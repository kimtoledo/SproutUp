import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { bootstrapSuperAdmin } from './bootstrap-super-admin.js';
import { seedAuthorization } from './seed-authorization.js';
import type { Database } from './database.js';
import * as schema from './schema/index.js';

const pglite = new PGlite();
const db = drizzle(pglite, { schema }) as unknown as Database;

beforeAll(async () => {
  for (const migration of [
    '0000_yielding_zombie.sql',
    '0001_audit-immutability.sql',
    '0002_little_union_jack.sql',
    '0003_approval-actions-immutability.sql',
    '0004_perpetual_mikhail_rasputin.sql',
    '0005_lowly_shadow_king.sql',
    '0006_onboarding-events-immutability.sql',
    '0007_narrow_wolfsbane.sql',
    '0008_applicant-role-bootstrap.sql',
    '0009_moaning_argent.sql',
    '0010_job-attempt-evidence.sql',
    '0011_wide_nemesis.sql',
    '0012_ledger-invariants.sql',
    '0013_robust_corsair.sql',
    '0014_consent-evidence-invariants.sql',
    '0015_wise_lockjaw.sql',
    '0016_config-rule-immutability.sql',
    '0017_salty_molten_man.sql',
    '0018_document-version-immutability.sql',
    '0019_faithful_siren.sql',
    '0020_portal-identity-isolation.sql',
    '0021_backfill-portal-identities.sql',
    '0022_mean_toad_men.sql',
    '0023_real_daredevil.sql',
    '0024_customer-auth-cutover.sql',
    '0025_lame_may_parker.sql',
    '0026_illegal_ravenous.sql',
    '0027_light_rattler.sql',
    '0028_massive_energizer.sql',
  ]) {
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
    await pglite.exec(sql.replaceAll('--> statement-breakpoint', ''));
  }
  await seedAuthorization(db);
  await db.insert(schema.adminAccounts).values([
    { id: '00000000-0000-4000-8000-0000000009a1', name: 'Ops Lead', email: 'ops-lead@sproutup.ph' },
    {
      id: '00000000-0000-4000-8000-0000000009a2',
      name: 'Suspended User',
      email: 'suspended@sproutup.ph',
      status: 'suspended',
    },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

describe('bootstrapSuperAdmin', () => {
  it('grants super_admin to an active account and records audit evidence', async () => {
    const result = await bootstrapSuperAdmin(db, 'Ops-Lead@Sproutup.PH');
    expect(result).toEqual({
      ok: true,
      status: 'granted',
      userId: '00000000-0000-4000-8000-0000000009a1',
      email: 'ops-lead@sproutup.ph',
    });

    const roles = await db
      .select({ roleKey: schema.adminRoleGrants.roleKey })
      .from(schema.adminRoleGrants)
      .where(
        eq(
          schema.adminRoleGrants.adminAccountId,
          '00000000-0000-4000-8000-0000000009a1',
        ),
      );
    expect(roles).toContainEqual({ roleKey: 'super_admin' });

    const audits = await db
      .select({ action: schema.auditEvents.action, actorType: schema.auditEvents.actorType })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, '00000000-0000-4000-8000-0000000009a1'));
    expect(audits).toContainEqual({
      action: 'account.super_admin_bootstrapped',
      actorType: 'system',
    });
  });

  it('is idempotent for an account that already holds super_admin', async () => {
    const result = await bootstrapSuperAdmin(db, 'ops-lead@sproutup.ph');
    expect(result).toMatchObject({ ok: true, status: 'already_super_admin' });
  });

  it('refuses an unknown or inactive account', async () => {
    await expect(bootstrapSuperAdmin(db, 'nobody@sproutup.ph')).resolves.toEqual({
      ok: false,
      reason: 'user_not_found',
    });
    await expect(bootstrapSuperAdmin(db, 'suspended@sproutup.ph')).resolves.toEqual({
      ok: false,
      reason: 'user_not_active',
    });
  });
});
