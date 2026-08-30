import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type Database } from '@sproutup/db';
import { createApprovalHistoryService } from '../src/auth/approval-history-service.js';
import { createApprovalLifecycleService } from '../src/auth/approval-lifecycle-service.js';
import { createRoleAssignmentService } from '../src/auth/role-assignments-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const makerId = '00000000-0000-4000-8000-000000000601';
const checkerId = '00000000-0000-4000-8000-000000000602';
const targetId = '00000000-0000-4000-8000-000000000603';
let approvalId = '';

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.roles).values({
    key: 'compliance_officer',
    name: 'Compliance Officer',
    category: 'staff',
  });
  await orm.insert(schema.adminAccounts).values([
    { id: makerId, name: 'Maker', email: 'history-maker@sproutup.ph' },
    { id: checkerId, name: 'Checker', email: 'history-checker@sproutup.ph' },
    { id: targetId, name: 'Target', email: 'history-target@sproutup.ph' },
  ]);
  const proposal = await createRoleAssignmentService(orm).propose({
    makerUserId: makerId,
    makerRoles: ['super_admin'],
    targetUserId: targetId,
    roleKey: 'compliance_officer',
    reason: 'History visibility request',
    requestId: '00000000-0000-4000-8000-000000000604',
  });
  if (!proposal.ok) throw new Error('Expected proposal to succeed');
  approvalId = proposal.request.id;
  await createApprovalLifecycleService(orm).reject({
    checkerUserId: checkerId,
    checkerRoles: ['super_admin'],
    approvalId,
    reason: 'Evidence did not meet policy',
    requestId: '00000000-0000-4000-8000-000000000605',
  });
});

afterAll(async () => {
  await pglite.close();
});

describe('approval history service', () => {
  it('returns bounded role approval history with explicit payload integrity', async () => {
    const result = await createApprovalHistoryService(orm).list({
      page: 1,
      pageSize: 25,
      commandType: 'role.assign',
      status: 'rejected',
    });

    expect(result.total).toBe(1);
    expect(result.approvals).toEqual([
      expect.objectContaining({ id: approvalId, status: 'rejected', integrity: 'valid' }),
    ]);
  });

  it('returns the append-only action timeline for a role approval', async () => {
    const result = await createApprovalHistoryService(orm).detail(approvalId);

    expect(result).toMatchObject({
      id: approvalId,
      integrity: 'valid',
      actions: [
        { action: 'proposed', actorUserId: makerId },
        { action: 'rejected', actorUserId: checkerId, reason: 'Evidence did not meet policy' },
      ],
    });
  });
});
