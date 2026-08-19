# 19 — Scheduler, Queues & Job Control

**Status:** WIP  
**Outcome:** Critical asynchronous work runs once as intended, is observable, and can be recovered without corrupting financial state.

## Implementation progress

- **2026-08-19 — Durable persistence foundation:** Added `background_jobs` and `background_job_attempts` through generated migration `0009_moaning_argent.sql`.
- Jobs have globally unique namespaced idempotency keys, minimum payloads, availability/priority ordering, bounded retry budgets, explicit processing leases, retry/dead-letter/cancel/success states, and consistent terminal timestamps.
- Attempts have unique job/attempt numbers, worker/lease attribution, and paired outcome/finish evidence. Migration tests cover duplicate work, missing leases, retry overflow, duplicate attempts, and incomplete terminal attempt records.
- Added transaction-aware enqueue so domain state and required work roll back together; exact retries safely return the existing job while the same key with a different topic/payload returns an idempotency conflict. Sensitive payload keys are rejected.
- Added bounded priority/availability claims with `FOR UPDATE SKIP LOCKED`, worker leases/heartbeats, stale settlement denial, exponential retry, attempt-budget dead-lettering, expired-lease recovery, terminal success, and cancellation limited to unleased work.
- Added custom migration `0010_job-attempt-evidence.sql` so active attempts may heartbeat/settle once while completed evidence cannot be changed, deleted, or truncated.
- Seven service integration tests cover atomic rollback, duplicate/conflicting enqueue, sensitive payload denial, exclusive/ordered claims, heartbeats/success, retry/dead-letter, lease recovery/stale workers, and cancellation.
- Topic registry/handlers, worker loop/scheduler, operational replay API/audit, metrics/alerts, provider choice, retention, and per-job runbooks remain; this task stays **WIP**.

## Scope

- Inventory MVP 1 scheduled, event-driven, and manual jobs with owner and trigger/cadence.
- Implement unique work claims/locks, bounded batches, timeouts, retries/backoff, idempotency, and dead-letter handling.
- Add job run/attempt records, business progress metrics, heartbeats, alerts, replay, and cancellation controls.
- Separate ordinary production jobs from migrations, diagnostics, and audited break-glass corrections.
- Cover email/SMS, document signing, campaign publication, payment processing, repayment/distribution, reminders, reconciliation, and exports.

## Acceptance criteria

- Concurrent workers cannot duplicate investments, ledger postings, distributions, or notifications.
- Failed work retains safe retry/recovery context and never requires direct balance edits.
- Every production job has an owner, runbook, service objective, alert, and tested recovery path.
- No production command contains hardcoded record IDs, recipients, dates, rates, or secrets.
- Scheduler configuration is version-controlled and environment-independent except for secrets/capacity.

## Dependencies

- Tasks 05, 07, 09–12, 14, and 15 — document signing, campaign publication, payment processing, repayment/distribution runs, notifications, and reconciliation/exports are the domain jobs this task orchestrates, retries, and recovers.

## Legacy reference

- [Cron & console inventory](../reference/legacy/api-v1-1/04-cron-console-inventory.md)

## Open decisions

- PostgreSQL is the approved durable source of job/outbox truth; an external delivery/notification layer may be added later but cannot replace transactional database acceptance.
- Queue/scheduler technology beyond PostgreSQL, worker topology, concurrency limits, retention, and break-glass approval model remain open.
