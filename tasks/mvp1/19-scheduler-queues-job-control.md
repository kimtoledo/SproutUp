# 19 — Scheduler, Queues & Job Control

**Status:** WIP  
**Outcome:** Critical asynchronous work runs once as intended, is observable, and can be recovered without corrupting financial state.

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

- Queue/scheduler technology, worker topology, concurrency limits, retention, and break-glass approval model.
