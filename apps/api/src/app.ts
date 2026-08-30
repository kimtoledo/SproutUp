import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { HealthResponse } from '@sproutup/shared';
import type { ApiConfig } from './config.js';
import type { AuthServices } from './auth/types.js';
import { registerAdminAuthRoutes, registerCustomerAuthRoutes } from './routes/auth.js';
import { registerSessionRoutes } from './routes/sessions.js';
import type { SessionService } from './auth/sessions-service.js';
import type { RoleAssignmentService } from './auth/role-assignments-service.js';
import { registerRoleAssignmentRoutes } from './routes/role-assignments.js';
import type { AccessCatalogueService } from './auth/access-catalogue-service.js';
import { registerAccessCatalogueRoutes } from './routes/access-catalogue.js';
import type { RoleRevocationService } from './auth/role-revocations-service.js';
import { registerRoleRevocationRoutes } from './routes/role-revocations.js';
import type { ApprovalLifecycleService } from './auth/approval-lifecycle-service.js';
import { registerApprovalLifecycleRoutes } from './routes/approval-lifecycle.js';
import type { ApprovalHistoryService } from './auth/approval-history-service.js';
import { registerApprovalHistoryRoutes } from './routes/approval-history.js';
import type { OnboardingCaseService } from './onboarding/case-service.js';
import { registerOnboardingCaseRoutes } from './routes/onboarding-cases.js';
import type { OnboardingReviewService } from './onboarding/review-service.js';
import { registerOnboardingReviewRoutes } from './routes/onboarding-review.js';
import { operation } from './openapi/operation.js';
import { healthResponseSchema } from './openapi/system-schemas.js';
import { apiVersionHeaders, currentApiVersionPolicy } from './openapi/api-version.js';

export interface AppDependencies {
  config: Pick<ApiConfig, 'appOrigin' | 'environment'>
    & Partial<Pick<ApiConfig, 'appOrigins' | 'trustProxy'>>;
  checkDatabase(): Promise<void>;
  auth?: {
    service: AuthServices;
    adminService?: AuthServices;
    borrowerService?: AuthServices;
    investorService?: AuthServices;
    baseUrl: string;
    sessions?: SessionService;
    roleAssignments?: RoleAssignmentService;
    catalogue?: AccessCatalogueService;
    roleRevocations?: RoleRevocationService;
    approvalLifecycle?: ApprovalLifecycleService;
    approvalHistory?: ApprovalHistoryService;
  };
  logger?: boolean;
  onboarding?: {
    cases: OnboardingCaseService;
    review?: OnboardingReviewService;
  };
}

function now(): string {
  return new Date().toISOString();
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.logger ?? dependencies.config.environment !== 'test',
    trustProxy: dependencies.config.trustProxy ?? false,
    genReqId: () => randomUUID(),
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const details = (error ?? {}) as { statusCode?: unknown; code?: unknown; validation?: unknown };
    const candidateStatus = typeof details.statusCode === 'number' ? details.statusCode : undefined;
    const errorCode = typeof details.code === 'string' ? details.code : '';

    // Schema validation and body-parsing failures are client errors, not server
    // faults: keep them on the stable 400 envelope instead of a 500.
    if (
      details.validation !== undefined ||
      candidateStatus === 400 ||
      errorCode.startsWith('FST_ERR_CTP_')
    ) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'The request does not match the operation contract' },
      });
    }

    // Preserve other framework-raised client errors (e.g. 413, 415) as themselves.
    if (candidateStatus && candidateStatus >= 400 && candidateStatus < 500) {
      return reply.status(candidateStatus).send({
        success: false,
        error: { code: 'REQUEST_REJECTED', message: 'The request could not be processed' },
      });
    }

    request.log.error({ err: error }, 'Unhandled API request failure');
    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'The requested resource does not exist' },
    });
  });

  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(cors, {
    origin(origin, callback) {
      const allowedOrigins = dependencies.config.appOrigins ?? [dependencies.config.appOrigin];
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    credentials: true,
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'SproutUp API',
        description: 'Versioned API contract for the SproutUp Philippine controlled pilot.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'better-auth.session_token',
            description: 'HTTP-only Better Auth session cookie; exact production prefix is environment-managed.',
          },
        },
      },
      tags: [
        { name: 'health', description: 'Process and dependency health' },
        { name: 'authentication', description: 'Identity and session boundary' },
        { name: 'access', description: 'RBAC and approval administration' },
        { name: 'role approvals', description: 'Dual-controlled role change lifecycle' },
        { name: 'onboarding', description: 'Borrower and investor onboarding workflows' },
      ],
    },
  });

  const currentVersionHeaders = apiVersionHeaders(currentApiVersionPolicy);
  app.addHook('onSend', async (request, reply) => {
    const pathname = request.url.split('?', 1)[0] ?? request.url;
    if (
      pathname === currentApiVersionPolicy.pathPrefix
      || pathname.startsWith(`${currentApiVersionPolicy.pathPrefix}/`)
    ) {
      for (const [name, value] of Object.entries(currentVersionHeaders)) {
        reply.header(name, value);
      }
    }
  });

  app.get('/health', {
    schema: operation({
      operationId: 'getLiveness',
      summary: 'Report API process liveness without dependency checks',
      tags: ['health'],
      authenticated: false,
      metadata: {
        actor: 'public', permissions: [], permissionMode: 'all', retryModel: 'safe_read',
        sideEffects: [], auditEvent: null,
      },
      http: { response: { 200: healthResponseSchema } },
    }),
  }, async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'api',
    timestamp: now(),
  }));

  app.get('/v1/health', {
    schema: operation({
      operationId: 'getReadiness',
      summary: 'Report API readiness and required database availability',
      tags: ['health'],
      authenticated: false,
      metadata: {
        actor: 'public', permissions: [], permissionMode: 'all', retryModel: 'safe_read',
        sideEffects: ['check database availability'], auditEvent: null,
      },
      http: { response: { 200: healthResponseSchema, 503: healthResponseSchema } },
    }),
  }, async (_request, reply): Promise<HealthResponse> => {
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

  app.get(
    '/openapi.json',
    { schema: { hide: true } },
    async (_request, reply) => reply.type('application/json').send(app.swagger()),
  );

  if (dependencies.auth) {
    const staffAuth = dependencies.auth.adminService ?? dependencies.auth.service;
    if (dependencies.auth.adminService) {
      await registerAdminAuthRoutes(app, {
        auth: dependencies.auth.adminService,
        authBaseUrl: dependencies.auth.baseUrl,
      });
    }
    if (dependencies.auth.borrowerService && dependencies.auth.investorService) {
      await registerCustomerAuthRoutes(app, {
        borrowerAuth: dependencies.auth.borrowerService,
        investorAuth: dependencies.auth.investorService,
        authBaseUrl: dependencies.auth.baseUrl,
      });
    }
    if (dependencies.auth.sessions) {
      await registerSessionRoutes(app, {
        auth: dependencies.auth.service,
        sessions: dependencies.auth.sessions,
      });
    }
    if (dependencies.auth.roleAssignments) {
      await registerRoleAssignmentRoutes(app, {
        auth: staffAuth,
        roleAssignments: dependencies.auth.roleAssignments,
      });
    }
    if (dependencies.auth.catalogue) {
      await registerAccessCatalogueRoutes(app, {
        auth: staffAuth,
        catalogue: dependencies.auth.catalogue,
      });
    }
    if (dependencies.auth.roleRevocations) {
      await registerRoleRevocationRoutes(app, {
        auth: staffAuth,
        roleRevocations: dependencies.auth.roleRevocations,
      });
    }
    if (dependencies.auth.approvalLifecycle) {
      await registerApprovalLifecycleRoutes(app, {
        auth: staffAuth,
        lifecycle: dependencies.auth.approvalLifecycle,
      });
    }
    if (dependencies.auth.approvalHistory) {
      await registerApprovalHistoryRoutes(app, {
        auth: staffAuth,
        history: dependencies.auth.approvalHistory,
      });
    }
  }

  if (dependencies.auth && dependencies.onboarding) {
    await registerOnboardingCaseRoutes(app, {
      auth: dependencies.auth.service,
      cases: dependencies.onboarding.cases,
    });
    if (dependencies.onboarding.review) {
      await registerOnboardingReviewRoutes(app, {
        auth: dependencies.auth.adminService ?? dependencies.auth.service,
        review: dependencies.onboarding.review,
      });
    }
  }

  return app;
}
