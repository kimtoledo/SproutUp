CREATE TABLE "rule_sets" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_sets_key_check" CHECK ("rule_sets"."key" ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
	CONSTRAINT "rule_sets_description_check" CHECK (length(btrim("rule_sets"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" varchar(120) NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"body" jsonb NOT NULL,
	"note" text,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_versions_positive_version" CHECK ("rule_versions"."version" > 0),
	CONSTRAINT "rule_versions_body_is_object" CHECK (jsonb_typeof("rule_versions"."body") = 'object')
);
--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_key_rule_sets_key_fk" FOREIGN KEY ("rule_key") REFERENCES "public"."rule_sets"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_key_version_idx" ON "rule_versions" USING btree ("rule_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_key_effective_idx" ON "rule_versions" USING btree ("rule_key","effective_from");--> statement-breakpoint
CREATE INDEX "rule_versions_resolve_idx" ON "rule_versions" USING btree ("rule_key","effective_from");