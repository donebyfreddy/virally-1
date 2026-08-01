import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobEvents, jobs } from "@/lib/db/schema";
import type { JobStatus } from "@/types/database";
import { LEASE_MS, isExhausted, retryDelayMs } from "./backoff";

/**
 * Postgres-backed work queue.
 *
 * The `jobs` table was designed for this and has been waiting for it: the claim
 * index, the `locked_by`/`locked_until` lease pair and the `idempotency_key`
 * unique are all here to support exactly the operations below. Nothing drained
 * it before, so every generation ran inside a request — which is the thing the
 * brief forbids, and which cannot work at all for a video model that takes four
 * minutes.
 *
 * Three properties carry the design:
 *
 * **Claiming is atomic and lock-free between workers.** `FOR UPDATE SKIP
 * LOCKED` means two workers racing for the same batch take disjoint sets rather
 * than one blocking on the other. Without it, scaling to a second worker
 * either double-runs jobs or serialises them.
 *
 * **A lease, not a flag.** A worker that crashes mid-job cannot release
 * anything, so ownership has to expire on its own. `locked_until` is what makes
 * a dead worker's jobs reclaimable without an operator noticing first.
 *
 * **Tenancy comes from the row.** A worker serves every workspace, so it has no
 * ambient tenant context and must never invent one. Each claimed job carries
 * its own `organizationId`/`workspaceId`, and every downstream call is scoped
 * with those. This is the one place in the codebase where a tenant scope is not
 * derived from a session, and it is safe only because it is derived from the
 * row being processed rather than from anything the caller supplied.
 */

/** Job types this queue understands. Mirrors the `jobs.type` CHECK. */
export type JobType = typeof jobs.$inferSelect["type"];

/**
 * Statuses a job can be claimed from.
 *
 * `waiting_external` is claimable, which is what makes polling work: a job that
 * submitted to a provider parks in that state with `run_after` set to its next
 * poll time, and the same claim query picks it back up when that time arrives.
 * A separate poller reading a separate table would need its own lease, its own
 * backoff and its own crash recovery — all of which this already has.
 */
const CLAIMABLE: readonly JobStatus[] = ["pending", "queued", "waiting_external"];

/** Identifies this process in `locked_by`. Regenerated per process, on purpose. */
export const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

export type ClaimedJob = {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId: string | null;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  startedAt: Date | null;
};

export type ClaimOptions = {
  /** Restrict to these types. Omitted means any type this queue serves. */
  types?: readonly JobType[];
  limit?: number;
  leaseMs?: number;
  workerId?: string;
  now?: Date;
};

/**
 * Atomically claims up to `limit` due jobs.
 *
 * Ordered by priority then `run_after`, so an urgent job jumps a backlog but
 * two jobs of equal priority are served oldest first. Starvation is bounded
 * because priority is a small fixed range (1-9) rather than a computed score.
 *
 * `attempts` is incremented AT CLAIM, not at failure. Claiming is the only
 * moment we are certain the work is about to be tried; incrementing on failure
 * would leave a job that crashed the worker hard — OOM, SIGKILL — with its
 * count unchanged, so it would be reclaimed and crash the next worker too,
 * forever. Counting at claim makes a poison-pill job dead-letter itself.
 */
export async function claimJobs(options: ClaimOptions = {}): Promise<readonly ClaimedJob[]> {
  const limit = options.limit ?? 5;
  const leaseMs = options.leaseMs ?? LEASE_MS;
  const workerId = options.workerId ?? WORKER_ID;
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  const typeFilter = options.types?.length
    ? sql`and type in ${sql.raw(`(${options.types.map((t) => `'${t}'`).join(", ")})`)}`
    : sql``;

  const rows = await db.execute<{
    id: string;
    organization_id: string;
    workspace_id: string;
    user_id: string | null;
    type: JobType;
    status: JobStatus;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    created_at: Date;
    started_at: Date | null;
  }>(sql`
    update jobs set
      status = 'running',
      locked_by = ${workerId},
      locked_until = ${leaseUntil},
      attempts = attempts + 1,
      started_at = coalesce(started_at, ${now}),
      updated_at = ${now}
    where id in (
      select id from jobs
      where status in ('pending', 'queued', 'waiting_external')
        and run_after <= ${now}
        -- A live lease held by another worker. Not ours to take.
        and (locked_until is null or locked_until < ${now})
        ${typeFilter}
      order by priority asc, run_after asc
      limit ${limit}
      -- Disjoint batches between concurrent workers. Without this two workers
      -- either block on each other or claim the same rows.
      for update skip locked
    )
    returning id, organization_id, workspace_id, user_id, type, status, payload,
              attempts, max_attempts, created_at, started_at
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    payload: row.payload ?? {},
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: new Date(row.created_at),
    startedAt: row.started_at ? new Date(row.started_at) : null,
  }));
}

/**
 * Extends the lease on a job still being worked.
 *
 * Guarded on `locked_by` so a worker whose lease already expired — and whose
 * job another worker has since claimed — cannot extend a lease it no longer
 * holds and start writing over the new owner's work. Returns false in that
 * case, which the handler must treat as "stop, you have been superseded".
 */
export async function heartbeat(
  jobId: string,
  options: { workerId?: string; leaseMs?: number; now?: Date } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const result = await db
    .update(jobs)
    .set({ lockedUntil: new Date(now.getTime() + (options.leaseMs ?? LEASE_MS)), updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.lockedBy, options.workerId ?? WORKER_ID)))
    .returning({ id: jobs.id });
  return result.length > 0;
}

/** Marks a job finished. Releases the lease so the row reads cleanly. */
export async function completeJob(
  jobId: string,
  result: Record<string, unknown> = {},
  options: { now?: Date; progress?: number } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await transition(jobId, "completed", {
    now,
    detail: null,
    set: {
      result,
      progress: options.progress ?? 100,
      completedAt: now,
      lockedBy: null,
      lockedUntil: null,
      failureCode: null,
      failureMessage: null,
    },
  });
}

/**
 * Parks a job until its next poll.
 *
 * The lease is released on purpose. A job waiting on a provider is not being
 * worked, and holding the lease across the wait would make a worker that dies
 * mid-wait block the job for the whole lease duration for no benefit —
 * `run_after` already prevents it being picked up early.
 */
export async function awaitExternal(
  jobId: string,
  nextPollAt: Date,
  options: { now?: Date; progress?: number; externalJobId?: string | null } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await transition(jobId, "waiting_external", {
    now,
    detail: `Next poll at ${nextPollAt.toISOString()}.`,
    set: {
      runAfter: nextPollAt,
      lockedBy: null,
      lockedUntil: null,
      ...(options.progress !== undefined ? { progress: options.progress } : {}),
      ...(options.externalJobId !== undefined ? { externalJobId: options.externalJobId } : {}),
    },
  });
}

export type JobFailure = {
  code: string;
  message: string;
  /** Whether another attempt could plausibly succeed. A 400 cannot; a 503 can. */
  retryable: boolean;
};

export type FailOutcome = "retry_scheduled" | "failed" | "dead_letter";

/**
 * Records a failed attempt and decides what happens next.
 *
 * Three outcomes, and the difference between the last two matters operationally.
 * A non-retryable failure is `failed`: the request was wrong and a user can fix
 * and resubmit it. A retryable failure that has exhausted its attempts is
 * `dead_letter`: policy gave up, and someone should ask why rather than assume
 * a user will notice. Reporting both as `failed` is how a systemic outage comes
 * to look like a hundred unrelated user errors.
 */
export async function failJob(
  jobId: string,
  failure: JobFailure,
  options: { attempts: number; maxAttempts: number; now?: Date },
): Promise<FailOutcome> {
  const now = options.now ?? new Date();
  const message = failure.message.slice(0, 500);

  if (failure.retryable && !isExhausted(options.attempts, options.maxAttempts)) {
    const runAfter = new Date(now.getTime() + retryDelayMs(options.attempts));
    await transition(jobId, "pending", {
      now,
      detail: `Attempt ${options.attempts} failed (${failure.code}). Retrying at ${runAfter.toISOString()}.`,
      set: {
        runAfter,
        lockedBy: null,
        lockedUntil: null,
        failureCode: failure.code,
        failureMessage: message,
      },
    });
    return "retry_scheduled";
  }

  const terminal: JobStatus =
    failure.retryable && isExhausted(options.attempts, options.maxAttempts)
      ? "dead_letter"
      : "failed";

  await transition(jobId, terminal, {
    now,
    detail: `${failure.code}: ${message}`,
    set: {
      completedAt: now,
      lockedBy: null,
      lockedUntil: null,
      failureCode: failure.code,
      failureMessage: message,
    },
  });
  return terminal === "dead_letter" ? "dead_letter" : "failed";
}

/**
 * Returns jobs whose lease expired to the pending pool.
 *
 * This is crash recovery. A worker that died holding jobs cannot release them,
 * and nothing else will notice: the rows sit in `running` with a lease that has
 * passed, invisible to the claim query's `status in (...)` filter. Run before
 * every claim so a lost worker costs one lease duration rather than requiring
 * an operator.
 *
 * Attempts are NOT reset. A job that repeatedly kills its worker must still
 * reach its attempt limit and dead-letter, or it will cycle forever.
 */
export async function reclaimExpiredLeases(options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const rows = await db
    .update(jobs)
    .set({ status: "pending", lockedBy: null, lockedUntil: null, updatedAt: now })
    .where(
      and(
        eq(jobs.status, "running"),
        sql`${jobs.lockedUntil} is not null`,
        sql`${jobs.lockedUntil} < ${now}`,
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

export type EnqueueInput = {
  organizationId: string;
  workspaceId: string;
  userId?: string | null;
  type: JobType;
  payload: Record<string, unknown>;
  /** Required. What makes a double-submit one job instead of two. */
  idempotencyKey: string;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
  parentJobId?: string | null;
};

/**
 * Enqueues a job, or returns the existing one with the same key.
 *
 * `created: false` means the caller must NOT treat this as a fresh submission —
 * the work is already queued or already done. Returning the existing id rather
 * than throwing lets a retrying caller converge on the same job instead of
 * having to distinguish "conflict" from "error".
 */
export async function enqueueJob(
  input: EnqueueInput,
): Promise<{ jobId: string; created: boolean }> {
  const inserted = await db
    .insert(jobs)
    .values({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      status: "queued",
      priority: input.priority ?? 5,
      maxAttempts: input.maxAttempts ?? 3,
      runAfter: input.runAfter ?? new Date(),
      parentJobId: input.parentJobId ?? null,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });

  const created = inserted[0];
  if (created) return { jobId: created.id, created: true };

  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (!existing) {
    // Insert reported a conflict and the read found nothing. Only reachable if
    // the conflicting row was deleted between the two statements, which nothing
    // in the application does. Loud rather than silently returning a fake id.
    throw new Error(`Job ${input.idempotencyKey} conflicted but could not be read back.`);
  }
  return { jobId: existing.id, created: false };
}

/** Progress, for the dashboard. Deliberately does not touch the lease. */
export async function reportProgress(jobId: string, progress: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  await db
    .update(jobs)
    .set({ progress: clamped, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

/**
 * Applies a status change and records it in `job_events`.
 *
 * Both in one transaction so the audit trail cannot disagree with the row. The
 * `from` status is read inside the transaction rather than passed in, because a
 * caller's idea of the current status is stale by definition and an event
 * claiming a transition that did not happen is worse than no event.
 */
async function transition(
  jobId: string,
  to: JobStatus,
  options: {
    now: Date;
    detail: string | null;
    set: Partial<typeof jobs.$inferInsert>;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: jobs.status, workspaceId: jobs.workspaceId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!current) return;

    await tx
      .update(jobs)
      .set({ ...options.set, status: to, updatedAt: options.now })
      .where(eq(jobs.id, jobId));

    await tx.insert(jobEvents).values({
      jobId,
      workspaceId: current.workspaceId,
      fromStatus: current.status,
      toStatus: to,
      detail: options.detail,
    });
  });
}

export { CLAIMABLE };
