import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createBorrowerProfileService } from '../src/onboarding/borrower-profile-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const requestId = '00000000-0000-4000-8000-000000000803';

// One case per applicant per test: the database enforces at most one open
// (draft/submitted/in_review/needs_information) borrower case per applicant,
// so each scenario below that creates its own case uses its own applicant.
const applicantId = '00000000-0000-4000-8000-000000000801';
const otherApplicantId = '00000000-0000-4000-8000-000000000802';
const createApplicantId = '00000000-0000-4000-8000-000000000811';
const versionApplicantId = '00000000-0000-4000-8000-000000000812';
const replaceOwnersApplicantId = '00000000-0000-4000-8000-000000000813';
const percentageApplicantId = '00000000-0000-4000-8000-000000000814';
const notEditableApplicantId = '00000000-0000-4000-8000-000000000815';

async function createCase(applicantUserId: string, status: 'draft' | 'approved' = 'draft') {
  const [created] = await orm
    .insert(schema.onboardingCases)
    .values({ caseType: 'borrower', applicantUserId, status })
    .returning({ id: schema.onboardingCases.id });
  if (!created) throw new Error('Fixture case was not created');
  return created.id;
}

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.borrowerAccounts).values([
    applicantId,
    otherApplicantId,
    createApplicantId,
    versionApplicantId,
    replaceOwnersApplicantId,
    percentageApplicantId,
    notEditableApplicantId,
  ].map((id) => ({ id, name: `Applicant ${id.slice(-4)}`, email: `profile-${id.slice(-4)}@sproutup.ph` })));
});

afterAll(async () => {
  await pglite.close();
});

describe.sequential('borrower profile service', () => {
  it('creates a profile with beneficial owners and audits the save', async () => {
    const service = createBorrowerProfileService(orm);
    const caseId = await createCase(createApplicantId);

    const result = await service.saveOwn({
      applicantUserId: createApplicantId,
      actorRoles: [],
      caseId,
      entityType: 'corporation',
      registeredName: 'Sprout Trading Corp',
      tin: '123-456-789-000',
      beneficialOwners: [
        { fullName: 'Owner One', ownershipPercentage: '60.00', isPep: false },
        { fullName: 'Owner Two', ownershipPercentage: '40.00', isPep: true, nationality: 'Filipino' },
      ],
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected profile creation to succeed');
    expect(result.profile).toMatchObject({
      caseId,
      entityType: 'corporation',
      version: 1,
      registeredName: 'Sprout Trading Corp',
    });
    expect(result.profile.beneficialOwners).toHaveLength(2);

    const read = await service.getOwn(createApplicantId, caseId);
    expect(read?.beneficialOwners.map((owner) => owner.fullName).sort()).toEqual([
      'Owner One',
      'Owner Two',
    ]);

    const audits = await orm
      .select({ action: schema.auditEvents.action, metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, result.profile.id));
    expect(audits).toEqual([
      {
        action: 'borrower_profile.saved',
        metadata: expect.objectContaining({ wasCreated: true, beneficialOwnerCount: 2 }),
      },
    ]);
  });

  it('rejects a second create and requires the current version to update', async () => {
    const service = createBorrowerProfileService(orm);
    const caseId = await createCase(versionApplicantId);
    const created = await service.saveOwn({
      applicantUserId: versionApplicantId,
      actorRoles: [],
      caseId,
      entityType: 'sole_proprietorship',
      registeredName: 'Solo Trader',
      beneficialOwners: [],
      requestId,
    });
    if (!created.ok) throw new Error('Expected first save to succeed');

    await expect(
      service.saveOwn({
        applicantUserId: versionApplicantId,
        actorRoles: [],
        caseId,
        entityType: 'sole_proprietorship',
        registeredName: 'Solo Trader Again',
        beneficialOwners: [],
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'stale_version' });

    await expect(
      service.saveOwn({
        applicantUserId: versionApplicantId,
        actorRoles: [],
        caseId,
        expectedVersion: 999,
        entityType: 'sole_proprietorship',
        registeredName: 'Solo Trader Again',
        beneficialOwners: [],
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'stale_version' });

    const updated = await service.saveOwn({
      applicantUserId: versionApplicantId,
      actorRoles: [],
      caseId,
      expectedVersion: created.profile.version,
      entityType: 'sole_proprietorship',
      registeredName: 'Solo Trader Renamed',
      beneficialOwners: [],
      requestId,
    });
    expect(updated).toMatchObject({
      ok: true,
      profile: { version: 2, registeredName: 'Solo Trader Renamed' },
    });
  });

  it('replaces beneficial owners wholesale on update', async () => {
    const service = createBorrowerProfileService(orm);
    const caseId = await createCase(replaceOwnersApplicantId);
    const created = await service.saveOwn({
      applicantUserId: replaceOwnersApplicantId,
      actorRoles: [],
      caseId,
      entityType: 'partnership',
      registeredName: 'Two Partners',
      beneficialOwners: [{ fullName: 'First Owner', ownershipPercentage: '50.00', isPep: false }],
      requestId,
    });
    if (!created.ok) throw new Error('Expected first save to succeed');
    expect(created.profile.beneficialOwners).toHaveLength(1);

    const updated = await service.saveOwn({
      applicantUserId: replaceOwnersApplicantId,
      actorRoles: [],
      caseId,
      expectedVersion: created.profile.version,
      entityType: 'partnership',
      registeredName: 'Two Partners',
      beneficialOwners: [{ fullName: 'Replacement Owner', ownershipPercentage: '100.00', isPep: false }],
      requestId,
    });
    if (!updated.ok) throw new Error('Expected update to succeed');
    expect(updated.profile.beneficialOwners.map((owner) => owner.fullName)).toEqual([
      'Replacement Owner',
    ]);

    const remainingOwnerRows = await orm
      .select({ id: schema.beneficialOwners.id })
      .from(schema.beneficialOwners)
      .where(eq(schema.beneficialOwners.borrowerProfileId, created.profile.id));
    expect(remainingOwnerRows).toHaveLength(1);
  });

  it('rejects beneficial owner percentages that exceed 100%', async () => {
    const service = createBorrowerProfileService(orm);
    const caseId = await createCase(percentageApplicantId);
    await expect(
      service.saveOwn({
        applicantUserId: percentageApplicantId,
        actorRoles: [],
        caseId,
        entityType: 'corporation',
        registeredName: 'Over Allocated Corp',
        beneficialOwners: [
          { fullName: 'Owner A', ownershipPercentage: '60.00', isPep: false },
          { fullName: 'Owner B', ownershipPercentage: '50.00', isPep: false },
        ],
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'ownership_percentage_exceeds_total' });

    const profileRows = await orm
      .select({ id: schema.borrowerProfiles.id })
      .from(schema.borrowerProfiles)
      .where(eq(schema.borrowerProfiles.caseId, caseId));
    expect(profileRows).toHaveLength(0);
  });

  it('will not read or edit a case owned by a different applicant', async () => {
    const service = createBorrowerProfileService(orm);
    const caseId = await createCase(otherApplicantId);
    expect(await service.getOwn(applicantId, caseId)).toBeNull();
    await expect(
      service.saveOwn({
        applicantUserId: applicantId,
        actorRoles: [],
        caseId,
        entityType: 'corporation',
        registeredName: 'Should Not Save',
        beneficialOwners: [],
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'case_not_found' });
  });

  it('refuses to edit a profile once the case is no longer editable', async () => {
    const service = createBorrowerProfileService(orm);
    const caseId = await createCase(notEditableApplicantId, 'approved');
    await expect(
      service.saveOwn({
        applicantUserId: notEditableApplicantId,
        actorRoles: [],
        caseId,
        entityType: 'corporation',
        registeredName: 'Too Late Corp',
        beneficialOwners: [],
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'case_not_editable' });
  });

  // A database trigger already refuses to let a borrower account own an
  // investor-type case (see migration 0023), so an investor case can never
  // reach this service under a borrower applicant id in the first place; the
  // service's own `caseType: 'borrower'` filter is defense in depth for that
  // already-unreachable state, not something this suite can construct.
});
