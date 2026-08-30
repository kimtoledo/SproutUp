# 07 — Campaign & Loan Management

**Status:** WIP  
**Outcome:** An approved credit application can become a controlled crowdfunding campaign and loan contract.

## Implementation progress

- **2026-08-30 — Amortized/interest-only schedule math (slice S4.1):** Added
  `generateLoanSchedule`/`formatLoanSchedule` (`@sproutup/shared`), a pure, deterministic function
  for exactly the two repayment models the product brief approves (amortized, interest-only) —
  the legacy reference describes three *different*, mutually inconsistent amortization engines
  plus a second, dead scoring-linked engine with its own rate table, so none of them are ported
  (see Decisions). Every monetary value, including the amortized model's periodic payment (PMT)
  figure, is computed with exact bigint/rational arithmetic — never floating point — by treating
  `(1+r)^n` as an exact rational raised to an integer power rather than calling a transcendental
  function. The final period always closes to exactly zero outstanding balance by construction
  (paid the *remaining* balance, not a re-derived "regular" principal figure), which is what
  guarantees a schedule reconciles to the loan amount to the centavo regardless of rounding earlier
  in the schedule. Interest uses a fixed monthly rate (`annualRatePercent / 12`) rather than the
  legacy Effective-Rate engine's actual/365 day-count (a deliberate simplicity choice, not a
  confirmed regulatory requirement). Covered by 8 boundary-value tests: exact reconciliation on a
  non-dividing term/rate, the 0% degenerate case, a single-period term, and due-date month-length
  clamping.
- Added `campaigns`/`campaign_events` (migration `0028_massive_energizer.sql`) and
  `createCampaignService` (`apps/api/src/campaigns/campaign-service.ts`): a staff-only workflow —
  `create` (from an **approved** credit application only, loan amount capped at the application's
  approved amount, one open campaign per application), `update` (draft only), `submit`/`publish`
  (dual-controlled: the publisher must differ from the submitter, enforced by the service **and** a
  database check constraint, mirroring the credit-application approval pattern exactly),
  `sendBack` (publisher returns a submission to draft for correction, no dual control needed for a
  negative/corrective action), and `cancel`. `detail()` returns the persisted terms plus the
  **computed** repayment schedule (never persisted, so it can never drift from the terms of
  record) and the immutable event timeline.
- Added `campaigns.{read,manage,publish}`, granted to `credit_analyst` (dual control via a
  different actor, not a different role — same provisional pairing pattern as task 06's
  `recommend`/`approve`, flagged the same way below).
- Added `GET`/`POST /v1/admin/campaigns*` with full OpenAPI contracts, wired into
  `AppDependencies`/`app.ts` as an optional top-level `campaigns` service group and into
  `server.ts`.
- **Deliberately not built**: funding-window mechanics that depend on actual investor commitments
  (funded/failed transitions, released holds on failure/cancellation) — those need task 08
  (Investor Commitments) to exist first; a campaign here only reaches `published` (open for
  funding) or `cancelled`. Also not built: fees and taxes on the schedule (no approved fee/tax
  policy exists — see Open decisions), contract generation/e-signature, and any investor-facing
  browsing of published campaigns (that belongs to task 08's public listing surface).

## Scope

- Campaign draft, review, approval, publication, funding window, target, minimum commitment, and status lifecycle.
- Loan amount, term, borrower rate, investor return, fees, repayment model, and schedule preview.
- Amortized and interest-only schedule generation.
- Funding success/failure, cancellation, contract generation, and campaign closure.

## Acceptance criteria

- Only approved credit applications can produce publishable campaigns. Implemented: `create`
  checks the credit application's status and caps the loan amount at its approved amount.
- Published financial terms are immutable; material changes require a new version and approval.
  Implemented for the state machine (`update` only works on `draft`; publishing requires
  `submit` → `publish` by a different actor). No amendment-after-publish path exists yet — a
  published campaign can currently only be cancelled, not revised — since amendment policy isn't
  scoped here.
- Funding cannot exceed the approved amount. The loan-amount-vs-approved-credit-application guard
  is implemented; the *investor funding total* side of this (commitments cannot exceed the loan
  amount) depends on task 08 and isn't applicable yet — nothing tracks commitments here.
- Schedule totals reconcile principal, interest, fees, taxes, and maturity amounts under approved
  rounding rules. Principal/interest/maturity reconciliation is implemented and boundary-tested
  (exact by construction). Fees and taxes are not computed — no approved policy exists (Open
  decisions) — so they are simply absent from the schedule rather than zeroed or estimated.
- Failed or cancelled campaigns release all investor holds. Not applicable yet — there are no
  investor holds to release until task 08 exists. Cancellation itself (the state transition) is
  implemented.

## Legacy reference

- [Loan Origination & Borrowing](../reference/legacy/domain-loans-borrowing.md) — extensively
  cross-referenced while scoping this slice specifically to identify what *not* to port: three
  mutually inconsistent amortization/interest engines (Balloon/EMR/Effective-Rate) selected
  per-loan, a second dead engine with a hardcoded interest-rate-by-grade table, three different
  disagreeing collateral-haircut formulas, penalty formulas referencing config keys that don't
  exist in any checked-in environment file, and several flagged arithmetic bugs (e.g. a
  days-sales-outstanding-shaped formula that algebraically drops its own numerator). None of this
  is reproduced; see Implementation progress for what was built instead.

## Dependencies

- 22 — maker/checker approval matrix: campaign publish and loan-term approval assume the dual-control requester/approver separation this task defines. Not blocking: the dual-control *mechanism* (different-actor enforcement, service-layer plus a database check constraint) is already built here, mirroring the identical pattern already used for role changes and credit-application approval — task 22's remaining "domain matrix" work is about formally cataloguing which operations require this across the whole system, not inventing the mechanism itself.

## Open decisions

- Partial-funding policy, campaign extension rules, minimum investment, and cancellation rights.
- Fee and tax treatment on the schedule (task 13, Accounting & Tax Baseline) — not modeled yet.
- Campaign approval authority: `campaigns.manage`/`campaigns.publish` are both currently granted to
  `credit_analyst`; whether publish should sit with a distinct role is unresolved and, like task
  06, changeable later via role-permission grants alone.
- Amendment-after-publish policy (the acceptance criterion assumes a "new version and approval"
  path for material changes to a *published* campaign; only pre-publish editing and outright
  cancellation exist today).
