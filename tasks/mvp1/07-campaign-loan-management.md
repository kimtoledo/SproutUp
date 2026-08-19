# 07 — Campaign & Loan Management

**Status:** WIP  
**Outcome:** An approved credit application can become a controlled crowdfunding campaign and loan contract.

## Scope

- Campaign draft, review, approval, publication, funding window, target, minimum commitment, and status lifecycle.
- Loan amount, term, borrower rate, investor return, fees, repayment model, and schedule preview.
- Amortized and interest-only schedule generation.
- Funding success/failure, cancellation, contract generation, and campaign closure.

## Acceptance criteria

- Only approved credit applications can produce publishable campaigns.
- Published financial terms are immutable; material changes require a new version and approval.
- Funding cannot exceed the approved amount.
- Schedule totals reconcile principal, interest, fees, taxes, and maturity amounts under approved rounding rules.
- Failed or cancelled campaigns release all investor holds.

## Legacy reference

- [Loan Origination & Borrowing](../reference/legacy/domain-loans-borrowing.md)

## Dependencies

- 22 — maker/checker approval matrix: campaign publish and loan-term approval assume the dual-control requester/approver separation this task defines.

## Open decisions

- Partial-funding policy, campaign extension rules, minimum investment, and cancellation rights.
