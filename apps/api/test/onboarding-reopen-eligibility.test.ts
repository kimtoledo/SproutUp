import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Database } from '@sproutup/db';
import { createOnboardingCaseService } from '../src/onboarding/case-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const database = drizzle(pglite, { schema }) as unknown as Database;
const applicantId = '00000000-0000-4000-8000-000000000f01';
const reviewerId = '00000000-0000-4000-8000-000000000f02';
const clock = () => new Date('2026-09-01T00:00:00Z');

beforeAll(async () => {
  await applyMigrations(pglite);
  await database.insert(schema.users).values([
    { id: applicantId, name: 'Reopen Applicant', email: 'reopen@sproutup.ph' },
    { id: reviewerId, name: 'Reviewer Shadow', email: 'reopen-reviewer@sproutup.ph' },
  ]);
  await database.insert(schema.adminAccounts).values({
    id: reviewerId,
    name: 'Reviewer',
    email: 'reopen-reviewer@sproutup.ph',
  });
  await database.insert(schema.borrowerAccounts).values({
    id: applicantId,
    name: 'Reopen Applicant',
    email: 'reopen@sproutup.ph',
  });
});

afterAll(async () => {
  await pglite.close();
});

const service = () => createOnboardingCaseService(database, clock);

/** Drive a case straight to a terminal status via direct writes. */
async function forceStatus(caseId: string, status: 'rejected' | 'approved' | 'expired') {
  await database
    .update(schema.onboardingCases)
    .set({ status, decidedAt: clock(), assignedReviewerUserId: reviewerId })
    .where(eq(schema.onboardingCases.id, caseId));
}

describe.sequential('onboarding reopen + eligibility', () => {
  it('reports "none" eligibility before any case exists', async () => {
    expect(await service().eligibility(applicantId, 'borrower')).toEqual({
      journey: 'borrower',
      status: 'none',
      caseId: null,
      decidedAt: null,
    });
  });

  it('reports "pending" while a case is open and "none" again after rejection', async () => {
    const created = await service().create({
      applicantUserId: applicantId,
      actorRoles: [],
      caseType: 'borrower',
      requestId: '00000000-0000-4000-8000-000000000f10',
    });
    if (!created.ok) throw new Error('create failed');

    expect((await service().eligibility(applicantId, 'borrower')).status).toBe('pending');

    await forceStatus(created.case.id, 'rejected');
    const afterReject = await service().eligibility(applicantId, 'borrower');
    expect(afterReject).toMatchObject({ status: 'none', caseId: created.case.id });
  });

  it('reopens a rejected case to a fresh draft with a reopened event', async () => {
    const [rejected] = await database
      .select()
      .from(schema.onboardingCases)
      .where(
        and(
          eq(schema.onboardingCases.applicantUserId, applicantId),
          eq(schema.onboardingCases.caseType, 'borrower'),
        ),
      )
      .limit(1);

    const result = await service().reopen({
      applicantUserId: applicantId,
      actorRoles: [],
      allowedCaseTypes: ['borrower'],
      caseId: rejected.id,
      expectedVersion: rejected.version,
      requestId: '00000000-0000-4000-8000-000000000f11',
    });
    expect(result).toMatchObject({ ok: true, case: { status: 'draft' } });
    if (!result.ok) throw new Error('reopen failed');
    expect(result.case.assignedReviewerUserId).toBeNull();
    expect(result.case.decidedAt).toBeNull();

    const events = await database
      .select({ eventType: schema.onboardingCaseEvents.eventType })
      .from(schema.onboardingCaseEvents)
      .where(eq(schema.onboardingCaseEvents.caseId, rejected.id));
    expect(events.map((e) => e.eventType)).toContain('reopened');

    const [audit] = await database
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, 'onboarding_case.reopened'),
          eq(schema.auditEvents.resourceId, rejected.id),
        ),
      );
    expect(audit?.action).toBe('onboarding_case.reopened');
  });

  it('refuses to reopen a case that is not terminal', async () => {
    const [draft] = await database
      .select()
      .from(schema.onboardingCases)
      .where(eq(schema.onboardingCases.applicantUserId, applicantId))
      .limit(1);
    const result = await service().reopen({
      applicantUserId: applicantId,
      actorRoles: [],
      allowedCaseTypes: ['borrower'],
      caseId: draft.id,
      expectedVersion: draft.version,
      requestId: '00000000-0000-4000-8000-000000000f12',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_transition' });
  });

  it('rejects reopen with a stale version and for a non-owner', async () => {
    const [current] = await database
      .select()
      .from(schema.onboardingCases)
      .where(eq(schema.onboardingCases.applicantUserId, applicantId))
      .limit(1);
    await forceStatus(current.id, 'rejected');

    expect(
      await service().reopen({
        applicantUserId: applicantId,
        actorRoles: [],
        allowedCaseTypes: ['borrower'],
        caseId: current.id,
        expectedVersion: current.version + 99,
        requestId: '00000000-0000-4000-8000-000000000f13',
      }),
    ).toEqual({ ok: false, reason: 'stale_version' });

    expect(
      await service().reopen({
        applicantUserId: reviewerId,
        actorRoles: [],
        allowedCaseTypes: ['borrower'],
        caseId: current.id,
        expectedVersion: current.version,
        requestId: '00000000-0000-4000-8000-000000000f14',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('blocks a new case and reports "approved" once a case is approved, and clears on expiry', async () => {
    const [current] = await database
      .select()
      .from(schema.onboardingCases)
      .where(eq(schema.onboardingCases.applicantUserId, applicantId))
      .limit(1);
    await forceStatus(current.id, 'approved');

    expect((await service().eligibility(applicantId, 'borrower')).status).toBe('approved');
    expect(
      await service().create({
        applicantUserId: applicantId,
        actorRoles: [],
        caseType: 'borrower',
        requestId: '00000000-0000-4000-8000-000000000f15',
      }),
    ).toEqual({ ok: false, reason: 'already_approved' });

    await forceStatus(current.id, 'expired');
    expect((await service().eligibility(applicantId, 'borrower')).status).toBe('expired');
    // An expired approval no longer blocks a fresh start.
    expect(
      await service().create({
        applicantUserId: applicantId,
        actorRoles: [],
        caseType: 'borrower',
        requestId: '00000000-0000-4000-8000-000000000f16',
      }),
    ).toMatchObject({ ok: true });
  });

  it('will not reopen a terminal case while another case for the journey is open', async () => {
    // From the previous test: one open draft exists. Force an older terminal case.
    const rows = await database
      .select()
      .from(schema.onboardingCases)
      .where(
        and(
          eq(schema.onboardingCases.applicantUserId, applicantId),
          eq(schema.onboardingCases.caseType, 'borrower'),
        ),
      );
    const expired = rows.find((r) => r.status === 'expired');
    const open = rows.find((r) =>
      ['draft', 'submitted', 'in_review', 'needs_information'].includes(r.status),
    );
    expect(expired && open).toBeTruthy();

    const result = await service().reopen({
      applicantUserId: applicantId,
      actorRoles: [],
      allowedCaseTypes: ['borrower'],
      caseId: expired!.id,
      expectedVersion: expired!.version,
      requestId: '00000000-0000-4000-8000-000000000f17',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate_open_case' });
  });
});
