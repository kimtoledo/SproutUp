import { and, asc, eq } from 'drizzle-orm';
import type { BorrowerEntityType, RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

export type BorrowerProfileFailure =
  | 'case_not_found'
  | 'case_not_editable'
  | 'stale_version'
  | 'ownership_percentage_exceeds_total';

export interface BeneficialOwnerInput {
  fullName: string;
  /** Decimal string, e.g. "25.50" — matches the `numeric(5,2)` column. */
  ownershipPercentage: string;
  nationality?: string;
  isPep: boolean;
}

export interface BeneficialOwnerRecord {
  id: string;
  fullName: string;
  ownershipPercentage: string;
  nationality: string | null;
  isPep: boolean;
  createdAt: Date;
}

export interface BorrowerProfileRecord {
  id: string;
  caseId: string;
  entityType: BorrowerEntityType;
  version: number;
  registeredName: string;
  tradeName: string | null;
  registrationNumber: string | null;
  tin: string | null;
  principalAddress: string | null;
  contactPersonName: string | null;
  contactPersonEmail: string | null;
  contactPersonPhone: string | null;
  dateEstablished: string | null;
  createdAt: Date;
  updatedAt: Date;
  beneficialOwners: BeneficialOwnerRecord[];
}

export interface SaveBorrowerProfileInput {
  applicantUserId: string;
  actorRoles: RoleKey[];
  caseId: string;
  /** Omit to create; the current profile version to replace it. */
  expectedVersion?: number;
  entityType: BorrowerEntityType;
  registeredName: string;
  tradeName?: string;
  registrationNumber?: string;
  tin?: string;
  principalAddress?: string;
  contactPersonName?: string;
  contactPersonEmail?: string;
  contactPersonPhone?: string;
  dateEstablished?: string;
  beneficialOwners: BeneficialOwnerInput[];
  requestId: string;
  ipAddressHash?: string;
}

export type SaveBorrowerProfileResult =
  | { ok: true; profile: BorrowerProfileRecord }
  | { ok: false; reason: BorrowerProfileFailure };

export interface BorrowerProfileService {
  getOwn(applicantUserId: string, caseId: string): Promise<BorrowerProfileRecord | null>;
  saveOwn(input: SaveBorrowerProfileInput): Promise<SaveBorrowerProfileResult>;
}

const profileSelection = {
  id: schema.borrowerProfiles.id,
  caseId: schema.borrowerProfiles.caseId,
  entityType: schema.borrowerProfiles.entityType,
  version: schema.borrowerProfiles.version,
  registeredName: schema.borrowerProfiles.registeredName,
  tradeName: schema.borrowerProfiles.tradeName,
  registrationNumber: schema.borrowerProfiles.registrationNumber,
  tin: schema.borrowerProfiles.tin,
  principalAddress: schema.borrowerProfiles.principalAddress,
  contactPersonName: schema.borrowerProfiles.contactPersonName,
  contactPersonEmail: schema.borrowerProfiles.contactPersonEmail,
  contactPersonPhone: schema.borrowerProfiles.contactPersonPhone,
  dateEstablished: schema.borrowerProfiles.dateEstablished,
  createdAt: schema.borrowerProfiles.createdAt,
  updatedAt: schema.borrowerProfiles.updatedAt,
};

/** Whole-cents-of-a-percent (e.g. "33.33" -> 3333), matching `numeric(5,2)` without floats. */
function toHundredthsOfPercent(value: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid ownership percentage: ${value}`);
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return whole * 100 + Number(fraction);
}

async function loadProfileByCaseId(
  database: Pick<Database, 'select'>,
  caseId: string,
): Promise<BorrowerProfileRecord | null> {
  const [profile] = await database
    .select(profileSelection)
    .from(schema.borrowerProfiles)
    .where(eq(schema.borrowerProfiles.caseId, caseId))
    .limit(1);
  if (!profile) return null;

  const beneficialOwners = await database
    .select({
      id: schema.beneficialOwners.id,
      fullName: schema.beneficialOwners.fullName,
      ownershipPercentage: schema.beneficialOwners.ownershipPercentage,
      nationality: schema.beneficialOwners.nationality,
      isPep: schema.beneficialOwners.isPep,
      createdAt: schema.beneficialOwners.createdAt,
    })
    .from(schema.beneficialOwners)
    .where(eq(schema.beneficialOwners.borrowerProfileId, profile.id))
    .orderBy(asc(schema.beneficialOwners.createdAt), asc(schema.beneficialOwners.id));

  return { ...profile, beneficialOwners };
}

const editableCaseStatuses = new Set(['draft', 'needs_information']);

export function createBorrowerProfileService(database: Database): BorrowerProfileService {
  return {
    async getOwn(applicantUserId, caseId) {
      const [borrowerCase] = await database
        .select({ id: schema.onboardingCases.id })
        .from(schema.onboardingCases)
        .where(
          and(
            eq(schema.onboardingCases.id, caseId),
            eq(schema.onboardingCases.applicantUserId, applicantUserId),
            eq(schema.onboardingCases.caseType, 'borrower'),
          ),
        )
        .limit(1);
      if (!borrowerCase) return null;
      return loadProfileByCaseId(database, caseId);
    },

    async saveOwn(input) {
      // Ownership-percentage arithmetic runs before the transaction opens —
      // it is pure input validation, not a database-state check.
      const totalHundredths = input.beneficialOwners.reduce(
        (sum, owner) => sum + toHundredthsOfPercent(owner.ownershipPercentage),
        0,
      );
      if (totalHundredths > 100_00) {
        return { ok: false, reason: 'ownership_percentage_exceeds_total' };
      }

      return database.transaction(async (transaction) => {
        const [borrowerCase] = await transaction
          .select({ status: schema.onboardingCases.status })
          .from(schema.onboardingCases)
          .where(
            and(
              eq(schema.onboardingCases.id, input.caseId),
              eq(schema.onboardingCases.applicantUserId, input.applicantUserId),
              eq(schema.onboardingCases.caseType, 'borrower'),
            ),
          )
          .limit(1)
          .for('update');
        if (!borrowerCase) return { ok: false as const, reason: 'case_not_found' as const };
        if (!editableCaseStatuses.has(borrowerCase.status)) {
          return { ok: false as const, reason: 'case_not_editable' as const };
        }

        const [existing] = await transaction
          .select({ id: schema.borrowerProfiles.id, version: schema.borrowerProfiles.version })
          .from(schema.borrowerProfiles)
          .where(eq(schema.borrowerProfiles.caseId, input.caseId))
          .limit(1)
          .for('update');

        const fields = {
          entityType: input.entityType,
          registeredName: input.registeredName,
          tradeName: input.tradeName,
          registrationNumber: input.registrationNumber,
          tin: input.tin,
          principalAddress: input.principalAddress,
          contactPersonName: input.contactPersonName,
          contactPersonEmail: input.contactPersonEmail,
          contactPersonPhone: input.contactPersonPhone,
          dateEstablished: input.dateEstablished,
        };

        let profileId: string;
        let nextVersion: number;
        if (!existing) {
          if (input.expectedVersion !== undefined) {
            return { ok: false as const, reason: 'stale_version' as const };
          }
          const [created] = await transaction
            .insert(schema.borrowerProfiles)
            .values({ caseId: input.caseId, ...fields })
            .returning({ id: schema.borrowerProfiles.id, version: schema.borrowerProfiles.version });
          if (!created) throw new Error('Borrower profile was not created');
          profileId = created.id;
          nextVersion = created.version;
        } else {
          if (input.expectedVersion !== existing.version) {
            return { ok: false as const, reason: 'stale_version' as const };
          }
          nextVersion = existing.version + 1;
          const [updated] = await transaction
            .update(schema.borrowerProfiles)
            .set({ ...fields, version: nextVersion })
            .where(
              and(
                eq(schema.borrowerProfiles.id, existing.id),
                eq(schema.borrowerProfiles.version, existing.version),
              ),
            )
            .returning({ id: schema.borrowerProfiles.id });
          if (!updated) return { ok: false as const, reason: 'stale_version' as const };
          profileId = existing.id;
          // Beneficial owners are saved as a full replace — the client has no
          // per-owner id to diff against yet, and this keeps the percentage
          // total checked above always describing the row set being written.
          await transaction
            .delete(schema.beneficialOwners)
            .where(eq(schema.beneficialOwners.borrowerProfileId, profileId));
        }

        if (input.beneficialOwners.length > 0) {
          await transaction.insert(schema.beneficialOwners).values(
            input.beneficialOwners.map((owner) => ({
              borrowerProfileId: profileId,
              fullName: owner.fullName,
              ownershipPercentage: owner.ownershipPercentage,
              nationality: owner.nationality,
              isPep: owner.isPep,
            })),
          );
        }

        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'borrower_profile.saved',
          outcome: 'succeeded',
          resourceType: 'borrower_profile',
          resourceId: profileId,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: {
            caseId: input.caseId,
            version: nextVersion,
            wasCreated: !existing,
            entityType: input.entityType,
            beneficialOwnerCount: input.beneficialOwners.length,
          },
        });

        const profile = await loadProfileByCaseId(transaction, input.caseId);
        if (!profile) throw new Error('Borrower profile was not persisted');
        return { ok: true as const, profile };
      });
    },
  };
}
