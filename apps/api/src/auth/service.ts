import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import type { Database } from '@sproutup/db';
import { schema } from '@sproutup/db';
import type { ApiConfig } from '../config.js';
import { createAuthorizationResolver } from './authorization.js';
import type { AuthServices, BetterAuthSession } from './types.js';

export function createAuthServices(config: ApiConfig, database: Database): AuthServices {
  const auth = betterAuth({
    appName: 'SproutUp',
    secret: config.authSecret,
    baseURL: config.authBaseUrl,
    basePath: '/v1/auth',
    trustedOrigins: [config.appOrigin],
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema,
      usePlural: true,
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
      useSecureCookies: config.environment === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.environment === 'production',
      },
    },
  });

  return {
    handler: auth.handler,
    getSession: async (headers) =>
      (await auth.api.getSession({ headers })) as BetterAuthSession | null,
    resolveAuthorization: createAuthorizationResolver(database),
  };
}
