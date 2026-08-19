import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Database } from '@sproutup/db';
import { createLedgerBalanceService } from '../src/ledger/balance-service.js';
import { createLedgerPostingService } from '../src/ledger/posting-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const database = drizzle(pglite, { schema }) as unknown as Database;
const assetAccountId = '00000000-0000-4000-8000-000000000a01';
const liabilityAccountId = '00000000-0000-4000-8000-000000000a02';
const emptyAccountId = '00000000-0000-4000-8000-000000000a03';
const postedAt = new Date('2026-08-19T01:00:00.000Z');

beforeAll(async () => {
  await applyMigrations(pglite);
  await database.insert(schema.ledgerAccounts).values([
    { id: assetAccountId, code: 'test.balance.asset', name: 'Balance Asset', normalBalance: 'debit' },
    {
      id: liabilityAccountId,
      code: 'test.balance.liability',
      name: 'Balance Liability',
      normalBalance: 'credit',
    },
    {
      id: emptyAccountId,
      code: 'test.balance.empty',
      name: 'Empty Closed Account',
      normalBalance: 'debit',
      isActive: false,
    },
  ]);
  const posting = createLedgerPostingService(database, () => postedAt);
  const first = await posting.post({
    idempotencyKey: 'ledger:balance:first',
    sourceType: 'test.balance',
    sourceId: 'first',
    description: 'First balance projection posting',
    effectiveAt: postedAt,
    actor: { type: 'system' },
    lines: [
      { accountId: assetAccountId, direction: 'debit', amount: '100.01' },
      { accountId: liabilityAccountId, direction: 'credit', amount: '100.01' },
    ],
  });
  const second = await posting.post({
    idempotencyKey: 'ledger:balance:second',
    sourceType: 'test.balance',
    sourceId: 'second',
    description: 'Second balance projection posting',
    effectiveAt: postedAt,
    actor: { type: 'system' },
    lines: [
      { accountId: assetAccountId, direction: 'credit', amount: '125.02' },
      { accountId: liabilityAccountId, direction: 'debit', amount: '125.02' },
    ],
  });
  if (!first.ok || !second.ok) throw new Error('Expected balance projection fixtures');
});

afterAll(async () => {
  await pglite.close();
});

describe('ledger balance service', () => {
  it('derives exact debit-normal totals and a negative balance from immutable entries', async () => {
    const result = await createLedgerBalanceService(database).getAccountBalance(assetAccountId);
    expect(result).toEqual({
      ok: true,
      account: {
        accountId: assetAccountId,
        code: 'test.balance.asset',
        name: 'Balance Asset',
        normalBalance: 'debit',
        currency: 'PHP',
        isActive: true,
        debitTotal: '100.01',
        creditTotal: '125.02',
        balance: '-25.01',
      },
    });
  }, 15_000);

  it('derives the inverse exact balance for a credit-normal account', async () => {
    const result = await createLedgerBalanceService(database).getAccountBalance(liabilityAccountId);
    expect(result).toMatchObject({
      ok: true,
      account: {
        normalBalance: 'credit',
        debitTotal: '125.02',
        creditTotal: '100.01',
        balance: '-25.01',
      },
    });
  });

  it('returns canonical zero totals for an empty closed account', async () => {
    const result = await createLedgerBalanceService(database).getAccountBalance(emptyAccountId);
    expect(result).toMatchObject({
      ok: true,
      account: {
        isActive: false,
        debitTotal: '0.00',
        creditTotal: '0.00',
        balance: '0.00',
      },
    });
  });

  it('returns a stable not-found result without fabricating an account', async () => {
    await expect(createLedgerBalanceService(database).getAccountBalance(
      '00000000-0000-4000-8000-000000000aff',
    )).resolves.toEqual({ ok: false, reason: 'account_not_found' });
  });
});
