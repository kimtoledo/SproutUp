# 04 — Investor Onboarding & KYC

**Status:** WIP  
**Outcome:** An eligible investor can be verified, risk-assessed, and approved before funding campaigns.

## Implementation progress

- **2026-08-19 — Shared workflow foundation:** Added versioned `onboarding_cases` and append-only `onboarding_case_events` for borrower/investor journeys, including one-open-case enforcement, applicant/reviewer separation, correction, expiry, and immutable transition history.
- Email signup now requires borrower/investor intent and atomically maps investor intent only to the narrow `investor` role. The role receives own-case read/manage/submit capabilities; funding and withdrawal eligibility still depend on future approved onboarding state controls.
- Added the same protected own-case create/list/detail/submit boundary for the investor journey, with type-specific capability checks, SQL ownership binding, one-open-case enforcement, optimistic versioning, and immutable event/audit evidence.
- Investor cases now appear in the same capability-protected compliance queue and can be claimed for review with self-review/takeover denial and atomic reviewer/state/evidence updates; suitability/eligibility decisions remain unimplemented.
- Assigned reviewers can request information with a versioned reason, and the investor can resubmit the same owned case without losing assignment or immutable correction history.
- Staff can inspect investor case identity/current state and the complete ordered immutable transition/reason timeline through the queue-read capability.
- Investors can withdraw their own eligible open case with optimistic versioning and a required reason; the terminal state, event, and audit evidence remain immutable while allowing a later fresh journey.
- Investor subject classification, profile/evidence fields, suitability questionnaire versions, eligibility restrictions, bank verification, and decision APIs remain unimplemented because the individual/institutional pilot scope and approved rules are still open; this task stays **WIP**.

## Scope

- Investor profile, identity/address documents, bank account, declarations, and consent.
- Risk/suitability questionnaire and compliance review workflow.
- Investment eligibility status with restrictions, expiry, re-KYC, and suspension support.
- Approved settlement bank-account verification before withdrawal.

## Acceptance criteria

- Unapproved, expired, or suspended investors cannot commit funds or withdraw.
- Suitability answers and resulting eligibility are versioned and reviewable.
- Bank-account changes require verification and are fully audited.
- Investor restrictions are enforced by APIs, not only hidden in the interface.

## Legacy reference

- [User Accounts, KYC & Onboarding](../reference/legacy/domain-user-accounts-kyc.md) — CKA (`CKAV1Form`) and SAT/risk-profile (`AssessmentForm`) self-declared questionnaires with no automated pass/fail scoring; `EscrowRequiredValidator` income/net-asset source-of-wealth branching and accredited-investor `confirm_ai`/`confirm_wealth` gates; `Bank` model's pending → approved/rejected admin approval workflow (`Bank::approve()`/`reject()`); `UserLib::updateStatus()` as the admin-triggered eligibility approval gate.
- [Registration, Authentication & Onboarding](../reference/legacy/user/02-registration-auth-onboarding.md) — end-to-end onboarding journey (profile → KYC → CKA/SAT → pending review → admin approval) that investor eligibility status is derived from.

## Dependencies

- [02 — Authentication, RBAC & Audit](./02-auth-rbac-audit.md)
- Approved investor-classification and suitability rules.

## Open decisions

- Individual versus institutional investor support for the pilot.
- Investment limits and enhanced-due-diligence triggers.
