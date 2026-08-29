# SproutUp — QA Pass (black-box, manual)

**Tester role:** Independent QA, black-box first (drove the product as a consumer of the HTTP API and the
web UI), then grey-box confirmation by reading source to pin down root cause.
**Date:** 2026-08-29
**Build under test:** `main` @ `71869c9` (`feat: add active-sessions device UI to the portal`)
**Verdict:** **Not release-ready.** Core lending journey is a skeleton, and there are functional
defects in shipped surfaces plus several security/hardening gaps. Details below.

---

## Documents in this pass

| File | Purpose |
| --- | --- |
| [qa/README.md](README.md) | This file — scope, environment, method, summary table, verdict |
| [qa/system-review.md](system-review.md) | Whole-system review: architecture, data model, roles, journey completeness map |
| [qa/test-plan-and-results.md](test-plan-and-results.md) | Systematic manual test matrix with expected/actual/verdict per case |
| [qa/findings.md](findings.md) | Defect register — every finding with repro steps, evidence, impact, suggested fix |
| [qa/ui-ux-review.md](ui-ux-review.md) | Heuristic UI/UX evaluation of the four rendered surfaces |

---

## Environment

| Item | Value |
| --- | --- |
| OS | macOS (darwin 25.2) |
| Node | v24.7.0 (`.nvmrc` pins 20.19.4; `package.json` engines allow `<25`) |
| PostgreSQL | local, `postgresql://sproutup:sproutup@localhost:5432/sproutup`, all 21 migrations applied |
| API | `npm run dev:api`, Fastify on `http://localhost:3002` (per committed `.env`) |
| Web | `npm run dev:web`, Next.js 16 on `http://localhost:3000` |
| Env loading | Root `.env` **manually exported into the shell** before starting both dev servers (see finding F-10 — the documented `npm run dev:web` alone does not do this) |
| Automated suite | `npm test` → 166 tests pass (api 94, web 29, db 15, shared 28) |

### Test accounts created during the pass

All via `POST /v1/auth/sign-up/email`; the three staff roles were then added by direct
`INSERT INTO user_roles` because **no API/UI path exists to create staff** (F-05).

| Email | Roles | Notes |
| --- | --- | --- |
| `borrower_1788008452@example.com` | `sme_borrower` | Primary applicant; drove a full borrower case to `rejected` |
| `reviewer1_…@sproutup.test` | `compliance_officer` + `investor` | Checker |
| `reviewer2_…@sproutup.test` | `compliance_officer` + `investor` | Maker/assigned reviewer |
| `admin1_…@sproutup.test` | `super_admin` + `investor` | Role-approval maker |
| `borrower2_…@sproutup.test` | `investor` | Cross-tenant / negative tests |

> Every staff account also carries a customer role — that is the only way to make one (F-12).

---

## Method

1. **Whole-system review** — read `README`, `AGENTS.md`, `docs/*`, `tasks/*`, every route/service in
   `apps/api/src`, every page/client in `apps/web`, the shared contracts and the DB schema. Output:
   [qa/system-review.md](system-review.md).
2. **API black-box** — exercised every `/v1` endpoint with `curl` + a cookie jar: happy paths, auth
   denial, ownership isolation, optimistic-version conflicts, state-machine illegal transitions,
   validation bounds, pagination bounds, injection strings, CORS (legit + hostile origin), header
   spoofing, malformed bodies.
3. **Workflow black-box** — ran the borrower onboarding lifecycle end to end
   (create → submit → claim → request-info → resubmit → resume → reject) across three accounts, and
   the role-approval maker/checker lifecycle (propose → restricted/dup/self checks → cancel → history).
4. **UI/UX** — SSR HTML inspection for the public + auth pages, full source review of the four
   client-rendered surfaces (`/portal`, `/admin/onboarding`, `/admin/role-approvals`, auth card),
   heuristic evaluation, and cross-checking each rendered field against the real API payloads.
   (No browser automation was available in the environment; DOM-runtime defects such as F-01 were
   confirmed by tracing the exact render path against captured API responses.)
5. **Root-cause confirmation** — for every failed test, read the implicated source to confirm the
   mechanism and rule out test error.

---

## Severity legend

| Sev | Meaning |
| --- | --- |
| **Blocker** | Prevents the product from delivering its purpose, or unsafe to run in production as-is |
| **High** | Shipped feature is broken, or a real security/data-integrity exposure |
| **Medium** | Wrong behaviour with a workaround, hardening gap, or standards violation |
| **Low** | Polish, DX, minor UX, cosmetic, or documented-but-unresolved risk |

---

## Findings summary

| ID | Sev | Area | One line |
| --- | --- | --- | --- |
| [F-01](findings.md#f-01) | High | API / Admin UI | Role-approval **history & detail return `payload: {}`** — Fastify strips it; `/admin/role-approvals` history crashes on `undefined.slice()` and the audit trail loses which role/user |
| [F-02](findings.md#f-02) | High | Auth / Availability | Auth rate-limiting is **global, not per-IP** (`no-trusted-ip` bucket) — 5 failed sign-ins/minute locks out **every** user |
| [F-03](findings.md#f-03) | High | Security | `trustProxy: true` + IP-keyed limiter → **`X-Forwarded-For` spoofing fully bypasses** both rate limiters (demonstrated) |
| [F-04](findings.md#f-04) | Blocker | Product | Onboarding has **no success path** — no approve, no reopen; every journey dead-ends. All downstream lending domains unreachable |
| [F-05](findings.md#f-05) | Blocker | Deploy / RBAC | **No bootstrap for the first staff/super_admin**; maker/checker needs ≥2 `roles.assign` holders → role administration is inoperable without manual DB seeding |
| [F-06](findings.md#f-06) | Medium | API | Malformed JSON body → **`500 INTERNAL_ERROR`** instead of `400` |
| [F-07](findings.md#f-07) | Medium | Web security | Web app serves **zero security headers** (no CSP / X-Frame-Options / HSTS / nosniff / Referrer-Policy) on login, register, portal, admin |
| [F-08](findings.md#f-08) | Medium | Audit | **Audit events never record actor IP** — column and input field exist, nothing populates them |
| [F-09](findings.md#f-09) | Medium | Audit | **Denied/failed attempts are not audited** for onboarding review or role-approval authz |
| [F-10](findings.md#f-10) | Medium | Config / DX | Fresh clone is **broken per docs** — `NEXT_PUBLIC_API_URL` not loaded; client falls back to `:3001` while committed `.env` runs the API on `:3002`; `.env` vs `.env.example` disagree |
| [F-11](findings.md#f-11) | Medium | Privacy | Compliance queue **exposes `draft` cases** (never submitted) with applicant name + email |
| [F-12](findings.md#f-12) | Medium | Separation of duties | **Every staff account also holds a customer role** — no staff-only account shape; a reviewer is also an applicant |
| [F-13](findings.md#f-13) | Low | DX | `npm run db:check` from repo root fails unless `DATABASE_URL` is exported in the shell |
| [F-14](findings.md#f-14) | Low | Repo hygiene | `next dev` writes untracked `apps/web/AGENTS.md` + `CLAUDE.md` (not git-ignored; shadows the authoritative root `AGENTS.md`) and rewrites tracked `next-env.d.ts` |
| [F-15](findings.md#f-15) | Low | UI | Active-sessions rows show a **blank location/device line** — `?? 'Unknown'` doesn't catch the API's `""` |
| [F-16](findings.md#f-16) | Low | UX | Rejected applicant gets **no next-step guidance**; "Start journey" silently re-enables |
| [F-17](findings.md#f-17) | Low | UX | "Needs information" correction loop is a **no-op** — no fields to correct; "Resubmit" sends an unchanged case |
| [F-18](findings.md#f-18) | Low | A11y | Registration intent selector is `<button aria-pressed>` with no radio/hidden input; whole app has no `<noscript>` |
| [F-19](findings.md#f-19) | Low | UX | Internal optimistic-lock counter shown to end users as "Version 7" |
| [F-20](findings.md#f-20) | Low | Contract | Published `openapi.json` advertises `payload: {type: object}` (shapeless) for role-approval history; `payloadHash` schema differs between pending vs history |
| [F-21](findings.md#f-21) | Low | Build | Tailwind is configured but **unused** — hand-rolled CSS everywhere; `next dev` warns "No utility classes were detected" |
| [F-22](findings.md#f-22) | Low | Operability | No reviewer **unassign / transfer / escalation** — a case is permanently bound to one reviewer |
| [F-23](findings.md#f-23) | Low | API | Invalid `registrationIntent` returns generic `FAILED_TO_CREATE_USER`, unlike the clean `MISSING_FIELD` for the missing case (correctly rejected — no escalation) |

**What works well (verified):** optimistic-version concurrency control on every mutation; ownership
isolation on customer case reads; maker/checker separation on role approvals (self-approve,
self-target, restricted-role, duplicate-pending all blocked); append-only audit triggers; immutable
onboarding event timeline; identical "invalid email or password" for unknown-user vs wrong-password;
parameterised queries (no SQLi via user search); strict single-origin CORS with credentials; Helmet
on the API; the `docs/` set is unusually detailed and honest about what is deferred.

---

## Remediation status (2026-08-29)

Fixes were applied in the same pass. `npm run check` is green: lint + typecheck + **173 tests** +
4 workspace builds. See `tasks/LOGS.md` (2026-08-29 entry) for the change list. Each finding in
[qa/findings.md](findings.md) carries a `RESOLVED` / `DEFERRED` note with what was done.

| Outcome | Findings |
| --- | --- |
| **Resolved** (code + tests + docs, live-verified) | F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-08, F-09 (review workflow), F-10, F-11, F-13, F-14, F-15, F-16, F-18, F-19, F-20, F-23 |
| **Deferred** (needs a product/policy decision or carries regression risk not verifiable here) | F-12 (staff-only accounts — F-05 promote path is the interim), F-17 (blocked on the KYC field model), F-21 (Tailwind removal — reset-replacement risk), F-22 (reviewer reassign/escalation — needs state-machine + policy), plus F-09 scope beyond the review workflow and the trigger-written `account.registered` IP hash |

Live re-verification performed against a running stack: role-approval history now returns the full
`payload`; malformed JSON → `400`; `registrationIntent: super_admin` → `400`; web pages carry CSP +
`X-Frame-Options` + HSTS + `nosniff` + `Referrer-Policy`; `X-Forwarded-For` no longer resets the
rate-limit bucket; the compliance queue hides drafts; new audit rows carry `ip_address_hash`; a
cross-reviewer approve attempt writes an `onboarding_case.review_denied` (`outcome: denied`) event;
the onboarding loop runs create → submit → start-review → **approve** end to end; and
`db:bootstrap-super-admin` promotes two accounts so a maker/checker role grant executes.
