import { createHash } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  addPhpMoney,
  comparePhpMoney,
  formatPhpMoney,
  parsePhpMoney,
  phpAmountSchema,
  roleKeySchema,
  type PhpMoney,
  type RoleKey,
} from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

const ledgerLineInputSchema = z.object({
  accountId: z.uuid(),
  direction: z.enum(['debit', 'credit']),
  amount: phpAmountSchema,
  memo: z.string().trim().min(1).max(500).optional(),
}).strict();

const ledgerActorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('system') }).strict(),
  z.object({ type: z.literal('user'), userId: z.uuid(), roles: z.array(roleKeySchema) }).strict(),
]);

const ledgerPostingInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  sourceType: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  effectiveAt: z.date().refine((value) => Number.isFinite(value.getTime()), 'Invalid effective date'),
  actor: ledgerActorSchema,
  requestId: z.uuid().optional(),
  lines: z.array(ledgerLineInputSchema).min(2).max(100),
}).strict();

const ledgerReversalInputSchema = z.object({
  originalTransactionId: z.uuid(),
  idempotencyKey: z.string().trim().min(1).max(200),
  sourceType: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  effectiveAt: z.date().refine((value) => Number.isFinite(value.getTime()), 'Invalid effective date'),
  actor: ledgerActorSchema,
  requestId: z.uuid().optional(),
}).strict();

export type LedgerPostingInput = z.input<typeof ledgerPostingInputSchema> & {
  actor: { type: 'system' } | { type: 'user'; userId: string; roles: RoleKey[] };
};

export type LedgerPostingResult =
  | { ok: true; created: boolean; transactionId: string; payloadHash: string }
  | {
    ok: false;
    reason:
      | 'duplicate_account'
      | 'non_positive_amount'
      | 'unbalanced'
      | 'account_not_found'
      | 'account_inactive'
      | 'idempotency_conflict';
  };

export type LedgerReversalInput = z.input<typeof ledgerReversalInputSchema> & {
  actor: { type: 'system' } | { type: 'user'; userId: string; roles: RoleKey[] };
};

export type LedgerReversalResult =
  | { ok: true; created: boolean; transactionId: string; payloadHash: string }
  | {
    ok: false;
    reason:
      | 'original_not_found'
      | 'original_is_reversal'
      | 'original_already_reversed'
      | 'idempotency_conflict';
  };

type LedgerPostingDatabase = Pick<Database, 'select' | 'insert'>;

interface CanonicalLine {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: string;
  memo: string | null;
}

function canonicalize(input: z.output<typeof ledgerPostingInputSchema>): {
  lines: CanonicalLine[];
  payloadHash: string;
} {
  const lines = input.lines
    .map((line): CanonicalLine => ({
      accountId: line.accountId,
      direction: line.direction,
      amount: line.amount,
      memo: line.memo ?? null,
    }))
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
  const payloadHash = hashPostingPayload(input, lines);
  return { lines, payloadHash };
}

function hashPostingPayload(
  input: {
    sourceType: string;
    sourceId: string;
    description: string;
    effectiveAt: Date;
  },
  lines: CanonicalLine[],
  reversalOfTransactionId: string | null = null,
): string {
  return createHash('sha256').update(JSON.stringify({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    effectiveAt: input.effectiveAt.toISOString(),
    currency: 'PHP',
    reversalOfTransactionId,
    lines,
  })).digest('hex');
}

export async function postLedgerTransactionInTransaction(
  database: LedgerPostingDatabase,
  rawInput: LedgerPostingInput,
  postedAt: Date = new Date(),
): Promise<LedgerPostingResult> {
  const input = ledgerPostingInputSchema.parse(rawInput);
  const { lines, payloadHash } = canonicalize(input);
  if (new Set(lines.map(({ accountId }) => accountId)).size !== lines.length) {
    return { ok: false, reason: 'duplicate_account' };
  }

  const debitValues: PhpMoney[] = [];
  const creditValues: PhpMoney[] = [];
  for (const line of lines) {
    const amount = parsePhpMoney(line.amount);
    if (amount.minorUnits <= 0n) return { ok: false, reason: 'non_positive_amount' };
    (line.direction === 'debit' ? debitValues : creditValues).push(amount);
  }
  const debitTotal = addPhpMoney(...debitValues);
  const creditTotal = addPhpMoney(...creditValues);
  if (comparePhpMoney(debitTotal, creditTotal) !== 0) {
    return { ok: false, reason: 'unbalanced' };
  }

  const [existing] = await database
    .select({ id: schema.ledgerTransactions.id, payloadHash: schema.ledgerTransactions.payloadHash })
    .from(schema.ledgerTransactions)
    .where(eq(schema.ledgerTransactions.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) {
    return existing.payloadHash === payloadHash
      ? { ok: true, created: false, transactionId: existing.id, payloadHash }
      : { ok: false, reason: 'idempotency_conflict' };
  }

  const accounts = await database
    .select({
      id: schema.ledgerAccounts.id,
      isActive: schema.ledgerAccounts.isActive,
      currency: schema.ledgerAccounts.currency,
    })
    .from(schema.ledgerAccounts)
    .where(inArray(schema.ledgerAccounts.id, lines.map(({ accountId }) => accountId)))
    .for('share');
  if (accounts.length !== lines.length || accounts.some(({ currency }) => currency !== 'PHP')) {
    return { ok: false, reason: 'account_not_found' };
  }
  if (accounts.some(({ isActive }) => !isActive)) {
    return { ok: false, reason: 'account_inactive' };
  }

  const [created] = await database
    .insert(schema.ledgerTransactions)
    .values({
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      description: input.description,
      effectiveAt: input.effectiveAt,
      postedAt,
      actorUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
      requestId: input.requestId,
    })
    .onConflictDoNothing({ target: schema.ledgerTransactions.idempotencyKey })
    .returning({ id: schema.ledgerTransactions.id });
  if (!created) {
    const [concurrent] = await database
      .select({ id: schema.ledgerTransactions.id, payloadHash: schema.ledgerTransactions.payloadHash })
      .from(schema.ledgerTransactions)
      .where(eq(schema.ledgerTransactions.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return concurrent?.payloadHash === payloadHash
      ? { ok: true, created: false, transactionId: concurrent.id, payloadHash }
      : { ok: false, reason: 'idempotency_conflict' };
  }

  await database.insert(schema.ledgerEntries).values(lines.map((line, index) => ({
    transactionId: created.id,
    lineNumber: index + 1,
    accountId: line.accountId,
    direction: line.direction,
    amount: line.amount,
    currency: 'PHP' as const,
    memo: line.memo,
    createdAt: postedAt,
  })));
  await writeAudit(database, {
    actorType: input.actor.type,
    actorUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
    actorRoles: input.actor.type === 'user' ? input.actor.roles : [],
    action: 'ledger.transaction.posted',
    outcome: 'succeeded',
    resourceType: 'ledger_transaction',
    resourceId: created.id,
    requestId: input.requestId,
    reason: input.description,
    metadata: {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      payloadHash,
      debitTotal: formatPhpMoney(debitTotal),
      currency: 'PHP',
    },
  });

  return { ok: true, created: true, transactionId: created.id, payloadHash };
}

export async function reverseLedgerTransactionInTransaction(
  database: LedgerPostingDatabase,
  rawInput: LedgerReversalInput,
  postedAt: Date = new Date(),
): Promise<LedgerReversalResult> {
  const input = ledgerReversalInputSchema.parse(rawInput);
  const [original] = await database
    .select({
      id: schema.ledgerTransactions.id,
      reversalOfTransactionId: schema.ledgerTransactions.reversalOfTransactionId,
    })
    .from(schema.ledgerTransactions)
    .where(eq(schema.ledgerTransactions.id, input.originalTransactionId))
    .for('update')
    .limit(1);
  if (!original) return { ok: false, reason: 'original_not_found' };
  if (original.reversalOfTransactionId) return { ok: false, reason: 'original_is_reversal' };

  const originalLines = await database
    .select({
      accountId: schema.ledgerEntries.accountId,
      direction: schema.ledgerEntries.direction,
      amount: schema.ledgerEntries.amount,
      memo: schema.ledgerEntries.memo,
    })
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.transactionId, original.id))
    .orderBy(asc(schema.ledgerEntries.lineNumber));
  const lines: CanonicalLine[] = originalLines
    .map((line) => ({
      accountId: line.accountId,
      direction: line.direction === 'debit' ? 'credit' as const : 'debit' as const,
      amount: line.amount,
      memo: line.memo,
    }))
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
  const payloadHash = hashPostingPayload(input, lines, original.id);

  const [existingIdempotency] = await database
    .select({
      id: schema.ledgerTransactions.id,
      payloadHash: schema.ledgerTransactions.payloadHash,
      reversalOfTransactionId: schema.ledgerTransactions.reversalOfTransactionId,
    })
    .from(schema.ledgerTransactions)
    .where(eq(schema.ledgerTransactions.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existingIdempotency) {
    return existingIdempotency.payloadHash === payloadHash
      && existingIdempotency.reversalOfTransactionId === original.id
      ? { ok: true, created: false, transactionId: existingIdempotency.id, payloadHash }
      : { ok: false, reason: 'idempotency_conflict' };
  }

  const [existingReversal] = await database
    .select({ id: schema.ledgerTransactions.id })
    .from(schema.ledgerTransactions)
    .where(eq(schema.ledgerTransactions.reversalOfTransactionId, original.id))
    .limit(1);
  if (existingReversal) return { ok: false, reason: 'original_already_reversed' };

  const [created] = await database
    .insert(schema.ledgerTransactions)
    .values({
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      description: input.description,
      effectiveAt: input.effectiveAt,
      postedAt,
      reversalOfTransactionId: original.id,
      actorUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
      requestId: input.requestId,
    })
    .onConflictDoNothing({ target: schema.ledgerTransactions.idempotencyKey })
    .returning({ id: schema.ledgerTransactions.id });
  if (!created) {
    const [concurrent] = await database
      .select({
        id: schema.ledgerTransactions.id,
        payloadHash: schema.ledgerTransactions.payloadHash,
        reversalOfTransactionId: schema.ledgerTransactions.reversalOfTransactionId,
      })
      .from(schema.ledgerTransactions)
      .where(eq(schema.ledgerTransactions.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return concurrent?.payloadHash === payloadHash
      && concurrent.reversalOfTransactionId === original.id
      ? { ok: true, created: false, transactionId: concurrent.id, payloadHash }
      : { ok: false, reason: 'idempotency_conflict' };
  }

  await database.insert(schema.ledgerEntries).values(lines.map((line, index) => ({
    transactionId: created.id,
    lineNumber: index + 1,
    accountId: line.accountId,
    direction: line.direction,
    amount: line.amount,
    currency: 'PHP' as const,
    memo: line.memo,
    createdAt: postedAt,
  })));
  await writeAudit(database, {
    actorType: input.actor.type,
    actorUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
    actorRoles: input.actor.type === 'user' ? input.actor.roles : [],
    action: 'ledger.transaction.reversed',
    outcome: 'succeeded',
    resourceType: 'ledger_transaction',
    resourceId: created.id,
    requestId: input.requestId,
    reason: input.description,
    metadata: {
      originalTransactionId: original.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      payloadHash,
      currency: 'PHP',
    },
  });

  return { ok: true, created: true, transactionId: created.id, payloadHash };
}

export function createLedgerPostingService(
  database: Database,
  clock: () => Date = () => new Date(),
) {
  return {
    post(input: LedgerPostingInput): Promise<LedgerPostingResult> {
      return database.transaction(
        async (transaction) => postLedgerTransactionInTransaction(transaction, input, clock()),
      );
    },
    reverse(input: LedgerReversalInput): Promise<LedgerReversalResult> {
      return database.transaction(
        async (transaction) => reverseLedgerTransactionInTransaction(transaction, input, clock()),
      );
    },
  };
}
