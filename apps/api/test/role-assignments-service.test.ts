import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createRoleAssignmentService } from '../src/auth/role-assignments-service.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const makerId = '00000000-0000-4000-8000-000000000201';
const checkerId = '00000000-0000-4000-8000-000000000202';
const targetId = '00000000-0000-4000-8000-000000000203';

beforeAll(async () => {
  for (const migration of [
    '0000_yielding_zombie.sql',
    '0001_audit-immutability.sql',
    '0002_little_union_jack.sql',
    '0003_approval-actions-immutability.sql',
    '0004_perpetual_mikhail_rasputin.sql',
  ]) {
    const sql = await readFile(
      new URL(`../../../packages/db/migrations/${migration}`, import.meta.url),
      'utf8',
    );
    await pglite.exec(sql.replaceAll('--> statement-breakpoint', ''));
  }
  await orm.insert(schema.roles).values([
    { key: 'super_admin', name: 'Super Admin', category: 'staff' },
    { key: 'investor', name: 'Investor', category: 'customer' },
  ]);
  await orm.insert(schema.users).values([
    { id: makerId, name: 'Maker', email: 'maker-service@sproutup.ph' },
    { id: checkerId, name: 'Checker', email: 'checker-service@sproutup.ph' },
    { id: targetId, name: 'Investor', email: 'investor-service@sproutup.ph' },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

describe('role assignment approval service', () => {
  it('requires a different checker and atomically executes the approved grant', async () => {
    const service = createRoleAssignmentService(orm, () => new Date('2026-08-19T00:00:00Z'));
    const proposal = await service.propose({
      makerUserId: makerId,
      makerRoles: ['super_admin'],
      targetUserId: targetId,
      roleKey: 'investor',
      reason: 'Investor onboarding passed review',
      requestId: '00000000-0000-4000-8000-000000000204',
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) throw new Error('Expected proposal to succeed');

    await expect(
      service.approve({
        checkerUserId: makerId,
        checkerRoles: ['super_admin'],
        approvalId: proposal.request.id,
        reason: 'Attempted maker approval',
        requestId: '00000000-0000-4000-8000-000000000205',
      }),
    ).resolves.toEqual({ ok: false, reason: 'same_actor' });

    await expect(
      service.approve({
        checkerUserId: checkerId,
        checkerRoles: ['super_admin'],
        approvalId: proposal.request.id,
        reason: 'Independent checker approval',
        requestId: '00000000-0000-4000-8000-000000000206',
      }),
    ).resolves.toEqual({ ok: true });

    const grants = await orm
      .select()
      .from(schema.userRoles)
      .where(and(eq(schema.userRoles.userId, targetId), eq(schema.userRoles.roleKey, 'investor')));
    const actions = await orm
      .select({ action: schema.approvalActions.action })
      .from(schema.approvalActions)
      .where(eq(schema.approvalActions.requestId, proposal.request.id));
    const audits = await orm
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, proposal.request.id));

    expect(grants).toHaveLength(1);
    expect(actions.map(({ action }) => action)).toEqual(['proposed', 'approved', 'executed']);
    expect(audits.map(({ action }) => action)).toContain('role_assignment.proposed');
  });

  it('forbids self-targeted and Super Admin proposals', async () => {
    const service = createRoleAssignmentService(orm);

    await expect(
      service.propose({
        makerUserId: makerId,
        makerRoles: ['super_admin'],
        targetUserId: makerId,
        roleKey: 'investor',
        reason: 'Self-targeted role request',
        requestId: '00000000-0000-4000-8000-000000000207',
      }),
    ).resolves.toEqual({ ok: false, reason: 'self_target_not_allowed' });
    await expect(
      service.propose({
        makerUserId: makerId,
        makerRoles: ['super_admin'],
        targetUserId: targetId,
        roleKey: 'super_admin',
        reason: 'Privileged elevation request',
        requestId: '00000000-0000-4000-8000-000000000208',
      }),
    ).resolves.toEqual({ ok: false, reason: 'restricted_role' });
  });
});
