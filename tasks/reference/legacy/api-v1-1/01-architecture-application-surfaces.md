# 01 — Architecture & Application Surfaces

**Status:** Source-verified with runtime gaps

## Technology shape

- PHP/Yii `1.1.14`; framework source and many third-party libraries are vendored into the repository.
- Shared ActiveRecord models, libraries, forms, validators, components, templates, and uploads live under `newunion/applications/common`.
- Environment overlays under `newunion/environments/{dev,qa,prod}` are copied/merged into ignored runtime configuration paths.
- Application bootstraps merge common configuration with an application-specific configuration.

## Application surfaces

| Surface | Source location | Responsibility |
| --- | --- | --- |
| Services API | `applications/services`, `public/services` | Web/mobile/partner JSON-style endpoints |
| Backend/admin | `applications/backend`, `public/admin` | Operations UI, server actions, reports, settings, approvals |
| Shared domain layer | `applications/common` | Models, business libraries, forms, templates, files, integrations |
| Cron console | `cron/protected/commands` | Queues, auto-invest, publishing, payment polling, reminders |
| Maintenance CLI | `cbase/commands` | Reconciliation, repair, force actions, provider utilities |
| Migrations | `migrations` | Incremental database changes after the original schema |
| Tests | `tests/codeception/functional` | Legacy functional scenarios across API/backend/frontend/cron |
| API docs | `documentations/api` | RAML/generated documentation that covers only part of source behavior |

## Request routing

- Services routes accept unversioned, `v1`, `v1_1`, `investor`, and `borrower` prefixes that map to the same `Service*Controller` classes.
- `ServiceController::createAction()` maps HTTP verbs to method prefixes such as `getList` and `postSave`.
- The API can require shared HTTP Basic service credentials plus a user API key/session token.
- A route allowlist bypasses user-token checks for registration, site/content, password, selected credit-rating, gateway callback, and other actions.
- A smaller “unsecured” list bypasses shared Basic authentication for contracts/files and the Paynamics callback.

## Shared-domain coupling

- Controllers call ActiveRecord models and static business libraries directly.
- Business rules, persistence, formatting, notifications, and external calls are frequently combined in the same request or model method.
- Backend/admin and services share the same model layer and sometimes duplicate controller behavior.
- Background jobs invoke the same models/libraries without a formal application-service boundary.

## Revamp implications

- Define explicit domain/application services instead of porting controllers as business logic.
- Publish one versioned API contract with authentication and authorization defined per operation.
- Isolate background jobs, notifications, provider clients, file storage, and reporting behind stable interfaces.
- Remove web-accessible test/control surfaces and environment-specific behavior from deployable application code.
