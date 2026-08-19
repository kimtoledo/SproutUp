# 03 — Borrower Onboarding & KYC

**Status:** WIP  
**Outcome:** An SME can submit a Philippine borrower profile for compliant review and approval.

## Implementation progress

- **2026-08-19 — Shared workflow foundation:** Added versioned `onboarding_cases` and append-only `onboarding_case_events` for borrower/investor journeys, without encoding unresolved entity types, required fields/documents, or provider policy.
- The database permits one open borrower case per user, separates applicant/reviewer identities, and preserves every state transition. The shared state machine supports draft → submitted → review → information/decision plus correction/re-KYC reopening.
- No borrower profile, KYB evidence, compliance queue API, or decision command is implemented yet; this task stays **WIP** pending the Philippine entity/document matrix and screening/escalation policy.

## Scope

- Company registration, authorized representative, beneficial-owner, director, address, and contact details.
- KYC/KYB document checklist, declarations, consent, application progress, and resubmission.
- Compliance work queue with approve, reject, request-information, and reason history.
- Eligibility gating so an unapproved borrower cannot create or publish a campaign.

## Acceptance criteria

- Required fields and documents vary by approved borrower/entity type.
- Every submission and decision is timestamped, attributable, and retained.
- Rejected or incomplete applications can be corrected without creating duplicate accounts.
- Sensitive personal and company information is access-controlled and encrypted as required.
- Singapore/MAS-specific legacy rules are not used unless separately approved.

## Dependencies

- [02 — Authentication, RBAC & Audit](./02-auth-rbac-audit.md) — the compliance work queue and approve/reject/request-information actions require authenticated, role-scoped staff access.

## Legacy reference

- [User Accounts, KYC & Onboarding](../reference/legacy/domain-user-accounts-kyc.md)

## Open decisions

- Supported Philippine entity types and required documents.
- AML/sanctions provider, screening cadence, retention, and escalation policy.
