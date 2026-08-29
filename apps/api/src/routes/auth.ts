import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveRequestAuthorization } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { authorizationContextSchema } from '../openapi/access-schemas.js';
import { operation } from '../openapi/operation.js';
import { errorResponseSchema, successResponse } from '../openapi/onboarding-schemas.js';

interface RegisterAuthRoutesOptions {
  auth: AuthServices;
  authBaseUrl: string;
}

function toWebRequest(request: FastifyRequest, baseUrl: string): Request {
  const url = new URL(request.raw.url ?? request.url, baseUrl);
  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.body !== undefined;
  const headers = fromNodeHeaders(request.headers);
  headers.set('x-sproutup-client-ip', request.ip);

  return new Request(url, {
    method,
    headers,
    body: hasBody
      ? typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body)
      : undefined,
  });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: RegisterAuthRoutesOptions,
): Promise<void> {
  app.route({
    method: ['GET', 'POST'],
    url: '/v1/auth/*',
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      // Fail bad registration intents on the stable validation envelope before
      // they reach Better Auth, which would otherwise surface an opaque
      // "Failed to create user" for an invalid enum value.
      if (
        request.method.toUpperCase() === 'POST'
        && (request.raw.url ?? request.url).split('?', 1)[0]?.endsWith('/sign-up/email')
      ) {
        const body = request.body;
        const intent =
          body && typeof body === 'object' && 'registrationIntent' in body
            ? (body as Record<string, unknown>).registrationIntent
            : undefined;
        if (intent !== undefined && intent !== 'borrower' && intent !== 'investor') {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'registrationIntent must be "borrower" or "investor"',
            },
          });
        }
      }

      const response = await options.auth.handler(toWebRequest(request, options.authBaseUrl));
      const headers = response.headers as Headers & { getSetCookie?: () => string[] };

      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== 'set-cookie') {
          reply.header(name, value);
        }
      });

      const setCookies = headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        reply.header('set-cookie', setCookies);
      }

      reply.status(response.status);
      return response.body
        ? reply.send(Buffer.from(await response.arrayBuffer()))
        : reply.send();
    },
  });

  app.get('/v1/session-context', {
    schema: operation({
      operationId: 'getSessionContext',
      summary: 'Resolve the active user and server-authoritative access context',
      tags: ['authentication'],
      metadata: {
        actor: 'authenticated_user',
        permissions: [],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        response: {
          200: successResponse(authorizationContextSchema),
          401: errorResponseSchema,
        },
      },
    }),
  }, async (request, reply) => {
    const authorization = await resolveRequestAuthorization(request, options.auth);
    if (!authorization) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' },
      });
    }

    return reply.send({ success: true, data: authorization });
  });
}
