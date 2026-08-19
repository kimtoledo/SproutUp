# MVP 1 — Controlled Pilot

**Status: WIP**

MVP 1 is the smallest release that can complete one real SME loan from onboarding through investor payout, with manual operations allowed where automation is not essential. See [00-overview.md](./00-overview.md) for boundaries and release gates.

## Task checklist

- [ ] [01 — Platform Foundation](./01-platform-foundation.md) — initial monorepo, web/API health slice, shared contracts, database boundary, and CI implemented; infrastructure and financial foundations remain
- [ ] [02 — Authentication, RBAC & Audit](./02-auth-rbac-audit.md) — password/session boundary, canonical RBAC schema, throttling, and immutable audit foundation implemented; delivery-backed recovery/MFA and admin commands remain
- [ ] [03 — Borrower Onboarding & KYC](./03-borrower-onboarding-kyc.md)
- [ ] [04 — Investor Onboarding & KYC](./04-investor-onboarding-kyc.md)
- [ ] [05 — Document & Consent Management](./05-document-consent-management.md)
- [ ] [06 — Credit Scoring & Underwriting](./06-credit-scoring-underwriting.md)
- [ ] [07 — Campaign & Loan Management](./07-campaign-loan-management.md)
- [ ] [08 — Investor Commitments](./08-investor-commitments.md)
- [ ] [09 — Wallet Ledger & Bank Transfers](./09-wallet-ledger-bank-transfers.md)
- [ ] [10 — Disbursement & Financial Controls](./10-disbursement-controls.md)
- [ ] [11 — Repayment & Collections](./11-repayment-collections.md)
- [ ] [12 — Investor Distribution](./12-investor-distribution.md)
- [ ] [13 — Accounting & Tax Baseline](./13-accounting-tax-baseline.md)
- [ ] [14 — Notifications & Templates](./14-notifications-templates.md)
- [ ] [15 — Admin Operations & Reports](./15-admin-operations-reports.md)
- [ ] [16 — Migration, Reconciliation & Pilot Readiness](./16-migration-reconciliation-pilot.md)
- [ ] [17 — Legacy Schema Baseline & Data Mapping](./17-legacy-schema-data-mapping.md)
- [ ] [18 — API Contracts & Security Boundary](./18-api-contracts-security-boundary.md)
- [ ] [19 — Scheduler, Queues & Job Control](./19-scheduler-queues-job-control.md)
- [ ] [20 — Admin Information Architecture & Work Queues](./20-admin-information-architecture-work-queues.md)
- [ ] [21 — Borrower & Investor Portal Journeys](./21-borrower-investor-portal-journeys.md)
- [ ] [22 — Maker/Checker Approval Matrix](./22-maker-checker-approval-matrix.md)
- [ ] [23 — Cross-App Contract, Compatibility & Cutover](./23-cross-app-contract-cutover.md)

## Release rule

MVP 1 is not done when individual screens work. It is done only after an approved borrower and investor complete the full pilot flow and all money movements reconcile against the ledger and bank evidence.
