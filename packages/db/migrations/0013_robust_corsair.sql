CREATE TABLE "consent_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_document_id" uuid NOT NULL,
	"accepted_content_sha256" varchar(64) NOT NULL,
	"request_id" uuid,
	"ip_address_hash" varchar(64),
	"user_agent_hash" varchar(64),
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_acceptances_content_hash_check" CHECK ("consent_acceptances"."accepted_content_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "consent_acceptances_ip_hash_check" CHECK ("consent_acceptances"."ip_address_hash" is null or "consent_acceptances"."ip_address_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "consent_acceptances_user_agent_hash_check" CHECK ("consent_acceptances"."user_agent_hash" is null or "consent_acceptances"."user_agent_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "consent_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_key" varchar(120) NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"locale" varchar(20) DEFAULT 'en-PH' NOT NULL,
	"content" text NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_documents_key_check" CHECK ("consent_documents"."document_key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "consent_documents_positive_version" CHECK ("consent_documents"."version" > 0),
	CONSTRAINT "consent_documents_title_check" CHECK (length(btrim("consent_documents"."title")) > 0),
	CONSTRAINT "consent_documents_locale_check" CHECK ("consent_documents"."locale" ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
	CONSTRAINT "consent_documents_content_check" CHECK (length("consent_documents"."content") > 0),
	CONSTRAINT "consent_documents_content_hash_check" CHECK ("consent_documents"."content_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_consent_document_id_consent_documents_id_fk" FOREIGN KEY ("consent_document_id") REFERENCES "public"."consent_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_documents" ADD CONSTRAINT "consent_documents_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_acceptances_user_document_idx" ON "consent_acceptances" USING btree ("user_id","consent_document_id");--> statement-breakpoint
CREATE INDEX "consent_acceptances_user_time_idx" ON "consent_acceptances" USING btree ("user_id","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_documents_key_version_idx" ON "consent_documents" USING btree ("document_key","locale","version");--> statement-breakpoint
CREATE INDEX "consent_documents_effective_idx" ON "consent_documents" USING btree ("document_key","locale","effective_at");