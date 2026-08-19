# 01 — External Accounting Data

**Status:** WIP / Requires confirmation  
**Outcome:** Borrowers can authorize selected accounting data to reduce underwriting effort and improve evidence quality.

## Scope

- OAuth2 connection, consent, token lifecycle, disconnect, and audit history.
- Provider-neutral mapping for company profile, financial statements, and eligible invoice/collateral data.
- Data provenance, reporting period, currency, freshness, validation, and manual-review fallback.
- Start with one provider only after usage and value are confirmed.

## Acceptance criteria

- Tokens are encrypted, least-privileged, revocable, and never logged.
- Imported values retain source, provider field, period, currency, and retrieval timestamp.
- Mapping tests use current provider schemas and approved financial definitions.
- Imported data never auto-approves credit without the approved underwriting controls.

## Legacy reference

- [Accounting Integrations](../reference/legacy/domain-accounting-integrations.md)

## Open decisions

- Provider priority, supported reports, refresh model, retention, and fallback when provider data changes.
