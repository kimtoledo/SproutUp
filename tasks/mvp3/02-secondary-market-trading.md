# 02 — Secondary Market Trading

**Status:** WIP / Requires explicit product and regulatory approval  
**Outcome:** Eligible investors may transfer investment positions through a controlled resale marketplace.

## Scope

- Eligibility, listing, minimum/buy-now price, bidding, expiry, cancellation, and seller acceptance.
- Bidder wallet holds, competing-bid release, settlement, fees/taxes, and ownership transfer.
- Accrued/prorated payment rights, borrower-payment timing, audit history, and operations report.

## Acceptance criteria

- Legal/compliance approval defines whether and how this market may operate.
- Self-trading, double sale, overspending, expired actions, and duplicated settlement are blocked.
- Seller/buyer principal and accrued return entitlements reconcile before and after transfer.
- Failed or cancelled activity releases all holds deterministically.
- Trading cannot mutate historical ownership or repayment records.

## Legacy reference

- [Secondary Market Trading](../reference/legacy/domain-secondary-market-trading.md)

## Open decisions

- Whether this feature belongs in the Philippine product at all, eligibility, pricing rules, transfer fees/taxes, disclosures, and liquidity model.
