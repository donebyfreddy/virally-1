// =============================================================================
// BILLING — plans, entitlements, credit reservations, top-up packages.
//
// Merged into schema.ts via `export * from "./schema.billing"`.
//
// Complements the tables that already exist rather than replacing them:
//
//   credit_ledger   — append-only truth for the balance (schema.fragment.ts)
//   subscriptions   — one row per org, current billing state (schema.fragment.ts)
//   usage_events    — metered consumption (schema.fragment.ts)
//
// The balance is ALWAYS `sum(credit_ledger.delta)`. Nothing here stores one.
// A cached balance column would need to stay in step with an append-only log
// under concurrency, and the first time it drifted, the ledger and the number
// the user sees would disagree with no way to tell which was right.
// =============================================================================

import { sql } from "drizzle-orm";
import { desc } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, user, workspaces } from "./schema";

// Cross-file table references below are wrapped in lazy `() => table.column`
// accessors — Drizzle's pattern for circular/forward references.

/**
 * A purchasable plan. Seeded, editable without a deploy.
 *
 * Prices are integer cents. `priceCents` being nullable is what distinguishes
 * the Network tier — a null price means "contact sales", not "free", and the
 * pricing UI branches on it rather than rendering €0.00.
 */
export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    position: integer("position").notNull().default(0),

    priceCents: integer("price_cents"),
    currency: text("currency").notNull().default("EUR"),
    interval: text("interval").notNull().default("month").$type<"month" | "year">(),

    /** Production Credits granted at the start of each billing period. */
    includedCredits: integer("included_credits").notNull().default(0),

    /**
     * Whether the UI should lead with this plan.
     *
     * Named for what it does to layout, not "most_popular" — the brief is
     * explicit that the recommended tier is signalled through composition and
     * hierarchy rather than a badge claiming a popularity we have not measured.
     */
    emphasised: boolean("emphasised").notNull().default(false),

    /** Whether new subscriptions may be created on this plan. */
    available: boolean("available").notNull().default(true),
    /** True for Network: price and credits are negotiated, not listed. */
    requiresContact: boolean("requires_contact").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    priceCheck: check("subscription_plans_price_check", sql`price_cents is null or price_cents >= 0`),
    creditsCheck: check("subscription_plans_credits_check", sql`included_credits >= 0`),
    intervalCheck: check("subscription_plans_interval_check", sql`interval in ('month', 'year')`),
    // A listed plan needs a price; a contact-sales plan must not pretend to have
    // one. This is what stops "€0/month" from ever rendering for Network.
    contactCheck: check(
      "subscription_plans_contact_check",
      sql`(requires_contact and price_cents is null) or (not requires_contact and price_cents is not null)`,
    ),
  }),
);

/**
 * What a plan allows, one row per limit.
 *
 * A row-per-limit table rather than columns on `subscription_plans`, because
 * limits are added far more often than plans are, and each addition would
 * otherwise be a migration plus a backfill.
 *
 * A null `limitValue` means UNLIMITED, which is why the column is nullable and
 * why nothing may coalesce it to zero — that inversion would turn an unlimited
 * entitlement into a total block.
 */
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planCode: text("plan_code")
      .notNull()
      .references(() => subscriptionPlans.code, { onDelete: "cascade" }),
    key: text("key").notNull().$type<
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
      | "sso"
    >(),
    /** Null means unlimited. Never coalesce this to 0. */
    limitValue: integer("limit_value"),
    /** For boolean entitlements, where `limitValue` is meaningless. */
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    limitCheck: check(
      "plan_entitlements_limit_check",
      sql`limit_value is null or limit_value >= 0`,
    ),
    planKeyUnique: unique("plan_entitlements_plan_key_unique").on(table.planCode, table.key),
  }),
);

/**
 * Credits withheld for work that has been authorised but has not finished.
 *
 * The row is bookkeeping and audit; the MONEY is entirely in `credit_ledger`.
 * Creating a reservation writes a negative `reservation_hold` entry, so the
 * balance already reflects the hold and nothing needs to subtract reservations
 * at read time. Settling writes a positive `reservation_release` for whatever
 * was not used.
 *
 * That split matters: if the balance were computed as
 * `ledger_sum - sum(active_reservations)`, then a crash between writing the
 * reservation row and writing the ledger entry would produce a balance that is
 * wrong in the customer's favour and self-correcting only by luck.
 */
export const creditReservations = pgTable(
  "credit_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),

    /** What the reservation is for, so the usage page can attribute it. */
    campaignId: uuid("campaign_id"),
    purpose: text("purpose").notNull().$type<"campaign_batch" | "single_generation" | "regeneration">(),

    /** Credits withheld at creation. Immutable once written. */
    creditsReserved: integer("credits_reserved").notNull(),
    /**
     * Credits actually consumed. Null until settled.
     *
     * Null is not zero: "not yet settled" and "settled at no cost" are different
     * states, and only the latter permits releasing the full hold.
     */
    creditsCharged: integer("credits_charged"),

    state: text("state").notNull().default("held").$type<
      "held" | "settled" | "released" | "expired"
    >(),

    /** Provider runs this reservation covers. */
    providerRunIds: jsonb("provider_run_ids").notNull().default([]),

    /**
     * When an unsettled hold may be swept back.
     *
     * Without an expiry, a worker that dies mid-batch strands the customer's
     * credits permanently with no operator-visible cause.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),

    /** Makes a repeated "Generate" click reserve once, not twice. */
    idempotencyKey: text("idempotency_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reservedCheck: check("credit_reservations_reserved_check", sql`credits_reserved > 0`),
    // A settlement may not charge more than was authorised. This is the
    // constraint that makes "you will never be billed above the estimate" a
    // property of the database rather than a promise in the UI.
    chargedCheck: check(
      "credit_reservations_charged_check",
      sql`credits_charged is null or (credits_charged >= 0 and credits_charged <= credits_reserved)`,
    ),
    stateCheck: check(
      "credit_reservations_state_check",
      sql`state in ('held', 'settled', 'released', 'expired')`,
    ),
    // A terminal reservation must record when it settled, and a held one must
    // not. Distinguishes "still running" from "finished, timestamp not written".
    settledCheck: check(
      "credit_reservations_settled_check",
      sql`(state = 'held') = (settled_at is null)`,
    ),
    // Only a settled reservation may name a charged amount.
    settledChargeCheck: check(
      "credit_reservations_settled_charge_check",
      sql`(state = 'settled') = (credits_charged is not null)`,
    ),
    idempotencyUnique: unique("credit_reservations_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    orgStateIdx: index("credit_reservations_org_state_idx").on(
      table.organizationId,
      table.state,
      desc(table.createdAt),
    ),
    // Drives the expiry sweeper.
    expiryIdx: index("credit_reservations_expiry_idx")
      .on(table.expiresAt)
      .where(sql`state = 'held'`),
  }),
);

/**
 * Purchasable credit bundles.
 *
 * Schema and UI exist regardless of whether Stripe is configured. With no
 * Stripe, checkout reports itself as configuration-required — it does not
 * fabricate a successful purchase, because a fake grant is indistinguishable
 * from a real one once it is in the ledger.
 */
export const topUpPackages = pgTable(
  "top_up_packages",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    credits: integer("credits").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    position: integer("position").notNull().default(0),
    available: boolean("available").notNull().default(true),
    /** Stripe price id, when Stripe is configured. Null otherwise. */
    externalPriceId: text("external_price_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    creditsCheck: check("top_up_packages_credits_check", sql`credits > 0`),
    priceCheck: check("top_up_packages_price_check", sql`price_cents > 0`),
  }),
);

/**
 * An organisation's subscription to a plan, with the period its grant covers.
 *
 * Distinct from the existing `subscriptions` table, which holds provider-facing
 * billing state (Stripe ids, status). This records which grant has been applied
 * for which period, and the unique index below is what makes "grant this
 * period's credits" idempotent — a cron that fires twice cannot grant twice.
 */
export const workspaceSubscriptions = pgTable(
  "workspace_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planCode: text("plan_code")
      .notNull()
      .references(() => subscriptionPlans.code, { onDelete: "restrict" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    creditsGranted: integer("credits_granted").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    periodCheck: check("workspace_subscriptions_period_check", sql`period_end > period_start`),
    creditsCheck: check("workspace_subscriptions_credits_check", sql`credits_granted >= 0`),
    // One grant per org per period. The idempotency guarantee for renewals.
    periodUnique: uniqueIndex("workspace_subscriptions_period_idx").on(
      table.organizationId,
      table.periodStart,
    ),
  }),
);
