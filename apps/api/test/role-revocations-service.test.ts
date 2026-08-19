import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createRoleRevocationService } from '../src/auth/role-revocations-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const makerId = '00000000-0000-4000-8000-000000000411';
const checkerId = '00000000-0000-4000-8000-000000000412';
const targetId = '00000000-0000-4000-8000-000000000413';

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.roles).values([
    { key: 'super_admin', name: 'Super Admin', category: 'staff' },
    { key: 'sme_borrower', name: 'SME Borrower', category: 'customer' },
    { key: 'investor', name: 'Investor', category: 'customer' },
  ]);
  await orm.insert(schema.users).values([
    { id: makerId, name: 'Maker', email: 'revoke-maker@sproutup.ph' },
    { id: checkerId, name: 'Checker', email: 'revoke-checker@sproutup.ph' },
    { id: targetId, name: 'Dual Customer', email: 'revoke-target@sproutup.ph' },
  ]);
  await orm.insert(schema.userRoles).values([
    { userId: targetId, roleKey: 'sme_borrower', grantedBy: makerId },
    { userId: targetId, roleKey: 'investor', grantedBy: makerId },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

describe('role revocation approval service', () => {
  it('requires a separate checker and atomically removes only the approved role', async () => {
    const service = createRoleRevocationService(orm, () => new Date('2026-08-19T00:00:00Z'));
    const proposal = await service.propose({
      makerUserId: makerId,
      makerRoles: ['super_admin'],
      targetUserId: targetId,
      roleKey: 'investor',
      reason: 'Remove duplicate customer access',
      requestId: '00000000-0000-4000-8000-000000000414',
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) throw new Error('Expected revocation proposal to succeed');

    await expect(
      service.approve({
        checkerUserId: makerId,
        checkerRoles: ['super_admin'],
        approvalId: proposal.request.id,
        requestId: '00000000-0000-4000-8000-000000000415',
      }),
    ).resolves.toEqual({ ok: false, reason: 'same_actor' });
    await expect(
      service.approve({
        checkerUserId: checkerId,
        checkerRoles: ['super_admin'],
        approvalId: proposal.request.id,
        reason: 'Confirmed access removal',
        requestId: '00000000-0000-4000-8000-000000000416',
      }),
    ).resolves.toEqual({ ok: true });

    const remaining = await orm
      .select({ roleKey: schema.userRoles.roleKey })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, targetId));
    const actions = await orm
      .select({ action: schema.approvalActions.action })
      .from(schema.approvalActions)
      .where(eq(schema.approvalActions.requestId, proposal.request.id));

    expect(remaining).toEqual([{ roleKey: 'sme_borrower' }]);
    expect(actions.map(({ action }) => action)).toEqual(['proposed', 'approved', 'executed']);
  });

  it('protects the last role of an active account and all Super Admin changes', async () => {
    const service = createRoleRevocationService(orm);
    await expect(
      service.propose({
        makerUserId: makerId,
        makerRoles: ['super_admin'],
        targetUserId: targetId,
        roleKey: 'sme_borrower',
        reason: 'Remove final customer role',
        requestId: '00000000-0000-4000-8000-000000000417',
      }),
    ).resolves.toEqual({ ok: false, reason: 'last_role_not_allowed' });
    await expect(
      service.propose({
        makerUserId: makerId,
        makerRoles: ['super_admin'],
        targetUserId: targetId,
        roleKey: 'super_admin',
        reason: 'Attempt privileged revocation',
        requestId: '00000000-0000-4000-8000-000000000418',
      }),
    ).resolves.toEqual({ ok: false, reason: 'restricted_role' });
  });
});
