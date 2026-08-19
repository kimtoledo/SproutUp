import { describe, expect, it } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { RoleRevocationService } from '../src/auth/role-revocations-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const actorId = '00000000-0000-4000-8000-000000000401';
const approvalId = '00000000-0000-4000-8000-000000000402';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: actorId, expiresAt: new Date() },
      user: { id: actorId, email: 'checker@sproutup.ph', name: 'Checker' },
    }),
    resolveAuthorization: async () => ({
      user: { id: actorId, email: 'checker@sproutup.ph', name: 'Checker' },
      roles: ['super_admin'],
      permissions,
    }),
  };
}

function service(overrides: Partial<RoleRevocationService> = {}): RoleRevocationService {
  return {
    listPending: async () => [],
    propose: async () => ({ ok: false, reason: 'target_not_found' }),
    approve: async () => ({ ok: false, reason: 'not_found' }),
    ...overrides,
  };
}

describe('role revocation routes', () => {
  it('requires the explicit role change capability', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.read']),
        baseUrl: 'http://localhost:3001',
        roleRevocations: service(),
      },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/role-revocations' });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns a stable conflict when execution would remove the last active role', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.assign']),
        baseUrl: 'http://localhost:3001',
        roleRevocations: service({
          approve: async () => ({ ok: false, reason: 'last_role_not_allowed' }),
        }),
      },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/role-revocations/${approvalId}/approve`,
        payload: { reason: 'Independent access review' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'LAST_ROLE_NOT_ALLOWED' } });
    } finally {
      await app.close();
    }
  });
});
