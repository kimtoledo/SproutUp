import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashIpAddress } from '@sproutup/db';
import { hasPermission, roleKeySchema } from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { RoleRevocationService } from '../auth/role-revocations-service.js';
import type { AuthServices } from '../auth/types.js';
import { operation } from '../openapi/operation.js';
import {
  approvalIdParameters,
  optionalApprovalReasonBody,
  pendingRoleChangeListResponses,
  pendingRoleChangeSchema,
  roleChangeProposalBody,
} from '../openapi/role-approval-schemas.js';
import { commonErrors, successResponse } from '../openapi/onboarding-schemas.js';

const proposalSchema = z.object({
  targetUserId: z.uuid(),
  roleKey: roleKeySchema,
  reason: z.string().trim().min(10).max(500),
});
const approvalParametersSchema = z.object({ approvalId: z.uuid() });
const approvalBodySchema = z.object({ reason: z.string().trim().min(10).max(500).optional() });

interface Options {
  auth: AuthServices;
  roleRevocations: RoleRevocationService;
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' },
  });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({
    success: false,
    error: { code: 'FORBIDDEN', message: 'The required permission is not granted' },
  });
}

function failure(reply: FastifyReply, reason: string) {
  const failures: Record<string, { status: number; code: string; message: string }> = {
    restricted_role: { status: 403, code: 'RESTRICTED_ROLE', message: 'Super Admin changes require an out-of-band policy' },
    self_target_not_allowed: { status: 409, code: 'SELF_TARGET_NOT_ALLOWED', message: 'A maker cannot revoke their own role' },
    self_approval_not_allowed: { status: 409, code: 'SELF_APPROVAL_NOT_ALLOWED', message: 'A checker cannot approve their own role revocation' },
    same_actor: { status: 409, code: 'MAKER_CHECKER_CONFLICT', message: 'The proposal maker cannot approve the same request' },
    duplicate_pending: { status: 409, code: 'DUPLICATE_PENDING_APPROVAL', message: 'An equivalent revocation is already awaiting approval' },
    not_assigned: { status: 409, code: 'ROLE_NOT_ASSIGNED', message: 'The user does not currently have this role' },
    last_role_not_allowed: { status: 409, code: 'LAST_ROLE_NOT_ALLOWED', message: 'An active account cannot lose its last role' },
    not_pending: { status: 409, code: 'APPROVAL_NOT_PENDING', message: 'The approval request is no longer pending' },
    expired: { status: 409, code: 'APPROVAL_EXPIRED', message: 'The approval request has expired' },
    payload_mismatch: { status: 409, code: 'APPROVAL_PAYLOAD_MISMATCH', message: 'The approval payload failed its integrity check' },
    target_not_found: { status: 404, code: 'TARGET_NOT_FOUND', message: 'Target user not found' },
    role_not_found: { status: 404, code: 'ROLE_NOT_FOUND', message: 'Role not found' },
    not_found: { status: 404, code: 'APPROVAL_NOT_FOUND', message: 'Approval request not found' },
  };
  const mapped = failures[reason] ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Role revocation could not be processed' };
  return reply.status(mapped.status).send({ success: false, error: { code: mapped.code, message: mapped.message } });
}

export async function registerRoleRevocationRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.get('/v1/admin/role-revocations', {
    schema: operation({
      operationId: 'listPendingRoleRevocations',
      summary: 'List unexpired pending role-revocation proposals',
      tags: ['role approvals'],
      metadata: {
        actor: 'staff', permissions: ['roles.assign'], permissionMode: 'all',
        retryModel: 'safe_read', sideEffects: [], auditEvent: null,
      },
      http: { response: pendingRoleChangeListResponses },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.assign')) return forbidden(reply);
    return reply.send({ success: true, data: await options.roleRevocations.listPending() });
  });

  app.post('/v1/admin/role-revocations', {
    schema: operation({
      operationId: 'proposeRoleRevocation',
      summary: 'Propose a hash-bound role revocation for independent approval',
      tags: ['role approvals'],
      metadata: {
        actor: 'staff', permissions: ['roles.assign'], permissionMode: 'all',
        retryModel: 'unique_pending_approval',
        sideEffects: ['create approval request', 'append approval action', 'append audit event'],
        auditEvent: 'role_revocation.proposed',
      },
      http: {
        body: roleChangeProposalBody,
        response: {
          201: successResponse(pendingRoleChangeSchema),
          400: commonErrors[400], 401: commonErrors[401], 403: commonErrors[403],
          404: commonErrors[404], 409: commonErrors[409],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.assign')) return forbidden(reply);
    const parsed = proposalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Target, role, and a 10–500 character reason are required' } });
    }
    const result = await options.roleRevocations.propose({
      makerUserId: identity.authorization.user.id,
      makerRoles: identity.authorization.roles,
      ...parsed.data,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(201).send({ success: true, data: result.request });
  });

  app.post('/v1/admin/role-revocations/:approvalId/approve', {
    schema: operation({
      operationId: 'approveRoleRevocation',
      summary: 'Approve and execute a pending role revocation as an independent checker',
      tags: ['role approvals'],
      metadata: {
        actor: 'staff', permissions: ['roles.assign'], permissionMode: 'all',
        retryModel: 'locked_approval_decision',
        sideEffects: ['revoke role', 'transition approval', 'append approval actions', 'append audit event'],
        auditEvent: 'role_revocation.executed',
      },
      http: {
        params: approvalIdParameters,
        body: optionalApprovalReasonBody,
        response: {
          204: { type: 'null', description: 'Role revocation approved and executed' },
          400: commonErrors[400], 401: commonErrors[401], 403: commonErrors[403],
          404: commonErrors[404], 409: commonErrors[409],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.assign')) return forbidden(reply);
    const parameters = approvalParametersSchema.safeParse(request.params);
    const body = approvalBodySchema.safeParse(request.body ?? {});
    if (!parameters.success || !body.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid approval ID and optional reason are required' } });
    }
    const result = await options.roleRevocations.approve({
      checkerUserId: identity.authorization.user.id,
      checkerRoles: identity.authorization.roles,
      approvalId: parameters.data.approvalId,
      reason: body.data.reason,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(204).send();
  });
}
