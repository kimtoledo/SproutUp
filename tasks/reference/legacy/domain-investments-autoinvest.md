# Investments & Auto-Invest (Alfred)

## Overview

This domain covers three tightly-coupled things:

1. **Manual investing (pledging)** — an investor commits funds to a published loan listing. This happens either synchronously in-process (`LoanBorrowListing::AddInvestment`) or, for the current API flow, asynchronously via a queue table (`LoanLendPlanRequest` → cron `InvestmentProcessorCommand`).
2. **Fund-hold / escrow bookkeeping** — money is placed "on hold" (`UserFundHold`) the moment a pledge request is created, and only actually debited from the investor's balance once the pledge is confirmed (`UserFund::completePledge` → `successInvestment`). Cancelling releases the hold instead.
3. **Alfred** — an automated allocation engine (`UserAutoInvest::investAllUsers`) that, shortly after a loan is published, auto-pledges on behalf of investors who have configured Auto-Invest rules (`UserAutoInvest`), splitting the loan across a "priority lane" and a "regular lane" with hard percentage caps.

Actors:
- **Investor (end user)** — browses loans, manually pledges funds, configures Auto-Invest rules, cancels open pledges, links promotional vouchers to a pledge, views repayment schedule/contract for each investment.
- **Borrower (fundseeker)** — on the receiving end; loan-side repayment math (`LoanBorrowListing`) belongs to a different domain but is read here because `LoanLendRepaymentPlan` derives investor payouts from it (loan `returns`, `loan_tenor`, `days_base`, schedule).
- **Introducer** — attached to a plan (`introducer_id`) for commission tracking (out of scope here except as a foreign key/notification recipient).
- **Admin** — force-invests, cancels investments, manually triggers Alfred for one loan, grants/revokes "Priority Investor" status on a user, views a plan's repayment detail — all via `ServerLoanController` (the admin `InvestmentController.php` is a disconnected legacy stub, see Tech Debt).
- **System / cron ("Alfred" + queue processor)** — `AutoInvestCommand` (and duplicated logic in `LoanCommand::actionAutoInvest` / `ServicesCommand::actionAutoPublishLoan`) runs the Alfred allocation engine against newly-published loans; `InvestmentProcessorCommand` (and duplicated `ServicesCommand::actionProcessInvestment`) drains the `loan_lend_plan_requests` queue for manual pledges.
- **PitakaMo** — an external partner channel with its own direct-invest entry point that bypasses some of the normal validation (`postPitakaMoDirectInvest`, `isPitakamo()`).

## Current Features & Flows

### Admin dashboard (`seedin-live-admin`)
| Endpoint | Description |
|---|---|
| `backend/InvestmentController::actionView/Add/List/Draft/Edit` | Operates on a generic `Investment` / `InvestmentForm` model, **not** `LoanLendRepaymentPlan` — dead/vestigial stub disconnected from the real investment domain (see Tech Debt). |
| `server/ServerLoanController::actionAutoInvest` | Admin-triggered manual run of Alfred for one loan (`UserAutoInvest::investAllUsers`), with the same post-run 80%/100% cap re-validation as the cron job; requires the loan to already be published and `LoanLib::isAutoInvestAllow()` to be true. |
| `server/ServerLoanController::actionCancelInvestment` | Admin cancels an investor's pledge (`LoanLendRepaymentPlan::canAdminCancel()` → `cancelPledge()`), gated on the loan still being `on_hold` (subscription not yet finalized). |
| `server/ServerLoanController::actionPlanDetails` | Renders a single `LoanLendRepaymentPlan`'s detail/repayment table for the admin UI. |
| `server/ServerLoanController::actionPublishNow` | Publishes a loan (`LoanLib::publish`) — the event that starts the Alfred trigger-delay clock. |
| `server/ServerCustomerController` (customer edit form) | Grants/revokes **Priority Investor** status on a user by writing to `priority_investors` (`is_priority_investor` dropdown, `priority_investor_expire` date) — there is no dedicated Priority Investor admin screen; it's a field on the generic customer-edit form. |
| CLI `AutoInvestCommand::run()` (`newunion/cron/protected/commands/AutoInvestCommand.php`) | Cron entry point for Alfred: finds published, Alfred-enabled, not-yet-executed loans past the trigger delay and runs `UserAutoInvest::investAllUsers()` per loan inside a DB transaction; marks `alfred_executed=1` only on success. |
| CLI `InvestmentProcessorCommand::run()` | Long-running loop (2s poll) that drains pending `LoanLendPlanRequest` rows, completes the associated fund hold, and calls `$request->process()`. |
| Migrations `m180612_061751_enhancement`, `m190110_092323_investment_processor`, `m181127_032441_alfred_with_priority_lane`, `m181204_064951_priority_investors`, `m190408_032209_alfred_enhancement`, `m191008_031810_loan_restrict_non_investor` | Schema history for `user_auto_invest`, `loan_lend_plan_requests`, `user_auto_invest_logs`, `user_auto_invest_instructions`, `priority_investors`, and `loan_borrow_listings.alfred_enabled/alfred_executed/activate_invest_date/restrict_non_investor`. |

### API (`seedin-live-api-v1-1`) — where the investor-facing logic actually lives
| Endpoint / Method | Description |
|---|---|
| `ServiceLoanController::postInvest` | Primary manual-invest entry point. Validates amount, resolves a promo voucher, gates behind SMS OTP (mobile) or account-level OTP setting (web), then creates a `LoanLendPlanRequest` (which immediately places the amount on hold) and tells the client to wait — actual processing happens asynchronously in the cron. |
| `ServiceLoanController::postPitakaMoDirectInvest` | Direct-invest channel for the PitakaMo partner integration; skips the OTP step, still funnels through `LoanLendPlanRequest::create(..., 'pitakamo')`. |
| `ServiceInvestmentController::getList` | Paginated list of the logged-in investor's `LoanLendRepaymentPlan`s, filterable by `product_type` (pre-funding / crowd-funding). |
| `ServiceInvestmentController::getView` | Full detail of one investment: contract URL, repayment table/schedule (balloon, EMR, or effective-rate variant), earned dividends, voucher info, cancel/link-voucher eligibility, outstanding balance. |
| `ServiceInvestmentController::postCancel` | Investor-initiated cancellation of an open pledge — gated by `LoanLendRepaymentPlan::canCancel()`, which **only allows self-cancel for auto-invested plans** (`is_auto_invest = 1`), not manually-placed pledges (see Tech Debt / Business Rule). |
| `ServiceInvestmentController::postLinkVoucher` | Attach/detach a promo voucher (`UserVoucher`) to an existing pledge; triggers `resetRepaymentSchedule()` to recompute the schedule with the voucher applied. |
| `ServiceAutoInvestController::getList` | List the investor's Auto-Invest rules (`UserAutoInvest`) with decoded category/industry/repayment-mode filters. |
| `ServiceAutoInvestController::getView` / `postView` | Detail of one rule, expanding JSON-encoded `industries`/`repayment_modes` into id/name/on triples. |
| `ServiceAutoInvestController::getConfigs` | Hardcoded slider bounds for the rule-builder UI: interest 1–20% step 1, tenure 1–12 months step 1, allocation $1,000–$100,000 step $1,000. |
| `ServiceAutoInvestController::postDelete` | Delete a rule (ownership-checked). |
| `ServiceAutoInvestController::postUpdate` | Create/update a rule: parses `"min,max"` strings for interest/tenure/allocation, requires at least one industry selected. |
| `ServiceAutoInvestController::postAgreement` | One-time acceptance of the Auto-Invest T&Cs (`user.auto_invest_agree`) — gates whether the rule-builder UI is shown at all. |
| `ServiceAutoInvestController::postEnable` | Global on/off toggle for the user (`user.auto_invest_enable`) — separate from per-loan Alfred settings and per-rule `is_enabled`. |
| `ServiceAutoInvestController::getIndustries` | List of industries usable as a rule filter. |
| `cbase/commands/LoanCommand` (console, run on API host) | Ops CLI: `summary`, `detail`, `cancelinvestment`, `addinvestment` (bypasses subscription window via normal `AddInvestment`), `forceinvestment` (bypasses **all** invest validation, see Tech Debt), `autoinvest`, `scaninvestment` (reconciles `on_hold` vs. actual `UserFundHold` sum per loan), `validateonholds`/`doubleautoinvestdisc`/`doubleautoinvestcancel` (one-off data-repair scripts for duplicate/mismatched fund holds), `validatetotalinvestment`, `recalculateall`/`recalculateloan` (rebuild repayment schedules). |
| `cbase/commands/ServicesCommand` (console, long-running daemon) | `processinvestment` (same queue-drain loop as `InvestmentProcessorCommand`, but polling every **30 minutes** instead of 2 seconds — see Tech Debt), `autopublishloan` (auto-publishes a loan whose `publish_date` has arrived **and** runs the Alfred trigger in the same 2-second loop iteration). |
| `cron/protected/commands/AutoInvestCommand` / `InvestmentProcessorCommand` | Third and fourth near-identical copies of the same two jobs, packaged for the API app's own cron runner. |

### User app (`seedin-live-user`) — thin proxy layer
| Endpoint | Description |
|---|---|
| `frontend/InvestmentController` | Empty subclass of `LoanController` — loan browsing/detail lives in the Loans domain, not here. |
| `server/ServerInvestmentController::actionCancel` | Proxies to API `Investment/Cancel`. |
| `server/ServerInvestmentController::actionLinkVoucher` | Proxies to API `Investment/LinkVoucher`. |
| `server/ServerAutoInvestController::actionList` | Proxies to `AutoInvest/List`; if the user hasn't accepted the Auto-Invest agreement yet, renders the agreement prompt instead. |
| `server/ServerAutoInvestController::actionForm($id)` | Loads a rule (or blank form) and pre-fills `interest`/`tenure`/`allocation` as `"[min,max]"` strings for the slider widget. |
| `server/ServerAutoInvestController::actionUpdate/Agreement/Delete/Enable` | Proxy to the matching API endpoints; `Agreement`/`Enable` also refresh the cached `user` object in the PHP session after the call. |
| `frontend/views/autoinvest/_ajax_agreement.tpl`, `_ajax_form.tpl`, `_ajax_list.tpl` | The three partials that render the Auto-Invest agreement gate, rule builder, and rule list. |

## Business Logic & Computations

### 1. Investment ratio and total/monthly interest
`LoanLendRepaymentPlan::getInterestRate()` / `investmentRatio()` (admin `LoanLendRepaymentPlan.php:152-155, 350-352`):
```php
return $this->amount / $this->borrowlisting->amount;   // this investor's share of the whole loan
```
`calculateTotalInterest()` (`:260-263`):
```php
$total_interest = $this->borrowlisting->amount * (($this->borrowlisting->returns/100) * ($this->borrowlisting->loan_tenor/12));
return round($total_interest * $this->getInterestRate(), 2);
```
`calculateMonthlyInterest()` (`:256-258`): `round(calculateTotalInterest() / loan_tenor, 2)`.

### 2. Pro-rated first-month interest
`calculateFirstMonthInterest()` (`:265-293`) — only applied when the investor's own repayment start date is *after* the borrower's (i.e. they joined the loan partway through the first period):
```php
$dayDiff = (new DateTime($firstPeriodDate))->diff(new DateTime($lenderStartDate))->format("%a");
if ($dayDiff > $this->borrowlisting->days_base) $dayDiff = $this->borrowlisting->days_base;
return ($dayDiff / $this->borrowlisting->days_base) * ($this->borrowlisting->returns/100/12) * $this->amount;
```
If the investor's start date lands exactly one calendar month before the first schedule date, the pro-ration is skipped (returns 0) — full first-month interest is paid instead.

### 3. Dividend fee/tax netting (duplicated in two places — must stay in sync)
`LoanLendRepaymentPlan::earnedDividends()` (`:208-250`, display-only) and `UserFund::InvestorPayInterest()` (api `UserFund.php:310-355`, the actual money-moving version) apply the **same** formula:
```php
$interest_fee = round($netAmount * Yii::app()->params['interest_fee_rate'], 2);   // Risk Management Fee
// Two different tax formulas depending on a hardcoded cutover date:
if (date('Y-m-d') >= '2018-02-01') {
    $tax = round($netAmount * Yii::app()->params['withholding_tax_rate'], 2);
} else {
    $tax = round(($netAmount - $interest_fee) * Yii::app()->params['withholding_tax_rate'], 2);
}
$netAmount -= $interest_fee + $tax;
// RMF Discount voucher partially refunds the interest_fee:
if ($voucher && $voucher->isRMFDiscount()) {
    $rmf_discount_amount = $interest_fee * ($voucher->amount / 100);
    $netAmount += $rmf_discount_amount;
}
```
`interest_fee_rate = 0.05` (5%) is the only one of these two rates found statically defined in `params.php` (api `environments/prod/.../params.php:222`); `withholding_tax_rate` was not found in any inspected `params.php` (see Tech Debt).
This fee/tax logic only applies `if ($borrowlisting->has_interest_charge)` — some loans are configured with no interest charge at all, in which case the investor receives the gross interest untouched.

### 4. Elite Circle bonus (available-funds-only)
`InvestorPayBonus()` / the `$includeBonus` branch inside `getRepaymentBalloonPayment()` / `getRepaymentEMRPayment()` (admin `LoanLendRepaymentPlan.php:1267-1297, 801-823, 990-1012`):
```php
$elite_bonus_rate = [
    User::ELITE_GOLD      => 0.005,   // User.php:25
    User::ELITE_SOLITAIRE => 0.015,   // User.php:27
    User::ELITE_PLATINUM  => 0.01,    // User.php:26
];
$elite_bonus_amount = round((($this->available_funds_used * $rate) / 12) * $loan_tenor, 2);  // ELITE_NO_MONTHS = 12
```
Only applies when `available_funds_used > 0` (i.e. **not** funded from promotion/campaign credits) and only if `borrowlisting->is_allowed_bonus` is set on the loan; skipped entirely for sold plans (`isSold()`).

### 5. Voucher "Percentage Payout" bonus interest
`isVoucherPercentagePayout()` (`:1746-1749`) gates on `available_funds_used && voucher->isPercentage()`. When active:
```php
$totalVoucherInterest    = ($this->available_funds_used * ($voucher->amount / 100)) * ($loan_tenor / 12);
$voucherInterestPerMonth = $totalVoucherInterest / $loan_tenor;
```
Paid out per-period alongside interest via a separate `LoanLendRepaymentTxn::TYPE_VOUCHER` transaction and `UserFund::payVoucherInterest()` (which itself deducts an interest_fee-rate charge if the loan `has_interest_charge`).

### 6. Repayment table generation — three product shapes
`getRepaymentTable($includeBonus)` (`:1017-1027`) dispatches on the loan's rate type, with **no explicit else** (a listing matching none of these silently returns nothing — see Tech Debt):
- **Effective Rate** (`isEffectiveRate()`) → `getLoanScheduleEffectiveRate()`: scales the *borrower's* schedule by `investmentRatio()`, with per-row voucher interest computed from `LoanLib::generateEMRSchedule()` when a percentage-payout voucher is present.
- **Balloon** (`isBalloonPayment()`) → `getRepaymentBalloonPayment()`: full principal due at the last period, interest-only in between; a period is "Paid" only when the paid interest matches (rounded) the expected interest **and** principal is fully matched, "Partial"/"Partial Principal" otherwise; a period on an already-restructured loan that's still "Pending" is forced to status "Abort".
- **EMR — Equal Monthly Repayment** (`isEMR()`) → `getRepaymentEMRPayment()`: principal amortized evenly (`round(amount / loan_tenor, 2)`, with the last period absorbing the rounding remainder), status is taken directly from the *borrower's* per-period schedule status rather than recomputed independently.

### 7. Outstanding balance
`outstandingBalance()` (`:589-603`) branches by product shape: Effective Rate scales the borrower's outstanding by `investmentRatio()`; Balloon/EMR compute `amount - getTotalPaidPrincipal()` (floored at 0); a matured plan always reports 0.

### 8. Investment eligibility / pledge validation (`LoanBorrowListing::throwErrorsBeforeInvest`, api `LoanBorrowListing.php:886-928`)
Checked in order (any failure throws `InvestmentException`, unless `$force` is set — see Tech Debt for what `$force` actually bypasses):
1. Loan must exist and be `STATUS_APPROVED`.
2. `isActiveInvestDate()` — `strtotime(activate_invest_date) < now()`; if Alfred is enabled on the loan, manual investing is blocked until this timestamp so Alfred gets first pick.
3. `hasReachGoal()` — `currentMaximumAllowedInvestment() == 0` (i.e. `amount - total_funds`).
4. `isSubscriptionOver()` — `today >= financeEndDate()` where `financeEndDate() = endSubscriptionDate() = created_at + (subscription_days - 1) days`.
5. `canInvest($force)` — combines fully-funded / finance-ended / matured / preview-or-repayment-status checks.
6. `(total_funds() + amount) > amount` → "You can now only finance this maximum amount …".
7. `amount < minimumLendAmount()` — **unless** the investing user is the loan's designated `crc_user_id` (a carve-out for whoever raised the credit line).

### 9. Fund-hold lifecycle
- `UserFundHold::hold()` creates a `STATUS_HOLD` row and calls `UserFund::addHoldAmount()`, which validates `amount <= available()` (`balance - on_hold`) **unless** `$fund->skipValidation` is set (used for PitakaMo deposits).
- `complete()` moves the hold to `STATUS_COMPLETED` and calls `minusHoldAmount()` (releases the hold reservation — the actual balance debit happens separately via `successInvestment()` → `UserFund::minus()`).
- `cancel()` moves the hold to `STATUS_CANCELLED` and also calls `minusHoldAmount()` — cancelling and completing release the same `on_hold` amount; the difference is only which downstream ledger entries get written.
- Every hold state transition is mirrored into `UserFundHoldHistory` with a signed amount (`+amount` on `STATUS_HOLD`, `-amount` otherwise).

### 10. Async manual-invest pipeline
1. `ServiceLoanController::postInvest` → `LoanLendPlanRequest::create()` (api `LoanLendPlanRequest.php:60-86`) immediately calls `UserFundHold::hold($fund, $amount, TYPE_LOAN_REQUEST, $request_id)` — the money is locked before any loan-side validation runs.
2. `InvestmentProcessorCommand` (poll loop) picks up `STATUS_PENDING` requests, completes the hold (`$onHold->complete()`), opens a DB transaction, and calls `$request->process()`.
3. `process()` re-validates (`validateInvestmentAmount()` — re-checks `user->isCompleted()`, `availableFunds()`, and re-runs `throwErrorsBeforeInvest`) unless the source site is `pitakamo`, then calls `$loan->addFinance()` → `LoanBorrowListing::AddInvestment()`.
4. On success the request is marked `STATUS_SUCCESS` and linked to the new `repayment_plan_id`; on any exception the whole DB transaction rolls back and the request is marked `STATUS_FAILED` (`markAsFailed()`) with the exception message stored in `response`.
5. `AddInvestment()` itself: merges into an existing `STATUS_ONGOING` plan for the same user+loan if one exists (`_update()` just adds to `amount`) rather than creating a second plan row, else creates a new `LoanLendRepaymentPlan` + a `LoanLendListing` audit row per top-up; recalculates the schedule (`resetRepaymentSchedule()`); increments `loan.total_funds`; for Product B loans calls `UserFund::addPledge()` (places another `TYPE_LOAN_PLEDGE` hold for the *latest* increment) instead of immediately debiting — actual debit happens later via `completePledge()`.

### 11. Cancellation rules
- `LoanLendRepaymentPlan::canCancel()` (`:1868-1872`): `$this->is_auto_invest AND $this->isOpen()` — **investor self-service cancel is only available for Alfred-placed pledges.** A manually-placed pledge cannot be self-cancelled through the API once created (business rule as coded — confirm intent for rebuild).
- `canAdminCancel()` (`:1885-1888`): `!isReturnedInvestment() AND borrowlisting->on_hold` — admin can cancel any non-returned pledge, but only while the loan itself is still in the on-hold/pre-finalization state.
- `cancelPledge()` releases the `UserFundHold` (money never left the balance) and flips the plan to `STATUS_RETURNED`; `cancelInvestment()` (a separate code path, requires zero `repaymentTxns`) additionally credits the balance back via `FundTransaction::TYPE_INVESTMENT_CANCEL` and decrements the investment counter — used when funds were already fully debited (post-`completePledge`) but no repayment has occurred yet.

### 12. Alfred allocation engine (`UserAutoInvest`, admin/api `UserAutoInvest.php`)
Constants (`:5-8`):
```php
const MAX_REGULAR_PERCENT  = .40;   // 40% of loan amount reserved for the regular lane
const MAX_PRIORITY_PERCENT = .40;   // 40% of loan amount reserved for the priority lane
const MAX_PERCENT          = .80;   // combined 80% hard cap Alfred may fill before a loan goes live to manual investors
const MIN_INVESTMENT       = 1000;  // $1,000 minimum increment per allocation round after a user's first slice
```
**Trigger** (`AutoInvestCommand::run`, duplicated 3× — see Tech Debt): loans where `alfred_enabled = 1 AND alfred_executed = 0 AND is_published = 1 AND status = APPROVED AND (publish_date IS NULL OR publish_date + alfred_trigger_minutes minutes < now())`.

**Eligibility per investor** (`isQualified()`, `:465-566`):
- `user->progress() == 100` (fully onboarded) and `availableFunds() > 0`.
- No existing `is_auto_invest=1` plan on this loan that isn't already `STATUS_ONGOING` (prevents re-auto-investing into a cancelled/returned auto-invest slot).
- At least one active `UserAutoInvest` rule where: `loan.returns` within `[min_interest, max_interest]`, `loan.loan_tenor` within `[min_tenure, max_tenure]`, `loan.industry` is one of the rule's selected industries, `loan.repayment_mode` is one of the rule's selected repayment modes (defaults to Balloon+EMR if unset).
- Rule's remaining `max_allocation` (net of any existing investment on this loan) must be `> 0`, and both the investor's available funds **and** the rule's `max_allocation` must be `>= loan.minimum_lend_amount`.
- Per-user cap for this run = `min(availableFunds, remaining max_allocation)`.

**Sort order** (`validInvestors()`, `:655-674`): investors with **fewer** total prior investments first, then **lower** cumulative invested total, then `auto_invest_id` ascending — i.e. Alfred systematically favors newer/less-active investors over prolific ones when there isn't enough loan capacity for everyone.

**Priority lane gating**: priority is only offered at all if `loan.autoInvestInstructions()->priority_investor` is enabled for that loan (`user_auto_invest_instructions.priority_investor`), **and** is disabled outright the moment the loan already has *any* existing lender (`$isReRun`) — a re-run of Alfred (e.g. after a partial failure) treats the loan as no longer eligible for fresh priority allocations; only investors who already had money in before the re-run keep their priority-lane share.

**Two-lane round-robin split** (`getCalculatedAmounts()` / `splitInvestment()`, `:247-463`):
- Priority-lane investors are drained first, splitting the priority pool ($`maxAmountPriority`) across them: each user's first slice is `min(remainingCap, loan.minimum_lend_amount)`, subsequent slices are `min(remainingCap, MIN_INVESTMENT=$1000)`, capped further by whatever pool money is left.
- A priority investor who receives $0 in a pass (`movePriorityInvestor()`) is downgraded (`isDowngrade=true, isPriority=false`) and moved into the regular pool, re-sorted by original `sortOrder`, to get another chance from the regular lane.
- Any priority-lane money left unspent after priority investors are exhausted rolls into the regular lane's reserve; symmetrically, regular-lane leftovers roll back into the priority pool. The outer `do...while` keeps alternating lanes until either money or investors run out.
- Each allocation is logged per-user into `UserAutoInvestLog` with a breakdown of how much came from the `priority` vs. `regular` bucket (used later by `LoanLendRepaymentPlan::getAllotedAmounts()` for reporting).
- Actual pledge placement (`_investNow()`, `:581-653`) re-validates independently of the batch precondition (profile complete, subscription not over, `total_funds() < loan.amount * MAX_PERCENT`, `availableFunds() >= 0`, loan published) then calls `LoanBorrowListing::AddInvestment(..., $force = TRUE)`, flags the resulting plan `is_auto_invest = 1`, logs an `Activity`, queues an SMS (`CronJob::add(CRONTYPE_SMS_AUTO_INVEST)`), and emails/notifies both the investor and (implicitly) the introducer.

**Post-run safety re-check** (all three cron variants, identical): after `investAllUsers()` returns, the caller re-fetches `getTotalFunded()` and throws (rolling back the whole DB transaction, so **none** of that run's allocations persist) if funded amount exceeds `loan.amount * 0.80` or exceeds `loan.amount` outright — this is a belt-and-suspenders check *outside* the allocation algorithm rather than a hard constraint enforced inside it.

## Data Model

| Table | Model | Key columns |
|---|---|---|
| `loan_lend_repayment_plans` | `LoanLendRepaymentPlan` (PK `repayment_plan_id`) | `borrow_id`, `user_id`, `introducer_id`, `amount`, `version`, `contract_version` (1–4), `account_src`, `available_funds_used`, `promotion_funds_used`, `elite_type`, `repayment_start_date`, `voucher_id`, `src_site` (`nuph`/`pitakamo`), `status` (0 Ongoing…7 Abort-due-to-restructure, see enum below), `is_auto_invest`, `is_selling`, `sellable_flag`, `is_acquired`, `trade_list_id`, `earned_interest`, `created_at`. |
| `loan_lend_repayment_schedule` | `LoanLendRepaymentSchedule` (PK `id`) | `repayment_plan_id`, `borrow_id`, `period`, `child_period`, `date_repayment`, `amount`, `principal`, `interest`, `interest_voucher`, `paid`, `is_sold`. |
| `loan_lend_repayment_txns` | `LoanLendRepaymentTxn` (PK `repayment_txn_id`) | `user_id`, `borrow_id`, `repayment_plan_id`, `period`, `child_period`, `type` (1 Interest / 2 Principal / 3 Penalty / 4 Voucher), `amount`, `is_paid`, `on_hold`, `net_amount`, `net_details` (JSON), `pitakamo_status`, `created_at`. |
| `loan_lend_repayment_summary` | `LoanLendRepaymentSummary` (PK `repayment_txn_id`) | Table name + PK only; empty `relations()`/`rules()` — no write path found in the scanned code (likely dead/legacy). |
| `loan_lend_listings` | `LoanLendListing` (PK `lend_id`) | `repayment_plan_id`, `amount`, `introducer_id`, `user_id`, `borrow_id`, `created_at` — one row per incremental top-up to a plan (audit trail of multi-tranche financing). |
| `loan_lend_plan_requests` | `LoanLendPlanRequest` (PK `request_id`, migration `m190110_092323`) | `repayment_plan_id`, `user_id`, `borrow_id`, `amount`, `voucher_id`, `redeem_id`, `src_site`, `status` (1 Pending / 2 Success / 3 Failed), `response` (JSON), `created_at`, `updated_at` — the async invest queue. |
| `user_funds_hold` | `UserFundHold` (PK `id`) | `user_id`, `amount`, `ref_id`, `ref` (JSON), `type` (1 Withdrawal / 2 LoanPledge / 3 LoanRequest), `status` (0 Hold / 1 Cancelled / 2 Completed), `created_at`, `cancelled_at`, `completed_at`. |
| `user_funds_hold_history` | `UserFundHoldHistory` (PK `id`) | `user_id`, `funds_hold_id`, `type`, `amount` (signed +/-), `status`, `ref`, `ref_id`, `created_at`. |
| `user_auto_invest` | `UserAutoInvest` (PK `auto_invest_id`, migration `m180612_061751`) | `user_id`, `name`, `min_interest`/`max_interest` (float), `min_tenure`/`max_tenure`, `min_allocation`/`max_allocation` (decimal), `categories` (JSON), `industries` (JSON), `repayment_modes` (JSON, added later), `is_enabled`, `status`, `created_at`, `updated_at`. |
| `user_auto_invest_instructions` | `UserAutoInvestInstructions` (PK `id`, migration `m181127_032441`) | `borrow_id`, `priority_investor` (bool), `no_introducer_first` (bool), `created_at`, `updated_at` — per-loan Alfred config, one row per loan that has ever had `autoInvestInstructions()` accessed/saved. |
| `user_auto_invest_logs` | `UserAutoInvestLog` (PK `id`, migration `m181127_032441`) | `user_id`, `auto_invest_id`, `repayment_plan_id`, `allocation` (decimal), `is_success`, `errors`, `data` (JSON: `isPriority`, `isDowngrade`, `rules` snapshot, `investmentHistory`, `maxAmount`, `previousAllocations`, `allocations: {priority, regular}`, `allowPriority`), `created_at`. |
| `priority_investors` | `PriorityInvestor` (PK `id`, migrations `m181127_032441` + `m181204_064951`) | `user_id`, `admin_id` (who granted it), `voucher_id`, `expire_at`, `status` (0 Active / 1 Disabled), `data`, `created_at`, `updated_at`. `isActive()` requires both `status == ACTIVE` **and** `expire_at` in the future. |
| `loan_borrow_listings` (subset relevant here) | `LoanBorrowListing` | `alfred_enabled`, `alfred_executed` (migration `m190408_032209`), `activate_invest_date` (migration `m181127_032441`), `restrict_non_investor` (migration `m191008_031810`), `minimum_lend_amount`, `total_funds`, `amount`, `loan_tenor`, `returns`, `subscription_days`, `industry`, `repayment_mode`, `days_base`, `publish_date`, `is_published`, `status`, `crc_user_id`. |
| `users` (subset relevant here) | `User` | `auto_invest_enable`, `auto_invest_agree`, `elite_type`, `priority_investor_expire` (legacy free-text field superseded by the `priority_investors` table). |

## Cron/Automation Dependencies

- **Alfred trigger** — four near-duplicate implementations of the same ~50-line block: `newunion/cron/protected/commands/AutoInvestCommand.php` (admin and api repos), `newunion/cbase/commands/LoanCommand.php::actionAutoInvest` (api), and inline inside `newunion/cbase/commands/ServicesCommand.php::actionAutoPublishLoan` (api, admin) — the last one shares its poll loop with loan auto-publishing. All poll for `alfred_enabled=1 AND alfred_executed=0 AND is_published=1 AND status=APPROVED` loans past `publish_date + alfred_trigger_minutes`, run `UserAutoInvest::investAllUsers()` per loan in its own DB transaction, re-verify the 80%/100% funding caps, and set `alfred_executed=1` only on success (so a failed run will be retried on the next poll).
- **Investment request processor** — `newunion/cron/protected/commands/InvestmentProcessorCommand.php` (admin and api, 2-second poll) and `newunion/cbase/commands/ServicesCommand.php::actionProcessInvestment` (api, **30-minute** poll — inconsistent with the other copy, see Tech Debt) drain `loan_lend_plan_requests` where `status = PENDING`, completing the associated fund hold and calling `LoanLendPlanRequest::process()` inside a transaction per request.
- **Loan auto-publish** — `ServicesCommand::actionAutoPublishLoan` publishes any approved loan whose `publish_date` has arrived, then immediately runs the Alfred trigger in the same loop iteration (2s sleep) — the two jobs are operationally coupled even though they're logically separate.

## Integrations

- **Email** — `EmailLib` / `EmailLog::queue()` for investment success/failure notifications, contract delivery (`sendContract()`), and "fund reach maturity" notices; templated per-event (`LoanFinanceSuccess`, `LoanFinanceFailed`, `DonateSuccess`, `FundPayoutSuccess`, etc).
- **In-app notifications** — `Notification::` class mirrors most of the email sends (e.g. `Notification::LoanFinanceSuccess`).
- **Telegram** — `Telegram::log()` posts investment success/failure events and Alfred trigger events to an ops channel.
- **SMS** — `SMSLib` sends an ops alert when a loan is auto-published; a separate SMS-to-investor is queued (not sent inline) via `CronJob::add(CronJob::CRONTYPE_SMS_AUTO_INVEST, ...)` whenever Alfred places a pledge, deferring the actual send to yet another downstream cron job not in this domain's scanned files.
- **OTP** — `OTPLib` + `Device::validateDevice()` gate manual web/mobile investment (`ServiceLoanController::postInvest`) behind a one-time-passcode challenge unless the account has OTP disabled.
- **PDF generation** — `RazorViewRenderer` + `PdfLib` (mPDF) + `PdfMergerLib` render the per-investment contract (`getContractFile()`), varying template by loan type (EMR/Product B/etc) and contract version.
- **PitakaMo (external partner platform)** — a parallel direct-invest channel (`postPitakaMoDirectInvest`, `isPitakamo()`, `depositPitakamo()`, `pitakamo_status` field on repayment txns) that funds an investment via an external reference ID rather than the normal wallet-hold flow.
- **Activity log** — `Activity::adminLog` / `Activity::userLog` / `Activity::addCustom` record every pledge, cancellation, and Alfred trigger (success or failure) for audit purposes.

## Tech Debt / Risks Observed

- **Quadruplicated cron logic.** The Alfred trigger block and the investment-request-processor loop each exist in 3–4 near-identical copies across `cron/protected/commands/` (admin + api) and `cbase/commands/` (`LoanCommand`, `ServicesCommand`) — any future logic change (e.g. adjusting the 80% cap) has to be made consistently in all copies or the environments will silently diverge.
- **Inconsistent poll intervals for the same job.** `InvestmentProcessorCommand` polls every 2 seconds; `ServicesCommand::actionProcessInvestment` (a copy of the same job) polls every **1800 seconds (30 minutes)** — depending on which daemon is actually running in a given environment, investor-perceived latency for "please wait, we're processing your investment" varies from seconds to half an hour.
- **`alfred_trigger_minutes` param not found statically defined.** All six call sites read `Yii::app()->params['alfred_trigger_minutes']`, but no `params.php` file inspected across either repo defines it — if truly unset in production config, `DATE_ADD(..., INTERVAL NULL MINUTE)` / string concatenation would coerce to `0`, meaning Alfred could fire essentially immediately at publish instead of after the intended grace period. Needs runtime config verification before the rebuild copies this behavior.
- **`withholding_tax_rate` param likewise not found in any inspected `params.php`**, only `interest_fee_rate = 0.05`. Either it's injected by a DB-backed settings loader outside the scanned paths, or it's a latent misconfiguration — flag as a hidden dependency to track down before porting the dividend-tax formula.
- **Hardcoded date cutover baked into business logic.** The withholding-tax formula branches on the literal string `'2018-02-01'` in two separate files (`LoanLendRepaymentPlan::earnedDividends()` and `UserFund::InvestorPayInterest()`) — correct historical behavior, but a landmine if the rebuild needs to reproduce exact historical dividend figures without also porting the literal date branch.
- **`AddForceInvestment()` skips all pledge validation.** Unlike `AddInvestment()`, `AddForceInvestment()` (api `LoanBorrowListing.php:1170+`) has `throwErrorsBeforeInvest()` commented out entirely (line ~1184) — the `forceinvestment` CLI command can push an investment past the goal amount, past the subscription window, or into a non-approved loan with zero server-side guardrails.
- **Self-cancel is auto-invest-only.** `LoanLendRepaymentPlan::canCancel()` requires `is_auto_invest = 1` — a manually-placed pledge cannot be cancelled by the investor through the API at all (only an admin can, via `canAdminCancel()`, and only while the loan is still `on_hold`). Worth confirming this is intentional product behavior rather than an oversight before the rebuild encodes it as a rule.
- **Stale docblock vs. constants.** `UserAutoInvest::_investNow()`'s docblock (`:569-580`) describes "Priority Investor: 45% / Others: 25%", but the actual constants are `MAX_PRIORITY_PERCENT = .40` and `MAX_REGULAR_PERCENT = .40` — the comment does not match the shipped percentages (40/40/80, matching the domain brief), a clear signal the split ratio changed at some point without updating the docs.
- **Admin `InvestmentController.php` is dead code.** It CRUDs a generic `Investment`/`InvestmentForm` model that has no relationship to `LoanLendRepaymentPlan` — none of the routes an admin actually uses for investment management (`ServerLoanController::actionAutoInvest/actionCancelInvestment/actionPlanDetails`) go through it. Should not be treated as a spec for admin investment screens.
- **`getRepaymentTable()` has no fallback branch.** If a loan matches none of `isEffectiveRate()/isBalloonPayment()/isEMR()`, the method implicitly returns `null`, and every caller (`getLoanStatement`, `resetRepaymentSchedule`, contract generation, API `getView`) assumes an array — a new/misconfigured product-type flag combination would fail silently or throw downstream rather than at the source.
- **~90% code duplication between `getRepaymentBalloonPayment()` and `getRepaymentEMRPayment()`** (~170 lines each) — the two most important computed-schedule methods diverge only in a handful of lines (principal amortization formula, status source), increasing the odds of a bug fix applied to one and missed in the other.
- **Two independently-maintained copies of `LoanLendRepaymentPlan.php`** (admin vs. api repos) have already drifted — `getLoanPaymentsRecords()` differs between the two (api version added an EMR/Balloon product-type branch and switched to `net_amount()` for EMR; admin version still uses the older unconditional `amount()`). Confirms these "common" models are not actually shared/synced automatically between repos.
- **Raw SQL string concatenation in ops CLI commands** (`LoanCommand::actionValidateOnHolds`, `actionDoubleAutoInvestDisc`, `actionKeyPrintingPress`) builds queries by interpolating variables directly into SQL strings rather than using parameterized queries — lower risk since these are console-only, but a pattern to avoid carrying into the rebuild's tooling.
- **`actionKeyPrintingPress` is a permanent one-off data-fix script** — hardcoded `borrow_id = 115`, hardcoded `0.17` interest rate, hardcoded `300/360` day-count, and hardcoded voucher description strings, committed into the general-purpose `LoanCommand` CLI surface rather than run-once-and-removed.
- **`canLinkVocher()` / `canLinkVoucher` naming typo** is baked into both the model method name and the API wire format (`ServiceInvestmentController` response key `canLinkVoucher` vs. model method `canLinkVocher()`), plus the model has a duplicate no-op override that always returns `FALSE` (`:1874-1878`) shadowing the real logic in `LoanLendRepaymentPlan` — needs to be traced to whichever repo's copy is authoritative before porting.
- **Belt-and-suspenders cap enforcement.** Alfred's per-lane math never hard-stops at 80%/100% *inside* `investAllUsers()`/`_investNow()` itself (each user's own eligibility check uses `total_funds() >= maxAutoInvestAmount` as an exception trigger, not a pre-filter) — the actual backstop is the caller re-checking after the fact and rolling back the entire transaction on breach. Correct today because the check is synchronous and same-transaction, but a subtler bug (e.g. concurrent Alfred runs on the same loan) could pass both individual checks and still land in an invalid combined state before the outer check catches it.

## Proposed MVP Scope for Revamp

### Must-have (v1)
- **Manual pledge flow with fund hold** — request → hold → validate → confirm/reject, even if implemented synchronously instead of via a polling queue table; this is the core money-safety mechanism (hold before commit, release on cancel/failure) and cannot be dropped.
- **Core interest/dividend computation** — investment ratio, total/monthly interest, pro-rated first-month interest, and the fee/tax netting formula (RMF + withholding tax) — this is the number investors are paid; must be ported byte-for-byte or the platform pays people incorrectly.
- **Balloon and EMR repayment table generation** — the two live product shapes; Effective Rate can likely be deferred if it's legacy/unused in current listings (verify against the Loans domain before deferring).
- **Pledge cancellation with correct fund-hold release** — both the "still on hold, never debited" (`cancelPledge`) and "debited, no repayment yet" (`cancelInvestment`) paths, since they touch real money and have different ledger consequences.
- **Alfred core allocation algorithm** — priority/regular lane split with the 40/40/80% caps and $1,000 minimum increment, investor eligibility rules (rule matching on interest/tenure/industry/repayment-mode, funds sufficiency), and the least-active-investor-first sort order — this is the differentiating automated feature named explicitly in the domain brief.
- **Auto-Invest rule CRUD + agreement/enable gating** — investors need to configure Alfred before it can run; this is table-stakes for the feature to exist at all.
- **Post-run over-allocation safety check with transactional rollback** — non-negotiable money-safety guarantee; should ideally be moved *inside* the allocation transaction rather than kept as an external re-check, but the guarantee itself must be preserved.

### Nice-to-have / defer
- **Elite Circle bonus and Priority Investor voucher-linked bonuses** — narrow-audience loyalty perks layered on top of core investing; can launch v1 without them and backfill once the core flow is stable.
- **Voucher "Percentage Payout" / "Junkard Chips" / "RMF Discount" special investment types** — promotional mechanics that add real complexity (separate transaction types, schedule recalculation triggers) for a feature that's marketing-driven rather than core lending; defer until the promotions/vouchers domain is scoped.
- **PitakaMo direct-invest channel** — a single external-partner integration with its own bypass logic; only needed if that partnership is still active — confirm before porting.
- **PDF contract generation pipeline** — important for compliance but can initially be served from the legacy system or handled as a follow-on integration rather than blocking the core invest/Alfred rebuild.
- **CLI ops tooling** (`scaninvestment`, `validateonholds`, `doubleautoinvestdisc/cancel`, `keyprintingpress`) — these are reconciliation/incident-response scripts, not product features; rebuild equivalents only as real operational needs surface, and do not port the hardcoded one-off scripts verbatim.
- **Admin `InvestmentController` CRUD screens** — already dead code against the real domain model; do not resurrect, design fresh admin screens against `LoanLendRepaymentPlan`/Alfred directly instead.
- **Dedicated Priority Investor admin UI** — currently a buried field on the generic customer-edit form; low usage surface, fine to keep minimal (or fold into the general admin user-management screen) rather than building a standalone feature.
