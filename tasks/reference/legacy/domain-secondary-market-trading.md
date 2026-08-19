# Secondary Market / Investment Trading

## Overview

This domain is a peer-to-peer resale marketplace layered on top of SeedIn's primary lending product. An **investor** who already holds an active investment (a `LoanLendRepaymentPlan` record) can list it for resale to other investors before it matures (`InvestmentTradeList`). Other investors can either **bid** an amount below the seller's asking price (`InvestmentTradeBid` / `InvestmentTradeBidHistory`) or trigger an instant **Buy Now** at the seller's fixed price. The seller can accept the winning bid, or let the listing sit until it expires; a **cron job** auto-expires stale listings and auto-cancels listings whose seller-accept window lapses. While a listing is open, bidders' funds are placed **on hold** (escrowed) in their wallet; funds are released back to losing bidders when a sale/cancellation resolves the listing. On a successful sale, the underlying investment (repayment plan) is transferred to the buyer, any pending payout for the seller is prorated/handled, and the platform charges the seller a **sale fee**.

Actors:
- **Investor (seller)** — lists an eligible investment for resale, can accept a bid or cancel the listing.
- **Investor (buyer/bidder)** — browses listings, places bids or buys now, can cancel their own bid while the listing is open.
- **Admin** — read-only visibility into listings/bids via a backend "Investment Trading" screen and a "Trading" report/export (no admin action to force-cancel or override a trade found in the code).
- **Introducer / Manager** — copied on trade lifecycle email notifications (added, bid, accepted, cancelled, sold) for the accounts they oversee, via `EmailLib::notifyIntroducer()` / `EmailLib::notifyManagers()`.
- **System (cron)** — flags which investments are eligible to be listed (`sellable_flag`), expires listings past their bidding window, and auto-cancels listings whose seller-accept window has lapsed without action.

## Current Features & Flows

### Admin dashboard (`seedin-live-admin` / `seedin-live-api-v1-1`, `backend` app)

| Endpoint | Description |
|---|---|
| `InvestmentTradingController::actionIndex` | Alias for the listing index (`admin/investmentTrading`). — `.../backend/controllers/InvestmentTradingController.php:5-8` |
| `InvestmentTradingController::actionList` | Lists **all** `InvestmentTradeList` records (no pagination/filter in the controller itself) — `.../InvestmentTradingController.php:25-30`, rendered by `backend/views/investment_trade/list.tpl` (date, seller name, investment amount, minimum price, buy-now price, latest/winning bid amount, computed status). |
| `InvestmentTradingController::actionView($id)` | Detail view of one listing: seller, buy-now/minimum price, expiry date, computed status, and — if sold — buyer, amount sold, date sold, plus the 10 most recent bids — `.../InvestmentTradingController.php:10-17`, `backend/views/investment_trade/view.tpl`. |
| `InvestmentTradingController::actionAdd` | Renders an "add" form, but binds it to `InvestmentForm` (a real-estate/property investment form: `property_name`, `goal`, `roi`, etc. — `backend/forms/InvestmentForm.php`), **not** a trade-listing form (`InvestTradeForm`). This action is effectively non-functional/mismatched for creating a trade listing — `.../InvestmentTradingController.php:19-23`. |
| `TradingController::actionIndex` (under `reports/`) | Renders the "Secondary Trading" report page (`reports/trading/list`) — `.../backend/controllers/reports/TradingController.php:5-12`. |
| `ServerTradingController::actionList` | AJAX data source for the report grid; filters by year (required), status, month, and seller-name keyword — `.../backend/controllers/reports/server/ServerTradingController.php:5-75`. |
| `TradingController::actionDownload` | Exports the filtered report to an `.xlsx` (via PHPExcel) named `Trading-<Status|All>-<year>-<month>.xlsx`; `downloadType=2` also dumps each listing's recent bid history inline in the sheet — `.../reports/TradingController.php:14-153`. |

### API — customer-facing service layer (`seedin-live-api-v1-1`, `services` app)

**No `ServiceInvestmentTradeListController` or `ServiceInvestmentTradeBidController` PHP file exists in this codebase** (see Tech Debt). The only real, present customer endpoints in this area belong to `ServiceInvestmentController` (`.../applications/services/controllers/ServiceInvestmentController.php`) and cover the *primary* investment, not the trade marketplace:

| Endpoint | Description |
|---|---|
| `GET Investment/List` | Paginated list of the logged-in investor's primary investments (repayment plans), joined to the borrow listing — line 20-87. |
| `GET Investment/View` | Full detail of one investment the caller owns (repayment schedule, voucher, contract URL, etc.) — line 98-281. |
| `POST Investment/Cancel` | Cancels an investor's pledge if `LoanLendRepaymentPlan::canCancel()` (auto-invest + still open) — line 292-318. |
| `POST Investment/LinkVoucher` | Attaches/detaches a promotion voucher to an investment — line 330-417. |

Functional test files (`newunion/tests/codeception/functional/tests/frontend/InvestmentTradeCest.php`, `ApiProductACest.php`, `ApiProductACest_2.php`) show the **intended** service surface for this domain, exercised against endpoints that are not implemented as controllers in this snapshot:
`InvestmentTradeList/Add`, `InvestmentTradeList/View`, `InvestmentTradeList/BuyNow`, `InvestmentTradeList/Accept`, `InvestmentTradeList/SellerCancel`, `InvestmentTradeList/BuyerCancel`, `InvestmentTradeBid/Add`, `InvestmentTradeBid/List` (`ApiProductACest_2.php:544-637`, `ApiProductACest.php:1041-1150`). These names are the closest thing to an endpoint contract available and should guide the rebuilt API surface.

### "User" frontend app (`seedin-live-user`, legacy server-rendered site)

| Route | Description |
|---|---|
| `investment-trade` → `InvestmentController::actionInvestmentTrade` (route map only, `.../frontend/config/main.php:51`) | Intended trade-listing browse page. `InvestmentController` merely extends `LoanController`, and **no `actionInvestmentTrade` method exists** anywhere in the inheritance chain — this route 404s as coded. |
| `investment-trade/<id>` → `InvestmentController::actionInvestmentTradeView` (`main.php:52`) | Intended single-listing page; likewise **not implemented**. |
| `ServerInvestmentController::actionCancel` / `actionLinkVoucher` | Proxies to `Investment/Cancel` and `Investment/LinkVoucher` on the API service (primary investment only, not trade) — `.../frontend/controllers/server/ServerInvestmentController.php`. |

### Model-layer business actions (invoked from the (missing) controllers above, and directly by cron)

These are the actual state-transition methods that implement the domain, all on `InvestmentTradeList` / `InvestmentTradeBid` (identical in `seedin-live-admin` and `seedin-live-api-v1-1`, path: `.../applications/common/models/InvestmentTradeList.php` and `InvestmentTradeBid.php`):

- `InvestmentTradeList::addBid($params)` — place/raise a bid, or auto-trigger Buy Now if the bid ≥ buy-now price (line 165-261).
- `InvestmentTradeList::buyNow($params)` — immediate purchase at (or above) the buy-now price (line 263-329).
- `InvestmentTradeList::cancelBidding()` — seller cancels the whole listing (line 581-619).
- `InvestmentTradeList::cancelBidder(User $user)` — a specific bidder withdraws their bid (line 621-690).
- `InvestmentTradeList::acceptBidding()` — seller accepts the current winning bid (line 692-743).
- `InvestmentTradeBid::releaseOnHoldAmount()` / `completeOnHoldAmount()` / `accepted()` — escrow release/settlement helpers per bid.
- `InvestmentTradeLib::CheckSellableFlag()`, `CheckExpiration()`, `CheckAcceptWindowAutoClose()` — the three cron-driven system jobs (see Cron section).

## Business Logic & Computations

### 1. Listing eligibility ("sellability") — `LoanLendRepaymentPlan::canAddTrade()` / `canAddToTradeList()`
```
( is_selling == 0 OR (tradelist exists AND tradelist->isCancelled()) )
AND sellable_flag == today's date
AND is_acquired == 0
AND status == LoanLendRepaymentPlan::STATUS_ONGOING
```
(`.../common/models/LoanLendRepaymentPlan.php:1802-1808`)

`sellable_flag` is a **daily, cron-computed** eligibility flag (see Cron section) — it must equal *today's* date, meaning eligibility is only valid for the day it was computed and must be recomputed daily by the cron job. `is_selling` marks whether the plan already has an active/expired trade listing (`LoanLendRepaymentPlan::isSelling()`, line 1810-1812).

### 2. Which investments are candidates for sellability at all — `InvestmentTradeLib::CheckSellableFlag()`
Only scans borrow listings matching:
```sql
version = 2 AND is_trial = 0
AND status IN (LoanBorrowListing::STATUS_REPAYMENT, LoanBorrowListing::STATUS_APPROVED)
AND product_type IN (LoanBorrowListing::PRODUCT_TYPE_A, LoanBorrowListing::PRODUCT_TYPE_C)
```
(`.../common/lib/InvestmentTradeLib.php:9`) — i.e. **Product B (crowdfunded) loans are excluded** from the secondary market; only Product A (pre-funded) and Product C loans, on "version 2" contracts, non-trial, that are approved or in repayment, are candidates. For each matching loan it recomputes `total_payouts` (sum of paid `LoanLendRepaymentTxn` amounts) and `last_payout_period` (next period − 1, or full tenor if fully paid), then for every lender (`LoanLendRepaymentPlan`) that is not already listed and is `STATUS_ONGOING`, it calls `$lender->sellabilityExceptions()` and sets `sellable_flag` to today if it passes, else `0` (line 13-64). **`sellabilityExceptions()` is called but is not defined anywhere in the codebase** (see Tech Debt) — its actual eligibility rules (e.g. minimum holding period, no missed payments, etc.) are not recoverable from this code and must be re-specified with the business for the rebuild.

### 3. Trade expiry date calculation — `InvestmentTradeList::calculateExpiryDate(LoanLendRepaymentPlan $investment)` (line 821-874)
```
expire_date              = today + investment_trade_max_days
allow_before_payout_date = today + investment_trade_days_allowed_before_payout
```
- If the investment uses effective-rate amortization, the "second-to-last" repayment index is `count(scheduleRows) - 2`; otherwise it is `loan_tenor - 1` (i.e. second-to-last row of the flat repayment table).
- **Rule A:** if `allow_before_payout_date > next_payout_date`, trading is blocked: *"It is not allowed to trade if next payout is within N days."* (N = `investment_trade_days_allowed_before_payout`).
- **Rule B:** if today ≥ the second-to-last repayment date, trading is blocked: *"Cannot sell if only left two payouts."*
- **Rule C:** if the computed `expire_date` would fall after the second-to-last repayment date, trading is blocked: *"Expiration date must not cross the second last payout."*
- Otherwise returns `expire_date` (a `Y-m-d` string) as the listing's bidding deadline.

### 4. Minimum bid amount — `InvestmentTradeList::minimumBidAmount()` (line 152-163)
```
min_bid = minimum_price
if last_bid_amount > 0:
    min_bid = last_bid_amount + investment_trade_minbid_diff   // minimum outbid increment
if min_bid > buynow_price:
    min_bid = buynow_price
```

### 5. Bid placement / hold amount — `InvestmentTradeList::addBid()` (line 165-261)
- If `amount >= buynow_price` → redirect straight into `buyNow()` (auto buy-now trigger).
- Otherwise: finds or creates the caller's `InvestmentTradeBid` row (one row per user per listing — bids are *raised*, not stacked). The **incremental hold amount** is `amount - previous_bid_amount` (only the delta is placed on hold, not the full new bid), then a hold is recorded via `UserFundHold::hold(..., UserFundHold::TYPE_BID, ...)` and a corresponding `fund()->InvestmentTradeBidHold(...)` ledger entry. Both a full `InvestmentTradeBidHistory` audit row and the `InvestmentTradeBid` "current bid" row are written. The listing's `last_bid_amount` / `winning_bid_id` are updated to the new bid (highest bidder always wins — no explicit "second-price"/proxy-bid logic; the visible `last_bid_amount` is simply this bidder's own new amount).
- Validation gate: `bidExceptions()` (line 492-528):
  - Runs `checkMainExceptions()` (below).
  - `usable_funds = available balance`, plus the caller's *existing* bid amount on this same listing added back in (so a bidder isn't penalized for their own prior hold when raising a bid).
  - Reject if `amount < minimumBidAmount()` → *"Please enter a minimum amount to bid (X)"*.
  - Reject if `usable_funds < amount` → *"Insuficient funds..."*.
  - Reject if the user previously **cancelled** their bid on this listing (`STATUS_BUYER_CANCELLED`) → they may not re-bid.

### 6. Buy Now — `InvestmentTradeList::buyNow()` (line 263-329) / `buyNowExceptions()` (line 530-550)
- `sold_amount` defaults to `buynow_price` (but the method accepts an override `sold_amount` param with no upper/lower bound check against `buynow_price` beyond the exceptions check below — see Tech Debt).
- Validation: same `checkMainExceptions()`, plus `usable_funds` (available balance + caller's own last bid on this listing, if any) must be ≥ `buynow_price`.
- On success: releases **all** other bidders' on-hold funds (`releaseAllBiddersOnHoldAmount('buynow', ...)`), marks listing `STATUS_SOLD_BUYNOW`, calls `transferInvestmentTo()` to actually move the investment to the buyer, and releases any escrowed borrower payout to the new investor (`releaseOnHoldPayouts`).

### 7. Common pre-trade guard rails — `InvestmentTradeList::checkMainExceptions()` (line 554-570)
Rejects the action if any of:
- Caller is the listing's own seller — *"You cannot buy or bid on your own investment."*
- `hasExpired()` (current time past `expire_date`) — *"Listing has been expired."*
- `sold_to_user_id != 0` — *"Listing has been sold."*
- `status != STATUS_ONGOING` — *"This listing is not available."*
- Caller's available fund balance is exactly `0` — *"You dont't have available funds. Please Top up."*

### 8. Accept-window (seller decision deadline) — `expireAcceptDate()` / `isAcceptPeriodExpired()` / `canAccept()`
```
accept_deadline = expire_date + investment_trade_accept_window days   (line 99-101)
isAcceptPeriodExpired = today (00:00) > accept_deadline
canAccept = !isAcceptPeriodExpired AND status in {ONGOING, EXPIRED}
```
Once a listing's bidding window (`expire_date`) lapses, the cron flips it to `STATUS_EXPIRED` but the seller still has `investment_trade_accept_window` days to **Accept** the current winning bid or **Cancel**; if neither happens in time, the cron auto-cancels it (`CheckAcceptWindowAutoClose`, releasing everyone's funds).

### 9. Accepting the winning bid — `InvestmentTradeList::acceptBidding()` (line 692-743)
Only proceeds if the current `winning_bidder` still matches `winning_bid_id` (guards against a stale/withdrawn winner). Releases all other bidders' holds, marks the winning `InvestmentTradeBid` `STATUS_ACCEPTED` (`InvestmentTradeBid::accepted()`, which "completes" — not merely releases — that bidder's fund hold), sets listing `STATUS_SOLD_ACCEPT`, then runs the same `transferInvestmentTo('accept', ...)` used by Buy Now.

### 10. Ownership transfer & pro-rated payout split — `InvestmentTradeList::transferInvestmentTo($action, $user, $sold_amount, $is_current_payout_to_buyer)` (line 331-433)
This is the core settlement routine, run identically for both Buy Now and Accept:
- Requires the underlying loan to have a "next period" (throws `Next repayment is empty` otherwise).
- Creates a **new** `LoanLendRepaymentPlan` for the buyer, copying most economic attributes from the original (amount, contract/version, `account_src`, `available_funds_used`, `promotion_funds_used`, `last_period_applied`, `last_date_applied`, buyer's `elite_type`), zeroing `earned_interest`, flagging `is_acquired = 1` and linking `trade_list_id` back to this listing — then resets its repayment schedule and creates a matching `LoanLendListing` record.
- Ledger postings: seller's fund gets `InvestmentTradeSold($sold_amount, ...)`; on Buy Now specifically, buyer's fund also gets `InvestmentTradeAcquiredBuynow($sold_amount, ...)`.
- Investment-count/outstanding bookkeeping: for Product B loans, `outstanding` comes from the linked `loan_request`; otherwise it's the acquired amount. Seller's fund investment count/outstanding is decremented, buyer's is incremented.
- **Payout timing split** (who receives the *next* repayment period — seller or buyer):
  - If `is_current_payout_to_buyer` is true and this is the *first* time the listing changed hands (`sold_at_period == 0`): the buyer receives the very next payout in full; `sold_at_period = next_period - 1` and `period_split_amount = 0`.
  - Otherwise (payout is split day-by-day within the period): `sold_at_period = next_period`, and the **seller's residual entitlement** for that transitional period is computed as:
    ```
    period_split_amount = orig_investment_next_period_interest - new_investment_next_period_interest
    ```
    i.e. the difference between what the original schedule would have paid for that period and what the new (buyer's) schedule — recalculated from the sale date — pays for the same period. This is the pro-rated interest the outgoing seller is still owed for the days they held the investment within the transition period.
- The original investment is marked `LoanLendRepaymentPlan::STATUS_SOLD`; both plans have their repayment schedules reset.
- **Sale fee (only cost charged in this domain):**
  ```
  total_fee = sold_amount * investment_trade_sale_fee     (a configured percentage/rate)
  ```
  charged to the **seller's** fund via `InvestmentTradeSaleFee($total_fee, ...)` (line 425-427). This is a flat percentage of the sale price — no tiered/sliding scale found in code.

### 11. Whether the current payout should route to the buyer instead of the seller — `isCurrentPayoutToBuyer()` (line 769-777)
```
isCurrentPayoutToBuyer = isOnHoldPayouts() OR isNextPayoutWithinBiddingDays()
```
- `isOnHoldPayouts()`: true if there is an unreleased `UserFundHold` of type interest/voucher/capital repayment already sitting against this repayment plan (i.e. the borrower already paid but the fund is escrowed pending the trade's resolution).
- `isNextPayoutWithinBiddingDays()` (line 754-767): true if the *next* scheduled payout date falls between the listing's creation date and `expire_date + investment_trade_accept_window` days — i.e. a payout is due to land somewhere inside this listing's max possible lifetime (bidding + accept window), so it must be redirected to whoever ends up owning the investment rather than paid out mid-auction.

### 12. Escrowed borrower payouts during an active/expired-but-undecided listing — `checkIfHoldPayout()` / `releaseOnHoldPayouts()`
```
checkIfHoldPayout = (isOngoing() OR isExpired()) AND !isAcceptPeriodExpired()
```
While a listing is open or pending seller-accept, any borrower repayment that lands on this investment must be held rather than paid out (this flag is presumably consulted by the repayment/payout cron, which is outside the provided file set for this domain — see Cron section note). `releaseOnHoldPayouts($new_investment=null)` (line 779-795) finds all `UserFundHold` rows of type interest/voucher/capital tied to `repayment_plan_id`; if a `$new_investment` (the buyer's new plan) is supplied it **transfers** the held funds to that new investment (`hold->transferFundsToNewInvestment()`), otherwise (listing cancelled with no buyer) it simply releases the hold back to the original owner.

### 13. Bid cancellation and fund release
- **Bidder cancels their own bid** (`InvestmentTradeList::cancelBidder`, line 621-690): releases that bidder's hold (`STATUS_BUYER_CANCELLED`), deactivates all their `InvestmentTradeBidHistory` rows (`is_active = 0`), and if they were the current winning bidder, the listing's `last_bid_amount`/`winning_bid_id` fall back to whoever is now the next-highest **active** bid (`winning_bidder` relation re-queried), or to zero/none if nobody else bid. Once a bidder cancels, `bidExceptions()` permanently blocks them from bidding again on that same listing (see #5).
- **Seller cancels the whole listing** (`cancelBidding`, line 581-619): sets `STATUS_CANCELLED`, `date_cancelled = now`, releases every bidder's on-hold funds (`STATUS_SELLER_CANCELLED`), and releases any escrowed borrower payout back to the (unchanged) original owner.

### 14. Status derivation shown to users — `InvestmentTradeList::status()` (line 120-138)
Not a stored value beyond the raw `status` int — the human-facing label is computed:
- `Sold` if `isSold()`; `Cancelled` if `isCancelled()`.
- If `isExpired()`: computed as `Pending for approval` **only** to the seller or the current winning bidder, and only while `now < expire_date + accept_window` — everyone else (and the seller/winner after the accept window lapses) sees `Expired`.
- `On Going` otherwise.

## Data Model

### `investment_trade_listings` — `InvestmentTradeList` (PK `trade_list_id`)
| Column (inferred) | Notes |
|---|---|
| `trade_list_id` | PK |
| `user_id` | seller (`belongs_to User`) |
| `sold_to_user_id` | buyer once sold; `0`/unset while open |
| `repayment_plan_id` | the investment being resold (`belongs_to LoanLendRepaymentPlan`, aliased `investment`) |
| `status` | `0` Ongoing, `1` Sold (Buy Now), `2` Sold (Accepted), `3` Cancelled, `4` Expired (constants `STATUS_*`, line 16-27) |
| `minimum_price`, `buynow_price` | seller-set asking bounds |
| `last_bid_amount`, `winning_bid_id` | denormalized cache of the current top bid |
| `expire_date` | bidding deadline (see calc #3) |
| `created_at`, `date_cancelled`, `date_sold` | lifecycle timestamps |
| `amount_sold` | final settlement amount (buy-now price or accepted bid amount) |
| `sold_at_period`, `period_split_amount` | payout-transition bookkeeping (see calc #10) |

Relations: `user`, `sold_to_user`, `investment` (→ `LoanLendRepaymentPlan`), `bids` (→ all `InvestmentTradeBid`), `bid_history` / `recent_bids` (→ active `InvestmentTradeBidHistory`, latter capped at 10), `winning_bidder` (→ highest-amount active `InvestmentTradeBid`).

### `investment_trade_bids` — `InvestmentTradeBid` (PK `bid_id`)
| Column | Notes |
|---|---|
| `bid_id` | PK |
| `user_id` | bidder |
| `trade_list_id` | FK to listing |
| `amount` | bidder's current (latest) bid amount — one row per bidder per listing |
| `last_bid_date`, `created_at` | timestamps |
| `status` | `0` Active, `1` Accepted, `2` Seller Cancelled, `3` Buyer Cancelled, `4` Released (constants line 12-18) |
| `date_accepted` | set on acceptance |

### `investment_trade_bid_history` — `InvestmentTradeBidHistory` (PK `id`)
| Column | Notes |
|---|---|
| `id` | PK |
| `user_id`, `trade_list_id`, `bid_id` | links back to bidder/listing/current bid row |
| `amount`, `created_at` | full audit trail of every raise (unlike `InvestmentTradeBid`, which only stores the latest amount) |
| `is_active` | zeroed out when the bidder cancels, so historical rows can be excluded from "recent bids" display |

### `loan_lend_repayment_plans` (`LoanLendRepaymentPlan`) — fields touched by this domain
`is_selling`, `sellable_flag` (date string or `0`), `is_acquired`, `trade_list_id` (FK back to the listing that created this plan, for acquired plans), plus the full set of economic attributes copied on transfer (`amount`, `version`, `contract_version`, `account_src`, `available_funds_used`, `promotion_funds_used`, `last_period_applied`, `last_date_applied`, `elite_type`, `earned_interest`, `introducer_id`, `repayment_start_date`, `status`).

### `loan_borrow_listings` (`LoanBorrowListing`) — fields touched by `CheckSellableFlag`
`total_payouts`, `last_payout_period` (recomputed daily by the cron for every eligible loan).

### `user_funds_hold` (`UserFundHold`) — escrow ledger
Referenced (but only partially defined — see Tech Debt) types: `TYPE_BID` (bid escrow), `TYPE_REPAYMENT_INTEREST` / `TYPE_REPAYMENT_VOUCHER` / `TYPE_REPAYMENT_CAPITAL` (borrower payouts held during an open trade). Referenced statuses: `STATUS_HOLD`, `STATUS_RELEASED` (in addition to the defined `STATUS_HOLD`/`STATUS_CANCELLED`/`STATUS_COMPLETED`). Stores `ref_id` (links to `bid_id` or `repayment_plan_id` depending on type) and a JSON `ref` blob (e.g. `txnid`, `bidhistid`).

## Cron/Automation Dependencies

`InvestmentTradeCommand` (Yii console command) runs three jobs in sequence every invocation:
```php
InvestmentTradeLib::CheckExpiration();
InvestmentTradeLib::CheckSellableFlag();
InvestmentTradeLib::CheckAcceptWindowAutoClose();
```
(`.../cron/protected/commands/trash/InvestmentTradeCommand.php:8-11`)

1. **`CheckExpiration()`** (`InvestmentTradeLib.php:90-120`) — for every `STATUS_ONGOING` listing whose `hasExpired()` is true (past `expire_date`), flips it to `STATUS_EXPIRED` and emails the seller that they have `investment_trade_accept_window` days to accept the winning bid (`EmailLib::InvestmentTradeExpiredNotifySellerToAccept`).
2. **`CheckSellableFlag()`** (line 6-69) — daily recompute of which investments are eligible for listing (see Business Logic #2); this must run once per day (before sellers try to list) since eligibility is keyed to "today's date."
3. **`CheckAcceptWindowAutoClose()`** (line 71-88) — for every `STATUS_ONGOING` listing whose accept window has lapsed (`isAcceptPeriodExpired()`), force-cancels it via `cancelBidding()` (releasing all bidder holds), swallowing any exception silently (`catch(Exception $e){}` with no logging).

**Important caveat:** this command file lives in `newunion/cron/protected/commands/**trash**/InvestmentTradeCommand.php`, not in the live `commands/` directory alongside the actually-scheduled jobs (`AutoInvestCommand`, `InvestorFeesCommand`, `CheckStatementCommand`, etc., which sit one level up). Yii's console app only auto-discovers commands from the configured `commandPath`, so a file under a `trash/` subfolder is not reachable as `yiic investmentTrade` by default — see Tech Debt for the implication.

## Integrations

- **Email** (`EmailLib`, SwiftMailer-based) — every lifecycle transition sends templated HTML email (`.mail` templates under `common/views/_email/investment_trade_*.mail` and `admin_investment_trade_*.mail`): listing added, bid placed (buyer+seller), buy-now (buyer+seller), bid accepted, bidder cancelled (buyer+seller notice), seller cancelled (buyer+seller notice), funds released, and listing-expired-pending-accept. Admin-facing copies are BCC'd to `Yii::app()->params['admin_email_cc']`.
- **In-app notifications** (`Notification::send(...)`) — mirrors most of the above seller/buyer emails as in-app notification records.
- **Introducer/Manager fan-out** (`EmailLib::notifyIntroducer()`, `notifyManagers()`) — several trade events (added, bid, accepted, cancelled, sold) are also copied to the relevant introducer and manager accounts.
- **Activity log** (`Activity::userLog`) — records `TYPE_BIDDING_TRADE_BID` (135), `TYPE_BIDDING_TRADE_BUY` (136), `TYPE_BIDDING_CANCEL` (132), `TYPE_BIDDING_ACCEPT` (133) against the underlying `repayment_plan_id`.
- **Internal wallet ledger** (`FundTransaction` / `UserFundHold`) — all escrow and settlement movements are (intended to be) posted here; no external payment gateway is touched directly by this domain — funds already sit in the platform wallet from a prior deposit/investment.
- **Excel export** (PHPExcel/`PhpExcelLib`) — the only "integration" that fully works end-to-end in this domain, for the admin Trading report download.
- No SMS, e-signature, or accounting-system (Xero/QuickBooks) touchpoints were found for this domain specifically (those integrations exist elsewhere in the codebase for other domains).

## Tech Debt / Risks Observed

- **The customer-facing API surface for this domain does not exist in this codebase.** Functional tests (`ApiProductACest.php`, `ApiProductACest_2.php`, `InvestmentTradeCest.php`) call `InvestmentTradeList/Add|View|BuyNow|Accept|SellerCancel|BuyerCancel` and `InvestmentTradeBid/Add|List`, but no `ServiceInvestmentTradeListController.php` / `ServiceInvestmentTradeBidController.php` exists under `.../applications/services/controllers/` (verified by directory listing — only 31 other `Service*Controller.php` files are present, none named for trading). The legacy user-frontend routes `investment-trade` and `investment-trade/<id>` (`seedin-live-user/.../frontend/config/main.php:51-52`) point at `InvestmentController::actionInvestmentTrade[View]`, methods that do not exist anywhere in `InvestmentController` or its parent `LoanController` — these routes would 404 today.
- **Core wallet methods this domain depends on are not implemented.** `InvestmentTradeList`/`InvestmentTradeBid` call `$user->fund()->InvestmentTradeBidHold()`, `InvestmentTradeSold()`, `InvestmentTradeAcquiredBuynow()`, `InvestmentTradeSaleFee()`, `InvestmentTradeBidRelease()`, and `InvestmentTradeAcquiredAccept()` on the `UserFund` model, plus `UserFundHold::TYPE_BID`, `TYPE_REPAYMENT_INTEREST`, `TYPE_REPAYMENT_VOUCHER`, `TYPE_REPAYMENT_CAPITAL`, `STATUS_RELEASED`, `->releaseFunds()`, and `->transferFundsToNewInvestment()`. None of these methods or constants are defined in `.../common/models/UserFund.php` or `.../common/models/UserFundHold.php` (both fully read; `UserFund` only defines `TYPE_WITHDRAWAL/LOAN_PLEDGE/LOAN_REQUEST` and generic `add/minus/addHoldAmount/minusHoldAmount`). Calling `addBid()`, `buyNow()`, `acceptBidding()`, or `cancelBidder()` as currently written would throw a PHP fatal error ("call to undefined method") every time.
- **`LoanLendRepaymentPlan::sellabilityExceptions()` is called but never defined.** `InvestmentTradeLib::CheckSellableFlag()` (`InvestmentTradeLib.php:44`) calls this method inside a `try/catch(Exception $e)`; since PHP 7 a call to an undefined method throws `\Error`, not `\Exception`, so this catch block would **not** actually contain the failure — the cron job would fatal-error on the first eligible loan it processes. The real eligibility rule set behind "sellability" (beyond the SQL prefilter in `CheckSellableFlag`) is not recoverable from this codebase and must be re-elicited from the business.
- **The scheduled command lives in a `trash/` folder**, not the live `commands/` directory (`newunion/cron/protected/commands/trash/InvestmentTradeCommand.php`, alongside ~40 other retired commands). Combined with the two points above, this strongly suggests the entire feature has been dormant/disabled in production for some time, even though the domain model, admin read views, and email templates are fully built out.
- **`InvestmentTradingController::actionAdd`** binds an unrelated `InvestmentForm` (property/real-estate fields: `property_name`, `goal`, `roi`, …) instead of the trading-specific `InvestTradeForm` (`buynow_price`, `minimum_price`, `repayment_plan_id`) that actually exists at `.../services/forms/InvestTradeForm.php` — the admin "Add" action is not wired to create a real trade listing.
- **`EmailLib::InvestmentTradeAdded()`** is defined but never called anywhere in the codebase — dead code, consistent with there being no working "create listing" endpoint.
- **Admin report status filter has confusing/likely-buggy logic** (`ServerTradingController::getData`, lines 41-47): the `STATUS_SOLD_BUYNOW` case actually matches `(status = SOLD_ACCEPT) OR (status = SOLD_BUYNOW AND expire_date >= today)`, and the `STATUS_EXPIRED` case matches `status = SOLD_BUYNOW AND expire_date < today` — i.e. rows sold via Buy Now with a past expiry date are reported as "Expired" rather than "Sold," and the filter never actually queries on `InvestmentTradeList::STATUS_EXPIRED` (4) or `STATUS_CANCELLED`'s true semantics for buy-now sales. Worth re-deriving the reporting status taxonomy from scratch.
- **No explicit ceiling on `buyNow($params['sold_amount'])`.** The method accepts a caller-supplied `sold_amount` override with only a funds-sufficiency check (`usable_funds < buynow_price`), not a check that `sold_amount` itself is reasonable/equal to `buynow_price` — worth hardening in the rebuild if this override is kept at all (it does not appear to be exercised by any current caller, since no controller calls `buyNow()` with a custom amount).
- **Fixed platform config values (`investment_trade_max_days`, `investment_trade_accept_window`, `investment_trade_minbid_diff`, `investment_trade_sale_fee`, `investment_trade_days_allowed_before_payout`) have no visible defaults anywhere in the repositories' `params.php` files** (searched all `common/backend/frontend/services` config and all `environments/*` variants) — they are read purely via `Yii::app()->params[...]`, implying they are seeded directly in a database-backed params table not included in these repos. Their live values (and therefore the actual minimum-increment, sale-fee %, and day windows in production) could not be confirmed from source and should be pulled from the live DB/config before the rebuild finalizes these rules.
- **Cron failures are swallowed silently.** `CheckAcceptWindowAutoClose()` wraps each `cancelBidding()` call in a bare `catch(Exception $e){}` with no logging — a stuck listing would fail to auto-cancel with no operational visibility.
- **One `InvestmentTradeBid` row per bidder per listing, amount overwritten in place** — `InvestmentTradeBidHistory` is the only full audit trail of bid raises; the "bid" itself is mutated, not append-only, which is a reasonable model but means any UI/report reading `InvestmentTradeBid` directly only ever sees each bidder's latest amount, not their bid history (must join to `InvestmentTradeBidHistory`).
- **`buyNow()` never actually releases the other bidders' fund holds — the release call is dead code.** `buyNow()` calls `$this->releaseAllBiddersOnHoldAmount('buynow', ['sold_to'=>$user])` (`InvestmentTradeList.php:275`). Inside `releaseAllBiddersOnHoldAmount($action, $params)`, the per-bid loop only has two branches: `if ($action == 'seller_cancelled')` and `elseif ($action == 'accepted')` (`InvestmentTradeList.php:460,469`). Since the top-level `$action` passed in is the literal string `'buynow'`, **neither branch matches**, so the loop body — including the inner (unreachable) check `if ($action == 'buynow' or ...)` at line 471, which can never be true because it is nested inside the `elseif ($action == 'accepted')` branch — never executes for a Buy Now sale. Net effect: when a listing sells via Buy Now, every losing bidder's escrowed funds are left permanently on hold and are never released by this code path. This is a real, verifiable fund-lockup bug that must not be carried into the rebuild.
- **`UserFundHold::hold()` is called with the wrong first argument type when a bid is placed.** `UserFundHold::hold($fund, $amount, $type, $ref_id, $ref)` expects a `Fund`-like object (it immediately does `$fund->user_id` and `$fund->addHoldAmount($holdfund)` — see `UserFundHold.php:43-56`), but `InvestmentTradeList::addBid()` calls it as `UserFundHold::hold($bidHistory->user_id, $hold_amount, UserFundHold::TYPE_BID, $userBid->bid_id, [...])` (`InvestmentTradeList.php:215`), passing a plain integer user id instead of a fund object. As written this would fatal-error (`Attempt to read property "user_id" on int` / call to `addHoldAmount()` on an int) the first time a real bid is placed, independent of the missing-`TYPE_BID`-constant issue already noted above.

## Proposed MVP Scope for Revamp

**Must-have (v1):**
- List an eligible investment for resale with `minimum_price` / `buynow_price` (validated `buynow_price > minimum_price`, mirroring `InvestTradeForm`) — this is the entry point to the whole domain and currently has no working implementation to preserve, so it must be built fresh from the model-layer spec above.
- Bidding with server-computed minimum-bid-amount (`last_bid + min_increment`, capped at buy-now price) and incremental fund hold (only the delta between a bidder's old and new bid) — the escrow behavior is the trust foundation of a marketplace and must be exact.
- Buy Now (immediate settlement at asking price) with full release of all other bidders' holds.
- Seller Accept / Seller Cancel / Bidder Cancel actions, each driving the same fund-hold release semantics documented above.
- The three guard-rail checks (`checkMainExceptions`, `bidExceptions`, `buyNowExceptions`) — self-trade prevention, expiry/sold/status checks, and funds-sufficiency — these are the core integrity rules preventing double-spend or invalid trades.
- Investment ownership transfer on sale, including the pro-rated payout split logic (`sold_at_period` / `period_split_amount`) and sale-fee charge — losing this loses real money-movement correctness for a fintech product.
- Daily sellability computation and expiry/accept-window cron jobs — without these, listings never expire or unlock funds, freezing user capital indefinitely.
- Redefine (with the business) the actual eligibility rule currently hidden behind the undefined `sellabilityExceptions()` — this cannot be "ported," it must be re-specified, since the source of truth does not exist in code.
- Admin visibility: listing list/detail view and a status/date-filterable trading report (lower complexity than the transactional core, but needed for support/ops from day one).

**Nice-to-have / defer:**
- Excel export of the trading report — reproducible later from the same report query; not core to the trading mechanic itself.
- Introducer/manager email fan-out on every lifecycle event — valuable for internal visibility but can start with seller/buyer notifications only and layer in the broader distribution list later.
- In-app `Notification::send` duplication of every email — can be consolidated into a single notification-service call in the rebuild rather than ported 1:1.
- Buy-Now with an arbitrary admin/override `sold_amount` — not used by any current caller; only add if a real use case (e.g. negotiated admin-assisted settlement) is confirmed.
- Full historical bid-audit UI surfacing `InvestmentTradeBidHistory` beyond "recent bids" — nice for transparency/dispute resolution but not blocking for launch.
