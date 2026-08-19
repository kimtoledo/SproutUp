# `seedin-live-admin` Source Review

**Status:** WIP — static source review  
**Reviewed:** 2026-08-19  
**Branch:** `main`

This is a direct review of the legacy back-office application. It supplements the earlier automated domain scan and the [`seedin-live-api-v1-1` review](../api-v1-1/README.md).

## Snapshot

- Yii `1.1.14` back-office application sharing most code with the API repository snapshot.
- 51 page controllers, 42 server/data controllers, 18 report controllers, 350 view files, and 17 backend form models.
- Route-based permissions backed by database records and 12 legacy role identifiers.
- Operational coverage for requests, investors, issuers, underwriting, campaigns/loans, money movement, repayment, marketing, reporting, settings, jobs, and logs.
- High-risk actions include profile approval, loan approval/publishing, wallet adjustment, payment status changes, repayment execution, restructuring, and loan completion.

## Review documents

- [01 — Architecture, Parity & Boundaries](./01-architecture-parity-boundaries.md)
- [02 — Navigation, Modules & Screens](./02-navigation-modules-screens.md)
- [03 — Operational Workflows & State Changes](./03-operational-workflows-state-changes.md)
- [04 — Roles, Permissions & Control Gaps](./04-roles-permissions-control-gaps.md)
- [05 — Reports, Exports & Operations Tooling](./05-reports-exports-operations.md)
- [06 — Revamp Impact & Disposition](./06-revamp-impact-disposition.md)

## Interpretation rule

The admin repository is not an independent source of truth. It contains duplicated business logic and models that have drifted from the API snapshot. Every financial or approval behavior must be reconciled against runtime data, current operations, and the approved revamp rules before migration.
