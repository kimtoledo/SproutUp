import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashIpAddress } from '@sproutup/db';
import { creditApplicationStatusSchema, hasPermission, nonNegativePhpAmountSchema } from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import type { CreditReviewService } from '../credit/review-service.js';
import { operation } from '../openapi/operation.js';
import { commonErrors, successResponse } from '../openapi/onboarding-schemas.js';
import {
  applicationIdParameters,
  approvalBody,
  creditApplicationSummarySchema,
  informationRequestBody,
  recommendationBody,
  rejectionBody,
  reviewQueueQuery,
  staffCreditApplicationDetailSchema,
  staffCreditApplicationSummarySchema,
  versionBody,
} from '../openapi/credit-schemas.js';

interface Options {
  auth: AuthServices;
  review: CreditReviewService;
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: creditApplicationStatusSchema.optional(),
  assignedToMe: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
const applicationIdParametersSchema = z.object({ applicationId: z.uuid() });
const versionSchema = z.object({ version: z.number().int().positive() });
const informationRequestSchema = versionSchema.extend({ reason: z.string().trim().min(10).max(1000) });
const rejectionSchema = versionSchema.extend({ reason: z.string().trim().min(10).max(1000) });
const recommendationSchema = versionSchema.extend({
  recommendationNarrative: z.string().trim().min(10).max(2000),
  recommendedAmount: nonNegativePhpAmountSchema.optional(),
  recommendedTermMonths: z.number().int().min(1).max(600).optional(),
});
const approvalSchema = versionSchema.extend({
  approvedAmount: nonNegativePhpAmountSchema,
  approvedTermMonths: z.number().int().min(1).max(600),
  reason: z.string().trim().min(10).max(1000),
});

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' },
  });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: 'The required underwriting permission is not granted' },
  });
}

function failure(reply: FastifyReply, reason: string) {
  const failures: Record<string, { status: number; code: string; message: string }> = {
    not_found: { status: 404, code: 'APPLICATION_NOT_FOUND', message: 'Credit application not found' },
    assigned_to_other: {
      status: 409,
      code: 'APPLICATION_ASSIGNED_TO_OTHER',
      message: 'The application is assigned to another analyst',
    },
    not_assigned_analyst: {
      status: 403,
      code: 'NOT_ASSIGNED_ANALYST',
      message: 'Only the assigned analyst can update this review',
    },
    same_actor_as_recommendation: {
      status: 403,
      code: 'SAME_ACTOR_AS_RECOMMENDATION',
      message: 'The final decision must be made by someone other than the recommending analyst',
    },
    stale_version: {
      status: 409,
      code: 'STALE_APPLICATION_VERSION',
      message: 'The credit application changed; reload before retrying',
    },
    invalid_transition: {
      status: 409,
      code: 'INVALID_APPLICATION_TRANSITION',
      message: 'The review cannot make that transition from its current state',
    },
  };
  const mapped = failures[reason]
    ?? { status: 500, code: 'INTERNAL_ERROR', message: 'The credit review could not be processed' };
  return reply.status(mapped.status).send({
    success: false,
    error: { code: mapped.code, message: mapped.message },
  });
}

export async function registerCreditReviewRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.get('/v1/admin/credit/applications', {
    schema: operation({
      operationId: 'listCreditUnderwritingQueue',
      summary: 'List the bounded staff credit underwriting queue',
      tags: ['credit'],
      metadata: {
        actor: 'staff',
        permissions: ['credit_applications.read'],
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
            required: ['applications', 'page', 'pageSize', 'total'],
            properties: {
              applications: { type: 'array', items: staffCreditApplicationSummarySchema },
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
    if (!hasPermission(identity.authorization, 'credit_applications.read')) return forbidden(reply);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid underwriting queue filters' },
      });
    }
    const { assignedToMe, ...filters } = parsed.data;
    return reply.send({
      success: true,
      data: await options.review.list({
        ...filters,
        analystUserId: assignedToMe ? identity.authorization.user.id : undefined,
      }),
    });
  });

  app.get('/v1/admin/credit/applications/:applicationId', {
    schema: operation({
      operationId: 'getCreditUnderwritingApplication',
      summary: 'Read a credit application under review and its immutable timeline',
      tags: ['credit'],
      metadata: {
        actor: 'staff',
        permissions: ['credit_applications.read'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: applicationIdParameters,
        response: {
          200: successResponse(staffCreditApplicationDetailSchema),
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
    if (!hasPermission(identity.authorization, 'credit_applications.read')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID is required' },
      });
    }
    const detail = await options.review.detail(parameters.data.applicationId);
    if (!detail) return failure(reply, 'not_found');
    return reply.send({ success: true, data: detail });
  });

  app.post('/v1/admin/credit/applications/:applicationId/start-review', {
    schema: operation({
      operationId: 'startCreditReview',
      summary: 'Claim a submitted credit application and start review',
      tags: ['credit'],
      metadata: {
        actor: 'staff',
        permissions: ['credit_applications.review'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['assign analyst', 'transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.review_started',
      },
      http: {
        params: applicationIdParameters,
        body: versionBody,
        response: {
          200: successResponse(creditApplicationSummarySchema),
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
    if (!hasPermission(identity.authorization, 'credit_applications.review')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID and positive version are required' },
      });
    }
    const result = await options.review.startReview({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });

  app.post('/v1/admin/credit/applications/:applicationId/request-information', {
    schema: operation({
      operationId: 'requestCreditApplicationInformation',
      summary: 'Return an assigned credit application for applicant correction',
      tags: ['credit'],
      metadata: {
        actor: 'staff',
        permissions: ['credit_applications.review'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.information_requested',
      },
      http: {
        params: applicationIdParameters,
        body: informationRequestBody,
        response: {
          200: successResponse(creditApplicationSummarySchema),
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
    if (!hasPermission(identity.authorization, 'credit_applications.review')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = informationRequestSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID, version, and 10–1000 character reason are required' },
      });
    }
    const result = await options.review.requestInformation({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      reason: body.data.reason,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });

  app.post('/v1/admin/credit/applications/:applicationId/recommend', {
    schema: operation({
      operationId: 'recommendCreditApplication',
      summary: "Record the assigned analyst's underwriting recommendation (narrative, not a score)",
      tags: ['credit'],
      metadata: {
        actor: 'staff',
        permissions: ['credit_applications.recommend'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.recommended',
      },
      http: {
        params: applicationIdParameters,
        body: recommendationBody,
        response: {
          200: successResponse(creditApplicationSummarySchema),
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
    if (!hasPermission(identity.authorization, 'credit_applications.recommend')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = recommendationSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID, version, and recommendation narrative are required' },
      });
    }
    const result = await options.review.recommend({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      recommendationNarrative: body.data.recommendationNarrative,
      recommendedAmount: body.data.recommendedAmount,
      recommendedTermMonths: body.data.recommendedTermMonths,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });

  app.post('/v1/admin/credit/applications/:applicationId/approve', {
    schema: operation({
      operationId: 'approveCreditApplication',
      summary: 'Approve a recommended credit application; the approver must differ from the recommending analyst',
      tags: ['credit'],
      metadata: {
        actor: 'staff',
        permissions: ['credit_applications.approve'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.approved',
      },
      http: {
        params: applicationIdParameters,
        body: approvalBody,
        response: {
          200: successResponse(creditApplicationSummarySchema),
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
    if (!hasPermission(identity.authorization, 'credit_applications.approve')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = approvalSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID, version, approved amount/term, and reason are required' },
      });
    }
    const result = await options.review.approve({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      approvedAmount: body.data.approvedAmount,
      approvedTermMonths: body.data.approvedTermMonths,
      reason: body.data.reason,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });

  app.post('/v1/admin/credit/applications/:applicationId/reject', {
    schema: operation({
      operationId: 'rejectCreditApplication',
      summary: 'Reject a credit application under review or after a recommendation',
      tags: ['credit'],
      metadata: {
        actor: 'staff',
        // Either capability can reach this route; the service enforces which
        // one actually applies (assigned-analyst pre-recommendation,
        // dual-control post-recommendation) based on the application's state.
        permissions: ['credit_applications.review', 'credit_applications.approve'],
        permissionMode: 'any',
        retryModel: 'optimistic_version',
        sideEffects: ['transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.rejected',
      },
      http: {
        params: applicationIdParameters,
        body: rejectionBody,
        response: {
          200: successResponse(creditApplicationSummarySchema),
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
    // Early rejection (still `in_review`) only needs `.review`; rejection
    // after a recommendation is a final decision and needs `.approve`. Both
    // are accepted here — the service enforces the actual dual-control rule.
    if (
      !hasPermission(identity.authorization, 'credit_applications.review')
      && !hasPermission(identity.authorization, 'credit_applications.approve')
    ) {
      return forbidden(reply);
    }
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = rejectionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID, version, and rejection reason are required' },
      });
    }
    const result = await options.review.reject({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      reason: body.data.reason,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });
}
