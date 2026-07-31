// =============================================================================
// CREATIVE GENERATION — provider catalogue, provider runs, production modes.
//
// Merged into schema.ts via `export * from "./schema.creative"`.
//
// This file adds what the existing schema does not already model. It does NOT
// redefine `generation_runs` or `jobs`, which already exist in
// schema.fragment.ts and remain the durable record of what ran and what is
// queued. The relationship is:
//
//   jobs             — the unit of work the queue claims and retries
//   generation_runs  — one attempt at one stage, provider-agnostic
//   provider_runs    — the provider-specific detail of a single external task
//
// The third exists because `generation_runs` deliberately has no room for
// prompts, negative prompts, requested resolutions or provider credit figures,
// and widening it would put per-vendor columns on the table every stage writes
// to — including the language stages, which have none of those fields.
//
// Isolation: every table here carries organization_id and workspace_id and
// every query must filter on both. There is no RLS (see schema.fragment.ts
// header); the guard is application code.
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
import { organizations, workspaces } from "./schema";
import { generationRuns, jobs, mediaAssets } from "./schema.fragment";

// This file imports tables from ./schema and ./schema.fragment. Every
// cross-file reference below is wrapped in a lazy `() => table.column`
// accessor — Drizzle's documented pattern for circular/forward references.
// Do not add a top-level (non-lazy) use of an imported table here.

// =============================================================================
// Provider catalogue
// =============================================================================

/**
 * One row per generation vendor. Seeded, not user-created.
 *
 * Exists so the router's provider list, per-workspace preferences and cost
 * reporting all reference the same identifier, and so a provider can be
 * disabled operationally without a deploy.
 */
export const generationProviders = pgTable(
  "generation_providers",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    // Whether the deployment will route to it at all. A provider with a valid
    // key can still be switched off here during an incident.
    enabled: boolean("enabled").notNull().default(true),
    // Name of the env var that configures it. Rendered in the settings UI so an
    // operator is told which variable to set. Never the value.
    credentialEnvVar: text("credential_env_var").notNull(),
    // Requests per minute Virally will send. The worker's own limiter reads
    // this; it is not a claim about the provider's published limit.
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
    docsUrl: text("docs_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    rateLimitCheck: check(
      "generation_providers_rate_limit_check",
      sql`rate_limit_per_minute > 0`,
    ),
  }),
);

/**
 * A model offered by a provider, with the cost basis used to quote it.
 *
 * `estimated_cents_per_unit` is our configured estimate, never a provider
 * quote — Magnific returns no price at submit time. `cost_basis` records which
 * it is, so the estimator UI cannot present a local guess as a vendor figure.
 */
export const generationModels = pgTable(
  "generation_models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => generationProviders.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    kind: text("kind").notNull().$type<"image" | "video" | "audio">(),
    // Exact POST path at the provider. Stored rather than derived: provider
    // paths are not uniform and a constructed one would be wrong for most.
    endpointPath: text("endpoint_path").notNull(),
    // Durations the model accepts, in seconds. Empty array = continuous.
    allowedDurations: jsonb("allowed_durations").notNull().default([]),
    // Aspect ratios in Virally's vocabulary, not the provider's.
    supportedRatios: jsonb("supported_ratios").notNull().default([]),
    estimatedCentsPerUnit: integer("estimated_cents_per_unit").notNull(),
    costBasis: text("cost_basis")
      .notNull()
      .default("configured_table")
      .$type<"provider_quote" | "configured_table">(),
    // Production modes this model may serve.
    modes: jsonb("modes").notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindCheck: check("generation_models_kind_check", sql`kind in ('image', 'video', 'audio')`),
    costBasisCheck: check(
      "generation_models_cost_basis_check",
      sql`cost_basis in ('provider_quote', 'configured_table')`,
    ),
    costCheck: check("generation_models_cost_check", sql`estimated_cents_per_unit >= 0`),
    providerKindIdx: index("generation_models_provider_kind_idx").on(table.providerId, table.kind),
  }),
);

// =============================================================================
// Provider runs
// =============================================================================

/**
 * One external provider task, with everything the brief requires recorded.
 *
 * Separate from `generation_runs` because this is vendor-specific detail: the
 * exact prompt sent, the resolution asked for, the provider's own credit
 * figure. `generation_runs` stays the provider-agnostic record every stage
 * writes, including stages that have none of these fields.
 *
 * `state` is a superset of `job_status` and intentionally its own text column
 * rather than the shared enum: it carries `downloading`, which exists only
 * here. That state is what enforces the rule that nothing is reported complete
 * until the bytes are in Virally storage — a job status enum shared with
 * publishing and metrics jobs has no business carrying it.
 */
export const providerRuns = pgTable(
  "provider_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    // The provider-agnostic run this belongs to, when there is one.
    generationRunId: uuid("generation_run_id").references(() => generationRuns.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),

    providerId: text("provider_id")
      .notNull()
      .references(() => generationProviders.id, { onDelete: "restrict" }),
    // Free text rather than an FK: a model can be retired from the catalogue
    // while historic runs must still say what actually produced their output.
    model: text("model").notNull(),

    generationType: text("generation_type").notNull().$type<"image" | "video" | "audio">(),

    // --- What was asked for -------------------------------------------------
    inputPrompt: text("input_prompt").notNull(),
    negativePrompt: text("negative_prompt"),
    // Assets fed in as references (first frame, style, structure).
    inputAssetIds: jsonb("input_asset_ids").notNull().default([]),
    requestedDurationSeconds: integer("requested_duration_seconds"),
    requestedResolution: text("requested_resolution"),
    requestedAspectRatio: text("requested_aspect_ratio"),

    // --- What happened ------------------------------------------------------
    externalTaskId: text("external_task_id"),
    state: text("state").notNull().default("planned").$type<
      | "planned"
      | "queued"
      | "submitted"
      | "generating"
      | "downloading"
      | "completed"
      | "failed"
      | "cancelled"
    >(),
    // 0-100 when the provider reports it. Null means genuinely unknown, and the
    // UI must render an indeterminate indicator rather than invent a number.
    progress: integer("progress"),

    // --- Money --------------------------------------------------------------
    // What the provider says it charged, in its own credit unit. Null until
    // reconciliation; Magnific does not report it on the generation call.
    providerCredits: integer("provider_credits"),
    estimatedInternalCents: integer("estimated_internal_cents").notNull().default(0),
    // Null until the run is terminal. Distinguishing "cost nothing" from "cost
    // not yet known" is what makes the reservation refund correct.
    actualInternalCents: integer("actual_internal_cents"),

    // --- Outcome ------------------------------------------------------------
    // Media ingested into Virally storage. Populated at `completed`, never
    // before — a provider URL is not an asset.
    outputAssetIds: jsonb("output_asset_ids").notNull().default([]),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    attemptCount: integer("attempt_count").notNull().default(0),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /**
     * Supplied by the caller on every submit.
     *
     * Unique per workspace, which is what makes "the user double-clicked
     * Generate" cost one provider task instead of two. Scoped to the workspace
     * rather than globally so two tenants cannot collide on a key either of
     * them chose.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stateCheck: check(
      "provider_runs_state_check",
      sql`state in ('planned', 'queued', 'submitted', 'generating', 'downloading', 'completed', 'failed', 'cancelled')`,
    ),
    typeCheck: check(
      "provider_runs_generation_type_check",
      sql`generation_type in ('image', 'video', 'audio')`,
    ),
    progressCheck: check(
      "provider_runs_progress_check",
      sql`progress is null or progress between 0 and 100`,
    ),
    attemptCheck: check("provider_runs_attempt_check", sql`attempt_count >= 0`),
    estimatedCheck: check(
      "provider_runs_estimated_check",
      sql`estimated_internal_cents >= 0`,
    ),
    actualCheck: check(
      "provider_runs_actual_check",
      sql`actual_internal_cents is null or actual_internal_cents >= 0`,
    ),
    // A terminal run must say when it finished. Without this, "still running"
    // and "finished, timestamp never written" are indistinguishable, and the
    // reservation sweeper cannot tell which reservations are safe to release.
    completedAtCheck: check(
      "provider_runs_completed_at_check",
      sql`(state in ('completed', 'failed', 'cancelled')) = (completed_at is not null)`,
    ),
    // The idempotency guarantee. A repeated submit collides here instead of
    // creating a second billable provider task.
    idempotencyUnique: unique("provider_runs_idempotency_key_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    // One row per external task per provider, so a webhook can resolve its
    // target unambiguously.
    externalTaskUnique: uniqueIndex("provider_runs_external_task_idx")
      .on(table.providerId, table.externalTaskId)
      .where(sql`external_task_id is not null`),
    // Drives the poller: which runs are still awaiting a provider result.
    pendingIdx: index("provider_runs_pending_idx")
      .on(table.state, table.createdAt)
      .where(sql`state in ('queued', 'submitted', 'generating', 'downloading')`),
    workspaceIdx: index("provider_runs_workspace_idx").on(
      table.workspaceId,
      desc(table.createdAt),
    ),
    runIdx: index("provider_runs_generation_run_idx").on(table.generationRunId),
  }),
);

/**
 * Media a provider produced, before and after ingestion.
 *
 * Separate from `provider_runs` because one task can return several files, and
 * separate from `media_assets` because a provider URL is not an asset —
 * `media_asset_id` stays null until the bytes are copied into Virally storage.
 * That null is the machine-checkable form of the rule that a temporary provider
 * URL is never authoritative.
 */
export const providerRunOutputs = pgTable(
  "provider_run_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerRunId: uuid("provider_run_id")
      .notNull()
      .references(() => providerRuns.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /**
     * The provider's temporary URL. Expires.
     *
     * Kept only for the download step and for diagnosing a failed ingestion.
     * Nothing may serve it to a user or treat it as an asset location.
     */
    sourceUrl: text("source_url").notNull(),
    sourceUrlExpiresAt: timestamp("source_url_expires_at", { withTimezone: true }),
    // Null until ingestion succeeds. Its presence is what makes the run
    // completable.
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, {
      onDelete: "set null",
    }),
    // Populated by FFmpeg after download, not guessed from the URL extension.
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    checksumSha256: text("checksum_sha256"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    positionCheck: check("provider_run_outputs_position_check", sql`position >= 0`),
    byteSizeCheck: check(
      "provider_run_outputs_byte_size_check",
      sql`byte_size is null or byte_size >= 0`,
    ),
    // An ingested output must have an asset, and an asset implies ingestion.
    ingestedCheck: check(
      "provider_run_outputs_ingested_check",
      sql`(media_asset_id is not null) = (ingested_at is not null)`,
    ),
    runPositionUnique: unique("provider_run_outputs_run_position_unique").on(
      table.providerRunId,
      table.position,
    ),
    pendingIdx: index("provider_run_outputs_pending_idx")
      .on(table.providerRunId)
      .where(sql`media_asset_id is null`),
  }),
);

// =============================================================================
// Production modes and cost configuration
// =============================================================================

/**
 * Fast / Hybrid / Cinematic, as data.
 *
 * The brief is explicit that these numbers must not be scattered as constants
 * through the application, because they are business settings that change
 * without a deploy. Seeded from src/lib/creative/modes.ts, which holds the
 * defaults and is the fallback when the table has not been seeded yet.
 */
export const productionModes = pgTable(
  "production_modes",
  {
    id: text("id").primaryKey().$type<"fast" | "hybrid" | "cinematic">(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    position: integer("position").notNull().default(0),

    /** What the user is charged, in Virally Production Credits. */
    productionCredits: integer("production_credits").notNull(),

    /**
     * Target internal cost band, in integer cents.
     *
     * A band rather than a figure because the real cost varies with clip count
     * and model. It is a margin guard rail for reporting, not a quote.
     */
    targetCostCentsLow: integer("target_cost_cents_low").notNull(),
    targetCostCentsHigh: integer("target_cost_cents_high").notNull(),

    /** Composition shape: how many generated clips this mode budgets for. */
    aiVideoClipsMin: integer("ai_video_clips_min").notNull().default(0),
    aiVideoClipsMax: integer("ai_video_clips_max").notNull().default(0),
    generatedImagesTypical: integer("generated_images_typical").notNull().default(0),
    /** Free regenerations included before further credits are charged. */
    regenerationAllowance: integer("regeneration_allowance").notNull().default(0),

    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    idCheck: check("production_modes_id_check", sql`id in ('fast', 'hybrid', 'cinematic')`),
    creditsCheck: check("production_modes_credits_check", sql`production_credits > 0`),
    bandCheck: check(
      "production_modes_band_check",
      sql`target_cost_cents_low >= 0 and target_cost_cents_high >= target_cost_cents_low`,
    ),
    clipsCheck: check(
      "production_modes_clips_check",
      sql`ai_video_clips_min >= 0 and ai_video_clips_max >= ai_video_clips_min`,
    ),
  }),
);

/**
 * Tunable pricing and policy values, one row per key.
 *
 * A key/value table rather than columns because these are operational settings
 * read by name at runtime, and adding one should not require a migration. Typed
 * by `value_type` so a reader can fail loudly on a malformed value instead of
 * silently coercing "abc" to 0.
 *
 * Scoped nullably to an organisation: a null `organization_id` is the global
 * default, and a row with one is that tenant's override.
 */
export const costConfiguration = pgTable(
  "cost_configuration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    valueType: text("value_type").notNull().default("integer").$type<
      "integer" | "decimal" | "boolean" | "string" | "json"
    >(),
    description: text("description").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    valueTypeCheck: check(
      "cost_configuration_value_type_check",
      sql`value_type in ('integer', 'decimal', 'boolean', 'string', 'json')`,
    ),
    // Partial uniques rather than one composite: a plain UNIQUE over a nullable
    // column does not constrain the global rows at all, because NULL is never
    // equal to NULL in Postgres. Two indexes are what actually make "one global
    // default per key" enforceable.
    globalKeyUnique: uniqueIndex("cost_configuration_global_key_idx")
      .on(table.key)
      .where(sql`organization_id is null`),
    orgKeyUnique: uniqueIndex("cost_configuration_org_key_idx")
      .on(table.organizationId, table.key)
      .where(sql`organization_id is not null`),
  }),
);
