# 04 — Proposed Revamp Schema

**Status:** Proposed — implementation requires design review.

## Implementation status

The first reviewed identity, approval, onboarding-workflow, durable-job, and generic ledger slices were implemented on 2026-08-19. On 2026-08-30, the portal-identity isolation work introduced separate admin, borrower, and investor account/auth relations, a protected global email registry, active `admin_role_grants` plus admin approval/reviewer foreign keys, and registry-anchored onboarding/document/consent/ledger ownership. Migration `0024` completes borrower/investor runtime isolation and retires the legacy unified auth/active customer-role boundary after exact reconciliation. The remaining entities below are still proposed and must be introduced only through their owning MVP tasks.

This is a normalized domain outline for the Philippine revamp. It intentionally avoids copying legacy table names and duplicated summary tables.

## Identity and authorization

- `account_email_registry` — implemented global normalized-email/account-id ownership across portals
- `admin_accounts`, `borrower_accounts`, `investor_accounts` — implemented separate account classes
- portal-specific credentials, sessions, verifications, rate limits, routes, cookies, and session
  contexts — implemented and active for all three account classes
- `admin_profiles`, `investor_profiles`
- `borrower_profiles`, `beneficial_owners` — **implemented (2026-08-30)**: versioned KYB capture
  (entity type, registration, authorized contact) plus a full-replace beneficial-owner list checked
  server-side against a 100% ownership total; required fields/documents per entity type remain an
  open decision (task 03)
- `roles`, `permissions`, `admin_role_grants`, `role_permissions` — staff RBAC implemented on the
  admin account boundary; historical customer role definitions are inactive evidence only
- `mfa_methods`, `auth_attempts`
- `audit_events` — append-only actor/action/resource/change metadata

## Parties, KYC, and documents

- `organizations`, `people`, `organization_members`
- `onboarding_cases`, `onboarding_case_events` — implemented workflow spine with registry-backed
  applicant/actor attribution and database-enforced borrower/investor case-class matching
- `kyc_cases`, `kyc_requirements`, `kyc_submissions`, `kyc_decisions`
- `screening_checks`, `risk_assessments` (`beneficial_owners` moved to Identity above — implemented)
- `documents`, `document_versions` — **implemented (2026-08-30)**: private file store with an
  owner, coarse classification, and a `purpose` tag; append-only versions whose identity/content
  columns are immutable and whose only mutable field is the malware-scan outcome. Byte storage is
  a swappable `FileStorage` port (in-memory / local-fs / future S3). See
  [`docs/DOCUMENTS.md`](../../docs/DOCUMENTS.md). `consents` — implemented earlier;
  `signature_envelopes` still proposed.
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

- `ledger_accounts` — generic stable account identity implemented; production chart/ownership remains proposed
- `ledger_transactions` — immutable posting header, idempotency/source/hash/reversal identity implemented
- `ledger_entries` — immutable positive debit/credit PHP lines with deferred exact balance enforcement implemented
- `fund_holds`, `hold_events`
- `payment_intents`, `provider_events`, `bank_statement_lines`
- `reconciliation_runs`, `reconciliation_matches`, `reconciliation_exceptions`

## Fees, tax, referral, and accounting

- `rule_sets`, `rule_versions` — **implemented (2026-08-30)**: effective-dated configuration
  catalogue plus immutable, effective-dated `jsonb` bodies with monotonic per-key versioning,
  append-only DB triggers, and a `resolve(key, at)` service. No rule bodies are seeded; each is
  published by its owning task. See [`docs/CONFIG.md`](../../docs/CONFIG.md).
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
