# 05 — Document & Consent Management

**Status:** WIP  
**Outcome:** Compliance and loan documents are stored, versioned, reviewed, and retrievable securely.

## Implementation progress

- **2026-08-19 — Immutable consent evidence schema:** Added policy-neutral `consent_documents` and `consent_acceptances` with canonical key/locale/version identity, exact text and SHA-256 content evidence, publication/effective attribution, and optional request/client-context hashes.
- PostgreSQL prevents document/acceptance update, deletion, and truncation; unique constraints prevent duplicate user/version acceptance; a trigger rejects an accepted hash that differs from the referenced immutable document.
- Added internal transaction-aware services that compute exact UTF-8 content SHA-256, publish immutable versions with conflict-safe retries and audit, select the latest effective key/locale at a given time, and accept an exact effective document once per user with atomic audit evidence.
- No legal content is seeded and no publication/read/acceptance route exists. Required document policy, legal approval authority, re-consent/withdrawal, retention, private upload, scanning, storage, and e-signature controls remain unimplemented; this task stays **WIP**.
- **2026-08-30 — Private document store (slice S1.2a):** Added `documents` + append-only `document_versions` (migrations `0017`/`0018`): owner, coarse classification, `purpose` tag; a version's identity/content/provenance is immutable, versions cannot be deleted or truncated, and the only mutable fields are the malware-scan outcome (`scan_state`/`scanned_at`) and `retention_until`. Added a swappable `FileStorage` port (`apps/api/src/storage/`, in-memory + local-filesystem impls; keys are opaque generated ids, never user paths) and an internal `DocumentService` — create/add-version (atomic metadata + audit, orphaned-object cleanup on failure), record-scan-result (once, `pending → clean/infected/error`), API-mediated download hard-gated on `scan_state = 'clean'` with owner/staff authz, and list-own. Content type is allowlisted (PDF/JPEG/PNG), size cap 20 MiB. **No HTTP route, no e-signature, no retention job, and no `documents.*` capability yet** — those land with the borrower KYB upload form (task 03) and the approved retention policy. Legal-content and required-consent-matrix decisions are unchanged. See [`../../docs/DOCUMENTS.md`](../../docs/DOCUMENTS.md).
- **2026-08-30 — Portal-account attribution cutover:** Document owner/uploader and consent acceptor
  foreign keys now use the immutable global account registry; consent publication is admin-only at
  the database boundary. Existing references are preflighted before migration and exact aggregate
  counts are retained in immutable cutover audit evidence.

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
