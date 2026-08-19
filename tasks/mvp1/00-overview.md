# MVP 1 — Controlled Pilot Overview

**Status:** WIP  
**Goal:** Safely operate a limited Philippine SME lending pilot end to end.

## Included

- Staff authentication, role-based access, and audit history
- SME and investor registration, KYC, review, and approval
- Document submission, consent, and signed loan artifacts
- Credit evaluation and manual approval workflow
- Campaign publication and investor commitments
- Manual bank-transfer funding, wallet holds, and immutable ledger entries
- Controlled loan disbursement with maker-checker approval
- Amortized and interest-only repayment schedules
- Repayment collection and automatic pro-rata investor distribution
- Baseline Philippine fee/tax configuration and reconciliation reports
- Transactional email/SMS and essential admin dashboards
- Controlled legacy-data migration needed for the pilot
- Versioned API contracts and explicit security boundaries
- Observable scheduler, queue, retry, and job-recovery controls
- Verified legacy schema baseline and approved field-level migration mapping
- Role-scoped admin work queues and linked operational records
- Coherent borrower and investor portal journeys
- Explicit maker/checker approval matrix for high-risk commands
- Cross-application contract compatibility and controlled cutover

## Deliberately deferred

- Automated payment-gateway payouts and broad cash-in channel coverage
- Auto-invest
- Referral commissions
- Xero/QuickBooks connections
- Secondary-market trading
- Marketing campaigns, loyalty tiers, vouchers, and multi-level commissions

## Pilot constraints

- PHP only
- One operating entity and one primary settlement bank
- Manual bank verification, cash-in approval, and payout execution are acceptable
- Limited approved borrowers and investors
- No feature may bypass the append-only ledger or dual-control rules

## Release gates

- Philippine legal/compliance owners approve the onboarding and transaction controls.
- Finance approves the chart of accounts, fee/tax configuration, rounding, and reconciliation outputs.
- Critical calculations have deterministic tests using approved examples.
- Every privileged and financial action is attributable to a user and timestamp.
- A full dry run reconciles registration → funding → disbursement → repayment → investor payout.
