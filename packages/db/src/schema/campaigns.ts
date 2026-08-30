import { sql } from 'drizzle-orm';
import {
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
import type { RepaymentModel } from '@sproutup/shared';
import { id, timestamps } from './helpers.js';
import { creditApplications } from './credit.js';
import { onboardingCases } from './onboarding.js';
import { accountEmailRegistry, adminAccounts } from './portal-identities.js';

/**
 * Campaign origination and dual-controlled publish workflow. Bound to an
 * approved credit application; publishable terms are the loan amount/term/
 * repayment model/rates the funding round is built on. Funding-window
 * mechanics that depend on actual investor commitments (funded/failed
 * transitions, released holds) belong to task 08 (Investor Commitments) and
 * are not modeled here — this table only reaches `published` (open for
 * funding) or `cancelled`.
 *
 * Repayment schedules are never persisted here: `generateLoanSchedule`
 * (`@sproutup/shared`) is a pure, deterministic function of the published
 * terms, computed on read rather than stored and risking drift from the
 * terms of record.
 */
export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'pending_approval',
  'published',
  'cancelled',
]);

export const campaignEventTypeEnum = pgEnum('campaign_event_type', [
  'created',
  'submitted',
  'published',
  'sent_back',
  'cancelled',
]);

export const campaignRepaymentModelEnum = pgEnum('campaign_repayment_model', [
  'amortized',
  'interest_only',
]);

export const campaignActorTypeEnum = pgEnum('campaign_actor_type', ['user', 'system']);

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    creditApplicationId: uuid('credit_application_id')
      .notNull()
      .references(() => creditApplications.id, { onDelete: 'restrict' }),
    // Denormalized from the credit application for ownership/query
    // convenience, mirroring how credit_applications denormalizes
    // applicant_user_id from its own borrower case.
    borrowerCaseId: uuid('borrower_case_id')
      .notNull()
      .references(() => onboardingCases.id, { onDelete: 'restrict' }),
    status: campaignStatusEnum('status').$type<'draft' | 'pending_approval' | 'published' | 'cancelled'>().notNull().default('draft'),
    version: integer('version').notNull().default(1),

    loanAmount: numeric('loan_amount', { precision: 14, scale: 2 }).notNull(),
    termMonths: integer('term_months').notNull(),
    repaymentModel: campaignRepaymentModelEnum('repayment_model').$type<RepaymentModel>().notNull(),
    borrowerAnnualRatePercent: numeric('borrower_annual_rate_percent', { precision: 8, scale: 4 }).notNull(),
    investorAnnualRatePercent: numeric('investor_annual_rate_percent', { precision: 8, scale: 4 }).notNull(),
    minimumCommitmentAmount: numeric('minimum_commitment_amount', { precision: 14, scale: 2 }).notNull(),
    fundingWindowDays: integer('funding_window_days').notNull(),
    firstRepaymentDueDate: date('first_repayment_due_date').notNull(),
    purposeSummary: text('purpose_summary').notNull(),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => adminAccounts.id, { onDelete: 'restrict' }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    publishedByUserId: uuid('published_by_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    ...timestamps,
  },
  (table) => [
    check('campaigns_positive_version', sql`${table.version} > 0`),
    check('campaigns_positive_loan_amount', sql`${table.loanAmount} > 0`),
    check('campaigns_positive_term', sql`${table.termMonths} > 0`),
    check(
      'campaigns_borrower_rate_range',
      sql`${table.borrowerAnnualRatePercent} >= 0 and ${table.borrowerAnnualRatePercent} <= 100`,
    ),
    check(
      'campaigns_investor_rate_range',
      sql`${table.investorAnnualRatePercent} >= 0 and ${table.investorAnnualRatePercent} <= 100`,
    ),
    // The platform must never pay investors more than the borrower is
    // charged; equal is allowed only for an explicit zero-spread campaign.
    check(
      'campaigns_investor_rate_not_above_borrower',
      sql`${table.investorAnnualRatePercent} <= ${table.borrowerAnnualRatePercent}`,
    ),
    check('campaigns_positive_minimum_commitment', sql`${table.minimumCommitmentAmount} > 0`),
    check(
      'campaigns_minimum_commitment_within_loan',
      sql`${table.minimumCommitmentAmount} <= ${table.loanAmount}`,
    ),
    check('campaigns_positive_funding_window', sql`${table.fundingWindowDays} > 0`),
    check('campaigns_purpose_summary_check', sql`length(btrim(${table.purposeSummary})) > 0`),
    check(
      'campaigns_submitted_pairing',
      sql`(${table.submittedByUserId} is null and ${table.submittedAt} is null) or (${table.submittedByUserId} is not null and ${table.submittedAt} is not null)`,
    ),
    check(
      'campaigns_published_pairing',
      sql`(${table.publishedByUserId} is null and ${table.publishedAt} is null) or (${table.publishedByUserId} is not null and ${table.publishedAt} is not null)`,
    ),
    check(
      'campaigns_cancelled_pairing',
      sql`(${table.cancelledByUserId} is null and ${table.cancelledAt} is null) or (${table.cancelledByUserId} is not null and ${table.cancelledAt} is not null)`,
    ),
    // Dual control: whoever publishes must differ from whoever submitted.
    check(
      'campaigns_dual_control',
      sql`${table.publishedByUserId} is null or ${table.submittedByUserId} is null or ${table.publishedByUserId} <> ${table.submittedByUserId}`,
    ),
    // At most one active (non-cancelled) campaign per credit application at a time.
    uniqueIndex('campaigns_one_open_per_application_idx')
      .on(table.creditApplicationId)
      .where(sql`${table.status} in ('draft', 'pending_approval', 'published')`),
    index('campaigns_borrower_case_idx').on(table.borrowerCaseId),
    index('campaigns_queue_idx').on(table.status, table.createdAt),
  ],
);

export const campaignEvents = pgTable(
  'campaign_events',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    eventType: campaignEventTypeEnum('event_type').notNull(),
    fromStatus: campaignStatusEnum('from_status'),
    toStatus: campaignStatusEnum('to_status').notNull(),
    campaignVersion: integer('campaign_version').notNull(),
    actorType: campaignActorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => accountEmailRegistry.accountId, {
      onDelete: 'restrict',
    }),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('campaign_events_positive_version', sql`${table.campaignVersion} > 0`),
    check(
      'campaign_events_actor_identity',
      sql`(${table.actorType} = 'user' and ${table.actorUserId} is not null) or (${table.actorType} = 'system' and ${table.actorUserId} is null)`,
    ),
    index('campaign_events_campaign_idx').on(table.campaignId, table.occurredAt),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
