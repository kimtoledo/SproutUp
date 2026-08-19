import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission, onboardingCaseStatusSchema, onboardingCaseTypeSchema } from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import type { OnboardingReviewService } from '../onboarding/review-service.js';
import { operation } from '../openapi/operation.js';
import {
  caseIdParameters,
  caseSummarySchema,
  commonErrors,
  informationRequestBody,
  rejectionBody,
  reviewQueueQuery,
  staffCaseDetailSchema,
  staffCaseSummarySchema,
  successResponse,
  versionBody,
} from '../openapi/onboarding-schemas.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  caseType: onboardingCaseTypeSchema.optional(),
  status: onboardingCaseStatusSchema.optional(),
  assignedToMe: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
const parametersSchema = z.object({ caseId: z.uuid() });
const versionSchema = z.object({ version: z.number().int().positive() });
const informationRequestSchema = versionSchema.extend({ reason: z.string().trim().min(10).max(1000) });
const rejectionSchema = versionSchema.extend({ reason: z.string().trim().min(10).max(1000) });

interface Options {
  auth: AuthServices;
  review: OnboardingReviewService;
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' } });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'The required onboarding review permission is not granted' } });
}

function failure(reply: FastifyReply, reason: string) {
  const failures: Record<string, { status: number; code: string; message: string }> = {
    not_found: { status: 404, code: 'CASE_NOT_FOUND', message: 'Onboarding case not found' },
    self_review_not_allowed: { status: 409, code: 'SELF_REVIEW_NOT_ALLOWED', message: 'An applicant cannot review their own case' },
    assigned_to_other: { status: 409, code: 'CASE_ASSIGNED_TO_OTHER', message: 'The case is assigned to another reviewer' },
    stale_version: { status: 409, code: 'STALE_CASE_VERSION', message: 'The onboarding case changed; reload before retrying' },
    invalid_transition: { status: 409, code: 'INVALID_CASE_TRANSITION', message: 'The review cannot make that transition from its current state' },
    not_assigned_reviewer: { status: 403, code: 'NOT_ASSIGNED_REVIEWER', message: 'Only the assigned reviewer can update this review' },
  };
  const mapped = failures[reason] ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Onboarding review could not be processed' };
  return reply.status(mapped.status).send({ success: false, error: { code: mapped.code, message: mapped.message } });
}

export async function registerOnboardingReviewRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.get('/v1/admin/onboarding/cases', {
    schema: operation({
      operationId: 'listOnboardingReviewQueue',
      summary: 'List the bounded staff onboarding review queue',
      tags: ['onboarding'],
      metadata: {
        actor: 'staff',
        permissions: ['onboarding_cases.read'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        querystring: reviewQueueQuery,
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['cases', 'page', 'pageSize', 'total'],
            properties: {
              cases: { type: 'array', items: staffCaseSummarySchema },
              page: { type: 'integer', minimum: 1 },
              pageSize: { type: 'integer', minimum: 1, maximum: 100 },
              total: { type: 'integer', minimum: 0 },
            },
          }),
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'onboarding_cases.read')) return forbidden(reply);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid onboarding queue filters' } });
    }
    const { assignedToMe, ...filters } = parsed.data;
    return reply.send({
      success: true,
      data: await options.review.list({
        ...filters,
        reviewerUserId: assignedToMe ? identity.authorization.user.id : undefined,
      }),
    });
  });

  app.get('/v1/admin/onboarding/cases/:caseId', {
    schema: operation({
      operationId: 'getOnboardingReviewCase',
      summary: 'Read an onboarding review case and immutable timeline',
      tags: ['onboarding'],
      metadata: {
        actor: 'staff',
        permissions: ['onboarding_cases.read'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: caseIdParameters,
        response: {
          200: successResponse(staffCaseDetailSchema),
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
    if (!hasPermission(identity.authorization, 'onboarding_cases.read')) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid case ID is required' } });
    }
    const detail = await options.review.detail(parameters.data.caseId);
    if (!detail) return failure(reply, 'not_found');
    return reply.send({ success: true, data: detail });
  });

  app.post('/v1/admin/onboarding/cases/:caseId/start-review', {
    schema: operation({
      operationId: 'startOnboardingReview',
      summary: 'Claim a submitted onboarding case and start review',
      tags: ['onboarding'],
      metadata: {
        actor: 'staff',
        permissions: ['onboarding_cases.review'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['assign reviewer', 'transition onboarding case', 'append case event', 'append audit event'],
        auditEvent: 'onboarding_case.review_started',
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
    if (!hasPermission(identity.authorization, 'onboarding_cases.review')) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid case ID and positive version are required' } });
    }
    const result = await options.review.startReview({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      caseId: parameters.data.caseId,
      expectedVersion: body.data.version,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.case });
  });

  app.post('/v1/admin/onboarding/cases/:caseId/request-information', {
    schema: operation({
      operationId: 'requestOnboardingInformation',
      summary: 'Return an assigned onboarding case for applicant correction',
      tags: ['onboarding'],
      metadata: {
        actor: 'staff',
        permissions: ['onboarding_cases.review'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition onboarding case', 'append case event', 'append audit event'],
        auditEvent: 'onboarding_case.information_requested',
      },
      http: {
        params: caseIdParameters,
        body: informationRequestBody,
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
    if (!hasPermission(identity.authorization, 'onboarding_cases.review')) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    const body = informationRequestSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid case ID, version, and 10–1000 character reason are required' },
      });
    }
    const result = await options.review.requestInformation({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      caseId: parameters.data.caseId,
      expectedVersion: body.data.version,
      reason: body.data.reason,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.case });
  });

  app.post('/v1/admin/onboarding/cases/:caseId/reject', {
    schema: operation({
      operationId: 'rejectOnboardingCase',
      summary: 'Reject an assigned in-review onboarding case with a reason',
      tags: ['onboarding'],
      metadata: {
        actor: 'staff',
        permissions: ['onboarding_cases.review'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition onboarding case', 'append case event', 'append audit event'],
        auditEvent: 'onboarding_case.rejected',
      },
      http: {
        params: caseIdParameters,
        body: rejectionBody,
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
    if (!hasPermission(identity.authorization, 'onboarding_cases.review')) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    const body = rejectionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid case ID, version, and 10–1000 character rejection reason are required',
        },
      });
    }
    const result = await options.review.reject({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      caseId: parameters.data.caseId,
      expectedVersion: body.data.version,
      reason: body.data.reason,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.case });
  });
}
