# 09 — Wallet Ledger & Bank Transfers

**Status:** WIP  
**Outcome:** Investor and borrower balances are derived from an auditable ledger with a controlled manual bank-transfer path.

## Implementation progress

- **2026-08-19 — Exact settled-money primitive:** Added canonical `PHP` decimal-string contracts and immutable `bigint`-centavo runtime values with exact signed arithmetic and a shared `numeric(30,2)` persistence boundary.
- Numeric JSON, ambiguous formats, floating-point arithmetic, negative zero, and overflow are rejected. Multiplication, allocation, and rounding remain unavailable until the ledger/calculation rules are approved.
- Added generic `ledger_accounts`, immutable `ledger_transactions`, and immutable positive debit/credit `ledger_entries` with PHP `numeric(30,2)`, global posting idempotency, source/reversal identity, and commit-deferred minimum-line/balance enforcement.
- Added an atomic posting service with canonical order-independent payload hashing, exact retries, idempotency conflicts, shared active-account locks, exact centavo preflight, and immutable audit evidence. Owning domains can compose it inside their own transaction.
- Added one-time atomic full reversal: the original is locked, every line is mirrored to the opposite direction, exact retries are stable, second/reversal-of-reversal attempts fail, and closed historical accounts remain correctable without permitting new postings.
- No production chart or domain posting rule is seeded. Holds, transfer evidence, approval, balance derivation, and reconciliation remain unimplemented; this task stays **WIP**.

## Scope

- Append-only double-entry or equivalently balanced ledger with available, held, and settled balances.
- Bank-transfer cash-in request, proof upload, admin verification, approval/rejection, and receipt.
- Withdrawal request, fee/tax snapshot, hold, approval, manual payout confirmation, cancellation, and failure.
- Idempotency keys, reference numbers, reversals/corrections, and daily reconciliation views.

## Acceptance criteria

- Balances are computed from ledger entries; direct balance edits are prohibited.
- Every posting balances and links to its source transaction and actor.
- Approval cannot post the same bank transfer or withdrawal twice.
- Corrections use reversing entries and preserve the original history.
- Held funds cannot be committed or withdrawn elsewhere.

## Dependencies

- [03 — Borrower Onboarding & KYC](./03-borrower-onboarding-kyc.md) — verified borrower bank details are required for withdrawal requests and payout confirmation.
- [04 — Investor Onboarding & KYC](./04-investor-onboarding-kyc.md) — an approved investor account is required to hold a wallet and request cash-in/withdrawal.

## Legacy reference

- [Wallet, Withdrawals & Payment Gateways](../reference/legacy/domain-payments-wallet-gateways.md)

## Open decisions

- Ledger design, settlement accounts, bank statement format, withdrawal service fee, and calculation rounding/residual rules.
