# Whole-system review

> Read before the test results. This is the map I built of what the system *is* and what it *does today*,
> so the findings can be read against the intended product.

## 1. What SproutUp is meant to be

A Philippine debt-crowdfunding platform (the planned replacement for the legacy SeedIn admin / user /
API apps). SMEs borrow, investors fund approved campaigns, borrowers repay, the platform distributes
principal + return to investors. Roles: Super Admin, Sales Officer, Credit Analyst, Compliance
Officer, Finance Officer, SME Borrower, Investor. Target MVP1 = one controlled end-to-end lending
loop with manual bank ops allowed. (`README.md`, `tasks/README.md`.)

## 2. Architecture as built

| Layer | Tech | Location | State |
| --- | --- | --- | --- |
| Web | Next.js 16 App Router, React 19, hand-rolled CSS | [apps/web](../apps/web) | 5 routes live |
| API | Fastify 5, Zod, Better Auth, `@fastify/swagger` | [apps/api](../apps/api) | ~28 operations live |
| DB | PostgreSQL + Drizzle, generated migrations | [packages/db](../packages/db) | 21 tables, 14 migration files |
| Shared | Zod contracts, enums, money primitive, RBAC + onboarding state machine | [packages/shared](../packages/shared) | stable |

Cross-origin by design in dev: web `:3000` ↔ API `:3002`. Auth is an HTTP-only session cookie issued
by a Better Auth proxy mounted at `/v1/auth/*`; every protected route re-resolves the session and
re-derives roles/permissions from the DB ([apps/api/src/auth/authorization.ts](../apps/api/src/auth/authorization.ts)).
The client never reads the cookie.

### Live API surface (from `/openapi.json` + route files)

```
GET    /health                                     liveness (no deps)
GET    /v1/health                                  readiness (503 if DB/schema down)
GET    /openapi.json                               generated OpenAPI 3.1
*      /v1/auth/*                                   Better Auth proxy (sign-up/in/out, session)
GET    /v1/session-context                         resolved user + roles + permissions
GET    /v1/sessions                                own sessions (no tokens)
DELETE /v1/sessions/:id                            revoke own session
GET    /v1/onboarding/cases                        own borrower/investor cases
GET    /v1/onboarding/cases/:id                    own case + immutable timeline
POST   /v1/onboarding/cases                        open one draft (one-open-case rule)
POST   /v1/onboarding/cases/:id/submit             draft|needs_information -> submitted
POST   /v1/onboarding/cases/:id/withdraw           draft|submitted|needs_information -> withdrawn
GET    /v1/admin/onboarding/cases                  compliance queue (onboarding_cases.read)
GET    /v1/admin/onboarding/cases/:id              queue case detail + applicant identity
POST   /v1/admin/onboarding/cases/:id/start-review submitted -> in_review (claims it)
POST   /v1/admin/onboarding/cases/:id/request-information  in_review -> needs_information
POST   /v1/admin/onboarding/cases/:id/reject       in_review -> rejected
GET    /v1/admin/role-assignments                  pending grants  (roles.assign)
POST   /v1/admin/role-assignments                  propose grant
POST   /v1/admin/role-assignments/:id/approve      checker approves + executes
GET    /v1/admin/role-revocations                  pending revokes
POST   /v1/admin/role-revocations                  propose revoke
POST   /v1/admin/role-revocations/:id/approve      checker approves + executes
POST   /v1/admin/role-approvals/:id/reject         checker rejects
POST   /v1/admin/role-approvals/:id/cancel         maker cancels
GET    /v1/admin/role-approvals                    approval history (paged/filtered)
GET    /v1/admin/role-approvals/:id                approval + action timeline
GET    /v1/admin/roles                             roles + effective permissions (roles.read)
GET    /v1/admin/users                             bounded user catalogue (users.read)
```

### Live web routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | SSR static | Marketing landing (`Sign in` / `Portal` / `Create account`) |
| `/login`, `/register` | client form, SSR shell | Better Auth email/password; register forces `borrower`\|`investor` intent |
| `/portal` | client | Applicant home: journeys, case cards + timeline, withdraw form, active sessions |
| `/admin/onboarding` | client | Compliance queue: filters, claim/resume, request-info, reject, case timeline |
| `/admin/role-approvals` | client | Maker/checker: pending list, propose form (user search + role picker), history |

## 3. Data model (21 tables)

- **Identity/auth:** `users`, `accounts`, `sessions`, `verifications`, `rate_limits` (Better Auth) +
  `roles`, `permissions`, `role_permissions`, `user_roles` (RBAC, seeded from `initialRolePermissions`).
- **Audit:** `audit_events` — append-only, `BEFORE UPDATE/DELETE/TRUNCATE` triggers reject mutation.
- **Onboarding:** `onboarding_cases` (+ partial unique index `one_open_journey` over
  draft/submitted/in_review/needs_information), append-only `onboarding_case_events`.
- **Approvals:** `approval_requests` (+ `unique_pending_approval`), append-only `approval_actions`.
- **Financial (schema only, no routes):** `ledger_accounts`, `ledger_transactions`, `ledger_entries`
  (deferred balance + append-only invariants), `consent_documents`, `consent_acceptances`.
- **Jobs (schema + runtime only, no topics):** `background_jobs`, `background_job_attempts`.

## 4. Roles → permissions (as seeded)

| Permission | super_admin | compliance_officer | finance_officer | credit_analyst | sales_officer | sme_borrower | investor |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| users.read | ✅ | ✅ | ✅ | ✅ | ✅ | | |
| roles.read | ✅ | ✅ | ✅ | ✅ | ✅ | | |
| roles.assign | ✅ | | | | | | |
| roles.manage_permissions | ✅ | | | | | | |
| users.manage_status | ✅ | | | | | | |
| audit.read | ✅ | ✅ | ✅ | | | | |
| audit.export | ✅ | | | | | | |
| onboarding_cases.read | ✅ | ✅ | | | | | |
| onboarding_cases.review | ✅ | ✅ | | | | | |
| sessions.read_own / revoke_own | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| sessions.revoke_any | ✅ | | | | | | |
| borrower_onboarding.\*_own | ✅ | | | | | ✅ | |
| investor_onboarding.\*_own | ✅ | | | | | | ✅ |

Observations:
- Only `super_admin` can drive role administration, and it can also act as a borrower/investor
  applicant — see F-05, F-12.
- `sessions.revoke_any` and `users.manage_status` are granted to `super_admin` but **no route
  consumes them** — dead permissions today.
- `credit_analyst` / `sales_officer` have no domain capability yet (expected — their MVP tasks are
  unstarted).

## 5. Onboarding state machine — intended vs reachable

`packages/shared/src/onboarding.ts` declares:

```
draft            -> submitted, withdrawn
submitted        -> in_review, withdrawn
in_review        -> needs_information, approved, rejected
needs_information-> submitted, withdrawn
approved         -> expired
rejected         -> draft          (event: reopened)
withdrawn        -> (terminal)
expired          -> draft          (event: reopened)
```

**Reachable today** (an endpoint actually performs the transition):

```
draft ─submit──────────► submitted ─start-review─► in_review ─request-information─► needs_information
  │                          │                        │                                  │
  └─withdraw─► withdrawn      └─withdraw─►withdrawn     └─reject─► rejected  (DEAD END)     └─submit─► submitted
                                                       └─approve─► approved   ✗ NO ENDPOINT
rejected ─► draft   ✗ NO ENDPOINT       expired ─► draft   ✗ NO ENDPOINT (expired is itself unreachable)
```

So `approved`, `expired`, and the `reopened` event are **unreachable dead code**, and `rejected` is a
permanent dead end for that case (the applicant can only start a *new* case). This is the crux of
F-04: the pilot's headline journey ("approved campaigns are funded by investors") cannot begin,
because nothing can produce an approved onboarding.

## 6. Feature completeness map (against `tasks/mvp1`)

| MVP1 domain | Status observed |
| --- | --- |
| 01 Platform foundation | ✅ builds, migrates, health endpoints, OpenAPI |
| 02 Auth / RBAC / audit | ⚠️ works, but global rate-limit (F-02), spoofable proxy (F-03), no-IP audit (F-08), no denial audit (F-09), no staff bootstrap (F-05) |
| 03 Borrower onboarding KYC | ⚠️ case shell + state machine only; **no KYC fields, no approve** (F-04, F-17) |
| 04 Investor onboarding KYC | ⚠️ same shell |
| 05 Document / consent | schema + internal service only, no routes/UI |
| 06 Credit scoring / underwriting | not started |
| 07 Campaign / loan | not started |
| 08 Investor commitments | not started |
| 09 Wallet / ledger / bank transfers | ledger schema + posting/reversal/balance services only, **internal, no routes** |
| 10–13 disbursement / repayment / distribution / tax | not started |
| 14 Notifications | not started |
| 15 Admin ops / reports | partial: compliance queue + role approvals UI |
| 18 API contracts / security boundary | ✅ OpenAPI + version header + operation metadata; but see F-20 |
| 19 Scheduler / queues | runtime + schema present, **zero topics registered**, no worker active |
| 20 Admin IA / work queues | partial: one queue, no SLA/aging policy, no saved views, no bulk |
| 21 Borrower/investor portal | partial: portal shell + case timeline + sessions |
| 22 Maker/checker matrix | only role changes; **no matrix for disbursement/wallet/etc.** |
| 23 Cross-app contract cutover | n/a yet |

**Net:** the repo is an honest, well-tested *foundation*. It is not yet a system that can run a
single loan from application to repayment, and the project docs (`README.md` "Current state",
`tasks/LOGS.md`) say as much. The QA value here is (a) confirming the shipped slices behave, and
(b) catching the defects/gaps that *are* in scope for what shipped.

## 7. Cross-cutting concerns to watch as domains land

- **Client IP resolution is unconfigured end-to-end** (F-02/F-03/F-08). Fix this once, centrally,
  before any money-movement or provider-callback endpoint exists — idempotency keys, callback
  source allow-lists and fraud controls will all want a trustworthy client IP.
- **Audit only records success** (F-09). Financial/compliance audit needs the denials too.
- **Response serialization fidelity** (F-01/F-20): `{ type: 'object' }` with no `properties` in a
  Fastify response schema silently ships `{}`. Grep the schema files before adding ledger/consent
  responses — the same pattern will drop `metadata`, `entries`, fee breakdowns, etc.
- **Separation of duties** (F-12): decide now whether an account can hold both a staff and a
  customer role, because disbursement maker/checker and "staff can't invest in campaigns they
  reviewed" rules depend on it.
