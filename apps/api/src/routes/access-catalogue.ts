import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission } from '@sproutup/shared';
import type { AccessCatalogueService } from '../auth/access-catalogue-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { operation } from '../openapi/operation.js';
import {
  roleSummarySchema,
  userAccessSummarySchema,
  userCatalogueQuery,
} from '../openapi/access-schemas.js';
import { commonErrors, successResponse } from '../openapi/onboarding-schemas.js';

const userQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  query: z.string().trim().min(2).max(100).optional(),
  status: z.enum(['active', 'suspended', 'disabled']).optional(),
});

interface RegisterAccessCatalogueRoutesOptions {
  auth: AuthServices;
  catalogue: AccessCatalogueService;
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
    error: { code: 'FORBIDDEN', message: 'The required permission is not granted' },
  });
}

export async function registerAccessCatalogueRoutes(
  app: FastifyInstance,
  options: RegisterAccessCatalogueRoutesOptions,
): Promise<void> {
  app.get('/v1/admin/roles', {
    schema: operation({
      operationId: 'listRoleCatalogue',
      summary: 'List roles and effective permission keys',
      tags: ['access'],
      metadata: {
        actor: 'staff',
        permissions: ['roles.read'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        response: {
          200: successResponse({ type: 'array', items: roleSummarySchema }),
          401: commonErrors[401],
          403: commonErrors[403],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.read')) return forbidden(reply);

    return reply.send({ success: true, data: await options.catalogue.listRoles() });
  });

  app.get('/v1/admin/users', {
    schema: operation({
      operationId: 'listUserAccessCatalogue',
      summary: 'List bounded user access summaries',
      tags: ['access'],
      metadata: {
        actor: 'staff',
        permissions: ['users.read'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        querystring: userCatalogueQuery,
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['users', 'page', 'pageSize', 'total'],
            properties: {
              users: { type: 'array', items: userAccessSummarySchema },
              page: { type: 'integer', minimum: 1 },
              pageSize: { type: 'integer', minimum: 1, maximum: 100 },
              total: { type: 'integer', minimum: 0 },
            },
          }),
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'users.read')) return forbidden(reply);

    const parsed = userQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid user catalogue filters' },
      });
    }

    return reply.send({ success: true, data: await options.catalogue.listUsers(parsed.data) });
  });
}
