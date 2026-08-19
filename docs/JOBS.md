# SproutUp Durable Job Foundation

## Current scope

The provider-neutral persistence layer is implemented in PostgreSQL through `background_jobs` and `background_job_attempts`. It is the common durability boundary for future notifications, provider calls, signing, financial orchestration, reconciliation, and exports. No external queue or scheduler provider has been selected, and no production job topic is registered yet.

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

The database enforces a positive bounded retry budget (1–100), attempt count within that budget, priority 0–1000, paired lease owner/expiry, an active lease only while processing, and consistent success/cancellation timestamps. Attempts have a unique `(job_id, attempt_number)` and cannot record an outcome without a finish time or a finish time without an outcome.

## Required next service boundary

The worker service must add all of the following before this foundation is production-operational:

- transactional idempotent enqueue with safe duplicate retrieval;
- bounded `FOR UPDATE SKIP LOCKED` claims ordered by availability/priority/age;
- lease heartbeat and expired-lease recovery;
- success, retry with bounded backoff, dead-letter, and cancellation transitions;
- append-only business audit evidence for operator replay/cancellation;
- redacted structured logs, metrics, alerts, and a tested recovery runbook; and
- graceful shutdown that stops claiming, finishes or hands off work, then closes the database.

Financial handlers must still enforce their own posting/provider idempotency keys. A job lease prevents concurrent processing; it is not a substitute for an authoritative financial uniqueness constraint.
