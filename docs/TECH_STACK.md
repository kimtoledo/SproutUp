# SproutUp Technology Stack

**Status:** Approved baseline for scaffolding

**Source reviewed:** local `MedicalHub` repository on 2026-08-19

**Decision:** Reuse MedicalHub's implemented architecture and engineering conventions, adapted to SproutUp's financial, compliance, and operational requirements.

## Adopted stack

| Layer | SproutUp baseline | MedicalHub evidence | SproutUp adaptation |
| --- | --- | --- | --- |
| Runtime | Node.js 20+ | Node.js 20+ developer prerequisite | Pin the exact Node/npm versions when scaffolding and use them in local, CI, and deployment environments. |
| Repository | npm workspaces with `apps/*` and `packages/*` | Root `package.json` and lockfile use npm workspaces | npm is authoritative. Do not copy MedicalHub's stale pnpm wording. Commit `package-lock.json`. |
| Frontend | Next.js 16 App Router, React 19, strict TypeScript | MedicalHub's `apps/web` architecture, upgraded from its vulnerable Next.js 14 dependency line | One web application may use route groups/layouts for public, borrower, investor, and admin surfaces; all privileged rules stay in the API. |
| Styling/UI | Tailwind CSS 3, PostCSS, Autoprefixer, Lucide icons | `apps/web` and root dependencies | Establish SproutUp-specific tokens and accessible reusable components before feature UI; do not copy Dentra branding. |
| API | Fastify 5, TypeScript, Zod, `@fastify/swagger` OpenAPI 3.1, Pino-compatible structured logging | `apps/api` | Version routes under `/v1`; keep route handlers thin, generate a CI-validated contract, and organize lending logic into domain services. |
| API security | Fastify Helmet, CORS, cookie, multipart, and rate-limit plugins | `apps/api` | Apply explicit origin, upload, rate-limit, and secure-cookie policy per environment. Public onboarding and callbacks need endpoint-specific abuse controls. |
| Authentication | Better Auth with Drizzle adapter behind an auth-service boundary | `apps/api/src/auth` | Roles, permissions, KYC state, account ownership, and active operating context are resolved server-side. Keep the boundary replaceable. |
| Database | PostgreSQL with Drizzle ORM and generated Drizzle Kit migrations | `packages/db` | Use `numeric` plus a decimal-money abstraction for PHP amounts. Add append-only ledger, approval, audit, and idempotency constraints. |
| Shared contracts | Workspace package for Zod schemas, enums, identifiers, and permission constants | `packages/shared` | Publish request/response schemas and financial/state enums from one package. Use one aligned Zod major version across workspaces. |
| Build/dev | `tsx` for API development, `tsup` for API builds, Next.js build tooling | root and app scripts | Root scripts orchestrate all workspaces and fail if a required workspace check is absent or fails. |
| Testing | Vitest, strict TypeScript checks, production builds, responsive browser QA | web/API packages and MedicalHub docs | Add integration tests against PostgreSQL, authorization matrices, ledger invariants, idempotency/concurrency tests, migration tests, and end-to-end critical journeys. |
| Files | Private object storage through an adapter with short-lived access | Replit Object Storage in MedicalHub | Do not adopt Replit Object Storage as a fixed provider. Select the provider during infrastructure approval; store metadata and access policy in PostgreSQL. |
| External services | Interfaces/adapters constructed at the application boundary | MedicalHub integration/provider services | Apply this pattern to banking/payment rails, KYC/AML, email/SMS, storage, accounting, credit data, and e-signature vendors. |

## Target repository layout

```text
apps/
  web/                 # Next.js public, borrower, investor, and admin surfaces
  api/                 # Fastify HTTP API and composition root
packages/
  db/                  # Drizzle schema, migrations, DB client, ledger/audit helpers
  shared/              # Zod contracts, enums, permission keys, common value types
docs/                  # Architecture, developer, security, operations, and decision docs
scripts/               # Migration, readiness, seed, reconciliation, and operational scripts
tasks/                 # Dependency-ordered delivery tasks and append-only handoff log
```

Create further packages only when code has a real cross-application boundary. Avoid a large generic utility package and avoid copying business logic between workspaces.

## Architecture rules carried forward from MedicalHub

- Use strict TypeScript and avoid `any` except at a narrow, validated boundary.
- Separate the web application, HTTP API, database package, and shared contracts.
- Inject services and vendor adapters at the API composition root so domain code is testable.
- Validate inputs and outputs with shared Zod schemas.
- Generate OpenAPI from Fastify routes and attach reviewable actor, capability, retry, side-effect, and audit metadata to privileged operations.
- Keep Fastify/OpenAPI JSON schemas aligned with shared Zod/domain validation; schema-level failures must use stable non-leaking error envelopes.
- Keep database access inside explicit domain services rather than scattering queries through handlers.
- Use database constraints as well as application validation.
- Check database readiness before serving traffic and shut down gracefully.
- Use generated, committed, forward-only migrations and verify them after deployment.
- Keep secrets in environment/secret management and never commit or log them.

## SproutUp-required extensions

MedicalHub is a useful application foundation, but it is not a financial-ledger reference architecture. SproutUp additionally requires:

1. **Exact money:** shared canonical PHP decimal-string contracts and immutable `bigint`-centavo `PhpMoney` values are implemented for exact settled-amount addition/subtraction/comparison, with a common PostgreSQL `numeric(30,2)` overflow boundary. Rate/percentage calculations still require an approved exact-decimal implementation plus explicit rounding mode, stage, residual rule, and rule version.
2. **Append-only ledgers:** `ledger_accounts`, immutable `ledger_transactions`, and immutable positive debit/credit `ledger_entries` are implemented with PHP-only `numeric(30,2)`, unique posting/reversal identities, and deferred database balance enforcement. API primitives add exact preflight balance, canonical payload hashing, active-account locks, exact-retry semantics, atomic audit evidence, one-time full opposite-line reversal, and read-only exact account aggregation. A mutable wallet balance is never the source of truth. The chart, ownership, public projections, domain posting rules, holds, and reconciliation mappings remain task-owned.
3. **Idempotency and concurrency:** financial postings use a global hash-bound idempotency key and shared account locks, with a transaction-aware primitive for atomic domain state and ledger effects. Provider references and future domain commands still require their own unique constraints, row locking or equivalent concurrency control, atomic state transitions, and safe retries.
4. **Durable background work:** PostgreSQL `background_jobs` and protected `background_job_attempts` provide provider-neutral idempotency, `SKIP LOCKED` claims, bounded leases/backoff/retries, scheduling, dead-letter/terminal state, and attempt evidence. The enqueue primitive accepts an owning domain transaction so state and work commit atomically. Worker runtime topology and any external queue/scheduler provider remain open infrastructure decisions.

The in-process worker runtime is also provider-neutral and deny-by-default: versioned Zod topic registration, bounded non-overlapping polling/concurrency, automatic heartbeats, safe error classification, and timed graceful handoff are implemented and tested. The API does not activate it while the explicit application registry is empty; deployed worker topology remains an infrastructure decision.
5. **Dual control:** maker/checker authorization and auditable approval state for disbursement, transfer approval, adjustments, write-offs, and configuration changes as defined by the approval matrix.
6. **Operational evidence:** structured logs with correlation IDs, metrics, tracing/error reporting, immutable audit trails, reconciliation dashboards, backup/restore tests, and runbooks.
7. **Security and privacy:** field/file classification, encryption and key management, retention/deletion policy, malware scanning for uploads, least privilege, dependency/secret scanning, and tested incident procedures.
8. **Consent evidence:** immutable PostgreSQL `consent_documents` and `consent_acceptances` retain exact versioned text/hash identity and user acceptance linkage. Internal transaction-aware services compute exact UTF-8 publication hashes, resolve version conflicts, select latest-effective content, and atomically record exact acceptance/audit evidence. Legal content, route authorization, required-document policy, re-consent, withdrawal, retention, private files, and e-signatures remain separate task-owned controls.

## Dependency and version policy

MedicalHub's checked-in versions are the initial compatibility reference, not a command to copy vulnerable or unsupported versions. At scaffold time:

- pin exact versions after checking Node 20 compatibility and peer dependencies;
- use one version of each shared runtime dependency across workspaces, especially Zod;
- generate and commit the npm lockfile;
- record deviations here with the reason and migration impact; and
- require dependency, license, vulnerability, typecheck, test, and build checks in CI.

The initial clean install requires `legacy-peer-deps=true` because both npm 10.9.3 and npm 11.5.1 crash in Arborist while resolving Better Auth/Vitest optional peers. Direct dependencies remain exact-pinned and the lockfile plus CI validation are authoritative. This workaround must be removed once an npm resolver update completes a clean install without it.

The MedicalHub snapshot currently mixes Zod 3 in the root/shared package with Zod 4 in the API. SproutUp must resolve that mismatch before its first scaffold rather than reproduce it.

The initial SproutUp scaffold resolves that mismatch on Zod 4. It also upgrades MedicalHub's Next.js 14/React 18 combination to Next.js 16/React 19 because the copied Next.js 14 release fails the production dependency audit with multiple high-severity advisories. The App Router architecture remains the same; future framework upgrades require passing tests, builds, and the production audit before adoption.

The API uses exact-pinned `@fastify/swagger` 9.8.1, whose 9.x line is compatible with Fastify 5. Generated OpenAPI 3.1 coverage is tested in CI across every application-owned operation, including public health and authenticated session context. The framework-owned Better Auth wildcard is explicitly excluded rather than assigned a misleading generic payload contract; future domain/provider routes must satisfy the global assertion when registered.

Major API compatibility is path-based (`/v1`) and every versioned response publishes `SproutUp-API-Version`. Retirement uses RFC 9745 `Deprecation` plus RFC 8594 `Sunset`, with a code-enforced minimum 180-day notice period; current `v1` emits neither retirement header.

## Decisions still open

The application stack above is approved. These infrastructure choices remain deliberately provider-neutral until requirements and operating constraints are confirmed:

- hosting/container platform and regional topology;
- managed PostgreSQL provider, availability target, backups, point-in-time recovery, and recovery objectives;
- queue/cache provider and scheduler topology;
- private object-storage provider and retention controls;
- observability/error-reporting platform;
- transactional email/SMS, KYC/AML, e-signature, payment/bank, accounting, and credit-data providers; and
- whether separate frontend deployments are needed later for security, scaling, or release independence.

## Documentation rule

Documentation is a deliverable, not cleanup. Every material change must update the relevant task/MVP Markdown, technical or operational documentation, and the append-only [`tasks/LOGS.md`](../tasks/LOGS.md) entry in the same work session. Stack changes must also update this document.
