# 02 — Authentication, RBAC & Audit

**Status:** WIP  
**Outcome:** Secure access for staff, SME borrowers, and investors with traceable privileged activity.

## Implementation progress

- **2026-08-19 — Auth foundation complete:** Better Auth email/password and database sessions are mounted at `/v1/auth/*`; `GET /v1/session-context` returns only server-resolved active-user roles and permissions.
- Added the seven approved roles, ten initial auth-domain capability keys, deny-by-default policy helper, idempotent authorization seed, and normalized `roles`, `permissions`, `user_roles`, and `role_permissions` tables.
- Added database-backed authentication throttling plus an API rate-limit layer, secure-cookie production defaults, seven-day sessions, hashed verification identifiers, and 12–128-character password limits.
- Added append-only `audit_events`, sensitive-metadata rejection, and PostgreSQL triggers that reject update, delete, and truncate operations.
- Generated and tested migrations against embedded PostgreSQL; tests cover schema creation, immutable audit enforcement, idempotent authorization seed, auth proxying, inactive/unauthenticated denial boundary, and server-resolved context.
- Added capability-protected own-session listing and revocation. The API exposes opaque IDs rather than tokens, enforces ownership in the delete query, and commits revocation plus immutable audit evidence atomically.
- Password-reset/email-verification delivery, MFA/OTP, role-management commands, audit integration into each privileged workflow, final grants, emergency access, and device UI remain; this task stays **WIP**.

## Scope

- Email/password authentication, password reset, session/device management, and OTP step-up.
- Roles: Super Admin, Sales Officer, Credit Analyst, Compliance Officer, Finance Officer, SME Borrower, and Investor.
- Permission matrix for viewing, creating, approving, rejecting, disbursing, correcting, and exporting data.
- Rate limiting, lockout, session revocation, and immutable business audit events.

## Acceptance criteria

- Strong password hashing and expiring single-use reset tokens are used.
- Staff cannot perform actions outside their approved role permissions.
- Maker and checker cannot be the same person for controlled financial actions.
- Login, permission changes, KYC decisions, campaign decisions, and money movements are audited.
- Sensitive fields and credentials never appear in logs or audit metadata.

## Legacy reference

- [Auth, RBAC & Access Audit](../reference/legacy/domain-auth-security-rbac.md)

## Open decisions

- Required OTP events and session lifetime per user type.
- Final role-permission matrix and emergency-access procedure.
- Transactional-email and SMS providers for verification, recovery, and OTP delivery.

## Legacy findings to reconcile

- The back office defines 12 legacy role IDs and database-configured route permissions; these do not map directly to the five target staff roles.
- Broad Admin access, a narrow superadmin-only deny list, and ad hoc object-level introducer checks require deny-by-default replacement policies.
- High-risk action separation is specified separately in [Task 22](./22-maker-checker-approval-matrix.md).
- See the [legacy role and permission review](../reference/legacy/admin/04-roles-permissions-control-gaps.md).
