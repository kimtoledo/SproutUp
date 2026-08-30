import { and, desc, eq } from 'drizzle-orm';
import type { RoleKey } from '@sproutup/shared';
import { schema, writeAudit, type Database } from '@sproutup/db';

export interface SessionSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SessionService {
  listOwn(userId: string): Promise<SessionSummary[]>;
  revokeOwn(input: {
    userId: string;
    roles: RoleKey[];
    sessionId: string;
    requestId: string;
    ipAddressHash?: string;
  }): Promise<boolean>;
}

export function createSessionService(database: Database): SessionService {
  async function accountType(userId: string) {
    const [registry] = await database
      .select({ accountType: schema.accountEmailRegistry.accountType })
      .from(schema.accountEmailRegistry)
      .where(eq(schema.accountEmailRegistry.accountId, userId))
      .limit(1);
    return registry?.accountType ?? null;
  }

  return {
    async listOwn(userId) {
      const type = await accountType(userId);
      const selection = type === 'admin'
        ? await database.select({
            id: schema.adminSessions.id,
            createdAt: schema.adminSessions.createdAt,
            expiresAt: schema.adminSessions.expiresAt,
            ipAddress: schema.adminSessions.ipAddress,
            userAgent: schema.adminSessions.userAgent,
          }).from(schema.adminSessions)
          .where(eq(schema.adminSessions.userId, userId))
          .orderBy(desc(schema.adminSessions.createdAt))
        : type === 'borrower'
          ? await database.select({
              id: schema.borrowerSessions.id,
              createdAt: schema.borrowerSessions.createdAt,
              expiresAt: schema.borrowerSessions.expiresAt,
              ipAddress: schema.borrowerSessions.ipAddress,
              userAgent: schema.borrowerSessions.userAgent,
            }).from(schema.borrowerSessions)
            .where(eq(schema.borrowerSessions.userId, userId))
            .orderBy(desc(schema.borrowerSessions.createdAt))
          : type === 'investor'
            ? await database.select({
                id: schema.investorSessions.id,
                createdAt: schema.investorSessions.createdAt,
                expiresAt: schema.investorSessions.expiresAt,
                ipAddress: schema.investorSessions.ipAddress,
                userAgent: schema.investorSessions.userAgent,
              }).from(schema.investorSessions)
              .where(eq(schema.investorSessions.userId, userId))
              .orderBy(desc(schema.investorSessions.createdAt))
            : [];
      // Better Auth stores an unresolved IP/UA as an empty string; normalise to
      // null so clients get one "unknown" representation.
      return selection.map((row) => ({
        ...row,
        ipAddress: row.ipAddress?.trim() ? row.ipAddress : null,
        userAgent: row.userAgent?.trim() ? row.userAgent : null,
      }));
    },

    async revokeOwn(input) {
      return database.transaction(async (transaction) => {
        const [registry] = await transaction
          .select({ accountType: schema.accountEmailRegistry.accountType })
          .from(schema.accountEmailRegistry)
          .where(eq(schema.accountEmailRegistry.accountId, input.userId))
          .limit(1);
        const revoked = registry?.accountType === 'admin'
          ? (await transaction.delete(schema.adminSessions).where(and(
              eq(schema.adminSessions.id, input.sessionId),
              eq(schema.adminSessions.userId, input.userId),
            )).returning({ id: schema.adminSessions.id }))[0]
          : registry?.accountType === 'borrower'
            ? (await transaction.delete(schema.borrowerSessions).where(and(
                eq(schema.borrowerSessions.id, input.sessionId),
                eq(schema.borrowerSessions.userId, input.userId),
              )).returning({ id: schema.borrowerSessions.id }))[0]
            : registry?.accountType === 'investor'
              ? (await transaction.delete(schema.investorSessions).where(and(
                  eq(schema.investorSessions.id, input.sessionId),
                  eq(schema.investorSessions.userId, input.userId),
                )).returning({ id: schema.investorSessions.id }))[0]
              : undefined;

        if (!revoked) {
          return false;
        }

        await writeAudit(transaction, {
          actorType: 'user',
          actorUserId: input.userId,
          actorRoles: input.roles,
          action: 'session.revoked',
          outcome: 'succeeded',
          resourceType: 'session',
          resourceId: revoked.id,
          requestId: input.requestId,
          ipAddressHash: input.ipAddressHash,
        });

        return true;
      });
    },
  };
}
