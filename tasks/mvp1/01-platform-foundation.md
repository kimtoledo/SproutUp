# 01 — Platform Foundation

**Status:** WIP  
**Outcome:** A deployable, observable foundation shared by admin, borrower, investor, and background processes.

## Implementation progress

- **2026-08-19 — Initial scaffold complete:** npm workspaces now contain the Next.js web app, Fastify API, PostgreSQL/Drizzle boundary, and shared Zod contracts.
- Process liveness (`GET /health`) and database readiness (`GET /v1/health`) are implemented and tested, including the degraded `503` response.
- CI now runs lint, strict type checks, tests, production builds, and a high-severity production dependency audit on Node 20.
- Local setup, environment variables, health behavior, validation commands, and the migration workflow are documented in [`../../docs/DEVELOPER.md`](../../docs/DEVELOPER.md).
- Authentication/RBAC, initial domain schema/migrations, and the provider-neutral durable-job persistence foundation are implemented. Production job activation/topology, observability provider, backups, and remaining financial/domain controls remain open; this task stays **WIP**.
- Added generated migration `0009_moaning_argent.sql` for idempotent background jobs, bounded priorities/retries, exclusive leases, terminal timestamps, and unique per-job attempt evidence. Startup readiness now requires both job relations.
- Added a transaction-aware enqueue primitive and PostgreSQL job-control service for bounded concurrent claims, heartbeats, stale-worker denial, exponential retry, dead-lettering, expired-lease recovery, success, and unclaimed cancellation. Custom migration `0010_job-attempt-evidence.sql` protects completed attempt evidence.
- Added a deny-by-default worker runtime with explicit versioned topic registration, bounded non-overlapping polling/concurrency, automatic heartbeats, safe error classification, and graceful drain/lease handoff. The application registry remains intentionally empty and the server starts no worker.
- Added canonical two-decimal PHP string contracts and an immutable `bigint`-centavo money value for exact parsing, formatting, signed addition/subtraction, comparison, transport conversion, and `numeric(30,2)` overflow enforcement. Rate/rounding operations remain deliberately unavailable.
- Added generated ledger schema migration `0011_wide_nemesis.sql` and custom invariant migration `0012_ledger-invariants.sql`: stable PHP accounts, immutable posting headers/positive debit-credit lines, unique idempotency/reversal identities, and deferred exact balance enforcement at commit.
- Added the transaction-aware ledger posting primitive with exact balance validation, canonical order-independent hashing, active PHP account locks, exact-retry/conflict semantics, and atomic immutable audit evidence.

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
