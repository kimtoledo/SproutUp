import { and, asc, count, eq } from 'drizzle-orm';
import {
  formatLoanSchedule,
  generateLoanSchedule,
  parsePhpMoney,
  type LoanSchedule,
  type RepaymentModel,
  type RoleKey,
} from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

export type CampaignFailure =
  | 'credit_application_not_found'
  | 'credit_application_not_approved'
  | 'loan_amount_exceeds_approved'
  | 'open_campaign_exists'
  | 'campaign_not_found'
  | 'stale_version'
  | 'campaign_not_editable'
  | 'invalid_transition'
  | 'same_actor_as_submission';

type CampaignStatus = 'draft' | 'pending_approval' | 'published' | 'cancelled';

const transitions: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['published', 'draft', 'cancelled'],
  published: ['cancelled'],
  cancelled: [],
};
function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return transitions[from].includes(to);
}

export interface CampaignSummary {
  id: string;
  creditApplicationId: string;
  borrowerCaseId: string;
  status: CampaignStatus;
  version: number;
  loanAmount: string;
  termMonths: number;
  repaymentModel: RepaymentModel;
  borrowerAnnualRatePercent: string;
  investorAnnualRatePercent: string;
  minimumCommitmentAmount: string;
  fundingWindowDays: number;
  firstRepaymentDueDate: string;
  purposeSummary: string;
  createdByUserId: string;
  submittedByUserId: string | null;
  submittedAt: Date | null;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  cancelledByUserId: string | null;
  cancelledAt: Date | null;
  decisionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignFields {
  loanAmount: string;
  termMonths: number;
  repaymentModel: RepaymentModel;
  borrowerAnnualRatePercent: string;
  investorAnnualRatePercent: string;
  minimumCommitmentAmount: string;
  fundingWindowDays: number;
  firstRepaymentDueDate: string;
  purposeSummary: string;
}

export interface CreateCampaignInput extends CampaignFields {
  creatorUserId: string;
  creatorRoles: RoleKey[];
  creditApplicationId: string;
  requestId: string;
  ipAddressHash?: string;
}

export interface UpdateCampaignInput extends CampaignFields {
  actorUserId: string;
  actorRoles: RoleKey[];
  campaignId: string;
  expectedVersion: number;
  requestId: string;
  ipAddressHash?: string;
}

interface TransitionInput {
  actorUserId: string;
  actorRoles: RoleKey[];
  campaignId: string;
  expectedVersion: number;
  requestId: string;
  ipAddressHash?: string;
}

export type CampaignResult =
  | { ok: true; campaign: CampaignSummary }
  | { ok: false; reason: CampaignFailure };

export interface CampaignService {
  list(input: { page: number; pageSize: number; status?: CampaignStatus }): Promise<{
    campaigns: CampaignSummary[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  detail(campaignId: string): Promise<
    (CampaignSummary & { schedule: ReturnType<typeof formatLoanSchedule>; events: Array<Record<string, unknown>> })
    | null
  >;
  create(input: CreateCampaignInput): Promise<CampaignResult>;
  update(input: UpdateCampaignInput): Promise<CampaignResult>;
  submit(input: TransitionInput): Promise<CampaignResult>;
  publish(input: TransitionInput): Promise<CampaignResult>;
  sendBack(input: TransitionInput & { reason: string }): Promise<CampaignResult>;
  cancel(input: TransitionInput & { reason: string }): Promise<CampaignResult>;
}

const summarySelection = {
  id: schema.campaigns.id,
  creditApplicationId: schema.campaigns.creditApplicationId,
  borrowerCaseId: schema.campaigns.borrowerCaseId,
  status: schema.campaigns.status,
  version: schema.campaigns.version,
  loanAmount: schema.campaigns.loanAmount,
  termMonths: schema.campaigns.termMonths,
  repaymentModel: schema.campaigns.repaymentModel,
  borrowerAnnualRatePercent: schema.campaigns.borrowerAnnualRatePercent,
  investorAnnualRatePercent: schema.campaigns.investorAnnualRatePercent,
  minimumCommitmentAmount: schema.campaigns.minimumCommitmentAmount,
  fundingWindowDays: schema.campaigns.fundingWindowDays,
  firstRepaymentDueDate: schema.campaigns.firstRepaymentDueDate,
  purposeSummary: schema.campaigns.purposeSummary,
  createdByUserId: schema.campaigns.createdByUserId,
  submittedByUserId: schema.campaigns.submittedByUserId,
  submittedAt: schema.campaigns.submittedAt,
  publishedByUserId: schema.campaigns.publishedByUserId,
  publishedAt: schema.campaigns.publishedAt,
  cancelledByUserId: schema.campaigns.cancelledByUserId,
  cancelledAt: schema.campaigns.cancelledAt,
  decisionReason: schema.campaigns.decisionReason,
  createdAt: schema.campaigns.createdAt,
  updatedAt: schema.campaigns.updatedAt,
};

function computeSchedule(campaign: CampaignSummary): LoanSchedule {
  return generateLoanSchedule({
    principal: parsePhpMoney(campaign.loanAmount),
    annualRatePercent: campaign.borrowerAnnualRatePercent,
    termMonths: campaign.termMonths,
    repaymentModel: campaign.repaymentModel,
    firstDueDate: campaign.firstRepaymentDueDate,
  });
}

const editableStatuses = new Set<CampaignStatus>(['draft']);

export function createCampaignService(database: Database, clock: () => Date = () => new Date()): CampaignService {
  return {
    async list(input) {
      const where = input.status ? eq(schema.campaigns.status, input.status) : undefined;
      const [[totalRow], campaigns] = await Promise.all([
        database.select({ value: count() }).from(schema.campaigns).where(where),
        database
          .select(summarySelection)
          .from(schema.campaigns)
          .where(where)
          .orderBy(asc(schema.campaigns.createdAt), asc(schema.campaigns.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
      ]);
      return { campaigns, page: input.page, pageSize: input.pageSize, total: totalRow?.value ?? 0 };
    },

    async detail(campaignId) {
      const [campaign] = await database
        .select(summarySelection)
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, campaignId))
        .limit(1);
      if (!campaign) return null;

      const events = await database
        .select({
          id: schema.campaignEvents.id,
          eventType: schema.campaignEvents.eventType,
          fromStatus: schema.campaignEvents.fromStatus,
          toStatus: schema.campaignEvents.toStatus,
          campaignVersion: schema.campaignEvents.campaignVersion,
          actorType: schema.campaignEvents.actorType,
          actorUserId: schema.campaignEvents.actorUserId,
          reason: schema.campaignEvents.reason,
          occurredAt: schema.campaignEvents.occurredAt,
        })
        .from(schema.campaignEvents)
        .where(eq(schema.campaignEvents.campaignId, campaign.id))
        .orderBy(asc(schema.campaignEvents.occurredAt), asc(schema.campaignEvents.id));

      return { ...campaign, schedule: formatLoanSchedule(computeSchedule(campaign)), events };
    },

    async create(input) {
      return database.transaction(async (transaction) => {
        const [creditApplication] = await transaction
          .select({
            status: schema.creditApplications.status,
            borrowerCaseId: schema.creditApplications.borrowerCaseId,
            approvedAmount: schema.creditApplications.approvedAmount,
            requestedAmount: schema.creditApplications.requestedAmount,
          })
          .from(schema.creditApplications)
          .where(eq(schema.creditApplications.id, input.creditApplicationId))
          .limit(1);
        if (!creditApplication) return { ok: false as const, reason: 'credit_application_not_found' as const };
        if (creditApplication.status !== 'approved') {
          return { ok: false as const, reason: 'credit_application_not_approved' as const };
        }
        const approvedCeiling = creditApplication.approvedAmount ?? creditApplication.requestedAmount;
        if (parsePhpMoney(input.loanAmount).minorUnits > parsePhpMoney(approvedCeiling).minorUnits) {
          return { ok: false as const, reason: 'loan_amount_exceeds_approved' as const };
        }

        const [created] = await transaction
          .insert(schema.campaigns)
          .values({
            creditApplicationId: input.creditApplicationId,
            borrowerCaseId: creditApplication.borrowerCaseId,
            createdByUserId: input.creatorUserId,
            loanAmount: input.loanAmount,
            termMonths: input.termMonths,
            repaymentModel: input.repaymentModel,
            borrowerAnnualRatePercent: input.borrowerAnnualRatePercent,
            investorAnnualRatePercent: input.investorAnnualRatePercent,
            minimumCommitmentAmount: input.minimumCommitmentAmount,
            fundingWindowDays: input.fundingWindowDays,
            firstRepaymentDueDate: input.firstRepaymentDueDate,
            purposeSummary: input.purposeSummary,
          })
          // No explicit target: the arbiter is the partial one-open-per-application
          // unique index (see the same pattern in credit/application-service.ts).
          .onConflictDoNothing()
          .returning(summarySelection);
        if (!created) return { ok: false as const, reason: 'open_campaign_exists' as const };

        await transaction.insert(schema.campaignEvents).values({
          campaignId: created.id,
          eventType: 'created',
          toStatus: 'draft',
          campaignVersion: created.version,
          actorType: 'user',
          actorUserId: input.creatorUserId,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.creatorUserId,
          actorRoles: input.creatorRoles,
          action: 'campaign.created',
          outcome: 'succeeded',
          resourceType: 'campaign',
          resourceId: created.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { creditApplicationId: input.creditApplicationId, loanAmount: input.loanAmount },
        });
        return { ok: true as const, campaign: created };
      });
    },

    async update(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, input.campaignId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'campaign_not_found' as const };
        if (!editableStatuses.has(current.status)) {
          return { ok: false as const, reason: 'campaign_not_editable' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }

        const nextVersion = current.version + 1;
        const [updated] = await transaction
          .update(schema.campaigns)
          .set({
            loanAmount: input.loanAmount,
            termMonths: input.termMonths,
            repaymentModel: input.repaymentModel,
            borrowerAnnualRatePercent: input.borrowerAnnualRatePercent,
            investorAnnualRatePercent: input.investorAnnualRatePercent,
            minimumCommitmentAmount: input.minimumCommitmentAmount,
            fundingWindowDays: input.fundingWindowDays,
            firstRepaymentDueDate: input.firstRepaymentDueDate,
            purposeSummary: input.purposeSummary,
            version: nextVersion,
          })
          .where(
            and(eq(schema.campaigns.id, current.id), eq(schema.campaigns.version, input.expectedVersion)),
          )
          .returning(summarySelection);
        if (!updated) return { ok: false as const, reason: 'stale_version' as const };

        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'campaign.updated',
          outcome: 'succeeded',
          resourceType: 'campaign',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, campaign: updated };
      });
    },

    async submit(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, input.campaignId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'campaign_not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransition(current.status, 'pending_approval')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const submittedAt = clock();
        const [submitted] = await transaction
          .update(schema.campaigns)
          .set({
            status: 'pending_approval',
            version: nextVersion,
            submittedByUserId: input.actorUserId,
            submittedAt,
          })
          .where(
            and(eq(schema.campaigns.id, current.id), eq(schema.campaigns.version, input.expectedVersion)),
          )
          .returning(summarySelection);
        if (!submitted) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.campaignEvents).values({
          campaignId: current.id,
          eventType: 'submitted',
          fromStatus: current.status,
          toStatus: 'pending_approval',
          campaignVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.actorUserId,
          occurredAt: submittedAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'campaign.submitted',
          outcome: 'succeeded',
          resourceType: 'campaign',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, campaign: submitted };
      });
    },

    async publish(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, input.campaignId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'campaign_not_found' as const };
        if (current.submittedByUserId === input.actorUserId) {
          await writeAudit(transaction, {
            actorType: 'user',
            actorUserId: input.actorUserId,
            actorRoles: input.actorRoles,
            action: 'campaign.publish_denied',
            outcome: 'denied',
            resourceType: 'campaign',
            resourceId: current.id,
            requestId: input.requestId,
            ipAddressHash: input.ipAddressHash,
            reason: 'same_actor_as_submission',
            metadata: { status: current.status },
          });
          return { ok: false as const, reason: 'same_actor_as_submission' as const };
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransition(current.status, 'published')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const publishedAt = clock();
        const [published] = await transaction
          .update(schema.campaigns)
          .set({
            status: 'published',
            version: nextVersion,
            publishedByUserId: input.actorUserId,
            publishedAt,
          })
          .where(
            and(eq(schema.campaigns.id, current.id), eq(schema.campaigns.version, input.expectedVersion)),
          )
          .returning(summarySelection);
        if (!published) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.campaignEvents).values({
          campaignId: current.id,
          eventType: 'published',
          fromStatus: current.status,
          toStatus: 'published',
          campaignVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.actorUserId,
          occurredAt: publishedAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'campaign.published',
          outcome: 'succeeded',
          resourceType: 'campaign',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, campaign: published };
      });
    },

    async sendBack(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, input.campaignId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'campaign_not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransition(current.status, 'draft')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const [sentBack] = await transaction
          .update(schema.campaigns)
          .set({
            status: 'draft',
            version: nextVersion,
            submittedByUserId: null,
            submittedAt: null,
            decisionReason: input.reason,
          })
          .where(
            and(eq(schema.campaigns.id, current.id), eq(schema.campaigns.version, input.expectedVersion)),
          )
          .returning(summarySelection);
        if (!sentBack) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.campaignEvents).values({
          campaignId: current.id,
          eventType: 'sent_back',
          fromStatus: current.status,
          toStatus: 'draft',
          campaignVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.actorUserId,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'campaign.sent_back',
          outcome: 'succeeded',
          resourceType: 'campaign',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, campaign: sentBack };
      });
    },

    async cancel(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, input.campaignId))
          .limit(1)
          .for('update');
        if (!current) return { ok: false as const, reason: 'campaign_not_found' as const };
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, reason: 'stale_version' as const };
        }
        if (!canTransition(current.status, 'cancelled')) {
          return { ok: false as const, reason: 'invalid_transition' as const };
        }

        const nextVersion = current.version + 1;
        const cancelledAt = clock();
        const [cancelled] = await transaction
          .update(schema.campaigns)
          .set({
            status: 'cancelled',
            version: nextVersion,
            cancelledByUserId: input.actorUserId,
            cancelledAt,
            decisionReason: input.reason,
          })
          .where(
            and(eq(schema.campaigns.id, current.id), eq(schema.campaigns.version, input.expectedVersion)),
          )
          .returning(summarySelection);
        if (!cancelled) return { ok: false as const, reason: 'stale_version' as const };

        await transaction.insert(schema.campaignEvents).values({
          campaignId: current.id,
          eventType: 'cancelled',
          fromStatus: current.status,
          toStatus: 'cancelled',
          campaignVersion: nextVersion,
          actorType: 'user',
          actorUserId: input.actorUserId,
          reason: input.reason,
          occurredAt: cancelledAt,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'campaign.cancelled',
          outcome: 'succeeded',
          resourceType: 'campaign',
          resourceId: current.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { fromStatus: current.status, fromVersion: current.version, toVersion: nextVersion },
        });
        return { ok: true as const, campaign: cancelled };
      });
    },
  };
}
