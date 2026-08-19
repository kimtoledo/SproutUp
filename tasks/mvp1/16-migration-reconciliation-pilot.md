# 16 — Migration, Reconciliation & Pilot Readiness

**Status:** WIP  
**Outcome:** Required legacy records are migrated safely and the end-to-end pilot is proven operationally ready.

## Scope

- Decide pilot migration scope for users, KYC, bank accounts, active loans, investments, balances, documents, and transaction history.
- Build repeatable extract-transform-load scripts with source IDs, validation, rejects, and rerun behavior.
- Reconcile migrated counts and financial control totals against all legacy applications and bank evidence.
- Run security, performance, backup/restore, incident, and end-to-end operational rehearsals.
- Define cutover, rollback/forward-fix, support ownership, and pilot limits.

## Acceptance criteria

- Every migrated financial balance is supported by reconciled opening ledger entries.
- Duplicate identities and conflicting records are resolved through an approved process.
- Migration scripts can be rerun safely in a clean environment.
- Critical pilot scenarios pass with signed Product, Compliance, Finance, and Engineering evidence.
- No unresolved severity-critical defect or unexplained reconciliation variance remains.

## Dependencies

- Tasks 09–13 — reconciliation and pilot rehearsals validate ledger, disbursement, repayment, distribution, and accounting/tax outputs against migrated data and bank evidence.
- [17 — Legacy Schema Baseline & Data Mapping](./17-legacy-schema-data-mapping.md) — the approved field-level mapping is required before building migration ETL scripts.

## Open decisions

- Whether the pilot starts clean or carries active legacy positions.
- Data cutoff, archival access, allowed variance, pilot participants, and go/no-go authority.
