# Portal Identity Isolation

**Status:** Foundation, legacy backfill, and administrator runtime boundary implemented; customer runtime/foreign-key cutover in progress.

SproutUp treats administrator, borrower, and investor as separate account classes. Borrower and
investor are not target RBAC roles and a credential issued in one portal must never authenticate
against another portal.

## Database boundary

Migration `0019_faithful_siren.sql` creates physically separate identity namespaces:

| Portal | Account | Credentials | Sessions | Verification | Rate limits |
| --- | --- | --- | --- | --- | --- |
| Admin | `admin_accounts` | `admin_credentials` | `admin_sessions` | `admin_verifications` | `admin_rate_limits` |
| Borrower | `borrower_accounts` | `borrower_credentials` | `borrower_sessions` | `borrower_verifications` | `borrower_rate_limits` |
| Investor | `investor_accounts` | `investor_credentials` | `investor_sessions` | `investor_verifications` | `investor_rate_limits` |

Migration `0020_portal-identity-isolation.sql` binds every account insert to
`account_email_registry`. Normalized email is globally unique across all three account classes, so
an investor email cannot later register as a borrower or administrator. Account IDs are also
globally unique. Account ID and email are immutable, and account rows cannot be deleted or
truncated; access is removed by changing status so attribution remains intact.

Migration `0021_backfill-portal-identities.sql` classifies and copies legacy identities. Any staff
role takes precedence over stale customer-role grants. A non-staff record must have exactly one of
the legacy borrower/investor roles; both or neither abort the migration before any copy. Account,
credential, and session counts must reconcile exactly before an immutable summary audit event is
written. Verification and rate-limit rows are intentionally invalidated instead of copied because
their legacy keys do not carry a trustworthy account foreign key.

Run `npm run db:report-identity-cutover` before applying the backfill. Its output contains aggregate
counts and opaque exception user IDs/role keys only; it does not print email addresses or password
material.

## Authorization model

- `admin_accounts` use staff RBAC: Super Admin, Sales Officer, Credit Analyst, Compliance Officer,
  and Finance Officer.
- `borrower_accounts` receive borrower-owned capabilities from their account boundary, not from an
  `sme_borrower` role grant.
- `investor_accounts` receive investor-owned capabilities from their account boundary, not from an
  `investor` role grant.
- API services still authorize ownership and operational capability on the server. A subdomain or
  browser-selected account type is never authority.

## Active portal boundary

The administrator portal now signs in only through `/v1/auth/admin/*`, stores sessions only in
`admin_sessions`, and uses the distinct HTTP-only `sproutup_admin` cookie namespace. Public admin
signup is rejected by the Fastify boundary; staff provisioning remains a controlled operation.
`GET /v1/admin/session-context` resolves an active `admin_accounts` row and staff roles only, and
all current staff operations use that resolver. The admin, borrower, and investor web hosts have
independent marketing and auth presentation; host selection never grants authority.

Borrower and investor login/registration temporarily continue through the legacy compatibility
boundary while their ownership foreign keys are migrated. Their separate target tables are already
backfilled, but they must not be called the active customer auth source yet.

## Cutover sequence

The new relations are additive in the foundation commit. The existing `users` / `accounts` /
`sessions` boundary remains temporarily active so deployed data and all existing foreign keys can
be migrated forward safely. Before release, the cutover must:

1. **Done:** classify each legacy `users` record into exactly one account class, with staff identity
   taking precedence and ambiguous customer records rejected for operator review;
2. **Done:** copy credential/session evidence into the matching namespace without exposing password
   hashes, with exact count reconciliation;
3. move staff RBAC foreign keys to `admin_accounts` and customer ownership to the matching borrower
   or investor account;
4. **Admin done:** mount separate Better Auth boundaries and distinct cookie names for admin,
   borrower, and investor; borrower/investor remain;
5. remove public customer-role selection and disable the legacy `/v1/auth/*` boundary; and
6. reconcile counts, email ownership, active sessions, onboarding ownership, and audit attribution
   before accepting traffic.

Until that sequence is complete, portal identity isolation is a release blocker and the new tables
must not be described as the active authentication source.
