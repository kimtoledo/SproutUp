# 22 — Maker/Checker Approval Matrix

**Status:** WIP  
**Outcome:** High-risk compliance and financial operations require explicit separation of duties, evidence, and auditable approval before execution.

## Implementation progress

- **2026-08-19 — Reusable approval foundation and role assignment:** Added `approval_requests` for current workflow state and append-only `approval_actions` for proposed/approved/executed/expired evidence.
- Role assignment is the first controlled command. Its exact canonical target/role payload is SHA-256 bound, expires after 24 hours, permits only one equivalent pending proposal, locks the request during approval, and creates the grant in the checker's transaction.
- Role revocation now uses the same controlled boundary and locks all target grants before execution so an active account cannot lose its final role through concurrent/stale review.
- API and service tests prove capability denial, maker/checker separation, atomic execution, and restricted self-target/`super_admin` paths. Database tests prove approval actions cannot be updated, deleted, or truncated.
- The cross-domain command/threshold matrix, rejection/cancellation/amendment flows, alerting, emergency override, and financial command integrations remain; this task stays **WIP**.

## Scope

- Catalogue commands that are view-only, propose, approve, execute, reverse/correct, override, export, or administer.
- Define maker/checker requirements for KYC decisions, underwriting/offer approval, campaign publish, disbursement, wallet adjustments, withdrawals, borrower-payment allocation, investor distribution, restructuring, write-off, and permission changes.
- Prevent self-approval and enforce incompatible-role constraints.
- Record proposal payload, evidence, reason, risk flags, maker/checker identities, timestamps, and before/after snapshots.
- Handle expiry, cancellation, rejection, amendment, duplicate approval, stale state, and emergency override.
- Add thresholds for amount/risk-based additional approval where approved by policy.

## Acceptance criteria

- No configured dual-control command can execute with one actor or a stale proposal.
- Approval uses the exact version/hash of the proposed command and evidence.
- Authorization is enforced in the API/domain boundary and covered by negative tests.
- Audit and reconciliation reports distinguish proposed, approved, executed, failed, corrected, and reversed states.
- Emergency overrides are narrowly permissioned, reasoned, alerted, and independently reviewed.

## Dependencies

- Tasks 02, 06–13, 15, and 18.
- [Legacy admin control review](../reference/legacy/admin/03-operational-workflows-state-changes.md).

## Open decisions

- Final approval matrix, monetary thresholds, delegated authority, emergency process, and whether some low-risk pilot actions may use post-review.
