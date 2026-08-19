# Notifications & Communications

## Overview

This domain is the cross-cutting messaging layer used by every other domain in the SeedIn / New Union platform. It has no UI of its own for end users beyond an in-app notification/activity feed; instead it is a set of shared libraries and models (`EmailLib`, `SMSLib`, `Notification`, `PushNotification`, `Telegram`, `Device`) that other domains (registration, KYC/profile approval, fund transfer/withdrawal, loan investment, secondary trading, referrals) call into whenever something happens that a user or an internal admin needs to know about.

The codebase is duplicated near-verbatim across the **admin** repo (Yii `backend`/`cron` apps) and the **api-v1-1** repo (same `backend`/`cron` apps plus the `services` app that serves the mobile/web API) — diffing confirms `EmailLib.php`, `EmailLog.php`, `PushNotification.php`, `SMSLib.php`, and `Notification.php` are byte-identical between the two repos. The **user** repo (frontend) only renders notification/activity views and calls the API (`ServerNotificationController`, `ServerActivityController`) rather than sending anything itself; it also carries a dead/legacy `EmailLib.php` (old SendGrid API format, hardcoded `admin@newunion.sg` sender) that is referenced by only `PaypalController` and `ServerSiteController` and appears to be vestigial.

**Consumers by role:**
- **Borrower (fundseeker):** transactional emails/notifications for borrow request approval/rejection, loan finance success/failure, repayment/maturity notices, contract signing.
- **Investor (lender):** transactional emails/notifications for fund top-up, investment success, payout, withdrawal, secondary-market trade bidding/acceptance/cancellation, subscription maturity.
- **Introducer / Manager (referral hierarchy):** CC'd via `notifyIntroducer()` / `notifyManagers()` hooks on almost every user-facing email (registration, profile status, fund events) — currently **no-ops** in code (see Tech Debt).
- **Admin (back office):** receives admin-copy emails (`admin_*` templates) on nearly all financial events; manages email templates, email blasts, blast rules/groups, push-notification test tools, and email logs/queue via the Admin Dashboard.
- **System/automated (cron):** queued email retry sender, email blast sender, registration/profile completion reminders, one-off internal admin utility endpoints (`RunController`).
- **Internal ops (via Telegram):** every login, profile update, document/reference/bank change, password reset, investment attempt (success/failure), withdrawal/top-up, referral invite, and report download is broadcast to a Telegram chat for real-time ops monitoring — this is effectively an audit-trail integration, not a user-facing feature.

## Current Features & Flows

### Admin Dashboard (`seedin-live-admin` / `seedin-live-api-v1-1`, `applications/backend/controllers`)

**Email Blast** — `EmailBlastController.php`
- `actionIndex` / `actionIndex2` — list email blasts (report-grid view with inline "Blast now" / "Cancel" actions that POST to `EmailBlast/UpdateStatus`).
- `actionAdd` / `actionEdit` / `actionView` — create/edit/view an email blast (recipient picker modal, CKEditor body).
- `actionDownload` — export blast list to file via `ReportColumns::export`.
- `actionPreview` — render a blast's content merged into its selected `EmailBlastTemplate` layout for WYSIWYG preview.
- `actionRules` / `actionGroups` / `actionGroup($id)` — manage saved recipient rules (dynamic SQL-like filters) and static recipient groups (explicit user-id lists).
- `actionTemplates` / `actionTemplate($id)` / `actionAddTemplate` — manage reusable blast HTML layouts (the wrapper template a blast body gets inserted into).
- `actionRecipients($id)` / `actionRecipientsdownload($id)` — list/export the resolved per-user recipient rows and their send status for one blast.

**Email Templates** (transactional, admin-editable) — `EmailTemplateController.php`
- `actionIndex` — list transactional `email_template` rows.
- `actionAdd` / `actionEdit($id)` — create/edit a named template (`{placeholder}` merge-field body + subject), later sent via `EmailTemplate::sendNow()`.

**Email Logs / Queue** — `EmaillogsController.php`
- `actionIndex` / `actionLogs` — list the last 1000 non-queued (`is_queue=0`) sent-email log rows.
- `actionQueues` — list the last 1000 queued (`is_queue=1`) email-log rows (both pending and historical).
- `actionPending` — list only queued rows still `STATUS_PENDING`.
- `actionView($id)` — render the raw stored HTML body (from DB `body` column or from a log file on disk) of one log/queue entry.
- `actionTest` — ad-hoc endpoint to fire a test email to an arbitrary `?email=` address.

**Push Notifications (admin test tools)** — `PushnotificationController.php`
- `actionLogs` — list the last 5000 `push_notifications` rows.
- `actionTest` — render a manual push-test form.
- `actionPush1` — POST raw FCM payload JSON, sent via `FCMServiceLib::pushMessage()`.
- `actionPush3` — POST a device token + payload, sent via `APNSServiceLib::pushMessage()`.
- `actionPush2` — look up a user by mobile API key/token and send a push via `PushNotification::send()`.

**Internal ad-hoc utility endpoints** — `RunController.php` (not domain-specific, but touches notifications)
- `actionExecuteJobs` — drains legacy `cronjobs` table entries of type `notify_newpassword`: emails the user + a hardcoded ops address (`sujith@edifice.com.sg`) and SMS-es the new password in plaintext to the user's mobile.
- `actionCheckMail` — manual test to send a `credit_rating_approved_admin_notify` email to admin + admin CC.
- Other actions (`actionChangeUserType`, `actionRecalculateInvestments`, `actionResetBorrowerCounter`, `actionSendContracts`, `actionGenFundTxnRef`, `actionPhpInfo`) are one-off maintenance scripts, mostly unrelated to this domain (listed for completeness since the file is shared).

**Telegram bot command** — `telegram_commands/ChatidCommand.php`
- `/chatid` — replies with the current chat's Telegram `chat_id`, used by ops to discover the ID to hardcode into `TELEGRAM_ADMIN_CHAT_ID` / `TELEGRAM_USER_CHAT_ID` config constants.

### API (`seedin-live-api-v1-1`, `applications/services/controllers`)

**Notifications (in-app feed)** — `ServiceNotificationController.php`
- `GET Notification/Stats` — total / unread / read counts for the current user.
- `GET Notification/List` — paginated (10/page) list of the user's notifications, newest first; returns an empty-state payload with copy/icon when none exist.
- `GET Notification/View` — fetch + mark-as-read a single notification; strips `<a>` tags from the message body when called from a mobile client (`serviceType == 'mobile'`).
- `GET Notification/MarkAllAsRead` — bulk `UPDATE notifications SET is_read=1 WHERE user_id=...`.
- `POST Notification/SetRead` — mark a single notification read **or** log a "prompt" dismissal (`PromptLog`) by `prompt_id`/`type`, deduplicated via `PromptLog::checkExistsById/ByType`.
- `GET Notification/Prompts` — returns unread, `is_modal=1` notifications as blocking in-app prompt/modal messages (distinct from the passive notification feed).

### User App (`seedin-live-user`, `applications/frontend`)

- `NotificationController::actionList` — renders the notification list page (server-rendered shell; actual data proxied from API).
- `NotificationController::actionView($id)` — loads one notification, calls `setAsRead()`, decrements the user's unread badge counter, renders detail view. **Reads directly from the local `Notification` AR model rather than going through the API**, unlike the rest of the notification flow (inconsistent access pattern).
- `ActivityController::actionView($id)` — empty stub (no body) — dead/unfinished controller.
- `server/ServerNotificationController::actionList` — proxies `Notification/List` to the API, renders `_ajax_list` or `_ajax_list_side` partial depending on `?tpl=side`.
- `server/ServerNotificationController::actionView` — proxies `Notification/View`, renders `_ajax_view` partial.
- `server/ServerActivityController::actionList` — proxies `Activity/List` to the API, renders the activity feed partial (activity/audit log, a sibling feed to notifications).
- `server/ServerRequestController::actionWithdrawal($id)` / `actionDeposit($id)` — proxy `Activity/View` and render request-detail partials for a specific withdrawal/deposit activity record (drill-down from the activity feed).
- Views: `views/notification/{list,view,_ajax_list,_ajax_list_side,_ajax_view}.tpl`, `views/activity/{_ajax_list,view_type_14}.tpl`, `views/request/{deposit,withdrawal}.tpl`.
- `applications/common/config/apns/` — bundled `.pem`/`.p12` APNS certificate files (`apns-test.pem`, `apns-test2.pem`, `push.p12`) committed to source control (see Tech Debt).

## Business Logic & Computations

This domain itself performs little numeric business logic (the "real" fintech math lives in the loan/fund domains), but it contains several rules that must not be lost:

**1. Email delivery / TEST_MODE gating** (`EmailLib::send`, `seedin-live-admin/newunion/applications/common/lib/EmailLib.php:504-641`)
- If `TEST_MODE` is on, email is **not** sent to SendGrid unless the recipient matches `Yii::app()->params['always_email']` (an explicit allow-list) or a regex pattern in `always_email['patterns']`. Non-allowed test-mode sends are instead written to disk (`TEST_PATH.'email/'.date...html`) and logged.
- Live sends always go to `https://api.sendgrid.com/api/mail.send.json` via the legacy v2 SendGrid API with a hardcoded Bearer token in source (`Authorization: Bearer SG.N7tk1...`), `from = info@seedinph.tech`.
- Success is determined by `strtolower($response_array['message']) == 'success'`.

**2. Email queue / retry state machine** (`EmailLog`, `seedin-live-admin/newunion/applications/common/models/EmailLog.php`)
- Statuses: `PENDING(0)`, `DELIVERED(1)`, `FAILED(2)` (retryable), `FATAL(3)` (not retried).
- `EmailLog::getAllPendingQueue()` selects rows where `is_queue=1 AND status IN (PENDING, FAILED) AND attempts < 2` — i.e. **max 2 delivery attempts** before a message is silently abandoned (never marked FATAL automatically; it simply stops being picked up once `attempts >= 2`).
- `EmailLog::queue($to, $data, $type)` supports two payload shapes: `_action_` (dispatches to a named `EmailLib::<method>` static, passing `$data` and the log row itself) or `_subject_`/`_tpl_` (generic template-driven send, auto-selecting `admin` vs `user` wrapper template based on whether the template name starts with `admin`).
- `EmailSenderCommand` (cron) increments `attempts` **before** calling `->send()`, then either sets `DELIVERED` or `FAILED` + stores the failure `response`.

**3. Email blast recipient resolution** (`EmailBlast::blastNow()`, `seedin-live-admin/newunion/applications/common/models/EmailBlast.php:159-245`)
- Recipients are stored as a JSON array of tokens, each either `rule{N}` (dynamic, resolved via `EmailBlastRule::users()`) or `group{N}` (static id list, resolved via `EmailBlastGroup::userIds()`).
- Rule resolution builds a `CDbCriteria` filtering on `dashboard_type`, `status`, and a fund comparison: `round(fund.balance - fund.on_hold, 2) {operator} {fund_value}` where operator is one of `=`, `>`, `>=`, `<`, `<=` (`EmailBlastRule::users()`, lines 54-70) — i.e. blast segmentation by **available balance** (balance minus funds on hold).
- **Hardcoded exclusion list**: user IDs `7`, `36`, `411` are explicitly skipped when resolving `rule` recipients (`EmailBlast.php:200-209`), with only inline comments ("sir edison", "sir ansong", "aubrey rose") explaining why — no config-driven suppression list.
- Resulting user IDs are deduped and persisted as `EmailBlastRecipient` rows (idempotent — `EmailBlastRecipient::create()` checks existence by `blast_id`+`user_id` first), then blast status flips `PENDING/PREPARING → BLASTED`.

**4. Email blast send / merge-field substitution** (`EmailBlastCommand::actionIndex`, `seedin-live-admin/newunion/cron/protected/commands/EmailBlastCommand.php`)
- Per-recipient merge fields (`EmailBlast::defaultVariables($user)`): `{firstname}`, `{lastname}`, `{name}`, `{address}`, `{funds}` (= `Currency::s($user->availableFunds())`), `{mobile}`, `{email}`.
- Recipient body is substituted, then wrapped into the blast's `EmailBlastTemplate.content` (`{content}` placeholder), then wrapped again into a static layout file (`backend/views/layouts/emailblast.tpl`).
- No blast-level rate limiting, batching, or unsubscribe-link injection is present in this loop.

**5. Notification unread counter** (`Notification::send`, `seedin-live-admin/newunion/applications/common/models/Notification.php:136-146`)
- Every `Notification::send()` call increments a denormalized `user.notification_count`-style counter (`$user->incNotification()->save()`), and `NotificationController::actionView` decrements it on read — this counter is *not* recomputed from the `notifications` table, so it can drift if increments/decrements are missed (e.g. bulk "mark all read" via the API updates `is_read` directly without touching the counter — see Tech Debt).

**6. OTP delivery channel selection** (`OTPLib::send`, `seedin-live-api-v1-1/newunion/applications/common/lib/OTPLib.php:28-67`) — directly feeds SMS/Email sending in this domain:
- OTP code: 6-digit random (`rand(100000,999999)`), lifespan **5 minutes** (`OTPLib::$otp_lifespan`).
- In `TEST_MODE`, the OTP is hardcoded to `"123123"` — a standing backdoor code in non-prod environments.
- Channel choice: `$user->otp_sender == User::OTP_SENDER_MAIL` → email OTP (`EmailLib::sendOTP`); otherwise SMS OTP (`SMSLib::sendOTP`).
- `TEST_MODE` + staging host detection (`preg_match("/^staging/", $_SERVER['HTTP_HOST'])`) force-reroutes the SMS to a fixed test number `+6588287430`, regardless of the actual user's mobile number.
- OTP validation (`OTPLib::validate`) matches on `mobile_no + token_id + code` and checks `expire_at > now()`.

**7. SMS provider selection** (`SMSLib::send`, `seedin-live-admin/newunion/applications/common/lib/SMSLib.php:25-46`)
- Provider chosen at send time via `Setting::get('sms_provider','replyx')` — DB-configurable switch between `twilio` and `replyx` (default), letting ops flip providers without a deploy.
- ReplyX is called over a plain HTTP GET with a static API key embedded in source (`sKey`), success determined by `strpos($response->getBody(),'ok') === 0`.
- Twilio uses different hardcoded SID/token pairs for `TEST_MODE` vs live, and a fixed `From` number `+17868286291`.

**8. Push notification queue-vs-send + attempt cap** (`PushNotification`, `seedin-live-admin/newunion/applications/common/models/PushNotification.php`)
- `PushNotification::queue()` only creates a row if the user has a `UserApiKey` of `service_type='mobile'` with a non-empty `device_id` — users without a registered mobile device silently get no push row at all.
- `status()` derives display status from `attemps >= 4 → 'Failed'`, `status==1 → 'Sent'`, else `'Pending'` — implying a **4-attempt retry cap**, though the actual `push()` delivery method that increments `attemps` is currently **hardcoded to `return FALSE` immediately** (`PushNotification.php:47-49`) — i.e. push sending is code-disabled platform-wide except when triggered synchronously via `send()` under `TEST_MODE`.
- `FCMServiceLib::push()` / `APNSServiceLib::push()` (api repo only) construct the actual FCM/APNS payloads when invoked directly (bypassing the disabled `push()` method), used by the admin test tools and inline in a few flows (`FundRequest`, `LoanRequest`, `LoanLib`, `CoinsPH`, `ServerRequestController`).

**9. Repayment table computation in "Crowdfunding Success" email** (`EmailLib::CrowdFundingSuccessApproved`, lines 387-436)
- For each repayment row: `net = LoanLib::interestNet($row['interest'], $row['principal'])` (interest/principal net-of-fee calculation defined in the Loans domain, not here) — the notification layer sums `total_principal`, `total_interest`, `total_net` across all repayment rows and renders an HTML repayment schedule table directly in the email body. This is the one place in this domain where a financial schedule is rendered, so the rebuild must preserve the same per-row net calculation reference (`LoanLib::interestNet`) rather than re-deriving it.

**10. Registration/profile reminder cadence** (cron, described below under Cron/Automation) — every-3-days and fixed day-3/day-4 reminder rules are hardcoded business logic for nudging incomplete signups.

## Data Model

Inferred from `ActiveRecord` classes and migration files (no ORM schema file found; columns beyond migrations are inferred from model usage):

| Table | Key columns (from code) | Notes |
|---|---|---|
| `email_logs` (`EmailLog`, PK `email_log_id`) | `created_at`, `email`, `subject`, `body`, `filename`, `status`, `delivered_at`, `is_queue`, `type`, `data` (JSON), `attempts`, `response`, `parent_id` | No migration file found (predates migration tracking); dual-purpose table for both **sent-email audit log** and **retryable send queue** (`is_queue` flag distinguishes them). `type` currently only has `TYPE_FUNDREACHMATURITY(1)` besides `TYPE_DEFAULT(0)`. |
| `email_template` (`EmailTemplate`, PK `tpl_id`) | `name` (unique), `subject`, `template`, `params`, `created_at`, `created_by` | `m200525_133135_email_template.php`. Admin-managed transactional templates, distinct from the file-based `.mail`/`.ntf` templates used by `EmailLib`/`Notification`. |
| `email_blast` (`EmailBlast`, PK `blast_id`) | `admin_id`, `content`, `created_at`, `status`, `name`, `target` (JSON array of `rule{N}`/`group{N}` tokens, originally an int enum before `m180208`/`m180823` migrated it to TEXT), `template_id` (FK → `email_blast_template`) | `m180122_084750_emailblast.php` + `m180208_054108_emailblast_target.php` + `m180823_015550_email_blast.php`. |
| `email_blast_recipient` (`EmailBlastRecipient`, PK `recipient_id`) | `blast_id` (FK), `user_id` (FK), `created_at`, `status` (0=Pending,1=Sent) | Junction table populated by `EmailBlast::blastNow()`, consumed by `EmailBlastCommand`. |
| `email_blast_rules` (`EmailBlastRule`, PK `rule_id`) | `name`, `condition` (JSON: `dashboard_type`, `status`, `funds` operator, `fund_value`), `created_at`, `created_by` | Seeded with 3 default rules (All Users / All Investors / All Fund Seekers) in `m180823`. |
| `email_blast_groups` (`EmailBlastGroup`, PK `group_id`) | `name`, `ids` (JSON array of user_ids), `created_at`, `created_by` | Static recipient lists. |
| `email_blast_template` (`EmailBlastTemplate`, PK `template_id`) | `name`, `content` (HTML wrapper with `{content}` placeholder), `created_at`, `status` | Blast layout/wrapper templates. |
| `notifications` (`Notification`, PK `notification_id`) | `user_id` (FK → `User`), `title`, `message`, `is_read`, `is_modal` (added by `m180815_101838_notification.php`), `created_at` | In-app notification feed; `is_modal=1` rows surface as blocking prompts via `Notification/Prompts`. |
| `push_notifications` (`PushNotification`, PK `id`) | `user_id` (FK), `created_at`, `message` (JSON `{title, body}`), `device_os`, `status`, `attemps` (sic — typo retained in schema/code) | No migration file found. |
| `devices` (`Device`, PK `id`) | `created_at`, `user_id`, `status`, `device_id`, `device_uuid`, `os`, `brand`, `otp_enabled`, `bio_enabled` | `m180816_013812_device.php`; also created sibling `user_security` table (`otp_enabled`, `bio_enabled`, `is_mobile_verified`, `mobile_otp_enabled`) and added `api_key.device_uuid`. |
| `cronjobs` (`CronJob`, PK `job_id`) | `type` (string enum), `data` (JSON), `is_executed`, `created_at`, `executed_at` | Legacy generic job queue; comments mark `CRONTYPE_NOTIFY_INTRODUCERS`, `CRONTYPE_NOTIFY_MANAGERS`, `CRONTYPE_NOTIFY_NEW_PASSWORD`, `CRONTYPE_QUEUE_MAIL` as **deprecated in favor of `EmailLog`**, but `CRONTYPE_NOTIFY_NEW_PASSWORD` is still actively drained by `RunController::actionExecuteJobs`. |
| `otp` / `otp_attempts` (`Otp`, `OtpAttempts`) | `mobile_no`, `token_id`, `code`, `expire_at`, `details`, `datecreated` | Adjacent OTP domain, but its delivery step (`OTPLib::send`) is the trigger for both `EmailLib::sendOTP` and `SMSLib::sendOTP`. |

File-based template stores (not DB): `EMAIL_TEMPLATE` directory of `*.mail` files (transactional email bodies, e.g. `signup_thankyou.mail`, `fund_maturity.mail`, `admin_fund_maturity.mail`, `otp_email.mail`) and `NOTIFICATION_TEMPLATE` directory of `*.ntf` files (in-app notification bodies) — both use `{placeholder}` string replacement, no templating engine.

## Cron/Automation Dependencies

All found under `newunion/cron/protected/commands/` (identical in both `admin` and `api-v1-1` repos):

- **`EmailSenderCommand`** — drains `EmailLog::getAllPendingQueue()` (queued transactional emails with `attempts < 2`), the core retry worker for the queue described above. Intended to run frequently (minutes).
- **`EmailBlastCommand::actionIndex`** — sends to all `EmailBlastRecipient` rows still `STATUS_PENDING` whose blast has a resolved template; marks each `STATUS_SENT` after send.
- **`EmailBlastCommand::actionBlastPreparingNow`** — finds `EmailBlast` rows in `STATUS_PREPARING` and calls `blastNow()` to resolve rules/groups into recipient rows (the two-phase "prepare recipients" → "send" split allows a large blast to be staged before the actual send window).
- **`UserRegistrationReminderCommand`** — two independent reminder loops: (a) for users with a pending `Request::TYPE_PROFILE_APPROVAL` and incomplete proof/reference docs, emails every 3rd day since request creation (`diff->days % 3 == 0`); (b) for `User::STATUS_VERIFIED` users, emails on exactly day 3 (`user_profile_reminder_3_days` template) and exactly day 4 (`user_profile_reminder_4_days` template) since account creation.
- **`UserProfileReminderInitCommand`** — simpler variant: emails every `User::STATUS_VERIFIED` user whose account is more than 1 day old with the day-3 reminder template, unconditionally (used as a one-time backfill/init job, distinct cadence from the recurring reminder command above).
- **`ResendEmailCommand`** — manual one-off resend utility (currently short-circuited by a leading `exit;`), used historically to re-send `CrowdFundingSuccessApproved` and `FundPayoutSuccess` emails for specific hardcoded borrow/loan IDs. Kept as an operational runbook script, not a scheduled job.
- **`TestSendgridCommand`** (api repo only) — broken/incomplete diagnostic script (references undefined `$toArray`, `$subject`, `$body`) for testing the legacy v2 SendGrid API directly.
- **Trashed commands** (`cron/protected/commands/trash/`, no longer wired into any crontab but present in source):
  - `NotifyIncomingDueDateCommand` — emailed a hardcoded ops address + admin email 4–5 days before a borrower's next repayment due date.
  - `NotifyIntroducersCommand` / `NotifyManagersCommand` — drained the (now-disabled) `CronJob` queue populated by `EmailLib::notifyIntroducer()`/`notifyManagers()` to forward copies of user-facing emails to the user's introducer/manager chain.
- **`RunController::actionExecuteJobs`** (HTTP-triggered admin action, not a true cron, but functions as one) — drains `cronjobs` rows of type `notify_newpassword`: emails the new password to the user and a hardcoded ops inbox, and SMS-es the plaintext new password to the user's mobile.

## Integrations

| Service | Purpose | Where |
|---|---|---|
| **SendGrid** (legacy v2 REST API `api.sendgrid.com/api/mail.send.json`) | Transactional + blast email delivery | `EmailLib::send()` — hardcoded Bearer API key in source; `from = info@seedinph.tech` |
| **ReplyX** (`replyx.com.sg` / `app.replyx.com` SOAP/HTTP) | Default SMS provider (OTP, notifications, new-password SMS) | `SMSLib::sendViaReplyX()` — hardcoded API key, plain HTTP GET |
| **Twilio** | Alternate SMS provider, selectable via `Setting::get('sms_provider')` | `SMSLib::sendViaTwilio()` — hardcoded SID/token (different pair for test vs live), fixed sender number |
| **Firebase Cloud Messaging (FCM)** | Android push notifications | `FCMServiceLib::pushMessage()` — hardcoded legacy FCM server key, plain `fcm.googleapis.com/fcm/send` REST call |
| **Apple Push Notification service (APNS)** | iOS push notifications | `APNSServiceLib::pushMessage()` — raw TCP/TLS socket to `gateway.sandbox.push.apple.com:2195` (legacy binary APNS protocol, sandbox endpoint even implied for "production" branch selection since it's the same hardcoded sandbox host either way) using bundled `.pem` certs in `seedin-live-user/newunion/applications/common/config/apns/` |
| **Telegram Bot API** (`longman/telegram-bot` PHP library) | Internal ops alerting — logs nearly every significant user/admin action to a Telegram chat in near-real time | `Telegram::log()`; chat routing by `APPNAME` (`backend` → `TELEGRAM_ADMIN_CHAT_ID`, else → `TELEGRAM_USER_CHAT_ID`); `/chatid` bot command for chat-id discovery |
| **SwiftMailer** (imported but effectively unused) | Legacy mail transport, superseded by direct SendGrid cURL calls; `EmailLib::send2()` (dead alternate method) still builds `SwiftMailer::message()` in commented-out code | `EmailLib.php` top-of-file import |

## Tech Debt / Risks Observed

- **Hardcoded secrets in source control**: SendGrid Bearer token, Twilio SID/token pairs (test and live), ReplyX API key, FCM legacy server key are all embedded directly in PHP files (`EmailLib.php:576`, `SMSLib.php:54-58, 17/21`, `FCMServiceLib.php:40`). APNS `.pem`/`.p12` certificate files are committed to the `seedin-live-user` repo.
- **Push notifications are code-disabled**: `PushNotification::push()` unconditionally `return FALSE` before doing any work (`PushNotification.php:47-49`), meaning the FCM/APNS integration paths behind the standard queue→push flow are dead code in production; only the admin manual test endpoints (`Pushnotification/Push1`/`Push3`) and `TEST_MODE` synchronous sends actually reach FCM/APNS.
- **Introducer/manager notification fan-out is a no-op**: `EmailLib::notifyIntroducer()` and `EmailLib::notifyManagers()` are called from ~20 places across `EmailLib` but their bodies are entirely commented out (`EmailLib.php:478-502`) — every call site silently does nothing, while the corresponding cron drain commands (`NotifyIntroducersCommand`, `NotifyManagersCommand`) have also been moved to a `trash/` directory. This is a large amount of dead call-site surface implying a feature that was removed but not cleaned up.
- **Two independent email-sending code paths with divergent behavior**: `EmailLib::send()` (active, SendGrid v2 REST via cURL) vs `EmailLib::send2()` (dead, references undefined `$options`/SendGrid PHP SDK v1 style, kept commented in-body) vs the `seedin-live-user` repo's own separate `EmailLib::send()` (uses old `api_user`/`api_key` SendGrid v1 auth style, different hardcoded sender `admin@newunion.sg`, no logging) — three divergent implementations of "send an email" across the codebase.
- **Email queue silently abandons messages after 2 failed attempts**: `EmailLog::getAllPendingQueue()` filters `attempts < 2`; there is no explicit transition to `STATUS_FATAL` or alerting when a message exhausts retries — it simply stops appearing in the query and is invisible unless someone checks `Emaillogs/Queues` manually.
- **Denormalized unread-notification counter can drift**: `user.notification_count`-style field is incremented on send and decremented on individual view, but the bulk `Notification/MarkAllAsRead` API endpoint updates `is_read` directly via `updateAll()` without touching the counter — counter and actual unread count can diverge.
- **Hardcoded blast-recipient exclusion list**: three specific user IDs (`7`, `36`, `411`) are skipped by name-in-comment inside `EmailBlast::blastNow()` rather than via any admin-configurable suppression/opt-out list.
- **Inconsistent data-access pattern for notifications**: the user-app's `NotificationController` reads the `Notification` ActiveRecord directly against the shared DB, while `ServerNotificationController`/`ServerActivityController` proxy through the API service layer — two different architectural patterns for the same feature within one repo.
- **`ActivityController::actionView($id)` is an empty stub** in the user repo — dead/unfinished code path.
- **No unsubscribe / consent tracking** visible anywhere in the email-blast or transactional-email flow — no suppression list, bounce handling, or opt-out mechanism beyond the hardcoded ID exclusion above.
- **OTP hardcoded bypass code in `TEST_MODE`**: `OTPLib::send()` always issues code `"123123"` when `TEST_MODE` is on, and force-reroutes SMS OTPs to a fixed number `+6588287430` on staging hosts — a standing security bypass that must not leak into any shared/staging environment reachable by real users.
- **Legacy SendGrid v2 API** (`api.sendgrid.com/api/mail.send.json`) is deprecated by SendGrid; the current integration is on an unsupported API version.
- **APNS integration uses the legacy binary protocol against the sandbox gateway even in the "production" code branch** (`APNSServiceLib.php:39-43` selects between two files but both connect to `gateway.sandbox.push.apple.com`), and Apple has fully retired the legacy binary APNS provider API in favor of HTTP/2 — this integration would not function against current Apple infrastructure regardless.
- **Plaintext password delivery**: `RunController::actionExecuteJobs` and `RunController`'s SMS payload both email/SMS a newly generated plaintext password to the user (and a hardcoded third-party ops inbox `sujith@edifice.com.sg`).
- **No migration files for `email_logs` or `push_notifications` tables** — schema for these two heavily-used tables is not tracked in the migrations directory (predates migration adoption), so the rebuild team cannot rely on migrations alone to recover the full column list; must inspect a live DB dump.
- **`ResendEmailCommand` and `TestSendgridCommand`** are non-functional as committed (`exit;` guard / undefined variables) — effectively dead code kept for reference only.

## Proposed MVP Scope for Revamp

**Must-have (v1):**
- Transactional email sending with a retryable queue and delivery/failure logging — this is the backbone every other domain depends on for confirmations, approvals/rejections, and financial-event receipts. *Rationale: nearly every business flow in the platform (registration, KYC, funding, investing, withdrawals) terminates in a transactional email; without it those flows are silently incomplete.*
- In-app notification feed (list, unread count, mark-as-read, mark-all-as-read) — core UX for both borrower and investor dashboards. *Rationale: currently the only in-product signal users get for async events; explicitly tested via API contract (`Notification/List`, `/Stats`, `/View`, `/MarkAllAsRead`).*
- SMS OTP delivery with a single, well-monitored provider — required for login/2FA and password-reset flows. *Rationale: security-critical path; the dual-provider abstraction can be simplified to one modern provider (e.g. Twilio only) since ReplyX is a legacy, less standard integration.*
- Admin email-log/queue visibility (view sent/queued/failed messages) — operational necessity for support and debugging. *Rationale: without it, support cannot diagnose "I never got my email" tickets.*
- Telegram (or equivalent) internal ops alerting for security-sensitive events (login, password change, withdrawal, investment) — cheap, currently pervasive, high operational value. *Rationale: already deeply embedded in ops workflow across ~30+ call sites; low cost to keep, valuable fraud/ops signal.*

**Nice-to-have / defer:**
- Email blast / marketing campaign tooling (rules, groups, templates, preview, recipient tracking) — defer to v2 unless marketing team has an immediate hard dependency. *Rationale: self-contained admin feature, not on the critical path of a core borrower/investor transaction; can be replaced short-term by a third-party ESP (e.g. SendGrid Marketing, Customer.io) rather than rebuilt bespoke.*
- Push notifications (FCM/APNS) — defer. *Rationale: already effectively disabled in production (`push()` hardcoded to return false); rebuilding requires a new APNS HTTP/2 integration from scratch anyway since the legacy binary protocol is retired by Apple, so there's no legacy logic worth preserving beyond "user has X device, send title/body."*
- Introducer/manager CC notification fan-out — defer/re-scope. *Rationale: dead code in the current system (no-op for years); revisit only if the referral/introducer program is being actively relaunched, and redesign as a proper subscription/notification-preference model rather than hardcoded CC chains.*
- Admin-editable transactional email template CRUD (`EmailTemplate`) as a live DB-backed system — nice-to-have; v1 can ship with code-defined templates (like the current `.mail`/`.ntf` file approach) and add a template-management UI later. *Rationale: reduces v1 scope while template content is still being finalized; the file-based approach already used for most transactional emails is simpler to port initially.*
- Multi-provider SMS failover (Twilio + ReplyX switch) — defer to single provider for v1, revisit failover only if delivery reliability becomes a measured problem. *Rationale: added complexity with no evidence in the code of automatic failover logic (it's a manual admin-set switch, not a real failover).*
- Blast-level rate limiting, unsubscribe links, and suppression-list management — must be added if/when blast marketing is rebuilt, but out of scope for the notifications-core MVP. *Rationale: currently entirely absent from the legacy system, so it's new functionality rather than logic being preserved — build it properly when blast is prioritized, not as a stopgap.*
