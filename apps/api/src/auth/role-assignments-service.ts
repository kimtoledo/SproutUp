import { createHash } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { roleKeySchema, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

const roleAssignmentPayloadSchema = z.object({
  roleKey: roleKeySchema,
  targetUserId: z.uuid(),
});

type RoleAssignmentPayload = z.infer<typeof roleAssignmentPayloadSchema>;

type ProposalFailure =
  | 'restricted_role'
  | 'self_target_not_allowed'
  | 'target_not_found'
  | 'role_not_found'
  | 'already_assigned'
  | 'duplicate_pending';

type ApprovalFailure =
  | 'not_found'
  | 'not_pending'
  | 'same_actor'
  | 'self_approval_not_allowed'
  | 'expired'
  | 'payload_mismatch'
  | 'target_not_found'
  | 'role_not_found'
  | 'already_assigned'
  | 'restricted_role';

export interface PendingRoleAssignment {
  id: string;
  payload: RoleAssignmentPayload;
  payloadHash: string;
  makerUserId: string;
  reason: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface RoleAssignmentService {
  listPending(): Promise<PendingRoleAssignment[]>;
  propose(input: {
    makerUserId: string;
    makerRoles: RoleKey[];
    targetUserId: string;
    roleKey: RoleKey;
    reason: string;
    requestId: string;
  }): Promise<{ ok: true; request: PendingRoleAssignment } | { ok: false; reason: ProposalFailure }>;
  approve(input: {
    checkerUserId: string;
    checkerRoles: RoleKey[];
    approvalId: string;
    reason?: string;
    requestId: string;
  }): Promise<{ ok: true } | { ok: false; reason: ApprovalFailure }>;
}

export function hashRoleAssignmentPayload(payload: RoleAssignmentPayload): string {
  return createHash('sha256')
    .update(JSON.stringify({ roleKey: payload.roleKey, targetUserId: payload.targetUserId }))
    .digest('hex');
}

export function createRoleAssignmentService(
  database: Database,
  clock: () => Date = () => new Date(),
): RoleAssignmentService {
  return {
    async listPending() {
      const rows = await database
        .select({
          id: schema.approvalRequests.id,
          payload: schema.approvalRequests.payload,
          payloadHash: schema.approvalRequests.payloadHash,
          makerUserId: schema.approvalRequests.makerUserId,
          reason: schema.approvalRequests.reason,
          expiresAt: schema.approvalRequests.expiresAt,
          createdAt: schema.approvalRequests.createdAt,
        })
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.commandType, 'role.assign'),
            eq(schema.approvalRequests.status, 'pending'),
            gt(schema.approvalRequests.expiresAt, clock()),
          ),
        )
        .orderBy(asc(schema.approvalRequests.createdAt));

      return rows.flatMap((row) => {
        const payload = roleAssignmentPayloadSchema.safeParse(row.payload);
        return payload.success ? [{ ...row, payload: payload.data }] : [];
      });
    },

    async propose(input) {
      if (input.roleKey === 'super_admin') return { ok: false, reason: 'restricted_role' };
      if (input.targetUserId === input.makerUserId) {
        return { ok: false, reason: 'self_target_not_allowed' };
      }

      return database.transaction(async (transaction) => {
        const [target] = await transaction
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.id, input.targetUserId), eq(schema.users.status, 'active')))
          .limit(1);
        if (!target) return { ok: false as const, reason: 'target_not_found' as const };

        const [role] = await transaction
          .select({ key: schema.roles.key })
          .from(schema.roles)
          .where(and(eq(schema.roles.key, input.roleKey), eq(schema.roles.isActive, true)))
          .limit(1);
        if (!role) return { ok: false as const, reason: 'role_not_found' as const };

        const [existing] = await transaction
          .select({ userId: schema.userRoles.userId })
          .from(schema.userRoles)
          .where(
            and(
              eq(schema.userRoles.userId, input.targetUserId),
              eq(schema.userRoles.roleKey, input.roleKey),
            ),
          )
          .limit(1);
        if (existing) return { ok: false as const, reason: 'already_assigned' as const };

        const payload: RoleAssignmentPayload = {
          roleKey: input.roleKey,
          targetUserId: input.targetUserId,
        };
        const payloadHash = hashRoleAssignmentPayload(payload);
        const [duplicate] = await transaction
          .select({ id: schema.approvalRequests.id })
          .from(schema.approvalRequests)
          .where(
            and(
              eq(schema.approvalRequests.commandType, 'role.assign'),
              eq(schema.approvalRequests.status, 'pending'),
              eq(schema.approvalRequests.payloadHash, payloadHash),
            ),
          )
          .limit(1);
        if (duplicate) return { ok: false as const, reason: 'duplicate_pending' as const };

        const expiresAt = new Date(clock().getTime() + 24 * 60 * 60 * 1000);
        const [request] = await transaction
          .insert(schema.approvalRequests)
          .values({
            commandType: 'role.assign',
            payload,
            payloadHash,
            makerUserId: input.makerUserId,
            reason: input.reason,
            expiresAt,
          })
          .onConflictDoNothing()
          .returning({
            id: schema.approvalRequests.id,
            createdAt: schema.approvalRequests.createdAt,
          });
        if (!request) return { ok: false as const, reason: 'duplicate_pending' as const };

        await transaction.insert(schema.approvalActions).values({
          requestId: request.id,
          action: 'proposed',
          actorUserId: input.makerUserId,
          payloadHash,
          reason: input.reason,
        });
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.makerUserId,
          actorRoles: input.makerRoles,
          action: 'role_assignment.proposed',
          outcome: 'succeeded',
          resourceType: 'approval_request',
          resourceId: request.id,
          requestId: input.requestId,
          reason: input.reason,
          metadata: payload,
        });

        return {
          ok: true as const,
          request: {
            id: request.id,
            payload,
            payloadHash,
            makerUserId: input.makerUserId,
            reason: input.reason,
            expiresAt,
            createdAt: request.createdAt,
          },
        };
      });
    },

    async approve(input) {
      return database.transaction(async (transaction) => {
        const [request] = await transaction
          .select()
          .from(schema.approvalRequests)
          .where(
            and(
              eq(schema.approvalRequests.id, input.approvalId),
              eq(schema.approvalRequests.commandType, 'role.assign'),
            ),
          )
          .limit(1)
          .for('update');
        if (!request) return { ok: false as const, reason: 'not_found' as const };
        if (request.status !== 'pending') return { ok: false as const, reason: 'not_pending' as const };
        if (request.makerUserId === input.checkerUserId) {
          return { ok: false as const, reason: 'same_actor' as const };
        }

        const payloadResult = roleAssignmentPayloadSchema.safeParse(request.payload);
        if (!payloadResult.success || hashRoleAssignmentPayload(payloadResult.data) !== request.payloadHash) {
          return { ok: false as const, reason: 'payload_mismatch' as const };
        }
        const payload = payloadResult.data;
        if (payload.roleKey === 'super_admin') return { ok: false as const, reason: 'restricted_role' as const };
        if (payload.targetUserId === input.checkerUserId) {
          return { ok: false as const, reason: 'self_approval_not_allowed' as const };
        }

        const now = clock();
        if (request.expiresAt <= now) {
          await transaction
            .update(schema.approvalRequests)
            .set({ status: 'expired' })
            .where(eq(schema.approvalRequests.id, request.id));
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
            action: 'role_assignment.expired',
            outcome: 'denied',
            resourceType: 'approval_request',
            resourceId: request.id,
            requestId: input.requestId,
            reason: 'Approval request expired before execution',
            metadata: { approvalRequestId: request.id, payloadHash: request.payloadHash },
          });
          return { ok: false as const, reason: 'expired' as const };
        }

        const [target] = await transaction
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.id, payload.targetUserId), eq(schema.users.status, 'active')))
          .limit(1);
        if (!target) return { ok: false as const, reason: 'target_not_found' as const };

        const [role] = await transaction
          .select({ key: schema.roles.key })
          .from(schema.roles)
          .where(and(eq(schema.roles.key, payload.roleKey), eq(schema.roles.isActive, true)))
          .limit(1);
        if (!role) return { ok: false as const, reason: 'role_not_found' as const };

        const [grant] = await transaction
          .insert(schema.userRoles)
          .values({
            userId: payload.targetUserId,
            roleKey: payload.roleKey,
            grantedBy: input.checkerUserId,
          })
          .onConflictDoNothing()
          .returning({ userId: schema.userRoles.userId });
        if (!grant) return { ok: false as const, reason: 'already_assigned' as const };

        await transaction
          .update(schema.approvalRequests)
          .set({ status: 'executed', checkerUserId: input.checkerUserId, executedAt: now })
          .where(eq(schema.approvalRequests.id, request.id));
        await transaction.insert(schema.approvalActions).values([
          {
            requestId: request.id,
            action: 'approved',
            actorUserId: input.checkerUserId,
            payloadHash: request.payloadHash,
            reason: input.reason,
          },
          {
            requestId: request.id,
            action: 'executed',
            actorUserId: input.checkerUserId,
            payloadHash: request.payloadHash,
          },
        ]);
        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.checkerUserId,
          actorRoles: input.checkerRoles,
          action: 'role_assignment.executed',
          outcome: 'succeeded',
          resourceType: 'user_role',
          resourceId: `${payload.targetUserId}:${payload.roleKey}`,
          requestId: input.requestId,
          reason: input.reason,
          metadata: { ...payload, approvalRequestId: request.id, payloadHash: request.payloadHash },
        });

        return { ok: true as const };
      });
    },
  };
}
