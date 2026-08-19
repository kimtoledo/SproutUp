import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission } from '@sproutup/shared';
import {
  approvalStatusSchema,
  roleApprovalCommandSchema,
  type ApprovalHistoryService,
} from '../auth/approval-history-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import { operation } from '../openapi/operation.js';
import {
  approvalHistoryDetailSchema,
  approvalHistoryListResponse,
  approvalHistoryQuery,
  approvalIdParameters,
} from '../openapi/role-approval-schemas.js';
import { commonErrors, successResponse } from '../openapi/onboarding-schemas.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  commandType: roleApprovalCommandSchema.optional(),
  status: approvalStatusSchema.optional(),
});
const parametersSchema = z.object({ approvalId: z.uuid() });

interface Options {
  auth: AuthServices;
  history: ApprovalHistoryService;
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' } });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'The required permission is not granted' } });
}

export async function registerApprovalHistoryRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.get('/v1/admin/role-approvals', {
    schema: operation({
      operationId: 'listRoleApprovalHistory',
      summary: 'List bounded role-approval history with payload integrity status',
      tags: ['role approvals'],
      metadata: {
        actor: 'staff', permissions: ['roles.assign'], permissionMode: 'all',
        retryModel: 'safe_read', sideEffects: [], auditEvent: null,
      },
      http: {
        querystring: approvalHistoryQuery,
        response: {
          200: approvalHistoryListResponse,
          400: commonErrors[400], 401: commonErrors[401], 403: commonErrors[403],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.assign')) return forbidden(reply);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid approval history filters' } });
    }
    return reply.send({ success: true, data: await options.history.list(parsed.data) });
  });

  app.get('/v1/admin/role-approvals/:approvalId', {
    schema: operation({
      operationId: 'getRoleApprovalHistory',
      summary: 'Read one role approval and its immutable action timeline',
      tags: ['role approvals'],
      metadata: {
        actor: 'staff', permissions: ['roles.assign'], permissionMode: 'all',
        retryModel: 'safe_read', sideEffects: [], auditEvent: null,
      },
      http: {
        params: approvalIdParameters,
        response: {
          200: successResponse(approvalHistoryDetailSchema),
          400: commonErrors[400], 401: commonErrors[401], 403: commonErrors[403],
          404: commonErrors[404],
        },
      },
    }),
  }, async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.assign')) return forbidden(reply);
    const parsed = parametersSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid approval ID is required' } });
    }
    const detail = await options.history.detail(parsed.data.approvalId);
    if (!detail) {
      return reply.status(404).send({ success: false, error: { code: 'APPROVAL_NOT_FOUND', message: 'Role approval request not found' } });
    }
    return reply.send({ success: true, data: detail });
  });
}
