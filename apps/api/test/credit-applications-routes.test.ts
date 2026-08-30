import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { CreditApplicationService } from '../src/credit/application-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const applicantId = '00000000-0000-4000-8000-000000000c11';
const applicationId = '00000000-0000-4000-8000-000000000c12';
const borrowerCaseId = '00000000-0000-4000-8000-000000000c13';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: applicantId, expiresAt: new Date() },
      user: { id: applicantId, email: 'borrower@sproutup.ph', name: 'Borrower' },
    }),
    resolveAuthorization: async () => ({
      accountType: 'borrower',
      user: { id: applicantId, email: 'borrower@sproutup.ph', name: 'Borrower' },
      roles: [],
      permissions,
    }),
  };
}

function creditService(overrides: Partial<CreditApplicationService> = {}): CreditApplicationService {
  return {
    listOwn: async () => [],
    detailOwn: async () => null,
    saveOwn: async () => ({ ok: false, reason: 'application_not_found' }),
    submit: async () => ({ ok: false, reason: 'application_not_found' }),
    withdraw: async () => ({ ok: false, reason: 'application_not_found' }),
    reopen: async () => ({ ok: false, reason: 'application_not_found' }),
    ...overrides,
  };
}

const sampleApplication = {
  id: applicationId,
  borrowerCaseId,
  status: 'draft' as const,
  version: 1,
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
  assignedAnalystUserId: null,
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
  submittedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildTestApp(auth: AuthServices, applications: CreditApplicationService) {
  return buildApp({
    config: { appOrigin: 'http://localhost:3000', environment: 'test' },
    checkDatabase: async () => undefined,
    auth: { service: auth, baseUrl: 'http://localhost:3001' },
    credit: { applications },
  });
}

describe('own credit application routes', () => {
  it('requires manage-own to create and never calls the service without it', async () => {
    const saveOwn = vi.fn<CreditApplicationService['saveOwn']>();
    const app = await buildTestApp(authWithPermissions([]), creditService({ saveOwn }));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/credit/applications',
        payload: {
          borrowerCaseId,
          requestedAmount: '500000.00',
          termMonths: 12,
          purpose: 'Working capital',
          isAudited: false,
          bankruptcyHistory: false,
        },
      });
      expect(response.statusCode).toBe(403);
      expect(saveOwn).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('creates with the authenticated owner and passes fields through', async () => {
    const saveOwn = vi.fn<CreditApplicationService['saveOwn']>().mockResolvedValue({
      ok: true,
      application: sampleApplication,
      collateralItems: [],
      guarantors: [],
    });
    const app = await buildTestApp(
      authWithPermissions(['credit_applications.manage_own']),
      creditService({ saveOwn }),
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/credit/applications',
        payload: {
          borrowerCaseId,
          requestedAmount: '500000.00',
          termMonths: 12,
          purpose: 'Working capital',
          isAudited: false,
          bankruptcyHistory: false,
        },
      });
      expect(response.statusCode).toBe(201);
      expect(saveOwn).toHaveBeenCalledWith(expect.objectContaining({
        applicantUserId: applicantId,
        borrowerCaseId,
        requestedAmount: '500000.00',
      }));
    } finally {
      await app.close();
    }
  });

  it('saves an update with the expected version from the URL and body', async () => {
    const saveOwn = vi.fn<CreditApplicationService['saveOwn']>().mockResolvedValue({
      ok: true,
      application: sampleApplication,
      collateralItems: [],
      guarantors: [],
    });
    const app = await buildTestApp(
      authWithPermissions(['credit_applications.manage_own']),
      creditService({ saveOwn }),
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/credit/applications/${applicationId}`,
        payload: {
          expectedVersion: 2,
          requestedAmount: '600000.00',
          termMonths: 18,
          purpose: 'Equipment purchase',
          isAudited: true,
          bankruptcyHistory: false,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(saveOwn).toHaveBeenCalledWith(expect.objectContaining({
        applicantUserId: applicantId,
        applicationId,
        expectedVersion: 2,
        requestedAmount: '600000.00',
      }));
    } finally {
      await app.close();
    }
  });

  it('submits, withdraws, and reopens with the authenticated owner', async () => {
    const submit = vi.fn<CreditApplicationService['submit']>().mockResolvedValue({ ok: true, application: sampleApplication });
    const withdraw = vi.fn<CreditApplicationService['withdraw']>().mockResolvedValue({ ok: true, application: sampleApplication });
    const reopen = vi.fn<CreditApplicationService['reopen']>().mockResolvedValue({ ok: true, application: sampleApplication });
    const app = await buildTestApp(
      authWithPermissions(['credit_applications.submit_own', 'credit_applications.manage_own']),
      creditService({ submit, withdraw, reopen }),
    );
    try {
      const submitResponse = await app.inject({
        method: 'POST',
        url: `/v1/credit/applications/${applicationId}/submit`,
        payload: { version: 1 },
      });
      expect(submitResponse.statusCode).toBe(200);
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ applicantUserId: applicantId, applicationId, expectedVersion: 1 }));

      const withdrawResponse = await app.inject({
        method: 'POST',
        url: `/v1/credit/applications/${applicationId}/withdraw`,
        payload: { version: 2, reason: 'Found alternate financing' },
      });
      expect(withdrawResponse.statusCode).toBe(200);
      expect(withdraw).toHaveBeenCalledWith(expect.objectContaining({ applicantUserId: applicantId, reason: 'Found alternate financing' }));

      const reopenResponse = await app.inject({
        method: 'POST',
        url: `/v1/credit/applications/${applicationId}/reopen`,
        payload: { version: 3 },
      });
      expect(reopenResponse.statusCode).toBe(200);
      expect(reopen).toHaveBeenCalledWith(expect.objectContaining({ applicantUserId: applicantId, expectedVersion: 3 }));
    } finally {
      await app.close();
    }
  });

  it.each([
    ['borrower_case_not_found', 404],
    ['borrower_case_not_approved', 409],
    ['open_application_exists', 409],
    ['stale_version', 409],
    ['application_not_editable', 409],
  ] as const)('maps %s to HTTP %i', async (reason, status) => {
    const app = await buildTestApp(
      authWithPermissions(['credit_applications.manage_own']),
      creditService({ saveOwn: async () => ({ ok: false, reason }) }),
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/credit/applications',
        payload: {
          borrowerCaseId,
          requestedAmount: '500000.00',
          termMonths: 12,
          purpose: 'Working capital',
          isAudited: false,
          bankruptcyHistory: false,
        },
      });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });
});
