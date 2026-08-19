import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@sproutup/shared';
import type { ApiConfig } from './config.js';

export interface AppDependencies {
  config: Pick<ApiConfig, 'appOrigin' | 'environment'>;
  checkDatabase(): Promise<void>;
  logger?: boolean;
}

function now(): string {
  return new Date().toISOString();
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.logger ?? dependencies.config.environment !== 'test',
    trustProxy: true,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || origin === dependencies.config.appOrigin);
    },
    credentials: true,
  });

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'api',
    timestamp: now(),
  }));

  app.get('/v1/health', async (_request, reply): Promise<HealthResponse> => {
    try {
      await dependencies.checkDatabase();

      return {
        status: 'ok',
        service: 'api',
        timestamp: now(),
        dependencies: { database: 'ok' },
      };
    } catch (error) {
      app.log.error({ err: error }, 'Database readiness check failed');
      reply.status(503);

      return {
        status: 'degraded',
        service: 'api',
        timestamp: now(),
        dependencies: { database: 'unavailable' },
      };
    }
  });

  return app;
}
