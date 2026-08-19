# 04 — Cron & Console Inventory

**Status:** Source-verified command inventory; actual production schedules are unknown.

No crontab, scheduler manifest, or deployment schedule was found. Directory placement alone cannot prove that a command runs in production.

## Commands in the active cron directory

| Command | Observed behavior | Classification |
| --- | --- | --- |
| `AutoInvestCommand` | Finds eligible published Alfred loans, allocates investors transactionally, checks caps, logs result | Operational candidate; concurrency/locking review required |
| `CheckStatementCommand` | Prints repayment schedule diagnostics for a supplied loan ID | Manual diagnostic |
| `CommissionCommand` | Empty `run()` | No-op |
| `EmailBlastCommand` | Prepares recipient lists and sends blast content | Operational/marketing; compliance controls incomplete |
| `EmailSenderCommand` | Processes pending `EmailLog` queue and increments attempts | Operational candidate; locking/backoff/limits unclear |
| `InvestmentProcessorCommand` | Infinite polling loop for pending investment requests; completes hold then processes | Daemon candidate; lifecycle, locking, and recovery risks |
| `InvestorFeesCommand` | Applies fee/tax to hardcoded loan `9` and sends payout email | One-off repair; unsafe as scheduled job |
| `JobCommand` | Auto-publishes scheduled campaigns and sends SMS to hardcoded recipients | Operational candidate with hardcoded operational data |
| `NUPartnerCommand` | Links referral invitations to registered users | Batch reconciliation/repair candidate |
| `PaynamicsCommand` | Polls incomplete/pending/failed gateway transactions and approves/rejects them | Operational candidate; sensitive debug output present |
| `ResendEmailCommand` | Immediately exits; remaining body is historical hardcoded resend logic | Disabled one-off repair |
| `ResetRepaymentCommand` | Resets hardcoded loan `13` and lender schedules | Unsafe one-off repair |
| `SiteNotificationCommand` | Entire operational body is commented out | No-op |
| `TestCommand` | Runs auto-invest on hardcoded loan `19` | Test/unsafe outside development |
| `TestSendgridCommand` | Direct SendGrid test with undefined variables | Broken test utility |
| `UpdateFundsCommand` | Computes PH total plus SG/TW feeds using hardcoded exchange values | Marketing aggregate; not financial source of truth |
| `UserProfileReminderInitCommand` | Repeatedly reminds verified users after one day | Operational candidate; duplicate cadence risk |
| `UserRegistrationReminderCommand` | Reminds pending/incomplete profiles on day/cadence rules | Operational candidate |

## Commands under `trash`

The 41 archived commands include active-looking business behavior despite their location:

- Campaign/loan: `ActiveCampaign`, `CreditListing`, `ProductB`, `UpdateDaysLeft`, `UpdateLoanSchedule`, `LoanFee`, `LoanResetSchedule`, `NotifyIncomingDueDate`, `RepaymentReminder`
- Trading/investment: `InvestmentTrade`, `ReloadMissingBonus`, `UpdatePromotionInvestmentLog`, `fixOnhold`
- Communications/ops: `Docusign`, `EmailSender`, `NotifyIntroducers`, `NotifyManagers`, `PushNotification`, `Watcher`, `Job`
- Accounting integrations: `Quickbooks`, `Xero`
- Migration/repair: `AddressImport`, `ImportCreditRatingData`, `ImportVoucherLog`, `Migrate*`, `RequestsUpdateReference`, `FixBonus`, `InsuranceFee`
- Testing/control: `Bucket`, `Checker`, `ClearOTPAttempts`, `ControlSystem`, `NewUnionProcess`, `Test`

Important capabilities such as repayment reminders, DocuSign polling, trading expiry, and watcher/health logic appear only here. Their actual replacement need must be decided independently of folder name.

## `cbase` maintenance CLI

- `CoinsphCommand` — connect, transfer funds, balance, invoice creation/status.
- `CommissionCommand` — commission reset and percentage fixes.
- `LoanCommand` — validate/correct holds and investments, run/force/cancel investments, notifications, recalculation, and diagnostics.
- `PaynamicsCommand` — queue population, duplicate checks, and queue execution.
- `ServicesCommand` — auto-publish, investment processing, and email-blast processing.
- `SiteCommand` — cache clearing and test utilities.
- `UserCommand` — wallet/on-hold scans, balance repairs, OTP tests, transaction sanitation, and running-balance fixes.

These commands include powerful repair/force operations and should not be exposed as ordinary revamp commands.

## Revamp scheduler requirements

- Central job registry with owner, purpose, cadence/trigger, timeout, retry, concurrency policy, idempotency key, and alerting.
- Separate production jobs from migrations, diagnostics, tests, and break-glass repairs.
- Distributed locking or unique work claims for auto-invest, investment processing, email, provider polling, and distributions.
- Bounded batches, dead-letter state, replay tooling, and auditable manual recovery.
- No hardcoded record IDs, phone numbers, dates, rates, credentials, or provider secrets.
- Health/heartbeat monitoring must prove execution and business progress, not only process availability.
