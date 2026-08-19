# 06 — Revamp Impact & Disposition

## MVP 1 — rebuild

- Role-scoped admin shell and authoritative API authorization.
- KYC/compliance, underwriting, campaign, disbursement, repayment, withdrawal, and reconciliation queues.
- Customer, application, campaign, loan, commitment, wallet, and transaction detail views.
- Maker/checker controls for high-risk approvals and executions.
- Operational dashboards, audit search, exception handling, and essential exports.

## MVP 2 — automate after pilot

- Provider-driven cash-in/cash-out operations.
- Advanced collections workflows and bulk processing.
- Business intelligence, scheduled reports, and richer self-service support.
- Auto-invest operations and one-level referral administration.

## MVP 3 or retire unless approved

- Promotions, vouchers, points, reserve groups, secondary-market tooling, and broad marketing CMS.
- Partner/provider-specific consoles such as Coins.ph and PitakaMo.
- External accounting import consoles and old partner/introducer hierarchy behavior.
- Arbitrary run/QA utilities exposed in the production admin UI.

## Migration rule

Do not recreate every controller as a screen. Start with target operational jobs and their risks, define commands and read models, then map legacy routes into temporary compatibility or migration tools only where required.
