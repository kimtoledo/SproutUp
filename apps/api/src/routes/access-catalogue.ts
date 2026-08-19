import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission } from '@sproutup/shared';
import type { AccessCatalogueService } from '../auth/access-catalogue-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';

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
  app.get('/v1/admin/roles', async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.read')) return forbidden(reply);

    return reply.send({ success: true, data: await options.catalogue.listRoles() });
  });

  app.get('/v1/admin/users', async (request, reply) => {
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
