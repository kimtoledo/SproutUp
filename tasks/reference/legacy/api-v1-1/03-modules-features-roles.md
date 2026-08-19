# 03 — Modules, Features & Roles

**Status:** Source inventory; production usage is not yet confirmed.

## Core business modules

- Registration, authentication, device/API-key sessions, OTP, password recovery, social login
- Investor and fundseeker dashboards, user profiles, KYC, escrow/accredited-investor declarations, bank accounts, documents, references
- Credit application wizard, financial statements, collateral, directors/shareholders, review history, scoring
- Loan/campaign creation, approval, publishing, funding, contracts, repayments, penalties, restructuring, secured/Product-B credit listings
- Manual investment, asynchronous investment queue, auto-invest/Alfred, eligibility, holds, cancellation
- Wallet, cash-in, withdrawal, gateway state, requests, approvals, reconciliation/correction utilities
- Borrower repayment allocation, investor distribution, fees, withholding, statements
- Notifications, email queue/templates/blasts, SMS, push, operational alerts
- Referrals, introducers, commissions, points, promotions, vouchers
- Secondary-market investment trading
- Xero/QuickBooks data import and invoice collateral

## Supporting/admin modules

- Customer, borrower, entrepreneur, introducer, manager, executive, admin, permission, and country management
- Campaign/newsroom/banner/video/media-library content
- App-version/release management
- Settings, cron status, system mode, activity/access logs, records/history, imports, QA/run utilities
- Reports for activity, AUM, borrowers, funds, idle funds, insurance fees, investors, Lend-or-Fend, logs, ongoing loans, payouts, profiles, promotions, registration, sales, trading, transactions, and withdrawals
- Provider operations for Paynamics, Coins.ph, PitakaMo, and partner requests

## Legacy end-user classifications

- User types: qualified, retail, and company.
- Dashboard modes: investor and fundseeker.
- User states include new, registration rejected, verified, profile pending, profile approved, profile rejected, and deleted.

## Legacy admin roles

| ID | Legacy label |
| ---: | --- |
| 1 | Superadmin |
| 2 | Admin |
| 3 | Manager constant; omitted from visible role list |
| 4 | Introducer constant displayed as Manager |
| 5 | Credit User |
| 6 | Finance |
| 7 | Business Development |
| 8 | IT |
| 9 | Marketing |
| 10 | Agency |
| 11 | Credit Dashboard |
| 12 | Digital Marketing |

Introducer records separately define Director, Deputy Director, Manager, Executive, and Agency hierarchy roles. This hierarchy conflicts with the approved one-level revamp referral direction.

## Access-control behavior

- Superadmin receives unrestricted access.
- Admin receives broad access except a small superadmin-only list.
- Other staff access is assembled from database `role_permission` records and route strings.
- A hardcoded permission map and dynamic route exceptions coexist with database permissions.
- Some roles are defined but omitted or relabeled in UI lists, making actual authorization difficult to infer from role names alone.

## Revamp role mapping

Legacy role IDs must not be migrated directly. Map capabilities to the approved roles: Super Admin, Sales Officer, Credit Analyst, Compliance Officer, Finance Officer, SME Borrower, and Investor. Build a reviewed permission matrix with maker-checker separation for KYC approval, credit approval, campaign publication, disbursement, repayment posting, corrections, and withdrawals.
