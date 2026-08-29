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
      authBaseUrl: 'http://localhost:3001',
      authSecret: 'test-secret-that-is-at-least-32-characters',
      databaseUrl: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
      environment: 'development',
      trustProxy: false,
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
});
