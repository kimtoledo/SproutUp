# Credit Rating & Underwriting

## Overview

This domain implements SeedIn / New Union's SME credit-scoring and underwriting workflow: an SME ("Fundseeker"/borrower) submits a multi-step "seek funds" application (loan purpose, company particulars, 2 years of financial history, collateral/pledge details, guarantor/director information, bankruptcy disclosure), and the system either computes a weighted multi-factor score (A–F) or short-circuits the score to `A` when pledged collateral fully covers the requested loan amount. A separate but related "Financial Analysis" tool lets an SME (or its accountant) pull P&L/Balance Sheet data from Xero or QuickBooks (or enter manually) and get an auto-computed ratio/margin report (working-capital days, gearing, profitability, "power of one" sensitivity tables) independent of the credit-rating flow.

**Users:**
- **Borrower (Fundseeker company / SME)** — fills in the multi-step credit-rating wizard (`seedin-live-user`), uploads director/shareholder KYC docs, connects Xero/QuickBooks, views their own financial analysis reports.
- **Admin / Credit Risk Committee (CRC) staff** — reviews submitted applications in the admin dashboard (`seedin-live-admin`), can edit/re-score an application, approve/reject, track review "stages" (pending doc → site visit → memo → CRC approval), and later create a loan/investment listing from an approved rating.
- **System / automated** — the scoring engine (`CreditRating::processRating()`) runs synchronously at final submission; Xero/QuickBooks pulls are triggered on-demand by the borrower during the wizard (not on a schedule).
- **Investor** — not a direct actor in this domain, but the resulting letter grade (and the loan/listing built from it) is what investors ultimately see downstream (outside this domain).

The domain spans two closely related sub-systems:
1. **Credit Rating / Underwriting** — `CreditRating` + related child tables (directors, shareholders, collateral, attachments, reviews, history) and the scoring engine.
2. **Financial Ratio / Analysis Engine** — `FinancialStatementMaster`/`FinancialStatement`/`FinancialTypes` (balance-sheet/P&L line items feeding the credit rating's "Financial" score section) and the standalone `FinancialAnalysis` tool (ratios/margins/growth report, also Xero/QuickBooks fed, but functionally separate from the scoring engine).

## Current Features & Flows

### Admin Dashboard (`seedin-live-admin` / `seedin-live-api-v1-1`, `backend` app)

- `CreditratingController::actionList` — list/filter credit-rating applications by status (pending, approved, rejected, dropped, incomplete, profile_required, reviewing) and rating (A–D). `admin/newunion/applications/backend/controllers/CreditratingController.php:8`
- `CreditratingController::actionView($id)` — read-only detail view of one application, including loaded financial statements A/B (2 years) via `FinancialStatementMaster::loadStatements()`. `.../CreditratingController.php:23`
- `CreditratingController::actionEdit($id)` — full edit form for an application (admin can amend any field submitted by the borrower, re-run pledge/financial computations, re-upload docs). `.../CreditratingController.php:60`
- `CreditratingController::actionCreateloan($id)` — pushes an approved credit rating into a new `BorrowForm`/`LoanBorrowListing` (Product Type B), pre-filling amount/tenor/company from the credit rating. `.../CreditratingController.php:188`
- `CreditratingController::actionLoans` — lists "Product B" loans originating from credit ratings. `.../CreditratingController.php:252`
- `CreditlistingController::actionList` — list of `CreditListing` records (the listing wrapper created once a rating is approved/restructured). `.../CreditlistingController.php:7`
- `CreditlistingController::actionView($id)` — view one credit listing plus its linked `LoanBorrowListing`. `.../CreditlistingController.php:18`
- `CreditlistingController::actionMakeInvestmentListing($id)` — converts a `CreditListing` into an investor-facing listing (Product Type A), carrying forward `hasPledge()`/`hasGuarantor()` flags. `.../CreditlistingController.php:35`
- `ServiceCreditRatingController` (services app, shared by admin+backend) — the same step-validation service endpoints described below are reused by the admin "edit" screen (`APPNAME == 'backend'` branch pulls `credit_rating_id` from POST instead of session).

### API / Services (`seedin-live-api-v1-1`, `services` app — `ServiceCreditRatingController`)

Step-wizard endpoints, all funneled through `postValidateStep` → `validate{Step}()`:
- `postValidateStep` — dispatcher; blocks guests (prompts registration), blocks Investor-type users from applying, blocks a second concurrent application if one is already pending (when `ALLOW_MULTIPLE_FUND_SEEK` is off), auto-creates a new `CreditRating` (status `INCOMPLETE`) on the `understanding` step. `.../ServiceCreditRatingController.php:13`
- `validateUnderstanding` — Step 1: saves `amount`, `purpose` (fund purpose), `total_months`. `:98`
- `validateParticulars` — Step 2: company/contact info, `ownership` date (used later for company-age scoring), bankruptcy pre-fields. `:120`
- `validateFinancialAnalysis` — saves the two-year "financial statement" balance sheet/P&L breakdown (`FinancialStatementMaster` A & B) used by the rating's Financial section. `:177`
- `validateFinancial` — Step 3: industry, last-2-years sales/gross/net figures, `is_audited` flag, and guarantor "notice" fields; also triggers director/shareholder file uploads via `CreditRating::updateFiles()`. `:239`
- `validateCollaterals` — Step 4: pledge properties (Inventories / Invoices / Real Estate), runs `CreditRatingLib::ProcessPledge()` per pledge line as a **preview** calculation, validates required sub-fields, persists raw pledge inputs as `pledge_result` JSON. `:297`
- `validateNotice` — guarantor 1 & 2 details (name, NRIC, asset assessment amounts/years, social handles, residency status). `:378`
- `validateBankruptcy` — bankruptcy history/discharge/year. `:420`
- `validateOptional` — final step: uploads free-form attachments, resolves/creates the `CreditClient`, sets status to `PENDING`, logs activity + history, **calls `CreditRating::processRating()` to compute the score**, emails admin + borrower, posts a Telegram log line. `:454`
- `validateInvoice` — manual invoice entry path (currently dead-disabled: wrapped in `if (false and ...)`). `:608`
- `actionInvoiceDetails` — renders an invoice detail HTML snippet for a given `Collateral` row. `:710`
- `postApplyNow` — returns the current in-progress `CreditRating` + loaded financial statements (used to resume/repopulate the wizard). `:742`
- `postGrabQuickBooksData` — pulls company info, 2 years of P&L + Balance Sheet, and 15-day-window invoices from QuickBooks; auto-fills `FinancialStatementMaster` A/B and creates `Collateral` rows from QB invoices. `:792`
- `postGrabXeroData` — same as above but from Xero; also pulls organisation info and saves raw payloads to `XeroData`. `:1115`

### User App (`seedin-live-user`, `frontend`)

- `CreditRatingController::actionIndex` — renders the full multi-step credit-rating wizard (understanding → collaterals → bankruptcy → financial → notice → particulars → optional → invoice → financial_analysis partials), pre-filling from the in-progress `CreditRating` (session `current_credit_rating_id`) or from a cached "seek funds" teaser captured pre-login. `.../CreditRatingController.php:6`
- `CreditRatingController::actionPledgeForm` — renders one additional blank pledge-collateral row (AJAX "add another pledge"). `:253`
- `CreditRatingController::actionView($id)` — renders a read-only view partial of a submitted application (used e.g. in confirmation emails). `:257`
- `ServerCreditRatingController::actionTempSaveStep1` — caches step-1 form data in session before login. `:8`
- `ServerCreditRatingController::actionValidateStep` — proxies to `services` `CreditRating/ValidateStep`. `:20`
- `ServerCreditRatingController::actionGrabXeroData` / `actionGrabQuickBooksData` — proxy to the services Xero/QuickBooks pull endpoints. `:30`, `:39`
- `ServerFinancialAnalysisController::actionForm` — renders the standalone Financial Analysis multi-step form (reporting period → P&L → assets → liabilities → equity), resuming a draft if one exists. `:7`
- `ServerFinancialAnalysisController::actionDraft` — checks for/loads an existing draft `FinancialAnalysis` record. `:85`
- `ServerFinancialAnalysisController::actionResults($id)` — renders the computed ratio/margin report for a completed `FinancialAnalysis`. `:112`
- `ServerFinancialAnalysisController::actionValidateStep` — saves each wizard step's data into `FinancialAnalysis.data` (JSON); on the final "equity" step (non-draft) flips status to `COMPLETE`. `:137`
- `ServerFinancialAnalysisController::actionGrabXeroData` — pulls 3 years of P&L + Balance Sheet from Xero, computes `gross_profit_margin`/`net_profit_margin` inline, stores as `FinancialAnalysis.api_data`. `:333`
- `ServerFinancialAnalysisController::actionGrabQuickBooksData` — QuickBooks equivalent. `:500`

## Business Logic & Computations

### 1. The live scoring engine — `CreditRating::processRating()`
`admin/newunion/applications/common/models/CreditRating.php:827-1373` (identical in `seedin-live-api-v1-1`). This is the method actually invoked from the submission flow (`ServiceCreditRatingController::validateOptional()` line 537). It produces a **weighted A–F letter grade** stored in `credit_rating.credit_rating`, with full computation trail in `credit_rating.summary_result` (JSON).

**Six weighted sections, weights sum to 100:**

| Section | Weight | Sub-factors (each rated 1–5, then averaged) |
|---|---|---|
| Collateral | 5 | `pledgeRate` (0–5) |
| Understanding (need vs. purpose) | 15 | `howMuchYouNeedRate`, `purposeRate` |
| Particulars | 10 | `employeesRate`, `ownershipRate` |
| Financial | 30 | `auditRate`, `salesRate`, `grossRate`, `netRate` |
| Notice (guarantor) | 20 | `guaranteeRate`, `directorRate` |
| Bankruptcy | 20 | `bankruptcyRate` |

For each section: `rate_avg = sum(sub-rates)/count(sub-rates)`, `rate_percentage = rate_avg/5`, `weight_rate = weightage * rate_percentage`. `totalWeight = sum(weight_rate across sections)` unless short-circuited (see Collateral below).

**Collateral / pledge short-circuit ("Force A"):** `CreditRating.php:836-949`
- For each `Collateral` record: `z = estimated_value*0.5 - outstanding_loan` (real estate), `z = estimated_value*0.5` (inventories), `z = invoice_amount*0.5` (invoice).
- Plus, if `pledge_properties == 'Yes'` and `pledge_result` JSON is set, the same 3 formulas are re-applied to the raw pledge inputs (`realestate_estimated_value*0.5 - realestate_outstanding_loan`, `inventory_estimated_value*0.5`, `invoices_estimated_value*0.5`) and summed into the same `totalZ`.
- `pledgeRate` tiers based on how many multiples of `totalZ` the requested `amount` is: `<1×→5`, `[1×,1.5×)→4`, `[1.5×,2×)→3`, `[2×,2.5×)→2`, `[2.5×,3×)→1`, `>3×→0`.
- **If `amount < totalZ` (pledged collateral value covers the loan), `totalWeight` is forced to `100` immediately — this guarantees the final grade is `A` regardless of every other section.** This is the "collateral covers the loan ⇒ auto A" rule from the domain brief. Otherwise `amount -= totalZ` and scoring continues normally with the collateral-adjusted amount used for the "Understanding" and "Notice" sections below.

**Understanding (need amount vs. purpose):** `:951-1027`
- `howMuchYouNeedRate`: `amount < $20,000 → 1`; else tiered by `amount` as % of 2-yr avg sales revenue: `<8%→5`, `(8%,12%)→4`, `(12%,20%)→3`, `(20%,30%)→2`, `(30%,100%)→1`, `≥100%→0`.
- `purposeRate`: regex on lowercased `purpose` string — `debt→1`, `inventory→5`, `equipment→3`, `working→5`, `acquire→4`, `other→3`, unmatched→0. (Note: `remodel`, `marketing`, `emergency` branches are present but commented out — dead rules.)

**Particulars:** `:1030-1089`
- `employeesRate`: `1→1`, `2–5→2`, `6–10→3`, `11–50→4`, `≥51→5`.
- `ownershipRate`: months of company age (via `DateTime::diff` on `ownership.'-1'`) — `0–11mo→1`, `12–23→2`, `24–35→3`, `36–59→4`, `≥60→5`; negative interval (future date) → 0.

**Financial:** `:1092-1204`
- "No proper management" flag if `industry` empty OR any of last-1/last-2 sales/gross/net = 0 → forces `auditRate = 1`.
- `auditRate`: not-audited & avg net profit ≤0 → 2; not-audited & avg net profit >0 → 3; audited & both years net profit >0 → 5; audited & only one year net profit >0 → 4; else 0.
- `salesRate` (2-yr avg sales revenue): `<500k→1`, `[500k,1M)→2`, `[1M,2M)→3`, `[2M,5M)→4`, `≥5M→5`.
- `grossRate` (gross_profit_avg / sales_revenue_avg × 100): `≤20%→1`, `(20,30]→2`, `(30,40]→3`, `(40,50]→4`, `>50%→5`.
- `netRate` (net_profit_avg / sales_revenue_avg × 100): `[0,0.1]→1`, `(0.1,2]→2`, `(2,5]→3`, `(5,10]→4`, `>10→5`; negative → 0.

**Notice (guarantor):** `:1209-1292`
- Requires both name+status+NRIC populated for a guarantor to count as "has guarantor"; otherwise both sub-rates = 0.
- `guarantorAmount{1,2}` = whichever assessment year (`yr1` vs `yr2`) is later, using that year's amount.
- `guaranteeRate` tiers guarantor asset total vs. multiples of the (collateral-adjusted) `amount`: `≥200%→5`, `[150%,200%)→4`, `[100%,150%)→3`, `[50%,100%)→2`, `[0%,50%)→1`, else 0.
- `directorRate` (nationality mix, `GUARANTOR_LOCAL=1/PR=2/FOREIGNER=3`): both local→5, one local→4, both PR→3, one PR→2, any foreigner→1, else 0.

**Bankruptcy:** `:1294-1343`
- No bankruptcy history → `bankruptcyRate = 5`.
- Bankruptcy history + **not discharged** → `bankruptcyRate = 0` (see disqualification note below).
- Bankruptcy history + discharged: years-since tiers — `≤7→2`, `[8,10]→3`, `≥11→4`; `'' `(blank year) → 1; `'10>'` maps to 11.

**Final aggregation & grading:** `:1346-1373`
```
if (bankruptcyRate && totalWeight == 0) { totalWeight = sum(all section weight_rate) }
totalWeight <= 0        → 'F'
0  < totalWeight <= 20   → 'E'
20 < totalWeight <= 40   → 'D'
40 < totalWeight <= 60   → 'C'
60 < totalWeight <= 80   → 'B'
     totalWeight > 80    → 'A'
```
**Important edge case / disqualification interaction:** an *undischarged bankruptcy* sets `bankruptcyRate = 0`, and because the aggregation only sums section scores `if ($bankruptcyRate && ...)`, a zero `bankruptcyRate` leaves `totalWeight` at its initial value of `0` → automatic grade **F**, effectively hard-disqualifying the applicant **unless** the collateral short-circuit already set `totalWeight = 100` earlier in the same run — i.e., **pledging collateral that fully covers the loan overrides an undischarged-bankruptcy disqualification and still yields an `A`.** This looks like an unintended interaction the rebuild should explicitly decide on.

The result is persisted as `credit_rating.credit_rating` (letter) and `credit_rating.summary_result` (full JSON breakdown: per-section rates, weight_rate, and a human-readable `summary` sub-array for the admin UI). `getScoreCode()` / `showScore()` read this back for display.

### 2. Dead/unused alternate scoring engine — `CreditRatingLib::calculate()`
`api-v1-1/newunion/applications/common/lib/CreditRatingLib.php:23-252` (byte-identical copy also in `seedin-live-admin`). **No caller of `CreditRatingLib::calculate()` was found anywhere in the three repos** — it appears to be an earlier iteration of the scoring model that was superseded by `CreditRating::processRating()` but never deleted. It computes a **different** 7-factor average (`RATE_BORROW`, `RATE_FUND_PURPOSE`, `RATE_COMPANY_EMPLOYEES`, `RATE_OWNERSHIP`, `RATE_SALES`, `RATE_GROSS`, `RATE_GUARANTOR`), floors the average to get a 3–5 grade band (`5→A, 4→B, 3→C, else→D`), and **directly maps grade to a fixed interest rate**:
```
INTEREST_A = 4%   INTEREST_B = 4.5%   INTEREST_C = 5%   INTEREST_D = 5.5%   INTEREST_E = 5.5%
```
This is the formula that matches the domain brief's "rates a borrower A-D (mapping to a fixed interest rate)" description — **but it is dead code in the current system.** The rebuild team must decide which model is the intended source of truth; as-is, the live app only produces a letter grade with no automatic interest-rate mapping (interest/fee appears to be set manually by admin when creating the loan listing, outside this domain).

`CreditRatingLib::ProcessPledge()` (same file, `:254-328`) **is** live — called from `validateCollaterals()` as a **preview/validation** calculation shown to the borrower mid-wizard. Its collateral multipliers **differ from `processRating()`'s**:
- Inventories: `estimated_value × 0.5` (same as processRating)
- Invoices: `estimated_value × 0.5` (same as processRating)
- **Real Estate: `(estimated_value − outstanding_loan) × 0.7`** — vs. `processRating()`'s `estimated_value×0.5 − outstanding_loan`. These are materially different formulas (0.7× net-of-loan vs. 0.5×-then-subtract-loan) — an inconsistency between the "preview" shown to the borrower and the actual score computed at submission.
- `ProcessPledge`'s own A/B rating rule (`need_amount < total_pledge_amount → 'A'`) is likewise unused downstream — its `credit_rating` result field is never read by `processRating()`.

### 3. Loan eligibility / allowed-amount calculations
`CreditRating.php`:
- `allowedAmount()` (`:509`): `round((invoice_total_amount ?: borrowed_amount) * (loan_value/100))` — a lender-configurable LTV (`loan_value` field, %) applied to either total invoice value or the raw borrowed amount.
- `eligibleAmount()` (`:517`): for `INVOICE_XERO` or `INVOICE_DEFAULT` invoice types only: `round(invoice_amount() * (ELIGIBLE_RATE/100))` where `ELIGIBLE_RATE = 85` (hardcoded 85% advance rate constant). Returns `0` for QuickBooks/Freshbooks invoice types (not handled).
- `invoice_amount()` / `collateral_amount()` (`:385-459`) — aggregate collateral value across `Collateral` rows (Xero invoice totals via `xero()->total_amount`, or manual `invoice_amount`) **plus** any `pledge_result` JSON pledges (`Invoices` pledge type added at face value; `Real Estate` pledge type added net of outstanding loan, **no haircut applied** here — different again from both `processRating()` and `ProcessPledge()`).

### 4. Financial ratio engine — `FinancialStatementMaster`
`admin/newunion/applications/common/models/FinancialStatementMaster.php`. This is the "financial-ratio engine" referenced in the domain brief; it operates on the two `FinancialStatementMaster` records (`financial_a_id`/`financial_b_id`, i.e. "Year A"/"Year B") attached to each `CreditRating`, built either from Xero/QuickBooks pulls or manual entry, and is what feeds `last1_*`/`last2_*` figures used by `processRating()`'s Financial section (via the admin/user financial-statement wizard step, not automatically — the credit-rating fields `last1_sales_revenue` etc. are separately entered/synced).
- `grossMargin()` (`:503`): `round((REVENUE − SALES) / REVENUE, 1) * 100` (rounded to 1 decimal **before** the ×100, i.e. effectively rounded to nearest 10%).
- `netMargin()` (`:517`): `round(profitAfterTax / REVENUE, 1) * 100` (same rounding caveat).
- `currentMargin()` (`:531`): `round(totalCurrentAssets / totalCurrentLiabilities, 1) * 100` — the "current ratio" expressed as a %.
- `debtMargin()` (`:546`): `round(totalLiabilities / totalAllAssets, 1) * 100` — the "debt ratio" as a %.
- `preTaxMargin()` (`:561`): `round((profitAfterTax + tax + interest) / interest, 2)` — pre-tax interest coverage ratio.
- `payableTurnover()` (`:577`): `round(SALES / ACCOUNT_PAYABLES, 2)`.
- `debtorsTurnover()` (`:591`): `round(REVENUE / ACCOUNT_RECEIVABLES, 2)`.
- `gross()` (`:462`): `REVENUE − SALES`. `net()` (`:467`): `gross() − (totalOperatingExpenses + DEPRECIATION + INTEREST)`. `profitAfterTax()` (`:472`): `net() − TAX`.
- Balance-sheet roll-ups (`totalAllCurrentAssets`, `totalAllAssets`, `totalAllLtLiabilities`, `totalAllCurrentLiabilities`, `totalLiabilities`, `totalEquity`, `totalLiabilitiesAndEquity`, `totalDebit`, `totalCredit`) each fall back from an explicit "TOTAL_x" line item to summing that section's "_SUB" custom line items when the total is zero/unset (`:306-460`).

### 5. Standalone Financial Analysis tool — `FinancialAnalysis::getCalculated()`
`admin/newunion/applications/common/models/FinancialAnalysis.php:56-389`. Independent from credit-rating scoring; operates on 3 years of manually-entered or Xero/QuickBooks-pulled data (`year_end`, `period_length`, revenue, COGS, etc.), sorted latest→oldest via `sortDataInYear()`.
- **Working capital:** `debtors_days = (revenue / trade_debtors_receivables / revenue) * 365` (note: this simplifies to `365/trade_debtors_receivables` — the `revenue` terms cancel, which is almost certainly a bug; standard DSO would be `(trade_debtors_receivables/revenue)*365`). `inventory_days = (inventory/COGS)*365`. `creditor_days = (trade_creditors_payables/COGS)*365`. `working_capital_days = debtors_days + inventory_days + creditor_days`.
- **Gearing:** `debt_ratio = total_liabilities/total_assets`. `net_current_assets = total_current_assets/total_current_liabilities` (despite the name, this is actually the current ratio, not a $ net-current-assets figure). `interest_coverage_ratio = net_profit_before_interest_and_tax / interest_paid`.
- **Profitability:** `annualized_revenue = (revenue*12)/period_length`. `overheads = (total_operating_expenses*12)/revenue`. `net_operating_cash_flow = net_profit_before_tax − trade_debtors_receivables + trade_creditors_payables − inventory`.
- **Revenue growth:** `(current_year_revenue − prior_year_revenue) / prior_year_revenue * 100`, computed for latest-vs-prior and prior-vs-oldest.
- **"Power of One" sensitivity table** (`generatePowerOfOneReport`, `:259-389`): fixed ±5%/±20% what-if adjustments — Revenue +5%, COGS −5%, Overheads −5%, Debtors −20%, Stock −20%, Creditors +20% — purely illustrative, not persisted back.
- Xero auto-pull (`ServerFinancialAnalysisController::actionGrabXeroData`) computes `gross_profit_margin = GrossProfit/TotalIncome` and `net_profit_margin = net_profit_before_tax/TotalIncome` inline (both `round(x, 2)`), independent of the `FinancialStatementMaster` margin formulas above — a **third, separately-implemented** margin calculation in the codebase.

### 6. Xero / QuickBooks → Financial Statement field mapping (credit rating step)
`ServiceCreditRatingController::postGrabQuickBooksData` (`:792-1113`) maps QuickBooks report line labels to internal `FinancialTypes` codes, e.g. `TOTAL_EXPENSES←"TOTAL EXPENSES"`, `SALES←"SALES"`, `REVENUE←"TOTAL INCOME"`, `CASH←"TOTAL BANK ACCOUNTS"`, `CURRENT_ASSETS←"CURRENT ASSETS"`, `ACCOUNT_RECEIVABLES←"ACCOUNTS RECEIVABLE"`, `LONG_TERM_LIABILITIES←"LIABILITIES"`, `CURRENT_LIABILITIES←"CURRENT LIABILITIES"`, `ACCOUNT_PAYABLES←"ACCOUNTS PAYABLE"`, `CURRENT_BORROWING←"TOTAL OTHER CURRENT LIABILITIES"`, `SHARE_CAPITAL←"OPENING BALANCE EQUITY"`, `RETAINED_EARNINGS←"RETAINED EARNINGS"`. Report data is cached per `(auth_id, type, page)` in `QuickBooksData`/`XeroData` tables so repeated pulls don't re-hit the third-party API. QuickBooks invoice sync is hardcoded to only import invoices where `CurrencyRef->value == 'USD'` (`Collateral.php:120`, comment above it still says `//if SGD`) — likely a bug/leftover from currency-handling changes.

## Data Model

Primary table: **`credit_ratings`** (model `CreditRating`, PK `credit_rating_id`). Key columns inferred from AR usage:
- Identity/linkage: `user_id`, `company_id`, `client_id` (→`CreditClient`), `financial_a_id`/`financial_b_id` (→`FinancialStatementMaster`), `restructure_credit_rating_id`, `credit_rating_id_src`.
- Application data: `borrowed_amount`, `purpose`/`fund_purpose`, `total_months`, `loan_value` (LTV %), `industry`.
- Company/contact: `company_name`, `company_address`, `company_province`, `company_city`, `company_postal`, `company_phone`, `company_employees`, `ownership` (Y-M), `entity_type`, `contact_name/surname/address/email/telephone`.
- Financials (2 years, entered/synced separately from `FinancialStatementMaster`): `last1_sales_year`, `last1_sales_revenue`, `last1_gross_profit`, `last1_net_profit`, `last2_*` equivalents, `is_audited`.
- Collateral/pledge: `pledge_properties` ('Yes'/'No'), `pledge_result` (JSON blob of pledge line items), `invoice_type` (`INVOICE_DEFAULT|XERO|QUICKBOOKS|FRESHBOOKS`), `invoice_no`, `invoice_amount`, `invoice_attachment`.
- Guarantor/notice (×2): `guarantor{n}_name`, `_nric`, `_status` (`GUARANTOR_LOCAL|PR|FOREIGNER`), `_ass_yr1`/`_ass_yr2` (assessment years), `_ass_yr1_amount`/`_ass_yr2_amount`, `_facebook`/`_twitter`/`_instagram`.
- Bankruptcy: `bankruptcy_history`, `bankruptcy_discharge`, `bankruptcy_year`.
- Documents: `memorandum`, `bizfile`, `last1_supporting_doc`, `last2_supporting_doc`.
- Workflow/status: `status` (0 Incomplete,1 Pending,2 Reviewing[deprecated],3 Approved,4 Rejected,5 Cancelled,6 BD Approval,7 BD Approved), `has_reviewer`, `confirm_1`/`confirm_2` (dual-approval flags gating `canAddListing()`/`canAddBorrowListing()`), `reviewed_by`, `is_approved`, `is_offline`, `is_original`, `is_deleted`/`deleted_at`, `reference_url`, `reason`.
- Scoring output: `credit_rating` (letter A–F), `summary_result` (JSON breakdown), `data` (free-form JSON, e.g. `review_stages`).
- Misc: `ip_address`, `reference_code`.

**Child / related tables:**
- `credit_rating_directors` (`CreditRatingDirectors`) — director KYC: `photo_id_file`, `proof_residence_file`, linked `credit_rating_id`.
- `credit_rating_shareholders` (`CreditRatingShareholders`) — shareholder KYC: `photo_id_file`, `proof_residence_file`, `m_aa` (memorandum & articles of association upload).
- `credit_rating_attachments` (`CreditRatingAttachment`, PK `cr_attachment_id`) — free-form supporting doc uploads, `cr_id`, `filename`.
- `credit_rating_reviews_history` (`CreditRatingReview`, PK `review_id`) — admin review actions: `review_type` (Rejected/Approved/Edited/Reviewed), `credit_rating_id`, `date_created`.
- `credit_rating_history` (`CreditRatingHistory`, PK `history_id`) — audit trail: `type` (Created online/offline, Reviewed, Modified, Approved, Rejected, Funded, Closed, Reverted, Deleted, Modified/Added Jarvis), `data` (JSON old/new-val diff), `admin_id`/`user_id`, `name`.
- `credit_rating_message_history` (`CreditRatingMessageHistory`) — admin↔borrower message log, `admin_id`, `credit_rating_id`.
- `credit_dashboard_clients` (`CreditClient`, PK `client_id`) — a borrower "client" record (one company can have multiple credit-rating applications over time); generates sequential `reference_code` (`AC{client_id}-{loan_seq}`).
- `collateral` (`Collateral`, PK `id`) — pledge/invoice line items: `collateral_type` (Invoice/Real Estate/Inventories), `invoice_type` (Default/Xero/QuickBooks), `invoice_id`, `invoice_amount`, `invoice_no`, `estimated_value`, `outstanding_loan`, `credit_rating_id`, `currency`.
- `financial_statement_master` (`FinancialStatementMaster`, PK `statement_master_id`) — one per "Year A"/"Year B" per credit rating: `user_id`, `cutoff` (date).
- `financial_statement` (`FinancialStatement`, PK `statement_id`) — line items: `statement_master_id`, `statement_name` (→`financial_types.statement_name`), `amount`, `custom_name` (for "_SUB" custom rows).
- `financial_types` (`FinancialTypes`, PK `statement_name`) — chart-of-accounts lookup: `multiplier` (+1/−1 for debit/credit sign), `sort`.
- `financial_analysis` (`FinancialAnalysis`, PK `id`) — standalone tool: `user_id`, `status` (Draft/Complete), `data` (JSON, 3 years of P&L/BS figures), `api_data` (raw Xero/QB pull cache).
- `user_loan_risk` (`UserLoanRisk`) — a per-user risk record with a 365-day freshness window (`getRisk()`); referenced but not clearly wired into `processRating()` in the files reviewed — needs further tracing if used elsewhere.
- `get_crc_investments` (`CRC` model) — CRC (Credit Risk Committee?) investment/funding tracking, monthly aggregation for charts; tangential to scoring.
- Xero/QuickBooks integration tables referenced but out of this domain's core (`XeroAuth`, `XeroData`, `XeroInvoice`, `QuickBooksAuth`, `QuickBooksData`) — store OAuth tokens and cached report payloads keyed by `(auth_id, type, page)`.
- Jarvis integration relations exist on `CreditRating` (`jarvis_application`, `jarvis_financials`, `jarvis_owners`, `credit_bureau_reports`, `guarantors`, `behavioural`, `customer_level`) — a third-party/alternate credit-bureau data source linked 1:1 via `credit_rating_id = application_id`, present in `relations()` but no controller logic for it was found in the files reviewed (likely lives in a module not covered by the inventory list — flag for follow-up).

## Cron/Automation Dependencies

- **No live scheduled job was found that touches this domain.** `CronController`/`ServerCronController` and `CronJob.php` contain no credit-rating-specific job types.
- `seedin-live-api-v1-1/newunion/cron/protected/commands/trash/ImportCreditRatingDataCommand.php` — a one-off console command (sits in a `trash/` folder, i.e. deprecated) that bulk-migrated legacy `credit_ratings_original` rows into the current `credit_ratings` schema and called `processRating()` on each; not part of any active schedule.
- Xero/QuickBooks data pulls are **synchronous, user-triggered** (button click during the wizard), not polling/cron-based. Report payloads are cached indefinitely per `(auth_id, type, page)` — there's no refresh/expiry logic visible, so once pulled, figures are never re-synced automatically.

## Integrations

- **Xero** (accounting) — OAuth via `XeroAuth`/`XeroLib`; pulls Organisation info, Profit & Loss, Balance Sheet, and AUTHORISED SGD invoices due within 15 days (used as collateral). Feeds both the credit-rating `FinancialStatementMaster` and the standalone `FinancialAnalysis` tool (different field-mapping code paths for each).
- **QuickBooks** (accounting) — OAuth via `QuickBooksAuth`/`QuickBookLib`; pulls Company info, P&L, Balance Sheet, and invoices due within 15 days filtered to **USD currency only** (`Collateral.php:120`, contradicting an adjacent comment referencing SGD). Same dual-consumer pattern as Xero.
- **Email** (`EmailLib::send`) — application-submitted notification to admin (`Yii::app()->params['admin_email']` + cc list) and to the borrower, rendering the same `creditrating/view` partial with `isadmin` toggled.
- **Telegram** (`Telegram::log`) — logs "submitted a loan application" on final submit.
- **Jarvis** — relations present on `CreditRating` for `JarvisSmeApplicationProductData`, `JarvisFinancialData`, `JarvisOwnerData`, `JarvisCreditBureauReport`, `JarvisSmeGuarantorsData`, `JarvisSmeBehaviouralData`, `JarvisSmeCustomerLevel` — an external credit-bureau/KYC data source keyed by `credit_rating_id`. No processing logic for these was found in the files inventoried; likely lives in modules outside the given path list — flag for a follow-up pass if Jarvis is still active.
- **Freshbooks** — `CreditRating::INVOICE_FRESHBOOKS` constant exists but no corresponding pull/integration code was found anywhere searched — looks like a placeholder that was never implemented.
- **File storage** — local disk uploads (`Yii::app()->params['dir_credit_rating']`, `dir_credit_rating_supporting_doc_1/2`, `dir_identity`) with a secondary `BucketLib::uploadBucket()` call for attachments (cloud bucket mirror) only wired into the `validateOptional` attachment path, not into the director/shareholder KYC upload path (`CreditRating::uploadDocument`) — inconsistent backup coverage.

## Tech Debt / Risks Observed

- **Two incompatible scoring engines coexist.** `CreditRating::processRating()` (live, A–F, no interest-rate output) vs. `CreditRatingLib::calculate()` (dead code, A–D, direct 4%–5.5% interest mapping — matches the domain brief's description but is never called). The rebuild needs an explicit decision on which model is authoritative; carrying both forward unexamined would perpetuate confusion.
- **Collateral valuation formula is implemented three different ways** in the same codebase: `processRating()` (real estate: `value×0.5 − loan`), `CreditRatingLib::ProcessPledge()` (real estate: `(value−loan)×0.7`, used only as a borrower-facing preview), and `CreditRating::collateral_amount()`/`invoice_amount()` (real estate pledge: `value − loan`, no haircut at all). These will silently disagree with each other for any real-estate-collateral application.
- **Undefined class constants referenced in dead-looking methods.** `CreditRating::canUserSeeDetails()`, `rejectCreditRating()`, `approveCreditRating()` (`CreditRating.php:779-1389`) reference `self::STAT_PENDING`, `STAT_CREDIT_REJECTED`, `STAT_LISTING_CREATED`, `STAT_UNSUCCESSFUL`, `STAT_CREDIT_APPROVED` — none of these constants exist in the class (the real ones are `STATUS_*`-prefixed). Calling these methods would throw a PHP fatal error; they appear to be unreachable/legacy code left in place.
- **Undischarged-bankruptcy disqualification can be bypassed by the collateral short-circuit.** See Business Logic §1 — pledging enough collateral yields grade `A` even when the applicant has an undischarged bankruptcy, because the "force totalWeight=100" branch runs before the bankruptcy zero-out check.
- **Likely bug in `debtors_days` formula.** `FinancialAnalysis::getCalculated()` computes `debtors_days = (revenue / trade_debtors_receivables / revenue) * 365`, which algebraically reduces to `365 / trade_debtors_receivables`, dropping revenue entirely — almost certainly should be `(trade_debtors_receivables / revenue) * 365` (standard Days Sales Outstanding).
- **Three separately-implemented margin/ratio calculations** for what should be the same figures: `FinancialStatementMaster::grossMargin()/netMargin()` (rounds to nearest 10% due to `round(x,1)` before `×100`), `FinancialAnalysis`'s power-of-one/profitability tables, and the inline Xero-pull `gross_profit_margin`/`net_profit_margin` computation in `ServerFinancialAnalysisController::actionGrabXeroData`. No shared ratio library.
- **QuickBooks invoice import filters to `CurrencyRef->value == 'USD'`** (`Collateral.php:120`) with an adjacent comment still referencing SGD — looks like an unresolved currency-handling regression; SGD-currency QuickBooks users would get zero invoices imported as collateral.
- **Hardcoded business constants scattered in code, not configuration:** `ELIGIBLE_RATE = 85` (85% advance rate), `INTEREST_A..E` (4%–5.5%, in the dead lib), admin notification email lists as PHP string constants (`CreditRating::ADMIN_EMAIL`, `CRC::ADMIN_EMAIL` — personal Gmail addresses embedded in source), fixed 15-day invoice due-date windows for both Xero and QuickBooks pulls, fixed min/max wizard amounts (`$10,000`/`$20,000` in `CreditRatingController::actionIndex`, which look like a stale/inconsistent range).
- **`validateInvoice()` (manual invoice entry) is dead-disabled** (`if (false and ...)` at `ServiceCreditRatingController.php:635`) — manual (non-Xero/QuickBooks) invoice collateral entry does not currently function despite `INVOICE_DEFAULT` being a supported `invoice_type` elsewhere.
- **No visible refresh/expiry on cached Xero/QuickBooks report data** — `QuickBooksData`/`XeroData` rows are looked up by `(auth_id, type, page)` and only fetched from the API if missing; a stale prior-year P&L pull would never be refreshed automatically.
- **Schema not tracked in migrations** — `credit_ratings` and all related tables were not found in any Yii migration file in either repo, meaning the authoritative schema only exists as a live DB dump; the rebuild will need a fresh schema dump/introspection rather than relying on migration history.
- **Inconsistent file-backup coverage** — `BucketLib::uploadBucket()` (cloud mirror) is called for free-form attachments but not for director/shareholder KYC documents or the credit-rating's own memorandum/bizfile uploads, meaning some legally-important KYC documents may only exist on local disk.
- **Jarvis and Freshbooks integrations are only stub/relation-level** — `INVOICE_FRESHBOOKS` constant with no implementation; Jarvis relations with no processing logic found in the inventoried paths — both need a follow-up investigation before the rebuild decides whether to carry them forward.

## Proposed MVP Scope for Revamp

**Must-have:**
- Multi-step borrower application wizard (understanding → particulars → financials → collateral/pledge → guarantor/notice → bankruptcy → attachments) — this is the core data-capture surface every downstream process depends on.
- A single, decided, correctly-specified **weighted scoring engine** (resolve the `processRating()` vs. `CreditRatingLib::calculate()` conflict; pick one formula set, document it, and make the collateral-covers-loan short-circuit and bankruptcy-disqualification interaction an explicit, tested business rule rather than an emergent one).
- Collateral/pledge capture and valuation using **one consistent formula** (resolve the three-way real-estate-haircut discrepancy).
- Financial statement entry (manual) with the balance-sheet/P&L roll-up logic (`totalAllAssets`, `totalLiabilities`, margins, etc.) — needed both for scoring and for underwriter review.
- Admin review workflow: list/view/edit application, approve/reject, review-stage tracking, audit history (`CreditRatingHistory`) — CRC cannot operate without this.
- Director/shareholder KYC document capture — required for underwriting and likely regulatory compliance.
- Email notification to admin + borrower on submission — core to the operational handoff.

**Nice-to-have / defer:**
- **Xero/QuickBooks auto-pull integrations** — valuable UX but adds significant third-party-API surface; can launch v1 with manual entry only and layer in one provider (pick the one with more current usage) post-MVP.
- **Standalone Financial Analysis tool** (ratio/margin report, "power of one" sensitivity tables) — functionally separate from underwriting itself; useful borrower self-service but not required to originate a loan. Defer and rebuild its ratio math correctly (fixing the DSO bug) rather than porting as-is.
- **Freshbooks integration** — never implemented; drop unless there's active demand.
- **Jarvis credit-bureau integration** — unclear current usage from the inventoried code; needs a dedicated investigation before deciding to port.
- **Telegram logging** — nice operational signal, trivial to defer or replace with a general activity-log/observability solution.
- **Restructure-credit-rating linkage** (`restructure_credit_rating_id`, `getRestructureLinks()`) and **offline/manual credit-rating creation** (`is_offline`) — edge-case admin workflows; can be added after the primary online flow is solid.
- **`CreditClient` cross-application reference-code sequencing** — nice for repeat-borrower tracking but can be simplified/deferred if v1 only needs one application per company at a time.
