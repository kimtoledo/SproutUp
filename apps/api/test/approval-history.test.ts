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
      accountType: 'admin',
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

const sampleApproval = {
  id: '00000000-0000-4000-8000-0000000006aa',
  commandType: 'role.assign',
  status: 'executed',
  payload: { roleKey: 'compliance_officer', targetUserId: '00000000-0000-4000-8000-0000000006bb' },
  payloadHash: 'a'.repeat(64),
  version: 3,
  makerUserId: '00000000-0000-4000-8000-0000000006cc',
  checkerUserId: '00000000-0000-4000-8000-0000000006dd',
  reason: 'pilot compliance staffing',
  expiresAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
  executedAt: new Date('2026-01-01T12:00:00.000Z').toISOString(),
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-01-01T12:00:00.000Z').toISOString(),
  integrity: 'valid' as const,
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

  it('serializes the role-change payload in list and detail responses', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.assign']),
        baseUrl: 'http://localhost:3001',
        approvalHistory: {
          list: async ({ page, pageSize }) => ({
            approvals: [sampleApproval],
            page,
            pageSize,
            total: 1,
          }),
          detail: async () => ({
            ...sampleApproval,
            actions: [
              {
                id: '00000000-0000-4000-8000-0000000006ee',
                action: 'proposed',
                actorUserId: sampleApproval.makerUserId,
                payloadHash: sampleApproval.payloadHash,
                reason: sampleApproval.reason,
                occurredAt: sampleApproval.createdAt,
                metadata: { note: 'kept' },
              },
            ],
          }),
        },
      },
    });
    try {
      const list = await app.inject({ method: 'GET', url: '/v1/admin/role-approvals' });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.approvals[0].payload).toEqual({
        roleKey: 'compliance_officer',
        targetUserId: '00000000-0000-4000-8000-0000000006bb',
      });

      const detail = await app.inject({
        method: 'GET',
        url: `/v1/admin/role-approvals/${sampleApproval.id}`,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.payload).toEqual({
        roleKey: 'compliance_officer',
        targetUserId: '00000000-0000-4000-8000-0000000006bb',
      });
      expect(detail.json().data.actions[0].metadata).toEqual({ note: 'kept' });
    } finally {
      await app.close();
    }
  });
});
