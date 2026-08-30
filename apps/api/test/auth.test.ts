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
  it('proxies the borrower auth namespace and leaves the legacy wildcard retired', async () => {
    const borrowerAuth = createAuth({
      handler: async (request) =>
        new Response(JSON.stringify({ path: new URL(request.url).pathname }), {
          status: 201,
          headers: { 'content-type': 'application/json', 'set-cookie': 'session=test; HttpOnly' },
        }),
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: borrowerAuth,
        borrowerService: borrowerAuth,
        investorService: createAuth(),
        baseUrl: 'http://localhost:3001',
      },
    });

    try {
      const response = await app.inject({ method: 'POST', url: '/v1/auth/borrower/sign-in/email' });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ path: '/v1/auth/borrower/sign-in/email' });
      expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
      const legacy = await app.inject({ method: 'POST', url: '/v1/auth/sign-in/email' });
      expect(legacy.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('denies session context when no active authorization resolves', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: createAuth(),
        borrowerService: createAuth(),
        investorService: createAuth(),
        baseUrl: 'http://localhost:3001',
      },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/borrower/session-context' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    } finally {
      await app.close();
    }
  });

  it('returns only server-resolved roles and permissions', async () => {
    const userId = '00000000-0000-4000-8000-000000000701';
    const auth = createAuth({
      getSession: async () => ({
        session: { id: 'session-id', userId, expiresAt: new Date() },
        user: { id: userId, email: 'analyst@sproutup.ph', name: 'Credit Analyst' },
      }),
      resolveAuthorization: async () => ({
        accountType: 'borrower',
        user: { id: userId, email: 'borrower@sproutup.ph', name: 'Borrower' },
        roles: [],
        permissions: ['borrower_onboarding.read_own'],
      }),
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: auth,
        borrowerService: auth,
        investorService: createAuth(),
        baseUrl: 'http://localhost:3001',
      },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/borrower/session-context' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: {
          accountType: 'borrower',
          roles: [],
          permissions: ['borrower_onboarding.read_own'],
        },
      });
    } finally {
      await app.close();
    }
  });
});
