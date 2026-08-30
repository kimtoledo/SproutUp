import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createCampaignService } from '../src/campaigns/campaign-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const requestId = '00000000-0000-4000-8000-000000000e03';

const borrowerId = '00000000-0000-4000-8000-000000000e11';
const creatorId = '00000000-0000-4000-8000-000000000e21';
const publisherId = '00000000-0000-4000-8000-000000000e22';

const baseFields = {
  loanAmount: '500000.00',
  termMonths: 12,
  repaymentModel: 'amortized' as const,
  borrowerAnnualRatePercent: '15.0000',
  investorAnnualRatePercent: '8.0000',
  minimumCommitmentAmount: '5000.00',
  fundingWindowDays: 14,
  firstRepaymentDueDate: '2026-06-01',
  purposeSummary: 'Working capital expansion for inventory purchase.',
};

async function createApprovedCreditApplication(status: 'approved' | 'submitted' = 'approved', approvedAmount = '500000.00') {
  const [borrowerCase] = await orm
    .insert(schema.onboardingCases)
    .values({ caseType: 'borrower', applicantUserId: borrowerId, status: 'approved' })
    .returning({ id: schema.onboardingCases.id });
  if (!borrowerCase) throw new Error('Fixture borrower case was not created');

  const [application] = await orm
    .insert(schema.creditApplications)
    .values({
      borrowerCaseId: borrowerCase.id,
      applicantUserId: borrowerId,
      status,
      requestedAmount: '500000.00',
      approvedAmount: status === 'approved' ? approvedAmount : null,
      termMonths: 12,
      purpose: 'Working capital',
      isAudited: false,
      bankruptcyHistory: false,
    })
    .returning({ id: schema.creditApplications.id });
  if (!application) throw new Error('Fixture credit application was not created');
  return { creditApplicationId: application.id, borrowerCaseId: borrowerCase.id };
}

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.borrowerAccounts).values({
    id: borrowerId,
    name: 'Borrower',
    email: 'campaign-borrower@sproutup.ph',
  });
  await orm.insert(schema.adminAccounts).values([
    { id: creatorId, name: 'Creator', email: 'campaign-creator@sproutup.ph' },
    { id: publisherId, name: 'Publisher', email: 'campaign-publisher@sproutup.ph' },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

describe.sequential('campaign service', () => {
  it('creates a campaign from an approved credit application and audits it', async () => {
    const service = createCampaignService(orm);
    const { creditApplicationId, borrowerCaseId } = await createApprovedCreditApplication();

    const result = await service.create({
      creatorUserId: creatorId,
      creatorRoles: [],
      creditApplicationId,
      ...baseFields,
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected campaign creation to succeed');
    expect(result.campaign).toMatchObject({
      creditApplicationId,
      borrowerCaseId,
      status: 'draft',
      version: 1,
      loanAmount: '500000.00',
    });

    const detail = await service.detail(result.campaign.id);
    expect(detail?.schedule.repaymentModel).toBe('amortized');
    expect(detail?.schedule.totalPrincipal).toBe('500000.00');
    expect(detail?.events).toEqual([expect.objectContaining({ eventType: 'created' })]);

    const audits = await orm
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, result.campaign.id));
    expect(audits.map((row) => row.action)).toEqual(['campaign.created']);
  });

  it('rejects a campaign for a credit application that is not approved', async () => {
    const service = createCampaignService(orm);
    const { creditApplicationId } = await createApprovedCreditApplication('submitted');
    await expect(
      service.create({ creatorUserId: creatorId, creatorRoles: [], creditApplicationId, ...baseFields, requestId }),
    ).resolves.toEqual({ ok: false, reason: 'credit_application_not_approved' });
  });

  it('rejects a loan amount above the approved credit application amount', async () => {
    const service = createCampaignService(orm);
    const { creditApplicationId } = await createApprovedCreditApplication('approved', '100000.00');
    await expect(
      service.create({
        creatorUserId: creatorId,
        creatorRoles: [],
        creditApplicationId,
        ...baseFields,
        loanAmount: '500000.00',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'loan_amount_exceeds_approved' });
  });

  it('rejects a second open campaign for the same credit application', async () => {
    const service = createCampaignService(orm);
    const { creditApplicationId } = await createApprovedCreditApplication();
    const first = await service.create({ creatorUserId: creatorId, creatorRoles: [], creditApplicationId, ...baseFields, requestId });
    if (!first.ok) throw new Error('Expected first create to succeed');
    await expect(
      service.create({ creatorUserId: creatorId, creatorRoles: [], creditApplicationId, ...baseFields, requestId }),
    ).resolves.toEqual({ ok: false, reason: 'open_campaign_exists' });
  });

  it('drives submit → publish and enforces dual control on publish', async () => {
    const service = createCampaignService(orm);
    const { creditApplicationId } = await createApprovedCreditApplication();
    const created = await service.create({ creatorUserId: creatorId, creatorRoles: [], creditApplicationId, ...baseFields, requestId });
    if (!created.ok) throw new Error('Expected create to succeed');

    const submitted = await service.submit({
      actorUserId: creatorId,
      actorRoles: [],
      campaignId: created.campaign.id,
      expectedVersion: created.campaign.version,
      requestId,
    });
    expect(submitted).toMatchObject({ ok: true, campaign: { status: 'pending_approval', submittedByUserId: creatorId } });
    if (!submitted.ok) throw new Error('Expected submit to succeed');

    await expect(
      service.publish({
        actorUserId: creatorId,
        actorRoles: [],
        campaignId: created.campaign.id,
        expectedVersion: submitted.campaign.version,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'same_actor_as_submission' });

    const published = await service.publish({
      actorUserId: publisherId,
      actorRoles: [],
      campaignId: created.campaign.id,
      expectedVersion: submitted.campaign.version,
      requestId,
    });
    expect(published).toMatchObject({
      ok: true,
      campaign: { status: 'published', publishedByUserId: publisherId },
    });
  });

  it('sends a campaign back to draft for correction, then allows resubmission', async () => {
    const service = createCampaignService(orm);
    const { creditApplicationId } = await createApprovedCreditApplication();
    const created = await service.create({ creatorUserId: creatorId, creatorRoles: [], creditApplicationId, ...baseFields, requestId });
    if (!created.ok) throw new Error('Expected create to succeed');
    const submitted = await service.submit({
      actorUserId: creatorId,
      actorRoles: [],
      campaignId: created.campaign.id,
      expectedVersion: created.campaign.version,
      requestId,
    });
    if (!submitted.ok) throw new Error('Expected submit to succeed');

    const sentBack = await service.sendBack({
      actorUserId: publisherId,
      actorRoles: [],
      campaignId: created.campaign.id,
      expectedVersion: submitted.campaign.version,
      reason: 'Rate looks too aggressive versus comparable campaigns',
      requestId,
    });
    expect(sentBack).toMatchObject({ ok: true, campaign: { status: 'draft', submittedByUserId: null } });
    if (!sentBack.ok) throw new Error('Expected send-back to succeed');

    const resubmitted = await service.submit({
      actorUserId: creatorId,
      actorRoles: [],
      campaignId: created.campaign.id,
      expectedVersion: sentBack.campaign.version,
      requestId,
    });
    expect(resubmitted).toMatchObject({ ok: true, campaign: { status: 'pending_approval' } });
  });

  it('cancels a campaign with a reason and refuses further transitions', async () => {
    const service = createCampaignService(orm);
    const { creditApplicationId } = await createApprovedCreditApplication();
    const created = await service.create({ creatorUserId: creatorId, creatorRoles: [], creditApplicationId, ...baseFields, requestId });
    if (!created.ok) throw new Error('Expected create to succeed');

    const cancelled = await service.cancel({
      actorUserId: creatorId,
      actorRoles: [],
      campaignId: created.campaign.id,
      expectedVersion: created.campaign.version,
      reason: 'Borrower withdrew the funding request',
      requestId,
    });
    expect(cancelled).toMatchObject({ ok: true, campaign: { status: 'cancelled', cancelledByUserId: creatorId } });
    if (!cancelled.ok) throw new Error('Expected cancel to succeed');

    await expect(
      service.submit({
        actorUserId: creatorId,
        actorRoles: [],
        campaignId: created.campaign.id,
        expectedVersion: cancelled.campaign.version,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_transition' });
  });
});
