import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies safe local defaults around a required database URL', () => {
    expect(
      loadConfig({
        DATABASE_URL: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
        BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 3001,
      appOrigin: 'http://localhost:3000',
      appOrigins: ['http://localhost:3000'],
      authCookieDomain: undefined,
      authBaseUrl: 'http://localhost:3001',
      authSecret: 'test-secret-that-is-at-least-32-characters',
      databaseUrl: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
      environment: 'development',
      trustProxy: false,
      emailOutboxDir: '.data/email-outbox',
      documentStorageDir: '.data/documents',
    });
  });

  it('parses API_TRUST_PROXY into a Fastify trustProxy value', () => {
    const base = {
      DATABASE_URL: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
      BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
    };
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, API_TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, API_TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(
      loadConfig({ ...base, API_TRUST_PROXY: '10.0.0.0/8, 172.16.0.1' }).trustProxy,
    ).toEqual(['10.0.0.0/8', '172.16.0.1']);
  });

  it('fails closed when DATABASE_URL is missing', () => {
    expect(() =>
      loadConfig({ BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters' }),
    ).toThrow();
  });

  it('fails closed when the authentication secret is missing', () => {
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgresql://sproutup:sproutup@localhost:5432/sproutup' }),
    ).toThrow();
  });

  it('rejects an invalid application origin', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
        BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
        APP_ORIGIN: 'not-a-url',
      }),
    ).toThrow();
  });

  it('accepts and deduplicates portal origins for subdomain CORS and trusted origins', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
      BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
      APP_ORIGIN: 'http://admin.lvh.me:3000',
      APP_ORIGINS: 'http://admin.lvh.me:3000,http://borrower.lvh.me:3000,http://investor.lvh.me:3000',
      AUTH_COOKIE_DOMAIN: '.lvh.me',
    });

    expect(config.appOrigins).toEqual([
      'http://admin.lvh.me:3000',
      'http://borrower.lvh.me:3000',
      'http://investor.lvh.me:3000',
    ]);
    expect(config.authCookieDomain).toBe('.lvh.me');
  });
});
