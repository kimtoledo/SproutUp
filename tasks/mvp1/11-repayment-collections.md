# 11 — Repayment & Collections

**Status:** WIP  
**Outcome:** Borrower payments are recorded and allocated predictably to due loan obligations.

## Scope

- Due schedule for amortized and interest-only loans.
- Manual payment receipt with bank evidence, approval, value date, and external reference.
- Configurable allocation waterfall across fees, taxes, penalties, interest, and principal.
- Partial, short, excess, late, and reversed payment handling.
- Delinquency status, aging, collection notes, promise-to-pay, and manual penalty controls.

## Acceptance criteria

- One receipt cannot be posted twice.
- Allocation results are deterministic, versioned, and reproducible.
- Principal outstanding never becomes negative.
- Reversals restore schedule and ledger state using compensating entries.
- Finance can reconcile borrower receipts to bank credits and loan allocations.

## Legacy reference

- [Loan Origination & Borrowing](../reference/legacy/domain-loans-borrowing.md)

## Dependencies

- [07 — Campaign & Loan Management](./07-campaign-loan-management.md) — a funded loan's terms and schedule must exist before a due schedule can be generated.
- [09 — Wallet Ledger & Bank Transfers](./09-wallet-ledger-bank-transfers.md) — payment receipts, allocations, and reversals post as entries against the append-only ledger.
- [10 — Disbursement & Financial Controls](./10-disbursement-controls.md) — a loan must be disbursed before repayment obligations become due.
- 22 — maker/checker approval matrix: manual receipt posting and reversal/correction approval assume the dual-control requester/approver separation this task defines.

## Open decisions

- Approved allocation waterfall, grace period, penalty formula, prepayment, and excess-payment policy.
