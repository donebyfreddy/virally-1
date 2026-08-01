import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { pollRun, submitGeneration, type SubmitInput } from "@/lib/creative/pipeline";
import { tenantScope } from "@/lib/creative/scope";
import { linkRunToReservation } from "@/lib/generation/service";
import { MAX_JOB_AGE_MS, pollDelayMs } from "./backoff";
import {
  awaitExternal,
  completeJob,
  failJob,
  reportProgress,
  type ClaimedJob,
  type JobType,
} from "./queue";

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
};

export type HandlerResult =
  | { outcome: "submitted"; runId: string }
  | { outcome: "polling"; runId: string; state: string }
  | { outcome: "completed"; runId: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "abandoned"; reason: string };

export async function handleGenerationJob(job: ClaimedJob): Promise<HandlerResult> {
  const payload = job.payload as GenerationJobPayload;
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

  if (!payload.providerRunId) return submitPhase(job, payload, scope);
  return pollPhase(job, payload, scope, payload.providerRunId);
}

async function submitPhase(
  job: ClaimedJob,
  payload: GenerationJobPayload,
  scope: ReturnType<typeof tenantScope>,
): Promise<HandlerResult> {
  const request = { kind: payload.kind, input: payload.input } as SubmitInput;

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
    return { outcome: "failed", reason: outcome.reason };
  }

  // `already_running` is a success, not a conflict: it means this job — or an
  // identical one — reached the provider before, and the run to poll is the one
  // that already exists. Treating it as an error would fail a generation the
  // user is being charged for and which is going to complete regardless.
  const { runId } = outcome;

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
        code: `run_${poll.state}`,
        message: `The generation ended as ${poll.state}.`,
        retryable: false,
      },
      { attempts: job.attempts, maxAttempts: job.maxAttempts },
    );
    return { outcome: "failed", reason: poll.state };
  }

  await persistPollCount(job.id, payload, pollCount);

  if (poll.progress !== null) await reportProgress(job.id, poll.progress);

  await awaitExternal(
    job.id,
    new Date(Date.now() + pollDelayMs(pollCount, payload.suggestedPollMs)),
    // Progress is only written when the provider reported one. MuAPI never
    // does, so its jobs keep whatever the submit phase set and the UI renders
    // an indeterminate indicator rather than a bar frozen at a made-up number.
    poll.progress !== null ? { progress: poll.progress } : {},
  );

  return { outcome: "polling", runId, state: poll.state };
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
