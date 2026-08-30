import { createHash } from 'node:crypto';
import { and, desc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import { roleKeySchema, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

const documentKeySchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const localeSchema = z.string().min(2).max(20).regex(/^[a-z]{2}(?:-[A-Z]{2})?$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const consentActorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('system') }).strict(),
  z.object({ type: z.literal('user'), userId: z.uuid(), roles: z.array(roleKeySchema) }).strict(),
]);
const publicationSchema = z.object({
  documentKey: documentKeySchema,
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  locale: localeSchema.default('en-PH'),
  content: z.string().min(1).max(1_000_000),
  effectiveAt: z.date().refine((value) => Number.isFinite(value.getTime()), 'Invalid effective date'),
  actor: consentActorSchema,
  requestId: z.uuid().optional(),
}).strict();
const acceptanceSchema = z.object({
  userId: z.uuid(),
  actorRoles: z.array(roleKeySchema),
  consentDocumentId: z.uuid(),
  contentSha256: sha256Schema,
  requestId: z.uuid().optional(),
  ipAddressHash: sha256Schema.optional(),
  userAgentHash: sha256Schema.optional(),
}).strict();

export type ConsentPublicationInput = z.input<typeof publicationSchema> & {
  actor: { type: 'system' } | { type: 'user'; userId: string; roles: RoleKey[] };
};
export type ConsentAcceptanceInput = z.input<typeof acceptanceSchema> & { actorRoles: RoleKey[] };

export interface ConsentDocumentProjection {
  id: string;
  documentKey: string;
  version: number;
  title: string;
  locale: string;
  content: string;
  contentSha256: string;
  effectiveAt: Date;
  publishedAt: Date;
}

export type ConsentPublicationResult =
  | { ok: true; created: boolean; document: ConsentDocumentProjection }
  | { ok: false; reason: 'version_conflict' };

export type ConsentAcceptanceResult =
  | { ok: true; created: boolean; acceptanceId: string; acceptedAt: Date }
  | {
    ok: false;
    reason: 'document_not_found' | 'document_not_effective' | 'content_mismatch' | 'user_not_found';
  };

type ConsentDatabase = Pick<Database, 'select' | 'insert'>;

const documentProjection = {
  id: schema.consentDocuments.id,
  documentKey: schema.consentDocuments.documentKey,
  version: schema.consentDocuments.version,
  title: schema.consentDocuments.title,
  locale: schema.consentDocuments.locale,
  content: schema.consentDocuments.content,
  contentSha256: schema.consentDocuments.contentSha256,
  effectiveAt: schema.consentDocuments.effectiveAt,
  publishedAt: schema.consentDocuments.publishedAt,
};

function contentSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isExactPublication(
  existing: ConsentDocumentProjection,
  input: z.output<typeof publicationSchema>,
  hash: string,
): boolean {
  return existing.title === input.title
    && existing.content === input.content
    && existing.contentSha256 === hash
    && existing.effectiveAt.getTime() === input.effectiveAt.getTime();
}

export async function publishConsentDocumentInTransaction(
  database: ConsentDatabase,
  rawInput: ConsentPublicationInput,
  publishedAt: Date = new Date(),
): Promise<ConsentPublicationResult> {
  const input = publicationSchema.parse(rawInput);
  const hash = contentSha256(input.content);
  const [existing] = await database
    .select(documentProjection)
    .from(schema.consentDocuments)
    .where(and(
      eq(schema.consentDocuments.documentKey, input.documentKey),
      eq(schema.consentDocuments.locale, input.locale),
      eq(schema.consentDocuments.version, input.version),
    ))
    .limit(1);
  if (existing) {
    return isExactPublication(existing, input, hash)
      ? { ok: true, created: false, document: existing }
      : { ok: false, reason: 'version_conflict' };
  }

  const [created] = await database
    .insert(schema.consentDocuments)
    .values({
      documentKey: input.documentKey,
      version: input.version,
      title: input.title,
      locale: input.locale,
      content: input.content,
      contentSha256: hash,
      effectiveAt: input.effectiveAt,
      publishedAt,
      publishedByUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
    })
    .onConflictDoNothing({
      target: [
        schema.consentDocuments.documentKey,
        schema.consentDocuments.locale,
        schema.consentDocuments.version,
      ],
    })
    .returning(documentProjection);
  if (!created) {
    const [concurrent] = await database
      .select(documentProjection)
      .from(schema.consentDocuments)
      .where(and(
        eq(schema.consentDocuments.documentKey, input.documentKey),
        eq(schema.consentDocuments.locale, input.locale),
        eq(schema.consentDocuments.version, input.version),
      ))
      .limit(1);
    return concurrent && isExactPublication(concurrent, input, hash)
      ? { ok: true, created: false, document: concurrent }
      : { ok: false, reason: 'version_conflict' };
  }

  await writeAudit(database, {
    actorType: input.actor.type,
    actorUserId: input.actor.type === 'user' ? input.actor.userId : undefined,
    actorRoles: input.actor.type === 'user' ? input.actor.roles : [],
    action: 'consent_document.published',
    outcome: 'succeeded',
    resourceType: 'consent_document',
    resourceId: created.id,
    requestId: input.requestId,
    metadata: {
      documentKey: input.documentKey,
      version: input.version,
      locale: input.locale,
      contentSha256: hash,
      effectiveAt: input.effectiveAt.toISOString(),
    },
  });
  return { ok: true, created: true, document: created };
}

export async function acceptConsentDocumentInTransaction(
  database: ConsentDatabase,
  rawInput: ConsentAcceptanceInput,
  acceptedAt: Date = new Date(),
): Promise<ConsentAcceptanceResult> {
  const input = acceptanceSchema.parse(rawInput);
  const [document] = await database
    .select(documentProjection)
    .from(schema.consentDocuments)
    .where(eq(schema.consentDocuments.id, input.consentDocumentId))
    .limit(1);
  if (!document) return { ok: false, reason: 'document_not_found' };
  const [user] = await database
    .select({ id: schema.accountEmailRegistry.accountId })
    .from(schema.accountEmailRegistry)
    .where(eq(schema.accountEmailRegistry.accountId, input.userId))
    .limit(1);
  if (!user) return { ok: false, reason: 'user_not_found' };
  if (document.contentSha256 !== input.contentSha256) {
    return { ok: false, reason: 'content_mismatch' };
  }
  if (document.effectiveAt.getTime() > acceptedAt.getTime()) {
    return { ok: false, reason: 'document_not_effective' };
  }

  const [existing] = await database
    .select({
      id: schema.consentAcceptances.id,
      acceptedAt: schema.consentAcceptances.acceptedAt,
    })
    .from(schema.consentAcceptances)
    .where(and(
      eq(schema.consentAcceptances.userId, input.userId),
      eq(schema.consentAcceptances.consentDocumentId, input.consentDocumentId),
    ))
    .limit(1);
  if (existing) {
    return { ok: true, created: false, acceptanceId: existing.id, acceptedAt: existing.acceptedAt };
  }

  const [created] = await database
    .insert(schema.consentAcceptances)
    .values({
      userId: input.userId,
      consentDocumentId: input.consentDocumentId,
      acceptedContentSha256: input.contentSha256,
      requestId: input.requestId,
      ipAddressHash: input.ipAddressHash,
      userAgentHash: input.userAgentHash,
      acceptedAt,
    })
    .onConflictDoNothing({
      target: [
        schema.consentAcceptances.userId,
        schema.consentAcceptances.consentDocumentId,
      ],
    })
    .returning({ id: schema.consentAcceptances.id, acceptedAt: schema.consentAcceptances.acceptedAt });
  if (!created) {
    const [concurrent] = await database
      .select({
        id: schema.consentAcceptances.id,
        acceptedAt: schema.consentAcceptances.acceptedAt,
      })
      .from(schema.consentAcceptances)
      .where(and(
        eq(schema.consentAcceptances.userId, input.userId),
        eq(schema.consentAcceptances.consentDocumentId, input.consentDocumentId),
      ))
      .limit(1);
    if (!concurrent) throw new Error('Concurrent consent acceptance could not be resolved');
    return {
      ok: true,
      created: false,
      acceptanceId: concurrent.id,
      acceptedAt: concurrent.acceptedAt,
    };
  }

  await writeAudit(database, {
    actorType: 'user',
    actorUserId: input.userId,
    actorRoles: input.actorRoles,
    action: 'consent_document.accepted',
    outcome: 'succeeded',
    resourceType: 'consent_document',
    resourceId: document.id,
    requestId: input.requestId,
    metadata: {
      consentAcceptanceId: created.id,
      documentKey: document.documentKey,
      version: document.version,
      locale: document.locale,
      contentSha256: document.contentSha256,
    },
  });
  return { ok: true, created: true, acceptanceId: created.id, acceptedAt: created.acceptedAt };
}

export function createConsentService(
  database: Database,
  clock: () => Date = () => new Date(),
) {
  return {
    publish(input: ConsentPublicationInput): Promise<ConsentPublicationResult> {
      return database.transaction(
        async (transaction) => publishConsentDocumentInTransaction(transaction, input, clock()),
      );
    },
    accept(input: ConsentAcceptanceInput): Promise<ConsentAcceptanceResult> {
      return database.transaction(
        async (transaction) => acceptConsentDocumentInTransaction(transaction, input, clock()),
      );
    },
    async getLatestEffective(
      documentKey: string,
      locale: string = 'en-PH',
      at: Date = clock(),
    ): Promise<ConsentDocumentProjection | null> {
      const parsedKey = documentKeySchema.parse(documentKey);
      const parsedLocale = localeSchema.parse(locale);
      const [document] = await database
        .select(documentProjection)
        .from(schema.consentDocuments)
        .where(and(
          eq(schema.consentDocuments.documentKey, parsedKey),
          eq(schema.consentDocuments.locale, parsedLocale),
          lte(schema.consentDocuments.effectiveAt, at),
        ))
        .orderBy(desc(schema.consentDocuments.effectiveAt), desc(schema.consentDocuments.version))
        .limit(1);
      return document ?? null;
    },
  };
}
