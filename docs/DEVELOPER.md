# SproutUp Developer Guide

## Prerequisites

- Node.js 20.19.4 (see `.nvmrc`)
- npm 10+
- PostgreSQL reachable through `DATABASE_URL`

Use the same Node major version locally and in CI. Runtime dependencies are pinned exactly and `package-lock.json` is committed for repeatable installation.

The repository temporarily enables npm's `legacy-peer-deps` resolver because npm 10/11 currently crashes while building the Better Auth/Vitest optional-peer tree. This does not relax application validation: direct dependencies are pinned, the clean lockfile is authoritative, and CI still runs type, test, build, and production-audit gates. Remove the setting after an npm resolver update is verified with a clean install.

## Install

```bash
nvm use
npm install
cp .env.example .env
```

Never commit `.env` or place credentials in Markdown, source files, logs, or test fixtures.

Generate a local `BETTER_AUTH_SECRET` with `openssl rand -base64 48`. Do not reuse local secrets in shared environments.

## Run locally

Start the web application:

```bash
npm run dev:web
```

The web application is available at `http://localhost:3000`.

In another terminal, start the API:

```bash
npm run dev:api
```

The API starts at `http://localhost:3001` only after it can connect to PostgreSQL.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process liveness; does not query dependencies |
| `GET /v1/health` | Readiness; returns `503` when PostgreSQL or required schema relations are unavailable |
| `GET /openapi.json` | Generated OpenAPI 3.1 contract; hidden from its own path list |
| `/v1/auth/*` | Better Auth email/password and session endpoints |
| `GET /v1/session-context` | Server-resolved current user, roles, and permissions; returns `401` without an active authorized account |
| `GET /v1/sessions` | List the authenticated user's sessions without exposing tokens |
| `DELETE /v1/sessions/:sessionId` | Revoke an owned session and append immutable audit evidence |
| `GET /v1/admin/role-assignments` | List unexpired pending role-assignment proposals; requires `roles.assign` |
| `POST /v1/admin/role-assignments` | Propose a target/role grant with a 10–500 character reason; requires `roles.assign` |
| `POST /v1/admin/role-assignments/:approvalId/approve` | Approve and execute a proposal as a different authorized actor |
| `GET /v1/admin/role-revocations` | List unexpired pending role-revocation proposals; requires `roles.assign` |
| `POST /v1/admin/role-revocations` | Propose removal of an existing target/role grant; requires `roles.assign` |
| `POST /v1/admin/role-revocations/:approvalId/approve` | Approve and execute a revocation as a different authorized actor |
| `POST /v1/admin/role-approvals/:approvalId/reject` | Reject a pending role change as a different authorized reviewer |
| `POST /v1/admin/role-approvals/:approvalId/cancel` | Cancel a pending role change as its original maker |
| `GET /v1/admin/role-approvals` | List paginated role approval history by command/status; requires `roles.assign` |
| `GET /v1/admin/role-approvals/:approvalId` | Read a role approval and its immutable action timeline |
| `GET /v1/admin/roles` | List role status and effective permission keys; requires `roles.read` |
| `GET /v1/admin/users` | List bounded user access summaries; requires `users.read` |
| `GET /v1/onboarding/cases` | List only the authenticated user's permitted borrower/investor cases |
| `GET /v1/onboarding/cases/:caseId` | Read an owned case and its immutable state timeline |
| `POST /v1/onboarding/cases` | Open one permitted borrower/investor draft journey |
| `POST /v1/onboarding/cases/:caseId/submit` | Submit an owned draft/information response using its exact current version |
| `GET /v1/admin/onboarding/cases` | List the bounded compliance queue; requires `onboarding_cases.read` |
| `GET /v1/admin/onboarding/cases/:caseId` | Read applicant context and the complete immutable case timeline |
| `POST /v1/admin/onboarding/cases/:caseId/start-review` | Claim a submitted case and begin review; requires `onboarding_cases.review` |
| `POST /v1/admin/onboarding/cases/:caseId/request-information` | Return an assigned in-review case for applicant correction with a reason |

All `/v1` responses carry `SproutUp-API-Version: 1`, including error and Better Auth adapter responses. The current version is not deprecated. Read [API_COMPATIBILITY.md](./API_COMPATIBILITY.md) before changing a request, response, validation rule, enum, retry model, or route path.

Role-change proposals expire after 24 hours. The API rejects duplicate pending payloads, self-targeting, maker self-approval, checker self-approval/rejection, stale/non-pending requests, and hash mismatches. A different authorized reviewer may reject with a reason; only the original maker may cancel. `super_admin` changes are intentionally unavailable until the bootstrap/emergency-access policy is approved. Revocation cannot leave an active user without a role.

Role approval history defaults to 25 records per page (maximum 100) and may be filtered by `commandType` (`role.assign` or `role.revoke`) and lifecycle `status`. Detail responses include the append-only action timeline. Both list and detail recompute the canonical payload hash and return `integrity: "valid"` or `"invalid"`; invalid evidence must be treated as a security exception, never silently repaired.

The user catalogue defaults to page 1 with 25 records and accepts `page`, `pageSize` (maximum 100), `query` (literal name/email search), and `status`. Its response is intentionally limited to identity, verification/status, role keys, and creation time; it never returns password hashes, account-provider records, session identifiers, or tokens.

Email signup requires one additional field:

```json
{
  "name": "Pilot Applicant",
  "email": "applicant@example.com",
  "password": "use-a-password-manager-generated-value",
  "registrationIntent": "borrower"
}
```

`registrationIntent` accepts only `borrower` or `investor`. It atomically bootstraps the matching customer role and registration audit evidence; callers cannot request staff or `super_admin`. Staff/bootstrap administration remains an out-of-band controlled operation until its policy is approved.

## Validate a change

```bash
npm run check
```

This runs workspace linting, strict type checks, tests, and production builds. CI runs the same command and audits production dependencies.

The API contract test composes every current service boundary and verifies that all implemented route groups appear in `/openapi.json`, OpenAPI 3.1 metadata and the session-cookie scheme are present, and obvious secret material is absent. It walks every application-owned operation and fails on missing IDs, response schemas, or `x-sproutup` trust/permission/retry/side-effect/audit metadata. When adding a route, add its exact operation ID assertion to `apps/api/test/openapi.test.ts` when stable client naming matters.

Use `apps/api/src/openapi/operation.ts` for public and protected operation metadata. Public health operations declare `actor: "public"`, no cookie security, and no capabilities; session-context and other protected operations declare cookie security and their exact authenticated actor/capability boundary. Every application-owned operation has unique IDs plus `x-sproutup` permission mode, retry model, side effects, and audit event (`null` for safe reads). Do not claim an operation is fully specified until request, success, and error JSON schemas are also present.

Reusable onboarding JSON schemas live in `apps/api/src/openapi/onboarding-schemas.ts`; token-free session and allowlisted access-catalogue schemas live in `apps/api/src/openapi/access-schemas.ts`; hash-bound role-change and immutable approval-history schemas live in `apps/api/src/openapi/role-approval-schemas.ts`. They document and validate UUID path parameters, bounded filters, command bodies, response projections, pagination, and structured 4xx errors. Keep these schemas and the handler Zod/domain rules aligned in the same commit. Fastify schema failures use the stable `400 VALIDATION_ERROR` envelope; domain errors remain route/service-owned.

The `/v1/auth/*` route is a transparent, rate-limited Better Auth proxy and is intentionally excluded from the application-owned operation assertion. Its endpoint-specific contracts belong to the pinned Better Auth version; SproutUp must not publish a fabricated wildcard request/response schema. Application-owned session and authorization projections remain fully contracted around that adapter.

API retirement signaling is centralized in `apps/api/src/openapi/api-version.ts`. Keep the current policy free of deprecation dates until a replacement and migration plan are approved. A deprecated version uses RFC 9745's structured timestamp, RFC 8594's HTTP-date sunset, and a code-enforced minimum 180-day notice period.

Role-change proposal operations use `unique_pending_approval`: the database admits at most one pending command-type/payload-hash pair, so a duplicate retry returns a stable conflict. Approval, rejection, and cancellation use `locked_approval_decision`: the service locks and revalidates the request, payload hash, actor separation, expiry, and terminal state before committing effects and evidence. Clients must refetch after a `409`; they must not assume a repeated decision executed twice.

## Database workflow

Schemas belong in `packages/db/src/schema/`. Every schema change must be tied to an approved task.

```bash
npm run db:generate
# Review the generated SQL under packages/db/migrations/.
npm run db:migrate
npm run db:check
```

`db:migrate` applies committed migrations and idempotently seeds the approved role/permission baseline. `db:check` verifies connectivity and every relation currently required by API startup, including approval workflow and durable-job relations.

Migration `0009_moaning_argent.sql` creates the provider-neutral `background_jobs` and `background_job_attempts` foundation; `0010_job-attempt-evidence.sql` protects completed attempt evidence and blocks delete/truncate. Read [JOBS.md](./JOBS.md) before adding a topic or worker. Transaction-aware enqueue, lease/retry/recovery controls, and the bounded graceful worker runtime are integration-tested. `createApplicationJobTopicRegistry()` intentionally registers no production topics, so no worker is active in the API server.

The onboarding schema currently provides only `onboarding_cases` and append-only `onboarding_case_events`. Its shared state machine lives in `packages/shared/src/onboarding.ts`. Do not add entity types, KYC requirements, provider result payloads, suitability scoring, document categories, or retention behavior until the corresponding open decision in tasks 03–05 is approved.

Onboarding create/read/submit routes use distinct borrower/investor own-case capabilities. Submission bodies contain `{ "version": <positive integer> }`; a stale version returns `409 STALE_CASE_VERSION`. Case creation returns `409 OPEN_CASE_EXISTS` when the database already contains an open case for that user/journey. API retries therefore cannot create duplicate open workflows or silently overwrite newer state.

The compliance queue defaults to page 1 with 25 cases and accepts `page`, `pageSize` (maximum 100), `caseType`, `status`, and `assignedToMe=true|false`. Starting review requires the submitted case version. It atomically assigns the authenticated reviewer and moves the case to `in_review`; applicant self-review and takeover from another assigned reviewer return stable conflicts.

Information requests require `{ "version": <positive integer>, "reason": "10–1000 characters" }` from the assigned reviewer. The case moves to `needs_information`; the applicant corrects future profile/evidence records and calls the existing submit endpoint with the new version. Resubmission returns the same case to `submitted` and retains the reviewer assignment/history.

Commit schema and generated migration files together. Custom SQL, such as append-only audit triggers, belongs in an explicitly generated custom migration. Never edit a migration already applied to a shared environment, use schema push against shared environments, or run manual DDL as a substitute for a migration.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js public and authenticated user interfaces |
| `apps/api` | Fastify API, HTTP security, and application composition |
| `packages/db` | PostgreSQL client, Drizzle schema, and migrations |
| `packages/shared` | Cross-workspace Zod contracts and types |
| `docs` | Technical and operational documentation |
| `tasks` | Approved scope, decisions, and append-only handoff history |

Update the relevant Markdown documentation and `tasks/LOGS.md` in the same commit as every material implementation change.
