import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { roleKeySchema, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

/**
 * Effective-dated configuration service.
 *
 * Reads: `resolve(key, at)` returns the version of a rule in force at `at`
 * (greatest `effective_from <= at`). Writes: `registerRuleSet` declares a key;
 * `publish` appends a new immutable version. Nothing is ever updated in place,
 * so a historical fee/tax/eligibility computation can be replayed exactly.
 *
 * This slice ships the mechanism only. Concrete rule keys and bodies (KYC
 * required-field/document matrices, tax rates, investment limits, SLA
 * thresholds, scorecard weights) are seeded by their owning MVP task, each
 * flagged `ASSUMED FOR PILOT` until the business owner confirms it.
 */

const ruleKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'rule key must be lowercase dotted/dashed segments');

const ruleBodySchema = z.record(z.string(), z.unknown());

const actorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('system') }).strict(),
  z.object({ type: z.literal('user'), userId: z.uuid(), roles: z.array(roleKeySchema) }).strict(),
]);

const registerSchema = z
  .object({
    key: ruleKeySchema,
    description: z.string().trim().min(1).max(2000),
  })
  .strict();

const publishSchema = z
  .object({
    key: ruleKeySchema,
    effectiveFrom: z
      .date()
      .refine((value) => Number.isFinite(value.getTime()), 'Invalid effective date'),
    body: ruleBodySchema,
    actor: actorSchema,
    note: z.string().trim().min(1).max(2000).optional(),
    requestId: z.uuid().optional(),
  })
  .strict();

type RuleActor = { type: 'system' } | { type: 'user'; userId: string; roles: RoleKey[] };

export type RegisterRuleSetInput = z.input<typeof registerSchema>;
export type PublishRuleVersionInput = Omit<z.input<typeof publishSchema>, 'actor'> & {
  actor: RuleActor;
};

export interface ResolvedRule {
  key: string;
  version: number;
  effectiveFrom: Date;
  body: Record<string, unknown>;
  note: string | null;
}

export type RegisterRuleSetResult = { ok: true; created: boolean };

export type PublishRuleVersionResult =
  | { ok: true; ruleVersionId: string; version: number; effectiveFrom: Date }
  | { ok: false; reason: 'unknown_rule_key' | 'effective_from_conflict' };

type RuleDatabase = Pick<Database, 'select' | 'insert'>;

const resolvedSelection = {
  key: schema.ruleVersions.ruleKey,
  version: schema.ruleVersions.version,
  effectiveFrom: schema.ruleVersions.effectiveFrom,
  body: schema.ruleVersions.body,
  note: schema.ruleVersions.note,
};

export async function registerRuleSetInTransaction(
  database: RuleDatabase,
  rawInput: RegisterRuleSetInput,
): Promise<RegisterRuleSetResult> {
  const input = registerSchema.parse(rawInput);
  const [created] = await database
    .insert(schema.ruleSets)
    .values({ key: input.key, description: input.description })
    .onConflictDoNothing({ target: schema.ruleSets.key })
    .returning({ key: schema.ruleSets.key });
  return { ok: true, created: Boolean(created) };
}

export async function resolveRuleInDatabase(
  database: Pick<Database, 'select'>,
  rawKey: string,
  at: Date,
): Promise<ResolvedRule | null> {
  const key = ruleKeySchema.parse(rawKey);
  const [row] = await database
    .select(resolvedSelection)
    .from(schema.ruleVersions)
    .where(and(eq(schema.ruleVersions.ruleKey, key), lte(schema.ruleVersions.effectiveFrom, at)))
    .orderBy(desc(schema.ruleVersions.effectiveFrom), desc(schema.ruleVersions.version))
    .limit(1);
  return row ?? null;
}

export async function publishRuleVersionInTransaction(
  database: RuleDatabase,
  rawInput: PublishRuleVersionInput,
  publishedAt: Date = new Date(),
): Promise<PublishRuleVersionResult> {
  const input = publishSchema.parse(rawInput);

  const [ruleSet] = await database
    .select({ key: schema.ruleSets.key })
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.key, input.key))
    .limit(1);
  if (!ruleSet) return { ok: false, reason: 'unknown_rule_key' };

  const [aggregate] = await database
    .select({
      maxVersion: sql<number | null>`max(${schema.ruleVersions.version})`,
      atEffective: sql<number>`count(*) filter (where ${schema.ruleVersions.effectiveFrom} = ${input.effectiveFrom})`,
    })
    .from(schema.ruleVersions)
    .where(eq(schema.ruleVersions.ruleKey, input.key));
  if (Number(aggregate?.atEffective ?? 0) > 0) {
    return { ok: false, reason: 'effective_from_conflict' };
  }
  const nextVersion = Number(aggregate?.maxVersion ?? 0) + 1;

  const [created] = await database
    .insert(schema.ruleVersions)
    .values({
      ruleKey: input.key,
      version: nextVersion,
      effectiveFrom: input.effectiveFrom,
      body: input.body,
      note: input.note,
      publishedByUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
      publishedAt,
    })
    .onConflictDoNothing()
    .returning({
      id: schema.ruleVersions.id,
      version: schema.ruleVersions.version,
      effectiveFrom: schema.ruleVersions.effectiveFrom,
    });
  if (!created) {
    // A concurrent publish claimed this version or effective instant.
    return { ok: false, reason: 'effective_from_conflict' };
  }

  await writeAudit(database, {
    actorType: input.actor.type,
    actorUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
    actorRoles: input.actor.type === 'user' ? input.actor.roles : [],
    action: 'config_rule.published',
    outcome: 'succeeded',
    resourceType: 'config_rule',
    resourceId: created.id,
    requestId: input.requestId,
    metadata: {
      key: input.key,
      version: created.version,
      effectiveFrom: input.effectiveFrom.toISOString(),
      note: input.note ?? null,
    },
  });

  return {
    ok: true,
    ruleVersionId: created.id,
    version: created.version,
    effectiveFrom: created.effectiveFrom,
  };
}

export function createRuleService(database: Database, clock: () => Date = () => new Date()) {
  return {
    registerRuleSet(input: RegisterRuleSetInput): Promise<RegisterRuleSetResult> {
      return database.transaction((transaction) =>
        registerRuleSetInTransaction(transaction, input),
      );
    },
    publish(input: PublishRuleVersionInput): Promise<PublishRuleVersionResult> {
      return database.transaction((transaction) =>
        publishRuleVersionInTransaction(transaction, input, clock()),
      );
    },
    resolve(key: string, at: Date = clock()): Promise<ResolvedRule | null> {
      return resolveRuleInDatabase(database, key, at);
    },
    async listVersions(key: string): Promise<ResolvedRule[]> {
      const parsedKey = ruleKeySchema.parse(key);
      return database
        .select(resolvedSelection)
        .from(schema.ruleVersions)
        .where(eq(schema.ruleVersions.ruleKey, parsedKey))
        .orderBy(desc(schema.ruleVersions.version));
    },
  };
}

export type RuleService = ReturnType<typeof createRuleService>;
