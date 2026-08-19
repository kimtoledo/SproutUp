# SproutUp — Repository Instructions

Read [`README.md`](./README.md), [`docs/TECH_STACK.md`](./docs/TECH_STACK.md), [`tasks/README.md`](./tasks/README.md), and [`tasks/LOGS.md`](./tasks/LOGS.md) before material work. Also read the relevant MVP, schema, and legacy-reference documents for the area being changed.

## Architecture baseline

- Use an npm-workspaces TypeScript monorepo modeled on the proven MedicalHub structure.
- Put the Next.js App Router frontend in `apps/web` and the Fastify API in `apps/api`.
- Put PostgreSQL/Drizzle schema, migrations, and database access in `packages/db`.
- Put cross-application Zod contracts, enums, identifiers, and permission constants in `packages/shared`.
- Keep business rules and financial calculations in API/domain services, never in React components or route handlers.
- Version external API routes under `/v1` and keep vendor integrations behind interfaces/adapters.
- Treat [`docs/TECH_STACK.md`](./docs/TECH_STACK.md) as the authoritative stack decision record.

## Security and financial invariants

- Authenticate and authorize every protected operation on the server.
- Resolve roles, permissions, and borrower/investor ownership from the authenticated session; never trust client-supplied authority or scope.
- Use explicit transactions for multi-write financial and state-transition workflows.
- Keep the wallet and accounting ledgers append-only. Corrections use reversal/adjustment entries, not edits or deletes.
- Store PHP monetary values with PostgreSQL `numeric` and perform calculations with an approved decimal-money abstraction; never use JavaScript floating-point arithmetic for money.
- Preserve gross amount, every fee/tax/deduction, net amount, currency, rule version, and effective date.
- Require idempotency for money movement, provider callbacks, scheduled jobs, and retryable commands.
- Record immutable audit events for privileged, compliance, financial, and approval actions.
- Keep private KYC, identity, contract, and financial files out of public storage and logs.
- Enforce maker/checker separation for the operations identified by the approved matrix.

## Work method

1. Confirm that a task exists and read its dependencies and acceptance criteria.
2. State assumptions and identify affected routes, services, tables, jobs, permissions, and financial entries.
3. Make a focused change with tests for success, denial, validation, idempotency, and rollback/failure paths as applicable.
4. For schema changes, generate and review a new Drizzle migration. Never rewrite an applied migration or use schema push against a shared environment.
5. Run the repository-defined lint, typecheck, test, build, migration-readiness, and relevant security/reconciliation checks.
6. Update documentation in the same change.

## Documentation is part of every change

Every material code, schema, configuration, architecture, security, workflow, or task-status change must update the relevant Markdown files in the same work session:

- the affected task and its MVP README;
- `docs/TECH_STACK.md` for stack or architecture decisions;
- `README.md` or developer/runbook documentation when setup or operation changes; and
- `tasks/LOGS.md` with a new, append-only handoff entry.

Do not mark work complete while its documentation is stale. Do not rewrite historical log entries; add a newer correction or decision entry.
