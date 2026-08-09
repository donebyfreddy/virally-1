// =============================================================================
// SCHEMA FRAGMENT — converted from supabase/migrations/0004..0011
//
// Merged into schema.ts via `export * from "./schema.fragment"`. Enums come
// from the dependency-free ./enums module; tables come from ./schema:
//
//   Tables: user, profiles, organizations, organizationMembers, workspaces,
//           workspaceMembers, brands, brandProfiles
//
// Conversion notes that apply to the whole file:
//   - RLS policies, ENABLE/FORCE ROW LEVEL SECURITY, GRANT/REVOKE, and
//     SECURITY DEFINER functions (app.is_org_member, app.is_workspace_member,
//     app.has_workspace_permission, app.has_org_permission, app.apply_*_rls,
//     app.apply_child_rls) are intentionally NOT ported. Isolation moves to
//     application-code query guards.
//   - `updated_at` is maintained by app code — there is no DB trigger
//     (`app.attach_touch_trigger`) modelled here; Drizzle has no trigger
//     construct and none is needed at the schema level.
//   - `auth.users (id)` becomes `user.id` (Better Auth identity table).
//   - Every table below carries a one-line purpose comment and a note of
//     which migration file it came from, per the conversion brief.
// =============================================================================

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgView,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  date,
  index,
  unique,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
// All enums (including the four new ones this fragment's migrations
// introduced — campaignStageEnum, stageStateEnum, generationModeEnum,
// experimentConfidenceEnum) live in ./enums, which has no dependency on
// ./schema or this file. That is deliberate: an enum referenced directly
// inside a pgTable/pgView column (not lazily, unlike `.references(() =>
// ...)`) is read the instant the module evaluates, so an enum sitting in the
// schema.ts <-> schema.fragment.ts cycle crashes with "Cannot access before
// initialization". Re-exported below so external code can still import them
// from either './schema' or './schema.fragment'.
export {
  campaignStageEnum,
  stageStateEnum,
  generationModeEnum,
  experimentConfidenceEnum,
} from './enums';
import {
  memberRoleEnum,
  platformEnum,
  aspectRatioEnum,
  reviewStatusEnum,
  jobStatusEnum,
  publishStatusEnum,
  connectionHealthEnum,
  assetKindEnum,
  outputOriginEnum,
  campaignStageEnum,
  stageStateEnum,
  generationModeEnum,
  experimentConfidenceEnum,
} from './enums';
import { user, organizations, workspaces, brands } from './schema';

// This file is imported by schema.ts via `export * from "./schema.fragment"`,
// and imports several tables back from schema.ts above — a circular import.
// That's safe here ONLY because every cross-reference below is wrapped in a
// lazy `() => table.column` accessor (Drizzle's documented pattern for
// forward/circular references), never read at module-evaluation time. Do not
// add a top-level (non-lazy) use of a table import from './schema' in this
// file.

// =============================================================================
// 0004_brands_onboarding.sql
//
// NOTE: `brands` and `brand_profiles` are defined elsewhere per the merge
// contract and are NOT redefined here, even though this migration file
// creates them.
// =============================================================================

// One row per user per organisation: resumable onboarding progress and
// answers. From: 0004_brands_onboarding.sql
export const onboardingProgress = pgTable(
  'onboarding_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Originally `smallint`; no smallint builder in the agreed import set, so
    // modelled as integer with the same range check preserved below.
    currentStep: integer('current_step').notNull().default(1),
    completedSteps: integer('completed_steps').array().notNull().default([]),
    accountType: text('account_type').$type<'personal' | 'agency' | 'company' | 'network'>(),
    contentGoals: text('content_goals').array().notNull().default([]),
    preferredFormats: text('preferred_formats').array().notNull().default([]),
    firstCampaignPrompt: text('first_campaign_prompt'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgUserUnique: uniqueIndex('onboarding_progress_organization_id_user_id_key').on(
      table.organizationId,
      table.userId,
    ),
    userIdx: index('onboarding_progress_user_idx').on(table.userId),
    currentStepCheck: check(
      'onboarding_progress_current_step_check',
      sql`current_step between 1 and 7`,
    ),
    accountTypeCheck: check(
      'onboarding_progress_account_type_check',
      sql`account_type in ('personal', 'agency', 'company', 'network')`,
    ),
  }),
);

// View: teammate roster (name, avatar, role) for the team screen. Originally
// ran with view-owner rights (deliberately not security_invoker) and used
// `app.is_org_member(m.organization_id)` in its WHERE clause as the ONLY
// thing standing between the caller and every user's row, since owner rights
// bypass RLS on organization_members and profiles.
//
// That authorisation function is being dropped along with RLS. This view
// reproduces the SELECT/JOIN shape only — it does NOT reproduce the
// authorisation predicate. Whoever queries this view from application code
// MUST filter to organisations the caller belongs to itself, or it will
// return every organisation's roster.
// From: 0004_brands_onboarding.sql
export const organizationTeammates = pgView('organization_teammates', {
  organizationId: uuid('organization_id'),
  userId: uuid('user_id'),
  role: memberRoleEnum('role'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
}).as(sql`
  select
    m.organization_id,
    m.user_id,
    m.role,
    m.accepted_at,
    p.full_name,
    p.avatar_url
  from organization_members m
  join profiles p on p.id = m.user_id
`);

// =============================================================================
// 0005_campaigns.sql
// =============================================================================

// The parent object for generation, publishing and analytics: one marketing
// campaign. From: 0005_campaigns.sql
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    objective: text('objective'),
    mode: generationModeEnum('mode').notNull().default('campaign'),
    status: reviewStatusEnum('status').notNull().default('draft'),

    startsOn: date('starts_on'),
    endsOn: date('ends_on'),

    languages: text('languages').array().notNull().default(['en']),
    platforms: platformEnum('platforms').array().notNull().default([]),

    // Denormalised counters, maintained by the job workers.
    conceptsCount: integer('concepts_count').notNull().default(0),
    contentCount: integer('content_count').notNull().default(0),
    publishedCount: integer('published_count').notNull().default(0),

    // Cost accounting in integer minor units (cents), never floats.
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    actualCostCents: integer('actual_cost_cents').notNull().default(0),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameLengthCheck: check(
      'campaigns_name_check',
      sql`length(trim(name)) between 1 and 200`,
    ),
    dateRangeCheck: check(
      'campaigns_date_range',
      sql`ends_on is null or starts_on is null or ends_on >= starts_on`,
    ),
    conceptsCountCheck: check('campaigns_concepts_count_check', sql`concepts_count >= 0`),
    contentCountCheck: check('campaigns_content_count_check', sql`content_count >= 0`),
    publishedCountCheck: check('campaigns_published_count_check', sql`published_count >= 0`),
    estimatedCostCheck: check(
      'campaigns_estimated_cost_cents_check',
      sql`estimated_cost_cents >= 0`,
    ),
    actualCostCheck: check('campaigns_actual_cost_cents_check', sql`actual_cost_cents >= 0`),
    workspaceStatusIdx: index('campaigns_workspace_status_idx')
      .on(table.workspaceId, table.status, desc(table.createdAt))
      .where(sql`deleted_at is null`),
    brandIdx: index('campaigns_brand_idx').on(table.brandId).where(sql`deleted_at is null`),
    // Trigram index for the command palette's campaign search. Requires the
    // pg_trgm extension (created in an earlier migration) to be present.
    nameTrgmIdx: index('campaigns_name_trgm_idx').using(
      'gin',
      sql`${table.name} gin_trgm_ops`,
    ),
  }),
);

// The structured, versioned brief derived from the user's prompt — one
// version per edit, never overwritten in place. From: 0005_campaigns.sql
export const campaignBriefs = pgTable(
  'campaign_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),

    rawPrompt: text('raw_prompt'),
    sourceKind: text('source_kind').$type<
      'prompt' | 'website' | 'product' | 'document' | 'video' | 'audio' | 'image' | 'library'
    >(),
    sourceUrl: text('source_url'),
    // Deferred FK added in 0007_media_generation.sql once media_assets exists.
    sourceAssetId: uuid('source_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),

    audience: text('audience'),
    tone: text('tone'),
    keyMessages: text('key_messages').array().notNull().default([]),
    contentPillars: text('content_pillars').array().notNull().default([]),
    callToAction: text('call_to_action'),

    externalTextSanitised: boolean('external_text_sanitised').notNull().default(false),

    isCurrent: boolean('is_current').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionCheck: check('campaign_briefs_version_check', sql`version >= 1`),
    sourceKindCheck: check(
      'campaign_briefs_source_kind_check',
      sql`source_kind in ('prompt', 'website', 'product', 'document', 'video', 'audio', 'image', 'library')`,
    ),
    campaignVersionUnique: uniqueIndex('campaign_briefs_campaign_id_version_key').on(
      table.campaignId,
      table.version,
    ),
    oneCurrentIdx: uniqueIndex('campaign_briefs_one_current')
      .on(table.campaignId)
      .where(sql`is_current`),
  }),
);

// One row per pipeline stage per campaign, so the progress visual reads real
// state and a blocked stage always carries its reason. From:
// 0005_campaigns.sql
export const campaignStages = pgTable(
  'campaign_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    stage: campaignStageEnum('stage').notNull(),
    state: stageStateEnum('state').notNull().default('pending'),
    blockedReason: text('blocked_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campaignStageUnique: uniqueIndex('campaign_stages_campaign_id_stage_key').on(
      table.campaignId,
      table.stage,
    ),
    blockedNeedsReason: check(
      'campaign_stages_blocked_needs_reason',
      sql`state <> 'blocked' or blocked_reason is not null`,
    ),
  }),
);

// Which platforms (and at which ratios) a campaign targets. From:
// 0005_campaigns.sql
export const campaignPlatforms = pgTable(
  'campaign_platforms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    aspectRatios: aspectRatioEnum('aspect_ratios').array().notNull().default(['9:16']),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campaignPlatformUnique: uniqueIndex('campaign_platforms_campaign_id_platform_key').on(
      table.campaignId,
      table.platform,
    ),
  }),
);

// =============================================================================
// 0006_content.sql
// =============================================================================

// One creative idea before it is written: the top-level pitch for a piece of
// content. From: 0006_content.sql
export const contentConcepts = pgTable(
  'content_concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),

    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    angle: text('angle'),
    summary: text('summary'),
    status: reviewStatusEnum('status').notNull().default('draft'),

    origin: outputOriginEnum('origin').notNull().default('mock'),

    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campaignIdx: index('content_concepts_campaign_idx').on(table.campaignId, table.position),
  }),
);

// The first 1-3 seconds of a piece of content, tracked as its own entity so
// hook performance can be compared across variants. From: 0006_content.sql
export const contentHooks = pgTable(
  'content_hooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => contentConcepts.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    text: text('text').notNull(),
    position: integer('position').notNull().default(0),
    origin: outputOriginEnum('origin').notNull().default('mock'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conceptIdx: index('content_hooks_concept_idx').on(table.conceptId, table.position),
  }),
);

// One creative idea in one language — the thing an editor opens in the
// studio. Platform-specific renditions live in `content_variants`. From:
// 0006_content.sql
export const contentItems = pgTable(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    conceptId: uuid('concept_id').references(() => contentConcepts.id, { onDelete: 'set null' }),
    hookId: uuid('hook_id').references(() => contentHooks.id, { onDelete: 'set null' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),

    title: text('title').notNull().default('Untitled'),
    contentType: text('content_type')
      .notNull()
      .default('short_video')
      .$type<'short_video' | 'long_video' | 'image' | 'carousel' | 'text'>(),
    language: text('language').notNull().default('en'),
    status: reviewStatusEnum('status').notNull().default('draft'),

    /** Production lifecycle, separate from editorial review status. */
    generationStatus: text('generation_status').$type<
      'planned' | 'queued' | 'generating' | 'rendering' | 'ready' | 'failed' | 'cancelled'
    >(),
    generationErrorCode: text('generation_error_code'),
    generationErrorMessage: text('generation_error_message'),
    generationErrorStage: text('generation_error_stage'),
    generationStartedAt: timestamp('generation_started_at', { withTimezone: true }),
    generationCompletedAt: timestamp('generation_completed_at', { withTimezone: true }),

    // Canonical duration in milliseconds — never seconds-as-float.
    durationMs: integer('duration_ms'),

    caption: text('caption'),
    callToAction: text('call_to_action'),

    origin: outputOriginEnum('origin').notNull().default('mock'),

    /**
     * Fields a campaign-authored item gets for free elsewhere and a standalone
     * one has nowhere else to keep. From: 0016_quick_content.sql.
     *
     * `tone` mirrors `campaign_briefs.tone` — there is no brief row for
     * standalone content, since `campaign_briefs.campaign_id` is NOT NULL.
     * `productionMode` mirrors the batch-level mode a campaign chooses once for
     * all its items; a standalone item chooses its own.
     */
    tone: text('tone'),
    productionMode: text('production_mode').$type<'fast' | 'hybrid' | 'cinematic'>(),
    /**
     * The plan the user reviewed and confirmed before paid generation started —
     * structure, hook, per-asset counts. A snapshot, not recomputed on read, so
     * the credits actually reserved always match what the user actually saw.
     */
    generationPlan: jsonb('generation_plan'),
    estimatedCredits: integer('estimated_credits').notNull().default(0),
    actualCredits: integer('actual_credits').notNull().default(0),

    // Optimistic-concurrency token for the studio's autosave.
    revision: integer('revision').notNull().default(1),

    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => user.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contentTypeCheck: check(
      'content_items_content_type_check',
      sql`content_type in ('short_video', 'long_video', 'image', 'carousel', 'text')`,
    ),
    durationCheck: check(
      'content_items_duration_ms_check',
      sql`duration_ms is null or duration_ms > 0`,
    ),
    revisionCheck: check('content_items_revision_check', sql`revision >= 1`),
    productionModeCheck: check(
      'content_items_production_mode_check',
      sql`production_mode is null or production_mode in ('fast', 'hybrid', 'cinematic')`,
    ),
    generationStatusCheck: check(
      'content_items_generation_status_check',
      sql`generation_status is null or generation_status in ('planned', 'queued', 'generating', 'rendering', 'ready', 'failed', 'cancelled')`,
    ),
    estimatedCreditsCheck: check(
      'content_items_estimated_credits_check',
      sql`estimated_credits >= 0`,
    ),
    actualCreditsCheck: check('content_items_actual_credits_check', sql`actual_credits >= 0`),
    workspaceStatusIdx: index('content_items_workspace_status_idx')
      .on(table.workspaceId, table.status, desc(table.updatedAt))
      .where(sql`deleted_at is null`),
    campaignIdx: index('content_items_campaign_idx')
      .on(table.campaignId)
      .where(sql`deleted_at is null`),
    conceptIdx: index('content_items_concept_idx').on(table.conceptId),
  }),
);

// The publishable unit: one content item, recomposed for one platform at one
// ratio for one account. From: 0006_content.sql
export const contentVariants = pgTable(
  'content_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),

    platform: platformEnum('platform').notNull(),
    aspectRatio: aspectRatioEnum('aspect_ratio').notNull().default('9:16'),
    width: integer('width'),
    height: integer('height'),
    language: text('language').notNull().default('en'),

    // Per-platform overrides. Null means "inherit from the content item".
    captionOverride: text('caption_override'),
    titleOverride: text('title_override'),
    callToActionOverride: text('call_to_action_override'),

    // Per-ratio layout decisions: subject focus, safe-area insets, placement.
    layoutOverrides: jsonb('layout_overrides').notNull().default({}),

    // Deferred FKs added in 0007_media_generation.sql once media_assets exists.
    renderedAssetId: uuid('rendered_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    thumbnailAssetId: uuid('thumbnail_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),

    status: reviewStatusEnum('status').notNull().default('draft'),
    origin: outputOriginEnum('origin').notNull().default('mock'),

    // Content fingerprint over the rendered media, for the duplicate-content
    // warning. Nullable — only exists post-render.
    contentHash: text('content_hash'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    widthCheck: check('content_variants_width_check', sql`width is null or width > 0`),
    heightCheck: check('content_variants_height_check', sql`height is null or height > 0`),
    // One variant per item per platform/ratio/language — what makes a retried
    // batch-generation job idempotent instead of producing duplicates.
    itemPlatformRatioLangUnique: uniqueIndex(
      'content_variants_content_item_id_platform_aspect_ratio_language_key',
    ).on(table.contentItemId, table.platform, table.aspectRatio, table.language),
    itemIdx: index('content_variants_item_idx').on(table.contentItemId),
    platformIdx: index('content_variants_platform_idx').on(
      table.workspaceId,
      table.platform,
      table.status,
    ),
    // Powers the duplicate-asset warning.
    hashIdx: index('content_variants_hash_idx')
      .on(table.workspaceId, table.contentHash)
      .where(sql`content_hash is not null`),
  }),
);

// A versioned, segmentable script for a content item — regenerating one shot
// must not regenerate the whole thing. From: 0006_content.sql
export const scripts = pgTable(
  'scripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    isCurrent: boolean('is_current').notNull().default(true),
    fullText: text('full_text'),
    wordCount: integer('word_count'),
    origin: outputOriginEnum('origin').notNull().default('mock'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionCheck: check('scripts_version_check', sql`version >= 1`),
    itemVersionUnique: uniqueIndex('scripts_content_item_id_version_key').on(
      table.contentItemId,
      table.version,
    ),
    oneCurrentIdx: uniqueIndex('scripts_one_current')
      .on(table.contentItemId)
      .where(sql`is_current`),
  }),
);

// One narration/beat segment of a script. No tenant column — authorised
// through the parent script (see 0003; RLS not ported here). From:
// 0006_content.sql
export const scriptSegments = pgTable(
  'script_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scriptId: uuid('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    role: text('role')
      .notNull()
      .default('body')
      .$type<'hook' | 'body' | 'cta' | 'outro'>(),
    text: text('text').notNull(),
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roleCheck: check(
      'script_segments_role_check',
      sql`role in ('hook', 'body', 'cta', 'outro')`,
    ),
    startMsCheck: check('script_segments_start_ms_check', sql`start_ms is null or start_ms >= 0`),
    endMsCheck: check('script_segments_end_ms_check', sql`end_ms is null or end_ms >= 0`),
    timeOrderCheck: check(
      'script_segments_time_order',
      sql`end_ms is null or start_ms is null or end_ms > start_ms`,
    ),
    scriptPositionUnique: uniqueIndex('script_segments_script_id_position_key').on(
      table.scriptId,
      table.position,
    ),
  }),
);

// A versioned shot list for a content item's script. From: 0006_content.sql
export const storyboards = pgTable(
  'storyboards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    isCurrent: boolean('is_current').notNull().default(true),
    origin: outputOriginEnum('origin').notNull().default('mock'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionCheck: check('storyboards_version_check', sql`version >= 1`),
    itemVersionUnique: uniqueIndex('storyboards_content_item_id_version_key').on(
      table.contentItemId,
      table.version,
    ),
    oneCurrentIdx: uniqueIndex('storyboards_one_current')
      .on(table.contentItemId)
      .where(sql`is_current`),
  }),
);

// One shot within a storyboard, with its own generated media so regenerating
// one shot replaces one asset. From: 0006_content.sql
export const shots = pgTable(
  'shots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyboardId: uuid('storyboard_id')
      .notNull()
      .references(() => storyboards.id, { onDelete: 'cascade' }),
    scriptSegmentId: uuid('script_segment_id').references(() => scriptSegments.id, {
      onDelete: 'set null',
    }),
    position: integer('position').notNull(),
    description: text('description'),
    visualPrompt: text('visual_prompt'),
    camera: text('camera'),
    durationMs: integer('duration_ms'),
    // Deferred FK added in 0007_media_generation.sql once media_assets exists.
    assetId: uuid('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    status: jobStatusEnum('status').notNull().default('pending'),
    origin: outputOriginEnum('origin').notNull().default('mock'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    durationCheck: check('shots_duration_ms_check', sql`duration_ms is null or duration_ms > 0`),
    storyboardPositionUnique: uniqueIndex('shots_storyboard_id_position_key').on(
      table.storyboardId,
      table.position,
    ),
  }),
);

// =============================================================================
// 0007_media_generation.sql
//
// NOTE: the deferred FKs this file originally added via ALTER TABLE onto
// `brand_profiles.logo_asset_id`, `campaign_briefs.source_asset_id`,
// `content_variants.rendered_asset_id` / `thumbnail_asset_id`, and
// `shots.asset_id` are modelled inline on those columns above instead
// (Drizzle has no deferred-constraint concept — `() => mediaAssets.id` lazy
// references resolve regardless of declaration order). `brand_profiles` is
// defined elsewhere per the merge contract, so its `logo_asset_id ->
// media_assets` FK is NOT added here — add
// `.references(() => mediaAssets.id, { onDelete: 'set null' })` to
// `brandProfiles.logoAssetId` by hand when merging.
// =============================================================================

// Any stored media object — uploaded or generated — with its storage
// location, provenance and moderation lifecycle. From:
// 0007_media_generation.sql
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'set null',
    }),

    kind: assetKindEnum('kind').notNull(),

    // `storagePath` is the object key inside the bucket; access is always via
    // a short-lived signed URL, never a public URL.
    bucket: text('bucket')
      .notNull()
      .$type<'source-media' | 'generated-media' | 'brand-assets' | 'avatars' | 'exports'>(),
    storagePath: text('storage_path').notNull(),

    filename: text('filename'),
    mimeType: text('mime_type'),
    byteSize: bigint('byte_size', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    aspectRatio: aspectRatioEnum('aspect_ratio'),
    codec: text('codec'),
    // Poster image for video, so a library grid never needs a <video> element
    // per tile just to show a still frame.
    posterAssetId: uuid('poster_asset_id').references((): AnyPgColumn => mediaAssets.id, {
      onDelete: 'set null',
    }),

    origin: outputOriginEnum('origin').notNull().default('user_upload'),
    provider: text('provider'),
    providerModel: text('provider_model'),
    generationCostCents: integer('generation_cost_cents').notNull().default(0),

    // Deduplication and the duplicate-content warning.
    checksum: text('checksum'),

    // Upload lifecycle. A row exists before the bytes land, so an interrupted
    // upload is visible and cleanable rather than an orphaned object.
    uploadState: text('upload_state')
      .notNull()
      .default('pending')
      .$type<'pending' | 'uploaded' | 'processing' | 'ready' | 'failed'>(),
    scanState: text('scan_state')
      .notNull()
      .default('pending')
      .$type<'pending' | 'clean' | 'rejected' | 'skipped'>(),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bucketCheck: check(
      'media_assets_bucket_check',
      sql`bucket in ('source-media', 'generated-media', 'brand-assets', 'avatars', 'exports')`,
    ),
    byteSizeCheck: check(
      'media_assets_byte_size_check',
      sql`byte_size is null or byte_size >= 0`,
    ),
    durationCheck: check(
      'media_assets_duration_ms_check',
      sql`duration_ms is null or duration_ms >= 0`,
    ),
    widthCheck: check('media_assets_width_check', sql`width is null or width > 0`),
    heightCheck: check('media_assets_height_check', sql`height is null or height > 0`),
    uploadStateCheck: check(
      'media_assets_upload_state_check',
      sql`upload_state in ('pending', 'uploaded', 'processing', 'ready', 'failed')`,
    ),
    scanStateCheck: check(
      'media_assets_scan_state_check',
      sql`scan_state in ('pending', 'clean', 'rejected', 'skipped')`,
    ),
    // One row per object — makes a retried upload idempotent.
    bucketPathUnique: uniqueIndex('media_assets_bucket_storage_path_key').on(
      table.bucket,
      table.storagePath,
    ),
    workspaceKindIdx: index('media_assets_workspace_kind_idx')
      .on(table.workspaceId, table.kind, desc(table.createdAt))
      .where(sql`deleted_at is null`),
    campaignIdx: index('media_assets_campaign_idx')
      .on(table.campaignId)
      .where(sql`deleted_at is null`),
    checksumIdx: index('media_assets_checksum_idx')
      .on(table.workspaceId, table.checksum)
      .where(sql`checksum is not null`),
  }),
);

// Append-only history of an asset's regenerations — regeneration produces a
// new version rather than overwriting, so undo stays possible and a
// published post's asset never gets rewritten under it. From:
// 0007_media_generation.sql
export const mediaAssetVersions = pgTable(
  'media_asset_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    storagePath: text('storage_path').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionCheck: check('media_asset_versions_version_check', sql`version >= 1`),
    assetVersionUnique: uniqueIndex('media_asset_versions_asset_id_version_key').on(
      table.assetId,
      table.version,
    ),
  }),
);

// The canonical, renderer-agnostic edit timeline for a content item or
// variant — tracks, clips, captions, timings — so a 4:5 variant is derivable
// from a 9:16 one instead of a blind centre crop. From:
// 0007_media_generation.sql
export const compositions = pgTable(
  'compositions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'cascade',
    }),
    contentVariantId: uuid('content_variant_id').references(() => contentVariants.id, {
      onDelete: 'cascade',
    }),

    width: integer('width').notNull(),
    height: integer('height').notNull(),
    fps: integer('fps').notNull().default(30),
    // Frames, not seconds — the renderer works in frames.
    durationFrames: integer('duration_frames').notNull(),
    backgroundColour: text('background_colour'),

    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    widthCheck: check('compositions_width_check', sql`width > 0`),
    heightCheck: check('compositions_height_check', sql`height > 0`),
    fpsCheck: check('compositions_fps_check', sql`fps between 1 and 120`),
    durationFramesCheck: check(
      'compositions_duration_frames_check',
      sql`duration_frames > 0`,
    ),
    revisionCheck: check('compositions_revision_check', sql`revision >= 1`),
    // Belongs to an item or a variant, never both and never neither.
    singleOwnerCheck: check(
      'compositions_single_owner',
      sql`(content_item_id is not null and content_variant_id is null) or (content_item_id is null and content_variant_id is not null)`,
    ),
  }),
);

// One track (video/audio/voice/music/text/caption/overlay) within a
// composition's timeline. From: 0007_media_generation.sql
export const compositionTracks = pgTable(
  'composition_tracks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    compositionId: uuid('composition_id')
      .notNull()
      .references(() => compositions.id, { onDelete: 'cascade' }),
    kind: text('kind')
      .notNull()
      .$type<'video' | 'audio' | 'voice' | 'music' | 'text' | 'caption' | 'overlay'>(),
    position: integer('position').notNull(),
    isMuted: boolean('is_muted').notNull().default(false),
    isLocked: boolean('is_locked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'composition_tracks_kind_check',
      sql`kind in ('video', 'audio', 'voice', 'music', 'text', 'caption', 'overlay')`,
    ),
    compositionPositionUnique: uniqueIndex('composition_tracks_composition_id_position_key').on(
      table.compositionId,
      table.position,
    ),
    // The join column read by app-code query guards replacing the RLS policy
    // that used to authorise this table two levels down from a workspace.
    compositionIdx: index('composition_tracks_composition_idx').on(table.compositionId),
  }),
);

// One clip (media reference, text overlay, transform, transitions) placed on
// a composition track. From: 0007_media_generation.sql
export const compositionClips = pgTable(
  'composition_clips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackId: uuid('track_id')
      .notNull()
      .references(() => compositionTracks.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    // All timings in frames, consistent with the composition.
    startFrame: integer('start_frame').notNull(),
    durationFrames: integer('duration_frames').notNull(),
    // Trim points within the source asset.
    sourceInFrame: integer('source_in_frame'),
    sourceOutFrame: integer('source_out_frame'),
    textContent: text('text_content'),
    style: jsonb('style').notNull().default({}),
    transform: jsonb('transform').notNull().default({}),
    transitionIn: text('transition_in'),
    transitionOut: text('transition_out'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    startFrameCheck: check('composition_clips_start_frame_check', sql`start_frame >= 0`),
    durationFramesCheck: check(
      'composition_clips_duration_frames_check',
      sql`duration_frames > 0`,
    ),
    sourceInFrameCheck: check(
      'composition_clips_source_in_frame_check',
      sql`source_in_frame is null or source_in_frame >= 0`,
    ),
    sourceRangeCheck: check(
      'composition_clips_source_range',
      sql`source_out_frame is null or source_in_frame is null or source_out_frame > source_in_frame`,
    ),
    trackPositionUnique: uniqueIndex('composition_clips_track_id_position_key').on(
      table.trackId,
      table.position,
    ),
    // The join column every policy above filtered on.
    trackIdx: index('composition_clips_track_idx').on(table.trackId),
  }),
);

// One row per provider call: what generated it, how long it took, what it
// cost, and whether it was real or mock. From: 0007_media_generation.sql
export const generationRuns = pgTable(
  'generation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'set null',
    }),
    contentVariantId: uuid('content_variant_id').references(() => contentVariants.id, {
      onDelete: 'set null',
    }),
    shotId: uuid('shot_id').references(() => shots.id, { onDelete: 'set null' }),

    stage: text('stage').notNull().$type<
      | 'brief'
      | 'strategy'
      | 'concepts'
      | 'hooks'
      | 'script'
      | 'storyboard'
      | 'image'
      | 'video'
      | 'voice'
      | 'composition'
      | 'adaptation'
      | 'moderation'
      | 'thumbnail'
    >(),

    provider: text('provider').notNull(),
    providerModel: text('provider_model'),
    // Which prompt template produced this — without it, a quality regression
    // after a prompt change is untraceable.
    promptVersion: text('prompt_version'),
    capability: text('capability'),

    status: jobStatusEnum('status').notNull().default('pending'),
    attempt: integer('attempt').notNull().default(1),

    origin: outputOriginEnum('origin').notNull().default('mock'),

    inputDigest: text('input_digest'),
    outputSummary: jsonb('output_summary'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    costCents: integer('cost_cents').notNull().default(0),
    // Distinguishes "failed and you were charged" from "failed for free".
    costIncurred: boolean('cost_incurred').notNull().default(false),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),

    // Support identifier surfaced in the error UI. Originally computed at
    // insert time from `gen_random_uuid()`; reproduce the same generation in
    // application code when inserting (no column-level default expression
    // equivalent is modelled here beyond the SQL default below).
    reference: text('reference')
      .notNull()
      .default(sql`upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))`),

    externalJobId: text('external_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stageCheck: check(
      'generation_runs_stage_check',
      sql`stage in ('brief', 'strategy', 'concepts', 'hooks', 'script', 'storyboard', 'image', 'video', 'voice', 'composition', 'adaptation', 'moderation', 'thumbnail')`,
    ),
    attemptCheck: check('generation_runs_attempt_check', sql`attempt >= 1`),
    durationCheck: check(
      'generation_runs_duration_ms_check',
      sql`duration_ms is null or duration_ms >= 0`,
    ),
    costCheck: check('generation_runs_cost_cents_check', sql`cost_cents >= 0`),
    workspaceCreatedIdx: index('generation_runs_workspace_created_idx').on(
      table.workspaceId,
      desc(table.createdAt),
    ),
    statusIdx: index('generation_runs_status_idx')
      .on(table.status)
      .where(sql`status in ('pending', 'queued', 'running', 'waiting_external')`),
    itemIdx: index('generation_runs_item_idx').on(table.contentItemId),
    referenceUnique: uniqueIndex('generation_runs_reference_idx').on(table.reference),
  }),
);

// =============================================================================
// 0008_accounts.sql
// =============================================================================

// A social/publishing account connected to a workspace — identity and health
// only; tokens live separately in `oauth_connections`. From:
// 0008_accounts.sql
export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),

    platform: platformEnum('platform').notNull(),
    // The platform's own identifier. Unique per platform per workspace so
    // reconnecting the same account updates rather than duplicating it.
    externalId: text('external_id').notNull(),
    username: text('username'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    profileUrl: text('profile_url'),

    accountKind: text('account_kind').$type<
      'personal' | 'creator' | 'business' | 'page' | 'channel'
    >(),

    health: connectionHealthEnum('health').notNull().default('healthy'),
    healthDetail: text('health_detail'),

    // Capabilities actually granted by this connection, resolved at connect
    // time from the scopes the user consented to.
    grantedCapabilities: text('granted_capabilities').array().notNull().default([]),
    grantedScopes: text('granted_scopes').array().notNull().default([]),

    followerCount: integer('follower_count'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastPublishedAt: timestamp('last_published_at', { withTimezone: true }),

    connectedBy: uuid('connected_by').references(() => user.id, { onDelete: 'set null' }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    accountKindCheck: check(
      'connected_accounts_account_kind_check',
      sql`account_kind in ('personal', 'creator', 'business', 'page', 'channel')`,
    ),
    followerCountCheck: check(
      'connected_accounts_follower_count_check',
      sql`follower_count is null or follower_count >= 0`,
    ),
    workspacePlatformExternalUnique: uniqueIndex(
      'connected_accounts_workspace_id_platform_external_id_key',
    ).on(table.workspaceId, table.platform, table.externalId),
    workspaceIdx: index('connected_accounts_workspace_idx')
      .on(table.workspaceId)
      .where(sql`disconnected_at is null`),
    healthIdx: index('connected_accounts_health_idx')
      .on(table.workspaceId, table.health)
      .where(sql`disconnected_at is null`),
    brandIdx: index('connected_accounts_brand_idx').on(table.brandId),
    // Referenced by account_slots' composite FK — see 0015_account_slots.sql.
    // Must be a unique CONSTRAINT, not a unique index — Postgres foreign
    // keys only accept the former as a reference target.
    idWorkspaceKey: unique('connected_accounts_id_workspace_key').on(
      table.id,
      table.workspaceId,
    ),
  }),
);

// SECRETS. Encrypted OAuth tokens for a connected account — no client access
// under RLS previously, and under the new model this table must never be
// exposed through any client-facing query path; only server code should
// touch it. From: 0008_accounts.sql
export const oauthConnections = pgTable(
  'oauth_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .unique()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),

    platform: platformEnum('platform').notNull(),

    // Encrypted at the application layer before insert (TOKEN_ENCRYPTION_KEY
    // held only in the server environment).
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    // Which key version encrypted this row, so keys can be rotated without
    // decrypting everything at once.
    encryptionKeyId: text('encryption_key_id').notNull().default('v1'),

    tokenType: text('token_type'),
    scopes: text('scopes').array().notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    refreshFailureCount: integer('refresh_failure_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    refreshFailureCountCheck: check(
      'oauth_connections_refresh_failure_count_check',
      sql`refresh_failure_count >= 0`,
    ),
    expiryIdx: index('oauth_connections_expiry_idx')
      .on(table.expiresAt)
      .where(sql`expires_at is not null`),
  }),
);

// View: token expiry state for the accounts UI, so it can show "reconnection
// required" without ever reading the token. Originally ran with view-owner
// rights and an `app.is_workspace_member` predicate as the only access
// control on top of owner rights bypassing RLS on both underlying tables.
//
// That authorisation function is being dropped along with RLS. This view
// reproduces the SELECT/JOIN/CASE shape only — it does NOT reproduce the
// authorisation predicate, and it still never exposes ciphertext, scopes, or
// the encryption key id. Whoever queries this view from application code
// MUST filter to the caller's workspace itself, or it will return every
// workspace's token status.
// From: 0008_accounts.sql
export const connectedAccountTokenStatus = pgView('connected_account_token_status', {
  connectedAccountId: uuid('connected_account_id'),
  workspaceId: uuid('workspace_id'),
  platform: platformEnum('platform'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  refreshFailureCount: integer('refresh_failure_count'),
  canRefresh: boolean('can_refresh'),
  tokenState: text('token_state').$type<'unknown' | 'expired' | 'expiring_soon' | 'valid'>(),
}).as(sql`
  select
    c.id as connected_account_id,
    c.workspace_id,
    c.platform,
    o.expires_at,
    o.last_refreshed_at,
    o.refresh_failure_count,
    (o.refresh_token_encrypted is not null) as can_refresh,
    case
      when o.expires_at is null then 'unknown'
      when o.expires_at <= now() then 'expired'
      when o.expires_at <= now() + interval '7 days' then 'expiring_soon'
      else 'valid'
    end as token_state
  from connected_accounts c
  join oauth_connections o on o.connected_account_id = c.id
`);

// A named group of connected accounts, so publishing to "all Spanish
// accounts" is one action with the membership shown explicitly first. From:
// 0008_accounts.sql
export const accountGroups = pgTable(
  'account_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    groupingKind: text('grouping_kind').$type<
      'brand' | 'language' | 'country' | 'niche' | 'client' | 'campaign' | 'strategy'
    >(),
    description: text('description'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameLengthCheck: check(
      'account_groups_name_check',
      sql`length(trim(name)) between 1 and 120`,
    ),
    groupingKindCheck: check(
      'account_groups_grouping_kind_check',
      sql`grouping_kind in ('brand', 'language', 'country', 'niche', 'client', 'campaign', 'strategy')`,
    ),
    workspaceNameUnique: uniqueIndex('account_groups_workspace_id_name_key').on(
      table.workspaceId,
      table.name,
    ),
  }),
);

// Membership rows for an account group. From: 0008_accounts.sql
export const accountGroupMembers = pgTable(
  'account_group_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountGroupId: uuid('account_group_id')
      .notNull()
      .references(() => accountGroups.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    groupAccountUnique: uniqueIndex('account_group_members_account_group_id_connected_account_id_key').on(
      table.accountGroupId,
      table.connectedAccountId,
    ),
  }),
);

// Reference data: what each platform permits, per account kind (max
// duration, file size, supported ratios, whether it needs app review).
// Seeded by a later migration (0014) — seed data is out of scope here, only
// the table shape. From: 0008_accounts.sql
export const platformCapabilities = pgTable(
  'platform_capabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: platformEnum('platform').notNull(),
    accountKind: text('account_kind').notNull(),
    capability: text('capability').notNull(),
    isSupported: boolean('is_supported').notNull().default(false),
    requiresAppReview: boolean('requires_app_review').notNull().default(false),
    maxDurationSeconds: integer('max_duration_seconds'),
    maxFileSizeMb: integer('max_file_size_mb'),
    supportedRatios: aspectRatioEnum('supported_ratios').array().notNull().default([]),
    notes: text('notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    platformAccountCapabilityUnique: uniqueIndex(
      'platform_capabilities_platform_account_kind_capability_key',
    ).on(table.platform, table.accountKind, table.capability),
  }),
);

// Generated launch material (bio, names, content plan, manual checklist) for
// an account the user creates themselves on the platform — nothing here
// automates account creation. From: 0008_accounts.sql
export const accountLaunchKits = pgTable(
  'account_launch_kits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),

    targetPlatform: platformEnum('target_platform').notNull(),
    concept: text('concept'),
    suggestedNames: text('suggested_names').array().notNull().default([]),
    suggestedUsernames: text('suggested_usernames').array().notNull().default([]),
    bio: text('bio'),
    profileDescription: text('profile_description'),
    profileImageAssetId: uuid('profile_image_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    coverImageAssetId: uuid('cover_image_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    brandVoice: text('brand_voice'),
    audience: text('audience'),
    contentPillars: text('content_pillars').array().notNull().default([]),
    initialHooks: text('initial_hooks').array().notNull().default([]),
    // The 30-post plan and the human setup checklist.
    firstPosts: jsonb('first_posts').notNull().default([]),
    manualChecklist: jsonb('manual_checklist').notNull().default([]),

    origin: outputOriginEnum('origin').notNull().default('mock'),
    // Set once the user confirms they created the account themselves and
    // connected it. Never set by the system on the user's behalf.
    linkedAccountId: uuid('linked_account_id').references(() => connectedAccounts.id, {
      onDelete: 'set null',
    }),

    // Columns added by 0015_account_slots.sql (not 0008) — the launch-form
    // inputs that produced this kit, and the kit's own lifecycle.
    targetAudience: text('target_audience'),
    primaryLanguage: text('primary_language').notNull().default('en'),
    region: text('region'),
    objective: text('objective'),
    visualDirection: text('visual_direction'),
    postingFrequency: text('posting_frequency'),
    // SET NULL rather than CASCADE: deleting a campaign must not silently
    // destroy launch material a user may still be working from.
    initialCampaignId: uuid('initial_campaign_id').references(() => campaigns.id, {
      onDelete: 'set null',
    }),
    status: text('status')
      .notNull()
      .default('draft')
      .$type<'draft' | 'ready' | 'account_created' | 'connected' | 'archived'>(),

    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'account_launch_kits_status_check',
      sql`status in ('draft', 'ready', 'account_created', 'connected', 'archived')`,
    ),
    statusIdx: index('account_launch_kits_status_idx').on(table.workspaceId, table.status),
    campaignIdx: index('account_launch_kits_campaign_idx')
      .on(table.initialCampaignId)
      .where(sql`initial_campaign_id is not null`),
    // Referenced by account_slots' composite FK — see 0015_account_slots.sql.
    // Must be a unique CONSTRAINT, not a unique index — Postgres foreign
    // keys only accept the former as a reference target.
    idWorkspaceKey: unique('account_launch_kits_id_workspace_key').on(
      table.id,
      table.workspaceId,
    ),
  }),
);

// =============================================================================
// 0009_publishing.sql
// =============================================================================

// A confirmed batch-publish plan: cadence, windows, warnings shown to the
// user before anything is created. From: 0009_publishing.sql
export const publishingPlans = pgTable(
  'publishing_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),

    name: text('name'),
    // Confirmed counts, computed and shown to the user before anything is
    // created. Stored so the audit trail records what was approved.
    plannedPostCount: integer('planned_post_count').notNull().default(0),
    plannedAccountCount: integer('planned_account_count').notNull().default(0),
    estimatedUsageCredits: integer('estimated_usage_credits').notNull().default(0),

    cadence: text('cadence').$type<'asap' | 'daily' | 'weekdays' | 'custom' | 'even_spread'>(),
    postsPerDay: integer('posts_per_day'),
    timeWindows: jsonb('time_windows').notNull().default([]),
    timezone: text('timezone').notNull().default('UTC'),

    startsOn: date('starts_on'),
    endsOn: date('ends_on'),

    // Warnings surfaced at plan time: duplicate assets, repeated hooks,
    // frequency limits, capability mismatches.
    warnings: jsonb('warnings').notNull().default([]),

    status: text('status')
      .notNull()
      .default('draft')
      .$type<'draft' | 'previewed' | 'confirmed' | 'executing' | 'completed' | 'cancelled'>(),
    // Explicit confirmation of an expensive batch. Nothing executes without it.
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => user.id, { onDelete: 'set null' }),

    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    plannedPostCountCheck: check(
      'publishing_plans_planned_post_count_check',
      sql`planned_post_count >= 0`,
    ),
    plannedAccountCountCheck: check(
      'publishing_plans_planned_account_count_check',
      sql`planned_account_count >= 0`,
    ),
    estimatedUsageCreditsCheck: check(
      'publishing_plans_estimated_usage_credits_check',
      sql`estimated_usage_credits >= 0`,
    ),
    cadenceCheck: check(
      'publishing_plans_cadence_check',
      sql`cadence in ('asap', 'daily', 'weekdays', 'custom', 'even_spread')`,
    ),
    postsPerDayCheck: check(
      'publishing_plans_posts_per_day_check',
      sql`posts_per_day is null or posts_per_day > 0`,
    ),
    rangeCheck: check(
      'publishing_plans_range',
      sql`ends_on is null or starts_on is null or ends_on >= starts_on`,
    ),
    statusCheck: check(
      'publishing_plans_status_check',
      sql`status in ('draft', 'previewed', 'confirmed', 'executing', 'completed', 'cancelled')`,
    ),
    confirmationCompleteCheck: check(
      'publishing_plans_confirmation_complete',
      sql`(confirmed_at is null) = (confirmed_by is null)`,
    ),
  }),
);

// The intent: this content variant, to this account, at this time. Layer 1
// of duplicate-publish prevention via a unique constraint on
// (content_variant_id, connected_account_id, scheduled_for). From:
// 0009_publishing.sql
export const scheduledPosts = pgTable(
  'scheduled_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    publishingPlanId: uuid('publishing_plan_id').references(() => publishingPlans.id, {
      onDelete: 'set null',
    }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    contentVariantId: uuid('content_variant_id')
      .notNull()
      .references(() => contentVariants.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),

    platform: platformEnum('platform').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('UTC'),

    status: publishStatusEnum('status').notNull().default('draft'),

    caption: text('caption'),
    firstComment: text('first_comment'),
    // Platform-specific fields: YouTube title/category, TikTok privacy level,
    // Instagram collaborator tags — genuinely heterogeneous per platform.
    platformOptions: jsonb('platform_options').notNull().default({}),

    requiresApproval: boolean('requires_approval').notNull().default(true),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => user.id, { onDelete: 'set null' }),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    // The platform's own post id. Unique per account: the database refuses to
    // record the same remote post twice.
    externalPostId: text('external_post_id'),
    externalPermalink: text('external_permalink'),

    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Layer 1 of duplicate prevention.
    variantAccountScheduledUnique: uniqueIndex(
      'scheduled_posts_content_variant_id_connected_account_id_scheduled_for_key',
    ).on(table.contentVariantId, table.connectedAccountId, table.scheduledFor),
    approvalCompleteCheck: check(
      'scheduled_posts_approval_complete',
      sql`(approved_at is null) = (approved_by is null)`,
    ),
    // A published post must know where it went.
    publishedHasIdCheck: check(
      'scheduled_posts_published_has_id',
      sql`status <> 'published' or external_post_id is not null`,
    ),
    // Layer 3: one remote post per account, enforced by the database.
    externalUnique: uniqueIndex('scheduled_posts_external_unique')
      .on(table.connectedAccountId, table.externalPostId)
      .where(sql`external_post_id is not null`),
    // The calendar's primary query.
    calendarIdx: index('scheduled_posts_calendar_idx')
      .on(table.workspaceId, table.scheduledFor)
      .where(sql`cancelled_at is null`),
    statusIdx: index('scheduled_posts_status_idx')
      .on(table.status, table.scheduledFor)
      .where(sql`status in ('scheduled', 'queued', 'uploading', 'publishing')`),
    accountIdx: index('scheduled_posts_account_idx').on(
      table.connectedAccountId,
      desc(table.scheduledFor),
    ),
    awaitingApprovalIdx: index('scheduled_posts_awaiting_approval_idx')
      .on(table.workspaceId, table.scheduledFor)
      .where(sql`status = 'awaiting_review'`),
  }),
);

// The unit of publish work, separate from the scheduled post so a job can be
// retried, cancelled and audited without mutating the user's intent. Layer 2
// of duplicate-publish prevention via `idempotency_key`. From:
// 0009_publishing.sql
export const publishingJobs = pgTable(
  'publishing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scheduledPostId: uuid('scheduled_post_id')
      .notNull()
      .references(() => scheduledPosts.id, { onDelete: 'cascade' }),

    status: jobStatusEnum('status').notNull().default('pending'),
    // Originally `smallint`; modelled as integer, same 1-9 range check kept.
    priority: integer('priority').notNull().default(5),

    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),

    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Held by a worker while processing, with a lease so a crashed worker's
    // job becomes reclaimable instead of stuck in `running` forever.
    lockedBy: text('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    // Whether re-running is safe (e.g. a timeout after the upload began is
    // NOT safely retryable without checking the platform first).
    retrySafe: boolean('retry_safe').notNull().default(true),

    // Layer 2 of duplicate prevention.
    idempotencyKey: text('idempotency_key').notNull().unique(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    priorityCheck: check('publishing_jobs_priority_check', sql`priority between 1 and 9`),
    attemptsCheck: check('publishing_jobs_attempts_check', sql`attempts >= 0`),
    maxAttemptsCheck: check('publishing_jobs_max_attempts_check', sql`max_attempts >= 1`),
    attemptsBoundCheck: check(
      'publishing_jobs_attempts_bound',
      sql`attempts <= max_attempts + 1`,
    ),
    // The worker's claim query.
    claimableIdx: index('publishing_jobs_claimable_idx')
      .on(table.status, table.priority, table.runAfter)
      .where(sql`status in ('pending', 'queued')`),
    leaseIdx: index('publishing_jobs_lease_idx')
      .on(table.lockedUntil)
      .where(sql`locked_until is not null`),
    postIdx: index('publishing_jobs_post_idx').on(table.scheduledPostId),
  }),
);

// Append-only record of every real call to a platform for a publishing job —
// the audit trail a support investigation reads. From: 0009_publishing.sql
export const publishingAttempts = pgTable(
  'publishing_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    publishingJobId: uuid('publishing_job_id')
      .notNull()
      .references(() => publishingJobs.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: text('outcome')
      .notNull()
      .default('running')
      .$type<'running' | 'succeeded' | 'failed' | 'aborted' | 'skipped_duplicate'>(),

    httpStatus: integer('http_status'),
    platformErrorCode: text('platform_error_code'),
    platformErrorMessage: text('platform_error_message'),
    externalPostId: text('external_post_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    attemptNumberCheck: check(
      'publishing_attempts_attempt_number_check',
      sql`attempt_number >= 1`,
    ),
    outcomeCheck: check(
      'publishing_attempts_outcome_check',
      sql`outcome in ('running', 'succeeded', 'failed', 'aborted', 'skipped_duplicate')`,
    ),
    jobAttemptUnique: uniqueIndex('publishing_attempts_publishing_job_id_attempt_number_key').on(
      table.publishingJobId,
      table.attemptNumber,
    ),
    jobIdx: index('publishing_attempts_job_idx').on(
      table.publishingJobId,
      table.attemptNumber,
    ),
  }),
);

// =============================================================================
// 0010_analytics.sql
// =============================================================================

// Append-only, time-series metric snapshots for one published post at one
// captured hour — never a mutable running total, because platform counters
// can go down, arrive late, and be revised. From: 0010_analytics.sql
export const contentMetrics = pgTable(
  'content_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    scheduledPostId: uuid('scheduled_post_id')
      .notNull()
      .references(() => scheduledPosts.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    contentVariantId: uuid('content_variant_id').references(() => contentVariants.id, {
      onDelete: 'set null',
    }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    platform: platformEnum('platform').notNull(),

    // The moment the platform's figures describe, truncated to the hour.
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),

    // Nullable throughout — 0 would be a lie about a metric never reported.
    views: bigint('views', { mode: 'number' }),
    reach: bigint('reach', { mode: 'number' }),
    impressions: bigint('impressions', { mode: 'number' }),
    likes: bigint('likes', { mode: 'number' }),
    comments: bigint('comments', { mode: 'number' }),
    shares: bigint('shares', { mode: 'number' }),
    saves: bigint('saves', { mode: 'number' }),
    clicks: bigint('clicks', { mode: 'number' }),
    followersGained: integer('followers_gained'),
    // Basis points (1/100th of a percent) as an integer, not a float.
    engagementRateBp: integer('engagement_rate_bp'),
    completionRateBp: integer('completion_rate_bp'),
    averageWatchMs: integer('average_watch_ms'),
    threeSecondViews: bigint('three_second_views', { mode: 'number' }),

    // Retention curve as reported, when the platform provides one.
    retentionCurve: jsonb('retention_curve'),

    origin: outputOriginEnum('origin').notNull().default('provider'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    viewsCheck: check('content_metrics_views_check', sql`views is null or views >= 0`),
    reachCheck: check('content_metrics_reach_check', sql`reach is null or reach >= 0`),
    impressionsCheck: check(
      'content_metrics_impressions_check',
      sql`impressions is null or impressions >= 0`,
    ),
    likesCheck: check('content_metrics_likes_check', sql`likes is null or likes >= 0`),
    commentsCheck: check('content_metrics_comments_check', sql`comments is null or comments >= 0`),
    sharesCheck: check('content_metrics_shares_check', sql`shares is null or shares >= 0`),
    savesCheck: check('content_metrics_saves_check', sql`saves is null or saves >= 0`),
    clicksCheck: check('content_metrics_clicks_check', sql`clicks is null or clicks >= 0`),
    engagementRateBpCheck: check(
      'content_metrics_engagement_rate_bp_check',
      sql`engagement_rate_bp is null or engagement_rate_bp >= 0`,
    ),
    completionRateBpCheck: check(
      'content_metrics_completion_rate_bp_check',
      sql`completion_rate_bp is null or completion_rate_bp between 0 and 10000`,
    ),
    averageWatchMsCheck: check(
      'content_metrics_average_watch_ms_check',
      sql`average_watch_ms is null or average_watch_ms >= 0`,
    ),
    threeSecondViewsCheck: check(
      'content_metrics_three_second_views_check',
      sql`three_second_views is null or three_second_views >= 0`,
    ),
    // One snapshot per post per hour — a re-run of the metrics sync is
    // idempotent rather than inflating the series with duplicates.
    postCapturedUnique: uniqueIndex('content_metrics_scheduled_post_id_captured_at_key').on(
      table.scheduledPostId,
      table.capturedAt,
    ),
    postTimeIdx: index('content_metrics_post_time_idx').on(
      table.scheduledPostId,
      desc(table.capturedAt),
    ),
    workspaceTimeIdx: index('content_metrics_workspace_time_idx').on(
      table.workspaceId,
      desc(table.capturedAt),
    ),
    campaignIdx: index('content_metrics_campaign_idx').on(
      table.campaignId,
      desc(table.capturedAt),
    ),
    platformIdx: index('content_metrics_platform_idx').on(
      table.workspaceId,
      table.platform,
      desc(table.capturedAt),
    ),
  }),
);

// One daily snapshot per connected account — follower and reach counters as
// reported by the platform. From: 0010_analytics.sql
export const accountMetrics = pgTable(
  'account_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),

    capturedOn: date('captured_on').notNull(),

    followerCount: bigint('follower_count', { mode: 'number' }),
    followersGained: integer('followers_gained'),
    followersLost: integer('followers_lost'),
    profileViews: bigint('profile_views', { mode: 'number' }),
    reach: bigint('reach', { mode: 'number' }),
    impressions: bigint('impressions', { mode: 'number' }),
    totalViews: bigint('total_views', { mode: 'number' }),
    postsPublished: integer('posts_published'),

    origin: outputOriginEnum('origin').notNull().default('provider'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    followerCountCheck: check(
      'account_metrics_follower_count_check',
      sql`follower_count is null or follower_count >= 0`,
    ),
    postsPublishedCheck: check(
      'account_metrics_posts_published_check',
      sql`posts_published is null or posts_published >= 0`,
    ),
    accountDateUnique: uniqueIndex('account_metrics_connected_account_id_captured_on_key').on(
      table.connectedAccountId,
      table.capturedOn,
    ),
    accountDateIdx: index('account_metrics_account_date_idx').on(
      table.connectedAccountId,
      desc(table.capturedOn),
    ),
    workspaceDateIdx: index('account_metrics_workspace_date_idx').on(
      table.workspaceId,
      desc(table.capturedOn),
    ),
  }),
);

// Pre-aggregated per workspace/day/platform rollup the dashboard reads
// directly, instead of scanning raw snapshots at page-load time. Derivable
// from the tables above, so a corrupted rollup can be rebuilt. From:
// 0010_analytics.sql
export const analyticsDaily = pgTable(
  'analytics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    platform: platformEnum('platform'),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),

    views: bigint('views', { mode: 'number' }).notNull().default(0),
    reach: bigint('reach', { mode: 'number' }).notNull().default(0),
    engagements: bigint('engagements', { mode: 'number' }).notNull().default(0),
    followersGained: integer('followers_gained').notNull().default(0),
    postsPublished: integer('posts_published').notNull().default(0),
    // Averages stored as basis points, weighted by the worker at write time.
    avgCompletionBp: integer('avg_completion_bp'),
    avgEngagementBp: integer('avg_engagement_bp'),

    // Demo rows are rolled up separately so they can never contaminate a real
    // total.
    origin: outputOriginEnum('origin').notNull().default('provider'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceDayPlatformBrandOriginUnique: uniqueIndex(
      'analytics_daily_workspace_id_day_platform_brand_id_origin_key',
    ).on(table.workspaceId, table.day, table.platform, table.brandId, table.origin),
    workspaceDayIdx: index('analytics_daily_workspace_day_idx').on(
      table.workspaceId,
      desc(table.day),
    ),
  }),
);

// An A/B(/n) test over a variable (hook, thumbnail, posting time, ...) with
// an honest confidence vocabulary instead of a fabricated p-value. From:
// 0010_analytics.sql
export const experiments = pgTable(
  'experiments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    hypothesis: text('hypothesis'),
    variable: text('variable').notNull().$type<
      | 'hook'
      | 'first_frame'
      | 'duration'
      | 'caption'
      | 'cta'
      | 'thumbnail'
      | 'voice'
      | 'music'
      | 'platform'
      | 'account'
      | 'posting_time'
    >(),
    primaryMetric: text('primary_metric').notNull(),
    secondaryMetric: text('secondary_metric'),

    status: text('status')
      .notNull()
      .default('draft')
      .$type<'draft' | 'running' | 'paused' | 'concluded' | 'abandoned'>(),
    confidenceState: experimentConfidenceEnum('confidence_state').notNull().default('no_data'),
    // Prose, deliberately — a number here would be read as a guarantee.
    confidenceNotes: text('confidence_notes'),
    outcomeSummary: text('outcome_summary'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    minObservations: integer('min_observations'),
    concludedAt: timestamp('concluded_at', { withTimezone: true }),

    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    variableCheck: check(
      'experiments_variable_check',
      sql`variable in ('hook', 'first_frame', 'duration', 'caption', 'cta', 'thumbnail', 'voice', 'music', 'platform', 'account', 'posting_time')`,
    ),
    statusCheck: check(
      'experiments_status_check',
      sql`status in ('draft', 'running', 'paused', 'concluded', 'abandoned')`,
    ),
    minObservationsCheck: check(
      'experiments_min_observations_check',
      sql`min_observations is null or min_observations > 0`,
    ),
  }),
);

// One arm (variant) of an experiment. Exactly one control per experiment —
// a comparison without a baseline is not one. From: 0010_analytics.sql
export const experimentVariants = pgTable(
  'experiment_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experimentId: uuid('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contentVariantId: uuid('content_variant_id').references(() => contentVariants.id, {
      onDelete: 'set null',
    }),
    label: text('label').notNull(),
    isControl: boolean('is_control').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    experimentLabelUnique: uniqueIndex('experiment_variants_experiment_id_label_key').on(
      table.experimentId,
      table.label,
    ),
    oneControlIdx: uniqueIndex('experiment_variants_one_control')
      .on(table.experimentId)
      .where(sql`is_control`),
  }),
);

// A learning surfaced to the post-analytics screen, always citing the
// observations behind it — an insight with no evidence is rejected at the
// database level, never fabricated. From: 0010_analytics.sql
export const learningInsights = pgTable(
  'learning_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    contentVariantId: uuid('content_variant_id').references(() => contentVariants.id, {
      onDelete: 'set null',
    }),

    kind: text('kind').notNull().$type<'what_worked' | 'what_lost_attention' | 'what_to_test'>(),
    statement: text('statement').notNull(),
    // The observations this claim rests on: sample size, metric, comparison
    // basis.
    evidence: jsonb('evidence').notNull(),
    observationCount: integer('observation_count').notNull(),
    confidenceState: experimentConfidenceEnum('confidence_state').notNull().default('early_signal'),

    origin: outputOriginEnum('origin').notNull().default('mock'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'learning_insights_kind_check',
      sql`kind in ('what_worked', 'what_lost_attention', 'what_to_test')`,
    ),
    observationCountCheck: check(
      'learning_insights_observation_count_check',
      sql`observation_count >= 0`,
    ),
    // An insight with no observations behind it is a fabrication.
    needsEvidenceCheck: check(
      'learning_insights_needs_evidence',
      sql`observation_count > 0 and evidence <> '{}'::jsonb`,
    ),
    variantIdx: index('learning_insights_variant_idx').on(table.contentVariantId),
    campaignIdx: index('learning_insights_campaign_idx').on(table.campaignId),
  }),
);

// =============================================================================
// 0011_jobs_usage_audit.sql
// =============================================================================

// The generic job queue. Persisted in Postgres so the product works with no
// Redis configured; the database, not a queue, is the source of truth for
// "did this run". From: 0011_jobs_usage_audit.sql
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),

    type: text('type').notNull().$type<
      | 'campaign.plan'
      | 'content.script'
      | 'content.storyboard'
      | 'asset.image.generate'
      | 'asset.video.generate'
      | 'asset.voice.generate'
      | 'content.render'
      | 'content.transcode'
      | 'content.quality_check'
      | 'content.publish'
      | 'content.metrics.sync'
      | 'account.sync'
    >(),

    status: jobStatusEnum('status').notNull().default('pending'),
    // Originally `smallint`; modelled as integer, same range checks kept.
    priority: integer('priority').notNull().default(5),
    progress: integer('progress').notNull().default(0),

    payload: jsonb('payload').notNull().default({}),
    result: jsonb('result'),

    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),

    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    lockedBy: text('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    provider: text('provider'),
    externalJobId: text('external_job_id'),
    costCents: integer('cost_cents').notNull().default(0),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),

    // Every enqueue supplies one. Uniqueness makes "enqueue this batch again"
    // safe: the second call collides on existing rows instead of doubling
    // the work.
    idempotencyKey: text('idempotency_key').notNull().unique(),

    // Parent/child so a batch of 100 renders has one row to report progress on.
    parentJobId: uuid('parent_job_id').references((): AnyPgColumn => jobs.id, {
      onDelete: 'cascade',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    priorityCheck: check('jobs_priority_check', sql`priority between 1 and 9`),
    progressCheck: check('jobs_progress_check', sql`progress between 0 and 100`),
    attemptsCheck: check('jobs_attempts_check', sql`attempts >= 0`),
    maxAttemptsCheck: check('jobs_max_attempts_check', sql`max_attempts >= 1`),
    costCentsCheck: check('jobs_cost_cents_check', sql`cost_cents >= 0`),
    typeCheck: check(
      'jobs_type_check',
      sql`type in ('campaign.plan', 'content.script', 'content.storyboard', 'asset.image.generate', 'asset.video.generate', 'asset.voice.generate', 'content.render', 'content.transcode', 'content.quality_check', 'content.publish', 'content.metrics.sync', 'account.sync')`,
    ),
    claimableIdx: index('jobs_claimable_idx')
      .on(table.status, table.priority, table.runAfter)
      .where(sql`status in ('pending', 'queued')`),
    workspaceStatusIdx: index('jobs_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      desc(table.createdAt),
    ),
    leaseIdx: index('jobs_lease_idx').on(table.lockedUntil).where(sql`locked_until is not null`),
    parentIdx: index('jobs_parent_idx')
      .on(table.parentJobId)
      .where(sql`parent_job_id is not null`),
    externalIdx: index('jobs_external_idx')
      .on(table.provider, table.externalJobId)
      .where(sql`external_job_id is not null`),
  }),
);

// Append-only state-transition history for a job — separate from `jobs`
// because the job row holds current state while this holds history. From:
// 0011_jobs_usage_audit.sql
export const jobEvents = pgTable(
  'job_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fromStatus: jobStatusEnum('from_status'),
    toStatus: jobStatusEnum('to_status').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    jobIdx: index('job_events_job_idx').on(table.jobId, table.createdAt),
  }),
);

// The activity feed's raw event stream. A null actor means the system did
// it, rendered differently from a teammate action. From:
// 0011_jobs_usage_audit.sql
export const activityEvents = pgTable(
  'activity_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => user.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceTimeIdx: index('activity_events_workspace_time_idx').on(
      table.workspaceId,
      desc(table.createdAt),
    ),
  }),
);

// Per-user notifications (job completion, disconnected accounts, approvals,
// billing warnings). Strictly personal — the only mutation a user may make
// is marking one read. From: 0011_jobs_usage_audit.sql
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    kind: text('kind').notNull().$type<
      | 'job_completed'
      | 'job_failed'
      | 'account_disconnected'
      | 'approval_required'
      | 'publishing_completed'
      | 'publishing_failed'
      | 'usage_warning'
      | 'team_invitation'
      | 'analytics_insight'
    >(),
    title: text('title').notNull(),
    body: text('body'),
    linkPath: text('link_path'),
    metadata: jsonb('metadata').notNull().default({}),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'notifications_kind_check',
      sql`kind in ('job_completed', 'job_failed', 'account_disconnected', 'approval_required', 'publishing_completed', 'publishing_failed', 'usage_warning', 'team_invitation', 'analytics_insight')`,
    ),
    // Two indexes, deliberately: the partial one serves the unread badge
    // (the hot query), the full one serves the "read notifications too" case
    // that a partial index cannot satisfy.
    userUnreadIdx: index('notifications_user_unread_idx')
      .on(table.userId, desc(table.createdAt))
      .where(sql`read_at is null`),
    userIdx: index('notifications_user_idx').on(table.userId, desc(table.createdAt)),
  }),
);

// A review comment on content, optionally frame-anchored ("the cut at 0:04
// is early"). From: 0011_jobs_usage_audit.sql
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'cascade',
    }),
    contentVariantId: uuid('content_variant_id').references(() => contentVariants.id, {
      onDelete: 'cascade',
    }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    // Frame-anchored review notes.
    anchorFrame: integer('anchor_frame'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bodyCheck: check('comments_body_check', sql`length(trim(body)) > 0`),
    anchorFrameCheck: check(
      'comments_anchor_frame_check',
      sql`anchor_frame is null or anchor_frame >= 0`,
    ),
    itemIdx: index('comments_item_idx').on(table.contentItemId, table.createdAt),
    workspaceOpenIdx: index('comments_workspace_open_idx')
      .on(table.workspaceId)
      .where(sql`resolved_at is null`),
  }),
);

// A request for review/approval on a content item or scheduled post — the
// editor/reviewer split. From: 0011_jobs_usage_audit.sql
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'cascade',
    }),
    scheduledPostId: uuid('scheduled_post_id').references(() => scheduledPosts.id, {
      onDelete: 'cascade',
    }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedTo: uuid('assigned_to').references(() => user.id, { onDelete: 'set null' }),
    status: text('status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'approved' | 'rejected' | 'withdrawn'>(),
    decidedBy: uuid('decided_by').references(() => user.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusCheck: check(
      'approval_requests_status_check',
      sql`status in ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
    decisionCompleteCheck: check(
      'approval_requests_decision_complete',
      sql`(decided_at is null) = (decided_by is null)`,
    ),
    pendingIdx: index('approval_requests_pending_idx')
      .on(table.workspaceId, table.createdAt)
      .where(sql`status = 'pending'`),
  }),
);

// Append-only usage ledger — the balance is a SUM over this table, never a
// mutable counter, so a disputed charge can always be traced to what
// produced it. From: 0011_jobs_usage_audit.sql
export const usageEvents = pgTable(
  'usage_events',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),

    kind: text('kind').notNull().$type<
      | 'video_generated'
      | 'image_generated'
      | 'voice_generated'
      | 'render_minutes'
      | 'storage_bytes'
      | 'post_published'
      | 'account_connected'
      | 'transcription_minutes'
    >(),
    // Integer quantity in the unit's smallest sensible increment — never a
    // float.
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    unit: text('unit').notNull(),

    creditsDelta: integer('credits_delta').notNull().default(0),
    providerCostCents: integer('provider_cost_cents').notNull().default(0),

    generationRunId: uuid('generation_run_id').references(() => generationRuns.id, {
      onDelete: 'set null',
    }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),

    // Same key as the job that caused it, so a retried job cannot bill twice.
    idempotencyKey: text('idempotency_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check(
      'usage_events_kind_check',
      sql`kind in ('video_generated', 'image_generated', 'voice_generated', 'render_minutes', 'storage_bytes', 'post_published', 'account_connected', 'transcription_minutes')`,
    ),
    quantityCheck: check('usage_events_quantity_check', sql`quantity >= 0`),
    providerCostCentsCheck: check(
      'usage_events_provider_cost_cents_check',
      sql`provider_cost_cents >= 0`,
    ),
    idempotencyKindUnique: uniqueIndex('usage_events_idempotency_key_kind_key').on(
      table.idempotencyKey,
      table.kind,
    ),
    orgTimeIdx: index('usage_events_org_time_idx').on(
      table.organizationId,
      desc(table.occurredAt),
    ),
    kindIdx: index('usage_events_kind_idx').on(
      table.organizationId,
      table.kind,
      desc(table.occurredAt),
    ),
  }),
);

// Append-only credit ledger — positive for grants/top-ups, negative for
// consumption; the balance is the sum, so there is no stored balance to
// drift. From: 0011_jobs_usage_audit.sql
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    // The two `reservation_*` reasons were added for the generation reservation
    // flow (see src/lib/creative/credits.ts). The original six names are kept
    // verbatim rather than renamed to the brief's vocabulary — `plan_grant`
    // rather than `subscription_grant`, `expiry` rather than `expiration` —
    // because they are already written into a migrated CHECK constraint and any
    // rows behind it. Renaming buys nothing and costs a data migration.
    reason: text('reason').notNull().$type<
      | 'plan_grant'
      | 'top_up'
      | 'consumption'
      | 'refund'
      | 'adjustment'
      | 'expiry'
      // Credits withheld before a generation runs. Negative delta.
      | 'reservation_hold'
      // Unused portion of a hold returned once actual cost is known. Positive.
      | 'reservation_release'
    >(),
    usageEventId: bigint('usage_event_id', { mode: 'bigint' }).references(() => usageEvents.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reasonCheck: check(
      'credit_ledger_reason_check',
      sql`reason in ('plan_grant', 'top_up', 'consumption', 'refund', 'adjustment', 'expiry', 'reservation_hold', 'reservation_release')`,
    ),
    // A hold must be negative and a release positive. Without this, a sign error
    // in the reservation code mints credits instead of withholding them, and the
    // ledger — being append-only — has no way to notice.
    holdSignCheck: check(
      'credit_ledger_hold_sign_check',
      sql`(reason <> 'reservation_hold' or delta < 0) and (reason <> 'reservation_release' or delta > 0)`,
    ),
    orgIdx: index('credit_ledger_org_idx').on(table.organizationId, desc(table.occurredAt)),
  }),
);

// One row per organisation's billing subscription state. Feature-flagged: no
// Stripe configured still tracks usage, it simply does not charge for it.
// From: 0011_jobs_usage_audit.sql
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .unique()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('none').$type<'none' | 'stripe'>(),
    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id'),
    planCode: text('plan_code').notNull().default('free'),
    status: text('status')
      .notNull()
      .default('active')
      .$type<'active' | 'trialing' | 'past_due' | 'cancelled' | 'paused' | 'unconfigured'>(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    includedCredits: integer('included_credits').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    providerCheck: check('subscriptions_provider_check', sql`provider in ('none', 'stripe')`),
    statusCheck: check(
      'subscriptions_status_check',
      sql`status in ('active', 'trialing', 'past_due', 'cancelled', 'paused', 'unconfigured')`,
    ),
    includedCreditsCheck: check(
      'subscriptions_included_credits_check',
      sql`included_credits >= 0`,
    ),
  }),
);

// Append-only, never-deleted audit trail for security-relevant actions: who
// connected/disconnected an account, who approved and who published, who
// changed a role. From: 0011_jobs_usage_audit.sql
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').references(() => user.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),

    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),

    // Truncated at the application layer before insert — a full IP and user
    // agent are more personal data than an audit trail needs.
    ipPrefix: text('ip_prefix'),
    userAgentFamily: text('user_agent_family'),

    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgTimeIdx: index('audit_logs_org_time_idx').on(table.organizationId, desc(table.createdAt)),
    subjectIdx: index('audit_logs_subject_idx').on(table.subjectType, table.subjectId),
  }),
);

// Inbound platform/provider webhook callbacks, stored before processing so a
// replayed delivery is caught by the unique constraint instead of processed
// twice. From: 0011_jobs_usage_audit.sql
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    externalEventId: text('external_event_id'),
    eventType: text('event_type'),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Replay protection.
    sourceEventUnique: uniqueIndex('webhook_events_source_external_event_id_key').on(
      table.source,
      table.externalEventId,
    ),
    unprocessedIdx: index('webhook_events_unprocessed_idx')
      .on(table.receivedAt)
      .where(sql`processed_at is null`),
  }),
);
