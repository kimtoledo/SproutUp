# Manual test plan & results

Systematic black-box execution. **PASS** = behaved as a correct system should; **FAIL** = defect
(linked); **NOTE** = works but worth recording. All against API `:3002`, Web `:3000`, 2026-08-29.

Legend for "Evidence": condensed request → observed response.

---

## 1. Health, contract, transport

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 1.1 | `GET /health` | 200, no DB touch | PASS | `{"status":"ok","service":"api"}`, Helmet headers present |
| 1.2 | `GET /v1/health` | 200 + `dependencies.database:"ok"` + `SproutUp-API-Version: 1` | PASS | header present on `/v1/*` only |
| 1.3 | `GET /openapi.json` | 3.1 doc, `sessionCookie` scheme, self path hidden | PASS | `openapi: "3.1.0"`, `/openapi.json` absent from `paths` |
| 1.4 | `GET /openapi.json` role-approval `payload` shape | described object | FAIL | `{ "type":"object" }` — [F-20](findings.md#f-20) / [F-01](findings.md#f-01) |
| 1.5 | `PUT /v1/health`, `GET /v1/%2e%2e/` | 404 | PASS | clean 404s, no stack |
| 1.6 | CORS: `Origin: https://evil.example.com` on `GET /v1/health` | no `Access-Control-Allow-Origin` | PASS | 200 body but ACAO absent → browser blocks |
| 1.7 | CORS preflight from allowed `http://localhost:3000` | 204 + ACAO + methods + `allow-credentials` | PASS | `access-control-allow-methods: GET,HEAD,POST` |
| 1.8 | `X-Forwarded-For` spoof on rate-limit bucket | ignored (fixed key) | FAIL | fresh bucket per forged IP — [F-03](findings.md#f-03) |
| 1.9 | Malformed JSON body | 400 | FAIL | 500 `INTERNAL_ERROR` — [F-06](findings.md#f-06) |
| 1.10 | `Content-Type: text/plain` on JSON route | 4xx | PASS | 400 `VALIDATION_ERROR` |
| 1.11 | Rate-limit headers on normal call | present | PASS | `x-ratelimit-limit: 120` |

## 2. Registration & authentication

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 2.1 | Sign-up borrower (valid) | 200 + session cookie (`HttpOnly; SameSite=Lax`), role `sme_borrower` | PASS | cookie `better-auth.session_token`, `Max-Age=604800` |
| 2.2 | Sign-up investor (valid) | role `investor` + `investor_onboarding.*_own` | PASS | via `session-context` |
| 2.3 | Sign-up, `registrationIntent` omitted | rejected, field named | PASS | `MISSING_FIELD` |
| 2.4 | Sign-up, `registrationIntent: "super_admin"` / `"staff"` | rejected, no user, no escalation | PASS (functional) / NOTE | rejected but generic `FAILED_TO_CREATE_USER` — [F-23](findings.md#f-23) |
| 2.5 | Sign-up, password `"short"` | rejected | PASS | `PASSWORD_TOO_SHORT` |
| 2.6 | Sign-up, name `<script>alert(1)</script>` | stored; must be inert in UI | NOTE | stored & returned raw in JSON (correct for an API); React auto-escapes in `/portal` so not exploitable in current UI. No server-side name normalisation/length cap observed beyond Better Auth. |
| 2.7 | Sign-in wrong password (known user) | generic message | PASS | `INVALID_EMAIL_OR_PASSWORD` |
| 2.8 | Sign-in unknown user | **same** message as 2.7 | PASS | identical `INVALID_EMAIL_OR_PASSWORD` — no user enumeration |
| 2.9 | Rapid repeated sign-up/sign-in | throttled per-IP | FAIL | throttled **globally** (`no-trusted-ip` bucket) — [F-02](findings.md#f-02) |
| 2.10 | `GET /v1/session-context` no cookie | 401 | PASS | `UNAUTHENTICATED` |
| 2.11 | `GET /v1/session-context` garbage cookie | 401 | PASS | forged token rejected |
| 2.12 | `session-context` shape | `user{id,email,name}` + `roles[]` + `permissions[]` | PASS | matches `authorizationContextSchema` |

## 3. Sessions

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 3.1 | `GET /v1/sessions` | own sessions, no tokens, `current` flag | PASS | returns `id, createdAt, expiresAt, ipAddress, userAgent, current` |
| 3.2 | `ipAddress` value locally | `null` or a real IP | NOTE | returns `""` → blank line in portal UI — [F-15](findings.md#f-15) |
| 3.3 | `DELETE /v1/sessions/:id` bad UUID | 400 | PASS | `VALIDATION_ERROR` |
| 3.4 | `DELETE /v1/sessions/:id` unknown UUID | 404 | PASS | `NOT_FOUND` |
| 3.5 | Revoke own non-current session | 204 + audit | NOT RUN | only one session per jar in this pass; code path + unit tests reviewed, look correct |

## 4. Onboarding — customer (borrower / investor)

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 4.1 | `POST /v1/onboarding/cases {caseType:"borrower"}` as borrower | 201 draft v1 | PASS | |
| 4.2 | Create second borrower case while one open | 409 | PASS | `OPEN_CASE_EXISTS` (partial unique index) |
| 4.3 | Create `investor` case as borrower | 403 | PASS | `FORBIDDEN` (per-journey permission) |
| 4.4 | `GET /v1/onboarding/cases` | only own, only permitted types | PASS | |
| 4.5 | `GET /v1/onboarding/cases/:id` own | case + ordered immutable events | PASS | `created`, `submitted` events with version + actor |
| 4.6 | `GET` another user's case id | indistinguishable from missing | PASS | 404 `CASE_NOT_FOUND` (borrower2 → borrower1's case) |
| 4.7 | Submit with wrong version | 409 | PASS | `STALE_CASE_VERSION` |
| 4.8 | Submit with `version: 0` | 400 | PASS | `VALIDATION_ERROR` |
| 4.9 | Submit with correct version | 200, status `submitted`, version+1, `submittedAt` set | PASS | |
| 4.10 | Submit an already-`submitted` case | 409 | PASS | `INVALID_CASE_TRANSITION` |
| 4.11 | Withdraw with 8-char reason | 400 (min 10) | PASS | `VALIDATION_ERROR` |
| 4.12 | Withdraw a `rejected` case | 409 | PASS | `INVALID_CASE_TRANSITION` |
| 4.13 | Submit a `rejected` case | 409 | PASS | `INVALID_CASE_TRANSITION` — [F-04](findings.md#f-04): rejected is a dead end |
| 4.14 | Create a fresh case after rejection | 201 | PASS | rejected case does not hold the open-journey slot |
| 4.15 | Reach `approved` | some path exists | FAIL | **no approve endpoint anywhere** — [F-04](findings.md#f-04) |
| 4.16 | Resubmit after `needs_information` | returns to `submitted`, reviewer retained | PASS (mechanics) / NOTE | nothing for the applicant to actually change — [F-17](findings.md#f-17) |

## 5. Onboarding — staff review (maker/checker)

Accounts: `reviewer2` = maker/assignee, `reviewer1` = other reviewer, `borrower` = applicant.

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 5.1 | `GET /v1/admin/onboarding/cases` as borrower | 403 | PASS | `FORBIDDEN` (`onboarding_cases.review` msg) |
| 5.2 | Queue as `compliance_officer` | paged list + `applicantName/Email` + counts | PASS | `page,pageSize,total` |
| 5.3 | Queue unfiltered | should not surface `draft` | FAIL | `draft` case shown with PII — [F-11](findings.md#f-11) |
| 5.4 | Queue `pageSize=1000` | 400 (cap 100) | PASS | |
| 5.5 | Queue `page=-1` | 400 | PASS | |
| 5.6 | Queue `page=99999` | 400 (cap 10000) | PASS | bounded; could be friendlier as empty page |
| 5.7 | `start-review` (submitted, v2) | 200, `in_review`, `assignedReviewerUserId` = me | PASS | |
| 5.8 | Other reviewer `start-review` same case | 409 | PASS | `CASE_ASSIGNED_TO_OTHER` |
| 5.9 | Other reviewer `request-information` | 403 | PASS | `NOT_ASSIGNED_REVIEWER` |
| 5.10 | Assignee `request-information` v3 (10–1000 reason) | 200, `needs_information` | PASS | reason on event, applicant-visible |
| 5.11 | Applicant resubmits v4 | 200, `submitted`, reviewer retained | PASS | |
| 5.12 | Assignee `start-review` again (resume) | 200, `in_review` | PASS | |
| 5.13 | Assignee `reject` v6 (reason) | 200, `rejected`, `decidedAt` set | PASS | immutable `rejected` event with reason |
| 5.14 | Applicant self-review own case | blocked | PASS (by code) | `self_review_not_allowed` guard in all three review ops; not run live but confirmed in `review-service.ts` |
| 5.15 | Reassign / release / escalate | some path | FAIL | none exists — [F-22](findings.md#f-22) |
| 5.16 | Staff read of applicant detail | audit event recorded | FAIL | read is `auditEvent: null`; no "who viewed whom" — see [F-09](findings.md#f-09) discussion |

## 6. Role approvals (maker/checker)

Accounts: `admin1` = only `roles.assign` holder.

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 6.1 | `GET /v1/admin/roles` as `super_admin` | roles + effective permission keys | PASS | |
| 6.2 | `GET /v1/admin/users?query='...OR 1=1--` | literal search, no injection | PASS | `total 0`; `query=sproutup.test` → 4 rows |
| 6.3 | `GET /v1/admin/users` fields | identity + status + roles + createdAt; **no** hashes/tokens/sessions | PASS | |
| 6.4 | Propose `compliance_officer` grant to another user (10–500 reason) | 201 pending, payload hash, 24h expiry | PASS | |
| 6.5 | Propose `super_admin` grant | rejected | PASS | `RESTRICTED_ROLE` |
| 6.6 | Propose grant targeting self | rejected | PASS | `SELF_TARGET_NOT_ALLOWED` |
| 6.7 | Propose duplicate pending payload | 409 | PASS | `DUPLICATE_PENDING_APPROVAL` (`unique_pending_approval`) |
| 6.8 | Maker approves own proposal | rejected | PASS | `MAKER_CHECKER_CONFLICT` |
| 6.9 | Non-`roles.assign` user approves / lists | 403 | PASS | `FORBIDDEN` |
| 6.10 | Maker cancels own proposal (reason) | ok, status `cancelled`, action logged | PASS | audit `approval.cancelled` written |
| 6.11 | `GET /v1/admin/role-approvals` (history) `payload` | shows role + target | FAIL | `payload: {}` — [F-01](findings.md#f-01) |
| 6.12 | `GET /v1/admin/role-approvals/:id` timeline | actions with actor + reason + metadata | PARTIAL | actions/reasons OK; `payload: {}` and `metadata: {}` — [F-01](findings.md#f-01) |
| 6.13 | `/admin/role-approvals` History panel renders | list of past approvals | FAIL (derived) | `shortId(undefined).slice` throws on every history row — [F-01](findings.md#f-01) |
| 6.14 | Execute a role change end-to-end (approve as independent checker) | role granted + audit | BLOCKED | needs a 2nd `roles.assign` holder that can't be created via the workflow — [F-05](findings.md#f-05) |
| 6.15 | Revocation cannot remove a user's last role | `LAST_ROLE_NOT_ALLOWED` | NOT RUN | mapped in client + service; blocked by 6.14 |

## 7. Web UI (rendered)

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 7.1 | `GET /` (landing) | SSR content + working links, no JS required to read | PASS | hero copy + nav present in raw HTML |
| 7.2 | `GET /login`, `/register` SSR shell | form markup, labels, `autocomplete` | PASS | `type=email/password`, `minLength=12` on register |
| 7.3 | Web security headers | CSP / XFO / HSTS / nosniff / Referrer-Policy | FAIL | none present — [F-07](findings.md#f-07) |
| 7.4 | `X-Powered-By` | absent | PASS | `poweredByHeader: false` |
| 7.5 | `GET /nonexistent` | 404 | PASS | default Next 404 |
| 7.6 | `GET /portal`, `/admin/onboarding` without cookie | 200 shell → client-side gate to "sign-in required" | PASS (arch) | no SSR redirect; brief loading → gated state |
| 7.7 | Intent picker is a real form control | radio/hidden input | FAIL | `<button aria-pressed>` only — [F-18](findings.md#f-18) |
| 7.8 | Out-of-the-box `npm run dev:web` reaches the API | yes | FAIL | falls back to `:3001`, API is on `:3002` — [F-10](findings.md#f-10) |
| 7.9 | Portal case card copy | user-meaningful | NOTE | shows raw "Version N" — [F-19](findings.md#f-19) |
| 7.10 | Rejected-applicant guidance | next step shown | FAIL | none — [F-16](findings.md#f-16) |

## 8. Data integrity / audit

| # | Test | Expected | Result | Evidence / note |
| --- | --- | --- | --- | --- |
| 8.1 | `onboarding_case_events` after lifecycle | append-only, ordered, versioned, actor + reason | PASS | 7 events for the driven case, monotonic versions |
| 8.2 | `audit_events` UPDATE/DELETE | rejected by trigger | PASS (schema) | `prevent_audit_events_mutation` triggers present |
| 8.3 | `audit_events.ip_address_hash` | populated | FAIL | always NULL — [F-08](findings.md#f-08) |
| 8.4 | Audit on denied actions | recorded | FAIL | only success (and approval-expiry) audited — [F-09](findings.md#f-09) |
| 8.5 | `approval_actions` | `proposed` + terminal action, each with `payloadHash` | PASS | hash stable across actions |
| 8.6 | Optimistic concurrency on every mutation | version checked in `WHERE`, `409` on mismatch, re-read required | PASS | verified on submit, withdraw, start-review, request-information, reject |

## Not covered (environment / scope limits)

- Browser DOM runtime, responsive breakpoints, real screen-reader / keyboard traversal, visual
  regression — no browser automation available; UI defects here were derived from source + API
  payloads and should be re-verified in a real browser.
- Concurrency races under real parallel load (only single-threaded `curl` sequences run).
- Ledger / consent / jobs — no HTTP surface exists to black-box.
- Email verification, password reset flows (Better Auth built-ins; not wired into any UI).
- TLS / cookie `Secure` behaviour (only exercised in `NODE_ENV=development`).
