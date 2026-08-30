import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashIpAddress } from '@sproutup/db';
import { annualRatePercentSchema, hasPermission, nonNegativePhpAmountSchema, repaymentModelSchema } from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import type { CampaignService } from '../campaigns/campaign-service.js';
import { operation } from '../openapi/operation.js';
import { commonErrors, successResponse } from '../openapi/onboarding-schemas.js';
import {
  campaignDetailSchema,
  campaignIdParameters,
  campaignQueueQuery,
  campaignSummarySchema,
  createCampaignBody,
  reasonedVersionBody,
  updateCampaignBody,
  versionBody,
} from '../openapi/campaign-schemas.js';

interface Options {
  auth: AuthServices;
  campaigns: CampaignService;
}

const campaignIdParametersSchema = z.object({ campaignId: z.uuid() });
const versionSchema = z.object({ version: z.number().int().positive() });
const reasonedVersionSchema = versionSchema.extend({ reason: z.string().trim().min(10).max(1000) });
const campaignStatusSchema = z.enum(['draft', 'pending_approval', 'published', 'cancelled']);
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: campaignStatusSchema.optional(),
});

const fieldsSchema = z.object({
  loanAmount: nonNegativePhpAmountSchema,
  termMonths: z.number().int().min(1).max(600),
  repaymentModel: repaymentModelSchema,
  borrowerAnnualRatePercent: annualRatePercentSchema,
  investorAnnualRatePercent: annualRatePercentSchema,
  minimumCommitmentAmount: nonNegativePhpAmountSchema,
  fundingWindowDays: z.number().int().min(1).max(365),
  firstRepaymentDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purposeSummary: z.string().trim().min(1).max(2000),
});
const createSchema = fieldsSchema.extend({ creditApplicationId: z.uuid() });
const updateSchema = fieldsSchema.extend({ expectedVersion: z.number().int().positive() });

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' },
  });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: 'The required campaign permission is not granted' },
  });
}

const failureMap: Record<string, { status: number; code: string; message: string }> = {
  credit_application_not_found: {
    status: 404,
    code: 'CREDIT_APPLICATION_NOT_FOUND',
    message: 'Credit application not found',
  },
  credit_application_not_approved: {
    status: 409,
    code: 'CREDIT_APPLICATION_NOT_APPROVED',
    message: 'A campaign requires an approved credit application',
  },
  loan_amount_exceeds_approved: {
    status: 409,
    code: 'LOAN_AMOUNT_EXCEEDS_APPROVED',
    message: 'The campaign loan amount cannot exceed the approved credit application amount',
  },
  open_campaign_exists: {
    status: 409,
    code: 'OPEN_CAMPAIGN_EXISTS',
    message: 'An open campaign already exists for this credit application',
  },
  campaign_not_found: { status: 404, code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found' },
  stale_version: {
    status: 409,
    code: 'STALE_CAMPAIGN_VERSION',
    message: 'The campaign changed; reload before retrying',
  },
  campaign_not_editable: {
    status: 409,
    code: 'CAMPAIGN_NOT_EDITABLE',
    message: 'The campaign is no longer editable',
  },
  invalid_transition: {
    status: 409,
    code: 'INVALID_CAMPAIGN_TRANSITION',
    message: 'The campaign cannot make that transition from its current state',
  },
  same_actor_as_submission: {
    status: 403,
    code: 'SAME_ACTOR_AS_SUBMISSION',
    message: 'Publishing must be done by someone other than whoever submitted the campaign',
  },
};

function failure(reply: FastifyReply, reason: string) {
  const mapped = failureMap[reason]
    ?? { status: 500, code: 'INTERNAL_ERROR', message: 'The campaign could not be processed' };
  return reply.status(mapped.status).send({
    success: false,
    error: { code: mapped.code, message: mapped.message },
  });
}

export async function registerCampaignRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.get('/v1/admin/campaigns', {
    schema: operation({
      operationId: 'listCampaigns',
      summary: 'List the bounded staff campaign queue',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.read'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        querystring: campaignQueueQuery,
        response: {
          200: successResponse({
            type: 'object',
            additionalProperties: false,
            required: ['campaigns', 'page', 'pageSize', 'total'],
            properties: {
              campaigns: { type: 'array', items: campaignSummarySchema },
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
    if (!hasPermission(identity.authorization, 'campaigns.read')) return forbidden(reply);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign queue filters' },
      });
    }
    return reply.send({ success: true, data: await options.campaigns.list(parsed.data) });
  });

  app.get('/v1/admin/campaigns/:campaignId', {
    schema: operation({
      operationId: 'getCampaign',
      summary: 'Read a campaign, its computed repayment schedule, and immutable timeline',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.read'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: campaignIdParameters,
        response: {
          200: successResponse(campaignDetailSchema),
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
    if (!hasPermission(identity.authorization, 'campaigns.read')) return forbidden(reply);
    const parameters = campaignIdParametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid campaign ID is required' },
      });
    }
    const detail = await options.campaigns.detail(parameters.data.campaignId);
    if (!detail) return failure(reply, 'campaign_not_found');
    return reply.send({ success: true, data: detail });
  });

  app.post('/v1/admin/campaigns', {
    schema: operation({
      operationId: 'createCampaign',
      summary: 'Create a draft campaign from an approved credit application',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.manage'],
        permissionMode: 'all',
        retryModel: 'unique_open_case',
        sideEffects: ['create campaign', 'append campaign event', 'append audit event'],
        auditEvent: 'campaign.created',
      },
      http: {
        body: createCampaignBody,
        response: {
          201: successResponse(campaignSummarySchema),
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
    if (!hasPermission(identity.authorization, 'campaigns.manage')) return forbidden(reply);
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid campaign is required' },
      });
    }
    const result = await options.campaigns.create({
      creatorUserId: identity.authorization.user.id,
      creatorRoles: identity.authorization.roles,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
      ...body.data,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(201).send({ success: true, data: result.campaign });
  });

  app.post('/v1/admin/campaigns/:campaignId', {
    schema: operation({
      operationId: 'updateCampaign',
      summary: 'Replace a draft campaign’s terms',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.manage'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['replace campaign terms', 'append audit event'],
        auditEvent: 'campaign.updated',
      },
      http: {
        params: campaignIdParameters,
        body: updateCampaignBody,
        response: {
          200: successResponse(campaignSummarySchema),
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
    if (!hasPermission(identity.authorization, 'campaigns.manage')) return forbidden(reply);
    const parameters = campaignIdParametersSchema.safeParse(request.params);
    const body = updateSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid campaign ID and campaign terms are required' },
      });
    }
    const { expectedVersion, ...fields } = body.data;
    const result = await options.campaigns.update({
      actorUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      campaignId: parameters.data.campaignId,
      expectedVersion,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
      ...fields,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.campaign });
  });

  app.post('/v1/admin/campaigns/:campaignId/submit', {
    schema: operation({
      operationId: 'submitCampaign',
      summary: 'Submit a draft campaign for publish approval',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.manage'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition campaign', 'append campaign event', 'append audit event'],
        auditEvent: 'campaign.submitted',
      },
      http: {
        params: campaignIdParameters,
        body: versionBody,
        response: {
          200: successResponse(campaignSummarySchema),
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
    if (!hasPermission(identity.authorization, 'campaigns.manage')) return forbidden(reply);
    const parameters = campaignIdParametersSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid campaign ID and positive version are required' },
      });
    }
    const result = await options.campaigns.submit({
      actorUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      campaignId: parameters.data.campaignId,
      expectedVersion: body.data.version,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.campaign });
  });

  app.post('/v1/admin/campaigns/:campaignId/publish', {
    schema: operation({
      operationId: 'publishCampaign',
      summary: 'Publish a submitted campaign; the publisher must differ from the submitter',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.publish'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition campaign', 'append campaign event', 'append audit event'],
        auditEvent: 'campaign.published',
      },
      http: {
        params: campaignIdParameters,
        body: versionBody,
        response: {
          200: successResponse(campaignSummarySchema),
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
    if (!hasPermission(identity.authorization, 'campaigns.publish')) return forbidden(reply);
    const parameters = campaignIdParametersSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid campaign ID and positive version are required' },
      });
    }
    const result = await options.campaigns.publish({
      actorUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      campaignId: parameters.data.campaignId,
      expectedVersion: body.data.version,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.campaign });
  });

  app.post('/v1/admin/campaigns/:campaignId/send-back', {
    schema: operation({
      operationId: 'sendBackCampaign',
      summary: 'Return a submitted campaign to draft for correction',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.publish'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition campaign', 'append campaign event', 'append audit event'],
        auditEvent: 'campaign.sent_back',
      },
      http: {
        params: campaignIdParameters,
        body: reasonedVersionBody,
        response: {
          200: successResponse(campaignSummarySchema),
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
    if (!hasPermission(identity.authorization, 'campaigns.publish')) return forbidden(reply);
    const parameters = campaignIdParametersSchema.safeParse(request.params);
    const body = reasonedVersionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid campaign ID, version, and reason are required' },
      });
    }
    const result = await options.campaigns.sendBack({
      actorUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      campaignId: parameters.data.campaignId,
      expectedVersion: body.data.version,
      reason: body.data.reason,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.campaign });
  });

  app.post('/v1/admin/campaigns/:campaignId/cancel', {
    schema: operation({
      operationId: 'cancelCampaign',
      summary: 'Cancel a campaign with a reason',
      tags: ['campaigns'],
      metadata: {
        actor: 'staff',
        permissions: ['campaigns.manage'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['transition campaign', 'append campaign event', 'append audit event'],
        auditEvent: 'campaign.cancelled',
      },
      http: {
        params: campaignIdParameters,
        body: reasonedVersionBody,
        response: {
          200: successResponse(campaignSummarySchema),
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
    if (!hasPermission(identity.authorization, 'campaigns.manage')) return forbidden(reply);
    const parameters = campaignIdParametersSchema.safeParse(request.params);
    const body = reasonedVersionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid campaign ID, version, and reason are required' },
      });
    }
    const result = await options.campaigns.cancel({
      actorUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      campaignId: parameters.data.campaignId,
      expectedVersion: body.data.version,
      reason: body.data.reason,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.campaign });
  });
}
