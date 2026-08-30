import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import {
  createBorrowerAuthServices,
  createCustomerAuthServices,
  createInvestorAuthServices,
} from '../src/auth/service.js';
import type { ApiConfig } from '../src/config.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const config: ApiConfig = {
  host: '127.0.0.1',
  port: 3001,
  appOrigin: 'http://localhost:3000',
  appOrigins: ['http://borrower.lvh.me:3000', 'http://investor.lvh.me:3000'],
  authBaseUrl: 'http://localhost:3001',
  authSecret: 'registration-test-secret-at-least-32-characters',
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  environment: 'test',
  trustProxy: false,
};
const borrowerAuth = createBorrowerAuthServices(config, orm);
const investorAuth = createInvestorAuthServices(config, orm);
const customerAuth = createCustomerAuthServices(orm, borrowerAuth, investorAuth);

beforeAll(async () => applyMigrations(pglite));

afterAll(async () => {
  await pglite.close();
});

function signUp(accountType: 'borrower' | 'investor', body: Record<string, unknown>) {
  const auth = accountType === 'borrower' ? borrowerAuth : investorAuth;
  return auth.handler(
    new Request(`http://localhost:3001/v1/auth/${accountType}/sign-up/email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://${accountType}.lvh.me:3000`,
      },
      body: JSON.stringify(body),
    }),
  );
}

function signIn(accountType: 'borrower' | 'investor', email: string) {
  const auth = accountType === 'borrower' ? borrowerAuth : investorAuth;
  return auth.handler(new Request(
    `http://localhost:3001/v1/auth/${accountType}/sign-in/email`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://${accountType}.lvh.me:3000`,
      },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    },
  ));
}

function sessionCookie(response: Response): string {
  return response.headers.getSetCookie()[0]?.split(';', 1)[0] ?? '';
}

describe('isolated customer account registration', () => {
  it('creates a physical borrower account without a legacy user or role grant', async () => {
    const response = await signUp('borrower', {
      name: 'Pilot Borrower',
      email: 'signup-borrower@sproutup.ph',
      password: 'correct-horse-battery-staple',
    });

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toContain('sproutup_borrower.session_token');
    const borrowers = await orm
      .select({ id: schema.borrowerAccounts.id })
      .from(schema.borrowerAccounts)
      .where(eq(schema.borrowerAccounts.email, 'signup-borrower@sproutup.ph'));
    const users = await orm
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'signup-borrower@sproutup.ph'));
    const roles = borrowers[0]
      ? await orm.select().from(schema.userRoles)
          .where(eq(schema.userRoles.userId, borrowers[0].id))
      : [];
    expect(borrowers).toHaveLength(1);
    expect(users).toHaveLength(0);
    expect(roles).toHaveLength(0);
  });

  it('creates an investor account with class capabilities and no roles', async () => {
    const response = await signUp('investor', {
      name: 'Pilot Investor',
      email: 'signup-investor@sproutup.ph',
      password: 'correct-horse-battery-staple',
    });

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toContain('sproutup_investor.session_token');
    const [investor] = await orm
      .select({ id: schema.investorAccounts.id })
      .from(schema.investorAccounts)
      .where(eq(schema.investorAccounts.email, 'signup-investor@sproutup.ph'));
    const context = investor
      ? await createInvestorAuthServices(config, orm).resolveAuthorization(investor.id)
      : null;
    expect(context).toMatchObject({ accountType: 'investor', roles: [] });
    expect(context?.permissions).toContain('investor_onboarding.manage_own');
  });

  it('rejects the same normalized email in the other customer namespace', async () => {
    const response = await signUp('investor', {
      name: 'Cross Portal Attempt',
      email: 'signup-borrower@sproutup.ph',
      password: 'correct-horse-battery-staple',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const investors = await orm
      .select({ id: schema.investorAccounts.id })
      .from(schema.investorAccounts)
      .where(eq(schema.investorAccounts.email, 'signup-borrower@sproutup.ph'));
    expect(investors).toHaveLength(0);
  });

  it('does not authenticate a borrower credential as an investor', async () => {
    await expect(signIn('investor', 'signup-borrower@sproutup.ph'))
      .resolves.toMatchObject({ status: 401 });
    await expect(signIn('borrower', 'signup-borrower@sproutup.ph'))
      .resolves.toMatchObject({ status: 200 });
  });

  it('fails closed when both isolated customer cookies are presented together', async () => {
    const borrower = await signIn('borrower', 'signup-borrower@sproutup.ph');
    const investor = await signIn('investor', 'signup-investor@sproutup.ph');
    const headers = new Headers({
      cookie: `${sessionCookie(borrower)}; ${sessionCookie(investor)}`,
    });
    await expect(customerAuth.getSession(headers)).resolves.toBeNull();
  });
});
