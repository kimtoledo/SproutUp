import { and, asc, count, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import type { PermissionKey, RoleKey } from '@sproutup/shared';
import { schema, type Database } from '@sproutup/db';

type UserStatus = 'active' | 'suspended' | 'disabled';

export interface RoleSummary {
  key: RoleKey;
  name: string;
  category: 'staff' | 'customer';
  isActive: boolean;
  permissions: PermissionKey[];
}

export interface UserAccessSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: UserStatus;
  roles: RoleKey[];
  createdAt: Date;
}

export interface AccessCatalogueService {
  listRoles(): Promise<RoleSummary[]>;
  listUsers(input: {
    page: number;
    pageSize: number;
    query?: string;
    status?: UserStatus;
  }): Promise<{ users: UserAccessSummary[]; page: number; pageSize: number; total: number }>;
}

export function createAccessCatalogueService(database: Database): AccessCatalogueService {
  return {
    async listRoles() {
      const [roles, grants] = await Promise.all([
        database
          .select({
            key: schema.roles.key,
            name: schema.roles.name,
            category: schema.roles.category,
            isActive: schema.roles.isActive,
          })
          .from(schema.roles)
          .orderBy(asc(schema.roles.name)),
        database
          .select({
            roleKey: schema.rolePermissions.roleKey,
            permissionKey: schema.rolePermissions.permissionKey,
          })
          .from(schema.rolePermissions)
          .orderBy(asc(schema.rolePermissions.roleKey), asc(schema.rolePermissions.permissionKey)),
      ]);
      const permissionsByRole = new Map<RoleKey, PermissionKey[]>();
      for (const grant of grants) {
        const permissions = permissionsByRole.get(grant.roleKey) ?? [];
        permissions.push(grant.permissionKey);
        permissionsByRole.set(grant.roleKey, permissions);
      }

      return roles.map((role) => ({
        ...role,
        permissions: permissionsByRole.get(role.key) ?? [],
      }));
    },

    async listUsers(input) {
      const filters: SQL[] = [];
      if (input.status) filters.push(eq(schema.users.status, input.status));
      if (input.query) {
        const escapedQuery = input.query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
        const search = `%${escapedQuery}%`;
        const textFilter = or(ilike(schema.users.name, search), ilike(schema.users.email, search));
        if (textFilter) filters.push(textFilter);
      }
      const where = filters.length > 0 ? and(...filters) : undefined;

      return database.transaction(async (transaction) => {
        const [[totalRow], users] = await Promise.all([
          transaction.select({ value: count() }).from(schema.users).where(where),
          transaction
            .select({
              id: schema.users.id,
              name: schema.users.name,
              email: schema.users.email,
              emailVerified: schema.users.emailVerified,
              status: schema.users.status,
              createdAt: schema.users.createdAt,
            })
            .from(schema.users)
            .where(where)
            .orderBy(asc(schema.users.createdAt), asc(schema.users.id))
            .limit(input.pageSize)
            .offset((input.page - 1) * input.pageSize),
        ]);

        if (users.length === 0) {
          return { users: [], page: input.page, pageSize: input.pageSize, total: totalRow?.value ?? 0 };
        }

        const grants = await transaction
          .select({ userId: schema.userRoles.userId, roleKey: schema.userRoles.roleKey })
          .from(schema.userRoles)
          .where(inArray(schema.userRoles.userId, users.map(({ id }) => id)))
          .orderBy(asc(schema.userRoles.roleKey));
        const rolesByUser = new Map<string, RoleKey[]>();
        for (const grant of grants) {
          const roles = rolesByUser.get(grant.userId) ?? [];
          roles.push(grant.roleKey);
          rolesByUser.set(grant.userId, roles);
        }

        return {
          users: users.map((user) => ({ ...user, roles: rolesByUser.get(user.id) ?? [] })),
          page: input.page,
          pageSize: input.pageSize,
          total: totalRow?.value ?? 0,
        };
      });
    },
  };
}
