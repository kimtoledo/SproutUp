import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashIpAddress } from '@sproutup/db';
import { borrowerEntityTypeSchema, hasPermission } from '@sproutup/shared';
import type { BorrowerProfileService } from '../onboarding/borrower-profile-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { operation } from '../openapi/operation.js';
import { caseIdParameters, commonErrors, successResponse } from '../openapi/onboarding-schemas.js';
import { borrowerProfileSchema, saveBorrowerProfileBody } from '../openapi/borrower-profile-schemas.js';

interface Options {
  auth: AuthServices;
  profiles: BorrowerProfileService;
}

const parametersSchema = z.object({ caseId: z.uuid() });

const beneficialOwnerInputSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  ownershipPercentage: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Use a decimal percentage like 25.50'),
  nationality: z.string().trim().min(1).max(80).optional(),
  isPep: z.boolean(),
});

const saveSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  entityType: borrowerEntityTypeSchema,
  registeredName: z.string().trim().min(1).max(300),
  tradeName: z.string().trim().min(1).max(300).optional(),
  registrationNumber: z.string().trim().min(1).max(100).optional(),
  tin: z.string().trim().min(1).max(30).optional(),
  principalAddress: z.string().trim().min(1).max(500).optional(),
  contactPersonName: z.string().trim().min(1).max(200).optional(),
  contactPersonEmail: z.email().optional(),
  contactPersonPhone: z.string().trim().min(1).max(30).optional(),
  dateEstablished: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  beneficialOwners: z.array(beneficialOwnerInputSchema).max(20).default([]),
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
      message: 'The borrower profile changed; reload before retrying',
    },
    ownership_percentage_exceeds_total: {
      status: 400,
      code: 'OWNERSHIP_PERCENTAGE_EXCEEDS_TOTAL',
      message: 'Declared beneficial owner percentages cannot exceed 100%',
    },
  };
  const mapped = failures[reason]
    ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Borrower profile could not be processed' };
  return reply.status(mapped.status).send({
    success: false,
    error: { code: mapped.code, message: mapped.message },
  });
}

export async function registerBorrowerProfileRoutes(
  app: FastifyInstance,
  options: Options,
): Promise<void> {
  app.get('/v1/onboarding/borrower/cases/:caseId/profile', {
    schema: operation({
      operationId: 'getOwnBorrowerProfile',
      summary: 'Read the borrower KYB profile for an owned case',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['borrower_onboarding.read_own'],
        permissionMode: 'all',
        retryModel: 'safe_read',
        sideEffects: [],
        auditEvent: null,
      },
      http: {
        params: caseIdParameters,
        response: {
          200: successResponse(borrowerProfileSchema),
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
    if (!hasPermission(identity.authorization, 'borrower_onboarding.read_own')) {
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

  app.post('/v1/onboarding/borrower/cases/:caseId/profile', {
    schema: operation({
      operationId: 'saveOwnBorrowerProfile',
      summary: 'Create or replace the borrower KYB profile for an owned draft case',
      tags: ['onboarding'],
      metadata: {
        actor: 'authenticated_customer',
        permissions: ['borrower_onboarding.manage_own'],
        permissionMode: 'all',
        retryModel: 'optimistic_version',
        sideEffects: [
          'create or replace borrower profile',
          'replace beneficial owners',
          'append audit event',
        ],
        auditEvent: 'borrower_profile.saved',
      },
      http: {
        params: caseIdParameters,
        body: saveBorrowerProfileBody,
        response: {
          200: successResponse(borrowerProfileSchema),
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
    if (!hasPermission(identity.authorization, 'borrower_onboarding.manage_own')) {
      return forbidden(reply);
    }
    const parameters = parametersSchema.safeParse(request.params);
    const body = saveSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid case ID and borrower profile are required',
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
