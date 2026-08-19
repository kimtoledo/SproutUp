import { describe, expect, it } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { ApprovalLifecycleService } from '../src/auth/approval-lifecycle-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const actorId = '00000000-0000-4000-8000-000000000521';
const approvalId = '00000000-0000-4000-8000-000000000522';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: actorId, expiresAt: new Date() },
      user: { id: actorId, email: 'operator@sproutup.ph', name: 'Operator' },
    }),
    resolveAuthorization: async () => ({
      user: { id: actorId, email: 'operator@sproutup.ph', name: 'Operator' },
      roles: ['super_admin'],
      permissions,
    }),
  };
}

const lifecycle: ApprovalLifecycleService = {
  reject: async () => ({ ok: true }),
  cancel: async () => ({ ok: false, reason: 'not_maker' }),
};

describe('role approval lifecycle routes', () => {
  it('requires roles.assign for approval decisions', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.read']),
        baseUrl: 'http://localhost:3001',
        approvalLifecycle: lifecycle,
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/role-approvals/${approvalId}/reject`,
        payload: { reason: 'Independent rejection reason' },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('maps unauthorized cancellation to a stable error', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.assign']),
        baseUrl: 'http://localhost:3001',
        approvalLifecycle: lifecycle,
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/role-approvals/${approvalId}/cancel`,
        payload: { reason: 'Cancellation by wrong actor' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_PROPOSAL_MAKER' } });
    } finally {
      await app.close();
    }
  });
});
