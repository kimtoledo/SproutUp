import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { eq } from 'drizzle-orm';
import type { Database } from '@sproutup/db';
import { schema } from '@sproutup/db';
import type { ApiConfig } from '../config.js';
import {
  createAdminAuthorizationResolver,
  createCustomerAuthorizationResolver,
} from './authorization.js';
import type { AuthServices, BetterAuthSession } from './types.js';

function createPortalAuthServices(
  config: ApiConfig,
  database: Database,
  accountType: 'borrower' | 'investor',
): AuthServices {
  const borrower = accountType === 'borrower';
  const auth = betterAuth({
    appName: borrower ? 'SproutUp for Business' : 'SproutUp Invest',
    secret: config.authSecret,
    baseURL: config.authBaseUrl,
    basePath: `/v1/auth/${accountType}`,
    trustedOrigins: config.appOrigins,
    // Vendor errors may contain SQL parameters. Fastify owns sanitized request
    // telemetry, so the adapter logger must never print identity/credential data.
    logger: { disabled: true },
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: borrower ? schema.borrowerAuthSchema : schema.investorAuthSchema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    verification: {
      storeIdentifier: 'hashed',
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: borrower ? 'sproutup_borrower' : 'sproutup_investor',
      useSecureCookies: config.environment === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.environment === 'production',
      },
      ...(config.authCookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: config.authCookieDomain } }
        : {}),
      // The Fastify boundary resolves the client IP (honouring API_TRUST_PROXY)
      // and forwards it on this header. Without this, Better Auth cannot key its
      // sign-in/sign-up rate limits per client and falls back to one shared
      // global bucket, so a handful of failures locks out every user.
      ipAddress: {
        ipAddressHeaders: ['x-sproutup-client-ip'],
      },
    },
  });

  return {
    async handler(request) {
      const pathname = new URL(request.url).pathname;
      if (request.method === 'POST' && pathname.endsWith('/sign-up/email')) {
        const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (email) {
          const [existing] = await database
            .select({ accountId: schema.accountEmailRegistry.accountId })
            .from(schema.accountEmailRegistry)
            .where(eq(schema.accountEmailRegistry.email, email))
            .limit(1);
          if (existing) {
            return Response.json(
              { code: 'ACCOUNT_CREATION_FAILED', message: 'Account could not be created' },
              { status: 422 },
            );
          }
        }
      }
      return auth.handler(request);
    },
    getSession: async (headers) =>
      (await auth.api.getSession({ headers })) as BetterAuthSession | null,
    resolveAuthorization: createCustomerAuthorizationResolver(database, accountType),
  };
}

export function createBorrowerAuthServices(config: ApiConfig, database: Database): AuthServices {
  return createPortalAuthServices(config, database, 'borrower');
}

export function createInvestorAuthServices(config: ApiConfig, database: Database): AuthServices {
  return createPortalAuthServices(config, database, 'investor');
}

/**
 * Protected customer operations accept exactly one isolated portal session.
 * If both cookies are present, fail closed instead of choosing an identity.
 */
export function createCustomerAuthServices(
  database: Database,
  borrowerAuth: AuthServices,
  investorAuth: AuthServices,
): AuthServices {
  const borrowerResolver = createCustomerAuthorizationResolver(database, 'borrower');
  const investorResolver = createCustomerAuthorizationResolver(database, 'investor');
  return {
    handler: async () => Response.json({ error: 'Not found' }, { status: 404 }),
    async getSession(headers) {
      const [borrower, investor] = await Promise.all([
        borrowerAuth.getSession(headers),
        investorAuth.getSession(headers),
      ]);
      return borrower && !investor ? borrower : investor && !borrower ? investor : null;
    },
    async resolveAuthorization(userId) {
      const [borrower, investor] = await Promise.all([
        borrowerResolver(userId),
        investorResolver(userId),
      ]);
      return borrower && !investor ? borrower : investor && !borrower ? investor : null;
    },
  };
}

export function createAdminAuthServices(config: ApiConfig, database: Database): AuthServices {
  const auth = betterAuth({
    appName: 'SproutUp Admin',
    secret: config.authSecret,
    baseURL: config.authBaseUrl,
    basePath: '/v1/auth/admin',
    trustedOrigins: config.appOrigins,
    logger: { disabled: true },
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: schema.adminAuthSchema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
    },
    verification: { storeIdentifier: 'hashed' },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'sproutup_admin',
      useSecureCookies: config.environment === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.environment === 'production',
      },
      ...(config.authCookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: config.authCookieDomain } }
        : {}),
      ipAddress: { ipAddressHeaders: ['x-sproutup-client-ip'] },
    },
  });

  return {
    handler: auth.handler,
    getSession: async (headers) =>
      (await auth.api.getSession({ headers })) as BetterAuthSession | null,
    resolveAuthorization: createAdminAuthorizationResolver(database),
  };
}
