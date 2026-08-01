// =============================================================================
// WORKFLOW ENGINE — definitions, runs, resolved steps, per-attempt step runs.
//
// Merged into schema.ts via `export * from "./schema.workflow"`.
//
// A workflow is the layer above `generation_runs` and `provider_runs`. Those two
// answer "what did one stage do" and "what did one vendor task do"; neither can
// answer "the user asked for Prompt → Images → Voice → Reel, we are three of
// four steps in, step two failed twice and succeeded on the third attempt".
// Reconstructing that from a bag of generation runs means inferring order from
// timestamps, which is wrong the moment two steps run concurrently.
//
// The four tables split along the axes that actually change independently:
//
//   workflow_definitions — the recipe: shipped template or a tenant's own
//   workflow_runs        — one execution of a recipe, with its own inputs
//   workflow_steps       — the recipe's steps MATERIALISED for that one run
//   workflow_step_runs   — one attempt at one of those steps
//
// The third exists because the definition's steps live in a jsonb spec that a
// user may edit or version at any time. If progress were tracked against that
// spec by index, editing a template would silently repoint every in-flight run
// at a different step. Materialising the steps at start freezes the plan for
// the life of the run.
//
// Isolation: every tenant table here carries organization_id and workspace_id
// and every query must filter on both. There is no RLS (see schema.fragment.ts
// header); the guard is application code.
// =============================================================================

import { desc, sql } from "drizzle-orm";
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
import { jobStatusEnum } from "./enums";
import { organizations, user, workspaces } from "./schema";
import { campaigns, contentItems, jobs } from "./schema.fragment";

// This file imports tables from ./schema and ./schema.fragment. Every
// cross-file reference below is wrapped in a lazy `() => table.column`
// accessor — Drizzle's documented pattern for circular/forward references.
// Do not add a top-level (non-lazy) use of an imported table here.

// =============================================================================
// Definitions
// =============================================================================

/**
 * A workflow recipe: either one Virally ships or one a tenant saved.
 *
 * Both live in one table because they are the same thing to the engine — a
 * starter that a run copies its steps from — and because the product's whole
 * path is "pick a shipped template, tweak it, save it as ours". Two tables
 * would make that a migration between types rather than an insert.
 *
 * `organization_id` null means a Virally-shipped template offered to everyone;
 * non-null means a tenant's own, visible to nobody else. `workspace_id` narrows
 * the same way one level down, so an agency can keep a per-client workflow out
 * of its other workspaces without giving up the org-wide ones.
 *
 * `steps_spec` is jsonb rather than a child table on purpose. A definition's
 * steps are only ever read as a whole, and never joined against — the queryable
 * copy is `workflow_steps`, written per run. Modelling the spec relationally
 * would buy nothing and cost a migration on every change to the step shape,
 * which the visual builder will make constantly.
 *
 * `version` is monotonic per slug and never rewritten in place: a run records
 * which definition it started from, and editing the row under it would make
 * historic runs claim they executed steps that did not exist at the time.
 */
export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for a shipped template. See header.
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),

    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").notNull().default(1),

    /**
     * The shipped template this derives from, when it derives from one.
     *
     * Free text rather than a self-FK: the source template can be withdrawn
     * from a future release while a tenant's copy of it must keep working and
     * must keep saying where it came from.
     */
    templateId: text("template_id"),

    /** Ordered `WorkflowStepSpec[]` — see src/lib/workflows/templates.ts. */
    stepsSpec: jsonb("steps_spec").notNull().default([]),
    /** Declared workflow inputs, keyed by name: `Record<string, WorkflowValueType>`. */
    inputsSpec: jsonb("inputs_spec").notNull().default({}),

    enabled: boolean("enabled").notNull().default(true),
    // Null for a shipped template, and for a tenant workflow whose author has
    // since been removed from the organisation.
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionCheck: check("workflow_definitions_version_check", sql`version >= 1`),
    // A tenant row must be attributable to a tenant on both axes. A workspace
    // without its organisation cannot be authorized against without a join the
    // guard code would have to remember to write.
    scopeCheck: check(
      "workflow_definitions_scope_check",
      sql`workspace_id is null or organization_id is not null`,
    ),
    // Two partial uniques rather than one composite: a plain UNIQUE over a
    // nullable column does not constrain the global template rows at all,
    // because NULL is never equal to NULL in Postgres, so every shipped
    // template could be inserted twice. Two indexes are what actually make
    // "one global template per slug, one tenant workflow per slug" enforceable.
    // Same reasoning as cost_configuration in schema.creative.ts.
    globalSlugUnique: uniqueIndex("workflow_definitions_global_slug_idx")
      .on(table.slug)
      .where(sql`organization_id is null`),
    orgSlugUnique: uniqueIndex("workflow_definitions_org_slug_idx")
      .on(table.organizationId, table.slug)
      .where(sql`organization_id is not null`),
    // Drives the template picker, which lists only what can be started.
    enabledIdx: index("workflow_definitions_enabled_idx")
      .on(table.organizationId)
      .where(sql`enabled`),
  }),
);

// =============================================================================
// Runs
// =============================================================================

/**
 * One execution of one definition.
 *
 * This is the row the user's progress UI reads and the row the credit
 * reservation is held against. It carries `total_steps` denormalised from the
 * materialised steps so "step 3 of 6" costs no join on a screen that polls.
 *
 * `campaign_id` and `content_item_id` are both nullable and both `set null`:
 * a workflow can be run standalone from the studio with no campaign behind it,
 * and deleting a campaign must not delete the record of what it cost to run.
 */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    // `restrict`, unlike the other references here: deleting a definition that
    // runs point at would orphan their step history with no way to say what
    // recipe produced it. Definitions are disabled, not deleted.
    workflowDefinitionId: uuid("workflow_definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "restrict" }),

    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),

    status: jobStatusEnum("status").notNull().default("pending"),

    /** Zero-based. Equals `total_steps` only once every step is terminal. */
    currentStepIndex: integer("current_step_index").notNull().default(0),
    totalSteps: integer("total_steps").notNull(),

    /** The values the run was started with, keyed by the definition's input names. */
    inputs: jsonb("inputs").notNull().default({}),
    /** Terminal outputs, keyed by step key. Written as each step completes. */
    outputs: jsonb("outputs").notNull().default({}),

    estimatedCredits: integer("estimated_credits").notNull().default(0),
    /**
     * Null until the run is terminal.
     *
     * Distinguishing "cost nothing" from "cost not yet known" is what makes the
     * reservation refund correct — a zero here would tell the sweeper the run
     * was free and release the whole reservation mid-flight.
     */
    actualCredits: integer("actual_credits"),

    /**
     * Supplied by the caller on every start.
     *
     * Unique per workspace, which is what makes "the user double-clicked Run"
     * cost one workflow instead of two — and a workflow is many provider tasks,
     * so the duplicate is far more expensive here than at the provider layer.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    currentStepCheck: check("workflow_runs_current_step_check", sql`current_step_index >= 0`),
    // A run with no steps is not a run. Rejected at write time rather than
    // producing a progress bar that divides by zero.
    totalStepsCheck: check("workflow_runs_total_steps_check", sql`total_steps > 0`),
    stepBoundsCheck: check(
      "workflow_runs_step_bounds_check",
      sql`current_step_index <= total_steps`,
    ),
    estimatedCreditsCheck: check(
      "workflow_runs_estimated_credits_check",
      sql`estimated_credits >= 0`,
    ),
    actualCreditsCheck: check(
      "workflow_runs_actual_credits_check",
      sql`actual_credits is null or actual_credits >= 0`,
    ),
    // Mirrors provider_runs_completed_at_check. Without it, "still running" and
    // "finished, timestamp never written" are indistinguishable, and the
    // reservation sweeper cannot tell which reservations are safe to release.
    completedAtCheck: check(
      "workflow_runs_completed_at_check",
      sql`(status in ('completed', 'failed', 'cancelled', 'dead_letter')) = (completed_at is not null)`,
    ),
    // The idempotency guarantee. A repeated start collides here instead of
    // launching a second billable workflow.
    idempotencyUnique: unique("workflow_runs_idempotency_key_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    workspaceIdx: index("workflow_runs_workspace_idx").on(
      table.workspaceId,
      desc(table.createdAt),
    ),
    // Drives the scheduler: which runs still need work claimed for them.
    pendingIdx: index("workflow_runs_pending_idx")
      .on(table.status, table.createdAt)
      .where(sql`status in ('pending', 'queued', 'running', 'waiting_external')`),
    definitionIdx: index("workflow_runs_definition_idx").on(table.workflowDefinitionId),
  }),
);

/**
 * The frozen, ordered steps of ONE run — not of a definition.
 *
 * The definition's steps live in its jsonb spec and can be edited or versioned
 * under an in-flight run at any moment. These rows are the copy taken at start,
 * which is what lets each step be retried, skipped and progressed independently
 * without the engine re-reading a spec that may have changed shape since.
 *
 * Nothing here records an outcome. A step that failed twice and then succeeded
 * has one row here and three in `workflow_step_runs`; putting a status on this
 * table would force the third attempt to overwrite the evidence of the first
 * two, which is exactly what makes a retry loop impossible to debug.
 */
export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    // Denormalised from the run so a step query filters on tenancy without a
    // join, matching the rule that every query filters on the workspace.
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    /** Execution order, zero-based, already topologically resolved. */
    position: integer("position").notNull(),
    /**
     * The step's key from the spec.
     *
     * Stable across versions of the definition, unlike `position`, which shifts
     * whenever a step is inserted. Everything that refers to a step — dependency
     * edges, the outputs map on the run — refers to it by key for that reason.
     */
    key: text("key").notNull(),

    /** `WorkflowStepKind` — see src/lib/workflows/templates.ts. */
    kind: text("kind").notNull(),
    /**
     * `GenerationCapability`, for the steps that call a model.
     *
     * Null for the steps that do not — compose, render, validate and export run
     * inside Virally and have no provider capability to route on. Recorded here
     * rather than derived from `kind` because the consent gate reads it, and
     * "lip-sync needs confirmed authorization" must not depend on a mapping a
     * future kind could quietly fall outside of.
     */
    capability: text("capability"),
    label: text("label").notNull(),

    /** Per-step configuration resolved from the spec at start. */
    inputsSpec: jsonb("inputs_spec").notNull().default({}),
    /** Step keys that must be terminal before this one may be claimed. */
    dependsOn: jsonb("depends_on").notNull().default([]),
    /** A failure here does not fail the run. Captions on a reel, not the reel. */
    optional: boolean("optional").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    positionCheck: check("workflow_steps_position_check", sql`position >= 0`),
    kindCheck: check(
      "workflow_steps_kind_check",
      sql`kind in ('generate_image', 'generate_video', 'generate_audio', 'generate_lipsync', 'upscale', 'language', 'compose', 'render', 'validate', 'export')`,
    ),
    dependsOnCheck: check(
      "workflow_steps_depends_on_check",
      sql`jsonb_typeof(depends_on) = 'array'`,
    ),
    // Two rows cannot claim the same slot in the plan; without this a partial
    // re-materialisation would produce a run whose order is decided by the
    // planner's choice of row ordering.
    runPositionUnique: unique("workflow_steps_run_position_unique").on(
      table.workflowRunId,
      table.position,
    ),
    // Keys are what dependency edges and the run's outputs map resolve against,
    // so a duplicate makes a wiring ambiguous rather than merely untidy.
    runKeyUnique: unique("workflow_steps_run_key_unique").on(table.workflowRunId, table.key),
    runIdx: index("workflow_steps_run_idx").on(table.workflowRunId, table.position),
  }),
);

/**
 * One ATTEMPT at one step.
 *
 * Separate from `workflow_steps` for exactly the reason `provider_runs` is
 * separate from `generation_runs`: a step can be retried independently, and
 * each attempt has its own provider, model, cost and outcome. Collapsing the
 * two would make the second attempt overwrite the first's failure code, its
 * provider and its bill — and the bill is real whether or not the attempt
 * produced anything usable, so a run's true cost is the sum of these rows, not
 * of its steps.
 */
export const workflowStepRuns = pgTable(
  "workflow_step_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowStepId: uuid("workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    // Carried alongside the step so the run-level status roll-up — the query
    // the progress UI polls — never joins through workflow_steps.
    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    /** 1-based. The first try is attempt 1, not attempt 0. */
    attempt: integer("attempt").notNull().default(1),
    status: jobStatusEnum("status").notNull().default("pending"),

    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    /**
     * The provider run this attempt drove, when it drove one. NO foreign key.
     *
     * `provider_runs` lives in schema.creative.ts and is subject to its own
     * retention: vendor payloads and prompts are purged long before a workflow's
     * cost history stops mattering. An FK would either block that purge or,
     * with `set null`, erase the only pointer explaining a charge that still
     * appears on the run's total. An unresolvable id is the honest outcome.
     */
    providerRunId: uuid("provider_run_id"),
    /**
     * Free text, and null for the steps that call no vendor.
     *
     * Not an FK to `generation_providers` for the same reason `provider_runs`
     * stores its model as text: a provider or model can be retired while a
     * historic attempt must still say what actually ran.
     */
    providerId: text("provider_id"),
    modelId: text("model_id"),

    /** The resolved inputs this attempt was submitted with, after wiring. */
    inputs: jsonb("inputs").notNull().default({}),
    /** The step's declared outputs, keyed by output name. Null until terminal. */
    output: jsonb("output"),
    /** Media ingested into Virally storage. Populated at `completed`, never before. */
    outputAssetIds: jsonb("output_asset_ids").notNull().default([]),

    /** Internal cost of this attempt alone, including a failed one. */
    costCents: integer("cost_cents").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),

    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    attemptCheck: check("workflow_step_runs_attempt_check", sql`attempt >= 1`),
    costCheck: check("workflow_step_runs_cost_check", sql`cost_cents >= 0`),
    creditsCheck: check("workflow_step_runs_credits_check", sql`credits_charged >= 0`),
    // The retry guarantee: a re-claim of the same step at the same attempt
    // number collides here instead of submitting a second billable task.
    stepAttemptUnique: unique("workflow_step_runs_step_attempt_unique").on(
      table.workflowStepId,
      table.attempt,
    ),
    // The roll-up the engine runs after every state change: is this run's
    // current wave finished, and did anything in it fail.
    runStatusIdx: index("workflow_step_runs_run_status_idx").on(table.workflowRunId, table.status),
    workspaceIdx: index("workflow_step_runs_workspace_idx").on(
      table.workspaceId,
      desc(table.createdAt),
    ),
    // Reconciling a provider invoice back to the workflow that incurred it.
    providerRunIdx: index("workflow_step_runs_provider_run_idx")
      .on(table.providerRunId)
      .where(sql`provider_run_id is not null`),
  }),
);
