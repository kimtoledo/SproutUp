import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ClaimedJob, JobControlService } from './job-control-service.js';

export interface JobHandlerContext {
  jobId: string;
  attemptNumber: number;
  signal: AbortSignal;
}

interface RegisteredJobHandler {
  schema: z.ZodType<unknown>;
  handle(payload: unknown, context: JobHandlerContext): Promise<void>;
}

export class JobTopicRegistry {
  readonly #handlers = new Map<string, RegisteredJobHandler>();

  register<T>(input: {
    topic: string;
    schema: z.ZodType<T>;
    handle(payload: T, context: JobHandlerContext): Promise<void>;
  }): this {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(input.topic) || input.topic.length > 120) {
      throw new Error('Job topic must be a bounded lowercase dotted or dashed identifier');
    }
    if (this.#handlers.has(input.topic)) throw new Error(`Duplicate job topic: ${input.topic}`);
    this.#handlers.set(input.topic, {
      schema: input.schema,
      handle: async (payload, context) => input.handle(payload as T, context),
    });
    return this;
  }

  get(topic: string): RegisteredJobHandler | undefined {
    return this.#handlers.get(topic);
  }

  get size(): number {
    return this.#handlers.size;
  }
}

export class JobHandlerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'JobHandlerError';
  }
}

export interface JobWorkerRuntime {
  start(): void;
  runOnce(): Promise<number>;
  stop(timeoutMs?: number): Promise<{ drained: boolean }>;
}

interface JobWorkerOptions {
  workerId?: string;
  batchSize?: number;
  concurrency?: number;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  recoveryBatchSize?: number;
  onError?(error: unknown): void;
}

type ResolvedJobWorkerOptions = Required<Omit<JobWorkerOptions, 'onError'>> & {
  onError(error: unknown): void;
};

function validateOptions(options: ResolvedJobWorkerOptions): void {
  if (options.workerId.length < 1 || options.workerId.length > 200) throw new Error('Invalid worker ID');
  for (const [name, value] of [
    ['batchSize', options.batchSize],
    ['concurrency', options.concurrency],
    ['recoveryBatchSize', options.recoveryBatchSize],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
      throw new Error(`${name} must be between 1 and 100`);
    }
  }
  if (options.leaseDurationMs < 1_000 || options.leaseDurationMs > 900_000) {
    throw new Error('Worker lease must be between 1 second and 15 minutes');
  }
  if (options.heartbeatIntervalMs < 10 || options.heartbeatIntervalMs >= options.leaseDurationMs) {
    throw new Error('Heartbeat interval must be at least 10ms and shorter than the lease');
  }
  if (options.pollIntervalMs < 10 || options.pollIntervalMs > 60_000) {
    throw new Error('Poll interval must be between 10ms and 1 minute');
  }
}

export function createJobWorkerRuntime(
  control: JobControlService,
  registry: JobTopicRegistry,
  configured: JobWorkerOptions = {},
): JobWorkerRuntime {
  const options: ResolvedJobWorkerOptions = {
    workerId: configured.workerId ?? `api-worker-${randomUUID()}`,
    batchSize: configured.batchSize ?? 10,
    concurrency: configured.concurrency ?? 4,
    leaseDurationMs: configured.leaseDurationMs ?? 60_000,
    heartbeatIntervalMs: configured.heartbeatIntervalMs ?? 20_000,
    pollIntervalMs: configured.pollIntervalMs ?? 1_000,
    recoveryBatchSize: configured.recoveryBatchSize ?? 25,
    onError: configured.onError ?? (() => undefined),
  };
  validateOptions(options);

  let started = false;
  let stopping = false;
  let tickRunning = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = new Map<string, { promise: Promise<void>; controller: AbortController }>();

  async function execute(job: ClaimedJob): Promise<void> {
    const definition = registry.get(job.topic);
    if (!definition) {
      await control.fail({
        jobId: job.id,
        attemptNumber: job.attemptNumber,
        workerId: options.workerId,
        errorCode: 'UNKNOWN_JOB_TOPIC',
        retryable: false,
      });
      return;
    }

    const parsed = definition.schema.safeParse(job.payload);
    if (
      !Number.isSafeInteger(job.payload.schemaVersion)
      || Number(job.payload.schemaVersion) < 1
      || !parsed.success
    ) {
      await control.fail({
        jobId: job.id,
        attemptNumber: job.attemptNumber,
        workerId: options.workerId,
        errorCode: 'INVALID_JOB_PAYLOAD',
        retryable: false,
      });
      return;
    }

    const controller = new AbortController();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || controller.signal.aborted) return;
      heartbeatRunning = true;
      void control.heartbeat({
        jobId: job.id,
        attemptNumber: job.attemptNumber,
        workerId: options.workerId,
        leaseDurationMs: options.leaseDurationMs,
      }).then((owned) => {
        if (!owned) controller.abort('job lease was lost');
      }).finally(() => {
        heartbeatRunning = false;
      });
    }, options.heartbeatIntervalMs);
    controller.signal.addEventListener('abort', () => clearInterval(heartbeat), { once: true });

    const promise = (async () => {
      try {
        await definition.handle(parsed.data, {
          jobId: job.id,
          attemptNumber: job.attemptNumber,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          await control.succeed({
            jobId: job.id,
            attemptNumber: job.attemptNumber,
            workerId: options.workerId,
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const classified = error instanceof JobHandlerError
            ? error
            : new JobHandlerError('UNHANDLED_JOB_ERROR', true);
          await control.fail({
            jobId: job.id,
            attemptNumber: job.attemptNumber,
            workerId: options.workerId,
            errorCode: classified.code,
            retryable: classified.retryable,
          });
        }
      } finally {
        clearInterval(heartbeat);
      }
    })();

    active.set(job.id, { promise, controller });
    try {
      await promise;
    } finally {
      active.delete(job.id);
    }
  }

  async function runOnce(): Promise<number> {
    if (stopping || tickRunning || registry.size === 0) return 0;
    tickRunning = true;
    try {
      await control.recoverExpired({ limit: options.recoveryBatchSize });
      const capacity = Math.max(0, options.concurrency - active.size);
      if (capacity === 0) return 0;
      const jobs = await control.claimBatch({
        workerId: options.workerId,
        limit: Math.min(options.batchSize, capacity),
        leaseDurationMs: options.leaseDurationMs,
      });
      await Promise.all(jobs.map(execute));
      return jobs.length;
    } finally {
      tickRunning = false;
    }
  }

  function schedule(): void {
    if (stopping) return;
    timer = setTimeout(() => {
      void runOnce().catch(options.onError).finally(schedule);
    }, options.pollIntervalMs);
  }

  return {
    start() {
      if (started) throw new Error('Job worker runtime already started');
      if (registry.size === 0) throw new Error('Job worker requires at least one registered topic');
      started = true;
      schedule();
    },

    runOnce,

    async stop(timeoutMs = 30_000) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) {
        throw new Error('Worker shutdown timeout must be between 0 and 5 minutes');
      }
      stopping = true;
      if (timer) clearTimeout(timer);
      if (active.size === 0) return { drained: true };

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([
        Promise.allSettled([...active.values()].map(({ promise }) => promise)).then(() => true),
        new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (!drained) {
        for (const { controller } of active.values()) {
          controller.abort('worker shutdown lease handoff');
        }
      }
      return { drained };
    },
  };
}
