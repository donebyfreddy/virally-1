CREATE TABLE "generation_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"estimated_cents_per_unit" integer,
	"external_model_id" text NOT NULL,
	"change_reason" text NOT NULL,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_model_versions_model_version_unique" UNIQUE("model_id","version"),
	CONSTRAINT "generation_model_versions_version_check" CHECK (version >= 1),
	CONSTRAINT "generation_model_versions_cost_check" CHECK (estimated_cents_per_unit is null or estimated_cents_per_unit >= 0)
);
--> statement-breakpoint
CREATE TABLE "provider_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"capability" text,
	"requests_per_minute" integer NOT NULL,
	"max_concurrent" integer DEFAULT 8 NOT NULL,
	"max_concurrent_per_workspace" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_rate_limits_rpm_check" CHECK (requests_per_minute > 0),
	CONSTRAINT "provider_rate_limits_concurrency_check" CHECK (max_concurrent > 0 and max_concurrent_per_workspace > 0 and max_concurrent_per_workspace <= max_concurrent)
);
--> statement-breakpoint
ALTER TABLE "generation_models" DROP CONSTRAINT "generation_models_cost_check";--> statement-breakpoint
ALTER TABLE "provider_runs" DROP CONSTRAINT "provider_runs_state_check";--> statement-breakpoint
ALTER TABLE "provider_runs" DROP CONSTRAINT "provider_runs_completed_at_check";--> statement-breakpoint
ALTER TABLE "generation_models" ALTER COLUMN "estimated_cents_per_unit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "external_model_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "input_types" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "max_reference_images" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "supported_resolutions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "supports_negative_prompt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "supports_seed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "supports_audio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "deprecated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_models" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_model_versions" ADD CONSTRAINT "generation_model_versions_model_id_generation_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."generation_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_rate_limits" ADD CONSTRAINT "provider_rate_limits_provider_id_generation_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."generation_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_model_versions_model_idx" ON "generation_model_versions" USING btree ("model_id","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "provider_rate_limits_provider_wide_idx" ON "provider_rate_limits" USING btree ("provider_id") WHERE capability is null;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_rate_limits_capability_idx" ON "provider_rate_limits" USING btree ("provider_id","capability") WHERE capability is not null;--> statement-breakpoint
CREATE INDEX "generation_models_routable_idx" ON "generation_models" USING btree ("provider_id") WHERE enabled and deprecated_at is null and estimated_cents_per_unit is not null;--> statement-breakpoint
-- Backfill, hand-added to a generated migration.
--
-- Required, not cosmetic: Postgres validates a CHECK against existing rows when
-- it is added, and `generation_models_capabilities_check` below demands a
-- non-empty array. Every row already in this table predates the capabilities
-- column and would take the '[]' default, so without this the migration fails
-- on any database that has been seeded — which is all of them.
--
-- Capability is derived from `kind`, which is the only signal the old rows
-- carry. Both image capabilities and both video capabilities are assigned
-- because the endpoints already seeded genuinely accept optional references;
-- the seeder overwrites all of this with the catalogue's own values on its next
-- run, so these values only have to be correct, not final.
UPDATE "generation_models" SET "capabilities" =
  CASE "kind"
    WHEN 'image' THEN '["text-to-image","image-to-image"]'::jsonb
    WHEN 'video' THEN '["text-to-video","image-to-video"]'::jsonb
    ELSE CASE WHEN "id" LIKE '%music%' THEN '["music"]'::jsonb ELSE '["sound-effect"]'::jsonb END
  END
WHERE jsonb_array_length("capabilities") = 0;--> statement-breakpoint
UPDATE "generation_models" SET "input_types" =
  CASE WHEN "kind" = 'audio' THEN '["text"]'::jsonb ELSE '["text","image"]'::jsonb END
WHERE jsonb_array_length("input_types") = 0;--> statement-breakpoint
-- `endpoint_path` is what Magnific addresses a model by, so it IS the external
-- identifier for every pre-existing row. Left as the '' default it would break
-- invoice reconciliation, which joins on this column.
UPDATE "generation_models" SET "external_model_id" = "endpoint_path" WHERE "external_model_id" = '';--> statement-breakpoint
ALTER TABLE "generation_models" ADD CONSTRAINT "generation_models_max_reference_images_check" CHECK (max_reference_images >= 0);--> statement-breakpoint
ALTER TABLE "generation_models" ADD CONSTRAINT "generation_models_capabilities_check" CHECK (jsonb_typeof(capabilities) = 'array' and jsonb_array_length(capabilities) > 0);--> statement-breakpoint
ALTER TABLE "generation_models" ADD CONSTRAINT "generation_models_cost_check" CHECK (estimated_cents_per_unit is null or estimated_cents_per_unit >= 0);--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_state_check" CHECK (state in ('planned', 'queued', 'submitted', 'waiting_external', 'generating', 'downloading', 'validating', 'completed', 'failed', 'cancelled', 'dead_letter'));--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_completed_at_check" CHECK ((state in ('completed', 'failed', 'cancelled', 'dead_letter')) = (completed_at is not null));