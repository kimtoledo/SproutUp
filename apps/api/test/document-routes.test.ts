import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { DocumentService } from '../src/documents/document-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const userId = '00000000-0000-4000-8000-000000000931';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId, expiresAt: new Date() },
      user: { id: userId, email: 'borrower@sproutup.ph', name: 'Borrower' },
    }),
    resolveAuthorization: async () => ({
      accountType: 'borrower',
      user: { id: userId, email: 'borrower@sproutup.ph', name: 'Borrower' },
      roles: [],
      permissions,
    }),
  };
}

function documentService(overrides: Partial<DocumentService> = {}): DocumentService {
  return {
    create: async () => ({ ok: false, reason: 'empty_file' }),
    addVersion: async () => ({ ok: false, reason: 'document_not_found' }),
    markScanResult: async () => ({ ok: false, reason: 'version_not_found' }),
    getForDownload: async () => ({ ok: false, reason: 'not_found' }),
    listOwn: async () => [],
    ...overrides,
  };
}

const BOUNDARY = '----sproutupTestBoundary';

function multipartPayload(
  fields: Record<string, string>,
  file?: { filename: string; contentType: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n`
        + `Content-Type: ${file.contentType}\r\n\r\n`,
    ));
    parts.push(file.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}

describe('own document routes', () => {
  it('requires the upload-own capability and never calls the service without it', async () => {
    const create = vi.fn<DocumentService['create']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions([]), baseUrl: 'http://localhost:3001' },
      documents: documentService({ create }),
    });
    try {
      const { body, contentType } = multipartPayload(
        { classification: 'kyc_identity', purpose: 'borrower.id' },
        { filename: 'id.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4') },
      );
      const response = await app.inject({
        method: 'POST',
        url: '/v1/documents',
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(403);
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects a multipart request with no file part before calling the service', async () => {
    const create = vi.fn<DocumentService['create']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['documents.upload_own']), baseUrl: 'http://localhost:3001' },
      documents: documentService({ create }),
    });
    try {
      const { body, contentType } = multipartPayload({ classification: 'kyc_identity', purpose: 'borrower.id' });
      const response = await app.inject({
        method: 'POST',
        url: '/v1/documents',
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'FILE_REQUIRED' } });
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects an unsupported content type before calling the service', async () => {
    const create = vi.fn<DocumentService['create']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['documents.upload_own']), baseUrl: 'http://localhost:3001' },
      documents: documentService({ create }),
    });
    try {
      const { body, contentType } = multipartPayload(
        { classification: 'kyc_identity', purpose: 'borrower.id' },
        { filename: 'malware.exe', contentType: 'application/x-msdownload', data: Buffer.from('MZ') },
      );
      const response = await app.inject({
        method: 'POST',
        url: '/v1/documents',
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'UNSUPPORTED_CONTENT_TYPE' } });
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('parses fields and file bytes and passes the authenticated owner through', async () => {
    const create = vi.fn<DocumentService['create']>().mockResolvedValue({
      ok: true,
      created: {
        documentId: 'doc-1',
        documentVersionId: 'version-1',
        version: 1,
        contentSha256: 'a'.repeat(64),
        byteSize: 8,
      },
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['documents.upload_own']), baseUrl: 'http://localhost:3001' },
      documents: documentService({ create }),
    });
    try {
      const { body, contentType } = multipartPayload(
        { classification: 'kyc_identity', purpose: 'borrower.id' },
        { filename: 'id.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 body') },
      );
      const response = await app.inject({
        method: 'POST',
        url: '/v1/documents',
        headers: { 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ success: true, data: { documentId: 'doc-1' } });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        ownerUserId: userId,
        uploadedByUserId: userId,
        classification: 'kyc_identity',
        purpose: 'borrower.id',
        filename: 'id.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4 body'),
      }));
    } finally {
      await app.close();
    }
  });

  it('lists only the authenticated owner\'s documents', async () => {
    const listOwn = vi.fn<DocumentService['listOwn']>().mockResolvedValue([]);
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['documents.read_own']), baseUrl: 'http://localhost:3001' },
      documents: documentService({ listOwn }),
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/documents' });
      expect(response.statusCode).toBe(200);
      expect(listOwn).toHaveBeenCalledWith(userId);
    } finally {
      await app.close();
    }
  });

  it('streams a downloaded document with the right headers', async () => {
    const getForDownload = vi.fn<DocumentService['getForDownload']>().mockResolvedValue({
      ok: true,
      bytes: Buffer.from('%PDF-1.4 body'),
      contentType: 'application/pdf',
      originalFilename: 'id.pdf',
      byteSize: 13,
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['documents.read_own']), baseUrl: 'http://localhost:3001' },
      documents: documentService({ getForDownload }),
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/documents/00000000-0000-4000-8000-000000000999/download',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toContain('id.pdf');
      expect(response.body).toBe('%PDF-1.4 body');
      expect(getForDownload).toHaveBeenCalledWith({
        documentVersionId: '00000000-0000-4000-8000-000000000999',
        requesterUserId: userId,
        staffCanReadAny: false,
      });
    } finally {
      await app.close();
    }
  });

  it.each([
    ['not_found', 404],
    ['forbidden', 403],
    ['not_scanned_clean', 409],
  ] as const)('maps %s to HTTP %i on download', async (reason, status) => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['documents.read_own']), baseUrl: 'http://localhost:3001' },
      documents: documentService({ getForDownload: async () => ({ ok: false, reason }) }),
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/documents/00000000-0000-4000-8000-000000000999/download',
      });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });
});
