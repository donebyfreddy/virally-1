CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."account_slot_status" AS ENUM('planning', 'launch_kit_ready', 'awaiting_manual_creation', 'awaiting_connection', 'connecting', 'connected', 'limited_permissions', 'reconnection_required', 'suspended_by_user', 'disconnected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."aspect_ratio" AS ENUM('9:16', '4:5', '1:1', '16:9', '4:3', '3:2', 'custom');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('source_video', 'generated_video', 'image', 'generated_image', 'audio', 'voiceover', 'music', 'thumbnail', 'document', 'brand_asset', 'export');--> statement-breakpoint
CREATE TYPE "public"."campaign_stage" AS ENUM('brief', 'concepts', 'scripts', 'storyboards', 'assets', 'editing', 'approval', 'schedule', 'publish', 'learn');--> statement-breakpoint
CREATE TYPE "public"."connection_health" AS ENUM('healthy', 'expired', 'limited', 'rate_limited', 'failing', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."experiment_confidence" AS ENUM('no_data', 'early_signal', 'inconclusive', 'promising', 'enough_observations');--> statement-breakpoint
CREATE TYPE "public"."generation_mode" AS ENUM('quick', 'campaign', 'repurpose', 'product', 'account_launch', 'batch_studio');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'queued', 'running', 'waiting_external', 'completed', 'failed', 'cancelled', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('viewer', 'analyst', 'reviewer', 'publisher', 'editor', 'strategist', 'admin', 'owner');--> statement-breakpoint
CREATE TYPE "public"."output_origin" AS ENUM('provider', 'mock', 'user_upload', 'seeded_demo');--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('content.create', 'content.approve', 'content.publish', 'content.delete', 'campaign.manage', 'accounts.connect', 'accounts.disconnect', 'analytics.view', 'billing.view', 'billing.manage', 'team.manage', 'workspace.manage', 'assets.delete');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'facebook', 'tiktok', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'awaiting_review', 'approved', 'scheduled', 'queued', 'uploading', 'publishing', 'published', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'awaiting_review', 'approved', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."stage_state" AS ENUM('pending', 'active', 'complete', 'blocked', 'skipped');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slot_number" integer NOT NULL,
	"platform" "platform" NOT NULL,
	"status" "account_slot_status" DEFAULT 'planning' NOT NULL,
	"brand_id" uuid,
	"account_launch_kit_id" uuid,
	"connected_account_id" uuid,
	"display_label" text,
	"internal_notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "account_slots_slot_number_positive" CHECK ("account_slots"."slot_number" > 0),
	CONSTRAINT "account_slots_archived_consistent" CHECK (("account_slots"."status" = 'archived') = ("account_slots"."archived_at" is not null)),
	CONSTRAINT "account_slots_connected_requires_account" CHECK ("account_slots"."status" not in ('connected', 'limited_permissions', 'reconnection_required') or "account_slots"."connected_account_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_audience" text,
	"tone" text,
	"primary_objective" text,
	"value_propositions" text[] DEFAULT '{}' NOT NULL,
	"content_pillars" text[] DEFAULT '{}' NOT NULL,
	"banned_topics" text[] DEFAULT '{}' NOT NULL,
	"banned_phrases" text[] DEFAULT '{}' NOT NULL,
	"visual_style" text,
	"colour_tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logo_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_profiles_brand_id_unique" UNIQUE("brand_id")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"description" text,
	"industry" text,
	"primary_language" text DEFAULT 'en' NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "brands_name_length" CHECK (length(trim("brands"."name")) between 1 and 120),
	CONSTRAINT "brands_website_url_format" CHECK ("brands"."website_url" is null or "brands"."website_url" ~ '^https?://')
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"account_type" text DEFAULT 'personal' NOT NULL,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_name_length" CHECK (length(trim("organizations"."name")) between 1 and 120),
	CONSTRAINT "organizations_slug_format" CHECK ("organizations"."slug" ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
	CONSTRAINT "organizations_account_type" CHECK ("organizations"."account_type" in ('personal', 'agency', 'company', 'network'))
);
--> statement-breakpoint
CREATE TABLE "plan_limits" (
	"plan_code" text PRIMARY KEY NOT NULL,
	"account_slot_limit" integer NOT NULL,
	"monthly_generation_limit" integer,
	"monthly_publish_limit" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"full_name" text,
	"avatar_url" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"notification_preferences" jsonb DEFAULT '{"job_failed":true,"approval_required":true,"publish_failed":true,"usage_warning":true,"weekly_digest":false}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_limits" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"account_slot_limit" integer,
	"monthly_generation_limit" integer,
	"monthly_publish_limit" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_length" CHECK (length(trim("workspaces"."name")) between 1 and 120),
	CONSTRAINT "workspaces_slug_format" CHECK ("workspaces"."slug" ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);
--> statement-breakpoint
CREATE TABLE "account_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_group_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grouping_kind" text,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_name_check" CHECK (length(trim(name)) between 1 and 120),
	CONSTRAINT "account_groups_grouping_kind_check" CHECK (grouping_kind in ('brand', 'language', 'country', 'niche', 'client', 'campaign', 'strategy'))
);
--> statement-breakpoint
CREATE TABLE "account_launch_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid,
	"target_platform" "platform" NOT NULL,
	"concept" text,
	"suggested_names" text[] DEFAULT '{}' NOT NULL,
	"suggested_usernames" text[] DEFAULT '{}' NOT NULL,
	"bio" text,
	"profile_description" text,
	"profile_image_asset_id" uuid,
	"cover_image_asset_id" uuid,
	"brand_voice" text,
	"audience" text,
	"content_pillars" text[] DEFAULT '{}' NOT NULL,
	"initial_hooks" text[] DEFAULT '{}' NOT NULL,
	"first_posts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual_checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"linked_account_id" uuid,
	"target_audience" text,
	"primary_language" text DEFAULT 'en' NOT NULL,
	"region" text,
	"objective" text,
	"visual_direction" text,
	"posting_frequency" text,
	"initial_campaign_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_launch_kits_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "account_launch_kits_status_check" CHECK (status in ('draft', 'ready', 'account_created', 'connected', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "account_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"captured_on" date NOT NULL,
	"follower_count" bigint,
	"followers_gained" integer,
	"followers_lost" integer,
	"profile_views" bigint,
	"reach" bigint,
	"impressions" bigint,
	"total_views" bigint,
	"posts_published" integer,
	"origin" "output_origin" DEFAULT 'provider' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_metrics_follower_count_check" CHECK (follower_count is null or follower_count >= 0),
	CONSTRAINT "account_metrics_posts_published_check" CHECK (posts_published is null or posts_published >= 0)
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"platform" "platform",
	"brand_id" uuid,
	"views" bigint DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"engagements" bigint DEFAULT 0 NOT NULL,
	"followers_gained" integer DEFAULT 0 NOT NULL,
	"posts_published" integer DEFAULT 0 NOT NULL,
	"avg_completion_bp" integer,
	"avg_engagement_bp" integer,
	"origin" "output_origin" DEFAULT 'provider' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_item_id" uuid,
	"scheduled_post_id" uuid,
	"requested_by" uuid NOT NULL,
	"assigned_to" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_status_check" CHECK (status in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "approval_requests_decision_complete" CHECK ((decided_at is null) = (decided_by is null))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"actor_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"ip_prefix" text,
	"user_agent_family" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"raw_prompt" text,
	"source_kind" text,
	"source_url" text,
	"source_asset_id" uuid,
	"audience" text,
	"tone" text,
	"key_messages" text[] DEFAULT '{}' NOT NULL,
	"content_pillars" text[] DEFAULT '{}' NOT NULL,
	"call_to_action" text,
	"external_text_sanitised" boolean DEFAULT false NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_briefs_version_check" CHECK (version >= 1),
	CONSTRAINT "campaign_briefs_source_kind_check" CHECK (source_kind in ('prompt', 'website', 'product', 'document', 'video', 'audio', 'image', 'library'))
);
--> statement-breakpoint
CREATE TABLE "campaign_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"aspect_ratios" "aspect_ratio"[] DEFAULT '{"9:16"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stage" "campaign_stage" NOT NULL,
	"state" "stage_state" DEFAULT 'pending' NOT NULL,
	"blocked_reason" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_stages_blocked_needs_reason" CHECK (state <> 'blocked' or blocked_reason is not null)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid,
	"name" text NOT NULL,
	"objective" text,
	"mode" "generation_mode" DEFAULT 'campaign' NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"languages" text[] DEFAULT '{"en"}' NOT NULL,
	"platforms" "platform"[] DEFAULT '{}' NOT NULL,
	"concepts_count" integer DEFAULT 0 NOT NULL,
	"content_count" integer DEFAULT 0 NOT NULL,
	"published_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"actual_cost_cents" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_name_check" CHECK (length(trim(name)) between 1 and 200),
	CONSTRAINT "campaigns_date_range" CHECK (ends_on is null or starts_on is null or ends_on >= starts_on),
	CONSTRAINT "campaigns_concepts_count_check" CHECK (concepts_count >= 0),
	CONSTRAINT "campaigns_content_count_check" CHECK (content_count >= 0),
	CONSTRAINT "campaigns_published_count_check" CHECK (published_count >= 0),
	CONSTRAINT "campaigns_estimated_cost_cents_check" CHECK (estimated_cost_cents >= 0),
	CONSTRAINT "campaigns_actual_cost_cents_check" CHECK (actual_cost_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_item_id" uuid,
	"content_variant_id" uuid,
	"campaign_id" uuid,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"anchor_frame" integer,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_check" CHECK (length(trim(body)) > 0),
	CONSTRAINT "comments_anchor_frame_check" CHECK (anchor_frame is null or anchor_frame >= 0)
);
--> statement-breakpoint
CREATE TABLE "composition_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"asset_id" uuid,
	"position" integer NOT NULL,
	"start_frame" integer NOT NULL,
	"duration_frames" integer NOT NULL,
	"source_in_frame" integer,
	"source_out_frame" integer,
	"text_content" text,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transform" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transition_in" text,
	"transition_out" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "composition_clips_start_frame_check" CHECK (start_frame >= 0),
	CONSTRAINT "composition_clips_duration_frames_check" CHECK (duration_frames > 0),
	CONSTRAINT "composition_clips_source_in_frame_check" CHECK (source_in_frame is null or source_in_frame >= 0),
	CONSTRAINT "composition_clips_source_range" CHECK (source_out_frame is null or source_in_frame is null or source_out_frame > source_in_frame)
);
--> statement-breakpoint
CREATE TABLE "composition_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"composition_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"is_muted" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "composition_tracks_kind_check" CHECK (kind in ('video', 'audio', 'voice', 'music', 'text', 'caption', 'overlay'))
);
--> statement-breakpoint
CREATE TABLE "compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_item_id" uuid,
	"content_variant_id" uuid,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"fps" integer DEFAULT 30 NOT NULL,
	"duration_frames" integer NOT NULL,
	"background_colour" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compositions_width_check" CHECK (width > 0),
	CONSTRAINT "compositions_height_check" CHECK (height > 0),
	CONSTRAINT "compositions_fps_check" CHECK (fps between 1 and 120),
	CONSTRAINT "compositions_duration_frames_check" CHECK (duration_frames > 0),
	CONSTRAINT "compositions_revision_check" CHECK (revision >= 1),
	CONSTRAINT "compositions_single_owner" CHECK ((content_item_id is not null and content_variant_id is null) or (content_item_id is null and content_variant_id is not null))
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"avatar_url" text,
	"profile_url" text,
	"account_kind" text,
	"health" "connection_health" DEFAULT 'healthy' NOT NULL,
	"health_detail" text,
	"granted_capabilities" text[] DEFAULT '{}' NOT NULL,
	"granted_scopes" text[] DEFAULT '{}' NOT NULL,
	"follower_count" integer,
	"last_synced_at" timestamp with time zone,
	"last_published_at" timestamp with time zone,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "connected_accounts_account_kind_check" CHECK (account_kind in ('personal', 'creator', 'business', 'page', 'channel')),
	CONSTRAINT "connected_accounts_follower_count_check" CHECK (follower_count is null or follower_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "content_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"angle" text,
	"summary" text,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_hooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"concept_id" uuid,
	"hook_id" uuid,
	"brand_id" uuid,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"content_type" text DEFAULT 'short_video' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"duration_ms" integer,
	"caption" text,
	"call_to_action" text,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_content_type_check" CHECK (content_type in ('short_video', 'long_video', 'image', 'carousel', 'text')),
	CONSTRAINT "content_items_duration_ms_check" CHECK (duration_ms is null or duration_ms > 0),
	CONSTRAINT "content_items_revision_check" CHECK (revision >= 1)
);
--> statement-breakpoint
CREATE TABLE "content_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scheduled_post_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"content_variant_id" uuid,
	"campaign_id" uuid,
	"platform" "platform" NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"views" bigint,
	"reach" bigint,
	"impressions" bigint,
	"likes" bigint,
	"comments" bigint,
	"shares" bigint,
	"saves" bigint,
	"clicks" bigint,
	"followers_gained" integer,
	"engagement_rate_bp" integer,
	"completion_rate_bp" integer,
	"average_watch_ms" integer,
	"three_second_views" bigint,
	"retention_curve" jsonb,
	"origin" "output_origin" DEFAULT 'provider' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_metrics_views_check" CHECK (views is null or views >= 0),
	CONSTRAINT "content_metrics_reach_check" CHECK (reach is null or reach >= 0),
	CONSTRAINT "content_metrics_impressions_check" CHECK (impressions is null or impressions >= 0),
	CONSTRAINT "content_metrics_likes_check" CHECK (likes is null or likes >= 0),
	CONSTRAINT "content_metrics_comments_check" CHECK (comments is null or comments >= 0),
	CONSTRAINT "content_metrics_shares_check" CHECK (shares is null or shares >= 0),
	CONSTRAINT "content_metrics_saves_check" CHECK (saves is null or saves >= 0),
	CONSTRAINT "content_metrics_clicks_check" CHECK (clicks is null or clicks >= 0),
	CONSTRAINT "content_metrics_engagement_rate_bp_check" CHECK (engagement_rate_bp is null or engagement_rate_bp >= 0),
	CONSTRAINT "content_metrics_completion_rate_bp_check" CHECK (completion_rate_bp is null or completion_rate_bp between 0 and 10000),
	CONSTRAINT "content_metrics_average_watch_ms_check" CHECK (average_watch_ms is null or average_watch_ms >= 0),
	CONSTRAINT "content_metrics_three_second_views_check" CHECK (three_second_views is null or three_second_views >= 0)
);
--> statement-breakpoint
CREATE TABLE "content_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"aspect_ratio" "aspect_ratio" DEFAULT '9:16' NOT NULL,
	"width" integer,
	"height" integer,
	"language" text DEFAULT 'en' NOT NULL,
	"caption_override" text,
	"title_override" text,
	"call_to_action_override" text,
	"layout_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rendered_asset_id" uuid,
	"thumbnail_asset_id" uuid,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_variants_width_check" CHECK (width is null or width > 0),
	CONSTRAINT "content_variants_height_check" CHECK (height is null or height > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"usage_event_id" bigint,
	"note" text,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "credit_ledger_reason_check" CHECK (reason in ('plan_grant', 'top_up', 'consumption', 'refund', 'adjustment', 'expiry'))
);
--> statement-breakpoint
CREATE TABLE "experiment_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_variant_id" uuid,
	"label" text NOT NULL,
	"is_control" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"name" text NOT NULL,
	"hypothesis" text,
	"variable" text NOT NULL,
	"primary_metric" text NOT NULL,
	"secondary_metric" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"confidence_state" "experiment_confidence" DEFAULT 'no_data' NOT NULL,
	"confidence_notes" text,
	"outcome_summary" text,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"min_observations" integer,
	"concluded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiments_variable_check" CHECK (variable in ('hook', 'first_frame', 'duration', 'caption', 'cta', 'thumbnail', 'voice', 'music', 'platform', 'account', 'posting_time')),
	CONSTRAINT "experiments_status_check" CHECK (status in ('draft', 'running', 'paused', 'concluded', 'abandoned')),
	CONSTRAINT "experiments_min_observations_check" CHECK (min_observations is null or min_observations > 0)
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"content_item_id" uuid,
	"content_variant_id" uuid,
	"shot_id" uuid,
	"stage" text NOT NULL,
	"provider" text NOT NULL,
	"provider_model" text,
	"prompt_version" text,
	"capability" text,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"input_digest" text,
	"output_summary" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"cost_incurred" boolean DEFAULT false NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"reference" text DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) NOT NULL,
	"external_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_runs_stage_check" CHECK (stage in ('brief', 'strategy', 'concepts', 'hooks', 'script', 'storyboard', 'image', 'video', 'voice', 'composition', 'adaptation', 'moderation', 'thumbnail')),
	CONSTRAINT "generation_runs_attempt_check" CHECK (attempt >= 1),
	CONSTRAINT "generation_runs_duration_ms_check" CHECK (duration_ms is null or duration_ms >= 0),
	CONSTRAINT "generation_runs_cost_cents_check" CHECK (cost_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_status" "job_status",
	"to_status" "job_status" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"provider" text,
	"external_job_id" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"idempotency_key" text NOT NULL,
	"parent_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "jobs_priority_check" CHECK (priority between 1 and 9),
	CONSTRAINT "jobs_progress_check" CHECK (progress between 0 and 100),
	CONSTRAINT "jobs_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "jobs_max_attempts_check" CHECK (max_attempts >= 1),
	CONSTRAINT "jobs_cost_cents_check" CHECK (cost_cents >= 0),
	CONSTRAINT "jobs_type_check" CHECK (type in ('campaign.plan', 'content.script', 'content.storyboard', 'asset.image.generate', 'asset.video.generate', 'asset.voice.generate', 'content.render', 'content.transcode', 'content.quality_check', 'content.publish', 'content.metrics.sync', 'account.sync'))
);
--> statement-breakpoint
CREATE TABLE "learning_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"content_variant_id" uuid,
	"kind" text NOT NULL,
	"statement" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"observation_count" integer NOT NULL,
	"confidence_state" "experiment_confidence" DEFAULT 'early_signal' NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_insights_kind_check" CHECK (kind in ('what_worked', 'what_lost_attention', 'what_to_test')),
	CONSTRAINT "learning_insights_observation_count_check" CHECK (observation_count >= 0),
	CONSTRAINT "learning_insights_needs_evidence" CHECK (observation_count > 0 and evidence <> '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "media_asset_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_path" text NOT NULL,
	"byte_size" bigint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_versions_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"brand_id" uuid,
	"campaign_id" uuid,
	"content_item_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"filename" text,
	"mime_type" text,
	"byte_size" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"aspect_ratio" "aspect_ratio",
	"codec" text,
	"poster_asset_id" uuid,
	"origin" "output_origin" DEFAULT 'user_upload' NOT NULL,
	"provider" text,
	"provider_model" text,
	"generation_cost_cents" integer DEFAULT 0 NOT NULL,
	"checksum" text,
	"upload_state" text DEFAULT 'pending' NOT NULL,
	"scan_state" text DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_bucket_check" CHECK (bucket in ('source-media', 'generated-media', 'brand-assets', 'avatars', 'exports')),
	CONSTRAINT "media_assets_byte_size_check" CHECK (byte_size is null or byte_size >= 0),
	CONSTRAINT "media_assets_duration_ms_check" CHECK (duration_ms is null or duration_ms >= 0),
	CONSTRAINT "media_assets_width_check" CHECK (width is null or width > 0),
	CONSTRAINT "media_assets_height_check" CHECK (height is null or height > 0),
	CONSTRAINT "media_assets_upload_state_check" CHECK (upload_state in ('pending', 'uploaded', 'processing', 'ready', 'failed')),
	CONSTRAINT "media_assets_scan_state_check" CHECK (scan_state in ('pending', 'clean', 'rejected', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_path" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK (kind in ('job_completed', 'job_failed', 'account_disconnected', 'approval_required', 'publishing_completed', 'publishing_failed', 'usage_warning', 'team_invitation', 'analytics_insight'))
);
--> statement-breakpoint
CREATE TABLE "oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"encryption_key_id" text DEFAULT 'v1' NOT NULL,
	"token_type" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"refresh_failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_connections_connected_account_id_unique" UNIQUE("connected_account_id"),
	CONSTRAINT "oauth_connections_refresh_failure_count_check" CHECK (refresh_failure_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"completed_steps" integer[] DEFAULT '{}' NOT NULL,
	"account_type" text,
	"content_goals" text[] DEFAULT '{}' NOT NULL,
	"preferred_formats" text[] DEFAULT '{}' NOT NULL,
	"first_campaign_prompt" text,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_progress_current_step_check" CHECK (current_step between 1 and 7),
	CONSTRAINT "onboarding_progress_account_type_check" CHECK (account_type in ('personal', 'agency', 'company', 'network'))
);
--> statement-breakpoint
CREATE TABLE "platform_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"account_kind" text NOT NULL,
	"capability" text NOT NULL,
	"is_supported" boolean DEFAULT false NOT NULL,
	"requires_app_review" boolean DEFAULT false NOT NULL,
	"max_duration_seconds" integer,
	"max_file_size_mb" integer,
	"supported_ratios" "aspect_ratio"[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publishing_job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text DEFAULT 'running' NOT NULL,
	"http_status" integer,
	"platform_error_code" text,
	"platform_error_message" text,
	"external_post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_attempts_attempt_number_check" CHECK (attempt_number >= 1),
	CONSTRAINT "publishing_attempts_outcome_check" CHECK (outcome in ('running', 'succeeded', 'failed', 'aborted', 'skipped_duplicate'))
);
--> statement-breakpoint
CREATE TABLE "publishing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scheduled_post_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"retry_safe" boolean DEFAULT true NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "publishing_jobs_priority_check" CHECK (priority between 1 and 9),
	CONSTRAINT "publishing_jobs_attempts_check" CHECK (attempts >= 0),
	CONSTRAINT "publishing_jobs_max_attempts_check" CHECK (max_attempts >= 1),
	CONSTRAINT "publishing_jobs_attempts_bound" CHECK (attempts <= max_attempts + 1)
);
--> statement-breakpoint
CREATE TABLE "publishing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"name" text,
	"planned_post_count" integer DEFAULT 0 NOT NULL,
	"planned_account_count" integer DEFAULT 0 NOT NULL,
	"estimated_usage_credits" integer DEFAULT 0 NOT NULL,
	"cadence" text,
	"posts_per_day" integer,
	"time_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_plans_planned_post_count_check" CHECK (planned_post_count >= 0),
	CONSTRAINT "publishing_plans_planned_account_count_check" CHECK (planned_account_count >= 0),
	CONSTRAINT "publishing_plans_estimated_usage_credits_check" CHECK (estimated_usage_credits >= 0),
	CONSTRAINT "publishing_plans_cadence_check" CHECK (cadence in ('asap', 'daily', 'weekdays', 'custom', 'even_spread')),
	CONSTRAINT "publishing_plans_posts_per_day_check" CHECK (posts_per_day is null or posts_per_day > 0),
	CONSTRAINT "publishing_plans_range" CHECK (ends_on is null or starts_on is null or ends_on >= starts_on),
	CONSTRAINT "publishing_plans_status_check" CHECK (status in ('draft', 'previewed', 'confirmed', 'executing', 'completed', 'cancelled')),
	CONSTRAINT "publishing_plans_confirmation_complete" CHECK ((confirmed_at is null) = (confirmed_by is null))
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publishing_plan_id" uuid,
	"campaign_id" uuid,
	"content_variant_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"caption" text,
	"first_comment" text,
	"platform_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"published_at" timestamp with time zone,
	"external_post_id" text,
	"external_permalink" text,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_posts_approval_complete" CHECK ((approved_at is null) = (approved_by is null)),
	CONSTRAINT "scheduled_posts_published_has_id" CHECK (status <> 'published' or external_post_id is not null)
);
--> statement-breakpoint
CREATE TABLE "script_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text DEFAULT 'body' NOT NULL,
	"text" text NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_segments_role_check" CHECK (role in ('hook', 'body', 'cta', 'outro')),
	CONSTRAINT "script_segments_start_ms_check" CHECK (start_ms is null or start_ms >= 0),
	CONSTRAINT "script_segments_end_ms_check" CHECK (end_ms is null or end_ms >= 0),
	CONSTRAINT "script_segments_time_order" CHECK (end_ms is null or start_ms is null or end_ms > start_ms)
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"full_text" text,
	"word_count" integer,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scripts_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storyboard_id" uuid NOT NULL,
	"script_segment_id" uuid,
	"position" integer NOT NULL,
	"description" text,
	"visual_prompt" text,
	"camera" text,
	"duration_ms" integer,
	"asset_id" uuid,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shots_duration_ms_check" CHECK (duration_ms is null or duration_ms > 0)
);
--> statement-breakpoint
CREATE TABLE "storyboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"origin" "output_origin" DEFAULT 'mock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storyboards_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"external_customer_id" text,
	"external_subscription_id" text,
	"plan_code" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"included_credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "subscriptions_provider_check" CHECK (provider in ('none', 'stripe')),
	CONSTRAINT "subscriptions_status_check" CHECK (status in ('active', 'trialing', 'past_due', 'cancelled', 'paused', 'unconfigured')),
	CONSTRAINT "subscriptions_included_credits_check" CHECK (included_credits >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"kind" text NOT NULL,
	"quantity" bigint NOT NULL,
	"unit" text NOT NULL,
	"credits_delta" integer DEFAULT 0 NOT NULL,
	"provider_cost_cents" integer DEFAULT 0 NOT NULL,
	"generation_run_id" uuid,
	"job_id" uuid,
	"idempotency_key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_kind_check" CHECK (kind in ('video_generated', 'image_generated', 'voice_generated', 'render_minutes', 'storage_bytes', 'post_published', 'account_connected', 'transcription_minutes')),
	CONSTRAINT "usage_events_quantity_check" CHECK (quantity >= 0),
	CONSTRAINT "usage_events_provider_cost_cents_check" CHECK (provider_cost_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_event_id" text,
	"event_type" text,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_brand_id_workspace_id_brands_id_workspace_id_fk" FOREIGN KEY ("brand_id","workspace_id") REFERENCES "public"."brands"("id","workspace_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_account_launch_kit_id_workspace_id_account_launch_kits_id_workspace_id_fk" FOREIGN KEY ("account_launch_kit_id","workspace_id") REFERENCES "public"."account_launch_kits"("id","workspace_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_slots" ADD CONSTRAINT "account_slots_connected_account_id_workspace_id_connected_accounts_id_workspace_id_fk" FOREIGN KEY ("connected_account_id","workspace_id") REFERENCES "public"."connected_accounts"("id","workspace_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_logo_asset_id_media_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_limits" ADD CONSTRAINT "workspace_limits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_account_group_id_account_groups_id_fk" FOREIGN KEY ("account_group_id") REFERENCES "public"."account_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_profile_image_asset_id_media_assets_id_fk" FOREIGN KEY ("profile_image_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_cover_image_asset_id_media_assets_id_fk" FOREIGN KEY ("cover_image_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_linked_account_id_connected_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_initial_campaign_id_campaigns_id_fk" FOREIGN KEY ("initial_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_launch_kits" ADD CONSTRAINT "account_launch_kits_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_metrics" ADD CONSTRAINT "account_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_metrics" ADD CONSTRAINT "account_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_metrics" ADD CONSTRAINT "account_metrics_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_source_asset_id_media_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_platforms" ADD CONSTRAINT "campaign_platforms_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_platforms" ADD CONSTRAINT "campaign_platforms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stages" ADD CONSTRAINT "campaign_stages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stages" ADD CONSTRAINT "campaign_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_clips" ADD CONSTRAINT "composition_clips_track_id_composition_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."composition_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_clips" ADD CONSTRAINT "composition_clips_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_tracks" ADD CONSTRAINT "composition_tracks_composition_id_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."compositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_concepts" ADD CONSTRAINT "content_concepts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_concepts" ADD CONSTRAINT "content_concepts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_concepts" ADD CONSTRAINT "content_concepts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_concepts" ADD CONSTRAINT "content_concepts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_hooks" ADD CONSTRAINT "content_hooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_hooks" ADD CONSTRAINT "content_hooks_concept_id_content_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."content_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_concept_id_content_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."content_concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_hook_id_content_hooks_id_fk" FOREIGN KEY ("hook_id") REFERENCES "public"."content_hooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_metrics" ADD CONSTRAINT "content_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_rendered_asset_id_media_assets_id_fk" FOREIGN KEY ("rendered_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_thumbnail_asset_id_media_assets_id_fk" FOREIGN KEY ("thumbnail_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_job_id_jobs_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_insights" ADD CONSTRAINT "learning_insights_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_insights" ADD CONSTRAINT "learning_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_insights" ADD CONSTRAINT "learning_insights_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_insights" ADD CONSTRAINT "learning_insights_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_versions" ADD CONSTRAINT "media_asset_versions_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_versions" ADD CONSTRAINT "media_asset_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_versions" ADD CONSTRAINT "media_asset_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_poster_asset_id_media_assets_id_fk" FOREIGN KEY ("poster_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_attempts" ADD CONSTRAINT "publishing_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_attempts" ADD CONSTRAINT "publishing_attempts_publishing_job_id_publishing_jobs_id_fk" FOREIGN KEY ("publishing_job_id") REFERENCES "public"."publishing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_plans" ADD CONSTRAINT "publishing_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_plans" ADD CONSTRAINT "publishing_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_plans" ADD CONSTRAINT "publishing_plans_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_plans" ADD CONSTRAINT "publishing_plans_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_plans" ADD CONSTRAINT "publishing_plans_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_publishing_plan_id_publishing_plans_id_fk" FOREIGN KEY ("publishing_plan_id") REFERENCES "public"."publishing_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_content_variant_id_content_variants_id_fk" FOREIGN KEY ("content_variant_id") REFERENCES "public"."content_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_segments" ADD CONSTRAINT "script_segments_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_script_segment_id_script_segments_id_fk" FOREIGN KEY ("script_segment_id") REFERENCES "public"."script_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_slots_workspace_slot_key" ON "account_slots" USING btree ("workspace_id","slot_number");--> statement-breakpoint
CREATE INDEX "account_slots_active_idx" ON "account_slots" USING btree ("workspace_id","slot_number") WHERE "account_slots"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "account_slots_status_idx" ON "account_slots" USING btree ("workspace_id","status") WHERE "account_slots"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "account_slots_connected_account_idx" ON "account_slots" USING btree ("connected_account_id") WHERE "account_slots"."connected_account_id" is not null;--> statement-breakpoint
CREATE INDEX "account_slots_launch_kit_idx" ON "account_slots" USING btree ("account_launch_kit_id") WHERE "account_slots"."account_launch_kit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_one_default_per_workspace" ON "brands" USING btree ("workspace_id") WHERE "brands"."is_default" and "brands"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_key" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_members_org_idx" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_org_role_idx" ON "organization_members" USING btree ("user_id","organization_id","role");--> statement-breakpoint
CREATE INDEX "organizations_created_by_idx" ON "organizations" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_user_key" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_members_organization_idx" ON "workspace_members" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_org_slug_key" ON "workspaces" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_one_default_per_org" ON "workspaces" USING btree ("organization_id") WHERE "workspaces"."is_default" and "workspaces"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "workspaces_org_idx" ON "workspaces" USING btree ("organization_id") WHERE "workspaces"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_members_account_group_id_connected_account_id_key" ON "account_group_members" USING btree ("account_group_id","connected_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_workspace_id_name_key" ON "account_groups" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "account_launch_kits_status_idx" ON "account_launch_kits" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "account_launch_kits_campaign_idx" ON "account_launch_kits" USING btree ("initial_campaign_id") WHERE initial_campaign_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "account_metrics_connected_account_id_captured_on_key" ON "account_metrics" USING btree ("connected_account_id","captured_on");--> statement-breakpoint
CREATE INDEX "account_metrics_account_date_idx" ON "account_metrics" USING btree ("connected_account_id","captured_on" desc);--> statement-breakpoint
CREATE INDEX "account_metrics_workspace_date_idx" ON "account_metrics" USING btree ("workspace_id","captured_on" desc);--> statement-breakpoint
CREATE INDEX "activity_events_workspace_time_idx" ON "activity_events" USING btree ("workspace_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_workspace_id_day_platform_brand_id_origin_key" ON "analytics_daily" USING btree ("workspace_id","day","platform","brand_id","origin");--> statement-breakpoint
CREATE INDEX "analytics_daily_workspace_day_idx" ON "analytics_daily" USING btree ("workspace_id","day" desc);--> statement-breakpoint
CREATE INDEX "approval_requests_pending_idx" ON "approval_requests" USING btree ("workspace_id","created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "audit_logs_org_time_idx" ON "audit_logs" USING btree ("organization_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "audit_logs_subject_idx" ON "audit_logs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_briefs_campaign_id_version_key" ON "campaign_briefs" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_briefs_one_current" ON "campaign_briefs" USING btree ("campaign_id") WHERE is_current;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_platforms_campaign_id_platform_key" ON "campaign_platforms" USING btree ("campaign_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_stages_campaign_id_stage_key" ON "campaign_stages" USING btree ("campaign_id","stage");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_status_idx" ON "campaigns" USING btree ("workspace_id","status","created_at" desc) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "campaigns_brand_idx" ON "campaigns" USING btree ("brand_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "campaigns_name_trgm_idx" ON "campaigns" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "comments_item_idx" ON "comments" USING btree ("content_item_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_workspace_open_idx" ON "comments" USING btree ("workspace_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "composition_clips_track_id_position_key" ON "composition_clips" USING btree ("track_id","position");--> statement-breakpoint
CREATE INDEX "composition_clips_track_idx" ON "composition_clips" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "composition_tracks_composition_id_position_key" ON "composition_tracks" USING btree ("composition_id","position");--> statement-breakpoint
CREATE INDEX "composition_tracks_composition_idx" ON "composition_tracks" USING btree ("composition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_workspace_id_platform_external_id_key" ON "connected_accounts" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_workspace_idx" ON "connected_accounts" USING btree ("workspace_id") WHERE disconnected_at is null;--> statement-breakpoint
CREATE INDEX "connected_accounts_health_idx" ON "connected_accounts" USING btree ("workspace_id","health") WHERE disconnected_at is null;--> statement-breakpoint
CREATE INDEX "connected_accounts_brand_idx" ON "connected_accounts" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "content_concepts_campaign_idx" ON "content_concepts" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE INDEX "content_hooks_concept_idx" ON "content_hooks" USING btree ("concept_id","position");--> statement-breakpoint
CREATE INDEX "content_items_workspace_status_idx" ON "content_items" USING btree ("workspace_id","status","updated_at" desc) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "content_items_campaign_idx" ON "content_items" USING btree ("campaign_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "content_items_concept_idx" ON "content_items" USING btree ("concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_metrics_scheduled_post_id_captured_at_key" ON "content_metrics" USING btree ("scheduled_post_id","captured_at");--> statement-breakpoint
CREATE INDEX "content_metrics_post_time_idx" ON "content_metrics" USING btree ("scheduled_post_id","captured_at" desc);--> statement-breakpoint
CREATE INDEX "content_metrics_workspace_time_idx" ON "content_metrics" USING btree ("workspace_id","captured_at" desc);--> statement-breakpoint
CREATE INDEX "content_metrics_campaign_idx" ON "content_metrics" USING btree ("campaign_id","captured_at" desc);--> statement-breakpoint
CREATE INDEX "content_metrics_platform_idx" ON "content_metrics" USING btree ("workspace_id","platform","captured_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "content_variants_content_item_id_platform_aspect_ratio_language_key" ON "content_variants" USING btree ("content_item_id","platform","aspect_ratio","language");--> statement-breakpoint
CREATE INDEX "content_variants_item_idx" ON "content_variants" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "content_variants_platform_idx" ON "content_variants" USING btree ("workspace_id","platform","status");--> statement-breakpoint
CREATE INDEX "content_variants_hash_idx" ON "content_variants" USING btree ("workspace_id","content_hash") WHERE content_hash is not null;--> statement-breakpoint
CREATE INDEX "credit_ledger_org_idx" ON "credit_ledger" USING btree ("organization_id","occurred_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_variants_experiment_id_label_key" ON "experiment_variants" USING btree ("experiment_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_variants_one_control" ON "experiment_variants" USING btree ("experiment_id") WHERE is_control;--> statement-breakpoint
CREATE INDEX "generation_runs_workspace_created_idx" ON "generation_runs" USING btree ("workspace_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "generation_runs_status_idx" ON "generation_runs" USING btree ("status") WHERE status in ('pending', 'queued', 'running', 'waiting_external');--> statement-breakpoint
CREATE INDEX "generation_runs_item_idx" ON "generation_runs" USING btree ("content_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_runs_reference_idx" ON "generation_runs" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claimable_idx" ON "jobs" USING btree ("status","priority","run_after") WHERE status in ('pending', 'queued');--> statement-breakpoint
CREATE INDEX "jobs_workspace_status_idx" ON "jobs" USING btree ("workspace_id","status","created_at" desc);--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("locked_until") WHERE locked_until is not null;--> statement-breakpoint
CREATE INDEX "jobs_parent_idx" ON "jobs" USING btree ("parent_job_id") WHERE parent_job_id is not null;--> statement-breakpoint
CREATE INDEX "jobs_external_idx" ON "jobs" USING btree ("provider","external_job_id") WHERE external_job_id is not null;--> statement-breakpoint
CREATE INDEX "learning_insights_variant_idx" ON "learning_insights" USING btree ("content_variant_id");--> statement-breakpoint
CREATE INDEX "learning_insights_campaign_idx" ON "learning_insights" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_versions_asset_id_version_key" ON "media_asset_versions" USING btree ("asset_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_bucket_storage_path_key" ON "media_assets" USING btree ("bucket","storage_path");--> statement-breakpoint
CREATE INDEX "media_assets_workspace_kind_idx" ON "media_assets" USING btree ("workspace_id","kind","created_at" desc) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "media_assets_campaign_idx" ON "media_assets" USING btree ("campaign_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "media_assets_checksum_idx" ON "media_assets" USING btree ("workspace_id","checksum") WHERE checksum is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at" desc) WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "oauth_connections_expiry_idx" ON "oauth_connections" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_progress_organization_id_user_id_key" ON "onboarding_progress" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "onboarding_progress_user_idx" ON "onboarding_progress" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_capabilities_platform_account_kind_capability_key" ON "platform_capabilities" USING btree ("platform","account_kind","capability");--> statement-breakpoint
CREATE UNIQUE INDEX "publishing_attempts_publishing_job_id_attempt_number_key" ON "publishing_attempts" USING btree ("publishing_job_id","attempt_number");--> statement-breakpoint
CREATE INDEX "publishing_attempts_job_idx" ON "publishing_attempts" USING btree ("publishing_job_id","attempt_number");--> statement-breakpoint
CREATE INDEX "publishing_jobs_claimable_idx" ON "publishing_jobs" USING btree ("status","priority","run_after") WHERE status in ('pending', 'queued');--> statement-breakpoint
CREATE INDEX "publishing_jobs_lease_idx" ON "publishing_jobs" USING btree ("locked_until") WHERE locked_until is not null;--> statement-breakpoint
CREATE INDEX "publishing_jobs_post_idx" ON "publishing_jobs" USING btree ("scheduled_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_posts_content_variant_id_connected_account_id_scheduled_for_key" ON "scheduled_posts" USING btree ("content_variant_id","connected_account_id","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_posts_external_unique" ON "scheduled_posts" USING btree ("connected_account_id","external_post_id") WHERE external_post_id is not null;--> statement-breakpoint
CREATE INDEX "scheduled_posts_calendar_idx" ON "scheduled_posts" USING btree ("workspace_id","scheduled_for") WHERE cancelled_at is null;--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_idx" ON "scheduled_posts" USING btree ("status","scheduled_for") WHERE status in ('scheduled', 'queued', 'uploading', 'publishing');--> statement-breakpoint
CREATE INDEX "scheduled_posts_account_idx" ON "scheduled_posts" USING btree ("connected_account_id","scheduled_for" desc);--> statement-breakpoint
CREATE INDEX "scheduled_posts_awaiting_approval_idx" ON "scheduled_posts" USING btree ("workspace_id","scheduled_for") WHERE status = 'awaiting_review';--> statement-breakpoint
CREATE UNIQUE INDEX "script_segments_script_id_position_key" ON "script_segments" USING btree ("script_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scripts_content_item_id_version_key" ON "scripts" USING btree ("content_item_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "scripts_one_current" ON "scripts" USING btree ("content_item_id") WHERE is_current;--> statement-breakpoint
CREATE UNIQUE INDEX "shots_storyboard_id_position_key" ON "shots" USING btree ("storyboard_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboards_content_item_id_version_key" ON "storyboards" USING btree ("content_item_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "storyboards_one_current" ON "storyboards" USING btree ("content_item_id") WHERE is_current;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_idempotency_key_kind_key" ON "usage_events" USING btree ("idempotency_key","kind");--> statement-breakpoint
CREATE INDEX "usage_events_org_time_idx" ON "usage_events" USING btree ("organization_id","occurred_at" desc);--> statement-breakpoint
CREATE INDEX "usage_events_kind_idx" ON "usage_events" USING btree ("organization_id","kind","occurred_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_source_external_event_id_key" ON "webhook_events" USING btree ("source","external_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("received_at") WHERE processed_at is null;--> statement-breakpoint
CREATE VIEW "public"."connected_account_token_status" AS (
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
);--> statement-breakpoint
CREATE VIEW "public"."organization_teammates" AS (
  select
    m.organization_id,
    m.user_id,
    m.role,
    m.accepted_at,
    p.full_name,
    p.avatar_url
  from organization_members m
  join profiles p on p.id = m.user_id
);