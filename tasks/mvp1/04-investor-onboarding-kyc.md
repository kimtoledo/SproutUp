# 04 — Investor Onboarding & KYC

**Status:** WIP  
**Outcome:** An eligible investor can be verified, risk-assessed, and approved before funding campaigns.

## Implementation progress

- **2026-08-19 — Shared workflow foundation:** Added versioned `onboarding_cases` and append-only `onboarding_case_events` for borrower/investor journeys, including one-open-case enforcement, applicant/reviewer separation, correction, expiry, and immutable transition history.
- Investor signup now writes only `investor_accounts` and its matching auth tables through
  `/v1/auth/investor/*`. The active account class receives fixed own-case capabilities with no RBAC
  grant; funding and withdrawal eligibility still depend on future approved onboarding state
  controls.
- Added the same protected own-case create/list/detail/submit boundary for the investor journey, with type-specific capability checks, SQL ownership binding, one-open-case enforcement, optimistic versioning, and immutable event/audit evidence.
- Investor cases now appear in the same capability-protected compliance queue and can be claimed for review with self-review/takeover denial and atomic reviewer/state/evidence updates; suitability/eligibility decisions remain unimplemented.
- Assigned reviewers can request information with a versioned reason, and the investor can resubmit the same owned case without losing assignment or immutable correction history.
- Staff can inspect investor case identity/current state and the complete ordered immutable transition/reason timeline through the queue-read capability.
- Investors can withdraw their own eligible open case with optimistic versioning and a required reason; the terminal state, event, and audit evidence remain immutable while allowing a later fresh journey.
- The assigned compliance reviewer can reject an `in_review` investor case with a reason and exact version, preserving decision time and immutable event/audit evidence. Approval and eligibility effects remain unavailable.
- The authenticated portal now renders the server-granted investor journey, lists owned cases, starts a draft, submits/resubmits the displayed version, and performs reasoned withdrawal. Suitability/profile/evidence forms remain absent.
- Investors can expand an owned case to view its ordered immutable state/version timeline and reasons for information requests, withdrawal, or terminal decisions.
- Compliance staff now have the same responsive permission-driven queue UI for investor filtering, claim/resume, reasoned information requests, and rejection over the existing protected APIs.
- Investor subject classification, profile/evidence fields, suitability questionnaire versions, eligibility restrictions, bank verification, and approval remain unimplemented because the individual/institutional pilot scope and approved rules are still open; this task stays **WIP**.
- **2026-08-30 — Lifecycle completion + eligibility spine (slice S1.1):** The owner-bound `reopen` transition (`rejected|expired → draft`) and the `create` `CASE_ALREADY_APPROVED` guard apply to the investor journey too. The internal `eligibility(userId, 'investor')` projection (`none|pending|approved|expired`) is the read that commitment/withdrawal gating will enforce against (task acceptance: "unapproved, expired, or suspended investors cannot commit funds or withdraw"); `suspended` and bank-verification state layer on in slice S1.3.
- **2026-08-30 — Investor ownership cutover:** Onboarding applicant/event attribution now uses the
  global registry entry created only by a physical portal account. PostgreSQL requires an investor
  account for an investor case and rejects borrower/admin IDs.
- **2026-08-30 — Investor auth cutover:** Investor signup/sign-in, HTTP-only sessions, session
  context, own-device management, and portal sign-out now use only the investor namespace. The
  legacy unified customer auth path and investor-role authority are retired; context exposes
  `accountType: investor`, no roles, and only server-defined investor capabilities.
- **2026-08-30 — Individual investor KYC profile capture:** Added `investor_profiles` (migration
  `0026`) and `GET`/`POST /v1/onboarding/investor/cases/:caseId/profile`, mirroring the borrower
  profile slice: capability- and ownership-bound to the existing
  `investor_onboarding.read_own`/`manage_own` permissions, an upsert guarded by the profile's own
  optimistic version, editable only while the case is `draft` or `needs_information`, with every
  save appending an immutable `investor_profile.saved` audit event. Scope is deliberately narrow:
  baseline natural-person identity/contact/source-of-funds fields only (full name, date of birth,
  nationality, government ID, address, occupation, source of funds), with only `fullName` required.
  It intentionally does **not** add institutional-investor support or a risk/suitability
  questionnaire — see Open decisions below.

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

- Individual versus institutional investor support for the pilot. The current `investor_profiles`
  table only captures a natural person; an institutional shape (registered entity, beneficial
  owners, similar to `borrower_profiles`) is not built until this is confirmed.
- Investment limits and enhanced-due-diligence triggers.
- The risk/suitability questionnaire (CKA/SAT in the legacy system) and any accredited-investor
  concept must be redesigned against confirmed Philippine SEC/AMLC rules, not ported from the
  legacy Singapore/MAS-shaped forms — see the legacy-conflict warning in `tasks/README.md`. Until
  then, `sourceOfFunds` on the profile is a plain free-text declaration, not a scored questionnaire.
