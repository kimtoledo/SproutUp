import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createCreditApplicationService } from '../src/credit/application-service.js';
import { createCreditReviewService } from '../src/credit/review-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const requestId = '00000000-0000-4000-8000-000000000b03';

const applicantId = '00000000-0000-4000-8000-000000000b11';
const analystAId = '00000000-0000-4000-8000-000000000b21';
const analystBId = '00000000-0000-4000-8000-000000000b22';

const applicationService = createCreditApplicationService(orm);
const reviewService = createCreditReviewService(orm);

async function createSubmittedApplication(): Promise<{ id: string; version: number }> {
  const [borrowerCase] = await orm
    .insert(schema.onboardingCases)
    .values({ caseType: 'borrower', applicantUserId: applicantId, status: 'approved' })
    .returning({ id: schema.onboardingCases.id });
  if (!borrowerCase) throw new Error('Fixture borrower case was not created');

  const created = await applicationService.saveOwn({
    applicantUserId: applicantId,
    actorRoles: [],
    borrowerCaseId: borrowerCase.id,
    requestedAmount: '500000.00',
    termMonths: 12,
    purpose: 'Working capital',
    isAudited: false,
    bankruptcyHistory: false,
    collateralItems: [],
    guarantors: [],
    requestId,
  });
  if (!created.ok) throw new Error('Fixture application was not created');

  const submitted = await applicationService.submit({
    applicantUserId: applicantId,
    actorRoles: [],
    applicationId: created.application.id,
    expectedVersion: created.application.version,
    requestId,
  });
  if (!submitted.ok) throw new Error('Fixture application was not submitted');
  return { id: submitted.application.id, version: submitted.application.version };
}

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.borrowerAccounts).values({
    id: applicantId,
    name: 'Applicant',
    email: 'credit-review-applicant@sproutup.ph',
  });
  await orm.insert(schema.adminAccounts).values([
    { id: analystAId, name: 'Analyst A', email: 'credit-analyst-a@sproutup.ph' },
    { id: analystBId, name: 'Analyst B', email: 'credit-analyst-b@sproutup.ph' },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

describe.sequential('credit review service', () => {
  it('claims a submitted application and denies a second analyst', async () => {
    const application = await createSubmittedApplication();
    const started = await reviewService.startReview({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: application.version,
      requestId,
    });
    expect(started).toMatchObject({
      ok: true,
      application: { status: 'in_review', assignedAnalystUserId: analystAId },
    });
    if (!started.ok) throw new Error('Expected start-review to succeed');

    await expect(
      reviewService.startReview({
        reviewerUserId: analystBId,
        reviewerRoles: [],
        applicationId: application.id,
        expectedVersion: started.application.version,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'assigned_to_other' });
  });

  it('requires the assigned analyst to request information or recommend', async () => {
    const application = await createSubmittedApplication();
    const started = await reviewService.startReview({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: application.version,
      requestId,
    });
    if (!started.ok) throw new Error('Expected start-review to succeed');

    await expect(
      reviewService.recommend({
        reviewerUserId: analystBId,
        reviewerRoles: [],
        applicationId: application.id,
        expectedVersion: started.application.version,
        recommendationNarrative: 'Should not be allowed',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_assigned_analyst' });

    const recommended = await reviewService.recommend({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: started.application.version,
      recommendationNarrative: 'Financials look sound; recommend approval at a reduced term.',
      recommendedAmount: '400000.00',
      recommendedTermMonths: 10,
      requestId,
    });
    expect(recommended).toMatchObject({
      ok: true,
      application: { status: 'recommended', recommendedByUserId: analystAId, recommendedAmount: '400000.00' },
    });
  });

  it('requires a different approver than the recommending analyst', async () => {
    const application = await createSubmittedApplication();
    const started = await reviewService.startReview({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: application.version,
      requestId,
    });
    if (!started.ok) throw new Error('Expected start-review to succeed');
    const recommended = await reviewService.recommend({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: started.application.version,
      recommendationNarrative: 'Recommend approval.',
      requestId,
    });
    if (!recommended.ok) throw new Error('Expected recommend to succeed');

    await expect(
      reviewService.approve({
        reviewerUserId: analystAId,
        reviewerRoles: [],
        applicationId: application.id,
        expectedVersion: recommended.application.version,
        approvedAmount: '500000.00',
        approvedTermMonths: 12,
        reason: 'Self-approval attempt',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'same_actor_as_recommendation' });

    const approved = await reviewService.approve({
      reviewerUserId: analystBId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: recommended.application.version,
      approvedAmount: '500000.00',
      approvedTermMonths: 12,
      reason: 'Approved per committee sign-off',
      requestId,
    });
    expect(approved).toMatchObject({
      ok: true,
      application: {
        status: 'approved',
        decidedByUserId: analystBId,
        approvedAmount: '500000.00',
        approvedTermMonths: 12,
      },
    });

    const dualControlCheck = await orm
      .select({ recommendedByUserId: schema.creditApplications.recommendedByUserId, decidedByUserId: schema.creditApplications.decidedByUserId })
      .from(schema.creditApplications)
      .where(eq(schema.creditApplications.id, application.id));
    expect(dualControlCheck[0]).toEqual({ recommendedByUserId: analystAId, decidedByUserId: analystBId });
  });

  it('allows the assigned analyst to reject early, before any recommendation', async () => {
    const application = await createSubmittedApplication();
    const started = await reviewService.startReview({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: application.version,
      requestId,
    });
    if (!started.ok) throw new Error('Expected start-review to succeed');

    await expect(
      reviewService.reject({
        reviewerUserId: analystBId,
        reviewerRoles: [],
        applicationId: application.id,
        expectedVersion: started.application.version,
        reason: 'Not the assigned analyst',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_assigned_analyst' });

    const rejected = await reviewService.reject({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: started.application.version,
      reason: 'Fails basic eligibility screening',
      requestId,
    });
    expect(rejected).toMatchObject({ ok: true, application: { status: 'rejected', decidedByUserId: analystAId } });
  });

  it('requires a different approver to reject after a recommendation', async () => {
    const application = await createSubmittedApplication();
    const started = await reviewService.startReview({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: application.version,
      requestId,
    });
    if (!started.ok) throw new Error('Expected start-review to succeed');
    const recommended = await reviewService.recommend({
      reviewerUserId: analystAId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: started.application.version,
      recommendationNarrative: 'Recommend approval, but flag thin collateral.',
      requestId,
    });
    if (!recommended.ok) throw new Error('Expected recommend to succeed');

    await expect(
      reviewService.reject({
        reviewerUserId: analystAId,
        reviewerRoles: [],
        applicationId: application.id,
        expectedVersion: recommended.application.version,
        reason: 'Second-guessing my own recommendation',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'same_actor_as_recommendation' });

    const rejected = await reviewService.reject({
      reviewerUserId: analystBId,
      reviewerRoles: [],
      applicationId: application.id,
      expectedVersion: recommended.application.version,
      reason: 'Committee disagrees with the recommendation',
      requestId,
    });
    expect(rejected).toMatchObject({ ok: true, application: { status: 'rejected', decidedByUserId: analystBId } });
  });

  it('lists the queue with applicant identity and reads full detail', async () => {
    const application = await createSubmittedApplication();
    const { applications, total } = await reviewService.list({ page: 1, pageSize: 25 });
    expect(total).toBeGreaterThan(0);
    expect(applications.some((item) => item.id === application.id)).toBe(true);
    const found = applications.find((item) => item.id === application.id);
    expect(found).toMatchObject({ applicantEmail: 'credit-review-applicant@sproutup.ph' });

    const detail = await reviewService.detail(application.id);
    expect(detail).toMatchObject({ applicantUserId: applicantId, status: 'submitted' });
    expect(detail?.events.length).toBeGreaterThan(0);
  });
});
