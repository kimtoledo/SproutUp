# SproutUp

[SproutUp](https://github.com/kimtoledo/SproutUp) is the planned replacement for the legacy SeedIn admin, borrower/investor portal, and API applications. It targets a Philippine debt-crowdfunding platform with one authoritative API and auditable financial workflows.

## Engineering baseline

The approved implementation baseline is adapted from the reviewed MedicalHub repository:

- npm-workspaces TypeScript monorepo;
- Next.js 16 App Router and React 19 frontend;
- Fastify 5 API with Zod validation and structured logging;
- PostgreSQL with Drizzle ORM and generated migrations;
- Better Auth behind a replaceable server-side authentication boundary;
- shared contracts in `packages/shared`; and
- Vitest, strict type checks, production builds, and domain-specific integration/end-to-end tests.

SproutUp adds financial-grade requirements that MedicalHub does not supply by itself: exact decimal money, append-only ledgers, idempotency, concurrency controls, durable queues/outbox processing, maker/checker approvals, and reconciliation.

See [`docs/TECH_STACK.md`](./docs/TECH_STACK.md) for the authoritative reviewed stack, [`docs/API_COMPATIBILITY.md`](./docs/API_COMPATIBILITY.md) for the `/v1` compatibility and retirement policy, and [`AGENTS.md`](./AGENTS.md) for repository working rules.

## Current state

The platform foundation is implemented with production builds, database migrations, authentication/RBAC/audit controls, dual-controlled role administration, owner-bound borrower/investor onboarding workflows, a compliance review/correction loop, generated OpenAPI contracts, and a Tailwind design system with an accessible component kit and an installable PWA shell (web app manifest, offline-capable service worker). The controlled-pilot MVP remains in progress: regulated onboarding data, provider integrations, financial ledger/campaign/repayment domains, the full portal/admin user interfaces, operations, and release readiness still follow the dependency-ordered task plan.

Start with [`tasks/README.md`](./tasks/README.md) and the latest entry in [`tasks/LOGS.md`](./tasks/LOGS.md).

## Quick start

```bash
nvm use
npm install
cp .env.example .env
npm run dev:web
```

Run `npm run dev:api` in a second terminal after configuring a reachable PostgreSQL `DATABASE_URL`. See [`docs/DEVELOPER.md`](./docs/DEVELOPER.md) for setup, health endpoints, validation, and migration commands.

Authentication is isolated by account class. Admin, borrower, and investor use separate account,
credential, session, verification, and rate-limit tables; separate `/v1/auth/{account-type}/*`
boundaries; and distinct HTTP-only cookie namespaces. Staff alone use RBAC through
`admin_role_grants`; borrower and investor authorization comes from their physical account class
plus server-enforced ownership. A globally unique email registry prevents the same normalized
email from registering in another portal. Migration `0024` retired the legacy unified customer
auth routes, sessions, credentials, and active customer-role grants. See
[`docs/IDENTITY.md`](./docs/IDENTITY.md) and [`docs/SECURITY.md`](./docs/SECURITY.md).
