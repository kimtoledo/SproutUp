CREATE TYPE "public"."onboarding_actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."onboarding_case_status" AS ENUM('draft', 'submitted', 'in_review', 'needs_information', 'approved', 'rejected', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."onboarding_case_type" AS ENUM('borrower', 'investor');--> statement-breakpoint
CREATE TYPE "public"."onboarding_event_type" AS ENUM('created', 'submitted', 'review_started', 'information_requested', 'approved', 'rejected', 'withdrawn', 'reopened', 'expired');--> statement-breakpoint
CREATE TABLE "onboarding_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"event_type" "onboarding_event_type" NOT NULL,
	"from_status" "onboarding_case_status",
	"to_status" "onboarding_case_status" NOT NULL,
	"case_version" integer NOT NULL,
	"actor_type" "onboarding_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_case_events_positive_version" CHECK ("onboarding_case_events"."case_version" > 0),
	CONSTRAINT "onboarding_case_events_actor_identity" CHECK (("onboarding_case_events"."actor_type" = 'user' and "onboarding_case_events"."actor_user_id" is not null) or ("onboarding_case_events"."actor_type" = 'system' and "onboarding_case_events"."actor_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "onboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_type" "onboarding_case_type" NOT NULL,
	"status" "onboarding_case_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"assigned_reviewer_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_cases_positive_version" CHECK ("onboarding_cases"."version" > 0),
	CONSTRAINT "onboarding_cases_reviewer_separation" CHECK ("onboarding_cases"."assigned_reviewer_user_id" is null or "onboarding_cases"."assigned_reviewer_user_id" <> "onboarding_cases"."applicant_user_id")
);
--> statement-breakpoint
ALTER TABLE "onboarding_case_events" ADD CONSTRAINT "onboarding_case_events_case_id_onboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."onboarding_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_case_events" ADD CONSTRAINT "onboarding_case_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_assigned_reviewer_user_id_users_id_fk" FOREIGN KEY ("assigned_reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_case_events_case_idx" ON "onboarding_case_events" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "onboarding_case_events_actor_idx" ON "onboarding_case_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_cases_one_open_journey_idx" ON "onboarding_cases" USING btree ("applicant_user_id","case_type") WHERE "onboarding_cases"."status" in ('draft', 'submitted', 'in_review', 'needs_information');--> statement-breakpoint
CREATE INDEX "onboarding_cases_applicant_idx" ON "onboarding_cases" USING btree ("applicant_user_id","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_cases_review_queue_idx" ON "onboarding_cases" USING btree ("case_type","status","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_cases_reviewer_idx" ON "onboarding_cases" USING btree ("assigned_reviewer_user_id","status");