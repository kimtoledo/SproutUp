import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { seedAuthorization } from './seed-authorization.js';
import type { Database } from './database.js';
import * as schema from './schema/index.js';

const foundationMigrations = [
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
] as const;

async function applyMigration(database: PGlite, migration: string): Promise<void> {
  const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
  await database.exec(sql.replaceAll('--> statement-breakpoint', ''));
}

async function createFixture(): Promise<{ pglite: PGlite; db: Database }> {
  const pglite = new PGlite();
  for (const migration of foundationMigrations) await applyMigration(pglite, migration);
  const db = drizzle(pglite, { schema }) as unknown as Database;
  await seedAuthorization(db);
  await pglite.exec(`
    insert into roles (key, name, category) values
      ('sme_borrower', 'SME Borrower', 'customer'),
      ('investor', 'Investor', 'customer')
  `);
  return { pglite, db };
}

describe('portal identity backfill migration', () => {
  it('copies each safe legacy identity, credential, and session exactly once', async () => {
    const { pglite, db } = await createFixture();
    try {
      const adminId = '00000000-0000-4000-8000-00000000e101';
      const borrowerId = '00000000-0000-4000-8000-00000000e102';
      const investorId = '00000000-0000-4000-8000-00000000e103';
      await db.insert(schema.users).values([
        {
          id: adminId,
          name: 'Admin',
          email: 'backfill-admin@sproutup.ph',
          registrationIntent: 'investor',
        },
        {
          id: borrowerId,
          name: 'Borrower',
          email: 'backfill-borrower@sproutup.ph',
          registrationIntent: 'borrower',
        },
        {
          id: investorId,
          name: 'Investor',
          email: 'backfill-investor@sproutup.ph',
          registrationIntent: 'investor',
        },
      ]);
      await db.insert(schema.userRoles).values({ userId: adminId, roleKey: 'super_admin' });
      const onboardingCaseId = '00000000-0000-4000-8000-00000000e150';
      await db.insert(schema.onboardingCases).values({
        id: onboardingCaseId,
        caseType: 'borrower',
        applicantUserId: borrowerId,
      });
      await db.insert(schema.onboardingCaseEvents).values({
        caseId: onboardingCaseId,
        caseVersion: 1,
        eventType: 'created',
        toStatus: 'draft',
        actorType: 'user',
        actorUserId: borrowerId,
      });
      await db.insert(schema.accounts).values([
        {
          id: '00000000-0000-4000-8000-00000000e201',
          userId: adminId,
          providerId: 'credential',
          accountId: 'backfill-admin@sproutup.ph',
          password: 'opaque-admin-hash',
        },
        {
          id: '00000000-0000-4000-8000-00000000e202',
          userId: borrowerId,
          providerId: 'credential',
          accountId: 'backfill-borrower@sproutup.ph',
          password: 'opaque-borrower-hash',
        },
        {
          id: '00000000-0000-4000-8000-00000000e203',
          userId: investorId,
          providerId: 'credential',
          accountId: 'backfill-investor@sproutup.ph',
          password: 'opaque-investor-hash',
        },
      ]);
      await db.insert(schema.sessions).values([
        {
          id: '00000000-0000-4000-8000-00000000e301',
          userId: adminId,
          token: 'opaque-admin-session',
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        },
        {
          id: '00000000-0000-4000-8000-00000000e302',
          userId: borrowerId,
          token: 'opaque-borrower-session',
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        },
        {
          id: '00000000-0000-4000-8000-00000000e303',
          userId: investorId,
          token: 'opaque-investor-session',
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        },
      ]);

      await applyMigration(pglite, '0021_backfill-portal-identities.sql');

      const counts = await pglite.query<{
        admins: number;
        borrowers: number;
        investors: number;
        credentials: number;
        sessions: number;
      }>(`select
        (select count(*)::int from admin_accounts) admins,
        (select count(*)::int from borrower_accounts) borrowers,
        (select count(*)::int from investor_accounts) investors,
        ((select count(*) from admin_credentials)
          + (select count(*) from borrower_credentials)
          + (select count(*) from investor_credentials))::int credentials,
        ((select count(*) from admin_sessions)
          + (select count(*) from borrower_sessions)
          + (select count(*) from investor_sessions))::int sessions`);
      expect(counts.rows[0]).toEqual({
        admins: 1,
        borrowers: 1,
        investors: 1,
        credentials: 3,
        sessions: 3,
      });
      const admin = await pglite.query<{ email: string }>(
        'select email from admin_accounts where id = $1',
        [adminId],
      );
      expect(admin.rows[0]?.email).toBe('backfill-admin@sproutup.ph');
      const audit = await pglite.query<{ metadata: Record<string, number> }>(
        `select metadata from audit_events where action = 'identity.portal_backfill_completed'`,
      );
      expect(audit.rows.at(-1)?.metadata).toMatchObject({ users: 3, credentials: 3, sessions: 3 });

      await applyMigration(pglite, '0022_mean_toad_men.sql');
      const staffCutover = await pglite.query<{
        admin_grants: number;
        legacy_admin_roles: number;
        legacy_admin_credentials: number;
        legacy_admin_sessions: number;
        legacy_customer_roles: number;
      }>(`select
        (select count(*)::int from admin_role_grants where admin_account_id = $1) admin_grants,
        (select count(*)::int from user_roles where user_id = $1) legacy_admin_roles,
        (select count(*)::int from accounts where user_id = $1) legacy_admin_credentials,
        (select count(*)::int from sessions where user_id = $1) legacy_admin_sessions,
        (select count(*)::int from user_roles where user_id in ($2, $3)) legacy_customer_roles`,
        [adminId, borrowerId, investorId],
      );
      expect(staffCutover.rows[0]).toEqual({
        admin_grants: 1,
        legacy_admin_roles: 0,
        legacy_admin_credentials: 0,
        legacy_admin_sessions: 0,
        legacy_customer_roles: 2,
      });
      await expect(
        pglite.query(
          `insert into user_roles (user_id, role_key) values ($1, 'super_admin')`,
          [adminId],
        ),
      ).rejects.toThrow('admin accounts cannot receive legacy role grants');
      await expect(
        pglite.query(
          `insert into admin_role_grants (admin_account_id, role_key) values ($1, 'investor')`,
          [adminId],
        ),
      ).rejects.toThrow('admin role grants accept staff roles only');
      const staffAudit = await pglite.query<{ action: string }>(
        `select action from audit_events where action = 'identity.admin_rbac_cutover_completed'`,
      );
      expect(staffAudit.rows).toEqual([{ action: 'identity.admin_rbac_cutover_completed' }]);

      await applyMigration(pglite, '0023_real_daredevil.sql');
      const ownershipAudit = await pglite.query<{
        action: string;
        metadata: Record<string, number>;
      }>(
        `select action, metadata from audit_events
         where action = 'identity.account_ownership_cutover_completed'`,
      );
      expect(ownershipAudit.rows).toEqual([{
        action: 'identity.account_ownership_cutover_completed',
        metadata: expect.objectContaining({ onboardingCases: 1, onboardingEvents: 1 }),
      }]);
      await expect(pglite.query(
        `update onboarding_cases set case_type = 'investor' where id = $1`,
        [onboardingCaseId],
      )).rejects.toThrow('onboarding case type must match borrower or investor account class');

      const lateBorrowerId = '00000000-0000-4000-8000-00000000e104';
      const lateCredentialId = '00000000-0000-4000-8000-00000000e204';
      await db.insert(schema.users).values({
        id: lateBorrowerId,
        name: 'Late Borrower',
        email: 'late-backfill-borrower@sproutup.ph',
        registrationIntent: 'borrower',
      });
      await db.insert(schema.accounts).values({
        id: lateCredentialId,
        userId: lateBorrowerId,
        providerId: 'credential',
        accountId: 'late-backfill-borrower@sproutup.ph',
        password: 'opaque-late-borrower-hash',
      });
      await db.insert(schema.sessions).values({
        userId: lateBorrowerId,
        token: 'opaque-late-borrower-session',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      });

      await applyMigration(pglite, '0024_customer-auth-cutover.sql');
      const customerCutover = await pglite.query<{
        legacy_credentials: number;
        legacy_sessions: number;
        legacy_grants: number;
        cutover_audits: number;
      }>(`select
        (select count(*)::int from accounts) legacy_credentials,
        (select count(*)::int from sessions) legacy_sessions,
        (select count(*)::int from user_roles) legacy_grants,
        (select count(*)::int from audit_events
          where action = 'identity.customer_auth_cutover_completed') cutover_audits`);
      expect(customerCutover.rows[0]).toEqual({
        legacy_credentials: 0,
        legacy_sessions: 0,
        legacy_grants: 0,
        cutover_audits: 1,
      });
      const lateTarget = await pglite.query<{
        borrowers: number;
        credentials: number;
      }>(`select
        (select count(*)::int from borrower_accounts where id = $1) borrowers,
        (select count(*)::int from borrower_credentials
          where id = $2 and borrower_account_id = $1) credentials`,
      [lateBorrowerId, lateCredentialId]);
      expect(lateTarget.rows[0]).toEqual({ borrowers: 1, credentials: 1 });
      await expect(pglite.query(
          `insert into accounts (account_id, provider_id, user_id)
         values ('retired@sproutup.ph', 'credential', $1)`,
        [borrowerId],
      )).rejects.toThrow('legacy unified authentication namespace is retired');
    } finally {
      await pglite.close();
    }
  });

  it('refuses ambiguous customer identity without partially copying it', async () => {
    const { pglite, db } = await createFixture();
    try {
      const userId = '00000000-0000-4000-8000-00000000e401';
      await db.insert(schema.users).values({
        id: userId,
        name: 'Ambiguous',
        email: 'backfill-ambiguous@sproutup.ph',
        registrationIntent: 'borrower',
      });
      await db.insert(schema.userRoles).values({ userId, roleKey: 'investor' });

      await expect(
        applyMigration(pglite, '0021_backfill-portal-identities.sql'),
      ).rejects.toThrow('portal identity backfill refused');
      const count = await pglite.query<{ count: number }>(
        `select ((select count(*) from admin_accounts)
          + (select count(*) from borrower_accounts)
          + (select count(*) from investor_accounts))::int count`,
      );
      expect(count.rows[0]?.count).toBe(0);
    } finally {
      await pglite.close();
    }
  });
});
