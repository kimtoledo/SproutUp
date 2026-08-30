CREATE TYPE "public"."credit_application_actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."credit_application_event_type" AS ENUM('created', 'submitted', 'review_started', 'information_requested', 'recommended', 'approved', 'rejected', 'withdrawn', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."credit_application_status" AS ENUM('draft', 'submitted', 'in_review', 'needs_information', 'recommended', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."credit_collateral_type" AS ENUM('real_estate', 'inventory', 'invoice', 'other');--> statement-breakpoint
CREATE TYPE "public"."credit_guarantor_residency" AS ENUM('local', 'permanent_resident', 'foreign');--> statement-breakpoint
CREATE TABLE "credit_application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"event_type" "credit_application_event_type" NOT NULL,
	"from_status" "credit_application_status",
	"to_status" "credit_application_status" NOT NULL,
	"application_version" integer NOT NULL,
	"actor_type" "credit_application_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_application_events_positive_version" CHECK ("credit_application_events"."application_version" > 0),
	CONSTRAINT "credit_application_events_actor_identity" CHECK (("credit_application_events"."actor_type" = 'user' and "credit_application_events"."actor_user_id" is not null) or ("credit_application_events"."actor_type" = 'system' and "credit_application_events"."actor_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "credit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"borrower_case_id" uuid NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"status" "credit_application_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"requested_amount" numeric(14, 2) NOT NULL,
	"term_months" integer NOT NULL,
	"purpose" text NOT NULL,
	"industry" text,
	"company_employees" integer,
	"ownership_date" date,
	"is_audited" boolean DEFAULT false NOT NULL,
	"last_year1_sales_revenue" numeric(14, 2),
	"last_year1_gross_profit" numeric(14, 2),
	"last_year1_net_profit" numeric(14, 2),
	"last_year2_sales_revenue" numeric(14, 2),
	"last_year2_gross_profit" numeric(14, 2),
	"last_year2_net_profit" numeric(14, 2),
	"bankruptcy_history" boolean DEFAULT false NOT NULL,
	"bankruptcy_discharged" boolean,
	"bankruptcy_year" integer,
	"assigned_analyst_user_id" uuid,
	"recommendation_narrative" text,
	"recommended_amount" numeric(14, 2),
	"recommended_term_months" integer,
	"recommended_by_user_id" uuid,
	"recommended_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"approved_amount" numeric(14, 2),
	"approved_term_months" integer,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_applications_positive_version" CHECK ("credit_applications"."version" > 0),
	CONSTRAINT "credit_applications_positive_amount" CHECK ("credit_applications"."requested_amount" > 0),
	CONSTRAINT "credit_applications_positive_term" CHECK ("credit_applications"."term_months" > 0),
	CONSTRAINT "credit_applications_purpose_check" CHECK (length(btrim("credit_applications"."purpose")) > 0),
	CONSTRAINT "credit_applications_bankruptcy_pairing" CHECK ("credit_applications"."bankruptcy_history" = true or ("credit_applications"."bankruptcy_discharged" is null and "credit_applications"."bankruptcy_year" is null)),
	CONSTRAINT "credit_applications_recommendation_pairing" CHECK (("credit_applications"."recommended_by_user_id" is null and "credit_applications"."recommended_at" is null) or ("credit_applications"."recommended_by_user_id" is not null and "credit_applications"."recommended_at" is not null)),
	CONSTRAINT "credit_applications_decision_pairing" CHECK (("credit_applications"."decided_by_user_id" is null and "credit_applications"."decided_at" is null) or ("credit_applications"."decided_by_user_id" is not null and "credit_applications"."decided_at" is not null)),
	CONSTRAINT "credit_applications_dual_control" CHECK ("credit_applications"."decided_by_user_id" is null or "credit_applications"."recommended_by_user_id" is null or "credit_applications"."decided_by_user_id" <> "credit_applications"."recommended_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "credit_collateral_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"collateral_type" "credit_collateral_type" NOT NULL,
	"description" text NOT NULL,
	"estimated_value" numeric(14, 2) NOT NULL,
	"outstanding_loan" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_collateral_items_positive_value" CHECK ("credit_collateral_items"."estimated_value" > 0),
	CONSTRAINT "credit_collateral_items_outstanding_loan_check" CHECK ("credit_collateral_items"."outstanding_loan" is null or "credit_collateral_items"."outstanding_loan" >= 0),
	CONSTRAINT "credit_collateral_items_description_check" CHECK (length(btrim("credit_collateral_items"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_guarantors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"residency_status" "credit_guarantor_residency" NOT NULL,
	"assessed_net_worth" numeric(14, 2),
	"assessment_year" integer,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_guarantors_name_check" CHECK (length(btrim("credit_guarantors"."full_name")) > 0),
	CONSTRAINT "credit_guarantors_net_worth_check" CHECK ("credit_guarantors"."assessed_net_worth" is null or "credit_guarantors"."assessed_net_worth" >= 0)
);
--> statement-breakpoint
ALTER TABLE "credit_application_events" ADD CONSTRAINT "credit_application_events_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_application_events" ADD CONSTRAINT "credit_application_events_actor_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_borrower_case_id_onboarding_cases_id_fk" FOREIGN KEY ("borrower_case_id") REFERENCES "public"."onboarding_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_applicant_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_assigned_analyst_user_id_admin_accounts_id_fk" FOREIGN KEY ("assigned_analyst_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_recommended_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("recommended_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_decided_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_collateral_items" ADD CONSTRAINT "credit_collateral_items_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_guarantors" ADD CONSTRAINT "credit_guarantors_application_id_credit_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_application_events_application_idx" ON "credit_application_events" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_applications_one_open_per_case_idx" ON "credit_applications" USING btree ("borrower_case_id") WHERE "credit_applications"."status" in ('draft', 'submitted', 'in_review', 'needs_information', 'recommended');--> statement-breakpoint
CREATE INDEX "credit_applications_applicant_idx" ON "credit_applications" USING btree ("applicant_user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_applications_queue_idx" ON "credit_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "credit_applications_analyst_idx" ON "credit_applications" USING btree ("assigned_analyst_user_id","status");--> statement-breakpoint
CREATE INDEX "credit_collateral_items_application_idx" ON "credit_collateral_items" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "credit_guarantors_application_idx" ON "credit_guarantors" USING btree ("application_id");