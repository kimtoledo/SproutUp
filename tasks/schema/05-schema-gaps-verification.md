# 05 — Schema Gaps & Verification Plan

**Status:** WIP

## Confirmed repository gaps

- No complete baseline DDL is present.
- `newunion/tests/.../_data/dump.sql` contains only a placeholder comment.
- Legacy control code references `database/schema.sql`, but that file is absent.
- The 61 available migrations cover only changes from September 2017 through May 2020.
- Most migration `down()` methods explicitly return unsupported.
- Only 41 table creations were found in migrations, while the application declares well over 100 table-backed models.
- No foreign-key declarations were found in the available migration SQL.
- Production/QA environment configuration files are versioned and must be security-reviewed without copying secrets into documentation.
- The referral/commission ledger posting flow (see 03 — Financial Ledger & Money Flow, "Commission and referral money flow") needs production-data verification: no single legacy table or column was identified that unambiguously represents "platform commission revenue" as the funding source distinct from the introducer/referral payout lines drawn against it. Commission calculation, commission-as-revenue, and referral/introducer payout are intermixed across `CommissionLib`, `commisson_payments`, `commission_txn_master`, `commission_rate`, and `commission_details`; the authoritative commission-revenue account/table must be confirmed against production data before the revamp ledger design is finalized.
- `introducer_members` is a database VIEW (created by `m180323_024943_referral_v2.php` over `user_referrals`/`users`, via the intermediate `introducer_members_all` VIEW), not a physical table. Whether the revamp schema preserves it as a view or intentionally materializes it as a first-class table is an open decision that must be made before finalizing 04 — Proposed Revamp Schema.

## Required database verification

Obtain a sanitized schema-only export from the authoritative deployed database and capture:

- tables, columns, types, defaults, nullability, generated columns, and comments;
- primary, unique, foreign, and secondary indexes;
- views, triggers, stored procedures/functions, scheduled database events, and sequences;
- table engines, collations, row counts, and approximate size;
- orphan counts and violated logical relationships;
- status/type value distributions;
- financial control totals and latest transaction timestamps.

## Comparison procedure

1. Compare deployed objects with model `tableName()`, `primaryKey()`, rules, and relations.
2. Compare deployed columns with every query and raw SQL reference.
3. Mark each object as active, read-only/reporting, integration cache, obsolete, unknown, or migration-only.
4. Identify duplicate sources of truth and database views masquerading as tables/models.
5. Produce a signed financial reconciliation for users, balances, holds, investments, loan principal, due amounts, repayments, and payouts.
6. Map only approved data into the proposed revamp schema.

## Security handling

- Use schema-only or properly sanitized exports.
- Never commit production credentials, personal data, identity documents, bank details, tokens, or raw transaction payloads.
- Rotate any credential found in version history or logs according to the incident/security process.

## Deliverable checklist

- [ ] Authoritative schema source identified
- [ ] Sanitized DDL captured outside public paths
- [ ] Model-to-table/column matrix completed
- [ ] Foreign-key and index gaps reviewed
- [ ] Views/procedures/triggers inventoried
- [ ] Data-quality exceptions quantified
- [ ] Financial control totals reconciled
- [ ] Legacy-to-revamp mapping approved
- [ ] Migration rehearsal and rollback/forward-fix plan approved
