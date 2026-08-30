import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { OnboardingCaseService } from '../src/onboarding/case-service.js';
import type { InvestorProfileService } from '../src/onboarding/investor-profile-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const applicantId = '00000000-0000-4000-8000-000000000921';
const caseId = '00000000-0000-4000-8000-000000000922';

/** Investor-profile routes are registered alongside the case routes, which need some service. */
const unusedCaseService: OnboardingCaseService = {
  listOwn: async () => [],
  detailOwn: async () => null,
  create: async () => ({ ok: false, reason: 'duplicate_open_case' }),
  submit: async () => ({ ok: false, reason: 'not_found' }),
  withdraw: async () => ({ ok: false, reason: 'not_found' }),
  reopen: async () => ({ ok: false, reason: 'not_found' }),
  eligibility: async (_userId, journey) => ({ journey, status: 'none', caseId: null, decidedAt: null }),
};

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: applicantId, expiresAt: new Date() },
      user: { id: applicantId, email: 'investor@sproutup.ph', name: 'Investor' },
    }),
    resolveAuthorization: async () => ({
      accountType: 'investor',
      user: { id: applicantId, email: 'investor@sproutup.ph', name: 'Investor' },
      roles: [],
      permissions,
    }),
  };
}

function profileService(overrides: Partial<InvestorProfileService> = {}): InvestorProfileService {
  return {
    getOwn: async () => null,
    saveOwn: async () => ({ ok: false, reason: 'case_not_found' }),
    ...overrides,
  };
}

const sampleProfile = {
  id: '00000000-0000-4000-8000-000000000923',
  caseId,
  version: 1,
  fullName: 'Juana Dela Cruz',
  dateOfBirth: null,
  nationality: null,
  governmentIdType: null,
  governmentIdNumber: null,
  residentialAddress: null,
  phoneNumber: null,
  occupation: null,
  sourceOfFunds: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('own investor profile routes', () => {
  it('requires the read-own capability and never calls the service without it', async () => {
    const getOwn = vi.fn<InvestorProfileService['getOwn']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions([]), baseUrl: 'http://localhost:3001' },
      onboarding: { cases: unusedCaseService, investorProfile: profileService({ getOwn }) },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/onboarding/investor/cases/${caseId}/profile`,
      });
      expect(response.statusCode).toBe(403);
      expect(getOwn).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns the owned profile for a permitted read', async () => {
    const getOwn = vi.fn<InvestorProfileService['getOwn']>().mockResolvedValue(sampleProfile);
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['investor_onboarding.read_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: { cases: unusedCaseService, investorProfile: profileService({ getOwn }) },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/onboarding/investor/cases/${caseId}/profile`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ success: true, data: { fullName: 'Juana Dela Cruz' } });
      expect(getOwn).toHaveBeenCalledWith(applicantId, caseId);
    } finally {
      await app.close();
    }
  });

  it('rejects a save payload missing the required fields before calling the service', async () => {
    const saveOwn = vi.fn<InvestorProfileService['saveOwn']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['investor_onboarding.manage_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: { cases: unusedCaseService, investorProfile: profileService({ saveOwn }) },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/investor/cases/${caseId}/profile`,
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(saveOwn).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('passes the authenticated owner, case id, and body through to a save', async () => {
    const saveOwn = vi.fn<InvestorProfileService['saveOwn']>().mockResolvedValue({
      ok: true,
      profile: sampleProfile,
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['investor_onboarding.manage_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: { cases: unusedCaseService, investorProfile: profileService({ saveOwn }) },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/investor/cases/${caseId}/profile`,
        payload: { fullName: 'Juana Dela Cruz', nationality: 'Filipino' },
      });
      expect(response.statusCode).toBe(200);
      expect(saveOwn).toHaveBeenCalledWith(expect.objectContaining({
        applicantUserId: applicantId,
        caseId,
        fullName: 'Juana Dela Cruz',
        nationality: 'Filipino',
      }));
    } finally {
      await app.close();
    }
  });

  it.each([
    ['case_not_found', 404],
    ['case_not_editable', 409],
    ['stale_version', 409],
  ] as const)('maps %s to HTTP %i', async (reason, status) => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['investor_onboarding.manage_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: {
        cases: unusedCaseService,
        investorProfile: profileService({ saveOwn: async () => ({ ok: false, reason }) }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/investor/cases/${caseId}/profile`,
        payload: { fullName: 'Juana Dela Cruz' },
      });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });
});
