import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission } from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import type { SessionService } from '../auth/sessions-service.js';

const sessionParametersSchema = z.object({ sessionId: z.uuid() });

interface RegisterSessionRoutesOptions {
  auth: AuthServices;
  sessions: SessionService;
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

export async function registerSessionRoutes(
  app: FastifyInstance,
  options: RegisterSessionRoutesOptions,
): Promise<void> {
  app.get('/v1/sessions', async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'sessions.read_own')) return forbidden(reply);

    const sessions = await options.sessions.listOwn(identity.authorization.user.id);
    return reply.send({
      success: true,
      data: sessions.map((session) => ({
        ...session,
        current: session.id === identity.session.session.id,
      })),
    });
  });

  app.delete('/v1/sessions/:sessionId', async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'sessions.revoke_own')) return forbidden(reply);

    const parsed = sessionParametersSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid session ID is required' },
      });
    }

    const revoked = await options.sessions.revokeOwn({
      userId: identity.authorization.user.id,
      roles: identity.authorization.roles,
      sessionId: parsed.data.sessionId,
      requestId: request.id,
    });

    if (!revoked) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Session not found' },
      });
    }

    return reply.status(204).send();
  });
}
