# 05 — Reports, Exports & Operations Tooling

## Report surfaces

Dedicated report controllers cover activity, AUM, borrower data, funds, idle funds, insurance fees, investor detail/contracts, lender-of-record/end data, logs, ongoing loans, payouts, profiles, promotions, registrations, sales, trading, transactions, and withdrawals.

Additional exports exist for withdrawal fees, insurance, customers by month, monthly fund transactions, CRC, reserves, bonus, interest lump sum, customer investments, manager/sales/customer data, loan lists, and ongoing repayment.

## Operational tools

- API access, activity, email queue, push, system, and transaction logs.
- CSV and direct-download endpoints across customer, loan, request, and report modules.
- Manual cron launch screens and general-purpose `RunController` maintenance actions.
- QA pages for loans, users, and trading.
- Dashboard charts computed directly from transactional tables.

## Revamp implications

- Define every report's business meaning, cutoff, timezone, status inclusion, and source fields before rebuilding it.
- Reconcile finance reports to the immutable ledger and loan subledger, not independent ad hoc queries.
- Run large exports asynchronously; encrypt them, expire them, and audit download access.
- Apply field-level masking and role-scoped columns to PII and bank details.
- Replace arbitrary maintenance endpoints with named, permissioned, idempotent runbooks/jobs.
- Preserve legacy reports only after a current business owner confirms usage and regulatory value.

## Runtime evidence required

Obtain recent access logs or owner confirmation for each report/export, sample reconciled outputs, scheduler execution history, and the retained reporting periods. Static presence alone does not establish production use.
