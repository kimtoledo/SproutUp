import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashIpAddress } from '@sproutup/db';
import {
  creditCollateralTypeSchema,
  creditGuarantorResidencySchema,
  hasPermission,
  nonNegativePhpAmountSchema,
  phpAmountSchema,
} from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import type { CreditApplicationService } from '../credit/application-service.js';
import { operation } from '../openapi/operation.js';
import { commonErrors, successResponse } from '../openapi/onboarding-schemas.js';
import {
  applicationIdParameters,
  createCreditApplicationBody,
  ownCreditApplicationDetailSchema,
  creditApplicationSummarySchema,
  saveCreditApplicationBody,
  versionBody,
  withdrawalBody,
} from '../openapi/credit-schemas.js';

interface Options {
  auth: AuthServices;
  applications: CreditApplicationService;
}

const applicationIdParametersSchema = z.object({ applicationId: z.uuid() });
const versionSchema = z.object({ version: z.number().int().positive() });
const withdrawSchema = versionSchema.extend({ reason: z.string().trim().min(10).max(1000) });

const collateralItemInputSchema = z.object({
  collateralType: creditCollateralTypeSchema,
  description: z.string().trim().min(1).max(500),
  estimatedValue: nonNegativePhpAmountSchema,
  outstandingLoan: nonNegativePhpAmountSchema.optional(),
});
const guarantorInputSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  residencyStatus: creditGuarantorResidencySchema,
  assessedNetWorth: nonNegativePhpAmountSchema.optional(),
  assessmentYear: z.number().int().min(1900).max(2200).optional(),
  contactPhone: z.string().trim().min(1).max(30).optional(),
});

const applicationFieldsSchema = z.object({
  requestedAmount: nonNegativePhpAmountSchema,
  termMonths: z.number().int().min(1).max(600),
  purpose: z.string().trim().min(1).max(1000),
  industry: z.string().trim().min(1).max(200).optional(),
  companyEmployees: z.number().int().min(1).optional(),
  ownershipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isAudited: z.boolean(),
  lastYear1SalesRevenue: nonNegativePhpAmountSchema.optional(),
  lastYear1GrossProfit: phpAmountSchema.optional(),
  lastYear1NetProfit: phpAmountSchema.optional(),
  lastYear2SalesRevenue: nonNegativePhpAmountSchema.optional(),
  lastYear2GrossProfit: phpAmountSchema.optional(),
  lastYear2NetProfit: phpAmountSchema.optional(),
  bankruptcyHistory: z.boolean(),
  bankruptcyDischarged: z.boolean().optional(),
  bankruptcyYear: z.number().int().min(1900).max(2200).optional(),
  collateralItems: z.array(collateralItemInputSchema).max(20).default([]),
  guarantors: z.array(guarantorInputSchema).max(10).default([]),
});
const createSchema = applicationFieldsSchema.extend({ borrowerCaseId: z.uuid() });
const saveSchema = applicationFieldsSchema.extend({ expectedVersion: z.number().int().positive() });

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' },
  });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: 'The required credit application permission is not granted' },
  });
}

const failureMap: Record<string, { status: number; code: string; message: string }> = {
  borrower_case_not_found: {
    status: 404,
    code: 'BORROWER_CASE_NOT_FOUND',
    message: 'An owned, approved borrower case is required',
  },
  borrower_case_not_approved: {
    status: 409,
    code: 'BORROWER_CASE_NOT_APPROVED',
    message: 'The borrower case must be approved before a credit application can be created',
  },
  application_not_found: {
    status: 404,
    code: 'APPLICATION_NOT_FOUND',
    message: 'Credit application not found',
  },
  open_application_exists: {
    status: 409,
    code: 'OPEN_APPLICATION_EXISTS',
    message: 'An open credit application already exists for this borrower case',
  },
  stale_version: {
    status: 409,
    code: 'STALE_APPLICATION_VERSION',
    message: 'The credit application changed; reload before retrying',
  },
  application_not_editable: {
    status: 409,
    code: 'APPLICATION_NOT_EDITABLE',
    message: 'The credit application is no longer editable',
  },
  invalid_transition: {
    status: 409,
    code: 'INVALID_APPLICATION_TRANSITION',
    message: 'The credit application cannot make that transition from its current state',
  },
};

function failure(reply: FastifyReply, reason: string) {
  const mapped = failureMap[reason]
    ?? { status: 500, code: 'INTERNAL_ERROR', message: 'The credit application could not be processed' };
  return reply.status(mapped.status).send({
    success: false,
    error: { code: mapped.code, message: mapped.message },
  });
}

export async function registerCreditApplicationRoutes(
  app: FastifyInstance,
  options: Options,
): Promise<void> {
  app.get('/v1/credit/applications', {
    schema: operation({
      operationId: 'listOwnCreditApplications',
      summary: 'List the current borrower own credit applications',
      tags: ['credit'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['credit_applications.read_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        response: {
          200: successResponse({ type: 'array', items: creditApplicationSummarySchema }),
          401: commonErrors[401],
          403: commonErrors[403],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'credit_applications.read_own')) return forbidden(reply);
    return reply.send({
      success: true,
      data: await options.applications.listOwn(identity.authorization.user.id),
    });
  });

  app.get('/v1/credit/applications/:applicationId', {
    schema: operation({
      operationId: 'getOwnCreditApplication',
      summary: 'Read an owned credit application and immutable timeline',
      tags: ['credit'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['credit_applications.read_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: applicationIdParameters,
        response: {
          200: successResponse(ownCreditApplicationDetailSchema),
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
    if (!hasPermission(identity.authorization, 'credit_applications.read_own')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID is required' },
      });
    }
    const detail = await options.applications.detailOwn(
      identity.authorization.user.id,
      parameters.data.applicationId,
    );
    if (!detail) return failure(reply, 'application_not_found');
    return reply.send({ success: true, data: detail });
  });

  app.post('/v1/credit/applications', {
    schema: operation({
      operationId: 'createOwnCreditApplication',
      summary: 'Create a draft credit application for an owned, approved borrower case',
      tags: ['credit'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['credit_applications.manage_own'],
        permissionMode: 'all',
        retryModel: 'unique_open_case',
        sideEffects: ['create credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.saved',
      },
      http: {
        body: createCreditApplicationBody,
        response: {
          201: successResponse(creditApplicationSummarySchema),
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
    if (!hasPermission(identity.authorization, 'credit_applications.manage_own')) return forbidden(reply);
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid credit application is required' },
      });
    }
    const result = await options.applications.saveOwn({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
      ...body.data,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(201).send({ success: true, data: result.application });
  });

  app.post('/v1/credit/applications/:applicationId', {
    schema: operation({
      operationId: 'saveOwnCreditApplication',
      summary: 'Replace an owned draft or needs-information credit application',
      tags: ['credit'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['credit_applications.manage_own'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['replace credit application', 'append audit event'],
        auditEvent: 'credit_application.saved',
      },
      http: {
        params: applicationIdParameters,
        body: saveCreditApplicationBody,
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
    if (!hasPermission(identity.authorization, 'credit_applications.manage_own')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = saveSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID and credit application are required' },
      });
    }
    const { expectedVersion, ...fields } = body.data;
    const result = await options.applications.saveOwn({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
      ...fields,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });

  app.post('/v1/credit/applications/:applicationId/submit', {
    schema: operation({
      operationId: 'submitOwnCreditApplication',
      summary: 'Submit an owned credit application using its current version',
      tags: ['credit'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['credit_applications.submit_own'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.submitted',
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
    if (!hasPermission(identity.authorization, 'credit_applications.submit_own')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID and positive version are required' },
      });
    }
    const result = await options.applications.submit({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });

  app.post('/v1/credit/applications/:applicationId/withdraw', {
    schema: operation({
      operationId: 'withdrawOwnCreditApplication',
      summary: 'Withdraw an owned open credit application with a reason',
      tags: ['credit'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['credit_applications.manage_own'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.withdrawn',
      },
      http: {
        params: applicationIdParameters,
        body: withdrawalBody,
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
    if (!hasPermission(identity.authorization, 'credit_applications.manage_own')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = withdrawSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid application ID, version, and withdrawal reason are required',
        },
      });
    }
    const result = await options.applications.withdraw({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      reason: body.data.reason,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });

  app.post('/v1/credit/applications/:applicationId/reopen', {
    schema: operation({
      operationId: 'reopenOwnCreditApplication',
      summary: 'Reopen an owned rejected credit application to a fresh draft',
      tags: ['credit'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['credit_applications.manage_own'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition credit application', 'append application event', 'append audit event'],
        auditEvent: 'credit_application.reopened',
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
    if (!hasPermission(identity.authorization, 'credit_applications.manage_own')) return forbidden(reply);
    const parameters = applicationIdParametersSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid application ID and positive version are required' },
      });
    }
    const result = await options.applications.reopen({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      applicationId: parameters.data.applicationId,
      expectedVersion: body.data.version,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.application });
  });
}
