import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, contentItems, jobs } from "@/lib/db/schema";
import { releaseReservation } from "@/lib/creative/credits";
import { tenantScope } from "@/lib/creative/scope";
import { QUEUE_CLAIM_TIMEOUT_MS } from "./backoff";
import { failJob } from "./queue";

/**
 * Fails jobs nobody has even looked at.
 *
 * `reclaimExpiredLeases` (queue.ts) recovers a job a worker started and then
 * abandoned mid-lease. This recovers the other failure mode: a job no worker
 * has EVER claimed — `locked_by` was never set — because nothing is consuming
 * the queue at all. No local `dev:worker` process running, `CRON_SECRET`
 * unconfigured, the self-trigger in trigger.ts lost. Both failure modes look
 * identical to a user watching the content page: "Queued" forever. Run
 * alongside `reclaimExpiredLeases`, before every claim attempt, so an
 * unconsumed queue surfaces as a specific, actionable failure instead of an
 * infinite spinner and a permanently withheld credit reservation.
 */
export async function failStaleQueuedJobs(
  options: { now?: Date; timeoutMs?: number; limit?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? QUEUE_CLAIM_TIMEOUT_MS;
  const cutoff = new Date(now.getTime() - timeoutMs);
  const limit = options.limit ?? 50;

  const stale = await db
    .select({
      id: jobs.id,
      organizationId: jobs.organizationId,
      workspaceId: jobs.workspaceId,
      type: jobs.type,
      payload: jobs.payload,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
    })
    .from(jobs)
    .where(
      and(
        sql`${jobs.status} in ('pending', 'queued')`,
        isNull(jobs.lockedBy),
        lt(jobs.createdAt, cutoff),
      ),
    )
    .limit(limit);

  for (const job of stale) {
    await failOneStaleJob(job, now);
  }
  return stale.length;
}

const USER_MESSAGE = "Generation couldn't start. The generation worker did not pick up this job.";

type StaleJob = {
  id: string;
  organizationId: string;
  workspaceId: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

async function failOneStaleJob(job: StaleJob, now: Date): Promise<void> {
  await failJob(
    job.id,
    { code: "WORKER_UNAVAILABLE", message: USER_MESSAGE, retryable: false },
    { attempts: job.attempts, maxAttempts: job.maxAttempts, now },
  );

  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const contentItemId = typeof payload.contentItemId === "string" ? payload.contentItemId : null;
  const reservationId = typeof payload.reservationId === "string" ? payload.reservationId : null;

  if (contentItemId) {
    const stage =
      job.type === "content.render"
        ? "rendering"
        : typeof payload.capability === "string"
          ? payload.capability
          : "asset_generation";

    await db.transaction(async (tx) => {
      await tx
        .update(contentItems)
        .set({
          generationStatus: "failed",
          generationErrorCode: "WORKER_UNAVAILABLE",
          generationErrorMessage: USER_MESSAGE,
          generationErrorStage: stage,
          generationCompletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(contentItems.id, contentItemId),
            eq(contentItems.workspaceId, job.workspaceId),
            sql`${contentItems.generationStatus} in ('queued', 'generating', 'rendering')`,
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: job.organizationId,
        workspaceId: job.workspaceId,
        actorId: null,
        kind: "content.generation_failed",
        subjectType: "content_item",
        subjectId: contentItemId,
        summary: `${stage} generation failed: no worker claimed the job`,
        metadata: { jobId: job.id, errorCode: "WORKER_UNAVAILABLE" },
      });
    });
  }

  if (reservationId) {
    try {
      await releaseReservation(
        tenantScope(job.organizationId, job.workspaceId),
        reservationId,
        "The generation worker did not pick up this job before the timeout.",
      );
    } catch (error) {
      // A reservation already settled or released by another path is not an
      // error worth failing the watchdog pass over; anything else is logged
      // so a permanently stuck hold has a trail.
      console.error(`[watchdog] Could not release reservation ${reservationId} for job ${job.id}.`, error);
    }
  }
}
