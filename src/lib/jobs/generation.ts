import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, contentItems, jobs, providerRunOutputs } from "@/lib/db/schema";
import { isContentReadyToRender } from "@/lib/creative/contentRender";
import { pollRun, submitGeneration, type SubmitInput } from "@/lib/creative/pipeline";
import { tenantScope } from "@/lib/creative/scope";
import { attachAssetToCampaign, attachAssetToShot } from "@/lib/generation/attach";
import { linkRunToReservation } from "@/lib/generation/service";
import {
  classifyGenerationError,
  userMessageForGenerationError,
} from "@/lib/generation/errors";
import { MAX_JOB_AGE_MS, pollDelayMs } from "./backoff";
import {
  awaitExternal,
  completeJob,
  enqueueJob,
  failJob,
  reportProgress,
  type ClaimedJob,
  type JobType,
} from "./queue";
import { logGenerationStage } from "./generationLog";

/**
 * The generation job handler.
 *
 * One handler serves both halves of a generation's life, and which half runs is
 * decided by whether the payload already carries a `providerRunId` rather than
 * by the job's status. That is deliberate: status can be rewritten by lease
 * recovery — a crashed worker's job returns to `pending` even though it had
 * already submitted — and a handler keyed on status would then resubmit it, and
 * bill for it twice. The payload is the only field that records what actually
 * reached the provider.
 *
 * Idempotency is defended twice over. The run row's
 * `UNIQUE (workspace_id, idempotency_key)` makes a duplicate submit collide in
 * the database rather than create a second billable task, and `submitGeneration`
 * reports `already_running` instead of throwing. The payload check above simply
 * avoids paying for a round trip to discover that.
 */

export const GENERATION_JOB_TYPES: readonly JobType[] = [
  "asset.image.generate",
  "asset.video.generate",
  "asset.voice.generate",
];

/**
 * What a generation job carries.
 *
 * `providerRunId` is written back onto the row the moment a submission
 * succeeds — before the job parks — so a crash between submit and park cannot
 * lose the link to a provider task that is already running and already costing
 * money.
 */
export type GenerationJobPayload = {
  kind: SubmitInput["kind"];
  input: SubmitInput["input"];
  providerRunId?: string;
  /**
   * The credit hold this generation runs against.
   *
   * Carried on the payload rather than looked up, because the link from run to
   * reservation is written by this handler — before it exists there is nothing
   * to look the reservation up by.
   */
  reservationId?: string;
  /** The provider and model the credit quote was built against. */
  preferredProviderId?: string | null;
  modelId?: string | null;
  capability?: string | null;
  /** Polls performed so far. Drives the easing curve in `pollDelayMs`. */
  pollCount?: number;
  suggestedPollMs?: number | null;
  allowMockFallback?: boolean;

  /**
   * Attachment. Carried through from `GenerationRequest` (service.ts) so the
   * worker can wire a completed asset into the thing that asked for it —
   * `attach.ts`'s functions exist for exactly this, but nothing called them
   * automatically until this field reached the completion handler below.
   */
  campaignId?: string | null;
  contentItemId?: string | null;
  shotId?: string | null;
};

export type HandlerResult =
  | { outcome: "submitted"; runId: string }
  | { outcome: "polling"; runId: string; state: string }
  | { outcome: "completed"; runId: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "abandoned"; reason: string };

export async function handleGenerationJob(job: ClaimedJob): Promise<HandlerResult> {
  const payload = job.payload as GenerationJobPayload;
  const handledAt = Date.now();
  // Tenancy from the row, never ambient. A worker has no session, so this is
  // the only honest source of scope it has.
  const scope = tenantScope(job.organizationId, job.workspaceId);

  const age = Date.now() - job.createdAt.getTime();
  if (age > MAX_JOB_AGE_MS) {
    // Retryable, so this dead-letters rather than failing: a generation that
    // ran an hour without finishing is a provider or systemic problem, not a
    // malformed request the user can fix.
    await failJob(
      job.id,
      {
        code: "generation_timeout",
        message: `The generation did not finish within ${Math.round(MAX_JOB_AGE_MS / 60_000)} minutes.`,
        retryable: true,
      },
      { attempts: job.maxAttempts, maxAttempts: job.maxAttempts },
    );
    return { outcome: "abandoned", reason: "exceeded maximum job age" };
  }

  const result = !payload.providerRunId
    ? await submitPhase(job, payload, scope)
    : await pollPhase(job, payload, scope, payload.providerRunId);
  logGenerationStage({
    contentId: payload.contentItemId ?? null,
    generationJobId: job.id,
    workspaceId: job.workspaceId,
    provider: payload.preferredProviderId ?? null,
    model: payload.modelId ?? null,
    stage: payload.capability ?? payload.kind,
    durationMs: Date.now() - handledAt,
    status: result.outcome,
    errorCode: result.outcome === "failed" || result.outcome === "abandoned" ? result.reason : null,
  });
  return result;
}

async function submitPhase(
  job: ClaimedJob,
  payload: GenerationJobPayload,
  scope: ReturnType<typeof tenantScope>,
): Promise<HandlerResult> {
  const request = { kind: payload.kind, input: payload.input } as SubmitInput;

  console.info(
    `[generation] submitting to fal jobId=${job.id} contentId=${payload.contentItemId ?? "-"} provider=${payload.preferredProviderId ?? "auto"} model=${payload.modelId ?? "auto"}`,
  );

  const outcome = await submitGeneration(scope, request, {
    allowMockFallback: payload.allowMockFallback ?? false,
    jobId: job.id,
    // Both carried from the service layer, which routed and quoted against
    // exactly these. Letting the pipeline re-route would let the catalogue
    // change between enqueue and submit decide what the user actually pays for.
    providerId: payload.preferredProviderId ?? null,
    modelId: payload.modelId ?? null,
    capability: payload.capability ?? null,
  });

  if (outcome.status === "unavailable") {
    // No configured provider could serve this. Not retryable: the configuration
    // will not change on its own, and retrying burns attempts to reach the same
    // conclusion three times.
    await failJob(
      job.id,
      { code: "provider_unavailable", message: outcome.reason, retryable: false },
      { attempts: job.attempts, maxAttempts: job.maxAttempts },
    );
    await markContentFailed(job, payload, "PROVIDER_UNAVAILABLE", outcome.reason);
    return { outcome: "failed", reason: outcome.reason };
  }

  // `already_running` is a success, not a conflict: it means this job — or an
  // identical one — reached the provider before, and the run to poll is the one
  // that already exists. Treating it as an error would fail a generation the
  // user is being charged for and which is going to complete regardless.
  const { runId } = outcome;
  console.info(
    `[generation] fal request submitted jobId=${job.id} externalJobId=${outcome.status === "submitted" ? outcome.externalTaskId : "already_running"}`,
  );

  // Written before parking. A crash here would otherwise orphan a provider task
  // that is already running and already billable.
  await persistRunId(job.id, payload, runId);

  // The second half of the reserve-then-submit ordering. The reservation was
  // made before the provider was called — it had to be, or the generation would
  // run against credits that were never withheld — and the run id only exists
  // now. Without this link the hold is never settled and the workspace is never
  // charged for work it received.
  if (payload.reservationId) {
    await linkRunToReservation(scope, payload.reservationId, runId);
  }

  await awaitExternal(job.id, new Date(Date.now() + pollDelayMs(0, payload.suggestedPollMs)), {
    progress: 10,
    externalJobId: outcome.status === "submitted" ? outcome.externalTaskId : null,
  });

  await markContentGenerating(job, payload);

  return { outcome: "submitted", runId };
}

async function pollPhase(
  job: ClaimedJob,
  payload: GenerationJobPayload,
  scope: ReturnType<typeof tenantScope>,
  runId: string,
): Promise<HandlerResult> {
  const poll = await pollRun(scope, runId);
  const pollCount = (payload.pollCount ?? 0) + 1;

  if (poll.terminal) {
    if (poll.state === "completed") {
      await attachCompletedAssets(scope, runId, payload);
      await completeJob(job.id, { providerRunId: runId, state: poll.state });
      return { outcome: "completed", runId };
    }
    // `failed`, `cancelled` or `dead_letter` on the run. The run row already
    // carries the failure detail and the refund decision; the job only mirrors
    // the outcome. Non-retryable because the run is terminal — retrying the job
    // would resubmit a generation the user was already told had failed.
    await failJob(
      job.id,
      {
        code: poll.failureCode ?? `run_${poll.state}`,
        message: poll.failureMessage ?? `The generation ended as ${poll.state}.`,
        retryable: false,
      },
      { attempts: job.attempts, maxAttempts: job.maxAttempts },
    );
    await markContentFailed(
      job,
      payload,
      poll.failureCode ?? "provider_error",
      poll.failureMessage ?? `The generation ended as ${poll.state}.`,
    );
    return { outcome: "failed", reason: poll.failureMessage ?? poll.state };
  }

  await persistPollCount(job.id, payload, pollCount);

  if (poll.progress !== null) await reportProgress(job.id, poll.progress);

  await awaitExternal(
    job.id,
    new Date(Date.now() + pollDelayMs(pollCount, payload.suggestedPollMs)),
    // Progress is only written when the provider reported one. fal never
    // does, so its jobs keep whatever the submit phase set and the UI renders
    // an indeterminate indicator rather than a bar frozen at a made-up number.
    poll.progress !== null ? { progress: poll.progress } : {},
  );

  return { outcome: "polling", runId, state: poll.state };
}

/**
 * Wires a completed run's asset(s) into whatever asked for them.
 *
 * `ingestRunOutputs` (pipeline.ts) copies provider bytes into Virally storage
 * and creates the `media_assets` rows, but it has no idea what the generation
 * was FOR — attaching it to a campaign, a content item or a shot is a
 * decision the caller made at submit time, not something ingestion can infer.
 * That decision travelled all the way through the job payload for exactly
 * this moment.
 *
 * Attachment is part of delivery, not cosmetic bookkeeping. A failure throws
 * so the queue retries and records it; otherwise the content can never become
 * renderable and the UI would wait forever with the only evidence in stderr.
 */
async function attachCompletedAssets(
  scope: ReturnType<typeof tenantScope>,
  runId: string,
  payload: GenerationJobPayload,
): Promise<void> {
  if (!payload.campaignId && !payload.contentItemId && !payload.shotId) return;

  const outputs = await db
      .select({ mediaAssetId: providerRunOutputs.mediaAssetId })
      .from(providerRunOutputs)
      .where(
        and(
          eq(providerRunOutputs.providerRunId, runId),
          eq(providerRunOutputs.workspaceId, scope.workspaceId),
        ),
      );

  const assetIds = outputs
      .map((row) => row.mediaAssetId)
      .filter((id): id is string => id !== null);

  for (const assetId of assetIds) {
      if (payload.campaignId || payload.contentItemId) {
        await attachAssetToCampaign(scope, assetId, {
          campaignId: payload.campaignId ?? null,
          contentItemId: payload.contentItemId ?? null,
        });
      }
  }

    // A shot holds exactly one asset. The first output is the one that fills
    // it; a model that returns several outputs for one shot is not a case any
    // catalogued model produces today.
  const [firstAssetId] = assetIds;
  if (payload.shotId && firstAssetId) {
    await attachAssetToShot(scope, payload.shotId, firstAssetId);
  }

  if (payload.contentItemId) {
    await enqueueRenderIfReady(scope, payload.contentItemId);
  }
}

/**
 * Enqueues the render once every asset a content item's plan called for has
 * arrived — checked, not assumed, because this runs after EVERY completed
 * generation and most of those completions still leave something outstanding.
 *
 * The idempotency key has no revision in it: today a content item is rendered
 * once, the first time it becomes ready. Regenerating a shot later and wanting
 * a fresh render is a real case this does not yet cover — see the "Regenerate"
 * action called for in the product brief, which is unbuilt.
 */
async function enqueueRenderIfReady(
  scope: ReturnType<typeof tenantScope>,
  contentItemId: string,
): Promise<void> {
  const ready = await isContentReadyToRender(scope, contentItemId);
  if (!ready) return;

  const enqueued = await enqueueJob({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    type: "content.render",
    payload: { contentItemId },
    idempotencyKey: `content.render:${contentItemId}`,
  });
  if (enqueued.created) {
    await db
      .update(contentItems)
      .set({
        generationStatus: "rendering",
        generationErrorCode: null,
        generationErrorMessage: null,
        generationErrorStage: null,
        updatedAt: new Date(),
      })
      .where(and(eq(contentItems.id, contentItemId), eq(contentItems.workspaceId, scope.workspaceId)));
  }
}

async function markContentGenerating(
  job: ClaimedJob,
  payload: GenerationJobPayload,
): Promise<void> {
  if (!payload.contentItemId) return;
  await db
    .update(contentItems)
    .set({ generationStatus: "generating", updatedAt: new Date() })
    .where(
      and(
        eq(contentItems.id, payload.contentItemId),
        eq(contentItems.workspaceId, job.workspaceId),
        sql`${contentItems.generationStatus} in ('queued', 'generating')`,
      ),
    );
}

async function markContentFailed(
  job: ClaimedJob,
  payload: GenerationJobPayload,
  code: string,
  message: string,
): Promise<void> {
  if (!payload.contentItemId) return;
  const contentItemId = payload.contentItemId;
  const stage = payload.capability ?? payload.kind;
  const normalisedCode = classifyGenerationError(code, message);
  const safeMessage = userMessageForGenerationError(
    normalisedCode,
    payload.preferredProviderId === "fal" ? "fal.ai" : (payload.preferredProviderId ?? "The provider"),
    message,
  );
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(contentItems)
      .set({
        generationStatus: "failed",
        generationErrorCode: normalisedCode,
        generationErrorMessage: safeMessage.slice(0, 500),
        generationErrorStage: stage,
        generationCompletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentItems.id, contentItemId),
          eq(contentItems.workspaceId, job.workspaceId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: job.organizationId,
      workspaceId: job.workspaceId,
      actorId: job.userId,
      kind: "content.generation_failed",
      subjectType: "content_item",
      subjectId: contentItemId,
      summary: `${stage} generation failed`,
      metadata: { jobId: job.id, errorCode: normalisedCode },
    });
  });
}

/**
 * Merges fields into the job payload.
 *
 * A read-modify-write rather than a `jsonb_set`, which is safe here only
 * because the claiming worker holds the lease and is the sole writer of this
 * row's payload for the duration.
 */
async function persistRunId(
  jobId: string,
  payload: GenerationJobPayload,
  providerRunId: string,
): Promise<void> {
  await db
    .update(jobs)
    .set({ payload: { ...payload, providerRunId }, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

async function persistPollCount(
  jobId: string,
  payload: GenerationJobPayload,
  pollCount: number,
): Promise<void> {
  await db
    .update(jobs)
    .set({ payload: { ...payload, pollCount }, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}
