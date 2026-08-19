CREATE TYPE "public"."background_job_attempt_outcome" AS ENUM('succeeded', 'retry_scheduled', 'dead_lettered', 'lease_expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."background_job_status" AS ENUM('pending', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'cancelled');--> statement-breakpoint
CREATE TABLE "background_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"worker_id" varchar(200) NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"outcome" "background_job_attempt_outcome",
	"error_code" varchar(120),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "background_job_attempts_number_check" CHECK ("background_job_attempts"."attempt_number" >= 1),
	CONSTRAINT "background_job_attempts_finish_check" CHECK (("background_job_attempts"."outcome" is null) = ("background_job_attempts"."finished_at" is null))
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" varchar(120) NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"status" "background_job_status" DEFAULT 'pending' NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(200),
	"lease_expires_at" timestamp with time zone,
	"last_error_code" varchar(120),
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_jobs_priority_check" CHECK ("background_jobs"."priority" between 0 and 1000),
	CONSTRAINT "background_jobs_attempts_check" CHECK ("background_jobs"."max_attempts" between 1 and 100 and "background_jobs"."attempt_count" between 0 and "background_jobs"."max_attempts"),
	CONSTRAINT "background_jobs_lease_pair_check" CHECK (("background_jobs"."lease_owner" is null) = ("background_jobs"."lease_expires_at" is null)),
	CONSTRAINT "background_jobs_processing_lease_check" CHECK (("background_jobs"."status" = 'processing' and "background_jobs"."lease_owner" is not null) or ("background_jobs"."status" <> 'processing' and "background_jobs"."lease_owner" is null)),
	CONSTRAINT "background_jobs_terminal_time_check" CHECK (("background_jobs"."status" = 'succeeded' and "background_jobs"."completed_at" is not null and "background_jobs"."cancelled_at" is null)
        or ("background_jobs"."status" = 'cancelled' and "background_jobs"."cancelled_at" is not null and "background_jobs"."completed_at" is null)
        or ("background_jobs"."status" not in ('succeeded', 'cancelled') and "background_jobs"."completed_at" is null and "background_jobs"."cancelled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "background_job_attempts" ADD CONSTRAINT "background_job_attempts_job_id_background_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "background_job_attempts_job_number_idx" ON "background_job_attempts" USING btree ("job_id","attempt_number");--> statement-breakpoint
CREATE INDEX "background_job_attempts_worker_idx" ON "background_job_attempts" USING btree ("worker_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_idempotency_idx" ON "background_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("status","available_at","priority","created_at");--> statement-breakpoint
CREATE INDEX "background_jobs_lease_expiry_idx" ON "background_jobs" USING btree ("status","lease_expires_at");