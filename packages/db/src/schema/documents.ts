import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './helpers.js';
import { users } from './users.js';

/**
 * Private document store.
 *
 * `documents` is a logical file owned by a user (a KYC ID, a SEC registration,
 * a signed contract). `document_versions` are the immutable uploaded bytes —
 * replacing a file adds a version, never edits one. The actual bytes live in a
 * `FileStorage` backend keyed by `storage_key` (an opaque id, never a
 * user-supplied path); only metadata and the access decision live here.
 *
 * `scan_state` is the one mutable field on a version: it moves
 * `pending → clean | infected | error` when a malware scan resolves (manual for
 * the pilot, a provider adapter later). Download is gated on `clean`.
 */
export const documentClassificationEnum = pgEnum('document_classification', [
  'kyc_identity',
  'kyc_address',
  'kyc_business',
  'financial',
  'contract',
  'other',
]);

export const documentScanStateEnum = pgEnum('document_scan_state', [
  'pending',
  'clean',
  'infected',
  'error',
]);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    classification: documentClassificationEnum('classification').notNull(),
    // A rule-key-style tag for what this document is, e.g. 'borrower.sec_registration'.
    purpose: varchar('purpose', { length: 120 }).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      'documents_purpose_check',
      sql`${table.purpose} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`,
    ),
    index('documents_owner_idx').on(table.ownerUserId, table.classification),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    contentSha256: varchar('content_sha256', { length: 64 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    contentType: varchar('content_type', { length: 255 }).notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    scanState: documentScanStateEnum('scan_state').notNull().default('pending'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('document_versions_document_version_idx').on(table.documentId, table.version),
    uniqueIndex('document_versions_storage_key_idx').on(table.storageKey),
    index('document_versions_document_idx').on(table.documentId, table.uploadedAt),
    check('document_versions_positive_version', sql`${table.version} > 0`),
    check('document_versions_positive_size', sql`${table.byteSize} > 0`),
    check('document_versions_hash_check', sql`${table.contentSha256} ~ '^[a-f0-9]{64}$'`),
    check(
      'document_versions_scanned_pairing',
      sql`(${table.scanState} = 'pending' and ${table.scannedAt} is null) or (${table.scanState} <> 'pending' and ${table.scannedAt} is not null)`,
    ),
  ],
);
