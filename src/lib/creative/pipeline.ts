import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditReservations, providerRuns } from "@/lib/db/schema";
import { settleReservation } from "./credits";
import { IngestError, ingestRunOutputs } from "./ingest";
import { centsToCredits } from "./modes";
import { getProviderRouter } from "./router";
import type { TenantScope } from "./scope";
import { assertScope } from "./scope";
import { applyStatus, completeRun, createOrGetRun, recordSubmission } from "./runs";
import type {
  AudioGenerationInput,
  CreativeGenerationProvider,
  GenerationKind,
  ImageGenerationInput,
  VideoGenerationInput,
} from "./types";
import {
  ProviderNotConfiguredError,
  ProviderUnsupportedError,
  isTerminalRunState,
} from "./types";

/**
 * The generation pipeline.
 *
 * Sequences the four steps that a single piece of generated media passes
 * through, each independently retryable and each with its own durable state:
 *
 *   submit   -> provider has a task, we have its id
 *   poll     -> provider reports progress; on COMPLETED we get expiring URLs
 *   ingest   -> bytes copied into Virally storage, assets created
 *   settle   -> reservation charged for what was actually used
 *
 * The ordering constraints that make this safe are not incidental:
 *
 * The run row is written BEFORE the provider is called. A crash between "we
 * created a task" and "we recorded it" would otherwise leave a task billing
 * silently with nothing tracking it. Writing first means the worst case is a
 * row with no external id, which is visible and reconcilable.
 *
 * `completed` is reachable only through ingestion. `applyStatus` throws if
 * asked to write it, and `completeRun` refuses while any output lacks an asset.
 *
 * Settlement happens once, at the terminal transition, and is idempotent
 * because a retried worker must not charge twice.
 */

export type SubmitInput =
  | { kind: "image"; input: ImageGenerationInput }
  | { kind: "video"; input: VideoGenerationInput }
  | { kind: "audio"; input: AudioGenerationInput };

export type SubmitOutcome =
  | { status: "submitted"; runId: string; externalTaskId: string; providerId: string; isMock: boolean }
  /** The idempotency key already had a run. Nothing new was sent to the provider. */
  | { status: "already_running"; runId: string }
  | { status: "unavailable"; reason: string };

/**
 * Submits one generation.
 *
 * Idempotent on the input's `idempotencyKey`. A repeated call — a double-clicked
 * button, a retried job — finds the existing run and returns without creating a
 * second billable provider task.
 */
export async function submitGeneration(
  scope: TenantScope,
  request: SubmitInput,
  options: {
    allowMockFallback?: boolean;
    jobId?: string | null;
    generationRunId?: string | null;
    /**
     * The provider the caller already routed to.
     *
     * Supplied by the service layer, which routed, quoted and reserved credits
     * against a specific provider and model before this was ever enqueued.
     * Re-routing here would be free to pick a different one — the catalogue can
     * change between enqueue and submit — and the user would then be charged
     * against a quote for a model that never ran. Honoured rather than
     * re-derived for the same reason `resolveProvider` is a lookup and not a
     * route.
     */
    providerId?: string | null;
    /** The model that quote was built from. Pins adapter model selection. */
    modelId?: string | null;
    /** Recorded on the run so history can be filtered by capability. */
    capability?: string | null;
  } = {},
): Promise<SubmitOutcome> {
  assertScope(scope);

  const router = getProviderRouter();

  // A caller-supplied provider is used directly. Falling back to routing when
  // it cannot be resolved would silently undo the pin, so an unknown id is a
  // refusal instead.
  let provider: CreativeGenerationProvider;
  if (options.providerId) {
    const pinned = router.providerById(options.providerId, options.modelId ?? null);
    if (!pinned) {
      return {
        status: "unavailable",
        reason: `The provider this generation was quoted against (${options.providerId}) is no longer available.`,
      };
    }
    if (!pinned.isConfigured()) {
      return {
        status: "unavailable",
        reason: `Provider configuration required — ${pinned.credentialEnvVar} is not set.`,
      };
    }
    provider = pinned;
  } else {
    const decision = router.route({
      kind: request.kind,
      mode: request.input.mode,
      ratio: request.kind === "audio" ? undefined : request.input.ratio,
      durationSeconds: request.kind === "image" ? undefined : request.input.durationSeconds,
      allowMockFallback: options.allowMockFallback ?? true,
    });
    if (!decision.ok) return { status: "unavailable", reason: decision.reason };
    provider = decision.provider;
  }

  const isMock = provider.id === "mock";
  const estimate = await estimateFor(provider, request);

  // The run row exists before the provider is called, so a crash mid-submit
  // leaves something to reconcile rather than an untracked billable task.
  const { run, created } = await createOrGetRun({
    scope,
    idempotencyKey: request.input.idempotencyKey,
    providerId: provider.id,
    model: options.modelId ?? "pending",
    generationType: request.kind,
    capability: options.capability ?? null,
    prompt: request.input.prompt,
    negativePrompt: request.input.negativePrompt ?? null,
    requestedDurationSeconds: request.kind === "image" ? null : request.input.durationSeconds,
    requestedAspectRatio: request.kind === "audio" ? null : request.input.ratio,
    requestedResolution: request.kind === "image" ? (request.input.resolution ?? null) : null,
    estimatedInternalCents: estimate.internalCents,
    jobId: options.jobId ?? null,
    generationRunId: options.generationRunId ?? null,
  });

  // Not created means a task is already in flight for this key. Submitting
  // again would duplicate a provider charge.
  if (!created) return { status: "already_running", runId: run.id };

  try {
    const task = await generate(provider, request);
    const recorded = await recordSubmission(scope, run.id, task);

    if (!recorded) {
      // Another writer won the race and already recorded a task id. Ours is now
      // an orphan at the provider — logged rather than silently dropped,
      // because it may still bill.
      return { status: "already_running", runId: run.id };
    }

    return {
      status: "submitted",
      runId: run.id,
      externalTaskId: task.externalTaskId,
      providerId: provider.id,
      isMock,
    };
  } catch (error) {
    await failRun(scope, run.id, error);
    if (error instanceof ProviderNotConfiguredError || error instanceof ProviderUnsupportedError) {
      return { status: "unavailable", reason: error.message };
    }
    throw error;
  }
}

export type PollOutcome = {
  runId: string;
  state: string;
  progress: number | null;
  /** True when this poll advanced the run to a terminal state. */
  terminal: boolean;
};

/**
 * Polls one run and advances it as far as it can go.
 *
 * When the provider reports completion this also performs ingestion, so a
 * single poll can take a run from `generating` all the way to `completed`. That
 * is deliberate: a separate ingestion pass would leave runs sitting in
 * `downloading` whenever the pass was not scheduled, and `downloading` is
 * exactly the state a user must never be stuck watching.
 */
export async function pollRun(scope: TenantScope, runId: string): Promise<PollOutcome> {
  assertScope(scope);

  const rows = await db
    .select({
      id: providerRuns.id,
      providerId: providerRuns.providerId,
      externalTaskId: providerRuns.externalTaskId,
      generationType: providerRuns.generationType,
      state: providerRuns.state,
      estimatedInternalCents: providerRuns.estimatedInternalCents,
    })
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.id, runId),
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  const run = rows[0];
  if (!run) throw new Error(`No provider run ${runId} in this workspace.`);
  // `isTerminalRunState`, not `isTerminalState`: a dead-lettered run is terminal
  // and must not be polled again. Enumerating the three states inline was
  // correct until `dead_letter` existed, and would then have kept polling a run
  // the worker had already given up on — forever, since nothing would ever move
  // it on.
  if (isTerminalRunState(run.state)) {
    return { runId, state: run.state, progress: null, terminal: true };
  }
  if (!run.externalTaskId) {
    // Submitted but never recorded an id — the crash case createOrGetRun exists
    // to make visible. Not a poll problem; the run needs re-submission.
    return { runId, state: run.state, progress: null, terminal: false };
  }

  const provider = resolveProvider(run.providerId);
  if (!provider) {
    return { runId, state: run.state, progress: null, terminal: false };
  }

  const status = await provider.getTaskStatus(
    run.externalTaskId,
    run.generationType as GenerationKind,
  );

  if (status.state === "failed") {
    await applyStatus(scope, runId, status);
    await settleFor(scope, runId);
    return { runId, state: "failed", progress: null, terminal: true };
  }

  // Not yet finished at the provider. Record progress and stop.
  if (status.state !== "downloading") {
    await applyStatus(scope, runId, status);
    return { runId, state: status.state, progress: status.progress, terminal: false };
  }

  // Provider is done. Record the URLs, then copy the bytes before anything
  // claims this generation is complete.
  await applyStatus(scope, runId, status);

  try {
    await ingestRunOutputs(scope, runId);
  } catch (error) {
    if (error instanceof IngestError && !error.retryable) {
      await markFailed(scope, runId, "ingest_failed", error.message);
      // The provider did generate and did bill, so the reservation is charged
      // even though Virally never got the bytes. Refunding here would absorb a
      // real cost silently.
      await settleFor(scope, runId);
      return { runId, state: "failed", progress: null, terminal: true };
    }
    // Retryable: leave the run in `downloading` so the next poll tries again.
    throw error;
  }

  await completeRun(scope, runId, run.estimatedInternalCents);
  await settleFor(scope, runId);
  return { runId, state: "completed", progress: 100, terminal: true };
}

/**
 * Settles the reservation covering a run, once every run it covers is finished.
 *
 * A reservation can cover one run (a single generation) or many (a campaign
 * batch), and the difference is what makes this more than a lookup. Settling on
 * the first run of a batch to finish would charge the whole reservation for one
 * clip's cost and release the rest of the hold — so the remaining twenty clips
 * would generate against credits the user no longer has withheld, and the
 * ledger would say they were free. So the last run to finish settles, and the
 * others return having done nothing.
 *
 * Costs are read back from the run rows rather than passed in. Every terminal
 * transition writes `actual_internal_cents` — `completeRun` on success,
 * `applyStatus` on failure (estimate if the provider billed, zero if not), and
 * `markFailed` zero — so the database already holds the authoritative figure,
 * and a caller passing its own would be quoting an estimate at the exact moment
 * the real number became available.
 *
 * Best-effort and non-fatal: a settlement failure must not roll back a
 * completed generation, or the user loses media they were charged for. The
 * expiry sweeper releases anything left held.
 */
async function settleFor(scope: TenantScope, runId: string): Promise<void> {
  try {
    const reservation = await reservationForRun(scope, runId);
    if (!reservation) return;

    const covered = await db
      .select({
        state: providerRuns.state,
        actualInternalCents: providerRuns.actualInternalCents,
      })
      .from(providerRuns)
      .where(
        and(
          inArray(providerRuns.id, [...reservation.providerRunIds]),
          eq(providerRuns.workspaceId, scope.workspaceId),
          eq(providerRuns.organizationId, scope.organizationId),
        ),
      );

    // Still work in flight. The last run to finish settles for everyone.
    if (covered.some((run) => !isTerminalRunState(run.state))) return;

    const totalCents = covered.reduce((sum, run) => sum + (run.actualInternalCents ?? 0), 0);

    // Two runs finishing concurrently can both reach here and both settle. That
    // is safe rather than merely tolerated: `settleReservation` is idempotent on
    // an already-settled reservation, so the second call is a no-op instead of a
    // double charge.
    await settleReservation(scope, reservation.id, centsToCredits(totalCents));
  } catch {
    // Swallowed deliberately. See the doc comment: the alternative is failing a
    // generation the user already received.
  }
}

type CoveringReservation = { id: string; providerRunIds: readonly string[] };

/**
 * Finds the held reservation covering a run.
 *
 * Matches on `provider_run_ids` containment. Only `held` reservations are
 * considered — a settled or released one has already had its outcome recorded,
 * and re-settling it on a late-arriving poll would be a second charge.
 *
 * Returns at most one. A run belonging to two held reservations would be a bug
 * in whoever created them, and picking the oldest makes the behaviour
 * deterministic rather than dependent on row order.
 */
async function reservationForRun(
  scope: TenantScope,
  runId: string,
): Promise<CoveringReservation | null> {
  const rows = await db
    .select({
      id: creditReservations.id,
      providerRunIds: creditReservations.providerRunIds,
    })
    .from(creditReservations)
    .where(
      and(
        eq(creditReservations.organizationId, scope.organizationId),
        eq(creditReservations.workspaceId, scope.workspaceId),
        eq(creditReservations.state, "held"),
        sql`${creditReservations.providerRunIds} @> ${JSON.stringify([runId])}::jsonb`,
      ),
    )
    .orderBy(creditReservations.createdAt)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const ids = Array.isArray(row.providerRunIds)
    ? row.providerRunIds.filter((id): id is string => typeof id === "string")
    : [];

  // A reservation whose id list does not contain the run that matched it is not
  // something to guess about — the containment query said it does, so an empty
  // list means the column holds something malformed.
  if (!ids.includes(runId)) return null;

  return { id: row.id, providerRunIds: ids };
}

/**
 * Attaches a run to a reservation.
 *
 * Called by the submit path once the run row exists, because the reservation
 * has to be made BEFORE the provider is called — credits are withheld against
 * work that has not started — while the run id only exists after. Appending
 * rather than replacing, so a batch reservation accumulates its runs.
 */
export async function attachRunToReservation(
  scope: TenantScope,
  reservationId: string,
  runId: string,
): Promise<void> {
  assertScope(scope);
  await db
    .update(creditReservations)
    .set({
      // Appended in SQL rather than read-modify-written in TypeScript: two
      // concurrent submissions against one batch reservation would otherwise
      // each write a list missing the other's run.
      providerRunIds: sql`
        case when ${creditReservations.providerRunIds} @> ${JSON.stringify([runId])}::jsonb
             then ${creditReservations.providerRunIds}
             else ${creditReservations.providerRunIds} || ${JSON.stringify([runId])}::jsonb
        end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(creditReservations.id, reservationId),
        eq(creditReservations.organizationId, scope.organizationId),
        eq(creditReservations.workspaceId, scope.workspaceId),
        eq(creditReservations.state, "held"),
      ),
    );
}

async function failRun(scope: TenantScope, runId: string, error: unknown): Promise<void> {
  const message =
    error instanceof Error ? error.message : "The generation failed before it was submitted.";
  await markFailed(scope, runId, "submit_failed", message);
}

async function markFailed(
  scope: TenantScope,
  runId: string,
  code: string,
  message: string,
): Promise<void> {
  await db
    .update(providerRuns)
    .set({
      state: "failed",
      failureCode: code,
      failureMessage: message.slice(0, 500),
      actualInternalCents: 0,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(providerRuns.id, runId),
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
        sql`${providerRuns.state} not in ('completed', 'failed', 'cancelled')`,
      ),
    );
}

/**
 * Finds the provider that submitted a run, by the id recorded on its row.
 *
 * A direct lookup, NOT a re-route. The previous implementation routed a
 * synthetic `{ kind: "image", mode: "fast" }` request and accepted the result
 * only if its id matched, which happened to work while Magnific was the sole
 * candidate and silently stopped working the moment MuAPI was added: a MuAPI
 * run would route to Magnific, fail the id check, and resolve to null — leaving
 * the run stuck in `submitted` with no error, because "provider not found" is
 * treated as a transient condition.
 *
 * Resolution must depend only on what the run recorded. Routing answers "who
 * should do this next time", which is a different question from "who has the
 * task id I need to poll", and the two diverge whenever the catalogue, the
 * configuration or the price changes between submit and poll.
 */
function resolveProvider(providerId: string): CreativeGenerationProvider | null {
  return getProviderRouter().providerById(providerId);
}

async function estimateFor(provider: CreativeGenerationProvider, request: SubmitInput) {
  if (request.kind === "image") return provider.estimateImage(request.input);
  if (request.kind === "video") return provider.estimateVideo(request.input);
  return provider.estimateAudio(request.input);
}

async function generate(provider: CreativeGenerationProvider, request: SubmitInput) {
  if (request.kind === "image") return provider.generateImage(request.input);
  if (request.kind === "video") return provider.generateVideo(request.input);
  return provider.generateAudio(request.input);
}
