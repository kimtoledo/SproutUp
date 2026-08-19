# SproutUp MVP 1 Job Catalogue

This catalogue prevents infrastructure readiness from being mistaken for authorization to automate unresolved business or provider behavior. A topic may move to **Ready** only when its owning task, payload contract, idempotency invariant, handler owner, service objective, alerts, and recovery runbook are approved.

| Candidate topic/work | Trigger/cadence | Pilot classification | Owner task | Gate before activation |
| --- | --- | --- | --- | --- |
| Authentication verification/recovery delivery | Account/security event | Blocked | 02, 14 | Email/SMS provider, templates, verification/recovery policy |
| OTP/step-up delivery | Protected action | Blocked | 02, 14 | MFA events, recovery/trusted-device policy, provider |
| Onboarding case submission | Applicant command | Synchronous for pilot | 03, 04 | Current state/event/audit transaction is sufficient; add jobs only for approved external checks/notices |
| KYC/AML/sanctions screening | Evidence/profile update or review | Blocked | 03, 04 | Philippine requirements, provider, cadence, result/retention model |
| Document malware scan | Upload accepted | Blocked | 05 | Storage/scanner provider, quarantine and retention policy |
| E-signature envelope dispatch/status | Approved document event/provider callback | Blocked | 05 | Provider, legal document set, callback verification/replay contract |
| Campaign publication/window open/close | Approved terms and scheduled time | Blocked | 07, 22 | Campaign states, partial funding/extension/cancellation policy, approval matrix |
| Funding hold release | Campaign failure/cancellation | Blocked | 07–09 | Campaign and authoritative ledger/hold design |
| Bank transfer/provider event processing | Signed callback/manual evidence | Blocked | 09 | Ledger, bank/provider references, signed webhook/replay contract |
| Disbursement execution | Approved finance command | Manual/synchronous controlled pilot | 10, 22 | Ledger, fee/tax rules, bank evidence, maker/checker matrix; external rail may remain manual |
| Repayment due-state/collection reminders | Schedule cadence | Blocked | 11, 14 | Loan schedule, grace/penalty/allocation policies and templates |
| Borrower receipt allocation | Approved bank receipt | Manual/synchronous controlled pilot | 09–11, 22 | Ledger, waterfall, reversal and dual-control rules |
| Investor distribution | Cleared allocation event | Blocked | 12, 13 | Immutable ownership snapshot, tax/spread/rounding rules, ledger |
| Notification delivery | Versioned domain event | Blocked | 14 | Provider, approved templates/languages, mandatory-notice matrix |
| Large report/export generation | Authorized export request | Blocked | 15 | Report definitions, cutoff/timezone, masking, retention, private-file access |
| Daily ledger/bank reconciliation | Scheduled business cutoff | Blocked | 09, 13, 15, 16 | Ledger, bank statement format, cutoff/timezone, tolerance/exception ownership |
| Migration/import batches | Explicit cutover command | Not an ordinary production job | 16, 17 | Approved mapping/cutoff/reject/rerun/reconciliation plan and separate runbook |
| Diagnostics or break-glass correction | Explicit incident procedure | Not an ordinary production job | 01, 16, 22 | Incident authority, maker/checker, audit, rollback/forward-fix plan |

## Current activation state

There are no **Ready** production topics. `createApplicationJobTopicRegistry()` therefore remains empty and the API server does not start a worker. This is intentional fail-closed behavior, not incomplete wiring.

Expired-lease recovery is infrastructure control executed before each future worker poll; it is not a business topic. Health checks, database migrations, authorization seeding, and startup readiness are also process/operational commands rather than queued domain work.

## Promotion checklist

Before registering a topic:

1. Link the approved owning task and record the exact trigger and handler owner.
2. Define a positive integer `schemaVersion` and bounded Zod payload containing no secrets or raw private evidence.
3. Define the enqueue idempotency key and the handler's separate domain/provider idempotency constraint.
4. Classify retryable and terminal errors using safe stable codes; define maximum attempts and bounded backoff.
5. Define timeout, heartbeat, service objective, metrics, alert threshold, dead-letter response, and replay safety.
6. Add transactional enqueue, handler integration, duplicate/concurrency/recovery tests, and a runbook in one reviewed change.
7. Update this catalogue from **Blocked** or **Synchronous for pilot** to **Ready**, then register the topic explicitly.
