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
    });
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
