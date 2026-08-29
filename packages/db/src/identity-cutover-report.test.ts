import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { buildIdentityCutoverReport } from './identity-cutover-report.js';
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
  ]) {
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
    await pglite.exec(sql.replaceAll('--> statement-breakpoint', ''));
  }
  await seedAuthorization(db);
});

afterAll(async () => {
  await pglite.close();
});

describe('identity cutover report', () => {
  it('classifies staff with precedence and exposes ambiguous records without email data', async () => {
    const adminId = '00000000-0000-4000-8000-00000000d101';
    const borrowerId = '00000000-0000-4000-8000-00000000d102';
    const investorId = '00000000-0000-4000-8000-00000000d103';
    const ambiguousId = '00000000-0000-4000-8000-00000000d104';
    const missingId = '00000000-0000-4000-8000-00000000d105';
    await db.insert(schema.users).values([
      { id: adminId, name: 'Staff Customer', email: 'staff-customer@sproutup.ph' },
      { id: borrowerId, name: 'Borrower', email: 'cutover-borrower@sproutup.ph' },
      { id: investorId, name: 'Investor', email: 'cutover-investor@sproutup.ph' },
      { id: ambiguousId, name: 'Ambiguous', email: 'cutover-ambiguous@sproutup.ph' },
      { id: missingId, name: 'Missing', email: 'cutover-missing@sproutup.ph' },
    ]);
    await db.insert(schema.userRoles).values([
      { userId: adminId, roleKey: 'compliance_officer' },
      { userId: adminId, roleKey: 'investor' },
      { userId: borrowerId, roleKey: 'sme_borrower' },
      { userId: investorId, roleKey: 'investor' },
      { userId: ambiguousId, roleKey: 'sme_borrower' },
      { userId: ambiguousId, roleKey: 'investor' },
    ]);

    const report = await buildIdentityCutoverReport(db);

    expect(report).toEqual({
      totalUsers: 5,
      classified: { admin: 1, borrower: 1, investor: 1 },
      exceptionCount: 2,
      exceptions: [
        {
          userId: ambiguousId,
          reason: 'ambiguous_customer_types',
          roleKeys: ['investor', 'sme_borrower'],
        },
        { userId: missingId, reason: 'missing_account_type', roleKeys: [] },
      ],
    });
    expect(JSON.stringify(report)).not.toContain('@sproutup.ph');
  });
});
