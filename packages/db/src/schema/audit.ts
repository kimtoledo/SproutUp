import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { id } from './helpers.js';

export const auditActorTypeEnum = pgEnum('audit_actor_type', ['user', 'system']);
export const auditOutcomeEnum = pgEnum('audit_outcome', ['succeeded', 'denied', 'failed']);

/** Append-only business and privileged-operation evidence. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: auditActorTypeEnum('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorRoles: text('actor_roles').array().notNull().default(sql`ARRAY[]::text[]`),
    action: varchar('action', { length: 160 }).notNull(),
    outcome: auditOutcomeEnum('outcome').notNull(),
    resourceType: varchar('resource_type', { length: 120 }).notNull(),
    resourceId: text('resource_id'),
    requestId: uuid('request_id'),
    reason: text('reason'),
    ipAddressHash: varchar('ip_address_hash', { length: 128 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index('audit_events_occurred_at_idx').on(table.occurredAt),
    index('audit_events_actor_idx').on(table.actorUserId, table.occurredAt),
    index('audit_events_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_events_request_idx').on(table.requestId),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
