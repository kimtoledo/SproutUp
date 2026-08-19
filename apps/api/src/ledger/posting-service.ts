import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
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
  const payloadHash = createHash('sha256').update(JSON.stringify({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    description: input.description,
    effectiveAt: input.effectiveAt.toISOString(),
    currency: 'PHP',
    lines,
  })).digest('hex');
  return { lines, payloadHash };
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
  };
}
