# 02 — Authentication, RBAC & Audit

**Status:** WIP  
**Outcome:** Secure access for staff, SME borrowers, and investors with traceable privileged activity.

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

## Legacy findings to reconcile

- The back office defines 12 legacy role IDs and database-configured route permissions; these do not map directly to the five target staff roles.
- Broad Admin access, a narrow superadmin-only deny list, and ad hoc object-level introducer checks require deny-by-default replacement policies.
- High-risk action separation is specified separately in [Task 22](./22-maker-checker-approval-matrix.md).
- See the [legacy role and permission review](../reference/legacy/admin/04-roles-permissions-control-gaps.md).
