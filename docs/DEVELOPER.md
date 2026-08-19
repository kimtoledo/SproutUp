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
| `GET /v1/health` | Readiness; returns `503` when PostgreSQL cannot be reached |

## Validate a change

```bash
npm run check
```

This runs workspace linting, strict type checks, tests, and production builds. CI runs the same command and audits production dependencies.

## Database workflow

Schemas belong in `packages/db/src/schema/`. Every schema change must be tied to an approved task.

```bash
npm run db:generate
# Review the generated SQL under packages/db/migrations/.
npm run db:migrate
```

Commit schema and generated migration files together. Never edit a migration already applied to a shared environment, use schema push against shared environments, or run manual DDL as a substitute for a migration.

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
