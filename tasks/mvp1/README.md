# MVP 1 — Controlled Pilot

**Status: WIP**

MVP 1 is the smallest release that can complete one real SME loan from onboarding through investor payout, with manual operations allowed where automation is not essential. See [00-overview.md](./00-overview.md) for boundaries and release gates.

## Task checklist

- [ ] [01 — Platform Foundation](./01-platform-foundation.md) — monorepo, web/API health, shared contracts, database/CI, auth/audit, jobs, exact PHP money, balanced append-only ledger schema, posting, reversal, and exact internal account projection implemented; production infrastructure and remaining services remain
- [ ] [02 — Authentication, RBAC & Audit](./02-auth-rbac-audit.md) — password/session boundary, registration/login UI, audited customer-intent bootstrap, access catalogue, own-session revocation, canonical RBAC, immutable audit, and dual-controlled role changes implemented; recovery/MFA and remaining controls remain
- [ ] [03 — Borrower Onboarding & KYC](./03-borrower-onboarding-kyc.md) — protected case lifecycle, assigned-reviewer rejection, and own portal case actions implemented; Philippine profile, evidence, completeness, and approval remain
- [ ] [04 — Investor Onboarding & KYC](./04-investor-onboarding-kyc.md) — protected case lifecycle, assigned-reviewer rejection, and own portal case actions implemented; classification, suitability, bank, completeness, approval, and eligibility controls remain
- [ ] [05 — Document & Consent Management](./05-document-consent-management.md) — immutable versioned consent evidence plus internal publication/effective-read/exact-acceptance services implemented; legal content, routes/policy, private files, retention, and e-signatures remain
- [ ] [06 — Credit Scoring & Underwriting](./06-credit-scoring-underwriting.md)
- [ ] [07 — Campaign & Loan Management](./07-campaign-loan-management.md)
- [ ] [08 — Investor Commitments](./08-investor-commitments.md)
- [ ] [09 — Wallet Ledger & Bank Transfers](./09-wallet-ledger-bank-transfers.md) — exact PHP, balanced append-only generic ledger, audited posting/reversal, and exact internal account projection implemented; chart/ownership/holds, transfer workflow, public projections, approved calculations, and reconciliation remain
- [ ] [10 — Disbursement & Financial Controls](./10-disbursement-controls.md)
- [ ] [11 — Repayment & Collections](./11-repayment-collections.md)
- [ ] [12 — Investor Distribution](./12-investor-distribution.md)
- [ ] [13 — Accounting & Tax Baseline](./13-accounting-tax-baseline.md)
- [ ] [14 — Notifications & Templates](./14-notifications-templates.md)
- [ ] [15 — Admin Operations & Reports](./15-admin-operations-reports.md)
- [ ] [16 — Migration, Reconciliation & Pilot Readiness](./16-migration-reconciliation-pilot.md)
- [ ] [17 — Legacy Schema Baseline & Data Mapping](./17-legacy-schema-data-mapping.md)
- [ ] [18 — API Contracts & Security Boundary](./18-api-contracts-security-boundary.md) — every current application-owned operation has an enforced CI-validated OpenAPI 3.1 contract and `/v1` compatibility/retirement policy; future domain, file, and webhook contracts remain
- [ ] [19 — Scheduler, Queues & Job Control](./19-scheduler-queues-job-control.md) — persistence/control/runtime and policy-gated MVP job catalogue implemented; all production topics remain blocked or intentionally synchronous pending their owning domains/providers
- [ ] [20 — Admin Information Architecture & Work Queues](./20-admin-information-architecture-work-queues.md) — bounded compliance queue UI/API with safe claim/resume, information request, detail, and rejection implemented; approval policy, richer detail, and remaining domain queues remain
- [ ] [21 — Borrower & Investor Portal Journeys](./21-borrower-investor-portal-journeys.md) — public auth entry plus permission-driven onboarding actions and immutable case timeline UI implemented; profile/evidence screens and complete end-to-end journeys remain
- [ ] [22 — Maker/Checker Approval Matrix](./22-maker-checker-approval-matrix.md) — hash-bound role grant/revocation, reject/cancel, and history/detail implemented; domain matrix, amendment, and emergency paths remain
- [ ] [23 — Cross-App Contract, Compatibility & Cutover](./23-cross-app-contract-cutover.md)

## Release rule

MVP 1 is not done when individual screens work. It is done only after an approved borrower and investor complete the full pilot flow and all money movements reconcile against the ledger and bank evidence.
