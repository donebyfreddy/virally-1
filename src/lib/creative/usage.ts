import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditLedger, creditReservations, providerRuns } from "@/lib/db/schema";
import { readBalance, type CreditBalance } from "./credits";
import type { TenantScope } from "./scope";
import { assertScope } from "./scope";

/**
 * Usage reporting.
 *
 * Every figure is derived from the append-only ledger and from `provider_runs`,
 * never from a mutable counter. That is what makes the page reconcilable: a
 * number here can always be traced to the rows that produced it, and a
 * disagreement between the page and the ledger is impossible rather than merely
 * unlikely.
 *
 * Internal provider cost is deliberately NOT exposed by any function that feeds
 * a customer-facing surface. It is our margin, not their price; publishing it
 * on the usage page would tell every customer exactly what they are marked up.
 * `readCostBreakdown` exists for internal/admin reporting and is named so its
 * audience is unambiguous.
 */

export type UsagePeriod = {
  start: Date;
  end: Date;
};

/** The current calendar month, in UTC. */
export function currentPeriod(now: Date = new Date()): UsagePeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export type LedgerEntry = {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  occurredAt: Date;
};

export type GenerationSummary = {
  kind: "image" | "video" | "audio";
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
};

export type UsageSummary = {
  balance: CreditBalance;
  period: UsagePeriod;
  /** Credits consumed within the period, as a positive figure. */
  usedThisPeriod: number;
  /** Credits granted within the period (plan renewals plus top-ups). */
  grantedThisPeriod: number;
  generations: readonly GenerationSummary[];
  recentLedger: readonly LedgerEntry[];
  /** Reservations currently holding credits, for the "why is my balance low" question. */
  activeReservations: readonly {
    id: string;
    credits: number;
    purpose: string;
    createdAt: Date;
    expiresAt: Date;
  }[];
};

export async function readUsageSummary(
  scope: TenantScope,
  now: Date = new Date(),
): Promise<UsageSummary> {
  assertScope(scope);
  const period = currentPeriod(now);

  const [balance, periodTotals, generations, recentLedger, activeReservations] = await Promise.all([
    readBalance(scope),

    db
      .select({
        used: sql<number>`coalesce(-sum(${creditLedger.delta}) filter (where ${creditLedger.reason} = 'consumption'), 0)::int`,
        granted: sql<number>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.reason} in ('plan_grant', 'top_up')), 0)::int`,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.organizationId, scope.organizationId),
          gte(creditLedger.occurredAt, period.start),
        ),
      ),

    // Grouped in SQL rather than counted in JS: a workspace with 50,000 runs
    // would otherwise stream every row into memory to produce six numbers.
    db
      .select({
        kind: providerRuns.generationType,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${providerRuns.state} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${providerRuns.state} = 'failed')::int`,
        inFlight: sql<number>`count(*) filter (where ${providerRuns.state} in ('queued', 'submitted', 'generating', 'downloading'))::int`,
      })
      .from(providerRuns)
      .where(
        and(
          eq(providerRuns.workspaceId, scope.workspaceId),
          eq(providerRuns.organizationId, scope.organizationId),
          gte(providerRuns.createdAt, period.start),
        ),
      )
      .groupBy(providerRuns.generationType),

    db
      .select({
        id: creditLedger.id,
        delta: creditLedger.delta,
        reason: creditLedger.reason,
        note: creditLedger.note,
        occurredAt: creditLedger.occurredAt,
      })
      .from(creditLedger)
      .where(eq(creditLedger.organizationId, scope.organizationId))
      .orderBy(desc(creditLedger.occurredAt))
      .limit(25),

    db
      .select({
        id: creditReservations.id,
        credits: creditReservations.creditsReserved,
        purpose: creditReservations.purpose,
        createdAt: creditReservations.createdAt,
        expiresAt: creditReservations.expiresAt,
      })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.organizationId, scope.organizationId),
          eq(creditReservations.state, "held"),
        ),
      )
      .orderBy(desc(creditReservations.createdAt))
      .limit(10),
  ]);

  return {
    balance,
    period,
    usedThisPeriod: periodTotals[0]?.used ?? 0,
    grantedThisPeriod: periodTotals[0]?.granted ?? 0,
    generations: generations.map((row) => ({
      kind: row.kind as GenerationSummary["kind"],
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      inFlight: row.inFlight,
    })),
    // bigint ids stringified at the boundary: a Postgres bigint exceeds
    // Number.MAX_SAFE_INTEGER and React cannot serialise a BigInt prop.
    recentLedger: recentLedger.map((row) => ({ ...row, id: String(row.id) })),
    activeReservations,
  };
}

export type ProviderCostRow = {
  providerId: string;
  model: string;
  runs: number;
  /** Integer cents. Internal cost basis, NOT what the customer paid. */
  internalCents: number;
};

/**
 * Provider cost by model. INTERNAL / ADMIN ONLY.
 *
 * Named to make its audience unambiguous. Rendering this on a customer-facing
 * page would publish the margin between provider cost and Production Credit
 * price — see this module's header.
 */
export async function readCostBreakdown(
  scope: TenantScope,
  since: Date,
): Promise<readonly ProviderCostRow[]> {
  assertScope(scope);

  const rows = await db
    .select({
      providerId: providerRuns.providerId,
      model: providerRuns.model,
      runs: sql<number>`count(*)::int`,
      // Only actual cost, and only where it is known. Falling back to the
      // estimate would report a projection as a measurement.
      internalCents: sql<number>`coalesce(sum(${providerRuns.actualInternalCents}), 0)::int`,
    })
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
        gte(providerRuns.createdAt, since),
      ),
    )
    .groupBy(providerRuns.providerId, providerRuns.model)
    .orderBy(desc(sql`sum(${providerRuns.actualInternalCents})`));

  return rows;
}

/** Human-readable label for a ledger reason. */
export function ledgerReasonLabel(reason: string): string {
  const labels: Readonly<Record<string, string>> = {
    plan_grant: "Plan renewal",
    top_up: "Top-up",
    consumption: "Generation",
    refund: "Refund",
    adjustment: "Manual adjustment",
    expiry: "Expired",
    reservation_hold: "Reserved",
    reservation_release: "Returned",
  };
  return labels[reason] ?? reason;
}
