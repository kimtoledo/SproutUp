# `seedin-live-api-v1-1` Source Review

**Status:** WIP — static source review  
**Reviewed:** 2026-08-18  
**Branch:** `main`

This review supplements the earlier Claude Code domain inventory with direct inspection of `seedin-live-api-v1-1`.

## Snapshot

- Yii `1.1.14` monolith with services API, backend/admin, shared models/libraries, cron commands, and maintenance CLI.
- 32 service controller files and 164 callable-style `get*`, `post*`, or `action*` method declarations.
- 51 top-level backend page controllers, 42 backend server/data controllers, and 18 report controllers.
- 146 common model files and 50 common library files.
- 18 commands in the active cron directory, 41 commands under `cron/.../trash`, and 7 maintenance command groups under `cbase`.
- 61 incremental migrations dated 2017–2020, but no complete baseline database schema.
- 21 Codeception scenario/test files; configuration and fixture limitations prevent treating this as current coverage proof.

## Review documents

- [01 — Architecture & Application Surfaces](./01-architecture-application-surfaces.md)
- [02 — Services API Inventory](./02-services-api-inventory.md)
- [03 — Modules, Features & Roles](./03-modules-features-roles.md)
- [04 — Cron & Console Inventory](./04-cron-console-inventory.md)
- [05 — Integrations & Storage](./05-integrations-storage.md)
- [06 — Data, Migrations & Tests](./06-data-migrations-tests.md)
- [07 — Risks & Verification Gaps](./07-risks-verification-gaps.md)
- [08 — Revamp Impact & Feature Disposition](./08-revamp-impact-feature-disposition.md)

## Related schema documentation

- [Schema documentation index](../../../schema/README.md)

## Interpretation rule

“Present in source” does not mean “enabled in production” or “required in the revamp.” Runtime configuration, database state, real scheduler configuration, provider accounts, and business operations still need verification.
