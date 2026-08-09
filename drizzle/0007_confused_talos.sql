ALTER TABLE "content_items" ADD COLUMN "generation_status" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "generation_error_code" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "generation_error_message" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "generation_error_stage" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "generation_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "generation_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_generation_status_check" CHECK (generation_status is null or generation_status in ('planned', 'queued', 'generating', 'rendering', 'ready', 'failed', 'cancelled'));