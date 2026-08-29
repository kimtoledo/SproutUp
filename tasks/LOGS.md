# SproutUp Task Log

This is the chronological handoff record for people and AI working on the revamp tasks. It records what changed, why it changed, unresolved decisions, and the recommended next action. Detailed requirements remain in the linked task documents.

## AI usage

1. Read [README.md](./README.md), this log, and the relevant MVP README before changing a task.
2. Treat the newest log entry as the latest handoff context, but verify it against the current files.
3. Add a new entry after every material change. Put the newest entry immediately below this section.
4. Do not delete or rewrite older entries. Add a correction in a newer entry when earlier information is no longer accurate.
5. Record facts separately from assumptions and unresolved decisions.

## Entry format

```md
## YYYY-MM-DD — Short update title

**Status:** WIP | Ready | Blocked | Done

### Updated

- What changed and which files were affected.

### Decisions

- Confirmed planning or implementation decisions.

### Open items

- Unresolved questions, blockers, or assumptions requiring validation.

### Next

- The recommended next action.
```

## 2026-08-30 — Onboarding lifecycle completion + party-eligibility spine (slice S1.1)

**Status:** Done

### Updated

- **Reopen transition.** New owner-bound `POST /v1/onboarding/cases/:caseId/reopen`
  (`reopenOwnOnboardingCase`, `borrower|investor_onboarding.manage_own`, optimistic version).
  `OnboardingCaseService.reopen` transitions a `rejected` or `expired` case back to `draft` (the
  shared state machine already permitted this), emits a `reopened` case event, clears
  `assignedReviewerUserId` and `decidedAt`, bumps the version, and writes an
  `onboarding_case.reopened` audit event. It refuses when another case for the same journey is
  already open (`OPEN_CASE_EXISTS`, pre-checked and backed by the `one_open_journey` index) or the
  case is not terminal (`INVALID_CASE_TRANSITION`). This ends the "rejected applicant is a
  permanent dead end" half of F-04 / F-16 — a rejected applicant corrects and reapplies on the
  same account.
- **Re-onboarding guard.** `OnboardingCaseService.create` now returns `already_approved` →
  `409 CASE_ALREADY_APPROVED` while an `approved` case stands for that applicant/journey. An
  `expired` approval does not block a fresh start.
- **Party-eligibility projection.** New internal `OnboardingCaseService.eligibility(userId, journey)`
  → `{ journey, status: none | pending | approved | expired, caseId, decidedAt }`, derived from the
  most recent case (`withdrawn`/`rejected` → `none`, any open status → `pending`). This is the read
  every downstream domain (credit, campaigns, commitments, disbursement, withdrawal) will gate on
  rather than reading case rows directly. No HTTP route yet.
- **Tests.** +7 api service tests (`onboarding-reopen-eligibility.test.ts`: eligibility for every
  status, reopen happy path with event+audit, non-terminal refusal, stale-version + non-owner
  refusal, `already_approved` create block, expired-clears-block, reopen blocked by another open
  case) and +2 route tests (reopen owner/version passthrough + `CASE_ALREADY_APPROVED` mapping;
  capability denial). `openapi.test.ts` contracted-operations list gains `reopenOwnOnboardingCase`.
  `npm run check` green: lint + typecheck + **251 tests** (api 117, web 83, db 23, shared 28) +
  4 builds. `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities.
- **Docs.** `docs/DEVELOPER.md` (endpoint table + reopen/eligibility semantics), `tasks/mvp1/03` +
  `04` implementation progress, `tasks/mvp1/21`, `tasks/mvp1/README.md`, `qa/findings.md`
  (F-04 / F-16 sub-gaps).

### Decisions

- `reopen` is owner-initiated (a `manage_own` capability), not a staff action — it is the
  applicant choosing to try again, distinct from any staff-side "reconsider a decision" path
  (which is not in scope and would need its own authority rule).
- Reopen clears the reviewer assignment and `decidedAt`: a reopened case is a genuinely fresh
  draft, not a case still "attached" to the reviewer who rejected it. History (events/audit)
  is retained.
- `eligibility` stays a pure server-side projection for now. A portal-facing read and the
  campaign/commitment enforcement points are wired in their own slices so this one stays small.
- The `expired` branch of `reopen` is implemented but only lightly exercised until the approval-
  expiry job exists — that is slice **S1.1c** (a `rule_versions` `onboarding.approval_validity`
  key + a job topic + an `expireApprovedCases` service method; first activation of the durable-job
  runtime, task 19).

### Open items

- Portal "start a new application" button should call `reopen` (F-16 UI half) — lands with the
  portal kit migration in S1.2.
- Approval-expiry job (S1.1c). Policy-gated approve (completeness + screening) still layers on in
  S1.2 / S1.4. `suspended` eligibility state arrives with investor controls in S1.3.
- Everything from the earlier 2026-08-30 / 2026-08-29 entries is unchanged.

### Next

- Slice **S0.3 folded into S1.2**: private file storage adapter + `documents`/`document_versions`
  schema, then the borrower KYB model (`organizations`, `organization_members`,
  `beneficial_owners`, `borrower_profiles`), a rule-versioned per-entity-type required-field /
  document matrix, completeness computation, and the portal multi-step form on the component kit.

## 2026-08-30 — Effective-dated configuration primitive (slice S0.2)

**Status:** Done

### Updated

- **Schema.** New `packages/db/src/schema/config.ts`: `rule_sets` (key catalogue, key regex,
  non-empty description) and `rule_versions` (immutable, effective-dated `jsonb` bodies). Generated
  migration `0015_wise_lockjaw.sql`; hand-written invariant migration `0016_config-rule-immutability.sql`
  — `rule_versions` is append-only (UPDATE/DELETE/TRUNCATE raise `rule_versions is append-only`),
  `rule_sets` keys are permanent and `key`/`created_at` immutable (description may be corrected),
  `(rule_key, version)` and `(rule_key, effective_from)` unique, `version > 0`,
  `jsonb_typeof(body) = 'object'`. Journal entry idx 16 added by hand (matches the existing
  custom-migration pattern; `0014` likewise has no snapshot).
- **Service.** New `apps/api/src/config/rule-service.ts`: `createRuleService(db, clock?)` →
  `registerRuleSet` (idempotent), `publish` (transaction-aware; next per-key version;
  `unknown_rule_key` if the key is unregistered; `effective_from_conflict` on a same-instant clash,
  pre-checked and race-guarded via `onConflictDoNothing`; writes a `config_rule.published` audit
  event with key/version/effectiveFrom/note metadata but **never the body**), `resolve(key, at)`
  (greatest `effective_from <= at`, or `null`), `listVersions` (newest first). Transaction-aware
  `*InTransaction` forms exported for atomic domain+config commits, mirroring the ledger/consent
  services. Zod validates the key format, an object body, the `{system}|{user,userId,roles}` actor,
  and bounded description/note.
- Startup readiness (`REQUIRED_DATABASE_RELATIONS`) now requires `rule_sets` + `rule_versions`.
  Both hardcoded migration lists (`apps/api/test/database-fixture.ts`,
  `packages/db/src/migrations.test.ts`) updated with 0015 + 0016.
- **Tests.** +5 db migration tests (relations exist; non-object body and `version 0` rejected;
  published version immutable; `rule_sets` description editable but key un-deletable/un-renamable;
  same-instant second version rejected) and +10 api service tests (unknown-key refusal, idempotent
  register, monotonic versions, point-in-time resolution incl. before-first-version `null`,
  **historical reproducibility after a newer version exists**, same-instant conflict, non-object
  body rejected at the boundary, audit row without the body, newest-first listing, caller-transaction
  rollback). `npm run check` green: lint + typecheck + **242 tests** (api 108, web 83, db 23,
  shared 28) + 4 builds. `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities.
- **Docs.** New `docs/CONFIG.md`; `docs/DEVELOPER.md` (Database workflow), `tasks/schema/04`
  (rule_sets/rule_versions marked implemented), `tasks/mvp1/01` + `tasks/mvp1/13` implementation
  progress, `tasks/mvp1/README.md`.

### Decisions

- **Fully immutable, insert-only supersession** rather than an `effective_to` range that would have
  to be mutated on the previous row. "In force at T" = greatest `effective_from <= T`. This is the
  same selection the consent service already uses and it keeps `resolve` reproducible for any past
  date with zero writes to old rows.
- `version` is a monotonic per-key counter for display/audit; `effective_from` is the authority for
  resolution. `(rule_key, effective_from)` is unique so resolution is never ambiguous.
- The audit event deliberately omits the rule body — it can be large and `assertSafeAuditMetadata`
  would scan it for sensitive-looking keys. The body lives in the immutable `rule_versions` row.
- No rule bodies seeded and no HTTP route in this slice. Publish authority per key is a maker/checker
  matrix decision (task 22); until then rules are published `{ type: 'system' }` from seeds/migrations
  in their owning slices.
- `db:migrate` / `db:check` not run here (no local Postgres in the sandbox, consistent with prior
  entries); verified against PGlite via the migration + service test suites.

### Open items

- Unchanged from the S0.1 entries. Plus: an admin publish/list HTTP surface for `rule_versions`
  (deferred to task 22's approval matrix); seeding of the actual pilot rule bodies happens in
  S1.2 (KYC matrices), S1.3 (investor limits), S1.7 (SLA), S2.2 (scorecard), S3.5–S3.7 (allocation,
  penalties, tax) — each flagged `ASSUMED FOR PILOT`.

### Next

- Slice **S0.3**: private file storage adapter (`FileStorage` interface + local-filesystem dev
  impl) and the `documents` / `document_versions` schema (owner, classification, sha-256, size,
  mime, scan_state, retention) with authorised upload / short-lived signed download / list routes.
  Serves tasks 03/04/05. Then Phase 1 (S1.1 onboarding state machine + eligibility spine).

## 2026-08-30 — Component render/a11y test infrastructure (slice S0.1b)

**Status:** Done

### Updated

- Added `jsdom@26.1.0`, `@testing-library/react@16.3.3`, `@testing-library/dom@10.4.1`, and
  `@testing-library/jest-dom@7.0.1` as `apps/web` dev dependencies. `jsdom` is pinned to the 26.x
  line because 27+ requires Node 20+ and 30 requires Node 22+/24.15+, while `.nvmrc` pins 20.19.4.
- `apps/web/vitest.config.mts`: `globals: true`, `setupFiles: ['./vitest.setup.ts']`, and the
  include glob now also matches `*.test.tsx`. `vitest.setup.ts` registers the jest-dom matchers.
  Default environment stays `node`; render test files opt into jsdom with a
  `// @vitest-environment jsdom` docblock, so the fast logic/client-lib tests keep running in node.
- Added DOM render + a11y tests: `Button` (default `type="button"`, disabled suppresses onClick,
  internal vs external link), `Field` (label↔control association, `aria-describedby` for
  description and error, `toBeInvalid`, id-prefix collision safety), `RadioCards` (real
  `role="group"` + `role="radio"`, checked state, selection moves on click), `Alert`
  (`role="alert"` for danger/warning, `role="status"` for info/success), `Stepper`
  (`aria-current="step"`, accessible list name "Step N of M: …").
- Added `apps/web/lib/auth-routing.test.ts` for `routeForSession` — the previously untested
  post-login redirect helper inherited in S0.1 (admin queue vs approvals routing, surface/role
  mismatch fallback, dual staff+customer preference).
- `npm run check` green: lint + typecheck (4 workspaces) + **227 tests** (api 98, web 83, db 18,
  shared 28) + 4 builds. `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities. The 4
  moderate `esbuild` dev-server advisories pulled in transitively are dev-only and below the CI
  `high` gate.
- Docs: `qa/ui-foundation.md` (gap 3 closed; dependency + suite-count notes).

### Decisions

- Per-file `// @vitest-environment jsdom` rather than a second Vitest project — minimal config, and
  it keeps the node-env logic suite (the majority) fast.
- `jsdom` held at 26.x to respect the repo's Node 20 pin even though the sandbox runs Node 24.

### Open items

- Unchanged from the S0.1 entry below: raster PWA icons; real browser/device + Lighthouse pass;
  `/portal` + `/admin/*` still on legacy `globals.css`.

### Next

- Slice **S0.2**: the effective-dated `rule_sets` / `rule_versions` configuration primitive in
  `packages/db` + a `resolveRule(key, at)` service in `apps/api`, with migration/immutability
  triggers and tests. It is the dependency for the KYC required-field/document matrices, tax
  rates, investment limits, SLA thresholds, and scorecard weights in Phases 1–3.

## 2026-08-30 — UI/UX foundation, component kit, and installable PWA (slice S0.1)

**Status:** Done

### Updated

- **Program plan.** The user authorised a full MVP build and confirmed four decisions: open
  business/compliance items proceed on documented, configurable, versioned `ASSUMED FOR PILOT`
  defaults (stop only for irreversible items); pilot scope is broad (multiple borrower entity
  types; individual + institutional investors; all external vendors stubbed behind adapters);
  UI on Tailwind + a SproutUp component kit; commits go straight to `main`, one pushed commit per
  slice. Per-slice protocol: implement across shared → db → api → web, add tests (success / denial
  / validation / idempotency / concurrency / rollback), add a `qa/` scenario file, update the task
  + MVP README + docs + this log, run `npm run check` + `npm audit`, commit + push.
- **Design tokens.** `apps/web/tailwind.config.ts` now defines SproutUp semantic colour keys
  (`primary`, `surface`, `border`, `danger`, `warning`, `success`, `ring`, …), `borderRadius`,
  `boxShadow`, Inter `font-family`, and `max-w-content`. Values match the previous hand-rolled CSS
  palette, so unmigrated screens are visually unchanged. Tailwind is now actually used — the
  `next dev` "No utility classes were detected" warning is gone (**F-21 resolved**).
- **Component kit** in `apps/web/components/ui/`: `Button`/`ButtonLink`, `Field` + `Input` /
  `Textarea` / `Select`, `RadioCards` (real radio group), `Badge` / `StatusBadge` (status→tone
  map), `Alert`, `Card` / `Panel`, `Spinner`, `Stepper`, `PageHeading`, `SiteHeader`, plus a `cn`
  joiner and an `index.ts` barrel. Every class/variant recipe is a pure sibling `.ts` module
  (`button-classes.ts`, `field-wiring.ts`, `badge-tone.ts`, `stepper-model.ts`) so it is unit-
  tested in the `node` Vitest env without a DOM.
- **Migrated surfaces.** The landing page (`components/surface-home.tsx`), the auth card
  (`components/auth-card.tsx`), and the auth layout now use the kit — mobile-first, visible amber
  focus ring, `<noscript>` notice via `Alert`. The landing page previously referenced `.surface-*`
  CSS classes that existed in no stylesheet, so it was substantially unstyled before this change.
  `/portal` and `/admin/*` still use `app/globals.css` and migrate with their Phase 1 feature work;
  legacy CSS is trimmed as each route moves.
- **Inherited uncommitted work also landed in this commit.** The working tree already contained an
  uncommitted "multi-surface" landing refactor: `apps/web/app/page.tsx` (modified to resolve a
  surface from the request host), plus new untracked `apps/web/components/surface-home.tsx`,
  `apps/web/lib/portal-surface.ts` (surface content + `surfaceFromHost`/`portalUrl` for
  `admin.`/`borrower.`/`investor.` subdomains), and `apps/web/lib/auth-routing.ts`
  (`routeForSession` post-login redirect helper — **currently unused, untested scaffolding**).
  `page.tsx` already depended on these, so the repo did not build in isolation without them; they
  are committed here rather than stranded. `surface-home.tsx` was rewritten onto the kit as part of
  this slice. A test for `routeForSession` is deferred to S0.1b.
- **PWA.** `app/manifest.ts` → `/manifest.webmanifest` (`display: standalone`, theme `#287a4b`,
  SVG icons). `public/sw.js` is a small hand-written service worker: HTML navigations network-first
  (cached shell / `/offline` when offline), immutable build assets cache-first, everything else
  passthrough — and it only ever touches **same-origin GET**, so the cross-origin API is never
  cached. Its rules are specced + unit-tested in `apps/web/lib/pwa.ts`. `components/pwa-register.tsx`
  registers the worker in production builds only. New routes: `/offline`. `app/layout.tsx` gained
  `viewport` (theme colour, `viewport-fit: cover`), manifest + `appleWebApp` metadata, and a
  `metadataBase`. `next.config.mjs` adds `worker-src`/`manifest-src` to the CSP and a `no-cache`
  header for `/sw.js`. `app/icon.svg` + `app/apple-icon.svg` added.
- **Tests.** +31 web unit tests (`cn`, button recipe, field wiring, badge tones incl. unknown-status
  fallback, stepper model, PWA routing rules). Web suite 12 files / 60 tests. `npm run check` green:
  lint + typecheck (4 workspaces) + **204 tests** (api 98, web 60, db 18, shared 28) + 4 builds.
  `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities. No new dependencies.
- **Docs.** `docs/DEVELOPER.md` (new "User interface & PWA" section + route list), `qa/ui-foundation.md`
  (new — automated coverage, manual/heuristic scenarios, a11y checklist, gaps), `qa/findings.md`
  (F-21 → RESOLVED), `tasks/mvp1/21` + `tasks/mvp1/15` implementation progress, `tasks/mvp1/README.md`.

### Decisions

- Component style recipes live in `.ts` siblings, not inside the `.tsx`, purely so they are
  unit-testable in the current `node` test env. Real DOM render + a11y assertions need
  `jsdom` + `@testing-library/react`; that is the next slice (S0.1b) before the config primitive.
- The service worker is hand-written and deliberately tiny rather than Workbox-generated. For a
  financial app the key invariant is "never serve authenticated data from cache" — satisfied
  structurally because the API is a separate origin and the SW filters to same-origin GET.
- PWA icons are SVG (`sizes: "any"`), which satisfies Android/Chrome installability. Rasterised
  PNGs (192/512 + a 180px apple-touch) for iOS home-screen / Lighthouse fidelity are a tracked
  follow-up in `qa/ui-foundation.md`, not a blocker.
- Landing/auth migrated now (low risk — landing was already unstyled); portal/admin deferred to
  their feature slices to avoid building UI twice.

### Open items

- Raster PWA icons; a real browser/device pass (responsive, install flow, offline nav, Lighthouse
  PWA) once a preview deploy exists — no browser automation in this environment.
- `jsdom` + Testing Library render/a11y tests for the kit (slice S0.1b).
- `/portal` + `/admin/onboarding` + `/admin/role-approvals` still on legacy `globals.css`.
- All prior open items from the 2026-08-29 entry are unchanged.

### Next

- Slice **S0.1b**: add `jsdom` + `@testing-library/react` (+ `jest-dom`) as web dev dependencies,
  a Vitest DOM project, and render/a11y tests for the kit. Then slice **S0.2**: the effective-dated
  `rule_sets` / `rule_versions` config primitive (migration + resolver service + tests) that the
  KYC field matrices, tax rates, limits, and SLA thresholds all depend on.

## 2026-08-29 — QA findings remediation (auth hardening, audit IP, onboarding approve, admin bootstrap)

**Status:** Done

### Updated

- **Response contract fidelity (`qa` F-01/F-20):** `apps/api/src/openapi/role-approval-schemas.ts` gave the role-approval history `payload` (and action `metadata`) a real shape; the list/detail endpoints and `openapi.json` were shipping `payload: {}`, which also crashed the `/admin/role-approvals` history panel (`shortId(undefined)`). Added a serialization round-trip test and hardened `roleLabel`/`shortId` in the page.
- **Per-client auth rate limiting (F-02):** `apps/api/src/auth/service.ts` now sets `advanced.ipAddress.ipAddressHeaders: ['x-sproutup-client-ip']` (the Fastify proxy already forwards that header) so sign-in/sign-up limits bucket per client instead of one global `no-trusted-ip` bucket. `apps/api/src/server.ts` backfills `NODE_ENV` for Better Auth's env detection.
- **Proxy trust (F-03):** added `API_TRUST_PROXY` (`apps/api/src/config.ts`); `buildApp` uses it for Fastify `trustProxy` instead of the unconditional `true` that let `X-Forwarded-For` spoofing defeat both rate limiters. Default `false`.
- **Error envelope (F-06):** `apps/api/src/app.ts` maps schema/body-parse/4xx framework errors to the stable `400 VALIDATION_ERROR` (was `500` for malformed JSON) and adds a `404 NOT_FOUND` envelope via `setNotFoundHandler`.
- **Audit client IP (F-08) + denial audit (F-09):** added `hashIpAddress` to `packages/db`; threaded a hashed client IP through every route → service → `writeAudit` call (onboarding, review, sessions, role assign/revoke, approval lifecycle). Review separation-of-duties denials (self-review, cross-reviewer) now emit `onboarding_case.review_denied` with `outcome: denied`. Trigger-written `account.registered` still has no IP hash (follow-up).
- **Env loading / ports (F-10, F-13):** `apps/api` dev/start scripts use `--env-file-if-exists=../../.env`; `packages/db` scripts load the root `.env` by explicit path; `apps/web/next.config.mjs` (renamed from `.js`) loads root `.env` for `NEXT_PUBLIC_*`. A plain `cp .env.example .env` now works for the documented commands without exporting anything.
- **Web security headers (F-07):** `next.config.mjs` adds CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS on all routes, and `agentRules: false` so Next stops writing a competing `apps/web/AGENTS.md`/`CLAUDE.md` (also `.gitignore`d — F-14).
- **Compliance queue scope (F-11):** `apps/api/src/onboarding/review-service.ts` hides `draft`/`withdrawn` from the default queue; an explicit `status` filter still returns them.
- **Onboarding approval (F-04):** added `POST /v1/admin/onboarding/cases/:caseId/approve` (`approveOnboardingCase`) — a gated `in_review → approved` transition mirroring reject (assigned reviewer, exact version, 10–1000 char reason, `decidedAt`, immutable `approved` event, `onboarding_case.approved` audit), wired into `/admin/onboarding`. This is a bare transition to unblock end-to-end pilot exercise; the deferred KYC/screening/escalation/eligibility policy is unchanged.
- **First-admin bootstrap (F-05):** added `packages/db/src/bootstrap-super-admin.ts` and `npm run db:bootstrap-super-admin -- <email>` — idempotent break-glass promotion of an existing active account to `super_admin`, audited, refusing unknown/inactive accounts. Two runs against two accounts make the maker/checker role workflow operable.
- **Minor UI (F-15/F-16/F-18/F-19):** session location/device falls back with `||` (not `??`) and the API normalises `""` → `null`; a rejected onboarding case shows a "declined — start a fresh application" note; the registration intent picker is now real radio inputs (`name="registrationIntent"`) with a `<noscript>` notice; the internal "Version N" line was removed from portal case cards.
- **`registrationIntent` validation (F-23):** the auth proxy rejects any non-`borrower`/`investor` value with `400 VALIDATION_ERROR` before Better Auth's opaque "Failed to create user".
- Docs: `docs/DEVELOPER.md`, `docs/SECURITY.md`, `.env.example`, and `qa/` (findings marked resolved/deferred). `npm run check` is green (lint, typecheck, 173 tests, 4 builds).

### Decisions

- `approve` was added despite the prior "approval intentionally absent" note because QA finding F-04 identified "no successful terminal state exists" as release-blocking and the finding's own remedy is "at least a gated approve transition". It deliberately implements **only** the state transition; completeness/screening/escalation/decision-authority/eligibility remain open under tasks 03–05, and re-onboarding after approval is not yet blocked.
- The bootstrap script bypasses maker/checker by design (operator with DB/env access is already inside the trust boundary). It is a setup-time CLI, never a route.
- Denial auditing was scoped to the onboarding review workflow's separation-of-duties checks. Role-approval lifecycle denials and route-level 403s are not yet audited (follow-up).

### Open items

- `account.registered` (DB trigger) does not carry the client-IP hash; role-approval lifecycle denials and `/admin/*` 403s are not audited yet.
- Reviewer unassign/transfer/escalation and queue SLA/aging policy still unbuilt (F-22, task 20).
- "Needs information" is still a no-op for applicants until KYC profile/evidence fields exist (F-17, tasks 03–05).
- Tailwind is still wired but unused (F-21) — deferred to avoid an unverifiable reset-replacement regression.
- Approved onboarding does not block a new onboarding case for the same applicant/journey.

### Next

- Confirm the onboarding approval policy (or gate `approve` behind completeness/screening) and the re-onboarding rule with product/compliance; then extend denial auditing to the role-approval lifecycle and route-level authorization failures.

## 2026-08-20 — Active-sessions device UI

**Status:** Done

### Updated

- Added `apps/web/lib/session-client.ts` and its test file, wrapping the existing `GET /v1/sessions` and `DELETE /v1/sessions/:sessionId` own-session APIs (task 02) with the same bounded-error-mapping pattern as the other clients.
- Added an "Active sessions" section to `/portal`, available to every authenticated account (all roles carry `sessions.read_own`/`sessions.revoke_own`): lists each session's IP address, user agent, created/expiry time, and current-device flag, with a per-session "Sign out this device" control. The current session has no revoke control there — it relies on the existing "Sign out" button instead, so a user can't accidentally end the session they're viewing the page from.
- Updated `docs/DEVELOPER.md`, `docs/SECURITY.md`, `tasks/mvp1/02-auth-rbac-audit.md`, `tasks/mvp1/21-borrower-investor-portal-journeys.md`, and `tasks/mvp1/README.md`.

### Decisions

- No user-agent parsing/device-name inference was added; the raw `userAgent` string is shown as-is rather than inventing a browser/OS detection feature nobody asked for.

### Open items

- Same as prior entries — nothing new. This closes the last "API exists, no UI" gap found in `apps/api/src/routes` during this pass (onboarding, role approvals, and now sessions all have a UI; `access-catalogue.ts`'s `/v1/admin/roles` and `/v1/admin/users` are used internally by the role-approvals propose form but have no standalone directory page — that would be new scope, not a gap, so it was left alone).
- Could not visually verify against live session data — no local Postgres/API was running; verified via typecheck, lint, unit tests, a full production build, and a dev-server smoke request only.

### Next

- No further engineering-only surface is currently identified anywhere in the MVP1 plan. Everything remaining needs a business/compliance/policy input first (see the 2026-08-20 role-approvals entry below for the same conclusion in more detail).

## 2026-08-20 — Role approvals UI and a Turbopack/shared-package build fix

**Status:** Done

### Updated

- Added `apps/web/lib/admin-role-approvals-client.ts` and its test file, wrapping the existing dual-controlled role-assignment/revocation, reject/cancel, and history/detail APIs (task 22) plus the bounded user catalogue (`/v1/admin/users`), with the same bounded-error-mapping pattern as the onboarding client.
- Added `/admin/role-approvals` (`apps/web/app/admin/role-approvals/page.tsx`), gated on `roles.assign`: a pending-request list with maker-aware approve/reject/cancel, a propose form with user search and a full role picker, and filterable/paginated history with an expandable action timeline and an explicit `integrity: "invalid"` warning.
- Linked the new workspace from `/portal` for `roles.assign` holders, alongside the existing onboarding-queue link; introduced a `.staff-workspace-links` wrapper so both links stack correctly instead of colliding.
- **Build fix, not new scope:** this is the first time `apps/web` imports `@sproutup/shared` from an actual page rather than only `next.config.js`. Doing so broke `next build` under Turbopack — it could not resolve the shared package's `NodeNext`-style `./foo.js` barrel re-exports back to their `.ts` source, even though `tsc`, `vitest`, and `tsup` all resolve that mapping fine elsewhere in the repo. Fixed by dropping the `.js` extensions in `packages/shared/src/index.ts`'s re-exports, which is valid and arguably more correct under its own `moduleResolution: "bundler"` tsconfig. Confirmed with a full `npm run check` afterward (164 tests, lint, typecheck, and all four workspace builds green).
- Updated `docs/DEVELOPER.md`, `docs/SECURITY.md`, `tasks/mvp1/02-auth-rbac-audit.md`, `tasks/mvp1/22-maker-checker-approval-matrix.md`, and `tasks/mvp1/README.md`.

### Decisions

- The client never accepts a free-typed target user ID; the propose form only ever submits the `id` from a selected `/v1/admin/users` search result.
- Approve does not collect a client-side reason (the API's reason there is optional); reject and cancel both require one, matching their required-reason contract.
- Self-review gating (hiding approve/reject for the current user's own proposal, showing cancel instead) is UI convenience only — every command re-hits the server, which is what actually enforces maker/checker separation.
- This is the first UI built on the task 22 approval foundation. Other domains that will eventually need dual control (disbursement, wallet adjustments, etc.) still have no UI and no approved matrix; nothing about this change extends the approval mechanism beyond role changes.

### Open items

- Same as prior task 20/02/22 entries: SLA/escalation policy, saved views, bulk actions, MFA/recovery, the cross-domain approval matrix, and emergency override are still unbuilt because they need an approved policy first.
- Could not visually verify the new page against live queue/user data — no local Postgres/API was running; verified via typecheck, lint, unit tests, a full production build across all four workspaces, and a dev-server smoke request only.

### Next

- No further engineering-only surface is currently identified on tasks 02/20/22. Remaining work across the MVP1 plan needs a business/compliance/policy input (KYC fields, tax rules, wallet chart of accounts, credit scoring criteria, SLA thresholds, or the approval matrix itself) before more can be implemented responsibly.

## 2026-08-20 — Onboarding queue aging display

**Status:** Done

### Updated

- Added a per-row "Waiting since {submittedAt}" / "Updated {updatedAt}" line to `/admin/onboarding` queue cards, using the already-returned queue row timestamps (no new API call or field).

### Decisions

- This is a descriptive aging display only — no SLA threshold, breach coloring, or priority ordering, since those require an approved policy (tracked as an open item on task 20).

### Open items

- Same as prior entries: SLA/aging *policy* (thresholds, breach treatment), assignment transfer/escalation, saved views, bulk-action policy, and end-to-end responsive/accessibility/browser tests remain.
- Could not visually verify rendering against live queue data — no local Postgres/API was running in this session; verified via typecheck, lint, unit tests, production build, and a dev-server smoke request only.

### Next

- Confirm SLA/aging policy with product/compliance, then add threshold-based indicators on top of this display.

## 2026-08-20 — Staff case detail/timeline UI

**Status:** Done

### Updated

- Added `loadAdminOnboardingCaseDetail` to the admin onboarding client, calling the existing `GET /v1/admin/onboarding/cases/:caseId` staff detail contract with 401/403/404/dependency-failure mapping that never leaks server text, plus two client tests (web suite now has seventeen tests).
- Wired a per-row "View history" toggle into `/admin/onboarding` that lazily loads and renders the ordered immutable event timeline (label, occurrence time, case version, reason), mirroring the customer portal's timeline pattern and reusing its existing `case-timeline` styling.
- Updated `docs/DEVELOPER.md` and `tasks/mvp1/20-admin-information-architecture-work-queues.md` to describe the wired detail/timeline UI.

### Decisions

- The admin detail view renders exactly the allowlisted staff projection already returned by `staffCaseDetailSchema` (applicant identity plus ordered events); no new fields were requested from the API.
- Detail loading follows the portal's toggle-and-collapse pattern rather than preloading every row, keeping the queue view lightweight.

### Open items

- Same as the prior entry: queue SLA/aging/priority, assignment transfer/escalation, saved views, bulk-action policy, and end-to-end responsive/accessibility/browser tests remain.

### Next

- Add approved profile/evidence completion UI and staff-side document/decision detail once those records exist.

## 2026-08-19 — Staff compliance queue workspace

**Status:** Done

### Updated

- Added responsive `/admin/onboarding` with session/capability resolution before protected queue loading and no case rendering on unauthenticated, forbidden, malformed, or unavailable states.
- Added page-size-25 queue navigation, matching total count, borrower/investor type filter, lifecycle status filter, assigned-to-me filter, refresh, and empty states.
- Added UI actions for claiming unassigned submitted work, resuming reviewer-retained resubmissions, assigned-reviewer information requests, and assigned-reviewer rejection with 10–1000 character reason forms.
- Added exact displayed-version command payloads, pending duplicate-action prevention, bounded stable error messages, assignment ownership cues, and authoritative queue reload after every command.
- Added a staff-only workspace link based on server-returned `onboarding_cases.read` and four client tests covering permission short-circuit, bounded filter construction, exact command payloads, and non-leaking assignment/stale errors; the web suite now has fifteen tests.
- Updated developer, security, borrower, investor, admin-queue, portal, MVP-index, and handoff documentation.

### Decisions

- Queue visibility requires `onboarding_cases.read`; review controls independently require `onboarding_cases.review`. The UI reflects, but never replaces, API enforcement.
- Submitted unassigned work can be claimed. A resubmitted case retains assignment and only its current reviewer can resume; another reviewer cannot take it over.
- Staff command forms send the queue row's exact version and reload after every outcome, preventing the client from assuming a transition succeeded.
- Approval remains absent from both API and UI until completeness, screening, escalation, authority, and eligibility effects are implemented.

### Open items

- Add staff case detail/timeline UI and future profile/evidence review once those records exist.
- Define queue SLA/aging/priority, assignment transfer/escalation, saved views, and bulk-action policy.
- Add end-to-end responsive/accessibility/browser tests against the deployed cookie/CORS topology.

### Next

- Add protected staff case detail/timeline UI to the workspace without broadening the current allowlisted applicant projection.

## 2026-08-19 — Owned onboarding case timeline UI

**Status:** Done

### Updated

- Added lazy owned-case detail loading from `GET /v1/onboarding/cases/:caseId` with cookie credentials and no staff-queue fallback.
- Added an expandable portal timeline showing ordered event labels, occurrence times, case versions, and applicant-visible information-request, withdrawal, and decision reasons.
- Added bounded unauthenticated, missing/foreign, malformed-contract, dependency, and network error behavior without rendering server exception text.
- Added two portal-client tests for exact owner-detail request behavior, preserved reason evidence, and safe missing/malformed responses; the web suite now has eleven tests.
- Updated developer, security, borrower, investor, portal, MVP-index, and handoff documentation.

### Decisions

- Case detail remains an on-demand own-case read. The portal does not preload every timeline or use staff APIs to enrich customer data.
- Event ordering, version, timestamp, and reasons come from immutable server evidence; the web client does not synthesize transitions.
- Reviewer user IDs remain in the existing API response contract but are not rendered in the customer UI; no broader reviewer identity is exposed.
- A hidden or foreign case is indistinguishable from a missing case in the portal.

### Open items

- Add approved profile/evidence completion UI and explicit correction fields after tasks 03–05 policies are resolved.
- Define and implement rejected/expired case reopen behavior and next-action content.
- Add full browser journey tests against a running API/database once the deployed cookie/CORS topology is selected.

### Next

- Implement a responsive staff compliance workspace over the existing protected queue/detail/start-review/request-information/reject APIs.

## 2026-08-19 — Permission-driven onboarding portal shell

**Status:** Done

### Updated

- Added the authenticated `/portal` route with loading, unauthenticated, unavailable, retry, empty, and responsive account states.
- Added a cookie-bearing portal client that resolves `/v1/session-context` before loading owned onboarding cases and never reads or stores session tokens.
- Rendered borrower/investor start controls only from server-returned `manage_own` permissions and submit/resubmit controls only from matching `submit_own` permissions plus current state.
- Added exact-version create/submit/withdraw commands, a bounded reason form, pending-state duplicate-action controls, safe stable error-code mapping, authoritative refresh after commands, session-expiry handling, and sign-out.
- Redirected successful registration/sign-in to the portal and linked the portal from the landing page.
- Added four portal-client tests covering unauthenticated short-circuit, ordered session/case loading with cookies, exact optimistic command payloads, and non-leaking stale/session errors; the web suite now has nine tests.
- Updated developer, security, borrower, investor, portal, MVP-index, and handoff documentation.

### Decisions

- Portal visibility is derived only from server-resolved permission keys. Client-side hiding improves clarity but never substitutes for owner/type/capability checks in the API.
- Session context must succeed before any owned-case request or authenticated rendering. Partial or malformed loads render no account data.
- Commands always use the currently displayed case version and reload server state after success or conflict; the browser never fabricates the next version.
- The portal currently supports case lifecycle actions only. It does not imply profile completeness, KYC evidence, approval eligibility, funding, wallet, or staff functionality.

### Open items

- Add owned case detail/timeline and explicit next-action content, then profile/evidence forms after field policies are approved.
- Add password recovery/email verification and deployed-browser cookie/CORS tests after provider/topology decisions.
- Add route-level session protection/redirect strategy if the deployment requires server-side authenticated rendering rather than the current no-data-until-resolved client shell.

### Next

- Implement owned onboarding case detail and immutable timeline UI using the existing protected detail API, including information-request and terminal decision reasons.

## 2026-08-19 — Borrower and investor authentication entry UI

**Status:** Done

### Updated

- Added responsive `/register` and `/login` App Router pages with a shared accessible authentication card and explicit SME borrower/investor primary-journey choice.
- Connected both forms to the existing Better Auth API boundary through `NEXT_PUBLIC_API_URL`, JSON requests, and `credentials: "include"` without exposing session tokens to browser code.
- Added client-side name/email/password validation aligned with current server constraints, pending-state duplicate-submit prevention, non-enumerating credential errors, rate-limit feedback, and non-leaking network failure messages.
- Updated the landing page with clear registration/sign-in navigation, stronger keyboard focus states, mobile form layout, and SproutUp icon treatment.
- Added four authentication-client tests covering normalized payloads, cookie request options, pre-network validation, safe denial/rate-limit messages, and network-failure redaction; the web suite now has five tests.
- Updated developer, security, authentication, portal, MVP-index, and handoff documentation.

### Decisions

- Registration exposes only the already-approved primary `borrower` or `investor` intent. Staff roles and dual-capacity selection are not presented to public users.
- Browser validation is for feedback only. Better Auth and the API remain authoritative for credentials, rate limiting, role bootstrap, and session-cookie behavior.
- Sign-in errors deliberately do not distinguish an unknown email from an incorrect password.
- Successful authentication returns to the landing page temporarily; the authenticated portal shell is the next UI boundary and must resolve server session context before rendering capabilities.

### Open items

- Implement the authenticated portal shell and server-authoritative session/onboarding state rendering.
- Add password recovery and email verification only with approved delivery provider, templates, token lifecycle, and anti-enumeration behavior.
- Complete accessibility/browser QA and end-to-end cookie/CORS tests in the deployed pilot topology.

### Next

- Implement an authenticated portal page that resolves `/v1/session-context`, shows only server-granted journey actions, and safely handles expired sessions.

## 2026-08-19 — Exact consent publication and acceptance services

**Status:** Done

### Updated

- Added an internal consent service with transaction-aware publication and acceptance primitives plus latest-effective document lookup.
- Publication computes lowercase SHA-256 from exact UTF-8 content, uses key/locale/version identity, returns only exact title/content/effective-time retries, rejects changed reuse, and atomically appends audit evidence.
- Acceptance requires an existing user, exact document/hash, and already-effective version, persists optional one-way client-context hashes, resolves repeated acceptance without duplicate evidence, and atomically appends audit evidence.
- Added six embedded-PostgreSQL integration tests covering exact hash/audit publication, retry/conflict behavior, effective-time selection, idempotent acceptance, all stable denial results, and caller-transaction rollback.
- Updated consent, developer, security, technology-stack, platform, document/consent, MVP-index, and handoff documentation.

### Decisions

- Published content is hashed exactly as supplied in UTF-8; the service does not normalize Unicode, line endings, or whitespace after publication input validation.
- Key/locale/version is the publication identity. An exact retry may return the existing row, but a changed title, content, hash, or effective time under that identity is a conflict.
- The internal latest-effective read is a technical selection helper, not a required-consent policy. Callers must enforce approved mandatory/re-consent rules.
- Acceptance is self-service for the identified existing user and exact displayed hash. Proxy/assisted acceptance is not implemented.
- No route or content seed is added, so the internal publication primitive does not bypass the missing legal authority and content-approval decisions.

### Open items

- Approve legal content owners, mandatory keys/versions, localization, route permissions, re-consent/withdrawal behavior, and retention.
- Integrate explicit accepted document versions into onboarding completeness only after that matrix is approved.
- Implement separate private-file validation/storage/scanning and e-signature evidence after provider and policy decisions.

### Next

- Continue with a provider-neutral private-file metadata/quarantine foundation only if storage, classification, scan-state, and retention semantics can be established without selecting an unapproved provider.

## 2026-08-19 — Immutable consent evidence schema

**Status:** Done

### Updated

- Added generated migration `0013_robust_corsair.sql` and Drizzle schema for versioned consent documents plus per-user acceptance evidence.
- Added key/locale/version, non-empty content, lowercase SHA-256, publication/effective attribution, one-acceptance-per-user/version, request correlation, and optional one-way client-context hash constraints.
- Added custom migration `0014_consent-evidence-invariants.sql` blocking update/delete/truncate on both evidence tables and rejecting acceptance hashes that differ from the referenced document.
- Added both relations to API startup readiness and shared embedded-PostgreSQL migration fixtures.
- Added migration coverage for relation creation, matching acceptance, mismatched hash rejection, and immutable document/acceptance evidence; the database suite now has 15 tests.
- Added the consent architecture document and updated developer, security, technology-stack, platform, document/consent, MVP-index, and handoff documentation.

### Decisions

- Legal content and acceptance evidence are append-only. Corrections and replacements use a new document version; historical accepted text is never edited in place.
- An acceptance duplicates the exact content hash and the database requires it to match the referenced immutable document, making version binding explicit.
- Exact canonical text is retained in PostgreSQL. Private uploads and signed artifacts remain separate storage/security domains and must not overload consent tables.
- No document keys/content are seeded and no API is exposed until legal ownership, required-version, authorization, re-consent, withdrawal, and retention policies are approved.

### Open items

- Implement an audited publication boundary that computes SHA-256 from exact UTF-8 content and enforces publishing authority.
- Approve legal content owners, mandatory document matrix, localization, effective/re-consent/withdrawal behavior, and retention.
- Implement separate private-file validation/storage/scanning and e-signature evidence after provider and policy decisions.

### Next

- Implement the internal consent publication and exact-acceptance services without exposing routes or seeding content, preserving the policy gates documented in `docs/CONSENTS.md`.

## 2026-08-19 — Assigned-reviewer onboarding rejection

**Status:** Done

### Updated

- Added `POST /v1/admin/onboarding/cases/:caseId/reject` with enforced UUID, positive version, and trimmed 10–1000 character reason contracts.
- Added a row-locked assigned-reviewer service command that rejects only `in_review`, stamps `decidedAt`, increments version, and atomically appends reasoned case-event and audit evidence.
- Added service coverage for resubmission/reclaim followed by unassigned-reviewer denial, stale-version denial, exact rejection state/timestamp/timeline, and audit reason preservation.
- Added route identity/permission propagation, stable denial behavior, and global OpenAPI operation coverage.
- Updated developer, security, borrower, investor, admin-queue, portal, MVP-index, and handoff documentation.

### Decisions

- Rejection requires the currently assigned reviewer and the `onboarding_cases.review` capability; general queue access is insufficient.
- Rejection is allowed only from `in_review`, is optimistic-versioned, and retains reviewer assignment as historical attribution.
- Rejection reasons and decision timestamps are durable workflow and audit evidence, not mutable case fields.
- Approval remains deliberately unavailable until profile/evidence completeness, screening, escalation, eligibility effects, and decision authority are implemented and tested.

### Open items

- Approve the borrower entity/document matrix and investor subject/suitability scope.
- Implement versioned profile/evidence/consent completeness before any positive decision path.
- Define rejected-case correction/reopen authority and conditions; the shared transition exists but no command assumes that policy.

### Next

- Add a policy-neutral, versioned draft profile envelope only if its Philippine borrower/investor field scope can be approved; otherwise continue with consent-version infrastructure that does not invent regulated content.

## 2026-08-19 — Reasoned applicant onboarding withdrawal

**Status:** Done

### Updated

- Added the owner-bound `POST /v1/onboarding/cases/:caseId/withdraw` operation for both permitted borrower and investor journeys.
- Required the current positive case version and a trimmed 10–1000 character reason under enforced Fastify/OpenAPI and Zod contracts.
- Added a row-locked service transition that atomically writes terminal `withdrawn` state, increments version, appends the reasoned immutable case event, and appends business audit evidence.
- Added service tests for stale-version denial, reason/timeline/audit preservation, and opening a fresh journey after withdrawal; added route identity/capability propagation and OpenAPI operation coverage.
- Updated developer, security, borrower, investor, portal, MVP-index, and handoff documentation.

### Decisions

- Applicants may withdraw only from `draft`, `submitted`, or `needs_information`, matching the existing shared state machine. A case already `in_review` requires staff coordination and cannot be unilaterally overwritten.
- Withdrawal uses the journey's `manage_own` capability and binds applicant identity plus permitted case type in the database query.
- Withdrawal is a terminal historical case, not deletion. Its reason, prior reviewer attribution, events, and audit evidence remain available.
- A terminal withdrawal releases the database one-open-case constraint, allowing a later new case without rewriting the old one.

### Open items

- Borrower/investor profile, evidence, consent, completeness, and provider policies remain blocked on tasks 03–05 decisions.
- Staff reject/approve commands and eligibility effects remain incomplete; approval must not be added before completeness/policy gates exist.
- Portal UI and accessible confirmation/retry behavior remain unimplemented.

### Next

- Implement the reasoned assigned-reviewer rejection command, which can safely preserve a negative decision without assuming an approval or KYC completeness policy.

## 2026-08-19 — Exact ledger account projection

**Status:** Done

### Updated

- Added an internal API service deriving a ledger account's current posted debit total, credit total, and signed normal balance directly from immutable entries.
- Preserved canonical PHP string results and exact `bigint` centavo subtraction after PostgreSQL performs exact numeric aggregation.
- Included real metadata and `0.00` totals for empty or closed accounts and a stable not-found result for missing accounts.
- Added four embedded-PostgreSQL tests for debit-normal and credit-normal negative balances, empty closed accounts, and missing accounts.
- Updated ledger, developer, security, technology-stack, platform, wallet/ledger, MVP-index, and handoff documentation.

### Decisions

- Normal balance is debit minus credit for debit-normal accounts and credit minus debit for credit-normal accounts. A negative result is valid technical ledger information and remains a signed canonical amount.
- The projection covers all currently posted entries. It does not imply available, held, settled, pending, value-date, cutoff, ownership, or statement semantics.
- No HTTP route is added until chart ownership and exact staff/customer authorization and response projections are approved.
- The immutable ledger remains the source of truth; no mutable account-balance column or cache was introduced.

### Open items

- Approve the production chart and account ownership model before customer or staff exposure.
- Define available/held/settled dimensions, hold lifecycle, effective-date/cutoff behavior, and reconciliation views.
- Define controlled bank-transfer evidence, approval, payout, and exception workflows.

### Next

- Resolve and document the controlled-pilot chart-of-accounts and ownership decisions required before wallet/transfer domain implementation.

## 2026-08-19 — Idempotent full ledger reversal

**Status:** Done

### Updated

- Added a transaction-aware full-reversal command and convenience service boundary to the API ledger service.
- Locked the original transaction, copied every historical line with debit/credit exchanged, linked the reversal header, and appended `ledger.transaction.reversed` audit evidence atomically.
- Added exact retry versus changed-payload conflict behavior, explicit missing/already-reversed/reversal-of-reversal outcomes, and service/database enforcement of one full reversal.
- Added four embedded-PostgreSQL tests for mirrored entries and audit evidence, retry/conflict/one-reversal behavior, missing originals and caller rollback, and correction after account closure; the ledger service suite now has ten tests.
- Updated ledger, developer, security, technology-stack, platform, wallet/ledger, MVP-index, and handoff documentation.

### Decisions

- A full reversal mirrors the complete original posting. Partial corrections remain a separate future domain command and cannot mutate or masquerade as a full reversal.
- A reversal of a reversal is rejected. Re-posting an economic effect requires a new approved domain command with its own source and idempotency identity.
- Original-row locking serializes application reversal attempts, while the unique reversal relationship is the final database authority.
- Account closure does not remove the ability to reverse historical evidence. Only the reversal primitive receives this exception; new postings still require active accounts.

### Open items

- Approve and seed the production chart, account ownership, available/held/settled balance dimensions, and domain posting matrices.
- Define controlled bank-transfer evidence, approval, payout, reconciliation, and exception workflows.
- Approve task-specific calculation, value-date/cutoff, maker/checker, and partial-correction rules before exposing ledger commands through HTTP.

### Next

- Implement read-only exact ledger balance projections without introducing a mutable source-of-truth balance.

## 2026-08-19 — Atomic audited ledger posting

**Status:** Done

### Updated

- Added an API ledger posting service that validates canonical positive PHP lines, distinct accounts, and exact debit/credit balance before writing.
- Added deterministic account-sorted payload hashing, shared locks on active PHP accounts, atomic header/line/audit persistence, exact idempotent retries, and conflict detection for changed effects.
- Exposed a transaction-aware primitive for owning-domain state changes and a convenience transaction-owning service method.
- Added six embedded-PostgreSQL integration tests covering balanced persistence and canonical order, exact retry without duplicate evidence, changed-payload conflicts, malformed financial effects, inactive/missing accounts, retry after closure, and caller rollback.
- Updated ledger, developer, security, technology-stack, platform, wallet/ledger, MVP-index, and handoff documentation.

### Decisions

- One posting may contain at most one line per account; callers aggregate same-account components before posting.
- Financial identity binds source, description, effective time, currency, and sorted lines. Actor and request IDs remain execution evidence and do not change exact-retry identity.
- Exact retries resolve before current account status checks. Newly created postings require every referenced account to be active and PHP-denominated.
- Database deferred constraints remain the final balance authority even though the service rejects imbalance earlier.

### Open items

- Implement a full reversal primitive that copies every original line in the opposite direction, preserves history, enforces a single reversal, and writes audit evidence atomically.
- Approve and seed the production chart, account ownership, available/held/settled dimensions, and domain posting matrices.
- Define bank evidence/reconciliation, value-date/cutoff, maker/checker, and calculation rules in their owning tasks.

### Next

- Implement and test the idempotent full reversal command over the posting boundary.

## 2026-08-19 — Balanced append-only ledger schema

**Status:** Done

### Updated

- Added generated migration `0011_wide_nemesis.sql` with generic ledger accounts, immutable posting headers, and positive debit/credit entry lines using PHP-only `numeric(30,2)`.
- Added global posting idempotency and payload hashes, source references, optional actor/request evidence, unique full-reversal identity, unique line/account identities, and account activity/normal-balance metadata.
- Added custom migration `0012_ledger-invariants.sql` with deferred commit-time enforcement requiring at least two entries and exact equal debit/credit totals.
- Added database triggers preventing posting/entry update, delete, and truncate while protecting account code, normal balance, and currency from drift.
- Added embedded-PostgreSQL tests for exact balanced posting, unbalanced/empty commit rejection, append-only evidence, and permitted account name/status maintenance; the DB suite now has 14 tests.
- Added the ledger architecture document and updated developer, money, security, technology-stack, platform, wallet/ledger, MVP-index, schema, and handoff documentation.

### Decisions

- The ledger is double-entry with positive line amounts and explicit debit/credit direction. PostgreSQL exact totals and deferred constraint triggers—not application-only checks—enforce final balance at transaction commit.
- Posting headers and lines are immutable. Corrections use a new full reversal transaction; at most one full reversal may reference an original transaction.
- The schema is generic and no production chart/account ownership or business posting rule is seeded. Normal balance is descriptive/control metadata, not permission to derive unresolved wallet behavior.
- Financial transaction idempotency is global and hash-bound; the posting service must return only exact retries and reject key reuse with a different effect.

### Open items

- Implement the atomic audited posting/idempotency service and full reversal command.
- Approve and seed the production chart, account ownership, available/held/settled dimensions, and domain posting matrices.
- Define bank evidence/reconciliation, value-date/cutoff, maker/checker, and calculation rules in their owning tasks.

### Next

- Implement the posting primitive that validates exact balance/active accounts, canonicalizes and hashes lines, commits audit evidence atomically, and safely resolves idempotent retries.

## 2026-08-19 — Exact PHP settled-money primitive

**Status:** Done

### Updated

- Added shared canonical `PHP` amount and money-contract schemas requiring decimal strings with exactly two places; numeric JSON, exponent/grouped/currency text, leading zeros, and negative zero are rejected.
- Added immutable branded `PhpMoney` values backed by `bigint` centavos plus exact parsing, formatting, transport conversion, addition, subtraction, negation, and comparison.
- Established a shared PostgreSQL `numeric(30,2)` technical precision and enforced the same overflow boundary during parsing and arithmetic.
- Added 20 money-focused cases across six tests, increasing the shared suite to 28 tests across four files.
- Added the exact-money architecture document and updated developer, security, technology-stack, platform, wallet/ledger, MVP-index, schema, and handoff documentation.

### Decisions

- BSP's statutory 100-centavos-per-peso definition supports two-decimal settled PHP values. External contracts use strings and internal settled values use integer centavos; JavaScript `number` is never accepted for money.
- `numeric(30,2)` is a technical persistence/overflow boundary, not a product transaction limit. Domain limits must be smaller, named, configurable where appropriate, and separately approved.
- No generic multiply/divide/rate/allocation/rounding operation is provided. Those require owning-domain rule versions, intermediate precision, rounding stage/mode, residual policy, and golden reconciliation tests.

### Open items

- Approve the ledger model, account catalogue, posting invariants, balance dimensions, and reversal semantics.
- Approve an exact intermediate-rate representation and every task-specific rounding/residual rule before financial formulas.
- Define product transaction/aggregate limits independently of the broad storage precision.

### Next

- Implement the provider-independent append-only balanced ledger schema and posting primitive, limited to exact PHP amounts and reversals with no unresolved fees/rates.

## 2026-08-19 — Policy-gated MVP job catalogue

**Status:** Done

### Updated

- Added the MVP 1 job catalogue for authentication/recovery, OTP, onboarding, compliance screening, document scanning/signing, campaigns, funding holds, bank events, disbursement, repayment, distribution, notifications, reports, reconciliation, migration, diagnostics, and break-glass work.
- Classified candidates as blocked, synchronous/manual for the controlled pilot, or separate non-production operational commands and recorded each owning task/gate.
- Added a seven-step promotion checklist covering versioned safe payloads, enqueue/handler idempotency, retry classification, service objectives, alerts, recovery, tests, and runbooks.
- Confirmed there are no approved **Ready** production topics; the explicit application registry remains empty and no worker starts.
- Updated job, developer, scheduler, MVP-index, and handoff documentation.

### Decisions

- Runtime availability does not authorize domain automation. A topic is registered only after its catalogue entry is **Ready** and its owning policy/provider/data model is approved.
- Onboarding state/event/audit work remains synchronous for the pilot; future screening or notification jobs require their own approved providers/contracts.
- Manual disbursement and receipt allocation may remain synchronous controlled-pilot operations, but they still require ledger idempotency, dual control, evidence, and reconciliation before implementation.
- Migrations, diagnostics, and break-glass corrections are separate operational commands with dedicated authority/runbooks, not ordinary production topics.

### Open items

- All external delivery/screening/signing/banking topics remain blocked on provider and contract decisions.
- Financial/campaign/repayment/distribution/reconciliation topics remain blocked on their authoritative domain models and approved calculation/control policies.
- Worker deployment/capacity and operator replay controls remain unnecessary until at least one topic becomes **Ready**.

### Next

- Continue with a provider-independent financial foundation, beginning with exact PHP money representation and explicit rounding boundaries without encoding unresolved rates or formulas.

## 2026-08-19 — Deny-by-default graceful job worker runtime

**Status:** Done

### Updated

- Added an explicit job-topic registry binding lowercase topic identifiers to versioned Zod payload schemas and typed handlers; duplicate or malformed registrations are rejected.
- Added a provider-neutral worker runtime with bounded batch/concurrency, non-overlapping polls, expired-lease recovery before claims, automatic heartbeats, and current-lease settlement through the existing control service.
- Unknown topics and invalid payload versions/contracts are non-retryably dead-lettered. Classified failures persist safe codes/retryability; unexpected exceptions persist only `UNHANDLED_JOB_ERROR`, not exception messages.
- Added graceful stop behavior that blocks new claims, drains within a bounded timeout, clears successful-drain timers, and abort-signals timed-out handlers without stale settlement so leases can be recovered.
- Added the empty application registry factory and intentionally did not activate a worker in the API server.
- Added five runtime tests; the API suite now has 70 tests across 24 files.
- Updated job, developer, security, technology-stack, platform, scheduler, MVP-index, and handoff documentation.

### Decisions

- Worker dispatch is deny-by-default. No job executes without an exact registered topic, positive `schemaVersion`, and successful topic schema validation.
- Poll cycles do not overlap; claims are additionally capped by available concurrency. This bounds local load while PostgreSQL leases coordinate multiple future processes.
- Shutdown timeout causes lease handoff, not false failure/success settlement. Handlers must observe the abort signal; their domain/provider idempotency remains authoritative if an external call has already started.
- No production topic or worker process is activated until its owning domain, handler idempotency, runbook, capacity, and alerts are approved.

### Open items

- Register approved production domain topics and handler owners as their tasks become implementable.
- Add a deployed worker entrypoint/configuration, structured metrics/alerts, and recovery/retention runbooks.
- Add audited operator dead-letter inspection/replay/cancellation after the break-glass model is approved.

### Next

- Inventory MVP 1 job topics and mark each as blocked, synchronous-for-pilot, or ready for handler implementation without inventing unresolved provider/domain policy.

## 2026-08-19 — Transactional job control and lease recovery

**Status:** Done

### Updated

- Added `enqueueDurableJob` for insertion inside an owning domain transaction and verified a failed domain transaction rolls back its job.
- Exact idempotent retries return the existing job; reuse of the same key with different topic/payload returns an explicit conflict. Sensitive payload keys are rejected before persistence.
- Added bounded priority/availability claims using PostgreSQL row locks with `SKIP LOCKED`, unique attempt creation, worker leases, and heartbeats.
- Added current-worker/current-attempt/unexpired-lease enforcement for success and failure settlement, exponential bounded retries, attempt-budget dead-lettering, expired-lease recovery, and cancellation restricted to unleased work.
- Added custom migration `0010_job-attempt-evidence.sql`; active attempts can heartbeat and settle once, while completed evidence cannot be edited, deleted, or truncated.
- Added seven embedded-PostgreSQL service tests; the API suite now has 65 tests across 23 files and the DB suite retains 13 migration/audit tests.
- Updated durable-job, developer, security, technology-stack, platform, scheduler, MVP-index, and handoff documentation.

### Decisions

- Domain code must call the transaction-aware enqueue primitive in the same transaction as authoritative state. Standalone enqueue is reserved for work with no companion domain mutation.
- Lower numeric priority is claimed first; equal-priority work is ordered by availability, creation time, and ID. Batches and leases are bounded, and stale workers cannot settle recovered work.
- In-flight jobs cannot be synchronously cancelled because external effects may already have started. Future cooperative cancellation requires a handler handshake; the current service cancels only pending/retry-scheduled work.
- Attempt evidence is mutable only while active for heartbeat and first settlement. Terminal attempts are immutable and retained.

### Open items

- Add a versioned topic/payload registry and handler ownership before registering production jobs.
- Add the graceful worker loop, scheduler trigger, metrics/alerts, retention, and recovery runbook.
- Add capability-protected, audited dead-letter inspection/replay/cancellation only after the break-glass operating model is approved.

### Next

- Implement the in-process worker runtime around the tested control service with an empty explicit topic registry and graceful shutdown behavior.

## 2026-08-19 — Durable job persistence foundation

**Status:** Done

### Updated

- Added generated Drizzle migration `0009_moaning_argent.sql` with PostgreSQL `background_jobs` and `background_job_attempts` relations.
- Enforced globally unique namespaced idempotency, availability/priority claim ordering, 1–100 retry budgets, paired processing leases, explicit retry/success/dead-letter/cancel states, and consistent terminal timestamps.
- Added per-job unique attempt numbers with worker/lease attribution and paired outcome/finish evidence.
- Added both relations to API startup readiness and every embedded-PostgreSQL migration fixture.
- Added migration tests for duplicate idempotency, processing without a lease, retry overflow, duplicate attempt numbers, and an outcome without a finish time; the DB suite now has 13 tests.
- Added the durable-job architecture document and updated developer, security, technology-stack, platform, scheduler, MVP-index, schema, and handoff documentation.

### Decisions

- PostgreSQL is the authoritative transactional acceptance layer for durable jobs/outbox work. A future external queue may accelerate delivery but cannot replace the database record committed with domain state.
- Idempotency keys are globally unique and must be namespaced by domain/command identity. Financial/provider handlers still require their own authoritative idempotency constraints.
- Job payloads are minimal non-sensitive context; secrets, tokens, cookies, credentials, and raw private documents are prohibited.

### Open items

- Implement bounded concurrent claim, heartbeat, lease recovery, settlement/backoff, dead-letter, and cancellation services.
- Approve worker topology, concurrency/capacity, retention, alerting, and audited operator replay/break-glass controls.
- Register production topics and runbooks only as their owning domain tasks become approved.

### Next

- Implement and integration-test the PostgreSQL job-control service against this schema without selecting an external queue provider.

## 2026-08-19 — API compatibility and retirement policy

**Status:** Done

### Updated

- Added a centralized current `/v1` policy and `SproutUp-API-Version: 1` on every versioned response, including errors and provider-adapter responses.
- Added standards-based generation for RFC 9745 `Deprecation` structured dates and RFC 8594 `Sunset` HTTP dates without emitting either header for current `v1`.
- Enforced valid positive major versions, a required deprecation date for deprecated versions, chronological dates, and a minimum 180-day sunset notice.
- Added five regression tests for current/unversioned headers, retirement formatting, invalid dates/order, and insufficient notice; the API suite now has 58 tests across 22 files.
- Added the API compatibility policy and updated developer, security, technology-stack, API-task, MVP-index, and handoff documentation.

### Decisions

- Major compatibility is URI-based. Backward-compatible additions stay under `/v1`; routine breaking changes require a parallel path such as `/v2`.
- Confirmed security corrections may narrow current-major behavior only with a documented risk decision, non-disclosing errors, release notes, and direct controlled-pilot client notice.
- `v1` is current and has no deprecation/sunset schedule. Retirement headers require an approved replacement, migration plan, affected-client list, and at least 180 days between deprecation and sunset.

### Open items

- Define private-file authorization contracts after object storage and malware-scanning decisions.
- Define signed webhook verification/replay contracts after external providers are approved.
- Future domain operations must be classified and tested against this compatibility policy as they are implemented.

### Next

- Continue with the next policy-independent MVP foundation slice; do not invent provider-specific file or webhook contracts while those selections remain open.

## 2026-08-19 — Complete current application-owned API contracts

**Status:** Done

### Updated

- Added an enforced authenticated session-context contract that exposes only server-resolved user identity, canonical roles, and canonical permissions.
- Added explicit public liveness/readiness contracts with service/dependency response schemas and no session-cookie requirement.
- Extended the operation helper to represent public actors and unauthenticated operations without weakening protected-route defaults.
- Replaced subset-only coverage with a global OpenAPI walk that fails CI when any application-owned operation lacks an ID, response schema, actor/capability/retry/side-effect metadata, or audit declaration.
- Added exact operation-ID assertions for session context and health while retaining the complete onboarding, session/access, and role-approval catalogue.
- Updated developer, security, technology-stack, authentication, API-contract, MVP-index, and handoff documentation.

### Decisions

- Public health operations carry the same operational metadata shape as protected operations, with `actor: "public"`, an empty capability set, and an empty OpenAPI security requirement.
- Session context requires a valid active account but no additional capability; its empty capability set is distinct from a public operation because cookie security and `actor: "authenticated_user"` remain declared.
- Better Auth's wildcard proxy is explicitly excluded from the application-owned operation assertion. Concrete auth payload contracts are controlled by the exact-pinned provider version; SproutUp will not publish a misleading catch-all schema.

### Open items

- Decide API version support/deprecation policy and compatibility reporting.
- Define signed webhook replay contracts and private-file authorization contracts after provider/storage decisions are approved.
- Apply the global operation assertion automatically to every future domain route as implementation expands.

### Next

- Establish and test the API version/deprecation compatibility policy that can be decided independently of the still-open provider integrations.

## 2026-08-19 — Role approval OpenAPI contracts

**Status:** Done

### Updated

- Added protected operation metadata and enforced request/response/error schemas to all ten role-assignment, role-revocation, approval-decision, and approval-history operations.
- Documented distinct `unique_pending_approval` and `locked_approval_decision` retry models matching the database unique index and transactional row locks already enforced by the services.
- Added allowlisted pending/history/detail schemas for role payloads, hashes, actors, lifecycle timestamps, integrity status, and immutable action timelines.
- Extended generated-contract CI coverage to enumerate each operation and require approval-ID path parameters, command bodies, security, metadata, and success/error responses.
- Updated developer, security, technology-stack, authentication, API-contract, MVP-index, and handoff documentation.

### Decisions

- Operational retry metadata describes the server invariant: duplicate pending proposals conflict, while repeated terminal decisions must refetch after a locked `409` rather than assume replayed execution.
- The success audit event names the primary command outcome. Expiry encountered during a decision remains a documented domain conflict with its own immutable audit event in the service transaction.
- History payloads remain observable even when malformed so `integrity: "invalid"` evidence can be investigated; command services still require the canonical role-change payload and matching SHA-256 hash before execution.

### Open items

- Add an explicit generated contract to the application-owned session-context endpoint.
- Define a defensible contract strategy for Better Auth's framework-owned `/v1/auth/*` endpoints without promising unsupported wildcard schemas.
- Decide API version/deprecation policy and provider-specific webhook/private-file contracts.

### Next

- Contract `GET /v1/session-context`, then make the contract test fail whenever any application-owned `/v1` operation lacks an operation ID, security declaration, SproutUp metadata, or schemas.

## 2026-08-19 — Session and access OpenAPI contracts

**Status:** Done

### Updated

- Added protected operation IDs, actor/capability boundaries, retry behavior, side effects, and audit-event metadata to own-session list/revocation and role/user catalogue routes.
- Added enforced JSON schemas for token-free session summaries, UUID revocation parameters, role permission projections, bounded user filters, paginated allowlisted user summaries, and structured errors.
- Extended generated-contract regression coverage to enumerate all four operations alongside onboarding and require security metadata, success/error responses, and path parameters.
- Updated developer, security, authentication, API-contract, and handoff documentation.

### Decisions

- `authenticated_user` represents protected operations shared by customer and staff identities; each operation still declares and enforces its exact capability.
- Session revocation is documented as an idempotent-delete retry model even though the first successful request returns `204` and later requests return `404` without repeating an audit write.
- OpenAPI response allowlists are a second boundary against accidental token or credential serialization; service projections and runtime authorization remain authoritative.

### Open items

- Contract role assignment, revocation, lifecycle, and history operations with their hash/locking retry behavior.
- Contract the session-context and relevant Better Auth boundary without falsely documenting framework-owned wildcard routes.
- Decide API version/deprecation policy and provider-specific webhook/private-file contracts.

### Next

- Migrate all role-approval operations to the protected operation helper and enforce their request, response, and error schemas.

## 2026-08-19 — Enforced onboarding OpenAPI schemas

**Status:** Done

### Updated

- Added reusable JSON schemas for onboarding UUID parameters, bounded queue filters, create/version/information-request bodies, case summaries/details, immutable events, pagination, and structured errors.
- Attached request, success, and applicable 400/401/403/404/409 response schemas to all eight onboarding operations.
- Enabled Fastify schema enforcement and added a stable generic `VALIDATION_ERROR` envelope that does not echo submitted values or internal validation details.
- Preserved Zod/domain checks for journey capability, ownership, state, assignment, and optimistic concurrency.
- Extended contract tests to require responses on every onboarding operation, request bodies on every command, and path parameters on every case-ID route.
- Updated developer, security, technology-stack, API-task, and handoff documentation.

### Decisions

- Fastify JSON schema handles transport shape; Zod/domain services remain authoritative for permission, ownership, workflow, and business invariants.
- Schema validation errors are deliberately generic to avoid reflecting sensitive input; stable domain errors remain specific enough for client recovery.
- JSON and Zod schemas must change together until a single-source schema adapter is reviewed for Zod 4/OpenAPI compatibility.

### Open items

- Add equivalent operation metadata and schemas to health, auth/session, role, approval, and access-catalogue routes.
- Decide API version/deprecation policy and generate typed client artifacts only after contract coverage is complete.
- Define webhook signature/replay and private-file contracts after providers are selected.

### Next

- Migrate session and role-administration operations to the same contract helper and extend the global coverage assertion.

## 2026-08-19 — Enforced onboarding operation metadata

**Status:** Done

### Updated

- Added a reusable Fastify/OpenAPI operation helper with typed SproutUp metadata for actor, permissions, permission mode, retry/idempotency model, side effects, and audit event.
- Annotated all eight customer/staff onboarding operations with unique operation IDs, summaries, onboarding tags, and Better Auth session-cookie security.
- Declared safe-read, database-unique-create, or optimistic-version retry behavior per operation and explicit `null` audit events for non-audited reads.
- Extended the generated-contract test to walk every onboarding operation and fail on missing/invalid security or SproutUp metadata.
- Updated developer, security, technology-stack, API-task, and handoff documentation.

### Decisions

- `x-sproutup` is the machine-readable extension for operational metadata not represented directly by core OpenAPI fields.
- Contract metadata does not replace runtime authorization; route/service permission and ownership checks remain authoritative and separately tested.
- An operation is not fully contracted until its request, success, and structured error schemas are present; this slice only completes operational metadata for onboarding.

### Open items

- Add request/response/error JSON schemas for onboarding operations and align them with shared Zod contracts.
- Annotate the earlier authentication, session, role, approval, and access-catalogue operations.
- Add a global CI assertion once every application operation is migrated to the helper.

### Next

- Add documented JSON schemas to the onboarding read and command operations without changing their existing stable runtime error bodies.

## 2026-08-19 — Generated OpenAPI route contract baseline

**Status:** Done

### Updated

- Added exact-pinned `@fastify/swagger` 9.8.1, compatible with the Fastify 5 runtime.
- Added generated OpenAPI 3.1 product metadata, route tags, and an HTTP-only Better Auth session-cookie security-scheme declaration.
- Exposed the generated machine-readable contract at `GET /openapi.json` while hiding that endpoint from its own path list.
- Added a full-composition contract test verifying every current application route group, OpenAPI version/product metadata, cookie scheme, and absence of obvious secret material.
- Integrated contract validation into the existing test/CI gate and updated the lockfile.
- Updated technology-stack, developer, security, API-task, MVP, and handoff documentation.

### Decisions

- OpenAPI generation is dynamic from the Fastify route tree; the contract test composes all optional services so route omissions fail CI.
- The contract endpoint is public metadata and must never include runtime values or secrets.
- This is route-coverage infrastructure, not completion of Task 18: full request/response and operational metadata must be added per operation.

### Open items

- Add operation IDs, input/output/error schemas, authentication/security requirements, actor/permission, idempotency, side effects, and audit event declarations for every route.
- Define API version support/deprecation policy and provider-specific webhook/private-file contracts.
- Decide whether interactive documentation is appropriate and how it would be protected; only JSON is served now.

### Next

- Add a reusable Fastify operation metadata contract and annotate the implemented onboarding endpoints first, failing CI when required metadata is absent.

## 2026-08-19 — Staff onboarding case detail

**Status:** Done

### Updated

- Added a capability-protected staff case-detail endpoint from the compliance queue.
- Returned applicant identity context, current case state/version/assignment/timestamps, and the ordered append-only event/reason timeline.
- Kept the response limited to implemented workflow fields; no unapproved KYC profile, document, suitability, or screening data is invented or exposed.
- Added embedded-PostgreSQL detail coverage across the full correction/resubmission timeline plus route-level not-found behavior.
- Updated developer, security, borrower, investor, admin-queue, and handoff documentation.

### Decisions

- Staff detail uses `onboarding_cases.read`; state-changing actions continue to require `onboarding_cases.review` separately.
- Event order is deterministic by occurrence time and opaque ID.
- Future sensitive sections must define field-level access/masking before joining this response.

### Open items

- Approve sensitive profile/evidence field access and masking by staff role.
- Define completeness/screening prerequisites and dual control for approve/reject decisions.
- Build the corresponding accessible staff detail screen.

### Next

- Stop before KYC decision execution until compliance policy is approved; continue with document/consent storage only after its type, retention, scanning, and provider decisions are resolved.

## 2026-08-19 — Onboarding information-request correction loop

**Status:** Done

### Updated

- Added a protected information-request command requiring the assigned reviewer, exact in-review case version, and a 10–1000 character reason.
- Denied applicant self-review, unassigned reviewer updates, stale versions, and invalid transitions without mutating case state.
- Committed `needs_information` state/version, immutable reasoned event, and correlated business audit evidence in one transaction.
- Reused the owner-bound submit command for applicant resubmission, retaining case identity/reviewer assignment and returning the workflow to `submitted` with a new version.
- Added integration coverage for the full created → submitted → review-started → information-requested → resubmitted timeline plus route-level unassigned-reviewer denial.
- Updated developer, security, borrower, investor, admin-queue, portal, and handoff documentation.

### Decisions

- Information requests are not decisions and do not require a second checker; they are restricted to the assigned compliance reviewer and fully reasoned/audited.
- Resubmission retains the assigned reviewer for continuity, but review must explicitly restart before a later decision.
- Completeness remains a future policy/service check; this slice does not pretend an empty workflow shell is release-eligible.

### Open items

- Approve profile/evidence completeness rules and required documents by borrower entity/investor type.
- Define decision dual-control, screening prerequisites, expiry, and role/eligibility effects.
- Add notifications after delivery providers/templates are approved.

### Next

- Implement staff case detail and then the decision proposal boundary, keeping approval execution blocked until KYC completeness and screening policy are approved.

## 2026-08-19 — Compliance queue and safe review claim

**Status:** Done

### Updated

- Added a protected, bounded compliance work queue for borrower/investor cases with case type, status, and assigned-to-me filters plus applicant name/email context.
- Kept queue read and review-start behind independent `onboarding_cases.read` and `onboarding_cases.review` capabilities.
- Added optimistic review start from submitted state, binding the authenticated reviewer and case version under a row lock.
- Denied applicant self-review and reviewer takeover with stable conflicts; stale and invalid state transitions remain non-mutating.
- Committed reviewer assignment, `in_review` state/version, append-only `review_started` event, and immutable business audit evidence in one transaction.
- Added route and embedded-PostgreSQL tests; updated developer, security, borrower, investor, admin-queue, MVP, and handoff documentation.

### Decisions

- A submitted case is claimed by the first authorized reviewer who successfully commits the expected version; assignment cannot be silently replaced.
- Queue count and list use the same validated filters and bounded page contract.
- This slice defines operational ownership only; SLA, priority, escalation, reassignment, and bulk-action policy remain open.

### Open items

- Approve reviewer reassignment/escalation and SLA policy.
- Add staff case detail, information-request/resubmission, and decision commands after evidence/completeness rules are approved.
- Build the accessible admin queue UI after its columns and operating policy are confirmed.

### Next

- Implement reasoned information request and applicant resubmission on the existing state/version boundary, without adding unapproved evidence rules.

## 2026-08-19 — Owner-bound onboarding case API

**Status:** Done

### Updated

- Added authenticated onboarding endpoints to create, list, inspect, and submit the current user's permitted borrower/investor case.
- Enforced separate journey capabilities so borrower access cannot open/read/submit investor cases and vice versa.
- Bound case ID, applicant user ID, and allowed case types in database reads/commands; another user's opaque case ID resolves as not found.
- Used the partial unique database index plus conflict-safe insert to prevent duplicate open cases under retry/concurrency.
- Added row locking and optimistic version matching on submission, returning stable stale-version/invalid-transition conflicts without overwriting current state.
- Committed create/submit current state, append-only case event, and immutable business audit evidence in one transaction.
- Added route and embedded-PostgreSQL service tests; updated developer, security, borrower, investor, API, portal, MVP, and handoff documentation.

### Decisions

- The case API remains policy-neutral and collects no regulated profile/evidence fields yet.
- Ownership is enforced in SQL in addition to route capability checks; inaccessible cases use not-found semantics.
- Case version is the concurrency token for every state-changing request; clients must reload after `STALE_CASE_VERSION`.

### Open items

- Approve and implement borrower/investor profile fields, evidence requirements, consent, and completeness validation before submission is release-ready.
- Implement the compliance queue, assignment, information request, and controlled decision commands.
- Add OpenAPI generation and portal UI/journey tests.

### Next

- Implement the staff compliance work queue and reviewer assignment/review-start transition without adding unapproved KYC decision rules.

## 2026-08-19 — Audited applicant role bootstrap

**Status:** Done

### Updated

- Extended Better Auth email signup with a required `registrationIntent` limited to `borrower` or `investor`.
- Added the matching nullable database enum for controlled non-public staff/bootstrap records.
- Added a PostgreSQL user-insert trigger that atomically maps borrower → `sme_borrower` or investor → `investor` and appends immutable `account.registered` audit evidence.
- Added separate borrower/investor own-case read/manage/submit capabilities plus compliance work-queue read/review capabilities; kept all other grants deny-by-default.
- Added embedded-PostgreSQL trigger tests and a real Better Auth signup integration test proving missing intent creates no identity and valid investor intent grants only the investor role.
- Updated security, developer, authentication, borrower, investor, portal, schema, MVP, and handoff documentation.

### Decisions

- Public signup may bootstrap exactly one customer persona role; it cannot accept any staff or `super_admin` role value.
- Customer persona identifies the selected journey, not KYC approval or financial eligibility. Later APIs must continue checking authoritative onboarding/eligibility state.
- Additional/dual borrower-investor capacity is not self-service in this slice and must use the approved role-change path until product policy is finalized.

### Open items

- Define controlled staff-account bootstrap and emergency access.
- Approve whether dual borrower/investor capacity may later be self-requested and which compliance review applies.
- Complete provider-backed email verification/recovery and MFA before pilot release.

### Next

- Implement authenticated own-case creation/read and controlled submission using the new customer capabilities, optimistic version checks, and atomic immutable event/audit writes.

## 2026-08-19 — Onboarding workflow and evidence foundation

**Status:** Done

### Updated

- Added shared borrower/investor onboarding case, status, event types, and an explicit allowed-transition map.
- Added versioned `onboarding_cases` with applicant/reviewer separation, queue indexes, and a partial unique index permitting only one open case per user and journey.
- Added append-only `onboarding_case_events` with positive case versions, explicit user/system attribution, from/to state, reason, and deterministic event indexes.
- Added generated schema migration and custom PostgreSQL triggers rejecting onboarding event update, delete, and truncate operations.
- Added shared state tests plus embedded-PostgreSQL tests for schema creation, duplicate-open-case denial, reviewer self-assignment denial, and event immutability.
- Updated security, developer, borrower, investor, portal, schema, MVP, and handoff documentation.

### Decisions

- The first onboarding slice is a workflow spine only. It intentionally does not encode unresolved Philippine entity types, document requirements, suitability scoring, screening providers/results, retention, or escalation rules.
- Rejected and expired cases may reopen to draft for correction/re-KYC without duplicating the login identity; withdrawn cases are terminal.
- A needs-information case must return through submission and review rather than jumping directly to approval.

### Open items

- Approve Philippine borrower entity types/requirements and investor individual/institutional pilot scope.
- Approve the document/evidence matrix, AML/sanctions provider, screening cadence, retention, suitability/limits, and escalation rules.
- Define onboarding permissions and first-role bootstrap behavior before exposing create/submit/review APIs.

### Next

- Implement the policy-neutral onboarding case service only after explicitly resolving who may open each journey and how a newly registered zero-role user obtains their initial applicant access.

## 2026-08-19 — Role approval history and integrity view

**Status:** Done

### Updated

- Added a protected, paginated role-approval history endpoint with bounded page size and validated command/status filters.
- Added a protected approval-detail endpoint returning current request state and the ordered append-only proposed/approved/executed/rejected/cancelled/expired action timeline.
- Recomputed the canonical role-change payload hash on every list/detail result and exposed an explicit `valid` or `invalid` integrity result.
- Restricted both endpoints to `roles.assign` because role-change reasons and review evidence are privileged operational data.
- Added route and embedded-PostgreSQL tests for permission denial, filter validation, history filtering, integrity verification, and ordered rejection evidence.
- Updated developer, security, authentication, maker/checker, MVP, and handoff documentation.

### Decisions

- An invalid stored payload/hash pair remains visible as a security exception; history reads do not conceal or rewrite it, and command execution already denies it.
- The history API includes only the currently implemented role-change command types. New domain approval types must opt in through their own reviewed access and payload contract.
- Offset pagination is acceptable for the controlled-pilot operator view; immutable action ordering uses occurrence time plus opaque ID as a deterministic tie-breaker.

### Open items

- Define alert routing for integrity failures and suspicious denied approval activity.
- Add amendment/supersession, delegated limits, and emergency override after policy approval.
- Apply the approval framework to onboarding and financial commands according to the final matrix.

### Next

- Begin the shared party and onboarding-state database foundation for borrower and investor journeys, keeping regulated KYC fields and provider decisions behind explicit open-policy gates.

## 2026-08-19 — Role approval rejection and cancellation

**Status:** Done

### Updated

- Added protected endpoints for reasoned rejection and cancellation of pending role grant/revocation requests.
- Enforced distinct maker/checker and non-target review on rejection; enforced original-maker ownership on cancellation.
- Locked each request and revalidated supported command type, pending state, expiry, payload shape, and SHA-256 hash before transition.
- Appended immutable `rejected`, `cancelled`, or `expired` action evidence and correlated business audit events in the same transaction as current-state updates.
- Added route and embedded-PostgreSQL tests for capability denial, maker/target rejection denial, independent rejection, non-maker cancellation denial, maker cancellation, and terminal state/action evidence.
- Updated developer, security, authentication, maker/checker, MVP, and handoff documentation.

### Decisions

- Rejection is an independent checker decision; the maker cannot reject their own request and the target cannot review their own role change.
- Cancellation is a maker withdrawal, not a checker decision, and therefore only the original maker may perform it.
- Lifecycle endpoints currently accept only `role.assign` and `role.revoke`; future domain approvals must opt in with their own capability and payload-validation policy.

### Open items

- Add an operator approval-history/detail view and amendment/supersession semantics.
- Define the broader domain approval matrix, alerting, delegated limits, and emergency override.
- Complete permission administration, account-status commands, recovery, verification, and MFA work.

### Next

- Add a protected approval history/detail API, then start the shared party/onboarding state foundation for borrower and investor journeys.

## 2026-08-19 — Dual-controlled role revocation

**Status:** Done

### Updated

- Added protected role-revocation list, proposal, and approval endpoints using the existing `roles.assign` capability and generic approval schema.
- Bound revocations to the canonical target/role payload hash, 24-hour expiry, duplicate-pending protection, request locking, and separate maker/checker identities.
- Revalidated and locked the target's current grants before deletion, preventing stale execution and removal of the final role from an active account.
- Committed the approved deletion, approved/executed action history, and immutable `role_revocation.executed` audit event in one transaction.
- Added route and embedded-PostgreSQL service tests for capability denial, stable last-role conflict, maker/checker separation, exact-role deletion, append-only action history, final-role protection, and restricted `super_admin` changes.
- Updated developer, security, authentication, maker/checker, MVP, and handoff documentation.

### Decisions

- Role grant and revocation both require dual control; there is no direct role-membership mutation endpoint.
- Active accounts must retain at least one role. Suspended/disabled account cleanup remains possible, but account-status policy is a separate command.
- All `super_admin` changes remain outside ordinary administration until the bootstrap and emergency-access process is approved.

### Open items

- Add proposal rejection/cancellation/amendment and operator history views.
- Define user suspension/restoration, role-permission mutation, bootstrap, and emergency-access policy.
- Complete provider-dependent verification, recovery, and MFA controls.

### Next

- Add reusable rejection/cancellation lifecycle operations to the approval boundary before applying it to onboarding and financial commands.

## 2026-08-19 — Protected access administration catalogue

**Status:** Done

### Updated

- Added `GET /v1/admin/roles` behind `roles.read`, returning role status and server-stored effective permission keys.
- Added `GET /v1/admin/users` behind `users.read`, with validated status/search filters, deterministic pagination, a maximum page size of 100, total counts, and assigned role keys.
- Defined an allowlisted user access summary that excludes credential-provider rows, password hashes, session identifiers, and tokens.
- Added route tests for independent capability enforcement and pagination validation plus embedded-PostgreSQL service tests for permission resolution, filtering, assigned roles, and secret-free output.
- Updated developer, security, authentication, API-contract, MVP, and handoff documentation.

### Decisions

- Read-only role and user administration uses separate capabilities; possession of one does not imply the other.
- Name/email search treats wildcard characters literally and requires at least two characters.
- Offset pagination is sufficient for the controlled-pilot access catalogue; high-volume domain queues will define cursor or snapshot semantics in their owning tasks.

### Open items

- Add OpenAPI generation and contract validation in CI.
- Define masking/export policy before user data is exposed outside this narrow access-administration response.
- Role revocation, user suspension, permission mutation, emergency access, and delivery-backed recovery/MFA remain open.

### Next

- Add dual-controlled role revocation on the established approval boundary, then begin the shared borrower/investor party and onboarding state foundation.

## 2026-08-19 — Dual-controlled role assignment

**Status:** Done

### Updated

- Added `approval_requests` and append-only `approval_actions`, generated migrations, a partial unique index preventing equivalent pending proposals, and database readiness coverage.
- Added protected endpoints to list pending role grants, propose an exact target/role assignment, and approve/execute it as a separate authorized checker.
- Bound approval to a canonical SHA-256 payload hash, a 24-hour expiry, request-row locking, active target/role revalidation, and atomic role grant plus evidence writes.
- Added stable denial responses for missing permission, self-targeting, maker/checker conflict, checker self-approval, duplicates, stale/expired requests, integrity mismatch, and restricted `super_admin` elevation.
- Added route, service, migration, immutability, and authorization tests; updated security, developer, schema, and MVP task documentation.

### Decisions

- Role assignment is the reference maker/checker command and cannot execute as a direct single-actor mutation.
- `super_admin` cannot be assigned through the ordinary role-grant workflow until bootstrap, emergency access, and independent-review policy is approved.
- Approval action history is immutable at the database layer; the mutable request record is only the current workflow state.

### Open items

- Add rejection/cancellation/amendment handling and the approved domain command/threshold matrix.
- Define a controlled bootstrap path, emergency access, and role revocation/permission-change workflows.
- Select delivery providers and complete recovery, verification, and MFA controls in task 02.

### Next

- Implement the read-only role/user administration catalogue and then the borrower-onboarding state model without weakening the deny-by-default or dual-control boundaries.

## 2026-08-19 — Audited own-session management

**Status:** Done

### Updated

- Added `GET /v1/sessions` and `DELETE /v1/sessions/:sessionId` behind the explicit `sessions.read_own` and `sessions.revoke_own` capabilities.
- Session responses expose opaque session IDs, timestamps, IP/user-agent context, and a current-session flag without returning bearer/session tokens.
- Session deletion binds both session ID and authenticated user ID, preventing cross-user revocation even when another opaque ID is known.
- Successful revocation and its `session.revoked` audit event execute in one database transaction with a UUID request correlation ID.
- Added route tests for token-free responses, capability denial, and revoke behavior plus embedded-PostgreSQL tests for ownership enforcement and atomic audit evidence.
- Updated security, developer, task, and MVP documentation.

### Decisions

- Session-management commands use opaque database IDs, never tokens in URLs or response bodies.
- Users may revoke their current session; the deleted database session invalidates subsequent requests even though the current delete request completes normally.
- Cross-user session administration remains a separate privileged capability and is not exposed until its administrative workflow and audit requirements are implemented.

### Open items

- Build the session/device management interface and decide which device attributes may be retained and displayed.
- Implement privileged session revocation only with a reviewed operator workflow.

### Next

- Continue task 02 with an audited, deny-by-default role catalogue and role-assignment proposal boundary; do not allow direct high-privilege assignment before maker/checker policy is approved.

## 2026-08-19 — Authentication, RBAC, and immutable audit foundation

**Status:** WIP

### Updated

- Added Better Auth email/password and session handling behind Fastify `/v1/auth/*`, plus `GET /v1/session-context` for server-resolved active-user roles and permissions.
- Added database-backed auth throttling, API rate limiting, secure production-cookie defaults, seven-day sessions, hashed verification identifiers, and strong password length bounds.
- Added shared canonical role/permission contracts and a deny-by-default authorization helper for the seven approved roles.
- Added Drizzle schemas for users, Better Auth accounts/sessions/verifications/rate limits, normalized RBAC, and append-only audit events.
- Generated migration `0000_yielding_zombie.sql` and explicit custom migration `0001_audit-immutability.sql`; added idempotent role/permission seeding and schema-readiness checks.
- Added embedded-PostgreSQL migration tests proving all ten relations are created, authorization seeding is idempotent, and audit update/delete/truncate operations are rejected by the database.
- Added auth proxy, session-context, configuration, policy, and audit-metadata tests; added `docs/SECURITY.md` and updated developer, schema, task, and project documentation.

### Decisions

- Better Auth remains behind an application service boundary and uses its default scrypt password hashing.
- Authorization is capability-based and deny-by-default. Only auth-domain capabilities are seeded now; later task owners must add and review their own capability grants.
- Authentication rate limits use PostgreSQL rather than process memory so limits remain effective across API replicas.
- An authenticated session is insufficient by itself: suspended/disabled accounts and identities without server-resolved access remain denied at the authorization boundary.
- Audit history is immutable at the database layer and intentionally does not foreign-key actor IDs, preventing later account changes from erasing attribution.

### Open items

- Select email/SMS providers and implement email verification, password-reset delivery, and the approved OTP/TOTP step-up policy.
- Implement audited role assignment/permission administration with maker/checker controls after the final matrix and emergency-access procedure are approved.
- Add session/device management UI and integration tests against the selected managed PostgreSQL runtime.
- Integrate audit writes into each privileged and financial workflow as those domain commands are implemented.

### Next

- Implement audited role-assignment and session-revocation commands that enforce the current auth capabilities, while keeping permission-matrix mutation behind the unresolved maker/checker design.

## 2026-08-19 — Initial SproutUp platform scaffold implemented

**Status:** WIP

### Updated

- Created the npm-workspaces application structure: `apps/web`, `apps/api`, `packages/db`, and `packages/shared`.
- Added the initial responsive SproutUp Next.js App Router page and shared product metadata test.
- Added a Fastify API with Helmet, explicit CORS policy, process liveness at `GET /health`, PostgreSQL readiness at `GET /v1/health`, startup database verification, and graceful shutdown.
- Added shared Zod health contracts, a PostgreSQL/Drizzle database service boundary, and Drizzle configuration ready for task-owned schemas and generated migrations.
- Added unit/API tests for shared contracts, liveness, successful readiness, and degraded database readiness.
- Added pinned runtime dependencies, Node/npm constraints, a committed lockfile, environment template, GitHub Actions CI, and root lint/typecheck/test/build commands.
- Added `docs/DEVELOPER.md`; updated the root README, technology-stack decision, platform/API tasks, and MVP 1 checklist.

### Decisions

- Kept MedicalHub's Next.js App Router architecture but upgraded the copied Next.js 14/React 18 versions to Next.js 16.3.1/React 19.2.8. The Next.js 14 baseline failed the production audit with multiple high-severity advisories; the selected release supports the pinned Node 20 line.
- Standardized all workspace validation on Zod 4.4.3 instead of reproducing MedicalHub's Zod 3/Zod 4 mismatch.
- API startup is fail-closed when PostgreSQL is unavailable. `/health` is process liveness; `/v1/health` is dependency readiness and returns `503` when PostgreSQL is unavailable.
- Domain tables will be introduced only through their approved MVP tasks and generated migrations; the foundation does not invent a premature database model.

### Open items

- Implement Better Auth, session resolution, RBAC, and immutable audit foundations under MVP 1 task 02.
- Define the first approved domain schema/migration and database integration-test environment.
- Select durable queue/outbox, hosting, PostgreSQL, object-storage, observability, and recovery providers.
- The current production audit is clean; four moderate findings remain in development-only Drizzle Kit/tsup esbuild tooling and require upstream/toolchain review.

### Next

- Implement the authentication/RBAC/audit vertical slice with server-resolved actor context and its first reviewed Drizzle migration, without beginning financial posting until money and ledger invariants are approved.

## 2026-08-19 — SproutUp project name confirmed

**Status:** Done

### Updated

- Renamed current project-facing documentation from "SeedIn Revamp" to **SproutUp**.
- Added the canonical GitHub repository link: <https://github.com/kimtoledo/SproutUp>.
- Retained SeedIn and `seedin-revamp` wording only where it identifies the legacy platform, migration context, or current local directory.

### Decisions

- **SproutUp** is the official project and product name.
- `https://github.com/kimtoledo/SproutUp` is the canonical GitHub repository; the configured local `origin` already matches it.

### Open items

- Package scopes, application metadata, environment names, and UI branding must use SproutUp when implementation scaffolding begins.

### Next

- Apply the SproutUp name consistently to package manifests, application metadata, deployment configuration, and user-facing branding during platform scaffolding.

## 2026-08-19 — MedicalHub technology baseline adopted

**Status:** WIP

### Updated

- Reviewed MedicalHub's actual monorepo manifests, TypeScript configuration, web/API/database/shared-package layout, developer guidance, agent rules, API composition root, database readiness, and migration workflow.
- Added `docs/TECH_STACK.md` as the authoritative SeedIn engineering baseline and documented which MedicalHub conventions are adopted, adapted, or intentionally provider-neutral.
- Added root `AGENTS.md` with architecture, financial/security invariants, migration workflow, testing expectations, and the requirement to update relevant Markdown documentation with every material change.
- Expanded the root README, this task index, and `mvp1/01-platform-foundation.md` to link the approved stack and add the required financial-platform foundations.

### Decisions

- SeedIn Revamp will use MedicalHub's implemented npm-workspaces TypeScript architecture: Next.js 14/React 18 web, Fastify 5 API, PostgreSQL/Drizzle, Better Auth behind a service boundary, shared Zod contracts, and Vitest-based checks.
- npm—not pnpm—is authoritative because that is what MedicalHub's checked-in root manifest, lockfile, and current developer workflow actually use.
- Replit Object Storage and other MedicalHub provider choices are not inherited. Storage, queues, hosting, observability, and external financial/compliance services stay behind adapters pending provider approval.
- SeedIn must add exact decimal money, append-only ledgers, idempotency/concurrency protection, transactional outbox and durable jobs, maker/checker controls, and reconciliation; MedicalHub's application stack alone is insufficient for regulated financial flows.
- Documentation updates are part of the definition of done for every material project change.

### Open items

- Choose and approve hosting, managed PostgreSQL, queue/cache, private object storage, observability, backup/recovery, and vendor providers.
- Pin exact dependency versions during scaffolding and resolve MedicalHub's Zod 3/Zod 4 workspace mismatch rather than copying it.
- Confirm whether one Next.js deployment remains sufficient or whether admin and customer surfaces require separate deployments later.

### Next

- Scaffold the four-workspace repository only after the remaining infrastructure and security requirements needed for the target environment are approved; then add CI and a minimal authenticated, database-backed vertical slice.

## 2026-08-19 — Cross-agent quality review and gap fixes

**Status:** WIP

### Updated

- Reviewed the full task tree (`README.md`, `LOGS.md`, `mvp1/`, `mvp2/`, `mvp3/`, `reference/legacy/`, `schema/`) for link integrity, orphaned files, count accuracy, task-quality (outcome/scope/acceptance-criteria/dependencies/legacy-reference completeness), and factual accuracy of the legacy source-review documents against the actual `seedin-live-admin`, `seedin-live-api-v1-1`, and `seedin-live-user` repositories.
- Independently spot-checked numeric claims in `reference/legacy/admin/README.md`, `reference/legacy/api-v1-1/README.md`, and `reference/legacy/user/README.md` (controller counts, view counts, role enums, cron inventories, specific business-logic citations) — all verified accurate against source, no fabrication found.
- Fixed `schema/01-legacy-schema-catalog.md`: corrected `introducer_members` from a listed base table to its actual status as a VIEW (created by `m180323_024943_referral_v2.php` via `UNION ALL` over `user_referrals`/`users`, deduplicated by `(user_id, email_address)`).
- Fixed `schema/03-financial-ledger-money-flow.md`: added a "Commission and referral money flow" section (previously entirely missing) covering how platform commission originates from the repayment split, how referral share is carved from commission only — never investor principal/returns — with the ₱100,000/₱1,000/₱100/₱900 worked example from `mvp2/03-one-level-referral.md`, concrete legacy citations (`CommissionLib`, `commisson_payments`, `commission_txn_master`, `commission_rate`, `commission_details`, `IntroducerLib`), and an explicit note that the legacy multi-level introducer hierarchy is historical-only.
- Fixed `schema/05-schema-gaps-verification.md`: added gaps for verifying the platform-commission-revenue account/table in production, and deciding whether `introducer_members` stays a view or is materialized in the revamp schema.
- Added missing "Legacy reference" sections to `mvp1/04-investor-onboarding-kyc.md`, `mvp1/05-document-consent-management.md`, and `mvp1/10-disbursement-controls.md` (the last citing concrete `LoanLib.php`/`LoanBorrowListing.php`/`UserFund.php` disbursement gross/net and ledger-posting logic).
- Added missing "Dependencies" sections across `mvp1/03, 05, 06, 07, 09, 11, 12, 13, 14, 15, 16, 19`, including linking `07`, `10`, `11`, `12` to `22-maker-checker-approval-matrix.md` since all four assume an approval framework that task 22 formally defines.

### Decisions

- The `mvp1`/`mvp2`/`mvp3` + `reference/legacy` + `schema` structure produced by prior sessions is accepted as the working baseline; a separate, earlier flat-file workflow run (10 domain docs + planned overview/roadmap at the top level of `tasks/`) was intentionally abandoned in favor of this richer structure rather than merged in, to avoid duplicate/conflicting content.

### Open items

- LOGS.md's 2026-08-18 "27 numbered implementation task files: 16 in MVP1, 8 in MVP2, and 3 in MVP3" entry is stale (current counts are 23/8/6 = 37) — left as-is per the no-rewrite rule; this entry is the correction.
- `mvp2/05-dashboards-business-intelligence.md` still has no defined KPI catalogue — largest unscoped item in MVP2, acceptable at WIP stage but worth flagging before implementation.
- Newly-assigned MVP1 dependency chains (03, 06, 09, 11, 13–16, 19) were inferred from task scope/acceptance-criteria, not confirmed by a product owner — treat as a draft ordering pending review.

### Next

- Have Product/Compliance/Finance/Engineering review the newly added commission money-flow section and the expanded MVP1 dependency graph before using either to sequence implementation work.

## 2026-08-19 — Direct legacy admin and user deep review

**Status:** WIP

### Updated

- Directly reviewed `seedin-live-admin`: 51 page controllers, 42 server/data controllers, 18 report controllers, 350 views, 17 forms, primary navigation, operational mutations, 12 legacy role IDs, route/database permissions, reports, exports, logs, and maintenance tools.
- Directly reviewed `seedin-live-user`: 27 page controllers, 18 browser-facing proxy controllers, 298 views, authentication/session boundary, staged onboarding, investor and issuer journeys, wallet activity, notifications, auto-invest, referrals, points, vouchers, and provider-specific flows.
- Added six admin review documents under `tasks/reference/legacy/admin/` and six user review documents under `tasks/reference/legacy/user/`.
- Added a cross-application user/API/admin workflow and cutover-boundary map.
- Added MVP 1 tasks 20–23 for admin work queues, borrower/investor portal journeys, maker/checker controls, and cross-app compatibility/cutover.
- Linked the new source reviews from the main, reference, legacy, and MVP indexes; expanded the RBAC and admin-report tasks with verified legacy findings.

### Decisions

- The revamp will use one authoritative API/domain boundary; neither frontend should own independent business formulas or write domain tables directly.
- Admin IA should be based on operational queues and exceptions rather than a screen-for-screen copy of the legacy module menu.
- The pilot needs coherent end-user journeys and explicit maker/checker controls, so both are MVP 1 work rather than unspecified frontend polish.
- Auto-invest and one-level referrals remain MVP 2. Points, vouchers, elite/reserve programs, multi-level referrals, legacy provider consoles, and broad marketing tooling remain optional or retirement candidates.

### Open items

- Confirm the deployed commit and runtime usage of each legacy application; the admin and API repository snapshots have drifted.
- Investigate the admin commission-list path that inserts into `dump_table`, and reconcile repayment statement amount differences between repository snapshots.
- Obtain the actual role-permission rows and map them to named staff/operators and current operating procedures.
- Validate introducer object-level access, broad public user routes, tokenized contract/file URLs, and direct-model paths against deployed behavior.
- Confirm report owners/usage and reconcile sample legacy exports to bank and ledger evidence.
- Finalize Philippine onboarding fields, investor classification, maker/checker matrix, queue SLAs, and phased cutover strategy.

### Next

- Produce the endpoint/command contract matrix for the MVP 1 cross-app flows, then validate it with runtime schema, permissions, scheduler, and reconciled financial samples.

## 2026-08-18 — Direct `seedin-live-api-v1-1` review and schema baseline

**Status:** WIP

### Updated

- Directly reviewed the API repository structure, Yii services routing/security, 32 service controllers, backend/admin modules and reports, 146 common models, shared libraries, roles/permissions, cron/console commands, integrations, migrations, and tests.
- Added eight repository-review documents under `tasks/reference/legacy/api-v1-1/` covering architecture, endpoints, modules/features/roles, crons, integrations/storage, data/tests, risks, and feature disposition.
- Added five schema documents under `tasks/schema/` covering the legacy catalog, relationships, financial flow, proposed revamp schema, and database verification plan.
- Added MVP 1 tasks 17–19 for legacy schema/data mapping, API contracts/security boundaries, and scheduler/queue/job controls.
- Added optional MVP 3 assessments for promotions/rewards, content/app communications, and partner channels.

### Decisions

- The first release still requires an end-to-end controlled pilot; API contracts, job controls, and a verified schema baseline are part of that MVP, not cleanup to postpone.
- Legacy promotions, vouchers, points, content tooling, and partner-specific channels are not assumed launch scope.
- Static source inspection cannot establish production feature usage or exact schema/scheduler state.

### Open items

- Obtain a sanitized schema-only export and production object inventory; the repository has no complete baseline DDL.
- Obtain the actual production scheduler/crontab and job monitoring history.
- Verify reachable public/unsecured routes, credential exposure, private-file authorization, and provider webhook security.
- Confirm which provider accounts, partner channels, marketing/reward features, reports, and archived jobs remain active.
- Review and rotate credential-shaped values/version history through the authorized security process.

### Next

- Complete endpoint-by-endpoint request/response and authorization extraction for MVP 1 operations, then validate database and scheduler findings against runtime evidence.

## 2026-08-18 — Legacy discovery provenance clarified

**Status:** WIP

### Updated

- Recorded that the original 11 legacy domain documents came from a Claude Code scan of `seedin-live-admin`, `seedin-live-user`, and `seedin-live-api-v1-1`.
- Updated the main and reference READMEs with verification guidance for automated scan findings.
- Added unverified automated observations as the lowest level in the requirement-authority order.

### Decisions

- The Claude-generated documents are the initial functionality/module/feature inventory and a useful navigation map for the legacy system.
- Automated scan findings are not assumed to prove that code is active, correct, complete, used in production, or required by the revamp.
- Financial, security, compliance, scheduler, and integration findings require direct source/caller verification before implementation.

### Open items

- Production usage, runtime configuration, database contents, and operational procedures have not yet been comprehensively reconciled against the static-code inventory.

### Next

- During task refinement, attach verified legacy source paths and mark each relevant behavior as active, inactive, broken, unknown, or intentionally retired.

## 2026-08-18 — MVP plan converted into implementation tasks

**Status:** WIP

### Updated

- Reframed MVP 1 as a complete controlled pilot instead of a foundation-only phase.
- Created 27 numbered implementation task files: 16 in MVP 1, 8 in MVP 2, and 3 in MVP 3.
- Added `00-overview.md` to every MVP with scope, deferrals, entry/release gates, and pilot constraints.
- Each implementation task now identifies its outcome, scope, acceptance criteria, dependencies or legacy reference, and unresolved decisions.
- Moved the 11 original domain analyses to `tasks/reference/legacy/` and added reference indexes so legacy behavior is clearly separated from approved revamp delivery scope.
- Updated the general README module map, MVP summary, delivery order, and reference links.

### Decisions

- **Recommended MVP 1:** Controlled end-to-end Philippine/PHP pilot covering onboarding, KYC, underwriting, campaign funding, manual bank transfers, immutable wallet ledger, disbursement, repayment, investor distribution, baseline tax/accounting, operations reporting, and pilot reconciliation.
- **Recommended MVP 2:** Automation and growth covering one payment gateway, auto-invest, one-level referrals, collections automation, BI, accounting/tax automation, self-service, and operational hardening.
- **Recommended MVP 3:** Uncommitted advanced capabilities covering external accounting data, secondary-market trading, and advanced risk analytics; each requires a separate business case and approval.
- Manual cash-in/payout operations are acceptable for MVP 1 because ledger correctness, dual control, and end-to-end reconciliation are more important than channel automation during a limited pilot.
- The one-level referral program belongs in MVP 2 so rewards are built on a proven platform-commission and ledger model.

### Open items

- Product, Compliance, Finance, and Engineering must review and approve the proposed MVP boundaries.
- Philippine KYC/AML, lending/crowdfunding, tax, accounting, document, disclosure, and reporting details remain subject to professional confirmation.
- The pilot migration approach—clean start versus active legacy balances/positions—must be decided early.
- Owners, estimates, delivery dates, final API/data architecture, and test cases are not yet assigned.

### Next

- Review `mvp1/00-overview.md`, approve the pilot constraints, and resolve the open decisions in tasks 01–05 before implementation begins.

## 2026-08-18 — Philippine crowdfunding platform direction recorded

**Status:** WIP

### Updated

- Added the workspace background and canonical target-platform overview to `tasks/README.md`.
- Documented the legacy roles of `seedin-live-admin`, `seedin-live-user`, and `seedin-live-api-v1-1`; identified `seedin-revamp` as the planning and future implementation workspace.
- Added target roles, end-to-end workflow, repayment models, business-model example, one-level referral rules, Philippine tax direction, recommended modules, and requirement-authority guidance for AI.
- Added revamp-direction warnings to the KYC, loan, repayment/payout, accounting-integration, and referral task documents where legacy behavior can conflict with the new product.
- Updated MVP 3 to describe one-level referrals and mark secondary-market trading as unconfirmed optional scope.

### Decisions

- The revamp targets a Philippine debt-crowdfunding platform for SMEs and investors, using PHP as the default product currency.
- The approved repayment shapes are amortized and interest-only with principal due at maturity.
- Referrals are one level only, persist while active/compliant, and are funded only from platform commission—not investor principal or returns.
- Rates, fees, taxes, thresholds, rounding rules, and effective dates must be configurable and auditable.
- Legacy code is discovery and migration evidence, not the automatic revamp specification.

### Open items

- Philippine legal, regulatory, compliance, accounting, and tax owners must confirm exact tax applicability, rates, bases, timing, rounding, filings, and reports.
- Accounting & Tax still needs a dedicated specification beyond the existing Xero/QuickBooks integration document.
- Reports & Dashboard still needs a consolidated cross-domain specification.
- Secondary-market trading is present in legacy discovery but is not included in the supplied target overview; product scope must be confirmed.
- The legacy documents still contain Singapore-specific and multi-level-program details for historical context; their revamp-direction notes take precedence until the bodies are rewritten into implementation tasks.

### Next

- Create implementation-ready MVP 1 task breakdowns aligned with the Philippine roles and KYC/compliance requirements, then define the missing Accounting & Tax and Reports & Dashboard specifications.

## 2026-08-18 — Numbered task files and AI handoff log

**Status:** WIP

### Updated

- Renamed all 11 domain documents with two-digit ordering prefixes, following the task-folder format used as the reference.
- Updated each MVP README to link to the renamed task files.
- Added this persistent log and linked it from the general task README for future AI sessions.

### Decisions

- `README.md` remains the overview and checklist inside each MVP folder.
- Task documents use `01-`, `02-`, and later prefixes to keep their intended order visible in file explorers.
- `LOGS.md` is the chronological handoff record; domain documents remain the source of detailed requirements.

### Open items

- All three MVPs remain WIP.
- Business validation is still required for conflicting, missing, or hardcoded rules documented inside the domain files.

### Next

- Convert the first approved MVP 1 domain into smaller implementation-ready tasks with owners, dependencies, and acceptance criteria.

## 2026-08-18 — Initial MVP consolidation

**Status:** WIP

### Updated

- Consolidated the 11 existing domain discovery documents into `mvp1`, `mvp2`, and `mvp3` folders.
- Added a general task README and one checklist README per MVP.
- Added focus statements and exit criteria for each MVP.

### Decisions

- MVP 1 covers platform foundation and compliant onboarding.
- MVP 2 covers the core lending and money-movement lifecycle.
- MVP 3 covers growth, external integrations, and secondary-market extensions.

### Open items

- The grouping is a planning baseline and has not yet been confirmed as a committed release plan.

### Next

- Validate MVP boundaries and prioritize the MVP 1 checklist.
