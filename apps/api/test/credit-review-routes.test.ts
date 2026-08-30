import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { CreditReviewService } from '../src/credit/review-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const reviewerId = '00000000-0000-4000-8000-000000000d11';
const applicationId = '00000000-0000-4000-8000-000000000d12';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: reviewerId, expiresAt: new Date() },
      user: { id: reviewerId, email: 'analyst@sproutup.ph', name: 'Analyst' },
    }),
    resolveAuthorization: async () => ({
      accountType: 'admin',
      user: { id: reviewerId, email: 'analyst@sproutup.ph', name: 'Analyst' },
      roles: ['credit_analyst'],
      permissions,
    }),
  };
}

function reviewService(overrides: Partial<CreditReviewService> = {}): CreditReviewService {
  return {
    list: async ({ page, pageSize }) => ({ applications: [], page, pageSize, total: 0 }),
    detail: async () => null,
    startReview: async () => ({ ok: false, reason: 'not_found' }),
    requestInformation: async () => ({ ok: false, reason: 'not_found' }),
    recommend: async () => ({ ok: false, reason: 'not_found' }),
    approve: async () => ({ ok: false, reason: 'not_found' }),
    reject: async () => ({ ok: false, reason: 'not_found' }),
    ...overrides,
  };
}

const sampleApplication = {
  id: applicationId,
  borrowerCaseId: '00000000-0000-4000-8000-000000000d13',
  status: 'in_review' as const,
  version: 2,
  requestedAmount: '500000.00',
  termMonths: 12,
  purpose: 'Working capital',
  industry: null,
  companyEmployees: null,
  ownershipDate: null,
  isAudited: false,
  lastYear1SalesRevenue: null,
  lastYear1GrossProfit: null,
  lastYear1NetProfit: null,
  lastYear2SalesRevenue: null,
  lastYear2GrossProfit: null,
  lastYear2NetProfit: null,
  bankruptcyHistory: false,
  bankruptcyDischarged: null,
  bankruptcyYear: null,
  assignedAnalystUserId: reviewerId,
  recommendationNarrative: null,
  recommendedAmount: null,
  recommendedTermMonths: null,
  recommendedByUserId: null,
  recommendedAt: null,
  decidedByUserId: null,
  decidedAt: null,
  decisionReason: null,
  approvedAmount: null,
  approvedTermMonths: null,
  submittedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildTestApp(auth: AuthServices, review: CreditReviewService) {
  return buildApp({
    config: { appOrigin: 'http://localhost:3000', environment: 'test' },
    checkDatabase: async () => undefined,
    auth: { service: auth, baseUrl: 'http://localhost:3001' },
    credit: {
      applications: {
        listOwn: async () => [],
        detailOwn: async () => null,
        saveOwn: async () => ({ ok: false, reason: 'application_not_found' }),
        submit: async () => ({ ok: false, reason: 'application_not_found' }),
        withdraw: async () => ({ ok: false, reason: 'application_not_found' }),
        reopen: async () => ({ ok: false, reason: 'application_not_found' }),
      },
      review,
    },
  });
}

describe('credit underwriting review routes', () => {
  it('requires queue read permission independently from review permission', async () => {
    const app = await buildTestApp(authWithPermissions(['credit_applications.review']), reviewService());
    try {
      const response = await app.inject({ method: 'GET', url: '/v1/admin/credit/applications' });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('scopes assigned-to-me queue filters to the authenticated analyst', async () => {
    const list = vi.fn<CreditReviewService['list']>().mockResolvedValue({
      applications: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    const app = await buildTestApp(authWithPermissions(['credit_applications.read']), reviewService({ list }));
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/credit/applications?assignedToMe=true',
      });
      expect(response.statusCode).toBe(200);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ analystUserId: reviewerId }));
    } finally {
      await app.close();
    }
  });

  it('starts review with the authenticated analyst', async () => {
    const startReview = vi.fn<CreditReviewService['startReview']>().mockResolvedValue({
      ok: true,
      application: sampleApplication,
    });
    const app = await buildTestApp(authWithPermissions(['credit_applications.review']), reviewService({ startReview }));
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/start-review`,
        payload: { version: 1 },
      });
      expect(response.statusCode).toBe(200);
      expect(startReview).toHaveBeenCalledWith(expect.objectContaining({ reviewerUserId: reviewerId, expectedVersion: 1 }));
    } finally {
      await app.close();
    }
  });

  it('requires the recommend capability and passes the narrative through', async () => {
    const recommend = vi.fn<CreditReviewService['recommend']>();
    const withoutPermission = await buildTestApp(authWithPermissions([]), reviewService({ recommend }));
    try {
      const denied = await withoutPermission.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/recommend`,
        payload: { version: 2, recommendationNarrative: 'Financials look sound.' },
      });
      expect(denied.statusCode).toBe(403);
      expect(recommend).not.toHaveBeenCalled();
    } finally {
      await withoutPermission.close();
    }

    recommend.mockResolvedValue({ ok: true, application: { ...sampleApplication, status: 'recommended' } });
    const withPermission = await buildTestApp(
      authWithPermissions(['credit_applications.recommend']),
      reviewService({ recommend }),
    );
    try {
      const response = await withPermission.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/recommend`,
        payload: { version: 2, recommendationNarrative: 'Financials look sound.' },
      });
      expect(response.statusCode).toBe(200);
      expect(recommend).toHaveBeenCalledWith(expect.objectContaining({
        reviewerUserId: reviewerId,
        recommendationNarrative: 'Financials look sound.',
      }));
    } finally {
      await withPermission.close();
    }
  });

  it('approves with the approved amount/term and reason', async () => {
    const approve = vi.fn<CreditReviewService['approve']>().mockResolvedValue({
      ok: true,
      application: { ...sampleApplication, status: 'approved' },
    });
    const app = await buildTestApp(authWithPermissions(['credit_applications.approve']), reviewService({ approve }));
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/approve`,
        payload: {
          version: 3,
          approvedAmount: '500000.00',
          approvedTermMonths: 12,
          reason: 'Meets underwriting criteria',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(approve).toHaveBeenCalledWith(expect.objectContaining({
        reviewerUserId: reviewerId,
        approvedAmount: '500000.00',
        approvedTermMonths: 12,
      }));
    } finally {
      await app.close();
    }
  });

  it('accepts either review or approve capability to reach reject', async () => {
    const reject = vi.fn<CreditReviewService['reject']>().mockResolvedValue({
      ok: true,
      application: { ...sampleApplication, status: 'rejected' },
    });
    const reviewOnly = await buildTestApp(authWithPermissions(['credit_applications.review']), reviewService({ reject }));
    try {
      const response = await reviewOnly.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/reject`,
        payload: { version: 2, reason: 'Fails eligibility screening' },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await reviewOnly.close();
    }

    const approveOnly = await buildTestApp(authWithPermissions(['credit_applications.approve']), reviewService({ reject }));
    try {
      const response = await approveOnly.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/reject`,
        payload: { version: 2, reason: 'Committee disagrees' },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await approveOnly.close();
    }

    const neither = await buildTestApp(authWithPermissions([]), reviewService({ reject }));
    try {
      const response = await neither.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/reject`,
        payload: { version: 2, reason: 'Should be denied' },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await neither.close();
    }
  });

  it.each([
    ['not_found', 404],
    ['assigned_to_other', 409],
    ['not_assigned_analyst', 403],
    ['same_actor_as_recommendation', 403],
    ['stale_version', 409],
    ['invalid_transition', 409],
  ] as const)('maps %s to HTTP %i on start-review', async (reason, status) => {
    const app = await buildTestApp(
      authWithPermissions(['credit_applications.review']),
      reviewService({ startReview: async () => ({ ok: false, reason }) }),
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/credit/applications/${applicationId}/start-review`,
        payload: { version: 1 },
      });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });
});
