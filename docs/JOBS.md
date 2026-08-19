# SproutUp Durable Job Foundation

## Current scope

The provider-neutral persistence and control service are implemented through PostgreSQL `background_jobs` and `background_job_attempts` plus `apps/api/src/jobs/job-control-service.ts`. They are the common durability boundary for future notifications, provider calls, signing, financial orchestration, reconciliation, and exports. No external queue or scheduler provider has been selected, no worker loop is started by the application, and no production job topic is registered yet.

Domain services will enqueue a job in the same database transaction as the state change that requires asynchronous work. The globally unique `idempotency_key` must be namespaced by domain and command identity, for example `onboarding:case-submitted:<case-id>:<version>`. Payloads contain only the minimum identifiers and non-sensitive execution context; credentials, tokens, cookies, raw private documents, and secrets are prohibited.

## Job states

| State | Meaning |
| --- | --- |
| `pending` | Newly accepted durable work, available now or at `available_at` |
| `processing` | Exclusively leased to one worker until `lease_expires_at` |
| `retry_scheduled` | A failed attempt is retained and delayed for a later claim |
| `succeeded` | Terminal success with `completed_at` |
| `dead_lettered` | Retry budget exhausted or failure classified non-retryable |
| `cancelled` | Terminal operator/domain cancellation with `cancelled_at` |

The database enforces a positive bounded retry budget (1–100), attempt count within that budget, priority 0–1000, paired lease owner/expiry, an active lease only while processing, and consistent success/cancellation timestamps. Lower priority numbers are claimed first, followed by availability and creation order. Attempts have a unique `(job_id, attempt_number)` and cannot record an outcome without a finish time or a finish time without an outcome. Migration `0010_job-attempt-evidence.sql` permits active heartbeats and first settlement but rejects later terminal edits, row deletion, and table truncation.

## Implemented service boundary

Use `enqueueDurableJob(transaction, input)` inside the owning domain transaction. A failed domain transaction rolls back its job. `createJobControlService(database)` provides idempotent standalone enqueue, bounded priority claims with `FOR UPDATE SKIP LOCKED`, 1-second to 15-minute leases, heartbeats, success, exponential retry, dead-letter settlement, expired-lease recovery, and cancellation of work that has not been leased.

Every settlement requires the current worker ID, attempt number, and an unexpired lease. A stale or different worker cannot settle another attempt. Retry delay starts at five seconds, doubles by attempt, and is capped at 15 minutes unless the service is constructed with another tested bounded policy. A job is dead-lettered when failure is non-retryable or its attempt budget is exhausted.

Leased work cannot be cancelled synchronously because its external side effect may already have started. Future cooperative cancellation must use a separate requested state/handler handshake rather than falsely marking in-flight work cancelled.

## Required next runtime boundary

The runtime must add all of the following before this foundation is production-operational:

- a topic registry with versioned payload validation and handler ownership;
- a worker loop that stops claims during shutdown and safely finishes or hands off leases;
- append-only business audit evidence for operator replay/cancellation;
- redacted structured logs, metrics, alerts, and a tested recovery runbook; and
- retention/archival rules and an approved operational replay API.

Financial handlers must still enforce their own posting/provider idempotency keys. A job lease prevents concurrent processing; it is not a substitute for an authoritative financial uniqueness constraint.
