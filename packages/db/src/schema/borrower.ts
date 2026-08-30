import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { BorrowerEntityType } from '@sproutup/shared';
import { id, timestamps } from './helpers.js';
import { onboardingCases } from './onboarding.js';

/**
 * Borrower KYB profile — at most one per onboarding case, editable while the
 * case is `draft` or `needs_information` (enforced by the service, not here).
 * Which fields and documents are ultimately required by `entity_type` is an
 * open compliance decision (task 03); this table only captures the shape,
 * not a requirement policy.
 */
export const borrowerEntityTypeEnum = pgEnum('borrower_entity_type', [
  'sole_proprietorship',
  'partnership',
  'corporation',
]);

export const borrowerProfiles = pgTable(
  'borrower_profiles',
  {
    id: id(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => onboardingCases.id, { onDelete: 'restrict' }),
    entityType: borrowerEntityTypeEnum('entity_type').$type<BorrowerEntityType>().notNull(),
    version: integer('version').notNull().default(1),
    registeredName: text('registered_name').notNull(),
    tradeName: text('trade_name'),
    registrationNumber: text('registration_number'),
    tin: text('tin'),
    principalAddress: text('principal_address'),
    contactPersonName: text('contact_person_name'),
    contactPersonEmail: text('contact_person_email'),
    contactPersonPhone: text('contact_person_phone'),
    dateEstablished: date('date_established'),
    ...timestamps,
  },
  (table) => [
    // One profile per case: `saveOwn` upserts this single row rather than
    // versioning a history table, matching how `onboarding_cases` itself
    // carries one current row plus an append-only event log.
    uniqueIndex('borrower_profiles_case_idx').on(table.caseId),
    check('borrower_profiles_positive_version', sql`${table.version} > 0`),
    check(
      'borrower_profiles_registered_name_check',
      sql`length(btrim(${table.registeredName})) > 0`,
    ),
    check(
      'borrower_profiles_contact_email_check',
      sql`${table.contactPersonEmail} is null or ${table.contactPersonEmail} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
  ],
);

/**
 * Declared beneficial owners for one profile. Saved as a full replace
 * alongside the profile (no independent client-tracked identity yet), which
 * keeps a single owning transaction responsible for the whole picture the
 * ownership-percentage total is checked against.
 */
export const beneficialOwners = pgTable(
  'beneficial_owners',
  {
    id: id(),
    borrowerProfileId: uuid('borrower_profile_id')
      .notNull()
      .references(() => borrowerProfiles.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    ownershipPercentage: numeric('ownership_percentage', { precision: 5, scale: 2 }).notNull(),
    nationality: varchar('nationality', { length: 80 }),
    isPep: boolean('is_pep').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('beneficial_owners_profile_idx').on(table.borrowerProfileId),
    check('beneficial_owners_name_check', sql`length(btrim(${table.fullName})) > 0`),
    check(
      'beneficial_owners_percentage_check',
      sql`${table.ownershipPercentage} > 0 and ${table.ownershipPercentage} <= 100`,
    ),
  ],
);

export type BorrowerProfile = typeof borrowerProfiles.$inferSelect;
export type NewBorrowerProfile = typeof borrowerProfiles.$inferInsert;
export type BeneficialOwner = typeof beneficialOwners.$inferSelect;
export type NewBeneficialOwner = typeof beneficialOwners.$inferInsert;
