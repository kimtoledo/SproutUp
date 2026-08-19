import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, asc, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Database } from '@sproutup/db';
import {
  createLedgerPostingService,
  postLedgerTransactionInTransaction,
  type LedgerPostingInput,
} from '../src/ledger/posting-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const database = drizzle(pglite, { schema }) as unknown as Database;
const debitAccountId = '00000000-0000-4000-8000-000000000901';
const creditAccountId = '00000000-0000-4000-8000-000000000902';
const inactiveAccountId = '00000000-0000-4000-8000-000000000903';
const actorUserId = '00000000-0000-4000-8000-000000000904';
const requestId = '00000000-0000-4000-8000-000000000905';
const effectiveAt = new Date('2026-08-19T00:00:00.000Z');
const postedAt = new Date('2026-08-19T00:00:01.000Z');

beforeAll(async () => {
  await applyMigrations(pglite);
  await database.insert(schema.users).values({
    id: actorUserId, name: 'Ledger Operator', email: 'ledger-operator@sproutup.ph',
  });
  await database.insert(schema.ledgerAccounts).values([
    { id: debitAccountId, code: 'test.cash', name: 'Test Cash', normalBalance: 'debit' },
    { id: creditAccountId, code: 'test.clearing', name: 'Test Clearing', normalBalance: 'credit' },
    {
      id: inactiveAccountId,
      code: 'test.closed',
      name: 'Test Closed',
      normalBalance: 'debit',
      isActive: false,
    },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

function posting(overrides: Partial<LedgerPostingInput> = {}): LedgerPostingInput {
  return {
    idempotencyKey: 'ledger:posting:test-1',
    sourceType: 'test.receipt',
    sourceId: 'receipt-1',
    description: 'Post exact test receipt',
    effectiveAt,
    actor: { type: 'user', userId: actorUserId, roles: ['finance_officer'] },
    requestId,
    lines: [
      { accountId: creditAccountId, direction: 'credit', amount: '100.01', memo: 'Clearing' },
      { accountId: debitAccountId, direction: 'debit', amount: '100.01', memo: 'Cash' },
    ],
    ...overrides,
  };
}

describe('ledger posting service', () => {
  it('posts a canonical exact balanced transaction and audit evidence atomically', async () => {
    const service = createLedgerPostingService(database, () => postedAt);
    const result = await service.post(posting());
    expect(result).toMatchObject({ ok: true, created: true, payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    if (!result.ok) throw new Error('Expected posting');

    const entries = await database
      .select({
        line: schema.ledgerEntries.lineNumber,
        accountId: schema.ledgerEntries.accountId,
        direction: schema.ledgerEntries.direction,
        amount: schema.ledgerEntries.amount,
      })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.transactionId, result.transactionId))
      .orderBy(asc(schema.ledgerEntries.lineNumber));
    expect(entries).toEqual([
      { line: 1, accountId: debitAccountId, direction: 'debit', amount: '100.01' },
      { line: 2, accountId: creditAccountId, direction: 'credit', amount: '100.01' },
    ]);
    const [audit] = await database
      .select({ action: schema.auditEvents.action, resourceId: schema.auditEvents.resourceId })
      .from(schema.auditEvents)
      .where(and(
        eq(schema.auditEvents.action, 'ledger.transaction.posted'),
        eq(schema.auditEvents.resourceId, result.transactionId),
      ));
    expect(audit).toEqual({ action: 'ledger.transaction.posted', resourceId: result.transactionId });
  }, 15_000);

  it('returns order-independent exact retries without duplicate entries or audit', async () => {
    const service = createLedgerPostingService(database, () => postedAt);
    const original = await service.post(posting());
    const retryInput = posting();
    retryInput.lines = [...retryInput.lines].reverse();
    const retry = await service.post(retryInput);
    expect(retry).toEqual({
      ok: true,
      created: false,
      transactionId: original.ok ? original.transactionId : '',
      payloadHash: original.ok ? original.payloadHash : '',
    });

    const [entryCount] = await database
      .select({ value: count() })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.transactionId, original.ok ? original.transactionId : ''));
    const [auditCount] = await database
      .select({ value: count() })
      .from(schema.auditEvents)
      .where(and(
        eq(schema.auditEvents.action, 'ledger.transaction.posted'),
        eq(schema.auditEvents.resourceId, original.ok ? original.transactionId : ''),
      ));
    expect(entryCount?.value).toBe(2);
    expect(auditCount?.value).toBe(1);
  });

  it('rejects key reuse with a different balanced financial effect', async () => {
    const service = createLedgerPostingService(database, () => postedAt);
    await service.post(posting());
    const result = await service.post(posting({
      lines: [
        { accountId: debitAccountId, direction: 'debit', amount: '100.02' },
        { accountId: creditAccountId, direction: 'credit', amount: '100.02' },
      ],
    }));
    expect(result).toEqual({ ok: false, reason: 'idempotency_conflict' });
  });

  it('rejects duplicate accounts, zero lines, and exact imbalance before persistence', async () => {
    const service = createLedgerPostingService(database, () => postedAt);
    expect(await service.post(posting({
      idempotencyKey: 'ledger:posting:duplicate-account',
      lines: [
        { accountId: debitAccountId, direction: 'debit', amount: '1.00' },
        { accountId: debitAccountId, direction: 'credit', amount: '1.00' },
      ],
    }))).toEqual({ ok: false, reason: 'duplicate_account' });
    expect(await service.post(posting({
      idempotencyKey: 'ledger:posting:zero',
      lines: [
        { accountId: debitAccountId, direction: 'debit', amount: '0.00' },
        { accountId: creditAccountId, direction: 'credit', amount: '0.00' },
      ],
    }))).toEqual({ ok: false, reason: 'non_positive_amount' });
    expect(await service.post(posting({
      idempotencyKey: 'ledger:posting:unbalanced',
      lines: [
        { accountId: debitAccountId, direction: 'debit', amount: '1.00' },
        { accountId: creditAccountId, direction: 'credit', amount: '0.99' },
      ],
    }))).toEqual({ ok: false, reason: 'unbalanced' });
  });

  it('rejects unknown or inactive accounts but resolves an existing retry before closure', async () => {
    const service = createLedgerPostingService(database, () => postedAt);
    const existing = await service.post(posting());
    await database
      .update(schema.ledgerAccounts)
      .set({ isActive: false })
      .where(eq(schema.ledgerAccounts.id, debitAccountId));
    expect(await service.post(posting())).toEqual({
      ok: true,
      created: false,
      transactionId: existing.ok ? existing.transactionId : '',
      payloadHash: existing.ok ? existing.payloadHash : '',
    });
    expect(await service.post(posting({
      idempotencyKey: 'ledger:posting:inactive',
      lines: [
        { accountId: inactiveAccountId, direction: 'debit', amount: '1.00' },
        { accountId: creditAccountId, direction: 'credit', amount: '1.00' },
      ],
    }))).toEqual({ ok: false, reason: 'account_inactive' });
    expect(await service.post(posting({
      idempotencyKey: 'ledger:posting:missing',
      lines: [
        {
          accountId: '00000000-0000-4000-8000-000000000999',
          direction: 'debit',
          amount: '1.00',
        },
        { accountId: creditAccountId, direction: 'credit', amount: '1.00' },
      ],
    }))).toEqual({ ok: false, reason: 'account_not_found' });
  });

  it('rolls back ledger and audit evidence with a failed owning domain transaction', async () => {
    await database
      .update(schema.ledgerAccounts)
      .set({ isActive: true })
      .where(eq(schema.ledgerAccounts.id, debitAccountId));
    const input = posting({ idempotencyKey: 'ledger:posting:domain-rollback' });
    await expect(database.transaction(async (transaction) => {
      const result = await postLedgerTransactionInTransaction(transaction, input, postedAt);
      expect(result).toMatchObject({ ok: true, created: true });
      throw new Error('owning domain failed');
    })).rejects.toThrow('owning domain failed');

    const transactions = await database
      .select({ id: schema.ledgerTransactions.id })
      .from(schema.ledgerTransactions)
      .where(eq(schema.ledgerTransactions.idempotencyKey, input.idempotencyKey));
    expect(transactions).toEqual([]);
  });
});
