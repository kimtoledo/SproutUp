import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { OnboardingReviewService } from '../src/onboarding/review-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const reviewerId = '00000000-0000-4000-8000-000000000811';
const caseId = '00000000-0000-4000-8000-000000000812';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: reviewerId, expiresAt: new Date() },
      user: { id: reviewerId, email: 'compliance@sproutup.ph', name: 'Compliance' },
    }),
    resolveAuthorization: async () => ({
      user: { id: reviewerId, email: 'compliance@sproutup.ph', name: 'Compliance' },
      roles: ['compliance_officer'],
      permissions,
    }),
  };
}

function reviewService(overrides: Partial<OnboardingReviewService> = {}): OnboardingReviewService {
  return {
    list: async ({ page, pageSize }) => ({ cases: [], page, pageSize, total: 0 }),
    startReview: async () => ({ ok: false, reason: 'not_found' }),
    requestInformation: async () => ({ ok: false, reason: 'not_found' }),
    ...overrides,
  };
}

const ownCases = {
  listOwn: async () => [],
  detailOwn: async () => null,
  create: async () => ({ ok: false as const, reason: 'duplicate_open_case' as const }),
  submit: async () => ({ ok: false as const, reason: 'not_found' as const }),
};

describe('onboarding review routes', () => {
  it('requires queue read permission independently from review permission', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['onboarding_cases.review']), baseUrl: 'http://localhost:3001' },
      onboarding: { cases: ownCases, review: reviewService() },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/onboarding/cases' });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('scopes assigned-to-me queue filters to the authenticated reviewer', async () => {
    const list = vi.fn<OnboardingReviewService['list']>().mockResolvedValue({
      cases: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['onboarding_cases.read']), baseUrl: 'http://localhost:3001' },
      onboarding: { cases: ownCases, review: reviewService({ list }) },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/onboarding/cases?assignedToMe=true',
      });
      expect(response.statusCode).toBe(200);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ reviewerUserId: reviewerId }));
    } finally {
      await app.close();
    }
  });

  it('maps reviewer takeover to a stable conflict', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['onboarding_cases.review']), baseUrl: 'http://localhost:3001' },
      onboarding: {
        cases: ownCases,
        review: reviewService({ startReview: async () => ({ ok: false, reason: 'assigned_to_other' }) }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/onboarding/cases/${caseId}/start-review`,
        payload: { version: 2 },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'CASE_ASSIGNED_TO_OTHER' } });
    } finally {
      await app.close();
    }
  });

  it('maps information requests from an unassigned reviewer to a stable denial', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions(['onboarding_cases.review']), baseUrl: 'http://localhost:3001' },
      onboarding: {
        cases: ownCases,
        review: reviewService({
          requestInformation: async () => ({ ok: false, reason: 'not_assigned_reviewer' }),
        }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/onboarding/cases/${caseId}/request-information`,
        payload: { version: 3, reason: 'Please provide clearer supporting evidence' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_ASSIGNED_REVIEWER' } });
    } finally {
      await app.close();
    }
  });
});
