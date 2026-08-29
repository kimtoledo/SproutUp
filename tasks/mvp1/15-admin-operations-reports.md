# 15 — Admin Operations & Reports

**Status:** WIP  
**Outcome:** Staff can operate and supervise the pilot through role-appropriate queues, dashboards, and exports.

## Implementation progress

- **2026-08-30 — Shared UI foundation (slice S0.1):** The SproutUp component kit (`apps/web/components/ui/`) and `SiteHeader`/`PageHeading` shells that the admin queues, dashboards, and detail views will be built on are in place, with design tokens and accessible primitives (tables, badges with a status-tone map, alerts, steppers). The existing `/admin/onboarding` and `/admin/role-approvals` workspaces still render on the legacy CSS and migrate onto the kit with their Phase 1 feature slices (20/22). No queue, dashboard, or report behaviour changed in this slice.

## Scope

- Work queues for KYC, underwriting, campaigns, funding evidence, disbursement, repayments, withdrawals, and exceptions.
- Dashboard metrics for applications, campaigns, funded amounts, outstanding principal, due/overdue amounts, wallet liabilities, and pending approvals.
- Searchable detail views and CSV exports with role-based field access.
- Daily ledger/bank reconciliation, exception report, audit report, and tax-support reports.

## Acceptance criteria

- Each staff role sees only authorized actions and data.
- Dashboard totals link to the records included in the calculation.
- Exported financial totals reconcile to the underlying ledger/report query.
- Large reports run asynchronously and are access-controlled.
- Sensitive exports are audited and expire after a configured period.

## Dependencies

- Tasks 02–13 — work queues, dashboard metrics, and reconciliation/tax-support reports surface the KYC, credit, campaign, funding, disbursement, repayment, distribution, and accounting records these tasks produce.

## Open decisions

- KPI definitions, reporting cutoff/timezone, export retention, and masking rules.

## Legacy findings to reconcile

- The legacy admin has module menus plus separate request, customer, loan, finance, report, log, and maintenance surfaces; the target operational model is defined in [Task 20](./20-admin-information-architecture-work-queues.md).
- Dedicated report controllers cover activity, AUM, funds, idle funds, investor contracts, ongoing loans, payouts, registrations, sales, transactions, profiles, and withdrawals, plus additional one-off exports.
- Some list/report paths contain database side effects or formulas that differ between repository snapshots. Treat all legacy totals and exports as reconciliation candidates, not specifications.
- See the [legacy admin report review](../reference/legacy/admin/05-reports-exports-operations.md).
