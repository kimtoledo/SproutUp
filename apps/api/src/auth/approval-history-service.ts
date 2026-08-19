import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { roleKeySchema } from '@sproutup/shared';
import { schema, type Database } from '@sproutup/db';

export const roleApprovalCommandSchema = z.enum(['role.assign', 'role.revoke']);
export const approvalStatusSchema = z.enum(['pending', 'executed', 'rejected', 'cancelled', 'expired', 'failed']);
const payloadSchema = z.object({ roleKey: roleKeySchema, targetUserId: z.uuid() });

function hashPayload(payload: z.infer<typeof payloadSchema>): string {
  return createHash('sha256')
    .update(JSON.stringify({ roleKey: payload.roleKey, targetUserId: payload.targetUserId }))
    .digest('hex');
}

export interface ApprovalHistoryService {
  list(input: {
    page: number;
    pageSize: number;
    commandType?: z.infer<typeof roleApprovalCommandSchema>;
    status?: z.infer<typeof approvalStatusSchema>;
  }): Promise<{ approvals: Array<Record<string, unknown>>; page: number; pageSize: number; total: number }>;
  detail(approvalId: string): Promise<Record<string, unknown> | null>;
}

export function createApprovalHistoryService(database: Database): ApprovalHistoryService {
  const roleCommands = roleApprovalCommandSchema.options;

  return {
    async list(input) {
      const filters: SQL[] = [inArray(schema.approvalRequests.commandType, roleCommands)];
      if (input.commandType) filters.push(eq(schema.approvalRequests.commandType, input.commandType));
      if (input.status) filters.push(eq(schema.approvalRequests.status, input.status));
      const where = and(...filters);

      const [[totalRow], approvals] = await Promise.all([
        database.select({ value: count() }).from(schema.approvalRequests).where(where),
        database
          .select({
            id: schema.approvalRequests.id,
            commandType: schema.approvalRequests.commandType,
            status: schema.approvalRequests.status,
            payload: schema.approvalRequests.payload,
            payloadHash: schema.approvalRequests.payloadHash,
            version: schema.approvalRequests.version,
            makerUserId: schema.approvalRequests.makerUserId,
            checkerUserId: schema.approvalRequests.checkerUserId,
            reason: schema.approvalRequests.reason,
            expiresAt: schema.approvalRequests.expiresAt,
            executedAt: schema.approvalRequests.executedAt,
            createdAt: schema.approvalRequests.createdAt,
            updatedAt: schema.approvalRequests.updatedAt,
          })
          .from(schema.approvalRequests)
          .where(where)
          .orderBy(desc(schema.approvalRequests.createdAt), desc(schema.approvalRequests.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
      ]);

      return {
        approvals: approvals.map((approval) => {
          const payload = payloadSchema.safeParse(approval.payload);
          return {
            ...approval,
            payload: payload.success ? payload.data : approval.payload,
            integrity: payload.success && hashPayload(payload.data) === approval.payloadHash ? 'valid' : 'invalid',
          };
        }),
        page: input.page,
        pageSize: input.pageSize,
        total: totalRow?.value ?? 0,
      };
    },

    async detail(approvalId) {
      const [approval] = await database
        .select()
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.id, approvalId),
            inArray(schema.approvalRequests.commandType, roleCommands),
          ),
        )
        .limit(1);
      if (!approval) return null;

      const actions = await database
        .select({
          id: schema.approvalActions.id,
          action: schema.approvalActions.action,
          actorUserId: schema.approvalActions.actorUserId,
          payloadHash: schema.approvalActions.payloadHash,
          reason: schema.approvalActions.reason,
          occurredAt: schema.approvalActions.occurredAt,
          metadata: schema.approvalActions.metadata,
        })
        .from(schema.approvalActions)
        .where(eq(schema.approvalActions.requestId, approval.id))
        .orderBy(asc(schema.approvalActions.occurredAt), asc(schema.approvalActions.id));
      const payload = payloadSchema.safeParse(approval.payload);

      return {
        ...approval,
        payload: payload.success ? payload.data : approval.payload,
        integrity: payload.success && hashPayload(payload.data) === approval.payloadHash ? 'valid' : 'invalid',
        actions,
      };
    },
  };
}
