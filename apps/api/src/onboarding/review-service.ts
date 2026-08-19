import { and, asc, count, eq, type SQL } from 'drizzle-orm';
import { canTransitionOnboardingCase, type OnboardingCaseStatus, type OnboardingCaseType, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';
import type { OnboardingCaseSummary } from './case-service.js';

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
  startReview(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    caseId: string;
    expectedVersion: number;
    requestId: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: ReviewFailure }>;
  requestInformation(input: {
    reviewerUserId: string;
    reviewerRoles: RoleKey[];
    caseId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: ReviewFailure | 'not_assigned_reviewer' }>;
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

export function createOnboardingReviewService(database: Database): OnboardingReviewService {
  return {
    async list(input) {
      const filters: SQL[] = [];
      if (input.caseType) filters.push(eq(schema.onboardingCases.caseType, input.caseType));
      if (input.status) filters.push(eq(schema.onboardingCases.status, input.status));
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
          return { ok: false as const, reason: 'self_review_not_allowed' as const };
        }
        if (
          current.assignedReviewerUserId &&
          current.assignedReviewerUserId !== input.reviewerUserId
        ) {
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
          return { ok: false as const, reason: 'self_review_not_allowed' as const };
        }
        if (current.assignedReviewerUserId !== input.reviewerUserId) {
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
          reason: input.reason,
          metadata: { caseType: current.caseType, fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, case: needsInformation };
      });
    },
  };
}
