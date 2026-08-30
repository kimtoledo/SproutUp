import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  canTransitionCreditApplication,
  type CreditApplicationStatus,
  type CreditCollateralType,
  type CreditGuarantorResidency,
  type RoleKey,
} from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

export type CreditApplicationFailure =
  | 'borrower_case_not_found'
  | 'borrower_case_not_approved'
  | 'application_not_found'
  | 'open_application_exists'
  | 'stale_version'
  | 'application_not_editable'
  | 'invalid_transition';

export interface CollateralItemInput {
  collateralType: CreditCollateralType;
  description: string;
  estimatedValue: string;
  outstandingLoan?: string;
}

export interface GuarantorInput {
  fullName: string;
  residencyStatus: CreditGuarantorResidency;
  assessedNetWorth?: string;
  assessmentYear?: number;
  contactPhone?: string;
}

export interface CollateralItemRecord {
  id: string;
  collateralType: CreditCollateralType;
  description: string;
  estimatedValue: string;
  outstandingLoan: string | null;
  createdAt: Date;
}

export interface GuarantorRecord {
  id: string;
  fullName: string;
  residencyStatus: CreditGuarantorResidency;
  assessedNetWorth: string | null;
  assessmentYear: number | null;
  contactPhone: string | null;
  createdAt: Date;
}

export interface CreditApplicationSummary {
  id: string;
  borrowerCaseId: string;
  status: CreditApplicationStatus;
  version: number;
  requestedAmount: string;
  termMonths: number;
  purpose: string;
  industry: string | null;
  companyEmployees: number | null;
  ownershipDate: string | null;
  isAudited: boolean;
  lastYear1SalesRevenue: string | null;
  lastYear1GrossProfit: string | null;
  lastYear1NetProfit: string | null;
  lastYear2SalesRevenue: string | null;
  lastYear2GrossProfit: string | null;
  lastYear2NetProfit: string | null;
  bankruptcyHistory: boolean;
  bankruptcyDischarged: boolean | null;
  bankruptcyYear: number | null;
  assignedAnalystUserId: string | null;
  recommendationNarrative: string | null;
  recommendedAmount: string | null;
  recommendedTermMonths: number | null;
  recommendedByUserId: string | null;
  recommendedAt: Date | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  approvedAmount: string | null;
  approvedTermMonths: number | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveCreditApplicationInput {
  applicantUserId: string;
  actorRoles: RoleKey[];
  /** Present only when creating the first application for a borrower case. */
  borrowerCaseId?: string;
  /** Present only when updating an existing owned draft/needs_information application. */
  applicationId?: string;
  expectedVersion?: number;
  requestedAmount: string;
  termMonths: number;
  purpose: string;
  industry?: string;
  companyEmployees?: number;
  ownershipDate?: string;
  isAudited: boolean;
  lastYear1SalesRevenue?: string;
  lastYear1GrossProfit?: string;
  lastYear1NetProfit?: string;
  lastYear2SalesRevenue?: string;
  lastYear2GrossProfit?: string;
  lastYear2NetProfit?: string;
  bankruptcyHistory: boolean;
  bankruptcyDischarged?: boolean;
  bankruptcyYear?: number;
  collateralItems: CollateralItemInput[];
  guarantors: GuarantorInput[];
  requestId: string;
  ipAddressHash?: string;
}

export type SaveCreditApplicationResult =
  | { ok: true; application: CreditApplicationSummary; collateralItems: CollateralItemRecord[]; guarantors: GuarantorRecord[] }
  | { ok: false; reason: CreditApplicationFailure };

export type CreditApplicationCommandResult =
  | { ok: true; application: CreditApplicationSummary }
  | { ok: false; reason: CreditApplicationFailure };

export interface CreditApplicationService {
  listOwn(applicantUserId: string): Promise<CreditApplicationSummary[]>;
  detailOwn(applicantUserId: string, applicationId: string): Promise<
    | (CreditApplicationSummary & {
        collateralItems: CollateralItemRecord[];
        guarantors: GuarantorRecord[];
        events: Array<Record<string, unknown>>;
      })
    | null
  >;
  saveOwn(input: SaveCreditApplicationInput): Promise<SaveCreditApplicationResult>;
  submit(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<CreditApplicationCommandResult>;
  withdraw(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<CreditApplicationCommandResult>;
  reopen(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<CreditApplicationCommandResult>;
}

const summarySelection = {
  id: schema.creditApplications.id,
  borrowerCaseId: schema.creditApplications.borrowerCaseId,
  status: schema.creditApplications.status,
  version: schema.creditApplications.version,
  requestedAmount: schema.creditApplications.requestedAmount,
  termMonths: schema.creditApplications.termMonths,
  purpose: schema.creditApplications.purpose,
  industry: schema.creditApplications.industry,
  companyEmployees: schema.creditApplications.companyEmployees,
  ownershipDate: schema.creditApplications.ownershipDate,
  isAudited: schema.creditApplications.isAudited,
  lastYear1SalesRevenue: schema.creditApplications.lastYear1SalesRevenue,
  lastYear1GrossProfit: schema.creditApplications.lastYear1GrossProfit,
  lastYear1NetProfit: schema.creditApplications.lastYear1NetProfit,
  lastYear2SalesRevenue: schema.creditApplications.lastYear2SalesRevenue,
  lastYear2GrossProfit: schema.creditApplications.lastYear2GrossProfit,
  lastYear2NetProfit: schema.creditApplications.lastYear2NetProfit,
  bankruptcyHistory: schema.creditApplications.bankruptcyHistory,
  bankruptcyDischarged: schema.creditApplications.bankruptcyDischarged,
  bankruptcyYear: schema.creditApplications.bankruptcyYear,
  assignedAnalystUserId: schema.creditApplications.assignedAnalystUserId,
  recommendationNarrative: schema.creditApplications.recommendationNarrative,
  recommendedAmount: schema.creditApplications.recommendedAmount,
  recommendedTermMonths: schema.creditApplications.recommendedTermMonths,
  recommendedByUserId: schema.creditApplications.recommendedByUserId,
  recommendedAt: schema.creditApplications.recommendedAt,
  decidedByUserId: schema.creditApplications.decidedByUserId,
  decidedAt: schema.creditApplications.decidedAt,
  decisionReason: schema.creditApplications.decisionReason,
  approvedAmount: schema.creditApplications.approvedAmount,
  approvedTermMonths: schema.creditApplications.approvedTermMonths,
  submittedAt: schema.creditApplications.submittedAt,
  createdAt: schema.creditApplications.createdAt,
  updatedAt: schema.creditApplications.updatedAt,
};

const collateralSelection = {
  id: schema.creditCollateralItems.id,
  collateralType: schema.creditCollateralItems.collateralType,
  description: schema.creditCollateralItems.description,
  estimatedValue: schema.creditCollateralItems.estimatedValue,
  outstandingLoan: schema.creditCollateralItems.outstandingLoan,
  createdAt: schema.creditCollateralItems.createdAt,
};

const guarantorSelection = {
  id: schema.creditGuarantors.id,
  fullName: schema.creditGuarantors.fullName,
  residencyStatus: schema.creditGuarantors.residencyStatus,
  assessedNetWorth: schema.creditGuarantors.assessedNetWorth,
  assessmentYear: schema.creditGuarantors.assessmentYear,
  contactPhone: schema.creditGuarantors.contactPhone,
  createdAt: schema.creditGuarantors.createdAt,
};

const editableStatuses = new Set<CreditApplicationStatus>(['draft', 'needs_information']);
const openStatuses: CreditApplicationStatus[] = [
  'draft',
  'submitted',
  'in_review',
  'needs_information',
  'recommended',
];

async function loadChildren(
  database: Pick<Database, 'select'>,
  applicationId: string,
): Promise<{ collateralItems: CollateralItemRecord[]; guarantors: GuarantorRecord[] }> {
  const [collateralItems, guarantors] = await Promise.all([
    database
      .select(collateralSelection)
      .from(schema.creditCollateralItems)
      .where(eq(schema.creditCollateralItems.applicationId, applicationId))
      .orderBy(asc(schema.creditCollateralItems.createdAt), asc(schema.creditCollateralItems.id)),
    database
      .select(guarantorSelection)
      .from(schema.creditGuarantors)
      .where(eq(schema.creditGuarantors.applicationId, applicationId))
      .orderBy(asc(schema.creditGuarantors.createdAt), asc(schema.creditGuarantors.id)),
  ]);
  return { collateralItems, guarantors };
}

export function createCreditApplicationService(
  database: Database,
  clock: () => Date = () => new Date(),
): CreditApplicationService {
  return {
    async listOwn(applicantUserId) {
      return database
        .select(summarySelection)
        .from(schema.creditApplications)
        .where(eq(schema.creditApplications.applicantUserId, applicantUserId))
        .orderBy(asc(schema.creditApplications.createdAt), asc(schema.creditApplications.id));
    },

    async detailOwn(applicantUserId, applicationId) {
      const [application] = await database
        .select(summarySelection)
        .from(schema.creditApplications)
        .where(
          and(
            eq(schema.creditApplications.id, applicationId),
            eq(schema.creditApplications.applicantUserId, applicantUserId),
          ),
        )
        .limit(1);
      if (!application) return null;

      const [{ collateralItems, guarantors }, events] = await Promise.all([
        loadChildren(database, application.id),
        database
          .select({
            id: schema.creditApplicationEvents.id,
            eventType: schema.creditApplicationEvents.eventType,
            fromStatus: schema.creditApplicationEvents.fromStatus,
            toStatus: schema.creditApplicationEvents.toStatus,
            applicationVersion: schema.creditApplicationEvents.applicationVersion,
            actorType: schema.creditApplicationEvents.actorType,
            actorUserId: schema.creditApplicationEvents.actorUserId,
            reason: schema.creditApplicationEvents.reason,
            occurredAt: schema.creditApplicationEvents.occurredAt,
          })
          .from(schema.creditApplicationEvents)
          .where(eq(schema.creditApplicationEvents.applicationId, application.id))
          .orderBy(asc(schema.creditApplicationEvents.occurredAt), asc(schema.creditApplicationEvents.id)),
      ]);
      return { ...application, collateralItems, guarantors, events };
    },

    async saveOwn(input) {
      return database.transaction(async (transaction) => {
        const fields = {
          requestedAmount: input.requestedAmount,
          termMonths: input.termMonths,
          purpose: input.purpose,
          industry: input.industry,
          companyEmployees: input.companyEmployees,
          ownershipDate: input.ownershipDate,
          isAudited: input.isAudited,
          lastYear1SalesRevenue: input.lastYear1SalesRevenue,
          lastYear1GrossProfit: input.lastYear1GrossProfit,
          lastYear1NetProfit: input.lastYear1NetProfit,
          lastYear2SalesRevenue: input.lastYear2SalesRevenue,
          lastYear2GrossProfit: input.lastYear2GrossProfit,
          lastYear2NetProfit: input.lastYear2NetProfit,
          bankruptcyHistory: input.bankruptcyHistory,
          bankruptcyDischarged: input.bankruptcyHistory ? input.bankruptcyDischarged : undefined,
          bankruptcyYear: input.bankruptcyHistory ? input.bankruptcyYear : undefined,
        };

        let applicationId: string;
        let nextVersion: number;

        if (!input.applicationId) {
          if (!input.borrowerCaseId) {
            return { ok: false as const, reason: 'borrower_case_not_found' as const };
          }
          const [borrowerCase] = await transaction
            .select({ status: schema.onboardingCases.status })
            .from(schema.onboardingCases)
            .where(
              and(
                eq(schema.onboardingCases.id, input.borrowerCaseId),
                eq(schema.onboardingCases.applicantUserId, input.applicantUserId),
                eq(schema.onboardingCases.caseType, 'borrower'),
              ),
            )
            .limit(1);
          if (!borrowerCase) return { ok: false as const, reason: 'borrower_case_not_found' as const };
          if (borrowerCase.status !== 'approved') {
            return { ok: false as const, reason: 'borrower_case_not_approved' as const };
          }

          const [created] = await transaction
            .insert(schema.creditApplications)
            .values({
              borrowerCaseId: input.borrowerCaseId,
              applicantUserId: input.applicantUserId,
              ...fields,
            })
            // No explicit target: the arbiter is the partial one-open-per-case
            // unique index, which Postgres can only match via unconstrained
            // inference, not a plain column target.
            .onConflictDoNothing()
            .returning({ id: schema.creditApplications.id, version: schema.creditApplications.version });
          if (!created) return { ok: false as const, reason: 'open_application_exists' as const };
          applicationId = created.id;
          nextVersion = created.version;

          await transaction.insert(schema.creditApplicationEvents).values({
            applicationId,
            eventType: 'created',
            toStatus: 'draft',
            applicationVersion: nextVersion,
            actorType: 'user',
            actorUserId: input.applicantUserId,
          });
        } else {
          const [existing] = await transaction
            .select({ id: schema.creditApplications.id, version: schema.creditApplications.version, status: schema.creditApplications.status })
            .from(schema.creditApplications)
            .where(
              and(
                eq(schema.creditApplications.id, input.applicationId),
                eq(schema.creditApplications.applicantUserId, input.applicantUserId),
              ),
            )
            .limit(1)
            .for('update');
          if (!existing) return { ok: false as const, reason: 'application_not_found' as const };
          if (!editableStatuses.has(existing.status)) {
            return { ok: false as const, reason: 'application_not_editable' as const };
          }
          if (input.expectedVersion !== existing.version) {
            return { ok: false as const, reason: 'stale_version' as const };
          }
          nextVersion = existing.version + 1;
          const [updated] = await transaction
            .update(schema.creditApplications)
            .set({ ...fields, version: nextVersion })
            .where(
              and(
                eq(schema.creditApplications.id, existing.id),
                eq(schema.creditApplications.version, existing.version),
              ),
            )
            .returning({ id: schema.creditApplications.id });
          if (!updated) return { ok: false as const, reason: 'stale_version' as const };
          applicationId = existing.id;

          await Promise.all([
            transaction.delete(schema.creditCollateralItems).where(eq(schema.creditCollateralItems.applicationId, applicationId)),
            transaction.delete(schema.creditGuarantors).where(eq(schema.creditGuarantors.applicationId, applicationId)),
          ]);
        }

        if (input.collateralItems.length > 0) {
          await transaction.insert(schema.creditCollateralItems).values(
            input.collateralItems.map((item) => ({ applicationId, ...item })),
          );
        }
        if (input.guarantors.length > 0) {
          await transaction.insert(schema.creditGuarantors).values(
            input.guarantors.map((guarantor) => ({ applicationId, ...guarantor })),
          );
        }

        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'credit_application.saved',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: applicationId,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: {
            version: nextVersion,
            wasCreated: !input.applicationId,
            collateralItemCount: input.collateralItems.length,
            guarantorCount: input.guarantors.length,
          },
        });

        const [application] = await transaction
          .select(summarySelection)
          .from(schema.creditApplications)
          .where(eq(schema.creditApplications.id, applicationId))
          .limit(1);
        if (!application) throw new Error('Credit application was not persisted');
        const { collateralItems, guarantors } = await loadChildren(transaction, applicationId);
        return { ok: true as const, application, collateralItems, guarantors };
      });
    },

    async submit(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(
            and(
              eq(schema.creditApplications.id, input.applicationId),
              eq(schema.creditApplications.applicantUserId, input.applicantUserId),
            ),
          )
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'application_not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'submitted')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const now = clock();
        const [submitted] = await transaction
          .update(schema.creditApplications)
          .set({ status: 'submitted', version: nextVersion, submittedAt: now })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!submitted) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'submitted',
          fromStatus: current.status,
          toStatus: 'submitted',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.applicantUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'credit_application.submitted',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: submitted };
      });
    },

    async withdraw(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(
            and(
              eq(schema.creditApplications.id, input.applicationId),
              eq(schema.creditApplications.applicantUserId, input.applicantUserId),
            ),
          )
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'application_not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'withdrawn')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const [withdrawn] = await transaction
          .update(schema.creditApplications)
          .set({ status: 'withdrawn', version: nextVersion })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!withdrawn) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'withdrawn',
          fromStatus: current.status,
          toStatus: 'withdrawn',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.applicantUserId,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'credit_application.withdrawn',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: withdrawn };
      });
    },

    async reopen(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(
            and(
              eq(schema.creditApplications.id, input.applicationId),
              eq(schema.creditApplications.applicantUserId, input.applicantUserId),
            ),
          )
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'application_not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'draft')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        // A terminal application can only reopen when no other application for
        // this borrower case is currently open (the database's own
        // one-open-per-case index is the final guard; this returns a clean
        // conflict first).
        const [openSibling] = await transaction
          .select({ id: schema.creditApplications.id })
          .from(schema.creditApplications)
          .where(
            and(
              eq(schema.creditApplications.borrowerCaseId, current.borrowerCaseId),
              ne(schema.creditApplications.id, current.id),
              inArray(schema.creditApplications.status, openStatuses),
            ),
          )
          .limit(1);
        if (openSibling) return { ok: false as const, reason: 'open_application_exists' as const };

        const nextVersion = current.version + 1;
        const [reopened] = await transaction
          .update(schema.creditApplications)
          .set({
            status: 'draft',
            version: nextVersion,
            assignedAnalystUserId: null,
            recommendationNarrative: null,
            recommendedAmount: null,
            recommendedTermMonths: null,
            recommendedByUserId: null,
            recommendedAt: null,
            decidedByUserId: null,
            decidedAt: null,
            decisionReason: null,
            approvedAmount: null,
            approvedTermMonths: null,
            submittedAt: null,
          })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!reopened) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'reopened',
          fromStatus: current.status,
          toStatus: 'draft',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.applicantUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'credit_application.reopened',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { fromStatus: current.status, fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: reopened };
      });
    },
  };
}
