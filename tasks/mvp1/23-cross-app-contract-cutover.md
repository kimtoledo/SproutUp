# 23 — Cross-App Contract, Compatibility & Cutover

**Status:** WIP  
**Outcome:** Legacy and revamp user/admin surfaces can coexist and cut over without competing sources of truth, lost obligations, or inconsistent financial results.

## Scope

- Map each user/admin operation to an authoritative versioned API command or query.
- Inventory direct legacy database/model/file paths and decide block, proxy, adapt, or retire.
- Define old-client compatibility windows, deprecation headers, capability/version negotiation, and telemetry.
- Assign one write owner per domain during every migration stage.
- Provide data-sync/reconciliation rules for identities, applications, campaigns, commitments, wallets, loans, schedules, payments, distributions, documents, and audit history.
- Define canary cohorts, rollback boundaries, freeze windows, and final legacy route shutdown.

## Acceptance criteria

- A contract matrix identifies caller, authorization, payload, response, side effects, idempotency, and target disposition for every MVP 1 operation.
- No domain accepts conflicting writes from legacy and revamp paths during cutover.
- Shadow/read comparisons expose material differences before a cohort is migrated.
- Cutover and rollback drills reconcile balances, open positions, schedules, and document references.
- Token-in-URL and unauthorized direct-file patterns are removed from the target path.

## Dependencies

- Tasks 16–18 and 21–22.
- [Cross-application workflow map](../reference/legacy/09-cross-application-workflows.md).

## Open decisions

- Big-bang versus phased rollout, supported legacy client versions, dual-run duration, acceptable comparison tolerances, and rollback time objective.
