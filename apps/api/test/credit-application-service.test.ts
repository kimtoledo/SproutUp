import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { schema, type Database } from '@sproutup/db';
import { createCreditApplicationService } from '../src/credit/application-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const requestId = '00000000-0000-4000-8000-000000000a03';

const createApplicantId = '00000000-0000-4000-8000-000000000a11';
const versionApplicantId = '00000000-0000-4000-8000-000000000a12';
const notApprovedApplicantId = '00000000-0000-4000-8000-000000000a13';
const otherApplicantId = '00000000-0000-4000-8000-000000000a14';
const editableApplicantId = '00000000-0000-4000-8000-000000000a15';
const reopenApplicantId = '00000000-0000-4000-8000-000000000a16';
const attackerApplicantId = '00000000-0000-4000-8000-000000000a17';

async function createBorrowerCase(applicantUserId: string, status: 'approved' | 'draft') {
  const [created] = await orm
    .insert(schema.onboardingCases)
    .values({ caseType: 'borrower', applicantUserId, status })
    .returning({ id: schema.onboardingCases.id });
  if (!created) throw new Error('Fixture borrower case was not created');
  return created.id;
}

const baseFields = {
  requestedAmount: '500000.00',
  termMonths: 12,
  purpose: 'Working capital for inventory expansion',
  isAudited: false,
  bankruptcyHistory: false,
  collateralItems: [] as never[],
  guarantors: [] as never[],
};

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.borrowerAccounts).values([
    createApplicantId,
    versionApplicantId,
    notApprovedApplicantId,
    otherApplicantId,
    editableApplicantId,
    reopenApplicantId,
    attackerApplicantId,
  ].map((id) => ({ id, name: `Applicant ${id.slice(-4)}`, email: `credit-${id.slice(-4)}@sproutup.ph` })));
});

afterAll(async () => {
  await pglite.close();
});

describe.sequential('credit application service', () => {
  it('creates an application for an approved borrower case and audits the save', async () => {
    const service = createCreditApplicationService(orm);
    const borrowerCaseId = await createBorrowerCase(createApplicantId, 'approved');

    const result = await service.saveOwn({
      applicantUserId: createApplicantId,
      actorRoles: [],
      borrowerCaseId,
      ...baseFields,
      collateralItems: [
        { collateralType: 'real_estate', description: 'Warehouse lot', estimatedValue: '1000000.00' },
      ],
      guarantors: [
        { fullName: 'Juan Guarantor', residencyStatus: 'local', assessedNetWorth: '2000000.00' },
      ],
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected application creation to succeed');
    expect(result.application).toMatchObject({
      borrowerCaseId,
      status: 'draft',
      version: 1,
      requestedAmount: '500000.00',
    });
    expect(result.collateralItems).toHaveLength(1);
    expect(result.guarantors).toHaveLength(1);

    const detail = await service.detailOwn(createApplicantId, result.application.id);
    expect(detail?.collateralItems).toHaveLength(1);
    expect(detail?.events).toEqual([expect.objectContaining({ eventType: 'created' })]);

    const audits = await orm
      .select({ action: schema.auditEvents.action, metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, result.application.id));
    expect(audits).toEqual([
      {
        action: 'credit_application.saved',
        metadata: expect.objectContaining({ wasCreated: true, collateralItemCount: 1, guarantorCount: 1 }),
      },
    ]);
  });

  it('rejects a second create for the same case and requires the current version to update', async () => {
    const service = createCreditApplicationService(orm);
    const borrowerCaseId = await createBorrowerCase(versionApplicantId, 'approved');
    const created = await service.saveOwn({
      applicantUserId: versionApplicantId,
      actorRoles: [],
      borrowerCaseId,
      ...baseFields,
      requestId,
    });
    if (!created.ok) throw new Error('Expected first save to succeed');

    await expect(
      service.saveOwn({
        applicantUserId: versionApplicantId,
        actorRoles: [],
        borrowerCaseId,
        ...baseFields,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'open_application_exists' });

    await expect(
      service.saveOwn({
        applicantUserId: versionApplicantId,
        actorRoles: [],
        applicationId: created.application.id,
        expectedVersion: 999,
        ...baseFields,
        purpose: 'Updated purpose text',
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'stale_version' });

    const updated = await service.saveOwn({
      applicantUserId: versionApplicantId,
      actorRoles: [],
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      ...baseFields,
      purpose: 'Updated purpose text',
      requestId,
    });
    expect(updated).toMatchObject({ ok: true, application: { version: 2, purpose: 'Updated purpose text' } });
  });

  it('rejects a credit application for a borrower case that is not approved', async () => {
    const service = createCreditApplicationService(orm);
    const borrowerCaseId = await createBorrowerCase(notApprovedApplicantId, 'draft');
    await expect(
      service.saveOwn({
        applicantUserId: notApprovedApplicantId,
        actorRoles: [],
        borrowerCaseId,
        ...baseFields,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'borrower_case_not_approved' });
  });

  it('rejects an unknown or foreign borrower case', async () => {
    const service = createCreditApplicationService(orm);
    await expect(
      service.saveOwn({
        applicantUserId: attackerApplicantId,
        actorRoles: [],
        borrowerCaseId: '00000000-0000-4000-8000-0000000000ff',
        ...baseFields,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'borrower_case_not_found' });

    const otherCaseId = await createBorrowerCase(otherApplicantId, 'approved');
    await expect(
      service.saveOwn({
        applicantUserId: attackerApplicantId,
        actorRoles: [],
        borrowerCaseId: otherCaseId,
        ...baseFields,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'borrower_case_not_found' });
  });

  it('replaces collateral and guarantors wholesale on update', async () => {
    const service = createCreditApplicationService(orm);
    const borrowerCaseId = await createBorrowerCase(editableApplicantId, 'approved');
    const created = await service.saveOwn({
      applicantUserId: editableApplicantId,
      actorRoles: [],
      borrowerCaseId,
      ...baseFields,
      collateralItems: [{ collateralType: 'inventory', description: 'Stock', estimatedValue: '100000.00' }],
      requestId,
    });
    if (!created.ok) throw new Error('Expected first save to succeed');
    expect(created.collateralItems).toHaveLength(1);

    const updated = await service.saveOwn({
      applicantUserId: editableApplicantId,
      actorRoles: [],
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      ...baseFields,
      collateralItems: [{ collateralType: 'invoice', description: 'Receivables', estimatedValue: '50000.00' }],
      requestId,
    });
    if (!updated.ok) throw new Error('Expected update to succeed');
    expect(updated.collateralItems.map((item) => item.description)).toEqual(['Receivables']);

    const remaining = await orm
      .select({ id: schema.creditCollateralItems.id })
      .from(schema.creditCollateralItems)
      .where(eq(schema.creditCollateralItems.applicationId, created.application.id));
    expect(remaining).toHaveLength(1);
  });

  it('will not read or edit an application owned by a different applicant', async () => {
    const service = createCreditApplicationService(orm);
    const borrowerCaseId = await createBorrowerCase(otherApplicantId, 'approved');
    const created = await service.saveOwn({
      applicantUserId: otherApplicantId,
      actorRoles: [],
      borrowerCaseId,
      ...baseFields,
      requestId,
    });
    if (!created.ok) throw new Error('Expected save to succeed');

    expect(await service.detailOwn(attackerApplicantId, created.application.id)).toBeNull();
    await expect(
      service.saveOwn({
        applicantUserId: attackerApplicantId,
        actorRoles: [],
        applicationId: created.application.id,
        expectedVersion: created.application.version,
        ...baseFields,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'application_not_found' });
  });

  it('submits, withdraws, and reopens the lifecycle, refusing edits once not editable', async () => {
    const service = createCreditApplicationService(orm);
    const borrowerCaseId = await createBorrowerCase(reopenApplicantId, 'approved');
    const created = await service.saveOwn({
      applicantUserId: reopenApplicantId,
      actorRoles: [],
      borrowerCaseId,
      ...baseFields,
      requestId,
    });
    if (!created.ok) throw new Error('Expected save to succeed');

    const submitted = await service.submit({
      applicantUserId: reopenApplicantId,
      actorRoles: [],
      applicationId: created.application.id,
      expectedVersion: created.application.version,
      requestId,
    });
    expect(submitted).toMatchObject({ ok: true, application: { status: 'submitted' } });
    if (!submitted.ok) throw new Error('Expected submit to succeed');

    await expect(
      service.saveOwn({
        applicantUserId: reopenApplicantId,
        actorRoles: [],
        applicationId: created.application.id,
        expectedVersion: submitted.application.version,
        ...baseFields,
        requestId,
      }),
    ).resolves.toEqual({ ok: false, reason: 'application_not_editable' });

    // Simulate an assigned-analyst rejection (the review service's own concern,
    // tested separately) by moving straight to `rejected` for this fixture.
    await orm
      .update(schema.creditApplications)
      .set({ status: 'rejected', version: submitted.application.version + 1 })
      .where(eq(schema.creditApplications.id, created.application.id));

    const reopened = await service.reopen({
      applicantUserId: reopenApplicantId,
      actorRoles: [],
      applicationId: created.application.id,
      expectedVersion: submitted.application.version + 1,
      requestId,
    });
    expect(reopened).toMatchObject({ ok: true, application: { status: 'draft' } });
  });
});
