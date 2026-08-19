import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  hasPermission,
  onboardingCaseTypeSchema,
  type AuthorizationContext,
  type OnboardingCaseType,
} from '@sproutup/shared';
import type { OnboardingCaseService } from '../onboarding/case-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { operation } from '../openapi/operation.js';
import {
  caseIdParameters,
  caseSummarySchema,
  commonErrors,
  createCaseBody,
  ownCaseDetailSchema,
  successResponse,
  versionBody,
} from '../openapi/onboarding-schemas.js';

const createSchema = z.object({ caseType: onboardingCaseTypeSchema });
const parametersSchema = z.object({ caseId: z.uuid() });
const submitSchema = z.object({ version: z.number().int().positive() });

interface Options {
  auth: AuthServices;
  cases: OnboardingCaseService;
}

const permissionByCaseType = {
  borrower: {
    read: 'borrower_onboarding.read_own',
    manage: 'borrower_onboarding.manage_own',
    submit: 'borrower_onboarding.submit_own',
  },
  investor: {
    read: 'investor_onboarding.read_own',
    manage: 'investor_onboarding.manage_own',
    submit: 'investor_onboarding.submit_own',
  },
} as const;

function allowedTypes(
  authorization: AuthorizationContext,
  action: 'read' | 'manage' | 'submit',
): OnboardingCaseType[] {
  return onboardingCaseTypeSchema.options.filter((caseType) =>
    hasPermission(authorization, permissionByCaseType[caseType][action]),
  );
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' } });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'The required onboarding permission is not granted' } });
}

function failure(reply: FastifyReply, reason: string) {
  const failures: Record<string, { status: number; code: string; message: string }> = {
    duplicate_open_case: { status: 409, code: 'OPEN_CASE_EXISTS', message: 'An open case already exists for this journey' },
    not_found: { status: 404, code: 'CASE_NOT_FOUND', message: 'Onboarding case not found' },
    stale_version: { status: 409, code: 'STALE_CASE_VERSION', message: 'The onboarding case changed; reload before retrying' },
    invalid_transition: { status: 409, code: 'INVALID_CASE_TRANSITION', message: 'The onboarding case cannot be submitted from its current state' },
  };
  const mapped = failures[reason] ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Onboarding case could not be processed' };
  return reply.status(mapped.status).send({ success: false, error: { code: mapped.code, message: mapped.message } });
}

export async function registerOnboardingCaseRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.get('/v1/onboarding/cases', {
    schema: operation({
      operationId: 'listOwnOnboardingCases',
      summary: 'List the authenticated customer onboarding cases',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['borrower_onboarding.read_own', 'investor_onboarding.read_own'],
        permissionMode: 'any',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        response: {
          200: successResponse({ type: 'array', items: caseSummarySchema }),
          401: commonErrors[401],
          403: commonErrors[403],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    const permitted = allowedTypes(identity.authorization, 'read');
    if (permitted.length === 0) return forbidden(reply);
    return reply.send({
      success: true,
      data: await options.cases.listOwn(identity.authorization.user.id, permitted),
    });
  });

  app.get('/v1/onboarding/cases/:caseId', {
    schema: operation({
      operationId: 'getOwnOnboardingCase',
      summary: 'Read an owned onboarding case and immutable timeline',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['borrower_onboarding.read_own', 'investor_onboarding.read_own'],
        permissionMode: 'any',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: caseIdParameters,
        response: {
          200: successResponse(ownCaseDetailSchema),
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
          404: commonErrors[404],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    const permitted = allowedTypes(identity.authorization, 'read');
    if (permitted.length === 0) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid case ID is required' } });
    }
    const detail = await options.cases.detailOwn(
      identity.authorization.user.id,
      parameters.data.caseId,
      permitted,
    );
    if (!detail) return failure(reply, 'not_found');
    return reply.send({ success: true, data: detail });
  });

  app.post('/v1/onboarding/cases', {
    schema: operation({
      operationId: 'createOwnOnboardingCase',
      summary: 'Create one open onboarding case for a permitted customer journey',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['borrower_onboarding.manage_own', 'investor_onboarding.manage_own'],
        permissionMode: 'any',
        retryModel: 'unique_open_case',
        sideEffects: ['create onboarding case', 'append case event', 'append audit event'],
        auditEvent: 'onboarding_case.created',
      },
      http: {
        body: createCaseBody,
        response: {
          201: successResponse(caseSummarySchema),
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
          409: commonErrors[409],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid onboarding case type is required' } });
    }
    if (!allowedTypes(identity.authorization, 'manage').includes(parsed.data.caseType)) {
      return forbidden(reply);
    }
    const result = await options.cases.create({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      caseType: parsed.data.caseType,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(201).send({ success: true, data: result.case });
  });

  app.post('/v1/onboarding/cases/:caseId/submit', {
    schema: operation({
      operationId: 'submitOwnOnboardingCase',
      summary: 'Submit an owned onboarding case using its current version',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['borrower_onboarding.submit_own', 'investor_onboarding.submit_own'],
        permissionMode: 'any',
        retryModel: 'optimistic_version',
        sideEffects: ['transition onboarding case', 'append case event', 'append audit event'],
        auditEvent: 'onboarding_case.submitted',
      },
      http: {
        params: caseIdParameters,
        body: versionBody,
        response: {
          200: successResponse(caseSummarySchema),
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
          404: commonErrors[404],
          409: commonErrors[409],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    const parameters = parametersSchema.safeParse(request.params);
    const body = submitSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid case ID and positive version are required' } });
    }
    const permitted = allowedTypes(identity.authorization, 'submit');
    if (permitted.length === 0) return forbidden(reply);
    const result = await options.cases.submit({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      allowedCaseTypes: permitted,
      caseId: parameters.data.caseId,
      expectedVersion: body.data.version,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.case });
  });
}
