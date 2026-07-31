/**
 * @vitest-environment node
 *
 * Integration tests for the credit ledger, against a REAL Postgres.
 *
 * These exist because the properties that matter here are properties of the
 * database, not of the TypeScript: the advisory lock that serialises spending,
 * the CHECK constraints that bound a charge, and the unique indexes that make a
 * retry idempotent. A mocked `db` would assert that the code calls the functions
 * I wrote, which is not the same as asserting that money cannot be created.
 *
 * Skipped automatically when DATABASE_URL is absent, so `npm test` still passes
 * on a machine with no database. That skip is reported, never silent — a test
 * that quietly does nothing is worse than no test at all.
 *
 * Every test creates its own organisation and workspace and deletes them
 * afterwards, so a run leaves the database as it found it and two runs cannot
 * interfere.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local" });

const HAS_DATABASE = Boolean(process.env.DATABASE_URL?.trim());

// Imported lazily: src/lib/db constructs a Pool at module scope and throws when
// DATABASE_URL is unset, which would fail the file before it could skip.
type Deps = {
  db: typeof import("@/lib/db").db;
  pool: typeof import("@/lib/db").pool;
  schema: typeof import("@/lib/db/schema");
  credits: typeof import("./credits");
  scope: typeof import("./scope");
};

let deps: Deps;

// Created once and reused; each test isolates itself by organisation.
const created: { organizationId: string; workspaceId: string }[] = [];

beforeAll(async () => {
  if (!HAS_DATABASE) return;
  deps = {
    db: (await import("@/lib/db")).db,
    pool: (await import("@/lib/db")).pool,
    schema: await import("@/lib/db/schema"),
    credits: await import("./credits"),
    scope: await import("./scope"),
  };
});

afterEach(async () => {
  if (!HAS_DATABASE) return;
  // Organisation delete cascades to workspaces, reservations and ledger rows.
  // Organisations go first: their `created_by` FK would otherwise block the
  // user delete.
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

/** Users created for fixtures, removed after each test alongside their org. */
const createdUsers: string[] = [];

/**
 * Creates an isolated user + organisation + workspace and returns its scope.
 *
 * The user is required: `organizations.created_by` and `workspaces.created_by`
 * are both NOT NULL. Slugs must satisfy the schema's format CHECK
 * (`^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`), so the suffix is lowercase alphanumeric.
 */
async function freshScope(): Promise<{ organizationId: string; workspaceId: string }> {
  // Counter plus clock rather than Math.random, so a failing run is
  // reproducible from the test order and cannot collide within one run.
  const suffix = `${created.length}${Date.now().toString(36)}`.toLowerCase();

  const [account] = await deps.db
    .insert(deps.schema.user)
    .values({ name: `Test ${suffix}`, email: `test-${suffix}@example.invalid` })
    .returning({ id: deps.schema.user.id });
  createdUsers.push(account!.id);

  const [organization] = await deps.db
    .insert(deps.schema.organizations)
    .values({ name: `test-org-${suffix}`, slug: `test-org-${suffix}`, createdBy: account!.id })
    .returning({ id: deps.schema.organizations.id });

  const [workspace] = await deps.db
    .insert(deps.schema.workspaces)
    .values({
      organizationId: organization!.id,
      name: `test-ws-${suffix}`,
      slug: `test-ws-${suffix}`,
      createdBy: account!.id,
    })
    .returning({ id: deps.schema.workspaces.id });

  const entry = { organizationId: organization!.id, workspaceId: workspace!.id };
  created.push(entry);
  return entry;
}

async function grant(scope: { organizationId: string; workspaceId: string }, credits: number) {
  await deps.credits.grantCredits({
    scope: deps.scope.tenantScope(scope.organizationId, scope.workspaceId),
    credits,
    reason: "plan_grant",
    idempotencyKey: `grant:${scope.organizationId}`,
    note: "Test grant",
  });
}

describe.skipIf(!HAS_DATABASE)("credit ledger (integration)", () => {
  it("reports a balance equal to the sum of the ledger", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);

    expect((await deps.credits.readBalance(scope)).available).toBe(0);
    await grant(raw, 100);
    expect((await deps.credits.readBalance(scope)).available).toBe(100);
  });

  it("grants once for a repeated idempotency key", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);

    await grant(raw, 100);
    await grant(raw, 100);

    // A renewal cron that fires twice must not grant twice.
    expect((await deps.credits.readBalance(scope)).available).toBe(100);
  });

  it("deducts a reservation from the available balance immediately", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "res-1",
      credits: 30,
      purpose: "campaign_batch",
    });

    const balance = await deps.credits.readBalance(scope);
    // The hold is a ledger row, so the balance already reflects it.
    expect(balance.available).toBe(70);
    expect(balance.reserved).toBe(30);
  });

  it("refuses a reservation larger than the balance", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 10);

    await expect(
      deps.credits.reserveCredits({
        scope,
        idempotencyKey: "res-too-big",
        credits: 11,
        purpose: "campaign_batch",
      }),
    ).rejects.toBeInstanceOf(deps.credits.InsufficientCreditsError);

    // Nothing was withheld by the failed attempt.
    expect((await deps.credits.readBalance(scope)).available).toBe(10);
  });

  it("reserves once when the same key is submitted twice", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const first = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "double-click",
      credits: 25,
      purpose: "campaign_batch",
    });
    const second = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "double-click",
      credits: 25,
      purpose: "campaign_batch",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect((await deps.credits.readBalance(scope)).available).toBe(75);
  });

  /**
   * The property the advisory lock exists for.
   *
   * Ten concurrent reservations of 20 against a balance of 100 must settle at
   * exactly five successes. Without serialisation every transaction reads the
   * same starting balance, all ten pass the affordability check, and the
   * organisation goes 100 credits into the negative.
   */
  it("cannot overspend under concurrent reservations", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const attempts = Array.from({ length: 10 }, (_, index) =>
      deps.credits
        .reserveCredits({
          scope,
          idempotencyKey: `concurrent-${index}`,
          credits: 20,
          purpose: "single_generation",
        })
        .then(() => "ok" as const)
        .catch((error: unknown) =>
          error instanceof deps.credits.InsufficientCreditsError ? ("rejected" as const) : Promise.reject(error),
        ),
    );

    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok")).toHaveLength(5);
    expect(results.filter((r) => r === "rejected")).toHaveLength(5);

    const balance = await deps.credits.readBalance(scope);
    expect(balance.available).toBe(0);
    // Never negative. This is the assertion that matters.
    expect(balance.available).toBeGreaterThanOrEqual(0);
    expect(balance.reserved).toBe(100);
  });

  it("charges the actual cost and returns the remainder", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "settle-me",
      credits: 72,
      purpose: "campaign_batch",
    });

    const result = await deps.credits.settleReservation(scope, reservation.id, 61);
    expect(result.charged).toBe(61);
    expect(result.refunded).toBe(11);

    const balance = await deps.credits.readBalance(scope);
    expect(balance.available).toBe(39);
    expect(balance.reserved).toBe(0);
    expect(balance.used).toBe(61);
  });

  it("clamps a cost overrun to the amount authorised", async () => {
    // "You will never be billed above the estimate you accepted" — enforced by
    // the database, not promised by the UI.
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "overrun",
      credits: 30,
      purpose: "campaign_batch",
    });

    const result = await deps.credits.settleReservation(scope, reservation.id, 500);
    expect(result.charged).toBe(30);
    expect((await deps.credits.readBalance(scope)).available).toBe(70);
  });

  it("does not double-charge a settled reservation", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "retry-settle",
      credits: 40,
      purpose: "campaign_batch",
    });

    await deps.credits.settleReservation(scope, reservation.id, 25);
    const second = await deps.credits.settleReservation(scope, reservation.id, 25);

    expect(second.alreadySettled).toBe(true);
    // A retried worker must not charge twice.
    expect((await deps.credits.readBalance(scope)).available).toBe(75);
  });

  it("returns a released reservation in full and does not double-refund", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "release-me",
      credits: 40,
      purpose: "campaign_batch",
    });

    const first = await deps.credits.releaseReservation(scope, reservation.id, "Provider failed");
    const second = await deps.credits.releaseReservation(scope, reservation.id, "Provider failed");

    expect(first.refunded).toBe(40);
    expect(second.alreadyResolved).toBe(true);
    expect((await deps.credits.readBalance(scope)).available).toBe(100);
  });

  it("sweeps expired holds back to the balance", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "will-expire",
      credits: 50,
      purpose: "campaign_batch",
    });

    // Backdate the expiry: a worker that died mid-batch must not strand the
    // customer's credits permanently.
    await deps.db
      .update(deps.schema.creditReservations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(deps.schema.creditReservations.id, reservation.id));

    expect(await deps.credits.expireStaleReservations(scope)).toBe(1);
    expect((await deps.credits.readBalance(scope)).available).toBe(100);
    // A second sweep finds nothing and refunds nothing.
    expect(await deps.credits.expireStaleReservations(scope)).toBe(0);
    expect((await deps.credits.readBalance(scope)).available).toBe(100);
  });

  it("keeps organisations isolated", async () => {
    const a = await freshScope();
    const b = await freshScope();
    await grant(a, 100);

    // B has its own ledger and cannot see or spend A's credits.
    expect(
      (await deps.credits.readBalance(deps.scope.tenantScope(b.organizationId, b.workspaceId)))
        .available,
    ).toBe(0);

    await expect(
      deps.credits.reserveCredits({
        scope: deps.scope.tenantScope(b.organizationId, b.workspaceId),
        idempotencyKey: "cross-tenant",
        credits: 50,
        purpose: "campaign_batch",
      }),
    ).rejects.toBeInstanceOf(deps.credits.InsufficientCreditsError);
  });

  it("refuses to settle another organisation's reservation", async () => {
    const a = await freshScope();
    const b = await freshScope();
    await grant(a, 100);

    const reservation = await deps.credits.reserveCredits({
      scope: deps.scope.tenantScope(a.organizationId, a.workspaceId),
      idempotencyKey: "a-owns-this",
      credits: 40,
      purpose: "campaign_batch",
    });

    // Scoped by organisation, so B cannot reach into A's reservation even
    // holding a valid id.
    await expect(
      deps.credits.settleReservation(
        deps.scope.tenantScope(b.organizationId, b.workspaceId),
        reservation.id,
        40,
      ),
    ).rejects.toThrow(/No credit reservation/);
  });

  it("rejects a negative delta on a hold at the database level", async () => {
    // Proves the CHECK is really installed: a sign error in application code
    // must not be able to mint credits.
    const raw = await freshScope();

    await expect(
      deps.db.insert(deps.schema.creditLedger).values({
        organizationId: raw.organizationId,
        delta: 500,
        reason: "reservation_hold",
        idempotencyKey: `bad-hold-${raw.organizationId}`,
        note: "A hold must never be positive",
      }),
    ).rejects.toThrow();
  });

  it("rejects charging a reservation above what it reserved", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "check-bound",
      credits: 20,
      purpose: "campaign_batch",
    });

    await expect(
      deps.db
        .update(deps.schema.creditReservations)
        .set({ state: "settled", creditsCharged: 999, settledAt: new Date() })
        .where(eq(deps.schema.creditReservations.id, reservation.id)),
    ).rejects.toThrow();
  });

  it("never lets the ledger sum go negative across a full lifecycle", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 50);

    for (let round = 0; round < 5; round += 1) {
      const reservation = await deps.credits.reserveCredits({
        scope,
        idempotencyKey: `cycle-${round}`,
        credits: 10,
        purpose: "single_generation",
      });
      await deps.credits.settleReservation(scope, reservation.id, round % 2 === 0 ? 10 : 3);

      const balance = await deps.credits.readBalance(scope);
      expect(balance.available).toBeGreaterThanOrEqual(0);
    }

    // 3 rounds at 10 + 2 rounds at 3 = 36 consumed.
    const final = await deps.credits.readBalance(scope);
    expect(final.used).toBe(36);
    expect(final.available).toBe(14);
  });

  it("keeps the reported balance equal to a raw sum of the ledger", async () => {
    // Guards against `readBalance` ever growing a filter that silently drops a
    // reason and disagrees with the ledger it claims to summarise.
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "sum-check",
      credits: 40,
      purpose: "campaign_batch",
    });
    await deps.credits.settleReservation(scope, reservation.id, 17);

    const rows = await deps.db
      .select({ total: sql<number>`coalesce(sum(${deps.schema.creditLedger.delta}), 0)::int` })
      .from(deps.schema.creditLedger)
      .where(eq(deps.schema.creditLedger.organizationId, raw.organizationId));

    expect((await deps.credits.readBalance(scope)).available).toBe(rows[0]!.total);
  });

  it("records the reservation against its campaign for attribution", async () => {
    const raw = await freshScope();
    const scope = deps.scope.tenantScope(raw.organizationId, raw.workspaceId);
    await grant(raw, 100);

    const reservation = await deps.credits.reserveCredits({
      scope,
      idempotencyKey: "attributed",
      credits: 10,
      purpose: "regeneration",
    });

    const rows = await deps.db
      .select({
        purpose: deps.schema.creditReservations.purpose,
        workspaceId: deps.schema.creditReservations.workspaceId,
      })
      .from(deps.schema.creditReservations)
      .where(
        and(
          eq(deps.schema.creditReservations.id, reservation.id),
          eq(deps.schema.creditReservations.organizationId, raw.organizationId),
        ),
      );

    expect(rows[0]?.purpose).toBe("regeneration");
    expect(rows[0]?.workspaceId).toBe(raw.workspaceId);
  });
});

// Reported, never silent: a suite that quietly does nothing is worse than none.
describe.skipIf(HAS_DATABASE)("credit ledger (integration)", () => {
  it("is skipped because DATABASE_URL is not set", () => {
    expect(HAS_DATABASE).toBe(false);
  });
});
