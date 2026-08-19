# 20 — Admin Information Architecture & Work Queues

**Status:** WIP  
**Outcome:** Staff can find, prioritize, and complete pilot operations through role-scoped queues instead of navigating a copy of the legacy module tree.

## Implementation progress

- **2026-08-19 — Initial compliance queue API:** Added a bounded borrower/investor onboarding queue with case-type, status, and assigned-to-me filters plus applicant identity context.
- Queue read and review-start use separate capabilities. Review start claims submitted work with applicant/reviewer separation, assignment-takeover denial, optimistic versioning, and immutable event/audit evidence.
- The assigned reviewer can issue a reasoned information request; unassigned reviewers are denied, and applicant resubmission returns the same case/version timeline to the queue.
- Added protected case detail linking queue rows to applicant identity, current state/version/assignment, and the ordered immutable workflow timeline.
- The assigned reviewer can now reject an in-review case with an exact version and reason. The queue state, decision timestamp, event, and audit record update atomically; approval remains policy-gated.
- Added `/admin/onboarding`, a responsive server-permission-driven workspace with bounded pagination, journey/status/assigned-to-me filters, matching total count, claim/resume review, assigned-reviewer-only information request/rejection, pending/error/empty states, and authoritative refresh after commands.
- SLA/aging/priority definitions, assignment policy beyond first claim, saved views, escalation, bulk actions, UI/navigation, and other domain queues remain; this task stays **WIP**.

## Scope

- Define admin navigation around KYC/compliance, underwriting, campaign readiness, funding, disbursement, collections, withdrawals, reconciliation, and exceptions.
- Specify queue columns, filters, aging/SLA indicators, ownership, assignment, priority, and bulk-action limits.
- Provide global search for customer, application, campaign, loan, commitment, payment, and transaction references.
- Define linked record detail pages with timeline, documents, decisions, money movements, and next valid actions.
- Standardize empty, loading, stale-data, permission-denied, conflict, and provider-error states.
- Preserve deep links and filter state for operational handoff without exposing sensitive criteria.

## Acceptance criteria

- Every MVP 1 operational state has exactly one primary owning queue and an escalation path.
- Queue counts reconcile to the same filtered query used by the detail list.
- Staff can move from an exception to its customer, loan, ledger entries, evidence, and audit trail.
- Actions shown in the UI are derived from server capabilities and re-authorized on execution.
- Accessibility and responsive behavior are verified for the supported staff devices.

## Dependencies

- Tasks 02, 03–15, and 18.
- [Legacy admin navigation review](../reference/legacy/admin/02-navigation-modules-screens.md).

## Open decisions

- Queue ownership, SLA targets, assignment policy, escalation rules, saved-view scope, and bulk-action policy.
