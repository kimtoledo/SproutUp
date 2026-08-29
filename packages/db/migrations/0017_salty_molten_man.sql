CREATE TYPE "public"."document_classification" AS ENUM('kyc_identity', 'kyc_address', 'kyc_business', 'financial', 'contract', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_scan_state" AS ENUM('pending', 'clean', 'infected', 'error');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"byte_size" bigint NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"scan_state" "document_scan_state" DEFAULT 'pending' NOT NULL,
	"scanned_at" timestamp with time zone,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_until" timestamp with time zone,
	CONSTRAINT "document_versions_positive_version" CHECK ("document_versions"."version" > 0),
	CONSTRAINT "document_versions_positive_size" CHECK ("document_versions"."byte_size" > 0),
	CONSTRAINT "document_versions_hash_check" CHECK ("document_versions"."content_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "document_versions_scanned_pairing" CHECK (("document_versions"."scan_state" = 'pending' and "document_versions"."scanned_at" is null) or ("document_versions"."scan_state" <> 'pending' and "document_versions"."scanned_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"classification" "document_classification" NOT NULL,
	"purpose" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_purpose_check" CHECK ("documents"."purpose" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_version_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_storage_key_idx" ON "document_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_user_id","classification");