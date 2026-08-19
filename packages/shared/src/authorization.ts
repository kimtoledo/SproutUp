import { z } from 'zod';

export const roleKeys = [
  'super_admin',
  'sales_officer',
  'credit_analyst',
  'compliance_officer',
  'finance_officer',
  'sme_borrower',
  'investor',
] as const;

export const permissionKeys = [
  'users.read',
  'users.manage_status',
  'roles.read',
  'roles.assign',
  'roles.manage_permissions',
  'sessions.read_own',
  'sessions.revoke_own',
  'sessions.revoke_any',
  'audit.read',
  'audit.export',
] as const;

export const roleKeySchema = z.enum(roleKeys);
export const permissionKeySchema = z.enum(permissionKeys);

export type RoleKey = z.infer<typeof roleKeySchema>;
export type PermissionKey = z.infer<typeof permissionKeySchema>;

export const roleDefinitions: ReadonlyArray<{
  key: RoleKey;
  name: string;
  category: 'staff' | 'customer';
}> = [
  { key: 'super_admin', name: 'Super Admin', category: 'staff' },
  { key: 'sales_officer', name: 'Sales Officer', category: 'staff' },
  { key: 'credit_analyst', name: 'Credit Analyst', category: 'staff' },
  { key: 'compliance_officer', name: 'Compliance Officer', category: 'staff' },
  { key: 'finance_officer', name: 'Finance Officer', category: 'staff' },
  { key: 'sme_borrower', name: 'SME Borrower', category: 'customer' },
  { key: 'investor', name: 'Investor', category: 'customer' },
];

export const permissionDefinitions: ReadonlyArray<{
  key: PermissionKey;
  description: string;
}> = [
  { key: 'users.read', description: 'Read user account and role summaries' },
  { key: 'users.manage_status', description: 'Suspend or restore user access' },
  { key: 'roles.read', description: 'Read roles and effective permissions' },
  { key: 'roles.assign', description: 'Assign or revoke user roles' },
  { key: 'roles.manage_permissions', description: 'Change role permission grants' },
  { key: 'sessions.read_own', description: 'List the current user sessions' },
  { key: 'sessions.revoke_own', description: 'Revoke the current user sessions' },
  { key: 'sessions.revoke_any', description: 'Revoke another user sessions' },
  { key: 'audit.read', description: 'Read immutable business audit events' },
  { key: 'audit.export', description: 'Export immutable business audit events' },
];

const ownSessionPermissions: PermissionKey[] = [
  'sessions.read_own',
  'sessions.revoke_own',
];

/**
 * Initial auth-domain grants only. Domain capabilities are added by their
 * reviewed MVP tasks; absence always means deny.
 */
export const initialRolePermissions: Readonly<Record<RoleKey, readonly PermissionKey[]>> = {
  super_admin: permissionKeys,
  sales_officer: ['users.read', 'roles.read', ...ownSessionPermissions],
  credit_analyst: ['users.read', 'roles.read', ...ownSessionPermissions],
  compliance_officer: ['users.read', 'roles.read', 'audit.read', ...ownSessionPermissions],
  finance_officer: ['users.read', 'roles.read', 'audit.read', ...ownSessionPermissions],
  sme_borrower: ownSessionPermissions,
  investor: ownSessionPermissions,
};

export interface AuthorizationContext {
  user: {
    id: string;
    email: string;
    name: string;
  };
  roles: RoleKey[];
  permissions: PermissionKey[];
}

export function hasPermission(
  context: AuthorizationContext,
  permission: PermissionKey,
): boolean {
  return context.permissions.includes(permission);
}
