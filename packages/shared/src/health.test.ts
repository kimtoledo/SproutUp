import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a ready API response', () => {
    const response = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      dependencies: { database: 'ok' },
    });

    expect(response.dependencies?.database).toBe('ok');
  });

  it('rejects an unknown dependency status', () => {
    expect(() =>
      healthResponseSchema.parse({
        status: 'degraded',
        service: 'api',
        timestamp: new Date().toISOString(),
        dependencies: { database: 'maybe' },
      }),
    ).toThrow();
  });
});
