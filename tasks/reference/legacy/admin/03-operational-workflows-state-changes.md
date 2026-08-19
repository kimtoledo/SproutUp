# 03 — Operational Workflows & State Changes

## Approval and servicing paths

| Workflow | Legacy entry points | State-changing behavior observed |
| --- | --- | --- |
| Registration/profile | Requests and customer detail | Approve/reject registration, profile, reset-profile, signed-contract, and declined-signature requests; optionally send DocuSign |
| Underwriting | Credit Rating list/detail | Review, message, attach documents, approve/reject, then create a pending unpublished loan |
| Campaign | Loan add/detail | Create/update schedule and terms, publish immediately, run auto-invest, approve/cancel Product B funding |
| Wallet operations | Requests/customer detail | Approve/reject top-ups and withdrawals, admin top-up, credit-line change, fund adjustment, and transfer |
| Repayment | Loan detail | Start repayment, register borrower payment, apply penalties, execute all investor repayments, update payment state |
| Exceptions | Loan detail/system | Early maturity, cancel investment, restructure loan, mark complete, change dates/statuses |

## Control observations

- Many actions are synchronous controller requests with immediate database mutations.
- Some flows use database transactions, but transaction coverage is action-specific rather than enforced by a common command boundary.
- Request approval can trigger user status changes, fund request changes, referral updates, notifications, and DocuSign operations.
- Loan servicing exposes several manual override paths that can affect schedules, balances, and investor outcomes.
- The UI warns when the last cron heartbeat is stale, but this is not a reliable job-control mechanism.

## Revamp requirements derived from risk

- Model every important transition as an explicit command with allowed-from/allowed-to states.
- Require idempotency keys for payment, disbursement, distribution, and provider callback commands.
- Separate proposal from approval for high-risk financial and compliance actions.
- Capture actor, reason, before/after state, evidence, and correlation ID in immutable audit records.
- Recalculate and reconcile from an authoritative ledger/schedule service; never trust a displayed total as the source of truth.
- Provide an exception queue rather than hidden one-off utility actions.

## Source concern to verify

The introducer access condition in the request status action combines mutually exclusive request-type comparisons with `OR`, making the denial branch appear always true for an introducer. This needs a runtime test and deployed-version check before documenting actual partner permissions.
