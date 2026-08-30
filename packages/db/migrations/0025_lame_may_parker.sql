CREATE TYPE "public"."borrower_entity_type" AS ENUM('sole_proprietorship', 'partnership', 'corporation');--> statement-breakpoint
CREATE TABLE "beneficial_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"borrower_profile_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"ownership_percentage" numeric(5, 2) NOT NULL,
	"nationality" varchar(80),
	"is_pep" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beneficial_owners_name_check" CHECK (length(btrim("beneficial_owners"."full_name")) > 0),
	CONSTRAINT "beneficial_owners_percentage_check" CHECK ("beneficial_owners"."ownership_percentage" > 0 and "beneficial_owners"."ownership_percentage" <= 100)
);
--> statement-breakpoint
CREATE TABLE "borrower_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"entity_type" "borrower_entity_type" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"registered_name" text NOT NULL,
	"trade_name" text,
	"registration_number" text,
	"tin" text,
	"principal_address" text,
	"contact_person_name" text,
	"contact_person_email" text,
	"contact_person_phone" text,
	"date_established" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "borrower_profiles_positive_version" CHECK ("borrower_profiles"."version" > 0),
	CONSTRAINT "borrower_profiles_registered_name_check" CHECK (length(btrim("borrower_profiles"."registered_name")) > 0),
	CONSTRAINT "borrower_profiles_contact_email_check" CHECK ("borrower_profiles"."contact_person_email" is null or "borrower_profiles"."contact_person_email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
--> statement-breakpoint
ALTER TABLE "beneficial_owners" ADD CONSTRAINT "beneficial_owners_borrower_profile_id_borrower_profiles_id_fk" FOREIGN KEY ("borrower_profile_id") REFERENCES "public"."borrower_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_profiles" ADD CONSTRAINT "borrower_profiles_case_id_onboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."onboarding_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beneficial_owners_profile_idx" ON "beneficial_owners" USING btree ("borrower_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "borrower_profiles_case_idx" ON "borrower_profiles" USING btree ("case_id");