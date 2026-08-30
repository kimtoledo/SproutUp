# 06 — Credit Scoring & Underwriting

**Status:** WIP  
**Outcome:** Credit Analysts can evaluate an SME consistently and produce an auditable approval recommendation.

## Implementation progress

- **2026-08-30 — Application intake and dual-controlled underwriting workflow, no scoring engine
  (slice S3.1):** Added `credit_applications` (its own status/version/event trail, mirroring
  `onboarding_cases`'s shape but with an extra `recommended` state — see Decisions), plus
  `credit_collateral_items` and `credit_guarantors` as append-per-save child rows. Borrowers create
  an application against their own **approved** borrower onboarding case
  (`createCreditApplicationService`: `saveOwn`/`submit`/`withdraw`/`reopen`/`listOwn`/`detailOwn`,
  `POST`/`GET /v1/credit/applications*`), capturing requested amount/term/purpose, two years of
  flat self-reported financials (`last_year{1,2}_{sales_revenue,gross_profit,net_profit}` — the
  same shape the legacy engine actually consumed, without its disputed roll-up logic), a
  bankruptcy disclosure, and collateral/guarantor line items (full-replace on every save, like the
  borrower profile's beneficial owners).
- Staff underwriting (`createCreditReviewService`, `GET`/`POST /v1/admin/credit/applications*`)
  mirrors the onboarding review queue for `startReview`/`requestInformation`, then adds `recommend`
  (the assigned analyst's narrative + suggested terms — **never a calculated score**) as a required
  step before any final decision. `approve`/`reject`-after-recommendation enforce dual control at
  both the service layer and a database check constraint
  (`credit_applications_dual_control`: `decided_by_user_id <> recommended_by_user_id`) — the
  approver can be any authorized staff member, but never the recommending analyst. An early
  `reject` straight from `in_review` (before any recommendation exists) is the assigned analyst's
  own call instead, matching the onboarding pattern.
- Added `credit_applications.{read_own,manage_own,submit_own}` (granted to borrower accounts) and
  `credit_applications.{read,review,recommend,approve}` (granted to `credit_analyst` — see
  Decisions on why the same role holds both `recommend` and `approve`).
- **Deliberately not built**: any calculated score, risk grade, or collateral-valuation formula.
  The legacy system carries two mutually inconsistent scoring engines (a live A–F weighted model
  and a dead A–D model with a direct interest-rate mapping) and three different collateral-haircut
  formulas that silently disagree with each other — see
  [the legacy reference](../reference/legacy/domain-credit-rating-underwriting.md) — and the
  approved scorecard, risk grades, approval authority, and collateral haircut are all still-open
  decisions below. `estimatedValue`/`outstandingLoan`/`assessedNetWorth` are stored exactly as
  declared, with no haircut applied.

## Scope

- Credit application, financial statements, requested amount/term, collateral, guarantors, and supporting documents.
- Versioned scorecard inputs, weights, overrides, risk grade, and analyst narrative.
- Review stages, request-information loop, approval/rejection, limits, and conditions.
- Separation between calculated score, analyst recommendation, and final approval.

## Acceptance criteria

- The approved scorecard is deterministic and covered by boundary-value tests. **Not started** —
  no scorecard is approved yet, so none exists to test.
- Input data, formula version, score, override, approver, and reason can be reconstructed. Input
  data, approver, and reason are already reconstructable from the immutable
  `credit_application_events`/`audit_events` trail; formula version, score, and override remain
  not-applicable until a scorecard exists.
- Missing mandatory information blocks final approval. Structurally true today: `requestedAmount`,
  `termMonths`, and `purpose` are database-required, so a draft cannot exist without them, and
  `approve`/`reject` are only reachable after `submitted` → `in_review` → `recommended`. Which
  *additional* fields/documents must be mandatory before final approval is unresolved — see Open
  decisions.
- Only authorized roles can change scores, overrides, or approval decisions. Implemented for
  approval decisions (capability-gated, dual-controlled). Not applicable to scores/overrides yet.
- Legacy scoring conflicts are resolved rather than copied into the new engine. Resolved by not
  porting any of them — see Implementation progress.

## Dependencies

- [03 — Borrower Onboarding & KYC](./03-borrower-onboarding-kyc.md) — a credit application requires an approved borrower profile before evaluation.
- [05 — Document & Consent Management](./05-document-consent-management.md) — financial statements and supporting documents are stored and versioned through the document service.

## Legacy reference

- [Credit Rating & Underwriting](../reference/legacy/domain-credit-rating-underwriting.md)

## Open decisions

- Final scorecard, risk grades, and collateral haircut — see the two-way (live vs. dead legacy
  engine) and three-way (collateral formula) legacy conflicts documented in the reference file.
- Exposure limits.
- Approval authority: `credit_applications.recommend` and `.approve` are both currently granted to
  `credit_analyst`; dual control is enforced by requiring a *different actor*, not a different
  role. Whether final approval should instead sit with a distinct credit-committee role or
  `compliance_officer` is unresolved and can be changed later purely via role-permission grants —
  no engineering change needed.
- Which fields/documents are mandatory before final approval, beyond the database-required
  amount/term/purpose (director/shareholder KYC documents, audited-financials threshold, etc.).
- Financial-statement entry beyond the flat 2-year summary (the legacy "financial ratio engine"
  and its three separately-implemented, disagreeing margin calculations) — deferred entirely, not
  rebuilt with corrected math, since no design authority reviewed the replacement formulas either.
- Xero/QuickBooks auto-pull integrations, the standalone Financial Analysis ratio tool, and Jarvis
  credit-bureau integration remain out of scope per the legacy reference's own "defer" list.
