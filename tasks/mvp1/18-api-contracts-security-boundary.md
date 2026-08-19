# 18 — API Contracts & Security Boundary

**Status:** WIP  
**Outcome:** Admin, borrower, investor, and integration clients use a versioned API with explicit authentication, authorization, validation, and error behavior.

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
- Token/session model details, version support policy, OpenAPI generation, and provider-specific webhook requirements remain open.
