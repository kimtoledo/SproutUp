import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { roleKeySchema, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

const supportedCommandSchema = z.enum(['role.assign', 'role.revoke']);
const roleChangePayloadSchema = z.object({ roleKey: roleKeySchema, targetUserId: z.uuid() });

type LifecycleFailure =
  | 'not_found'
  | 'not_pending'
  | 'same_actor'
  | 'not_maker'
  | 'self_review_not_allowed'
  | 'expired'
  | 'payload_mismatch';

export interface ApprovalLifecycleService {
  reject(input: {
    checkerUserId: string;
    checkerRoles: RoleKey[];
    approvalId: string;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true } | { ok: false; reason: LifecycleFailure }>;
  cancel(input: {
    makerUserId: string;
    makerRoles: RoleKey[];
    approvalId: string;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true } | { ok: false; reason: LifecycleFailure }>;
}

function hashPayload(payload: z.infer<typeof roleChangePayloadSchema>): string {
  return createHash('sha256')
    .update(JSON.stringify({ roleKey: payload.roleKey, targetUserId: payload.targetUserId }))
    .digest('hex');
}

export function createApprovalLifecycleService(
  database: Database,
  clock: () => Date = () => new Date(),
): ApprovalLifecycleService {
  return {
    async reject(input) {
      return database.transaction(async (transaction) => {
        const [request] = await transaction
          .select()
          .from(schema.approvalRequests)
          .where(eq(schema.approvalRequests.id, input.approvalId))
          .limit(1)
          .for('update');
        if (!request || !supportedCommandSchema.safeParse(request.commandType).success) {
          return { ok: false as const, reason: 'not_found' as const };
        }
        if (request.status !== 'pending') return { ok: false as const, reason: 'not_pending' as const };
        if (request.makerUserId === input.checkerUserId) {
          return { ok: false as const, reason: 'same_actor' as const };
        }

        const payload = roleChangePayloadSchema.safeParse(request.payload);
        if (!payload.success || hashPayload(payload.data) !== request.payloadHash) {
          return { ok: false as const, reason: 'payload_mismatch' as const };
        }
        if (payload.data.targetUserId === input.checkerUserId) {
          return { ok: false as const, reason: 'self_review_not_allowed' as const };
        }
        if (request.expiresAt <= clock()) {
          await transaction
            .update(schema.approvalRequests)
            .set({ status: 'expired' })
            .where(and(eq(schema.approvalRequests.id, request.id), eq(schema.approvalRequests.status, 'pending')));
          await transaction.insert(schema.approvalActions).values({
            requestId: request.id,
            action: 'expired',
            actorUserId: input.checkerUserId,
            payloadHash: request.payloadHash,
          });
          await writeAudit(transaction, {
            actorType: 'user',
            actorUserId: input.checkerUserId,
            actorRoles: input.checkerRoles,
            action: 'approval.expired',
            outcome: 'denied',
            resourceType: 'approval_request',
            resourceId: request.id,
            requestId: input.requestId,
            ipAddressHash: input.ipAddressHash,
            reason: 'Approval request expired before rejection',
            metadata: { commandType: request.commandType, payloadHash: request.payloadHash },
          });
          return { ok: false as const, reason: 'expired' as const };
        }

        await transaction
          .update(schema.approvalRequests)
          .set({ status: 'rejected', checkerUserId: input.checkerUserId })
          .where(and(eq(schema.approvalRequests.id, request.id), eq(schema.approvalRequests.status, 'pending')));
        await transaction.insert(schema.approvalActions).values({
          requestId: request.id,
          action: 'rejected',
          actorUserId: input.checkerUserId,
          payloadHash: request.payloadHash,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.checkerUserId,
          actorRoles: input.checkerRoles,
          action: 'approval.rejected',
          outcome: 'succeeded',
          resourceType: 'approval_request',
          resourceId: request.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { commandType: request.commandType, payloadHash: request.payloadHash },
        });
        return { ok: true as const };
      });
    },

    async cancel(input) {
      return database.transaction(async (transaction) => {
        const [request] = await transaction
          .select()
          .from(schema.approvalRequests)
          .where(eq(schema.approvalRequests.id, input.approvalId))
          .limit(1)
          .for('update');
        if (!request || !supportedCommandSchema.safeParse(request.commandType).success) {
          return { ok: false as const, reason: 'not_found' as const };
        }
        if (request.status !== 'pending') return { ok: false as const, reason: 'not_pending' as const };
        if (request.makerUserId !== input.makerUserId) {
          return { ok: false as const, reason: 'not_maker' as const };
        }

        const payload = roleChangePayloadSchema.safeParse(request.payload);
        if (!payload.success || hashPayload(payload.data) !== request.payloadHash) {
          return { ok: false as const, reason: 'payload_mismatch' as const };
        }
        if (request.expiresAt <= clock()) {
          await transaction
            .update(schema.approvalRequests)
            .set({ status: 'expired' })
            .where(and(eq(schema.approvalRequests.id, request.id), eq(schema.approvalRequests.status, 'pending')));
          await transaction.insert(schema.approvalActions).values({
            requestId: request.id,
            action: 'expired',
            actorUserId: input.makerUserId,
            payloadHash: request.payloadHash,
          });
          await writeAudit(transaction, {
            actorType: 'user',
            actorUserId: input.makerUserId,
            actorRoles: input.makerRoles,
            action: 'approval.expired',
            outcome: 'denied',
            resourceType: 'approval_request',
            resourceId: request.id,
            requestId: input.requestId,
            ipAddressHash: input.ipAddressHash,
            reason: 'Approval request expired before cancellation',
            metadata: { commandType: request.commandType, payloadHash: request.payloadHash },
          });
          return { ok: false as const, reason: 'expired' as const };
        }

        await transaction
          .update(schema.approvalRequests)
          .set({ status: 'cancelled' })
          .where(and(eq(schema.approvalRequests.id, request.id), eq(schema.approvalRequests.status, 'pending')));
        await transaction.insert(schema.approvalActions).values({
          requestId: request.id,
          action: 'cancelled',
          actorUserId: input.makerUserId,
          payloadHash: request.payloadHash,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.makerUserId,
          actorRoles: input.makerRoles,
          action: 'approval.cancelled',
          outcome: 'succeeded',
          resourceType: 'approval_request',
          resourceId: request.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { commandType: request.commandType, payloadHash: request.payloadHash },
        });
        return { ok: true as const };
      });
    },
  };
}
