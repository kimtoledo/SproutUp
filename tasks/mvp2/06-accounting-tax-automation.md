# 06 — Accounting & Tax Automation

**Status:** WIP  
**Outcome:** Approved accounting and Philippine tax outputs can be generated with minimal manual preparation.

## Scope

- Automated journal batches, period close/lock, adjustment approvals, and accounting-system export.
- Tax schedules for platform fees, investor interest withholding, DST, and referral withholding where applicable.
- Certificate/source-document generation when confirmed as required.
- Filing-period reconciliation, exception handling, and retained calculation evidence.

## Acceptance criteria

- Automated outputs use approved versioned tax rules and posted ledger data.
- Regeneration is deterministic and does not mutate closed historical transactions.
- Adjustments use auditable entries and approval, not spreadsheet-only overrides.
- Finance can reconcile each filing/report line to source transactions.

## Dependencies

- MVP 1 accounting/tax baseline and approved Philippine professional advice.

## Open decisions

- Required BIR outputs, certificate forms, accounting platform, close calendar, and electronic filing/invoicing integration.
