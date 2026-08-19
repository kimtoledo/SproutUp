# 10 — Disbursement & Financial Controls

**Status:** WIP  
**Outcome:** A successfully funded campaign can be disbursed to the borrower with complete authorization and accounting evidence.

## Scope

- Pre-disbursement checklist for funding, contracts, KYC status, conditions, fees, and destination bank.
- Gross proceeds, deducted fees/taxes, and net borrower proceeds calculation.
- Finance maker-checker request, approval, execution reference, rejection, and cancellation.
- Campaign transition from funded to active repayment only after confirmed disbursement.

## Acceptance criteria

- Disbursement is blocked until all mandatory conditions are satisfied.
- Requester and approver are different authorized staff members.
- Gross, deductions, and net amounts reconcile to ledger postings.
- Duplicate execution references and repeated approvals are rejected.
- Failed disbursements do not activate the repayment schedule.

## Legacy reference

- [Investor Payouts & Fund Ledger](../reference/legacy/domain-repayment-payout-computation.md) — money-movement/computation patterns adjacent to disbursement (`LoanLib.php:293`, `LoanLib.php:836`).
- `LoanBorrowListing::disbursementAmount()`/`opServiceFee()` (`applications/common/models/LoanBorrowListing.php:730-736`) — the actual gross/net disbursement formula: `disbursement = loan.amount - opServiceFee()`, where `opServiceFee = (op_service_fee% ) * amount`.
- `LoanBorrowListing::initiateApproveLoan()` (`LoanBorrowListing.php:1577-1607`) — posts the `TYPE_DISBURSEMENT` and `TYPE_LOAN_FEE` ledger transactions via `UserFund::borrowerDisbursement()`/`borrowerSuccessFee()` (`applications/common/models/UserFund.php:438-450`) once a loan is approved for funding.
- `LoanLib::BorrowerBalloonRepaymentPayNow()`/`BorrowerEMRRepaymentPayNow()` (`LoanLib.php:293`, `LoanLib.php:388`) — the closest legacy analog to maker-checker on money-movement actions: an unreviewed request only creates a `LoanPayment` proposal row, and the actual ledger mutation fires only when `$isReviewed` is true.

## Dependencies

- Campaign success, signed documents, verified borrower bank, ledger, and tax/fee configuration.
- 22 — maker/checker approval matrix: defines the dual-control roles/thresholds that disbursement's requester/approver separation and execution controls assume exist.

## Open decisions

- Origination/service fee timing, DST handling, payout rail, and evidence requirements.
