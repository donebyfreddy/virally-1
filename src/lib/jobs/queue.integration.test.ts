/**
 * @vitest-environment node
 *
 * Integration tests for the durable queue, against a REAL Postgres.
 *
 * These exist because every property worth asserting here is a property of the
 * database rather than of the TypeScript. `FOR UPDATE SKIP LOCKED` giving two
 * concurrent workers disjoint batches, a lease expiring so a dead worker's jobs
 * become reclaimable, an `ON CONFLICT` making a double-submit one job — none of
 * those can be observed against a mock. A mocked `db` would assert that the
 * code calls the functions I wrote, which is not the same as asserting that a
 * job cannot be run twice.
 *
 * Skipped automatically when DATABASE_URL is absent, so `npm test` still passes
 * on a machine with no database. That skip is reported, never silent.
 *
 * Every test creates its own organisation and workspace and deletes them
 * afterwards, so a run leaves the database as it found it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local" });

const HAS_DATABASE = Boolean(process.env.DATABASE_URL?.trim());

// Imported lazily: src/lib/db constructs a Pool at module scope and throws when
// DATABASE_URL is unset, which would fail the file before it could skip.
type Deps = {
  db: typeof import("@/lib/db").db;
  pool: typeof import("@/lib/db").pool;
  schema: typeof import("@/lib/db/schema");
  queue: typeof import("./queue");
};

let deps: Deps;

const created: { organizationId: string; workspaceId: string }[] = [];
const createdUsers: string[] = [];

beforeAll(async () => {
  if (!HAS_DATABASE) return;
  deps = {
    db: (await import("@/lib/db")).db,
    pool: (await import("@/lib/db")).pool,
    schema: await import("@/lib/db/schema"),
    queue: await import("./queue"),
  };
});

afterEach(async () => {
  if (!HAS_DATABASE) return;
  // Organisation delete cascades to workspaces, jobs and job_events.
  for (const entry of created.splice(0)) {
    await deps.db
      .delete(deps.schema.organizations)
      .where(eq(deps.schema.organizations.id, entry.organizationId));
  }
  for (const userId of createdUsers.splice(0)) {
    await deps.db.delete(deps.schema.user).where(eq(deps.schema.user.id, userId));
  }
});

afterAll(async () => {
  if (!HAS_DATABASE) return;
  await deps.pool.end();
});

async function freshScope(): Promise<{ organizationId: string; workspaceId: string }> {
  const suffix = `${created.length}${Date.now().toString(36)}`.toLowerCase();

  const [account] = await deps.db
    .insert(deps.schema.user)
    .values({ name: `Test ${suffix}`, email: `queue-${suffix}@example.invalid` })
    .returning({ id: deps.schema.user.id });
  createdUsers.push(account!.id);

  const [organization] = await deps.db
    .insert(deps.schema.organizations)
    .values({ name: `queue-org-${suffix}`, slug: `queue-org-${suffix}`, createdBy: account!.id })
    .returning({ id: deps.schema.organizations.id });

  const [workspace] = await deps.db
    .insert(deps.schema.workspaces)
    .values({
      organizationId: organization!.id,
      name: `queue-ws-${suffix}`,
      slug: `queue-ws-${suffix}`,
      createdBy: account!.id,
    })
    .returning({ id: deps.schema.workspaces.id });

  const entry = { organizationId: organization!.id, workspaceId: workspace!.id };
  created.push(entry);
  return entry;
}

let keyCounter = 0;

async function enqueue(
  scope: { organizationId: string; workspaceId: string },
  overrides: Partial<Parameters<Deps["queue"]["enqueueJob"]>[0]> = {},
) {
  keyCounter += 1;
  return deps.queue.enqueueJob({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    type: "asset.image.generate",
    payload: { kind: "image" },
    idempotencyKey: `test-${Date.now().toString(36)}-${keyCounter}`,
    ...overrides,
  });
}

async function readJob(jobId: string) {
  const [row] = await deps.db
    .select()
    .from(deps.schema.jobs)
    .where(eq(deps.schema.jobs.id, jobId))
    .limit(1);
  return row!;
}

describe.skipIf(!HAS_DATABASE)("durable queue (integration)", () => {
  it("claims a due job and increments its attempt count", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope);

    const claimed = await deps.queue.claimJobs({ limit: 10 });
    const mine = claimed.find((job) => job.id === jobId);

    expect(mine).toBeDefined();
    // Attempts increment AT CLAIM, not at failure. A job that hard-crashes its
    // worker must still burn an attempt, or it will crash every worker forever.
    expect(mine!.attempts).toBe(1);
    expect(mine!.organizationId).toBe(scope.organizationId);
    expect(mine!.workspaceId).toBe(scope.workspaceId);

    const row = await readJob(jobId);
    expect(row.status).toBe("running");
    expect(row.lockedBy).not.toBeNull();
    expect(row.lockedUntil).not.toBeNull();
    expect(row.startedAt).not.toBeNull();
  });

  it("never hands the same job to two concurrent claims", async () => {
    const scope = await freshScope();
    const ids = new Set<string>();
    for (let i = 0; i < 6; i += 1) {
      const { jobId } = await enqueue(scope);
      ids.add(jobId);
    }

    // The load-bearing assertion of this file. Issued concurrently so the two
    // claims genuinely race; SKIP LOCKED is what makes their batches disjoint
    // rather than one blocking or both taking the same rows.
    const [first, second] = await Promise.all([
      deps.queue.claimJobs({ limit: 6, workerId: "worker-a" }),
      deps.queue.claimJobs({ limit: 6, workerId: "worker-b" }),
    ]);

    const firstMine = first.filter((job) => ids.has(job.id)).map((job) => job.id);
    const secondMine = second.filter((job) => ids.has(job.id)).map((job) => job.id);

    const overlap = firstMine.filter((id) => secondMine.includes(id));
    expect(overlap).toEqual([]);
    expect(new Set([...firstMine, ...secondMine]).size).toBe(firstMine.length + secondMine.length);
  });

  it("does not claim a job whose run_after is in the future", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope, { runAfter: new Date(Date.now() + 60_000) });

    const claimed = await deps.queue.claimJobs({ limit: 20 });
    expect(claimed.find((job) => job.id === jobId)).toBeUndefined();
  });

  it("does not claim a job held under a live lease", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope);

    await deps.queue.claimJobs({ limit: 20, workerId: "worker-a" });
    const second = await deps.queue.claimJobs({ limit: 20, workerId: "worker-b" });

    expect(second.find((job) => job.id === jobId)).toBeUndefined();
  });

  it("reclaims a job whose lease expired, without resetting its attempts", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope);

    // A worker that died holding the job. It cannot release anything, so the
    // lease expiring is the only thing that can recover it.
    await deps.queue.claimJobs({ limit: 20, leaseMs: -1_000 });
    expect((await readJob(jobId)).status).toBe("running");

    const reclaimed = await deps.queue.reclaimExpiredLeases();
    expect(reclaimed).toBeGreaterThanOrEqual(1);

    const row = await readJob(jobId);
    expect(row.status).toBe("pending");
    expect(row.lockedBy).toBeNull();
    // Not reset: a job that repeatedly kills its worker must still reach its
    // limit and dead-letter rather than cycling forever.
    expect(row.attempts).toBe(1);
  });

  it("refuses a heartbeat from a worker that no longer holds the lease", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope);
    await deps.queue.claimJobs({ limit: 20, workerId: "worker-a" });

    expect(await deps.queue.heartbeat(jobId, { workerId: "worker-a" })).toBe(true);
    // A superseded worker must not be able to extend a lease it lost, or it
    // would keep writing over the new owner's work.
    expect(await deps.queue.heartbeat(jobId, { workerId: "worker-b" })).toBe(false);
  });

  it("schedules a retry for a retryable failure with attempts remaining", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope, { maxAttempts: 3 });

    const outcome = await deps.queue.failJob(
      jobId,
      { code: "provider_unavailable", message: "503", retryable: true },
      { attempts: 1, maxAttempts: 3 },
    );

    expect(outcome).toBe("retry_scheduled");
    const row = await readJob(jobId);
    expect(row.status).toBe("pending");
    expect(row.lockedBy).toBeNull();
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(row.completedAt).toBeNull();
  });

  it("fails outright, without retrying, when the failure is not retryable", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope, { maxAttempts: 3 });

    const outcome = await deps.queue.failJob(
      jobId,
      { code: "invalid_request", message: "400", retryable: false },
      { attempts: 1, maxAttempts: 3 },
    );

    // Attempts remained, but retrying a malformed request just reaches the same
    // 400 three times.
    expect(outcome).toBe("failed");
    expect((await readJob(jobId)).status).toBe("failed");
  });

  it("dead-letters a retryable failure that has exhausted its attempts", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope, { maxAttempts: 3 });

    const outcome = await deps.queue.failJob(
      jobId,
      { code: "provider_unavailable", message: "503", retryable: true },
      { attempts: 3, maxAttempts: 3 },
    );

    // Distinct from `failed` on purpose: policy gave up, so someone should ask
    // why rather than assume a user will notice.
    expect(outcome).toBe("dead_letter");
    const row = await readJob(jobId);
    expect(row.status).toBe("dead_letter");
    expect(row.completedAt).not.toBeNull();
  });

  it("makes a duplicate enqueue return the existing job rather than a second one", async () => {
    const scope = await freshScope();
    const key = `dedupe-${Date.now().toString(36)}`;

    const first = await enqueue(scope, { idempotencyKey: key });
    const second = await enqueue(scope, { idempotencyKey: key });

    expect(first.created).toBe(true);
    // What makes a double-clicked Generate one job instead of two.
    expect(second.created).toBe(false);
    expect(second.jobId).toBe(first.jobId);
  });

  it("parks a job for polling and releases the lease while it waits", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope);
    await deps.queue.claimJobs({ limit: 20 });

    const nextPoll = new Date(Date.now() + 30_000);
    await deps.queue.awaitExternal(jobId, nextPoll);

    const row = await readJob(jobId);
    expect(row.status).toBe("waiting_external");
    // Released deliberately: a job waiting on a provider is not being worked,
    // and run_after already prevents an early pick-up.
    expect(row.lockedBy).toBeNull();
    expect(row.runAfter.getTime()).toBeCloseTo(nextPoll.getTime(), -3);
  });

  it("re-claims a parked job once its poll time arrives", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope);
    await deps.queue.claimJobs({ limit: 20 });
    await deps.queue.awaitExternal(jobId, new Date(Date.now() - 1_000));

    // This is what makes polling work without a second queue: `waiting_external`
    // is claimable, so the same loop picks the job back up.
    const claimed = await deps.queue.claimJobs({ limit: 20 });
    expect(claimed.find((job) => job.id === jobId)).toBeDefined();
    expect((await readJob(jobId)).attempts).toBe(2);
  });

  it("records every transition in job_events", async () => {
    const scope = await freshScope();
    const { jobId } = await enqueue(scope);
    await deps.queue.claimJobs({ limit: 20 });
    await deps.queue.completeJob(jobId, { ok: true });

    const events = await deps.db
      .select()
      .from(deps.schema.jobEvents)
      .where(eq(deps.schema.jobEvents.jobId, jobId));

    const completion = events.find((event) => event.toStatus === "completed");
    expect(completion).toBeDefined();
    // Read inside the transaction rather than passed in, so the trail cannot
    // claim a transition that did not happen.
    expect(completion!.fromStatus).toBe("running");
    expect(completion!.workspaceId).toBe(scope.workspaceId);
  });

  it("restricts a claim to the requested job types", async () => {
    const scope = await freshScope();
    const { jobId: imageJob } = await enqueue(scope, { type: "asset.image.generate" });
    const { jobId: publishJob } = await enqueue(scope, { type: "content.publish" });

    const claimed = await deps.queue.claimJobs({ limit: 20, types: ["asset.image.generate"] });
    const ids = claimed.map((job) => job.id);

    expect(ids).toContain(imageJob);
    expect(ids).not.toContain(publishJob);
  });
});
