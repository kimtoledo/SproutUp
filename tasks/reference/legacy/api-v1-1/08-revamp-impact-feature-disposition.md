# 08 — Revamp Impact & Feature Disposition

**Status:** Proposed disposition for Product review

## Carry into MVP 1 after redesign

- Authentication, approved role/permission matrix, OTP/step-up security, audit trail
- Borrower/investor onboarding, KYC, documents, bank verification
- Credit application, scoring, review, campaign/loan lifecycle
- Manual investments, wallet holds, immutable ledger, manual bank transfers
- Disbursement, repayments, collections baseline, investor distribution
- Configurable Philippine fees/taxes and operational reconciliation reports
- Transactional email/SMS, secure files/contracts, essential staff queues
- API contracts, idempotency, scheduler/job controls, and migration reconciliation

## Rebuild in MVP 2 after pilot evidence

- One selected automated payment gateway
- Auto-invest
- One-level referral funded only by platform commission
- Collections/reminder automation
- Enhanced dashboards/BI, customer self-service, and accounting/tax automation

## Optional MVP 3 candidates

- Xero/QuickBooks borrower data import
- Secondary-market trading
- Advanced portfolio/risk analytics
- Promotions, vouchers, and points
- Content/news/banner/video management beyond essential campaign content
- Partner channels such as PitakaMo/NUWallet

## Retire or replace unless explicitly justified

- Multi-level introducer hierarchy and override commissions
- Lend-or-Fend gamification, donation-specific endpoints, legacy loyalty tiers, and voucher-adjusted financial formulas
- PayPal and stale provider paths
- Cross-country funded-total aggregation with hardcoded conversion factors
- Public test/environment endpoints, universal/admin access-as-user shortcuts, and unsafe control/repair controllers
- Hardcoded one-off cron/CLI fixes and direct balance repair tools
- Duplicated API prefixes/controllers and partial legacy RAML as the new contract

## New tasks created from this review

- API contract/security-boundary specification
- Scheduler, queue, and job-control specification
- Legacy feature disposition and decommission plan
- Legacy schema baseline and migration mapping
- Optional promotions/content/partner-channel assessments
