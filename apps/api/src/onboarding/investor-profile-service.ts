import { and, eq } from 'drizzle-orm';
import type { RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

export type InvestorProfileFailure = 'case_not_found' | 'case_not_editable' | 'stale_version';

export interface InvestorProfileRecord {
  id: string;
  caseId: string;
  version: number;
  fullName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  governmentIdType: string | null;
  governmentIdNumber: string | null;
  residentialAddress: string | null;
  phoneNumber: string | null;
  occupation: string | null;
  sourceOfFunds: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveInvestorProfileInput {
  applicantUserId: string;
  actorRoles: RoleKey[];
  caseId: string;
  /** Omit to create; the current profile version to replace it. */
  expectedVersion?: number;
  fullName: string;
  dateOfBirth?: string;
  nationality?: string;
  governmentIdType?: string;
  governmentIdNumber?: string;
  residentialAddress?: string;
  phoneNumber?: string;
  occupation?: string;
  sourceOfFunds?: string;
  requestId: string;
  ipAddressHash?: string;
}

export type SaveInvestorProfileResult =
  | { ok: true; profile: InvestorProfileRecord }
  | { ok: false; reason: InvestorProfileFailure };

export interface InvestorProfileService {
  getOwn(applicantUserId: string, caseId: string): Promise<InvestorProfileRecord | null>;
  saveOwn(input: SaveInvestorProfileInput): Promise<SaveInvestorProfileResult>;
}

const profileSelection = {
  id: schema.investorProfiles.id,
  caseId: schema.investorProfiles.caseId,
  version: schema.investorProfiles.version,
  fullName: schema.investorProfiles.fullName,
  dateOfBirth: schema.investorProfiles.dateOfBirth,
  nationality: schema.investorProfiles.nationality,
  governmentIdType: schema.investorProfiles.governmentIdType,
  governmentIdNumber: schema.investorProfiles.governmentIdNumber,
  residentialAddress: schema.investorProfiles.residentialAddress,
  phoneNumber: schema.investorProfiles.phoneNumber,
  occupation: schema.investorProfiles.occupation,
  sourceOfFunds: schema.investorProfiles.sourceOfFunds,
  createdAt: schema.investorProfiles.createdAt,
  updatedAt: schema.investorProfiles.updatedAt,
};

async function loadProfileByCaseId(
  database: Pick<Database, 'select'>,
  caseId: string,
): Promise<InvestorProfileRecord | null> {
  const [profile] = await database
    .select(profileSelection)
    .from(schema.investorProfiles)
    .where(eq(schema.investorProfiles.caseId, caseId))
    .limit(1);
  return profile ?? null;
}

const editableCaseStatuses = new Set(['draft', 'needs_information']);

export function createInvestorProfileService(database: Database): InvestorProfileService {
  return {
    async getOwn(applicantUserId, caseId) {
      const [investorCase] = await database
        .select({ id: schema.onboardingCases.id })
        .from(schema.onboardingCases)
        .where(
          and(
            eq(schema.onboardingCases.id, caseId),
            eq(schema.onboardingCases.applicantUserId, applicantUserId),
            eq(schema.onboardingCases.caseType, 'investor'),
          ),
        )
        .limit(1);
      if (!investorCase) return null;
      return loadProfileByCaseId(database, caseId);
    },

    async saveOwn(input) {
      return database.transaction(async (transaction) => {
        const [investorCase] = await transaction
          .select({ status: schema.onboardingCases.status })
          .from(schema.onboardingCases)
          .where(
            and(
              eq(schema.onboardingCases.id, input.caseId),
              eq(schema.onboardingCases.applicantUserId, input.applicantUserId),
              eq(schema.onboardingCases.caseType, 'investor'),
            ),
          )
          .limit(1)
          .for('update');
        if (!investorCase) return { ok: false as const, reason: 'case_not_found' as const };
        if (!editableCaseStatuses.has(investorCase.status)) {
          return { ok: false as const, reason: 'case_not_editable' as const };
        }

        const [existing] = await transaction
          .select({ id: schema.investorProfiles.id, version: schema.investorProfiles.version })
          .from(schema.investorProfiles)
          .where(eq(schema.investorProfiles.caseId, input.caseId))
          .limit(1)
          .for('update');

        const fields = {
          fullName: input.fullName,
          dateOfBirth: input.dateOfBirth,
          nationality: input.nationality,
          governmentIdType: input.governmentIdType,
          governmentIdNumber: input.governmentIdNumber,
          residentialAddress: input.residentialAddress,
          phoneNumber: input.phoneNumber,
          occupation: input.occupation,
          sourceOfFunds: input.sourceOfFunds,
        };

        let profileId: string;
        let nextVersion: number;
        if (!existing) {
          if (input.expectedVersion !== undefined) {
            return { ok: false as const, reason: 'stale_version' as const };
          }
          const [created] = await transaction
            .insert(schema.investorProfiles)
            .values({ caseId: input.caseId, ...fields })
            .returning({ id: schema.investorProfiles.id, version: schema.investorProfiles.version });
          if (!created) throw new Error('Investor profile was not created');
          profileId = created.id;
          nextVersion = created.version;
        } else {
          if (input.expectedVersion !== existing.version) {
            return { ok: false as const, reason: 'stale_version' as const };
          }
          nextVersion = existing.version + 1;
          const [updated] = await transaction
            .update(schema.investorProfiles)
            .set({ ...fields, version: nextVersion })
            .where(
              and(
                eq(schema.investorProfiles.id, existing.id),
                eq(schema.investorProfiles.version, existing.version),
              ),
            )
            .returning({ id: schema.investorProfiles.id });
          if (!updated) return { ok: false as const, reason: 'stale_version' as const };
          profileId = existing.id;
        }

        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'investor_profile.saved',
          outcome: 'succeeded',
          resourceType: 'investor_profile',
          resourceId: profileId,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { caseId: input.caseId, version: nextVersion, wasCreated: !existing },
        });

        const profile = await loadProfileByCaseId(transaction, input.caseId);
        if (!profile) throw new Error('Investor profile was not persisted');
        return { ok: true as const, profile };
      });
    },
  };
}
