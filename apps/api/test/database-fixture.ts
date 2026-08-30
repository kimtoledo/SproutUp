import { readFile } from 'node:fs/promises';
import type { PGlite } from '@electric-sql/pglite';

export const migrationFiles = [
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
] as const;

export async function applyMigrations(database: PGlite): Promise<void> {
  for (const migration of migrationFiles) {
    const sql = await readFile(
      new URL(`../../../packages/db/migrations/${migration}`, import.meta.url),
      'utf8',
    );
    await database.exec(sql.replaceAll('--> statement-breakpoint', ''));
  }
}
