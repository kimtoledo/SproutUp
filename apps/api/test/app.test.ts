import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@sproutup/shared';
import { buildApp } from '../src/app.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('health routes', () => {
  it('reports process liveness without checking dependencies', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => {
        throw new Error('should not be called');
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows credentialed browser requests only from the configured origin', async () => {
    const app = await buildApp({
      config: {
        appOrigin: 'https://app.sproutup.ph',
        appOrigins: ['https://app.sproutup.ph', 'https://admin.sproutup.ph'],
        environment: 'test',
      },
      checkDatabase: async () => undefined,
    });
    apps.push(app);

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://app.sproutup.ph' },
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://example.invalid' },
    });
    const allowedAdmin = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://admin.sproutup.ph' },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.sproutup.ph');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowedAdmin.headers['access-control-allow-origin']).toBe('https://admin.sproutup.ph');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reports database readiness', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = healthResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.dependencies?.database).toBe('ok');
  });

  it('returns 503 when PostgreSQL is unavailable', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => {
        throw new Error('database unavailable');
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = healthResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(503);
    expect(body).toMatchObject({
      status: 'degraded',
      dependencies: { database: 'unavailable' },
    });
  });
});
