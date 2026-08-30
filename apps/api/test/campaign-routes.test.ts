import { describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@sproutup/shared';
import type { CampaignService } from '../src/campaigns/campaign-service.js';
import type { AuthServices } from '../src/auth/types.js';
import { buildApp } from '../src/app.js';

const actorId = '00000000-0000-4000-8000-000000000f11';
const campaignId = '00000000-0000-4000-8000-000000000f12';
const creditApplicationId = '00000000-0000-4000-8000-000000000f13';

function authWithPermissions(permissions: PermissionKey[]): AuthServices {
  return {
    handler: async () => Response.json({}),
    getSession: async () => ({
      session: { id: 'session-id', userId: actorId, expiresAt: new Date() },
      user: { id: actorId, email: 'staff@sproutup.ph', name: 'Staff' },
    }),
    resolveAuthorization: async () => ({
      accountType: 'admin',
      user: { id: actorId, email: 'staff@sproutup.ph', name: 'Staff' },
      roles: ['credit_analyst'],
      permissions,
    }),
  };
}

function campaignService(overrides: Partial<CampaignService> = {}): CampaignService {
  return {
    list: async ({ page, pageSize }) => ({ campaigns: [], page, pageSize, total: 0 }),
    detail: async () => null,
    create: async () => ({ ok: false, reason: 'credit_application_not_found' }),
    update: async () => ({ ok: false, reason: 'campaign_not_found' }),
    submit: async () => ({ ok: false, reason: 'campaign_not_found' }),
    publish: async () => ({ ok: false, reason: 'campaign_not_found' }),
    sendBack: async () => ({ ok: false, reason: 'campaign_not_found' }),
    cancel: async () => ({ ok: false, reason: 'campaign_not_found' }),
    ...overrides,
  };
}

const sampleCampaign = {
  id: campaignId,
  creditApplicationId,
  borrowerCaseId: '00000000-0000-4000-8000-000000000f14',
  status: 'draft' as const,
  version: 1,
  loanAmount: '500000.00',
  termMonths: 12,
  repaymentModel: 'amortized' as const,
  borrowerAnnualRatePercent: '15.0000',
  investorAnnualRatePercent: '8.0000',
  minimumCommitmentAmount: '5000.00',
  fundingWindowDays: 14,
  firstRepaymentDueDate: '2026-06-01',
  purposeSummary: 'Working capital expansion',
  createdByUserId: actorId,
  submittedByUserId: null,
  submittedAt: null,
  publishedByUserId: null,
  publishedAt: null,
  cancelledByUserId: null,
  cancelledAt: null,
  decisionReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validCreateBody = {
  creditApplicationId,
  loanAmount: '500000.00',
  termMonths: 12,
  repaymentModel: 'amortized',
  borrowerAnnualRatePercent: '15.0000',
  investorAnnualRatePercent: '8.0000',
  minimumCommitmentAmount: '5000.00',
  fundingWindowDays: 14,
  firstRepaymentDueDate: '2026-06-01',
  purposeSummary: 'Working capital expansion for inventory purchase.',
};

function buildTestApp(auth: AuthServices, campaigns: CampaignService) {
  return buildApp({
    config: { appOrigin: 'http://localhost:3000', environment: 'test' },
    checkDatabase: async () => undefined,
    auth: { service: auth, baseUrl: 'http://localhost:3001' },
    campaigns,
  });
}

describe('campaign routes', () => {
  it('requires manage permission to create and never calls the service without it', async () => {
    const create = vi.fn<CampaignService['create']>();
    const app = await buildTestApp(authWithPermissions([]), campaignService({ create }));
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/admin/campaigns', payload: validCreateBody });
      expect(response.statusCode).toBe(403);
      expect(create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('creates with the authenticated staff creator and passes fields through', async () => {
    const create = vi.fn<CampaignService['create']>().mockResolvedValue({ ok: true, campaign: sampleCampaign });
    const app = await buildTestApp(authWithPermissions(['campaigns.manage']), campaignService({ create }));
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/admin/campaigns', payload: validCreateBody });
      expect(response.statusCode).toBe(201);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        creatorUserId: actorId,
        creditApplicationId,
        loanAmount: '500000.00',
      }));
    } finally {
      await app.close();
    }
  });

  it('reads detail with the computed schedule', async () => {
    const detail = vi.fn<CampaignService['detail']>().mockResolvedValue({
      ...sampleCampaign,
      schedule: {
        repaymentModel: 'amortized',
        totalPrincipal: '500000.00',
        totalInterest: '1000.00',
        totalPayment: '501000.00',
        periods: [],
      },
      events: [],
    });
    const app = await buildTestApp(authWithPermissions(['campaigns.read']), campaignService({ detail }));
    try {
      const response = await app.inject({ method: 'GET', url: `/v1/admin/campaigns/${campaignId}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ success: true, data: { schedule: { totalPrincipal: '500000.00' } } });
    } finally {
      await app.close();
    }
  });

  it('submits and publishes with the authenticated actor', async () => {
    const submit = vi.fn<CampaignService['submit']>().mockResolvedValue({ ok: true, campaign: { ...sampleCampaign, status: 'pending_approval' } });
    const publish = vi.fn<CampaignService['publish']>().mockResolvedValue({ ok: true, campaign: { ...sampleCampaign, status: 'published' } });
    const app = await buildTestApp(
      authWithPermissions(['campaigns.manage', 'campaigns.publish']),
      campaignService({ submit, publish }),
    );
    try {
      const submitResponse = await app.inject({
        method: 'POST',
        url: `/v1/admin/campaigns/${campaignId}/submit`,
        payload: { version: 1 },
      });
      expect(submitResponse.statusCode).toBe(200);
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actorId, expectedVersion: 1 }));

      const publishResponse = await app.inject({
        method: 'POST',
        url: `/v1/admin/campaigns/${campaignId}/publish`,
        payload: { version: 2 },
      });
      expect(publishResponse.statusCode).toBe(200);
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actorId, expectedVersion: 2 }));
    } finally {
      await app.close();
    }
  });

  it('requires the publish capability independently from manage', async () => {
    const publish = vi.fn<CampaignService['publish']>();
    const app = await buildTestApp(authWithPermissions(['campaigns.manage']), campaignService({ publish }));
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/campaigns/${campaignId}/publish`,
        payload: { version: 1 },
      });
      expect(response.statusCode).toBe(403);
      expect(publish).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['credit_application_not_found', 404],
    ['credit_application_not_approved', 409],
    ['loan_amount_exceeds_approved', 409],
    ['open_campaign_exists', 409],
  ] as const)('maps %s to HTTP %i on create', async (reason, status) => {
    const app = await buildTestApp(
      authWithPermissions(['campaigns.manage']),
      campaignService({ create: async () => ({ ok: false, reason }) }),
    );
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/admin/campaigns', payload: validCreateBody });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['campaign_not_found', 404],
    ['stale_version', 409],
    ['invalid_transition', 409],
    ['same_actor_as_submission', 403],
  ] as const)('maps %s to HTTP %i on publish', async (reason, status) => {
    const app = await buildTestApp(
      authWithPermissions(['campaigns.publish']),
      campaignService({ publish: async () => ({ ok: false, reason }) }),
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/admin/campaigns/${campaignId}/publish`,
        payload: { version: 1 },
      });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });
});
