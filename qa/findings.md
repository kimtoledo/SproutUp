# Defect register

Each finding: what I observed as a black-box tester, how to reproduce, the evidence, the confirmed
root cause (grey-box), impact, and a suggested fix. IDs are stable; severities per
[qa/README.md](README.md#severity-legend).

Base URLs used below: API `http://localhost:3002`, Web `http://localhost:3000`.

---

## F-01 — Role-approval history & detail return `payload: {}` (History UI crashes; audit trail loses the subject) {#f-01}

**Severity:** High · **Area:** API serialization / `/admin/role-approvals` UI

### Observed
`GET /v1/admin/role-approvals` and `GET /v1/admin/role-approvals/:id` return the approval with
`"payload": {}` and `"integrity": "valid"`, even though the DB row holds the full payload.

```
$ curl -sb admin1.jar 'http://localhost:3002/v1/admin/role-approvals?pageSize=10'
{ "approvals":[ { "id":"d5be1682-…","commandType":"role.assign","status":"cancelled",
                  "payload":{}, "payloadHash":"5aeb4e4e…","integrity":"valid", … } ], … }

$ psql … -c "select payload from approval_requests"
 {"roleKey": "compliance_officer", "targetUserId": "7c05f78f-d506-4ae5-8edc-fc9482478336"}
```

### Root cause
[apps/api/src/openapi/role-approval-schemas.ts](../apps/api/src/openapi/role-approval-schemas.ts) —
`approvalHistoryItemSchema.properties.payload` is `{ type: 'object' }` with **no `properties`**.
Fastify's response serializer (`fast-json-stringify`) emits only declared properties, so `payload`
(and `approvalActionSchema.metadata`, same pattern) is serialized as `{}`. The handler computes the
real payload and the integrity check runs on the real data *before* serialization, which is why
`integrity` is still `"valid"` — the object is only emptied on the way out.
`pendingRoleChangeSchema` is unaffected because it uses the fully-specified `roleChangePayloadSchema`.

### Downstream UI crash
[apps/web/app/admin/role-approvals/page.tsx](../apps/web/app/admin/role-approvals/page.tsx) renders
each history row with:

```tsx
<strong>{commandLabel(item.commandType)} {roleLabel(item.payload.roleKey)}</strong>
<span>Target {shortId(item.payload.targetUserId)}</span>
```

With `item.payload === {}`: `roleLabel(undefined)` → renders "Grant " with nothing after;
`shortId(undefined)` → `undefined.slice(0, 8)` → **`TypeError: Cannot read properties of undefined
(reading 'slice')`**. The Approval-history section throws on render; in production this hits the
route error boundary (the whole page falls back to "…temporarily unavailable / Continue safely").
The web client ([admin-role-approvals-client.ts](../apps/web/lib/admin-role-approvals-client.ts))
does not guard `payload`, so nothing catches it.

### Impact
- The **Approval history** panel — the maker/checker audit surface — is unusable.
- Even headless, the history/detail API no longer tells you *which role* was granted to *which
  user*; for a dual-control audit trail on a financial platform that is the point of the record.
- The action timeline's `metadata` is likewise always `{}`.

### Suggested fix
Give `payload` a real schema in the history item/detail (reuse `roleChangePayloadSchema`), and make
`metadata` either `{ type: 'object', additionalProperties: true }` or a declared shape. Add a test
that asserts `payload.roleKey` / `payload.targetUserId` survive a round trip. Sweep the other
schema files for bare `{ type: 'object' }` in **response** position before ledger/consent land
(F-20).

---

## F-02 — Auth rate limiting is global, not per-IP → any 5 failed sign-ins/minute lock out every user {#f-02}

**Severity:** High · **Area:** Better Auth config / availability

### Observed
During testing, a handful of sign-up/sign-in calls from a single machine produced
`429 {"message":"Too many requests. Please try again later."}` for **all** subsequent auth calls,
including unrelated accounts. The `rate_limits` table shows the bucket keys:

```
$ psql … -c "select key, count from rate_limits"
 no-trusted-ip|/sign-in/email | 2
 no-trusted-ip|/sign-up/email | 5
```

### Root cause
[apps/api/src/auth/service.ts](../apps/api/src/auth/service.ts) configures Better Auth's rate
limiter (`/sign-in/email` → 5/60s, `/sign-up/email` → 5/60s) but sets **no `advanced.ipAddress`**
config. Better Auth looks for `x-forwarded-for` (its default) to key the limiter; the Fastify proxy
in [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) forwards a **custom**
`x-sproutup-client-ip` header that Better Auth does not read, and does not set `x-forwarded-for`.
With no resolvable IP, Better Auth uses the literal `no-trusted-ip` key — i.e. one shared bucket
for the entire internet.

### Impact
`5 / minute` of failed sign-ins from *anyone* (an attacker, or just organic traffic at scale)
denies login to **every** user. This is a trivial, unauthenticated denial-of-service on the primary
entry point. It also means per-account brute-force isolation does not exist.

### Suggested fix
Configure `advanced.ipAddress.ipAddressHeaders` (or a resolver) so Better Auth keys on the real
client IP, and make the Fastify proxy forward a standards header the limiter recognises. Verify with
two source IPs that the `rate_limits` keys differ. Consider a per-account failure counter in
addition to per-IP.

---

## F-03 — `trustProxy: true` + IP-keyed limiter → `X-Forwarded-For` spoofing bypasses both rate limiters {#f-03}

**Severity:** High · **Area:** Fastify config / security

### Observed (demonstrated)
```
$ curl -si  localhost:3002/v1/health | grep remaining          # shared 127.0.0.1 bucket
x-ratelimit-remaining: 109
$ curl -si -H 'X-Forwarded-For: 9.9.9.9' localhost:3002/v1/health | grep remaining   # fresh bucket
x-ratelimit-remaining: 119
$ curl -si -H 'X-Forwarded-For: 8.8.8.8' localhost:3002/v1/health | grep remaining   # another fresh bucket
x-ratelimit-remaining: 119
```

### Root cause
[apps/api/src/app.ts](../apps/api/src/app.ts) sets `Fastify({ trustProxy: true })` unconditionally.
`@fastify/rate-limit` keys on `request.ip`, which with `trustProxy: true` is taken from
client-supplied `X-Forwarded-For`. The API is directly reachable in this deployment, so the value is
fully attacker-controlled.

### Impact
- The global `120 / minute` limiter and the auth-route `30 / minute` limiter are **both defeated** by
  rotating `X-Forwarded-For` — brute force and scraping are unthrottled.
- Any future audit/fraud logic that reads `request.ip` (F-08) would ingest forged addresses.

### Suggested fix
Set `trustProxy` to the known proxy address/CIDR (from env), not `true`. When the API has no proxy
in front, set it to `false`. Re-test that spoofed `X-Forwarded-For` no longer changes the
rate-limit bucket.

---

## F-04 — Onboarding has no success path; downstream lending domains are unreachable {#f-04}

**Severity:** Blocker · **Area:** Product / onboarding state machine
**Status:** partially acknowledged in `tasks/LOGS.md` ("Approval remains absent…") — raised here as a
release-gating completeness defect, not a surprise.

### Observed
Full lifecycle driven across three accounts:
`create → submit → reviewer2 start-review → request-information → applicant resubmit → reviewer2
resume → reviewer2 reject`. After `rejected`:

```
POST /v1/onboarding/cases/{id}/submit    → 409 INVALID_CASE_TRANSITION
POST /v1/onboarding/cases/{id}/withdraw  → 409 INVALID_CASE_TRANSITION
```

No `approve` endpoint exists on any onboarding route
([apps/api/src/routes/onboarding-review.ts](../apps/api/src/routes/onboarding-review.ts) has
start-review / request-information / reject only). No endpoint performs `rejected → draft`,
`in_review → approved`, or `expired → draft`, so the states `approved`, `expired` and the event
`reopened` are unreachable (`packages/shared/src/onboarding.ts` declares them; nothing uses them).

### Impact
- The controlled-pilot journey ("approved campaigns are funded by investors") cannot start — there
  is no way to reach an approved borrower or investor.
- A rejected applicant's case is a permanent dead end (they can start a fresh case, but with no
  KYC fields that is the same empty case again — see F-17).
- Everything after onboarding (credit scoring, campaigns, commitments, wallet, disbursement,
  repayment, distribution, tax) has no entry condition.

### Suggested fix
Not a code one-liner — needs the deferred policy (completeness, screening, escalation, eligibility
effects, decision authority) per tasks 03–05. For QA sign-off: the pilot cannot be exercised
end-to-end until at least a gated `approve` transition and a rejected-applicant path exist.

---

## F-05 — No bootstrap for the first staff / super_admin; role administration is inoperable out of the box {#f-05}

**Severity:** Blocker · **Area:** Deployment / RBAC
**Status:** acknowledged in `docs/DEVELOPER.md` ("Staff/bootstrap administration remains an
out-of-band controlled operation until its policy is approved") — raised here because it blocks
every staff surface and the maker/checker system from functioning at all.

### Observed
- Fresh DB after `db:migrate` + seed: `users` = 0, and no seed creates a staff user.
- `POST /v1/auth/sign-up/email` forces `registrationIntent ∈ {borrower, investor}` and cannot
  request a staff role (correctly — see F-23).
- With exactly one `super_admin` (seeded manually), `POST /v1/admin/role-assignments` works, but:
  - `super_admin` grants are rejected: `RESTRICTED_ROLE`.
  - The lone admin cannot approve their own proposal: `MAKER_CHECKER_CONFLICT`.
  - No other `roles.assign` holder exists to be the checker.
  → **Deadlock:** you cannot create a second approver through the workflow, so no role change can
  ever be executed.

I had to `INSERT INTO user_roles` directly to create `compliance_officer` and `super_admin` test
accounts.

### Impact
On any environment that isn't hand-seeded with ≥2 `super_admin` rows, the entire
`/admin/*` surface (compliance queue, role approvals) and the maker/checker mechanism are
non-functional. There is no documented, safe, repeatable bootstrap.

### Suggested fix
Ship a reviewed bootstrap: a one-shot seeded/first-run super-admin (env-guarded, audited), or a CLI
that creates the initial two administrators with immutable audit evidence. Until then, document the
exact manual DDL as the interim runbook.

---

## F-06 — Malformed JSON body returns `500 INTERNAL_ERROR` instead of `400` {#f-06}

**Severity:** Medium · **Area:** API error handling

### Observed
```
$ curl -s -o /dev/null -w '%{http_code}\n' -b borrower.jar -X POST \
    -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
    -d '{bad' http://localhost:3002/v1/onboarding/cases
500
# body: {"success":false,"error":{"code":"INTERNAL_ERROR","message":"The request could not be completed"}}
```

### Root cause
[apps/api/src/app.ts](../apps/api/src/app.ts) `setErrorHandler` only maps errors that carry a
`validation` property to `400 VALIDATION_ERROR`; a body-parse error
(`FST_ERR_CTP_INVALID_JSON`, which Fastify would otherwise surface as `400`) has no `.validation`,
so it falls through to the generic `500` branch and is logged as "Unhandled API request failure".

### Impact
Client input errors are reported as server faults: wrong status class for consumers, and every
malformed request inflates the 500 rate / error-log noise / on-call alerting.

### Suggested fix
In `setErrorHandler`, detect `error.statusCode === 400` / `error.code?.startsWith('FST_ERR_CTP')`
(or check `error instanceof SyntaxError`) and return the `400 VALIDATION_ERROR` envelope. Add a test
for a malformed-body POST.

---

## F-07 — Web application serves no security headers on any page {#f-07}

**Severity:** Medium · **Area:** Next.js / web security

### Observed
```
$ curl -sD - -o /dev/null http://localhost:3000/         # and /login, /register
HTTP/1.1 200 OK
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
Cache-Control: no-cache, must-revalidate
Content-Type: text/html; charset=utf-8
```
No `Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors`, `Strict-Transport-Security`,
`X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy`. The API (Helmet) sets these;
the web origin — which serves the login, register, portal and admin pages — sets none.
[apps/web/next.config.js](../apps/web/next.config.js) has `poweredByHeader: false` (good) but no
`async headers()`.

### Impact
The auth and KYC-facing origin is clickjackable (no frame-ancestors), MIME-sniffable (no nosniff),
leaks full-URL referrers cross-site (no Referrer-Policy), and won't pin TLS (no HSTS). Standard
baseline missing on the most sensitive surface.

### Suggested fix
Add `headers()` to `next.config.js` (or middleware) applying CSP, `X-Frame-Options: DENY` /
`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (or
`strict-origin-when-cross-origin`), `Strict-Transport-Security`, and a minimal `Permissions-Policy`.

---

## F-08 — Audit events never record the actor's IP {#f-08}

**Severity:** Medium · **Area:** Audit / compliance

### Observed
```
$ psql … -c "select action, ip_address_hash from audit_events order by occurred_at"
 account.registered        | (null)
 onboarding_case.created   | (null)
 onboarding_case.submitted | (null)
 role_assignment.proposed  | (null)
 approval.cancelled        | (null)
```
Every audit row has `ip_address_hash = NULL`, including for privileged role-approval actions.

### Root cause
`audit_events.ip_address_hash` (schema) and `WriteAuditInput.ipAddressHash`
([packages/db/src/write-audit.ts](../packages/db/src/write-audit.ts)) both exist, but **no route or
service passes it** — `grep -rn ipAddressHash apps/api/src` shows only the consent service's field
definition. Combined with F-02/F-03, a trustworthy client IP isn't even available to pass.

### Impact
`AGENTS.md` requires immutable audit for "privileged, compliance, financial, and approval actions".
Without actor IP, the audit trail can't answer "from where" for account takeover, insider abuse, or
provider-callback disputes — a gap that gets more expensive once money movement exists.

### Suggested fix
Resolve client IP centrally (after fixing F-03), hash it, and thread `ipAddressHash` through
`writeAudit` from every route (a Fastify request decorator or a `writeAudit` wrapper bound to the
request keeps call sites clean).

---

## F-09 — Denied / failed attempts are not audited {#f-09}

**Severity:** Medium · **Area:** Audit coverage

### Observed
Across the pass I triggered many authorization/decision denials — self-review of one's own case,
takeover of another reviewer's case, stale-version commands, a non-`roles.assign` user hitting
`/v1/admin/role-assignments`, a maker trying to self-approve. **None produced an audit row.** The
only `outcome: 'denied'` path in the codebase is approval **expiry**
([apps/api/src/auth/approval-lifecycle-service.ts](../apps/api/src/auth/approval-lifecycle-service.ts)).
`writeAudit` supports `outcome: 'denied' | 'failed'`; the onboarding services
([case-service.ts](../apps/api/src/onboarding/case-service.ts),
[review-service.ts](../apps/api/src/onboarding/review-service.ts)) only call it on the success branch.

### Impact
No evidence trail for probing/abuse: repeated attempts to review one's own KYC, to take over a
colleague's case, or to hit admin endpoints without permission leave no record. For a compliance
platform, denials are often the more interesting audit events.

### Suggested fix
Decide an audit policy for denials (at minimum: authz failures on `/admin/*`, self-review /
takeover attempts, maker/checker conflicts) and emit `outcome: 'denied'` events with the actor,
target and reason.

---

## F-10 — Fresh clone is broken per the documented run steps (API URL / port mismatch) {#f-10}

**Severity:** Medium · **Area:** Config / developer experience

### Observed / analysis
- `docs/DEVELOPER.md` says: `npm run dev:web`, app at `:3000`, then `npm run dev:api`.
- The web clients resolve the API as
  `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'`
  ([auth-client.ts](../apps/web/lib/auth-client.ts), [portal-client.ts](../apps/web/lib/portal-client.ts), …).
- Next.js only auto-loads `.env*` from the **Next app directory**; there is no `apps/web/.env`, and
  [apps/web/next.config.js](../apps/web/next.config.js) does no env plumbing. Running `npm run dev:web`
  from the repo root therefore leaves `NEXT_PUBLIC_API_URL` **undefined** → client uses `:3001`.
- The committed [.env](../.env) runs the API on **`:3002`** (`API_PORT=3002`,
  `BETTER_AUTH_URL=http://localhost:3002`, `NEXT_PUBLIC_API_URL=http://localhost:3002`), while
  [.env.example](../.env.example) and `docs/DEVELOPER.md` use `:3001`.

Result: out of the box the web app calls `http://localhost:3001`, nothing answers, and every
sign-in / portal / admin request fails. (This pass only worked because I exported the root `.env`
into the shell before starting both dev servers.)

### Suggested fix
Pick one port and make it consistent across `.env`, `.env.example`, and the docs. Either add
`apps/web/.env` (or a symlink / `dotenv` step) so `NEXT_PUBLIC_API_URL` is actually loaded by
`next dev`, or load the root `.env` from `next.config.js`. Make the client fallback match the
chosen port.

---

## F-11 — Compliance queue exposes unsubmitted `draft` cases with applicant PII {#f-11}

**Severity:** Medium · **Area:** Privacy / queue scoping

### Observed
```
$ curl -sb reviewer1.jar 'http://localhost:3002/v1/admin/onboarding/cases?pageSize=100'
 rejected borrower borrower_1788008452@example.com
 draft    borrower borrower_1788008452@example.com      ← never submitted
```
A `draft` case is one the applicant created but has not submitted for review. It appears in the
compliance queue (API + `/admin/onboarding` UI) with `applicantName` + `applicantEmail`.

### Root cause
[apps/api/src/onboarding/review-service.ts](../apps/api/src/onboarding/review-service.ts) `list()`
applies no default status floor; with no `status` filter it returns every case including `draft`
(and `withdrawn`). The `onboarding_cases_review_queue_idx` covers all statuses.

### Impact
Reviewers see identity data for people who have not yet chosen to enter review. Minor now (name +
email only); it compounds once drafts hold KYC fields, documents and financials.

### Suggested fix
Exclude `draft` (and probably `withdrawn`) from the queue unless explicitly filtered, or gate draft
visibility behind a separate permission. Decide the intended default set with compliance.

---

## F-12 — Every staff account also carries a customer role (no staff-only account) {#f-12}

**Severity:** Medium · **Area:** Separation of duties

### Observed
`session-context` for the manually-created reviewer:
```
"roles": ["compliance_officer", "investor"],
"permissions": [ …, "investor_onboarding.manage_own", "investor_onboarding.submit_own", … ]
```
The only route to a staff account is: register (which **forces** `registrationIntent` →
`borrower`/`investor` and atomically creates that customer role and its `*_onboarding.*_own`
permissions) and then add a staff role on top. There is no way to remove the customer role either
without hitting `LAST_ROLE`-style protections mid-transition.

### Impact
A compliance officer is simultaneously a live investor applicant; a finance officer can be a
borrower. This pre-empts rules the later MVPs will need ("a reviewer may not review their own KYC",
"staff may not invest in campaigns they underwrote", disbursement maker/checker). The self-review
guard in the onboarding service helps, but the account model itself doesn't support a clean
staff/customer split.

### Suggested fix
Allow provisioning a staff account without a customer role (e.g. an internal-user creation path in
the bootstrap from F-05 that doesn't require `registrationIntent`), and decide explicitly whether
one identity may hold both categories.

---

## F-13 — `npm run db:check` from repo root fails without an exported `DATABASE_URL` {#f-13}

**Severity:** Low · **Area:** DX

### Observed
```
$ npm run db:check
Error: DATABASE_URL is required to check database readiness
    at packages/db/src/check-readiness.ts:6
```
Works only after `set -a && . ./.env && set +a`.

### Root cause
`packages/db` scripts use `import 'dotenv/config'`, which loads `.env` from **`process.cwd()`** — and
for a workspace script that cwd is `packages/db/`, which has no `.env`. `docs/DEVELOPER.md` presents
`npm run db:check` / `db:migrate` / `db:generate` as plain root commands.

### Suggested fix
Point dotenv at the repo root (`dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })`),
or use `dotenv-cli -e ../../.env` in the workspace scripts, or document the export step.

---

## F-14 — `next dev` writes untracked `apps/web/AGENTS.md` + `CLAUDE.md` and rewrites tracked `next-env.d.ts` {#f-14}

**Severity:** Low · **Area:** Repo hygiene / docs integrity

### Observed
After `npm run dev:web`:
```
$ git status --porcelain
 M apps/web/next-env.d.ts
?? apps/web/AGENTS.md
?? apps/web/CLAUDE.md
```
`apps/web/AGENTS.md` begins `<!-- BEGIN:nextjs-agent-rules -->  # This is NOT the Next.js you know …`.
Neither generated file is in [.gitignore](../.gitignore). The dev log prints
`Set 'agentRules: false' in next.config to disable`.

### Impact
- Accidental-commit risk (a blanket `git add` picks them up).
- `apps/web/AGENTS.md` **shadows** the authoritative root [AGENTS.md](../AGENTS.md) for any tooling
  that resolves the nearest `AGENTS.md` from `apps/web/` — it replaces the repo's security/financial
  invariants with generic Next guidance. This repo's whole workflow is doc-driven.
- `apps/web/next-env.d.ts` (tracked) churns on every dev run.

### Suggested fix
Set `agentRules: false` in `next.config.js` (the repo maintains `AGENTS.md` by hand), and/or add
`apps/web/AGENTS.md`, `apps/web/CLAUDE.md` to `.gitignore`. Consider git-ignoring `next-env.d.ts`.

---

## F-15 — Active-sessions rows render a blank location/device line {#f-15}

**Severity:** Low · **Area:** `/portal` UI

### Observed
`GET /v1/sessions` returns `"ipAddress": ""` (empty string, not `null`) and often `userAgent` is a
bare string. [apps/web/app/portal/page.tsx](../apps/web/app/portal/page.tsx) renders
`{session.ipAddress ?? 'Unknown location'}` and `{session.userAgent ?? 'Unknown device'}`. `??` does
not catch `""`, so the "location" line renders empty. In this build the IP is *always* `""`
(consequence of F-02/F-03), so every session card shows a blank first line.

### Suggested fix
Use `session.ipAddress || 'Unknown location'` (and same for `userAgent`), and align the API to
return `null` rather than `""` when unknown. The `access-schemas.ts` response type already allows
`null`.

---

## F-16 — Rejected applicant gets no next-step guidance {#f-16}

**Severity:** Low · **Area:** `/portal` UX

### Observed
After the borrower case was rejected, the portal shows a case card with status "Rejected" and only a
"View history" toggle. The "Start journey" tile silently re-enables (the rejected case isn't an
"open" status) with no explanation. No copy tells the applicant they were declined, why-at-a-glance,
whether they can reapply, or when.

### Suggested fix
Add an explicit rejected/closed state treatment: surface the decision reason from the timeline
inline, and a clear "You can start a new application" affordance (and, once F-04's policy lands, any
cooling-off rule).

---

## F-17 — "Needs information" correction loop is a no-op for the applicant {#f-17}

**Severity:** Low · **Area:** onboarding UX (blocked on tasks 03–05)

### Observed
Reviewer sends `request-information` with a reason. The applicant's only control is "Resubmit case",
which calls `submit` with the incremented version — there are **no profile or evidence fields** to
edit ([system-review.md §6](system-review.md)). So the applicant resubmits an unchanged, empty case
and it returns to the reviewer exactly as before. The reviewer's request cannot be actioned.

### Suggested fix
Blocked on the KYC field/evidence model (tasks 03–05). Until then the "Request information" control
is misleading — consider hiding it, or making the reason mandatory-to-resolve with a free-text
applicant response captured on the event.

---

## F-18 — Registration intent selector isn't a real form control; app has no `<noscript>` {#f-18}

**Severity:** Low · **Area:** a11y / progressive enhancement

### Observed
[apps/web/components/auth-card.tsx](../apps/web/components/auth-card.tsx) implements "I am joining as"
as two `<button type="button" aria-pressed>` inside a `<fieldset><legend>`. There is no radio input
and no hidden field — the chosen intent exists only in React state, so if the bundle fails the form
POSTs without `registrationIntent` (API → `MISSING_FIELD`). `aria-pressed` toggle buttons are a
weaker pattern for a single-choice control than `role="radio"` radios in the fieldset that's
already there. No page in the app ships a `<noscript>` (the marketing landing does render its
content and links server-side, so it degrades; the auth/portal pages are blank without JS).

### Suggested fix
Use real radio inputs (`name="registrationIntent"`) styled as the cards; keep the fieldset/legend.
Add a `<noscript>` hint on the auth pages.

---

## F-19 — Internal optimistic-lock counter shown to end users as "Version N" {#f-19}

**Severity:** Low · **Area:** `/portal` UX / info exposure

### Observed
Portal case cards render `Version {item.version}` (e.g. "Version 7" after a few review round-trips).
This is the optimistic-concurrency counter, incremented on every internal transition — not something
meaningful to an applicant, and it leaks how much back-and-forth happened.

### Suggested fix
Drop it from customer-facing UI (keep it in the payload for the client's conflict handling), or
replace with a human status/last-updated line.

---

## F-20 — Published `openapi.json` is non-descriptive / inconsistent for role-approval history {#f-20}

**Severity:** Low · **Area:** API contract

### Observed
```
$ curl -s localhost:3002/openapi.json | jq '.paths["/v1/admin/role-approvals"].get.responses["200"]
        .content["application/json"].schema.properties.data.properties.approvals.items.properties.payload'
{ "type": "object" }
```
No shape for `payload` (this is also the F-01 root cause). Separately, `payloadHash` is
`{pattern: "^[a-f0-9]{64}$"}` in `pendingRoleChangeSchema` but `{minLength: 1, maxLength: 64}` in the
history schema — two different contracts for the same value. `apps/api/test/openapi.test.ts` passes
because it checks for the *presence* of response schemas, not their fidelity.

### Suggested fix
Fix alongside F-01; unify the `payloadHash` schema; add a contract assertion that key nested fields
are described.

---

## F-21 — Tailwind is configured but unused (dead dependency, noisy build) {#f-21}

**Severity:** Low · **Area:** build / frontend

### Observed
`npm run dev:web` prints:
```
warn - No utility classes were detected in your source files...
warn - https://tailwindcss.com/docs/content-configuration
```
`globals.css` has `@tailwind base/components/utilities`, `tailwind.config.ts` defines custom color
tokens (`ink`, `leaf`, `mist`, `sun`) — but every component uses hand-written CSS classes
(`.site-header`, `.hero`, `.auth-card`, …) defined as plain CSS. No component uses a Tailwind
utility or the custom tokens.

### Impact
Ships Tailwind + PostCSS + Autoprefixer for effectively only the Preflight reset; misleads the next
contributor about the styling system; adds a persistent build warning.

### Suggested fix
Either commit to Tailwind (migrate the CSS, or at least use the tokens) or remove it and keep the
hand-rolled CSS (add a small reset). Silence the warning either way.

---

## F-22 — No reviewer unassign / transfer / escalation; a case is permanently bound to one reviewer {#f-22}

**Severity:** Low · **Area:** operability (listed as an open item in `tasks/LOGS.md`)

### Observed
Once `start-review` assigns a reviewer, only that reviewer can `request-information` or `reject`
(confirmed: `NOT_ASSIGNED_REVIEWER` for anyone else), and a resubmitted case keeps the assignment.
There is no endpoint to release, reassign or escalate. If the assigned reviewer is unavailable, an
`in_review` / `needs_information` case is stuck with no path forward (they can't even be the one to
reject it).

### Suggested fix
Add a permissioned reassign/release action with audit evidence, plus a queue-aging/SLA policy
(already tracked for task 20).

---

## F-23 — Invalid `registrationIntent` returns a generic error unlike the missing-field case {#f-23}

**Severity:** Low · **Area:** API validation UX

### Observed
```
registrationIntent omitted        → {"code":"MISSING_FIELD","message":"registrationIntent is required"}
registrationIntent:"super_admin"  → {"code":"FAILED_TO_CREATE_USER","message":"Failed to create user"}
registrationIntent:"staff"        → {"code":"FAILED_TO_CREATE_USER","message":"Failed to create user"}
```
The invalid-enum value is **correctly rejected** (no privilege escalation — the user is not created),
but the error is a generic "Failed to create user" rather than a field validation error, so an API
consumer can't tell a bad `registrationIntent` from any other creation failure.

### Suggested fix
Validate `registrationIntent` against `{borrower, investor}` at the boundary (e.g. in the auth
proxy wrapper or a `before` hook) and return a `VALIDATION_ERROR` naming the field, consistent with
the missing-field response.

---

# Remediation log (2026-08-29)

Applied in the same pass; `npm run check` green (lint, typecheck, 173 tests, 4 builds); key items
re-verified against a running stack. Full change list in `tasks/LOGS.md` (2026-08-29 entry).

| ID | Status | What changed |
| --- | --- | --- |
| F-01 | **RESOLVED** | `role-approval-schemas.ts`: history `payload` + action `metadata` given real shapes (were serialized to `{}`). `roleLabel`/`shortId` in the page hardened. Round-trip test added. |
| F-02 | **RESOLVED** | `auth/service.ts`: `advanced.ipAddress.ipAddressHeaders: ['x-sproutup-client-ip']`; `server.ts` backfills `NODE_ENV`. Verified sign-in limits bucket per client. |
| F-03 | **RESOLVED** | `API_TRUST_PROXY` env → Fastify `trustProxy` (default `false`). Verified `X-Forwarded-For` no longer resets the rate-limit bucket. |
| F-04 | **RESOLVED** | Added `POST /v1/admin/onboarding/cases/:caseId/approve` (gated `in_review → approved`, assigned reviewer, exact version, reason, `decidedAt`, immutable event, audit) + `/admin/onboarding` UI. Deferred KYC/screening/eligibility policy unchanged. 2026-08-30 (S1.1): the "rejected is a permanent dead end" and "re-onboarding after approval not blocked" sub-gaps are now closed — `reopen` (`rejected|expired → draft`) exists and `create` returns `409 CASE_ALREADY_APPROVED` while an approval stands. The `approved`/`expired` states remain partly exercised only until the expiry job (S1.1c) lands. |
| F-05 | **RESOLVED** | `packages/db/src/bootstrap-super-admin.ts` + `npm run db:bootstrap-super-admin -- <email>`. Idempotent, audited, refuses unknown/inactive. Verified maker/checker grant executes with two bootstrapped admins. |
| F-06 | **RESOLVED** | `app.ts` error handler maps body-parse/4xx to `400 VALIDATION_ERROR`; `setNotFoundHandler` adds a `404 NOT_FOUND` envelope. Verified. |
| F-07 | **RESOLVED** | `next.config.mjs` `headers()`: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS on all routes. Verified on `/login`. |
| F-08 | **RESOLVED** | `hashIpAddress` in `packages/db`; threaded through every route→service→`writeAudit`. New audit rows carry `ip_address_hash`. (`account.registered` trigger event still excluded — follow-up.) |
| F-09 | **RESOLVED (review workflow)** | Review self-review / cross-reviewer denials now emit `onboarding_case.review_denied` (`outcome: denied`). Role-approval lifecycle denials + `/admin/*` 403s not yet audited — follow-up. |
| F-10 | **RESOLVED** | API dev/start use `--env-file-if-exists=../../.env`; `packages/db` scripts load root `.env` by path; `next.config.mjs` loads root `.env` for `NEXT_PUBLIC_*`. `cp .env.example .env` now suffices. |
| F-11 | **RESOLVED** | `review-service.ts` hides `draft`/`withdrawn` from the default queue; explicit `status` still returns them. Test added. Verified. |
| F-12 | **DEFERRED** | Partially mitigated by F-05 (promote path). A true staff-only account shape needs an internal user-creation flow + a policy decision on dual-category identities. |
| F-13 | **RESOLVED** | `check-readiness.ts` / `drizzle.config.ts` / `seed-authorization.ts` load the root `.env` by explicit path. `npm run db:check` works from a clean shell. |
| F-14 | **RESOLVED** | `agentRules: false` in `next.config.mjs`; `apps/web/AGENTS.md` + `CLAUDE.md` added to `.gitignore`; stale files removed; `next-env.d.ts` restored. |
| F-15 | **RESOLVED** | Portal uses `|| 'Unknown…'` for session location/device; `sessions-service` normalises `""` → `null`. |
| F-16 | **RESOLVED** | Rejected onboarding case shows a "declined — open the history for the reason — start a fresh application" note (`.case-note`). 2026-08-30 (S1.1): the API now backs this with a real `POST /v1/onboarding/cases/:caseId/reopen` (`rejected → draft`) so "start a fresh application" no longer means an orphaned empty case; the portal button wiring lands with the portal kit migration in S1.2. |
| F-17 | **DEFERRED** | Genuinely blocked on the tasks 03–05 KYC profile/evidence model; ripping out "Request information" was not done. |
| F-18 | **RESOLVED** | Intent picker is now real radio inputs (`name="registrationIntent"`, visually-hidden, `:focus-within`); `submit()` also reads the form value; `<noscript>` added to the auth layout. |
| F-19 | **RESOLVED** | Removed the user-facing "Version N" line from portal case cards. |
| F-20 | **RESOLVED** | Fixed with F-01; `payloadHash` schema unified to `^[a-f0-9]{64}$` across pending + history. |
| F-21 | **RESOLVED** (2026-08-30, slice S0.1) | Committed to Tailwind instead of removing it. `tailwind.config.ts` now carries a SproutUp design-token layer; an accessible component kit lives in `apps/web/components/ui/` (recipes are pure, unit-tested modules); the landing + register/sign-in surfaces were migrated onto it. The "No utility classes were detected" `next dev` warning is gone. `/portal` + `/admin/*` migrate onto the kit with their Phase 1 feature slices. Also added an installable PWA shell (manifest, same-origin-only service worker, `/offline`). See `qa/ui-foundation.md`. |
| F-22 | **DEFERRED** | Needs a new state-machine transition + event type + an escalation-authority policy (who may force-release another reviewer's case). Tracked under task 20. |
| F-23 | **RESOLVED** | Auth proxy rejects a non-`borrower`/`investor` `registrationIntent` with `400 VALIDATION_ERROR` naming the field. Verified. |
