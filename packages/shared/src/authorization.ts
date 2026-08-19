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
  'borrower_onboarding.read_own',
  'borrower_onboarding.manage_own',
  'borrower_onboarding.submit_own',
  'investor_onboarding.read_own',
  'investor_onboarding.manage_own',
  'investor_onboarding.submit_own',
  'onboarding_cases.read',
  'onboarding_cases.review',
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
  { key: 'borrower_onboarding.read_own', description: 'Read the current user borrower onboarding case' },
  { key: 'borrower_onboarding.manage_own', description: 'Create and edit the current user borrower onboarding draft' },
  { key: 'borrower_onboarding.submit_own', description: 'Submit the current user borrower onboarding case' },
  { key: 'investor_onboarding.read_own', description: 'Read the current user investor onboarding case' },
  { key: 'investor_onboarding.manage_own', description: 'Create and edit the current user investor onboarding draft' },
  { key: 'investor_onboarding.submit_own', description: 'Submit the current user investor onboarding case' },
  { key: 'onboarding_cases.read', description: 'Read onboarding cases in a staff work queue' },
  { key: 'onboarding_cases.review', description: 'Review and decide assigned onboarding cases' },
];

const ownSessionPermissions: PermissionKey[] = [
  'sessions.read_own',
  'sessions.revoke_own',
];

const borrowerOnboardingPermissions: PermissionKey[] = [
  'borrower_onboarding.read_own',
  'borrower_onboarding.manage_own',
  'borrower_onboarding.submit_own',
];
const investorOnboardingPermissions: PermissionKey[] = [
  'investor_onboarding.read_own',
  'investor_onboarding.manage_own',
  'investor_onboarding.submit_own',
];

/**
 * Initial auth-domain grants only. Domain capabilities are added by their
 * reviewed MVP tasks; absence always means deny.
 */
export const initialRolePermissions: Readonly<Record<RoleKey, readonly PermissionKey[]>> = {
  super_admin: permissionKeys,
  sales_officer: ['users.read', 'roles.read', ...ownSessionPermissions],
  credit_analyst: ['users.read', 'roles.read', ...ownSessionPermissions],
  compliance_officer: [
    'users.read',
    'roles.read',
    'audit.read',
    'onboarding_cases.read',
    'onboarding_cases.review',
    ...ownSessionPermissions,
  ],
  finance_officer: ['users.read', 'roles.read', 'audit.read', ...ownSessionPermissions],
  sme_borrower: [...ownSessionPermissions, ...borrowerOnboardingPermissions],
  investor: [...ownSessionPermissions, ...investorOnboardingPermissions],
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
