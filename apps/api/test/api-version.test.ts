import { describe, expect, it } from 'vitest';
import { apiVersionHeaders } from '../src/openapi/api-version.js';
import { buildApp } from '../src/app.js';

describe('API version compatibility policy', () => {
  it('marks every versioned response without falsely deprecating current v1', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
    });
    try {
      const versioned = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(versioned.headers['sproutup-api-version']).toBe('1');
      expect(versioned.headers).not.toHaveProperty('deprecation');
      expect(versioned.headers).not.toHaveProperty('sunset');

      const unversioned = await app.inject({ method: 'GET', url: '/health' });
      expect(unversioned.headers).not.toHaveProperty('sproutup-api-version');
    } finally {
      await app.close();
    }
  });

  it('formats standards-based deprecation and sunset dates for a future retired version', () => {
    const headers = apiVersionHeaders({
      major: 1,
      pathPrefix: '/v1',
      status: 'deprecated',
      deprecationAt: new Date('2027-01-01T00:00:00.000Z'),
      sunsetAt: new Date('2027-07-01T00:00:00.000Z'),
    });

    expect(headers).toEqual({
      'SproutUp-API-Version': '1',
      Deprecation: '@1798761600',
      Sunset: 'Thu, 01 Jul 2027 00:00:00 GMT',
    });
  });

  it('rejects a sunset scheduled before deprecation', () => {
    expect(() => apiVersionHeaders({
      major: 1,
      pathPrefix: '/v1',
      status: 'deprecated',
      deprecationAt: new Date('2027-07-01T00:00:00.000Z'),
      sunsetAt: new Date('2027-01-01T00:00:00.000Z'),
    })).toThrow('API sunset cannot precede deprecation');
  });

  it('rejects a sunset with less than the compatibility notice period', () => {
    expect(() => apiVersionHeaders({
      major: 1,
      pathPrefix: '/v1',
      status: 'deprecated',
      deprecationAt: new Date('2027-01-01T00:00:00.000Z'),
      sunsetAt: new Date('2027-03-01T00:00:00.000Z'),
    })).toThrow('API sunset requires at least 180 days notice');
  });

  it('rejects invalid retirement dates before formatting headers', () => {
    expect(() => apiVersionHeaders({
      major: 1,
      pathPrefix: '/v1',
      status: 'deprecated',
      deprecationAt: new Date('invalid'),
    })).toThrow('API deprecation and sunset dates must be valid');
  });
});
