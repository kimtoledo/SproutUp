# 18 — API Contracts & Security Boundary

**Status:** WIP  
**Outcome:** Admin, borrower, investor, and integration clients use a versioned API with explicit authentication, authorization, validation, and error behavior.

## Implementation progress

- **2026-08-19 — Initial protected API patterns:** Added versioned Zod-validated auth context, own-session, role-assignment approval, role catalogue, and paginated user catalogue routes.
- The implemented routes resolve server-side authorization, require explicit capabilities, return stable structured error codes, use UUID request correlation, and have negative permission/validation tests.
- The user catalogue caps pages at 100 records and returns only an allowlisted access summary. Credentials, provider-account data, session IDs, and tokens are not part of its response contract.
- Added owner-bound onboarding case routes with journey-specific capabilities, database uniqueness for duplicate create retries, optimistic version conflicts for stale submission retries, and atomic state/event/audit writes.
- Added generated OpenAPI 3.1 at `/openapi.json` with product metadata, a session-cookie security scheme, tags, and automated route-group/secret regression coverage in the normal CI test gate.
- Added a reusable operation metadata contract and annotated all eight onboarding operations with unique IDs, cookie security, actor boundary, capability set/mode, retry model, side effects, and audit event; CI walks and validates every annotation.
- Added enforced path/query/body and success/structured-error JSON schemas for all eight onboarding operations plus a stable non-leaking Fastify validation-error envelope. CI checks command request bodies, path parameters, and response declarations.
- Metadata/schemas on the earlier auth/access routes, private-file and webhook contracts, version/deprecation policy, and remaining domain operations remain; this task stays **WIP**.

## Scope

- Define resource-oriented endpoints and schemas for every MVP 1 workflow.
- Specify public, authenticated, staff-only, webhook, and internal/job trust boundaries.
- Use secure token transport, session/device revocation, step-up authentication, rate limits, idempotency, pagination, and request correlation.
- Standardize validation errors, domain errors, HTTP status codes, versioning, deprecation, and audit context.
- Define signed webhook verification and private-file access contracts.

## Acceptance criteria

- An OpenAPI contract covers all MVP 1 operations and is validated in CI.
- Every operation declares actor, permission, input/output, idempotency, side effects, and audit event.
- Tokens and secrets are never accepted in URLs or returned in logs/errors.
- Authorization is enforced server-side and tested for allowed and denied role/resource combinations.
- Webhook replay, duplicate requests, malformed input, and expired/revoked sessions are covered by tests.

## Legacy reference

- [Services API inventory](../reference/legacy/api-v1-1/02-services-api-inventory.md)
- [Legacy API risks](../reference/legacy/api-v1-1/07-risks-verification-gaps.md)

## Open decisions

- Fastify with resource-oriented, Zod-validated routes under `/v1` is the approved API technology/style; liveness remains unversioned at `/health`.
- Version support policy, complete OpenAPI operation metadata, and provider-specific webhook requirements remain open.
