import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Database } from '@sproutup/db';
import { createInMemoryFileStorage, type FileStorage } from '../src/storage/file-storage.js';
import {
  createDocumentService,
  type UploadDocumentInput,
} from '../src/documents/document-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const database = drizzle(pglite, { schema }) as unknown as Database;
const ownerId = '00000000-0000-4000-8000-0000000a0001';
const otherId = '00000000-0000-4000-8000-0000000a0002';
const staffId = '00000000-0000-4000-8000-0000000a0003';
const clock = () => new Date('2026-09-05T00:00:00Z');

/** In-memory storage that also records which keys currently hold bytes. */
function trackedStorage(): FileStorage & { keys: () => string[] } {
  const inner = createInMemoryFileStorage();
  const live = new Set<string>();
  return {
    async put(key, bytes, contentType) {
      await inner.put(key, bytes, contentType);
      live.add(key);
    },
    async get(key) {
      return inner.get(key);
    },
    async delete(key) {
      await inner.delete(key);
      live.delete(key);
    },
    keys: () => [...live],
  };
}

beforeAll(async () => {
  await applyMigrations(pglite);
  await database.insert(schema.users).values([
    { id: ownerId, name: 'Owner', email: 'doc-owner@sproutup.ph' },
    { id: otherId, name: 'Other', email: 'doc-other@sproutup.ph' },
    { id: staffId, name: 'Compliance', email: 'doc-staff@sproutup.ph' },
  ]);
  await database.insert(schema.borrowerAccounts).values([
    { id: ownerId, name: 'Owner', email: 'doc-owner@sproutup.ph' },
    { id: otherId, name: 'Other', email: 'doc-other@sproutup.ph' },
  ]);
  await database.insert(schema.adminAccounts).values({
    id: staffId,
    name: 'Compliance',
    email: 'doc-staff@sproutup.ph',
  });
});

afterAll(async () => {
  await pglite.close();
});

function upload(overrides: Partial<UploadDocumentInput> = {}): UploadDocumentInput {
  return {
    ownerUserId: ownerId,
    uploadedByUserId: ownerId,
    actorRoles: [],
    classification: 'kyc_business',
    purpose: 'borrower.sec_registration',
    filename: 'sec.pdf',
    contentType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.7 registration'),
    ...overrides,
  };
}

describe.sequential('document service', () => {
  const storage = trackedStorage();
  const service = () => createDocumentService(database, storage, { clock, maxBytes: 1024 });
  let documentId = '';
  let firstVersionId = '';

  it('creates a document with its first version and audit evidence', async () => {
    const result = await service().create(upload());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('create failed');
    documentId = result.created.documentId;
    firstVersionId = result.created.documentVersionId;
    expect(result.created.version).toBe(1);
    expect(result.created.contentSha256).toMatch(/^[a-f0-9]{64}$/);

    const [audit] = await database
      .select({ action: schema.auditEvents.action, metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, 'document.created'),
          eq(schema.auditEvents.resourceId, documentId),
        ),
      );
    expect(audit?.metadata).toMatchObject({ purpose: 'borrower.sec_registration', version: 1 });
  });

  it('adds a second immutable version to the same document', async () => {
    const result = await service().addVersion(
      documentId,
      upload({ filename: 'sec-v2.pdf', bytes: Buffer.from('%PDF-1.7 corrected') }),
    );
    expect(result).toMatchObject({ ok: true, created: { version: 2 } });

    // The first version row cannot be edited (the DB trigger rejects the write;
    // drizzle wraps the message, so assert only that it throws).
    await expect(
      database
        .update(schema.documentVersions)
        .set({ storageKey: 'tampered' })
        .where(eq(schema.documentVersions.id, firstVersionId)),
    ).rejects.toThrow();
  });

  it('rejects an empty or oversize file without writing bytes', async () => {
    expect(await service().create(upload({ bytes: Buffer.alloc(0) }))).toEqual({
      ok: false,
      reason: 'empty_file',
    });
    expect(await service().create(upload({ bytes: Buffer.alloc(2048, 1) }))).toEqual({
      ok: false,
      reason: 'file_too_large',
    });
  });

  it('gates download on a clean scan and on ownership', async () => {
    const pending = await service().getForDownload({
      documentVersionId: firstVersionId,
      requesterUserId: ownerId,
      staffCanReadAny: false,
    });
    expect(pending).toEqual({ ok: false, reason: 'not_scanned_clean' });

    const scan = await service().markScanResult({
      documentVersionId: firstVersionId,
      outcome: 'clean',
      actorUserId: staffId,
      actorRoles: ['compliance_officer'],
    });
    expect(scan).toEqual({ ok: true, alreadyResolved: false });

    // A second scan result is refused.
    expect(
      await service().markScanResult({
        documentVersionId: firstVersionId,
        outcome: 'infected',
        actorUserId: staffId,
        actorRoles: ['compliance_officer'],
      }),
    ).toEqual({ ok: false, reason: 'already_resolved' });

    const asOwner = await service().getForDownload({
      documentVersionId: firstVersionId,
      requesterUserId: ownerId,
      staffCanReadAny: false,
    });
    expect(asOwner).toMatchObject({ ok: true, contentType: 'application/pdf', originalFilename: 'sec.pdf' });

    expect(
      await service().getForDownload({
        documentVersionId: firstVersionId,
        requesterUserId: otherId,
        staffCanReadAny: false,
      }),
    ).toEqual({ ok: false, reason: 'forbidden' });

    expect(
      (
        await service().getForDownload({
          documentVersionId: firstVersionId,
          requesterUserId: otherId,
          staffCanReadAny: true,
        })
      ).ok,
    ).toBe(true);
  });

  it('lists the latest version per owned document', async () => {
    const owned = await service().listOwn(ownerId);
    const doc = owned.find((d) => d.documentId === documentId);
    expect(doc).toMatchObject({ latestVersion: 2, purpose: 'borrower.sec_registration' });
    expect(await service().listOwn(otherId)).toEqual([]);
  });

  it('deletes the orphaned object when the metadata write fails', async () => {
    const before = storage.keys().length;
    await expect(
      service().create(upload({ ownerUserId: '00000000-0000-4000-8000-0000000affff' })),
    ).rejects.toThrow();
    expect(storage.keys().length).toBe(before);
  });
});
