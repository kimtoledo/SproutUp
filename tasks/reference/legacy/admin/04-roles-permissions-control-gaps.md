# 04 — Roles, Permissions & Control Gaps

## Legacy roles

The `Admin` model defines these identifiers:

1. Superadmin
2. Admin
3. Manager (defined but hidden in current role lists)
4. Introducer, displayed as Manager
5. Credit User
6. Finance
7. Business Development
8. IT
9. Marketing
10. Agency
11. Credit Dashboard
12. Digital Marketing

These do not map one-to-one to the target roles: Super Admin, Sales Officer, Credit Analyst, Compliance Officer, and Finance Officer.

## Authorization mechanism

- Permissions are database records containing a primary route and comma-separated sub-routes.
- Role-permission rows are loaded into `allowedActions` on a request.
- Superadmin receives all routes; Admin receives all except a small `superAdminOnly` list.
- Navigation visibility calls `hasLinkPermission`, while controllers call `checkPermission` through `BackendController`.
- Several authentication/system routes are globally allowed, and the safe-database list remains available during maintenance mode.

## Gaps and risks

- Permissions bind to controller route strings, so renames and new endpoints can silently change access behavior.
- UI visibility and server authorization depend on the same mutable route list but are still separate enforcement points.
- Role names are ambiguous: legacy “Manager” and “Introducer” share presentation, and some declared roles are absent from creation options.
- Admin has extremely broad access; the superadmin-only deny list is narrow.
- There is no clear separation-of-duties policy for maker/checker actions.
- Object-level access is implemented ad hoc, particularly for introducer-owned customers.
- Permission changes themselves need stronger approval and audit semantics.

## Target mapping direction

Create capability-based policies for subjects and objects, then assign those capabilities to approved roles. At minimum, distinguish read, propose, approve, execute, export, override, and administer. Deny-by-default API authorization must be the enforcement source; menus should consume the same policy result.
