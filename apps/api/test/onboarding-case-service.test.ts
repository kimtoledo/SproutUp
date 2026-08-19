import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createOnboardingCaseService } from '../src/onboarding/case-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const applicantId = '00000000-0000-4000-8000-000000000701';
const otherUserId = '00000000-0000-4000-8000-000000000702';
const now = () => new Date('2026-08-19T01:00:00Z');

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.users).values([
    { id: applicantId, name: 'Borrower Applicant', email: 'case-applicant@sproutup.ph' },
    { id: otherUserId, name: 'Other Applicant', email: 'case-other@sproutup.ph' },
  ]);
});

afterAll(async () => {
  await pglite.close();
});

describe('onboarding case service', () => {
  it('atomically creates one open journey with event and audit evidence', async () => {
    const service = createOnboardingCaseService(orm, now);
    const created = await service.create({
      applicantUserId: applicantId,
      actorRoles: ['sme_borrower'],
      caseType: 'borrower',
      requestId: '00000000-0000-4000-8000-000000000703',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('Expected case creation to succeed');

    await expect(
      service.create({
        applicantUserId: applicantId,
        actorRoles: ['sme_borrower'],
        caseType: 'borrower',
        requestId: '00000000-0000-4000-8000-000000000704',
      }),
    ).resolves.toEqual({ ok: false, reason: 'duplicate_open_case' });

    const detail = await service.detailOwn(applicantId, created.case.id, ['borrower']);
    const hidden = await service.detailOwn(otherUserId, created.case.id, ['borrower']);
    const audits = await orm
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, created.case.id));
    expect(detail).toMatchObject({ status: 'draft', version: 1, events: [{ eventType: 'created' }] });
    expect(hidden).toBeNull();
    expect(audits.map(({ action }) => action)).toEqual(['onboarding_case.created']);
  });

  it('uses optimistic versioning and records submission atomically', async () => {
    const service = createOnboardingCaseService(orm, now);
    const [current] = await service.listOwn(applicantId, ['borrower']);
    if (!current) throw new Error('Expected existing case');

    await expect(
      service.submit({
        applicantUserId: applicantId,
        actorRoles: ['sme_borrower'],
        allowedCaseTypes: ['borrower'],
        caseId: current.id,
        expectedVersion: 99,
        requestId: '00000000-0000-4000-8000-000000000705',
      }),
    ).resolves.toEqual({ ok: false, reason: 'stale_version' });

    const submitted = await service.submit({
      applicantUserId: applicantId,
      actorRoles: ['sme_borrower'],
      allowedCaseTypes: ['borrower'],
      caseId: current.id,
      expectedVersion: current.version,
      requestId: '00000000-0000-4000-8000-000000000706',
    });
    expect(submitted).toMatchObject({ ok: true, case: { status: 'submitted', version: 2 } });
    if (!submitted.ok) throw new Error('Expected submission to succeed');

    await expect(
      service.submit({
        applicantUserId: applicantId,
        actorRoles: ['sme_borrower'],
        allowedCaseTypes: ['borrower'],
        caseId: current.id,
        expectedVersion: submitted.case.version,
        requestId: '00000000-0000-4000-8000-000000000707',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_transition' });

    const detail = await service.detailOwn(applicantId, current.id, ['borrower']);
    expect(detail).toMatchObject({
      status: 'submitted',
      version: 2,
      events: [{ eventType: 'created' }, { eventType: 'submitted', caseVersion: 2 }],
    });
  });
});
