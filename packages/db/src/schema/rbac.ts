import { boolean, index, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { PermissionKey, RoleKey } from '@sproutup/shared';
import { timestamps } from './helpers.js';
import { users } from './users.js';

export const roleCategoryEnum = pgEnum('role_category', ['staff', 'customer']);

export const roles = pgTable('roles', {
  key: varchar('key', { length: 80 }).$type<RoleKey>().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  category: roleCategoryEnum('category').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export const permissions = pgTable('permissions', {
  key: varchar('key', { length: 120 }).$type<PermissionKey>().primaryKey(),
  description: text('description').notNull(),
  ...timestamps,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleKey: varchar('role_key', { length: 80 })
      .$type<RoleKey>()
      .notNull()
      .references(() => roles.key, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 120 })
      .$type<PermissionKey>()
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.roleKey, table.permissionKey] }),
    index('role_permissions_permission_idx').on(table.permissionKey),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleKey: varchar('role_key', { length: 80 })
      .$type<RoleKey>()
      .notNull()
      .references(() => roles.key, { onDelete: 'restrict' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleKey] }),
    index('user_roles_role_idx').on(table.roleKey),
  ],
);
