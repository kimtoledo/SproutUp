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
- Added full operation metadata and enforced response/error schemas to own-session listing, owned-session revocation, role catalogue, and bounded user catalogue. UUID session parameters and catalogue filters are also transport-validated; the session response schema cannot expose tokens.
- Added full contracts to all ten role-assignment, revocation, lifecycle, and history operations. The contract distinguishes database-unique pending proposals from row-locked decisions and publishes hash/integrity evidence without weakening maker/checker runtime enforcement.
- Contracted public liveness/readiness and authenticated session context, then added a global CI walk that rejects missing operation IDs, response schemas, or operational metadata on every application-owned route.
- Added the path-major compatibility policy, a version response header on all `/v1` responses, and tested RFC 9745/RFC 8594 retirement-header generation with a minimum 180-day notice invariant. Current `v1` is explicitly not deprecated.
- **2026-08-30 — Portal-specific auth contracts:** Replaced the unscoped customer auth/context
  boundary with exact borrower and investor Better Auth wildcards plus
  `/v1/borrower/session-context` and `/v1/investor/session-context`. Admin remains isolated at its
  matching paths. Context responses include a server-resolved account class; customer roles are
  always empty. The legacy `/v1/auth/*` and `/v1/session-context` now return `404`, and tests cover
  cross-portal credential denial, duplicate-email privacy, exact cookies, and class-correct context.
- **2026-08-30 — Private document operations, partially contracted:** All four `/v1/documents*`
  operations carry an operation id, actor/permission/retry/side-effect/audit metadata, and enforced
  JSON error-response schemas, so the global CI walk covers them like every other route. Two gaps
  are deliberate, not oversights: the two upload operations take `multipart/form-data`, not JSON, so
  they declare no `body` schema (Fastify never populates `request.body` for a multipart request —
  one was declared and briefly broke every upload in CI before this was understood; see
  `routes/documents.ts`); and the download operation declares no `response[200]` schema, since a
  JSON-shaped schema there would make Fastify try to serialize a raw file `Buffer` through
  `fast-json-stringify`. Both gaps mean these three operations are excluded from `openapi.test.ts`'s
  strict per-operation table (which requires a `requestBody` on every POST and a 2xx response on
  every operation) while still passing the generic completeness walk.
- The Better Auth wildcard remains provider-owned and explicitly excluded; webhook contracts plus future domain operations remain, so this task stays **WIP**.

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
- `/v1` remains backward compatible; breaking changes use a parallel major path. Security-corrective narrowing requires documented risk/client notice. Deprecation and sunset require a replacement/migration plan and at least 180 days between their announced dates.
- Provider-specific webhook requirements remain open.
