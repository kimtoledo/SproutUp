# Portal Identity Isolation

**Status:** Portal identity, runtime authentication, staff RBAC, ownership, and legacy-auth cutover implemented.

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

Migration `0024_customer-auth-cutover.sql` performs the final customer runtime cutover. It copies
and exactly reconciles any borrower/investor accounts and password credentials created after the
earlier backfill, invalidates every remaining legacy customer session, verification, and rate-limit
record, removes legacy customer role grants, and makes the old account/session/grant namespace
write-inert. Historical customer role definitions remain inactive only because immutable approval
evidence may reference them; they are not active authority.

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

Each portal now has an independent runtime boundary:

| Portal | Auth route | Session context | Cookie prefix |
| --- | --- | --- | --- |
| Admin | `/v1/auth/admin/*` | `/v1/admin/session-context` | `sproutup_admin` |
| Borrower | `/v1/auth/borrower/*` | `/v1/borrower/session-context` | `sproutup_borrower` |
| Investor | `/v1/auth/investor/*` | `/v1/investor/session-context` | `sproutup_investor` |

Public admin signup is rejected; staff provisioning remains a controlled operation. Borrower and
investor signup create records only in their matching physical namespace. A credential from one
namespace receives the same non-enumerating authentication failure at either other namespace. The
unscoped legacy `/v1/auth/*` wildcard and `/v1/session-context` no longer exist.

The admin, borrower, and investor web hosts have independent marketing and auth presentation; host
selection never grants authority. Each protected request resolves the matching HTTP-only session
cookie and active physical account. Admin context then resolves staff RBAC; borrower/investor
contexts return their account class with no roles and only the fixed class capabilities. A request
carrying both customer cookie classes is rejected instead of guessing an identity.

Migration `0022_mean_toad_men.sql` moves staff grants into `admin_role_grants`, repoints approval
maker/checker/action, permission-grant attribution, and assigned-reviewer foreign keys to
`admin_accounts`, and reconciles the copy before cleanup. It revokes legacy admin credentials and
sessions and removes every legacy role grant for admin IDs. Its transitional database triggers
permitted only customer compatibility roles in `user_roles` and rejected new legacy auth material
for admin IDs; migration `0024` later replaced those triggers with unconditional legacy-namespace
retirement guards.

Migration `0023_real_daredevil.sql` removes the remaining domain ownership dependency on legacy
`users`. Onboarding applicants, onboarding event actors, document owners/uploaders, consent
acceptors, and ledger actors now reference immutable `account_email_registry.account_id` values;
admin-only rule and consent publishers reference `admin_accounts` directly. A database trigger
requires every onboarding case type to match its borrower or investor account class and rejects an
admin applicant. The migration fails before changing constraints if any existing reference is
unclassified or mismatched, then writes an aggregate immutable reconciliation event.

## Cutover sequence

The new relations were additive in the foundation commit. The existing `users` / `accounts` /
`sessions` boundary remained temporarily active while deployed data and foreign keys migrated
forward safely. The completed sequence was:

1. **Done:** classify each legacy `users` record into exactly one account class, with staff identity
   taking precedence and ambiguous customer records rejected for operator review;
2. **Done:** copy credential/session evidence into the matching namespace without exposing password
   hashes, with exact count reconciliation;
3. **Done:** move staff RBAC/approval/reviewer foreign keys to `admin_accounts` and shared actor or
   owner references to the globally unique portal-account registry, with onboarding class matching;
4. **Done:** mount separate Better Auth boundaries with distinct route, cookie, session, and
   server-resolved context namespaces;
5. **Done:** remove public customer-role selection and disable the legacy `/v1/auth/*` boundary;
   and
6. **Done:** reconcile counts, email ownership, invalidated legacy sessions, onboarding ownership,
   and immutable cutover evidence before accepting traffic.

Portal identity isolation itself is complete. Password-reset/email-verification delivery over a
swappable, audited provider port is implemented; the approved transactional-email vendor, the
forgot-password/reset-password/verify-email web pages, MFA/step-up policy, and the remaining
controls listed in `SECURITY.md` are separate release gates.
