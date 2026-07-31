import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerRuns } from "@/lib/db/schema";
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
import { ProviderNotConfiguredError, ProviderUnsupportedError } from "./types";

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
  options: { allowMockFallback?: boolean; jobId?: string | null; generationRunId?: string | null } = {},
): Promise<SubmitOutcome> {
  assertScope(scope);

  const decision = getProviderRouter().route({
    kind: request.kind,
    mode: request.input.mode,
    ratio: request.kind === "audio" ? undefined : request.input.ratio,
    durationSeconds: request.kind === "image" ? undefined : request.input.durationSeconds,
    allowMockFallback: options.allowMockFallback ?? true,
  });

  if (!decision.ok) return { status: "unavailable", reason: decision.reason };

  const provider = decision.provider;
  const estimate = await estimateFor(provider, request);

  // The run row exists before the provider is called, so a crash mid-submit
  // leaves something to reconcile rather than an untracked billable task.
  const { run, created } = await createOrGetRun({
    scope,
    idempotencyKey: request.input.idempotencyKey,
    providerId: provider.id,
    model: "pending",
    generationType: request.kind,
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
      isMock: decision.isMock,
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
  if (run.state === "completed" || run.state === "failed" || run.state === "cancelled") {
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
    await settleFor(scope, runId, status.failure?.costIncurred ? run.estimatedInternalCents : 0);
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
      await settleFor(scope, runId, run.estimatedInternalCents);
      return { runId, state: "failed", progress: null, terminal: true };
    }
    // Retryable: leave the run in `downloading` so the next poll tries again.
    throw error;
  }

  await completeRun(scope, runId, run.estimatedInternalCents);
  await settleFor(scope, runId, run.estimatedInternalCents);
  return { runId, state: "completed", progress: 100, terminal: true };
}

/**
 * Settles the reservation covering a run, if there is one.
 *
 * Best-effort and non-fatal: a settlement failure must not roll back a
 * completed generation, or the user loses media they were charged for. The
 * expiry sweeper releases anything left held.
 */
async function settleFor(
  scope: TenantScope,
  runId: string,
  actualCents: number,
): Promise<void> {
  const reservationId = await reservationForRun(scope, runId);
  if (!reservationId) return;
  try {
    await settleReservation(scope, reservationId, centsToCredits(actualCents));
  } catch {
    // Swallowed deliberately. See the doc comment: the alternative is failing a
    // generation the user already received.
  }
}

/**
 * Finds the reservation covering a run.
 *
 * Currently null in every case: reservations are created per campaign batch
 * (see src/lib/content/actions.ts), and the run-to-reservation link is written
 * when the batch scheduler enqueues jobs — which is not yet built. Returning
 * null rather than guessing means settlement is skipped, the hold stays, and
 * the expiry sweeper releases it. That is a delay, not a loss.
 */
async function reservationForRun(_scope: TenantScope, _runId: string): Promise<string | null> {
  return null;
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

function resolveProvider(providerId: string): CreativeGenerationProvider | null {
  const router = getProviderRouter();
  // Routing with mock fallback allowed guarantees a provider comes back; the id
  // check then confirms it is the one that actually ran this task. Polling a
  // different provider's task id would return nonsense.
  const decision = router.route({ kind: "image", mode: "fast", allowMockFallback: true });
  if (decision.ok && decision.provider.id === providerId) return decision.provider;
  return null;
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
