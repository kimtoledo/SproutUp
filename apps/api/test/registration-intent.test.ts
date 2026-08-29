import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createAuthServices } from '../src/auth/service.js';
import type { ApiConfig } from '../src/config.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const config: ApiConfig = {
  host: '127.0.0.1',
  port: 3001,
  appOrigin: 'http://localhost:3000',
  authBaseUrl: 'http://localhost:3001',
  authSecret: 'registration-test-secret-at-least-32-characters',
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  environment: 'test',
  trustProxy: false,
};

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.roles).values([
    { key: 'sme_borrower', name: 'SME Borrower', category: 'customer' },
    { key: 'investor', name: 'Investor', category: 'customer' },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

function signUp(body: Record<string, unknown>) {
  return createAuthServices(config, orm).handler(
    new Request('http://localhost:3001/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.appOrigin },
      body: JSON.stringify(body),
    }),
  );
}

describe('registration intent bootstrap', () => {
  it('requires an explicit borrower or investor intent at email signup', async () => {
    const response = await signUp({
      name: 'Missing Intent',
      email: 'missing-intent@sproutup.ph',
      password: 'correct-horse-battery-staple',
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const users = await orm
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'missing-intent@sproutup.ph'));
    expect(users).toHaveLength(0);
  });

  it('atomically creates the account with only its selected customer role', async () => {
    const response = await signUp({
      name: 'Pilot Investor',
      email: 'signup-investor@sproutup.ph',
      password: 'correct-horse-battery-staple',
      registrationIntent: 'investor',
    });

    expect(response.status).toBe(200);
    const [user] = await orm
      .select({ id: schema.users.id, registrationIntent: schema.users.registrationIntent })
      .from(schema.users)
      .where(eq(schema.users.email, 'signup-investor@sproutup.ph'));
    expect(user?.registrationIntent).toBe('investor');
    const grants = await orm
      .select({ roleKey: schema.userRoles.roleKey })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, user?.id ?? '00000000-0000-4000-8000-000000000000'));
    expect(grants).toEqual([{ roleKey: 'investor' }]);
  });
});
