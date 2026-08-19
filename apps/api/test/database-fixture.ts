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
