import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hasPermission } from '@sproutup/shared';
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  documentClassificationSchema,
  type DocumentClassification,
  type DocumentService,
} from '../documents/document-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { operation } from '../openapi/operation.js';
import { commonErrors, successResponse } from '../openapi/onboarding-schemas.js';
import {
  documentIdParameters,
  documentVersionIdParameters,
  documentVersionSchema,
  ownedDocumentSummarySchema,
} from '../openapi/document-schemas.js';

interface Options {
  auth: AuthServices;
  documents: DocumentService;
}

const documentIdParametersSchema = z.object({ documentId: z.uuid() });
const documentVersionIdParametersSchema = z.object({ documentVersionId: z.uuid() });
const fieldsSchema = z.object({
  classification: documentClassificationSchema,
  purpose: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
});

type ParsedUpload =
  | {
      ok: true;
      classification: DocumentClassification;
      purpose: string;
      filename: string;
      contentType: string;
      bytes: Buffer;
    }
  | { ok: false; reason: 'no_file' | 'invalid_fields' | 'unsupported_content_type' };

/**
 * `@fastify/multipart`'s `request.file()` only reliably captures fields sent
 * before the file part, so a mixed form (fields + one file, any order) is
 * read by hand-iterating every part instead. Each file part's stream must be
 * drained (`toBuffer()`) while it is current — the async iterator will not
 * advance to the next part, or detect the end of the request, until it is.
 */
async function readUpload(request: FastifyRequest): Promise<ParsedUpload> {
  const rawFields: Record<string, string> = {};
  let file: { filename: string; mimetype: string; bytes: Buffer } | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'field' && typeof part.value === 'string') {
      rawFields[part.fieldname] = part.value;
    } else if (part.type === 'file') {
      const bytes = await part.toBuffer();
      if (!file) file = { filename: part.filename, mimetype: part.mimetype, bytes };
    }
  }

  if (!file) return { ok: false, reason: 'no_file' };
  const fields = fieldsSchema.safeParse(rawFields);
  if (!fields.success) return { ok: false, reason: 'invalid_fields' };
  if (!(ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.mimetype)) {
    return { ok: false, reason: 'unsupported_content_type' };
  }

  return {
    ok: true,
    classification: fields.data.classification,
    purpose: fields.data.purpose,
    filename: file.filename,
    contentType: file.mimetype,
    bytes: file.bytes,
  };
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' },
  });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: 'The required document permission is not granted' },
  });
}

const uploadFailures: Record<string, { status: number; code: string; message: string }> = {
  no_file: { status: 400, code: 'FILE_REQUIRED', message: 'A file part is required' },
  invalid_fields: {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'A valid classification and purpose are required',
  },
  unsupported_content_type: {
    status: 400,
    code: 'UNSUPPORTED_CONTENT_TYPE',
    message: 'Only PDF, JPEG, and PNG files are accepted',
  },
  empty_file: { status: 400, code: 'FILE_REQUIRED', message: 'The uploaded file is empty' },
  file_too_large: { status: 413, code: 'FILE_TOO_LARGE', message: 'The uploaded file exceeds the size limit' },
  document_not_found: { status: 404, code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
  owner_mismatch: { status: 404, code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' },
};

function uploadFailure(reply: FastifyReply, reason: string) {
  const mapped = uploadFailures[reason]
    ?? { status: 500, code: 'INTERNAL_ERROR', message: 'The document could not be processed' };
  return reply.status(mapped.status).send({
    success: false,
    error: { code: mapped.code, message: mapped.message },
  });
}

export async function registerDocumentRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.post('/v1/documents', {
    schema: operation({
      operationId: 'uploadOwnDocument',
      summary: 'Upload a new private document owned by the current user (multipart/form-data: '
        + 'classification, purpose, file)',
      tags: ['documents'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['documents.upload_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: ['create document', 'store file bytes', 'append audit event'],
        auditEvent: 'document.created',
      },
      http: {
        // No `body` schema: this is multipart/form-data, parsed by hand via
        // `request.parts()` in `readUpload` below. `request.body` is never
        // populated for it, so a JSON body schema here would just reject
        // every request before the handler runs. `uploadDocumentMultipartBody`
        // documents the expected shape for readers/tooling.
        response: {
          201: successResponse(documentVersionSchema),
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
          413: commonErrors[400],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'documents.upload_own')) return forbidden(reply);

    const upload = await readUpload(request);
    if (!upload.ok) return uploadFailure(reply, upload.reason);

    const result = await options.documents.create({
      ownerUserId: identity.authorization.user.id,
      uploadedByUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      classification: upload.classification,
      purpose: upload.purpose,
      filename: upload.filename,
      contentType: upload.contentType as (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number],
      bytes: upload.bytes,
      requestId: request.id,
    });
    if (!result.ok) return uploadFailure(reply, result.reason);
    return reply.status(201).send({ success: true, data: result.created });
  });

  app.post('/v1/documents/:documentId/versions', {
    schema: operation({
      operationId: 'addOwnDocumentVersion',
      summary: 'Replace an owned document with a new version (multipart/form-data: '
        + 'classification, purpose, file)',
      tags: ['documents'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['documents.upload_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: ['store file bytes', 'append document version', 'append audit event'],
        auditEvent: 'document.version_added',
      },
      http: {
        params: documentIdParameters,
        // See the no-`body`-schema note on `uploadOwnDocument` above.
        response: {
          201: successResponse(documentVersionSchema),
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
          404: commonErrors[404],
          413: commonErrors[400],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'documents.upload_own')) return forbidden(reply);
    const parameters = documentIdParametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid document ID is required' },
      });
    }

    const upload = await readUpload(request);
    if (!upload.ok) return uploadFailure(reply, upload.reason);

    const result = await options.documents.addVersion(parameters.data.documentId, {
      ownerUserId: identity.authorization.user.id,
      uploadedByUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      classification: upload.classification,
      purpose: upload.purpose,
      filename: upload.filename,
      contentType: upload.contentType as (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number],
      bytes: upload.bytes,
      requestId: request.id,
    });
    if (!result.ok) return uploadFailure(reply, result.reason);
    return reply.status(201).send({ success: true, data: result.created });
  });

  app.get('/v1/documents', {
    schema: operation({
      operationId: 'listOwnDocuments',
      summary: "List the current user's own private documents at their latest version",
      tags: ['documents'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['documents.read_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        response: {
          200: successResponse({ type: 'array', items: ownedDocumentSummarySchema }),
          401: commonErrors[401],
          403: commonErrors[403],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'documents.read_own')) return forbidden(reply);
    return reply.send({
      success: true,
      data: await options.documents.listOwn(identity.authorization.user.id),
    });
  });

  app.get('/v1/documents/:documentVersionId/download', {
    schema: operation({
      operationId: 'downloadOwnDocumentVersion',
      summary: 'Download one owned document version once it has scanned clean',
      tags: ['documents'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['documents.read_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: documentVersionIdParameters,
        response: {
          401: commonErrors[401],
          403: commonErrors[403],
          404: commonErrors[404],
          409: commonErrors[409],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'documents.read_own')) return forbidden(reply);
    const parameters = documentVersionIdParametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid document version ID is required' },
      });
    }

    const result = await options.documents.getForDownload({
      documentVersionId: parameters.data.documentVersionId,
      requesterUserId: identity.authorization.user.id,
      staffCanReadAny: false,
    });
    if (!result.ok) {
      const failures: Record<string, { status: number; code: string; message: string }> = {
        not_found: { status: 404, code: 'DOCUMENT_NOT_FOUND', message: 'Document version not found' },
        forbidden: { status: 403, code: 'FORBIDDEN', message: 'You do not own this document' },
        not_scanned_clean: {
          status: 409,
          code: 'DOCUMENT_NOT_READY',
          message: 'This document has not finished its safety scan yet',
        },
        bytes_missing: { status: 500, code: 'INTERNAL_ERROR', message: 'Document bytes are unavailable' },
      };
      const mapped = failures[result.reason]
        ?? { status: 500, code: 'INTERNAL_ERROR', message: 'The document could not be downloaded' };
      return reply.status(mapped.status).send({
        success: false,
        error: { code: mapped.code, message: mapped.message },
      });
    }

    reply.header('content-type', result.contentType);
    reply.header(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(result.originalFilename)}"`,
    );
    return reply.send(result.bytes);
  });
}
