import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerRateLimits, providerRuns } from "@/lib/db/schema";
import type { GenerationCapability } from "@/lib/creative/capabilities";
import type { TenantScope } from "@/lib/creative/scope";
import { assertScope } from "@/lib/creative/scope";

/**
 * Concurrency and rate limiting for generation.
 *
 * Two distinct protections, and conflating them is the usual mistake:
 *
 * **Provider concurrency** protects Virally's vendor account. Every workspace
 * shares one API key, so one tenant submitting forty video jobs will rate-limit
 * every other tenant on the platform. The per-provider ceiling is what stops
 * that; the per-workspace ceiling is what stops it being one tenant's fault.
 *
 * **Workspace rate limiting** protects the workspace from itself and from
 * abuse. A held credit reservation already caps total spend, but a script
 * hammering the submit action can burn a month's credits in a minute, and "they
 * had the credits" is not a satisfying answer to the support ticket that
 * follows.
 *
 * Both read `provider_rate_limits`, which is seeded per capability rather than
 * per provider — vendors meter video far more tightly than images, and a single
 * figure is either too low for images or too high for video.
 *
 * Enforcement is admission control at submit time, not a token bucket in
 * memory. A bucket in a serverless process is per-instance and therefore
 * fiction; counting rows that actually exist is the only thing true across
 * every instance.
 */

/** In-flight states. A run in one of these occupies a concurrency slot. */
const IN_FLIGHT = ["queued", "submitted", "waiting_external", "generating", "downloading", "validating"] as const;

export type LimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Shown to the user. Says what to do, not merely what failed. */
      reason: string;
      /** When the caller could reasonably try again. Null when unknown. */
      retryAfterMs: number | null;
    };

export type ConcurrencyLimits = {
  providerId: string;
  capability: GenerationCapability | null;
  requestsPerMinute: number;
  maxConcurrent: number;
  maxConcurrentPerWorkspace: number;
};

/**
 * Reads the limits for a provider and capability.
 *
 * Prefers the capability-specific row and falls back to the provider-wide one.
 * When neither exists — a provider seeded before this table, or one added by
 * hand — returns a conservative default rather than treating "unconfigured" as
 * "unlimited". An absent limit must never be the most permissive state.
 */
export async function readLimits(
  providerId: string,
  capability: GenerationCapability,
): Promise<ConcurrencyLimits> {
  const rows = await db
    .select()
    .from(providerRateLimits)
    .where(
      and(
        eq(providerRateLimits.providerId, providerId),
        or(
          eq(providerRateLimits.capability, capability),
          isNull(providerRateLimits.capability),
        ),
      ),
    );

  // Capability-specific wins. Sorting rather than two queries because the row
  // count here is two at most.
  const specific = rows.find((row) => row.capability === capability);
  const wide = rows.find((row) => row.capability === null);
  const chosen = specific ?? wide;

  if (!chosen) {
    return {
      providerId,
      capability,
      requestsPerMinute: 10,
      maxConcurrent: 2,
      maxConcurrentPerWorkspace: 1,
    };
  }

  return {
    providerId,
    capability: chosen.capability as GenerationCapability | null,
    requestsPerMinute: chosen.requestsPerMinute,
    maxConcurrent: chosen.maxConcurrent,
    maxConcurrentPerWorkspace: chosen.maxConcurrentPerWorkspace,
  };
}

/**
 * Whether a workspace may submit another generation to this provider right now.
 *
 * Checks the workspace's own in-flight count before the platform-wide one, so a
 * tenant who is over their share is told that — rather than being told the
 * platform is busy, which is both less actionable and, from their point of
 * view, untrue.
 *
 * The mock provider is exempt. It makes no external call, costs nothing and
 * rate-limiting it would make the credential-free development path artificially
 * slow for no protective benefit.
 */
export async function checkConcurrency(
  scope: TenantScope,
  providerId: string,
  capability: GenerationCapability,
): Promise<LimitDecision> {
  assertScope(scope);
  if (providerId === "mock") return { allowed: true };

  const limits = await readLimits(providerId, capability);

  const [workspaceRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
        eq(providerRuns.providerId, providerId),
        inFlight(),
      ),
    );

  const workspaceInFlight = workspaceRow?.count ?? 0;
  if (workspaceInFlight >= limits.maxConcurrentPerWorkspace) {
    return {
      allowed: false,
      reason: `This workspace already has ${workspaceInFlight} generation${workspaceInFlight === 1 ? "" : "s"} running on ${providerId}. The next one starts when one of those finishes.`,
      // Deliberately null. The wait is however long a generation takes, which
      // is unknown, and inventing a number would produce a retry that fails.
      retryAfterMs: null,
    };
  }

  const [platformRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerRuns)
    .where(and(eq(providerRuns.providerId, providerId), inFlight()));

  const platformInFlight = platformRow?.count ?? 0;
  if (platformInFlight >= limits.maxConcurrent) {
    return {
      allowed: false,
      reason: `${providerId} is at capacity across Virally. The generation will start shortly — it has been queued, not lost.`,
      retryAfterMs: 15_000,
    };
  }

  return { allowed: true };
}

/**
 * Whether a workspace is within its submission rate.
 *
 * Counted from `provider_runs.created_at` over a sliding minute rather than
 * from a counter, because the rows are the only shared state a serverless
 * deployment has. Slightly more expensive than a bucket, and correct across
 * every instance instead of per-instance and wrong.
 */
export async function checkSubmissionRate(
  scope: TenantScope,
  providerId: string,
  capability: GenerationCapability,
  options: { now?: Date } = {},
): Promise<LimitDecision> {
  assertScope(scope);
  if (providerId === "mock") return { allowed: true };

  const now = options.now ?? new Date();
  const windowStart = new Date(now.getTime() - 60_000);
  const limits = await readLimits(providerId, capability);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
        eq(providerRuns.providerId, providerId),
        gte(providerRuns.createdAt, windowStart),
      ),
    );

  const submitted = row?.count ?? 0;
  if (submitted >= limits.requestsPerMinute) {
    return {
      allowed: false,
      reason: `This workspace has submitted ${submitted} generations to ${providerId} in the last minute, which is its limit. Try again shortly.`,
      retryAfterMs: 60_000,
    };
  }

  return { allowed: true };
}

/**
 * Both checks, in the order a caller should apply them.
 *
 * Rate first, then concurrency: a workspace hammering the endpoint should be
 * told it is going too fast, not that it has too many running — the former is
 * the actual problem and the latter is a symptom of it.
 */
export async function checkGenerationLimits(
  scope: TenantScope,
  providerId: string,
  capability: GenerationCapability,
): Promise<LimitDecision> {
  const rate = await checkSubmissionRate(scope, providerId, capability);
  if (!rate.allowed) return rate;
  return checkConcurrency(scope, providerId, capability);
}

function inFlight() {
  return sql`${providerRuns.state} in ${sql.raw(`(${IN_FLIGHT.map((s) => `'${s}'`).join(", ")})`)}`;
}
