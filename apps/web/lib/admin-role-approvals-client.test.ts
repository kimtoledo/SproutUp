import { describe, expect, it, vi } from 'vitest';
import {
  approveRoleAssignment,
  cancelRoleApproval,
  loadApprovalDetail,
  loadApprovalHistory,
  loadRoleApprovalsWorkspace,
  proposeRoleAssignment,
  proposeRoleRevocation,
  rejectRoleApproval,
  searchUsers,
} from './admin-role-approvals-client';

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const session = {
  user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
  roles: ['super_admin'],
  permissions: ['roles.assign', 'roles.read', 'users.read'],
};

describe('admin role approvals client', () => {
  it('denies locally after server session resolution when role-assign permission is absent', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {
      success: true,
      data: { ...session, permissions: ['roles.read'] },
    }));
    await expect(loadRoleApprovalsWorkspace(fetcher)).resolves.toEqual({ ok: false, reason: 'forbidden' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('merges and tags pending assignments and revocations, sorted oldest first', async () => {
    const assignment = {
      id: 'approval-1',
      payload: { targetUserId: 'user-1', roleKey: 'compliance_officer' },
      payloadHash: 'a'.repeat(64),
      makerUserId: 'admin-1',
      reason: 'New compliance hire',
      expiresAt: '2026-08-21T00:00:00.000Z',
      createdAt: '2026-08-20T02:00:00.000Z',
    };
    const revocation = {
      id: 'approval-2',
      payload: { targetUserId: 'user-2', roleKey: 'sales_officer' },
      payloadHash: 'b'.repeat(64),
      makerUserId: 'admin-1',
      reason: 'Role no longer needed',
      expiresAt: '2026-08-21T00:00:00.000Z',
      createdAt: '2026-08-20T01:00:00.000Z',
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { success: true, data: session }))
      .mockResolvedValueOnce(response(200, { success: true, data: [assignment] }))
      .mockResolvedValueOnce(response(200, { success: true, data: [revocation] }));
    await expect(loadRoleApprovalsWorkspace(fetcher)).resolves.toEqual({
      ok: true,
      session,
      pending: [
        { ...revocation, commandType: 'role.revoke' },
        { ...assignment, commandType: 'role.assign' },
      ],
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3001/v1/admin/session-context',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3001/v1/admin/role-assignments',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      'http://localhost:3001/v1/admin/role-revocations',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('sends exact propose/approve/reject/cancel payloads with trimmed reasons', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: {} }));
    await proposeRoleAssignment('user-1', 'compliance_officer', '  New compliance hire  ', fetcher);
    await proposeRoleRevocation('user-2', 'sales_officer', '  Role no longer needed  ', fetcher);
    await approveRoleAssignment('approval-1', fetcher);
    await rejectRoleApproval('approval-2', '  Insufficient justification  ', fetcher);
    await cancelRoleApproval('approval-1', '  Submitted in error  ', fetcher);
    expect(fetcher.mock.calls.map(([url, options]) => [url, options?.body])).toEqual([
      [
        'http://localhost:3001/v1/admin/role-assignments',
        JSON.stringify({ targetUserId: 'user-1', roleKey: 'compliance_officer', reason: 'New compliance hire' }),
      ],
      [
        'http://localhost:3001/v1/admin/role-revocations',
        JSON.stringify({ targetUserId: 'user-2', roleKey: 'sales_officer', reason: 'Role no longer needed' }),
      ],
      ['http://localhost:3001/v1/admin/role-assignments/approval-1/approve', undefined],
      [
        'http://localhost:3001/v1/admin/role-approvals/approval-2/reject',
        JSON.stringify({ reason: 'Insufficient justification' }),
      ],
      [
        'http://localhost:3001/v1/admin/role-approvals/approval-1/cancel',
        JSON.stringify({ reason: 'Submitted in error' }),
      ],
    ]);
  });

  it('maps restricted-role and self-approval conflicts without exposing server text', async () => {
    const restricted = vi.fn().mockResolvedValue(response(403, {
      success: false,
      error: { code: 'RESTRICTED_ROLE', message: 'internal detail ignored' },
    }));
    const selfApproval = vi.fn().mockResolvedValue(response(409, {
      success: false,
      error: { code: 'SELF_APPROVAL_NOT_ALLOWED', message: 'internal detail ignored' },
    }));
    await expect(proposeRoleAssignment('user-1', 'super_admin', 'Valid reason here', restricted))
      .resolves.toEqual({ ok: false, message: 'Super Admin changes require an out-of-band bootstrap policy.' });
    await expect(approveRoleAssignment('approval-1', selfApproval))
      .resolves.toEqual({ ok: false, message: 'You cannot approve your own proposal.' });
  });

  it('loads paginated approval history with integrity status', async () => {
    const history = {
      approvals: [{
        id: 'approval-1',
        commandType: 'role.assign',
        status: 'executed',
        payload: { targetUserId: 'user-1', roleKey: 'compliance_officer' },
        payloadHash: 'a'.repeat(64),
        version: 2,
        makerUserId: 'admin-1',
        checkerUserId: 'admin-2',
        reason: 'New compliance hire',
        expiresAt: '2026-08-21T00:00:00.000Z',
        executedAt: '2026-08-20T03:00:00.000Z',
        createdAt: '2026-08-20T02:00:00.000Z',
        updatedAt: '2026-08-20T03:00:00.000Z',
        integrity: 'valid',
      }],
      page: 1,
      pageSize: 25,
      total: 1,
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: history }));
    await expect(loadApprovalHistory({ page: 1, pageSize: 25, commandType: 'role.assign' }, fetcher))
      .resolves.toEqual({ ok: true, ...history });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/admin/role-approvals?page=1&pageSize=25&commandType=role.assign',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('reports an invalid integrity result on approval detail without silently repairing it', async () => {
    const detail = {
      id: 'approval-1',
      commandType: 'role.assign',
      status: 'executed',
      payload: { targetUserId: 'user-1', roleKey: 'compliance_officer' },
      payloadHash: 'a'.repeat(64),
      version: 2,
      makerUserId: 'admin-1',
      checkerUserId: 'admin-2',
      reason: 'New compliance hire',
      expiresAt: '2026-08-21T00:00:00.000Z',
      executedAt: '2026-08-20T03:00:00.000Z',
      createdAt: '2026-08-20T02:00:00.000Z',
      updatedAt: '2026-08-20T03:00:00.000Z',
      integrity: 'invalid',
      actions: [{
        id: 'action-1',
        action: 'proposed',
        actorUserId: 'admin-1',
        payloadHash: 'a'.repeat(64),
        reason: 'New compliance hire',
        occurredAt: '2026-08-20T02:00:00.000Z',
        metadata: {},
      }],
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: detail }));
    await expect(loadApprovalDetail('approval-1', fetcher)).resolves.toEqual({ ok: true, detail });
  });

  it('skips searching until at least two characters are entered and never sends bare whitespace', async () => {
    const fetcher = vi.fn();
    await expect(searchUsers(' a ', fetcher)).resolves.toEqual({ ok: true, users: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('searches the user catalogue with a bounded page size', async () => {
    const users = [{
      id: 'user-1',
      name: 'Jane Cruz',
      email: 'jane@example.com',
      emailVerified: true,
      status: 'active',
      roles: ['sales_officer'],
      createdAt: '2026-08-01T00:00:00.000Z',
    }];
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: { users, page: 1, pageSize: 10, total: 1 } }));
    await expect(searchUsers('jane', fetcher)).resolves.toEqual({ ok: true, users });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/admin/users?page=1&pageSize=10&query=jane',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});
