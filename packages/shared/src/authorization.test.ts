import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  accountTypePermissions,
  initialRolePermissions,
  permissionKeys,
  roleDefinitions,
} from './authorization.js';

describe('authorization baseline', () => {
  it('defines every approved SproutUp role exactly once', () => {
    expect(new Set(roleDefinitions.map(({ key }) => key)).size).toBe(5);
    expect(roleDefinitions.every(({ category }) => category === 'staff')).toBe(true);
  });

  it('grants every current auth capability to Super Admin', () => {
    expect(initialRolePermissions.super_admin).toEqual(permissionKeys);
  });

  it('denies capabilities absent from the resolved context', () => {
    expect(
      hasPermission(
        {
          accountType: 'investor',
          user: { id: 'user-id', email: 'investor@example.com', name: 'Investor' },
          roles: [],
          permissions: [...accountTypePermissions.investor],
        },
        'roles.assign',
      ),
    ).toBe(false);
  });
});
