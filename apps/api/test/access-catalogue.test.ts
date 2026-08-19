import { describe, expect, it } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { AccessCatalogueService } from '../src/auth/access-catalogue-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const userId = '00000000-0000-4000-8000-000000000301';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId, expiresAt: new Date() },
      user: { id: userId, email: 'staff@sproutup.ph', name: 'Staff' },
    }),
    resolveAuthorization: async () => ({
      user: { id: userId, email: 'staff@sproutup.ph', name: 'Staff' },
      roles: ['sales_officer'],
      permissions,
    }),
  };
}

const catalogue: AccessCatalogueService = {
  listRoles: async () => [
    {
      key: 'investor',
      name: 'Investor',
      category: 'customer',
      isActive: true,
      permissions: ['sessions.read_own'],
    },
  ],
  listUsers: async ({ page, pageSize }) => ({ users: [], page, pageSize, total: 0 }),
};

describe('access catalogue routes', () => {
  it('requires roles.read independently from other staff permissions', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['users.read']), baseUrl: 'http://localhost:3001', catalogue },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/roles' });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('returns the effective role catalogue to an authorized caller', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['roles.read']), baseUrl: 'http://localhost:3001', catalogue },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/roles' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: [{ key: 'investor', permissions: ['sessions.read_own'] }] });
    } finally {
      await app.close();
    }
  });

  it('validates and bounds user catalogue pagination', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['users.read']), baseUrl: 'http://localhost:3001', catalogue },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/users?pageSize=101' });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });
});
