CREATE TYPE "public"."campaign_actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."campaign_event_type" AS ENUM('created', 'submitted', 'published', 'sent_back', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."campaign_repayment_model" AS ENUM('amortized', 'interest_only');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'pending_approval', 'published', 'cancelled');--> statement-breakpoint
CREATE TABLE "campaign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"event_type" "campaign_event_type" NOT NULL,
	"from_status" "campaign_status",
	"to_status" "campaign_status" NOT NULL,
	"campaign_version" integer NOT NULL,
	"actor_type" "campaign_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_events_positive_version" CHECK ("campaign_events"."campaign_version" > 0),
	CONSTRAINT "campaign_events_actor_identity" CHECK (("campaign_events"."actor_type" = 'user' and "campaign_events"."actor_user_id" is not null) or ("campaign_events"."actor_type" = 'system' and "campaign_events"."actor_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_application_id" uuid NOT NULL,
	"borrower_case_id" uuid NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"loan_amount" numeric(14, 2) NOT NULL,
	"term_months" integer NOT NULL,
	"repayment_model" "campaign_repayment_model" NOT NULL,
	"borrower_annual_rate_percent" numeric(8, 4) NOT NULL,
	"investor_annual_rate_percent" numeric(8, 4) NOT NULL,
	"minimum_commitment_amount" numeric(14, 2) NOT NULL,
	"funding_window_days" integer NOT NULL,
	"first_repayment_due_date" date NOT NULL,
	"purpose_summary" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_positive_version" CHECK ("campaigns"."version" > 0),
	CONSTRAINT "campaigns_positive_loan_amount" CHECK ("campaigns"."loan_amount" > 0),
	CONSTRAINT "campaigns_positive_term" CHECK ("campaigns"."term_months" > 0),
	CONSTRAINT "campaigns_borrower_rate_range" CHECK ("campaigns"."borrower_annual_rate_percent" >= 0 and "campaigns"."borrower_annual_rate_percent" <= 100),
	CONSTRAINT "campaigns_investor_rate_range" CHECK ("campaigns"."investor_annual_rate_percent" >= 0 and "campaigns"."investor_annual_rate_percent" <= 100),
	CONSTRAINT "campaigns_investor_rate_not_above_borrower" CHECK ("campaigns"."investor_annual_rate_percent" <= "campaigns"."borrower_annual_rate_percent"),
	CONSTRAINT "campaigns_positive_minimum_commitment" CHECK ("campaigns"."minimum_commitment_amount" > 0),
	CONSTRAINT "campaigns_minimum_commitment_within_loan" CHECK ("campaigns"."minimum_commitment_amount" <= "campaigns"."loan_amount"),
	CONSTRAINT "campaigns_positive_funding_window" CHECK ("campaigns"."funding_window_days" > 0),
	CONSTRAINT "campaigns_purpose_summary_check" CHECK (length(btrim("campaigns"."purpose_summary")) > 0),
	CONSTRAINT "campaigns_submitted_pairing" CHECK (("campaigns"."submitted_by_user_id" is null and "campaigns"."submitted_at" is null) or ("campaigns"."submitted_by_user_id" is not null and "campaigns"."submitted_at" is not null)),
	CONSTRAINT "campaigns_published_pairing" CHECK (("campaigns"."published_by_user_id" is null and "campaigns"."published_at" is null) or ("campaigns"."published_by_user_id" is not null and "campaigns"."published_at" is not null)),
	CONSTRAINT "campaigns_cancelled_pairing" CHECK (("campaigns"."cancelled_by_user_id" is null and "campaigns"."cancelled_at" is null) or ("campaigns"."cancelled_by_user_id" is not null and "campaigns"."cancelled_at" is not null)),
	CONSTRAINT "campaigns_dual_control" CHECK ("campaigns"."published_by_user_id" is null or "campaigns"."submitted_by_user_id" is null or "campaigns"."published_by_user_id" <> "campaigns"."submitted_by_user_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_actor_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_credit_application_id_credit_applications_id_fk" FOREIGN KEY ("credit_application_id") REFERENCES "public"."credit_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_borrower_case_id_onboarding_cases_id_fk" FOREIGN KEY ("borrower_case_id") REFERENCES "public"."onboarding_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_submitted_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_published_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_cancelled_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_events_campaign_idx" ON "campaign_events" USING btree ("campaign_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_one_open_per_application_idx" ON "campaigns" USING btree ("credit_application_id") WHERE "campaigns"."status" in ('draft', 'pending_approval', 'published');--> statement-breakpoint
CREATE INDEX "campaigns_borrower_case_idx" ON "campaigns" USING btree ("borrower_case_id");--> statement-breakpoint
CREATE INDEX "campaigns_queue_idx" ON "campaigns" USING btree ("status","created_at");