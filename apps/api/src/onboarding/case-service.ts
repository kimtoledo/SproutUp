import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import type { OnboardingCaseStatus, OnboardingCaseType, RoleKey } from '@sproutup/shared';
import { canTransitionOnboardingCase } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

type CaseFailure =
  | 'duplicate_open_case'
  | 'not_found'
  | 'stale_version'
  | 'invalid_transition'
  | 'already_approved';

const openCaseStatuses: OnboardingCaseStatus[] = [
  'draft',
  'submitted',
  'in_review',
  'needs_information',
];

/**
 * Where an applicant stands for one journey, derived from their most recent
 * case. Downstream domains (campaigns, commitments, disbursement) gate on this
 * rather than reading case rows directly.
 * - `none`     — no case, or the last one was withdrawn/rejected (may restart)
 * - `pending`  — a case is open and not yet decided
 * - `approved` — the last case was approved and is still in force
 * - `expired`  — a previously approved case has lapsed (must re-onboard)
 */
export type PartyEligibilityStatus = 'none' | 'pending' | 'approved' | 'expired';

export interface PartyEligibility {
  journey: OnboardingCaseType;
  status: PartyEligibilityStatus;
  caseId: string | null;
  decidedAt: Date | null;
}

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
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: CaseFailure }>;
  submit(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    allowedCaseTypes: OnboardingCaseType[];
    caseId: string;
    expectedVersion: number;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: CaseFailure }>;
  withdraw(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    allowedCaseTypes: OnboardingCaseType[];
    caseId: string;
    expectedVersion: number;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: CaseFailure }>;
  reopen(input: {
    applicantUserId: string;
    actorRoles: RoleKey[];
    allowedCaseTypes: OnboardingCaseType[];
    caseId: string;
    expectedVersion: number;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; case: OnboardingCaseSummary } | { ok: false; reason: CaseFailure }>;
  eligibility(userId: string, journey: OnboardingCaseType): Promise<PartyEligibility>;
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
        const [approvedCase] = await transaction
          .select({ id: schema.onboardingCases.id })
          .from(schema.onboardingCases)
          .where(
            and(
              eq(schema.onboardingCases.applicantUserId, input.applicantUserId),
              eq(schema.onboardingCases.caseType, input.caseType),
              eq(schema.onboardingCases.status, 'approved'),
            ),
          )
          .limit(1);
        if (approvedCase) return { ok: false as const, reason: 'already_approved' as const };

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
          ipAddressHash: input.ipAddressHash,
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
          ipAddressHash: input.ipAddressHash,
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
          ipAddressHash: input.ipAddressHash,
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

    async reopen(input) {
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
        if (!canTransitionOnboardingCase(current.status, 'draft')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }
        // A terminal case can only be reopened when no other case for this
        // journey is currently open (the DB one-open-journey index is the final
        // guard; this returns a clean conflict first).
        const [{ value: openElsewhere }] = await transaction
          .select({ value: count() })
          .from(schema.onboardingCases)
          .where(
            and(
              eq(schema.onboardingCases.applicantUserId, input.applicantUserId),
              eq(schema.onboardingCases.caseType, current.caseType),
              inArray(schema.onboardingCases.status, openCaseStatuses),
              ne(schema.onboardingCases.id, current.id),
            ),
          );
        if (openElsewhere > 0) {
          return { ok: false as const, reason: 'duplicate_open_case' as const };
        }

        const nextVersion = current.version + 1;
        const [reopened] = await transaction
          .update(schema.onboardingCases)
          .set({
            status: 'draft',
            version: nextVersion,
            assignedReviewerUserId: null,
            decidedAt: null,
          })
          .where(
            and(
              eq(schema.onboardingCases.id, current.id),
              eq(schema.onboardingCases.version, input.expectedVersion),
            ),
          )
          .returning(summarySelection);
        if (!reopened) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.onboardingCaseEvents).values({
          caseId: current.id,
          eventType: 'reopened',
          fromStatus: current.status,
          toStatus: 'draft',
          caseVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.applicantUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.applicantUserId,
          actorRoles: input.actorRoles,
          action: 'onboarding_case.reopened',
          outcome: 'succeeded',
          resourceType: 'onboarding_case',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: {
            caseType: current.caseType,
            fromStatus: current.status,
            fromVersion: current.version,
            toVersion: nextVersion,
          },
        });
        return { ok: true as const, case: reopened };
      });
    },

    async eligibility(userId, journey) {
      const [latest] = await database
        .select({
          id: schema.onboardingCases.id,
          status: schema.onboardingCases.status,
          decidedAt: schema.onboardingCases.decidedAt,
        })
        .from(schema.onboardingCases)
        .where(
          and(
            eq(schema.onboardingCases.applicantUserId, userId),
            eq(schema.onboardingCases.caseType, journey),
          ),
        )
        .orderBy(desc(schema.onboardingCases.createdAt), desc(schema.onboardingCases.id))
        .limit(1);

      if (!latest || latest.status === 'withdrawn' || latest.status === 'rejected') {
        return { journey, status: 'none', caseId: latest?.id ?? null, decidedAt: null };
      }
      if (latest.status === 'approved') {
        return { journey, status: 'approved', caseId: latest.id, decidedAt: latest.decidedAt };
      }
      if (latest.status === 'expired') {
        return { journey, status: 'expired', caseId: latest.id, decidedAt: latest.decidedAt };
      }
      return { journey, status: 'pending', caseId: latest.id, decidedAt: null };
    },
  };
}
