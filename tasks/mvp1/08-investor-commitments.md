# 08 — Investor Commitments

**Status:** WIP  
**Outcome:** Approved investors can safely commit available funds to an active campaign.

## Scope

- Campaign discovery/detail, risk disclosure, amount entry, confirmation, and investment record.
- Eligibility, campaign-window, minimum/maximum, available-balance, and overfunding validation.
- Atomic wallet hold on commitment and release on rejection, cancellation, or failed funding.
- Investor agreement and transaction receipt.

## Acceptance criteria

- Concurrent commitments cannot overfund a campaign or overspend an investor wallet.
- A commitment and its hold are created or rejected atomically.
- Duplicate requests are idempotent.
- Investors see gross expected cash flows and clear risk disclosures before confirmation.
- Manual investing works without auto-invest.

## Legacy reference

- [Investments & Auto-Invest](../reference/legacy/domain-investments-autoinvest.md)

## Dependencies

- Approved investor, active campaign, immutable ledger, and document/consent service.
