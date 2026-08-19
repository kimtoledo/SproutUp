import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, gt, inArray, isNull, lt, lte } from 'drizzle-orm';
import { assertSafeAuditMetadata, schema, type Database } from '@sproutup/db';

const claimableStatuses = ['pending', 'retry_scheduled'] as const;

export interface ClaimedJob {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attemptNumber: number;
  maxAttempts: number;
  leaseExpiresAt: Date;
}

export interface EnqueueJobInput {
  topic: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
}

export type EnqueueJobResult =
  | { ok: true; created: boolean; jobId: string }
  | { ok: false; reason: 'idempotency_conflict' };

type JobEnqueueDatabase = Pick<Database, 'insert' | 'select'>;

export interface JobControlService {
  enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult>;
  claimBatch(input: {
    workerId: string;
    limit: number;
    leaseDurationMs: number;
  }): Promise<ClaimedJob[]>;
  heartbeat(input: {
    jobId: string;
    attemptNumber: number;
    workerId: string;
    leaseDurationMs: number;
  }): Promise<boolean>;
  succeed(input: {
    jobId: string;
    attemptNumber: number;
    workerId: string;
  }): Promise<boolean>;
  fail(input: {
    jobId: string;
    attemptNumber: number;
    workerId: string;
    errorCode: string;
    retryable: boolean;
  }): Promise<{ ok: true; status: 'retry_scheduled' | 'dead_lettered' } | { ok: false }>;
  recoverExpired(input: { limit: number }): Promise<number>;
  cancelUnclaimed(jobId: string): Promise<boolean>;
}

interface JobControlOptions {
  clock?: () => Date;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

function assertWorker(workerId: string, leaseDurationMs: number): void {
  if (workerId.length < 1 || workerId.length > 200) throw new Error('Invalid worker ID');
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 900_000) {
    throw new Error('Lease duration must be between 1 second and 15 minutes');
  }
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Job batch limit must be between 1 and 100');
  }
}

export async function enqueueDurableJob(
  database: JobEnqueueDatabase,
  input: EnqueueJobInput,
  now: Date = new Date(),
): Promise<EnqueueJobResult> {
  assertSafeAuditMetadata(input.payload, 'job.payload');
  if (input.topic.length < 1 || input.topic.length > 120) throw new Error('Invalid job topic');
  if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200) {
    throw new Error('Invalid job idempotency key');
  }

  const [created] = await database
    .insert(schema.backgroundJobs)
    .values({
      topic: input.topic,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? 10,
      availableAt: input.availableAt ?? now,
    })
    .onConflictDoNothing({ target: schema.backgroundJobs.idempotencyKey })
    .returning({ id: schema.backgroundJobs.id });
  if (created) return { ok: true, created: true, jobId: created.id };

  const [existing] = await database
    .select({
      id: schema.backgroundJobs.id,
      topic: schema.backgroundJobs.topic,
      payload: schema.backgroundJobs.payload,
    })
    .from(schema.backgroundJobs)
    .where(eq(schema.backgroundJobs.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!existing || existing.topic !== input.topic || !isDeepStrictEqual(existing.payload, input.payload)) {
    return { ok: false, reason: 'idempotency_conflict' };
  }
  return { ok: true, created: false, jobId: existing.id };
}

export function createJobControlService(
  database: Database,
  options: JobControlOptions = {},
): JobControlService {
  const clock = options.clock ?? (() => new Date());
  const baseRetryDelayMs = options.baseRetryDelayMs ?? 5_000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 15 * 60_000;
  if (baseRetryDelayMs < 1_000 || maxRetryDelayMs < baseRetryDelayMs) {
    throw new Error('Invalid retry backoff configuration');
  }

  return {
    async enqueue(input) {
      return database.transaction(
        async (transaction) => enqueueDurableJob(transaction, input, clock()),
      );
    },

    async claimBatch(input) {
      assertWorker(input.workerId, input.leaseDurationMs);
      assertLimit(input.limit);
      const now = clock();
      const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);

      return database.transaction(async (transaction) => {
        const jobs = await transaction
          .select()
          .from(schema.backgroundJobs)
          .where(and(
            inArray(schema.backgroundJobs.status, claimableStatuses),
            lte(schema.backgroundJobs.availableAt, now),
            lt(schema.backgroundJobs.attemptCount, schema.backgroundJobs.maxAttempts),
          ))
          .orderBy(
            asc(schema.backgroundJobs.priority),
            asc(schema.backgroundJobs.availableAt),
            asc(schema.backgroundJobs.createdAt),
            asc(schema.backgroundJobs.id),
          )
          .limit(input.limit)
          .for('update', { skipLocked: true });

        const claimed: ClaimedJob[] = [];
        for (const job of jobs) {
          const attemptNumber = job.attemptCount + 1;
          await transaction
            .update(schema.backgroundJobs)
            .set({
              status: 'processing',
              attemptCount: attemptNumber,
              leaseOwner: input.workerId,
              leaseExpiresAt,
              updatedAt: now,
            })
            .where(eq(schema.backgroundJobs.id, job.id));
          await transaction.insert(schema.backgroundJobAttempts).values({
            jobId: job.id,
            attemptNumber,
            workerId: input.workerId,
            leaseExpiresAt,
            startedAt: now,
          });
          claimed.push({
            id: job.id,
            topic: job.topic,
            payload: job.payload,
            attemptNumber,
            maxAttempts: job.maxAttempts,
            leaseExpiresAt,
          });
        }
        return claimed;
      });
    },

    async heartbeat(input) {
      assertWorker(input.workerId, input.leaseDurationMs);
      const now = clock();
      const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);
      return database.transaction(async (transaction) => {
        const [job] = await transaction
          .update(schema.backgroundJobs)
          .set({ leaseExpiresAt, updatedAt: now })
          .where(and(
            eq(schema.backgroundJobs.id, input.jobId),
            eq(schema.backgroundJobs.status, 'processing'),
            eq(schema.backgroundJobs.leaseOwner, input.workerId),
            eq(schema.backgroundJobs.attemptCount, input.attemptNumber),
            gt(schema.backgroundJobs.leaseExpiresAt, now),
          ))
          .returning({ id: schema.backgroundJobs.id });
        if (!job) return false;
        const [attempt] = await transaction
          .update(schema.backgroundJobAttempts)
          .set({ leaseExpiresAt })
          .where(and(
            eq(schema.backgroundJobAttempts.jobId, input.jobId),
            eq(schema.backgroundJobAttempts.attemptNumber, input.attemptNumber),
            eq(schema.backgroundJobAttempts.workerId, input.workerId),
            isNull(schema.backgroundJobAttempts.outcome),
          ))
          .returning({ id: schema.backgroundJobAttempts.id });
        if (!attempt) throw new Error('Active job attempt evidence is missing');
        return true;
      });
    },

    async succeed(input) {
      const now = clock();
      return database.transaction(async (transaction) => {
        const [job] = await transaction
          .update(schema.backgroundJobs)
          .set({
            status: 'succeeded',
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: now,
            lastErrorCode: null,
            updatedAt: now,
          })
          .where(and(
            eq(schema.backgroundJobs.id, input.jobId),
            eq(schema.backgroundJobs.status, 'processing'),
            eq(schema.backgroundJobs.leaseOwner, input.workerId),
            eq(schema.backgroundJobs.attemptCount, input.attemptNumber),
            gt(schema.backgroundJobs.leaseExpiresAt, now),
          ))
          .returning({ id: schema.backgroundJobs.id });
        if (!job) return false;
        const [attempt] = await transaction
          .update(schema.backgroundJobAttempts)
          .set({ outcome: 'succeeded', finishedAt: now })
          .where(and(
            eq(schema.backgroundJobAttempts.jobId, input.jobId),
            eq(schema.backgroundJobAttempts.attemptNumber, input.attemptNumber),
            eq(schema.backgroundJobAttempts.workerId, input.workerId),
            isNull(schema.backgroundJobAttempts.outcome),
          ))
          .returning({ id: schema.backgroundJobAttempts.id });
        if (!attempt) throw new Error('Active job attempt evidence is missing');
        return true;
      });
    },

    async fail(input) {
      if (input.errorCode.length < 1 || input.errorCode.length > 120) {
        throw new Error('Invalid job error code');
      }
      const now = clock();
      return database.transaction(async (transaction) => {
        const [job] = await transaction
          .select({
            id: schema.backgroundJobs.id,
            attemptCount: schema.backgroundJobs.attemptCount,
            maxAttempts: schema.backgroundJobs.maxAttempts,
          })
          .from(schema.backgroundJobs)
          .where(and(
            eq(schema.backgroundJobs.id, input.jobId),
            eq(schema.backgroundJobs.status, 'processing'),
            eq(schema.backgroundJobs.leaseOwner, input.workerId),
            eq(schema.backgroundJobs.attemptCount, input.attemptNumber),
            gt(schema.backgroundJobs.leaseExpiresAt, now),
          ))
          .limit(1)
          .for('update');
        if (!job) return { ok: false as const };

        const retry = input.retryable && job.attemptCount < job.maxAttempts;
        const status = retry ? 'retry_scheduled' as const : 'dead_lettered' as const;
        const delay = Math.min(
          baseRetryDelayMs * (2 ** Math.max(0, job.attemptCount - 1)),
          maxRetryDelayMs,
        );
        await transaction
          .update(schema.backgroundJobs)
          .set({
            status,
            availableAt: retry ? new Date(now.getTime() + delay) : now,
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: input.errorCode,
            updatedAt: now,
          })
          .where(eq(schema.backgroundJobs.id, job.id));
        const [attempt] = await transaction
          .update(schema.backgroundJobAttempts)
          .set({
            outcome: retry ? 'retry_scheduled' : 'dead_lettered',
            errorCode: input.errorCode,
            finishedAt: now,
          })
          .where(and(
            eq(schema.backgroundJobAttempts.jobId, input.jobId),
            eq(schema.backgroundJobAttempts.attemptNumber, input.attemptNumber),
            eq(schema.backgroundJobAttempts.workerId, input.workerId),
            isNull(schema.backgroundJobAttempts.outcome),
          ))
          .returning({ id: schema.backgroundJobAttempts.id });
        if (!attempt) throw new Error('Active job attempt evidence is missing');
        return { ok: true as const, status };
      });
    },

    async recoverExpired(input) {
      assertLimit(input.limit);
      const now = clock();
      return database.transaction(async (transaction) => {
        const jobs = await transaction
          .select({
            id: schema.backgroundJobs.id,
            attemptCount: schema.backgroundJobs.attemptCount,
            maxAttempts: schema.backgroundJobs.maxAttempts,
          })
          .from(schema.backgroundJobs)
          .where(and(
            eq(schema.backgroundJobs.status, 'processing'),
            lte(schema.backgroundJobs.leaseExpiresAt, now),
          ))
          .orderBy(asc(schema.backgroundJobs.leaseExpiresAt), asc(schema.backgroundJobs.id))
          .limit(input.limit)
          .for('update', { skipLocked: true });

        for (const job of jobs) {
          const retry = job.attemptCount < job.maxAttempts;
          await transaction
            .update(schema.backgroundJobs)
            .set({
              status: retry ? 'retry_scheduled' : 'dead_lettered',
              availableAt: now,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastErrorCode: 'LEASE_EXPIRED',
              updatedAt: now,
            })
            .where(eq(schema.backgroundJobs.id, job.id));
          const [attempt] = await transaction
            .update(schema.backgroundJobAttempts)
            .set({ outcome: 'lease_expired', errorCode: 'LEASE_EXPIRED', finishedAt: now })
            .where(and(
              eq(schema.backgroundJobAttempts.jobId, job.id),
              eq(schema.backgroundJobAttempts.attemptNumber, job.attemptCount),
              isNull(schema.backgroundJobAttempts.outcome),
            ))
            .returning({ id: schema.backgroundJobAttempts.id });
          if (!attempt) throw new Error('Expired job attempt evidence is missing');
        }
        return jobs.length;
      });
    },

    async cancelUnclaimed(jobId) {
      const now = clock();
      const [job] = await database
        .update(schema.backgroundJobs)
        .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
        .where(and(
          eq(schema.backgroundJobs.id, jobId),
          inArray(schema.backgroundJobs.status, claimableStatuses),
        ))
        .returning({ id: schema.backgroundJobs.id });
      return Boolean(job);
    },
  };
}
