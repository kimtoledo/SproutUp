# User Accounts, KYC & Onboarding

> **Revamp direction:** The target platform is for Philippine SME borrowers and investors. Singapore/MAS-specific rules below document legacy behavior only and must not be treated as approved revamp requirements without an explicit compliance decision.

## Overview

This domain covers the full lifecycle of a SeedIn / New Union (Singapore) account, from public registration through KYC document capture to admin approval and ongoing profile maintenance. It spans three repos that together implement one logical flow:

- **`seedin-live-user`** (public-facing "frontend" Yii app) — marketing/registration pages, login, the onboarding wizard views (`profile → address → bank → income → document`), and lightweight proxy models (`Company`, `Bank`) that mirror form shapes rather than touching the DB directly.
- **`seedin-live-api-v1-1`** (`services` Yii app) — the actual REST-ish JSON API (`ServiceRegisterController`, `ServiceProfileController`, `ServiceUserController`) that the user app and mobile apps call. This is where registration, OTP, CKA/SAT submission, escrow/KYC updates, bank CRUD, and login really happen. It shares the same `common/models` layer used by the `backend` (admin) app in the same repo.
- **`seedin-live-admin`** (staff-facing "backend" Yii app) — the admin console for reviewing/approving accounts (`CustomerController`, `ServerCustomerController`, `ServerUserController`), viewing CKA/SAT answers, editing KYC/escrow data on a customer's behalf, bulk CSV import of legacy accounts, and DocuSign contract dispatch.

**Users of this domain:**
- **Borrower / Fund-seeker** (`dashboard_type = DASHBOARD_FUNDSEEKER`) — registers, completes company + KYC profile, signs contract, gets approved to raise funds.
- **Investor** (`dashboard_type = DASHBOARD_INVESTOR`) — registers, completes individual/corporate profile, CKA (all investors) + SAT (retail investors only) assessments, Singaporean/Foreigner escrow wealth declaration, bank details, signs contract, gets approved to invest.
- **Introducer/Affiliate** — refers investors/borrowers via referral tokens/codes; not itself part of this domain's account model but `parent_id`/`introducer_id` on `User` link back to it.
- **Admin/Credit staff** — reviews, edits, approves/rejects profiles; can act as an "introducer" with restricted scope (`Yii::app()->user->isIntroducer()`).
- **System/automated** — DocuSign contract dispatch, OTP delivery (SMS/email), CSV bulk-importer for legacy account migration, email/Telegram notifications on status change.

The platform is multi-tenant: the same codebase serves "SeedIn Philippines" (`User::SOURCE_SEEDIN`), the white-labelled "PitakaMo" mobile lending product (`User::SOURCE_PITAKAMO`), and "New Union" Singapore — with jurisdiction-specific logic (Singaporean/Foreigner/PR citizen types, SGD escrow wealth declarations, Singapore country-id `108` hardcoded) layered on top of Philippines-specific defaults (Philippine bank list, PHP-focused identity document types). See Tech Debt section.

## Current Features & Flows

### User app (`seedin-live-user`, frontend Yii app)

| Controller/Action | Description |
|---|---|
| `SiteController::actionSignup` | Renders the signup page; redirects logged-in users to dashboard. `/Users/kimarvintoledo/Projects/seedin/seedin-live-user/newunion/applications/frontend/controllers/SiteController.php:108` |
| `SiteController::actionLogin` | Logs out then redirects to `/#login` (SPA-style login modal). `SiteController.php:130` |
| `SiteController::actionAccess` | Admin "login as user" bridge — decrypts a one-time code from the admin app, calls `User/Access` API, sets local session. `SiteController.php:151` |
| `SiteController::actionVerify` | Legacy email-verification link handler; sets `User::STATUS_CONFIRMED` (constant doesn't exist — see Tech Debt). `SiteController.php:193` |
| `SiteController::actionResetPassword` / `actionRequestPassword` | Password-reset request/consume flow via `Password/VerifyToken` service call. `SiteController.php:61,84` |
| `SiteController::actionFblogin` / `actionFbcallback` | Facebook OAuth login/registration bridge. `SiteController.php:466,530` |
| `RegisterController::action{Billionaire,Crowdfund,Wealth,Crowdfunding4u}*` | Landing-page variants for marketing-driven signup funnels (A/B campaign pages), each sets `Yii::app()->session['reg_name']` for attribution. `/Users/.../RegisterController.php` |
| `ServerUserController` (frontend `server/`) — KYC/escrow/director/document/reference/bank AJAX endpoints (proxy to `common/lib/UserLib.php`, shared with admin) | `/Users/kimarvintoledo/Projects/seedin/seedin-live-user/newunion/applications/frontend/controllers/server/ServerUserController.php` (996 lines — same shape as admin's, calling `UserLib::UpdateEscrow`, etc.) |
| `ServerMobileOtpController::actionForm` / `actionValidateOtpMobile` | Renders mobile-OTP verification form and proxies `Profile/ValidateOtpMobile`. `/Users/.../ServerMobileOtpController.php:5,22` |
| Views: `frontend/views/register`, `frontend/views/site`, `frontend/views/kyc`, `frontend/views/escrow`, `frontend/views/account` | Onboarding wizard steps, KYC forms, escrow wealth-declaration forms, account settings pages. |

### API / services app (`seedin-live-api-v1-1`, the real business logic)

| Endpoint (Controller::method) | Description |
|---|---|
| `ServiceRegisterController::postSave` | Main registration: validates `UserForm`+`CompanyForm`, creates `User` via `User::create()`, sets source (SeedIn/PitakaMo), links affiliate/referral, auto-logs-in, issues API key, sends welcome + "thank you for signing up" emails. `/Users/kimarvintoledo/Projects/seedin/seedin-live-api-v1-1/newunion/applications/services/controllers/ServiceRegisterController.php:72` |
| `ServiceRegisterController::postPitakaMoSave` | Mobile-only registration variant for the PitakaMo white-label, keyed by mobile number. `ServiceRegisterController.php:16` |
| `ServiceRegisterController::postValidate` | Pre-registration form validation + sends mobile OTP (rate-limited via `OtpAttempts::reachLimit`). `ServiceRegisterController.php:274` |
| `ServiceRegisterController::postFBSave` | Facebook-token registration/login, auto-creates account if e-mail not found. `ServiceRegisterController.php:358` |
| `ServiceUserController::postLogin` | Username/password login, issues `UserApiKey`, tracks device id/app version/OS, resets `login_attempts`. `/Users/.../ServiceUserController.php:18` |
| `ServiceUserController::postLogout` | Invalidates API key. `ServiceUserController.php:165` |
| `ServiceUserController::postFBLogin` / `postAccess` | Facebook login; admin "login-as" bridge. `ServiceUserController.php:273,417` |
| `ServiceUserController::postConfirmInvestor` | Submits CKA (all investors) + SAT/`AssessmentForm` (retail investors only) in one call. `ServiceUserController.php:576` |
| `ServiceUserController::postAcceptRisk` | Records Risk Disclosure Statement acceptance (`UserLoanRisk`) — only once, only for completed investors. `ServiceUserController.php:643` |
| `ServiceUserController::postUpdateOcbcNotice` | Toggles an OCBC-fund notice flag — uses `eval()` on POST input (see Tech Debt/security). `ServiceUserController.php:548` |
| `ServiceUserController::getApproveReferral` | Consumes a referral token to link introducer/parent. `ServiceUserController.php:702` |
| `ServiceProfileController::postSaveACK` | Legacy single-question CKA save (v1), sets `user_type = TYPE_EXPERIENCED_INVESTOR`. `/Users/.../ServiceProfileController.php:27` |
| `ServiceProfileController::postConfirmAI` | Accredited-investor self-declaration: sets `confirm_ai = true`, `user_type = TYPE_ACCREDITED_INVESTOR`. `ServiceProfileController.php:125` |
| `ServiceProfileController::postDashboardConfirmed` | First-time dashboard-type selection (Investor vs Fundseeker); blocks switching once set; warns if switching away from a pending Fundseeker credit-rating application. `ServiceProfileController.php:144` |
| `ServiceProfileController::postUploadProfile` | Multi-form file upload dispatcher — routes `UserForm`/`KycForm`/`EscrowForm`/`DirectorForm` files to the right model's `saveFile()`. `ServiceProfileController.php:226` |
| `ServiceProfileController::postUpdateKyc` | Saves `KycForm` (PEP/tax/declarations) + `EscrowForm` wealth fields onto `UserKyc`/`UserEscrow`. `ServiceProfileController.php:313` |
| `ServiceProfileController::postUpdateEscrow` | The core onboarding-wizard step-saver for web; delegates to `UserLib::UpdateEscrow()`. `ServiceProfileController.php:394` |
| `ServiceProfileController::postUpdate` | Same as above but for the mobile onboarding step machine (`mobile_profile1…mobile_document`). `ServiceProfileController.php:500` |
| `ServiceProfileController::postUpdateIncome` / `postUpdateTin` | Standalone income/TIN updates (TIN update marked `@apiDeprecated`, superseded by `UpdateEscrow`). `ServiceProfileController.php:1182,1210` |
| `ServiceProfileController::postSaveDocument` / `postRemoveDocument` | Identity/address/business `UserDocument` upload & delete. `ServiceProfileController.php:782,849` |
| `ServiceProfileController::postSaveReference` / `postRemoveReference` | Business reference contact CRUD (fundseeker KYC). `ServiceProfileController.php:882,921` |
| `ServiceProfileController::postUpdateBank` / `getBank` / `postBankSetPrimary` / `postBankDelete` | Bank-account CRUD + primary-account selection. `ServiceProfileController.php:979,1064,1104,1136` |
| `ServiceProfileController::postValidateOtpMobile` / `postConfirmOtpMobile` | Two-step mobile-OTP verification, optionally enabling SMS 2FA (`UserSecurity.otp_enabled` / `mobile_otp_enabled`). `ServiceProfileController.php:1241,1300` |
| `ServiceProfileController::postBackOnBoard` / `postBack` / `postGoto` | Onboarding step navigation helpers (back/forward/jump). `ServiceProfileController.php:1364,1377,1410` |
| `ServiceProfileController::postPitakaMoUpdate` | PitakaMo-specific profile field update. `ServiceProfileController.php:1467` |
| `ImportController` (backend, in api repo) | Renders legacy-migration CSV import job review UI. `/Users/.../backend/controllers/ImportController.php` |

### Admin dashboard (`seedin-live-admin`)

| Controller/Action | Description |
|---|---|
| `CustomerController::actionInvestor` / `actionBorrower` / `actionList` | List views filtered by dashboard type. `/Users/.../CustomerController.php:5,18,72` |
| `CustomerController::actionView($id)` | Full customer detail page (profile, KYC, escrow, requests, activity). `CustomerController.php:82` |
| `CustomerController::actionCKA($id)` | Renders the submitted CKA answers (`ckav{version}` template picked by `user->cka->version`). `CustomerController.php:149` |
| `CustomerController::actionSat($id)` | Renders the SAT/`AssessmentForm` answers. `CustomerController.php:162` |
| `CustomerController::actionAccess($id)` | Generates the encrypted "login as user" code and redirects staff into the user app. `CustomerController.php:133` |
| `CustomerController::actionDocusign` | Renders DocuSign status panel. `CustomerController.php:173` |
| `CustomerController::actionGroups` / `actionGroup` / `actiongroupDownload` | "Reserve member" group management + XLSX export of group members. `CustomerController.php:181,241,187` |
| `CustomerController::actionTransactions` / `actionActivities` / `actionDownloadTransaction` | Paginated transaction/activity history + XLSX export. `CustomerController.php:249,289,320` |
| `ServerCustomerController::actionUpdateStatus($id)` | Approve/reject a pending profile — the central admin decision point (delegates to `UserLib::updateStatus`). `/Users/.../server/ServerCustomerController.php:370` |
| `ServerCustomerController::actionUpdate` / `actionCreate` | Admin edit/create of a customer record (multi-step file-upload aware). `ServerCustomerController.php:385,519` |
| `ServerCustomerController::actionResetProfile` | Puts an approved profile back into an editable "reset" state (re-KYC flow). `ServerCustomerController.php:1172` |
| `ServerCustomerController::actionTopupCreditLine` / `actionDeductAvailableFund` | Admin-adjustable investor credit line / fund balance. `ServerCustomerController.php:671,710` |
| `ServerCustomerController::actionDocusignMarkComplete` / `actionDocusignList` | Manual override to mark a DocuSign envelope complete; list envelopes. `ServerCustomerController.php:846,796` |
| `ServerCustomerController::actionVistraUpdate` | Tracks whether documents were sent to/received from Vistra (SG corporate-services/trust provider) for corporate KYC. `ServerCustomerController.php:842` |
| `ServerCustomerController::actionSaveSummary` / `actionSummarycontent` | Inline admin edit of core account fields (status, source, dashboard type, priority-investor flag/expiry, email, password). `ServerCustomerController.php:836,831` |
| `ServerCustomerController::actionAddComment` / `actionComments` | Internal admin notes on a customer. `ServerCustomerController.php:1151,1347` |
| `ServerCustomerController::actionRetag` | Bulk tag management for customer segmentation. `ServerCustomerController.php:1677` |
| `ServerUserController::actionSubmitACK` | Admin-side CKA submission on behalf of a user (mirrors `postSaveACK`). `/Users/.../server/ServerUserController.php:13` |
| `ServerUserController::actionUpdateEscrow` | Admin edit of escrow/onboarding fields (same `UserLib::UpdateEscrow` path as the user app). `ServerUserController.php:63` |
| `ServerUserController::actionDirectorForm` / `actionRemoveDirector` | Corporate director/shareholder CRUD. `ServerUserController.php:113,118` |
| `ServerUserController::actionSaveDocument` / `actionRemoveDocument` | Identity/address/business document CRUD (admin side). `ServerUserController.php:129,195` |
| `ServerUserController::actionSaveReference` | Business reference CRUD (admin side). `ServerUserController.php:240` |
| `ServerUserController::actionSaveBank` / `actionBankSetPrimary` / `actionBankUpdateStatus` / `actionRemoveBank` | Bank CRUD + approve/reject (admin side). `ServerUserController.php:274,317,337,373` |
| `ServerImportController::actionUpload` / `actionImportProcess` / `actionGeneratePW` | Legacy CSV bulk-import of investor accounts + bank + historical fund transactions + investments; auto-generates and emails/SMS's a password. `/Users/.../server/ServerImportController.php:14,60,430` |
| `RunController::actionChangeUserType` | Cron-style HTTP endpoint: bulk-reclassifies users from a CSV to "experienced investor", clears their company. `/Users/.../backend/controllers/RunController.php:55` |
| `RunController::actionExecuteJobs` | Processes queued `CronJob` rows (e.g. `notify_newpassword` → sends generated-password email/SMS). `RunController.php:5` |
| `UserCommand` (console) | Ops CLI: `sanitize`, `summary` (status funnel counts), `detail`, `otpsmstest`/`otpemailtest`, fund-balance reconciliation tools. `/Users/.../cbase/commands/UserCommand.php` |

## Business Logic & Computations

### 1. Account status state machine
`User` status constants (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/models/User.php:9-19`):
```
STATUS_NEW (0) → STATUS_REG_REJECTED (1)
STATUS_VERIFIED (2)        // "incomplete" — freshly registered, editable
STATUS_PROFILE_PENDING (3) // submitted, awaiting DocuSign + admin approval
STATUS_PROFILE_APPROVED (4)
STATUS_PROFILE_REJECTED (5)
STATUS_DELETED (6)
```
Transitions are centralized in `User::statusUpdate()` (`User.php:1819-1917`), which:
- On `STATUS_PROFILE_APPROVED`: awards pending referral points (`PointsLib::AddFriendReward`), swaps in the reset-profile DocuSign doc id if this was a re-KYC, marks the doc `STATUS_COMPLETED`/`is_signed=1`, sends approval email/notification.
- On `STATUS_PROFILE_REJECTED`: branches on `rejectType` — `REJECT_TYPE_INSUFFICIENT` calls `$user->resetProfile()` (reverts to `STATUS_VERIFIED`, clears `doc_id`, archives the cached contract PDF) so the user can resubmit; `REJECT_TYPE_UNSUITABLE` and the default type leave the user rejected outright and clear the pending `Request::TYPE_PROFILE_APPROVAL` row.
- Every transition fires the matching `EmailLib`/`Notification` pair.

`UserLib::updateStatus()` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/lib/UserLib.php:579-698`) is the actual admin-triggered wrapper: it requires a `dashboard_type` to be set, requires a `reason` when rejecting, and — the key gate — **on approval it first sends the DocuSign contract if the investor/fundseeker hasn't signed yet** (`DOCUSIGN_INVESTOR`/`DOCUSIGN_FUNDSEEKER` feature flags), and only calls `User::statusUpdate()` to actually flip to `STATUS_PROFILE_APPROVED` once a signed/sent contract exists.

### 2. Onboarding-wizard progress calculation
`User::progress($type='web')` (`User.php:1174-1215`):
- `STATUS_PROFILE_PENDING` → 90% if fundseeker, 80% otherwise.
- `STATUS_PROFILE_REJECTED` → 75%.
- `STATUS_PROFILE_APPROVED` → 100%.
- Otherwise, mapped from the current `on_boarding_step`/`on_boarding_step_mobile` value: `profile→30, address→40, bank→50, income→60, document→70` (mobile equivalents `mobile_profile1→30 … mobile_document→70`). Default 30 if step unset.

`User::hasDashboardAccess()` (`User.php:1217-1226`): investors need `progress()==100`; fundseekers only need `progress()>=75` (i.e. can access the dashboard once past rejection, before final DocuSign completion).

Step ordering: `onBoardingSteps()` = `[profile, address, bank, (income — investors only), document]` (`User.php:2647-2656`); mobile equivalent is a fixed 5-step list. `nextStep()`/`prevStep()` (`User.php:2665-2700`) walk this array against the user's current step field.

### 3. Onboarding step-save orchestration (`UserLib::UpdateEscrow`)
`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/lib/UserLib.php:210-390` — used identically by the web onboarding (`postUpdateEscrow`) and mobile (`postUpdate`) endpoints:
1. Picks a `UserForm` validation *scenario* dynamically: `update_investor`/`update_fundseeker` + `_{on_boarding_step}` suffix (e.g. `update_investor_income`), so each wizard step only validates its own fields.
2. On the final ("document") step, if an `otp_code` is present it is validated via `OTPLib::validate()` before the save is allowed to become `saveType=final`.
3. Advances `on_boarding_step`/`on_boarding_step_mobile` to the computed `nextStep()`, and tracks the *high-water mark* `on_boarding_last_step`/`on_boarding_last_step_mobile` (only ever moves forward, via an index comparison against `array_flip(onBoardingSteps())`) — this lets the UI show "furthest step reached" even if the user navigates back.
4. When the wizard reaches `submit`, it immediately triggers a mobile-OTP send (`OTPLib::send`) as the final verification gate before submission.
5. Delegates the actual field persistence to `User::updateProfile()` (`User.php:311-389`), which is transactional and, on `saveType=final` (non-admin), flips status to `STATUS_PROFILE_PENDING` (or `is_reset_profile = RESET_PROFILE_PENDING` if this is a re-KYC) and creates/reopens the `Request::TYPE_PROFILE_APPROVAL` (or `TYPE_PROFILE_RESET_APPROVAL`) row for admin review.

### 4. CKA (Customer Knowledge Assessment) and SAT (Suitability Assessment)
- **CKA** (`CKAV1Form`, `/Users/kimarvintoledo/Projects/seedin/seedin-live-api-v1-1/newunion/applications/common/forms/CKAV1Form.php`): 4 yes/no knowledge questions (q1–q4) about understanding unlisted/high-risk investment products; each "yes" answer conditionally requires a follow-up sub-answer (`q1_yes`, `q2_yes`, `q3_yes_1..3`, and for CKA version 2 `q4_yes_1`/`q4_yes_2` instead of a single `q4_yes`). Two agreement checkboxes (`agree_1`, `agree_2`) are always required. Answers are stored as a JSON blob on `cka_answers.data` (`CKAAnswer::CURRENT_VERSION = 2`). **There is no computed pass/fail score** — the questionnaire is a self-declaration capture, not an automated eligibility gate; version 1 (legacy, `ServiceProfileController::postSaveACK`) is a simpler single-submission form that can only be submitted once (`if (!$user->cka)`).
- **SAT / Risk profile** (`AssessmentForm`, `/Users/kimarvintoledo/Projects/seedin/seedin-live-api-v1-1/newunion/applications/common/forms/AssessmentForm.php`): 5 required multiple-choice questions (loss tolerance, 10-year lock-up tolerance, return preference, investment objective, risk tolerance `Conservative/Balanced/Aggressive`), each validated to be `> 0` (i.e. "an option was chosen"), stored on `user_assessment`. **Only required for retail investors** (`User::isRetailInvestor()`), not for accredited/qualified investors — enforced in `ServiceUserController::postConfirmInvestor` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-api-v1-1/newunion/applications/services/controllers/ServiceUserController.php:576-641`): `if ($user->isRetailInvestor()) { $validateForms[] = $AssessmentForm; ... }`.
- **Risk Disclosure Statement acceptance**: `ServiceUserController::postAcceptRisk()` (`ServiceUserController.php:643-670`) — only allowed once (`!UserLoanRisk::hasRisk($user_id)`), only for a completed (`isCompleted()` = profile approved) investor; records IP address and an activity log entry (`Activity::TYPE_RDS_ACCEPTED`).

### 5. Accredited-investor / wealth-source suitability (escrow) requirements
Business rules live in `EscrowRequiredValidator` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/validators/EscrowRequiredValidator.php`), applied to `EscrowForm` fields on `create`/onboarding-step save:
- Always requires address fields (`add_1_bldg_name, add_1_street, add_1_unit_no, add_1_country, add_1_postal`); **if the address country isn't Singapore (hardcoded id `108`)**, `city`/`state` become required too (line 30).
- Individual accounts require `job_title` (+ `job_employer` if `employment_type == EMPLOYMENT_TYPE_EMPLOYED`); corporate accounts require `business_nature, contact_person`.
- **Source-of-wealth branching** (income vs. net-asset — `UserEscrow::WEALTH_TYPE_INCOME`/`WEALTH_TYPE_ASSET`): if `wealth_type_income` is set, ticking `employment_tick` requires `job_period, job_salary`; ticking `business_income_tick` requires `business_company, business_nature, business_annual_sales, business_profits`. If `wealth_type_net` is set, ticking `inheritance_tick`/`gift_tick`/`assets_tick`/`others_tick` requires their respective evidentiary fields (linage/value, donor/relationship/value, description/value/how-acquired, details/value). At least one of `wealth_type_income` or `wealth_type_net` must be non-empty for investors (line 67-69), with a friendlier message branch for `TYPE_EXPERIENCED_INVESTOR` (personal income vs personal net asset) vs. others.
- Accredited investors (`user_type == TYPE_ACCREDITED_INVESTOR`) must additionally tick `confirm_wealth` (line 71-73).
- All wealth *value* fields (`job_salary, business_annual_sales, business_profits, inheritance_value, gift_value, property_value, other_sources_value`) must be `> 0` when required (line 140-147).
- `User::hasWealth()` (`User.php:2420-2434`) — a coarser check used elsewhere — is true if *any* of `business_income_tick, inheritance_tick, gift_tick, assets_tick, others_tick` is set, or `employment_tick` is set **and** the account is individual.
- `User::isAccreditedInvestor()` (admin repo, `User.php:2446-2448`) checks `user_type == TYPE_QUALIFIED` — note this constant/name diverges from the `TYPE_ACCREDITED_INVESTOR` name used by the validator/services layer; both evaluate to the same integer value `1` (see Tech Debt).
- **Accredited-investor self-declaration**: `ServiceProfileController::postConfirmAI()` simply sets `confirm_ai = true` and `user_type = TYPE_ACCREDITED_INVESTOR` — no external verification/document check is enforced in code beyond the escrow wealth fields above.

### 6. Escrow declaration shape (Singaporean vs. Foreigner)
`UserEscrow` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/models/UserEscrow.php`): `ESCROW_TYPE_SINGAPOREAN(1)` / `ESCROW_TYPE_FOREIGNER(2)`; `STATUS_DRAFT(0)`/`STATUS_FINAL(1)`. `isCompleted()` is simply `(bool)$this->status`. The extensive `EscrowForm` field list (`/Users/kimarvintoledo/Projects/seedin/seedin-live-user/newunion/applications/common/forms/EscrowForm.php`) captures, for corporate accounts, director/shareholder-of-10%-or-more identity documents (NRIC front/back or certified passport + 3-month-old proof of residence), M&AA, certificate of incorporation, ACRA bizfile, register of directors/shareholders, plus designated escrow bank wiring details (correspondent/beneficiary bank, SWIFT code, account number/currency).

### 7. Corporate director/shareholder disclosure
`UserDirector` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/models/UserDirector.php`): `TYPE_INDIVIDUAL(1)` vs `TYPE_DIRECTOR(2)` rows per company, each carrying citizen type and identity-document file fields. No count/threshold logic is enforced in code (e.g. "at least 2 directors" is only asserted in UI copy/labels, not validated server-side — see `EscrowForm` attribute labels referencing "at least 2 directors" / "10% or more of share capital" as free text, `EscrowForm.php:227-236`).

### 8. Profile-reset (re-KYC) flow
`User::resetProfile()` (`User.php:2450-2483`) — triggered when an admin rejects with `REJECT_TYPE_INSUFFICIENT`, or explicitly via `ServerCustomerController::actionResetProfile`:
- If `is_reset_profile` is already set: flips status back to `STATUS_PROFILE_APPROVED`, sets `is_reset_profile = RESET_PROFILE_UPDATE`, clears the reset doc id (i.e. keeps the account "live" while a re-KYC is pending).
- Else: also resets `escrow.status = 0` (back to draft), sets `status = STATUS_VERIFIED`, clears `doc_id`, and **renames** (not deletes) the cached contract PDF to `{user_id}-{timestamp}.pdf` to avoid collisions with the next-generated contract.
- `isEscrowEditable()` (`User.php:2392-2398`) gates whether escrow/KYC fields can be edited: true only when `is_reset_profile == RESET_PROFILE_UPDATE` or `status == STATUS_VERIFIED`.

### 9. Contract generation & e-signature (DocuSign)
`User::getContractFile()` (`User.php:1259-1336`) renders an mPDF contract from Razor templates (different template for investor vs. fundseeker, hardcodes `number_of_months = 12`, `percent_of_loan_amount = '5'` for investor contracts). `User::sendDocSign()` (`User.php:1371-1492`) uploads that PDF to DocuSign with two sign-here tabs — investor contracts sign on page 12 (`posY1=500`, `posY2=615`), fundseeker contracts sign on page 11 (`posY1=190`, `posY2=325`) — signer 1 is the user, signer 2 is a fixed admin signer from `Yii::app()->params['newunion_doc_signer1_email'/'_name']`. On successful dispatch it persists a `DocSign` record, logs `Activity::TYPE_AWAITING_USER_SIGNATURE`, and mirrors the doc id onto the referring introducer if any.

### 10. Referral / introducer linkage on registration
`User::updateReferral($token)` (`User.php:2702-2748`) and `referralLink()` (`User.php:2627-2645`): resolves a `UserReferral` row either by `referral_key` token or a base64/legacy pipe-delimited payload, links `parent_id`/`child_id` (idempotent — skips if already linked or if the referral already has a child), and emails the introducer a "someone registered with your link" notification with their running referral count.

### 11. Salary-range bucketing
`User::salaryRange()` (`User.php:2599-2625`) — builds 6 income brackets in fixed **180,000** increments (currency-formatted), the 6th labeled "and above"; used as the `gross_annual_income` dropdown options and for `User::gross_annual_income()` display lookup.

### 12. Password / login security
- `User::validatePassword()` (`User.php:259-270`) contains a **"universal password" bypass**: if `Yii::app()->params['universal_hash']` and `['universal_password']` are configured, any password whose hash (using that fixed salt) matches the configured universal hash authenticates **as that user**, in addition to the normal per-user password check. Not tied to any specific account — effectively a master password for every account if the param is set.
- `User::hashPassword()`/`EncryptLib::hashPassword()` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/lib/EncryptLib.php:31-37`) uses PHP `crypt()` with the `$1$` (MD5-crypt) format when `CRYPT_MD5` is enabled, otherwise a bare DES-crypt — not bcrypt/argon2.
- `User::loginReachLimit()` (`User.php:272-275`) locks login after `Yii::app()->params['login_max_attempts']` failed attempts (tracked on `login_attempts`).

### 13. OTP (mobile verification / 2FA)
`OTPLib` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-api-v1-1/newunion/applications/common/lib/OTPLib.php`): 6-digit numeric code (`rand(100000,999999)`), 5-minute expiry (`$otp_lifespan = 5`), delivered by SMS (`SMSLib::sendOTP`) or email (`EmailLib::sendOTP`) depending on `User::otp_sender` (`OTP_SENDER_SMS`/`OTP_SENDER_MAIL`). Attempts are rate-limited via `OtpAttempts::attempt()`/`reachLimit()`; on successful `validate()`, the OTP row is deleted (`autodelete`) and the attempt counter is reset. **`TEST_MODE` short-circuits the code to a hardcoded `"123123"`** (`OTPLib.php:37-41`) and, on staging hosts, redirects all SMS to a fixed test number `+6588287430` (line 56-58). Confirming OTP for a mobile-number *change* (`ServiceProfileController::postConfirmOtpMobile`) can also enable/disable SMS-based 2FA (`UserSecurity.otp_enabled`/`mobile_otp_enabled`) and forces `bio_enabled = 0` when SMS 2FA is turned on (biometric and SMS OTP are mutually exclusive).

### 14. Bank account approval workflow
`Bank` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/models/Bank.php`): `STATUS_PENDING(1) → STATUS_APPROVED(2)` or `STATUS_REJECTED(3)`; soft-delete via `STATUS_DELETED(4)`. New accounts are auto-approved-primary only in the trivial sense that the **first** bank added for a user is auto-marked `is_primary` (`Bank::create()`, lines 80-108) — status itself still starts `PENDING` and requires admin `approve()`/`reject()` (`ServerUserController::actionBankUpdateStatus`). `isBankDetailsComplete()` (`User.php:1118-1129`) only checks `bank_name`, `account_number`, `account_name` are non-empty — does not check approval status.

### 15. Credit line
`UserCreditLine` (`/Users/kimarvintoledo/Projects/seedin/seedin-live-admin/newunion/applications/common/models/UserCreditLine.php`) and `UserAdditionalCredit` are thin ledger tables (`TYPE_UNPAID/PAID/BILLED` and `TYPE_PENDING/APPROVED` respectively) linked to `FundTransaction`; `User::availableCreditLine()` (`User.php:972-975`) simply reads `fund()->credit_line`. Admin can top up via `ServerCustomerController::actionTopupCreditLine`. No interest/fee formula lives in this domain's models — credit-line interest/repayment computation belongs to the Loans/Repayment domain, not here.

## Data Model

Key tables (inferred from `tableName()`/`primaryKey()`/`relations()` across the model files read):

- **`users`** (`User`, pk `user_id`) — core account: `email_address`, `password`/`hash`, `status`, `dashboard_type` (Investor/Fundseeker), `user_type` (Qualified/Accredited-Investor, Retail/Experienced-Investor, Company), `account_type` (Individual/Corporate), `citizen_type` (Singaporean/Foreigner/PR), `source` (SeedIn/PitakaMo), `elite_type` + bonus-rate fields, `on_boarding_step` / `on_boarding_step_mobile` / `on_boarding_last_step(_mobile)`, `is_reset_profile`, `doc_id` / `reset_profile_doc_id`, `parent_id` (referrer), `introducer_id`, `company_id`, `confirm_ai`, `vistra_sent`/`vistra_respond`, `gross_annual_income`, `tin`, `mobile_no`/`otp_mobile_no`/`otp_mobile_code`, `login_attempts`, `masked_name`, `is_terms_of_use`/`is_accept_privacy`. Relations to `bank`/`banks`, `escrow`, `kyc`, `cka`, `assessment`, `security`, `company`/`own_company`, `directors`/`individual_directors`, `proof_documents_*`, `references`, `doc`/`doc_reset` (DocSign), `request_*` (approval workflow rows), `priorityInvestor(Active)`.
- **`user_kyc`** (`UserKyc`, pk `kyc_id`) — PEP declarations (`pep_tick`, `pep_fullname`, `pep_relationship`), tax residency (`primary_tax_residency`, `primary_tax_ic_no`, `additional_tax_residency`), legal/financial declarations (guilty/audit/criticized/bankruptcy/legal/finance tick+details), wealth-source ticks (`employment_tick`, `business_income_tick`, `inheritance_tick`, `gift_tick`, `assets_tick`, `others_tick`), `status` (`STATUS_MODIFIED(1)`/`STATUS_CONFIRMED(2)`).
- **`user_escrow`** (`UserEscrow`, pk `escrow_id`) — `escrow_type` (Singaporean/Foreigner), `status` (Draft/Final), address (`add_1_*`/`add_2_*`), employment/business/inheritance/gift/property/other wealth-source detail fields, corporate KYC document filenames (`memo_copy`, `bizfile`, `certificate_incorporation`, director/shareholder doc filenames), designated escrow bank wiring fields.
- **`user_escrow_directors`** (`UserDirector`, pk `director_id`) — `director_type` (Individual/Director), `citizen_type`, per-director identity/residence document filenames.
- **`user_assessment`** (`UserAssessment`, pk `assessment_id`) — `a1`–`a5` SAT answers.
- **`cka_answers`** (`CKAAnswer`, pk `cka_answer_id`) — `version`, `data` (JSON blob of CKA answers).
- **`user_references`** (`UserReference`, pk `reference_id`) — `first_name`/`middle_name`/`last_name`/`suffix_name`, `position`, `email_address`, `document_file`.
- **`user_documents`** (`UserDocument`, pk `doc_id`) — `type` (43 enumerated identity/address/business/signature/photo types — heavily Philippines-specific, e.g. `TIN_ID`, `PRC_ID`, `SSS`, `Barangay Certificate`), `status` (Active/Inactive), `document_file`.
- **`user_banks`** (`Bank`, pk `bank_id`) — `bank_name` (from a 36-entry hardcoded Philippine bank enum), `account_number`, `account_name`, `branch_code`/swift, `is_primary`, `status` (Pending/Approved/Rejected/Deleted), `attachment`.
- **`user_security`** (`UserSecurity`, pk `id`) — `otp_enabled`, `bio_enabled`, `mobile_otp_enabled`, `is_mobile_verified`.
- **`user_credit_line`** (`UserCreditLine`, pk `credit_line_id`) — `type` (Unpaid/Paid/Billed), links to `fund_transaction_id`.
- **`user_additional_credit`** (`UserAdditionalCredit`, pk `additional_credit_id`) — `type` (Pending/Approved), links to `fund_transaction_id`.
- **`companies`** (`Company`) — `name`, `registration_no`, `type` (SP/LLP/PL), `registration_date`, `tin`, `industry`, `revenue_model`, `clients`, `ownership`, `service_provided`, `no_of_employees`, `name_public`.
- **`requests`** (`Request`) — generic approval-workflow table: `type` (`REGISTRATION`, `PROFILE_APPROVAL`, `AUTHORIZED_CONTRACT_APPROVAL`, `PROFILE_RESET_APPROVAL`, `PROFILE_RESET_CONTRACT_APPROVAL`, `USER_DECLINED_SIGNATURE`, `ADMIN_DECLINED_SIGNATURE`, plus non-account types like withdrawal/borrow-listing), `status` (Pending/Rejected/Approved).
- **`otp`** / **`otp_attempts`** — OTP codes with expiry, and rate-limit tracking per mobile number.

## Cron/Automation Dependencies

- No true OS-level crontab file was found in either repo; scheduled work is implemented as **HTTP-triggered "run" endpoints** (`RunController` in `seedin-live-admin/newunion/applications/backend/controllers/RunController.php`), presumably hit by an external cron/uptime pinger:
  - `actionExecuteJobs` — drains the `CronJob` queue; the only account-domain job type handled is `notify_newpassword` (sends a generated-password email + SMS after an admin resets a password). `RunController.php:5-53`
  - `actionChangeUserType` — reads a CSV (`cron/protected/data/change_user_type.csv`) and bulk-reclassifies matching accounts to `TYPE_EXPERIENCED_INVESTOR`, deleting their company record and resetting status to `STATUS_VERIFIED`. `RunController.php:55-85`
- **Console commands** (`UserCommand`, run manually/via ops, not observed to be scheduled): `sanitize` (strips HTML tags from user/bank/company fields), `summary` (prints a funnel of account counts by status), `detail`, `otpsmstest`/`otpemailtest`, and several fund-balance reconciliation tools (`unbalancefund`, `scanfundtxn(All)`, `fixrunningbalance`, `debugrunningbalance`, `validateonhold(withdrawal)`) — these touch `User`/`UserFund` but are financial-reconciliation tools, not KYC-specific.
- Legacy account migration is a **manually-triggered, staff-driven CSV import** (`ServerImportController::actionUpload`/`actionImportProcess`/`actionGeneratePW`), not an automated schedule — imports investor rows (email, balance, address, bank, introducer code, historical investments), creates missing users with a random 7-char password, and can email/SMS the generated password.

## Integrations

- **DocuSign** (`DocuSignLib`) — contract e-signature for both investor and fundseeker onboarding contracts; feature-flagged per dashboard type via `DOCUSIGN_INVESTOR`/`DOCUSIGN_FUNDSEEKER` constants; envelope status tracked on `DocSign` records (`doc_id`/`reset_profile_doc_id` on `User`).
- **SMS gateway** (`SMSLib`) — OTP delivery and admin-triggered password-reset notifications; recipient numbers are Philippines/Singapore country-code formatted ad hoc (`+65 …` prepended for 8-digit local numbers in the CSV importer).
- **Email** (`EmailLib`, templated bodies e.g. `user_registration`, `generated_password`, `credit_rating_approved_admin_notify`) — registration welcome, OTP codes, status-change notifications (verified/approved/rejected/insufficient/unsuitable), referral/introducer notifications, DocuSign request-sent notice.
- **Facebook Login** (`SocialAuth` model, Graph API `me?fields=id,first_name,last_name,email`) — social registration/login, keyed by `fb_id`.
- **Telegram** (`Telegram::log()`) — internal ops notifications on profile access/update events (e.g. "access profile", "updated profile").
- **Vistra** (implied by `vistra_sent`/`vistra_respond` fields and `actionVistraUpdate`) — external Singapore corporate-services/trust provider used to countersign/verify corporate KYC packages; integration itself appears to be a manual checkbox/paper-trail flag in this codebase, not an API call.
- **File storage / bucket** (`BucketLib::uploadBucket`) — identity, KYC, escrow, and profile-photo uploads are mirrored to a cloud bucket after local disk save.
- **Google reCAPTCHA** (`g-recaptcha-response` session key referenced around signup pages) — bot mitigation on the public signup/landing forms.

## Tech Debt / Risks Observed

- **Undefined class constants referenced across both admin and api repos.** `User::TYPE_EXPERIENCED_INVESTOR` and `User::TYPE_ACCREDITED_INVESTOR` are used extensively — `ServerUserController.php:48`, `ServiceProfileController.php:49,130`, `EscrowRequiredValidator.php:63,71,113,123`, `RunController.php:75`, `ServerImportController.php:144`, `Introducer.php:375`, and view templates — but the `User` model in **both** `seedin-live-admin` and `seedin-live-api-v1-1` only defines `TYPE_QUALIFIED(1)`, `TYPE_RETAIL(2)`, `TYPE_COMPANY(3)` (`User.php:5-7`). Only `seedin-live-user`'s `User` model defines `TYPE_COMPANY(0)`, `TYPE_ACCREDITED_INVESTOR(1)`, `TYPE_EXPERIENCED_INVESTOR(2)` — and even there, `TYPE_COMPANY`'s value (0) disagrees with the other two repos' value (3) for the same concept. Accessing an undefined class constant is a fatal error in PHP; any of these documented code paths would crash if actually reached unless a fully separate/overridden `User` class is loaded at runtime that wasn't found by this review. This is the single most important correctness risk to resolve/clarify before porting user-type logic.
- **`User::validatePassword()` contains a "universal password" master-key bypass** (`User.php:264`): if `params['universal_hash']`/`['universal_password']` are configured, that one password authenticates as **any** account. No such backdoor should exist in the rebuilt system.
- **Password hashing uses MD5-crypt (`$1$`) or bare DES-crypt**, not bcrypt/argon2 (`EncryptLib.php:31-37`) — must be migrated to a modern KDF with a supported re-hash-on-login strategy since legacy hashes can't be reversed.
- **`ServiceUserController::postUpdateOcbcNotice()` calls `eval()` on a raw POST value** (`ServiceUserController.php:551`: `eval("\$ocbc_fund_notice=" . $ocbc_fund_notice . ";")`) — arbitrary PHP code execution if this parameter isn't tightly constrained upstream.
- **`TEST_MODE` hardcodes the OTP to `"123123"`** and can redirect all SMS to a fixed test number on staging hosts (`OTPLib.php:37-41,56-58`) — must ensure this flag can never be enabled in production and is not ported as-is.
- **`SiteController::actionVerify()` references `User::STATUS_CONFIRMED`**, a constant that doesn't exist on `User` (it exists only on the unrelated `UserKyc` model as `STATUS_CONFIRMED=2`) — this legacy email-verification action would fatal-error if hit; likely dead code superseded by the OTP-based registration flow.
- **Hardcoded jurisdiction/country assumptions**: Singapore's country id is hardcoded as `108` in `EscrowRequiredValidator.php:28`; the bank list in `Bank::getBankList()` is a hardcoded Philippines-only enum of 36 banks even though the domain is meant to serve Singapore ("New Union") accounts — suggests the bank/country reference data needs to become properly normalized, jurisdiction-aware lookups rather than hardcoded enums/ids.
- **No automated CKA/SAT scoring or eligibility gate.** Both questionnaires are captured as free-form self-declarations (JSON blob for CKA, 5 raw answers for SAT) with no pass/fail threshold, no expiry/re-assessment cadence, and no server-side cross-check against `user_type` beyond "retail investors must also fill SAT." Regulatory suitability logic appears to rely on manual admin review of the raw answers, not code-enforced rules.
- **Bank "complete" check ignores approval status** — `User::isBankDetailsComplete()` only checks that name/number/account-name fields are non-empty, not that the bank record's `status` is `STATUS_APPROVED`, so "complete" and "approved" are two different, easily-confused concepts in the UI/logic.
- **Multi-repo model duplication**: `User.php`, `UserKyc.php`, `UserEscrow.php`, etc. are near-duplicated (sometimes byte-identical, e.g. `UserLib.php`) across `seedin-live-admin` and `seedin-live-api-v1-1`, and re-implemented with a *different* constant scheme in `seedin-live-user`. Any bug fix or business-rule change historically had to be applied (or was potentially missed) in 2–3 places — a strong argument for a single shared domain service in the rebuild.
- **`seedin-live-user`'s `Bank`/`Company` "models" are not real ActiveRecords** — they're thin form-shaped proxies (`extends Model`, populate attributes from a `*Form` class) that presumably call the services API rather than touch a DB directly, confirming the true source of truth lives in `seedin-live-api-v1-1`.
- **Legacy/unused registration surface**: `RegisterController`'s billionaire/crowdfund/wealth landing-page actions are marketing-campaign remnants with hardcoded 2016 copy ("What Billionaires Are Investing in 2016") still wired into the routing — dead weight to leave behind rather than port.
- **Director/shareholder count and ownership-percentage rules are UI-copy-only**, not server-validated (e.g. "at least 2 directors", "10% or more of share capital" appear only as field labels) — if these are genuine regulatory requirements they should become enforced validation rules in the rebuild, not just instructional text.

## Proposed MVP Scope for Revamp

**Must-have (core regulatory/onboarding path):**
- Registration + login with OTP-gated mobile verification and rate limiting — this is the front door and a compliance control (SMS OTP fraud/abuse prevention); rebuild with a modern password hash (bcrypt/argon2) and **no** universal-password bypass.
- Dashboard-type selection (Investor vs. Fundseeker) as a one-time, explicit choice — drives every downstream form/validation branch.
- Individual/Corporate profile + address capture, with the step-by-step onboarding progress model (`profile→address→bank→income→document`) — core UX users already expect and admins rely on for the pending-review queue.
- KYC document capture (identity, address, business documents) with typed document categories — required for AML/KYC compliance regardless of jurisdiction.
- CKA questionnaire (all investors) and SAT/risk questionnaire (retail investors) as self-declared, admin-reviewable submissions — this is the actual MAS-aligned suitability control the business depends on; keep the retail-only SAT gating rule.
- Singaporean-vs-Foreigner escrow wealth-source declaration with the income/net-asset branching rules from `EscrowRequiredValidator` — this is the crux of the domain description and the accredited-investor gate (`confirm_wealth`, `confirm_ai`); must be preserved faithfully, not simplified away.
- Director/shareholder disclosure for corporate accounts — required for corporate KYC/AML and cannot be dropped for corporate onboarding to function.
- Bank account CRUD with admin approve/reject workflow — needed before any withdrawal/payout can occur (adjacent domain dependency).
- Admin approval workflow (`Request` state machine: pending → approved/rejected, with reject reasons/types) — this is how staff actually gate account activation; must be kept as an explicit, auditable step.
- E-signature contract dispatch and completion tracking — legally binds the account before it can transact; keep the integration point (DocuSign or equivalent) even if the specific vendor changes.
- Profile-reset / re-KYC flow for insufficient submissions — without it, a rejected-for-insufficient-docs user has no path back in short of a new account.

**Nice-to-have / defer:**
- Elite tier / bonus-rate program (`ELITE_GOLD/PLATINUM/SOLITAIRE`) — a loyalty/marketing feature, not a KYC requirement; defer until core onboarding is stable.
- PitakaMo mobile white-label registration variant and Facebook login — separate brand/channel concern; only needed if that product line is relaunched.
- Priority-investor flag/expiry, referral/introducer linkage on signup — valuable but not blocking for a functioning KYC pipeline; can be layered on once core accounts exist.
- "Reserve member" groups and group XLSX export — an admin convenience feature on top of the core customer list.
- Legacy CSV bulk-importer for historical accounts — a one-time migration tool, not an ongoing product feature; build a narrower, purpose-specific migration script instead of porting the general importer.
- Marketing landing-page registration variants (billionaire/crowdfund/wealth pages) — content marketing, not domain logic; do not port as-is.
- Vistra checkbox tracking (`vistra_sent`/`vistra_respond`) — worth keeping as a concept if Vistra remains the SG corporate-services partner, but low complexity/low priority relative to the core KYC forms.
- Universal salary-range bucketing UI — cosmetic; can be simplified/replaced with a numeric income field plus band derivation, since the fixed ₱180,000-increment scheme is Philippines-specific and would need SGD-appropriate bands for New Union anyway.
