CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"workspace_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"template_id" text,
	"steps_spec" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputs_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_definitions_version_check" CHECK (version >= 1),
	CONSTRAINT "workflow_definitions_scope_check" CHECK (workspace_id is null or organization_id is not null)
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_definition_id" uuid NOT NULL,
	"campaign_id" uuid,
	"content_item_id" uuid,
	"created_by" uuid,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"total_steps" integer NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_credits" integer DEFAULT 0 NOT NULL,
	"actual_credits" integer,
	"idempotency_key" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_idempotency_key_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "workflow_runs_current_step_check" CHECK (current_step_index >= 0),
	CONSTRAINT "workflow_runs_total_steps_check" CHECK (total_steps > 0),
	CONSTRAINT "workflow_runs_step_bounds_check" CHECK (current_step_index <= total_steps),
	CONSTRAINT "workflow_runs_estimated_credits_check" CHECK (estimated_credits >= 0),
	CONSTRAINT "workflow_runs_actual_credits_check" CHECK (actual_credits is null or actual_credits >= 0),
	CONSTRAINT "workflow_runs_completed_at_check" CHECK ((status in ('completed', 'failed', 'cancelled', 'dead_letter')) = (completed_at is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_step_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"job_id" uuid,
	"provider_run_id" uuid,
	"provider_id" text,
	"model_id" text,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"output_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_step_runs_step_attempt_unique" UNIQUE("workflow_step_id","attempt"),
	CONSTRAINT "workflow_step_runs_attempt_check" CHECK (attempt >= 1),
	CONSTRAINT "workflow_step_runs_cost_check" CHECK (cost_cents >= 0),
	CONSTRAINT "workflow_step_runs_credits_check" CHECK (credits_charged >= 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"capability" text,
	"label" text NOT NULL,
	"inputs_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_steps_run_position_unique" UNIQUE("workflow_run_id","position"),
	CONSTRAINT "workflow_steps_run_key_unique" UNIQUE("workflow_run_id","key"),
	CONSTRAINT "workflow_steps_position_check" CHECK (position >= 0),
	CONSTRAINT "workflow_steps_kind_check" CHECK (kind in ('generate_image', 'generate_video', 'generate_audio', 'generate_lipsync', 'upscale', 'language', 'compose', 'render', 'validate', 'export')),
	CONSTRAINT "workflow_steps_depends_on_check" CHECK (jsonb_typeof(depends_on) = 'array')
);
--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_global_slug_idx" ON "workflow_definitions" USING btree ("slug") WHERE organization_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_org_slug_idx" ON "workflow_definitions" USING btree ("organization_id","slug") WHERE organization_id is not null;--> statement-breakpoint
CREATE INDEX "workflow_definitions_enabled_idx" ON "workflow_definitions" USING btree ("organization_id") WHERE enabled;--> statement-breakpoint
CREATE INDEX "workflow_runs_workspace_idx" ON "workflow_runs" USING btree ("workspace_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "workflow_runs_pending_idx" ON "workflow_runs" USING btree ("status","created_at") WHERE status in ('pending', 'queued', 'running', 'waiting_external');--> statement-breakpoint
CREATE INDEX "workflow_runs_definition_idx" ON "workflow_runs" USING btree ("workflow_definition_id");--> statement-breakpoint
CREATE INDEX "workflow_step_runs_run_status_idx" ON "workflow_step_runs" USING btree ("workflow_run_id","status");--> statement-breakpoint
CREATE INDEX "workflow_step_runs_workspace_idx" ON "workflow_step_runs" USING btree ("workspace_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "workflow_step_runs_provider_run_idx" ON "workflow_step_runs" USING btree ("provider_run_id") WHERE provider_run_id is not null;--> statement-breakpoint
CREATE INDEX "workflow_steps_run_idx" ON "workflow_steps" USING btree ("workflow_run_id","position");