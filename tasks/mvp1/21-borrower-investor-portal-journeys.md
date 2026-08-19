# 21 — Borrower & Investor Portal Journeys

**Status:** WIP  
**Outcome:** Borrowers and investors can complete the controlled-pilot lifecycle through coherent, accessible, state-driven portal experiences.

## Implementation progress

- **2026-08-19 — Onboarding state contract:** Added the shared borrower/investor case statuses and allowed transitions for draft, submission, review, information request/resubmission, approval/rejection, withdrawal, expiry, and reopening.
- The persistence layer versions current state and retains an immutable event timeline, providing the future portal with resumable/server-authoritative workflow state. Portal routes, forms, accessibility behavior, and end-to-end journeys remain; this task stays **WIP**.

## Scope

- Public eligibility, product explanation, disclosures, support, registration, login, recovery, and secure session flows.
- Resumable borrower and investor onboarding with progress, validation, document evidence, consent, correction, submission, and decision states.
- Investor marketplace, campaign detail, commitment confirmation, portfolio, repayment/distribution detail, contracts, and statements.
- Borrower application, staff questions, offer acceptance, funding progress, active loan schedule, payment instructions, receipts, and notices.
- Wallet top-up/withdrawal request, transaction history, bank management, notifications, and support entry points.
- Explicit next actions for incomplete, pending, approved, rejected, restricted, expired, overdue, and completed states.
- Philippine terminology and responsive/mobile accessibility.

## Acceptance criteria

- A pilot borrower and investor can complete their full journeys without hidden hash routes or staff-only workarounds.
- Refresh, retry, back navigation, and duplicate submission do not corrupt workflow state.
- All financial confirmations show gross amount, deductions, net amount, effective date, and reference.
- Documents and consents display the exact accepted version and timestamp.
- UI gating never substitutes for API authorization.
- Automated journey tests cover happy paths, corrections, rejection, insufficient funds, concurrency, and session expiry.

## Dependencies

- Tasks 01, 03–14, and 18.
- [Legacy user journey review](../reference/legacy/user/README.md).

## Open decisions

- Supported devices/browsers, bilingual content, borrower/investor dual capacity, notification channels, and assisted-onboarding policy.
