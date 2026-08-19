# 04 — Proposed Revamp Schema

**Status:** Proposed — implementation requires design review.

## Implementation status

The first reviewed identity, approval, onboarding-workflow, and durable-job slices were implemented on 2026-08-19: `users`, `sessions`, `accounts`, `verifications`, `rate_limits`, `roles`, `permissions`, `user_roles`, `role_permissions`, append-only `audit_events`, `approval_requests`, append-only `approval_actions`, `onboarding_cases`, append-only `onboarding_case_events`, `background_jobs`, and `background_job_attempts`. The remaining entities below are still proposed and must be introduced only through their owning MVP tasks.

This is a normalized domain outline for the Philippine revamp. It intentionally avoids copying legacy table names and duplicated summary tables.

## Identity and authorization

- `users` — login identity and global status
- `users.registration_intent` — implemented, nullable for controlled staff/bootstrap records and required by public email signup; only borrower/investor values
- `staff_profiles`, `investor_profiles`, `borrower_profiles`
- `roles`, `permissions`, `user_roles`, `role_permissions`
- `sessions`, `mfa_methods`, `auth_attempts`
- `audit_events` — append-only actor/action/resource/change metadata

## Parties, KYC, and documents

- `organizations`, `people`, `organization_members`
- `onboarding_cases`, `onboarding_case_events` — implemented workflow spine shared by borrower and investor journeys
- `kyc_cases`, `kyc_requirements`, `kyc_submissions`, `kyc_decisions`
- `screening_checks`, `risk_assessments`, `beneficial_owners`
- `documents`, `document_versions`, `consents`, `signature_envelopes`
- `bank_accounts`, `bank_account_verifications`

## Credit, campaigns, and contracts

- `credit_applications`, `credit_application_versions`
- `financial_statements`, `collateral_items`, `guarantors`
- `scorecards`, `scorecard_versions`, `credit_scores`, `credit_decisions`
- `campaigns`, `campaign_term_versions`, `campaign_events`
- `loans`, `loan_contracts`, `loan_schedules`, `loan_schedule_items`

## Investments and servicing

- `investment_commitments`, `investment_positions`
- `borrower_payments`, `payment_allocations`
- `collection_cases`, `collection_activities`, `penalty_assessments`
- `investor_distributions`, `distribution_lines`
- `withdrawal_requests`, `disbursement_requests`

## Ledger and reconciliation

- `ledger_accounts`
- `ledger_transactions` — posting group/header and idempotency identity
- `ledger_entries` — signed debit/credit lines with currency
- `fund_holds`, `hold_events`
- `payment_intents`, `provider_events`, `bank_statement_lines`
- `reconciliation_runs`, `reconciliation_matches`, `reconciliation_exceptions`

## Fees, tax, referral, and accounting

- `rule_sets`, `rule_versions` — rates, bases, thresholds, effective dates
- `fee_calculations`, `tax_calculations`, `tax_documents`
- `referral_relationships`, `referral_commissions`, `referral_payouts`
- `accounting_mappings`, `journal_batches`, `journal_lines`, `period_locks`

## Operations and communications

- `workflow_tasks`; `approval_requests` and `approval_actions` are implemented
- `background_jobs`, `background_job_attempts` — implemented provider-neutral durable work/outbox state; dead-letter state is represented on the job, while handler-specific business evidence remains in owning domains
- `notification_templates`, `notifications`, `delivery_attempts`
- `report_exports`, `data_import_runs`, `data_import_errors`

## Design rules

- Use stable opaque IDs and explicit foreign keys with indexes.
- Use exact decimal amounts and ISO currency codes; MVP 1 permits only PHP.
- PHP amount contracts use canonical two-decimal strings and exact runtime centavos; database money columns use the shared `numeric(30,2)` technical precision unless an owning task documents a stricter requirement.
- Use timestamps with a defined storage timezone plus separate business/value dates where required.
- Preserve immutable financial, approval, consent, and audit history.
- Keep configuration effective-dated so historical calculations are reproducible.
- Use unique idempotency constraints on external callbacks and financial commands.
- Avoid generic polymorphic `type/ref_id` links for core financial relationships where explicit foreign keys are possible.
- Derive reporting views from authoritative records; do not create competing financial sources of truth.
