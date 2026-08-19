CREATE TYPE "public"."currency_code" AS ENUM('PHP');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."ledger_normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"normal_balance" "ledger_normal_balance" NOT NULL,
	"currency" "currency_code" DEFAULT 'PHP' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" "ledger_entry_direction" NOT NULL,
	"amount" numeric(30, 2) NOT NULL,
	"currency" "currency_code" DEFAULT 'PHP' NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_line_number_check" CHECK ("ledger_entries"."line_number" >= 1),
	CONSTRAINT "ledger_entries_positive_amount_check" CHECK ("ledger_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"source_type" varchar(120) NOT NULL,
	"source_id" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversal_of_transaction_id" uuid,
	"actor_user_id" uuid,
	"request_id" uuid,
	CONSTRAINT "ledger_transactions_payload_hash_check" CHECK ("ledger_transactions"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reversal_of_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_code_idx" ON "ledger_accounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_transaction_line_idx" ON "ledger_entries" USING btree ("transaction_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_transaction_account_idx" ON "ledger_entries" USING btree ("transaction_id","account_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idempotency_idx" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_one_reversal_idx" ON "ledger_transactions" USING btree ("reversal_of_transaction_id") WHERE "ledger_transactions"."reversal_of_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "ledger_transactions_source_idx" ON "ledger_transactions" USING btree ("source_type","source_id","posted_at");