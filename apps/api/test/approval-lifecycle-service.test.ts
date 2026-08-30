import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createApprovalLifecycleService } from '../src/auth/approval-lifecycle-service.js';
import { createRoleAssignmentService } from '../src/auth/role-assignments-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const makerId = '00000000-0000-4000-8000-000000000501';
const checkerId = '00000000-0000-4000-8000-000000000502';
const targetId = '00000000-0000-4000-8000-000000000503';
const now = () => new Date('2026-08-19T00:00:00Z');

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.roles).values({
    key: 'compliance_officer',
    name: 'Compliance Officer',
    category: 'staff',
  });
  await orm.insert(schema.adminAccounts).values([
    { id: makerId, name: 'Maker', email: 'lifecycle-maker@sproutup.ph' },
    { id: checkerId, name: 'Checker', email: 'lifecycle-checker@sproutup.ph' },
    { id: targetId, name: 'Target', email: 'lifecycle-target@sproutup.ph' },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

async function propose(requestId: string) {
  const result = await createRoleAssignmentService(orm, now).propose({
    makerUserId: makerId,
    makerRoles: ['super_admin'],
    targetUserId: targetId,
    roleKey: 'compliance_officer',
    reason: 'Pilot access request for review',
    requestId,
  });
  if (!result.ok) throw new Error(`Proposal failed: ${result.reason}`);
  return result.request;
}

describe('approval lifecycle service', () => {
  it('allows only a distinct non-target checker to reject a pending role change', async () => {
    const request = await propose('00000000-0000-4000-8000-000000000504');
    const service = createApprovalLifecycleService(orm, now);

    await expect(
      service.reject({
        checkerUserId: makerId,
        checkerRoles: ['super_admin'],
        approvalId: request.id,
        reason: 'Maker rejection is invalid',
        requestId: '00000000-0000-4000-8000-000000000505',
      }),
    ).resolves.toEqual({ ok: false, reason: 'same_actor' });
    await expect(
      service.reject({
        checkerUserId: targetId,
        checkerRoles: ['super_admin'],
        approvalId: request.id,
        reason: 'Target rejection is invalid',
        requestId: '00000000-0000-4000-8000-000000000506',
      }),
    ).resolves.toEqual({ ok: false, reason: 'self_review_not_allowed' });
    await expect(
      service.reject({
        checkerUserId: checkerId,
        checkerRoles: ['super_admin'],
        approvalId: request.id,
        reason: 'Supporting evidence is incomplete',
        requestId: '00000000-0000-4000-8000-000000000507',
      }),
    ).resolves.toEqual({ ok: true });

    const [stored] = await orm
      .select({ status: schema.approvalRequests.status, checkerUserId: schema.approvalRequests.checkerUserId })
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, request.id));
    const actions = await orm
      .select({ action: schema.approvalActions.action })
      .from(schema.approvalActions)
      .where(eq(schema.approvalActions.requestId, request.id));
    expect(stored).toEqual({ status: 'rejected', checkerUserId: checkerId });
    expect(actions.map(({ action }) => action)).toEqual(['proposed', 'rejected']);
  });

  it('allows only the original maker to cancel a pending role change', async () => {
    const request = await propose('00000000-0000-4000-8000-000000000508');
    const service = createApprovalLifecycleService(orm, now);

    await expect(
      service.cancel({
        makerUserId: checkerId,
        makerRoles: ['super_admin'],
        approvalId: request.id,
        reason: 'Unrelated actor cancellation',
        requestId: '00000000-0000-4000-8000-000000000509',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_maker' });
    await expect(
      service.cancel({
        makerUserId: makerId,
        makerRoles: ['super_admin'],
        approvalId: request.id,
        reason: 'Request submitted in error',
        requestId: '00000000-0000-4000-8000-000000000510',
      }),
    ).resolves.toEqual({ ok: true });

    const [stored] = await orm
      .select({ status: schema.approvalRequests.status })
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, request.id));
    expect(stored?.status).toBe('cancelled');
  });
});
