import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import {
  initialRolePermissions,
  permissionDefinitions,
  roleDefinitions,
} from '@sproutup/shared';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from './database.js';
import { permissions, rolePermissions, roles } from './schema/rbac.js';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export async function seedAuthorization(database: Database): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction
      .insert(roles)
      .values([...roleDefinitions])
      .onConflictDoUpdate({
        target: roles.key,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          isActive: true,
        },
      });

    await transaction
      .insert(permissions)
      .values([...permissionDefinitions])
      .onConflictDoUpdate({
        target: permissions.key,
        set: { description: sql`excluded.description` },
      });

    const grants = roleDefinitions.flatMap(({ key: roleKey }) =>
      initialRolePermissions[roleKey].map((permissionKey) => ({ roleKey, permissionKey })),
    );

    await transaction.insert(rolePermissions).values(grants).onConflictDoNothing();
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed authorization data');
  }

  const database = createDatabase(databaseUrl);
  try {
    await seedAuthorization(database.db);
  } finally {
    await database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
