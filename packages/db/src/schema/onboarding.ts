import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  OnboardingCaseStatus,
  OnboardingCaseType,
  OnboardingEventType,
} from '@sproutup/shared';
import { id, timestamps } from './helpers.js';
import { users } from './users.js';
import { adminAccounts } from './portal-identities.js';

export const onboardingCaseTypeEnum = pgEnum('onboarding_case_type', ['borrower', 'investor']);
export const onboardingCaseStatusEnum = pgEnum('onboarding_case_status', [
  'draft',
  'submitted',
  'in_review',
  'needs_information',
  'approved',
  'rejected',
  'withdrawn',
  'expired',
]);
export const onboardingEventTypeEnum = pgEnum('onboarding_event_type', [
  'created',
  'submitted',
  'review_started',
  'information_requested',
  'approved',
  'rejected',
  'withdrawn',
  'reopened',
  'expired',
]);
export const onboardingActorTypeEnum = pgEnum('onboarding_actor_type', ['user', 'system']);

export const onboardingCases = pgTable(
  'onboarding_cases',
  {
    id: id(),
    caseType: onboardingCaseTypeEnum('case_type').$type<OnboardingCaseType>().notNull(),
    status: onboardingCaseStatusEnum('status').$type<OnboardingCaseStatus>().notNull().default('draft'),
    version: integer('version').notNull().default(1),
    applicantUserId: uuid('applicant_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assignedReviewerUserId: uuid('assigned_reviewer_user_id').references(() => adminAccounts.id, {
      onDelete: 'restrict',
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('onboarding_cases_positive_version', sql`${table.version} > 0`),
    check(
      'onboarding_cases_reviewer_separation',
      sql`${table.assignedReviewerUserId} is null or ${table.assignedReviewerUserId} <> ${table.applicantUserId}`,
    ),
    uniqueIndex('onboarding_cases_one_open_journey_idx')
      .on(table.applicantUserId, table.caseType)
      .where(sql`${table.status} in ('draft', 'submitted', 'in_review', 'needs_information')`),
    index('onboarding_cases_applicant_idx').on(table.applicantUserId, table.createdAt),
    index('onboarding_cases_review_queue_idx').on(table.caseType, table.status, table.createdAt),
    index('onboarding_cases_reviewer_idx').on(table.assignedReviewerUserId, table.status),
  ],
);

export const onboardingCaseEvents = pgTable(
  'onboarding_case_events',
  {
    id: id(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => onboardingCases.id, { onDelete: 'restrict' }),
    eventType: onboardingEventTypeEnum('event_type').$type<OnboardingEventType>().notNull(),
    fromStatus: onboardingCaseStatusEnum('from_status').$type<OnboardingCaseStatus>(),
    toStatus: onboardingCaseStatusEnum('to_status').$type<OnboardingCaseStatus>().notNull(),
    caseVersion: integer('case_version').notNull(),
    actorType: onboardingActorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('onboarding_case_events_positive_version', sql`${table.caseVersion} > 0`),
    check(
      'onboarding_case_events_actor_identity',
      sql`(${table.actorType} = 'user' and ${table.actorUserId} is not null) or (${table.actorType} = 'system' and ${table.actorUserId} is null)`,
    ),
    index('onboarding_case_events_case_idx').on(table.caseId, table.occurredAt),
    index('onboarding_case_events_actor_idx').on(table.actorUserId, table.occurredAt),
  ],
);
