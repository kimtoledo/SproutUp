import { describe, expect, it } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { ApprovalHistoryService } from '../src/auth/approval-history-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const actorId = '00000000-0000-4000-8000-000000000611';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: actorId, expiresAt: new Date() },
      user: { id: actorId, email: 'history@sproutup.ph', name: 'History Operator' },
    }),
    resolveAuthorization: async () => ({
      user: { id: actorId, email: 'history@sproutup.ph', name: 'History Operator' },
      roles: ['super_admin'],
      permissions,
    }),
  };
}

const history: ApprovalHistoryService = {
  list: async ({ page, pageSize }) => ({ approvals: [], page, pageSize, total: 0 }),
  detail: async () => null,
};

describe('approval history routes', () => {
  it('keeps privileged role-change reasons behind roles.assign', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.read']),
        baseUrl: 'http://localhost:3001',
        approvalHistory: history,
      },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/role-approvals' });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('validates status and command filters', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.assign']),
        baseUrl: 'http://localhost:3001',
        approvalHistory: history,
      },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/role-approvals?status=unknown' });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    } finally {
      await app.close();
    }
  });
});
