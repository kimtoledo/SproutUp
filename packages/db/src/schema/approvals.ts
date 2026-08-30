import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './helpers.js';
import { adminAccounts } from './portal-identities.js';

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'executed',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]);

export const approvalActionEnum = pgEnum('approval_action', [
  'proposed',
  'approved',
  'executed',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    commandType: varchar('command_type', { length: 120 }).notNull(),
    status: approvalStatusEnum('status').notNull().default('pending'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    version: integer('version').notNull().default(1),
    makerUserId: uuid('maker_user_id')
      .notNull()
      .references(() => adminAccounts.id, { onDelete: 'restrict' }),
    checkerUserId: uuid('checker_user_id').references(() => adminAccounts.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('approval_requests_status_expiry_idx').on(table.status, table.expiresAt),
    index('approval_requests_maker_idx').on(table.makerUserId, table.createdAt),
    index('approval_requests_command_idx').on(table.commandType, table.createdAt),
    uniqueIndex('approval_requests_one_pending_payload_idx')
      .on(table.commandType, table.payloadHash)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const approvalActions = pgTable(
  'approval_actions',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'restrict' }),
    action: approvalActionEnum('action').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => adminAccounts.id, { onDelete: 'restrict' }),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index('approval_actions_request_idx').on(table.requestId, table.occurredAt),
    index('approval_actions_actor_idx').on(table.actorUserId, table.occurredAt),
  ],
);
