import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createOnboardingCaseService } from '../src/onboarding/case-service.js';
import { createOnboardingReviewService } from '../src/onboarding/review-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const applicantId = '00000000-0000-4000-8000-000000000801';
const reviewerId = '00000000-0000-4000-8000-000000000802';
const otherReviewerId = '00000000-0000-4000-8000-000000000803';
let caseId = '';

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.users).values([
    { id: applicantId, name: 'Applicant', email: 'review-applicant@sproutup.ph' },
    { id: reviewerId, name: 'Reviewer', email: 'review-owner@sproutup.ph' },
    { id: otherReviewerId, name: 'Other Reviewer', email: 'review-other@sproutup.ph' },
  ]);
  const cases = createOnboardingCaseService(orm);
  const created = await cases.create({
    applicantUserId: applicantId,
    actorRoles: ['sme_borrower'],
    caseType: 'borrower',
    requestId: '00000000-0000-4000-8000-000000000804',
  });
  if (!created.ok) throw new Error('Expected case creation');
  caseId = created.case.id;
  const submitted = await cases.submit({
    applicantUserId: applicantId,
    actorRoles: ['sme_borrower'],
    allowedCaseTypes: ['borrower'],
    caseId,
    expectedVersion: 1,
    requestId: '00000000-0000-4000-8000-000000000805',
  });
  if (!submitted.ok) throw new Error('Expected case submission');
});

afterAll(async () => {
  await pglite.close();
});

describe.sequential('onboarding review service', () => {
  it('lists a bounded compliance queue with applicant context', async () => {
    const result = await createOnboardingReviewService(orm).list({
      page: 1,
      pageSize: 25,
      caseType: 'borrower',
      status: 'submitted',
    });

    expect(result.total).toBe(1);
    expect(result.cases).toEqual([
      expect.objectContaining({ id: caseId, applicantName: 'Applicant', status: 'submitted' }),
    ]);
  });

  it('prevents self-review and reviewer takeover while recording review start atomically', async () => {
    const service = createOnboardingReviewService(orm);
    await expect(
      service.startReview({
        reviewerUserId: applicantId,
        reviewerRoles: ['compliance_officer'],
        caseId,
        expectedVersion: 2,
        requestId: '00000000-0000-4000-8000-000000000806',
      }),
    ).resolves.toEqual({ ok: false, reason: 'self_review_not_allowed' });

    const result = await service.startReview({
      reviewerUserId: reviewerId,
      reviewerRoles: ['compliance_officer'],
      caseId,
      expectedVersion: 2,
      requestId: '00000000-0000-4000-8000-000000000807',
    });
    expect(result).toMatchObject({
      ok: true,
      case: { status: 'in_review', version: 3, assignedReviewerUserId: reviewerId },
    });

    await expect(
      service.startReview({
        reviewerUserId: otherReviewerId,
        reviewerRoles: ['compliance_officer'],
        caseId,
        expectedVersion: 3,
        requestId: '00000000-0000-4000-8000-000000000808',
      }),
    ).resolves.toEqual({ ok: false, reason: 'assigned_to_other' });

    await expect(
      service.requestInformation({
        reviewerUserId: otherReviewerId,
        reviewerRoles: ['compliance_officer'],
        caseId,
        expectedVersion: 3,
        reason: 'Attempted update by unassigned reviewer',
        requestId: '00000000-0000-4000-8000-000000000809',
      }),
    ).resolves.toEqual({ ok: false, reason: 'not_assigned_reviewer' });
    const informationRequest = await service.requestInformation({
      reviewerUserId: reviewerId,
      reviewerRoles: ['compliance_officer'],
      caseId,
      expectedVersion: 3,
      reason: 'Please provide clearer registration evidence',
      requestId: '00000000-0000-4000-8000-000000000810',
    });
    expect(informationRequest).toMatchObject({
      ok: true,
      case: { status: 'needs_information', version: 4, assignedReviewerUserId: reviewerId },
    });

    const resubmitted = await createOnboardingCaseService(orm).submit({
      applicantUserId: applicantId,
      actorRoles: ['sme_borrower'],
      allowedCaseTypes: ['borrower'],
      caseId,
      expectedVersion: 4,
      requestId: '00000000-0000-4000-8000-000000000814',
    });
    expect(resubmitted).toMatchObject({ ok: true, case: { status: 'submitted', version: 5 } });

    const events = await orm
      .select({ eventType: schema.onboardingCaseEvents.eventType })
      .from(schema.onboardingCaseEvents)
      .where(eq(schema.onboardingCaseEvents.caseId, caseId));
    const audits = await orm
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, caseId));
    expect(events.map(({ eventType }) => eventType)).toEqual([
      'created',
      'submitted',
      'review_started',
      'information_requested',
      'submitted',
    ]);
    expect(audits.map(({ action }) => action)).toContain('onboarding_case.review_started');
    expect(audits.map(({ action }) => action)).toContain('onboarding_case.information_requested');

    const detail = await service.detail(caseId);
    expect(detail).toMatchObject({
      id: caseId,
      applicantUserId: applicantId,
      applicantEmail: 'review-applicant@sproutup.ph',
      status: 'submitted',
      version: 5,
      events: [
        { eventType: 'created' },
        { eventType: 'submitted' },
        { eventType: 'review_started' },
        { eventType: 'information_requested', reason: 'Please provide clearer registration evidence' },
        { eventType: 'submitted' },
      ],
    });
  });

  it('allows only the assigned reviewer to reject in-review state with a reason', async () => {
    const decidedAt = new Date('2030-08-19T02:00:00.000Z');
    const service = createOnboardingReviewService(orm, () => decidedAt);
    const started = await service.startReview({
      reviewerUserId: reviewerId,
      reviewerRoles: ['compliance_officer'],
      caseId,
      expectedVersion: 5,
      requestId: '00000000-0000-4000-8000-000000000815',
    });
    expect(started).toMatchObject({ ok: true, case: { status: 'in_review', version: 6 } });

    await expect(service.reject({
      reviewerUserId: otherReviewerId,
      reviewerRoles: ['compliance_officer'],
      caseId,
      expectedVersion: 6,
      reason: 'Other reviewer cannot make this negative decision',
      requestId: '00000000-0000-4000-8000-000000000816',
    })).resolves.toEqual({ ok: false, reason: 'not_assigned_reviewer' });
    await expect(service.reject({
      reviewerUserId: reviewerId,
      reviewerRoles: ['compliance_officer'],
      caseId,
      expectedVersion: 5,
      reason: 'The case does not meet the documented pilot requirements',
      requestId: '00000000-0000-4000-8000-000000000817',
    })).resolves.toEqual({ ok: false, reason: 'stale_version' });

    const result = await service.reject({
      reviewerUserId: reviewerId,
      reviewerRoles: ['compliance_officer'],
      caseId,
      expectedVersion: 6,
      reason: 'The case does not meet the documented pilot requirements',
      requestId: '00000000-0000-4000-8000-000000000818',
    });
    expect(result).toMatchObject({
      ok: true,
      case: { status: 'rejected', version: 7, decidedAt },
    });

    const detail = await service.detail(caseId);
    expect(detail).toMatchObject({ status: 'rejected', version: 7 });
    expect(detail?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'rejected',
        fromStatus: 'in_review',
        toStatus: 'rejected',
        caseVersion: 7,
        reason: 'The case does not meet the documented pilot requirements',
        occurredAt: decidedAt,
      }),
    ]));
    const audits = await orm
      .select({ action: schema.auditEvents.action, reason: schema.auditEvents.reason })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, caseId));
    expect(audits).toContainEqual({
      action: 'onboarding_case.rejected',
      reason: 'The case does not meet the documented pilot requirements',
    });
  });
});
