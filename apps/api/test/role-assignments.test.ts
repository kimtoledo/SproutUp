import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { RoleAssignmentService } from '../src/auth/role-assignments-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const makerId = '00000000-0000-4000-8000-000000000101';
const targetId = '00000000-0000-4000-8000-000000000102';
const approvalId = '00000000-0000-4000-8000-000000000103';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: makerId, expiresAt: new Date() },
      user: { id: makerId, email: 'maker@sproutup.ph', name: 'Maker' },
    }),
    resolveAuthorization: async () => ({
      accountType: 'admin',
      user: { id: makerId, email: 'maker@sproutup.ph', name: 'Maker' },
      roles: ['super_admin'],
      permissions,
    }),
  };
}

function roleAssignmentService(overrides: Partial<RoleAssignmentService> = {}): RoleAssignmentService {
  return {
    listPending: async () => [],
    propose: async () => ({ ok: false, reason: 'target_not_found' }),
    approve: async () => ({ ok: false, reason: 'not_found' }),
    ...overrides,
  };
}

describe('maker/checker role assignment routes', () => {
  it('denies callers without the explicit role-assignment capability', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions([]),
        baseUrl: 'http://localhost:3001',
        roleAssignments: roleAssignmentService(),
      },
    });

    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/role-assignments' });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('creates a proposal with the authenticated maker identity', async () => {
    const expiresAt = new Date('2026-08-20T00:00:00Z');
    const createdAt = new Date('2026-08-19T00:00:00Z');
    const propose = vi.fn<RoleAssignmentService['propose']>().mockResolvedValue({
      ok: true,
      request: {
        id: approvalId,
        payload: { targetUserId: targetId, roleKey: 'compliance_officer' },
        payloadHash: 'a'.repeat(64),
        makerUserId: makerId,
        reason: 'Approved investor onboarding',
        expiresAt,
        createdAt,
      },
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.assign']),
        baseUrl: 'http://localhost:3001',
        roleAssignments: roleAssignmentService({ propose }),
      },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/role-assignments',
        payload: { targetUserId: targetId, roleKey: 'compliance_officer', reason: 'Approved compliance access' },
      });
      expect(response.statusCode).toBe(201);
      expect(propose).toHaveBeenCalledWith(
        expect.objectContaining({ makerUserId: makerId, targetUserId: targetId, roleKey: 'compliance_officer' }),
      );
    } finally {
      await app.close();
    }
  });

  it('maps maker/checker conflicts to a stable API error', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['roles.assign']),
        baseUrl: 'http://localhost:3001',
        roleAssignments: roleAssignmentService({
          approve: async () => ({ ok: false, reason: 'same_actor' }),
        }),
      },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/role-assignments/${approvalId}/approve`,
        payload: { reason: 'Independent approval review' },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'MAKER_CHECKER_CONFLICT' } });
    } finally {
      await app.close();
    }
  });
});
