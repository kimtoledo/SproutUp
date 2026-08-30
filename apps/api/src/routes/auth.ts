import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveRequestAuthorization } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { authorizationContextSchema } from '../openapi/access-schemas.js';
import { operation } from '../openapi/operation.js';
import { errorResponseSchema, successResponse } from '../openapi/onboarding-schemas.js';

interface RegisterAuthRoutesOptions {
  auth: AuthServices;
  authBaseUrl: string;
}

interface RegisterCustomerAuthRoutesOptions {
  borrowerAuth: AuthServices;
  investorAuth: AuthServices;
  authBaseUrl: string;
}

async function sendAuthResponse(
  response: Response,
  reply: FastifyReply,
) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') reply.header(name, value);
  });
  const setCookies = headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) reply.header('set-cookie', setCookies);
  reply.status(response.status);
  return response.body
    ? reply.send(Buffer.from(await response.arrayBuffer()))
    : reply.send();
}

function toWebRequest(request: FastifyRequest, baseUrl: string): Request {
  const url = new URL(request.raw.url ?? request.url, baseUrl);
  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && request.body !== undefined;
  const headers = fromNodeHeaders(request.headers);
  headers.set('x-sproutup-client-ip', request.ip);
  headers.set('x-sproutup-request-id', request.id);

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

async function registerCustomerPortal(
  app: FastifyInstance,
  options: RegisterAuthRoutesOptions,
  accountType: 'borrower' | 'investor',
): Promise<void> {
  app.route({
    method: ['GET', 'POST'],
    url: `/v1/auth/${accountType}/*`,
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      return sendAuthResponse(
        await options.auth.handler(toWebRequest(request, options.authBaseUrl)),
        reply,
      );
    },
  });

  app.get(`/v1/${accountType}/session-context`, {
    schema: operation({
      operationId: accountType === 'borrower'
        ? 'getBorrowerSessionContext'
        : 'getInvestorSessionContext',
      summary: `Resolve the active ${accountType} account and server-authoritative access context`,
      tags: ['authentication'],
      metadata: {
        actor: 'authenticated_customer',
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
        error: {
          code: 'UNAUTHENTICATED',
          message: `A valid ${accountType} session is required`,
        },
      });
    }

    return reply.send({ success: true, data: authorization });
  });
}

export async function registerCustomerAuthRoutes(
  app: FastifyInstance,
  options: RegisterCustomerAuthRoutesOptions,
): Promise<void> {
  await registerCustomerPortal(app, {
    auth: options.borrowerAuth,
    authBaseUrl: options.authBaseUrl,
  }, 'borrower');
  await registerCustomerPortal(app, {
    auth: options.investorAuth,
    authBaseUrl: options.authBaseUrl,
  }, 'investor');
}

export async function registerAdminAuthRoutes(
  app: FastifyInstance,
  options: RegisterAuthRoutesOptions,
): Promise<void> {
  app.route({
    method: ['GET', 'POST'],
    url: '/v1/auth/admin/*',
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const pathname = (request.raw.url ?? request.url).split('?', 1)[0];
      if (request.method.toUpperCase() === 'POST' && pathname?.endsWith('/sign-up/email')) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'ADMIN_SIGNUP_DISABLED',
            message: 'Administrator accounts are provisioned through controlled operations',
          },
        });
      }

      return sendAuthResponse(
        await options.auth.handler(toWebRequest(request, options.authBaseUrl)),
        reply,
      );
    },
  });

  app.get('/v1/admin/session-context', {
    schema: operation({
      operationId: 'getAdminSessionContext',
      summary: 'Resolve the active administrator and staff access context',
      tags: ['authentication'],
      metadata: {
        actor: 'staff',
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
        error: { code: 'UNAUTHENTICATED', message: 'A valid administrator session is required' },
      });
    }
    return reply.send({ success: true, data: authorization });
  });
}
