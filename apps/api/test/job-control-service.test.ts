import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { schema, type Database } from '@sproutup/db';
import {
  createJobControlService,
  enqueueDurableJob,
} from '../src/jobs/job-control-service.js';
import { applyMigrations } from './database-fixture.js';

async function fixture() {
  const pglite = new PGlite();
  await applyMigrations(pglite);
  const database = drizzle(pglite, { schema }) as unknown as Database;
  let now = new Date('2026-08-19T00:00:00.000Z');
  const service = createJobControlService(database, {
    clock: () => now,
    baseRetryDelayMs: 5_000,
    maxRetryDelayMs: 60_000,
  });
  return {
    database,
    service,
    setNow(value: string) { now = new Date(value); },
    close: () => pglite.close(),
  };
}

describe('PostgreSQL job control service', () => {
  it('enqueues once, returns exact duplicates, and rejects key/payload conflicts or secrets', async () => {
    const test = await fixture();
    try {
      const first = await test.service.enqueue({
        topic: 'pilot.case-index',
        payload: { caseId: 'case-1', version: 1 },
        idempotencyKey: 'pilot:case-index:case-1:1',
      });
      const duplicate = await test.service.enqueue({
        topic: 'pilot.case-index',
        payload: { version: 1, caseId: 'case-1' },
        idempotencyKey: 'pilot:case-index:case-1:1',
      });
      const conflict = await test.service.enqueue({
        topic: 'pilot.case-index',
        payload: { caseId: 'case-1', version: 2 },
        idempotencyKey: 'pilot:case-index:case-1:1',
      });

      expect(first).toMatchObject({ ok: true, created: true });
      expect(duplicate).toEqual({
        ok: true,
        created: false,
        jobId: first.ok ? first.jobId : '',
      });
      expect(conflict).toEqual({ ok: false, reason: 'idempotency_conflict' });
      await expect(test.service.enqueue({
        topic: 'pilot.case-index',
        payload: { nested: { accessToken: 'not-allowed' } },
        idempotencyKey: 'pilot:case-index:case-1:secret',
      })).rejects.toThrow('Sensitive audit metadata key is not allowed');
    } finally {
      await test.close();
    }
  }, 15_000);

  it('claims bounded work by priority and prevents a second worker from claiming leased jobs', async () => {
    const test = await fixture();
    try {
      await test.service.enqueue({
        topic: 'pilot.normal', payload: {}, idempotencyKey: 'pilot:normal:1', priority: 100,
      });
      await test.service.enqueue({
        topic: 'pilot.urgent', payload: {}, idempotencyKey: 'pilot:urgent:1', priority: 10,
      });

      const first = await test.service.claimBatch({
        workerId: 'worker-a', limit: 1, leaseDurationMs: 30_000,
      });
      const second = await test.service.claimBatch({
        workerId: 'worker-b', limit: 10, leaseDurationMs: 30_000,
      });
      const none = await test.service.claimBatch({
        workerId: 'worker-c', limit: 10, leaseDurationMs: 30_000,
      });

      expect(first).toHaveLength(1);
      expect(first[0]?.topic).toBe('pilot.urgent');
      expect(second).toHaveLength(1);
      expect(second[0]?.topic).toBe('pilot.normal');
      expect(none).toEqual([]);
    } finally {
      await test.close();
    }
  });

  it('enqueues through a caller transaction and rolls back with its domain state', async () => {
    const test = await fixture();
    try {
      await expect(test.database.transaction(async (transaction) => {
        await enqueueDurableJob(transaction, {
          topic: 'pilot.atomic',
          payload: { aggregateId: 'aggregate-1' },
          idempotencyKey: 'pilot:atomic:aggregate-1',
        }, new Date('2026-08-19T00:00:00.000Z'));
        throw new Error('domain transaction failed');
      })).rejects.toThrow('domain transaction failed');

      const jobs = await test.database
        .select({ id: schema.backgroundJobs.id })
        .from(schema.backgroundJobs)
        .where(eq(schema.backgroundJobs.idempotencyKey, 'pilot:atomic:aggregate-1'));
      expect(jobs).toEqual([]);
    } finally {
      await test.close();
    }
  });

  it('heartbeats and succeeds only the current unexpired worker attempt', async () => {
    const test = await fixture();
    try {
      const enqueued = await test.service.enqueue({
        topic: 'pilot.complete', payload: {}, idempotencyKey: 'pilot:complete:1',
      });
      if (!enqueued.ok) throw new Error('Expected enqueue');
      const [claim] = await test.service.claimBatch({
        workerId: 'worker-a', limit: 1, leaseDurationMs: 10_000,
      });
      if (!claim) throw new Error('Expected claim');

      test.setNow('2026-08-19T00:00:05.000Z');
      expect(await test.service.heartbeat({
        jobId: claim.id, attemptNumber: 1, workerId: 'worker-a', leaseDurationMs: 20_000,
      })).toBe(true);
      expect(await test.service.succeed({
        jobId: claim.id, attemptNumber: 1, workerId: 'worker-b',
      })).toBe(false);
      expect(await test.service.succeed({
        jobId: claim.id, attemptNumber: 1, workerId: 'worker-a',
      })).toBe(true);
      expect(await test.service.succeed({
        jobId: claim.id, attemptNumber: 1, workerId: 'worker-a',
      })).toBe(false);

      const [job] = await test.database
        .select({ status: schema.backgroundJobs.status, completedAt: schema.backgroundJobs.completedAt })
        .from(schema.backgroundJobs)
        .where(eq(schema.backgroundJobs.id, enqueued.jobId));
      expect(job).toMatchObject({ status: 'succeeded', completedAt: expect.any(Date) });
    } finally {
      await test.close();
    }
  });

  it('uses bounded exponential retry and dead-letters at the attempt budget', async () => {
    const test = await fixture();
    try {
      await test.service.enqueue({
        topic: 'pilot.retry', payload: {}, idempotencyKey: 'pilot:retry:1', maxAttempts: 2,
      });
      const [first] = await test.service.claimBatch({
        workerId: 'worker-a', limit: 1, leaseDurationMs: 30_000,
      });
      if (!first) throw new Error('Expected first claim');
      expect(await test.service.fail({
        jobId: first.id,
        attemptNumber: first.attemptNumber,
        workerId: 'worker-a',
        errorCode: 'PROVIDER_TEMPORARY',
        retryable: true,
      })).toEqual({ ok: true, status: 'retry_scheduled' });
      expect(await test.service.claimBatch({
        workerId: 'worker-b', limit: 1, leaseDurationMs: 30_000,
      })).toEqual([]);

      test.setNow('2026-08-19T00:00:05.000Z');
      const [second] = await test.service.claimBatch({
        workerId: 'worker-b', limit: 1, leaseDurationMs: 30_000,
      });
      if (!second) throw new Error('Expected retry claim');
      expect(second.attemptNumber).toBe(2);
      expect(await test.service.fail({
        jobId: second.id,
        attemptNumber: second.attemptNumber,
        workerId: 'worker-b',
        errorCode: 'PROVIDER_TEMPORARY',
        retryable: true,
      })).toEqual({ ok: true, status: 'dead_lettered' });

      const attempts = await test.database
        .select({ number: schema.backgroundJobAttempts.attemptNumber, outcome: schema.backgroundJobAttempts.outcome })
        .from(schema.backgroundJobAttempts)
        .orderBy(asc(schema.backgroundJobAttempts.attemptNumber));
      expect(attempts).toEqual([
        { number: 1, outcome: 'retry_scheduled' },
        { number: 2, outcome: 'dead_lettered' },
      ]);
    } finally {
      await test.close();
    }
  });

  it('recovers expired leases and rejects stale worker settlement', async () => {
    const test = await fixture();
    try {
      await test.service.enqueue({
        topic: 'pilot.recover', payload: {}, idempotencyKey: 'pilot:recover:1', maxAttempts: 2,
      });
      const [first] = await test.service.claimBatch({
        workerId: 'worker-a', limit: 1, leaseDurationMs: 1_000,
      });
      if (!first) throw new Error('Expected first claim');
      test.setNow('2026-08-19T00:00:01.000Z');
      expect(await test.service.recoverExpired({ limit: 10 })).toBe(1);
      expect(await test.service.succeed({
        jobId: first.id, attemptNumber: 1, workerId: 'worker-a',
      })).toBe(false);

      const [second] = await test.service.claimBatch({
        workerId: 'worker-b', limit: 1, leaseDurationMs: 1_000,
      });
      if (!second) throw new Error('Expected recovered claim');
      test.setNow('2026-08-19T00:00:02.000Z');
      expect(await test.service.recoverExpired({ limit: 10 })).toBe(1);
      const [job] = await test.database
        .select({ status: schema.backgroundJobs.status, errorCode: schema.backgroundJobs.lastErrorCode })
        .from(schema.backgroundJobs)
        .where(eq(schema.backgroundJobs.id, first.id));
      expect(job).toEqual({ status: 'dead_lettered', errorCode: 'LEASE_EXPIRED' });
    } finally {
      await test.close();
    }
  });

  it('cancels only work that has not been leased', async () => {
    const test = await fixture();
    try {
      const pending = await test.service.enqueue({
        topic: 'pilot.cancel', payload: {}, idempotencyKey: 'pilot:cancel:pending',
      });
      if (!pending.ok) throw new Error('Expected pending job');
      expect(await test.service.cancelUnclaimed(pending.jobId)).toBe(true);
      expect(await test.service.cancelUnclaimed(pending.jobId)).toBe(false);

      const leased = await test.service.enqueue({
        topic: 'pilot.cancel', payload: {}, idempotencyKey: 'pilot:cancel:leased',
      });
      if (!leased.ok) throw new Error('Expected leased job');
      await test.service.claimBatch({ workerId: 'worker-a', limit: 1, leaseDurationMs: 30_000 });
      expect(await test.service.cancelUnclaimed(leased.jobId)).toBe(false);
    } finally {
      await test.close();
    }
  });
});
