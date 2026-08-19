import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { HealthResponse } from '@sproutup/shared';
import type { ApiConfig } from './config.js';
import type { AuthServices } from './auth/types.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSessionRoutes } from './routes/sessions.js';
import type { SessionService } from './auth/sessions-service.js';
import type { RoleAssignmentService } from './auth/role-assignments-service.js';
import { registerRoleAssignmentRoutes } from './routes/role-assignments.js';
import type { AccessCatalogueService } from './auth/access-catalogue-service.js';
import { registerAccessCatalogueRoutes } from './routes/access-catalogue.js';

export interface AppDependencies {
  config: Pick<ApiConfig, 'appOrigin' | 'environment'>;
  checkDatabase(): Promise<void>;
  auth?: {
    service: AuthServices;
    baseUrl: string;
    sessions?: SessionService;
    roleAssignments?: RoleAssignmentService;
    catalogue?: AccessCatalogueService;
  };
  logger?: boolean;
}

function now(): string {
  return new Date().toISOString();
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.logger ?? dependencies.config.environment !== 'test',
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
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

  if (dependencies.auth) {
    await registerAuthRoutes(app, {
      auth: dependencies.auth.service,
      authBaseUrl: dependencies.auth.baseUrl,
    });
    if (dependencies.auth.sessions) {
      await registerSessionRoutes(app, {
        auth: dependencies.auth.service,
        sessions: dependencies.auth.sessions,
      });
    }
    if (dependencies.auth.roleAssignments) {
      await registerRoleAssignmentRoutes(app, {
        auth: dependencies.auth.service,
        roleAssignments: dependencies.auth.roleAssignments,
      });
    }
    if (dependencies.auth.catalogue) {
      await registerAccessCatalogueRoutes(app, {
        auth: dependencies.auth.service,
        catalogue: dependencies.auth.catalogue,
      });
    }
  }

  return app;
}
