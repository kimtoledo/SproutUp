# Private document store (`documents` / `document_versions`)

**Status:** schema + storage adapter + internal service + HTTP routes implemented (2026-08-30,
slices S1.2a and S1.2c). `documents.upload_own`/`documents.read_own` are granted to borrower and
investor accounts; there is no staff review route or automated scan-provider integration yet, so a
document stays `pending` — and therefore undownloadable — until both of those land.

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
- `createUnconfiguredFileStorage()` — fails closed; the composition root
  (`storage/select-file-storage.ts`) selects this in production until an approved
  object-storage adapter is wired, so a deployment never silently accepts an upload
  it cannot durably store. `DOCUMENT_STORAGE_DIR` (default `.data/documents`, gitignored)
  configures the local-dev root; metadata + access policy stay in PostgreSQL regardless
  of backend.

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

## HTTP routes — `apps/api/src/routes/documents.ts`

All four require an authenticated borrower/investor session and the matching capability
(`documents.upload_own` or `documents.read_own`); ownership is always re-derived from the session,
never a client-supplied field.

| Route | Behaviour |
| --- | --- |
| `POST /v1/documents` | Creates a new document. `multipart/form-data`: `classification`, `purpose` fields plus one `file` part — **not** a JSON body; Fastify never populates `request.body` for a multipart request, so the route hand-parses every part via `request.parts()` instead of declaring a `body` schema. Each file part is drained (`toBuffer()`) while it is the current part, or the async iterator hangs waiting for backpressure to clear. |
| `POST /v1/documents/:documentId/versions` | Same multipart shape; appends a version to an owned document. `document_not_found` and `owner_mismatch` both surface as one generic 404 so the response never discloses whether a document id you don't own exists. |
| `GET /v1/documents` | Lists the caller's own documents at their latest version (JSON). |
| `GET /v1/documents/:documentVersionId/download` | Streams the bytes with `Content-Type`/`Content-Disposition` set from stored metadata. Deliberately has no `response[200]` JSON schema — a JSON-schema-shaped response would make Fastify try to serialize the raw `Buffer` through `fast-json-stringify`. `403`/`404`/`409` map the service's `forbidden`/`not_found`/`not_scanned_clean` results. |

`@fastify/multipart` is registered globally in `app.ts` with `limits: { fileSize: DEFAULT_MAX_DOCUMENT_BYTES, files: 1, fields: 5 }` — a defense-in-depth cap at the stream level, ahead of the service's own byte-length check.
