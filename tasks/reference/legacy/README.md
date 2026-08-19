# Legacy Domain Discovery

These documents were initially produced by a Claude Code scan and describe behavior found across the existing SeedIn applications. They may contain incomplete inferences, Singapore-specific rules, deprecated integrations, broken/dead code, hardcoded configuration, and features not approved for the Philippine revamp.

## Documents

- [Accounting Integrations](./domain-accounting-integrations.md)
- [Auth, Security & RBAC](./domain-auth-security-rbac.md)
- [Credit Rating & Underwriting](./domain-credit-rating-underwriting.md)
- [Introducers & Commission](./domain-introducers-commission.md)
- [Investments & Auto-Invest](./domain-investments-autoinvest.md)
- [Loans & Borrowing](./domain-loans-borrowing.md)
- [Notifications & Communications](./domain-notifications-communications.md)
- [Payments, Wallet & Gateways](./domain-payments-wallet-gateways.md)
- [Repayment & Payout Computation](./domain-repayment-payout-computation.md)
- [Secondary Market Trading](./domain-secondary-market-trading.md)
- [User Accounts & KYC](./domain-user-accounts-kyc.md)

## Repository-level source review

- [`seedin-live-api-v1-1`](./api-v1-1/README.md) — direct follow-up review that verifies and extends this automated domain inventory.
- [`seedin-live-admin`](./admin/README.md) — direct review of back-office screens, workflow mutations, roles/permissions, reports, and operational controls.
- [`seedin-live-user`](./user/README.md) — direct review of portal architecture and borrower/investor journeys.
- [Cross-Application Workflow Map](./09-cross-application-workflows.md) — current responsibility map and target API boundary.

## Usage rule

Never convert a legacy behavior into a revamp requirement without checking the approved product overview, current regulation/business decisions, and the relevant implementation task's open decisions.

For financial formulas, permissions, KYC/compliance behavior, scheduled processes, and external integrations, verify the observation against the actual source path and all relevant callers before relying on it. When possible, also confirm whether the path is enabled and used in production operations.
