import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
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
import { phpMoneyPrecision, phpMoneyScale } from '@sproutup/shared';
import { id, timestamps } from './helpers.js';
import { users } from './users.js';

export const currencyCodeEnum = pgEnum('currency_code', ['PHP']);
export const ledgerNormalBalanceEnum = pgEnum('ledger_normal_balance', ['debit', 'credit']);
export const ledgerEntryDirectionEnum = pgEnum('ledger_entry_direction', ['debit', 'credit']);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: id(),
    code: varchar('code', { length: 120 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    normalBalance: ledgerNormalBalanceEnum('normal_balance').notNull(),
    currency: currencyCodeEnum('currency').notNull().default('PHP'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex('ledger_accounts_code_idx').on(table.code)],
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: id(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    sourceType: varchar('source_type', { length: 120 }).notNull(),
    sourceId: varchar('source_id', { length: 200 }).notNull(),
    description: text('description').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    reversalOfTransactionId: uuid('reversal_of_transaction_id').references(
      (): AnyPgColumn => ledgerTransactions.id,
      { onDelete: 'restrict' },
    ),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id'),
  },
  (table) => [
    uniqueIndex('ledger_transactions_idempotency_idx').on(table.idempotencyKey),
    uniqueIndex('ledger_transactions_one_reversal_idx')
      .on(table.reversalOfTransactionId)
      .where(sql`${table.reversalOfTransactionId} is not null`),
    index('ledger_transactions_source_idx').on(table.sourceType, table.sourceId, table.postedAt),
    check('ledger_transactions_payload_hash_check', sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: 'restrict' }),
    lineNumber: integer('line_number').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    direction: ledgerEntryDirectionEnum('direction').notNull(),
    amount: numeric('amount', {
      precision: phpMoneyPrecision,
      scale: phpMoneyScale,
    }).notNull(),
    currency: currencyCodeEnum('currency').notNull().default('PHP'),
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ledger_entries_transaction_line_idx').on(table.transactionId, table.lineNumber),
    uniqueIndex('ledger_entries_transaction_account_idx').on(table.transactionId, table.accountId),
    index('ledger_entries_account_idx').on(table.accountId, table.createdAt),
    check('ledger_entries_line_number_check', sql`${table.lineNumber} >= 1`),
    check('ledger_entries_positive_amount_check', sql`${table.amount} > 0`),
  ],
);
