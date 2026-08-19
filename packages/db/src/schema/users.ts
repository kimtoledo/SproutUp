import { boolean, index, pgEnum, pgTable, text, unique, varchar } from 'drizzle-orm/pg-core';
import { id, timestamps } from './helpers.js';

export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'disabled']);

/** Better Auth identity plus application-level account status. */
export const users = pgTable(
  'users',
  {
    id: id(),
    name: varchar('name', { length: 200 }).notNull().default(''),
    email: varchar('email', { length: 320 }).notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    status: userStatusEnum('status').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    unique('users_email_unique').on(table.email),
    index('users_status_idx').on(table.status),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
