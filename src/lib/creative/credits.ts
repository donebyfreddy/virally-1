import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditLedger, creditReservations } from "@/lib/db/schema";
import type { TenantScope } from "./scope";
import { assertScope } from "./scope";

/**
 * Production Credits: balance, reservation, settlement.
 *
 * The balance is ALWAYS `sum(credit_ledger.delta)`. There is no cached balance
 * column anywhere, because a cache over an append-only log has to be kept in
 * step under concurrency, and the first time it drifts, the ledger and the
 * number the customer sees disagree with no way to tell which is right.
 *
 * A reservation is two ledger entries, not a side table consulted at read time:
 *
 *   reserve  -> one negative `reservation_hold`      (balance drops immediately)
 *   settle   -> one positive `reservation_release`   (unused portion returns)
 *
 * `credit_reservations` records WHY and WHEN for the audit trail and the
 * expiry sweeper, but never participates in the arithmetic. If the balance were
 * `ledger_sum - sum(active_reservations)`, a crash between the two writes would
 * produce a balance wrong in the customer's favour, self-correcting only by
 * luck. This way the hold either exists in the ledger or it does not.
 *
 * CONCURRENCY. Two simultaneous reservations must not both pass an affordability
 * check against the same balance. There is no single row to lock — the ledger is
 * append-only — so each transaction takes a Postgres advisory lock keyed on the
 * organisation. Serialising per organisation is enough: one tenant's spending
 * cannot affect another's, so a global lock would be a needless bottleneck.
 */

/** How long an unsettled hold survives before the sweeper can release it. */
export const RESERVATION_TTL_MINUTES = 120;

export type CreditBalance = {
  /** Spendable now. Holds are already subtracted, because they are ledger rows. */
  available: number;
  /** Currently withheld for work in flight. Reporting only — already deducted. */
  reserved: number;
  /**
   * Sum of every positive grant this period. Shown as "included credits" so the
   * usage page can display used-of-included rather than a bare balance.
   */
  granted: number;
  used: number;
};

export class InsufficientCreditsError extends Error {
  readonly available: number;
  readonly required: number;
  constructor(available: number, required: number) {
    super(
      `This needs ${required} Production Credits and ${available} are available. Reduce the batch, choose a cheaper production mode, or top up.`,
    );
    this.name = "InsufficientCreditsError";
    this.available = available;
    this.required = required;
  }
}

/**
 * Serialises credit mutations for one organisation.
 *
 * `pg_advisory_xact_lock` is released automatically when the transaction ends,
 * including on rollback — an explicit unlock would leak the lock on any error
 * path that forgot it. `hashtextextended` gives the bigint the function needs
 * from a uuid.
 */
async function lockOrganisation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`);
}

export async function readBalance(scope: TenantScope): Promise<CreditBalance> {
  assertScope(scope);

  const rows = await db
    .select({
      available: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int`,
      granted: sql<number>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.delta} > 0 and ${creditLedger.reason} in ('plan_grant', 'top_up')), 0)::int`,
      // Consumption is negative in the ledger, so it is negated to read as a
      // positive "used" figure.
      used: sql<number>`coalesce(-sum(${creditLedger.delta}) filter (where ${creditLedger.reason} = 'consumption'), 0)::int`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.organizationId, scope.organizationId));

  const reservedRows = await db
    .select({ reserved: sql<number>`coalesce(sum(${creditReservations.creditsReserved}), 0)::int` })
    .from(creditReservations)
    .where(
      and(
        eq(creditReservations.organizationId, scope.organizationId),
        eq(creditReservations.state, "held"),
      ),
    );

  const totals = rows[0] ?? { available: 0, granted: 0, used: 0 };
  return {
    available: totals.available,
    reserved: reservedRows[0]?.reserved ?? 0,
    granted: totals.granted,
    used: totals.used,
  };
}

export type ReserveInput = {
  scope: TenantScope;
  idempotencyKey: string;
  credits: number;
  purpose: "campaign_batch" | "single_generation" | "regeneration";
  campaignId?: string | null;
  createdBy?: string | null;
  providerRunIds?: readonly string[];
  expectedRunCount?: number;
};

export type Reservation = {
  id: string;
  creditsReserved: number;
  state: "held" | "settled" | "released" | "expired";
  /** False when this call found an existing reservation for the same key. */
  created: boolean;
};

/**
 * Withholds credits before work starts.
 *
 * Idempotent on `(organizationId, idempotencyKey)`: a repeated submit returns
 * the existing reservation and writes no second hold. That check happens INSIDE
 * the lock, so two concurrent identical submits cannot both conclude they are
 * first.
 *
 * Throws `InsufficientCreditsError` rather than reserving a partial amount.
 * Partial reservation would start a batch that cannot finish, spending real
 * provider money on output the user never receives complete.
 */
export async function reserveCredits(input: ReserveInput): Promise<Reservation> {
  assertScope(input.scope);
  const credits = Math.trunc(input.credits);
  if (credits <= 0) {
    throw new Error(`A reservation must be for at least one credit, got ${credits}.`);
  }

  return db.transaction(async (tx) => {
    await lockOrganisation(tx, input.scope.organizationId);

    // Inside the lock: a concurrent duplicate is already blocked, so this read
    // is authoritative rather than advisory.
    const existing = await tx
      .select({
        id: creditReservations.id,
        creditsReserved: creditReservations.creditsReserved,
        state: creditReservations.state,
      })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.organizationId, input.scope.organizationId),
          eq(creditReservations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    const found = existing[0];
    if (found) return { ...found, created: false };

    const balanceRows = await tx
      .select({ available: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
      .from(creditLedger)
      .where(eq(creditLedger.organizationId, input.scope.organizationId));

    const available = balanceRows[0]?.available ?? 0;
    if (available < credits) throw new InsufficientCreditsError(available, credits);

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60_000);

    const inserted = await tx
      .insert(creditReservations)
      .values({
        organizationId: input.scope.organizationId,
        workspaceId: input.scope.workspaceId,
        createdBy: input.createdBy ?? null,
        campaignId: input.campaignId ?? null,
        purpose: input.purpose,
        creditsReserved: credits,
        state: "held",
        providerRunIds: [...(input.providerRunIds ?? [])],
        expectedRunCount: Math.max(1, Math.trunc(input.expectedRunCount ?? 1)),
        expiresAt,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: creditReservations.id });

    const reservationId = inserted[0]?.id;
    if (!reservationId) throw new Error("Failed to create the credit reservation.");

    // The hold itself. Negative, and the ledger's CHECK enforces that sign — a
    // sign error here would mint credits rather than withhold them.
    await tx.insert(creditLedger).values({
      organizationId: input.scope.organizationId,
      delta: -credits,
      reason: "reservation_hold",
      note: `Reserved for ${input.purpose}`,
      idempotencyKey: `hold:${reservationId}`,
    });

    return { id: reservationId, creditsReserved: credits, state: "held" as const, created: true };
  });
}

/** Finalises the number of jobs accepted under a batch hold before workers settle it. */
export async function setReservationExpectedRuns(
  scope: TenantScope,
  reservationId: string,
  expectedRunCount: number,
): Promise<void> {
  assertScope(scope);
  const count = Math.max(1, Math.trunc(expectedRunCount));
  await db
    .update(creditReservations)
    .set({ expectedRunCount: count, updatedAt: new Date() })
    .where(
      and(
        eq(creditReservations.id, reservationId),
        eq(creditReservations.organizationId, scope.organizationId),
        eq(creditReservations.workspaceId, scope.workspaceId),
        eq(creditReservations.state, "held"),
      ),
    );
}

/**
 * Settles a reservation against what was actually used.
 *
 * Writes the consumption and returns the remainder. Clamps the charge to what
 * was reserved: the database CHECK forbids charging more, and clamping here
 * turns a cost overrun into an absorbed loss rather than a failed transaction
 * that leaves the hold stranded. The customer is never billed above the
 * estimate they accepted.
 *
 * Idempotent: settling an already-settled reservation is a no-op, so a retried
 * worker cannot double-charge or double-refund.
 */
export async function settleReservation(
  scope: TenantScope,
  reservationId: string,
  creditsUsed: number,
): Promise<{ charged: number; refunded: number; alreadySettled: boolean }> {
  assertScope(scope);

  return db.transaction(async (tx) => {
    await lockOrganisation(tx, scope.organizationId);

    const rows = await tx
      .select({
        id: creditReservations.id,
        creditsReserved: creditReservations.creditsReserved,
        creditsCharged: creditReservations.creditsCharged,
        state: creditReservations.state,
      })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.id, reservationId),
          eq(creditReservations.organizationId, scope.organizationId),
        ),
      )
      .limit(1);

    const reservation = rows[0];
    if (!reservation) {
      throw new Error(`No credit reservation ${reservationId} in this organisation.`);
    }
    if (reservation.state !== "held") {
      return {
        charged: reservation.creditsCharged ?? 0,
        refunded: reservation.creditsReserved - (reservation.creditsCharged ?? 0),
        alreadySettled: true,
      };
    }

    const charged = Math.min(
      reservation.creditsReserved,
      Math.max(0, Math.trunc(creditsUsed)),
    );
    const refunded = reservation.creditsReserved - charged;

    await tx
      .update(creditReservations)
      .set({
        state: "settled",
        creditsCharged: charged,
        settledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditReservations.id, reservationId));

    // Consumption is recorded even when zero credits were used, so the usage
    // page can show that the work ran and cost nothing — distinct from work
    // that never ran at all.
    if (charged > 0) {
      await tx.insert(creditLedger).values({
        organizationId: scope.organizationId,
        delta: -charged,
        reason: "consumption",
        note: `Generation charge for reservation ${reservationId}`,
        idempotencyKey: `charge:${reservationId}`,
      });
    }

    // Return the hold in full, then re-deduct the actual charge above. Two
    // entries rather than one net entry so the ledger reads as what happened:
    // "we held 72, you used 61, 11 came back."
    await tx.insert(creditLedger).values({
      organizationId: scope.organizationId,
      delta: reservation.creditsReserved,
      reason: "reservation_release",
      note: `Released hold for reservation ${reservationId}`,
      idempotencyKey: `release:${reservationId}`,
    });

    return { charged, refunded, alreadySettled: false };
  });
}

/**
 * Returns a reservation in full without charging.
 *
 * For work that never ran, or that failed without the provider billing us.
 * Distinct from settling at zero: `released` says the work did not happen,
 * `settled` with `credits_charged = 0` says it happened for free.
 */
export async function releaseReservation(
  scope: TenantScope,
  reservationId: string,
  reason: string,
): Promise<{ refunded: number; alreadyResolved: boolean }> {
  assertScope(scope);

  return db.transaction(async (tx) => {
    await lockOrganisation(tx, scope.organizationId);

    const rows = await tx
      .select({
        creditsReserved: creditReservations.creditsReserved,
        state: creditReservations.state,
      })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.id, reservationId),
          eq(creditReservations.organizationId, scope.organizationId),
        ),
      )
      .limit(1);

    const reservation = rows[0];
    if (!reservation) {
      throw new Error(`No credit reservation ${reservationId} in this organisation.`);
    }
    if (reservation.state !== "held") return { refunded: 0, alreadyResolved: true };

    await tx
      .update(creditReservations)
      .set({ state: "released", settledAt: new Date(), updatedAt: new Date() })
      .where(eq(creditReservations.id, reservationId));

    await tx.insert(creditLedger).values({
      organizationId: scope.organizationId,
      delta: reservation.creditsReserved,
      reason: "reservation_release",
      note: reason,
      idempotencyKey: `release:${reservationId}`,
    });

    return { refunded: reservation.creditsReserved, alreadyResolved: false };
  });
}

/**
 * Grants credits. Used for plan renewals and completed top-ups.
 *
 * `idempotencyKey` is unique across the whole ledger, so a renewal cron that
 * fires twice for the same period grants once. That constraint is the entire
 * protection against duplicate grants — there is no second check.
 */
export async function grantCredits(input: {
  scope: TenantScope;
  credits: number;
  reason: "plan_grant" | "top_up" | "adjustment";
  idempotencyKey: string;
  note: string;
}): Promise<{ granted: boolean }> {
  assertScope(input.scope);
  const credits = Math.trunc(input.credits);
  if (credits <= 0) throw new Error(`A grant must be positive, got ${credits}.`);

  const inserted = await db
    .insert(creditLedger)
    .values({
      organizationId: input.scope.organizationId,
      delta: credits,
      reason: input.reason,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: creditLedger.idempotencyKey })
    .returning({ id: creditLedger.id });

  return { granted: inserted.length > 0 };
}

/**
 * Sweeps holds whose work never finished.
 *
 * Without this, a worker that dies mid-batch strands the customer's credits
 * permanently. Expired holds are released in full: we cannot know what was
 * used, and guessing against the customer is the wrong default.
 */
export async function expireStaleReservations(scope: TenantScope): Promise<number> {
  assertScope(scope);

  return db.transaction(async (tx) => {
    await lockOrganisation(tx, scope.organizationId);

    const stale = await tx
      .select({
        id: creditReservations.id,
        creditsReserved: creditReservations.creditsReserved,
      })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.organizationId, scope.organizationId),
          eq(creditReservations.state, "held"),
          sql`${creditReservations.expiresAt} < now()`,
        ),
      );

    for (const reservation of stale) {
      await tx
        .update(creditReservations)
        .set({ state: "expired", settledAt: new Date(), updatedAt: new Date() })
        .where(eq(creditReservations.id, reservation.id));

      await tx.insert(creditLedger).values({
        organizationId: scope.organizationId,
        delta: reservation.creditsReserved,
        reason: "reservation_release",
        note: `Reservation ${reservation.id} expired before the work completed.`,
        idempotencyKey: `release:${reservation.id}`,
      });
    }

    return stale.length;
  });
}
