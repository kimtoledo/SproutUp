import { and, eq, inArray } from 'drizzle-orm';
import type { AuthorizationContext } from '@sproutup/shared';
import type { Database } from '@sproutup/db';
import { schema } from '@sproutup/db';

export function createAuthorizationResolver(database: Database) {
  return async (userId: string): Promise<AuthorizationContext | null> => {
    const [user] = await database
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.status, 'active')))
      .limit(1);

    if (!user) {
      return null;
    }

    const roleRows = await database
      .select({ roleKey: schema.userRoles.roleKey })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleKey, schema.roles.key))
      .where(and(eq(schema.userRoles.userId, user.id), eq(schema.roles.isActive, true)));

    const roleKeys = roleRows.map(({ roleKey }) => roleKey);
    const permissionRows = roleKeys.length
      ? await database
          .selectDistinct({ permissionKey: schema.rolePermissions.permissionKey })
          .from(schema.rolePermissions)
          .where(inArray(schema.rolePermissions.roleKey, roleKeys))
      : [];

    return {
      user,
      roles: roleKeys,
      permissions: permissionRows.map(({ permissionKey }) => permissionKey),
    };
  };
}
