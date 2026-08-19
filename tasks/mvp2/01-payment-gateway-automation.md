# 01 — Payment Gateway Automation

**Status:** WIP  
**Outcome:** Cash-in and approved payouts can be automated through one selected Philippine payment provider.

## Scope

- Provider client, signed requests, verified webhooks, idempotency, retries, and status reconciliation.
- Automated cash-in reference creation and wallet posting after confirmed settlement.
- Finance-approved payout submission with provider status and failure recovery.
- Provider settlement, fee, and exception reports matched to internal ledger entries.

## Acceptance criteria

- Forged, stale, duplicated, or replayed webhooks do not post funds.
- Provider timeouts can be queried/reconciled without duplicating transactions.
- Internal status distinguishes requested, submitted, accepted, settled, failed, and reversed.
- Daily provider totals reconcile to ledger and bank settlement totals.

## Legacy reference

- [Wallet & Payment Gateways](../reference/legacy/domain-payments-wallet-gateways.md)

## Open decisions

- Provider, supported rails, fees, settlement timing, limits, and payout approval boundary.
