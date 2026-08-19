# 03 — Borrower Onboarding & KYC

**Status:** WIP  
**Outcome:** An SME can submit a Philippine borrower profile for compliant review and approval.

## Implementation progress

- **2026-08-19 — Shared workflow foundation:** Added versioned `onboarding_cases` and append-only `onboarding_case_events` for borrower/investor journeys, without encoding unresolved entity types, required fields/documents, or provider policy.
- The database permits one open borrower case per user, separates applicant/reviewer identities, and preserves every state transition. The shared state machine supports draft → submitted → review → information/decision plus correction/re-KYC reopening.
- Email signup now accepts only an explicit borrower/investor intent and atomically maps borrower intent to the narrow `sme_borrower` customer role. That role receives own-case read/manage/submit capabilities but no staff review permission.
- Added protected own-case create/list/detail/submit APIs. They bind ownership in database queries, enforce the borrower journey capability, prevent duplicate open cases, require optimistic version matches, and atomically append transition/audit evidence.
- Added the first staff compliance queue and review-start command with separate read/review capabilities, bounded filters, applicant/reviewer separation, optimistic versioning, assignment ownership, and immutable transition/audit evidence.
- Added reasoned information requests restricted to the assigned reviewer plus applicant resubmission on the same case/version timeline, meeting the correction-without-duplicate-account foundation.
- Added a capability-protected staff case detail with applicant identity context and the complete ordered immutable transition/reason timeline.
- Borrowers can withdraw their own `draft`, `submitted`, or `needs_information` case with an exact version and reason. The terminal event/audit trail is retained and a later fresh journey can use the released one-open-case slot.
- The assigned compliance reviewer can reject an `in_review` case with an exact version and reason; decision timestamp, transition, and audit evidence commit atomically. Approval is intentionally unavailable.
- The authenticated portal now renders the server-granted borrower journey, lists owned cases, starts a draft, submits/resubmits the displayed version, and performs reasoned withdrawal. Profile/evidence forms remain absent.
- Borrowers can expand an owned case to view its ordered immutable state/version timeline and reasons for information requests, withdrawal, or terminal decisions.
- No borrower profile, KYB evidence, completeness rules, or approval command is implemented yet; this task stays **WIP** pending the Philippine entity/document matrix and screening/escalation policy.

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
