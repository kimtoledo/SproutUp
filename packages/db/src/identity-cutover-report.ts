import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { asc, eq } from 'drizzle-orm';
import { createDatabase, type Database } from './database.js';
import { roles, userRoles, users } from './schema/index.js';

export type TargetAccountType = 'admin' | 'borrower' | 'investor';
export type IdentityCutoverExceptionReason =
  | 'ambiguous_customer_types'
  | 'missing_account_type';

export interface IdentityCutoverException {
  userId: string;
  reason: IdentityCutoverExceptionReason;
  roleKeys: string[];
}

export interface IdentityCutoverReport {
  totalUsers: number;
  classified: Record<TargetAccountType, number>;
  exceptionCount: number;
  exceptions: IdentityCutoverException[];
}

export async function buildIdentityCutoverReport(
  database: Database,
): Promise<IdentityCutoverReport> {
  const rows = await database
    .select({
      userId: users.id,
      roleKey: userRoles.roleKey,
      roleCategory: roles.category,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.key, userRoles.roleKey))
    .orderBy(asc(users.id), asc(userRoles.roleKey));

  const byUser = new Map<string, { roleKeys: string[]; hasStaff: boolean }>();
  for (const row of rows) {
    const current = byUser.get(row.userId) ?? { roleKeys: [], hasStaff: false };
    if (row.roleKey) current.roleKeys.push(row.roleKey);
    if (row.roleCategory === 'staff') current.hasStaff = true;
    byUser.set(row.userId, current);
  }

  const classified: Record<TargetAccountType, number> = {
    admin: 0,
    borrower: 0,
    investor: 0,
  };
  const exceptions: IdentityCutoverException[] = [];

  for (const [userId, identity] of byUser) {
    const hasBorrower = identity.roleKeys.includes('sme_borrower');
    const hasInvestor = identity.roleKeys.includes('investor');
    if (identity.hasStaff) {
      classified.admin += 1;
    } else if (hasBorrower && !hasInvestor) {
      classified.borrower += 1;
    } else if (hasInvestor && !hasBorrower) {
      classified.investor += 1;
    } else {
      exceptions.push({
        userId,
        reason: hasBorrower && hasInvestor
          ? 'ambiguous_customer_types'
          : 'missing_account_type',
        roleKeys: identity.roleKeys,
      });
    }
  }

  return {
    totalUsers: byUser.size,
    classified,
    exceptionCount: exceptions.length,
    exceptions,
  };
}

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to report identity cutover readiness');
  }
  const database = createDatabase(process.env.DATABASE_URL);
  try {
    console.log(JSON.stringify(await buildIdentityCutoverReport(database.db), null, 2));
  } finally {
    await database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
