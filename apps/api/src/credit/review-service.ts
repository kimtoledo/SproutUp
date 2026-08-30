import { and, asc, count, eq, inArray, type SQL } from 'drizzle-orm';
import { canTransitionCreditApplication, type CreditApplicationStatus, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type AuditWriterDatabase, type Database } from '@sproutup/db';
import type { CreditApplicationSummary } from './application-service.js';

// An application only enters the underwriting queue once submitted. Drafts
// (never submitted) and withdrawn applications are hidden unless a reviewer
// asks for that exact status.
const queueVisibleStatuses: CreditApplicationStatus[] = [
  'submitted',
  'in_review',
  'needs_information',
  'recommended',
  'approved',
  'rejected',
];

type ReviewFailure =
  | 'not_found'
  | 'assigned_to_other'
  | 'not_assigned_analyst'
  | 'same_actor_as_recommendation'
  | 'stale_version'
  | 'invalid_transition';

export interface CreditReviewService {
  list(input: {
    page: number;
    pageSize: number;
    status?: CreditApplicationStatus;
    analystUserId?: string;
  }): Promise<{
    applications: Array<CreditApplicationSummary & { applicantName: string; applicantEmail: string }>;
    page: number;
    pageSize: number;
    total: number;
  }>;
  detail(applicationId: string): Promise<
    | (CreditApplicationSummary & {
        applicantUserId: string;
        applicantName: string;
        applicantEmail: string;
        collateralItems: Array<Record<string, unknown>>;
        guarantors: Array<Record<string, unknown>>;
        events: Array<Record<string, unknown>>;
      })
    | null
  >;
  startReview(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; application: CreditApplicationSummary } | { ok: false; reason: ReviewFailure }>;
  requestInformation(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; application: CreditApplicationSummary } | { ok: false; reason: ReviewFailure }>;
  /** The assigned analyst's narrative recommendation — never a calculated score. */
  recommend(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    recommendationNarrative: string;
    recommendedAmount?: string;
    recommendedTermMonths?: number;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; application: CreditApplicationSummary } | { ok: false; reason: ReviewFailure }>;
  /** Final decision. Any authorized approver other than the recommending analyst — no pre-assignment. */
  approve(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    approvedAmount: string;
    approvedTermMonths: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; application: CreditApplicationSummary } | { ok: false; reason: ReviewFailure }>;
  /**
   * Rejects from `in_review` (assigned analyst only, no recommendation made
   * yet) or from `recommended` (any authorized approver other than the
   * recommending analyst — the same dual-control rule as `approve`).
   */
  reject(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    applicationId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; application: CreditApplicationSummary } | { ok: false; reason: ReviewFailure }>;
}

async function recordReviewDenial(
  transaction: AuditWriterDatabase,
  input: { reviewerUserId: string; reviewerRoles: RoleKey[]; requestId: string; ipAddressHash?: string },
  applicationRow: { id: string; status: CreditApplicationStatus },
  reason: string,
): Promise<void> {
  await writeAudit(transaction, {
    actorType: 'user',
    actorUserId: input.reviewerUserId,
    actorRoles: input.reviewerRoles,
    action: 'credit_application.review_denied',
    outcome: 'denied',
    resourceType: 'credit_application',
    resourceId: applicationRow.id,
    requestId: input.requestId,
    ipAddressHash: input.ipAddressHash,
    reason,
    metadata: { status: applicationRow.status },
  });
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

export function createCreditReviewService(
  database: Database,
  clock: () => Date = () => new Date(),
): CreditReviewService {
  return {
    async list(input) {
      const filters: SQL[] = [];
      if (input.status) {
        filters.push(eq(schema.creditApplications.status, input.status));
      } else {
        filters.push(inArray(schema.creditApplications.status, queueVisibleStatuses));
      }
      if (input.analystUserId) {
        filters.push(eq(schema.creditApplications.assignedAnalystUserId, input.analystUserId));
      }
      const where = and(...filters);

      const [[totalRow], applications] = await Promise.all([
        database.select({ value: count() }).from(schema.creditApplications).where(where),
        database
          .select({
            ...summarySelection,
            applicantName: schema.borrowerAccounts.name,
            applicantEmail: schema.borrowerAccounts.email,
          })
          .from(schema.creditApplications)
          .innerJoin(
            schema.borrowerAccounts,
            eq(schema.creditApplications.applicantUserId, schema.borrowerAccounts.id),
          )
          .where(where)
          .orderBy(asc(schema.creditApplications.createdAt), asc(schema.creditApplications.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
      ]);
      return { applications, page: input.page, pageSize: input.pageSize, total: totalRow?.value ?? 0 };
    },

    async detail(applicationId) {
      const [application] = await database
        .select({
          ...summarySelection,
          applicantUserId: schema.creditApplications.applicantUserId,
          applicantName: schema.borrowerAccounts.name,
          applicantEmail: schema.borrowerAccounts.email,
        })
        .from(schema.creditApplications)
        .innerJoin(
          schema.borrowerAccounts,
          eq(schema.creditApplications.applicantUserId, schema.borrowerAccounts.id),
        )
        .where(eq(schema.creditApplications.id, applicationId))
        .limit(1);
      if (!application) return null;

      const [collateralItems, guarantors, events] = await Promise.all([
        database
          .select()
          .from(schema.creditCollateralItems)
          .where(eq(schema.creditCollateralItems.applicationId, application.id))
          .orderBy(asc(schema.creditCollateralItems.createdAt)),
        database
          .select()
          .from(schema.creditGuarantors)
          .where(eq(schema.creditGuarantors.applicationId, application.id))
          .orderBy(asc(schema.creditGuarantors.createdAt)),
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

    async startReview(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(eq(schema.creditApplications.id, input.applicationId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.assignedAnalystUserId && current.assignedAnalystUserId !== input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'assigned_to_other');
          return { ok: false as const, reason: 'assigned_to_other' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'in_review')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const [reviewing] = await transaction
          .update(schema.creditApplications)
          .set({ status: 'in_review', version: nextVersion, assignedAnalystUserId: input.reviewerUserId })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!reviewing) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'review_started',
          fromStatus: current.status,
          toStatus: 'in_review',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'credit_application.review_started',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: reviewing };
      });
    },

    async requestInformation(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(eq(schema.creditApplications.id, input.applicationId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.assignedAnalystUserId !== input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'not_assigned_analyst');
          return { ok: false as const, reason: 'not_assigned_analyst' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'needs_information')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const [needsInformation] = await transaction
          .update(schema.creditApplications)
          .set({ status: 'needs_information', version: nextVersion })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!needsInformation) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'information_requested',
          fromStatus: current.status,
          toStatus: 'needs_information',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'credit_application.information_requested',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: needsInformation };
      });
    },

    async recommend(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(eq(schema.creditApplications.id, input.applicationId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.assignedAnalystUserId !== input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'not_assigned_analyst');
          return { ok: false as const, reason: 'not_assigned_analyst' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'recommended')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const recommendedAt = clock();
        const [recommended] = await transaction
          .update(schema.creditApplications)
          .set({
            status: 'recommended',
            version: nextVersion,
            recommendationNarrative: input.recommendationNarrative,
            recommendedAmount: input.recommendedAmount,
            recommendedTermMonths: input.recommendedTermMonths,
            recommendedByUserId: input.reviewerUserId,
            recommendedAt,
          })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!recommended) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'recommended',
          fromStatus: current.status,
          toStatus: 'recommended',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          occurredAt: recommendedAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'credit_application.recommended',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: recommended };
      });
    },

    async approve(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(eq(schema.creditApplications.id, input.applicationId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.recommendedByUserId === input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'same_actor_as_recommendation');
          return { ok: false as const, reason: 'same_actor_as_recommendation' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'approved')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const decidedAt = clock();
        const [approved] = await transaction
          .update(schema.creditApplications)
          .set({
            status: 'approved',
            version: nextVersion,
            decidedByUserId: input.reviewerUserId,
            decidedAt,
            decisionReason: input.reason,
            approvedAmount: input.approvedAmount,
            approvedTermMonths: input.approvedTermMonths,
          })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!approved) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'approved',
          fromStatus: current.status,
          toStatus: 'approved',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          reason: input.reason,
          occurredAt: decidedAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'credit_application.approved',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: approved };
      });
    },

    async reject(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.creditApplications)
          .where(eq(schema.creditApplications.id, input.applicationId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };

        // Two authorization shapes depending on how far the application has
        // gotten: an early rejection (still `in_review`) is the assigned
        // analyst's own call; a rejection after a recommendation exists is
        // the same dual-control rule `approve` uses.
        if (current.status === 'recommended') {
          if (current.recommendedByUserId === input.reviewerUserId) {
            await recordReviewDenial(transaction, input, current, 'same_actor_as_recommendation');
            return { ok: false as const, reason: 'same_actor_as_recommendation' as const };
          }
        } else if (current.assignedAnalystUserId !== input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'not_assigned_analyst');
          return { ok: false as const, reason: 'not_assigned_analyst' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionCreditApplication(current.status, 'rejected')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const decidedAt = clock();
        const [rejected] = await transaction
          .update(schema.creditApplications)
          .set({
            status: 'rejected',
            version: nextVersion,
            decidedByUserId: input.reviewerUserId,
            decidedAt,
            decisionReason: input.reason,
          })
          .where(
            and(
              eq(schema.creditApplications.id, current.id),
              eq(schema.creditApplications.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!rejected) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.creditApplicationEvents).values({
          applicationId: current.id,
          eventType: 'rejected',
          fromStatus: current.status,
          toStatus: 'rejected',
          applicationVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          reason: input.reason,
          occurredAt: decidedAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'credit_application.rejected',
          outcome: 'succeeded',
          resourceType: 'credit_application',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { fromStatus: current.status, fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, application: rejected };
      });
    },
  };
}
