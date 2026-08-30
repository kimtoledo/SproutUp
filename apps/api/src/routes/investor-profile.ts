import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashIpAddress } from '@sproutup/db';
import { hasPermission } from '@sproutup/shared';
import type { InvestorProfileService } from '../onboarding/investor-profile-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { operation } from '../openapi/operation.js';
import { caseIdParameters, commonErrors, successResponse } from '../openapi/onboarding-schemas.js';
import { investorProfileSchema, saveInvestorProfileBody } from '../openapi/investor-profile-schemas.js';

interface Options {
  auth: AuthServices;
  profiles: InvestorProfileService;
}

const parametersSchema = z.object({ caseId: z.uuid() });

const saveSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  fullName: z.string().trim().min(1).max(300),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nationality: z.string().trim().min(1).max(80).optional(),
  governmentIdType: z.string().trim().min(1).max(100).optional(),
  governmentIdNumber: z.string().trim().min(1).max(60).optional(),
  residentialAddress: z.string().trim().min(1).max(500).optional(),
  phoneNumber: z.string().trim().min(1).max(30).optional(),
  occupation: z.string().trim().min(1).max(200).optional(),
  sourceOfFunds: z.string().trim().min(1).max(500).optional(),
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
    error: { code: 'FORBIDDEN', message: 'The required onboarding permission is not granted' },
  });
}

function failure(reply: FastifyReply, reason: string) {
  const failures: Record<string, { status: number; code: string; message: string }> = {
    case_not_found: {
      status: 404,
      code: 'CASE_NOT_FOUND',
      message: 'Onboarding case not found',
    },
    case_not_editable: {
      status: 409,
      code: 'CASE_NOT_EDITABLE',
      message: 'The onboarding case is no longer editable',
    },
    stale_version: {
      status: 409,
      code: 'STALE_PROFILE_VERSION',
      message: 'The investor profile changed; reload before retrying',
    },
  };
  const mapped = failures[reason]
    ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Investor profile could not be processed' };
  return reply.status(mapped.status).send({
    success: false,
    error: { code: mapped.code, message: mapped.message },
  });
}

export async function registerInvestorProfileRoutes(
  app: FastifyInstance,
  options: Options,
): Promise<void> {
  app.get('/v1/onboarding/investor/cases/:caseId/profile', {
    schema: operation({
      operationId: 'getOwnInvestorProfile',
      summary: 'Read the individual investor KYC profile for an owned case',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['investor_onboarding.read_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: caseIdParameters,
        response: {
          200: successResponse(investorProfileSchema),
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
    if (!hasPermission(identity.authorization, 'investor_onboarding.read_own')) {
      return forbidden(reply);
    }
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid case ID is required' },
      });
    }
    const profile = await options.profiles.getOwn(
      identity.authorization.user.id,
      parameters.data.caseId,
    );
    if (!profile) return failure(reply, 'case_not_found');
    return reply.send({ success: true, data: profile });
  });

  app.post('/v1/onboarding/investor/cases/:caseId/profile', {
    schema: operation({
      operationId: 'saveOwnInvestorProfile',
      summary: 'Create or replace the individual investor KYC profile for an owned draft case',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['investor_onboarding.manage_own'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: ['create or replace investor profile', 'append audit event'],
        auditEvent: 'investor_profile.saved',
      },
      http: {
        params: caseIdParameters,
        body: saveInvestorProfileBody,
        response: {
          200: successResponse(investorProfileSchema),
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
    if (!hasPermission(identity.authorization, 'investor_onboarding.manage_own')) {
      return forbidden(reply);
    }
    const parameters = parametersSchema.safeParse(request.params);
    const body = saveSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid case ID and investor profile are required',
        },
      });
    }
    const result = await options.profiles.saveOwn({
      applicantUserId: identity.authorization.user.id,
      actorRoles: identity.authorization.roles,
      caseId: parameters.data.caseId,
      ...body.data,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(200).send({ success: true, data: result.profile });
  });
}
