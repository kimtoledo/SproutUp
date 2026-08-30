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

/**
 * Transitional staff resolver for the isolated admin account namespace.
 * Staff grants still live in the legacy RBAC join table until the following
 * forward-only migration moves those foreign keys to admin_accounts.
 */
export function createAdminAuthorizationResolver(database: Database) {
  return async (userId: string): Promise<AuthorizationContext | null> => {
    const [user] = await database
      .select({
        id: schema.adminAccounts.id,
        email: schema.adminAccounts.email,
        name: schema.adminAccounts.name,
      })
      .from(schema.adminAccounts)
      .where(and(eq(schema.adminAccounts.id, userId), eq(schema.adminAccounts.status, 'active')))
      .limit(1);

    if (!user) return null;

    const roleRows = await database
      .select({ roleKey: schema.adminRoleGrants.roleKey })
      .from(schema.adminRoleGrants)
      .innerJoin(schema.roles, eq(schema.adminRoleGrants.roleKey, schema.roles.key))
      .where(
        and(
          eq(schema.adminRoleGrants.adminAccountId, user.id),
          eq(schema.roles.isActive, true),
          eq(schema.roles.category, 'staff'),
        ),
      );
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
