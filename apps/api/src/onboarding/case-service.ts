import { and, asc, eq, inArray } from 'drizzle-orm';
import type { OnboardingCaseStatus, OnboardingCaseType, RoleKey } from '@sproutup/shared';
import { canTransitionOnboardingCase } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

type CaseFailure = 'duplicate_open_case' | 'not_found' | 'stale_version' | 'invalid_transition';

export interface OnboardingCaseSummary {
  id: string;
  caseType: OnboardingCaseType;
  status: OnboardingCaseStatus;
  version: number;
  assignedReviewerUserId: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingCaseService {
  listOwn(userId: string, allowedCaseTypes: OnboardingCaseType[]): Promise<OnboardingCaseSummary[]>;
  detailOwn(
    userId: string,
    caseId: string,
    allowedCaseTypes: OnboardingCaseType[],
  ): Promise<(OnboardingCaseSummary & { events: Array<Record<string, unknown>> }) | null>;
  create(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    caseType: OnboardingCaseType;
    requestId: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: CaseFailure }>;
  submit(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    allowedCaseTypes: OnboardingCaseType[];
    caseId: string;
    expectedVersion: number;
    requestId: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: CaseFailure }>;
  withdraw(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    allowedCaseTypes: OnboardingCaseType[];
    caseId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: CaseFailure }>;
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

export function createOnboardingCaseService(
  database: Database,
  clock: () => Date = () => new Date(),
): OnboardingCaseService {
  return {
    async listOwn(userId, allowedCaseTypes) {
      if (allowedCaseTypes.length === 0) return [];
      return database
        .select(summarySelection)
        .from(schema.onboardingCases)
        .where(
          and(
            eq(schema.onboardingCases.applicantUserId, userId),
            inArray(schema.onboardingCases.caseType, allowedCaseTypes),
          ),
        )
        .orderBy(asc(schema.onboardingCases.createdAt), asc(schema.onboardingCases.id));
    },

    async detailOwn(userId, caseId, allowedCaseTypes) {
      if (allowedCaseTypes.length === 0) return null;
      const [onboardingCase] = await database
        .select(summarySelection)
        .from(schema.onboardingCases)
        .where(
          and(
            eq(schema.onboardingCases.id, caseId),
            eq(schema.onboardingCases.applicantUserId, userId),
            inArray(schema.onboardingCases.caseType, allowedCaseTypes),
          ),
        )
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

    async create(input) {
      return database.transaction(async (transaction) => {
        const [onboardingCase] = await transaction
          .insert(schema.onboardingCases)
          .values({ caseType: input.caseType, applicantUserId: input.applicantUserId })
          .onConflictDoNothing()
          .returning(summarySelection);
        if (!onboardingCase) return { ok: false as const, reason: 'duplicate_open_case' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: onboardingCase.id,
          eventType: 'created',
          toStatus: 'draft',
          caseVersion: onboardingCase.version,
          actorType: 'user',
          actorUserId: input.applicantUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'onboarding_case.created',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: onboardingCase.id,
          requestId: input.requestId,
          metadata: { caseType: input.caseType, version: onboardingCase.version },
        });
        return { ok: true as const, case: onboardingCase };
      });
    },

    async submit(input) {
      if (input.allowedCaseTypes.length === 0) return { ok: false, reason: 'not_found' };
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.onboardingCases)
          .where(
            and(
              eq(schema.onboardingCases.id, input.caseId),
              eq(schema.onboardingCases.applicantUserId, input.applicantUserId),
              inArray(schema.onboardingCases.caseType, input.allowedCaseTypes),
            ),
          )
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionOnboardingCase(current.status, 'submitted')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const now = clock();
        const [submitted] = await transaction
          .update(schema.onboardingCases)
          .set({ status: 'submitted', version: nextVersion, submittedAt: now })
          .where(
            and(
              eq(schema.onboardingCases.id, current.id),
              eq(schema.onboardingCases.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!submitted) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: current.id,
          eventType: 'submitted',
          fromStatus: current.status,
          toStatus: 'submitted',
          caseVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.applicantUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'onboarding_case.submitted',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: current.id,
          requestId: input.requestId,
          metadata: { caseType: current.caseType, fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, case: submitted };
      });
    },

    async withdraw(input) {
      if (input.allowedCaseTypes.length === 0) return { ok: false, reason: 'not_found' };
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.onboardingCases)
          .where(
            and(
              eq(schema.onboardingCases.id, input.caseId),
              eq(schema.onboardingCases.applicantUserId, input.applicantUserId),
              inArray(schema.onboardingCases.caseType, input.allowedCaseTypes),
            ),
          )
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransitionOnboardingCase(current.status, 'withdrawn')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const [withdrawn] = await transaction
          .update(schema.onboardingCases)
          .set({ status: 'withdrawn', version: nextVersion })
          .where(
            and(
              eq(schema.onboardingCases.id, current.id),
              eq(schema.onboardingCases.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!withdrawn) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: current.id,
          eventType: 'withdrawn',
          fromStatus: current.status,
          toStatus: 'withdrawn',
          caseVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.applicantUserId,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'onboarding_case.withdrawn',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: current.id,
          requestId: input.requestId,
          reason: input.reason,
          metadata: {
            caseType: current.caseType,
            fromVersion: current.version,
            toVersion: nextVersion,
          },
        });
        return { ok: true as const, case: withdrawn };
      });
    },
  };
}
