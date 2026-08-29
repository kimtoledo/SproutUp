# 13 — Accounting & Tax Baseline

**Status:** WIP  
**Outcome:** Pilot transactions produce configurable, reviewable Philippine accounting and tax outputs.

## Implementation progress

- **2026-08-30 — Configuration mechanism ready (slice S0.2):** The effective-dated `rule_sets` /
  `rule_versions` primitive and `resolve(key, at)` service that this task's fee/VAT/withholding/DST
  rates and bases will be published to are implemented (immutable, monotonically versioned,
  effective-dated `jsonb` bodies; `config_rule.published` audit). See
  [`../../docs/CONFIG.md`](../../docs/CONFIG.md). No tax/fee bodies are seeded yet — they are
  published here once Finance/BIR advice is available, and until then as `ASSUMED FOR PILOT`
  placeholders with the rule version recorded on every posting.

## Scope

- Versioned configuration for platform fees, VAT or percentage tax, investor-interest withholding, DST, and referral withholding placeholders.
- Transaction-level gross, taxable base, rate, tax, net, effective date, and rule-version storage.
- Baseline chart-of-accounts mapping and journal export for funding, disbursement, repayment, distribution, fees, taxes, and withdrawals.
- Tax summaries and downloadable supporting schedules for Finance review.

## Acceptance criteria

- No tax or fee rate is hardcoded in transaction logic.
- Historical transactions retain the rule version and amounts applied at posting time.
- Journal exports are balanced and traceable to ledger transactions.
- Zero-rated, exempt, not-applicable, and withheld outcomes are distinguishable.
- Finance signs off approved examples before pilot launch.

## Dependencies

- Written advice from Philippine accounting, tax, legal, and compliance owners.
- Tasks 09–12 — journal export and tax computation require real funding/withdrawal, disbursement, repayment, and distribution ledger events to account for.

## Open decisions

- Exact registrations, tax bases/rates, DST event/timing, certificates, filing formats, and revenue-recognition policy.
