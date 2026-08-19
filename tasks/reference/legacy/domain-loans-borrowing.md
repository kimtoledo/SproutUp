# Loan Origination & Borrowing

> **Revamp direction:** The approved target models are amortized repayment and interest-only repayment with principal due at maturity. Additional legacy repayment modes below are discovery context and require an explicit product decision before inclusion.

## Overview

This domain covers the entire lifecycle of a loan on the SeedIn / New Union platform, from the borrower's initial loan request through admin approval, crowdfunding/pre-funding, publishing, amortization-schedule generation, repayment posting, penalty accrual, and restructuring. It spans three distinct loan "shapes" that all share the same core `LoanBorrowListing` model:

- **Product A** (`PRODUCT_TYPE_A`, "Pre-funded"): loans that are already funded/committed and simply run through repayment.
- **Product B** (`PRODUCT_TYPE_B`, "Crowdfunded"): SME loans opened to many retail investors, subject to a subscription window, a minimum funding goal ("on hold" until qualified), and admin approval before disbursement.
- **Product C** (`PRODUCT_TYPE_C`): a third product type referenced in constants/dropdowns but with materially less unique logic in the code read (mostly shares Product A/B code paths).

A parallel, largely independent secured/receivables line — **`CreditListing`** ("Product B" of the credit-rating module: AR/invoice/property/money-lending) — has its own listing, repayment table, and upfront-fee model, and is optionally 1:1 linked to a `LoanBorrowListing` (`CreditListing::loan` / `LoanBorrowListing::credit_listing`) so it can be turned into an investable listing.

There is also a legacy, largely superseded **loan-request funnel** (`LoanRequest` / `LoanSchedule` / `LoanRepayment`, tables `productb_loan_requests`, `productb_loan_schedules`, `productb_loan_repayments`) driven by `RequestloanController` / `FinanceLib`. It implements its own (simpler) effective-rate amortization and settlement math and appears to be an older Cambodia-era money-lending admin panel that predates `LoanBorrowListing`; it is still wired into a few live actions (`RequestloanController`, `LoanController::actionSliderCalc`) but is not the primary path for new loans today.

**Users of this domain:**
- **Borrower** (SME / fund-seeker): requests a loan, receives disbursement, makes repayments, may be restructured. Interacts mostly through the mobile/web `user` app, proxied to the API's `services` layer (`ServiceBorrowController`, `ServiceLoanController`).
- **Investor / Lender**: browses published listings, invests/pledges funds, receives interest/principal payouts (mechanics live mostly in `LoanLendRepaymentPlan`, out of scope here except where it's driven directly by this domain's schedule/payment code).
- **Introducer / CRC (Credit Referral Consultant)**: can endorse or partially fund a loan (`crc_user_id`, `CRC_INVEST_PERCENTAGE = 10%`).
- **Admin / Credit Ops**: creates/edits loans, approves and publishes listings, approves Product B funding, posts borrower repayments, manually incurs penalties, restructures loans, generates contracts. Primary UI is the `admin` repo's `LoanController` / `ServerLoanController` / `RequestloanController` / `CreditlistingController`.
- **System / automated**: auto-publish job (cron `JobCommand`), auto-invest (`UserAutoInvest`, `AutoInvestCommand`), and (historically) a daily penalty-accrual job.

## Current Features & Flows

### Admin dashboard (`seedin-live-admin`, mirrored in `seedin-live-api-v1-1` backend)

**`LoanController.php`**
- `actionView($id)` — loan detail page (schedule, payment form, endorsement info).
- `actionAdd()` — new-loan form.
- `actionList()` / `actionListDownload()` — paginated list and an Excel export (with optional per-period repayment detail sheet per loan).
- `actionEdit($id)` — edit form; renders draft vs. published-loan form variants.
- `actionGenerateContract($id)` — streams a PDF loan contract for a given lend plan.
- `actionDownloadOnGoingRepayment()` — Excel export of all loans currently in repayment with per-loan repayment detail sheets.

**`server/ServerLoanController.php` (AJAX endpoints backing the above)**
- `actionCreate` / `actionUpdate` — create/update a `LoanBorrowListing` via `BorrowForm` (draft, admin_create, update, update_published scenarios); resets the amortization schedule unless already published.
- `actionList` — server-side search/pagination (`LoanLib::search`).
- `actionStartRepaymentProcess` — flips a loan to `STATUS_REPAYMENT` and stamps `repayment_date_activated`.
- `actionPublishNow` — publishes a loan (`LoanLib::publish`) and, if linked, its `CreditListing`.
- `actionAutoInvest` — manually triggers `UserAutoInvest::investAllUsers` for a listing, capped by `UserAutoInvest::MAX_PERCENT` (80%).
- `actionUpdateAdjustments` — Product A/C only; forbidden for Product B.
- `actionLenderRepaymentPayNowAll` — bulk lender payout trigger.
- `actionUpdateStatusEarlyMaturityFullPayment` — pays out remaining interest + capital to all lenders and marks the loan early-matured/fully paid.
- `actionDelete` — hard-deletes an unfunded loan only (`total_funds == 0`).
- `actionLoanComplete` — force-marks a loan `STATUS_COMPLETED`.
- `actionPayAll` — bulk borrower "pay all" trigger (`LoanLib::payAll`).
- `actionUpdateBorrowerInterest` — admin edit of a borrower interest transaction/period.
- `actionForceTagVoucher` — tags a voucher onto an investment.
- `actionUpdateDateSec($id)` — sets `date_sec` (securities/SEC filing date?) on a loan.
- `actionUpdateFundingStatus($id)` — Product B: `ApproveFunding` → `LoanBorrowListing::productBAcceptLoan()`; `CancelFunding` → `LoanBorrowListing::cancelFunding()`; emails investors/admin accordingly.
- `actionGenerateLoanSchedule` — previews an amortization schedule for the currently-typed-in create form (balloon/EMR/effective) before saving.
- `actionSaveLoanRequest` — persists a Product B loan request from session data (`LoanBorrowListing::createLoanRequest`).
- `actionTransaction` — Product B transaction list/detail (payments tab).
- `actionBorrowerRepayment` — posts a borrower repayment; dispatches to Balloon/EMR/EffectiveRate pay-now logic based on loan mode.
- `actionManuallyIncurPenalty` — admin manually posts a penalty (`LoanLib::ManualIncurPenalty`); no-ops for effective-rate loans.
- `actionBorrowerRepaymentEffectiveRate` — dedicated effective-rate repayment endpoint.
- `actionUpdatePenaltySetting` — toggles `include_penalty` flag on a loan.
- `actionRestructureForm` / `actionGenerateRestructureLoan` / `actionConfirmRestructure` — 3-step restructure wizard: preview → generate new schedule → confirm (creates a new `LoanBorrowListing` linked via `restructured_from_id`).
- `actionUpdateBorrowerRepaymentPeriodStatus` — flips a schedule period to `STATUS_PROCESSING`/`STATUS_PENDING` (used to mark a period "being paid" before commit).
- `actionCancelInvestment` — admin cancels one lender's pledge.
- `actionUpdatePayment` — approves/cancels a queued `LoanPayment` (dual-control repayment posting, see Business Logic).
- `actionPlanDetails` — investor plan detail modal.

**`RequestloanController.php` / `server/ServerRequestloanController.php`** — legacy loan-request funnel admin UI: generate/save a `LoanRequest` + `LoanSchedule` rows, view/print loan statement and schedule (incl. Excel export), record a `LoanRepayment` via `actionSaveLoanRepayment`, compute a final/settlement payment (`actionFinalPayment`), a standalone loan calculator, and a "slider calc" tool (`actionSliderCalc`) for scenario-testing effective-rate settlement.

**`CreditlistingController.php` / `server/ServerCreditListingController.php`** — list/view `CreditListing` records; `actionMakeInvestmentListing` seeds a new `LoanBorrowListing` (Product A) directly from a `CreditListing`/`CreditRating`, copying company, amount and attachment.

**`QaController.php`** (dev/QA-only, hard-blocked in production via `if (ENV_PRODUCTION) exit;`) — raw dump views of a loan/user/investment-trade record; internal debugging tool, not a customer-facing feature.

**`LoanCommand.php` (console, run ad hoc, not shown to be scheduled)** — operational toolbox: `summary`, `detail`, `blastloan` (email blast), `recalculateall`/`recalculateloan` (rebuild schedules), `cancelinvestment`, `addinvestment`/`forceinvestment` (force-add an investment, bypassing normal validation, with optional past-subscription override), `acceptinvestment`, `validatetotalinvestment`, `validatestatus`, `autoinvest`, `scaninvestment`, `keyprintingpress` (named one-off campaign), `validateonholds`/`doubleautoinvestdisc`/`doubleautoinvestcancel` (fund-reconciliation utilities for duplicate/mismatched auto-invest holds).

### API (`seedin-live-api-v1-1`) — services layer (mobile/web-facing REST, consumed by the `user` app)

**`ServiceLoanController.php`** (investor-facing, `get*`/`post*` = HTTP verb):
- `postInvest` / `postPitakaMoDirectInvest` — 2-step (OTP-gated) investment flow into a listing, with `validateInvestmentAmount`/`validateDirectInvestmentAmount` guards (funds check, `throwErrorsBeforeInvest`, invest-token/CSRF-style token check).
- `getFilter` — public/homepage listing search & filter.
- `getView` — single listing detail (drives `user` app's loan view).
- `actionConfirmOnHoldRepayment` — confirms an on-hold repayment scenario.
- `getInterestedInvestment` — "interested" (soft-commit) list.
- `postCalculator` — investor return calculator.
- `getContract` — investor contract PDF.

**`ServiceBorrowController.php`** (borrower-facing):
- `postApplications` — borrower's own credit-rating applications list with status/progress.
- `postFundings` — borrower's own Product B fundings in flight, including the friendly status string `"Completed, awaiting for Credit Officer's Approval"` when on-hold + subscription over + qualified + awaiting admin confirm.
- `getRepayments` — full borrower repayment dashboard: per-listing investor list, statement, and (mode-specific) full repayment schedule table, formatted for the app.

**`LoanController.php` (backend, non-server)** — same shape as admin repo (`actionView/Add/List/ListDownload/Edit/GenerateContract/DownloadOnGoingRepayment`); this is effectively the same codebase deployed to both `admin` and `api-v1-1`.

**`CreditlistingController.php` / `ServerCreditListingController.php`** — same as admin repo.

**`LoanCommand.php` (cbase console)** — same operational toolbox as above.

**Cron-adjacent console commands (`cron/protected/commands`)**:
- `JobCommand` — polls for `LoanBorrowListing` rows with `publish_date` in the past and `is_published = 0`, auto-publishes them via `LoanLib::publish`, and sends an SMS to two hardcoded phone numbers on success/failure.
- `AutoInvestCommand` — drives scheduled auto-invest.
- `ResetRepaymentCommand` — one-off/manual schedule reset for a single hardcoded `borrow_id = 13` (looks like a manual-fix script, not general-purpose).
- `commands/trash/LoanFeeCommand` — (moved to `trash`, i.e. disabled) daily driver for `LoanLib::IncurPenalty()`.
- `commands/trash/NewUnionProcessCommand`, `commands/trash/WatcherCommand` — disabled payout/health-watcher jobs that read/write `Setting` flags (`cron_investment_payout_error`, `cron_watcher_flag`, etc.).

### User app (`seedin-live-user`) — thin proxy layer

`LoanController.php` (frontend) and `server/ServerLoanController.php` contain **no direct DB access** — they call the API's `services` endpoints (`Loan/View`, `Loan/Invest`, `Loan/Filter`, `Loan/Pledge`, `Loan/calculator`, `Loan/ConfirmOnHoldRepayment`, `Loan/contract`, `File/loan`) via a `NewunionServiceLib`/`$this->service` HTTP client and render templates. Actions: `actionIndex` (redirect to current listings), `actionList`, `actionSuccessful` (fully-funded showcase), `actionView`, `actionPreview` (session-cached preview), `actionContract` (proxies PDF), `actionParticipation` (kicks off a lender contract), `actionFilter`, `actionAttachment` (proxies factsheet/image download). The `LoanBorrowListing` model in this repo (`applications/common/models/LoanBorrowListing.php`) is a **stub** — no `relations()`, no DB binding (`extends Model`, not `CActiveRecord`) — used only for shared constants/label helpers, confirming this app has zero direct query logic for loans.

## Business Logic & Computations

This is the load-bearing section for the rebuild — the platform runs **three parallel amortization/repayment engines**, selected per-loan by `repayment_mode`, each implemented as a `RepaymentMethod` subclass (`/api-v1-1/newunion/applications/common/lib/{BalloonRateRepaymentMethod,EqualMonthlyRepaymentMethod,EffectiveRateRepaymentMethod}.php`) plus a matching schedule generator in `LoanLib.php`.

### 1. Balloon / Bullet repayment (`REPAYMENT_MODE_BALLOON = 1`)

Fixed monthly interest, full principal due at the final period.

Schedule generation — `LoanLib::generateBalloonRateSchedule()` (`/api-v1-1/.../lib/LoanLib.php:1332-1366`):
```php
$interest       = round(($loan_amount * ($interest_rate / 100)) * ($month / 12) / $month, 2);
$total_interest = round($interest * $month, 2);
// per period i:
$principal = ($month == $i) ? $loan_amount : 0;   // bullet principal only on last period
$payment   = $principal + $interest;              // same interest every period
```
Total interest formula (`BalloonRateRepaymentMethod::totalInterest()`, `RepaymentMethod` lib):
```php
totalInterest = round(amount * returns/100 / 12 * loan_tenor, 2)
```
i.e. simple monthly interest = `principal × annual_rate/12`, repeated `loan_tenor` times — **not** compounding, **not** day-count based (flat 1/12 per month regardless of actual days in the month).

### 2. Equal Monthly Repayment / EMR (`REPAYMENT_MODE_EMR = 3`)

Equal principal installments + flat monthly interest on the **original** principal (not declining balance) — this is a "flat rate" style, not a true amortizing loan.

`LoanLib::generateEMRSchedule()` (`LoanLib.php:1368-1409`):
```php
$monthlyPrincipal     = round($loan_amount / $month, 2);
$interest             = round($loan_amount * ($interest_rate / 100) / 12, 2);   // flat, based on ORIGINAL principal every period
$lastMonthlyPrincipal = $loan_amount - ($monthlyPrincipal * ($month - 1));       // last period absorbs rounding remainder
// payment = principal_i + interest (same interest each period)
```
`EqualMonthlyRepaymentMethod::totalInterest()`:
```php
totalInterest = round(amount * (loan_tenor/12) * returns/100, 2)   // == interest_per_period * loan_tenor
```

### 3. Effective Rate (`REPAYMENT_MODE_EFFECTIVE = 2`, also used by legacy `LoanRequest`/`FinanceLib`)

True declining-balance / actuarial amortization, **day-count-actual** (Actual/365) rather than 30/360.

`LoanLib::generateEffectRateSchedule()` (`LoanLib.php:1411-1448`, identical logic in `FinanceLib::generateLoanSchedule()`):
```php
$interestRatePerMonth = $interest_rate / 12 / 100;
$payment = round($interestRatePerMonth * $loan_amount / (1 - pow(1 + $interestRatePerMonth, -$month)), 2);  // standard annuity/PMT formula, used only as an initial/estimate payment
// per period i:
$days           = actual calendar days between previous due date and this due date;
$daily_interest = $interest_rate * $days / 365;          // annual rate pro-rated by ACTUAL days, not fixed 30
$interest       = round($outstanding * $daily_interest / 100, 2);
$principal      = ($i == $month) ? $outstanding : ($payment - $interest);   // last period clears remaining balance + its interest
$outstanding   -= $principal;
```
Note the annuity `$payment` value is computed once up front from the nominal monthly rate but the **actual interest/principal split each period is day-count-driven**, so the fixed `$payment` figure can drift from the true amortized payment over the life of the loan (this is exactly the kind of subtlety the rebuild must reproduce or explicitly redesign).

**Early/out-of-cycle settlement (effective rate)** — `EffectiveRateRepaymentMethod::calculateSettleMent()`:
```php
days            = |datediff(last_payment_date, payment_date)|
interest        = days * (returns / 365)            // percent
total_interest  = round(outstanding * interest / 100, 2)
settlement      = outstanding + total_interest
```
and incurred interest for a given number of days (`calculateIncurredInterest`):
```php
round(outstanding * (days * returns / 365) / 100, 2)
```
Both are simple-interest, Actual/365, non-compounding.

### Repayment posting (`LoanLib`)

- **`BorrowerBalloonRepaymentPayNow` / `BorrowerEMRRepaymentPayNow`** (`LoanLib.php:293-499`): validate via `LoanPaymentForm`, then either (a) save a **pending** `LoanPayment` for later admin review (`isReviewed` not set — dual-control workflow), or (b) once reviewed/approved: deposit funds to borrower, `deductFromOutstanding()` the total (interest+principal+penalty), allocate the payment across schedule periods oldest-first via `updateLoanSchedulePaymentSummary()`, then fan the payment out to lenders pro-rata (`LenderRepaymentPayNowAllBalloonPayment` / `...EMRPayment`) by `investmentRatio()`, paying interest, penalty (unless `is_penalty_waved`), then principal, and emailing each lender a payout notice with net-of-fee figures.
- **`BorrowerRepaymentEffectiveRatePayNow`** (`LoanLib.php:502-626`): computes days since last payment, caps the payment at the settlement amount, splits `principal = amount - incurred_interest`, rejects if principal would be negative ("must not be less than interest"), checks borrower's available funds, then pays each lender pro-rata (including a "voucher percentage payout" bonus interest calc: `ratio * outstanding_orig * (days * voucher.amount/365)/100`), and posts a separate `TYPE_INCURED_INTEREST` and `TYPE_PENALTY` ledger entry before the `TYPE_REPAYMENT` entry.
- **Payment allocation waterfall** — `LoanBorrowListing::updateLoanSchedulePaymentSummary()` (`LoanBorrowListing.php:2530-2606`): applies incoming principal, then interest, then penalty, **each strictly oldest-unpaid-period-first**, filling each period completely before spilling into the next.
- **Validation guardrails** (`LoanPaymentForm`): for balloon loans, principal cannot be paid until all outstanding interest is paid first ("Need to pay all interest before paying principal amount"); interest cannot be paid while there is unpaid penalty; payment date must be ≥ the loan's last statement date.

### Approval / origination flow

- **`LoanBorrowListing::initiateApproveLoan()`** (`LoanBorrowListing.php:1577-1607`): on approval, three ledger entries are posted to the borrower's outstanding balance: disbursement (`amount - opServiceFee()`), the op/success fee, and (for balloon/EMR only) the **entire life-of-loan fixed interest** as a `TYPE_FIXED_INTEREST` entry up front — i.e. for balloon/EMR, total interest is booked to the borrower's outstanding balance at disbursement time, not accrued period by period.
- **Op service fee**: `opServiceFee() = round(op_service_fee/100 * amount, 2)`; `disbursementAmount() = amount - opServiceFee()`. Default `op_service_fee = 0.03` (3%) from `params.php`.
- **Product B ("crowdfunded") specific flow** — `productBAcceptLoan()` (`LoanBorrowListing.php:1613-1686`): requires `on_hold == 1`, `isQualified()`, `isProductB()`, and a start-repayment-date; on acceptance it resets each lender's repayment schedule, sends an "Investment Approved" email per lender, snapshots `original_amount`, sets `amount = total_funds()` (i.e. the loan amount is trimmed down to what was actually raised if under/over target — investors funding beyond `amount` shouldn't happen due to the invest-time cap, but under-funded-but-qualified deals get their amount reduced to actual raised), flips status to `STATUS_REPAYMENT`, regenerates the schedule, and calls `initiateApproveLoan()`.
- **Qualification threshold**: `isQualified() = (total_funds() / amount) >= required_goal`; `required_goal` defaults to `ONHOLD_FLAG = 1` (100%) for Product B at insert time (`LoanBorrowListing::insert()`), i.e. a Product B deal must be **fully** subscribed by default before admin can approve funding (no partial-goal threshold is wired by default, though the column supports it).
- **Cancellation** — `cancelFunding()`: sets status `CANCELLED`, `on_hold=false`, returns every lender's pledge (`cancelPledge()`), flips linked `CreditRating` to `CANCELLED`.

### Investment eligibility checks (`LoanBorrowListing::throwErrorsBeforeInvest`, `canInvest`)

Order of checks before an investment is accepted (`LoanBorrowListing.php:831-928`):
1. Loan must exist.
2. Status must be `STATUS_APPROVED` (unless `force`, used by auto-invest/admin force-add).
3. `isActiveInvestDate()` — "Alfred Auto Invest" gating: manual investing is blocked until `activate_invest_date` has passed (an auto-invest-first exclusivity window).
4. Not already fully funded (`hasReachGoal()` ⇔ `currentMaximumAllowedInvestment() == 0`).
5. Subscription window not over (`isSubscriptionOver()` ⇔ today ≥ `financeEndDate()`).
6. Not matured, not preview-only, not already in `STATUS_REPAYMENT` (unless forced).
7. Investment + already-raised must not exceed `amount` (hard cap, exact match allowed).
8. Amount must be ≥ `minimumLendAmount()` — **unless** the investor is the loan's designated CRC user (`crc_user_id`), who is exempt from the minimum.
   - `minimumLendAmount()` also zeroes itself out once the remaining crowdfunding balance drops to/below the configured minimum, so the last investor can always finance the exact remainder even if it's below the stated minimum.
- **Auto-invest cap**: `UserAutoInvest::MAX_PERCENT = 0.80` — auto-invest will refuse to push a loan's total funding above 80% of `amount`, leaving the last 20% for manual/CRC investment (a stale code comment in `ServerLoanController::actionAutoInvest` says "65%" — the real constant is 80%, see Tech Debt).
- **CRC allocation guard**: `CRC_INVEST_PERCENTAGE = 0.10` (10%) constant exists on `LoanBorrowListing` (used elsewhere in the CRC investment domain, not expanded here).

### Restructuring (`LoanLib::restructureLoan`, `LoanBorrowListing.php:1134-1210`)

Only allowed when the source loan `isApproved()` or `isRepayment()`. Marks the old loan `STATUS_ABORT_DUE_TO_RESTRUCTURED` (payouts stop), clones **all** attributes into a brand-new `LoanBorrowListing` row (`restructured_from_id` points back to the original), with a new `funding_id`, new `amount`/`loan_tenor`/`returns`/`repayment_mode` from the admin's restructure form, `total_payouts` reset to 0, unpublished, and a freshly generated schedule. Every existing lender's `LoanLendRepaymentPlan` is likewise cloned into a new "ONGOING" plan against the new loan (old one marked `ABORT_DUE_TO_RESTRUCTURED`), each with its own reset schedule. This is effectively "close old, open clone" rather than an in-place restructure, which has audit-trail implications (the original loan's schedule/txns remain frozen as history).

### Penalty accrual

**Automatic daily accrual — `LoanLib::IncurPenalty()`** (`LoanLib.php:1212-1287`), designed to run once per day (see Tech Debt: its cron driver is disabled):
- Scans all `PRODUCT_TYPE_A` loans in `STATUS_APPROVED` or `STATUS_REPAYMENT`.
- For each non-`STATUS_PROCESSING` schedule period with unpaid interest (`interest - paid_interest > 0`) whose due date has passed:
  - Finds the most recent existing penalty transaction for that period (or falls back to the schedule's due date) and computes `daysDiff` since then.
  - If `daysDiff > 0`:
    ```php
    penalty = round((borrower_penalty_rate_daily/100) * unpaid_amount * daysDiff, 2);
    if (schedule.penalty == 0) {           // first time penalty applied to this period
        penalty += (borrower_penalty_rate_outstanding/100) * loan.amount;   // one-time flat penalty on top of the daily rate
    }
    penalty = round(penalty, 2);
    ```
  - Posts a `TYPE_PENALTY` transaction (adds to the loan's `outstanding`) and increments `schedule.penalty`.
- **Formula summary**: penalty = `daily_rate% × unpaid_interest × days_late` **plus, once per period**, a flat `outstanding_rate% × original_loan_amount` one-time fee the first time a period goes into penalty.
- Both `borrower_penalty_rate_daily` and `borrower_penalty_rate_outstanding` are read from `Yii::app()->params[...]` but **do not appear defined in any checked-in `params.php`** (prod/qa/dev) or in the `Setting` DB-table call sites found in the codebase — see Tech Debt.

**Manual penalty — `LoanLib::ManualIncurPenalty()`** (`LoanLib.php:1450-1507`): admin-entered penalty amount/date/period/description for balloon or EMR loans (blocked for effective-rate loans), validated by `LoanIncurPenaltyForm` (date must be ≥ repayment start date and ≥ last statement date), posts a `TYPE_PENALTY` transaction and bumps `schedule.penalty`.

**Penalty on effective-rate repayment** — handled inline in `BorrowerRepaymentEffectiveRatePayNow`: penalty is whatever the admin/collector types in at the time of posting a repayment (no automatic daily accrual formula for effective-rate loans in the code read).

**Penalty waiver**: `LoanPayment`/`LoanBorrowRepaymentTxns.is_penalty_waved` — when set, lenders are **not** paid their pro-rata share of the penalty (`LenderRepaymentPayNowAllBalloonPayment`/`...EMRPayment` explicitly check `is_penalty_waved == 0` before crediting lenders their penalty share), i.e. a waived penalty is a borrower-side write-off, not paid out to investors either.

### Investor payout net-of-fee formula

`LoanLib::interestNet()` (`LoanLib.php:1509-1515`):
```php
interest_fee = round(interest * interest_fee_rate, 2);      // params: interest_fee_rate = 0.05 (5%)
tax          = round(interest * withholding_tax_rate, 2);   // params key not found in checked-in configs
net          = round((interest - interest_fee - tax) + principal, 2);
```
This is the number shown to investors in payout emails (`FundPayoutSuccess`).

### Credit Listing (secured/receivables "Product B" line) — `CreditListing`

**Fee/upfront calculation** (`CreditListing::calculate()`, `CreditListingLib::calculateAmounts()` — duplicated in two places):
```php
charge         = fee/100 * purchase_price;
buyback_price  = purchase_price + charge;                                 // amount client must eventually pay back
amount         = is_up_front ? (purchase_price - charge) : purchase_price; // amount actually disbursed/listed for investment
```
i.e. if `is_up_front`, the fee is deducted from disbursement upfront (discounted/factoring style); otherwise the full purchase price is disbursed and the fee is recovered via `buyback_price` over time.

**Repayment table generation** (`CreditListing::getRepaymentTable()`, `CreditListing.php:615-724`):
- If `isUpFront()`, period 0 is a synthetic already-"paid" row for `getTotalInterest() = fee/100 * purchase_price`, dated on `funding_date`, remarked `"{fee}% fee deducted upfront"`.
- Subsequent periods are spaced monthly (day-of-month locked to the funding day, clamped to 28 to avoid month-length issues) or weekly depending on `tenor_type` (`TENOR_MONTHLY` / `TENOR_WEEKLY`).
- Per-period amount due: `round((purchase_price - total_interest) / total_repayments, 2)` if up-front, else `round(purchase_price / total_repayments, 2)` — i.e. **equal principal installments**, no interest component computed per period (interest was already extracted via the upfront fee).
- **Late fee / penalty** (`getCalculatedPenalty()`): `round(amount_due * 0.02, 2)` — a **hardcoded 2% per late instance** (see Tech Debt — not configurable per listing/rate table like the loan-side penalty).
- **Late-fee cadence**: `getPeriodNextLateDate()` schedules the next late-fee application exactly **1 week** after the due date, repeating per `getPeriodCurrentLateWeek()` — i.e. late fees accrue weekly, not daily.
- When linked to a `LoanBorrowListing` (`updateRepaymentTableProductB()`), the credit-listing repayment table is instead derived directly from the loan's own borrower schedule (`getBorrowerRepaymentScheduleTable()`), converting "fee periods" (`LoanBorrowListing::isPeriodChild()`) into child/late-fee rows.
- `balance() = totalAmountDue + totalLateFee - totalPaid`; `finalBalance() = buyback_price + totalLateFee` (full early-settlement/buyback figure).
- `chargePerWeek() = round(totalWeeks() / fee, 4)` — note this divides weeks by fee (percentage), which looks like a reversed/typo'd formula (a "charge per week" should presumably be `fee / totalWeeks`) — flagged as a probable bug to verify against production usage before porting.

### Underwriting/eligibility feeding origination — `CreditRating` (brief; full detail in the Credit Rating & Underwriting domain doc)

A `CreditListing` (and any `LoanBorrowListing` created via `CreditlistingController::actionMakeInvestmentListing`) is only originated after its parent `CreditRating` application has been scored. Two pieces of that engine matter directly to this domain's eligibility/collateral math and are duplicated here for completeness:
- **LTV/allowed amount** — `CreditRating::allowedAmount() = round((invoice_amount() ?: borrowed_amount) * (loan_value / 100), 0)`, an admin-set loan-to-value cap.
- **Eligible amount** — `CreditRating::eligibleAmount()`: for Xero/default invoice types, `= round(invoice_amount() * (ELIGIBLE_RATE / 100), 0)` where `ELIGIBLE_RATE = 85` (a hardcoded 85% advance rate against total invoice value); `0` for QuickBooks/Freshbooks invoice types.
- The full weighted 6-section (`Collateral 5 / Understanding 15 / Particulars 10 / Financial 30 / Notice(Guarantor) 20 / Bankruptcy 20`, weights sum to 100) scoring model that produces the `credit_rating` letter grade (`processRating()`) lives in `CreditRating.php` and is **not** re-derived here — see `domain-credit-rating-underwriting.md` for the full formula breakdown, its dead-code alternate engine (`CreditRatingLib`), and the collateral-haircut inconsistencies flagged there. The rebuild must treat credit scoring as an upstream input to this domain, not something to reimplement independently.

### Legacy loan-request funnel (`FinanceLib` / `LoanRequest`)

- `FinanceLib::generateLoanSchedule()` is **the same annuity/day-count-actual algorithm** as `LoanLib::generateEffectRateSchedule()` (verbatim duplicate) — confirms Effective Rate mode is a reimplementation/generalization of this older engine.
- `LoanRequest::makeRepayment()` reproduces the same day-count settlement math (`getInterestFee()`: `outstanding * (days * interest * 12/365) / 100` — note this multiplies the **monthly** rate `interest` by 12 to annualize, then by days/365, equivalent to the annual-rate day-count formula used elsewhere) and pays lenders pro-rata via `LoanLendRepaymentPlan::InvestorMakeRepaymentEffectiveRate()`/`holdRepaymentProductB()` for lenders who are mid-sale on the secondary market.
- Aging/accrual reporting (`FinanceLib::getAgingOutstanding`, `getAgingSummary`, `getIncome*`, `getInterestAccrual`) runs raw SQL against `productb_loan_requests`/`productb_loan_schedules`/`productb_loan_repayments`, bucketing overdue balances into 0-30/30-60/60-90/90-120/120+ day aging bands and computing straight-line interest accrual (`DATEDIFF(...) * (interest / DATEDIFF(period_start, period_end))`) for month-end financial reporting.

## Data Model

Key tables/columns inferred from ActiveRecord models (all `CCActiveRecord`/`CActiveRecord`, MySQL-backed via Yii's `CDbCriteria`):

**`loan_borrow_listings`** (`LoanBorrowListing`, PK `borrow_id`) — the central loan record. Notable columns referenced in code: `user_id`, `company_id`, `funding_id`, `product_type`, `status`, `is_published`, `is_newunion`, `version`, `include_penalty`, `on_hold`, `required_goal`, `original_amount`, `amount`, `total_funds`, `outstanding`, `returns`, `loan_tenor`, `repayment_mode`, `repayment_start_date`, `finance_end_date`, `subscription_days`, `activate_invest_date`, `publish_date`, `repayment_date_activated`, `op_service_fee`, `minimum_lend_amount`, `crc_user_id`, `credit_rating_id`, `category_id`, `promotion_id`, `reserve_group_id`, `is_reserve`, `show_public_name`, `lender_contract_type`, `secretcode`, `attachment`, `restructured_from_id`, `need_admin_confirm`, `date_sec`, `doc_id`, `terminated_at`, `borrower_count`, `total_financers`, `total_payouts`. Relations: `user`, `company`, `crc` (User), `lenders`/`lenders_cancelled`/`all_lenders` (`LoanLendRepaymentPlan`), `borrower_repayments_txn`/`borrower_paid_txn`/`borrower_last_payment` (`LoanBorrowRepaymentTxns`), `lender_repayments_txn` (`LoanLendRepaymentTxn`), `category`, `credit_rating`, `credit_listing`/`listing` (`CreditListing`, 1:1), `promotion`, `schedules`/`schedule`/`last_schedule` (`LoanBorrowRepaymentSchedule`), `group`/`grouplinks` (`UserGroup`/`LoanBorrowGroupLink`), `loan_request` (1:1 `LoanRequest`), `repayment_summary` (`LoanLendRepaymentSummary`), `autoInvestInstruction`.

**`loan_borrow_repayment_schedule`** (`LoanBorrowRepaymentSchedule`, PK `id`) — one row per amortization period per loan: `borrow_id`, `period`, `date_repayment`, `payment`, `principal`, `interest`, `outstanding`, `penalty`, `paid_principal`, `paid_interest`, `paid_penalty`, `status` (`STATUS_PENDING=0` / `STATUS_PROCESSING=1`), `days` (effective-rate only).

**`loan_borrower_repayment_txns`** (`LoanBorrowRepaymentTxns`, PK `repayment_txn_id`) — the borrower-side ledger; every disbursement, fee, interest accrual, penalty, and repayment is one signed-amount row here (`amount` negative = money leaving outstanding balance i.e. a repayment; positive = added to outstanding). Columns: `borrow_id`, `user_id`, `admin_id`, `amount`, `type` (`TYPE_DISBURSEMENT=1`, `TYPE_LOAN_FEE=2`, `TYPE_FIXED_INTEREST=3`, `TYPE_INCURED_INTEREST=4`, `TYPE_PENALTY=5`, `TYPE_REPAYMENT=6`), `interest`, `principal`, `penalty_amount`, `is_paid`, `is_fee`, `is_penalty_waved`, `period`, `days`, `outstanding` (running balance snapshot), `ref` (JSON blob of contextual metadata — e.g. penalty calc inputs), `paid_at`, `created_at`, `loan_payment_id`. Insert-time integrity check: for `TYPE_REPAYMENT`/`TYPE_PENALTY`, `principal + interest + penalty_amount` must equal `abs(amount)` or the insert throws.

**`loan_payment`** (`LoanPayment`, PK `payment_id`) — a **dual-control queue**: admin/collector submits a proposed repayment (`STATUS_PENDING`), a second admin approves it (`updatePayment()` → dispatches into `LoanLib::Borrower{Balloon,EMR}RepaymentPayNow(..., isReviewed=true)`, EMR/Balloon only — effective-rate repayments bypass this queue and post directly). Columns: `borrow_id`, `paid_at`, `amount`, `interest`, `principal`, `penalty`, `type`, `status` (`PENDING=0`/`COMPLETED=1`/`CANCELLED=2`), `created_by`/`approved_by`, `repayment_txn_id`, `reference` (JSON).

**`loan_borrower_penalties`** (`LoanBorrowPenalty`, PK `penalty_id`) — relation to `LoanBorrowListing` exists but no fields/usage beyond the relation were found in the files read; likely a reference/config table for penalty rate tiers (worth confirming against a migration before assuming it's unused).

**`loan_borrow_group_links`** (`LoanBorrowGroupLink`, PK `id`) — `borrow_id` × `group_id`, links a loan to a `UserGroup` for **reserved-deal** access control (private/pre-release listings visible only to group members — see `LoanLib::homepageLoan()`'s `is_reserve` SQL).

**`credit_dashboard_listing`** (`CreditListing`, PK `listing_id`) — the secured/receivables listing: `credit_rating_id`, `user_id`, `company_id`, `client_id`, `borrow_id` (nullable link to `LoanBorrowListing`), `status`, `product_type`, `listing_type`, `tenor`, `tenor_type`, `fee`, `purchase_price`, `buyback_price`, `amount`, `is_up_front`, `is_offline`, `is_published`, `funding_date`, `maturity_date`, `number_payments`, `reference_code`, `restructure_credit_rating_id`, `data` (JSON blob for ad hoc extension fields), `borrower_count`. Relations: `user`, `credit_rating`/`credit_rating2`, `company`, `client` (`CreditClient`), `attachment` (`CreditListingAttachment`, 1:1), `repayments`/`repayments_all` (`CreditListingRepayment`), `loan` (`LoanBorrowListing`), `histories` (`CreditListingHistory`), `restructures` (self-referential via `restructure_credit_rating_id`).

**`credit_dashboard_repayments`** (`CreditListingRepayment`, PK `repayment_id`) — `listing_id`, `period`, `due_date`, `payment_date`, `amount_due`, `monthly_payment`, `monthly_interest`, `late_fee`, `payment_to_date`, `is_paid`, `is_child` (late-fee sub-row vs. principal row), `parent_id`, `week`, `remarks`, `payment_method`, `action_date`, `status` (`STATUS_DELETE=0`/`STATUS_ACTIVE=1`).

**`productb_loan_requests`** (`LoanRequest`, legacy) — `user_id`, `admin_id`, `credit_rating_id`, `borrow_id`, `loan_amount`, `outstanding`, `interest`, `term`, `currency_type` (`USD`/`KHR`), `effective` (`'Effective Rate'`/`'Flat Rate'`), `collecteral`/`other`, `requested_date`, `last_payment_date`, `account_number`, `is_closed`. Relations: `schedules` (`LoanSchedule`), `repayments` (`LoanRepayment`), `user`, `admin`, `loan_borrow_listing`.

**`productb_loan_schedules`** (`LoanSchedule`) / **`productb_loan_repayments`** (`LoanRepayment`) — bare models (no custom logic beyond `tableName()`/relations), columns inferred from usage: `loan_request_id`, `repayment_date`, `payment`, `principal`, `interest`, `outstanding`, `days`, `paid`; and `loan_request_id`, `amount`, `payment_date`, `status`, `interest`, `principal`, `outstanding`, `days`, `admin_id`.

**`productb_comments`** (`Comment`) / **`user_comments`** (`UserComment`) — generic internal annotation tables surfaced through the QA debug controller; not loan-specific business data.

## Cron/Automation Dependencies

- **Auto-publish** (`JobCommand`, likely wired to a frequent cron tick, e.g. every 5 min per the commented-out `date('i') % 5 == 0` guard): publishes any loan whose `publish_date` has passed, then sends an SMS via `SMSLib` to two **hardcoded** phone numbers.
- **Auto-invest** (`AutoInvestCommand`, `UserAutoInvest::investAllUsers`): allocates investor funds automatically up to `MAX_PERCENT = 80%` of a loan's `amount`, gated by `activate_invest_date`.
- **Daily penalty accrual** (`LoanLib::IncurPenalty()`, driven by `LoanFeeCommand`): the command file lives under `cron/protected/commands/trash/`, i.e. **disabled/removed from the active cron set** — see Tech Debt; the business logic itself is intact in `LoanLib` and is still invoked manually via `actionManuallyIncurPenalty`/`ManualIncurPenalty`.
- **Investment processor / commission / investor fees** (`InvestmentProcessorCommand`, `CommissionCommand`, `InvestorFeesCommand`) — adjacent to this domain (drive lender-side payout completion) but not expanded here as they belong more to the Investor/Payments domain.
- **`ResetRepaymentCommand`** — a one-off manual-fix script hardcoded to `borrow_id = 13`; not a general recurring job, but present in the same commands directory as real cron jobs (risk of accidental re-run).
- **`LoanCommand` (console)** — not evidenced to be scheduled; used interactively by ops for reconciliation (`validateonholds`, `doubleautoinvestdisc/cancel`), forced investment entry, and schedule recalculation.

## Integrations

- **DocuSign** (`DocuSignLib`, `DocSign`/`DocSignRecipient` models) — `LoanBorrowListing::sendDocSign()` builds the loan contract PDF, sets up borrower + two fixed internal signer roles (`newunion_doc_signer1/2_email/name` from params) at hardcoded PDF coordinates, and sends via DocuSign; `generateLoanContractProductB()` later fetches and merges the signed envelope + certificate PDFs from DocuSign's API into the final stored contract.
- **mPDF** (`PdfLib`) — server-side contract PDF rendering (`getContractFile()`), combined with `PdfMergerLib` to stitch multiple contract sections/certificates.
- **SMS** (`SMSLib`) — auto-publish success/failure notifications (hardcoded destination numbers) in `JobCommand`.
- **Email** (`EmailLib`, `EmailLog::queue`, `EmailTemplate`) — approval/rejection notices, funding-approved/cancelled notices to admin and lenders, payout success emails with net-of-fee breakdowns, "Investment Approved" template on `productBAcceptLoan()`.
- **Telegram** (`Telegram::log`) — internal ops notification on publish and on auto-invest trigger.
- **PHPExcel** (`PhpExcelLib`) — loan list exports, ongoing-repayment export, legacy loan-statement/schedule Excel exports.
- No payment-gateway integration was found directly in this domain's code — repayments appear to be posted manually by admin/collections staff against the internal ledger (`LoanBorrowRepaymentTxns`) rather than pulled automatically from a bank/PSP webhook; actual cash movement/reconciliation is out of scope of the files read.

## Tech Debt / Risks Observed

- **Penalty cron is disabled**: `LoanFeeCommand` (the driver for `LoanLib::IncurPenalty()`, the daily penalty-accrual job) lives in `cron/protected/commands/trash/`, meaning automatic daily penalty accrual is not part of the active cron set as checked in. Manual penalty entry remains the only reliably-wired path.
- **Missing config keys**: `Yii::app()->params['borrower_penalty_rate_daily']`, `['borrower_penalty_rate_outstanding']`, and `['withholding_tax_rate']` are read in `LoanLib.php` but do not appear in any of the three checked-in `params.php` files (prod/qa/dev) nor in any `Setting::get()` call site found — these values are either injected by an untracked config layer or the formulas silently evaluate against `null`/0 in the current codebase as checked in. Must be sourced from a real environment/DB value before porting the penalty formula.
- **Stale comment vs. constant mismatch**: `ServerLoanController::actionAutoInvest` comments reference a "65%" cap while the actual enforced constant `UserAutoInvest::MAX_PERCENT` is `0.80` (80%) — verify which figure is authoritative in production before encoding either into the rebuild.
- **"Close-and-clone" restructuring**: `LoanLib::restructureLoan()` doesn't modify the loan/lender records in place; it clones every attribute into new rows. This duplicates data and relies on `restructured_from_id`/status chains for traceability — the rebuild should decide deliberately whether to keep this event-sourced-by-accident pattern or model restructuring as first-class state transitions with proper history.
- **Duplicated amortization math**: `FinanceLib::generateLoanSchedule()` and `LoanLib::generateEffectRateSchedule()` are near-identical implementations of the same annuity/day-count formula, one on the legacy `LoanRequest` funnel and one on the current `LoanBorrowListing` engine — a maintenance hazard (a fix applied to one is easily missed in the other) and a strong signal the two funnels should be unified in the rebuild.
- **`CreditListing::chargePerWeek()`** computes `totalWeeks() / fee` (weeks divided by a percentage), which reads backwards from what "charge per week" should compute; needs a functional-correctness check against real usage/UI before being ported.
- **Hardcoded operational values**: two SMS destination numbers hardcoded in `JobCommand`; DocuSign signer coordinates (`posX`/`posY`) and page numbers hardcoded in `sendDocSign()`; a special-cased borrower id (`$loan->borrow_id !== '115'`) that suppresses payout emails for one specific historical loan in `LenderRepaymentPayNowAllEMRPayment()`; `ResetRepaymentCommand` hardcoded to `borrow_id = 13`.
- **Inconsistent `ONHOLD_FLAG` constant**: the API/admin model defines `ONHOLD_FLAG = 1` (100%) while the `user` app's stub model defines `ONHOLD_FLAG = 80` with a comment "at least 80% required" — the two are never compared directly (the `user` app doesn't run this logic), but the divergent comments/values are confusing documentation of the true qualification threshold and should be resolved to one source of truth.
- **Weak/duplicated validation surface**: `LoanIncurPenaltyForm`/`LoanPaymentForm` re-implement the same date-format/date-range validators verbatim; several commented-out validation branches remain in `LoanPaymentForm::validatePenalty()` (dead code left in place rather than removed), making it unclear which rules are actually enforced today.
- **Dev-only controller reachable via routing table**: `QaController` is guarded only by an `if (ENV_PRODUCTION) exit;` runtime check rather than being excluded from the routable controller set entirely; relies on `ENV_PRODUCTION` being correctly set in every real deployment.
- **Mixed currency assumptions**: the legacy `FinanceLib`/`LoanRequest` funnel is explicitly multi-currency (`USD`/`KHR`, with `ExchangeRate` conversions in aging/income reports), whereas `LoanBorrowListing`/`CreditListing` show no currency field in the code read — confirm whether the SG platform is single-currency (SGD) only, or whether currency handling was dropped when the newer engine was built.
- **No visible automatic payment-gateway reconciliation**: all repayment posting paths in the files read are admin-entered (single or dual-control); if there is a bank feed / payment gateway elsewhere in the system it wasn't found wired into this domain's controllers, which is worth flagging as a scope gap to confirm with the team before assuming manual-only repayment posting is by design.
- **`LoanBorrowPenalty` model** has a relation to `LoanBorrowListing` but no other code path in the domain was found reading/writing it — likely dead or only used elsewhere (e.g., a rate-configuration screen not covered by this pass); worth a quick grep across the whole codebase before assuming it can be dropped.
- **Environment-drifted platform default**: `params['minimum_lend_amount']` is `5000` in the checked-in prod and qa configs but `10000` in dev — confirms config values genuinely diverge per environment (not just the missing-penalty-rate case above), so any value pulled from `params.php` during this analysis should be re-verified against the live prod config, not assumed from dev.

## Proposed MVP Scope for Revamp

**Must-have (v1):**
- Core `LoanBorrowListing`-equivalent entity with status state machine (pending → approved → [on-hold/subscribing] → repayment → completed/cancelled/restructured) — this is the backbone every other feature hangs off.
- All three amortization engines (Balloon, EMR, Effective-Rate) faithfully reproduced, including the day-count-actual effective-rate math and the flat/simple-interest balloon/EMR math — losing any one of these breaks existing/renewing loans on that mode.
- Admin loan creation/edit/approve/publish flow, including Product B subscription-goal qualification and admin funding approval (`productBAcceptLoan`/`cancelFunding`).
- Investor eligibility checks at invest-time (funding cap, minimum lend amount + CRC exemption, subscription window, active-invest-date gating) — these are the rules that keep the ledger consistent; skipping them risks over-funded or invalid loans.
- Borrower repayment posting with the oldest-period-first allocation waterfall (principal → interest → penalty ordering as implemented) and the dual-control (`LoanPayment` pending/approve) workflow for balloon/EMR — this is a core financial-control feature, not cosmetic.
- Manual penalty entry and the daily/formula-based automatic penalty accrual (re-enabled and correctly configured, since the automatic version is currently effectively dead) — a fintech lender cannot run without configurable, working penalty logic.
- Loan restructuring flow (even if redesigned to be in-place rather than clone-based) — actively used per the dedicated 3-step admin wizard.
- `CreditListing` secured/receivables product with its own upfront-fee/buyback and equal-principal-installment schedule, since it's a live, separate product line offered to investors.
- Contract generation (PDF) and e-signature integration (DocuSign) — legally required artifact for every funded loan.

**Nice-to-have / defer:**
- The legacy `LoanRequest`/`LoanSchedule`/`FinanceLib` funnel and its Excel-based statements/aging reports — appears superseded by `LoanBorrowListing` for current-market (SG) loans; migrate any still-open legacy loans data-only rather than rebuilding the UI/flow.
- `LoanCommand`'s ad hoc reconciliation actions (`doubleautoinvestdisc/cancel`, `validateonholds`) — these exist to patch historical data-integrity bugs in fund holds; a clean rebuild with correct invariants shouldn't need equivalents, but keep as one-off scripts if migrating legacy data.
- Reserved/group-restricted "private deal" listings (`is_reserve`, `LoanBorrowGroupLink`) — a segmentation feature layered on top of core origination; valuable but not required to originate and repay a loan.
- SMS auto-publish notifications and the specific hardcoded-recipient behavior — reimplement generically (configurable recipients) rather than porting the hardcoded numbers, and it's not core-path (publishing itself is).
- QA/debug dump controller — recreate only as a proper internal admin/observability tool, not a copy of the raw-dump pattern.
- Detailed Excel export formats (list download, ongoing-repayment workbook, loan statement/schedule exports) — useful reporting but can follow after the core ledger and repayment engine are solid.
- Voucher/percentage-payout bonus interest on lender side (`isVoucherPercentagePayout`) — a promotions feature that layers on top of, but isn't required for, basic loan origination and repayment.
