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
- Added dual-controlled role assignment: an authorized maker proposes a hash-bound role grant, a different authorized checker approves and executes it, and append-only approval/audit evidence is committed with the grant. Duplicate pending requests, self-targeting, self-approval, expired/stale requests, and `super_admin` elevation are denied.
- Added separately capability-protected role and user catalogues. Role results include effective permission keys; user results use bounded pagination and exclude credentials, provider accounts, sessions, and tokens.
- Added dual-controlled role revocation with the same hash/expiry/lock/evidence boundary. It revalidates current grants under lock, rejects self-change and `super_admin` mutation, and prevents removal of an active user's final role.
- Added role-change rejection and cancellation: a distinct authorized non-target reviewer may reject, only the maker may cancel, both require reasons, and terminal transitions append immutable action/audit evidence.
- Added bounded role-approval history/detail APIs with command/status filters, immutable action timelines, and independently recomputed payload-integrity results; privileged reasons require `roles.assign`.
- Added required borrower/investor registration intent to Better Auth email signup. A database trigger atomically grants only the matching customer role and appends registration audit evidence; staff/`super_admin` values are impossible through this field.
- Added generated OpenAPI operation metadata and enforced allowlist schemas for own-session and access-catalogue APIs. Session tokens, credential records, and provider-account data are structurally absent from these response contracts.
- Contracted all role-change APIs with bounded request schemas, allowlisted approval/evidence responses, structured errors, and explicit unique-pending or row-locked retry semantics. The contract regression test now covers proposals, execution, rejection, cancellation, and history/detail.
- Contracted session context as an active-user boundary that returns only schema-allowlisted identity, roles, and permissions. The Better Auth wildcard remains an explicitly documented, rate-limited provider adapter rather than a fabricated generic API schema.
- Added responsive `/register` and `/login` web pages over the Better Auth boundary. Registration captures only borrower/investor intent, both flows include cookie credentials, sign-in errors do not enumerate accounts, and client validation never replaces server enforcement.
- **2026-08-20 — Role approvals UI:** Added `/admin/role-approvals`, a `roles.assign`-gated workspace over the existing dual-controlled role-assignment/revocation, reject/cancel, and history/detail APIs: a pending-request list with maker-aware approve/reject/cancel, a propose form with bounded user search (`users.read`) and a full role picker, and filterable/paginated history with an expandable action timeline and an explicit integrity-invalid warning. Linked from `/portal` for permitted staff.
- **2026-08-20 — Active-sessions device UI:** Added an "Active sessions" section to `/portal`, available to every authenticated account, listing each session's IP, user agent, created/expiry time, and current-device flag from `GET /v1/sessions`, with a per-session revoke control wired to `DELETE /v1/sessions/:sessionId`. The current session has no revoke control there; it relies on the existing "Sign out" action instead.
- **2026-08-30 — Portal identity-isolation foundation:** Added separate `admin_accounts`,
  `borrower_accounts`, and `investor_accounts` plus separate credential/session/verification/rate-limit
  relations. `account_email_registry` and database triggers enforce one normalized email and one
  account ID across all portals, immutable account identity, and disable-instead-of-delete history.
  Borrower/investor are now the target account classes rather than RBAC roles. This slice is
  additive: migration of legacy `users` foreign keys, separate Better Auth route/cookie boundaries,
  and removal of customer roles remain required before release. See
  [`../../docs/IDENTITY.md`](../../docs/IDENTITY.md).
- **2026-08-30 — Identity cutover report and backfill:** Added the redacted
  `db:report-identity-cutover` preflight with deterministic staff precedence and explicit
  `ambiguous_customer_types` / `missing_account_type` exceptions. Migration `0021` refuses unsafe
  or pre-populated targets, copies each safe legacy account/credential/session into exactly one
  portal namespace, reconciles exact counts, invalidates unattributable verification/rate-limit
  state, and writes an immutable summary audit event. Runtime routes/cookies and domain foreign keys
  remain on the next cutover step.
- **2026-08-30 — Isolated administrator runtime boundary:** Mounted
  `/v1/auth/admin/*` over the backfilled admin-only Better Auth relations with a distinct
  `sproutup_admin` cookie and 12-hour staff sessions. Public admin signup is denied; admin context
  resolves only active `admin_accounts` and staff-category roles. All current staff route groups
  and web workspaces now use `/v1/admin/session-context`, and customer credentials fail against the
  admin sign-in namespace. `APP_ORIGINS` and `AUTH_COOKIE_DOMAIN` support the three exact portal
  origins. Staff RBAC still uses same-ID legacy joins until the next FK migration; borrower and
  investor runtime boundaries remain.
- Password-reset/email-verification delivery, MFA/OTP, audit integration into each privileged workflow, final grants, and emergency access remain; this task stays **WIP**.

## Scope

- Email/password authentication, password reset, session/device management, and OTP step-up.
- Separate account classes: Admin, SME Borrower, and Investor. Staff roles inside Admin: Super
  Admin, Sales Officer, Credit Analyst, Compliance Officer, and Finance Officer.
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
