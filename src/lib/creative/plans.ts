/**
 * Plan, entitlement and top-up defaults.
 *
 * These are PROVISIONAL business defaults, seeded into `subscription_plans`,
 * `plan_entitlements` and `top_up_packages`. Once seeded, the tables are the
 * source of truth and are editable without a deploy — nothing that prices a
 * real subscription should read this module.
 *
 * Prices are integer cents in EUR. Nothing here converts currency; a deployment
 * billing in another currency reseeds rather than multiplying at read time,
 * because a rate applied at read time makes historic invoices unreproducible.
 */

export type PlanEntitlementKey =
  | "connected_accounts"
  | "brands"
  | "users"
  | "max_export_height"
  | "batch_generation"
  | "hook_variations"
  | "all_aspect_ratios"
  | "advanced_analytics"
  | "experiments"
  | "client_workspaces"
  | "approval_workflows"
  | "priority_rendering"
  | "sso";

export type PlanEntitlementDefault = {
  key: PlanEntitlementKey;
  /** Null means unlimited. Never coalesce to 0 — that inverts the meaning. */
  limitValue: number | null;
  enabled: boolean;
};

export type PlanDefinition = {
  code: string;
  label: string;
  description: string;
  position: number;
  /** Null only for contact-sales plans. */
  priceCents: number | null;
  includedCredits: number;
  emphasised: boolean;
  requiresContact: boolean;
  entitlements: readonly PlanEntitlementDefault[];
  /**
   * What the included credits buy, computed from production-mode prices rather
   * than written by hand. See `planCapacity` — a hand-written "60 Fast Reels"
   * goes stale the moment a mode's credit price changes.
   */
  highlights: readonly string[];
};

export const PLAN_DEFAULTS: readonly PlanDefinition[] = [
  {
    code: "creator",
    label: "Creator",
    description: "One brand, one operator, enough volume to post daily.",
    position: 0,
    priceCents: 3900,
    includedCredits: 60,
    emphasised: false,
    requiresContact: false,
    entitlements: [
      { key: "connected_accounts", limitValue: 3, enabled: true },
      { key: "brands", limitValue: 1, enabled: true },
      { key: "users", limitValue: 1, enabled: true },
      { key: "max_export_height", limitValue: 1080, enabled: true },
      { key: "batch_generation", limitValue: null, enabled: false },
      { key: "hook_variations", limitValue: null, enabled: false },
      { key: "all_aspect_ratios", limitValue: null, enabled: false },
      { key: "advanced_analytics", limitValue: null, enabled: false },
      { key: "experiments", limitValue: null, enabled: false },
    ],
    highlights: ["3 connected accounts", "1 brand", "1 user", "1080p exports", "Scheduling and basic analytics"],
  },
  {
    code: "growth",
    label: "Growth",
    description:
      "Several brands, a small team, and the batch tools that make volume manageable rather than merely possible.",
    position: 1,
    priceCents: 9900,
    includedCredits: 220,
    // Signalled through layout and hierarchy. Deliberately not a "most popular"
    // ribbon — that is a claim about other customers' behaviour that we have not
    // measured and cannot substantiate.
    emphasised: true,
    requiresContact: false,
    entitlements: [
      { key: "connected_accounts", limitValue: 10, enabled: true },
      { key: "brands", limitValue: 5, enabled: true },
      { key: "users", limitValue: 3, enabled: true },
      { key: "max_export_height", limitValue: 1080, enabled: true },
      { key: "batch_generation", limitValue: null, enabled: true },
      { key: "hook_variations", limitValue: null, enabled: true },
      { key: "all_aspect_ratios", limitValue: null, enabled: true },
      { key: "advanced_analytics", limitValue: null, enabled: true },
      { key: "experiments", limitValue: null, enabled: true },
    ],
    highlights: [
      "10 connected accounts",
      "5 brands",
      "3 users",
      "Batch generation and hook variations",
      "All aspect ratios",
      "Advanced analytics and experiments",
    ],
  },
  {
    code: "agency",
    label: "Agency",
    description: "Client workspaces, approvals and roles, for teams delivering on someone else's behalf.",
    position: 2,
    priceCents: 29900,
    includedCredits: 750,
    emphasised: false,
    requiresContact: false,
    entitlements: [
      { key: "connected_accounts", limitValue: 50, enabled: true },
      { key: "brands", limitValue: null, enabled: true },
      { key: "users", limitValue: 10, enabled: true },
      { key: "max_export_height", limitValue: 2160, enabled: true },
      { key: "batch_generation", limitValue: null, enabled: true },
      { key: "hook_variations", limitValue: null, enabled: true },
      { key: "all_aspect_ratios", limitValue: null, enabled: true },
      { key: "advanced_analytics", limitValue: null, enabled: true },
      { key: "experiments", limitValue: null, enabled: true },
      { key: "client_workspaces", limitValue: null, enabled: true },
      { key: "approval_workflows", limitValue: null, enabled: true },
      { key: "priority_rendering", limitValue: null, enabled: true },
    ],
    highlights: [
      "50 connected accounts",
      "Client workspaces",
      "10 users",
      "Approval workflows, roles and permissions",
      "Client-level analytics",
      "Priority rendering",
    ],
  },
  {
    code: "network",
    label: "Network",
    description: "Dedicated workers, volume agreements and an SLA.",
    position: 3,
    // Null, not zero. The pricing UI branches on `requiresContact` so this never
    // renders as "€0.00".
    priceCents: null,
    includedCredits: 0,
    emphasised: false,
    requiresContact: true,
    entitlements: [
      { key: "connected_accounts", limitValue: null, enabled: true },
      { key: "brands", limitValue: null, enabled: true },
      { key: "users", limitValue: null, enabled: true },
      { key: "max_export_height", limitValue: 2160, enabled: true },
      { key: "batch_generation", limitValue: null, enabled: true },
      { key: "client_workspaces", limitValue: null, enabled: true },
      { key: "approval_workflows", limitValue: null, enabled: true },
      { key: "priority_rendering", limitValue: null, enabled: true },
      { key: "sso", limitValue: null, enabled: true },
    ],
    highlights: [
      "Custom credits and account limits",
      "Dedicated workers",
      "Volume agreements",
      "SSO",
      "SLA and priority support",
    ],
  },
] as const;

export type TopUpDefinition = {
  code: string;
  label: string;
  credits: number;
  priceCents: number;
  position: number;
};

export const TOP_UP_DEFAULTS: readonly TopUpDefinition[] = [
  { code: "topup_100", label: "100 Production Credits", credits: 100, priceCents: 5900, position: 0 },
  { code: "topup_300", label: "300 Production Credits", credits: 300, priceCents: 14900, position: 1 },
  { code: "topup_1000", label: "1,000 Production Credits", credits: 1000, priceCents: 39900, position: 2 },
] as const;

export function planDefault(code: string): PlanDefinition | null {
  return PLAN_DEFAULTS.find((plan) => plan.code === code) ?? null;
}

export type PlanCapacity = {
  fastReels: number;
  hybridReels: number;
  cinematicReels: number;
};

/**
 * How many reels of each kind a credit allowance buys.
 *
 * Computed from the production-mode prices rather than written into the plan
 * copy, so changing a mode's credit price updates every plan page instead of
 * leaving a stale hand-written figure claiming something untrue about what the
 * customer gets.
 */
export function planCapacity(
  includedCredits: number,
  modeCredits: { fast: number; hybrid: number; cinematic: number },
): PlanCapacity {
  const credits = Math.max(0, Math.trunc(includedCredits));
  return {
    fastReels: Math.floor(credits / Math.max(1, modeCredits.fast)),
    hybridReels: Math.floor(credits / Math.max(1, modeCredits.hybrid)),
    cinematicReels: Math.floor(credits / Math.max(1, modeCredits.cinematic)),
  };
}

/** Formats an integer-cent price. Null renders as contact-sales, never €0.00. */
export function formatPlanPrice(priceCents: number | null): string {
  if (priceCents === null) return "Custom";
  return `€${Math.round(priceCents / 100).toLocaleString("en-US")}`;
}
