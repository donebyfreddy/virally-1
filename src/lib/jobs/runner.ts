import { abandonRun } from "@/lib/creative/pipeline";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentItems } from "@/lib/db/schema";
import { tenantScope } from "@/lib/creative/scope";
import { GENERATION_JOB_TYPES, handleGenerationJob } from "./generation";
import {
  claimJobs,
  failJob,
  reclaimExpiredLeases,
  type ClaimedJob,
  type JobType,
} from "./queue";
import { handleRenderJob } from "./render";

/** Every job type this runner knows how to process, across both handlers. */
const ALL_RUNNABLE_JOB_TYPES: readonly JobType[] = [...GENERATION_JOB_TYPES, "content.render"];

/**
 * The drain loop.
 *
 * Bounded by wall clock rather than run as a daemon, because the deployment
 * target is a serverless function with an execution ceiling. A loop that ran
 * until the queue emptied would be killed mid-job at an arbitrary point; one
 * that stops while it still has budget leaves every claimed job either finished
 * or cleanly parked, and the next invocation picks up the rest.
 *
 * That constraint is also why this is safe to invoke concurrently. Two
 * overlapping runs claim disjoint batches (`FOR UPDATE SKIP LOCKED`) and hold
 * independent leases, so a cron firing again before the previous run finished
 * costs throughput at worst — never correctness.
 */

export type RunnerOptions = {
  /** Stop claiming once this much time has elapsed. Leaves room to finish. */
  budgetMs?: number;
  /** Jobs claimed per batch. Bounded so one batch cannot exhaust the budget. */
  batchSize?: number;
  /** Hard ceiling on jobs processed in one invocation. */
  maxJobs?: number;
  types?: readonly JobType[];
};

export type RunnerReport = {
  reclaimed: number;
  claimed: number;
  completed: number;
  polling: number;
  failed: number;
  abandoned: number;
  errored: number;
  /** True when the loop stopped on budget rather than on an empty queue. */
  budgetExhausted: boolean;
  durationMs: number;
};

/**
 * How much of the budget must remain to start another batch.
 *
 * A batch of slow video polls can take several seconds, so claiming one with
 * two seconds left would guarantee the function is killed holding leases. The
 * reserve is what turns "we ran out of time" from a correctness problem into a
 * scheduling one.
 */
const BATCH_RESERVE_MS = 5_000;

export async function runQueueOnce(options: RunnerOptions = {}): Promise<RunnerReport> {
  const budgetMs = options.budgetMs ?? 50_000;
  const batchSize = options.batchSize ?? 5;
  const maxJobs = options.maxJobs ?? 50;
  const types = options.types ?? ALL_RUNNABLE_JOB_TYPES;

  const startedAt = Date.now();
  const report: RunnerReport = {
    reclaimed: 0,
    claimed: 0,
    completed: 0,
    polling: 0,
    failed: 0,
    abandoned: 0,
    errored: 0,
    budgetExhausted: false,
    durationMs: 0,
  };

  // Before claiming, not after: a job orphaned by a dead worker is invisible to
  // the claim query until its lease is reclaimed, so doing this second would
  // delay every recovery by a full invocation.
  report.reclaimed = await reclaimExpiredLeases();

  while (report.claimed < maxJobs) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > budgetMs - BATCH_RESERVE_MS) {
      report.budgetExhausted = true;
      break;
    }

    const batch = await claimJobs({
      types,
      limit: Math.min(batchSize, maxJobs - report.claimed),
    });
    if (batch.length === 0) break;

    report.claimed += batch.length;

    // Sequential, not concurrent. Provider rate limits are per Virally account
    // and a batch of five parallel submissions is the fastest way to a 429 —
    // which costs a retry cycle and, on some vendors, counts against the quota
    // anyway. Concurrency belongs at the invocation level, where the queue's
    // claim semantics already make it safe.
    for (const job of batch) {
      const outcome = await runOne(job);
      report[outcome] += 1;
    }
  }

  report.durationMs = Date.now() - startedAt;
  return report;
}

type OutcomeKey = "completed" | "polling" | "failed" | "abandoned" | "errored";

/**
 * Runs one job, converting a thrown error into a recorded failure.
 *
 * Nothing may propagate out of here. An exception escaping would abandon the
 * rest of the batch with their leases held, so every job in it would wait a
 * full lease duration before anyone could touch it again — turning one bad job
 * into a stalled batch.
 */
async function runOne(job: ClaimedJob): Promise<OutcomeKey> {
  try {
    if (job.type === "content.render") {
      const result = await handleRenderJob(job);
      return result.outcome === "completed" ? "completed" : "failed";
    }

    const result = await handleGenerationJob(job);
    switch (result.outcome) {
      case "completed":
        return "completed";
      case "submitted":
      case "polling":
        return "polling";
      case "failed":
        return "failed";
      case "abandoned":
        return "abandoned";
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The job handler threw a non-Error value.";
    try {
      const outcome = await failJob(
        job.id,
        // Retryable: an unexpected throw is far more often a transient
        // condition — a dropped connection, a provider blip — than a permanent
        // one, and the attempt limit is what stops it cycling if it is not.
        { code: "handler_error", message, retryable: true },
        { attempts: job.attempts, maxAttempts: job.maxAttempts },
      );
      const contentItemId = job.payload.contentItemId;
      if (typeof contentItemId === "string") {
        await db
          .update(contentItems)
          .set({
            generationStatus: "failed",
            generationErrorCode: "UNKNOWN_ERROR",
            generationErrorMessage: message.slice(0, 500),
            generationErrorStage:
              job.type === "content.render"
                ? "rendering"
                : typeof job.payload.capability === "string"
                  ? job.payload.capability
                  : "asset_generation",
            generationCompletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(contentItems.id, contentItemId),
              eq(contentItems.workspaceId, job.workspaceId),
            ),
          );
      }
      // A dead-lettered job will never be polled again, so its run — if it has
      // one — must be closed out here or it sits non-terminal forever, quietly
      // consuming a concurrency slot for every generation after it. See
      // `abandonRun`'s doc comment for how that silently starves a workspace.
      const providerRunId = job.payload.providerRunId;
      if (outcome === "dead_letter" && typeof providerRunId === "string") {
        await abandonRun(
          tenantScope(job.organizationId, job.workspaceId),
          providerRunId,
          `The job polling this run gave up after ${job.attempts} attempts: ${message}`,
        );
      }
    } catch (failureError) {
      // The database is unreachable, so the job cannot be marked failed. Its
      // lease will expire and another invocation will reclaim it. Logged
      // because this is the one path where the queue's own bookkeeping failed.
      console.error(`[runner] Could not record failure for job ${job.id}.`, failureError);
    }
    return "errored";
  }
}
