import { describe, expect, it, vi } from 'vitest';
import type { AuthServices } from '../src/auth/types.js';
import type { SessionService } from '../src/auth/sessions-service.js';
import { buildApp } from '../src/app.js';

const currentSessionId = '00000000-0000-4000-8000-000000000010';
const otherSessionId = '00000000-0000-4000-8000-000000000011';

function authWithPermissions(permissions: Array<'sessions.read_own' | 'sessions.revoke_own'>): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: currentSessionId, userId: 'user-id', expiresAt: new Date() },
      user: { id: 'user-id', email: 'investor@example.com', name: 'Investor' },
    }),
    resolveAuthorization: async () => ({
      accountType: 'investor',
      user: { id: 'user-id', email: 'investor@example.com', name: 'Investor' },
      roles: [],
      permissions,
    }),
  };
}

describe('own session routes', () => {
  it('lists opaque session IDs and identifies the current session without tokens', async () => {
    const sessions: SessionService = {
      listOwn: async () => [
        {
          id: currentSessionId,
          createdAt: new Date('2026-08-19T00:00:00Z'),
          expiresAt: new Date('2026-08-26T00:00:00Z'),
          ipAddress: null,
          userAgent: 'Test Browser',
        },
      ],
      revokeOwn: async () => false,
    };
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['sessions.read_own']),
        baseUrl: 'http://localhost:3001',
        sessions,
      },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/sessions' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: [{ id: currentSessionId, current: true }],
      });
      expect(response.body).not.toContain('token');
    } finally {
      await app.close();
    }
  });

  it('revokes an owned session by ID', async () => {
    const revokeOwn = vi.fn<SessionService['revokeOwn']>().mockResolvedValue(true);
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['sessions.revoke_own']),
        baseUrl: 'http://localhost:3001',
        sessions: { listOwn: async () => [], revokeOwn },
      },
    });

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${otherSessionId}`,
      });
      expect(response.statusCode).toBe(204);
      expect(revokeOwn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-id', sessionId: otherSessionId }),
      );
    } finally {
      await app.close();
    }
  });

  it('denies session listing without the explicit capability', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions([]),
        baseUrl: 'http://localhost:3001',
        sessions: { listOwn: async () => [], revokeOwn: async () => false },
      },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/sessions' });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
