# Introducers, Referrals & Commission

> **Revamp direction:** The target referral program is one-level and lifetime while active/compliant. Rewards are calculated only from platform commission and must never reduce investor principal or investor returns. Multi-level hierarchies and override commissions below describe legacy behavior and are not approved revamp scope.

## Overview

This domain covers every mechanism by which SeedIn / New Union pays a third party for bringing money or borrowers onto the platform, plus the platform's own fee take on investor returns. Four largely separate systems live under one conceptual roof:

1. **Introducer network** — a 5-level sales hierarchy (Director → Deputy Director → Portfolio Manager → Portfolio Executive → "Agency"/Customer Service Team) of external sales agents (`Introducer` model, backed by `Admin` login accounts), each attached to the investors/borrowers they onboarded (`users.introducer_id`). Introducers sign a DocuSign contract, get a generated code (`I0001`), and (per unused code) are intended to earn personal + cascaded "override" commission on the AUM (assets under management) they and their downline bring in.
2. **IntroducerBonus** — a semi-annual (Jan–Jun / Jul–Dec), volume-tiered bonus table (`introducer_bonus`) paid on top of ordinary commission once an introducer's team crosses AUM thresholds ($250k/$500k/$750k+).
3. **User Referral / "NU Partner" program** — a simple peer-to-peer referral scheme available to any platform user (not just professional introducers). A user invites a friend by email (`UserReferral` / `user_referrals`) or shares an affiliate link (`?ref={user_id}`, captured as `users.parent_id`). Referrers earn points (gamified "referral levels" redeemable for vouchers) and/or a cash commission override on their referred friends' investment returns.
4. **Investor commission-fee calculators** — the platform's own tiered/flat fee formulas (`CommissionLib`) that determine how much of a repayment is taken as a "Risk Management Fee"/commission before computing partner payouts, and a separate tiered monthly/single-payout AUM commission engine (`IntroducerLib` + the (missing) `CommissionDetails` helper) that computes what NU Partners are paid based on their downline's outstanding investment balance.

**Users:**
- **Investor** — the end customer whose repayments/dividends generate the fee base for commissions; can also act as a peer referrer ("NU Partner") and see referral stats/levels/vouchers in the user app.
- **Introducer (external sales agent)** — logs into the Admin/backend app via an `Admin` account tied to `introducer_id`; views their book of customers, sales, and commission/bonus reports; e-signs a DocuSign contract.
- **Admin (SeedIn ops staff)** — creates/edits introducers, sets hierarchy (superior_id), views/exports commission reports company-wide, manages the commission percentage/tier settings.
- **System / cron** — computes AUM-based commission for repayments, resets/fixes commission amounts in bulk, and links referral invites to newly registered accounts.

---

## Current Features & Flows

### Admin dashboard (`seedin-live-admin` / `seedin-live-api-v1-1`, identical backend code in both repos)

**Introducer management** — `IntroducerController` (admin) / `ServerIntroducerController` (api, actual CRUD logic):
- `GET /introducer/index` — list introducers (with keyword/role filter, sortable, paginated).
- `GET /introducer/add`, `POST server/introducer/create` — create introducer + linked `Admin` login (username = generated code `I####`).
- `GET /introducer/edit/{id}`, `POST server/introducer/update` — edit introducer profile, superior, and optionally reset password.
- `GET /introducer/view/{id}` — ajax detail view.
- `DELETE server/introducer/delete/{id}` — delete, blocked if the introducer has subordinates.
- `POST server/introducer/uploadPhoto/{id}` — profile photo upload (jpg/png/gif/jpeg only).
- `GET /introducer/contract/{id}` — download the introducer's signed/unsigned DocuSign contract PDF (or generate a fresh unsigned PDF if none sent yet).
- `POST server/introducer/sendcontract` — kick off DocuSign envelope for the introducer's contract (blocked if a contract already exists).
- `GET /introducer/test/{id}` — debug endpoint, echoes 1/0 for `isSigned()`.
- `GET /introducer/download/{id}` — exports a multi-sheet Excel workbook per introducer: Commission Details, Salesman Bonus, Single Payout Details, Reinvestment Payout Details, New Funds Payout Details.
- `server/introducer/commissionList`, `server/introducer/commissionDetailsList` — paginated `CommissionTransaction` listings (legacy override-commission ledger; see Tech Debt).
- `server/introducer/superiors` — ajax dropdown of eligible superior introducers for a given role.

**Manager/Executive dashboards** — `ManagerController` / `ExecutiveController` (role-scoped views over the same introducer data):
- `GET /manager/view/{id}`, `GET /executive/view/{id}` — dashboard for a Portfolio Manager/Executive (or the logged-in introducer's own book if no id given).
- `GET /manager/downloadCustomerInvestments` — Excel export of an introducer's customer investments with computed commission column (`amount * introducer_customer_commission`).
- `GET /manager/downloadSales` — Excel export of total invested vs. total withdrawn per customer.
- `GET /manager/downloadCustomers` — Excel export of customer list with reinvestment/new-fund/available/dividend totals.
- `GET /manager/downloadManagers` — Excel export of subordinate introducers' AUM + commission roll-up.
- `GET /executive/contract/{id}` — same contract download as introducer.

**Commission (company-wide, "NU Partner" payout) reporting** — `CommissionController`:
- `GET /commission/index`, `GET /commission/summary` — list/summary views.
- `GET /commission/view/{id}` — single `Commission` record detail.
- `GET /commission/details/{id}` — `CommissionMaster` (per-user monthly aggregate) detail, lazily computing/backfilling each underlying `Commission` row via `CommissionLib::percentage()`.
- `GET /commission/download?month&year` — exports "SeedIn Partners Report" Excel: per-NU-Partner breakdown of each referred friend's investment, interest earned, tenor, and commission for the period, plus grand totals. Computes commission inline via `CommissionLib::calculate()` (tier lookup) and `CommissionLib::tier()` (fee ÷ tenor), and **persists** a `Commission` row per line via `Commission::create()` (dedupes on `fund_transaction_id`).

**CLI (`CommissionCommand`, identical in both repos' `cbase/commands/`)**:
- `commission reset` — recompute `amount` for every pending percentage-type `Commission` from the current plan/tenor via `CommissionLib::percentage()`.
- `commission percentagefix` — recompute already-**paid** percentage commissions; if the recomputed amount differs, stashes the old value in `original_amount` and overwrites `amount` (a backdated correction tool).

### API (`seedin-live-api-v1-1`) — user-facing referral endpoints

`ServiceReferralController` (mounted under `/services/Referral/*`, consumed by the user app's server-proxy controller):
- `GET Referral/Stats` — summary card: total referred, total approved, points earned, lifetime commission (`$user->totalCommission()`), and the user's affiliate link (`.../register?ref={user_id}`).
- `POST Referral/List` — paginated list of the user's `introducer_members` (both emailed referrals and affiliate-link sign-ups), each with type (Referral/Affiliate), status (Tagged / Not tag yet / Not a member yet / "User is tagged to X"), accepted/pending flags.
- `POST Referral/Activities` — month-by-month activity feed (referred/registered/pending/approved counts, invested amount, repayment amount, commission earned) for every calendar month since the user joined.
- `POST Referral/Edit` — change the email address of a pending referral invite.
- `POST Referral/Reinvite` — resend the invite email; logs to Telegram.
- `POST Referral/Add` — create a new email referral invite; logs to Telegram.
- `POST Referral/Delete` — delete a still-pending referral invite (only own, only pending); logs to Telegram.
- `GET Referral/LevelStats` — gamified referral-level engine: current level (1–3), progress %, points balance, per-level referral requirements/progress, and the list of redeemable vouchers (interest boosts, "red packets", RMF discounts, consumables) unlocked at the user's level.

`NUPartnerCommand` (cron console command, api repo): backfills `users.parent_id` and `user_referrals.child_id` by matching pending referral invites' emails against newly registered users — the mechanism that "activates" an email referral once the invitee signs up.

### User app (`seedin-live-user`)

`ServerUserReferralController` — thin server-side proxy that calls the API's `Referral/*` service endpoints and renders Razor `.tpl` partials:
- `index` / `list` → `/referral/_ajax_list` (referral list + status).
- `level` → `/referral/_ajax_level_progress` (level/points/voucher UI, `_voucher_level_store.tpl`).
- `edit`, `add`, `invite` (reinvite), `delete` → thin POST passthroughs.
- `activity` → `/referral/_ajax_activities` (monthly activity feed).

`CommissionRateSetupForm` (`common/forms/`) — an admin-side settings form (fields: `single_payout`, `re_Invested`, `below_100K`, `least_100K`, `least_200K`, `least_300K`, `least_250K`, `least_500K`, `least_750K`) used to edit the monthly-payout commission-rate tiers and the semi-annual bonus tiers from one screen; all fields required.

---

## Business Logic & Computations

### 1. Introducer hierarchy commission rates (personal + override) — **`Introducer.php`**

Roles and order (`Introducer::rolesLevel()`, `admin`/`api` `common/models/Introducer.php:58-96`):
`Director(0) → Agency(1, "Customer Service Team") → Deputy Director(1) → Manager(2) → Executive(3)`
(NB: `rolesLevel()`'s array order — Director, Agency, Deputy Director, Manager, Executive — is used to derive "superior" via `superiorRole()`/`allSuperiorRoles()` by walking the array index, **not** the `role_id` constant values; Agency sits between Director and Deputy Director in this ordering, which looks like a bug — see Tech Debt.)

Rate lookup — `getCommisionRate()` (`Introducer.php:232-251`):
```php
$rates = json_decode(str_replace('%', '', Setting::get('commision_'. $this->getShorRoletKey())));
$data['personal'] = trim($rates[0])/100;
$data['team'][$key] = trim($value)/100;   // per-subordinate-role override %, from $rates[1]
```
Rates are DB-configured JSON per role (`Setting` key `commision_director`, `commision_deputy_director`, `commision_portfolio_manager`, `commision_portfolio_executive`), shaped as `[personal_rate, {subordinate_role_key: override_rate, ...}]`.

Commission generation — `makeCommissions($plan)` (`Introducer.php:269-297`):
```php
public function makeCommissions($plan) {
    $rate = $this->getCommisionRate();
    $this->makeCommision($plan, $rate['personal']);              // personal commission = personal_rate * plan.amount
    foreach ($this->mySuperiors() as $superior) {
        $superior->makeCommisionFromTeam($plan, $this);          // cascade override up the chain
    }
}
public function makeCommision($plan, $rate) {
    $commision = $rate * $plan->amount;
    Commission::create($this->introducer_id, $plan, $commision, $rate*100);
}
public function makeCommisionFromTeam($plan, $team) {
    $rate = $this->getCommisionRateFromTeam($team->getShorRoletKey());
    if (!empty($rate)) {
        Commission::create($this->introducer_id, $plan, $rate * $plan->amount, $rate*100, $team->introducer_id);
    }
}
```
Every superior in the chain (walked via `mySuperiors()`, following `superior_id` up to 0) receives an override computed from **their own** configured override-rate-for-that-subordinate-role, applied to the **same** `plan->amount` — i.e., a flat-amount cascade, not a diminishing residual. **This entire code path (`makeCommissions`/`makeCommision`/`makeCommisionFromTeam`) has no callers anywhere in either repo — it is dead/unused code**, and its call to `Commission::create($introducer_id, $plan, $amount, $rate, $superiorId)` (5 positional args) does not match the actual `Commission::create($data)` signature (single associative array) in `common/models/Commission.php:86-109` — it would fatal-error if ever invoked. Must be re-derived/rebuilt from spec, not ported as-is.

### 2. IntroducerBonus — semi-annual volume tier bonus — **`IntroducerBonus.php`**

```php
public function getPercentage($amount, $term, $year) {
    if ($amount >= 250000 && $amount < 500000) $field = "at_least_250k";
    elseif ($amount >= 500000 && $amount < 750000) $field = "at_least_500k";
    elseif ($amount >= 750000) $field = "at_least_750k";
    // else: no bonus (0)
    $result = IntroducerBonus::model()->find([
        'condition' => 'year >= :year AND term >= :term', ... 'order' => 'id DESC', 'limit' => 1
    ]);
    return $result->{$field};
}
```
`term` = 1 (Jan–Jun) or 2 (Jul–Dec). Bonus amount = `Formula::getBonus(Formula::BONUS, $amount) = $amount * (percentage/100)` (`Formula.php:47-56`), where `percentage` comes from `IntroducerBonus::getPercentage()`. Called from `IntroducerLib::getSalesBonus()` + `IntroducerController::actionDownload()` — half-year totals are built by summing `fund_transactions` of type 0 (top-up), 1 (withdrawal, negated), and 6 (fee, negated) per month, bucketed Jan–Jun / Jul–Dec, only counting transactions after `SALES_BONUS_START_DATE` (`2016-04-25` prod / `2016-04-01` qa-dev, a hardcoded `define()` per environment) and only for `dashboard_type = 1` (investor) users.

There is also an unused/legacy `getHalfYearBonus()` in `IntroducerLib.php:478-523` that instead reads AUM (`loan_lend_repayment_plans.amount`) snapshotted only in months 01/06/07/12, using `Setting`-driven `commision_target`/`percentage` (0.5% mentioned in a comment) rather than `IntroducerBonus`/`Formula` — a second, apparently superseded bonus formula living side-by-side with the one actually wired into the Excel export.

### 3. Investor commission-fee calculators — **`CommissionLib.php`** (identical in `admin` and `api` repos)

**(a) RMF-tier rate lookup** — `calculate($amount)` (on absolute Risk Management Fee amount):
```php
if ($amount >= 1000000) $rate = .55;
elseif ($amount >= 500000) $rate = .50;
elseif ($amount >= 300000) $rate = .45;
elseif ($amount >= 100000) $rate = .40;
elseif ($amount >= 50000)  $rate = .35;
else $rate = .30;
$amount = $rate * $amount;
```
Returns `['rate' => ..., 'amount' => ...]`. Used in `CommissionController::actionDownload()` against `abs($totalRmf)` but the computed `$commission['amount']` is not actually used for payout — only `$commission['rate']` is stored on the `Commission` row; the actual payout amount comes from `tier()` below. (Dead branch — see Tech Debt.)

**(b) Flat-fee-per-tenor tier table** — `tier(LoanLendRepaymentPlan $plan)`:
A fixed lookup table of investment-amount bands → flat SGD fee, divided by loan tenor (months) and rounded to 2 dp:
| Amount band | Flat fee |
|---|---|
| ≤ 99 | 0 |
| 100–999 | 10 |
| 1,000–4,999 | 30 |
| 5,000–9,999 | 75 |
| 10,000–19,999 | 150 |
| 20,000–39,999 | 300 |
| 40,000–59,999 | 500 |
| 60,000–79,999 | 700 |
| 80,000–99,999 | 900 |
| 100,000–119,999 | 1,100 |
| 120,000–149,999 | 1,300 |
| 150,000–179,999 | 1,600 |
| 180,000–209,999 | 1,900 |
| 210,000–239,999 | 2,200 |
| 240,000–269,999 | 2,500 |
| 270,000–299,999 | 2,800 |
| 300,000–349,999 | 3,200 |
| 350,000–399,999 | 3,700 |
| 400,000–449,999 | 4,200 |
| 450,000–499,999 | 4,700 |
| 500,000–599,999 | 5,500 |
| 600,000–699,999 | 6,500 |
| 700,000–799,999 | 7,500 |
| 800,000–899,999 | 8,500 |
| 900,000–999,999 | 9,500 |
| ≥ 1,000,000 | 10,000 |

`return round($fee / $tenor, 2)`. Used as `TYPE_TIER` commission (legacy) and in the Excel "SeedIn Partners Report" export.

**(c) Percentage-of-monthly-amortized-amount** — `percentage(LoanLendRepaymentPlan $plan)`:
```php
return round($plan->amount / $plan->borrowlisting->loan_tenor * Yii::app()->params['commission_rate'], 2);
```
This is the **current, live** commission formula (`TYPE_PERCENTAGE`) computed in `CommissionMaster::details()` and re-applied by the `commission reset` / `commission percentagefix` CLI commands. `Yii::app()->params['commission_rate']` is not defined in any environment `params.php` file found in either repo — its value could not be traced statically (see Tech Debt).

### 4. NU-Partner ("Referral") monthly commission engine — **`CommissionMaster::details()`** (`admin`/`api` `common/models/CommissionMaster.php:33-95`)

For each parent (referrer)'s calendar month, pulls all `FundTransaction::TYPE_INVESTOR_DIVIDENDS` rows belonging to their referred children (`user.parent_id = referrer.user_id`) and, for each, lazily creates/updates a `Commission` row using `CommissionLib::percentage($plan)` — i.e. every dividend a referred friend earns generates a commission line for the referrer, computed off the friend's investment plan (amount ÷ tenor × global `commission_rate`), **not** off the dividend amount itself. `isTier()` rows (legacy) are silently upgraded to `TYPE_PERCENTAGE` in place when re-touched.

### 5. AUM-tiered monthly/single-payout commission for the Introducer ledger — **`IntroducerLib.php`**

This is the most complex logic in the domain, driving the `manager`/`executive`/`introducer` Excel exports (`getCommission`, `getCommissionSummary`, `getCommissionSummaryDetailed`, `getTotalMonthlyPayoutCommission`, `getTotalSinglePayoutCommission`, `getMonthlyPayoutCommission`, `commissionDetails`). It reads from three tables not modeled as PHP ActiveRecord classes in the repos read (`commission_details`, `commission_rate`, joined against `loan_lend_repayment_plans`/`loan_borrow_listings`):

- **Single Payout** commission type (`LoanBorrowListing::COMMISSION_TYPE_SINGLE_PAYOUT`): one-time annualized rate applied at investment time —
  `single_payout_commission = invested_amount * (single_payout_rate/100 / 12) * loan_tenor_months`.
  **Pro-ration rule**: if the investment was booked on-or-after day 28 of the month, the "current month" is rolled to the 1st of next month (handles month-end edge case for day-count bucketing). If `days_diff >= 30` the full amount is taken; otherwise it's pro-rated: `commission = (investment_days / total_days) * single_payout_commission`, where `total_days = tenor_months * 30` (a 30-day-month day-count convention) and `investment_days = total_days - (30 - days_diff)`.
- **Monthly Payout** commission type (`COMMISSION_TYPE_MONTHLY_PAYOUT`): a tiered rate looked up via `CommissionDetails::getMonthlyCommissionRate($total_aum, $fund_src)` against the introducer's **current month total AUM** (`CommissionDetails::getCurrentMonthTotalAUM(...)`, itself split by `fund_src` = Reinvestment vs. Top-up/new funds — `CommissionDetails::REINVESTMENT` / `CommissionDetails::TOPUP` constants). Per the inline comment in `IntroducerLib.php:105-127`, the intended tier bands are:
  - New Investment: Tier 1 < $100k → 0.20%/mo · Tier 2 < $100k(next band) → 0.25%/mo · Tier 3 < $200k → 0.28%/mo · Tier 4 < $300k → 0.32%/mo (documented as a comment; the live band edges/values are DB-configured, matching the `CommissionRateSetupForm` fields `below_100K`/`least_100K`/`least_200K`/`least_300K`).
  - Commission = `AUM * rate/100`, pro-rated by `days_diff/30` if the elapsed days in the commission-window are under 30 (same 30-day day-count convention as single payout).
- **`CommissionDetails` is referenced everywhere in this calculation chain (`REINVESTMENT`, `TOPUP` constants; `getMonthlyCommissionRate()`, `getCurrentMonthTotalAUM()`, `getTableCommissionRate()` static methods) but no `CommissionDetails` class/file exists anywhere in either the `admin` or `api` repository** — see Tech Debt. Its exact tier thresholds and current-month-AUM aggregation logic could not be recovered from source and must be reconstructed from the DB `commission_rate`/`commission_details` table contents and/or DBA/ops knowledge before rebuild.

### 6. Legacy monthly-amortized commission payout engine — **`cron/protected/lib/CommissionLib.php`**

A second, differently-shaped `CommissionLib::run()` (namespace-colliding class name with the "real" one in `common/lib/`) iterates `Commission` rows with `status = Commission::STATUS_ONGOING`, and for every elapsed month since `created_at` not yet applied (`last_period_applied`), adds `monthly_amount` to `current_amount`, writes a `CommissionTransaction` row, and marks the commission `STATUS_COMPLETED` once `last_period_applied >= total_periods`. **Neither `Commission::STATUS_ONGOING`/`STATUS_COMPLETED` nor a `CommissionTransaction` class exist in the current `Commission` model or anywhere in the codebase** — this appears to be dead/orphaned code from an earlier commission design (amortized-installment payout) that predates the current `STATUS_PENDING`/`STATUS_PAID` + `TYPE_TIER`/`TYPE_PERCENTAGE` model. The `cron/protected/commands/CommissionCommand.php::run()` that would invoke this lib is an empty stub. Not safe to port without clarifying with the business whether this payout style is still intended.

### 7. Referral bonus (simple flat-rate) — **`UserReferral::updateReferalBonus()`**

```php
$refbonus = Yii::app()->params['referral_bonus'];   // = 10 (SGD/points) per environment configs
$referral->status = STATUS_APPROVED;
$referral->referral_bonus = number_format($refbonus, 2, '.', '');
```
Applied by email match when a referred friend's status flips to approved. Withdrawal of accumulated referral bonus (`withdrawStatus()`) sums `referral_bonus` for a `request_id`, then calls `$user->fund()->payReferralBonus($total, ['request_id' => ...])` and marks rows `STATUS_WITHDRAW_APPROVED`/`REJECTED`. (Withdraw-flow constants are explicitly commented `// Unused` in `UserReferral.php:8-11` — confirms this manual-withdrawal path is not live; bonus is presumably now merged straight into `fund_transactions` or the points system instead.)

### 8. Referral level / points gamification — `ServiceReferralController::getLevelStats()` + `ReferralSummary`

- `UserReferral::getLevelUpgradeRequirements()` reads a DB `Setting` (`referral_level_requiments`, JSON) mapping level → `{referrals: N}` required-referral-count, and totals them for "overall progress".
- `ReferralSummary::checkLevel()` compares the user's `current_level`'s accumulated `referral_status[level].referrals` against the requirement and increments `current_level` (capped at 3), appending a `level_up_history` audit entry into the JSON `data` blob (no dedicated history table).
- `current_progress = (referral_approved / total_required_across_all_levels) * 100`.
- Per-level progress: `(referrals_at_level / required_at_level) * 100`, clamped to 100 if over 100% or if the user is already past that level.
- Unlocked vouchers are filtered from `Promotion::availableVoucherPoints(['is_level' => true])` by `activate_on_level` (2 or 3) and by voucher type (interest-boost, red packet, RMF discount, consumable) — reward catalog lives in the `Promotion`/`UserVoucher` domain, only referenced here.

### 9. Affiliate vs. email-referral distinction — DB view, not application logic

`user_referrals` (email invites) and `users.parent_id` (affiliate-link sign-ups) are unioned into a `introducer_members_all` VIEW, then de-duplicated per `(user_id, email_address)` into the `introducer_members` VIEW (`migrations/m180323_024943_referral_v2.php`) — the `IntroducerMember` AR model reads this view, exposing `TYPE_REFERRAL` (1) vs `TYPE_AFFILIATE` (2). This is the single source read by the "Referral/List" and "Referral/Activities" API endpoints, meaning **the referral list a user sees blends two structurally different acquisition paths transparently.**

---

## Data Model

| Table / View | Purpose | Key columns (from AR models / SQL usage) |
|---|---|---|
| `introducers` | Sales-hierarchy agents | `introducer_id` (PK), `code` (`I0001`…), `name`, `email`, `address`, `bank_account`, `bank_name`, `branch_code`, `mobile_no`, `role_id` (0–4), `superior_id` (self-FK), `photo`, `doc_id` (FK → `docsigns`), `created_at` |
| `admins` | Login credentials for introducers | `introducer_id` (FK), `username` (= introducer code), `role_id` |
| `users` | Investors/borrowers | `introducer_id` (FK → owning sales agent), `my_introducer_id` (used for `user` HAS_ONE relation lookup — distinct from `introducer_id`, see Tech Debt), `parent_id` (FK → referrer `user_id`, affiliate-link attribution), `dashboard_type` |
| `introducer_bonus` | Semi-annual volume bonus tiers | `id`, `year`, `term` (1/2), `at_least_250k`, `at_least_500k`, `at_least_750k` (percentages), `status` (ACTIVE/INACTIVE) |
| `commisson_payments` (AR: `Commission`) | NU-Partner / RMF-based commission ledger | `commission_id` (PK), `user_id`, `month`, `year`, `created_at`, `created_by`, `status` (0 Pending/1 Paid), `amount`, `rate`, `rmf`, `invested`, `fund_transaction_id`, `type` (1 Tier/2 Percentage, added `m191101`), `percent`, `repayment_plan_id`, `original_amount` (added `m191106`, correction audit trail) |
| `commission_txn_master` (AR: `CommissionMaster`) | Per-user-per-month commission aggregate/anchor | `fund_transaction_id` (PK), `user_id`, `month`, `year` |
| `commission_details` | Introducer-ledger commission line items (no AR model found) | referenced columns: `commission_detail_id`, `repayment_plan_id`, `fund_src`, `amount`, `single_payout_rate`, `reinvestment_rate`, `new_fund_rate_1..4` |
| `commission_rate` | Introducer-ledger applied rate/period snapshot per repayment (no AR model found) | referenced columns: `repayment_plan_id`, `commission_detail_id`, `repayment_date`, `commission`, `commission_rate`, `period` |
| `formula_table` (AR: `Formula`) | Generic amount→percentage lookup (bonus & legacy commission) | `id`, `category` (1 Bonus/2 Commission), `amount` (threshold), `percentage`, `status` ('y'/'n') |
| `settings` (AR: `Setting`) | DB-driven config key/value | keys used here: `commision_director`, `commision_deputy_director`, `commision_portfolio_manager`, `commision_portfolio_executive` (JSON `[personal%, {role:override%}]`), `introducer_bonus_target`, `introducer_bonus_percentage`, `referral_level_requiments` (JSON), `points_refer_a_friend` |
| `user_referrals` (AR: `UserReferral`) | Email-invite referral records | `referral_id` (PK), `user_id` (referrer), `email_address`, `referral_key`, `status` (0 Pending/1 Approved; 2–4 Withdraw states marked unused), `child_id` (FK → `users`, set once invitee registers), `original_user_id`, `referral_bonus`, `is_accepted`, `is_withdrawn`, `request_id`, `created_at` |
| `introducer_members_all` (VIEW) | Union of email referrals + affiliate sign-ups | `referral_id`, `created_at`, `parent_id`, `email_address`, `user_id`, `type` (1/2), `is_accepted`, `status` |
| `introducer_members` (VIEW, AR: `IntroducerMember`) | De-duplicated member list per referrer | same columns as above, grouped by `(user_id, email_address)`; PK `referral_id` |
| `referral_summary` (AR: `ReferralSummary`) | Per-user referral-level/points state | `id`, `created_at`, `user_id`, `current_level` (1–3), `total_approved`, `points_earned`, `data` (JSON: `referral_status[level] = {referrals, points_earned}`, `level_up_history[]`) |
| `docsigns` (AR: `DocSign`) | DocuSign envelope tracking, shared with investor/borrower contracts | `type` (4 = `TYPE_INTRODUCER_CONTRACT`), `status` (1 Pending/2 Completed/3 Notified), `envelopeID` |

---

## Cron / Automation Dependencies

- **`NUPartnerCommand`** (`seedin-live-api-v1-1/newunion/cron/protected/commands/NUPartnerCommand.php`) — iterates all `UserReferral` rows, matches `email_address` against a registered `User`, and back-fills `users.parent_id` / `user_referrals.child_id`. This is what "activates" a pending email referral once the invited friend actually signs up; without this job, `postAdd()`-created invites never link to real accounts.
- **`cron/protected/lib/CommissionLib::run()`** — intended to be the recurring job that pays out amortized `STATUS_ONGOING` `Commission` records monthly, but its invoking `cron/protected/commands/CommissionCommand.php::run()` is an empty stub and the referenced `Commission::STATUS_ONGOING`/`CommissionTransaction` do not exist in the current schema/model — **effectively dead/non-functional as shipped.**
- **`commission reset` / `commission percentagefix`** (`cbase/commands/CommissionCommand.php`) — manually-triggered (not seen scheduled anywhere) bulk recompute/correction commands for percentage-type commissions; likely run ad hoc by ops after a rate or tenor change, not on a timer.
- No scheduled job was found that computes/persists the `IntroducerBonus` semi-annual bonus or the `CommissionDetails`-driven monthly AUM-tier commission — both appear to be computed **on-demand** at Excel-export time (`IntroducerController::actionDownload`, `ManagerController::actionDownload*`), not pre-materialized by a batch job.

---

## Integrations

- **DocuSign** (`DocuSignLib`) — introducer contract e-signature: `Introducer::sendDocSign()` renders a PDF via `RazorViewRenderer`/`PdfLib` (mPDF), uploads it as a DocuSign envelope with one signer tab, and stores the resulting `DocSign` record; `getContractFile()` downloads/merges the completed envelope's documents into a cached PDF (`dir_doc_introducer_signed` / `dir_doc_introducer_unsigned` directories) via `PdfMergerLib`.
- **Telegram** (`Telegram::log(...)`) — fires on referral invite create/reinvite/delete actions (`ServiceReferralController`) for ops visibility; no other channel (SMS/email) integration is invoked directly in this domain beyond the standard `EmailLib::ReferFriend()` invite email.
- **PHPExcel** (`PhpExcelLib`/`PHPExcel_IOFactory`) — every commission/sales/customer report in the Admin dashboard is generated as an `.xlsx` export; there is no on-screen equivalent for most of these (see Tech Debt: reporting logic is duplicated between screen and Excel-export code paths in places).

---

## Tech Debt / Risks Observed

- **`CommissionDetails` class does not exist** anywhere in either the `admin` or `api-v1-1` repository (verified via full-repo `grep`), yet it is called extensively — `CommissionDetails::REINVESTMENT`, `::TOPUP`, `::getMonthlyCommissionRate()`, `::getCurrentMonthTotalAUM()`, `::getTableCommissionRate()` — from `IntroducerLib.php`, `IntroducerController.php`, `ServerManagerController.php`, `ServerQaController.php`, and several `.tpl` views. Every commission report/export that depends on it (`IntroducerController::actionDownload`, `IntroducerLib::getCommissionSummary*`) would fatal-error (`Class 'CommissionDetails' not found`) if actually executed against current source — either the class lives outside these two repos, or this functionality is currently broken in production.
- **`Introducer::makeCommissions()` / `makeCommision()` / `makeCommisionFromTeam()` are dead code** — the personal + cascaded-override hierarchy commission engine described in the class's own inline comments has zero callers anywhere in either repo, and its call to `Commission::create()` uses a 5-positional-argument signature that doesn't match the actual `Commission::create($data)` (single associative array) method — it would fatal if invoked. The hierarchy commission concept exists only as unreachable code plus DB `Setting` scaffolding (`commision_director` etc.); it is unclear whether it ever ran in production or was superseded entirely by the AUM-tier (`IntroducerLib`/`CommissionDetails`) approach.
- **A second, incompatible `Commission` payout model is referenced but not implemented**: `cron/protected/lib/CommissionLib::run()` uses `Commission::STATUS_ONGOING`/`STATUS_COMPLETED` and a `CommissionTransaction` AR class, neither of which exist against the current `Commission` model (`STATUS_PENDING`/`STATUS_PAID` only) or codebase. Its cron entry point (`cron/protected/commands/CommissionCommand.php`) is an empty stub — this looks like an abandoned/superseded amortized-payout design left in the tree.
- **`Yii::app()->params['commission_rate']` and `['introducer_customer_commission']`** — the two params driving the *current* live percentage-commission formula (`CommissionLib::percentage()`) and manager-dashboard commission columns — are not defined in any `params.php` found across the `dev`/`qa`/`prod` environment configs in either repo. Their actual values could not be verified statically; if truly undefined at runtime, `commission_rate` would evaluate to `null`/0 (silently zeroing all percentage commissions).
- **`Introducer::rolesLevel()` ordering looks incorrect**: `[Director, Agency, Deputy Director, Manager, Executive]` — Agency (role_id 4, "Customer Service Team") is placed second, between Director and Deputy Director, in the array used to derive "superior of a role" (`superiorRole()`) and "all superior roles" (`allSuperiorRoles()`). This would make Agency's superior resolve to Director and Deputy Director's superior resolve to Agency, which contradicts the documented hierarchy (Director→Deputy→Manager→Executive→Agency) and would misroute any override commission built on top of it.
- **`Introducer::getSalesByMonth()`** references an undefined variable `$type` in its `CDbCriteria` condition (`Introducer.php:202-219`) — would throw an "undefined variable" warning/produce a malformed SQL condition (`type = ''`) if called; no caller found in either repo (likely dead as well).
- **Hardcoded date constant**: `SALES_BONUS_START_DATE` is a per-environment `define()` (`2016-04-25` prod, `2016-04-01` qa/dev) baked into `settings.php` rather than a DB setting — any future change requires a code deploy.
- **Hardcoded tier tables**: both the RMF-rate table (`CommissionLib::calculate`) and the flat-fee tenor table (`CommissionLib::tier`) are literal PHP arrays/if-chains, not DB-configurable, despite the *monthly AUM* tier table living in the DB (`CommissionRateSetupForm`) — inconsistent configurability across the different commission calculators in the same domain.
- **Massive code duplication**: `IntroducerController::actionDownload()` in `admin` and `api-v1-1` are byte-for-byte identical (1,026 lines each), as are `Commission.php`, `CommissionMaster.php`, `CommissionLib.php`, `IntroducerLib.php`, `Introducer.php`, `IntroducerBonus.php`, `IntroducerMember.php`, `UserReferral.php`, `ReferralSummary.php`, and `ManagerController.php` — the two repos ship a fully duplicated copy of this entire domain's backend logic with no shared package, meaning every fix/bug must be manually applied twice today.
- **Excel-export-only reporting**: several commission summaries (per-introducer commission history, salesman bonus, single/monthly payout detail) exist only as generated `.xlsx` downloads with heavily inlined, repeated day-count/pro-ration logic (the "investment day ≥ 28 → roll to next month" adjustment and the 30-day pro-ration block appear copy-pasted 4+ times within `IntroducerLib.php` and `IntroducerController.php` alone) — no single canonical function computes "commission for this repayment plan in this month."
- **`UserReferral` withdraw-flow constants are explicitly marked unused** (`// Unused` comment on `STATUS_WITHDRAW_PENDING/APPROVED/REJECTED`) yet `withdrawStatus()` still implements and references them — dead-but-not-removed code path.
- **String-concatenated SQL throughout `IntroducerLib.php`** (values like `$id`, `$year`, `$month`, `$condition` interpolated directly via `sprintf`/string concat into raw `Yii::app()->db->createCommand($qry)`) — no parameter binding in the vast majority of these report queries, an injection-risk pattern if any of these condition strings are ever built from user input upstream.
- **`getShorRoletKey()`** (typo preserved from source, `Introducer.php:98`) has no mapping entry for `ROLE_AGENCY` — `rolesShortKey()` only covers Director/Deputy/Manager/Executive, so an Agency-role introducer's `getCommisionRate()`/`getShorRoletKey()` calls would look up a non-existent `Setting` key and silently return no rate.

---

## Proposed MVP Scope for Revamp

**Must-have (v1):**
- **Introducer CRUD + hierarchy** (Director/Deputy/Manager/Executive/Agency, superior linkage, role-based dashboard scoping) — the org structure is foundational; nothing else in the domain functions without it.
- **Investor tiered/flat commission-fee calculators** (`CommissionLib::tier()` and `::percentage()`) — this is the platform's actual revenue-take mechanism on every repayment; must be preserved exactly (the flat-fee tenor table and the percentage-of-monthly-amortized formula), with the currently-undiscoverable `commission_rate` param resolved with the business before cutover.
- **NU-Partner / peer referral core loop**: affiliate link + email invite → `introducer_members`-equivalent unified list → `Referral/Stats`/`Referral/List`/`Referral/Activities` — this is a live user-facing feature with real UI in the user app; re-platform the union-of-two-sources model as an explicit, first-class table rather than a SQL view for clarity/testability.
- **Commission ledger with Pending/Paid states and correction trail** (`Commission`/`CommissionMaster`, `original_amount` audit field, the `reset`/`percentagefix` admin tools) — needed for finance reconciliation and to preserve the auditability the current `original_amount` column provides.
- **Introducer contract e-signature** (DocuSign integration) — a compliance/legal requirement for onboarding paid sales agents, not optional.
- **AUM-tiered monthly/single-payout introducer commission engine** — this is clearly the *actual* commission mechanism in current production use (all the Excel exports key off it), but it depends on the missing `CommissionDetails` class. Before rebuilding, the exact tier bands/current-month-AUM logic must be recovered from the live `commission_rate`/`commission_details` table contents or ops knowledge, since the source alone under-specifies it.

**Nice-to-have / defer:**
- **Personal + cascaded hierarchy override commissions** (`makeCommissions`/`makeCommision`/`makeCommisionFromTeam`) — confirmed dead/unreachable code with a broken method signature; only rebuild if the business confirms this override model (as opposed to the AUM-tier model actually in use) is still desired.
- **Legacy amortized/installment commission payout engine** (`cron/protected/lib/CommissionLib::run()`, `CommissionTransaction`, `STATUS_ONGOING`) — references non-existent classes/constants and its cron entrypoint is an empty stub; treat as historical/abandoned unless finance confirms it's still needed.
- **Referral gamification (levels, points, voucher store)** — real and used, but a UX/marketing layer on top of the core referral mechanism; can ship after the core invite/attribution/commission loop, and its reward catalog belongs more naturally to the Promotions domain.
- **Semi-annual `IntroducerBonus` volume bonus** — real but low-frequency (computed twice a year, only surfaced via Excel export today); fine to defer past MVP as a follow-on payout feature once the core commission ledger is solid.
- **Legacy `Formula`-table generic bonus/commission lookup and `IntroducerLib::getHalfYearBonus()`** — appears superseded by `IntroducerBonus`/the AUM-tier engine respectively; do not port unless a concrete still-active caller is found in the live system.
- **Per-introducer/manager Excel-only reports** (customer investments, sales, customer list, manager list downloads) — valuable for ops but reproducible on top of whatever new reporting/BI layer the rebuild adopts; not core transactional logic.
