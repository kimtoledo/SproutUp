import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { OnboardingCaseService } from '../src/onboarding/case-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const applicantId = '00000000-0000-4000-8000-000000000711';
const caseId = '00000000-0000-4000-8000-000000000712';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: applicantId, expiresAt: new Date() },
      user: { id: applicantId, email: 'borrower@sproutup.ph', name: 'Borrower' },
    }),
    resolveAuthorization: async () => ({
      user: { id: applicantId, email: 'borrower@sproutup.ph', name: 'Borrower' },
      roles: ['sme_borrower'],
      permissions,
    }),
  };
}

function caseService(overrides: Partial<OnboardingCaseService> = {}): OnboardingCaseService {
  return {
    listOwn: async () => [],
    detailOwn: async () => null,
    create: async () => ({ ok: false, reason: 'duplicate_open_case' }),
    submit: async () => ({ ok: false, reason: 'not_found' }),
    ...overrides,
  };
}

describe('own onboarding case routes', () => {
  it('does not allow borrower capability to open an investor journey', async () => {
    const create = vi.fn<OnboardingCaseService['create']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['borrower_onboarding.manage_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: { cases: caseService({ create }) },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/onboarding/cases',
        payload: { caseType: 'investor' },
      });
      expect(response.statusCode).toBe(403);
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('passes the authenticated owner and expected version into submission', async () => {
    const submit = vi.fn<OnboardingCaseService['submit']>().mockResolvedValue({
      ok: true,
      case: {
        id: caseId,
        caseType: 'borrower',
        status: 'submitted',
        version: 2,
        assignedReviewerUserId: null,
        submittedAt: new Date(),
        decidedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['borrower_onboarding.submit_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: { cases: caseService({ submit }) },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/cases/${caseId}/submit`,
        payload: { version: 1 },
      });
      expect(response.statusCode).toBe(200);
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          applicantUserId: applicantId,
          allowedCaseTypes: ['borrower'],
          caseId,
          expectedVersion: 1,
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('returns a stable conflict for stale client state', async () => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['borrower_onboarding.submit_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: {
        cases: caseService({ submit: async () => ({ ok: false, reason: 'stale_version' }) }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/cases/${caseId}/submit`,
        payload: { version: 1 },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'STALE_CASE_VERSION' } });
    } finally {
      await app.close();
    }
  });
});
