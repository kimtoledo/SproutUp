# SproutUp Security Baseline

## Authentication boundary

Better Auth is mounted behind the Fastify API at `/v1/auth/*`. The web application does not read credentials, session tables, or role tables directly.

`GET /openapi.json` publishes route/contract metadata only. It declares the HTTP-only session-cookie security scheme but contains no cookie values, credentials, environment secrets, or internal database configuration; the generated document is covered by a secret-regression test.

Liveness and readiness are explicitly public and return only service/dependency status. Every other application-owned operation declares session-cookie authentication. `GET /v1/session-context` requires an active account and schema-allowlists only server-resolved identity, canonical roles, and canonical permission keys.

Every contracted onboarding, own-session, access-catalogue, and role-approval operation declares its authenticated actor boundary and required capability set in the generated contract. These declarations are documentation checked by CI; runtime authorization remains the server-resolved permission check in each handler/service and is independently covered by denial tests.

The framework-owned Better Auth wildcard is a rate-limited byte-preserving adapter and is excluded from SproutUp's per-operation assertion because its concrete endpoints and payloads are version-owned by Better Auth. This exception does not apply to any application-owned route; CI walks all of those routes and rejects missing trust metadata or response schemas.

API compatibility does not preserve known-unsafe behavior. A security-corrective change may narrow `v1` behavior only with a documented risk decision, stable non-disclosing error behavior, release notes, and controlled-pilot client notification. Routine breaking changes require a parallel major version and the deprecation/sunset process in `API_COMPATIBILITY.md`.

Onboarding path, query, body, success, and structured error schemas are now enforced by Fastify and published in OpenAPI. Schema failures return a generic stable validation message rather than echoing submitted values or internal validator details; deeper state/ownership checks still execute in the domain services.

Own-session responses are schema-allowlisted to opaque session identity and display metadata and cannot serialize session tokens. Role and user catalogue responses likewise enforce the documented access-management projection, excluding credentials, provider accounts, sessions, and tokens. Session IDs and user-catalogue filters are bounded at the transport boundary before ownership or permission checks continue.

- Email/password credentials use Better Auth's memory-hard scrypt hashing.
- Password length is 12–128 characters.
- Session tokens are stored in the database and transported through HTTP-only, SameSite=Lax cookies; production cookies are Secure.
- Sessions expire after seven days and refresh at most once per day.
- Verification identifiers are stored hashed.
- Authentication rate limits are database-backed so they apply across API replicas. Email sign-in is limited to five attempts per minute and password-reset requests to three per five minutes.
- API-level rate limiting is also enabled as defense in depth.
- Suspended or disabled users cannot resolve an authorization context even if an old session cookie still exists.
- Authenticated users can list and revoke only their own sessions through opaque session IDs. Session tokens are never returned by the session-management API.
- Session revocation and its immutable audit event commit in one database transaction. A mismatched owner/session pair is treated as not found.

Password-reset delivery and email verification are not operational until a transactional-email adapter and templates are approved. MFA/OTP is not enabled until the required events, recovery process, and delivery provider are approved. These are release blockers under MVP 1 task 02, not silently deferred security controls.

## Authorization

The API resolves roles and permissions from the authenticated user ID. Client-supplied role, permission, or ownership claims are never authoritative.

The initial role catalogue is:

- Super Admin
- Sales Officer
- Credit Analyst
- Compliance Officer
- Finance Officer
- SME Borrower
- Investor

Email signup requires a validated `registrationIntent` of `borrower` or `investor`. In the same PostgreSQL user-insert transaction, a database trigger grants exactly `sme_borrower` or `investor` and appends `account.registered` audit evidence. The enum cannot express staff or `super_admin`, and the API accepts no general role field at signup. This narrow customer bootstrap is the only exception to dual-controlled role administration; later or additional role changes use the approval workflow.

Authorization is capability-based and deny-by-default. The initial permissions cover only users, roles, sessions, and audit access. Each later domain task must add explicit capability keys and reviewed grants; no role receives a domain permission merely because it is a staff role.

Role grants and revocations are not exposed as direct mutations. A caller with `roles.assign` proposes an exact target/role payload and reason; a different caller with the same capability must approve it before the change executes. Proposals expire after 24 hours, are protected from duplicate pending payloads, are locked while being checked, and bind approval to a SHA-256 payload hash. The maker cannot target their own account, the checker cannot be the maker or target, and `super_admin` cannot be changed through this workflow until an emergency/bootstrap policy is approved. Revocation also locks and revalidates all current target grants and cannot remove the final role from an active account.

Pending role changes may be rejected only by a different authorized non-target reviewer and cancelled only by their original maker. Both paths require a reason, lock and revalidate pending/hash-bound state, and append their workflow action and audit evidence atomically. Terminal requests cannot be decided again.

Role approval list/detail APIs require `roles.assign` because proposal and decision reasons are privileged operational data. They return the immutable action timeline and an integrity result recomputed from the canonical payload; an invalid result is visible for investigation and cannot be executed by the command services.

The generated contract identifies proposal creation as unique-pending and every approval/rejection/cancellation as a locked decision. Request schemas enforce UUID identities, canonical role keys, and bounded reasons before domain checks; response schemas expose the payload hash and integrity result needed for investigation without exposing credentials or session material.

Administrative read APIs enforce `roles.read` and `users.read` independently. User results are paginated and expose only the access-management summary; credential-provider data, password hashes, session IDs, and tokens are outside the response model.

## Audit evidence

`audit_events`, `approval_actions`, and `onboarding_case_events` are append-only. PostgreSQL triggers reject row updates, row deletes, and table truncation. Corrections must be represented by new events.

The onboarding foundation stores workflow identity/state only; regulated profile fields, documents, suitability answers, and screening/provider results are not yet collected. The database prevents an applicant from reviewing their own case, permits only one open case per applicant/journey, versions every transition, and retains corrections as new events rather than overwriting history. Customer roles receive only their own matching onboarding capabilities; compliance queue read/review is granted only to Compliance Officer and Super Admin in the current baseline.

Customer onboarding reads and commands bind both case ID and authenticated applicant ID in the database query. Borrower capabilities cannot access investor journeys and investor capabilities cannot access borrower journeys. Submission and withdrawal lock the case, verify ownership/type/current version and allowed transition, then commit state, append-only transition evidence, and business audit evidence atomically. Withdrawal requires a bounded reason and cannot cancel a case already in review or a terminal case.

The staff compliance queue and review command use independent read/review capabilities. Review start locks and version-checks submitted state, rejects applicant self-review, refuses to replace another assigned reviewer, and commits reviewer assignment, state, transition evidence, and audit evidence atomically.

Staff case detail requires the queue-read capability and returns only the currently approved workflow/applicant identity fields plus ordered immutable events. Regulated profile, document, and screening data are not yet stored or exposed.

Only the assigned reviewer can request information from an in-review case. A reason and exact version are required, and state/event/audit writes commit atomically. Applicant resubmission uses the owner-bound submission query and version token, retaining the reviewer and complete correction trail.

Only the assigned reviewer can reject an in-review case. Rejection requires an exact version and bounded reason, stamps the decision time, and atomically preserves state/event/audit evidence. Approval remains unavailable so an empty or policy-incomplete case cannot be marked eligible through this foundation.

Audit metadata is rejected before persistence when a key indicates a password, token, secret, authorization header, cookie, API key, or credential. Audit events preserve actor and role snapshots without a foreign key that could erase attribution when a user record changes.

Durable job payloads must contain only minimum identifiers and non-sensitive execution context. Credentials, session material, raw private documents, and provider secrets are rejected by the enqueue boundary. The database enforces idempotency, retry, lease, terminal-state, and attempt-number invariants; completed attempt evidence cannot be edited, deleted, or truncated. Settlement requires the current worker/attempt and an unexpired lease. Worker process identity, audited operator replay/cancellation, redacted error handling, and alerting remain required before production job execution.

Worker dispatch is deny-by-default: the runtime refuses to start with an empty registry, accepts only explicit lowercase topic names, validates a positive payload schema version plus the topic's Zod contract, and dead-letters unknown/invalid work. Unexpected exception text is not persisted. Shutdown or lost leases abort handler signals and prevent the stale process from recording success.

The initial writer and schema are implemented, but every privileged/domain command must integrate audit writes in its own transaction or reliable outbox workflow before that command is considered complete.

Consent documents and acceptances are immutable database evidence. Versioned content is retained with its SHA-256 identity, and a database trigger rejects acceptance evidence whose duplicated hash differs from the referenced document. The internal publication service computes SHA-256 from exact UTF-8 content and atomically audits new versions; exact retries cannot change title, content, or effective time. The internal acceptance service requires an existing user, exact displayed document/hash, and effective time, then atomically persists acceptance and audit evidence. Transaction-aware forms allow an owning domain gate to commit with the evidence.

No legal content or consent HTTP API is active. Publication authorization and the required/latest/re-consent policy must exist before exposure. Raw IP addresses and user-agent strings must not be stored; only policy-approved one-way hashes are accepted by the internal boundary.

## Financial input integrity

Shared PHP money contracts reject JSON numbers, exponent notation, grouping/currency text, non-two-decimal values, leading zeros, negative zero, and values outside `numeric(30,2)`. Exact runtime arithmetic uses `bigint` centavos. This removes binary floating-point drift and ambiguous textual representations but does not authorize any rate, tax, interest, allocation, or rounding formula; those remain owning-domain decisions.

Ledger headers and lines are immutable database evidence. Deferred constraint triggers reject empty or unbalanced transactions at commit; entry amounts must be positive exact PHP values, transaction/account line identities are unique, and account code/normal-balance/currency cannot change.

The posting service is the application write boundary. It requires distinct active PHP accounts, computes balance in exact centavos, takes shared account locks, hashes a canonical order-independent financial payload, and atomically appends the posting plus `ledger.transaction.posted` audit evidence. A global idempotency key returns only an exact matching payload and rejects reuse for a different effect. Owning domains must use the transaction-aware primitive when the posting accompanies a state change. Direct ledger inserts and ad hoc application SQL remain prohibited.

The full-reversal boundary locks the original, copies all lines with their directions exchanged, records the original relationship, and atomically appends `ledger.transaction.reversed` evidence. It rejects reversal-of-reversal and relies on both serialization and a unique database constraint to enforce one reversal. Historical account closure cannot erase the correction path, but no unrelated new posting may use a closed account.

The account balance projection reads only account metadata and aggregate ledger entries and performs exact signed normal-balance arithmetic. It has no HTTP exposure. Account ownership and read permissions must be approved and enforced before any ledger projection is exposed to staff or customers; account codes, aggregate balances, and internal chart structure must not leak through a generic authenticated route.

## Secrets

`BETTER_AUTH_SECRET` must contain at least 32 random characters and must come from environment-specific secret management. Generate a local value with:

```bash
openssl rand -base64 48
```

Never put real secrets in `.env.example`, Markdown, source code, fixtures, logs, URLs, or audit metadata.

## Known open controls

- Email verification and password-reset delivery provider
- OTP/TOTP policy, required step-up events, recovery, and trusted-device behavior
- Final domain role-permission and maker/checker matrices; role assignment itself is dual-controlled
- Emergency access and support impersonation policy
- Central security event monitoring and alert provider
- Session/device management user interface; the protected API is implemented
- Secret rotation and incident runbooks
