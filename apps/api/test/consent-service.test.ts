import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Database } from '@sproutup/db';
import {
  acceptConsentDocumentInTransaction,
  createConsentService,
  type ConsentAcceptanceInput,
  type ConsentPublicationInput,
} from '../src/consents/consent-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const database = drizzle(pglite, { schema }) as unknown as Database;
const userId = '00000000-0000-4000-8000-000000000d01';
const publishedAt = new Date('2026-08-19T00:00:00.000Z');
const effectiveAt = new Date('2026-08-20T00:00:00.000Z');
const acceptedAt = new Date('2026-08-21T00:00:00.000Z');
const content = 'Exact pilot terms\nVersion one.';
const contentHash = createHash('sha256').update(content, 'utf8').digest('hex');

beforeAll(async () => {
  await applyMigrations(pglite);
  await database.insert(schema.users).values({
    id: userId,
    name: 'Consent Applicant',
    email: 'consent-service@sproutup.ph',
  });
  await database.insert(schema.borrowerAccounts).values({
    id: userId,
    name: 'Consent Applicant',
    email: 'consent-service@sproutup.ph',
  });
});

afterAll(async () => {
  await pglite.close();
});

function publication(overrides: Partial<ConsentPublicationInput> = {}): ConsentPublicationInput {
  return {
    documentKey: 'pilot.terms',
    version: 1,
    title: 'Pilot Terms',
    locale: 'en-PH',
    content,
    effectiveAt,
    actor: { type: 'system' },
    requestId: '00000000-0000-4000-8000-000000000d02',
    ...overrides,
  };
}

describe.sequential('consent service', () => {
  it('publishes exact UTF-8 content and audit evidence atomically', async () => {
    const result = await createConsentService(database, () => publishedAt).publish(publication());
    expect(result).toMatchObject({
      ok: true,
      created: true,
      document: {
        documentKey: 'pilot.terms',
        version: 1,
        content,
        contentSha256: contentHash,
        effectiveAt,
        publishedAt,
      },
    });
    if (!result.ok) throw new Error('Expected publication');
    const [audit] = await database
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(and(
        eq(schema.auditEvents.action, 'consent_document.published'),
        eq(schema.auditEvents.resourceId, result.document.id),
      ));
    expect(audit?.action).toBe('consent_document.published');
  }, 15_000);

  it('returns exact publication retries and rejects changed version identity', async () => {
    const service = createConsentService(database, () => publishedAt);
    await expect(service.publish(publication())).resolves.toMatchObject({ ok: true, created: false });
    await expect(service.publish(publication({ content: 'Changed terms under the same version.' })))
      .resolves.toEqual({ ok: false, reason: 'version_conflict' });
    const [documents] = await database.select({ value: count() }).from(schema.consentDocuments);
    const [audits] = await database
      .select({ value: count() })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'consent_document.published'));
    expect(documents?.value).toBe(1);
    expect(audits?.value).toBe(1);
  });

  it('selects only the latest version effective at the requested time', async () => {
    const service = createConsentService(database, () => publishedAt);
    await service.publish(publication({
      version: 2,
      content: 'Future pilot terms.',
      effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      requestId: '00000000-0000-4000-8000-000000000d03',
    }));
    await expect(service.getLatestEffective(
      'pilot.terms',
      'en-PH',
      new Date('2026-08-19T23:59:59.000Z'),
    )).resolves.toBeNull();
    await expect(service.getLatestEffective('pilot.terms', 'en-PH', acceptedAt))
      .resolves.toMatchObject({ version: 1, contentSha256: contentHash });
    await expect(service.getLatestEffective(
      'pilot.terms',
      'en-PH',
      new Date('2026-09-02T00:00:00.000Z'),
    )).resolves.toMatchObject({ version: 2 });
  });

  it('accepts an exact effective document once and appends audit evidence', async () => {
    const service = createConsentService(database, () => acceptedAt);
    const document = await service.getLatestEffective('pilot.terms', 'en-PH', acceptedAt);
    if (!document) throw new Error('Expected effective document');
    const input: ConsentAcceptanceInput = {
      userId,
      actorRoles: ['sme_borrower'],
      consentDocumentId: document.id,
      contentSha256: document.contentSha256,
      requestId: '00000000-0000-4000-8000-000000000d04',
      ipAddressHash: 'a'.repeat(64),
      userAgentHash: 'b'.repeat(64),
    };
    const result = await service.accept(input);
    expect(result).toMatchObject({ ok: true, created: true, acceptedAt });
    await expect(service.accept(input)).resolves.toMatchObject({
      ok: true,
      created: false,
      acceptanceId: result.ok ? result.acceptanceId : '',
    });
    const [audit] = await database
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'consent_document.accepted'));
    expect(audit?.action).toBe('consent_document.accepted');
  });

  it('rejects missing, future-effective, mismatched, and unknown-user acceptance', async () => {
    const service = createConsentService(database, () => publishedAt);
    const versionOne = await createConsentService(database).getLatestEffective(
      'pilot.terms',
      'en-PH',
      acceptedAt,
    );
    const future = await createConsentService(database).getLatestEffective(
      'pilot.terms',
      'en-PH',
      new Date('2026-09-02T00:00:00.000Z'),
    );
    if (!versionOne || !future) throw new Error('Expected consent fixtures');
    const base: ConsentAcceptanceInput = {
      userId,
      actorRoles: ['sme_borrower'],
      consentDocumentId: versionOne.id,
      contentSha256: versionOne.contentSha256,
    };
    await expect(service.accept({ ...base, consentDocumentId: future.id, contentSha256: future.contentSha256 }))
      .resolves.toEqual({ ok: false, reason: 'document_not_effective' });
    await expect(createConsentService(database, () => acceptedAt).accept({
      ...base,
      contentSha256: 'f'.repeat(64),
    })).resolves.toEqual({ ok: false, reason: 'content_mismatch' });
    await expect(createConsentService(database, () => acceptedAt).accept({
      ...base,
      userId: '00000000-0000-4000-8000-000000000d99',
    })).resolves.toEqual({ ok: false, reason: 'user_not_found' });
    await expect(createConsentService(database, () => acceptedAt).accept({
      ...base,
      consentDocumentId: '00000000-0000-4000-8000-000000000d98',
    })).resolves.toEqual({ ok: false, reason: 'document_not_found' });
  });

  it('rolls acceptance and audit evidence back with an owning domain transaction', async () => {
    const publicationService = createConsentService(database, () => publishedAt);
    const published = await publicationService.publish(publication({
      documentKey: 'pilot.privacy',
      requestId: '00000000-0000-4000-8000-000000000d05',
    }));
    if (!published.ok) throw new Error('Expected privacy publication');
    await expect(database.transaction(async (transaction) => {
      const result = await acceptConsentDocumentInTransaction(transaction, {
        userId,
        actorRoles: ['sme_borrower'],
        consentDocumentId: published.document.id,
        contentSha256: published.document.contentSha256,
        requestId: '00000000-0000-4000-8000-000000000d06',
      }, acceptedAt);
      expect(result).toMatchObject({ ok: true, created: true });
      throw new Error('owning consent domain failed');
    })).rejects.toThrow('owning consent domain failed');
    const acceptances = await database
      .select({ id: schema.consentAcceptances.id })
      .from(schema.consentAcceptances)
      .where(eq(schema.consentAcceptances.consentDocumentId, published.document.id));
    expect(acceptances).toEqual([]);
  });
});
