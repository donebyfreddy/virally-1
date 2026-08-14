/**
 * @vitest-environment node
 *
 * Integration tests for the "nobody ever claimed this job" watchdog, against a
 * REAL Postgres.
 *
 * This is the failure mode `queue.integration.test.ts`'s lease-reclaim tests do
 * not cover: a job that no worker has EVER picked up, because nothing is
 * consuming the queue at all — the exact state root-caused in production (see
 * the PR this file shipped with). A mocked `db` would only assert that the
 * right update statements were issued; what actually matters is the composite
 * outcome across three tables — the job, the content item, and the credit
 * reservation — all moving together in one pass.
 *
 * Skipped automatically when DATABASE_URL is absent.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local" });

const HAS_DATABASE = Boolean(process.env.DATABASE_URL?.trim());

type Deps = {
  db: typeof import("@/lib/db").db;
  pool: typeof import("@/lib/db").pool;
  schema: typeof import("@/lib/db/schema");
  queue: typeof import("./queue");
  watchdog: typeof import("./watchdog");
  credits: typeof import("@/lib/creative/credits");
  scope: typeof import("@/lib/creative/scope");
};

let deps: Deps;
const created: { organizationId: string; workspaceId: string }[] = [];
const createdUsers: string[] = [];
let fixtureCounter = 0;

beforeAll(async () => {
  if (!HAS_DATABASE) return;
  deps = {
    db: (await import("@/lib/db")).db,
    pool: (await import("@/lib/db")).pool,
    schema: await import("@/lib/db/schema"),
    queue: await import("./queue"),
    watchdog: await import("./watchdog"),
    credits: await import("@/lib/creative/credits"),
    scope: await import("@/lib/creative/scope"),
  };
});

afterEach(async () => {
  if (!HAS_DATABASE) return;
  for (const entry of created.splice(0)) {
    await deps.db.delete(deps.schema.organizations).where(eq(deps.schema.organizations.id, entry.organizationId));
  }
  for (const userId of createdUsers.splice(0)) {
    await deps.db.delete(deps.schema.user).where(eq(deps.schema.user.id, userId));
  }
});

afterAll(async () => {
  if (!HAS_DATABASE) return;
  await deps.pool.end();
});

async function freshScope() {
  fixtureCounter += 1;
  const suffix = `${fixtureCounter}${Date.now().toString(36)}`.toLowerCase();

  const [account] = await deps.db
    .insert(deps.schema.user)
    .values({ name: `Test ${suffix}`, email: `watchdog-${suffix}@example.invalid` })
    .returning({ id: deps.schema.user.id });
  createdUsers.push(account!.id);

  const [organization] = await deps.db
    .insert(deps.schema.organizations)
    .values({ name: `watchdog-org-${suffix}`, slug: `watchdog-org-${suffix}`, createdBy: account!.id })
    .returning({ id: deps.schema.organizations.id });

  const [workspace] = await deps.db
    .insert(deps.schema.workspaces)
    .values({
      organizationId: organization!.id,
      name: `watchdog-ws-${suffix}`,
      slug: `watchdog-ws-${suffix}`,
      createdBy: account!.id,
    })
    .returning({ id: deps.schema.workspaces.id });

  const entry = { organizationId: organization!.id, workspaceId: workspace!.id };
  created.push(entry);
  return deps.scope.tenantScope(entry.organizationId, entry.workspaceId);
}

async function makeContentItem(scopeValue: { organizationId: string; workspaceId: string }) {
  const [row] = await deps.db
    .insert(deps.schema.contentItems)
    .values({
      organizationId: scopeValue.organizationId,
      workspaceId: scopeValue.workspaceId,
      generationStatus: "queued",
      generationStartedAt: new Date(),
    })
    .returning({ id: deps.schema.contentItems.id });
  return row!.id;
}

let keyCounter = 0;

/** Enqueues a job and backdates `created_at` past the claim timeout — the only way to simulate "sat unclaimed for a while" without actually waiting. */
async function makeStaleJob(
  scopeValue: { organizationId: string; workspaceId: string },
  payload: Record<string, unknown>,
  ageMs = 10 * 60 * 1000,
) {
  keyCounter += 1;
  const { jobId } = await deps.queue.enqueueJob({
    organizationId: scopeValue.organizationId,
    workspaceId: scopeValue.workspaceId,
    type: "asset.image.generate",
    payload,
    idempotencyKey: `watchdog-test-${Date.now().toString(36)}-${keyCounter}`,
  });
  await deps.db
    .update(deps.schema.jobs)
    .set({ createdAt: new Date(Date.now() - ageMs) })
    .where(eq(deps.schema.jobs.id, jobId));
  return jobId;
}

async function readJob(jobId: string) {
  const [row] = await deps.db.select().from(deps.schema.jobs).where(eq(deps.schema.jobs.id, jobId)).limit(1);
  return row!;
}

async function readContentItem(contentItemId: string) {
  const [row] = await deps.db
    .select()
    .from(deps.schema.contentItems)
    .where(eq(deps.schema.contentItems.id, contentItemId))
    .limit(1);
  return row!;
}

describe.skipIf(!HAS_DATABASE)("failStaleQueuedJobs (integration)", () => {
  it("fails a job that has sat unclaimed past the timeout", async () => {
    const scope = await freshScope();
    const jobId = await makeStaleJob(scope, { kind: "image" });

    const failed = await deps.watchdog.failStaleQueuedJobs({ timeoutMs: 60_000 });
    expect(failed).toBeGreaterThanOrEqual(1);

    const row = await readJob(jobId);
    expect(row.status).toBe("failed");
    expect(row.failureCode).toBe("WORKER_UNAVAILABLE");
  });

  it("leaves a recently queued job alone", async () => {
    const scope = await freshScope();
    const jobId = await makeStaleJob(scope, { kind: "image" }, 1_000);

    await deps.watchdog.failStaleQueuedJobs({ timeoutMs: 60_000 });

    // A job queued one second ago is not "nobody is consuming the queue" —
    // it is "the worker has not gotten to it yet", which is normal.
    expect((await readJob(jobId)).status).toBe("queued");
  });

  it("leaves a claimed job alone — that is reclaimExpiredLeases's job, not this one", async () => {
    const scope = await freshScope();
    const jobId = await makeStaleJob(scope, { kind: "image" });
    await deps.queue.claimJobs({ limit: 20 });

    await deps.watchdog.failStaleQueuedJobs({ timeoutMs: 60_000 });

    // Claimed means locked_by is set, which this watchdog explicitly excludes.
    expect((await readJob(jobId)).status).toBe("running");
  });

  it("fails the linked content item and releases its credit reservation", async () => {
    const scope = await freshScope();
    await deps.credits.grantCredits({
      scope,
      credits: 100,
      reason: "plan_grant",
      idempotencyKey: `grant:${scope.organizationId}`,
      note: "Test grant",
    });
    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: `res:${scope.organizationId}`,
      credits: 5,
      purpose: "single_generation",
    });
    const contentItemId = await makeContentItem(scope);
    await makeStaleJob(scope, { kind: "image", contentItemId, reservationId: reservation.id, capability: "text-to-image" });

    const before = await deps.credits.readBalance(scope);
    expect(before.available).toBe(95);
    expect(before.reserved).toBe(5);

    await deps.watchdog.failStaleQueuedJobs({ timeoutMs: 60_000 });

    const item = await readContentItem(contentItemId);
    expect(item.generationStatus).toBe("failed");
    expect(item.generationErrorCode).toBe("WORKER_UNAVAILABLE");
    expect(item.generationErrorStage).toBe("text-to-image");

    // The point of this whole test: a permanently queued job must not
    // permanently lock the credits it reserved.
    const after = await deps.credits.readBalance(scope);
    expect(after.available).toBe(100);
    expect(after.reserved).toBe(0);
  });

  it("does not resurrect a content item that already finished through another path", async () => {
    const scope = await freshScope();
    const contentItemId = await makeContentItem(scope);
    await deps.db
      .update(deps.schema.contentItems)
      .set({ generationStatus: "ready" })
      .where(eq(deps.schema.contentItems.id, contentItemId));
    // A stray stale job referencing an item that is already done — e.g. a
    // regenerate-one-shot job nobody claimed after the rest of the content
    // finished and shipped through a different path.
    await makeStaleJob(scope, { kind: "image", contentItemId });

    await deps.watchdog.failStaleQueuedJobs({ timeoutMs: 60_000 });

    // The job itself still fails — it is still true that nobody claimed it —
    // but a content item already `ready` must never be downgraded to failed.
    expect((await readContentItem(contentItemId)).generationStatus).toBe("ready");
  });

  it("is idempotent: running it twice does not release a reservation twice", async () => {
    const scope = await freshScope();
    await deps.credits.grantCredits({
      scope,
      credits: 100,
      reason: "plan_grant",
      idempotencyKey: `grant:${scope.organizationId}`,
      note: "Test grant",
    });
    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: `res:${scope.organizationId}`,
      credits: 5,
      purpose: "single_generation",
    });
    const contentItemId = await makeContentItem(scope);
    const jobId = await makeStaleJob(scope, { kind: "image", contentItemId, reservationId: reservation.id });

    await deps.watchdog.failStaleQueuedJobs({ timeoutMs: 60_000 });
    // The job is already `failed` and therefore no longer matches this
    // watchdog's own `pending`/`queued` + unclaimed selection criteria, so a
    // second pass must not find it again.
    await deps.watchdog.failStaleQueuedJobs({ timeoutMs: 60_000 });

    expect((await readJob(jobId)).status).toBe("failed");
    expect((await deps.credits.readBalance(scope)).available).toBe(100);
  });
});
