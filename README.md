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

See [`docs/TECH_STACK.md`](./docs/TECH_STACK.md) for the authoritative reviewed stack and [`AGENTS.md`](./AGENTS.md) for repository working rules.

## Current state

This repository currently contains discovery, schema, and dependency-ordered MVP planning documents. Application scaffolding has not yet been created.

Start with [`tasks/README.md`](./tasks/README.md) and the latest entry in [`tasks/LOGS.md`](./tasks/LOGS.md).

## Quick start

```bash
nvm use
npm install
cp .env.example .env
npm run dev:web
```

Run `npm run dev:api` in a second terminal after configuring a reachable PostgreSQL `DATABASE_URL`. See [`docs/DEVELOPER.md`](./docs/DEVELOPER.md) for setup, health endpoints, validation, and migration commands.
