import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import type { AuthorizationContext } from '@sproutup/shared';
import type { AuthServices } from './types.js';

export async function resolveRequestAuthorization(
  request: FastifyRequest,
  auth: AuthServices,
): Promise<AuthorizationContext | null> {
  const session = await auth.getSession(fromNodeHeaders(request.headers));
  if (!session) {
    return null;
  }

  return auth.resolveAuthorization(session.user.id);
}
