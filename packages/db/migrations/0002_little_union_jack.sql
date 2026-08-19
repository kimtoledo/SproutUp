CREATE TYPE "public"."approval_action" AS ENUM('proposed', 'approved', 'executed', 'rejected', 'cancelled', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'executed', 'rejected', 'cancelled', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"action" "approval_action" NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_type" varchar(120) NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"maker_user_id" uuid NOT NULL,
	"checker_user_id" uuid,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_maker_user_id_users_id_fk" FOREIGN KEY ("maker_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_checker_user_id_users_id_fk" FOREIGN KEY ("checker_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_actions_request_idx" ON "approval_actions" USING btree ("request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "approval_actions_actor_idx" ON "approval_actions" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "approval_requests_status_expiry_idx" ON "approval_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "approval_requests_maker_idx" ON "approval_requests" USING btree ("maker_user_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_command_idx" ON "approval_requests" USING btree ("command_type","created_at");