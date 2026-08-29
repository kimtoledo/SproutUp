import { createHash } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { roleKeySchema, type RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

const roleRevocationPayloadSchema = z.object({
  roleKey: roleKeySchema,
  targetUserId: z.uuid(),
});
type RoleRevocationPayload = z.infer<typeof roleRevocationPayloadSchema>;

type ProposalFailure =
  | 'restricted_role'
  | 'self_target_not_allowed'
  | 'target_not_found'
  | 'role_not_found'
  | 'not_assigned'
  | 'last_role_not_allowed'
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
  | 'not_assigned'
  | 'last_role_not_allowed'
  | 'restricted_role';

export interface PendingRoleRevocation {
  id: string;
  payload: RoleRevocationPayload;
  payloadHash: string;
  makerUserId: string;
  reason: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface RoleRevocationService {
  listPending(): Promise<PendingRoleRevocation[]>;
  propose(input: {
    makerUserId: string;
    makerRoles: RoleKey[];
    targetUserId: string;
    roleKey: RoleKey;
    reason: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true; request: PendingRoleRevocation } | { ok: false; reason: ProposalFailure }>;
  approve(input: {
    checkerUserId: string;
    checkerRoles: RoleKey[];
    approvalId: string;
    reason?: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<{ ok: true } | { ok: false; reason: ApprovalFailure }>;
}

function hashPayload(payload: RoleRevocationPayload): string {
  return createHash('sha256')
    .update(JSON.stringify({ roleKey: payload.roleKey, targetUserId: payload.targetUserId }))
    .digest('hex');
}

export function createRoleRevocationService(
  database: Database,
  clock: () => Date = () => new Date(),
): RoleRevocationService {
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
            eq(schema.approvalRequests.commandType, 'role.revoke'),
            eq(schema.approvalRequests.status, 'pending'),
            gt(schema.approvalRequests.expiresAt, clock()),
          ),
        )
        .orderBy(asc(schema.approvalRequests.createdAt));

      return rows.flatMap((row) => {
        const payload = roleRevocationPayloadSchema.safeParse(row.payload);
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
          .select({ id: schema.users.id, status: schema.users.status })
          .from(schema.users)
          .where(eq(schema.users.id, input.targetUserId))
          .limit(1);
        if (!target) return { ok: false as const, reason: 'target_not_found' as const };

        const [role] = await transaction
          .select({ key: schema.roles.key })
          .from(schema.roles)
          .where(eq(schema.roles.key, input.roleKey))
          .limit(1);
        if (!role) return { ok: false as const, reason: 'role_not_found' as const };

        const assignedRoles = await transaction
          .select({ roleKey: schema.userRoles.roleKey })
          .from(schema.userRoles)
          .where(eq(schema.userRoles.userId, input.targetUserId));
        if (!assignedRoles.some(({ roleKey }) => roleKey === input.roleKey)) {
          return { ok: false as const, reason: 'not_assigned' as const };
        }
        if (target.status === 'active' && assignedRoles.length === 1) {
          return { ok: false as const, reason: 'last_role_not_allowed' as const };
        }

        const payload: RoleRevocationPayload = { roleKey: input.roleKey, targetUserId: input.targetUserId };
        const payloadHash = hashPayload(payload);
        const [duplicate] = await transaction
          .select({ id: schema.approvalRequests.id })
          .from(schema.approvalRequests)
          .where(
            and(
              eq(schema.approvalRequests.commandType, 'role.revoke'),
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
            commandType: 'role.revoke',
            payload,
            payloadHash,
            makerUserId: input.makerUserId,
            reason: input.reason,
            expiresAt,
          })
          .onConflictDoNothing()
          .returning({ id: schema.approvalRequests.id, createdAt: schema.approvalRequests.createdAt });
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
          action: 'role_revocation.proposed',
          outcome: 'succeeded',
          resourceType: 'approval_request',
          resourceId: request.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
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
              eq(schema.approvalRequests.commandType, 'role.revoke'),
            ),
          )
          .limit(1)
          .for('update');
        if (!request) return { ok: false as const, reason: 'not_found' as const };
        if (request.status !== 'pending') return { ok: false as const, reason: 'not_pending' as const };
        if (request.makerUserId === input.checkerUserId) {
          return { ok: false as const, reason: 'same_actor' as const };
        }

        const payloadResult = roleRevocationPayloadSchema.safeParse(request.payload);
        if (!payloadResult.success || hashPayload(payloadResult.data) !== request.payloadHash) {
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
            action: 'role_revocation.expired',
            outcome: 'denied',
            resourceType: 'approval_request',
            resourceId: request.id,
            requestId: input.requestId,
            ipAddressHash: input.ipAddressHash,
            reason: 'Approval request expired before execution',
            metadata: { approvalRequestId: request.id, payloadHash: request.payloadHash },
          });
          return { ok: false as const, reason: 'expired' as const };
        }

        const [target] = await transaction
          .select({ id: schema.users.id, status: schema.users.status })
          .from(schema.users)
          .where(eq(schema.users.id, payload.targetUserId))
          .limit(1);
        if (!target) return { ok: false as const, reason: 'target_not_found' as const };
        const [role] = await transaction
          .select({ key: schema.roles.key })
          .from(schema.roles)
          .where(eq(schema.roles.key, payload.roleKey))
          .limit(1);
        if (!role) return { ok: false as const, reason: 'role_not_found' as const };

        const assignedRoles = await transaction
          .select({ roleKey: schema.userRoles.roleKey })
          .from(schema.userRoles)
          .where(eq(schema.userRoles.userId, payload.targetUserId))
          .for('update');
        if (!assignedRoles.some(({ roleKey }) => roleKey === payload.roleKey)) {
          return { ok: false as const, reason: 'not_assigned' as const };
        }
        if (target.status === 'active' && assignedRoles.length === 1) {
          return { ok: false as const, reason: 'last_role_not_allowed' as const };
        }

        const [revoked] = await transaction
          .delete(schema.userRoles)
          .where(
            and(
              eq(schema.userRoles.userId, payload.targetUserId),
              eq(schema.userRoles.roleKey, payload.roleKey),
            ),
          )
          .returning({ userId: schema.userRoles.userId });
        if (!revoked) return { ok: false as const, reason: 'not_assigned' as const };

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
          action: 'role_revocation.executed',
          outcome: 'succeeded',
          resourceType: 'user_role',
          resourceId: `${payload.targetUserId}:${payload.roleKey}`,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
          reason: input.reason,
          metadata: { ...payload, approvalRequestId: request.id, payloadHash: request.payloadHash },
        });

        return { ok: true as const };
      });
    },
  };
}
