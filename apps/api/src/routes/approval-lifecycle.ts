import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission } from '@sproutup/shared';
import type { ApprovalLifecycleService } from '../auth/approval-lifecycle-service.js';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';

const parametersSchema = z.object({ approvalId: z.uuid() });
const decisionSchema = z.object({ reason: z.string().trim().min(10).max(500) });

interface Options {
  auth: AuthServices;
  lifecycle: ApprovalLifecycleService;
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' } });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'The required permission is not granted' } });
}

function failure(reply: FastifyReply, reason: string) {
  const failures: Record<string, { status: number; code: string; message: string }> = {
    not_found: { status: 404, code: 'APPROVAL_NOT_FOUND', message: 'Role approval request not found' },
    not_pending: { status: 409, code: 'APPROVAL_NOT_PENDING', message: 'The approval request is no longer pending' },
    same_actor: { status: 409, code: 'MAKER_CHECKER_CONFLICT', message: 'The proposal maker cannot reject the same request' },
    not_maker: { status: 403, code: 'NOT_PROPOSAL_MAKER', message: 'Only the proposal maker can cancel this request' },
    self_review_not_allowed: { status: 409, code: 'SELF_REVIEW_NOT_ALLOWED', message: 'A target user cannot review their own role change' },
    expired: { status: 409, code: 'APPROVAL_EXPIRED', message: 'The approval request has expired' },
    payload_mismatch: { status: 409, code: 'APPROVAL_PAYLOAD_MISMATCH', message: 'The approval payload failed its integrity check' },
  };
  const mapped = failures[reason] ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Approval transition could not be processed' };
  return reply.status(mapped.status).send({ success: false, error: { code: mapped.code, message: mapped.message } });
}

export async function registerApprovalLifecycleRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.post('/v1/admin/role-approvals/:approvalId/reject', async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.assign')) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    const body = decisionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid approval ID and 10–500 character reason are required' } });
    }
    const result = await options.lifecycle.reject({
      checkerUserId: identity.authorization.user.id,
      checkerRoles: identity.authorization.roles,
      approvalId: parameters.data.approvalId,
      reason: body.data.reason,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(204).send();
  });

  app.post('/v1/admin/role-approvals/:approvalId/cancel', async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'roles.assign')) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    const body = decisionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid approval ID and 10–500 character reason are required' } });
    }
    const result = await options.lifecycle.cancel({
      makerUserId: identity.authorization.user.id,
      makerRoles: identity.authorization.roles,
      approvalId: parameters.data.approvalId,
      reason: body.data.reason,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.status(204).send();
  });
}
