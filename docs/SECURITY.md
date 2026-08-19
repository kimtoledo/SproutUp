# SproutUp Security Baseline

## Authentication boundary

Better Auth is mounted behind the Fastify API at `/v1/auth/*`. The web application does not read credentials, session tables, or role tables directly.

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

Authorization is capability-based and deny-by-default. The initial permissions cover only users, roles, sessions, and audit access. Each later domain task must add explicit capability keys and reviewed grants; no role receives a domain permission merely because it is a staff role.

Role grants and revocations are not exposed as direct mutations. A caller with `roles.assign` proposes an exact target/role payload and reason; a different caller with the same capability must approve it before the change executes. Proposals expire after 24 hours, are protected from duplicate pending payloads, are locked while being checked, and bind approval to a SHA-256 payload hash. The maker cannot target their own account, the checker cannot be the maker or target, and `super_admin` cannot be changed through this workflow until an emergency/bootstrap policy is approved. Revocation also locks and revalidates all current target grants and cannot remove the final role from an active account.

Administrative read APIs enforce `roles.read` and `users.read` independently. User results are paginated and expose only the access-management summary; credential-provider data, password hashes, session IDs, and tokens are outside the response model.

## Audit evidence

`audit_events` and `approval_actions` are append-only. PostgreSQL triggers reject row updates, row deletes, and table truncation. Corrections must be represented by new events.

Audit metadata is rejected before persistence when a key indicates a password, token, secret, authorization header, cookie, API key, or credential. Audit events preserve actor and role snapshots without a foreign key that could erase attribution when a user record changes.

The initial writer and schema are implemented, but every privileged/domain command must integrate audit writes in its own transaction or reliable outbox workflow before that command is considered complete.

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
