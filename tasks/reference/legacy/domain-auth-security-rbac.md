# Auth, RBAC & Access Audit

## Overview

This domain covers everyone's front door into the SeedIn / New Union platform and the trail left behind afterward:

- **Staff/admin authentication and authorization** (`seedin-live-admin`, and a duplicated copy in `seedin-live-api-v1-1`): username/password login for staff, an optional SMS-OTP second factor, and a **custom** role → permission → action mapping system (`Admin`, `Permissions`, `RolePermission`, `PermissionLib`). The bundled third-party **yii-rights** module (`modules/rights`, a full `CDbAuthManager`-based RBAC engine with `AuthItem`/`AuthAssignment` tables) is present in the codebase but is **not wired up in any environment** — see Tech Debt.
- **End-user (borrower/investor/introducer) authentication** (`seedin-live-api-v1-1` "services" app, consumed by `seedin-live-user` "frontend" app): email/password login, Facebook login, mobile-OTP registration verification, per-device API keys, biometric/OTP step-up for sensitive actions, and password reset.
- **Audit trails**: `Activity` (business-event timeline shown to users/admins), `ServiceAccessLogs` (raw HTTP request/response logging for the API), and the admin-only `AccessLogController` / `ActivityController` UIs that surface them.

**Who uses it:**
- **Admin/staff users** (Superadmin, Admin, Manager/Introducer, Credit User, Finance, Business Development, IT, Marketing, Agency, Credit Dashboard, Digital Marketing) — log into the `admin` Yii app, are gated by `PermissionLib`/`RolePermission`.
- **Borrowers, investors, introducers** (all modeled as `User` with a `dashboard_type`) — authenticate through the `api-v1-1` "services" app via the `user` "frontend" app (a thin proxy) or directly via the mobile app.
- **System/automated**: cron commands, the OTP subsystem, `Activity::addLog()`/`ServiceAccessLogs::addLog()` audit writers, and an admin "login-as-user" backdoor (`ServiceUserController::postAccess`) used to impersonate a user session from a signed admin link.

## Current Features & Flows

### Admin Dashboard (`seedin-live-admin`)

| Endpoint / Action | Description |
|---|---|
| `SiteController` (`site/login`) → `ServerAdminController::actionAuth` | Staff login form; validates `LoginForm`, then either logs in directly or, if `admin.is_required_otp` is set, stashes the identity in session and sends an SMS OTP. |
| `ServerAdminController::actionConfirmotp` | Verifies the 6-digit OTP sent during login (`OTPLib::validate`) against the mobile number, then completes `Yii::app()->user->login()` using the identity stashed in session. |
| `ServerAdminController::actionUpdatePassword` | Change own password via `AdminPasswordForm` (validates current password, new/confirm match). |
| `ServerAdminController::actionList/actionCreate/actionUpdate/actionDelete/actionForm` | CRUD for admin/staff accounts (search by name/username/introducer, paginated 10/page); delete is a soft-delete (`status = STATUS_INACTIVE`) and is blocked for Superadmin/Admin roles. |
| `AdminController::actionIndex/actionAdd/actionEdit` | Admin-user management views (list/add/edit forms), backed by the `ServerAdminController` AJAX actions above. |
| `PermissionController::actionIndex` | List all defined `Permissions` records (alphabetical). |
| `PermissionController::actionAdd/actionEdit` | Create/edit a `Permissions` record (`permission_name`, `permission_action`, `permission_subactions`). |
| `PermissionController::actionRole` | Renders the role list view for assigning permissions per role. |
| `PermissionController::actionRolepermission($id)` | Renders the permission checklist for a given `role_id`, pre-checking permissions currently active (`role_permission.status = 1`) for that role. |
| `ServerPermissionController::actionSave` | AJAX save of a `Permissions` record (create or update). |
| `ServerPermissionController::actionSaveRolePermission` | AJAX save of a role's permission set: soft-disables (`status = 0`) all existing `role_permission` rows for the role, then re-enables/inserts rows for every permission checked in the POST. |
| `AccessLogController::actionIndex/actionList` | Renders the raw API access-log viewer (data comes from `ServiceAccessLogs`, sourced from the API app's DB). |
| `ActivityController::actionIndex/actionDownload/actionView` | Lists/exports/views individual `Activity` audit-trail rows (business events: registrations, withdrawals, contract uploads, admin edits, etc.). |
| yii-rights module (`modules/rights/*`) | Full generic RBAC UI (auth items, assignments, roles/tasks/operations) — present in the repo but **not imported by any environment config**, so its controllers/views are dead code in production. |

### API (`seedin-live-api-v1-1`, "services" app — consumed by user app & mobile clients)

| Endpoint | Description |
|---|---|
| `ServiceUserController::postLogin` | Email/password login (`LoginForm`); on success mints/updates a `UserApiKey` row (per `service_type` — web/mobile), records device info, resets `login_attempts`, updates `last_login`. Blocked entirely if `Setting::system_not_available`. |
| `ServiceUserController::postLogout` | "Logs out" — currently a no-op (the code that clears the api_key is commented out; see Tech Debt). |
| `ServiceUserController::postFBLogin` | Facebook login for an **existing** account: exchanges `fb_token` with the Facebook Graph API for `id/name/email`, then logs in by email only (no password) via `LoginForm::fblogin()`. |
| `ServiceUserController::postAccess` | Admin **"login as user"** backdoor: takes a `code = user_id|shared_secret|timestamp` string, checks the secret against `params['access_key']` and a 60-minute time window, then logs the caller in as `user_id` and issues a fresh API key. |
| `ServiceUserController::postVerifyPassword` | Re-verifies the current session's password (used to gate sensitive UI flows). |
| `ServiceUserController::postUpdateSettings` / `postUpdateOTPSender` | Toggle `user_security.otp_enabled` and `user.otp_sender` (SMS vs email OTP delivery). |
| `ServiceRegisterController::postValidate` | Step 1 of signup: validates the registration form, then (if `mobile` present) sends an OTP via `OTPLib::send()`, subject to `OtpAttempts::reachLimit()`. |
| `ServiceRegisterController::postSave` | Step 2 of signup: creates the `User` (+ optional `Company`), links an `fb_id` to `SocialAuth` if provided, auto-logs-in the new user, issues a `UserApiKey`, sends welcome/referral emails. |
| `ServiceRegisterController::postFBSave` | Facebook signup: validates `fb_token` against Graph API, auto-creates a `User` (`UserLib::FBCreate`) if the FB email isn't already registered, links referral, logs in. |
| `ServiceRegisterController::postPitakaMoSave` | Registration variant restricted to the PitakaMo partner channel (mobile-number based account, no email/password). |
| `ServicePasswordController::postUpdate` | Change password for logged-in user (current-password check + `CommonLib::isValidPassword` strength check). |
| `ServicePasswordController::postRequest` | "Forgot password" — emails a reset link containing `reset_password_key` (random 100-char string). |
| `ServicePasswordController::postReset` / `postVerifyToken` | Consume the reset token to set a new password / check token validity. |
| `ServiceProfileController::postValidateOtpMobile` | Send an OTP to a (new) mobile number for verification (delegates to `postConfirmOtpMobile` if OTP fields are already present). |
| `ServiceProfileController::postConfirmOtpMobile` | Validates OTP, updates `user.otp_mobile_code/otp_mobile_no`, and flips `user_security.otp_enabled`/`mobile_otp_enabled` + `is_mobile_verified`, sending an SMS-authentication-enabled/disabled email. |
| `ServiceSecurityController::getSettings` | Returns current biometric/OTP settings for the account + current device. |
| `ServiceSecurityController::postEnableOtp` | Password-gated toggle of SMS OTP (web: `otp_enabled`; mobile: `mobile_otp_enabled` on `user_security`, plus per-`Device` `otp_enabled`), emails the user, logs `Activity::TYPE_SECURITY_UPDATED`. |
| `ServiceSecurityController::postEnableBio` | Password-gated toggle of biometric login for the current device (`Device.bio_enabled` + `user_security.bio_enabled`), emails the user, logs activity. |
| `Device::validateDevice()` (called from `ServiceLoanController`/`ServiceRequestController`) | Step-up auth gate on sensitive transactions (invest, withdraw, deposit): if the current device has biometrics enabled, skip OTP; otherwise force OTP if the account has mobile-OTP enabled. |
| `ServiceController::beforeAction` / `checkToken` / `verifyToken` | Framework-level request auth: HTTP Basic Auth per integration partner (`params['service_auth']`) **or** unconditionally allowed for any `GET` request; then per-user bearer-style `apiKey` lookup against `UserApiKey`, re-logging the user in on every request. |
| `ServiceController::_response()` | Every JSON response is (in theory) written to `ServiceAccessLogs::addLog()` — see Tech Debt for why this is currently inert. |
| `PermissionController` / `ServerPermissionController` (duplicated backend, identical to admin repo) | Same Permissions/RolePermission CRUD as the admin app — this repo also ships an embedded copy of the `backend` Yii app with its own disabled `rights` module. |

### User App (`seedin-live-user`, "frontend" — thin proxy to the API)

| Endpoint / Component | Description |
|---|---|
| `UserIdentity::authenticate()` | Does **not** hit the DB directly — calls `NewunionServiceLib::webInstance()->post('User/Info')` against the API app and trusts whatever `user_id` comes back; i.e. auth state lives in the API app's session/api-key, not locally. |
| `WebUser` | Yii `CWebUser` wrapper that lazily loads the cached `User` model from `Yii::app()->session['user']`. |
| `ServerMobileOtpController::actionForm` | Renders the "change mobile number" OTP form (proxies `Profile/View`). |
| `ServerMobileOtpController::actionValidateOtpMobile` | Proxies to `Profile/ValidateOtpMobile` on the API app. |
| `FacebookLib` | Empty stub class that just requires the Facebook PHP SDK autoloader — actual FB logic lives entirely in the API app's controllers. |

## Business Logic & Computations

### Password hashing (weak, static salt)
`newunion/applications/common/lib/EncryptLib.php` (admin repo; identical logic in api repo):
```php
public static $salt = 'A5F16GvaRiF$02a1k09';
public static function hashPassword($password, $custom_salt='')
{
    if( CRYPT_MD5 ){
        return crypt($password, '$1$'. ((!empty($custom_salt)) ? $custom_salt : self::$salt) );
    }
    return crypt($password,  self::$salt );
}
```
Passwords are hashed with PHP `crypt()` using **MD5 crypt** (`$1$`) and a **hardcoded, shared, non-per-user salt** committed to source control. No bcrypt/argon2, no per-user random salt.

### OTP generation & validation (`OTPLib`, admin repo `common/lib/OTPLib.php`, mirrored in api repo)
- 6-digit numeric code: `rand(100000, 999999)`.
- Token id: `uniqid(rand(100000,999999) + time())`.
- Lifespan: **5 minutes** (`$otp_lifespan = 5`).
- `OTPLib::validate()` matches on `(mobile_no, token_id, code)` and additionally checks `expire_at > now()`; on success it deletes the OTP row (if `$autodelete`) and calls `OtpAttempts::renew()` to reset the attempt counter.
- **Test-mode bypass**: when `TEST_MODE` is defined, the code is hardcoded to `"123123"` and the token to a fixed string, and if the host starts with `staging`, the SMS is redirected to a hardcoded number (`+6588287430`).
- Delivery: SMS by default (`SMSLib::sendOTP`), or email if `user->otp_sender == User::OTP_SENDER_MAIL` (`EmailLib::sendOTP`).

### OTP attempt throttling (`OtpAttempts`, admin `common/models/OtpAttempts.php`)
```php
public static function reachLimit($mobile) {
    $attempt = self::findByMobile($mobile);
    if (!$attempt) return FALSE;
    if ($attempt->attempts < Yii::app()->params['otp_max_attempts']) return FALSE;

    $start_date = new DateTime(date('Y-m-d H:i:s'));
    $end_date = new DateTime(date('Y-m-d H:i:s', strtotime("+" . Yii::app()->params['otp_max_mins_penalty'] . " minutes", strtotime($attempt->updated_at))));
    $interval = $end_date->diff($start_date);
    ...
    if ($interval->invert == 1) {
        return array($interval->i, $interval->s);   // still locked: remaining (min, sec)
    } else {
        $attempt->attempts = 0; $attempt->save();
        return FALSE;                                 // lockout expired: reset
    }
}
```
Config values (`environments/prod/.../common/config/params.php`): `otp_max_attempts = 5`, `otp_max_mins_penalty = 15`. So: after 5 OTP sends to the same mobile number, further sends are blocked for 15 minutes from the last attempt timestamp; the lockout auto-clears once 15 minutes elapse.

### Login attempt throttling (`User::loginReachLimit()` / `resetLoginAttempts()`, api repo `common/models/User.php`)
```php
public function loginReachLimit() {
    return ($this->login_attempts >= Yii::app()->params['login_max_attempts']) ? TRUE : FALSE;
}
public function resetLoginAttempts() {
    if (!$this->loginReachLimit()) return array(0, 0);
    $end_date = new DateTime(date('Y-m-d H:i:s', strtotime("+" . Yii::app()->params['login_max_mins_penalty'] . " minutes", strtotime($this->updated_at))));
    ... // same pattern as OTP: locked until 15 min after last failed attempt, then reset to 0
}
```
Config: `login_max_attempts = 5`, `login_max_mins_penalty = 15`. Each failed password check increments `user.login_attempts` (`UserIdentity::authenticate()`); a successful login resets it to 0. Identical duplicate logic exists in `OtpAttempts::reachLimit()` — the two throttles are independently implemented rather than sharing one utility.

### Admin/staff role model (hardcoded, not DB-driven)
`Admin.php` (admin repo) defines roles as PHP constants, not a `roles` table:
```php
const ROLE_SUPERADMIN=1; ROLE_ADMIN=2; ROLE_MANAGER=3; ROLE_INTRODUCER=4; ROLE_CREDIT_USER=5;
ROLE_FINANCE=6; ROLE_BUSINESS=7; ROLE_IT=8; ROLE_MARKETING=9; ROLE_AGENCY=10;
ROLE_CREDIT_DASHBOARD=11; ROLE_DIGITAL_MARKETING=12;
```
`ROLE_MANAGER` (3) is effectively retired/aliased — `roles()` maps `ROLE_INTRODUCER` (4) to the display label "Manager" and comments out the `ROLE_MANAGER` entry, so two constants both loosely mean "manager" in different places of the code.

### Custom permission-checking algorithm (`PermissionLib::checkPermission`, admin repo `backend/lib/PermissionLib.php`)
This is the **actual** authorization engine used in production (the yii-rights module is unused — see Tech Debt):
1. **Superadmin** (`role_id == ROLE_SUPERADMIN`) → always allowed.
2. **Admin** (`role_id == ROLE_ADMIN`) → allowed for everything **except** an explicit denylist, `PermissionLib::superAdminOnly()` (currently: DocuSign "mark complete", `system/*`, `server/serverSystem/*`), matched via prefix/wildcard regex on `"{controller}/{action}"`.
3. **Every other role** → allowed only if the current route matches an entry in `Yii::app()->params['allowedActions']`, a per-request cache built once per session by `PermissionLib::publicRoutes()`:
   - Loads all `role_permission` rows for the user's `role_id` with `status = 1`, joined to `permissions.permission_action` (+ comma-split `permission_subactions`).
   - Always merges in a fixed safelist (`safeDBAccess()`: login, update-check, request/loan/customer list endpoints, latest-activity) plus always-public routes (`controlsystem/*`, `site/login`, `file/asset`, OTP auth endpoints, dashboard, report generation, `executive/*`).
   - Route matching: exact match, or prefix match if the configured action ends in `*` (implemented via `preg_match` with the pattern anchored at `^` and, for non-wildcard entries, also anchored at `$`).
4. `WebUser::checkAccess($operation)` is a thin wrapper calling `checkPermission((int)roleId(), $operation)` — used both for page routing (`BackendController::isAllowed()`) and for fine-grained UI checks in `PermissionLib::pageAccessRules()` (a large, mostly-dead block of `checkAccess('viewCreditRating')`-style rules that is unreachable because the function returns early via `checkPermission()` at its top — see Tech Debt).

### Permission ↔ Role assignment persistence (`ServerPermissionController::actionSaveRolePermission`)
Saving a role's permission set is a **soft "replace all"**: every existing `role_permission` row for that `role_id` is set to `status = 0`, then every checked `permission_id` from the POST is either updated back to `status = 1` or inserted fresh. Rows are never hard-deleted, so history of past permission grants is retained in the table (but there's no "granted by / revoked by / when" audit column captured beyond the row's own timestamps).

### Admin OTP login gate
`LoginForm::login()` (admin repo, `backend/forms/LoginForm.php`):
```php
if ($this->_identity->is_required_otp) {
    Yii::app()->session['identity'] = $this->_identity;
    $result['otp_token'] = OTPLib::send($this->_identity->mobile);
    $result['otp_mobile_no'] = $this->_identity->mobile;
    return $result;                       // caller must now call Confirmotp
} else {
    $duration = $this->rememberMe ? 3600*24*30 : 0;
    Yii::app()->user->login($this->_identity, $duration);
    return TRUE;
}
```
OTP is per-admin-account opt-out (`admin.is_required_otp`, default `1` per migration `m171115_024051_admin_login_option.php`), not a global policy — an admin with `is_required_otp = 0` skips the second factor entirely.

### End-user login rules (`UserIdentity::authenticate()`, api repo)
- Looked up by `LOWER(email_address) = ? AND dashboard_type = ? AND status <> STATUS_DELETED`; **`dashboard_type`** (investor vs. fundseeker/borrower) is part of the identity lookup, so the same email can have separate logins per dashboard type if `PITAKAMO_ENABLED_TOKEN_ACCESS` segregation doesn't apply.
- If `PITAKAMO_ENABLED_TOKEN_ACCESS` is on, an additional `source = User::SOURCE_SEEDIN` filter is applied (keeps PitakaMo-sourced accounts out of normal login).
- Order of checks: user not found → reach-limit → wrong password (increments `login_attempts`) → `STATUS_NEW` (unverified) → success.

### Per-device API key issuance
On every successful login/registration (`ServiceUserController::postLogin`, `postFBLogin`, `postAccess`; `ServiceRegisterController::postSave`, `postFBSave`, `postPitakaMoSave`), a `UserApiKey` row is looked up by `(user_id, service_type)`; if found, the **old key is preserved** in `api_key_previous` before being overwritten (used to detect "duplicate login" — see `ServiceController::verifyToken`, though the actual `VERIFY_NEW_DEVICE` comparison is currently commented out). Password-based logins mint the key via `CommonLib::simpleRandom()`; Facebook-based logins and the admin "login as user" path instead reuse the raw PHP session id (`Yii::app()->getSession()->getSessionId()`) as the API key — a weaker, more guessable/less-random token source.

### Admin "login as user" (`ServiceUserController::postAccess`)
```php
list($user_id, $key, $time) = explode('|', $code);
$diff = (int)(abs((int)$time - time()) / 60);
if ($diff > 60) { ... 'Session expired' ... }
if ($key == Yii::app()->params['access_key']) {
    $identity = new UserIdentity('', '');
    $identity->authenticate2($user_id);
    Yii::app()->user->login($identity, 60);
    ...
}
```
A single **static shared secret** (`params['access_key']`, hardcoded in `environments/prod/.../common/config/params.php` as `1A5D1-23GQ-12341F24-GWF51A`) plus a 60-minute timestamp window is sufficient to mint a fully logged-in session for **any** `user_id` — there's no per-admin identity, scope, or audit record tied to who generated the code.

### Step-up auth for sensitive transactions (`Device::validateDevice`, api repo `common/models/Device.php`)
```php
if ($enable_otp == 1) {
    if (!$user->security()->isOtpEnabledOnMobile()) $enable_otp = 0;   // client can't force OTP the server doesn't want
    return TRUE;
}
$device = ...lookup by device_uuid, falling back to device_id...
if ($device && $device->isBioEnabled()) return TRUE;                   // biometric present → no OTP needed
if ($user->security()->isOtpEnabledOnMobile()) $enable_otp = 1;        // otherwise force OTP if account has it enabled
```
Applied before investing (`ServiceLoanController`) and before withdrawal/deposit/borrow requests (`ServiceRequestController`) — biometric-enabled devices skip OTP, otherwise OTP is forced if the account has mobile-OTP security enabled.

### Access-log redaction (`ServiceAccessLogs::replaceSensitive`, both repos)
Any request/response field whose key contains `password` or is one of `apiKey, current_password, token, confirm_password, new_password, confirm_new_password` is masked to `*****` before being persisted (or would be, were the actual `save()` call not commented out — see Tech Debt).

## Data Model

| Table (inferred) | Key columns (from AR model usage) | Notes |
|---|---|---|
| `admin` | `admin_id` (PK), `firstname`, `lastname`, `username`, `password`, `role_id`, `status`, `introducer_id`, `mobile_code`, `mobile_number`, `is_required_otp`, `created_at` | Staff accounts. `role_id` is a raw int matched against `Admin::ROLE_*` constants — no `roles` table. `status`: 0=inactive,1=active (soft delete). |
| `permissions` | `permission_id` (PK), `permission_name`, `permission_action`, `permission_subactions`, `date_created` | Custom permission catalog; `permission_action` is a route string (e.g. `customer/edit`), `permission_subactions` a comma-separated list of extra routes granted alongside it. |
| `role_permission` | `role_permission_id` (PK), `role_id`, `permission_id`, `status` | Many-to-many role↔permission grant; `status=0` rows are soft-revoked, kept for history. |
| `otp` | `otp_id` (PK), `datecreated`, `mobile_no`, `token_id`, `code`, `expire_at`, `details` (JSON) | Shared by both admin-login OTP and end-user mobile-verification OTP flows. |
| `otp_attempts` | `id` (PK), `mobile`, `attempts`, `created_at`, `updated_at` | One row per mobile number; incremented on every `OTPLib::send()`, reset on successful validate. |
| `admin` login attempt fields | n/a (no `login_attempts` column found on `admin`; that concept only exists on `users`) | Admin login lockout is **not implemented** — only end-user login has `login_attempts`. |
| `users` (User) | `user_id`, `email_address`, `password`/`hash`, `dashboard_type`, `status`, `login_attempts`, `last_login`, `otp_sender`, `otp_mobile_code`, `otp_mobile_no`, `reset_password_key`, `source`, `p_username`, `p_group_id`, `app_version`, `app_os`, `api_version` | End-user account; `dashboard_type` distinguishes investor vs. fundseeker/borrower. |
| `user_security` | `id`, `user_id`, `otp_enabled`, `mobile_otp_enabled`, `bio_enabled`, `is_mobile_verified`, `updated_at`, `created_at` | Per-user security preferences; created on-the-fly with OTP defaulted ON if no row exists yet (`User::security()`). |
| `devices` | `id`, `user_id`, `device_id`, `device_uuid`, `os`, `otp_enabled`, `bio_enabled`, `status`, `created_at` | Per-device biometric/OTP override, keyed preferentially by `device_uuid`, falling back to `device_id`. |
| `api_key` (`UserApiKey`) | `user_id` (PK), `service_type`, `device_id`, `device_uuid`, `device_env`, `app_version`, `api_version`, `api_key`, `api_key_previous`, `session` (serialized blob), `date_created`, `last_activity` | One row per `(user_id, service_type)` — i.e. a user has at most one active key per service type (web/mobile), not one per physical device; a new login on a different device overwrites the previous key (old value parked in `api_key_previous`). |
| `social_auths` (`SocialAuth`) | `id`, `user_id`, `source` (e.g. `'fb'`), `source_id` | Maps a social-provider user id to a local `User`; only `fb` is ever written despite the schema being provider-agnostic — no Google rows are ever created (see Tech Debt). |
| `activities` (`Activity`) | `activity_id` (PK), `user_id`, `admin_id`, `type` (int enum, ~60 values), `reference` (JSON), `rel_id`, `desc`, `client_info` (JSON: ip/agent/app_version/app_os/api_version), `created_at` | The business-event audit trail (registration, login, withdrawals, contract uploads, security toggles, RDS acceptance, etc.) — see full `TYPE_*` catalog in `Activity.php`. |
| `access_logs` (`ServiceAccessLogs`) | `id`, `created_at`, `from` (web/app), `method`, `url`, `user_id`, `request` (JSON), `response` (JSON), `client_info` (JSON) | Raw API request/response log; schema created by migration `m181112_083339_access_logs.php`. Writing to this table is currently disabled in code (see Tech Debt) even though the admin UI (`AccessLogController`) still exists to browse it. |
| `admin_log` (`AdminLog`) | `id` (PK), constant `TYPE_APPROVED_CREDITRATING` | Model's `tableName()` returns `{{otp}}` (copy-paste bug pointing at the OTP table) and it has zero call sites anywhere in the admin codebase — effectively dead/broken code. |
| yii-rights tables (`authitem`, `authitemchild`, `authassignment`, etc., per `modules/rights/data/schema.sql`) | n/a | Present in the bundled module's own schema file but **not part of the live authorization path** since the module is never imported by any environment config. |

## Cron/Automation Dependencies

- **None of the domain's cleanup jobs are actually scheduled/active.** A `ClearOTPAttemptsCommand` exists only inside `newunion/cron/protected/commands/trash/` (a decommissioned-commands folder) in the admin repo — it is not present among the live `newunion/cron/protected/commands/*` files, meaning `otp_attempts` rows are never purged by cron today.
- `ServiceAccessLogs::removeOldData()` (deletes `access_logs` rows older than 2 months) is defined but has **no caller anywhere in either repo** — dead code, not wired to any console command or cron entry.
- No cron job rotates/expires `otp` rows either; expiry is enforced only at read time via the `expire_at > now()` check in `OTPLib::validate()`, so expired-but-unvalidated OTP rows accumulate indefinitely.
- `Activity` writes happen synchronously inline with the triggering request/cron job (e.g. loan/withdrawal cron flows call `Activity::addLog()` directly) — there is no separate audit-writing cron.

## Integrations

- **SMS**: `SMSLib::sendOTP()` — used for both admin-login OTP and end-user mobile-verification/security OTP.
- **Email**: `EmailLib` — used as an alternate OTP channel (`sendOTP`, when `otp_sender == OTP_SENDER_MAIL`), for security-toggle notifications (`SmsAuthenticationEnabled/Disabled`, `BioAuthenticationEnabled/Disabled`), password-reset links (`RequestNewPassword`), and registration welcome/thank-you emails.
- **Facebook Graph API**: direct unauthenticated `file_get_contents('https://graph.facebook.com/me?fields=id,name,email&access_token=...')` calls from `ServiceUserController::postFBLogin`/`ServiceRegisterController::postFBSave` — no server-side app-secret/app-id verification of the token's audience, and no SDK (`FacebookLib` in the user repo is an empty stub; the actual `Facebook/` SDK vendor code lives under `common/extensions/Facebook` but isn't used in this login path).
- **Telegram**: `Telegram::log(...)` fires on successful login and on password changes/resets, both for admin and end-user flows — appears to be an internal ops-notification channel, not a user-facing integration.
- **Google login**: referenced in the domain brief but **no implementation was found anywhere in any of the three repos** (no controller action, lib, or `SocialAuth.source = 'google'` writer) — see Tech Debt.
- **PitakaMo partner channel**: a separate authentication path (`authenticatePitakaMo`, `checkToken()`'s `p_target_username` header handling) that authenticates by `mobile_no` + a shared `pitakamo_seedin_access_token`, bypassing normal per-user API keys when `PITAKAMO_ENABLED_TOKEN_ACCESS` is on.

## Tech Debt / Risks Observed

- **yii-rights module is fully vendored, duplicated across two repos, but never imported** — `'import' => array('application.modules.rights.*', ...)` is commented out in every environment's `backend/config/main.php` (admin repo dev/qa/prod, and the embedded backend copy in api-v1-1). The actual authorization system in production is the bespoke `Permissions`/`RolePermission`/`PermissionLib` layer. A rebuild should not assume yii-rights' `AuthItem` hierarchy reflects real roles/permissions.
- **Hardcoded, shared, weak password hashing salt** committed to source (`EncryptLib::$salt = 'A5F16GvaRiF$02a1k09'`), using MD5-crypt rather than a modern adaptive hash (bcrypt/argon2). Same salt is reused for both admin and end-user passwords across repos.
- **Hardcoded shared secret for admin user-impersonation** (`params['access_key'] = '1A5D1-23GQ-12341F24-GWF51A'`) committed in plaintext in `environments/prod/.../common/config/params.php`; `ServiceUserController::postAccess` uses only this static string + a 60-minute timestamp window to mint a session for any `user_id`, with no per-admin attribution or audit trail of who generated the impersonation code.
- **Access-log persistence is silently disabled in both repos** — `ServiceAccessLogs::addLog()` builds the full log row but the final `$accessLog->save();` call is commented out (`// $accessLog->save();`) in both the admin repo's and the api repo's copy of the model. The admin `AccessLogController` UI still exists to browse this (empty/stale) table.
- **`AdminLog` model is broken/dead code**: `tableName()` returns `{{otp}}` (points at the OTP table, not a dedicated admin-log table) and it has zero call sites in the codebase.
- **`Device::isOtpEnabled()` checks the wrong column** — it returns `$this->bio_enabled == self::STATUS_ACTIVE`, a copy-paste bug that makes device-level OTP status indistinguishable from biometric status.
- **OTP test-mode bypass logic ships in the shared library**: when `TEST_MODE` is defined, `OTPLib::send()` hardcodes the OTP to `"123123"` and, for staging hosts, silently redirects all OTP SMS to a hardcoded phone number — a risk if `TEST_MODE`/host-matching is ever misconfigured in a non-dev environment.
- **API `GET` requests bypass service authentication entirely**: `ServiceController::authenticate()` returns `TRUE` unconditionally for any `GET` request before the per-partner Basic Auth check even runs (`if ($this->requestType == 'get') return TRUE;`), relying solely on the downstream per-user apiKey check (which itself is skipped for routes marked public).
- **Facebook login/signup trusts the client-supplied token's Graph API response with no app-id/audience verification** — any valid Facebook access token (potentially issued to a different Facebook app) that resolves to a matching email will log the user in or auto-create an account.
- **Google social login does not exist in code** despite being expected per the domain description — `social_auths.source` is only ever written as `'fb'`.
- **Facebook/impersonation-issued API keys use the raw session id as the token** (`Yii::app()->getSession()->getSessionId()`) instead of `CommonLib::simpleRandom()` used by normal password logins — an inconsistent, potentially more predictable token source depending on session-id generation.
- **`UserApiKey` is one row per `(user_id, service_type)`**, not per physical device — logging in from a second device silently invalidates the first device's key (moved to `api_key_previous`), and the "duplicate login" detection that would use that field (`VERIFY_NEW_DEVICE`) is commented out in `ServiceController::verifyToken()`, so duplicate-login is effectively never surfaced to the client today.
- **Two independently-implemented, near-identical rate-limit algorithms** (`OtpAttempts::reachLimit()` and `User::loginReachLimit()`/`resetLoginAttempts()`) duplicate the same "N attempts / M minute penalty" logic rather than sharing one utility — a rebuild should unify these.
- **`PermissionLib::pageAccessRules()` contains ~150 lines of `checkAccess('viewX')`-based fine-grained rules that are unreachable dead code** — the function returns early via `return PermissionLib::checkPermission($role_id, "checkPermission");` at the top, before any of the `checkAccess()` blocks execute.
- **No lockout/attempt-throttling exists for admin/staff logins** — only end users (`users.login_attempts`) have this; the `admin` table has no equivalent column, so brute-forcing an admin password is not rate-limited by the application (only the admin-login OTP step, if enabled per-account, adds a factor).
- **Role permission changes are not attributed** — `role_permission` rows record `status` but no `updated_by`/`admin_id` column, so there's no built-in answer to "which admin changed this role's permissions and when" beyond generic row timestamps (if even populated).
- **`Admin::ROLE_MANAGER` (3) is effectively dead/aliased** — `roles()` displays `ROLE_INTRODUCER` (4) as "Manager" and comments out the `ROLE_MANAGER` entry, leaving two constants that both loosely represent "manager" scattered through `PermissionLib`'s legacy (dead) rules.
- **Login identity in the `user` (frontend) app is not locally authoritative** — `UserIdentity::authenticate()` in `seedin-live-user` simply trusts whatever `user_id` the API app's `User/Info` endpoint returns; the frontend has no independent session validation of its own.

## Proposed MVP Scope for Revamp

**Must-have (v1):**
- Email/password login + registration for end users (borrower/investor/introducer), with modern password hashing (bcrypt/argon2, per-user salt) — replaces the MD5-crypt/static-salt scheme.
- SMS-OTP based mobile verification at registration, and OTP as an optional/step-up second factor for login and sensitive transactions (invest, withdraw, deposit) — this is core to the product's current UX and compliance posture.
- Per-device API key / session issuance with real per-device tracking (not one key per `service_type`), so duplicate-login detection can actually work.
- Admin/staff login with role-based access control — but replace the disabled-yii-rights + hand-rolled `PermissionLib` string-matching engine with a single, real, enforced RBAC model (role → permission → route/resource), since that is the system actually running today in all but name.
- Login attempt throttling (both admin and end-user) with a single shared rate-limiter implementation.
- Audit trail for business events (`Activity`-equivalent) — actively used by both the admin dashboard and end-user "your activity" views; must be preserved with its full event taxonomy.
- Password reset via emailed token, with token expiry.
- Facebook login/signup — but re-implemented with proper token audience verification (validate the token was issued to this app, not just that it resolves via the Graph API).

**Nice-to-have / defer:**
- Google social login — not implemented in the legacy system despite being named in scope; treat as new-build, not a migration item, and validate real business demand first.
- Full raw HTTP access-log persistence (`ServiceAccessLogs`) — the legacy system already disabled this in both repos without apparent incident; if revived, scope it to security-relevant events only (auth, permission changes, money-movement) rather than every API call, to control storage/PII exposure.
- PitakaMo-specific shared-secret partner authentication channel — only relevant if that partner integration continues.
- Admin "login as user" impersonation — genuinely useful for support, but must be rebuilt with per-admin signed/short-lived tokens and a mandatory audit log entry, not a static shared secret; do not carry over the existing mechanism as-is.
- The generic yii-rights-style authorization UI (arbitrary auth-item hierarchies/tasks/operations) — the business only ever used the flat role→permission→route model in practice; don't rebuild the fuller RBAC generality unless a concrete need emerges.
- `AdminLog` — currently broken/unused; drop unless a real requirement for a separate admin-action log (distinct from `Activity`) is identified.
