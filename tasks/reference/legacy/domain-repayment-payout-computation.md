# Investor Payouts & Fund Ledger

> **Revamp direction:** Calculations must support configurable Philippine taxes, gross/deduction/net reporting, PHP amounts, and versioned effective dates. Legacy Singapore rates and formulas below are reference material until validated for the Philippine product.

## Overview

This is the money-movement core of the SeedIn / New Union platform: the engine that takes a borrower's repayment and turns it into money that lands in investors' wallets. For every peso/dollar a borrower repays, this domain:

1. Splits the payment **pro-rata** across every investor ("lender") in that loan, based on each investor's share of the total funded amount (`investmentRatio()`).
2. Nets each investor's gross interest into **net dividends** by deducting a **Risk Management Fee (RMF)** and **Withholding Tax (WHT)**.
3. Credits/debits the `user_funds` wallet balance (`UserFund`) and writes an immutable, typed audit-trail row to `fund_transactions` (`FundTransaction`) for every movement.
4. Returns **principal** to investors (either monthly for EMR/amortizing loans, or as a lump sum at maturity for balloon/bullet loans).
5. Pays **penalty income** collected from a late borrower back out to investors pro-rata, and pays out **bonus** schemes (Elite Circle tiered bonus, red-packet vouchers, referral bonus, RMF-discount vouchers).
6. Provides the ledger (`FundTransaction`) that both the Admin dashboard and the User app read to show balances, transaction history, and payout reports.

It sits downstream of loan origination/investment (handled by a separate domain) and upstream of withdrawal payout to investors' bank accounts.

**Actors:**
- **Borrower** — triggers the whole chain by making a repayment (admin-recorded "Pay Now" action; no self-service borrower repayment UI was found in these repos).
- **Investor** — receives interest, principal, penalty income, and bonuses into their `UserFund` wallet; requests withdrawals.
- **Admin (Ops)** — manually records each borrower repayment via `LoanLib::Borrower*RepaymentPayNow()`, approves/rejects investor withdrawal and top-up requests, runs one-off "fix" console commands when the computation breaks.
- **System / cron** — `InvestmentPayoutLib` (balloon-payment maturity payout), `InvestmentProcessorCommand` (investment placement queue), `InvestorFeesCommand`/`InsuranceFeeCommand`/`ResetRepaymentCommand` (one-off hand-patch scripts).
- **Introducer/Partner** — receives `TYPE_COMMISSION` ("SeedIn Partner Payout") fund transactions computed by `CommissionLib`.

---

## Current Features & Flows

### Admin Dashboard (`seedin-live-admin`)

| Endpoint / Action | Description |
|---|---|
| `LoanLib::BorrowerBalloonRepaymentPayNow($id, $data, $isReviewed)` | Admin records a balloon/bullet-loan repayment (interest + principal + penalty), credits borrower's fund, deducts loan outstanding, then fans the payment out to all investors. `LoanLib.php:293` |
| `LoanLib::BorrowerEMRRepaymentPayNow($id, $data, $isReviewed)` | Same as above, for Equal Monthly Repayment (EMR/amortizing) loans. `LoanLib.php:388` |
| `LoanLib::BorrowerRepaymentEffectiveRatePayNow($id, $data)` | Records an effective-rate (interest-on-outstanding, ACT/365) loan repayment; computes settlement/incurred interest by elapsed days, splits pro-rata to lenders. `LoanLib.php:502` |
| `LoanLib::LenderRepaymentPayNowAllBalloonPayment(...)` | Internal: pro-rata splits one borrower repayment across all balloon-loan investors, creates `LoanLendRepaymentTxn` rows, calls `UserFund::InvestorPayInterest/InvestorEarnPenalty/InvestorReturnPrincipal`, emails each investor. `LoanLib.php:645` |
| `LoanLib::LenderRepaymentPayNowAllEMRPayment(...)` | Same, for EMR loans; also computes voucher-percentage-payout interest and red-packet payout. `LoanLib.php:836` |
| `LoanLib::IncurPenalty()` | Batch job logic: computes daily late-penalty + one-time outstanding-based penalty for every unpaid, overdue schedule row across all Product A loans. `LoanLib.php:1212` |
| `LoanLib::ManualIncurPenalty($id, $data)` | Admin manually adds an ad-hoc penalty to a specific period. `LoanLib.php:1450` |
| `LoanLib::restructureLoan($id, $data)` | Clones a loan + its lender plans into a new restructured loan/plan set, aborts the old ones. `LoanLib.php:1134` |
| `LoanLib::updateStatus($loan)` | Marks a loan `STATUS_COMPLETED` once every schedule period is paid. `LoanLib.php:628` |
| `WithdrawalController::actionList/actionDownload` | Lists/exports pending investor withdrawal requests (Excel). |
| `RequestController::actionWithdrawal($id)` / `actionDeposit($id)` | Admin review screens for a single withdrawal/deposit `FundRequest`. |
| `RequestController::actionReferralBonus($id)` | Shows referral-bonus payout detail for a `Request`. |
| `ServerRequestController::actionFundRequestStatusUpdate` | AJAX: admin approves/rejects a `FundRequest` (deposit or withdrawal), calling `FundRequest::updateStatus()`. |
| `PayoutController::actionIndex/actionDownload` | Yearly dividend payout report + Excel export with a monthly line chart, built from `ReportLib::getFundsTxnByYear/getFundsTxnDetailsByYear`. |
| `FundsController::actionIndex/actionDownload` | "User Funds" report: available/on-hold/invested/earned-dividend snapshot per investor, exported to Excel. |
| `FundsController::actionTransactions` | Full `fund_transactions` ledger export for a given year, joined with bank/loan reference detail, with investor/fundseeker role tagging. |
| `IdlefundsController::actionIndex/actionDetails` | "Idle funds" report — calls the MySQL **stored procedure** `idling_funds_details(user_id, date)` (business logic lives in the DB, not in this codebase). |
| `LoanCommand` (`cbase` console) | `recalculateall`, `recalculateloan` — recompute a loan/plan's repayment schedule; `keyprintingpress` — hand-patch script (see Tech Debt); `scaninvestment` — diffs on-hold fund vs. pledge amount per lender; `validateonholds`/`doubleautoinvestdisc`/`doubleautoinvestcancel` — fix scripts for duplicated auto-invest holds; `forceinvestment`/`addinvestment` — force-create an investment bypassing subscription window. |

### API (`seedin-live-api-v1-1`) — RPC service layer consumed by both Admin and User apps

| Endpoint | Description |
|---|---|
| `ServiceTransactionController::getList()` | Paginated `fund_transactions` history for the logged-in user (debit/credit/balance/description), filters out zero-amount rows. |
| `ServiceTransactionController::postCreditComment()` | Returns admin's comment for a manual credit adjustment (`UserAdditionalCredit`). |
| `ServiceTransactionController::postForceWithdrawComment()` | Returns admin's comment for a forced withdrawal (`UserForceWithdrawal`). |
| `ServiceRequestController::postTopUp()` | Creates a deposit request; branches to NUWallet, Paynamics (online banking/OTC/e-wallet), or manual bank-transfer-with-attachment flow. |
| `ServiceRequestController::postPaynamicsConfirm/Cancel()` | Payment-gateway callback handlers for Paynamics top-ups. |
| `ServiceRequestController::postNuwalletConfirm/Cancel()` | Callback handlers for the internal NUWallet gateway. |
| `ServiceRequestController::postWithdraw()` | Creates an investor withdrawal `FundRequest`, with OTP verification gate, then emails/notifies and defers to admin approval. Branches to `postWithdrawCoinsPH()` for crypto payout. |
| `ServiceRequestController::postWithdrawCoinsPH($form)` | Coins.ph wallet withdrawal path. |
| `ServiceRequestController::postWithdrawOld()` | Legacy withdrawal flow, still present alongside the current one. |
| `ServiceRequestController::postPitakaMoWithdrawal()` / `postTopupCoinsph()` | Withdrawal/top-up for the PitakaMo and Coins.ph payment partners. |
| `ServiceFundController::getOnHoldList()` | Lists a user's `UserFundHold` records (pledges/withdrawal holds). |
| `LoanLendRepaymentPlan::InvestorMakeRepaymentEffectiveRate/InvestorReturnCapitalBalloonPayment/InvestorPayBonus/InvestorEarnPenalty` | Per-investor-plan payout entry points invoked by the repayment flows above. |
| `LoanLendRepaymentTxn::create/getIfExisting` | Idempotent ledger-row factory for interest/principal/penalty/voucher payouts per investor per period. |

### User App (`seedin-live-user`) — thin proxy controllers, all real logic is in the API service layer above

| Endpoint | Description |
|---|---|
| `ServerTransactionController::actionList()` | Proxies to `Transaction/List`; renders `/transaction/_ajax_list` partial. |
| `ServerTransactionController::actionCreditComment()` | Proxies to `Transaction/CreditComment`. |
| `ServerTransactionController::actionForceWithdrawComment()` | Proxies to `Transaction/ForceWithdrawComment`. |
| `ServerBorrowController::actionRepaymentList()` | Proxies to `Borrow/Repayments`; renders the borrower's own repayment/statement view. |
| Views under `applications/frontend/views/transaction` and `.../account` | Render transaction history, dividend/payout statements, and idle-fund/withdrawal screens from the API JSON payloads above. |

---

## Business Logic & Computations

**This is the section most at risk of being silently lost in a rewrite — every formula below was taken verbatim or near-verbatim from the current PHP.**

### 1. Pro-rata investor split

Every investor's share of a loan is their **investment ratio**:
```php
// LoanLendRepaymentPlan.php:350
public function investmentRatio(){
    return $this->amount / $this->borrowlisting->amount;
}
```
Every dollar the borrower repays (interest, principal, or penalty) is multiplied by this ratio per investor. For interest specifically, an `interest_ratio` (this period's interest ÷ this loan's flat monthly interest) is also applied so that a pro-rated first period doesn't over/under-allocate (`LoanBorrowListing::LenderRepaymentPayNowAllBalloonPayment`, `LoanLib.php:686`).

### 2. Monthly interest (balloon / bullet loans)

```php
// LoanLendRepaymentPlan.php:260-263
$total_interest = $this->borrowlisting->amount * (($this->borrowlisting->returns/100) * ($this->borrowlisting->loan_tenor/12));
return round($total_interest * $this->getInterestRate(), 2);   // getInterestRate() == investmentRatio()

// calculateMonthlyInterest(), LoanLendRepaymentPlan.php:256
return round($this->calculateTotalInterest() / $this->borrowlisting->loan_tenor, 2);
```
i.e. `monthly interest = principal × (annual rate% ) × (tenor_months/12) / tenor_months`, apportioned to the investor by their pledge ratio.

### 3. Balloon-payment amortization table

```php
// LoanLib::generateBalloonRateSchedule, LoanLib.php:1332
$interest = round(($loan_amount * ($interest_rate / 100)) * ($month / 12) / $month, 2);
$total_interest = round($interest * $month, 2);
// principal = 0 every period except the last, where principal = full loan_amount
```
Flat interest every period; principal repaid entirely in the final period.

### 4. EMR (Equal Monthly Repayment) amortization table

```php
// LoanLib::generateEMRSchedule, LoanLib.php:1368
$monthlyPrincipal = round($loan_amount / $month, 2);
$interest = round($loan_amount * ($interest_rate / 100) / 12, 2);   // flat interest on original principal, NOT declining balance
$lastMonthlyPrincipal = $loan_amount - ($monthlyPrincipal * ($month - 1));   // absorbs rounding remainder
```
Note this is **not** a declining-balance amortization — interest is flat every period based on original loan amount, only principal is equal-split (with the last period absorbing the rounding remainder).

### 5. Effective-rate loans (interest-on-outstanding, actual/365)

```php
// EffectiveRateRepaymentMethod::calculateIncurredInterest, EffectiveRateRepaymentMethod.php:37
$outstanding = $this->loan->outstandingBalance();
return round($outstanding * ($days * $this->loan->returns / 365) / 100, 2);

// calculateSettleMent, EffectiveRateRepaymentMethod.php:246-255
$days = abs(DateTimeLib::datediff('d', $last_payment_date, $payment_date));
$interest = $days * ($this->loan->returns / 365);
$total_interest = round(($outstanding * $interest / 100), 2);
return $outstanding + $total_interest;
```
Day-count convention: **actual days / 365**, applied to the currently outstanding balance (true interest-on-outstanding / reducing-balance method) — the only one of the three repayment methods that is a genuine reducing-balance calculation. Balloon and EMR are both flat-interest schedules despite EMR's name suggesting amortization.

### 6. First-period proration

When an investor joins after the loan's official repayment start date, their first interest period is pro-rated by elapsed days over `days_base` (loan's configured day-count base):
```php
// LoanLendRepaymentPlan::calculateFirstMonthInterest, LoanLendRepaymentPlan.php:265-293
if ($dayDiff > $this->borrowlisting->days_base) $dayDiff = $this->borrowlisting->days_base;
return ($dayDiff / $this->borrowlisting->days_base) * ($this->borrowlisting->returns/100/12) * $this->amount;
```
A large block of related legacy logic is commented out (`borrow_id_start_prorated_fix` gate), indicating this proration rule itself was previously patched in production due to a "missing first day prorated calculation" bug (see comment at `LoanLendRepaymentPlan.php:304`).

### 7. Risk Management Fee (RMF) + Withholding Tax (WHT) — the core net-dividend formula

```php
// UserFund::InvestorPayInterest, UserFund.php:310-355
$interest_fee = round($lendTxn->amount * Yii::app()->params['interest_fee_rate'], 2);

// Formula changed 1-Feb-2018:
if (date('Y-m-d') >= '2018-02-01') {
    $tax = round($lendTxn->amount * Yii::app()->params['withholding_tax_rate'], 2);              // tax on GROSS interest
} else {
    $tax = round(($lendTxn->amount - $interest_fee) * Yii::app()->params['withholding_tax_rate'], 2);  // tax on interest NET of RMF
}

$netAmount = $lendTxn->amount - $interest_fee - $tax;

// RMF-discount voucher, if attached to the investment:
if (isset($repaymentplan->voucher) and $repaymentplan->voucher->isRMFDiscount()) {
    $rmf_discount_amount = $interest_fee * ($repaymentplan->voucher->amount / 100);
    $netAmount += $rmf_discount_amount;   // refunded back to investor as TYPE_RMF_DISCOUNT
}
```
`interest_fee_rate` = **5%** in production config (`params.php:222`, `'interest_fee_rate' => 0.05`). `withholding_tax_rate` is read from `Yii::app()->params['withholding_tax_rate']` throughout the codebase (`LoanLib.php:806,1023`, `UserFund.php:324`, `InvestorFeesCommand.php:17`) but **could not be found defined in any of the prod/qa/dev `params.php` files searched** — see Tech Debt. A hand-patch script comment states the historical value: *"tax was .20% originally, .15% now dahil sa train law"* (Philippines TRAIN tax law reform) — i.e. WHT dropped from 20% to 15% at some point. The identical net-formula logic is duplicated in three places: `UserFund::InvestorPayInterest()`, `LoanLendRepaymentPlan::earnedDividends()`, and `LoanLib::interestNet()` — all three must independently stay in sync (a direct sign of the "fix scripts" pattern: any rate change had to be hand-edited in ≥3 files).

Simplified net formula used for display (`LoanLib::interestNet`, `LoanLib.php:1509`):
```php
$interest_fee = round($interest * interest_fee_rate, 2);
$tax          = round($interest * withholding_tax_rate, 2);
net           = interest - interest_fee - tax + principal;
```

### 8. Borrower penalty (late payment)

```php
// LoanLib::IncurPenalty, LoanLib.php:1212-1287
$penalty = round((borrower_penalty_rate_daily/100) * $unpaid_amount * $daysDiff, 2);
if ($schedule->penalty == 0) {   // one-time flat penalty, only on the FIRST time a period goes overdue
    $penalty += (borrower_penalty_rate_outstanding/100) * $loan->amount;
}
$penalty = round($penalty, 2);
```
Two components: (a) a **daily accrual** on the unpaid interest amount, re-applied every run based on days since the last penalty was recorded (or since due-date if none yet); (b) a **one-time flat penalty** on the *original loan amount* (not outstanding), applied only once per period the very first time it goes overdue. Both rates (`borrower_penalty_rate_daily`, `borrower_penalty_rate_outstanding`) are read from `Yii::app()->params` but, like `withholding_tax_rate`, were **not found defined** in the checked `params.php` files.

Penalty collected from the borrower is then paid back out to investors pro-rata by interest ratio:
```php
// LoanLib.php:693
$penalty = $interest_ratio * $penalty_paid;   // per-investor share of penalty
```
via `UserFund::InvestorEarnPenalty()` → `FundTransaction::TYPE_INVESTOR_EARNED_FROM_PENALTY` — this is booked as pure additional income to investors, with **no RMF/WHT deduction applied** (unlike interest).

### 9. Elite Circle tiered bonus

```php
// User.php:21-29
const ELITE_GOLD = 1;      const ELITE_GOLD_BONUS_RATE      = .005;  // 0.5%
const ELITE_PLATINUM = 2;  const ELITE_PLATINUM_BONUS_RATE  = .01;   // 1.0%
const ELITE_SOLITAIRE = 3; const ELITE_SOLITAIRE_BONUS_RATE = .015;  // 1.5%
const ELITE_NO_MONTHS = 12;

// LoanLendRepaymentPlan::InvestorPayBonus, LoanLendRepaymentPlan.php:1277-1307
if (!$this->borrowlisting()->is_allowed_bonus || $this->available_funds_used <= 0) return FALSE;
$elite_bonus_amount = round((($this->available_funds_used * $rate) / ELITE_NO_MONTHS) * $loan_tenor, 2);
```
Bonus is only paid when the investment was funded from **available wallet funds** (not top-up-in-progress funds) and only if the loan/deal itself allows bonus (`is_allowed_bonus`). Annualized rate ÷ 12 × actual tenor months, based on the user's `elite_type` tier. Booked as `FundTransaction::TYPE_ELITE_BONUS` — **a constant that does not exist anywhere in `FundTransaction.php`** (see Tech Debt — this payout path would fatal-error if it ever actually ran end-to-end through `UserFund::InvestorPayBonus`).

### 10. Withdrawal fee

```php
// UserFund::withdrawable(), UserFund.php:448-452
$available = $this->available();   // balance - on_hold
return round($available - ($available * Yii::app()->params['withdrawable']), 2);

// FundRequest::withdrawalFee(), FundRequest.php:626-633
return ($this->withdrawal_fee > 0) ? round($this->amount * $this->withdrawal_fee, 2) : 0;
```
`withdrawable` = **0.001 (0.1%)** in prod params — investor receives 99.9% of the requested withdrawal amount; the fee rate is snapshotted onto the `FundRequest.withdrawal_fee` column at request-creation time rather than recomputed at approval time.

### 11. Investment charge / success fee

```php
'investment_charge_rate' => 0.01,   // 1% — UserFund::investmentCharge()
'op_service_fee'         => 0.03,   // 3% — borrower-side operation/success fee
```

### 12. Introducer commission

```php
// CommissionLib::calculate($amount), CommissionLib.php:4-25
// Tiered flat percentage of amount, from 30% (<50k) up to 55% (>=1,000,000)

// CommissionLib::tier($plan)  — flat SGD fee ÷ tenor, looked up from a 26-row hardcoded tier table
// e.g. amount 100-999 => $10 fee; amount >=1,000,000 => $10,000 fee; all divided by loan_tenor

// CommissionLib::percentage($plan), CommissionLib.php:79-82
round($plan->amount / $plan->borrowlisting->loan_tenor * Yii::app()->params['commission_rate'], 2);
```
Three different, seemingly unreconciled commission-calculation strategies live side by side in the same class (`calculate`, `tier`, `percentage`) with no visible caller-side logic in the reviewed files selecting which one is authoritative for a given deal — worth clarifying with the business before porting.

### 13. Voucher-driven payout variants

- **RMF Discount** (`isRMFDiscount()`): refunds a percentage of the Risk Management Fee back to the investor (§7 above).
- **Red Packet** (`isRedPacket()`): `UserFund::payRedPacket()` pays the voucher amount **only when the loan's outstanding balance is fully zero** (`$repaymentplan->borrowlisting()->outstanding < 1`).
- **Percentage Payout** (`isVoucherPercentagePayout()`): extra dividend computed as `ratio × available_funds_used_at_investment × (days × voucher.amount% / 365)`, paid alongside normal interest via `UserFund::payVoucherInterest()`, which itself deducts its own RMF-only charge (no WHT) if the loan `has_interest_charge`.
- **Junkard Chips** (`isJunkard()`): a promotional-credit voucher type, adjusted via `FundTransaction::voucherUse/voucherReturn` rather than the wallet balance.

### 14. Escrow hold lifecycle (pledge → invest, request → withdraw)

`UserFundHold` implements a two-phase commit for money that is "spoken for" but not yet moved:
```php
// UserFundHold.php
hold()      -> STATUS_HOLD       (adds to on_hold, doesn't touch balance)
complete()  -> STATUS_COMPLETED  (releases on_hold; balance actually debited via UserFund::minus in the caller)
cancel()    -> STATUS_CANCELLED  (releases on_hold, no balance change — money returns to "available")
```
`available()` = `balance - on_hold` is what an investor can pledge or withdraw. Both `UserFund::addPledge()` (investing) and `UserFund::withdrawOnHold()` (withdrawing) go through this hold mechanism before the corresponding `complete*`/`InvestorPayInterest` etc. methods actually move the balance.

### 15. Fund-request approval (admin side)

`FundRequest::updateStatus()` (`FundRequest.php:334`) is the single state-machine transition point for both deposits and withdrawals:
- **Deposit approved** → `UserFund::deposit()` (credits balance + `topup_funds`).
- **Withdrawal approved** → re-validates the user's on-hold balance is reconciled (`validateOnHold()`), then `UserFund::withdrawOnHoldComplete(receivable, fee, ref)`, which debits `available()` by `receivable + fee` in two separate ledger rows (`TYPE_WITHDRAWAL`, `TYPE_WITHDRAWAL_FEE`).
- **Withdrawal rejected** → `UserFund::withdrawCancelled()` releases the hold back to available funds.
- A hardcoded bypass exists inside `validateOnHold()`: `switch ($user->user_id) { case 7: $result = 0; break; ...}` — user ID 7 is permanently exempted from the hold-balance mismatch check (`FundRequest.php:316-319`).

---

## Data Model

Inferred from ActiveRecord `relations()`/attribute usage (no migration files were reviewed — column list is what the code reads/writes).

**`user_funds`** (`UserFund`, PK `fund_id`)
- `user_id`, `balance`, `on_hold`, `promotion_funds`, `topup_funds`, `reinvestment_funds`
- `investments` (running total currently invested), `investment_count`
- `earned_interest`, `earned_dividends_net`, `lastdate_invested`

**`fund_transactions`** (`FundTransaction`, PK `fund_transaction_id`) — the append-only ledger
- `user_id`, `type` (int enum, see below), `amount` (signed), `ref_id`, `ref` (JSON blob), `balance` (snapshot of available balance *after* this txn), `funds_hold` (snapshot of on_hold *after* this txn), `created_at`, `is_hidden`
- `type` enum (partial, prefix-coded by category — 10xx investor txns, 20xx borrower repayments, 30xx fees/charges, 40xx bonuses, 50xx cash in/out): `TYPE_DEPOSIT(5001)`, `TYPE_WITHDRAWAL(5002)`, `TYPE_DEPOSIT_BY_ADMIN(5003)`, `TYPE_INVESTOR_INVEST(1004)`, `TYPE_INVESTOR_DIVIDENDS(1005)`, `TYPE_INVESTOR_RETURN_PRINCIPAL(1006)`, `TYPE_INVESTOR_EARNED_FROM_PENALTY(1007)`, `TYPE_INVESTOR_VOUCHER_DIVIDENDS(1008)`, `TYPE_COMMISSION(1009)`, `TYPE_INVESTMENT_CANCEL(1010)`, `TYPE_BORROWER_REPAYMENT_PRINCIPAL(2002)`, `TYPE_BORROWER_REPAYMENT_INTEREST(2003)`, `TYPE_BORROWER_REPAYMENT_PENALTY(2004)`, `TYPE_RISK_MANAGEMENT_FEE(3001)`, `TYPE_WITHDRAWAL_FEE(3004)`, `TYPE_VOUCHER_RISK_MANAGEMENT_FEE(3005)`, `TYPE_RMF_DISCOUNT(3006)`, `TYPE_RED_PACKET(3007)`, `TYPE_WITHHOLDING_TAX_FEE(3008)`, `TYPE_REFERRAL_BONUS(4001)`.

**`loan_lend_repayment_txns`** (`LoanLendRepaymentTxn`, PK `repayment_txn_id`) — per-investor, per-period payout event that a `FundTransaction` references via `ref_id`
- `user_id`, `borrow_id`, `repayment_plan_id`, `period`, `child_period`, `type` (`TYPE_INTEREST=1`, `TYPE_PRINCIPAL=2`, `TYPE_PENALTY=3`, `TYPE_VOUCHER=4`), `amount`, `is_paid`, `on_hold`, `net_amount`, `net_details` (JSON of the fund_transactions that made up this net figure), `pitakamo_status`

**`loan_lend_repayment_plans`** (`LoanLendRepaymentPlan`, PK `repayment_plan_id`) — one row per investor-per-loan
- `user_id`, `borrow_id`, `amount`, `earned_interest`, `status` (0 ongoing / 1 completed / 2 cancelled / 3 abort / 4 trial / 5 returned / 6 sold / 7 abort-due-to-restructure), `voucher_id`, `elite_type`, `available_funds_used`, `repayment_start_date`

**`loan_lend_repayment_schedule`** — per-investor amortization schedule row: `period`, `date_repayment`, `amount`, `principal`, `interest`, `interest_voucher`, `paid`, `is_sold`, `child_period`

**`loan_borrower_repayment_txns`** (`LoanBorrowRepaymentTxns`) — borrower-side ledger: `type` (disbursement/loan-fee/fixed-interest/incurred-interest/penalty/repayment), `amount`, `interest`, `principal`, `penalty_amount`, `outstanding`, `is_paid`, `is_fee`, `days`, `ref`

**`user_funds_hold`** (`UserFundHold`) — `user_id`, `amount`, `type` (1 withdrawal / 2 loan pledge / 3 loan request), `status` (0 hold / 1 cancelled / 2 completed), `ref_id`, `ref`, `cancelled_at`, `completed_at`

**`fund_requests`** (`FundRequest`) — `user_id`, `amount`, `type` (transfer-slip / withdrawal / campaign-credit / product-B-borrower-withdrawal / pitakamo-withdrawal / withdrawal-no-fee), `payment_type` (cheque / bank-transfer / paypal / NUWallet / Paynamics variants / QR CoinsPH/WeChat/UnionPay), `withdrawal_type` (bank-transfer / GCash / Coins.ph / donation), `status` (0 pending / 1 approved / 2 failed), `withdrawal_fee` (rate snapshot), `bank_details`, `attachment`, `remarks`, `reject_reason`

---

## Cron/Automation Dependencies

| Job | What it does | Status |
|---|---|---|
| `NewUnionProcessCommand` (`cron/protected/commands/trash/`) | Wraps `InvestmentPayoutLib::run()` in a DB transaction; on failure sets a `Setting` flag (`cron_investment_payout_failed`) that **halts all future runs** until manually cleared, and alerts by email + SMS to hardcoded numbers/addresses. **Lives in a `trash/` directory** — deprecated but its logic (`InvestmentPayoutLib`) is still present and identical between the admin and api repos. |
| `InvestmentPayoutLib::run() → processNewRepayment()` | For every active balloon-payment loan (version 2, non-trial, Product A/C), on the exact due-date of the current period, checks if the borrower has paid; if so, pays each investor's interest for that period, and on the final period also returns capital + pays the Elite bonus. Sends push notifications. Closes the loan once every schedule row is `paid`. |
| `InvestmentProcessorCommand` | Long-running loop (`while (!connection_aborted())`, `sleep(2)`) draining pending `LoanLendPlanRequest` rows, completing their `UserFundHold`, and calling `$request->process()`. |
| `InvestorFeesCommand` | One-off/hand-editable console command hardcoded to `borrow_id = 9`: retroactively deducts RMF + WHT from a specific batch of `LoanLendRepaymentTxn` rows, then emails all affected users a payout notice. |
| `InsuranceFeeCommand` (`trash/`) | One-off script that finds zero-amount `TYPE_DEDUCT_FROM_INTEREST` rows (undefined constant — see Tech Debt) and back-fills the correct RMF deduction against the paired dividend row, hardcoded to filter `created_at >= '2015-04-20'` and referencing a specific database name (`newunion_development`) in a raw SQL string. |
| `ResetRepaymentCommand` | Hardcoded to `borrow_id = 13` — resets that one loan's repayment start date to `2018-05-04` and regenerates its schedule and every lender's schedule. A one-off fix, checked into the general command list. |
| `LoanCommand::actionKeyPrintingPress` (`cbase`) | The largest hand-patch script found: for a specific loan (`borrow_id = 115`, "Key Printing Press") on a specific date (`2020-11-15`), it manually recomputes dividends/RMF/WHT with hardcoded rate `0.17` (17%) and day-count `300/360`, inserts three new `fund_transactions` rows via raw SQL, patches the running `balance` snapshot by hand, and manually builds a synthetic `loan_lend_repayment_txns` row to tie the ledger back together. Requires a literal `"YES"` CLI argument to run. |
| `UpdateFundsCommand` | Not a payout job, but touches this domain: computes the platform's "total invested funds" figure by combining a live query of `fund_transactions`/`loan_lend_repayment_plans` (Philippines) with hardcoded numeric estimates for Cambodia/Taiwan and a live HTTP pull from sibling regional platforms (`sg.seedin.tech`, `newunion.tw`). Persists to `Setting`. |
| `CommissionCommand` | Registered but its `run()` body is **empty** — dead/stub cron. |
| Hardcoded "Key Printing Press" email suppression | `LoanLib::LenderRepaymentPayNowAllEMRPayment` has a permanent `if ($loan->borrow_id !== '115')` guard suppressing the payout-success email for that one loan (`LoanLib.php:1007`) — a leftover of the same incident as the `keyprintingpress` fix script above, left in the mainline repayment code path rather than removed after the fix. |

---

## Integrations

- **Paynamics** — payment gateway for investor top-ups (online banking, over-the-counter, e-wallet); `PaynamicsPayment::generateXml()`, confirm/cancel webhook handlers.
- **NUWallet** — New Union's own internal wallet-transfer gateway (`NUWallet::withdrawApply()`), used for top-ups.
- **Coins.ph** — cryptocurrency/e-wallet integration for both top-up (`postTopupCoinsph`) and withdrawal (`postWithdrawCoinsPH`).
- **PitakaMo** — a payment-partner integration with its own withdrawal flow (`postPitakaMoWithdrawal`) and its own deposit fund-transaction type (`TYPE_DEPOSIT_PITAKAMO`).
- **OTP/SMS** — `OTPLib`/`SMSLib` gate investor withdrawals; hardcoded destination numbers appear in the cron failure-alert path (`+6590230217`, `+6592715995`).
- **Telegram** — `Telegram::log()` fires on every top-up/withdrawal request as an internal ops notification channel.
- **Email** — `EmailLib::FundPayoutSuccess/FundtWithdrawSuccess/FundtWithdrawFailed/FundTransferSlipApproved/FundTransferSlipFailed`, driven by templated data including the live RMF/WHT rates for investor transparency.
- **Push notifications** — `PushNotification::send()` fires on interest payout, principal return, withdrawal approval/rejection.
- **DBS Bank** — the platform's own escrow account is hardcoded in `params.php` (`escrow_details`) and referenced when constructing the masked source-account string on withdrawal-approved emails.
- **MySQL stored procedure** — `idling_funds_details(user_id, date)` is called directly from PHP for the idle-funds report; this business logic is **not visible in either application codebase**, only in the database itself.
- **Sibling regional platforms** — `UpdateFundsCommand` performs unauthenticated `file_get_contents()` HTTP GETs against `https://sg.seedin.tech/services/Site/FundedToBusiness` and `http://www.newunion.tw/data_feed.jsp` (the second over plain HTTP) to aggregate a cross-region "total invested" figure.

---

## Tech Debt / Risks Observed

1. **Undefined class constants referenced throughout `FundTransaction.php`.** `TYPE_ELITE_BONUS` is used by `UserFund::InvestorPayBonus()` (the live Elite Circle bonus payout path, `UserFund.php:390`) and by `FundTransaction::eliteBonusTypes()`, but is **never declared** as a class constant in `FundTransaction.php` (admin and api repos both checked). At least ten other constants referenced by the various `*Types()` filter helpers are likewise undefined: `TYPE_DEPOSIT_BORROWER`, `TYPE_WITHDRAWAL_CANCELLED`, `TYPE_TOPUP_CREDIT_LINE`, `TYPE_USE_CREDIT_LINE`, `TYPE_ADD_CREDIT`, `TYPE_TRANSFER_FUNDS_TO_BORROWER`, `TYPE_TRANSFER_FUNDS_FROM_INVESTOR`, `TYPE_CAMPAIGN_CREDIT`, `TYPE_CAMPAIGN_DEBIT`, `TYPE_RISK_MANAGEMENT_FEE_OCBC`, `TYPE_RISK_MANAGEMENT_FEE_OCBC_VOUCHER`, `TYPE_DEDUCT_FROM_INTEREST`. Any live code path that calls one of these methods would hit a PHP fatal error ("undefined class constant"); the Elite bonus one (`InvestorPayBonus`) is wired into the mainline balloon-payment payout flow (`InvestmentPayoutLib.php:53`) and the EMR/balloon repayment table builders, so this is not obviously dead code.
2. **Critical fee-rate config values not found in any versioned `params.php`.** `withholding_tax_rate`, `borrower_penalty_rate_daily`, and `borrower_penalty_rate_outstanding` are read via `Yii::app()->params[...]` in the core dividend/penalty formulas (`UserFund.php:324`, `LoanLib.php:806,1023,1251,1254`) but do not appear in any of the prod/qa/dev `params.php` files checked in either repo. Either these are injected from an untracked local/server config or a database `Setting`, meaning the single most important tax rate in the ledger is not auditable from source control.
3. **Multiple hand-patch "fix" scripts checked permanently into the codebase**, several hardcoded to a single loan/borrower ID and a specific date, some requiring literal string arguments to run (`keyprintingpress YES`): `LoanCommand::actionKeyPrintingPress` (borrow_id 115, hardcoded 17% rate and 300/360 day count, raw SQL string-built INSERTs), `InvestorFeesCommand` (hardcoded borrow_id 9), `ResetRepaymentCommand` (hardcoded borrow_id 13 and a literal date), `InsuranceFeeCommand` (hardcoded date filter and a hardcoded database name `newunion_development` inside a SQL string — would silently target the wrong database if run against qa/prod without editing). These confirm the domain description: the pro-rata/net-dividend computation broke in production at least twice and was patched by writing bespoke one-off SQL rather than fixing and re-running the general computation.
4. **A permanent special-case borrow_id guard survives in the mainline payout code**, not just in the one-off fix script: `LoanLib::LenderRepaymentPayNowAllEMRPayment` unconditionally checks `if ($loan->borrow_id !== '115')` before sending the payout-success email (`LoanLib.php:1007`), a leftover of the Key Printing Press incident that was never cleaned up.
5. **A permanent per-user bypass in the withdrawal-approval hold check**: `FundRequest::validateOnHold()` special-cases `user_id == 7` to always report the hold balance as reconciled (`FundRequest.php:316-319`), regardless of the actual computed mismatch — the reason is not documented in code.
6. **RMF/WHT net-dividend formula is duplicated in at least three places** (`UserFund::InvestorPayInterest`, `LoanLendRepaymentPlan::earnedDividends`, `LoanLib::interestNet`) with the same date-gated branch (`>= '2018-02-01'`) copy-pasted into each — any future rate or rule change requires editing all three in lockstep, which is exactly the kind of drift that produced the fix scripts above.
7. **Dead/orphaned controller file**: `applications/backend/controllers/FundController.php` contains a class named `RequestController` with an empty body — a duplicate/leftover of the real `RequestController.php` in the same directory, misnamed and non-functional.
8. **Business logic hidden in a MySQL stored procedure**: the idle-funds report calls `CALL idling_funds_details(...)` directly; none of the computation it performs is visible in either application's PHP codebase, so a rewrite cannot port it without first extracting the procedure body from the database.
9. **Cron failure handling halts silently and requires manual intervention**: `NewUnionProcessCommand` sets a `Setting` flag (`cron_investment_payout_failed`) on any exception and every subsequent run short-circuits (`if ($flag_failure) return;`) until an operator manually clears it — with no automatic retry, backoff, or reconciliation logic, and hardcoded personal phone numbers/emails as the only alert channel.
10. **`EMR` (Equal Monthly Repayment) does not amortize** in the mathematical sense — interest is flat per period on the original principal (`LoanLib.php:1373`), not recalculated against a declining balance, while `EffectiveRateRepaymentMethod` (a separate, third repayment mode) is the only one that behaves as true reducing-balance interest. This naming/behavior mismatch is a real risk of misimplementation if a rewrite assumes "EMR" implies standard amortization math.
11. **Multiple commission-calculation strategies coexist with no visible selection logic** in the reviewed files (`CommissionLib::calculate`, `::tier`, `::percentage`) — three different formulas for what appears to be the same "introducer commission" concept.
12. **Legacy withdrawal flow left in place alongside the current one**: `ServiceRequestController::postWithdrawOld()` exists next to `postWithdraw()` with no visible deprecation guard preventing its use.
13. **`FundTransaction::record()`'s duplicate-ref-id guard is commented out** (`FundTransaction.php:95-101`) — a check that would have thrown `Exception('Ref already exists.')` on a duplicate `(type, ref_id)` pair is disabled, removing a safety net against double-booking the same payout.
14. **Regional "total invested funds" cron makes an unauthenticated plaintext HTTP call** (`http://www.newunion.tw/data_feed.jsp`) and hardcodes currency conversion rates (`$sg_rate = 39`) and full-region estimate amounts (`$cambodia_funds = 700000 * $sg_rate`) directly in cron code rather than configuration.

---

## Proposed MVP Scope for Revamp

### Must-have (v1)
- **Pro-rata investor split engine** (`investmentRatio()`-driven fan-out of every borrower repayment) — this *is* the domain; nothing else works without it.
- **Net-dividend computation (RMF + WHT)** as a single, versioned, testable formula — collapse the 3 duplicate implementations into one service, with the rate change date-gate expressed as explicit historical rate versions rather than an inline `if (date(...) >= '2018-02-01')` check, so future rate changes never require another hand-patch script.
- **`UserFund` wallet ledger + `FundTransaction` append-only audit log** with the hold/complete/cancel two-phase pattern for pledges and withdrawals — this is the reconciliation backbone the business audits against.
- **Principal return at maturity** (balloon) and **per-period principal** (EMR) payout paths.
- **Borrower-penalty accrual and pro-rata distribution to investors** — directly touches money owed to real people; must be correct from day one.
- **Withdrawal request → admin approval → payout state machine**, including the fee snapshot-at-request-time behavior, since this is core to investor trust/cashflow.
- **Full, versioned config for every rate** (`interest_fee_rate`, `withholding_tax_rate`, `borrower_penalty_rate_daily/outstanding`, `withdrawable`) — must be sourced from an auditable, source-controlled or admin-editable-with-history location, closing Tech Debt item #2.
- **Effective-rate (true reducing-balance) repayment method**, since it's the only mathematically "correct" amortization mode and is likely to be the one the business standardizes on going forward.

### Defer / nice-to-have
- **Elite Circle bonus tiers** — real feature but its current implementation is provably broken (undefined constant); defer until the business reconfirms this program is still active, rather than porting a feature that may not currently function in production.
- **Voucher system (RMF Discount, Red Packet, Percentage Payout, Junkard Chips)** — a promotional layer on top of the core payout; port after the core engine is solid, likely as a pluggable adjustment rather than inline branches scattered through `UserFund`.
- **Introducer commission calculation** — needs a product decision on which of the three existing formulas (`calculate`/`tier`/`percentage`) is authoritative before it can be ported at all.
- **Idle-funds report** — defer until the underlying stored-procedure logic is extracted and understood; do not port the report screen without first porting (and testing) the actual computation.
- **Multi-gateway top-up/withdrawal integrations (Paynamics, NUWallet, Coins.ph, PitakaMo)** — the wallet ledger itself is must-have, but each individual payment-gateway integration can be added incrementally after a single reference gateway is working end-to-end.
- **Cross-region "total invested funds" aggregation** (`UpdateFundsCommand`) — a marketing/reporting figure with hardcoded estimates for two regions; not core money-movement, safe to defer or replace with a manual figure initially.
- **One-off hand-patch console commands** (`keyprintingpress`, `InvestorFeesCommand`, `ResetRepaymentCommand`, `InsuranceFeeCommand`) — these should NOT be ported as-is; instead, the v1 rebuild should provide a general-purpose, audited "recompute and correct a ledger" admin tool so a future computation bug never again requires a bespoke raw-SQL script.
