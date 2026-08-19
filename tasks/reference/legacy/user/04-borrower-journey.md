# 04 — Issuer/Borrower Journey

## Journey observed

1. Complete issuer/company profile, KYC, bank, directors, documents, and approval.
2. Start a multi-step financing/credit-rating application.
3. Provide request particulars, purpose, repayment preference, financial statements, invoices, collateral/pledges, bankruptcy declarations, and optional supporting evidence.
4. Optionally pull accounting information from Xero or QuickBooks.
5. Submit for review, exchange messages, and track application status.
6. After approval, view funding/campaign state and associated contracts.
7. Track active loans, repayment schedules, and transaction history.
8. Top up the wallet and make/confirm repayments, with admin servicing exceptions handled in the back office.

## Legacy behavior to reassess

- The UI mixes “Issuer,” “Borrower,” “Fundseeker,” and seeker tiers.
- Source contains multiple legacy repayment variants beyond the approved amortized and interest-only target shapes.
- One older local create path prevents a new request while a pending or existing loan exists; the active credit-rating application path is API-backed and must be verified separately.
- External accounting imports and collateral flows may not be launch requirements.

## Revamp MVP 1 direction

Provide a Philippine SME application with resumable sections, evidence checklist, clear submission/review states, staff questions, decision notices, approved offer acceptance, campaign/funding visibility, repayment schedule, payment instructions, receipts, and overdue notices.

Business policy must decide repeat/concurrent facilities, application expiry, offer changes, collateral requirements, drawdown conditions, and restructuring communication.
