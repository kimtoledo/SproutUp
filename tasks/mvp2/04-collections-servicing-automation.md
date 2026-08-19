# 04 — Collections & Servicing Automation

**Status:** WIP  
**Outcome:** Due and delinquent loans are managed through consistent reminders, queues, and escalation rules.

## Scope

- Upcoming/due/overdue reminders, aging buckets, automated case creation, and assignment.
- Collection activities, contact attempts, promises to pay, disputes, restructures, and approved waivers.
- Configurable penalty accrual and escalation with maker-checker controls for adjustments.
- Portfolio delinquency and recovery reporting.

## Acceptance criteria

- Status and aging are derived consistently from due dates, cleared receipts, and approved grace rules.
- Automated notices are idempotent and respect approved communication policies.
- Waivers, restructures, and write-off-related actions require authorization and audit history.
- Loan, ledger, collection case, and report balances remain reconciled.

## Open decisions

- Collections strategy, grace periods, penalty rules, restructuring policy, write-off authority, and communication cadence.
