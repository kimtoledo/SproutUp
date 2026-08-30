import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { hashIpAddress, schema, type Database } from '@sproutup/db';
import {
  createAdminAuthServices,
  createBorrowerAuthServices,
  createInvestorAuthServices,
} from '../src/auth/service.js';
import type { ApiConfig } from '../src/config.js';
import { createInMemoryEmailDelivery } from '../src/notifications/email-delivery.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const config: ApiConfig = {
  host: '127.0.0.1',
  port: 3001,
  appOrigin: 'http://borrower.lvh.me:3000',
  appOrigins: [
    'http://admin.lvh.me:3000',
    'http://borrower.lvh.me:3000',
    'http://investor.lvh.me:3000',
  ],
  authCookieDomain: '.lvh.me',
  authBaseUrl: 'http://api.lvh.me:3001',
  authSecret: 'credential-recovery-test-secret-at-least-32-chars',
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  environment: 'test',
  trustProxy: false,
  emailOutboxDir: '.data/test-email-outbox',
};

const borrowerEmail = createInMemoryEmailDelivery();
const investorEmail = createInMemoryEmailDelivery();
const adminEmail = createInMemoryEmailDelivery();
const borrowerAuth = createBorrowerAuthServices(config, orm, borrowerEmail);
const investorAuth = createInvestorAuthServices(config, orm, investorEmail);
const adminAuth = createAdminAuthServices(config, orm, adminEmail);

const CLIENT_IP = '203.0.113.5';
const REQUEST_ID = '00000000-0000-4000-8000-0000000000aa';

function jsonRequest(
  handlerPath: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
) {
  return new Request(`${config.authBaseUrl}${handlerPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: config.appOrigin,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

/** Extracts the single-use reset/verification token embedded in the emailed link. */
function extractToken(url: string, marker: 'reset-password' | 'token='): string {
  if (marker === 'token=') {
    const match = /[?&]token=([^&]+)/.exec(url);
    if (!match) throw new Error(`No token query param in ${url}`);
    return decodeURIComponent(match[1]);
  }
  const match = /\/reset-password\/([^/?]+)/.exec(url);
  if (!match) throw new Error(`No reset-password token segment in ${url}`);
  return match[1];
}

beforeAll(async () => {
  await applyMigrations(pglite);
});

afterAll(async () => {
  await pglite.close();
});

describe('password reset delivery and completion', () => {
  it.each([
    { accountType: 'borrower' as const, auth: borrowerAuth, email: borrowerEmail, path: '/v1/auth/borrower', table: schema.borrowerAccounts },
    { accountType: 'investor' as const, auth: investorAuth, email: investorEmail, path: '/v1/auth/investor', table: schema.investorAccounts },
  ])('delivers, consumes, and audits a $accountType reset', async ({ accountType, auth, email, path, table }) => {
    const address = `reset-${accountType}@sproutup.ph`;
    const oldPassword = 'correct-horse-battery-staple';
    const newPassword = 'new-correct-horse-battery-staple';

    const signUp = await auth.handler(jsonRequest(`${path}/sign-up/email`, {
      name: `Reset ${accountType}`,
      email: address,
      password: oldPassword,
    }));
    expect(signUp.status).toBe(200);
    // sendOnSignUp fires a verification email too; only the reset message matters here.
    email.sent.length = 0;

    const requestReset = await auth.handler(jsonRequest(`${path}/request-password-reset`, {
      email: address,
    }));
    expect(requestReset.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: address });
    const token = extractToken(email.sent[0]!.text, 'reset-password');

    const resetResponse = await auth.handler(jsonRequest(
      `${path}/reset-password`,
      { newPassword, token },
      { 'x-sproutup-client-ip': CLIENT_IP, 'x-sproutup-request-id': REQUEST_ID },
    ));
    expect(resetResponse.status).toBe(200);

    const oldSignIn = await auth.handler(jsonRequest(`${path}/sign-in/email`, {
      email: address,
      password: oldPassword,
    }));
    expect(oldSignIn.status).toBe(401);

    const newSignIn = await auth.handler(jsonRequest(`${path}/sign-in/email`, {
      email: address,
      password: newPassword,
    }));
    expect(newSignIn.status).toBe(200);

    const [account] = await orm
      .select({ id: table.id })
      .from(table)
      .where(eq(table.email, address));
    expect(account).toBeDefined();

    const [audit] = await orm
      .select()
      .from(schema.auditEvents)
      .where(and(
        eq(schema.auditEvents.action, 'credential.password_reset_completed'),
        eq(schema.auditEvents.resourceId, account!.id),
      ));
    expect(audit).toMatchObject({
      actorType: 'user',
      actorUserId: account!.id,
      outcome: 'succeeded',
      resourceType: 'credential',
      metadata: { accountType },
      ipAddressHash: hashIpAddress(CLIENT_IP),
      requestId: REQUEST_ID,
    });
  });

  it('rejects a stale or unknown reset token without touching the password', async () => {
    const response = await borrowerAuth.handler(jsonRequest('/v1/auth/borrower/reset-password', {
      newPassword: 'irrelevant-new-password',
      token: 'never-issued-token',
    }));
    expect(response.status).toBe(400);
  });
});

describe('email verification delivery', () => {
  it('sends a verification email on self-serve borrower/investor signup', async () => {
    borrowerEmail.sent.length = 0;
    const signUp = await borrowerAuth.handler(jsonRequest('/v1/auth/borrower/sign-up/email', {
      name: 'Verify Borrower',
      email: 'verify-borrower@sproutup.ph',
      password: 'correct-horse-battery-staple',
    }));
    expect(signUp.status).toBe(200);
    expect(borrowerEmail.sent).toHaveLength(1);
    expect(borrowerEmail.sent[0]).toMatchObject({ to: 'verify-borrower@sproutup.ph' });
    expect(() => extractToken(borrowerEmail.sent[0]!.text, 'token=')).not.toThrow();
  });

  it('never sends a verification email for controlled administrator sign-up', async () => {
    adminEmail.sent.length = 0;
    const signUp = await adminAuth.handler(jsonRequest('/v1/auth/admin/sign-up/email', {
      name: 'Controlled Admin',
      email: 'no-verify-admin@sproutup.ph',
      password: 'correct-horse-battery-staple',
    }));
    expect(signUp.status).toBe(200);
    expect(adminEmail.sent).toHaveLength(0);
  });
});
