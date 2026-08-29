import { and, asc, count, eq, inArray, type SQL } from 'drizzle-orm';
import { canTransitionOnboardingCase, type OnboardingCaseStatus, type OnboardingCaseType, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type AuditWriterDatabase, type Database } from '@sproutup/db';
import type { OnboardingCaseSummary } from './case-service.js';

// A case only enters the compliance queue once the applicant submits it. Drafts
// (never submitted) and withdrawn cases are hidden unless a reviewer asks for
// that exact status.
const queueVisibleStatuses: OnboardingCaseStatus[] = [
  'submitted',
  'in_review',
  'needs_information',
  'approved',
  'rejected',
  'expired',
];

type ReviewFailure =
  | 'not_found'
  | 'self_review_not_allowed'
  | 'assigned_to_other'
  | 'stale_version'
  | 'invalid_transition';

export interface OnboardingReviewService {
  list(input: {
    page: number;
    pageSize: number;
    caseType?: OnboardingCaseType;
    status?: OnboardingCaseStatus;
    reviewerUserId?: string;
  }): Promise<{ cases: Array<OnboardingCaseSummary & { applicantName: string; applicantEmail: string }>; page: number; pageSize: number; total: number }>;
  detail(caseId: string): Promise<
    | (OnboardingCaseSummary & {
        applicantUserId: string;
        applicantName: string;
        applicantEmail: string;
        events: Array<Record<string, unknown>>;
      })
    | null
  >;
  startReview(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    caseId: string;
    expectedVersion: number;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: ReviewFailure }>;
  requestInformation(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    caseId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: ReviewFailure | 'not_assigned_reviewer' }>;
  reject(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    caseId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: ReviewFailure | 'not_assigned_reviewer' }>;
  approve(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    caseId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: ReviewFailure | 'not_assigned_reviewer' }>;
}

/**
 * Records a separation-of-duties denial (self-review, cross-reviewer takeover)
 * as immutable evidence. Written inside the caller's transaction, which still
 * commits because the caller returns rather than throws.
 */
async function recordReviewDenial(
  transaction: AuditWriterDatabase,
  input: { reviewerUserId: string; reviewerRoles: RoleKey[]; requestId: string; ipAddressHash?: string },
  caseRow: { id: string; caseType: OnboardingCaseType; status: OnboardingCaseStatus },
  reason: string,
): Promise<void> {
  await writeAudit(transaction, {
    actorType: 'user',
    actorUserId: input.reviewerUserId,
    actorRoles: input.reviewerRoles,
    action: 'onboarding_case.review_denied',
    outcome: 'denied',
    resourceType: 'onboarding_case',
    resourceId: caseRow.id,
    requestId: input.requestId,
    ipAddressHash: input.ipAddressHash,
    reason,
    metadata: { caseType: caseRow.caseType, status: caseRow.status },
  });
}

const summarySelection = {
  id: schema.onboardingCases.id,
  caseType: schema.onboardingCases.caseType,
  status: schema.onboardingCases.status,
  version: schema.onboardingCases.version,
  assignedReviewerUserId: schema.onboardingCases.assignedReviewerUserId,
  submittedAt: schema.onboardingCases.submittedAt,
  decidedAt: schema.onboardingCases.decidedAt,
  createdAt: schema.onboardingCases.createdAt,
  updatedAt: schema.onboardingCases.updatedAt,
};

export function createOnboardingReviewService(
  database: Database,
  clock: () => Date = () => new Date(),
): OnboardingReviewService {
  return {
    async list(input) {
      const filters: SQL[] = [];
      if (input.caseType) filters.push(eq(schema.onboardingCases.caseType, input.caseType));
      if (input.status) {
        filters.push(eq(schema.onboardingCases.status, input.status));
      } else {
        filters.push(inArray(schema.onboardingCases.status, queueVisibleStatuses));
      }
      if (input.reviewerUserId) {
        filters.push(eq(schema.onboardingCases.assignedReviewerUserId, input.reviewerUserId));
      }
      const where = filters.length > 0 ? and(...filters) : undefined;
      const [[totalRow], cases] = await Promise.all([
        database.select({ value: count() }).from(schema.onboardingCases).where(where),
        database
          .select({
            ...summarySelection,
            applicantName: schema.users.name,
            applicantEmail: schema.users.email,
          })
          .from(schema.onboardingCases)
          .innerJoin(schema.users, eq(schema.onboardingCases.applicantUserId, schema.users.id))
          .where(where)
          .orderBy(asc(schema.onboardingCases.createdAt), asc(schema.onboardingCases.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
      ]);
      return { cases, page: input.page, pageSize: input.pageSize, total: totalRow?.value ?? 0 };
    },

    async detail(caseId) {
      const [onboardingCase] = await database
        .select({
          ...summarySelection,
          applicantUserId: schema.onboardingCases.applicantUserId,
          applicantName: schema.users.name,
          applicantEmail: schema.users.email,
        })
        .from(schema.onboardingCases)
        .innerJoin(schema.users, eq(schema.onboardingCases.applicantUserId, schema.users.id))
        .where(eq(schema.onboardingCases.id, caseId))
        .limit(1);
      if (!onboardingCase) return null;

      const events = await database
        .select({
          id: schema.onboardingCaseEvents.id,
          eventType: schema.onboardingCaseEvents.eventType,
          fromStatus: schema.onboardingCaseEvents.fromStatus,
          toStatus: schema.onboardingCaseEvents.toStatus,
          caseVersion: schema.onboardingCaseEvents.caseVersion,
          actorType: schema.onboardingCaseEvents.actorType,
          actorUserId: schema.onboardingCaseEvents.actorUserId,
          reason: schema.onboardingCaseEvents.reason,
          occurredAt: schema.onboardingCaseEvents.occurredAt,
        })
        .from(schema.onboardingCaseEvents)
        .where(eq(schema.onboardingCaseEvents.caseId, onboardingCase.id))
        .orderBy(asc(schema.onboardingCaseEvents.occurredAt), asc(schema.onboardingCaseEvents.id));
      return { ...onboardingCase, events };
    },

    async startReview(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.onboardingCases)
          .where(eq(schema.onboardingCases.id, input.caseId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.applicantUserId === input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'self_review_not_allowed');
          return { ok: false as const, reason: 'self_review_not_allowed' as const };
        }
        if (
          current.assignedReviewerUserId &&
          current.assignedReviewerUserId !== input.reviewerUserId
        ) {
          await recordReviewDenial(transaction, input, current, 'assigned_to_other');
          return { ok: false as const, reason: 'assigned_to_other' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionOnboardingCase(current.status, 'in_review')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const [reviewing] = await transaction
          .update(schema.onboardingCases)
          .set({
            status: 'in_review',
            version: nextVersion,
            assignedReviewerUserId: input.reviewerUserId,
          })
          .where(
            and(
              eq(schema.onboardingCases.id, current.id),
              eq(schema.onboardingCases.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!reviewing) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: current.id,
          eventType: 'review_started',
          fromStatus: current.status,
          toStatus: 'in_review',
          caseVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'onboarding_case.review_started',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { caseType: current.caseType, fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, case: reviewing };
      });
    },

    async requestInformation(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.onboardingCases)
          .where(eq(schema.onboardingCases.id, input.caseId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.applicantUserId === input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'self_review_not_allowed');
          return { ok: false as const, reason: 'self_review_not_allowed' as const };
        }
        if (current.assignedReviewerUserId !== input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'not_assigned_reviewer');
          return { ok: false as const, reason: 'not_assigned_reviewer' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionOnboardingCase(current.status, 'needs_information')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const [needsInformation] = await transaction
          .update(schema.onboardingCases)
          .set({ status: 'needs_information', version: nextVersion })
          .where(
            and(
              eq(schema.onboardingCases.id, current.id),
              eq(schema.onboardingCases.version, input.expectedVersion),
              eq(schema.onboardingCases.assignedReviewerUserId, input.reviewerUserId),
            ),
          )
          .returning(summarySelection);
        if (!needsInformation) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: current.id,
          eventType: 'information_requested',
          fromStatus: current.status,
          toStatus: 'needs_information',
          caseVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'onboarding_case.information_requested',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { caseType: current.caseType, fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, case: needsInformation };
      });
    },

    async reject(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.onboardingCases)
          .where(eq(schema.onboardingCases.id, input.caseId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.applicantUserId === input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'self_review_not_allowed');
          return { ok: false as const, reason: 'self_review_not_allowed' as const };
        }
        if (current.assignedReviewerUserId !== input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'not_assigned_reviewer');
          return { ok: false as const, reason: 'not_assigned_reviewer' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionOnboardingCase(current.status, 'rejected')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const decidedAt = clock();
        const [rejected] = await transaction
          .update(schema.onboardingCases)
          .set({ status: 'rejected', version: nextVersion, decidedAt })
          .where(
            and(
              eq(schema.onboardingCases.id, current.id),
              eq(schema.onboardingCases.version, input.expectedVersion),
              eq(schema.onboardingCases.assignedReviewerUserId, input.reviewerUserId),
            ),
          )
          .returning(summarySelection);
        if (!rejected) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: current.id,
          eventType: 'rejected',
          fromStatus: current.status,
          toStatus: 'rejected',
          caseVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          reason: input.reason,
          occurredAt: decidedAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'onboarding_case.rejected',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: {
            caseType: current.caseType,
            fromVersion: current.version,
            toVersion: nextVersion,
          },
        });
        return { ok: true as const, case: rejected };
      });
    },

    async approve(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.onboardingCases)
          .where(eq(schema.onboardingCases.id, input.caseId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.applicantUserId === input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'self_review_not_allowed');
          return { ok: false as const, reason: 'self_review_not_allowed' as const };
        }
        if (current.assignedReviewerUserId !== input.reviewerUserId) {
          await recordReviewDenial(transaction, input, current, 'not_assigned_reviewer');
          return { ok: false as const, reason: 'not_assigned_reviewer' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionOnboardingCase(current.status, 'approved')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const decidedAt = clock();
        const [approved] = await transaction
          .update(schema.onboardingCases)
          .set({ status: 'approved', version: nextVersion, decidedAt })
          .where(
            and(
              eq(schema.onboardingCases.id, current.id),
              eq(schema.onboardingCases.version, input.expectedVersion),
              eq(schema.onboardingCases.assignedReviewerUserId, input.reviewerUserId),
            ),
          )
          .returning(summarySelection);
        if (!approved) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: current.id,
          eventType: 'approved',
          fromStatus: current.status,
          toStatus: 'approved',
          caseVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          reason: input.reason,
          occurredAt: decidedAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.reviewerUserId,
          actorRoles: input.reviewerRoles,
          action: 'onboarding_case.approved',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: {
            caseType: current.caseType,
            fromVersion: current.version,
            toVersion: nextVersion,
          },
        });
        return { ok: true as const, case: approved };
      });
    },
  };
}
