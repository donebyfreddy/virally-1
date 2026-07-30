/**
 * Drizzle ORM schema for Neon Postgres.
 *
 * Ported table-for-table from supabase/migrations/*.sql (kept under supabase/
 * for historical reference only — Neon/Drizzle migrations under drizzle/ are
 * now authoritative). Two things were deliberately NOT ported:
 *
 * 1. Row-level security. Every policy from the Supabase migrations encoded
 *    "is this row in an org/workspace the caller belongs to" — that logic now
 *    lives in src/lib/db/authorization.ts and is applied explicitly by every
 *    query (see that file's header for why app-code guards, not hidden
 *    columns or UI, are the enforcement point).
 * 2. `updated_at` triggers. Maintained by application code on every write
 *    instead (see src/lib/db/index.ts's `touchUpdatedAt` helper).
 *
 * `auth.users` (Supabase's own identity table) has no Neon equivalent — it is
 * replaced by Better Auth's `user` table below, which every table that used
 * to reference `auth.users(id)` now references instead.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
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
// Circular with schema.fragment.ts (which imports enums/tables back from this
// file) — safe because every use of these two imports below is inside a lazy
// `foreignKey(() => ...)` callback, never read at module-evaluation time.
import { accountLaunchKits, connectedAccounts, mediaAssets } from "./schema.fragment";

// All enums live in ./enums — see that file's header for why they cannot
// live in this file or schema.fragment.ts (it would reintroduce the exact
// circular-init crash pulling them out fixes).
export * from "./enums";
import {
  memberRoleEnum,
  platformEnum,
  accountSlotStatusEnum,
} from "./enums";

// =============================================================================
// BETTER AUTH — replaces Supabase Auth (GoTrue) / auth.users
//
// Column shape follows Better Auth's Drizzle adapter conventions
// (https://better-auth.com), with `id` overridden to a Postgres-generated uuid
// (via defaultRandom()) instead of Better Auth's own id generator, so every
// existing `references auth.users(id)` foreign key across this schema stays a
// plain `uuid` column with no format change. Better Auth is configured with
// `advanced.database.generateId: false` to match (see src/lib/auth/index.ts).
// =============================================================================

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =============================================================================
// TENANCY — supabase/migrations/0002_tenancy.sql
//
// Authorization helpers that used to live here as SECURITY DEFINER Postgres
// functions (app.is_org_member, app.has_workspace_permission, etc.) are now
// src/lib/db/authorization.ts. Every query elsewhere in the app must call
// them explicitly — there is no database-enforced fallback anymore.
// =============================================================================

/** One row per Better Auth user. Never stores credentials — Better Auth owns those. */
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  email: text("email"),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  locale: text("locale").notNull().default("en"),
  timezone: text("timezone").notNull().default("UTC"),
  notificationPreferences: jsonb("notification_preferences")
    .notNull()
    .default({
      job_failed: true,
      approval_required: true,
      publish_failed: true,
      usage_warning: true,
      weekly_digest: false,
    }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The billing and ownership boundary. Cross-organization access is denied unconditionally. */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    accountType: text("account_type").notNull().default("personal").$type<
      "personal" | "agency" | "company" | "network"
    >(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("organizations_created_by_idx").on(t.createdBy),
    check("organizations_name_length", sql`length(trim(${t.name})) between 1 and 120`),
    check("organizations_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'`),
    check(
      "organizations_account_type",
      sql`${t.accountType} in ('personal', 'agency', 'company', 'network')`,
    ),
  ],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("viewer"),
    invitedBy: uuid("invited_by").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organization_members_org_user_key").on(t.organizationId, t.userId),
    index("organization_members_user_idx").on(t.userId),
    index("organization_members_org_idx").on(t.organizationId),
    index("organization_members_user_org_role_idx").on(t.userId, t.organizationId, t.role),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_org_slug_key").on(t.organizationId, t.slug),
    // Exactly one default workspace per organisation (partial unique index).
    uniqueIndex("workspaces_one_default_per_org")
      .on(t.organizationId)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
    index("workspaces_org_idx").on(t.organizationId).where(sql`${t.deletedAt} is null`),
    check("workspaces_name_length", sql`length(trim(${t.name})) between 1 and 120`),
    check("workspaces_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'`),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Overrides the organisation role within this workspace only. Null = inherit. */
    role: memberRoleEnum("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_members_workspace_user_key").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
    index("workspace_members_workspace_idx").on(t.workspaceId),
    index("workspace_members_organization_idx").on(t.organizationId),
  ],
);

// =============================================================================
// ACCOUNT SLOTS & PLAN LIMITS — supabase/migrations/0015_account_slots.sql
//
// A slot is licensed capacity, not a social account — see the original
// migration's header for the full rationale (empty slots are absent rows,
// not pre-created rows). The advisory-lock limit enforcement and the atomic
// "claim lowest free slot number" RPC are ported as a Drizzle transaction in
// src/lib/accounts/slots.ts, not as schema — Drizzle has no trigger/function
// modeling, only tables.
// =============================================================================

/** Per-plan default quotas. Overridden per-workspace by workspaceLimits. Private — never queried by a normal request, only by the slot-limit resolver. */
export const planLimits = pgTable("plan_limits", {
  planCode: text("plan_code").primaryKey(),
  accountSlotLimit: integer("account_slot_limit").notNull(),
  monthlyGenerationLimit: integer("monthly_generation_limit"),
  monthlyPublishLimit: integer("monthly_publish_limit"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-workspace quota overrides. Absent row or null column = fall back to the plan default. */
export const workspaceLimits = pgTable("workspace_limits", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  accountSlotLimit: integer("account_slot_limit"),
  monthlyGenerationLimit: integer("monthly_generation_limit"),
  monthlyPublishLimit: integer("monthly_publish_limit"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Licensed capacity for one social account slot. NOT a social account — see module header. */
export const accountSlots = pgTable(
  "account_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slotNumber: integer("slot_number").notNull(),
    platform: platformEnum("platform").notNull(),
    status: accountSlotStatusEnum("status").notNull().default("planning"),
    brandId: uuid("brand_id"),
    accountLaunchKitId: uuid("account_launch_kit_id"),
    connectedAccountId: uuid("connected_account_id"),
    displayLabel: text("display_label"),
    internalNotes: text("internal_notes"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("account_slots_workspace_slot_key").on(t.workspaceId, t.slotNumber),
    index("account_slots_active_idx")
      .on(t.workspaceId, t.slotNumber)
      .where(sql`${t.archivedAt} is null`),
    index("account_slots_status_idx")
      .on(t.workspaceId, t.status)
      .where(sql`${t.archivedAt} is null`),
    index("account_slots_connected_account_idx")
      .on(t.connectedAccountId)
      .where(sql`${t.connectedAccountId} is not null`),
    index("account_slots_launch_kit_idx")
      .on(t.accountLaunchKitId)
      .where(sql`${t.accountLaunchKitId} is not null`),
    check("account_slots_slot_number_positive", sql`${t.slotNumber} > 0`),
    check(
      "account_slots_archived_consistent",
      sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`,
    ),
    check(
      "account_slots_connected_requires_account",
      sql`${t.status} not in ('connected', 'limited_permissions', 'reconnection_required') or ${t.connectedAccountId} is not null`,
    ),
    // Composite FKs from 0015_account_slots.sql: a slot must not point at
    // another workspace's brand/launch-kit/connected-account. The planner
    // enforces this on every write with no trigger to skip — see that
    // migration's "CROSS-WORKSPACE REFERENCE SAFETY" note.
    foreignKey({
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brands.id, brands.workspaceId],
    }).onDelete("set null"),
    foreignKey({
      columns: [t.accountLaunchKitId, t.workspaceId],
      foreignColumns: [accountLaunchKits.id, accountLaunchKits.workspaceId],
    }).onDelete("set null"),
    foreignKey({
      columns: [t.connectedAccountId, t.workspaceId],
      foreignColumns: [connectedAccounts.id, connectedAccounts.workspaceId],
    }).onDelete("set null"),
  ],
);

// =============================================================================
// BRANDS — supabase/migrations/0004_brands_onboarding.sql
// =============================================================================

/** The identity content is produced for. A workspace may hold several. */
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    description: text("description"),
    industry: text("industry"),
    primaryLanguage: text("primary_language").notNull().default("en"),
    isPlaceholder: boolean("is_placeholder").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brands_one_default_per_workspace")
      .on(t.workspaceId)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
    check("brands_name_length", sql`length(trim(${t.name})) between 1 and 120`),
    check(
      "brands_website_url_format",
      sql`${t.websiteUrl} is null or ${t.websiteUrl} ~ '^https?://'`,
    ),
    // Referenced by account_slots' composite FK — see 0015_account_slots.sql.
    // MUST be a unique CONSTRAINT (not a unique index): Postgres only allows
    // a foreign key to reference columns backed by a unique or primary-key
    // constraint, not an arbitrary unique index, even though both are
    // enforced identically under the hood.
    unique("brands_id_workspace_key").on(t.id, t.workspaceId),
  ],
);

/** Voice and audience, split from `brands` because it's large, optional, and independently rewritten. */
export const brandProfiles = pgTable(
  "brand_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .unique()
      .references(() => brands.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    targetAudience: text("target_audience"),
    tone: text("tone"),
    primaryObjective: text("primary_objective"),
    valuePropositions: text("value_propositions").array().notNull().default([]),
    contentPillars: text("content_pillars").array().notNull().default([]),
    bannedTopics: text("banned_topics").array().notNull().default([]),
    bannedPhrases: text("banned_phrases").array().notNull().default([]),
    visualStyle: text("visual_style"),
    colourTokens: jsonb("colour_tokens").notNull().default({}),
    logoAssetId: uuid("logo_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  workspaces: many(workspaces),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workspaces.organizationId],
    references: [organizations.id],
  }),
  members: many(workspaceMembers),
}));

// Bulk-converted tables (brands, campaigns, content, media, accounts,
// publishing, analytics, jobs/audit) are re-exported from schema.fragment.ts
// once merged in — see that file for the full list.
export * from "./schema.fragment";
