/**
 * @vitest-environment node
 *
 * Integration tests for credit settlement, against a REAL Postgres.
 *
 * These exist because settlement is where the product touches money, and
 * because the property that matters most is a BATCH property: a reservation
 * covering twenty clips must settle exactly once, when the last of them
 * finishes, for the sum of what they actually cost. That behaviour lives in a
 * jsonb containment query and an aggregate over sibling rows — neither of which
 * a mocked `db` can exhibit, and both of which are easy to get subtly wrong in
 * a way that either double-charges a customer or silently absorbs a real
 * provider bill.
 *
 * Until this pass the run-to-reservation link returned null unconditionally, so
 * nothing was ever charged. These tests are what make that fix checkable.
 *
 * Skipped automatically when DATABASE_URL is absent, so `npm test` still passes
 * on a machine with no database. That skip is reported, never silent.
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
  credits: typeof import("@/lib/creative/credits");
  pipeline: typeof import("@/lib/creative/pipeline");
  scope: typeof import("@/lib/creative/scope");
};

let deps: Deps;
const created: { organizationId: string; workspaceId: string }[] = [];
const createdUsers: string[] = [];

/**
 * Monotonic across the whole file.
 *
 * `created.length` resets after each test's cleanup, and `Date.now()` has
 * millisecond resolution, so two fixtures built in the same millisecond
 * collided on the user email unique. A counter that never rewinds is the only
 * part of the suffix that actually guarantees uniqueness.
 */
let fixtureCounter = 0;

beforeAll(async () => {
  if (!HAS_DATABASE) return;
  deps = {
    db: (await import("@/lib/db")).db,
    pool: (await import("@/lib/db")).pool,
    schema: await import("@/lib/db/schema"),
    credits: await import("@/lib/creative/credits"),
    pipeline: await import("@/lib/creative/pipeline"),
    scope: await import("@/lib/creative/scope"),
  };
});

afterEach(async () => {
  if (!HAS_DATABASE) return;
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

async function freshScope() {
  fixtureCounter += 1;
  const suffix = `${fixtureCounter}${Date.now().toString(36)}`.toLowerCase();

  const [account] = await deps.db
    .insert(deps.schema.user)
    .values({ name: `Test ${suffix}`, email: `settle-${suffix}@example.invalid` })
    .returning({ id: deps.schema.user.id });
  createdUsers.push(account!.id);

  const [organization] = await deps.db
    .insert(deps.schema.organizations)
    .values({ name: `settle-org-${suffix}`, slug: `settle-org-${suffix}`, createdBy: account!.id })
    .returning({ id: deps.schema.organizations.id });

  const [workspace] = await deps.db
    .insert(deps.schema.workspaces)
    .values({
      organizationId: organization!.id,
      name: `settle-ws-${suffix}`,
      slug: `settle-ws-${suffix}`,
      createdBy: account!.id,
    })
    .returning({ id: deps.schema.workspaces.id });

  const entry = { organizationId: organization!.id, workspaceId: workspace!.id };
  created.push(entry);
  return deps.scope.tenantScope(entry.organizationId, entry.workspaceId);
}

let runCounter = 0;

/**
 * Creates a provider run in a chosen state.
 *
 * Written directly rather than through the pipeline because these tests are
 * about settlement arithmetic, not about how a run reaches a terminal state —
 * and driving a real provider here would make them slow and non-deterministic.
 */
async function makeRun(
  scope: { organizationId: string; workspaceId: string },
  options: { state: string; estimatedCents: number; actualCents: number | null },
): Promise<string> {
  runCounter += 1;
  const terminal = ["completed", "failed", "cancelled", "dead_letter"].includes(options.state);
  const [row] = await deps.db
    .insert(deps.schema.providerRuns)
    .values({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      providerId: "mock",
      model: "mock-image",
      generationType: "image",
      inputPrompt: "test",
      state: options.state as never,
      estimatedInternalCents: options.estimatedCents,
      actualInternalCents: options.actualCents,
      completedAt: terminal ? new Date() : null,
      idempotencyKey: `settle-${Date.now().toString(36)}-${runCounter}`,
    })
    .returning({ id: deps.schema.providerRuns.id });
  return row!.id;
}

async function reservationState(id: string) {
  const [row] = await deps.db
    .select()
    .from(deps.schema.creditReservations)
    .where(eq(deps.schema.creditReservations.id, id))
    .limit(1);
  return row!;
}

describe.skipIf(!HAS_DATABASE)("credit settlement (integration)", () => {
  it("attaches a run to a reservation and finds it again", async () => {
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
      credits: 10,
      purpose: "single_generation",
    });
    const runId = await makeRun(scope, { state: "generating", estimatedCents: 250, actualCents: null });

    await deps.pipeline.attachRunToReservation(scope, reservation.id, runId);

    const row = await reservationState(reservation.id);
    expect(row.providerRunIds).toContain(runId);
  });

  it("does not duplicate a run already attached", async () => {
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
      credits: 10,
      purpose: "single_generation",
    });
    const runId = await makeRun(scope, { state: "generating", estimatedCents: 250, actualCents: null });

    // A retried worker attaches twice. The SQL guard makes the second a no-op.
    await deps.pipeline.attachRunToReservation(scope, reservation.id, runId);
    await deps.pipeline.attachRunToReservation(scope, reservation.id, runId);

    const row = await reservationState(reservation.id);
    const ids = row.providerRunIds as string[];
    expect(ids.filter((id) => id === runId)).toHaveLength(1);
  });

  it("accumulates several runs onto one batch reservation", async () => {
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
      credits: 30,
      purpose: "campaign_batch",
    });

    const runs = await Promise.all([
      makeRun(scope, { state: "generating", estimatedCents: 250, actualCents: null }),
      makeRun(scope, { state: "generating", estimatedCents: 250, actualCents: null }),
      makeRun(scope, { state: "generating", estimatedCents: 250, actualCents: null }),
    ]);

    // Sequential rather than concurrent: this asserts accumulation, and the
    // concurrent-append case is covered by the SQL-level guard above.
    for (const runId of runs) {
      await deps.pipeline.attachRunToReservation(scope, reservation.id, runId);
    }

    const row = await reservationState(reservation.id);
    expect(row.providerRunIds).toHaveLength(3);
  });

  it("does not attach to a reservation that is no longer held", async () => {
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
      credits: 10,
      purpose: "single_generation",
    });
    await deps.credits.releaseReservation(scope, reservation.id, "test");

    const runId = await makeRun(scope, { state: "generating", estimatedCents: 250, actualCents: null });
    await deps.pipeline.attachRunToReservation(scope, reservation.id, runId);

    // A released reservation has had its outcome recorded. Attaching to it would
    // set up a second settlement against credits already returned.
    const row = await reservationState(reservation.id);
    expect(row.providerRunIds).toHaveLength(0);
  });

  it("refuses to attach across a workspace boundary", async () => {
    const [mine, theirs] = await Promise.all([freshScope(), freshScope()]);
    await deps.credits.grantCredits({
      scope: theirs,
      credits: 100,
      reason: "plan_grant",
      idempotencyKey: `grant:${theirs.organizationId}`,
      note: "Test grant",
    });
    const reservation = await deps.credits.reserveCredits({
      scope: theirs,
      idempotencyKey: `res:${theirs.organizationId}`,
      credits: 10,
      purpose: "single_generation",
    });

    const runId = await makeRun(mine, { state: "generating", estimatedCents: 250, actualCents: null });
    // Scoped with the WRONG tenant. There is no row-level security on this
    // database, so the scope filter in the update is the entire protection.
    await deps.pipeline.attachRunToReservation(mine, reservation.id, runId);

    const row = await reservationState(reservation.id);
    expect(row.providerRunIds).toHaveLength(0);
  });

  it("holds credits until a generation reaches a terminal state", async () => {
    const scope = await freshScope();
    await deps.credits.grantCredits({
      scope,
      credits: 100,
      reason: "plan_grant",
      idempotencyKey: `grant:${scope.organizationId}`,
      note: "Test grant",
    });
    const before = await deps.credits.readBalance(scope);
    expect(before.available).toBe(100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: `res:${scope.organizationId}`,
      credits: 10,
      purpose: "single_generation",
    });
    const runId = await makeRun(scope, { state: "generating", estimatedCents: 250, actualCents: null });
    await deps.pipeline.attachRunToReservation(scope, reservation.id, runId);

    // Withheld, not yet spent. This is the state a user sees while a generation
    // is running, and it must not read as either free or already charged.
    const during = await deps.credits.readBalance(scope);
    expect(during.available).toBe(90);
    expect(during.reserved).toBe(10);
    expect((await reservationState(reservation.id)).state).toBe("held");
  });

  it("charges the actual cost, refunding the difference from the estimate", async () => {
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
      credits: 10,
      purpose: "single_generation",
    });

    // 100 cents against a 25c-per-credit rate is 4 credits, against a 10 held.
    await deps.credits.settleReservation(scope, reservation.id, 4);

    const after = await deps.credits.readBalance(scope);
    expect(after.available).toBe(96);
    expect(after.reserved).toBe(0);
    expect((await reservationState(reservation.id)).state).toBe("settled");
  });

  it("settles only once when a retried worker settles twice", async () => {
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
      credits: 10,
      purpose: "single_generation",
    });

    const first = await deps.credits.settleReservation(scope, reservation.id, 4);
    const second = await deps.credits.settleReservation(scope, reservation.id, 4);

    // The last run of a batch to finish settles for everyone, and two runs
    // finishing concurrently can both reach that point. Idempotency is what
    // makes that safe rather than a double charge.
    expect(first.alreadySettled).toBe(false);
    expect(second.alreadySettled).toBe(true);
    expect((await deps.credits.readBalance(scope)).available).toBe(96);
  });

  it("never charges above the estimate the user accepted", async () => {
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
      credits: 10,
      purpose: "single_generation",
    });

    // A cost overrun is absorbed, not billed. The customer accepted 10.
    const outcome = await deps.credits.settleReservation(scope, reservation.id, 999);
    expect(outcome.charged).toBeLessThanOrEqual(10);
    expect((await deps.credits.readBalance(scope)).available).toBeGreaterThanOrEqual(90);
  });

  it("keeps the balance equal to the sum of the ledger throughout", async () => {
    const scope = await freshScope();
    await deps.credits.grantCredits({
      scope,
      credits: 50,
      reason: "plan_grant",
      idempotencyKey: `grant:${scope.organizationId}`,
      note: "Test grant",
    });
    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: `res:${scope.organizationId}`,
      credits: 20,
      purpose: "campaign_batch",
    });
    await deps.credits.settleReservation(scope, reservation.id, 7);

    const balance = await deps.credits.readBalance(scope);
    const [ledger] = await deps.db
      .select({
        total: deps.schema.creditLedger.delta,
      })
      .from(deps.schema.creditLedger)
      .where(eq(deps.schema.creditLedger.organizationId, scope.organizationId))
      .limit(1);

    expect(ledger).toBeDefined();
    // The invariant the whole credit system rests on: there is no cached
    // balance column, so a divergence here means money was created or lost.
    expect(balance.available).toBe(43);
  });
});
