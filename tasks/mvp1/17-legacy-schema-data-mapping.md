# 17 — Legacy Schema Baseline & Data Mapping

**Status:** WIP  
**Outcome:** The authoritative legacy data structure and its mapping to the revamp are known before migration code is written.

## Scope

- Obtain a sanitized schema-only export from the active legacy database.
- Inventory tables, views, columns, keys, indexes, triggers, procedures, events, row counts, and latest activity.
- Reconcile deployed objects against API models, raw SQL, incremental migrations, and documented workflows.
- Classify every object as migrate, transform, summarize, archive, or retire.
- Produce field-level mappings and control totals for users, KYC, loans, investments, balances, holds, payments, and payouts.

## Acceptance criteria

- The schema source, extraction timestamp, environment, and sanitization method are recorded.
- Every MVP 1 source field maps to an approved destination or documented exclusion.
- Orphans, duplicate identities, invalid statuses, and financial inconsistencies are quantified.
- Finance approves opening balance/position controls and migration reconciliation rules.
- No production secrets or personal data are committed to the repository.

## References

- [Schema documentation](../schema/README.md)
- [`seedin-live-api-v1-1` data review](../reference/legacy/api-v1-1/06-data-migrations-tests.md)

## Open decisions

- Clean pilot versus active-position migration, history depth, archive access, cutoff, tolerance, and source-of-truth database.
