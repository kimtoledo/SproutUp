import { bootstrapSuperAdmin, createDatabase, schema, type Database } from '@sproutup/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig, type ApiConfig } from '../config.js';
import { createAdminAuthServices } from './service.js';

const initialAdminInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(12).max(128),
});

export interface InitialAdminProvisionResult {
  accountId: string;
  accountStatus: 'created' | 'existing';
  roleStatus: 'granted' | 'already_super_admin';
}

export async function provisionInitialAdmin(
  config: ApiConfig,
  database: Database,
  input: { name: string; email: string; password: string },
): Promise<InitialAdminProvisionResult> {
  const parsed = initialAdminInputSchema.parse(input);
  const [existing] = await database
    .select({ id: schema.adminAccounts.id })
    .from(schema.adminAccounts)
    .where(eq(schema.adminAccounts.email, parsed.email))
    .limit(1);

  let accountId = existing?.id;
  let accountStatus: InitialAdminProvisionResult['accountStatus'] = 'existing';
  if (!accountId) {
    const auth = createAdminAuthServices(config, database);
    const response = await auth.handler(new Request(`${config.authBaseUrl}/v1/auth/admin/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.appOrigin },
      body: JSON.stringify(parsed),
    }));
    if (!response.ok) {
      throw new Error(`Controlled administrator provisioning failed with status ${response.status}`);
    }
    const [created] = await database
      .select({ id: schema.adminAccounts.id })
      .from(schema.adminAccounts)
      .where(eq(schema.adminAccounts.email, parsed.email))
      .limit(1);
    if (!created) throw new Error('Controlled administrator provisioning did not create an account');
    accountId = created.id;
    accountStatus = 'created';
  }

  const role = await bootstrapSuperAdmin(database, parsed.email);
  if (!role.ok) throw new Error(`Controlled administrator role bootstrap failed: ${role.reason}`);
  return { accountId, accountStatus, roleStatus: role.status };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const input = {
    name: process.env.PROVISION_ADMIN_NAME ?? '',
    email: process.env.PROVISION_ADMIN_EMAIL ?? '',
    password: process.env.PROVISION_ADMIN_PASSWORD ?? '',
  };
  const database = createDatabase(config.databaseUrl);
  try {
    await database.check();
    const result = await provisionInitialAdmin(config, database.db, input);
    console.warn(
      `[provision] Initial administrator is ready (${result.accountStatus}, ${result.roleStatus}). `
        + 'No password or session material was printed.',
    );
  } finally {
    await database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
