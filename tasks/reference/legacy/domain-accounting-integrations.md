# Accounting Integrations (Xero & QuickBooks)

> **Scope note:** This document covers external bookkeeping integrations. It does not replace the still-required Philippine accounting, tax, general-ledger, and statutory-reporting specification.

## Overview

This domain provides one-way and two-way data pulls from **Xero** and **QuickBooks Online** into the SeedIn/New Union platform. It is used for two distinct purposes that happen to share the same OAuth/data-pull plumbing:

1. **Borrower onboarding / credit assessment automation** — a fundseeker (borrower) can connect their Xero or QuickBooks account during the **Credit Rating** application flow (`seedin-live-user`, `creditrating` controller/views) or the standalone **Financial Analysis** flow (`ServerFinancialAnalysisController`) so that the platform auto-fills Profit & Loss and Balance Sheet figures, and auto-pledges outstanding sales invoices as loan **collateral**, instead of the borrower typing the numbers in by hand.
2. **Bulk bookkeeping data mirror** — a much larger, mostly-dormant background sync (`XeroJobLib` / `QuickBooksJobLib`, run via `cron/protected/commands/trash/XeroCommand.php` and `QuickbooksCommand.php`) that pulls almost every resource type Xero/QuickBooks expose (contacts, invoices, bank transactions, bank transfers, payments, credit notes, journals, items, tax rates, employees, and a long list of financial reports) into local `xero_data` / `quickbooks_data` tables, keyed by "credit rating" record. This looks like it was built to give admins/underwriters a fuller picture of an applicant's books, but there is no visible admin UI that renders this data (see Tech Debt).

**Who uses it:**
- **Borrower (fundseeker)** — initiates the OAuth connection from the User app during credit-rating application, seek-funds "pledge collateral" step, or financial-analysis form; sees pulled invoices and can choose to pledge them.
- **System/cron (automated)** — `CronJob` records of type `dl_xero_data` / `dl_quickbooks_data` drive a multi-stage background job graph that paginates through the full account and downloads invoice PDFs.
- **Admin** — no dedicated Xero/QuickBooks admin screens were found; the Admin repo only hosts the shared library/model code and the `ServiceXeroController` / `ServiceQuickBooksController` / `ServiceCreditRatingController` API endpoints that the User app's frontend calls through the internal service layer.
- **Investor / Introducer** — not involved in this domain.

Both integrations use the **deprecated OAuth 1.0a** flow (Xero's own `XeroOAuth` extension library, and PHP's `OAuth` PECL extension for QuickBooks via the Intuit `QuickBooks-PHP` SDK's `QuickBooks_IPP` OAuth mode). Xero itself deprecated OAuth1 in 2019 in favor of OAuth2, meaning this integration is very likely non-functional against the live Xero API today even though the code is intact.

## Current Features & Flows

### Admin repo (`seedin-live-admin`) — Services layer (internal API called by User app)

| Endpoint / Method | Description |
|---|---|
| `ServiceXeroController::postStoredAuth` | Persists the OAuth1 access token/secret returned from Xero's callback into `XeroAuth`; if `action == 'creditrating'`, registers a background sync job (`XeroData::RegCronJob`). |
| `ServiceQuickBooksController::postStoredAuth` | Persists OAuth1 request/access tokens + QuickBooks `realmId` (company id) into `QuickBooksAuth`; if `action == 'creditrating'`, registers a background sync job (`QuickBooksData::RegCronJob`). |
| `ServiceCreditRatingController::postGrabXeroData` | Core "pull-on-demand" endpoint used during the Credit Rating application: logs into Xero (`getUsers`), pulls invoices due in the next 15 days with status `AUTHORISED`/currency `SGD`, pulls organisation details, pulls last-2-years PNL & Balance Sheet, persists raw responses to `xero_data`, converts invoices into `Collateral` records, and maps PNL/Balance-Sheet key figures into the borrower's `FinancialStatementMaster` (Financial A/B statements) and `CreditRating.company_*` fields. |
| `ServiceCreditRatingController::postGrabQuickBooksData` | Same as above but for QuickBooks: pulls `CompanyInfo` (to fill company name/address/phone), pulls PNL & Balance Sheet for last 2 years via QuickBooks Reports API, pulls invoices due within 15 days (currency filter checks `USD`, see Tech Debt), and maps figures into `FinancialStatementMaster` via `formatQBResponse`. |

### API repo (`seedin-live-api-v1-1`) — mirrors the Admin service layer

- `ServiceXeroController::postStoredAuth` — identical logic to the Admin repo's controller (stores `XeroAuth`, triggers cron registration).
- `ServiceQuickBooksController::postStoredAuth` — identical logic to the Admin repo's controller (stores `QuickBooksAuth`, triggers cron registration).
- `ServiceCreditRatingController::postGrabXeroData` / `postGrabQuickBooksData` — same borrower financial-data-pull logic as the Admin repo (appears to be a duplicated/forked copy of the same controller, not a distinct feature).
- `XeroLib` / `QuickBookLib` — shared OAuth1 client wrappers (see Business Logic section) — near-identical copies exist in all three repos (admin, api, user).

### User repo (`seedin-live-user`) — Frontend-facing OAuth handshake + Financial Analysis pull

| Endpoint / Action | Description |
|---|---|
| `ServerXeroController::actionOauth` | Handles the full Xero OAuth1 3-legged dance: step 1 requests a `RequestToken` and redirects the borrower to Xero's authorize URL; step 2 (callback with `oauth_verifier`) exchanges it for an access token via `AccessToken`, then calls the internal `Xero/StoredAuth` service, and finally emits a small `<script>` payload that calls back into the opener window's JS (`loadXero`, `Registration.loadXero`, or `financialAnalysis.loadXero`) depending on the `action` query param (`creditrating`, `signup`, `financial_analysis`) and closes the OAuth popup. |
| `ServerQuickBooksController::actionOauth` | Same 3-legged OAuth1 dance for QuickBooks/Intuit using PECL `OAuth`: gets request token → redirects to Intuit's `Connect/Begin` → on callback exchanges for access token + `realmId` → calls internal `QuickBooks/StoredAuth` service → emits callback JS (`loadQuickBook`, `Registration.loadQuickBook`, or `financialAnalysis.loadQuickBook`). |
| `ServerFinancialAnalysisController::actionForm` | Renders the multi-step Financial Analysis form (reporting period, P&L, assets, liabilities, equity), pre-filling from a draft `FinancialAnalysis` record if one exists, else 3 default blank years (current year + 2 prior). |
| `ServerFinancialAnalysisController::actionDraft` | Returns a "resume your draft financial analysis?" prompt if one exists. |
| `ServerFinancialAnalysisController::actionResults($id)` | Renders the computed financial-analysis results view. |
| `ServerFinancialAnalysisController::actionValidateStep` | Saves the current wizard step's data into `FinancialAnalysis.data` (JSON blob) and marks it `STATUS_COMPLETE` on the final ("equity") step, else `STATUS_DRAFT`. |
| `ServerFinancialAnalysisController::actionGrabXeroData` | Pulls 3 years of Xero P&L + Balance Sheet via `XeroLib::getProfitAndLossInfo` / `getBalanceSheetInfo`, computes gross/net profit margin ratios, and stores the resulting `financial_analysis` array into `FinancialAnalysis.api_data`. |
| `ServerFinancialAnalysisController::actionGrabQuickBooksData` | Same as above using `QuickBookLib`. |

### Frontend UI touchpoints (borrower-facing, gated by `ENABLE_XERO` / `ENABLE_QUICKBOOK` flags)

- Credit Rating wizard → "Pledge collateral" step (`step_invoice.tpl`): "Connect with Xero" / "Connect with QuickBooks" buttons; on success shows a table of pulled invoices with a "Use Xero Invoice" action.
- Seek-funds/Borrow wizard → `step_collaterals.tpl`: same connect buttons, framed as "pledging invoices automatically... may result in a better credit scoring."
- Financial Analysis form (`financial_analysis/form.tpl`): "Login to your XERO or QuickBooks accounts for our extraction automatically."
- Account settings page (`account/main.tpl`): re-triggers the OAuth popup flow and calls `loadXero`/QuickBooks JS callbacks after third-party auth completes.

### Cron/background sync (largely dormant — see Tech Debt)

- `XeroCommand` / `QuickbooksCommand` (both physically located in a `commands/trash/` folder, i.e. not part of the live/active command set) poll `CronJob` rows of type `dl_xero_data` / `dl_quickbooks_data` and dispatch to `XeroJobLib::getXeroData()` / `QuickBooksJobLib::getQBData()`.
- These job libs implement a **self-scheduling job graph**: an `init` job fans out into dozens of child `CronJob` rows for `invoice_files`, `reports` (yearly and monthly ranges), and `items` (paginated resource pulls), each of which is itself re-processed by the same command on a later cron tick, with retry (`attempt < 4`) and mid-run OAuth-token-expiry detection that aborts the whole job family.

## Business Logic & Computations

### 1. OAuth1 three-legged handshake (Xero)
`seedin-live-user/.../ServerXeroController.php:6-136`
- Request token: `XeroOAuth->request('GET', url('RequestToken',''), ['oauth_callback' => $callback_url])`, callback URL is `XERO_CALLBACK . '?action=' . $action [&reference_id=...]`.
- Authorize URL built as `url('Authorize','') . "?oauth_token={token}&scope="` (empty scope — Xero "Public" app type grants full read/write per the connected organisation).
- Access token exchange: `request('GET', url('AccessToken',''), ['oauth_verifier'=>..., 'oauth_token'=>...])`.
- Stored auth keyed by `(user_id, type, reference_id)` where `type` is `XeroAuth::TYPE_CREDIT_RATING (1)` or `TYPE_FINANCIAL_ANALYSIS (2)` (`XeroAuth::getType($action)`, action strings `'creditrating'` / `'financial_analysis'`).
- App type is hardcoded `Public` (`XeroLib::XRO_APP_TYPE`), core API version `2.0`.

### 2. OAuth1 three-legged handshake (QuickBooks/Intuit)
`seedin-live-user/.../ServerQuickBooksController.php:6-113`
- Hardcoded OAuth1 endpoint constants: `OAUTH_REQUEST_URL = https://oauth.intuit.com/oauth/v1/get_request_token`, `OAUTH_ACCESS_URL = https://oauth.intuit.com/oauth/v1/get_access_token`, `OAUTH_AUTHORISE_URL = https://appcenter.intuit.com/Connect/Begin`.
- Uses PECL `OAuth` class with `OAUTH_SIG_METHOD_HMACSHA1` / `OAUTH_AUTH_TYPE_URI`, and **explicitly disables SSL verification** (`$oauth->disableSSLChecks()`).
- On callback, persists both request-token secret and access token + `realmId` ("dataSource"/company id) via the internal `QuickBooks/StoredAuth` service call.
- If action is `financial_analysis` and no explicit `reference_id` was passed, it resolves the borrower's current draft `FinancialAnalysis` record on the fly (`FinancialAnalysis::getCurrentFinancialAnalysis(true)`).

### 3. Xero invoice "auto-pledge" filter (which invoices become loan collateral)
`XeroInvoice::getXeroInvoice()` — `seedin-live-admin/.../models/XeroInvoice.php:125-148`
```sql
auth_id = :auth_id AND credit_rating_id = :credit_rating_id
AND status = "AUTHORISED" AND payment_id = "" AND currency = "SGD"
AND invoice_number <> "" AND due_date BETWEEN DATE(NOW()) AND DATE(NOW()) + INTERVAL 15 DAY
```
Only **unpaid, authorised, SGD-denominated invoices due within the next 15 days** are eligible to become collateral. The same 15-day/AUTHORISED/SGD filter is re-implemented inline as a Xero API `Where` clause in `ServiceCreditRatingController::postGrabXeroData` (`Status = "AUTHORISED" && CurrencyCode = "SGD" && DueDate >= today && DueDate <= today+15d`).

### 4. QuickBooks invoice "auto-pledge" filter — currency mismatch bug
`Collateral::updateFromQuickBooks()` — `seedin-live-admin/.../models/Collateral.php:109-136`
```php
//if( $invoice->CurrencyRef->value == 'SGD' ){
if( $invoice->CurrencyRef->value == 'USD' ){
    $collateral->invoice_id = $invoice->Id;
    $collateral->invoice_type = CreditRating::INVOICE_QUICKBOOKS;
    $collateral->collateral_type = Collateral::TYPE_INVOICE;
    $collateral->invoice_amount = $invoice->TotalAmt;
    $collateral->invoice_no = 'INV-' . $invoice->Id;
    $collateral->invoice_date_payment = $invoice->DueDate;
    ...
```
The comment says the intent was to filter on `SGD` (consistent with the Xero path and the platform's SGD-denominated lending), but the live condition checks `USD`. On a Singapore-based platform this is very likely a bug that silently drops all SGD QuickBooks invoices from being pledged as collateral — must be resolved (confirm intended currency) before porting this logic.

`ServiceCreditRatingController::postGrabQuickBooksData` (admin) also has a **hardcoded absolute date filter left over from development**: `'Where' => 'DueDate > \'2016-01-24\' AND DueDate < \''.date('Y-m-d',$days_15).'\''` (line ~1071) — the lower bound should almost certainly be `date('Y-m-d')` (today), not a fixed 2016 date; as written it fetches all invoices due at any point since Jan 24, 2016 through 15 days from now, not just the "next 15 days" window the UI advertises.

### 5. Collateral model — invoice source typing
`CreditRating.php` constants: `INVOICE_DEFAULT = 1` (manually uploaded), `INVOICE_XERO = 2`, `INVOICE_QUICKBOOKS = 3`. `Collateral::invoiceAttachment()` (`Collateral.php:57-65`) serves the invoice file from different URL patterns depending on source: manually-uploaded files come from `file/invoice2/type/attach/img/{filename}`; Xero/QuickBooks-sourced invoices (once downloaded by cron, `is_downloaded == 1`) are served from `file/invoice/id/{id}`.

### 6. Profit & Loss / Balance Sheet extraction — "key-value pair" reducers
Both Xero and QuickBooks return deeply nested, hierarchical report JSON (rows/sub-rows/cells). Two parallel reducer functions flatten these into a flat `LABEL => VALUE` map for lookup:
- **Xero**: `XeroData::getReportsKNVPair()` / `__recur_getReportsKNVPair()` (`XeroData.php:75-107`) walks `Reports->Report->Rows->Row`, recursing into `Row->Rows->Row` for sub-sections, and for any row with exactly 2 cells takes `Cell[0]->Value` as the (uppercased) label and `Cell[1]->Value` (cast to float) as the value.
- **QuickBooks**: `QuickBooksData::getReportsKNVPair()` / `__recur_getReportsKNVPair()` (`QuickBooksData.php:80-118`) walks the `Rows` array recursively, and whenever it finds a `ColData` array, takes `ColData[0]['value']` (uppercased) as the label and `ColData[1]['value']` as the value.

### 7. Xero P&L / Balance Sheet field mapping (used for both credit-rating and financial-analysis pulls)
`XeroLib::getProfitAndLossInfo($year, &$PNL)` — `XeroLib.php:300-334`:
```php
$fromDate = "$year-01-01"; $toDate = last day of December of $year;
$PNL = $this->_getReport('ProfitAndLoss', ['fromDate'=>$fromDate,'toDate'=>$toDate]);
$mapping = [
    'TotalIncome'            => 'TOTAL INCOME',
    'GrossProfit'            => 'GROSS PROFIT',
    'NetProfit'              => 'NET PROFIT',
    'TotalCostOfSales'       => 'TOTAL COST OF SALES',
    'TotalOperatingExpenses' => 'TOTAL OPERATING EXPENSES',
    'InterestExpense'        => 'INTEREST EXPENSE',
];
// each field defaults to 0.00 if the label isn't present in the reduced report
```
`XeroLib::getBalanceSheetInfo($year, &$BALSHEET)` — `XeroLib.php:336-367` (as-at 31-Dec of `$year`):
```php
$mapping = [
    'AccountsReceivable'      => 'ACCOUNTS RECEIVABLE',
    'TotalAssets'             => 'TOTAL ASSETS',
    'TotalCurrentAssets'      => 'TOTAL CURRENT ASSETS',
    'TotalLiabilities'        => 'TOTAL LIABILITIES',
    'TotalCurrentLiabilities' => 'TOTAL CURRENT LIABILITIES',
    'TotalEquity'             => 'TOTAL EQUITY',
    'RetainedEarnings'        => 'RETAINED EARNINGS',
];
```

### 8. QuickBooks P&L / Balance Sheet field mapping (note: different QB report label vocabulary)
`QuickBookLib::getProfitAndLossInfo()` — `QuickBookLib.php:84-110`:
```php
$mapping = [
    'TotalIncome'            => 'TOTAL INCOME',
    'GrossProfit'            => 'GROSS PROFIT',
    'NetProfit'              => 'NET INCOME',                 // NOTE: differs from Xero's 'NET PROFIT'
    'TotalCostOfSales'       => 'TOTAL COST OF GOODS SOLD',    // NOTE: differs from Xero's 'TOTAL COST OF SALES'
    'TotalOperatingExpenses' => 'NET OPERATING INCOME',        // NOTE: semantically different concept, not "expenses"!
    'InterestExpense'        => '',                            // NOTE: unmapped / never populated for QuickBooks
];
```
The `TotalOperatingExpenses` key is mapped to QuickBooks' **"NET OPERATING INCOME"** row, not an expenses total — this is very likely a labeling/logic bug inherited from copy-pasting the Xero mapping structure, since "net operating income" and "total operating expenses" are not the same figure. `InterestExpense` is never populated for QuickBooks (empty label, so it always falls through to `0.00`).
`QuickBookLib::getBalanceSheetInfo()` — `QuickBookLib.php:135-169` uses the same 7-field mapping as Xero's Balance Sheet (`ACCOUNTS RECEIVABLE`, `TOTAL ASSETS`, `TOTAL CURRENT ASSETS`, `TOTAL LIABILITIES`, `TOTAL CURRENT LIABILITIES`, `TOTAL EQUITY`, `RETAINED EARNINGS`), and additionally supports being called with `['y' => $year]` shorthand which is converted to `start_date = "$y-01-01"` / `end_date = last day of Dec $y`.

### 9. Credit-rating flow's field mapping into the borrower's Financial Statements
`ServiceCreditRatingController::postGrabQuickBooksData` (`ServiceCreditRatingController.php:907-928`) defines the QuickBooks→FinancialStatementMaster mapping actually used when a borrower connects QuickBooks during credit-rating:
```php
$profitAndLossFields = [
    'TOTAL_EXPENSES' => 'TOTAL EXPENSES',
    'SALES'          => 'SALES',
    'REVENUE'        => 'TOTAL INCOME',
];
$balanceSheetFields = [
    'CASH'                  => 'TOTAL BANK ACCOUNTS',
    'TOTAL_FIXED_ASSETS'    => 'TOTAL FIXED ASSETS',
    'CURRENT_ASSETS'        => 'CURRENT ASSETS',
    'ACCOUNT_RECEIVABLES'   => 'ACCOUNTS RECEIVABLE',
    'OTHER_RECEIVABLES'     => 'ACCOUNTS RECEIVABLE (A/R)',
    'LONG_TERM_LIABILITIES' => 'LIABILITIES',
    'CURRENT_LIABILITIES'   => 'CURRENT LIABILITIES',
    'ACCOUNT_PAYABLES'      => 'ACCOUNTS PAYABLE',
    'OTHER_PAYABLES'        => 'ACCOUNTS PAYABLE (A/P)',
    'CURRENT_BORROWING'     => 'TOTAL OTHER CURRENT LIABILITIES',
    'SHARE_CAPITAL'         => 'OPENING BALANCE EQUITY',
    'RETAINED_EARNINGS'     => 'RETAINED EARNINGS',
];
```
Two prior fiscal years (`date('Y')-1`, `date('Y')-2`, labelled financial statement "A" and "B") are pulled and saved into `FinancialStatementMaster` via `FinancialStatementMaster::saveDetails($financialData, $key)` (`FinancialStatementMaster.php:605-629`), which iterates each field and calls `saveStatement($field, $value)`.

For **Xero** in the same controller (`postGrabXeroData`, lines ~1280-1315) the field list nominally targeted is `REVENUE, SALES, TOTAL_EXPENSES` (P&L) and `CASH, ACCOUNT_RECEIVABLES, ACCOUNT_PAYABLES, OTHER_PAYABLES, TAX, RETAINED_EARNINGS` (Balance Sheet) — but **verified by tracing the actual key names, this mapping never succeeds for a single field**: `formatXeroResponse()` (`ServiceCreditRatingController.php:1420-1426`) does `isset($sourceData[$year][$field])` where `$sourceData` is `$ProfitAndLoss`/`$BalanceSheet` — arrays whose per-year entries are keyed by `XeroLib::getProfitAndLossInfo()`'s own mapping output (`TotalIncome`, `GrossProfit`, `NetProfit`, `TotalCostOfSales`, `TotalOperatingExpenses`, `InterestExpense`) and `getBalanceSheetInfo()`'s (`AccountsReceivable`, `TotalAssets`, `TotalCurrentAssets`, `TotalLiabilities`, `TotalCurrentLiabilities`, `TotalEquity`, `RetainedEarnings`). None of those keys match the lookup fields `REVENUE`/`SALES`/`TOTAL_EXPENSES`/`CASH`/`ACCOUNT_RECEIVABLES`/`ACCOUNT_PAYABLES`/`OTHER_PAYABLES`/`TAX`/`RETAINED_EARNINGS` (different casing *and* different words — e.g. `TotalIncome` vs `REVENUE`, `RetainedEarnings` vs `RETAINED_EARNINGS`). So `isset()` is always `false`, and **`FinancialStatementMaster` is never actually populated with any figure when a borrower connects via Xero through the Credit Rating flow** — this is not merely "a narrower field set than QuickBooks", it is dead/non-functional code that silently no-ops. The QuickBooks path's mapping (above in this section), by contrast, does align key-for-key with `QuickBooksData::getReportsKNVPair()`'s uppercased report-row labels and plausibly does work (modulo the Year-2 Balance Sheet bug below).

**Second bug in the same block**: for QuickBooks Year 2 (`$last2_sales_year`, financial-statement bucket `'B'`), the Balance Sheet loop mistakenly writes into bucket `'A'` instead of `'B'`:
```php
// ServiceCreditRatingController.php:1019-1025 — inside the "START YEAR 2" block
foreach($profitAndLossFields as $field => $QBField) {
    $this->formatQBResponse($ProfitAndLoss, $financialData, 'B', $field, $QBField, $json);   // correct: 'B'
}
foreach($balanceSheetFields as $field => $QBField) {
    $this->formatQBResponse($Balancesheet, $financialData, 'A', $field, $QBField, $json);    // BUG: should be 'B'
}
```
As written, Year 2's Balance Sheet figures overwrite/collide with Year 1's Balance Sheet bucket (`financial_a_CASH`, `financial_a_ACCOUNT_RECEIVABLES`, etc. get set twice, last-write-wins from Year 2 data), while `financial_b_CASH` etc. are never populated for QuickBooks-sourced Balance Sheets. Only the P&L half of Financial Statement "B" is reliably populated for QuickBooks; the Balance Sheet half is not.

### 10. Financial Analysis auto-computed ratios (from Xero/QuickBooks pull, not the manual financial-analysis form)
`ServerFinancialAnalysisController::actionGrabXeroData` / `actionGrabQuickBooksData` (`ServerFinancialAnalysisController.php:438-484`, `601-646`) compute, per fiscal year (current year back 3 years):
```php
$gross_profit_margin = 0;
if ( GrossProfit isset AND TotalIncome > 0 ) {
    $gross_profit_margin = round( GrossProfit / TotalIncome, 2 );
}

$net_profit_before_tax = 0;
if ( GrossProfit isset AND TotalOperatingExpenses isset ) {
    $net_profit_before_tax = GrossProfit - TotalOperatingExpenses;
}

$net_profit_margin = 0;
if ( TotalIncome > 0 ) {
    $net_profit_margin = round( $net_profit_before_tax / TotalIncome, 2 );
}
```
Results are stored per year into `FinancialAnalysis.api_data` (JSON) with fields: `year_end`, `period_length` (current-year uses `date('m')`, else `12`), `revenue`, `gross_profit`, `gross_profit_margin`, `total_operating_expenses`, `interest_paid` (hardcoded `0.00` — never sourced from Xero/QB), `net_profit_before_tax`, `net_profit_before_interest_and_tax` (hardcoded `0.00`), `net_profit_margin`, `total_assets`, `total_current_assets`, `total_liabilities`, `total_current_liabilities`, `total_equity`.
Note: **`net_profit_before_tax` here is computed as `GrossProfit − TotalOperatingExpenses`**, not from the report's own `NetProfit`/`NET INCOME` line — this is a derived approximation, not the accounting system's own bottom line.

### 11. Xero date parsing (`/Date(...)/ ` MSAJAX format)
`XeroData::formatXeroDate()` (`XeroData.php:141-183`) parses Xero's legacy `.NET`-style `/Date(1234567890000+0000)/` timestamps (also handling a `+`/`-` timezone-offset suffix embedded in the digits) as well as ISO8601 (`YYYY-MM-DDTHH:MM:SS`), returning either the parsed date or the original string unchanged if neither pattern matches.

### 12. QuickBooks report "double dash" placeholder rule
`QuickBooksData::isDoubleDash($type, $header)` (`QuickBooksData.php:383-441`) maintains a per-report-type allowlist of header labels (mostly `'TOTAL'`, plus report-specific ones like `'Net Income'`, `'TOTAL LIABILITIES AND EQUITY'`, `'Cash at end of period'`) that the report-rendering UI treats specially (renders as a double-dash / summary row) — purely a display concern, not a financial computation, but documents which rows are considered "grand total" rows per report type.

### 13. Background sync job graph & retry policy
`XeroJobLib` / `QuickBooksJobLib` (`cron/protected/lib/*.php`): an `init` job (triggered by `RegCronJob`, one per `credit_rating_id`, de-duplicated via `CronJob.meta1`) fans out into ~10-15 child `CronJob` rows for `invoice_files`, `reports` (yearly ranges for Trial Balance/Budget Summary, monthly ranges for P&L/Executive Summary/Bank Summary), and `items` (Invoices, Bank Transactions/Transfers, Contacts, Accounts, Receipts, Journals, etc., some paginated up to 100 pages). Each pull attempt is retried up to 3 times per `xeroDL()`/`QBDL()` call (`for($try=1;$try<=3;$try++)`), and the parent job itself is marked `is_executed=0` again (i.e. reprocessed on the next cron tick) up to `attempt < 4` times if any sub-call reported a problem. A detected `TokenExpired` response immediately flags **every sibling job sharing the same `meta1` (credit_rating_id)** with `token_expired=1`, aborting the entire job family rather than just the failing call.

### 14. `signup` OAuth action is wired in the UI but throws server-side (dead/broken path)
`ServerXeroController::actionOauth` (`seedin-live-user/.../ServerXeroController.php:102-120`) and `ServerQuickBooksController::actionOauth` (`.../ServerQuickBooksController.php:87-103`) both branch their post-auth JS callback on three `action` values — `'signup'`, `'creditrating'`, `'financial_analysis'` — emitting `window.opener.$.fn.Registration.loadXero(...)` / `Registration.loadQuickBook(...)` for the `signup` case, implying the borrower **registration wizard** is meant to let a new user connect Xero/QuickBooks during signup. However, both controllers first call `XeroAuth::getType($action)` / `QuickBooksAuth::getType($action)` (`ServerXeroController.php:66`, `ServerQuickBooksController.php:66`) to resolve `$action` to a `type` constant before posting to the internal `Xero/StoredAuth` / `QuickBooks/StoredAuth` service. `XeroAuth::getActions()` / `QuickBooksAuth::getActions()` (identical in all three repos) only define:
```php
return [
    'creditrating'       => self::TYPE_CREDIT_RATING,       // 1
    'financial_analysis' => self::TYPE_FINANCIAL_ANALYSIS,  // 2
];
```
There is no `'signup'` entry, so `getType('signup')` hits the `else` branch and `throw new Exception('No Action found.')` — meaning **the OAuth callback for the registration/signup flow throws an uncaught exception before it can save the token or emit the `Registration.loadXero`/`loadQuickBook` JS callback**, i.e. this code path cannot function as written today.

## Data Model

Inferred from ActiveRecord model classes (no migration files were found for these tables; schema inferred purely from code usage):

| Table | Model | Key columns (inferred) | Notes |
|---|---|---|---|
| `xero_oauths` | `XeroAuth` | `id` (PK), `user_id`, `type` (1=credit_rating, 2=financial_analysis), `reference_id`, `created_at`, `oauth_verifier`, `oauth_token`, `access_token`, `access_token_secret` | One row per borrower per (type, reference) OAuth grant. |
| `quickbooks_oauth` | `QuickBooksAuth` | `id` (PK), `user_id`, `type`, `reference_id`, `request_datetime`, `oauth_request_token`, `oauth_request_token_secret`, `oauth_access_token`, `oauth_access_token_secret`, `qb_realm` (Intuit company/realm id), `access_datetime`, `touch_datetime` | |
| `xero_data` | `XeroData` | `id`, `auth_id` (FK→xero_oauths), `user_id`, `credit_rating_id`, `type` (20+ constants: bank txns/transfers, contacts, payments, invoices, journals, items, tax rates, org, and ~8 report types), `page`, `data` (raw JSON response), `server_response`, `params`, `created_at` | Raw cache of every Xero API response pulled by the background job. |
| `quickbooks_data` | `QuickBooksData` | `id`, `auth_id` (FK→quickbooks_oauth), `user_id`, `credit_rating_id`, `type` (~45 constants: 15 transaction types, 14 list/resource types, ~19 report types), `page`, `data`, `server_response`, `params`, `created_at` | Raw cache of every QuickBooks API response. |
| `xero_invoice` | `XeroInvoice` | `id`, `auth_id`, `credit_rating_id`, `invoice_id`, `invoice_number`, `total_amount`, `amount_paid`, `due_date`, `currency`, `type`, `status`, `reference`, `has_attachments`, `payment_id`, `payment_date`, `name`, `is_downloaded`, `created_at` | Normalized/flattened invoice rows (vs. raw JSON in `xero_data`). |
| `xero_bank` | `XeroBank` | `id`, `xero_id`, `credit_rating_id`, `code`, `account_id`, `type`, `tax_type`, `enable_payments_to_account`, `show_in_expense_claims`, `bank_account_type`, `reporting_code`, `reporting_code_name`, `updated_date_utc`, `bank_name`, `status`, `account_number`, `currency` | **Dead code** — model exists, `updateList()` defined, but never invoked from any controller/cron in the three repos. |
| `xero_contacts` | `XeroContacts` | `id`, `xero_id`, `credit_rating_id`, `contact_id`, `contact_status`, `name`, `email_address`, `bank_account_details`, `addresses` (JSON), `phones` (JSON), `updated_date_utc`, `contact_groups` (JSON), `is_supplier`, `is_customer`, `default_currency`, `balances` (JSON), `contact_persons` (JSON), `has_attachments`, `has_validation_errors`, `api_response` (JSON) | **Dead code** — same as above, never invoked. |
| `xero_organization` | `XeroOrganization` | `id`, `xero_id`, `credit_rating_id`, `name`, `orgz_type`, `base_currency`, `legal_name`, `address_1`, `address_2`, `city`, `postal_code`, `country_code`, `phone_number`, `phone_type`, `phone_area_code` | **Dead code** — never invoked; the live flow instead stores organisation data straight onto `CreditRating.company_*` fields. |
| `xero_api_general` | `XeroGeneral` | `id`, `user_id`, `xero_user_id`, `email`, `first_name`, `last_name`, `date` | **Dead code** — never invoked. |
| `xero_pnl` | `XeroPnl` | `id` only (no custom logic) | **Dead code** — empty model, unused. |
| `xero_loan_form` | `XeroLoan` | (no custom logic) | **Dead code** — empty model, unused. |
| `collateral` | `Collateral` | `id`, `credit_rating_id`, `invoice_id`, `invoice_type` (1=manual, 2=Xero, 3=QuickBooks), `collateral_type` (1=invoice, 2=real estate, 3=inventories), `invoice_amount`, `invoice_no`, `invoice_date_payment`, `invoice_attachment`, `currency`, `is_downloaded`, `status`, `created_date` | Loan collateral records auto-populated from Xero/QuickBooks invoices (or manually uploaded). |
| `cronjobs` | `CronJob` | `job_id` (PK), `type` (`dl_xero_data` / `dl_quickbooks_data` among others), `data` (JSON — process name, page, params, per-sub-job progress flags), `is_executed`, `executed_at`, `attempt`, `meta1` (used as `credit_rating_id` for dedup), `created_at` | Generic job queue table shared by many cron domains, not specific to accounting. |
| `financial_statement_master` | `FinancialStatementMaster` | (fields set dynamically via `saveStatement($field, $amount[, $customName])`) | Destination of the P&L/Balance-Sheet figures pulled from Xero/QuickBooks during credit-rating. |
| `financial_analysis` | `FinancialAnalysis` | `id`, `user_id`, `status` (draft/complete), `data` (JSON wizard data), `api_data` (JSON — Xero/QuickBooks-derived ratios per year) | Destination of the standalone Financial Analysis wizard, separately populated by `actionGrabXeroData`/`actionGrabQuickBooksData`. |

## Cron/Automation Dependencies

- **`XeroCommand`** (admin & api repos, `cron/protected/commands/trash/XeroCommand.php`) and **`QuickbooksCommand`** (`.../trash/QuickbooksCommand.php`) — both physically live in a `commands/trash/` directory alongside dozens of other retired console commands, while the "live" `commands/` directory (sibling, non-trash) contains no Xero/QuickBooks command at all. No crontab, scheduler config, or supervisor file referencing either command was found anywhere in the three repos. This strongly corroborates the domain description that these integrations are **dormant/manually-run** — the sync code exists and is presumably invoked ad hoc (e.g. by a developer running `php console.php xero` or `quickbooks` directly), not by any active scheduled job.
- When run, `XeroCommand`/`QuickbooksCommand` poll `CronJob` rows with `is_executed=0` and the corresponding `type` constant, and delegate to `XeroJobLib::getXeroData()` / `QuickBooksJobLib::getQBData()` (see Business Logic §13 for the job graph and retry behavior).
- `XeroJobLib::newProcessManager()` (unused helper, `XeroJobLib.php:771-785`) shows an intended-but-apparently-abandoned design to fan work out across parallel `php console.php xero` OS processes via `proc_open` — not wired into the actual `init()` flow (which instead just enqueues more `CronJob` rows for the same single-process command to pick up later).
- Invoice PDF downloads (`getXeroDownloadInvoiceFiles`, `downloadInvoiceFiles` in `QuickBooksJobLib`) write files to `Yii::app()->params['dir_xero_invoices']` / `dir_qb_invoices`, which map to `seedin-live-admin/newunion/applications/uploads/xero_invoices/` and `.../uploads/qb_invoices/` — both directories currently contain only a `.gitignore` (empty, git-ignored upload targets).

## Integrations

- **Xero** (accounting) — OAuth1 "Public" application via the bundled `XeroOAuth`/`OAuthSimple` PHP library (`applications/common/extensions/xero/lib/`); Core API v2.0. No Payroll/Files API usage found beyond the version constants.
- **QuickBooks Online** (accounting) — OAuth1 via PHP's `OAuth` PECL extension (browser handshake) plus Intuit's official `QuickBooks-PHP` SDK (`QuickBooks_IPP`, vendored under `applications/common/extensions/quickbooks/`) for the actual IDS/report/PDF calls after the token is obtained.
- **Internal service-to-service HTTP layer** — the User app's `Server*Controller`s call back into the Admin/API app's `Service*Controller`s via an internal `$this->service->post(...)` client (`ServiceController` framework), rather than writing to the DB directly — i.e. this domain also depends on the platform's internal service-call framework being intact.
- No other third-party services (payment gateway, e-signature, SMS/email) are touched directly by this domain's code; downstream consumers of the pulled data (Credit Rating, Financial Analysis, Collateral) belong to adjacent domains.

## Tech Debt / Risks Observed

- **Deprecated OAuth1 protocol.** Both integrations use OAuth 1.0a. Xero retired OAuth1 support industry-wide; this code is very likely non-functional against the current Xero API regardless of credentials.
- **Hardcoded plaintext API secrets committed to environment config**, e.g. `seedin-live-admin/newunion/environments/prod/newunion/applications/common/settings.php:39-40` (`CONSUMER_KEY`, `SHARED_SECRET` for Xero) and `:80-81` (`OAUTH_CONSUMER_KEY`, `OAUTH_CONSUMER_SECRET` for QuickBooks) — live production credentials checked into source control.
- **SSL verification disabled** for the QuickBooks OAuth1 handshake: `$oauth->disableSSLChecks()` (`ServerQuickBooksController.php:23`) — a documented workaround for a CA-cert issue, but a real security weakness (MITM exposure) if still relied upon.
- **Currency-filter bug in QuickBooks collateral import**: `Collateral::updateFromQuickBooks()` checks `CurrencyRef->value == 'USD'` while the adjacent commented-out line and the parallel Xero logic both target `SGD` — as written, this likely drops all real (SGD) invoices from ever becoming pledged collateral via QuickBooks.
- **Hardcoded stale date literal** in `ServiceCreditRatingController::postGrabQuickBooksData` invoice filter: `'DueDate > \'2016-01-24\''` instead of `date('Y-m-d')` — makes the "next 15 days" window actually span from Jan 2016 onward.
- **The Xero → Financial Statement mapping in the Credit Rating flow is completely non-functional**, not merely "narrower" than QuickBooks (see Business Logic §9): `formatXeroResponse()`'s lookup keys (`REVENUE`, `SALES`, `TOTAL_EXPENSES`, `CASH`, `ACCOUNT_RECEIVABLES`, etc.) never match the actual array keys produced by `XeroLib::getProfitAndLossInfo()`/`getBalanceSheetInfo()` (`TotalIncome`, `GrossProfit`, `RetainedEarnings`, etc.) — a borrower who connects Xero during Credit Rating gets invoices pledged as collateral and company profile auto-filled, but their P&L/Balance Sheet figures silently never reach `FinancialStatementMaster`. This should be treated as a rewrite-from-scratch mapping, not a "port with fix."
- **QuickBooks Year-2 Balance Sheet figures are written into the Year-1 (`'A'`) bucket** instead of `'B'` (`ServiceCreditRatingController.php:1023-1025`, see Business Logic §9) — Year 1's Balance Sheet data gets silently overwritten by Year 2's, and `financial_b_*` Balance Sheet fields are never populated for QuickBooks-sourced credit ratings.
- **The `signup`-action OAuth callback throws an uncaught exception** (see Business Logic §14): `XeroAuth::getType('signup')` / `QuickBooksAuth::getType('signup')` throw because only `creditrating`/`financial_analysis` are registered actions, even though both `ServerXeroController`/`ServerQuickBooksController` and their JS callback branches (`Registration.loadXero`/`loadQuickBook`) are written to support a signup-time connect flow — this borrower-registration entry point is currently broken.
- **Questionable QuickBooks P&L label mapping**: `TotalOperatingExpenses` is mapped to QuickBooks' `NET OPERATING INCOME` row (`QuickBookLib.php:91`), not an expenses total, and `InterestExpense` is never populated for QuickBooks (empty mapping label) — both look like copy-paste-from-Xero mistakes rather than intentional business rules.
- **Six ActiveRecord models are entirely dead code**: `XeroBank`, `XeroContacts`, `XeroOrganization`, `XeroGeneral`, `XeroPnl`, `XeroLoan` are fully implemented (including a working `updateList()`/`updateOrganisation()` on three of them) but are never called from any controller, service, or cron job in any of the three repos — this looks like an earlier, more complete version of the sync that was later replaced by the narrower `postGrabXeroData`/`postGrabQuickBooksData` flow without removing the old models.
- **Cron commands live in a `trash/` folder** with no discoverable scheduler entry anywhere in the repos — corroborates that this is unscheduled/manually-triggered only, and the large `XeroJobLib`/`QuickBooksJobLib` "full mirror" sync (contacts, bank transactions, 8-19 report types, paginated up to 100 pages) may not have run in production for a long time.
- **Derived, not authoritative, "net profit before tax"**: `ServerFinancialAnalysisController`'s auto-populated financial-analysis figures compute `net_profit_before_tax = GrossProfit − TotalOperatingExpenses` rather than reading the accounting system's own Net Profit/Net Income line — an approximation that can diverge from the source-of-truth figure whenever a business has material other-income/other-expense lines.
- **`interest_paid` and `net_profit_before_interest_and_tax` are hardcoded to `0.00`** in both the Xero and QuickBooks auto-pull paths (`ServerFinancialAnalysisController.php:466,470,628,632`) — never actually sourced from either accounting system, silently understating/misrepresenting these fields whenever a business does carry interest expense.
- **Duplicated code across all three repos**: `XeroLib`, `QuickBookLib`, `ServiceCreditRatingController`'s grab-data logic, and the OAuth model classes are near-identical copies maintained independently in `seedin-live-admin`, `seedin-live-api-v1-1`, and `seedin-live-user` — any bugfix (e.g. the currency bug above) would need to be applied in up to three places, and there is no evidence the repos are kept in sync (e.g. `QuickBookLib::getBalanceSheetInfo` differs slightly between the admin/api copy (uses `date($year.'-m-01')`, `date($year.'-m-t')`) — with `$year` interpolated into a format string containing literal `m`, which is very likely a bug producing a malformed date string, since `date()`'s first argument is a format string, not a template for substitution).
- **No visible admin-facing UI** consumes the large `xero_data`/`quickbooks_data` raw-cache tables populated by the background job — the only consumers found are the narrow, purpose-built "grab on demand" endpoints used during borrower onboarding.
- **Manual OAuth-popup UX with hard page-reload-driven state** (`window.opener.$.fn.loadXero(...)`, `window.close()`) — tightly couples the backend redirect response to specific frontend jQuery plugin method names (`loadXero`, `Registration.loadXero`, `financialAnalysis.loadXero`), making this brittle to any frontend refactor.
- **No automated tests** were found covering any of this domain's controllers, libs, or models.

## Proposed MVP Scope for Revamp

**Must-have (v1):**
- **Borrower-initiated OAuth connect + on-demand pull for Financial Analysis / Credit Rating** (the `postGrabXeroData`/`postGrabQuickBooksData`/`actionGrabXeroData`/`actionGrabQuickBooksData` flows) — this is the only actively-used, UI-reachable part of the domain and directly reduces borrower data-entry friction, which is a real product value proposition worth preserving.
- **Migrate both integrations to OAuth2** (Xero OAuth2 + QuickBooks OAuth2/OpenID Connect) — OAuth1 is deprecated/likely broken already; this is a hard prerequisite for the feature to work at all post-rebuild, not an optional improvement.
- **Invoice → Collateral auto-pledge logic**, reimplemented with the currency bug fixed and the currency (SGD vs. USD, and multi-currency support generally) made an explicit, tested business rule rather than an accidental literal.
- **P&L / Balance Sheet → Financial Statement field mapping, designed fresh** (not ported as-is): the existing Xero mapping in the Credit Rating flow never actually worked (§9/Tech Debt), the QuickBooks mapping has a Year-1/Year-2 Balance Sheet bucket bug, and `TotalOperatingExpenses` is mislabeled against QuickBooks' own report vocabulary — treat this as "build one correct, tested, provider-agnostic mapping" rather than "fix the existing one," and cover it with tests asserting each target field resolves from each provider's actual report label.
- **Company profile auto-fill** (name/address/phone from Xero Organisation / QuickBooks CompanyInfo) — low complexity, clear UX value, no known bugs.

**Nice-to-have / defer:**
- **Full bulk bookkeeping mirror** (`XeroJobLib`/`QuickBooksJobLib`'s ~60 resource/report types, contacts, bank transactions/transfers, tax rates, employees, items, etc.) — no evidence any admin screen or downstream feature consumes this today; defer until a concrete consumer (e.g. an underwriting dashboard) is identified, to avoid rebuilding a large, unused surface area.
- **Xero/QuickBooks invoice PDF download & local storage** — a nice convenience (serving the original invoice as an attachment) but adds file-storage/cron complexity; can be replaced in v1 by simply deep-linking the borrower back to the invoice in Xero/QuickBooks, or deferred until there's demand.
- **The six dead-code Xero models** (`XeroBank`, `XeroContacts`, `XeroOrganization`, `XeroGeneral`, `XeroPnl`, `XeroLoan`) — do not port; they represent an abandoned earlier design with no live callers.
- **Background/scheduled (cron-driven) periodic re-sync** — since usage today is manual/on-demand only and there's no evidence of a live scheduler, a v1 rebuild should keep this pull-based/on-demand (triggered by the borrower's action), and only add true scheduled background refresh if a business need for staleness-free data emerges.
- **Multi-year "yearly"/"monthly" report range fan-out** (Trial Balance, Budget Summary, Executive Summary, Bank Summary, Aged Payables/Receivables, Class/Department/Item Sales, etc.) — defer; only the 2-3-year P&L and Balance Sheet reports are actually consumed by any live feature today.
