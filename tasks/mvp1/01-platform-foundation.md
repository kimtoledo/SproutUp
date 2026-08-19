# 01 — Platform Foundation

**Status:** WIP  
**Outcome:** A deployable, observable foundation shared by admin, borrower, investor, and background processes.

## Implementation progress

- **2026-08-19 — Initial scaffold complete:** npm workspaces now contain the Next.js web app, Fastify API, PostgreSQL/Drizzle boundary, and shared Zod contracts.
- Process liveness (`GET /health`) and database readiness (`GET /v1/health`) are implemented and tested, including the degraded `503` response.
- CI now runs lint, strict type checks, tests, production builds, and a high-severity production dependency audit on Node 20.
- Local setup, environment variables, health behavior, validation commands, and the migration workflow are documented in [`../../docs/DEVELOPER.md`](../../docs/DEVELOPER.md).
- Authentication/RBAC, initial domain schema/migrations, and the provider-neutral durable-job persistence foundation are implemented. Worker execution/recovery, observability provider, backups, and financial primitives remain open; this task stays **WIP**.
- Added generated migration `0009_moaning_argent.sql` for idempotent background jobs, bounded priorities/retries, exclusive leases, terminal timestamps, and unique per-job attempt evidence. Startup readiness now requires both job relations.

## Scope

- Scaffold the approved npm-workspaces architecture from [`../../docs/TECH_STACK.md`](../../docs/TECH_STACK.md): `apps/web`, `apps/api`, `packages/db`, and `packages/shared`.
- Establish Next.js App Router web surfaces, a versioned Fastify `/v1` API, shared Zod contracts, PostgreSQL/Drizzle access, and Better Auth behind a server-side service boundary.
- Establish database migrations, configuration/secrets handling, queues, file storage, and scheduled jobs.
- Add structured logs, error tracking, health checks, backups, and restore procedures.
- Define shared money, date/time, identifier, pagination, and error-response conventions.
- Establish append-only ledger, idempotency, transactional-outbox, maker/checker, and immutable-audit foundations before money-moving features are implemented.

## Acceptance criteria

- Local, test, staging, and production configurations are separated and documented.
- Secrets are not committed; sensitive values are redacted from logs.
- Deployments and database migrations are repeatable with rollback/forward-fix guidance.
- Currency uses exact decimal arithmetic and stores PHP amounts without floating-point math.
- Every runtime workspace uses aligned, pinned shared dependency versions; the lockfile is committed.
- CI runs lint, strict type checks, unit/integration tests, production builds, migration verification, and dependency/secret checks.
- API startup verifies database readiness, and shutdown drains or safely hands off in-flight work.
- Durable jobs survive process restarts and can be retried idempotently with visible status and failure evidence.
- Backup restoration is tested before pilot launch.

## Dependencies

- Approved technology stack in [`../../docs/TECH_STACK.md`](../../docs/TECH_STACK.md).
- Hosting and managed-service provider decisions for the environment being deployed.

## Open decisions

- Hosting/deployment topology and whether frontend surfaces eventually need separate deployments.
- Managed PostgreSQL, private file-storage, durable queue/cache, and monitoring providers.
- Recovery point/time objectives, data residency, retention, and encryption/key-management requirements.
