// Scalar types shared across the app. Used to be generated from the Supabase
// project (`supabase gen types typescript`); now hand-kept in sync with the
// Drizzle enums in src/lib/db/schema.ts, which is the source of truth.
//
// The giant generated `Database` (PostgREST table-shape) type that used to
// live here is gone — nothing needs it once query results come from Drizzle,
// which infers row types directly from the schema (`typeof table.$inferSelect`).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AccountSlotStatus =
  | "planning"
  | "launch_kit_ready"
  | "awaiting_manual_creation"
  | "awaiting_connection"
  | "connecting"
  | "connected"
  | "limited_permissions"
  | "reconnection_required"
  | "suspended_by_user"
  | "disconnected"
  | "archived";

export type AspectRatio = "9:16" | "4:5" | "1:1" | "16:9" | "4:3" | "3:2" | "custom";

export type AssetKind =
  | "source_video"
  | "generated_video"
  | "image"
  | "generated_image"
  | "audio"
  | "voiceover"
  | "music"
  | "thumbnail"
  | "document"
  | "brand_asset"
  | "export";

export type CampaignStage =
  | "brief"
  | "concepts"
  | "scripts"
  | "storyboards"
  | "assets"
  | "editing"
  | "approval"
  | "schedule"
  | "publish"
  | "learn";

export type ConnectionHealth =
  | "healthy"
  | "expired"
  | "limited"
  | "rate_limited"
  | "failing"
  | "disconnected";

export type ExperimentConfidence =
  | "no_data"
  | "early_signal"
  | "inconclusive"
  | "promising"
  | "enough_observations";

export type GenerationMode =
  | "quick"
  | "campaign"
  | "repurpose"
  | "product"
  | "account_launch"
  | "batch_studio";

export type JobStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_external"
  | "completed"
  | "failed"
  | "cancelled"
  | "dead_letter";

export type MemberRole =
  | "viewer"
  | "analyst"
  | "reviewer"
  | "publisher"
  | "editor"
  | "strategist"
  | "admin"
  | "owner";

export type OutputOrigin = "provider" | "mock" | "user_upload" | "seeded_demo";

export type Permission =
  | "content.create"
  | "content.approve"
  | "content.publish"
  | "content.delete"
  | "campaign.manage"
  | "accounts.connect"
  | "accounts.disconnect"
  | "analytics.view"
  | "billing.view"
  | "billing.manage"
  | "team.manage"
  | "workspace.manage"
  | "assets.delete";

export type Platform = "instagram" | "facebook" | "tiktok" | "youtube";

export type PublishStatus =
  | "draft"
  | "awaiting_review"
  | "approved"
  | "scheduled"
  | "queued"
  | "uploading"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type ReviewStatus = "draft" | "awaiting_review" | "approved" | "rejected" | "archived";

export type StageState = "pending" | "active" | "complete" | "blocked" | "skipped";
