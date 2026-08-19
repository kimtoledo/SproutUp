# 06 — Credit Scoring & Underwriting

**Status:** WIP  
**Outcome:** Credit Analysts can evaluate an SME consistently and produce an auditable approval recommendation.

## Scope

- Credit application, financial statements, requested amount/term, collateral, guarantors, and supporting documents.
- Versioned scorecard inputs, weights, overrides, risk grade, and analyst narrative.
- Review stages, request-information loop, approval/rejection, limits, and conditions.
- Separation between calculated score, analyst recommendation, and final approval.

## Acceptance criteria

- The approved scorecard is deterministic and covered by boundary-value tests.
- Input data, formula version, score, override, approver, and reason can be reconstructed.
- Missing mandatory information blocks final approval.
- Only authorized roles can change scores, overrides, or approval decisions.
- Legacy scoring conflicts are resolved rather than copied into the new engine.

## Dependencies

- [03 — Borrower Onboarding & KYC](./03-borrower-onboarding-kyc.md) — a credit application requires an approved borrower profile before evaluation.
- [05 — Document & Consent Management](./05-document-consent-management.md) — financial statements and supporting documents are stored and versioned through the document service.

## Legacy reference

- [Credit Rating & Underwriting](../reference/legacy/domain-credit-rating-underwriting.md)

## Open decisions

- Final scorecard, risk grades, approval authority, collateral haircut, and exposure limits.
