# Private document store (`documents` / `document_versions`)

**Status:** schema + storage adapter + internal service implemented (2026-08-30, slice S1.2a).
No HTTP upload/download routes yet — those land with the borrower KYB form (S1.2c), where
`@fastify/multipart` is wired and `documents.*` capabilities are added to the RBAC map.

## Why

Borrower/investor KYC evidence, signed contracts, and financial statements are private files. They
must not be reachable by a guessable URL, must be integrity- and type-checked before acceptance,
must keep history when replaced, and must be malware-scanned. This is the shared store every later
task attaches typed uploads to (tasks 03, 04, 05, 06, 07, 11).

## Model

| Relation | Role |
| --- | --- |
| `documents` | A logical file owned by a user. `owner_user_id`, `classification` (`kyc_identity`/`kyc_address`/`kyc_business`/`financial`/`contract`/`other`), `purpose` (a lowercase dotted tag, e.g. `borrower.sec_registration`). |
| `document_versions` | The immutable uploaded bytes. `version` (monotonic per document), `storage_key` (opaque id into the byte backend — **never** a user path), `content_sha256`, `byte_size`, `content_type`, `original_filename` (display only), `scan_state`, `scanned_at`, `uploaded_by_user_id`, `retention_until`. |

**Invariants (migrations `0017`, `0018`):** a version's identity/content/provenance columns are
immutable (`document_versions evidence columns are immutable`); versions cannot be deleted
(`document_versions rows cannot be deleted`) or truncated; `documents` cannot be deleted/truncated.
The **only** mutable fields on a version are `scan_state` (`pending → clean | infected | error`),
`scanned_at`, and `retention_until`. `(document_id, version)` and `storage_key` are unique;
`byte_size > 0`; `content_sha256` is 64 hex; a resolved `scan_state` requires a `scanned_at`.

## Byte storage — `apps/api/src/storage/`

`FileStorage` (`file-storage.ts`) is a 3-method port: `put` (rejects an existing key), `get`
(`null` if unknown), `delete` (idempotent). Keys are validated by `assertStorageKey` — our
generated ids only, no separators, no `..`.

- `createInMemoryFileStorage()` — tests.
- `createLocalFileStorage(dir)` — development; one flat file per key under `dir`, `wx` write flag.
- S3-compatible adapter — deferred to infrastructure approval; metadata + access policy stay in
  PostgreSQL regardless of backend.

## Service — `apps/api/src/documents/document-service.ts`

`createDocumentService(db, storage, { maxBytes?, clock? })`:

| Method | Behaviour |
| --- | --- |
| `create(input)` | New document + version 1. Generates the `storage_key`, hashes the bytes, `storage.put` then an atomic metadata + `document.created` audit write. Rejects `empty_file` / `file_too_large`. If the metadata write fails, the orphaned object is deleted. |
| `addVersion(documentId, input)` | Appends the next version to an existing owned document (`document_not_found` / `owner_mismatch`), audited `document.version_added`. |
| `markScanResult({ documentVersionId, outcome, actor… })` | `pending → clean/infected/error` once (`already_resolved` otherwise), audited `document.scan_recorded`. Manual for the pilot; a `ScanProvider` adapter later. |
| `getForDownload({ documentVersionId, requesterUserId, staffCanReadAny })` | Authz (owner or staff), then a hard `scan_state = 'clean'` gate, then the bytes. Results: `not_found` / `forbidden` / `not_scanned_clean` / `bytes_missing`. |
| `listOwn(ownerUserId)` | Latest version metadata per owned document. |

Content type is allowlisted to `application/pdf`, `image/jpeg`, `image/png`; `maxBytes` defaults to
20 MiB. Download is API-mediated (per-request authz, `Content-Disposition: attachment`,
`nosniff`) — there is no public or signed object URL in the pilot.
