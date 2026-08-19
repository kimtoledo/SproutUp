import { describe, expect, it } from 'vitest';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

function createAuth(overrides: Partial<AuthServices> = {}): AuthServices {
  return {
    handler: async () => Response.json({ ok: true }),
    getSession: async () => null,
    resolveAuthorization: async () => null,
    ...overrides,
  };
}

describe('authentication boundary', () => {
  it('proxies Better Auth responses without exposing implementation details', async () => {
    const auth = createAuth({
      handler: async (request) =>
        new Response(JSON.stringify({ path: new URL(request.url).pathname }), {
          status: 201,
          headers: { 'content-type': 'application/json', 'set-cookie': 'session=test; HttpOnly' },
        }),
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: auth, baseUrl: 'http://localhost:3001' },
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/v1/auth/sign-in/email' });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ path: '/v1/auth/sign-in/email' });
      expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
    } finally {
      await app.close();
    }
  });

  it('denies session context when no active authorization resolves', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: createAuth(), baseUrl: 'http://localhost:3001' },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/session-context' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    } finally {
      await app.close();
    }
  });

  it('returns only server-resolved roles and permissions', async () => {
    const auth = createAuth({
      getSession: async () => ({
        session: { id: 'session-id', userId: 'user-id', expiresAt: new Date() },
        user: { id: 'user-id', email: 'analyst@sproutup.ph', name: 'Credit Analyst' },
      }),
      resolveAuthorization: async () => ({
        user: { id: 'user-id', email: 'analyst@sproutup.ph', name: 'Credit Analyst' },
        roles: ['credit_analyst'],
        permissions: ['users.read', 'roles.read'],
      }),
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: auth, baseUrl: 'http://localhost:3001' },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/session-context' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: { roles: ['credit_analyst'], permissions: ['users.read', 'roles.read'] },
      });
    } finally {
      await app.close();
    }
  });
});
