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
      withdraw: async () => ({ ok: false as const, reason: 'not_found' as const }),
      reopen: async () => ({ ok: false as const, reason: 'not_found' as const }),
      eligibility: async (_userId: string, journey: 'borrower' | 'investor') => ({
        journey,
        status: 'none' as const,
        caseId: null,
        decidedAt: null,
      }),
    },
    review: {
      list: async ({ page, pageSize }) => ({ cases: [], page, pageSize, total: 0 }),
      detail: async () => null,
      startReview: async () => ({ ok: false as const, reason: 'not_found' as const }),
      requestInformation: async () => ({ ok: false as const, reason: 'not_found' as const }),
      reject: async () => ({ ok: false as const, reason: 'not_found' as const }),
      approve: async () => ({ ok: false as const, reason: 'not_found' as const }),
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
        paths: Record<string, Record<string, {
          operationId?: string;
          security?: Array<Record<string, unknown>>;
          parameters?: Array<{ name?: string; in?: string }>;
          requestBody?: Record<string, unknown>;
          responses?: Record<string, unknown>;
          'x-sproutup'?: {
            actor?: string;
            permissions?: string[];
            permissionMode?: string;
            retryModel?: string;
            sideEffects?: string[];
            auditEvent?: string | null;
          };
        }>>;
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
          '/v1/onboarding/cases/{caseId}/withdraw',
          '/v1/admin/onboarding/cases',
          '/v1/admin/onboarding/cases/{caseId}/start-review',
          '/v1/admin/onboarding/cases/{caseId}/request-information',
          '/v1/admin/onboarding/cases/{caseId}/reject',
        ]),
      );
      expect(document.components.securitySchemes).toHaveProperty('sessionCookie');
      expect(response.body).not.toMatch(/registration-test-secret|password-hash|session-token-value/i);

      const contractedOperations = [
        ['/v1/session-context', 'get', 'getSessionContext'],
        ['/v1/sessions', 'get', 'listOwnSessions'],
        ['/v1/sessions/{sessionId}', 'delete', 'revokeOwnSession'],
        ['/v1/admin/roles', 'get', 'listRoleCatalogue'],
        ['/v1/admin/users', 'get', 'listUserAccessCatalogue'],
        ['/v1/admin/role-assignments', 'get', 'listPendingRoleAssignments'],
        ['/v1/admin/role-assignments', 'post', 'proposeRoleAssignment'],
        [
          '/v1/admin/role-assignments/{approvalId}/approve',
          'post',
          'approveRoleAssignment',
        ],
        ['/v1/admin/role-revocations', 'get', 'listPendingRoleRevocations'],
        ['/v1/admin/role-revocations', 'post', 'proposeRoleRevocation'],
        [
          '/v1/admin/role-revocations/{approvalId}/approve',
          'post',
          'approveRoleRevocation',
        ],
        ['/v1/admin/role-approvals/{approvalId}/reject', 'post', 'rejectRoleApproval'],
        ['/v1/admin/role-approvals/{approvalId}/cancel', 'post', 'cancelRoleApproval'],
        ['/v1/admin/role-approvals', 'get', 'listRoleApprovalHistory'],
        ['/v1/admin/role-approvals/{approvalId}', 'get', 'getRoleApprovalHistory'],
        ['/v1/onboarding/cases', 'get', 'listOwnOnboardingCases'],
        ['/v1/onboarding/cases/{caseId}', 'get', 'getOwnOnboardingCase'],
        ['/v1/onboarding/cases', 'post', 'createOwnOnboardingCase'],
        ['/v1/onboarding/cases/{caseId}/submit', 'post', 'submitOwnOnboardingCase'],
        ['/v1/onboarding/cases/{caseId}/withdraw', 'post', 'withdrawOwnOnboardingCase'],
        ['/v1/onboarding/cases/{caseId}/reopen', 'post', 'reopenOwnOnboardingCase'],
        ['/v1/admin/onboarding/cases', 'get', 'listOnboardingReviewQueue'],
        ['/v1/admin/onboarding/cases/{caseId}', 'get', 'getOnboardingReviewCase'],
        ['/v1/admin/onboarding/cases/{caseId}/start-review', 'post', 'startOnboardingReview'],
        [
          '/v1/admin/onboarding/cases/{caseId}/request-information',
          'post',
          'requestOnboardingInformation',
        ],
        ['/v1/admin/onboarding/cases/{caseId}/reject', 'post', 'rejectOnboardingCase'],
        ['/v1/admin/onboarding/cases/{caseId}/approve', 'post', 'approveOnboardingCase'],
      ] as const;

      for (const [path, method, operationId] of contractedOperations) {
        const operation = document.paths[path]?.[method];
        expect(operation?.operationId).toBe(operationId);
        expect(operation?.security).toEqual([{ sessionCookie: [] }]);
        expect(operation?.['x-sproutup']).toEqual(
          expect.objectContaining({
            actor: expect.any(String),
            permissions: expect.any(Array),
            permissionMode: expect.stringMatching(/^(any|all)$/),
            retryModel: expect.stringMatching(
              /^(safe_read|idempotent_delete|unique_open_case|unique_pending_approval|locked_approval_decision|optimistic_version)$/,
            ),
            sideEffects: expect.any(Array),
          }),
        );
        expect(operation?.['x-sproutup']).toHaveProperty('auditEvent');
        expect(operation?.responses).toBeDefined();
        const expectedResponses: Array<string | ReturnType<typeof expect.stringMatching>> = [
          expect.stringMatching(/^20[014]$/),
          '401',
        ];
        if ((operation?.['x-sproutup']?.permissions?.length ?? 0) > 0) {
          expectedResponses.push('403');
        }
        expect(Object.keys(operation?.responses ?? {})).toEqual(
          expect.arrayContaining(expectedResponses),
        );
        if (method === 'post') expect(operation?.requestBody).toBeDefined();
        if (path.includes('{caseId}')) {
          expect(operation?.parameters).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: 'caseId', in: 'path' })]),
          );
        }
        if (path.includes('{sessionId}')) {
          expect(operation?.parameters).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: 'sessionId', in: 'path' })]),
          );
        }
        if (path.includes('{approvalId}')) {
          expect(operation?.parameters).toEqual(
            expect.arrayContaining([expect.objectContaining({ name: 'approvalId', in: 'path' })]),
          );
        }
      }

      expect(document.paths['/health']?.get).toEqual(
        expect.objectContaining({
          operationId: 'getLiveness',
          security: [],
          'x-sproutup': expect.objectContaining({ actor: 'public', permissions: [] }),
        }),
      );
      expect(document.paths['/v1/health']?.get).toEqual(
        expect.objectContaining({
          operationId: 'getReadiness',
          security: [],
          'x-sproutup': expect.objectContaining({ actor: 'public', permissions: [] }),
        }),
      );

      const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
      for (const [path, pathItem] of Object.entries(document.paths)) {
        if (path.startsWith('/v1/auth/')) continue;
        for (const [method, documentedOperation] of Object.entries(pathItem)) {
          if (!httpMethods.has(method)) continue;
          expect(documentedOperation.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
          expect(documentedOperation.responses, `${method.toUpperCase()} ${path}`).toBeDefined();
          expect(documentedOperation['x-sproutup'], `${method.toUpperCase()} ${path}`).toEqual(
            expect.objectContaining({
              actor: expect.stringMatching(/^(public|authenticated_user|authenticated_customer|staff)$/),
              permissions: expect.any(Array),
              permissionMode: expect.stringMatching(/^(any|all)$/),
              retryModel: expect.any(String),
              sideEffects: expect.any(Array),
            }),
          );
          expect(documentedOperation['x-sproutup']).toHaveProperty('auditEvent');
        }
      }
    } finally {
      await app.close();
    }
  });
});
