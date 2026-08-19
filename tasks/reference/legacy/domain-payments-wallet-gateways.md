# Wallet, Withdrawals & Payment Gateways

## Overview

This domain covers everything to do with a user's cash position on the SeedIn / New Union platform:

- **Wallet / cash ledger** — every user (investor, fundseeker/borrower) has a single `user_funds` row (`UserFund`) tracking `balance`, `on_hold`, `investments`, `promotion_funds`, `topup_funds`, `earned_interest`, etc. Every movement is journalled as an immutable `FundTransaction` row.
- **Deposits / top-ups (cash-in)** — bank transfer with proof-of-payment upload ("transfer slip"), cheque, and Philippines gateways: Paynamics (cards, GCash, online banking, over-the-counter), Coins.ph (GCash/crypto rails), PitakaMo (mobile wallet, used specifically to fund/withdraw investor proceeds sourced through PitakaMo), NUWallet (an internal/partner wallet gateway), and a legacy/likely-dead PayPal integration.
- **Withdrawals / cash-out** — investor requests a withdrawal from available balance; a percentage fee is deducted; funds are put "on hold" until an admin approves (bank transfer, GCash) or the request is auto-processed via a gateway (Coins.ph, PitakaMo).
- **Bank account management** — investors register bank accounts (`user_banks`) that go through admin pending/approved/rejected verification before being usable as a withdrawal destination.
- **Admin verification workspace** — a unified "Requests" queue (`requests` table) that surfaces pending withdrawals, deposits/transfer-slips, profile approvals, etc. for staff to approve/reject with reason codes, plus dedicated Paynamics/Coins.ph/PitakaMo transaction-detail screens.

**Who uses it:**
- **Investor** — deposits cash, requests withdrawals, manages bank accounts, watches on-hold vs. available balance.
- **Fundseeker/Borrower** — also uses the same top-up flow (`FundRequest::TYPE_TRANSFER_SLIP`) to fund campaigns/repayments and a very similar (fee-free) withdrawal path for "Product B" loan proceeds.
- **Admin (SeedIn ops)** — approves/rejects withdrawal and deposit requests, views Paynamics/Coins.ph/PitakaMo transaction logs, downloads Excel reports for bank reconciliation (including a dedicated OCBC withdrawal report).
- **Introducer** — a restricted admin role that only sees requests for users under their referral ID.
- **System / automated** — cron/console commands poll Paynamics for async payment status and auto-approve/reject; gateway webhooks (Coins.ph, PitakaMo, NUWallet, Paynamics) drive fund crediting.

---

## Current Features & Flows

### Admin Dashboard (`seedin-live-admin`)

| Endpoint | Description |
|---|---|
| `WithdrawalController::actionList` (`/withdrawal`) | Renders the withdrawal-requests worklist (AJAX-driven list via `ServerRequestController`). |
| `WithdrawalController::actionDownload` | Exports pending/filtered withdrawal requests to Excel (`Withdrawal-Requests.xlsx`) with investor, net amount, bank, account, transfer mode. |
| `RequestController::actionList` (`/request`) | Unified "Requests" inbox — shows counts by type (registration, profile, withdrawal, transfer-slip, borrow-listing, campaign credit) via `Request::getStats()`. |
| `RequestController::actionBank` / `actionBankDownload` | Bank-account request list/report (pending bank verifications), backed by `BankPendingSummary`/`BankSummaryColumn`. |
| `RequestController::actionDownload` → `downloadWithdrawals()` | Richer Excel export including request status ("Balance"/"Not Balance" via `FundRequest::validateOnHold`), total/available/on-hold funds per investor. |
| `RequestController::actionWithdrawal($id)` | Detail view of a single withdrawal `FundRequest` for admin review. |
| `RequestController::actionDeposit($id)` | Detail view of a single deposit/transfer-slip `FundRequest`, decodes `bank_details` JSON for display. |
| `RequestController::actionReferralBonus($id)` | View referral-bonus approval detail (adjacent request type, not fund-specific). |
| `ServerRequestController::actionList` / `getData` | AJAX data source for the unified request queue; branches template by request type (withdrawal/profile/transfer-slip/default). |
| `ServerRequestController::getWithdrawalData` / `actionListWithdrawal` | AJAX data source specifically for `WithdrawalController`'s list, filterable by `type`, `status`, `keyword`. |
| `ServerRequestController::actionUpdateStatus` | **The core approve/reject action** for the `requests` table — routes to type-specific side effects (registration, profile approval, DocuSign, or `FundRequest::updateStatus()` for transfer-slip/withdrawal). |
| `ServerRequestController::actionFundRequestStatusUpdate` | Alternate direct-approve endpoint that updates a `FundRequest` by id/status/remarks. |
| `ServerRequestController::actionDownloadSelect` | Toggles a request id in/out of the session-based "selected for download" set (multi-select Excel export). |
| `ServerRequestController::actionBankList` / `getBankData` | Paginated bank-verification-pending report (`BankPendingSummary`). |
| `ServerCustomerController::actionDeductAvailableFund` | Admin manually deducts a user's available funds with a mandatory comment, logs to `UserDeductFund` (**calls `UserFund::deductFund()`, which does not exist in the codebase — see Tech Debt**). |
| `ServerCustomerController::actionTransferFunds($id)` | Admin transfers a user's available funds "to borrower" / "to investor" bucket (**calls `UserFund::transferFunds()`, which does not exist — see Tech Debt**). |
| `PaynamicsController::actionIndex/actionDownload/actionView` | Paynamics transaction report list + Excel export + single-transaction detail (`PaynamicsTxn`, its `PaynamicsApiResponse` history). |
| `CoinsphController::actionIndex/actionDownload/actionView` | Coins.ph transaction report list + Excel export + detail view (`CoinsPH` model). |
| `PitakamoController::actionIndex` (`actionPayment`) / `actionView` | PitakaMo "payment" (proceeds settlement) report + detail view. |
| `PitakamoRequestController::actionIndex/actionView` | PitakaMo withdrawal *request* report (separate from the payment/settlement report above) + detail view. |
| `WithdrawocbcController::actionIndex/actionDownload` | Dedicated "Withdrawal - OCBC" Excel export of `FundTransaction::TYPE_WITHDRAWAL` rows for bank reconciliation against the OCBC escrow account. |
| `FundController` | Empty stub controller (dead/unused). |

### API (`seedin-live-api-v1-1`) — mirrors most Admin controllers 1:1 plus the mobile/JSON service layer

| Endpoint | Description |
|---|---|
| `ServiceRequestController::postTopUp` (`Request/TopUp`) | **Core top-up entrypoint** used by both web and mobile. Branches by `payment_type` into: NUWallet apply, Paynamics XML generation (online banking / OTC / e-wallet), or bank-transfer/cheque with attachment upload. Validates via `TransferFundForm`. |
| `ServiceRequestController::postPaynamicsConfirm` (`Request/PaynamicsConfirm`) | Handles Paynamics return redirect; queues a status check (`PaynamicsCheckQueue`) and long-polls (up to 60s, 5s interval) for the cron worker to resolve it. |
| `ServiceRequestController::postPaynamicsCancel` (`Request/PaynamicsCancel`) | Marks a pending Paynamics txn cancelled when the user aborts payment. |
| `ServiceRequestController::postNuwalletConfirm` (`Request/NuwalletConfirm`) | Commits an NUWallet top-up (`NUWallet::withdrawCommit`) and, on success, credits the user's wallet. |
| `ServiceRequestController::postNuwalletCancel` | Stub — no-op. |
| `ServiceRequestController::postWithdraw` (`Request/Withdraw`) | **Core withdrawal entrypoint.** Validates form + minimum/available-balance rules, requires OTP (mobile) or account-level OTP setting (web), branches to Coins.ph flow or standard `FundRequest::create()` (puts funds on hold, emails confirmation). |
| `ServiceRequestController::postWithdrawCoinsPH` | Withdrawal variant that immediately calls `FundRequest::withdrawCoinsph()` to push a Coins.ph transfer via their v3 API. |
| `ServiceRequestController::postWithdrawOld` | Legacy/duplicate withdrawal endpoint (blocked for PitakaMo users) — appears superseded by `postWithdraw`. |
| `ServiceRequestController::postPitakaMoWithdrawal` | PitakaMo-specific withdrawal request (only for `isPitakamo()` requests / `user->isPitakaMo()` users); creates `FundRequest::TYPE_PITAKAMO_WITHDRAWAL`. |
| `ServiceRequestController::postTopupCoinsph` (`Request/TopupCoinsph`) | Creates a Coins.ph invoice via their `/v1/invoices/` API and returns the hosted `payment_url`. |
| `ServiceRequestController::validateWithdrawalAmount` | Shared validation: enforces `minimum_withdrawal` param and available-funds ceiling (see Tech Debt — param undefined). |
| `PaynamicsController` (backend mirror) | Same report/detail actions as Admin repo. |
| `CoinsphController` (backend mirror) | Same report/detail actions as Admin repo. |
| `PitakamoController` / `PitakamoRequestController` (backend mirror) | Same as Admin repo. |
| `WithdrawocbcController` (backend mirror) | Same OCBC reconciliation export as Admin repo. |
| `ServerRequestController` / `WithdrawalController` / `RequestController` (backend mirror) | Same admin approval workflow as Admin repo (this API app also serves the admin's AJAX calls). |
| `ServerCustomerController::postForceWithdrawComment` (`ServiceTransactionController`) | Mobile API to fetch the comment text on a `UserForceWithdrawal` record by `txn_id`. |

### User App (`seedin-live-user`) — thin proxy layer to the API's service endpoints

| Endpoint | Description |
|---|---|
| `ServerFundController::actionSubmitBankTransferDetails` | Proxies to `Request/TopUp`; normalizes the `date_transferred` array into `dd-mm-yyyy`→ISO and resolves `payment_type` (including QR Coins.ph/WeChat/UnionPay sub-types). |
| `ServerFundController::actionRequestWithdraw` | Proxies to `Request/Withdraw`; refreshes the session-cached `user` object with the response (e.g. after OTP). |
| `ServerFundController::actionTopupCoinsph` | Proxies to `Request/TopupCoinsph`. |
| `PaynamicsController::actionResponse` | Paynamics browser-redirect landing page; calls back to `Request/PaynamicsConfirm` and renders a shared "nuwallet/response" template. |
| `PaynamicsController::actionCancel` | Paynamics cancel landing page → `Request/PaynamicsCancel`. |
| `PaynamicsController::actionRedirect` | Renders the auto-submitting HTML form that POSTs the base64 Paynamics XML payload to their hosted payment page. |
| `PaypalController::actionReturn` | PayPal Express Checkout return handler — commits payment, deposits `topup_amount`, credits a "rebate". **Calls undefined methods; effectively broken (see Tech Debt).** |
| `PaypalController::actionCancelled` | PayPal cancel landing page. |
| `CoinsphController::actionCallback` / `actionCallback2` | Dumps raw `$_REQUEST` webhook payloads to a local log file — **no signature verification, no processing logic.** |
| `CoinsphController::actionRedirect` | Coins.ph hosted-invoice return handler; fetches invoice status via `CoinsPH/Invoice` service call and renders a receipt. |
| `NuwalletController::actionResponse` | NUWallet return handler → `Request/NuwalletConfirm`. |

---

## Business Logic & Computations

### 1. Withdrawal fee (percentage-based)
Source: `FundRequest::withdrawalFee()` / `receivableAmount()` / `withdrawable()` — `/Users/kimarvintoledo/Projects/seedin/seedin-live-api-v1-1/newunion/applications/common/models/FundRequest.php:616-638`

```php
public function withdrawalFee()
{
    if ($this->withdrawal_fee > 0) {
        return round($this->amount * $this->withdrawal_fee, 2);
    }
    return 0;
}

public function receivableAmount()
{
    return round($this->amount - $this->withdrawalFee(), 2);
}
```

- `withdrawal_fee` is **snapshotted onto the `FundRequest` row at creation time** from the global param `Yii::app()->params['withdrawable']` (`FundRequest::create()`, line 96) — currently **`0.001` = 0.1%** (`params.php:163`, comment: *"0.1 percent withdrawal fee"*).
- So: `fee = round(amount * 0.001, 2)`, `net payout = amount - fee`.
- **Product B / borrower withdrawals are fee-exempt**: `FundRequest::productBFundseekerWithdraw()` explicitly sets `$fr->withdrawal_fee = 0` (line 219).
- `showWithdrawalRate()` renders it as a percentage string (`withdrawal_fee * 100 . '%'`) for UI display.
- Separately, `UserFund::withdrawable()` (`UserFund.php:448-452`) computes a *displayed* withdrawable ceiling by applying the same rate to the *available* balance: `available - (available * withdrawable_rate)` — i.e. what the user could withdraw net of fee if they withdrew everything. **Note:** this is a *different* computation path than `User::withdrawable()` (used for the actual request-amount validation), which returns raw `available()` with **no fee deduction at all** — a real inconsistency (see Tech Debt).

### 2. Withdrawal hold → complete lifecycle (escrow-style on-hold mechanics)
Source: `UserFund.php:136-177`, `UserFundHold.php`

1. **Request submitted** → `UserFund::withdrawOnHold($amount, $frid)` → `UserFundHold::hold()` creates a `user_funds_hold` row with `type=TYPE_WITHDRAWAL`, `status=STATUS_HOLD`, and calls `UserFund::addHoldAmount()`, which **validates `amount <= available()`** before incrementing `on_hold` (throws `UserFundException` otherwise).
2. **Admin approves** → `FundRequest::updateStatus(STATUS_APPROVED)` → `UserFund::withdrawOnHoldComplete($receivableAmount, $withdrawalFee, $frid)`:
   - Finds the matching hold record and **asserts `hold->amount == receivableAmount + withdrawalFee`** (i.e. the gross request amount), throwing `Exception("Amount is invalid")` if it drifted.
   - Marks the hold `STATUS_COMPLETED` and removes it from `on_hold`.
   - `minus(receivableAmount, TYPE_WITHDRAWAL, frid)` — deducts the **net** amount from `balance`.
   - If fee > 0, a **second, separate** ledger entry `minus(withdrawalFee, TYPE_WITHDRAWAL_FEE, frid)` deducts the fee from `balance` too. (So gross amount leaves the wallet as two line items: net withdrawal + fee.)
3. **Admin rejects** → `UserFund::withdrawCancelled($amount, $frid)` → finds the hold, calls `hold->cancel()` → `STATUS_CANCELLED`, `on_hold` reduced back (funds return to "available").
4. **Guard before approval:** `FundRequest::updateStatus()` calls `FundRequest::validateOnHold($user_id)` and **throws if the user's on-hold ledger doesn't reconcile** with the sum of active loan pledges + pending fund requests (`VALIDATE_ON_HOLD = 1`). There is a hardcoded carve-out: `user_id == 7` always passes this check regardless of mismatch (`FundRequest.php:316-319`) — see Tech Debt.
5. **Bank requirement:** approval throws `Exception("Investor has no bank details.")` if `$user->bankPrimary` is empty (`FundRequest.php:423`).

### 3. Minimum withdrawal / minimum top-up amounts
Source: `ServiceRequestController::validateWithdrawalAmount()` (`ServiceRequestController.php:673-706`), `TransferFundForm::rules()`

```php
$minimumWithdraw = Yii::app()->params['minimum_withdrawal'];
if ($withdrawal_type == FundRequest::WITHDRAWAL_TYPE_DONATION_TAAL) {
    $minimumWithdraw = 1;   // special-case: disaster-relief "donation" withdrawal type, min ₱1
}
if ($amount < $minimumWithdraw) { ... error ... }
elseif ($sourceFunds == 0 or $amount > $sourceFunds) { ... "Insufficient available funds" ... }
```
`$sourceFunds = $user->withdrawable($type, User::ACCOUNT_ESCROW)` → resolves to raw `available()` (no fee deducted — see note above).

Top-up minimum: `TransferFundForm` enforces `amount >= Yii::app()->params['funds_minimum_transfer']` (currently **`1`**, i.e. SGD/PHP 1) for the `create` scenario (bank-transfer/cheque). This rule is **skipped** for the Paynamics/NUWallet scenarios (`create_paynamics`, `create_nuwallet` don't include the `compare` rule).

### 4. GCash withdrawal eligibility gate
Source: `WithdrawalForm::validateType()` (`WithdrawalForm.php:22-45`)

For `withdrawal_type == FundRequest::WITHDRAWAL_TYPE_GCASH`, the user must have **all** of: `gcash_number`, `signature` (specimen signature on file), `photo` (profile picture) — otherwise a combined error listing the missing items is returned.

### 5. On-hold reconciliation formula
Source: `FundRequest::validateOnHold()` (`FundRequest.php:281-332`)

```
totalOnHold = SUM(loan_lend_repayment_plans.amount WHERE status <> RETURNED AND borrowlisting.on_hold = 1)
            + SUM(fund_requests.amount WHERE status = PENDING)

currentOnHold = user->onHoldFunds()   // i.e. user_funds.on_hold

mismatch => returns VALIDATE_ON_HOLD (1), blocking withdrawal approval
```

### 6. PayPal top-up fee formula (legacy)
Source: `PaypalPayment::make()` / `totalAmount()` (`PaypalPayment.php:22-38`)

```php
$paypal_fee   = ($amount * params['paypal_fee_rate']) + params['paypal_charge'];
$topup_amount = $amount - $paypal_fee;
// totalAmount() = ceil($topup_amount + $paypal_fee)  // == ceil($amount)
```
Params (SGD): `paypal_fee_rate = 0.039` (3.9%), `paypal_charge = 0.5` (flat SGD 0.5), and separately `paypal_rebate = 0.5` (50%) applied to the fee on return (`$user->fund()->rebate($paypalpayment->paypal_fee * paypal_rebate)`), i.e. SeedIn absorbs/refunds half the processing fee to the user, presumably to offset PayPal's own cut. This flow is currently broken code (see Tech Debt) but the *formula* is the historical business intent and should be preserved if PayPal is revived.

### 7. Interest/dividend-adjacent fee logic touching the wallet (context for withdrawals report)
Source: `UserFund::InvestorPayInterest()` (`UserFund.php:310-355`)

Not strictly "withdrawal" logic, but it's the other side of the same ledger and directly affects what's later withdrawable:
```php
interest_fee = round(dividend_amount * params['interest_fee_rate'], 2);   // 0.05 = 5% Risk Management Fee
tax = (date >= '2018-02-01')
      ? round(dividend_amount * params['withholding_tax_rate'], 2)         // new formula: tax on gross
      : round((dividend_amount - interest_fee) * params['withholding_tax_rate'], 2); // old formula: tax on net-of-fee
netAmount = dividend_amount - interest_fee - tax [+ rmf_discount_amount if an RMF-discount voucher applies]
```
This dated formula switch (Feb 1, 2018) is a real historical business rule that must be preserved for any pre-2018 backfilled/reconciliation calculations, even if the rebuild only needs the "new" branch going forward.

### 8. Withdrawal request → gateway routing matrix
Source: `FundRequest::withdrawalTypes()`, `ServiceRequestController::postWithdraw()`

| `withdrawal_type` | Handling |
|---|---|
| `WITHDRAWAL_TYPE_BANK_TRANSFER` (1, default) | Standard hold → admin manual bank-transfer approval flow. |
| `WITHDRAWAL_TYPE_GCASH` (2) | Same manual admin-approval flow, but gated by the GCash-profile-completeness check above; actual GCash payout appears to be executed manually by ops off-platform (via Paynamics GCash payment method or bank transfer) — no dedicated GCash payout API call was found in this codebase. |
| `WITHDRAWAL_TYPE_COINSPH` (3) | Auto-submitted to Coins.ph's `/v3/transfers/` API immediately at request time (`FundRequest::withdrawCoinsph()`); asynchronously resolved via `CoinsPH::checkStatus()`/cron. |
| `WITHDRAWAL_TYPE_DONATION_TAAL` (4) | Special ₱1-minimum "donation" type (commented out of the active type list — legacy Taal-volcano-eruption 2020 relief campaign). |
| PitakaMo withdrawal (`FundRequest::TYPE_PITAKAMO_WITHDRAWAL = 16`, separate from `withdrawal_type`) | Only reachable for `user->isPitakaMo()`; creates a `PitakamoRequest` and holds funds, later manually "sent" by an admin via `PitakaMo::paymentSend()`. |

### 9. Paynamics signature scheme
Source: `PaynamicsPayment::generateXml()` (`PaynamicsPayment.php:815-912`), `PaynamicsTxn::checkStatus()`

```
signature = SHA-512( mid . request_id . ip_address . notification_url . response_url .
                      fname . lname . mname . address1 . address2 . city . state . country .
                      zip . email . phone . client_ip . amount . currency . secure3d . merchantKey )
```
For the async `query` status-check call: `signature = SHA-512(mid . request_id . org_trxid2 . merchantKey)`.
Response codes drive state: `GR001`/`GR002` → approve & deposit; `GR033` → still pending, auto-**rejected if `daysOld > 15`** (cron) or `> 15` (inline check — both paths use `daysOld() > 15`, but the standalone `cbase` cron command uses `> 5`, an inconsistency — see Tech Debt); any other code → reject.

### 10. Coins.ph HMAC signature scheme
Source: `CoinsPH.php` (lib), `FundRequest::withdrawCoinsph()`, `CoinsPH.php` (model) `checkStatusResponse()`

```
message  = timestamp . nonce . url [. json_body for POST]
signature = HMAC-SHA256(message, client_secret)
headers: ACCESS_SIGNATURE, ACCESS_KEY, ACCESS_NONCE, ACCESS_TIMESTAMP
```
Deposit uses invoice-based flow (`/v1/invoices/`, Bearer token auth) while withdrawal uses transfer-based flow (`/v3/transfers/`, HMAC auth) — two different auth schemes within the same integration.

### 11. Bank-account "primary" invariant
Source: `Bank.php:80-147`

- First bank added for a user is auto-marked primary (`Bank::create()`).
- `setPrimary()` uses an `updateAll()` to clear `is_primary` for all of the user's other banks before setting the new one — a two-step, non-atomic (no explicit transaction wrapping) operation.
- Rejecting a bank (`Bank::reject()`) forces `is_primary = 0`.
- Bank statuses: `PENDING(1) → APPROVED(2)` or `REJECTED(3)`; `DELETED(4)` is a soft-delete flag set by `delete()`.

---

## Data Model

### `user_funds` (via `UserFund`)
Per-user single-row wallet: `fund_id` (PK), `user_id`, `balance`, `on_hold`, `investments`, `investment_count`, `promotion_funds`, `topup_funds`, `reinvestment_funds`, `earned_interest`, `earned_dividends_net`, `credit_line`, `lastdate_invested`. `available = balance - on_hold` (computed, not stored).

### `fund_transactions` (via `FundTransaction`)
Immutable ledger: `fund_transaction_id` (PK), `user_id`, `type` (numeric code, see families below), `amount` (signed), `ref_id`, `ref` (JSON blob), `balance` (snapshot of `available()` at time of txn), `funds_hold` (snapshot of `on_hold`), `created_at`.
Type-code families (by comment convention in the model): `1xxx` investor investment txns, `2xxx` borrower repayments, `3xxx` NewUnion fees/charges (incl. `WITHDRAWAL_FEE = 3004`), `4xxx` bonuses, `50xx` cash flow in/out (`DEPOSIT=5001`, `WITHDRAWAL=5002`, `DEPOSIT_BY_ADMIN=5003`, `DEBIT=5004`, `CREDIT=5005`, `DEPOSIT_PITAKAMO=5006`).

### `user_funds_hold` (via `UserFundHold`)
`id` (PK), `user_id`, `amount`, `type` (`1`=withdrawal, `2`=loan pledge, `3`=loan request), `status` (`0`=hold, `1`=cancelled, `2`=completed), `ref_id`, `ref` (JSON), `created_at`, `cancelled_at`, `completed_at`. One row per hold event; history preserved via `UserFundHoldHistory::record()`.

### `fund_requests` (via `FundRequest`)
`request_id`/`fund_request_id` (PK varies by app version), `user_id`, `type` (0=transfer-slip, 1=withdrawal, 9=campaign credit, 11=withdrawal-no-fee, 15=Product B borrower withdrawal, 16=PitakaMo withdrawal), `status` (0=pending,1=approved,2=failed), `payment_type` (cheque/bank-transfer/paypal/nuwallet/paynamics variants/QR variants), `withdrawal_type` (bank-transfer/GCash/Coins.ph/donation), `withdrawal_fee` (rate snapshot), `amount`, `transfer_no`, `date_transferred`, `remarks`, `attachment`, `bank_details` (JSON, for deposits — which SeedIn bank the user paid into), `user_bank_details` (JSON snapshot of the requester's own bank at withdrawal time), `additional_data` (JSON, e.g. "IBanking Nick"), `fund_transaction_id`, `reject_reason`.

### `requests` (via `Request`, admin work-queue wrapper)
`request_id` (PK), `user_id`, `type` (registration/profile-approval/withdrawal/transfer-slip/borrow-listing/referral-bonus/campaign-credit/contract-signature/product-B-withdrawal/profile-reset, etc.), `status` (0=pending,1=rejected,2=approved), `reference` (JSON, e.g. `{"frid": <fund_request_id>}`), `ref_id`, `reason`, `created_at`.

### `user_banks` (via `Bank`)
`bank_id` (PK), `user_id`, `bank_name`/enumerated Philippine-bank id (BDO, Metrobank, Landbank, BPI, PNB, ... 36 banks total), `account_name`, `account_number`, `branch_code`, `swift_code`, `attachment` (proof file), `status` (1=pending,2=approved,3=rejected,4=deleted), `is_primary`.

### `user_banks_pending_summary` (via `BankPendingSummary`)
Read-only reporting view/table keyed by `user_id`, feeds the admin bank-verification report list.

### `user_force_withdrawal` (via `UserForceWithdrawal`)
`force_withdrawal_id` (PK), `fund_transaction_id` (FK to `FundTransaction`), `comment`, presumably `status` (`TYPE_PENDING=0`/`TYPE_APPROVED=1` consts exist but no write-path was found in this domain sweep besides the read-only `postForceWithdrawComment` API — likely written to elsewhere, e.g. an ops/reporting tool not in this domain's inventory).

### `user_deduct_fund` (via `UserDeductFund`)
`deduct_fund_id` (PK), `fund_transaction_id` (FK), `amount`, `comment`, `status`. Written by `ServerCustomerController::actionDeductAvailableFund` (admin manual deduction tool) — but see Tech Debt, the underlying fund-mutation call is broken.

### `paynamics_txn` (via `PaynamicsTxn`)
`paynamics_id` (PK), `created_at`, `user_id`, `amount`, `status` (0=incomplete,1=pending,2=success,3=failed,4=cancelled), `request_id`, `response_id`, `query`, `response`, `type`.

### `paynamics_api_response` (via `PaynamicsApiResponse`)
`response_id` (PK), `paynamics_id` (FK), `query` (JSON), `response` (JSON), `created_at` — full audit trail of every status-check round-trip.

### `paynamics_check_queue` (via `PaynamicsCheckQueue`)
`queue_id` (PK), `paynamics_id` (FK), `executed` (bool), `response` (JSON), `created_at`, `updated_at` — a DB-backed job queue the confirm-endpoint's long-poll and the cron worker both read/write.

### `coins_ph` (via `CoinsPH`)
`coin_id` (PK), `invoice_id`, `ref_id`, `fund_request_id`, `user_id`, `request_response`/`callback_response` (raw JSON blobs), `status` (1=pending,2=success,3=failed,4=expired), `coinsph_status` (raw gateway status string), `amount`, `type` (1=deposit,2=withdrawal), `created_at`/`updated_at`.

### `pitakamo_request` (via `PitakamoRequest`)
`request_id` (PK), `user_id`, `mobile`, `borrow_id`, `repayment_plan_id`, `repayment_txn_id`, `reference_id`, `amount`, `status` (1=pending,2=rejected,3=sent,4=denied,5=approved), `type` (1=withdrawal), `response` (JSON), `created_at`/`updated_at`, `created_by`/`updated_by`.

### `nuwallet_txn` (via `NUWalletTxn`)
`nuwallet_id` (PK), `user_id`, `amount`, `status` (0=pending,1=success,2=failed), `ref_token` (correlates to the external NUWallet payment token), `created_at`.

### `paypal_payments` (via `PaypalPayment`)
`paypal_payment_id` (PK), `user_id`, `created_at`, `paypal_fee`, `topup_amount`, `status` (0=pending,1=success,2=failed).

### `paypal_history` (via `PaypalHistory`)
`history_id` (PK), `created_at`, `txn_type`, `user_id`, `subscr_id`, `txn_id`, `payment_status`, `token`, `post_data`/`request_data` (serialized PHP — every raw NVP request/response, for audit).

### `user_escrow` (via `UserEscrow`)
Despite the name, this is **not** the fund-holding escrow — it is a KYC/wealth-declaration form for Singaporean vs. foreign investors: `escrow_id` (PK), `user_id`, `escrow_type` (1=Singaporean,2=foreigner), `status` (0=draft,1=final), plus wealth-type (`income`/`asset`) declaration fields and uploaded supporting-document attachments (cropped/resized). Included in the inventory because the term "escrow" collides with the withdrawal "Escrow (Investor)" request type (`Request::withdrawalTypes()`), but functionally this model belongs more to the KYC/onboarding domain than to wallet/payments — flagged here for the rebuild team to route correctly.

### Upload directories (proof-of-payment / documents)
- `uploads/banktransfer/` — deposit proof-of-transfer images (`TransferFundForm::attachment`).
- `uploads/bank_attachment/` — bank-account verification proof (`Bank::attachment`).
- `uploads/escrow/` — KYC wealth-declaration attachments (`UserEscrow`).
All three directories exist only as empty scaffolding (`.gitignore`-only) in the repo snapshot; actual files are runtime/environment data (also mirrored to a cloud bucket per `BucketLib::uploadBucket()` calls in `ServiceRequestController`).

---

## Cron/Automation Dependencies

| Command | Location | Purpose |
|---|---|---|
| `PaynamicsCommand::actionAddtoqueue` | `seedin-live-api-v1-1/newunion/cbase/commands/PaynamicsCommand.php` | Finds Paynamics txns that are `PENDING`, or `INCOMPLETE`/`FAILED` within the last 5 days, and enqueues them into `paynamics_check_queue` for status polling (dedupes against already-queued/unexecuted entries). |
| `PaynamicsCommand::actionExecuteQueue` | same file | Long-running worker loop (`while(!connection_aborted() ...)`, `sleep(2)` between iterations) that pops one queued item at a time and calls `PaynamicsTxn::checkStatus()`, persisting the result — this is what the API's `postPaynamicsConfirm` long-poll is waiting on. Must run continuously as a daemon/supervisor process, not a periodic cron tick. |
| `PaynamicsCommand::actionDuplicates` | same file | Diagnostic report of duplicate `TYPE_DEPOSIT` ledger entries sharing a `paynamics` ref — a data-integrity check, implying duplicate-crediting has been an observed real issue. |
| `PaynamicsCommand::run()` | `seedin-live-api-v1-1/newunion/cron/protected/commands/PaynamicsCommand.php` | A **second, apparently redundant/older** implementation of the same "check all incomplete/pending/failed Paynamics txns" sweep, meant to be invoked directly (single pass, not a queue worker) — likely the actual crontab entry, with the `cbase` queue-based version being a newer parallel implementation. Both exist simultaneously in the repo (see Tech Debt). Uses `daysOld() > 5` (vs. `> 15` in the queue/API version) as its force-reject threshold — an inconsistency. |
| `CoinsphCommand` | `seedin-live-api-v1-1/newunion/cbase/commands/CoinsphCommand.php` | Contains `actionCheckStatus <id>` (polls one Coins.ph invoice/transfer and applies `CoinsPH::checkStatus()`), plus `actionBalance`, `actionCreateInvoice`, `actionTransferFunds` — the latter three are clearly **manual debugging/dev-console commands** (hardcoded test emails, hardcoded account IDs, heavy commented-out code, `print_r` debug output) rather than production automation. |
| No crontab/scheduler file found in-repo | — | The actual invocation schedule (frequency, supervisor config) for these commands lives outside the repository (server crontab / process manager), so the exact cadence could not be verified from source. |

---

## Integrations

| Service | Purpose | Auth scheme | Notes |
|---|---|---|---|
| **Paynamics** | PH payment gateway: cards, GCash, online banking (BDO/BPI/Metrobank/PNB/SBC/UnionBank/UCPB), over-the-counter (7-Eleven, M Lhuillier, ECPAY), plus a legacy SOAP `query`/`refund`/`subscriptionbilling` API surface (mostly unused params scaffolding). | SHA-512 signature over concatenated fields + merchant key; SOAP client for status queries, hosted-redirect XML (base64) for payment initiation. | **Hardcoded merchant ID/key for both sandbox and "production" environments directly in source** (`PaynamicsPayment.php:10-32`) — see Tech Debt. |
| **Coins.ph** | PH crypto/GCash-adjacent cash-in (hosted invoice) and cash-out (wallet-to-wallet transfer) rail. | HMAC-SHA256 (`ACCESS_SIGNATURE`/`ACCESS_KEY`/`ACCESS_NONCE`/`ACCESS_TIMESTAMP` headers) for transfers; Bearer token for invoices. | Two parallel client implementations exist: a generic `CoinsPH` lib class (OAuth+HMAC, Requests-library based, unused in the live flow) and inline Guzzle calls directly in `FundRequest`/`ServiceRequestController`/`CoinsphCommand` — duplication (Tech Debt). |
| **PitakaMo** | PH mobile wallet used specifically for investors/borrowers sourced through the PitakaMo partner channel; wallet-to-wallet transfer + proceeds-settlement reporting API. | Static access token + username/group-id constants (`PitakaMo.php:9-11`), hardcoded in source. | Has a kill-switch (`PITAKAMO_ENABLED` constant) that returns dummy success responses when disabled — useful pattern, but means non-prod environments never exercise the real HTTP path. |
| **Coins.ph / GCash migration marker** | `m191118_064509_gcash.php` adds `users.gcash_number`; `m190924_082339_coinsph.php` adds `coins_ph` table — GCash itself is not a distinct gateway integration, it's accessed either via Coins.ph or via Paynamics' `gc` payment method, plus a manually-fulfilled `WITHDRAWAL_TYPE_GCASH` withdrawal path. |
| **PayPal** | Legacy top-up via Express Checkout (SGD currency, recurring-billing API surface largely unused for this domain). | Classic NVP/SOAP API (`USER`/`PWD`/`SIGNATURE`). | **Hardcoded live API credentials in source** (`PaypalLib.php:48-58`) for both sandbox and production. The return-flow code calls two undefined methods (`UserFund::deposit()` missing required `$ref_id` arg, `UserFund::rebate()` doesn't exist) — this integration is effectively dead/broken as committed. References to "Idea Bank"/"FundHive" in comments confirm this is inherited from a prior product name, i.e. very old, unmaintained code. |
| **NUWallet** | An internal/partner wallet-style cash-in and cash-out gateway (`withdraw/apply`, `withdraw/commit` endpoints called despite the "withdraw" naming being used for what is, from SeedIn's perspective, a *top-up*/deposit flow via `Request/TopUp`). | Simple POST via a custom `Curl` wrapper class; URL/confirm-URL from `NUWALLET_API`/`NUWALLET_CONFIRM_URL` constants. | Naming inconsistency: NUWallet's own API calls this a "withdrawal" (money leaving NUWallet into SeedIn), while SeedIn's UI presents it as a top-up. |
| **Email (EmailLib) / Push Notification / In-app Notification / SMS (SMSLib) / Telegram** | Every deposit/withdrawal approval, rejection, and submission fires a matching email template, push notification, in-app `Notification`, and (for withdrawal approval) an SMS with the amount and masked source/destination account numbers. `Telegram::log()` fires a lightweight ops-visibility ping on top-up/withdrawal submission. | — | The SMS destination number has a **hardcoded fallback `+6588287430`** used only when `TEST_MODE` is true (`FundRequest.php:451-458`, `CoinsPH.php:141-148`) — a real phone number baked into source, worth scrubbing during rebuild regardless of whether it's a real test line. |
| **DocuSign** | Adjacent to this domain only insofar as `ServerRequestController::actionUpdateStatus` gates *profile* approval (not fund approval) on contract e-signature — included for completeness since it shares the same `requests` queue UI. | — | Out of scope for wallet/payments proper. |

---

## Tech Debt / Risks Observed

- **Undefined method calls that would fatal at runtime:**
  - `UserFund::deductFund()` — called from `ServerCustomerController::actionDeductAvailableFund` — does not exist anywhere in either the admin or API `UserFund` class (both are byte-identical and neither defines it).
  - `UserFund::transferFunds()` — called from `ServerCustomerController::actionTransferFunds` — likewise undefined.
  - `FundTransaction::TYPE_TRANSFER_FUNDS_TO_BORROWER` / `TYPE_TRANSFER_FUNDS_TO_INVESTOR` — referenced in `transferFundsToBorrowerTypes()`/etc. helper methods and in `ServerCustomerController` but never declared as class constants anywhere in the codebase.
  - `UserFund::rebate()` — called from the PayPal return handler — undefined.
  - `UserFund::deposit($amount)` called with only one argument in the PayPal return handler, but the method signature requires `($amount, $ref_id, $ref = [])` with no default for `$ref_id`.
  - Net effect: the admin "deduct available fund", admin "transfer funds between accounts", and the entire PayPal top-up flow are **broken as committed** — they will error if invoked, not silently misbehave.
- **`PitakamoRequest` status helper methods are all bugged:** `isPending()`, `isRejected()`, `isSent()`, `isDenied()`, `isApproved()` each `return (self::STATUS_X)` — i.e. they return the **constant itself**, not a comparison against `$this->status`. Every one of these evaluates truthy for any non-zero constant regardless of actual record state, making them useless as state-machine guards (`PitakamoRequest.php:121-144`).
- **Undefined config key:** `Yii::app()->params['minimum_withdrawal']` is read in `ServiceRequestController::validateWithdrawalAmount()` but is **not defined in any environment's `params.php`** (prod, qa, dev checked) — the minimum-withdrawal-amount business rule is effectively unenforced (comparing against `null`/`0`) unless it's injected by some untraced override.
- **Inconsistent "how much can I withdraw" formula across two call sites:** `User::withdrawable()` (used to gate the actual withdrawal request amount) returns raw `available()` with **no fee deduction**, while `UserFund::withdrawable()` (used for display) **does** subtract the fee-adjusted amount. A user can therefore be shown one "max withdrawable" figure and be allowed to request a materially different (larger) amount.
- **Hardcoded third-party credentials committed to source:**
  - Paynamics merchant ID/key for both sandbox and production (`PaynamicsPayment.php`).
  - PayPal API username/password/signature for both sandbox and "production" (`PaypalLib.php`).
  - PitakaMo static access token, username, group ID (`PitakaMo.php`).
  - A live-looking fallback SMS phone number (`+6588287430`).
  This is a genuine credential-rotation and secrets-management risk to carry into the rebuild's threat model, independent of whether these specific creds are still active.
- **Two independent, seemingly redundant Paynamics polling implementations** with **different force-reject thresholds** (`daysOld() > 15` in `cbase/commands/PaynamicsCommand.php` + the inline API check, vs. `daysOld() > 5` in `cron/protected/commands/PaynamicsCommand.php`) — unclear which one is actually wired into production cron; the discrepancy itself is a correctness risk (a stuck txn could be force-rejected at 5 days by one path and left pending until 15 by the other, depending on which job is live).
- **Two independent Coins.ph client implementations** — a generic reusable `CoinsPH` lib class (OAuth or HMAC, uses the `Requests` PHP library) that appears unused by the live code paths, versus ad-hoc inline Guzzle/cURL calls duplicated across `FundRequest::withdrawCoinsph()`, `CoinsPH::checkStatusResponse()`, `ServiceRequestController::postTopupCoinsph()`, and `CoinsphCommand` — signature/timestamp/nonce construction logic is copy-pasted rather than shared.
- **Debug/dead code left in production-path files:** `CoinsphCommand.php` contains large commented-out blocks, hardcoded test credentials/emails, and unconditional `print_r()` calls in what look like exploratory dev-console commands rather than scheduled jobs; `CoinsphController::actionCallback`/`actionCallback2` on the user app simply dump raw webhook payloads to a local log file with **no signature verification and no business logic** — if these are live webhook endpoints, they are currently no-ops from a ledger-crediting standpoint.
- **Non-atomic "un-set all other primaries, then set new primary" bank operation** (`Bank::setPrimary()`) — two separate `save()`/`updateAll()` calls with no explicit DB transaction wrapping them; a mid-operation failure could leave a user with zero or multiple primary banks.
- **Hardcoded per-user special case in a financial integrity check:** `FundRequest::validateOnHold()` contains `switch ($user->user_id) { case 7: $result = 0; break; ... }` — a specific user id is exempted from the on-hold reconciliation guard that otherwise blocks withdrawal approval on ledger mismatch. This is a targeted workaround for one account's known-bad historical data, not a general rule, and should not be carried forward as-is.
- **Withholding-tax formula has a hard date cutover** (`InvestorPayInterest()`, `2018-02-01`) baked into runtime logic rather than being config/versioned — correct for historical replay but a poor pattern to extend (the next rate/rule change would presumably get bolted on the same way).
- **The `seedin-live-user` repo's own `FundRequest` model is a stale/divergent copy** (plain class, not an ActiveRecord, missing the fee/hold logic entirely, references now-dead flags like `ENABLE_PAYPAL = FALSE` and `ENABLE_TOPUP_BANK_FEE = FALSE`, loads payment-type lists from static JSON files that don't exist in the reviewed API app) — confirms the user-facing app is a thin proxy and this local copy is vestigial, but it's dead weight/confusion risk if a future maintainer edits it expecting it to be live.
- **`postWithdrawOld` is a near-complete duplicate of `postWithdraw`** left in the controller, gated only by a PitakaMo check — unclear if any client still calls it; duplicate logic paths for the same business operation increase the chance of the two drifting (e.g. `postWithdraw` enforces `WithdrawalForm` validation + the type-specific dispatch, `postWithdrawOld` does not dispatch to Coins.ph/PitakaMo at all).
- **GCash has no dedicated payout API integration** despite being a first-class `withdrawal_type` — the payout appears to rely on manual admin fulfillment outside the codebase (no automated crediting/transfer call was found for this type, unlike Coins.ph and PitakaMo).
- **`Request::description()` and `requestUrl()` build raw HTML strings with unescaped user-derived data** (email address, filenames) interpolated directly into `<a href>`/`<b>` markup — a stored-XSS-shaped pattern in the admin request-queue UI if any of those fields can contain attacker-controlled content.
- **Excel export / OCBC reconciliation report literal reference to "OCBC"** while the configured escrow bank in `params.php` is DBS Bank — `WithdrawocbcController`'s naming suggests the bank relationship changed at some point (OCBC → DBS) without the report/controller names being updated, a purely cosmetic but confusing legacy naming risk when onboarding new engineers.

---

## Proposed MVP Scope for Revamp

### Must-have (v1)
- **Wallet ledger core**: `balance` / `on_hold` / `available` model with an append-only transaction ledger (mirroring `FundTransaction`'s snapshot-balance-at-each-row pattern) — this is the financial source of truth every other feature depends on.
- **Bank-transfer top-up with proof-of-payment upload + admin approve/reject** — the baseline cash-in path that works regardless of any gateway's availability; needed on day one for both investors and borrowers.
- **Withdrawal request → percentage fee → hold → admin approval → payout** state machine, including the gross/net/fee three-way split and the on-hold reconciliation guard (rebuilt without the hardcoded user-id exemption) — this is the money-out core and the most complex/highest-risk logic to re-derive if lost.
- **Minimum withdrawal & minimum top-up amount enforcement**, properly wired to config this time (fixing the currently-broken `minimum_withdrawal` param).
- **Bank account management with verification workflow** (pending/approved/rejected, primary-account selection) — a hard prerequisite for any withdrawal payout.
- **At least one automated PH gateway for cash-in** (Paynamics or Coins.ph, whichever the business still actively uses) with a clean, single, tested signature/webhook implementation — avoid recreating the current duplicated-client problem.
- **Admin unified request queue** (approve/reject with reason, filter by type/status) — operationally required for staff to run the business day-to-day.
- **Excel/CSV reporting for reconciliation** (withdrawal requests, bank-transfer reconciliation) — needed for finance/ops continuity from day one.

### Nice-to-have / defer
- **Coins.ph withdrawal auto-payout integration** — valuable but can launch v1 with manual/bank-transfer payout while the gateway integration is rebuilt cleanly (current dual-client mess is not worth porting as-is).
- **PitakaMo integration** — appears to serve a narrow partner-channel segment; confirm current active volume with the business before committing rebuild effort; if low, defer and handle via manual reconciliation initially.
- **GCash as a distinct withdrawal type with its own eligibility gate** — since no automated payout exists today anyway (it's manually fulfilled), v1 can fold it into "bank transfer" withdrawal until/unless a real GCash disbursement API is integrated.
- **PayPal top-up** — currently broken/dead code with hardcoded legacy credentials and a stale SGD-denominated fee model; do not port as-is. Only rebuild if the business confirms it's still a wanted acquisition channel; if so, treat it as a net-new integration rather than a migration.
- **NUWallet integration** — scope/ownership unclear from code alone (external partner wallet); confirm business relevance before rebuilding.
- **Admin manual "deduct available fund" / "transfer funds between accounts" tools** — currently non-functional (call undefined methods), so there is no working behavior to preserve; rebuild only if ops confirms they need these break-glass tools, and implement them correctly against the new ledger model.
- **PayNamics' full historical payment-method catalogue** (7-Eleven, M Lhuillier, ECPAY OTC, multiple online-banking rails, subscription-billing surface) — the SOAP `process()`/`buildMethodParams()` scaffolding supports many transaction types (subscriptions, disputes, reversals) that this domain never actually exercises for cash-in/cash-out; only the `sale`/`query` flows are must-have, the rest is dead surface area not worth porting.
- **OCBC-branded reconciliation report** — rename/refactor into a generic "escrow bank reconciliation" report tied to whichever bank is currently configured, rather than porting the OCBC-specific naming.
