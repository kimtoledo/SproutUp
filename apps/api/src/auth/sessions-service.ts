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
  }): Promise<boolean>;
}

export function createSessionService(database: Database): SessionService {
  return {
    async listOwn(userId) {
      return database
        .select({
          id: schema.sessions.id,
          createdAt: schema.sessions.createdAt,
          expiresAt: schema.sessions.expiresAt,
          ipAddress: schema.sessions.ipAddress,
          userAgent: schema.sessions.userAgent,
        })
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, userId))
        .orderBy(desc(schema.sessions.createdAt));
    },

    async revokeOwn(input) {
      return database.transaction(async (transaction) => {
        const [revoked] = await transaction
          .delete(schema.sessions)
          .where(
            and(
              eq(schema.sessions.id, input.sessionId),
              eq(schema.sessions.userId, input.userId),
            ),
          )
          .returning({ id: schema.sessions.id });

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
        });

        return true;
      });
    },
  };
}
