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
} from 'drizzle-orm/pg-core';
import type {
  CreditApplicationEventType,
  CreditApplicationStatus,
  CreditCollateralType,
  CreditGuarantorResidency,
} from '@sproutup/shared';
import { id, timestamps } from './helpers.js';
import { onboardingCases } from './onboarding.js';
import { accountEmailRegistry, adminAccounts } from './portal-identities.js';

/**
 * Credit application intake and dual-controlled underwriting workflow.
 *
 * This deliberately has no calculated score, risk grade, or collateral
 * valuation formula. The legacy system carries two mutually inconsistent
 * scoring engines and three different collateral-haircut formulas (see
 * tasks/reference/legacy/domain-credit-rating-underwriting.md); the approved
 * scorecard, risk grades, approval authority, and collateral haircut are all
 * still-open decisions (tasks/mvp1/06-credit-scoring-underwriting.md). This
 * schema only captures the inputs an eventual scorecard would consume, plus
 * the human recommendation/approval trail around them.
 */
export const creditApplicationStatusEnum = pgEnum('credit_application_status', [
  'draft',
  'submitted',
  'in_review',
  'needs_information',
  'recommended',
  'approved',
  'rejected',
  'withdrawn',
]);

export const creditApplicationEventTypeEnum = pgEnum('credit_application_event_type', [
  'created',
  'submitted',
  'review_started',
  'information_requested',
  'recommended',
  'approved',
  'rejected',
  'withdrawn',
  'reopened',
]);

export const creditCollateralTypeEnum = pgEnum('credit_collateral_type', [
  'real_estate',
  'inventory',
  'invoice',
  'other',
]);

export const creditGuarantorResidencyEnum = pgEnum('credit_guarantor_residency', [
  'local',
  'permanent_resident',
  'foreign',
]);

export const creditApplicationActorTypeEnum = pgEnum('credit_application_actor_type', [
  'user',
  'system',
]);

export const creditApplications = pgTable(
  'credit_applications',
  {
    id: id(),
    // The borrower onboarding case this application belongs to. Must already
    // be `approved` — enforced by the service (an eligibility check, like
    // the other party-eligibility gates), not a database trigger.
    borrowerCaseId: uuid('borrower_case_id')
      .notNull()
      .references(() => onboardingCases.id, { onDelete: 'restrict' }),
    applicantUserId: uuid('applicant_user_id')
      .notNull()
      .references(() => accountEmailRegistry.accountId, { onDelete: 'restrict' }),
    status: creditApplicationStatusEnum('status').$type<CreditApplicationStatus>().notNull().default('draft'),
    version: integer('version').notNull().default(1),

    requestedAmount: numeric('requested_amount', { precision: 14, scale: 2 }).notNull(),
    termMonths: integer('term_months').notNull(),
    purpose: text('purpose').notNull(),
    industry: text('industry'),
    companyEmployees: integer('company_employees'),
    ownershipDate: date('ownership_date'),

    // Two years of self-reported summary financials — the same flat shape the
    // legacy scoring engine actually consumed (last1_*/last2_*), without its
    // disputed margin/ratio roll-up logic. Raw inputs only.
    isAudited: boolean('is_audited').notNull().default(false),
    lastYear1SalesRevenue: numeric('last_year1_sales_revenue', { precision: 14, scale: 2 }),
    lastYear1GrossProfit: numeric('last_year1_gross_profit', { precision: 14, scale: 2 }),
    lastYear1NetProfit: numeric('last_year1_net_profit', { precision: 14, scale: 2 }),
    lastYear2SalesRevenue: numeric('last_year2_sales_revenue', { precision: 14, scale: 2 }),
    lastYear2GrossProfit: numeric('last_year2_gross_profit', { precision: 14, scale: 2 }),
    lastYear2NetProfit: numeric('last_year2_net_profit', { precision: 14, scale: 2 }),

    bankruptcyHistory: boolean('bankruptcy_history').notNull().default(false),
    bankruptcyDischarged: boolean('bankruptcy_discharged'),
    bankruptcyYear: integer('bankruptcy_year'),

    assignedAnalystUserId: uuid('assigned_analyst_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),

    // Analyst recommendation — a narrative and suggested terms, never a score.
    recommendationNarrative: text('recommendation_narrative'),
    recommendedAmount: numeric('recommended_amount', { precision: 14, scale: 2 }),
    recommendedTermMonths: integer('recommended_term_months'),
    recommendedByUserId: uuid('recommended_by_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    recommendedAt: timestamp('recommended_at', { withTimezone: true }),

    // Final decision — must be a different actor than recommendedByUserId
    // (enforced by the service).
    decidedByUserId: uuid('decided_by_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    approvedAmount: numeric('approved_amount', { precision: 14, scale: 2 }),
    approvedTermMonths: integer('approved_term_months'),

    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('credit_applications_positive_version', sql`${table.version} > 0`),
    check('credit_applications_positive_amount', sql`${table.requestedAmount} > 0`),
    check('credit_applications_positive_term', sql`${table.termMonths} > 0`),
    check(
      'credit_applications_purpose_check',
      sql`length(btrim(${table.purpose})) > 0`,
    ),
    check(
      'credit_applications_bankruptcy_pairing',
      sql`${table.bankruptcyHistory} = true or (${table.bankruptcyDischarged} is null and ${table.bankruptcyYear} is null)`,
    ),
    check(
      'credit_applications_recommendation_pairing',
      sql`(${table.recommendedByUserId} is null and ${table.recommendedAt} is null) or (${table.recommendedByUserId} is not null and ${table.recommendedAt} is not null)`,
    ),
    check(
      'credit_applications_decision_pairing',
      sql`(${table.decidedByUserId} is null and ${table.decidedAt} is null) or (${table.decidedByUserId} is not null and ${table.decidedAt} is not null)`,
    ),
    check(
      'credit_applications_dual_control',
      sql`${table.decidedByUserId} is null or ${table.recommendedByUserId} is null or ${table.decidedByUserId} <> ${table.recommendedByUserId}`,
    ),
    // One open application per borrower case at a time; a fresh application
    // for the same case is fine once the previous one reaches a terminal
    // state (approved/rejected/withdrawn), mirroring onboarding_cases'
    // one-open-journey index.
    uniqueIndex('credit_applications_one_open_per_case_idx')
      .on(table.borrowerCaseId)
      .where(
        sql`${table.status} in ('draft', 'submitted', 'in_review', 'needs_information', 'recommended')`,
      ),
    index('credit_applications_applicant_idx').on(table.applicantUserId, table.createdAt),
    index('credit_applications_queue_idx').on(table.status, table.createdAt),
    index('credit_applications_analyst_idx').on(table.assignedAnalystUserId, table.status),
  ],
);

export const creditApplicationEvents = pgTable(
  'credit_application_events',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => creditApplications.id, { onDelete: 'restrict' }),
    eventType: creditApplicationEventTypeEnum('event_type').$type<CreditApplicationEventType>().notNull(),
    fromStatus: creditApplicationStatusEnum('from_status').$type<CreditApplicationStatus>(),
    toStatus: creditApplicationStatusEnum('to_status').$type<CreditApplicationStatus>().notNull(),
    applicationVersion: integer('application_version').notNull(),
    actorType: creditApplicationActorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => accountEmailRegistry.accountId, {
      onDelete: 'restrict',
    }),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('credit_application_events_positive_version', sql`${table.applicationVersion} > 0`),
    check(
      'credit_application_events_actor_identity',
      sql`(${table.actorType} = 'user' and ${table.actorUserId} is not null) or (${table.actorType} = 'system' and ${table.actorUserId} is null)`,
    ),
    index('credit_application_events_application_idx').on(table.applicationId, table.occurredAt),
  ],
);

export const creditCollateralItems = pgTable(
  'credit_collateral_items',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => creditApplications.id, { onDelete: 'cascade' }),
    collateralType: creditCollateralTypeEnum('collateral_type').$type<CreditCollateralType>().notNull(),
    description: text('description').notNull(),
    // Declared figures only — no haircut/valuation formula is applied here.
    estimatedValue: numeric('estimated_value', { precision: 14, scale: 2 }).notNull(),
    outstandingLoan: numeric('outstanding_loan', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('credit_collateral_items_positive_value', sql`${table.estimatedValue} > 0`),
    check(
      'credit_collateral_items_outstanding_loan_check',
      sql`${table.outstandingLoan} is null or ${table.outstandingLoan} >= 0`,
    ),
    check(
      'credit_collateral_items_description_check',
      sql`length(btrim(${table.description})) > 0`,
    ),
    index('credit_collateral_items_application_idx').on(table.applicationId),
  ],
);

export const creditGuarantors = pgTable(
  'credit_guarantors',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => creditApplications.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    residencyStatus: creditGuarantorResidencyEnum('residency_status').$type<CreditGuarantorResidency>().notNull(),
    assessedNetWorth: numeric('assessed_net_worth', { precision: 14, scale: 2 }),
    assessmentYear: integer('assessment_year'),
    contactPhone: text('contact_phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('credit_guarantors_name_check', sql`length(btrim(${table.fullName})) > 0`),
    check(
      'credit_guarantors_net_worth_check',
      sql`${table.assessedNetWorth} is null or ${table.assessedNetWorth} >= 0`,
    ),
    index('credit_guarantors_application_idx').on(table.applicationId),
  ],
);

export type CreditApplication = typeof creditApplications.$inferSelect;
export type NewCreditApplication = typeof creditApplications.$inferInsert;
export type CreditCollateralItem = typeof creditCollateralItems.$inferSelect;
export type NewCreditCollateralItem = typeof creditCollateralItems.$inferInsert;
export type CreditGuarantor = typeof creditGuarantors.$inferSelect;
export type NewCreditGuarantor = typeof creditGuarantors.$inferInsert;
