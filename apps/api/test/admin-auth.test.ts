import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { buildApp } from '../src/app.js';
import {
  createAdminAuthServices,
  createBorrowerAuthServices,
  createCustomerAuthServices,
  createInvestorAuthServices,
} from '../src/auth/service.js';
import { provisionInitialAdmin } from '../src/auth/provision-initial-admin.js';
import type { ApiConfig } from '../src/config.js';
import { createInMemoryEmailDelivery } from '../src/notifications/email-delivery.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const config: ApiConfig = {
  host: '127.0.0.1',
  port: 3001,
  appOrigin: 'http://admin.lvh.me:3000',
  appOrigins: [
    'http://admin.lvh.me:3000',
    'http://borrower.lvh.me:3000',
  ],
  authCookieDomain: '.lvh.me',
  authBaseUrl: 'http://api.lvh.me:3001',
  authSecret: 'admin-boundary-test-secret-at-least-32-characters',
  databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
  environment: 'test',
  trustProxy: false,
  emailOutboxDir: '.data/test-email-outbox',
  documentStorageDir: '.data/test-documents',
};

const emailDelivery = createInMemoryEmailDelivery();
const adminAuth = createAdminAuthServices(config, orm, emailDelivery);
const borrowerAuth = createBorrowerAuthServices(config, orm, emailDelivery);
const investorAuth = createInvestorAuthServices(config, orm, emailDelivery);
const customerAuth = createCustomerAuthServices(orm, borrowerAuth, investorAuth);

function authRequest(path: string, body: Record<string, unknown>, origin = config.appOrigin) {
  return new Request(`${config.authBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.roles).values({
    key: 'super_admin', name: 'Super Admin', category: 'staff',
  });
  await orm.insert(schema.permissions).values({
    key: 'users.read',
    description: 'Read users',
  });
  await orm.insert(schema.rolePermissions).values({
    roleKey: 'super_admin',
    permissionKey: 'users.read',
  });

  const signup = await adminAuth.handler(authRequest('/v1/auth/admin/sign-up/email', {
    name: 'Controlled Admin',
    email: 'controlled-admin@sproutup.ph',
    password: 'correct-horse-battery-staple',
  }));
  expect(signup.status).toBe(200);

  const [admin] = await orm
    .select({ id: schema.adminAccounts.id })
    .from(schema.adminAccounts)
    .where(eq(schema.adminAccounts.email, 'controlled-admin@sproutup.ph'));
  if (!admin) throw new Error('Admin setup failed');

  await orm.insert(schema.adminRoleGrants).values({
    adminAccountId: admin.id,
    roleKey: 'super_admin',
  });

  const customerSignup = await borrowerAuth.handler(authRequest('/v1/auth/borrower/sign-up/email', {
    name: 'Borrower Only',
    email: 'borrower-only@sproutup.ph',
    password: 'correct-horse-battery-staple',
  }, 'http://borrower.lvh.me:3000'));
  expect(customerSignup.status).toBe(200);
});

afterAll(async () => {
  await pglite.close();
});

describe('isolated administrator authentication', () => {
  it('provisions the initial Super Admin without creating legacy auth material', async () => {
    const input = {
      name: 'Initial Operator',
      email: 'initial-operator@sproutup.ph',
      password: 'correct-horse-battery-staple',
    };
    await expect(provisionInitialAdmin(config, orm, input)).resolves.toMatchObject({
      accountStatus: 'created',
      roleStatus: 'granted',
    });
    await expect(provisionInitialAdmin(config, orm, input)).resolves.toMatchObject({
      accountStatus: 'existing',
      roleStatus: 'already_super_admin',
    });
    const [admin] = await orm
      .select({ id: schema.adminAccounts.id })
      .from(schema.adminAccounts)
      .where(eq(schema.adminAccounts.email, input.email));
    const legacyCredentials = admin
      ? await orm
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(eq(schema.accounts.userId, admin.id))
      : [];
    const grants = admin
      ? await orm
          .select({ roleKey: schema.adminRoleGrants.roleKey })
          .from(schema.adminRoleGrants)
          .where(eq(schema.adminRoleGrants.adminAccountId, admin.id))
      : [];
    expect(legacyCredentials).toHaveLength(0);
    expect(grants).toContainEqual({ roleKey: 'super_admin' });
  });

  it('blocks public admin signup at the HTTP boundary', async () => {
    const app = await buildApp({
      config,
      checkDatabase: async () => undefined,
      auth: {
        service: customerAuth,
        adminService: adminAuth,
        borrowerService: borrowerAuth,
        investorService: investorAuth,
        baseUrl: config.authBaseUrl,
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/admin/sign-up/email',
        headers: { origin: config.appOrigin },
        payload: {
          name: 'Public Admin',
          email: 'public-admin@sproutup.ph',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'ADMIN_SIGNUP_DISABLED' } });
    } finally {
      await app.close();
    }
  });

  it('uses an admin-specific cookie and resolves only staff authorization', async () => {
    const app = await buildApp({
      config,
      checkDatabase: async () => undefined,
      auth: {
        service: customerAuth,
        adminService: adminAuth,
        borrowerService: borrowerAuth,
        investorService: investorAuth,
        baseUrl: config.authBaseUrl,
      },
    });
    try {
      const signIn = await app.inject({
        method: 'POST',
        url: '/v1/auth/admin/sign-in/email',
        headers: { origin: config.appOrigin },
        payload: {
          email: 'controlled-admin@sproutup.ph',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(signIn.statusCode).toBe(200);
      const setCookie = String(signIn.headers['set-cookie']);
      expect(setCookie).toContain('sproutup_admin.session_token');
      expect(setCookie).toContain('Domain=.lvh.me');

      const context = await app.inject({
        method: 'GET',
        url: '/v1/admin/session-context',
        headers: { cookie: setCookie.split(';', 1)[0] },
      });
      expect(context.statusCode).toBe(200);
      expect(context.json()).toMatchObject({
        data: { roles: ['super_admin'], permissions: ['users.read'] },
      });
    } finally {
      await app.close();
    }
  });

  it('does not accept a borrower credential on the admin sign-in endpoint', async () => {
    const app = await buildApp({
      config,
      checkDatabase: async () => undefined,
      auth: {
        service: customerAuth,
        adminService: adminAuth,
        borrowerService: borrowerAuth,
        investorService: investorAuth,
        baseUrl: config.authBaseUrl,
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/admin/sign-in/email',
        headers: { origin: config.appOrigin },
        payload: {
          email: 'borrower-only@sproutup.ph',
          password: 'correct-horse-battery-staple',
        },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
