import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './helpers.js';
import { adminAccounts } from './portal-identities.js';

/**
 * Effective-dated configuration.
 *
 * `rule_sets` is the catalogue of known configuration keys (e.g.
 * `borrower.required_fields`, `tax.vat`, `investor.limits`, `onboarding.sla`).
 * `rule_versions` holds the immutable, effective-dated bodies. "The rule in
 * force at time T" is the version for that key with the greatest
 * `effective_from <= T`. Superseding a rule is a plain insert of a later
 * version — nothing is ever updated or deleted, so a historical calculation
 * can always be reproduced against the exact body that applied at the time.
 */
export const ruleSets = pgTable(
  'rule_sets',
  {
    key: varchar('key', { length: 120 }).primaryKey(),
    description: text('description').notNull(),
    ...timestamps,
  },
  (table) => [
    check('rule_sets_key_check', sql`${table.key} ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'`),
    check('rule_sets_description_check', sql`length(btrim(${table.description})) > 0`),
  ],
);

export const ruleVersions = pgTable(
  'rule_versions',
  {
    id: id(),
    ruleKey: varchar('rule_key', { length: 120 })
      .notNull()
      .references(() => ruleSets.key, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    note: text('note'),
    publishedByUserId: uuid('published_by_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rule_versions_key_version_idx').on(table.ruleKey, table.version),
    uniqueIndex('rule_versions_key_effective_idx').on(table.ruleKey, table.effectiveFrom),
    index('rule_versions_resolve_idx').on(table.ruleKey, table.effectiveFrom),
    check('rule_versions_positive_version', sql`${table.version} > 0`),
    check('rule_versions_body_is_object', sql`jsonb_typeof(${table.body}) = 'object'`),
  ],
);
