import { createHash, randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { roleKeySchema, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';
import type { FileStorage } from '../storage/file-storage.js';

export const documentClassificationSchema = z.enum([
  'kyc_identity',
  'kyc_address',
  'kyc_business',
  'financial',
  'contract',
  'other',
]);
export type DocumentClassification = z.infer<typeof documentClassificationSchema>;

export const DEFAULT_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MiB
export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

const purposeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'purpose must be a lowercase dotted/dashed tag');

const uploadSchema = z
  .object({
    ownerUserId: z.uuid(),
    uploadedByUserId: z.uuid(),
    actorRoles: z.array(roleKeySchema),
    classification: documentClassificationSchema,
    purpose: purposeSchema,
    filename: z.string().trim().min(1).max(255),
    contentType: z.enum(ALLOWED_DOCUMENT_CONTENT_TYPES),
    retentionUntil: z.date().optional(),
    requestId: z.uuid().optional(),
  })
  .strict();

export type UploadDocumentInput = Omit<z.input<typeof uploadSchema>, 'actorRoles'> & {
  actorRoles: RoleKey[];
  bytes: Buffer;
};

export interface DocumentVersionRef {
  documentId: string;
  documentVersionId: string;
  version: number;
  contentSha256: string;
  byteSize: number;
}

export type UploadResult =
  | { ok: true; created: DocumentVersionRef }
  | { ok: false; reason: 'empty_file' | 'file_too_large' | 'document_not_found' | 'owner_mismatch' };

export type ScanResultInput = {
  documentVersionId: string;
  outcome: 'clean' | 'infected' | 'error';
  actorUserId: string;
  actorRoles: RoleKey[];
  requestId?: string;
};
export type ScanResult =
  | { ok: true; alreadyResolved: boolean }
  | { ok: false; reason: 'version_not_found' | 'already_resolved' };

export type DownloadResult =
  | {
      ok: true;
      bytes: Buffer;
      contentType: string;
      originalFilename: string;
      byteSize: number;
    }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_scanned_clean' | 'bytes_missing' };

export interface OwnedDocumentSummary {
  documentId: string;
  classification: DocumentClassification;
  purpose: string;
  latestVersion: number;
  latestVersionId: string;
  scanState: 'pending' | 'clean' | 'infected' | 'error';
  byteSize: number;
  contentType: string;
  originalFilename: string;
  uploadedAt: Date;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createDocumentService(
  database: Database,
  storage: FileStorage,
  options: { maxBytes?: number; clock?: () => Date } = {},
) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
  const clock = options.clock ?? (() => new Date());

  async function persistVersion(
    rawInput: UploadDocumentInput,
    existingDocumentId: string | null,
  ): Promise<UploadResult> {
    const { bytes, ...rest } = rawInput;
    const input = uploadSchema.parse(rest);
    if (bytes.length === 0) return { ok: false, reason: 'empty_file' };
    if (bytes.length > maxBytes) return { ok: false, reason: 'file_too_large' };

    const storageKey = randomUUID();
    const contentSha256 = sha256(bytes);
    await storage.put(storageKey, bytes, input.contentType);

    try {
      return await database.transaction(async (tx) => {
        let documentId = existingDocumentId;
        if (documentId) {
          const [doc] = await tx
            .select({ id: schema.documents.id, ownerUserId: schema.documents.ownerUserId })
            .from(schema.documents)
            .where(eq(schema.documents.id, documentId))
            .limit(1)
            .for('update');
          if (!doc) return { ok: false as const, reason: 'document_not_found' as const };
          if (doc.ownerUserId !== input.ownerUserId) {
            return { ok: false as const, reason: 'owner_mismatch' as const };
          }
        } else {
          const [doc] = await tx
            .insert(schema.documents)
            .values({
              ownerUserId: input.ownerUserId,
              classification: input.classification,
              purpose: input.purpose,
            })
            .returning({ id: schema.documents.id });
          documentId = doc.id;
        }

        const [{ maxVersion }] = await tx
          .select({ maxVersion: sql<number | null>`max(${schema.documentVersions.version})` })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId));
        const version = Number(maxVersion ?? 0) + 1;

        const [created] = await tx
          .insert(schema.documentVersions)
          .values({
            documentId,
            version,
            storageKey,
            contentSha256,
            byteSize: bytes.length,
            contentType: input.contentType,
            originalFilename: input.filename,
            uploadedByUserId: input.uploadedByUserId,
            uploadedAt: clock(),
            retentionUntil: input.retentionUntil,
          })
          .returning({ id: schema.documentVersions.id });

        await writeAudit(tx, {
          actorType: 'user',
          actorUserId: input.uploadedByUserId,
          actorRoles: input.actorRoles,
          action: existingDocumentId ? 'document.version_added' : 'document.created',
          outcome: 'succeeded',
          resourceType: 'document',
          resourceId: documentId,
          requestId: input.requestId,
          metadata: {
            classification: input.classification,
            purpose: input.purpose,
            version,
            contentSha256,
            byteSize: bytes.length,
            contentType: input.contentType,
          },
        });

        return {
          ok: true as const,
          created: {
            documentId,
            documentVersionId: created.id,
            version,
            contentSha256,
            byteSize: bytes.length,
          },
        };
      });
    } catch (error) {
      // Roll the orphaned object back so a failed insert leaves no bytes behind.
      await storage.delete(storageKey).catch(() => {});
      throw error;
    }
  }

  return {
    create(input: UploadDocumentInput): Promise<UploadResult> {
      return persistVersion(input, null);
    },
    addVersion(documentId: string, input: UploadDocumentInput): Promise<UploadResult> {
      return persistVersion(input, documentId);
    },

    async markScanResult(input: ScanResultInput): Promise<ScanResult> {
      return database.transaction(async (tx) => {
        const [version] = await tx
          .select({
            id: schema.documentVersions.id,
            documentId: schema.documentVersions.documentId,
            scanState: schema.documentVersions.scanState,
          })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.id, input.documentVersionId))
          .limit(1)
          .for('update');
        if (!version) return { ok: false as const, reason: 'version_not_found' as const };
        if (version.scanState !== 'pending') {
          return { ok: false as const, reason: 'already_resolved' as const };
        }

        await tx
          .update(schema.documentVersions)
          .set({ scanState: input.outcome, scannedAt: clock() })
          .where(eq(schema.documentVersions.id, input.documentVersionId));

        await writeAudit(tx, {
          actorType: 'user',
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'document.scan_recorded',
          outcome: input.outcome === 'clean' ? 'succeeded' : 'failed',
          resourceType: 'document',
          resourceId: version.documentId,
          requestId: input.requestId,
          metadata: { documentVersionId: input.documentVersionId, scanState: input.outcome },
        });
        return { ok: true as const, alreadyResolved: false };
      });
    },

    async getForDownload(input: {
      documentVersionId: string;
      requesterUserId: string;
      staffCanReadAny: boolean;
    }): Promise<DownloadResult> {
      const [row] = await database
        .select({
          storageKey: schema.documentVersions.storageKey,
          contentType: schema.documentVersions.contentType,
          originalFilename: schema.documentVersions.originalFilename,
          byteSize: schema.documentVersions.byteSize,
          scanState: schema.documentVersions.scanState,
          ownerUserId: schema.documents.ownerUserId,
        })
        .from(schema.documentVersions)
        .innerJoin(schema.documents, eq(schema.documentVersions.documentId, schema.documents.id))
        .where(eq(schema.documentVersions.id, input.documentVersionId))
        .limit(1);
      if (!row) return { ok: false, reason: 'not_found' };
      const isOwner = row.ownerUserId === input.requesterUserId;
      if (!isOwner && !input.staffCanReadAny) return { ok: false, reason: 'forbidden' };
      if (row.scanState !== 'clean') return { ok: false, reason: 'not_scanned_clean' };
      const bytes = await storage.get(row.storageKey);
      if (!bytes) return { ok: false, reason: 'bytes_missing' };
      return {
        ok: true,
        bytes,
        contentType: row.contentType,
        originalFilename: row.originalFilename,
        byteSize: row.byteSize,
      };
    },

    async listOwn(ownerUserId: string): Promise<OwnedDocumentSummary[]> {
      const rows = await database
        .select({
          documentId: schema.documents.id,
          classification: schema.documents.classification,
          purpose: schema.documents.purpose,
          version: schema.documentVersions.version,
          versionId: schema.documentVersions.id,
          scanState: schema.documentVersions.scanState,
          byteSize: schema.documentVersions.byteSize,
          contentType: schema.documentVersions.contentType,
          originalFilename: schema.documentVersions.originalFilename,
          uploadedAt: schema.documentVersions.uploadedAt,
        })
        .from(schema.documents)
        .innerJoin(
          schema.documentVersions,
          eq(schema.documentVersions.documentId, schema.documents.id),
        )
        .where(eq(schema.documents.ownerUserId, ownerUserId))
        .orderBy(desc(schema.documentVersions.uploadedAt));

      const latestByDocument = new Map<string, OwnedDocumentSummary>();
      for (const row of rows) {
        const existing = latestByDocument.get(row.documentId);
        if (!existing || row.version > existing.latestVersion) {
          latestByDocument.set(row.documentId, {
            documentId: row.documentId,
            classification: row.classification as DocumentClassification,
            purpose: row.purpose,
            latestVersion: row.version,
            latestVersionId: row.versionId,
            scanState: row.scanState as OwnedDocumentSummary['scanState'],
            byteSize: row.byteSize,
            contentType: row.contentType,
            originalFilename: row.originalFilename,
            uploadedAt: row.uploadedAt,
          });
        }
      }
      return [...latestByDocument.values()];
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
