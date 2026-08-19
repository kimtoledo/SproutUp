import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimedJob, JobControlService } from '../src/jobs/job-control-service.js';
import {
  createJobWorkerRuntime,
  JobHandlerError,
  JobTopicRegistry,
} from '../src/jobs/job-worker-runtime.js';
import { createApplicationJobTopicRegistry } from '../src/jobs/topics.js';

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: '00000000-0000-4000-8000-000000000801',
    topic: 'pilot.test',
    payload: { schemaVersion: 1, value: 'ok' },
    attemptNumber: 1,
    maxAttempts: 3,
    leaseExpiresAt: new Date('2026-08-19T00:01:00.000Z'),
    ...overrides,
  };
}

function control(overrides: Partial<JobControlService> = {}): JobControlService {
  return {
    enqueue: async () => ({ ok: false, reason: 'idempotency_conflict' }),
    claimBatch: async () => [],
    heartbeat: async () => true,
    succeed: async () => true,
    fail: async () => ({ ok: true, status: 'dead_lettered' }),
    recoverExpired: async () => 0,
    cancelUnclaimed: async () => false,
    ...overrides,
  };
}

const payloadSchema = z.object({ schemaVersion: z.literal(1), value: z.string() });

describe('job worker runtime', () => {
  it('requires explicit valid unique topic registration and refuses to start empty', async () => {
    const registry = createApplicationJobTopicRegistry();
    const claimBatch = vi.fn<JobControlService['claimBatch']>().mockResolvedValue([]);
    const runtime = createJobWorkerRuntime(control({ claimBatch }), registry, {
      workerId: 'worker-test',
    });

    expect(() => runtime.start()).toThrow('at least one registered topic');
    expect(await runtime.runOnce()).toBe(0);
    expect(claimBatch).not.toHaveBeenCalled();
    expect(() => registry.register({
      topic: 'Invalid Topic', schema: payloadSchema, handle: async () => undefined,
    })).toThrow('bounded lowercase');
    registry.register({ topic: 'pilot.test', schema: payloadSchema, handle: async () => undefined });
    expect(() => registry.register({
      topic: 'pilot.test', schema: payloadSchema, handle: async () => undefined,
    })).toThrow('Duplicate job topic');
  });

  it('validates payload versions and dead-letters unknown or malformed topics', async () => {
    const handled = vi.fn();
    const jobs = [
      job(),
      job({
        id: '00000000-0000-4000-8000-000000000802',
        payload: { schemaVersion: 2, value: 'future' },
      }),
      job({ id: '00000000-0000-4000-8000-000000000803', topic: 'pilot.unknown' }),
    ];
    const fail = vi.fn<JobControlService['fail']>().mockResolvedValue({
      ok: true, status: 'dead_lettered',
    });
    const succeed = vi.fn<JobControlService['succeed']>().mockResolvedValue(true);
    const registry = new JobTopicRegistry().register({
      topic: 'pilot.test',
      schema: payloadSchema,
      handle: async (payload) => { handled(payload); },
    });
    const runtime = createJobWorkerRuntime(control({
      claimBatch: async ({ limit }) => jobs.slice(0, limit), fail, succeed,
    }), registry, {
      workerId: 'worker-test', concurrency: 3, batchSize: 3,
    });

    expect(await runtime.runOnce()).toBe(3);
    expect(handled).toHaveBeenCalledWith({ schemaVersion: 1, value: 'ok' });
    expect(succeed).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({
      jobId: jobs[1]?.id, errorCode: 'INVALID_JOB_PAYLOAD', retryable: false,
    }));
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({
      jobId: jobs[2]?.id, errorCode: 'UNKNOWN_JOB_TOPIC', retryable: false,
    }));
  });

  it('maps classified and unexpected handler failures to safe retry decisions', async () => {
    const fail = vi.fn<JobControlService['fail']>().mockResolvedValue({
      ok: true, status: 'retry_scheduled',
    });
    let calls = 0;
    const registry = new JobTopicRegistry().register({
      topic: 'pilot.test',
      schema: payloadSchema,
      handle: async () => {
        calls += 1;
        if (calls === 1) throw new JobHandlerError('PROVIDER_RATE_LIMITED', true);
        throw new Error('sensitive provider detail must not persist');
      },
    });
    const claimed = [job()];
    const runtime = createJobWorkerRuntime(control({
      claimBatch: async () => claimed.splice(0), fail,
    }), registry, { workerId: 'worker-test' });

    await runtime.runOnce();
    claimed.push(job({ id: '00000000-0000-4000-8000-000000000804' }));
    await runtime.runOnce();
    expect(fail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      errorCode: 'PROVIDER_RATE_LIMITED', retryable: true,
    }));
    expect(fail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      errorCode: 'UNHANDLED_JOB_ERROR', retryable: true,
    }));
    expect(JSON.stringify(fail.mock.calls)).not.toContain('sensitive provider detail');
  });

  it('heartbeats long work and bounds each claim by configured concurrency', async () => {
    const heartbeat = vi.fn<JobControlService['heartbeat']>().mockResolvedValue(true);
    const claimBatch = vi.fn<JobControlService['claimBatch']>().mockResolvedValue([job()]);
    const registry = new JobTopicRegistry().register({
      topic: 'pilot.test',
      schema: payloadSchema,
      handle: async () => new Promise((resolve) => setTimeout(resolve, 35)),
    });
    const runtime = createJobWorkerRuntime(control({ claimBatch, heartbeat }), registry, {
      workerId: 'worker-test',
      batchSize: 10,
      concurrency: 2,
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 10,
    });

    expect(await runtime.runOnce()).toBe(1);
    expect(claimBatch).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
    expect(heartbeat).toHaveBeenCalled();
  });

  it('drains completed work on stop and hands unfinished leases back by aborting', async () => {
    let release: (() => void) | undefined;
    const succeed = vi.fn<JobControlService['succeed']>().mockResolvedValue(true);
    const registry = new JobTopicRegistry().register({
      topic: 'pilot.test',
      schema: payloadSchema,
      handle: async () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const runtime = createJobWorkerRuntime(control({
      claimBatch: async () => [job()], succeed,
    }), registry, { workerId: 'worker-test' });
    const running = runtime.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setTimeout(() => release?.(), 5);
    expect(await runtime.stop(100)).toEqual({ drained: true });
    await running;
    expect(succeed).toHaveBeenCalledTimes(1);

    let aborted = false;
    const handoffRegistry = new JobTopicRegistry().register({
      topic: 'pilot.test',
      schema: payloadSchema,
      handle: async (_payload, context) => new Promise<void>((resolve) => {
        context.signal.addEventListener('abort', () => {
          aborted = true;
          resolve();
        }, { once: true });
      }),
    });
    const staleSucceed = vi.fn<JobControlService['succeed']>().mockResolvedValue(true);
    const handoff = createJobWorkerRuntime(control({
      claimBatch: async () => [job()], succeed: staleSucceed,
    }), handoffRegistry, { workerId: 'worker-handoff' });
    const handingOff = handoff.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await handoff.stop(10)).toEqual({ drained: false });
    await handingOff;
    expect(aborted).toBe(true);
    expect(staleSucceed).not.toHaveBeenCalled();
  });
});
