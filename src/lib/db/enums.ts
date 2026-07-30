/**
 * All Postgres enums, in one module with no dependency on schema.ts or
 * schema.fragment.ts.
 *
 * schema.ts and schema.fragment.ts import tables back and forth from each
 * other (a circular import that's safe ONLY because every cross-file table
 * reference is wrapped in a lazy `() => table.column` callback — see each
 * file's header). Enum values used directly inside a `pgTable`/`pgView`
 * column definition are NOT lazy — they're read the instant the module
 * loads — so an enum sitting inside that cycle breaks it for real ("Cannot
 * access 'x' before initialization"). Pulling every enum out to a leaf module
 * both files can import without pulling each other in fixes that permanently.
 */

import { pgEnum } from "drizzle-orm/pg-core";

// supabase/migrations/0001_foundation.sql
export const memberRoleEnum = pgEnum("member_role", [
  "viewer",
  "analyst",
  "reviewer",
  "publisher",
  "editor",
  "strategist",
  "admin",
  "owner",
]);

export const permissionEnum = pgEnum("permission", [
  "content.create",
  "content.approve",
  "content.publish",
  "content.delete",
  "campaign.manage",
  "accounts.connect",
  "accounts.disconnect",
  "analytics.view",
  "billing.view",
  "billing.manage",
  "team.manage",
  "workspace.manage",
  "assets.delete",
]);

export const platformEnum = pgEnum("platform", ["instagram", "facebook", "tiktok", "youtube"]);

export const aspectRatioEnum = pgEnum("aspect_ratio", [
  "9:16",
  "4:5",
  "1:1",
  "16:9",
  "4:3",
  "3:2",
  "custom",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "draft",
  "awaiting_review",
  "approved",
  "rejected",
  "archived",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "queued",
  "running",
  "waiting_external",
  "completed",
  "failed",
  "cancelled",
  "dead_letter",
]);

export const publishStatusEnum = pgEnum("publish_status", [
  "draft",
  "awaiting_review",
  "approved",
  "scheduled",
  "queued",
  "uploading",
  "publishing",
  "published",
  "failed",
  "cancelled",
]);

export const connectionHealthEnum = pgEnum("connection_health", [
  "healthy",
  "expired",
  "limited",
  "rate_limited",
  "failing",
  "disconnected",
]);

export const assetKindEnum = pgEnum("asset_kind", [
  "source_video",
  "generated_video",
  "image",
  "generated_image",
  "audio",
  "voiceover",
  "music",
  "thumbnail",
  "document",
  "brand_asset",
  "export",
]);

export const outputOriginEnum = pgEnum("output_origin", [
  "provider",
  "mock",
  "user_upload",
  "seeded_demo",
]);

// supabase/migrations/0015_account_slots.sql
export const accountSlotStatusEnum = pgEnum("account_slot_status", [
  "planning",
  "launch_kit_ready",
  "awaiting_manual_creation",
  "awaiting_connection",
  "connecting",
  "connected",
  "limited_permissions",
  "reconnection_required",
  "suspended_by_user",
  "disconnected",
  "archived",
]);

// supabase/migrations/0005_campaigns.sql
export const campaignStageEnum = pgEnum("campaign_stage", [
  "brief",
  "concepts",
  "scripts",
  "storyboards",
  "assets",
  "editing",
  "approval",
  "schedule",
  "publish",
  "learn",
]);

export const stageStateEnum = pgEnum("stage_state", [
  "pending",
  "active",
  "complete",
  "blocked",
  "skipped",
]);

export const generationModeEnum = pgEnum("generation_mode", [
  "quick",
  "campaign",
  "repurpose",
  "product",
  "account_launch",
  "batch_studio",
]);

// supabase/migrations/0010_analytics.sql
export const experimentConfidenceEnum = pgEnum("experiment_confidence", [
  "no_data",
  "early_signal",
  "inconclusive",
  "promising",
  "enough_observations",
]);
