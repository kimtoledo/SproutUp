# Schema Documentation

**Status:** WIP — source-derived, not yet verified against a production database.

These documents capture the legacy API data model and a proposed revamp direction while `seedin-live-api-v1-1` is being reviewed.

## Documents

- [01 — Legacy Schema Catalog](./01-legacy-schema-catalog.md)
- [02 — Core Entity Relationships](./02-core-entity-relationships.md)
- [03 — Financial Ledger & Money Flow](./03-financial-ledger-money-flow.md)
- [04 — Proposed Revamp Schema](./04-proposed-revamp-schema.md)
- [05 — Schema Gaps & Verification Plan](./05-schema-gaps-verification.md)

## Evidence levels

- **Verified in source:** Explicit model `tableName()`, `primaryKey()`, relation, controller usage, or migration SQL.
- **Inferred:** Relationship inferred from naming, model relations, queries, or workflow calls but not backed by a complete DDL snapshot.
- **Proposed:** New revamp design direction; requires architecture, Finance, Product, and Compliance approval.
- **Unknown:** Cannot be confirmed without the deployed schema, current data, or runtime configuration.

## Important limitation

The repository does not contain a complete reproducible database baseline. The Codeception dump is a placeholder, `database/schema.sql` is absent even though legacy code references it, and the available migrations begin after the original schema already existed. Do not generate production migrations solely from this documentation.
