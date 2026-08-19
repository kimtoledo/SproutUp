import { eq, sql } from 'drizzle-orm';
import {
  formatPhpMoney,
  parsePhpMoney,
  subtractPhpMoney,
  type PhpAmount,
} from '@sproutup/shared';
import { schema, type Database } from '@sproutup/db';

export interface LedgerAccountBalance {
  accountId: string;
  code: string;
  name: string;
  normalBalance: 'debit' | 'credit';
  currency: 'PHP';
  isActive: boolean;
  debitTotal: PhpAmount;
  creditTotal: PhpAmount;
  balance: PhpAmount;
}

export type LedgerAccountBalanceResult =
  | { ok: true; account: LedgerAccountBalance }
  | { ok: false; reason: 'account_not_found' };

type LedgerBalanceDatabase = Pick<Database, 'select'>;

const exactDebitTotal = sql<string>`
  coalesce(
    sum(${schema.ledgerEntries.amount})
      filter (where ${schema.ledgerEntries.direction} = 'debit'),
    0::numeric
  )::numeric(30, 2)::text
`;
const exactCreditTotal = sql<string>`
  coalesce(
    sum(${schema.ledgerEntries.amount})
      filter (where ${schema.ledgerEntries.direction} = 'credit'),
    0::numeric
  )::numeric(30, 2)::text
`;

export function createLedgerBalanceService(database: LedgerBalanceDatabase) {
  return {
    async getAccountBalance(accountId: string): Promise<LedgerAccountBalanceResult> {
      const [row] = await database
        .select({
          accountId: schema.ledgerAccounts.id,
          code: schema.ledgerAccounts.code,
          name: schema.ledgerAccounts.name,
          normalBalance: schema.ledgerAccounts.normalBalance,
          currency: schema.ledgerAccounts.currency,
          isActive: schema.ledgerAccounts.isActive,
          debitTotal: exactDebitTotal,
          creditTotal: exactCreditTotal,
        })
        .from(schema.ledgerAccounts)
        .leftJoin(
          schema.ledgerEntries,
          eq(schema.ledgerEntries.accountId, schema.ledgerAccounts.id),
        )
        .where(eq(schema.ledgerAccounts.id, accountId))
        .groupBy(
          schema.ledgerAccounts.id,
          schema.ledgerAccounts.code,
          schema.ledgerAccounts.name,
          schema.ledgerAccounts.normalBalance,
          schema.ledgerAccounts.currency,
          schema.ledgerAccounts.isActive,
        )
        .limit(1);
      if (!row) return { ok: false, reason: 'account_not_found' };

      const debit = parsePhpMoney(row.debitTotal);
      const credit = parsePhpMoney(row.creditTotal);
      const balance = row.normalBalance === 'debit'
        ? subtractPhpMoney(debit, credit)
        : subtractPhpMoney(credit, debit);

      return {
        ok: true,
        account: {
          accountId: row.accountId,
          code: row.code,
          name: row.name,
          normalBalance: row.normalBalance,
          currency: row.currency,
          isActive: row.isActive,
          debitTotal: formatPhpMoney(debit),
          creditTotal: formatPhpMoney(credit),
          balance: formatPhpMoney(balance),
        },
      };
    },
  };
}
