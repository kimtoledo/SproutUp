import { describe, expect, it } from 'vitest';
import { buildApp, type AppDependencies } from '../src/app.js';

const dependencies: AppDependencies = {
  config: { appOrigin: 'http://localhost:3000', environment: 'test' },
  checkDatabase: async () => undefined,
  auth: {
    baseUrl: 'http://localhost:3001',
    service: {
      handler: async () => Response.json({}),
      getSession: async () => null,
      resolveAuthorization: async () => null,
    },
    sessions: { listOwn: async () => [], revokeOwn: async () => false },
    roleAssignments: {
      listPending: async () => [],
      propose: async () => ({ ok: false as const, reason: 'target_not_found' as const }),
      approve: async () => ({ ok: false as const, reason: 'not_found' as const }),
    },
    roleRevocations: {
      listPending: async () => [],
      propose: async () => ({ ok: false as const, reason: 'target_not_found' as const }),
      approve: async () => ({ ok: false as const, reason: 'not_found' as const }),
    },
    catalogue: {
      listRoles: async () => [],
      listUsers: async ({ page, pageSize }) => ({ users: [], page, pageSize, total: 0 }),
    },
    approvalLifecycle: {
      reject: async () => ({ ok: false as const, reason: 'not_found' as const }),
      cancel: async () => ({ ok: false as const, reason: 'not_found' as const }),
    },
    approvalHistory: {
      list: async ({ page, pageSize }) => ({ approvals: [], page, pageSize, total: 0 }),
      detail: async () => null,
    },
  },
  onboarding: {
    cases: {
      listOwn: async () => [],
      detailOwn: async () => null,
      create: async () => ({ ok: false as const, reason: 'duplicate_open_case' as const }),
      submit: async () => ({ ok: false as const, reason: 'not_found' as const }),
    },
    review: {
      list: async ({ page, pageSize }) => ({ cases: [], page, pageSize, total: 0 }),
      detail: async () => null,
      startReview: async () => ({ ok: false as const, reason: 'not_found' as const }),
      requestInformation: async () => ({ ok: false as const, reason: 'not_found' as const }),
    },
  },
};

describe('OpenAPI contract generation', () => {
  it('publishes OpenAPI 3.1 and includes every implemented application route group', async () => {
    const app = await buildApp(dependencies);
    try {
      const response = await app.inject({ method: 'GET', url: '/openapi.json' });
      expect(response.statusCode).toBe(200);
      const document = response.json<{
        openapi: string;
        info: { title: string; version: string };
        paths: Record<string, unknown>;
        components: { securitySchemes: Record<string, unknown> };
      }>();

      expect(document.openapi).toBe('3.1.0');
      expect(document.info).toEqual(expect.objectContaining({ title: 'SproutUp API', version: '0.1.0' }));
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          '/health',
          '/v1/health',
          '/v1/session-context',
          '/v1/sessions',
          '/v1/admin/roles',
          '/v1/admin/users',
          '/v1/admin/role-assignments',
          '/v1/admin/role-revocations',
          '/v1/admin/role-approvals',
          '/v1/onboarding/cases',
          '/v1/onboarding/cases/{caseId}/submit',
          '/v1/admin/onboarding/cases',
          '/v1/admin/onboarding/cases/{caseId}/start-review',
          '/v1/admin/onboarding/cases/{caseId}/request-information',
        ]),
      );
      expect(document.components.securitySchemes).toHaveProperty('sessionCookie');
      expect(response.body).not.toMatch(/registration-test-secret|password-hash|session-token-value/i);
    } finally {
      await app.close();
    }
  });
});
