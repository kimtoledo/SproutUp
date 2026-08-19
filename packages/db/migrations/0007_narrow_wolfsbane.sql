CREATE TYPE "public"."registration_intent" AS ENUM('borrower', 'investor');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "registration_intent" "registration_intent";