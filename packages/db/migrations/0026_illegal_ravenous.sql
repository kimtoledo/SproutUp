CREATE TABLE "investor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date,
	"nationality" varchar(80),
	"government_id_type" text,
	"government_id_number" text,
	"residential_address" text,
	"phone_number" text,
	"occupation" text,
	"source_of_funds" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investor_profiles_positive_version" CHECK ("investor_profiles"."version" > 0),
	CONSTRAINT "investor_profiles_full_name_check" CHECK (length(btrim("investor_profiles"."full_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_case_id_onboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."onboarding_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investor_profiles_case_idx" ON "investor_profiles" USING btree ("case_id");