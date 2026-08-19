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
