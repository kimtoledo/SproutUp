# 02 — Navigation, Modules & Screens

## Primary navigation

The main layout exposes these back-office areas, subject to route permissions:

| Navigation area | Main capabilities observed |
| --- | --- |
| Dashboard | Registration summaries and pending-request statistics |
| All Requests | General approval queue and bank-request queue |
| SeedIn Partners | Commission summary and partner details |
| Investors | Investor list, reserve groups, Paynamics, Coins.ph, and PitakaMo |
| Issuers | Issuer list, credit/loan requests, manual loan creation, and loan list |
| Marketing | Email blasts, media library, email templates, promotions, and banners |
| Finance | Investor and issuer transactions, deposits, withdrawals, and idle funds |
| Reports | Overall investors/AUM, user funds, profile data, and logs |
| Cron Jobs | Manual screens for registration reminders and email blasts |
| Settings | Points, statistics, country, permissions, role permissions, and admin users |
| Logs | Activities, system logs, and API access logs |

## Detailed operational surfaces

- Customer records: investor/issuer filtering, profile details, documents, bank accounts, KYC/CKA/SAT, DocuSign, activities, transactions, funds, comments, referrals, groups, auto-invest rules, and tags.
- Underwriting: multi-step credit-rating review, messages, supporting documents, external accounting data, approve/reject, and loan creation.
- Loan servicing: listing setup, schedules, investors, payment records, manual payment, auto-invest allocation, funding approval/cancellation, penalties, early maturity, restructuring, investment cancellation, and completion.
- Requests: registration/profile/contract approvals, deposits, withdrawals, borrow listings, bank requests, messages, and downloads.
- Communications: templates, email queues/logs, blast audiences/groups, previews, banners, newsroom, push tests, and notifications.
- Administration: admin accounts, route permission definitions, role assignments, settings, execution utilities, QA screens, and records.

## Information-architecture implication

The legacy menu is module-oriented, but daily operations are queue-oriented. The revamp should organize work around actionable queues—KYC review, underwriting, campaign readiness, funding exceptions, disbursements, collections, withdrawals, and reconciliation—while retaining searchable customer, loan, and transaction records.
