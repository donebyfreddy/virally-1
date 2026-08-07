ALTER TABLE "content_items" ADD COLUMN "tone" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "production_mode" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "generation_plan" jsonb;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "estimated_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "actual_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_production_mode_check" CHECK (production_mode is null or production_mode in ('fast', 'hybrid', 'cinematic'));--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_estimated_credits_check" CHECK (estimated_credits >= 0);--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_actual_credits_check" CHECK (actual_credits >= 0);