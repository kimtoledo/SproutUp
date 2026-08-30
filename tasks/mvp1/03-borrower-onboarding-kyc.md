# 03 — Borrower Onboarding & KYC

**Status:** WIP  
**Outcome:** An SME can submit a Philippine borrower profile for compliant review and approval.

## Implementation progress

- **2026-08-19 — Shared workflow foundation:** Added versioned `onboarding_cases` and append-only `onboarding_case_events` for borrower/investor journeys, without encoding unresolved entity types, required fields/documents, or provider policy.
- The database permits one open borrower case per user, separates applicant/reviewer identities, and preserves every state transition. The shared state machine supports draft → submitted → review → information/decision plus correction/re-KYC reopening.
- Borrower signup now writes only `borrower_accounts` and its matching auth tables through
  `/v1/auth/borrower/*`. The active account class receives fixed own-case capabilities but no staff
  review permission; no borrower RBAC grant is created.
- Added protected own-case create/list/detail/submit APIs. They bind ownership in database queries, enforce the borrower journey capability, prevent duplicate open cases, require optimistic version matches, and atomically append transition/audit evidence.
- Added the first staff compliance queue and review-start command with separate read/review capabilities, bounded filters, applicant/reviewer separation, optimistic versioning, assignment ownership, and immutable transition/audit evidence.
- Added reasoned information requests restricted to the assigned reviewer plus applicant resubmission on the same case/version timeline, meeting the correction-without-duplicate-account foundation.
- Added a capability-protected staff case detail with applicant identity context and the complete ordered immutable transition/reason timeline.
- Borrowers can withdraw their own `draft`, `submitted`, or `needs_information` case with an exact version and reason. The terminal event/audit trail is retained and a later fresh journey can use the released one-open-case slot.
- The assigned compliance reviewer can reject an `in_review` case with an exact version and reason; decision timestamp, transition, and audit evidence commit atomically. Approval is intentionally unavailable.
- The authenticated portal now renders the server-granted borrower journey, lists owned cases, starts a draft, submits/resubmits the displayed version, and performs reasoned withdrawal. Profile/evidence forms remain absent.
- Borrowers can expand an owned case to view its ordered immutable state/version timeline and reasons for information requests, withdrawal, or terminal decisions.
- Compliance staff now have a responsive permission-driven queue UI for borrower filtering, claim/resume, reasoned information requests, and rejection over the existing protected APIs.
- No borrower profile, KYB evidence, completeness rules, or approval command is implemented yet; this task stays **WIP** pending the Philippine entity/document matrix and screening/escalation policy.
- **2026-08-30 — Lifecycle completion + eligibility spine (slice S1.1):** Added the owner-bound `POST /v1/onboarding/cases/:caseId/reopen` (`rejected|expired → draft`, `reopened` event, reviewer/decision cleared, version bump, audit), so a rejected applicant corrects and reapplies on the same account without a dead end (acceptance criterion "corrected without creating duplicate accounts"). `create` now refuses `409 CASE_ALREADY_APPROVED` while an approved borrower case still stands; an expired one does not block. Added the internal `eligibility(userId, journey)` projection (`none|pending|approved|expired`) that credit/campaign/commitment gating will consume. Regulated profile/evidence completeness and the policy-gated approve still layer on in later slices.
- **2026-08-30 — Identity dependency correction:** The target borrower identity is now
  `borrower_accounts`, not a customer role on the unified `users` table.
- **2026-08-30 — Borrower ownership cutover:** Onboarding applicant/event attribution now uses the
  global registry entry created only by a physical portal account. PostgreSQL requires a borrower
  account for a borrower case and rejects investor/admin IDs, so host selection or a legacy role
  cannot change the journey class.
- **2026-08-30 — Borrower auth cutover:** Borrower signup/sign-in, HTTP-only sessions, session
  context, own-device management, and portal sign-out now use only the borrower namespace. The
  legacy unified customer auth path and `sme_borrower` authority are retired; context exposes
  `accountType: borrower`, no roles, and only server-defined borrower capabilities.
- **2026-08-30 — KYB profile capture (slice S2.1):** Added `borrower_profiles`/`beneficial_owners`
  (migration `0025`) and `GET`/`POST /v1/onboarding/borrower/cases/:caseId/profile`, capability- and
  ownership-bound to the existing `borrower_onboarding.read_own`/`manage_own` permissions. A save
  is an upsert guarded by the profile's own optimistic version, editable only while the case is
  `draft` or `needs_information`, and replaces beneficial owners wholesale each time; declared
  ownership percentages are rejected server-side if their total exceeds 100%. Every save appends an
  immutable `borrower_profile.saved` audit event. This captures company registration, entity type
  (sole proprietorship/partnership/corporation), authorized contact, and beneficial-owner/PEP
  fields; it does not yet encode which fields or documents are *required* per entity type — that
  policy is still an open decision below. Evidence/document attachment, completeness rules, and the
  approve command remain unimplemented.

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
