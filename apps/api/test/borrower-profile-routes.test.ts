import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { OnboardingCaseService } from '../src/onboarding/case-service.js';
import type { BorrowerProfileService } from '../src/onboarding/borrower-profile-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const applicantId = '00000000-0000-4000-8000-000000000821';
const caseId = '00000000-0000-4000-8000-000000000822';

/** Borrower-profile routes are registered alongside the case routes, which need some service. */
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

function profileService(overrides: Partial<BorrowerProfileService> = {}): BorrowerProfileService {
  return {
    getOwn: async () => null,
    saveOwn: async () => ({ ok: false, reason: 'case_not_found' }),
    ...overrides,
  };
}

const sampleProfile = {
  id: '00000000-0000-4000-8000-000000000823',
  caseId,
  entityType: 'corporation' as const,
  version: 1,
  registeredName: 'Sprout Trading Corp',
  tradeName: null,
  registrationNumber: null,
  tin: null,
  principalAddress: null,
  contactPersonName: null,
  contactPersonEmail: null,
  contactPersonPhone: null,
  dateEstablished: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  beneficialOwners: [],
};

describe('own borrower profile routes', () => {
  it('requires the read-own capability and never calls the service without it', async () => {
    const getOwn = vi.fn<BorrowerProfileService['getOwn']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: { service: authWithPermissions([]), baseUrl: 'http://localhost:3001' },
      onboarding: {
        cases: unusedCaseService,
        borrowerProfile: profileService({ getOwn }),
      },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/onboarding/borrower/cases/${caseId}/profile`,
      });
      expect(response.statusCode).toBe(403);
      expect(getOwn).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns the owned profile for a permitted read', async () => {
    const getOwn = vi.fn<BorrowerProfileService['getOwn']>().mockResolvedValue(sampleProfile);
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['borrower_onboarding.read_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: {
        cases: unusedCaseService,
        borrowerProfile: profileService({ getOwn }),
      },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/onboarding/borrower/cases/${caseId}/profile`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ success: true, data: { registeredName: 'Sprout Trading Corp' } });
      expect(getOwn).toHaveBeenCalledWith(applicantId, caseId);
    } finally {
      await app.close();
    }
  });

  it('rejects a save payload missing the required fields before calling the service', async () => {
    const saveOwn = vi.fn<BorrowerProfileService['saveOwn']>();
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['borrower_onboarding.manage_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: {
        cases: unusedCaseService,
        borrowerProfile: profileService({ saveOwn }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/borrower/cases/${caseId}/profile`,
        payload: { entityType: 'corporation' },
      });
      expect(response.statusCode).toBe(400);
      expect(saveOwn).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('passes the authenticated owner, case id, and body through to a save', async () => {
    const saveOwn = vi.fn<BorrowerProfileService['saveOwn']>().mockResolvedValue({
      ok: true,
      profile: { ...sampleProfile, version: 1 },
    });
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['borrower_onboarding.manage_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: {
        cases: unusedCaseService,
        borrowerProfile: profileService({ saveOwn }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/borrower/cases/${caseId}/profile`,
        payload: {
          entityType: 'corporation',
          registeredName: 'Sprout Trading Corp',
          beneficialOwners: [{ fullName: 'Owner One', ownershipPercentage: '100.00', isPep: false }],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(saveOwn).toHaveBeenCalledWith(expect.objectContaining({
        applicantUserId: applicantId,
        caseId,
        entityType: 'corporation',
        registeredName: 'Sprout Trading Corp',
        beneficialOwners: [{ fullName: 'Owner One', ownershipPercentage: '100.00', isPep: false }],
      }));
    } finally {
      await app.close();
    }
  });

  it.each([
    ['case_not_found', 404],
    ['case_not_editable', 409],
    ['stale_version', 409],
    ['ownership_percentage_exceeds_total', 400],
  ] as const)('maps %s to HTTP %i', async (reason, status) => {
    const app = await buildApp({
      config: { appOrigin: 'http://localhost:3000', environment: 'test' },
      checkDatabase: async () => undefined,
      auth: {
        service: authWithPermissions(['borrower_onboarding.manage_own']),
        baseUrl: 'http://localhost:3001',
      },
      onboarding: {
        cases: unusedCaseService,
        borrowerProfile: profileService({ saveOwn: async () => ({ ok: false, reason }) }),
      },
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/onboarding/borrower/cases/${caseId}/profile`,
        payload: { entityType: 'corporation', registeredName: 'Sprout Trading Corp' },
      });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });
});
