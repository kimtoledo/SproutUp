# 05 — Document & Consent Management

**Status:** WIP  
**Outcome:** Compliance and loan documents are stored, versioned, reviewed, and retrievable securely.

## Implementation progress

- **2026-08-19 — Immutable consent evidence schema:** Added policy-neutral `consent_documents` and `consent_acceptances` with canonical key/locale/version identity, exact text and SHA-256 content evidence, publication/effective attribution, and optional request/client-context hashes.
- PostgreSQL prevents document/acceptance update, deletion, and truncation; unique constraints prevent duplicate user/version acceptance; a trigger rejects an accepted hash that differs from the referenced immutable document.
- No legal content is seeded and no publication/read/acceptance route exists. Required document policy, legal approval authority, re-consent/withdrawal, retention, private upload, scanning, storage, and e-signature controls remain unimplemented; this task stays **WIP**.

## Scope

- Typed uploads for borrower, investor, credit, campaign, and repayment evidence.
- File validation, malware scanning, access authorization, retention, and download audit.
- Versioned terms, privacy notices, risk disclosures, and recorded user consent.
- Generated loan/investment documents and e-signature status tracking.

## Acceptance criteria

- Private files cannot be accessed through guessable public URLs.
- File type, size, integrity, and malware checks run before acceptance.
- The exact document/terms version accepted by a user is provable.
- Replacement documents retain history rather than silently overwriting evidence.
- Signed artifacts are linked to the correct borrower, campaign, and investor transaction.

## Legacy reference

- [User Accounts, KYC & Onboarding](../reference/legacy/domain-user-accounts-kyc.md) — `UserDocument` typed upload model (43 enumerated identity/address/business/signature/photo document types, `status` Active/Inactive); DocuSign contract generation/dispatch (`User::getContractFile()`, `User::sendDocSign()`) with per-document-type sign-tab positioning and `DocSign` envelope-status tracking (`doc_id`/`reset_profile_doc_id`).
- [Wallet, Withdrawals & Payment Gateways](../reference/legacy/domain-payments-wallet-gateways.md) — notes DocuSign is adjacent to the payments domain only insofar as `ServerRequestController::actionUpdateStatus` gates profile approval on contract e-signature, sharing the same generic `requests` approval queue (`type = contract-signature`, among other types).

## Dependencies

- [03 — Borrower Onboarding & KYC](./03-borrower-onboarding-kyc.md) — typed uploads for borrower KYC/KYB evidence require the borrower profile and application records this task attaches to.
- [04 — Investor Onboarding & KYC](./04-investor-onboarding-kyc.md) — typed uploads for investor evidence require the investor profile records this task attaches to.

## Open decisions

- Required consent-document keys, content owners/approvers, localization, effective/re-consent rules, and consent withdrawal semantics.
- E-signature provider and legally required document set.
- Retention periods, deletion restrictions, and storage region.
