import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createInvestorProfileService } from '../src/onboarding/investor-profile-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const requestId = '00000000-0000-4000-8000-000000000903';

// One case per applicant per test — the database enforces at most one open
// investor case per applicant, so each scenario that creates its own case
// uses its own applicant.
const applicantId = '00000000-0000-4000-8000-000000000901';
const otherApplicantId = '00000000-0000-4000-8000-000000000902';
const createApplicantId = '00000000-0000-4000-8000-000000000911';
const versionApplicantId = '00000000-0000-4000-8000-000000000912';
const notEditableApplicantId = '00000000-0000-4000-8000-000000000913';

async function createCase(applicantUserId: string, status: 'draft' | 'approved' = 'draft') {
  const [created] = await orm
    .insert(schema.onboardingCases)
    .values({ caseType: 'investor', applicantUserId, status })
    .returning({ id: schema.onboardingCases.id });
  if (!created) throw new Error('Fixture case was not created');
  return created.id;
}

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.investorAccounts).values([
    applicantId,
    otherApplicantId,
    createApplicantId,
    versionApplicantId,
    notEditableApplicantId,
  ].map((id) => ({ id, name: `Applicant ${id.slice(-4)}`, email: `investor-profile-${id.slice(-4)}@sproutup.ph` })));
});

afterAll(async () => {
  await pglite.close();
});

describe.sequential('investor profile service', () => {
  it('creates a profile and audits the save', async () => {
    const service = createInvestorProfileService(orm);
    const caseId = await createCase(createApplicantId);

    const result = await service.saveOwn({
      applicantUserId: createApplicantId,
      actorRoles: [],
      caseId,
      fullName: 'Juana Dela Cruz',
      dateOfBirth: '1990-05-14',
      nationality: 'Filipino',
      governmentIdNumber: 'P1234567A',
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected profile creation to succeed');
    expect(result.profile).toMatchObject({
      caseId,
      version: 1,
      fullName: 'Juana Dela Cruz',
      nationality: 'Filipino',
    });

    const read = await service.getOwn(createApplicantId, caseId);
    expect(read?.fullName).toBe('Juana Dela Cruz');

    const audits = await orm
      .select({ action: schema.auditEvents.action, metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, result.profile.id));
    expect(audits).toEqual([
      { action: 'investor_profile.saved', metadata: expect.objectContaining({ wasCreated: true }) },
    ]);
  });

  it('rejects a second create and requires the current version to update', async () => {
    const service = createInvestorProfileService(orm);
    const caseId = await createCase(versionApplicantId);
    const created = await service.saveOwn({
      applicantUserId: versionApplicantId,
      actorRoles: [],
      caseId,
      fullName: 'Juan Santos',
      requestId,
    });
    if (!created.ok) throw new Error('Expected first save to succeed');

    await expect(
      service.saveOwn({
        applicantUserId: versionApplicantId,
        actorRoles: [],
        caseId,
        fullName: 'Juan Santos Again',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'stale_version' });

    const updated = await service.saveOwn({
      applicantUserId: versionApplicantId,
      actorRoles: [],
      caseId,
      expectedVersion: created.profile.version,
      fullName: 'Juan Santos Renamed',
      requestId,
    });
    expect(updated).toMatchObject({ ok: true, profile: { version: 2, fullName: 'Juan Santos Renamed' } });
  });

  it('will not read or edit a case owned by a different applicant', async () => {
    const service = createInvestorProfileService(orm);
    const caseId = await createCase(otherApplicantId);
    expect(await service.getOwn(applicantId, caseId)).toBeNull();
    await expect(
      service.saveOwn({
        applicantUserId: applicantId,
        actorRoles: [],
        caseId,
        fullName: 'Should Not Save',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'case_not_found' });
  });

  it('refuses to edit a profile once the case is no longer editable', async () => {
    const service = createInvestorProfileService(orm);
    const caseId = await createCase(notEditableApplicantId, 'approved');
    await expect(
      service.saveOwn({
        applicantUserId: notEditableApplicantId,
        actorRoles: [],
        caseId,
        fullName: 'Too Late',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'case_not_editable' });
  });
});
