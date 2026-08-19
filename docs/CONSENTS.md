# SproutUp Consent Evidence Foundation

## Current scope

The policy-neutral consent foundation consists of:

- `consent_documents` — an immutable document key, locale, positive version, title, exact canonical content, lowercase SHA-256 hash, effective/publication times, and optional publishing actor; and
- `consent_acceptances` — immutable evidence that one user accepted one exact document version/hash at a specific time, with optional request and one-way client-context hashes.

No terms, privacy notice, risk disclosure, marketing consent, contract, or other legal content is seeded. The schema does not decide which documents are mandatory for borrower or investor onboarding. It is not an e-signature or private-file storage system.

## Evidence invariants

Document identity is unique by `document_key`, locale, and version. Keys and locales use bounded canonical formats; versions are positive; content and title cannot be empty; evidence hashes are 64-character lowercase SHA-256 values.

Documents and acceptances are append-only. PostgreSQL triggers reject update, delete, and truncate. A correction or replacement must use a new version rather than changing previously accepted content. A user may accept a particular immutable document version at most once.

A database trigger requires `accepted_content_sha256` to equal the referenced immutable document hash. This makes an acceptance self-describing and detects an application attempting to bind evidence to the wrong content version. The future publication service must compute and verify the document hash from the exact UTF-8 content before insert; PostgreSQL currently validates hash shape and acceptance linkage, not SHA-256 computation.

## Implemented internal service boundaries

`apps/api/src/consents/consent-service.ts` provides three internal primitives:

1. publication retains the exact supplied UTF-8 text, computes its SHA-256 hash, uses key/locale/version as the stable identity, resolves only byte-for-byte/title/effective-time exact retries, rejects changed reuse, and appends `consent_document.published` audit evidence atomically;
2. latest-effective lookup returns the highest effective document for one exact key/locale at a caller-supplied time and never mutates or hides historical rows; and
3. acceptance requires an existing user, exact document ID/hash, and an already-effective document, resolves repeat acceptance without duplicate evidence, optionally retains one-way client-context hashes, and atomically appends `consent_document.accepted` audit evidence.

Publication and acceptance each expose transaction-aware functions for composition with an owning domain state change. The convenience service methods own their own transactions and must not be called from inside a separate domain transaction.

These primitives do not decide which version is mandatory. Before any route is exposed, onboarding completeness must reference explicit approved document keys/versions rather than a generic “consented” flag, and the caller must enforce the approved required/latest/re-consent policy.

There is intentionally no HTTP API or seed data yet. The publication function is an internal technical boundary, not authorization to publish. Content ownership, legal approval authority, required document matrix, change notification, re-consent, consent withdrawal where applicable, retention, localization, and client-context hashing policy remain decisions for task 05 and the relevant legal/privacy owners.

## Separation from files and signatures

Consent content is stored as exact text evidence in PostgreSQL. Private uploaded evidence requires separate object storage, malware scanning, authorization, retention, and download-audit controls. Contract signatures require their own signer/envelope/artifact model and legal provider decision. Neither capability should overload these tables.
