import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies safe local defaults around a required database URL', () => {
    expect(
      loadConfig({ DATABASE_URL: 'postgresql://sproutup:sproutup@localhost:5432/sproutup' }),
    ).toEqual({
      host: '0.0.0.0',
      port: 3001,
      appOrigin: 'http://localhost:3000',
      databaseUrl: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
      environment: 'development',
    });
  });

  it('fails closed when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('rejects an invalid application origin', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://sproutup:sproutup@localhost:5432/sproutup',
        APP_ORIGIN: 'not-a-url',
      }),
    ).toThrow();
  });
});
