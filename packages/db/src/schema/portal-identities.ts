import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './helpers.js';
import { userStatusEnum } from './users.js';

/**
 * Authentication namespaces are account classes, not customer RBAC roles.
 * The registry supplies a database-enforced global email identity across the
 * three physically separate account tables.
 */
export const portalAccountTypeEnum = pgEnum('portal_account_type', [
  'admin',
  'borrower',
  'investor',
]);

export const accountEmailRegistry = pgTable(
  'account_email_registry',
  {
    email: varchar('email', { length: 320 }).primaryKey(),
    accountType: portalAccountTypeEnum('account_type').notNull(),
    accountId: uuid('account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('account_email_registry_account_unique').on(table.accountId),
    check(
      'account_email_registry_normalized_email',
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

const accountColumns = () => ({
  id: id(),
  name: varchar('name', { length: 200 }).notNull().default(''),
  email: varchar('email', { length: 320 }).notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  status: userStatusEnum('status').notNull().default('active'),
  ...timestamps,
});

export const adminAccounts = pgTable(
  'admin_accounts',
  accountColumns(),
  (table) => [
    unique('admin_accounts_email_unique').on(table.email),
    index('admin_accounts_status_idx').on(table.status),
    check('admin_accounts_normalized_email', sql`${table.email} = lower(btrim(${table.email}))`),
  ],
);

export const borrowerAccounts = pgTable(
  'borrower_accounts',
  accountColumns(),
  (table) => [
    unique('borrower_accounts_email_unique').on(table.email),
    index('borrower_accounts_status_idx').on(table.status),
    check(
      'borrower_accounts_normalized_email',
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

export const investorAccounts = pgTable(
  'investor_accounts',
  accountColumns(),
  (table) => [
    unique('investor_accounts_email_unique').on(table.email),
    index('investor_accounts_status_idx').on(table.status),
    check(
      'investor_accounts_normalized_email',
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: id(),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('admin_account_id')
      .notNull()
      .references(() => adminAccounts.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('admin_sessions_token_unique').on(table.token),
    index('admin_sessions_account_idx').on(table.userId),
    index('admin_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const borrowerSessions = pgTable(
  'borrower_sessions',
  {
    id: id(),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('borrower_account_id')
      .notNull()
      .references(() => borrowerAccounts.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('borrower_sessions_token_unique').on(table.token),
    index('borrower_sessions_account_idx').on(table.userId),
    index('borrower_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const investorSessions = pgTable(
  'investor_sessions',
  {
    id: id(),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('investor_account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('investor_sessions_token_unique').on(table.token),
    index('investor_sessions_account_idx').on(table.userId),
    index('investor_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

const credentialColumns = () => ({
  id: id(),
  accountId: text('provider_account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
});

export const adminCredentials = pgTable(
  'admin_credentials',
  {
    ...credentialColumns(),
    userId: uuid('admin_account_id')
      .notNull()
      .references(() => adminAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('admin_credentials_provider_account_unique').on(table.providerId, table.accountId),
    index('admin_credentials_account_idx').on(table.userId),
  ],
);

export const borrowerCredentials = pgTable(
  'borrower_credentials',
  {
    ...credentialColumns(),
    userId: uuid('borrower_account_id')
      .notNull()
      .references(() => borrowerAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('borrower_credentials_provider_account_unique').on(table.providerId, table.accountId),
    index('borrower_credentials_account_idx').on(table.userId),
  ],
);

export const investorCredentials = pgTable(
  'investor_credentials',
  {
    ...credentialColumns(),
    userId: uuid('investor_account_id')
      .notNull()
      .references(() => investorAccounts.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique('investor_credentials_provider_account_unique').on(table.providerId, table.accountId),
    index('investor_credentials_account_idx').on(table.userId),
  ],
);

const verificationColumns = () => ({
  id: id(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
});

export const adminVerifications = pgTable(
  'admin_verifications',
  verificationColumns(),
  (table) => [index('admin_verifications_identifier_idx').on(table.identifier)],
);

export const borrowerVerifications = pgTable(
  'borrower_verifications',
  verificationColumns(),
  (table) => [index('borrower_verifications_identifier_idx').on(table.identifier)],
);

export const investorVerifications = pgTable(
  'investor_verifications',
  verificationColumns(),
  (table) => [index('investor_verifications_identifier_idx').on(table.identifier)],
);

const rateLimitColumns = () => ({
  id: id(),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

export const adminRateLimits = pgTable(
  'admin_rate_limits',
  rateLimitColumns(),
  (table) => [unique('admin_rate_limits_key_unique').on(table.key)],
);

export const borrowerRateLimits = pgTable(
  'borrower_rate_limits',
  rateLimitColumns(),
  (table) => [unique('borrower_rate_limits_key_unique').on(table.key)],
);

export const investorRateLimits = pgTable(
  'investor_rate_limits',
  rateLimitColumns(),
  (table) => [unique('investor_rate_limits_key_unique').on(table.key)],
);

export const adminAuthSchema = {
  user: adminAccounts,
  session: adminSessions,
  account: adminCredentials,
  verification: adminVerifications,
  rateLimit: adminRateLimits,
};

export const borrowerAuthSchema = {
  user: borrowerAccounts,
  session: borrowerSessions,
  account: borrowerCredentials,
  verification: borrowerVerifications,
  rateLimit: borrowerRateLimits,
};

export const investorAuthSchema = {
  user: investorAccounts,
  session: investorSessions,
  account: investorCredentials,
  verification: investorVerifications,
  rateLimit: investorRateLimits,
};
