# 09 — Wallet Ledger & Bank Transfers

**Status:** WIP  
**Outcome:** Investor and borrower balances are derived from an auditable ledger with a controlled manual bank-transfer path.

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

- Ledger design, settlement accounts, bank statement format, and withdrawal service fee.
