CREATE TYPE "public"."portal_account_type" AS ENUM('admin', 'borrower', 'investor');--> statement-breakpoint
CREATE TABLE "account_email_registry" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"account_type" "portal_account_type" NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_email_registry_account_unique" UNIQUE("account_id"),
	CONSTRAINT "account_email_registry_normalized_email" CHECK ("account_email_registry"."email" = lower(btrim("account_email_registry"."email")))
);
--> statement-breakpoint
CREATE TABLE "admin_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) DEFAULT '' NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_accounts_normalized_email" CHECK ("admin_accounts"."email" = lower(btrim("admin_accounts"."email")))
);
--> statement-breakpoint
CREATE TABLE "admin_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_account_id" uuid NOT NULL,
	CONSTRAINT "admin_credentials_provider_account_unique" UNIQUE("provider_id","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "admin_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "admin_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"admin_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "admin_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "borrower_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) DEFAULT '' NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "borrower_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "borrower_accounts_normalized_email" CHECK ("borrower_accounts"."email" = lower(btrim("borrower_accounts"."email")))
);
--> statement-breakpoint
CREATE TABLE "borrower_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"borrower_account_id" uuid NOT NULL,
	CONSTRAINT "borrower_credentials_provider_account_unique" UNIQUE("provider_id","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "borrower_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "borrower_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "borrower_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"borrower_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "borrower_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "borrower_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investor_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) DEFAULT '' NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investor_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "investor_accounts_normalized_email" CHECK ("investor_accounts"."email" = lower(btrim("investor_accounts"."email")))
);
--> statement-breakpoint
CREATE TABLE "investor_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"investor_account_id" uuid NOT NULL,
	CONSTRAINT "investor_credentials_provider_account_unique" UNIQUE("provider_id","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "investor_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "investor_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "investor_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"investor_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investor_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "investor_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_credentials" ADD CONSTRAINT "admin_credentials_admin_account_id_admin_accounts_id_fk" FOREIGN KEY ("admin_account_id") REFERENCES "public"."admin_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_account_id_admin_accounts_id_fk" FOREIGN KEY ("admin_account_id") REFERENCES "public"."admin_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_credentials" ADD CONSTRAINT "borrower_credentials_borrower_account_id_borrower_accounts_id_fk" FOREIGN KEY ("borrower_account_id") REFERENCES "public"."borrower_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_sessions" ADD CONSTRAINT "borrower_sessions_borrower_account_id_borrower_accounts_id_fk" FOREIGN KEY ("borrower_account_id") REFERENCES "public"."borrower_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_credentials" ADD CONSTRAINT "investor_credentials_investor_account_id_investor_accounts_id_fk" FOREIGN KEY ("investor_account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_sessions" ADD CONSTRAINT "investor_sessions_investor_account_id_investor_accounts_id_fk" FOREIGN KEY ("investor_account_id") REFERENCES "public"."investor_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_accounts_status_idx" ON "admin_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "admin_credentials_account_idx" ON "admin_credentials" USING btree ("admin_account_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_account_idx" ON "admin_sessions" USING btree ("admin_account_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "admin_verifications_identifier_idx" ON "admin_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "borrower_accounts_status_idx" ON "borrower_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "borrower_credentials_account_idx" ON "borrower_credentials" USING btree ("borrower_account_id");--> statement-breakpoint
CREATE INDEX "borrower_sessions_account_idx" ON "borrower_sessions" USING btree ("borrower_account_id");--> statement-breakpoint
CREATE INDEX "borrower_sessions_expires_at_idx" ON "borrower_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "borrower_verifications_identifier_idx" ON "borrower_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "investor_accounts_status_idx" ON "investor_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "investor_credentials_account_idx" ON "investor_credentials" USING btree ("investor_account_id");--> statement-breakpoint
CREATE INDEX "investor_sessions_account_idx" ON "investor_sessions" USING btree ("investor_account_id");--> statement-breakpoint
CREATE INDEX "investor_sessions_expires_at_idx" ON "investor_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "investor_verifications_identifier_idx" ON "investor_verifications" USING btree ("identifier");