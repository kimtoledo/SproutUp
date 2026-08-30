import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps } from './helpers.js';
import { onboardingCases } from './onboarding.js';

/**
 * Individual investor KYC profile — at most one per onboarding case, editable
 * while the case is `draft` or `needs_information` (enforced by the service,
 * not here). Covers baseline natural-person identity/contact/source-of-funds
 * fields only.
 *
 * Institutional investor support and a risk/suitability questionnaire are
 * explicitly out of scope here: institutional support is an open pilot-scope
 * decision (task 04), and the legacy CKA/SAT questionnaires are Singapore/MAS
 * "accredited investor" constructs that must not be ported into the
 * Philippine revamp without confirmed local rules (tasks/README's
 * requirement-authority guidance). This table only fixes the identity shape.
 */
export const investorProfiles = pgTable(
  'investor_profiles',
  {
    id: id(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => onboardingCases.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    fullName: text('full_name').notNull(),
    dateOfBirth: date('date_of_birth'),
    nationality: varchar('nationality', { length: 80 }),
    governmentIdType: text('government_id_type'),
    governmentIdNumber: text('government_id_number'),
    residentialAddress: text('residential_address'),
    phoneNumber: text('phone_number'),
    occupation: text('occupation'),
    sourceOfFunds: text('source_of_funds'),
    ...timestamps,
  },
  (table) => [
    // One profile per case: `saveOwn` upserts this single row, matching the
    // same shape used for `borrower_profiles`.
    uniqueIndex('investor_profiles_case_idx').on(table.caseId),
    check('investor_profiles_positive_version', sql`${table.version} > 0`),
    check('investor_profiles_full_name_check', sql`length(btrim(${table.fullName})) > 0`),
  ],
);

export type InvestorProfile = typeof investorProfiles.$inferSelect;
export type NewInvestorProfile = typeof investorProfiles.$inferInsert;
