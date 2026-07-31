CREATE TABLE "cost_configuration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"value_type" text DEFAULT 'integer' NOT NULL,
	"description" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_configuration_value_type_check" CHECK (value_type in ('integer', 'decimal', 'boolean', 'string', 'json'))
);
--> statement-breakpoint
CREATE TABLE "generation_models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"endpoint_path" text NOT NULL,
	"allowed_durations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_ratios" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_cents_per_unit" integer NOT NULL,
	"cost_basis" text DEFAULT 'configured_table' NOT NULL,
	"modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_models_kind_check" CHECK (kind in ('image', 'video', 'audio')),
	CONSTRAINT "generation_models_cost_basis_check" CHECK (cost_basis in ('provider_quote', 'configured_table')),
	CONSTRAINT "generation_models_cost_check" CHECK (estimated_cents_per_unit >= 0)
);
--> statement-breakpoint
CREATE TABLE "generation_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"credential_env_var" text NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"docs_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_providers_rate_limit_check" CHECK (rate_limit_per_minute > 0)
);
--> statement-breakpoint
CREATE TABLE "production_modes" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"production_credits" integer NOT NULL,
	"target_cost_cents_low" integer NOT NULL,
	"target_cost_cents_high" integer NOT NULL,
	"ai_video_clips_min" integer DEFAULT 0 NOT NULL,
	"ai_video_clips_max" integer DEFAULT 0 NOT NULL,
	"generated_images_typical" integer DEFAULT 0 NOT NULL,
	"regeneration_allowance" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_modes_id_check" CHECK (id in ('fast', 'hybrid', 'cinematic')),
	CONSTRAINT "production_modes_credits_check" CHECK (production_credits > 0),
	CONSTRAINT "production_modes_band_check" CHECK (target_cost_cents_low >= 0 and target_cost_cents_high >= target_cost_cents_low),
	CONSTRAINT "production_modes_clips_check" CHECK (ai_video_clips_min >= 0 and ai_video_clips_max >= ai_video_clips_min)
);
--> statement-breakpoint
CREATE TABLE "provider_run_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source_url" text NOT NULL,
	"source_url_expires_at" timestamp with time zone,
	"media_asset_id" uuid,
	"mime_type" text,
	"byte_size" integer,
	"checksum_sha256" text,
	"ingested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_run_outputs_run_position_unique" UNIQUE("provider_run_id","position"),
	CONSTRAINT "provider_run_outputs_position_check" CHECK (position >= 0),
	CONSTRAINT "provider_run_outputs_byte_size_check" CHECK (byte_size is null or byte_size >= 0),
	CONSTRAINT "provider_run_outputs_ingested_check" CHECK ((media_asset_id is not null) = (ingested_at is not null))
);
--> statement-breakpoint
CREATE TABLE "provider_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"generation_run_id" uuid,
	"job_id" uuid,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"generation_type" text NOT NULL,
	"input_prompt" text NOT NULL,
	"negative_prompt" text,
	"input_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_duration_seconds" integer,
	"requested_resolution" text,
	"requested_aspect_ratio" text,
	"external_task_id" text,
	"state" text DEFAULT 'planned' NOT NULL,
	"progress" integer,
	"provider_credits" integer,
	"estimated_internal_cents" integer DEFAULT 0 NOT NULL,
	"actual_internal_cents" integer,
	"output_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_runs_idempotency_key_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "provider_runs_state_check" CHECK (state in ('planned', 'queued', 'submitted', 'generating', 'downloading', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "provider_runs_generation_type_check" CHECK (generation_type in ('image', 'video', 'audio')),
	CONSTRAINT "provider_runs_progress_check" CHECK (progress is null or progress between 0 and 100),
	CONSTRAINT "provider_runs_attempt_check" CHECK (attempt_count >= 0),
	CONSTRAINT "provider_runs_estimated_check" CHECK (estimated_internal_cents >= 0),
	CONSTRAINT "provider_runs_actual_check" CHECK (actual_internal_cents is null or actual_internal_cents >= 0),
	CONSTRAINT "provider_runs_completed_at_check" CHECK ((state in ('completed', 'failed', 'cancelled')) = (completed_at is not null))
);
--> statement-breakpoint
ALTER TABLE "cost_configuration" ADD CONSTRAINT "cost_configuration_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_models" ADD CONSTRAINT "generation_models_provider_id_generation_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."generation_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_run_outputs" ADD CONSTRAINT "provider_run_outputs_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_run_outputs" ADD CONSTRAINT "provider_run_outputs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_run_outputs" ADD CONSTRAINT "provider_run_outputs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_provider_id_generation_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."generation_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_configuration_global_key_idx" ON "cost_configuration" USING btree ("key") WHERE organization_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_configuration_org_key_idx" ON "cost_configuration" USING btree ("organization_id","key") WHERE organization_id is not null;--> statement-breakpoint
CREATE INDEX "generation_models_provider_kind_idx" ON "generation_models" USING btree ("provider_id","kind");--> statement-breakpoint
CREATE INDEX "provider_run_outputs_pending_idx" ON "provider_run_outputs" USING btree ("provider_run_id") WHERE media_asset_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_runs_external_task_idx" ON "provider_runs" USING btree ("provider_id","external_task_id") WHERE external_task_id is not null;--> statement-breakpoint
CREATE INDEX "provider_runs_pending_idx" ON "provider_runs" USING btree ("state","created_at") WHERE state in ('queued', 'submitted', 'generating', 'downloading');--> statement-breakpoint
CREATE INDEX "provider_runs_workspace_idx" ON "provider_runs" USING btree ("workspace_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "provider_runs_generation_run_idx" ON "provider_runs" USING btree ("generation_run_id");