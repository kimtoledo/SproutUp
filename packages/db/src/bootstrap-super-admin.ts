import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { createDatabase, type Database } from './database.js';
import { users } from './schema/users.js';
import { userRoles } from './schema/rbac.js';
import { writeAudit } from './write-audit.js';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export type BootstrapResult =
  | { ok: true; status: 'granted' | 'already_super_admin'; userId: string; email: string }
  | { ok: false; reason: 'user_not_found' | 'user_not_active' };

/**
 * Break-glass initial administrator setup. Promotes an existing, active account
 * to `super_admin` so the maker/checker role workflow has its first authorized
 * actor. This deliberately bypasses maker/checker and must only be run during
 * controlled environment setup; the grant is recorded as immutable audit
 * evidence. Running it again for the same account is a no-op.
 */
export async function bootstrapSuperAdmin(
  database: Database,
  email: string,
): Promise<BootstrapResult> {
  const normalizedEmail = email.trim().toLowerCase();

  return database.transaction(async (transaction) => {
    const [account] = await transaction
      .select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!account) return { ok: false as const, reason: 'user_not_found' as const };
    if (account.status !== 'active') return { ok: false as const, reason: 'user_not_active' as const };

    const [existing] = await transaction
      .select({ roleKey: userRoles.roleKey })
      .from(userRoles)
      .where(and(eq(userRoles.userId, account.id), eq(userRoles.roleKey, 'super_admin')))
      .limit(1);

    if (existing) {
      return {
        ok: true as const,
        status: 'already_super_admin' as const,
        userId: account.id,
        email: account.email,
      };
    }

    await transaction.insert(userRoles).values({ userId: account.id, roleKey: 'super_admin' });
    await writeAudit(transaction, {
      actorType: 'system',
      actorRoles: ['super_admin'],
      action: 'account.super_admin_bootstrapped',
      outcome: 'succeeded',
      resourceType: 'user',
      resourceId: account.id,
      reason: 'Break-glass initial administrator bootstrap',
      metadata: { email: account.email, viaMakerChecker: false },
    });

    return {
      ok: true as const,
      status: 'granted' as const,
      userId: account.id,
      email: account.email,
    };
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to bootstrap a super administrator');
  }

  const email = process.argv[2] ?? process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  if (!email) {
    throw new Error(
      'Provide the target account email as an argument or BOOTSTRAP_SUPER_ADMIN_EMAIL',
    );
  }

  const database = createDatabase(databaseUrl);
  try {
    const result = await bootstrapSuperAdmin(database.db, email);
    if (!result.ok) {
      console.error(`Bootstrap failed: ${result.reason} (${email})`);
      process.exitCode = 1;
      return;
    }
    console.warn(
      `[bootstrap] ${email} is now super_admin (${result.status}). This bypassed maker/checker; `
        + 'use it only for controlled environment setup.',
    );
  } finally {
    await database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
