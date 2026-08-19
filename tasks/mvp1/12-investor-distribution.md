# 12 — Investor Distribution

**Status:** WIP  
**Outcome:** Cleared borrower repayments are allocated to investors accurately and posted to their wallets.

## Scope

- Ownership share and pro-rata distribution of principal and investor interest.
- Platform spread/commission, withholding tax, other approved deductions, and rounding residuals.
- Pending-to-cleared distribution lifecycle, wallet credit, statement line, and receipt.
- Reversal/recalculation workflow that preserves original entries and approvals.

## Acceptance criteria

- Total investor principal allocation equals the approved distributable principal.
- Gross return, every deduction, and net investor credit are stored separately.
- Distribution uses an immutable investment snapshot and versioned formula configuration.
- Rounding residuals follow an approved deterministic policy.
- Re-running a job cannot duplicate wallet credits.

## Legacy reference

- [Investor Payouts & Fund Ledger](../reference/legacy/domain-repayment-payout-computation.md)

## Dependencies

- 22 — maker/checker approval matrix: distribution reversal/recalculation approval assumes the dual-control requester/approver separation this task defines.

## Open decisions

- Withholding rate/applicability, spread recognition, rounding allocation, and payout availability timing.
