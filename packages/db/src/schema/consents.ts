import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { id } from './helpers.js';
import { accountEmailRegistry, adminAccounts } from './portal-identities.js';

export const consentDocuments = pgTable(
  'consent_documents',
  {
    id: id(),
    documentKey: varchar('document_key', { length: 120 }).notNull(),
    version: integer('version').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    locale: varchar('locale', { length: 20 }).notNull().default('en-PH'),
    content: text('content').notNull(),
    contentSha256: varchar('content_sha256', { length: 64 }).notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    publishedByUserId: uuid('published_by_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('consent_documents_key_version_idx').on(
      table.documentKey,
      table.locale,
      table.version,
    ),
    index('consent_documents_effective_idx').on(
      table.documentKey,
      table.locale,
      table.effectiveAt,
    ),
    check(
      'consent_documents_key_check',
      sql`${table.documentKey} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`,
    ),
    check('consent_documents_positive_version', sql`${table.version} > 0`),
    check('consent_documents_title_check', sql`length(btrim(${table.title})) > 0`),
    check('consent_documents_locale_check', sql`${table.locale} ~ '^[a-z]{2}(?:-[A-Z]{2})?$'`),
    check('consent_documents_content_check', sql`length(${table.content}) > 0`),
    check(
      'consent_documents_content_hash_check',
      sql`${table.contentSha256} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const consentAcceptances = pgTable(
  'consent_acceptances',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => accountEmailRegistry.accountId, { onDelete: 'restrict' }),
    consentDocumentId: uuid('consent_document_id')
      .notNull()
      .references(() => consentDocuments.id, { onDelete: 'restrict' }),
    acceptedContentSha256: varchar('accepted_content_sha256', { length: 64 }).notNull(),
    requestId: uuid('request_id'),
    ipAddressHash: varchar('ip_address_hash', { length: 64 }),
    userAgentHash: varchar('user_agent_hash', { length: 64 }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('consent_acceptances_user_document_idx').on(
      table.userId,
      table.consentDocumentId,
    ),
    index('consent_acceptances_user_time_idx').on(table.userId, table.acceptedAt),
    check(
      'consent_acceptances_content_hash_check',
      sql`${table.acceptedContentSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'consent_acceptances_ip_hash_check',
      sql`${table.ipAddressHash} is null or ${table.ipAddressHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'consent_acceptances_user_agent_hash_check',
      sql`${table.userAgentHash} is null or ${table.userAgentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
