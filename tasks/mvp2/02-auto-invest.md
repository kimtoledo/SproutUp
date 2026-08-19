# 02 — Auto-Invest

**Status:** WIP  
**Outcome:** Investors can define rules that allocate available funds fairly and safely to eligible campaigns.

## Scope

- Enable/disable agreement and configurable amount, rate, term, risk, industry, and concentration rules.
- Deterministic eligible-investor selection and allocation under campaign/investor limits.
- Atomic wallet holds, allocation run records, explanations, and rollback on failure.
- Preview, history, notifications, and investor cancellation behavior.

## Acceptance criteria

- Auto-invest cannot bypass KYC, suitability, balance, concentration, or campaign rules.
- Concurrent manual and automatic investments cannot overspend or overfund.
- Every allocation records the rule version and reason for selection or exclusion.
- Re-running a failed job is idempotent and does not duplicate commitments.

## Legacy reference

- [Investments & Auto-Invest](../reference/legacy/domain-investments-autoinvest.md)

## Open decisions

- Fairness order, reservation percentage, allocation increment, and concentration limits.
