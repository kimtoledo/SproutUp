# 01 — Architecture, Parity & Boundaries

## Application shape

`seedin-live-admin` is a server-rendered Yii 1.1 application. Page controllers render `.tpl` views while `backend/controllers/server` controllers serve AJAX requests and commonly mutate shared ActiveRecord models directly. The browser therefore talks to the admin application, not exclusively through the services API.

The repository includes copies of `backend`, `common`, `services`, cron, migrations, and third-party libraries. Static comparison shows that it is almost the same snapshot as `seedin-live-api-v1-1`, but not identical.

## Observed drift from the API snapshot

| Area | Admin snapshot difference | Concern |
| --- | --- | --- |
| Commission summary | Pagination was changed to load the full result set and the listing loop inserts rows into `dump_table` | A read/list operation has an undocumented database side effect and may be expensive |
| Repayment display | `LoanLendRepaymentPlan` always uses gross `amount()` in a payment record where the API copy distinguishes EMR net amount | Statements may disagree across applications |
| Repayment transaction | `net_amount()` returns a formatted currency value instead of the raw field | Calculation and presentation types are mixed |
| Email/config | Email template and services configuration differ | Deployment behavior cannot be inferred from one repository alone |

## Revamp boundary

The replacement should have one authoritative domain/API layer. Admin pages may initiate commands and read projections, but must not carry independent financial formulas or bypass the service authorization and audit boundary.

## Verification needed

- Identify the deployed commit of each legacy application.
- Confirm whether `dump_table` exists and whether the commission side effect is reachable in production.
- Compare generated investor statements and repayment totals between deployed admin, API, and user applications.
- Inventory routes that still read or write shared database models locally.
- Establish which legacy application owns each mutation during migration and cutover.
