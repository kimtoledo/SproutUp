import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashIpAddress } from '@sproutup/db';
import { hasPermission, roleKeySchema } from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { RoleAssignmentService } from '../auth/role-assignments-service.js';
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

interface RegisterRoleAssignmentRoutesOptions {
  auth: AuthServices;
  roleAssignments: RoleAssignmentService;
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
    restricted_role: {
      status: 403,
      code: 'RESTRICTED_ROLE',
      message: 'Super Admin grants require an out-of-band bootstrap policy',
    },
    self_target_not_allowed: {
      status: 409,
      code: 'SELF_TARGET_NOT_ALLOWED',
      message: 'A maker cannot propose a role assignment for their own account',
    },
    self_approval_not_allowed: {
      status: 409,
      code: 'SELF_APPROVAL_NOT_ALLOWED',
      message: 'A checker cannot approve a role assignment for their own account',
    },
    same_actor: {
      status: 409,
      code: 'MAKER_CHECKER_CONFLICT',
      message: 'The proposal maker cannot approve the same request',
    },
    duplicate_pending: {
      status: 409,
      code: 'DUPLICATE_PENDING_APPROVAL',
      message: 'An equivalent role assignment is already awaiting approval',
    },
    already_assigned: {
      status: 409,
      code: 'ROLE_ALREADY_ASSIGNED',
      message: 'The user already has this role',
    },
    not_pending: {
      status: 409,
      code: 'APPROVAL_NOT_PENDING',
      message: 'The approval request is no longer pending',
    },
    expired: {
      status: 409,
      code: 'APPROVAL_EXPIRED',
      message: 'The approval request has expired',
    },
    payload_mismatch: {
      status: 409,
      code: 'APPROVAL_PAYLOAD_MISMATCH',
      message: 'The approval payload failed its integrity check',
    },
    target_not_found: { status: 404, code: 'TARGET_NOT_FOUND', message: 'Active target user not found' },
    role_not_found: { status: 404, code: 'ROLE_NOT_FOUND', message: 'Active role not found' },
    not_found: { status: 404, code: 'APPROVAL_NOT_FOUND', message: 'Approval request not found' },
  };
  const mapped = failures[reason] ?? {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Role assignment could not be processed',
  };

  return reply.status(mapped.status).send({
    success: false,
    error: { code: mapped.code, message: mapped.message },
  });
}

export async function registerRoleAssignmentRoutes(
  app: FastifyInstance,
  options: RegisterRoleAssignmentRoutesOptions,
): Promise<void> {
  app.get('/v1/admin/role-assignments', {
    schema: operation({
      operationId: 'listPendingRoleAssignments',
      summary: 'List unexpired pending role-assignment proposals',
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

    return reply.send({ success: true, data: await options.roleAssignments.listPending() });
  });

  app.post('/v1/admin/role-assignments', {
    schema: operation({
      operationId: 'proposeRoleAssignment',
      summary: 'Propose a hash-bound role assignment for independent approval',
      tags: ['role approvals'],
      metadata: {
        actor: 'staff', permissions: ['roles.assign'], permissionMode: 'all',
        retryModel: 'unique_pending_approval',
        sideEffects: ['create approval request', 'append approval action', 'append audit event'],
        auditEvent: 'role_assignment.proposed',
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
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Target, role, and a 10–500 character reason are required' },
      });
    }

    const result = await options.roleAssignments.propose({
      makerUserId: identity.authorization.user.id,
      makerRoles: identity.authorization.roles,
      ...parsed.data,
      requestId: request.id,
      ipAddressHash: hashIpAddress(request.ip),
    });
    if (!result.ok) return failure(reply, result.reason);

    return reply.status(201).send({ success: true, data: result.request });
  });

  app.post('/v1/admin/role-assignments/:approvalId/approve', {
    schema: operation({
      operationId: 'approveRoleAssignment',
      summary: 'Approve and execute a pending role assignment as an independent checker',
      tags: ['role approvals'],
      metadata: {
        actor: 'staff', permissions: ['roles.assign'], permissionMode: 'all',
        retryModel: 'locked_approval_decision',
        sideEffects: ['grant role', 'transition approval', 'append approval actions', 'append audit event'],
        auditEvent: 'role_assignment.executed',
      },
      http: {
        params: approvalIdParameters,
        body: optionalApprovalReasonBody,
        response: {
          204: { type: 'null', description: 'Role assignment approved and executed' },
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
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid approval ID and optional reason are required' },
      });
    }

    const result = await options.roleAssignments.approve({
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
