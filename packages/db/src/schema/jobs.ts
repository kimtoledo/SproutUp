import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './helpers.js';

export const backgroundJobStatusEnum = pgEnum('background_job_status', [
  'pending',
  'processing',
  'retry_scheduled',
  'succeeded',
  'dead_lettered',
  'cancelled',
]);

export const backgroundJobAttemptOutcomeEnum = pgEnum('background_job_attempt_outcome', [
  'succeeded',
  'retry_scheduled',
  'dead_lettered',
  'lease_expired',
  'cancelled',
]);

export const backgroundJobs = pgTable(
  'background_jobs',
  {
    id: id(),
    topic: varchar('topic', { length: 120 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    status: backgroundJobStatusEnum('status').notNull().default('pending'),
    priority: smallint('priority').notNull().default(100),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(10),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: varchar('lease_owner', { length: 200 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 120 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('background_jobs_idempotency_idx').on(table.idempotencyKey),
    index('background_jobs_claim_idx').on(
      table.status,
      table.availableAt,
      table.priority,
      table.createdAt,
    ),
    index('background_jobs_lease_expiry_idx').on(table.status, table.leaseExpiresAt),
    check(
      'background_jobs_priority_check',
      sql`${table.priority} between 0 and 1000`,
    ),
    check(
      'background_jobs_attempts_check',
      sql`${table.maxAttempts} between 1 and 100 and ${table.attemptCount} between 0 and ${table.maxAttempts}`,
    ),
    check(
      'background_jobs_lease_pair_check',
      sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`,
    ),
    check(
      'background_jobs_processing_lease_check',
      sql`(${table.status} = 'processing' and ${table.leaseOwner} is not null) or (${table.status} <> 'processing' and ${table.leaseOwner} is null)`,
    ),
    check(
      'background_jobs_terminal_time_check',
      sql`(${table.status} = 'succeeded' and ${table.completedAt} is not null and ${table.cancelledAt} is null)
        or (${table.status} = 'cancelled' and ${table.cancelledAt} is not null and ${table.completedAt} is null)
        or (${table.status} not in ('succeeded', 'cancelled') and ${table.completedAt} is null and ${table.cancelledAt} is null)`,
    ),
  ],
);

export const backgroundJobAttempts = pgTable(
  'background_job_attempts',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => backgroundJobs.id, { onDelete: 'restrict' }),
    attemptNumber: integer('attempt_number').notNull(),
    workerId: varchar('worker_id', { length: 200 }).notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    outcome: backgroundJobAttemptOutcomeEnum('outcome'),
    errorCode: varchar('error_code', { length: 120 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('background_job_attempts_job_number_idx').on(table.jobId, table.attemptNumber),
    index('background_job_attempts_worker_idx').on(table.workerId, table.startedAt),
    check('background_job_attempts_number_check', sql`${table.attemptNumber} >= 1`),
    check(
      'background_job_attempts_finish_check',
      sql`(${table.outcome} is null) = (${table.finishedAt} is null)`,
    ),
  ],
);
