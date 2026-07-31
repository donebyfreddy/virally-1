CREATE TABLE "credit_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"campaign_id" uuid,
	"purpose" text NOT NULL,
	"credits_reserved" integer NOT NULL,
	"credits_charged" integer,
	"state" text DEFAULT 'held' NOT NULL,
	"provider_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_reservations_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "credit_reservations_reserved_check" CHECK (credits_reserved > 0),
	CONSTRAINT "credit_reservations_charged_check" CHECK (credits_charged is null or (credits_charged >= 0 and credits_charged <= credits_reserved)),
	CONSTRAINT "credit_reservations_state_check" CHECK (state in ('held', 'settled', 'released', 'expired')),
	CONSTRAINT "credit_reservations_settled_check" CHECK ((state = 'held') = (settled_at is null)),
	CONSTRAINT "credit_reservations_settled_charge_check" CHECK ((state = 'settled') = (credits_charged is not null))
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_code" text NOT NULL,
	"key" text NOT NULL,
	"limit_value" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_entitlements_plan_key_unique" UNIQUE("plan_code","key"),
	CONSTRAINT "plan_entitlements_limit_check" CHECK (limit_value is null or limit_value >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"price_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"included_credits" integer DEFAULT 0 NOT NULL,
	"emphasised" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"requires_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_price_check" CHECK (price_cents is null or price_cents >= 0),
	CONSTRAINT "subscription_plans_credits_check" CHECK (included_credits >= 0),
	CONSTRAINT "subscription_plans_interval_check" CHECK (interval in ('month', 'year')),
	CONSTRAINT "subscription_plans_contact_check" CHECK ((requires_contact and price_cents is null) or (not requires_contact and price_cents is not null))
);
--> statement-breakpoint
CREATE TABLE "top_up_packages" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"credits" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"external_price_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "top_up_packages_credits_check" CHECK (credits > 0),
	CONSTRAINT "top_up_packages_price_check" CHECK (price_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"credits_granted" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_subscriptions_period_check" CHECK (period_end > period_start),
	CONSTRAINT "workspace_subscriptions_credits_check" CHECK (credits_granted >= 0)
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_reason_check";--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_code_subscription_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."subscription_plans"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_plan_code_subscription_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."subscription_plans"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_reservations_org_state_idx" ON "credit_reservations" USING btree ("organization_id","state","created_at" desc);--> statement-breakpoint
CREATE INDEX "credit_reservations_expiry_idx" ON "credit_reservations" USING btree ("expires_at") WHERE state = 'held';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscriptions_period_idx" ON "workspace_subscriptions" USING btree ("organization_id","period_start");--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_hold_sign_check" CHECK ((reason <> 'reservation_hold' or delta < 0) and (reason <> 'reservation_release' or delta > 0));--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_reason_check" CHECK (reason in ('plan_grant', 'top_up', 'consumption', 'refund', 'adjustment', 'expiry', 'reservation_hold', 'reservation_release'));