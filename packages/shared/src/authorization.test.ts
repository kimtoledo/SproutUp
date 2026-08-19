import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  initialRolePermissions,
  permissionKeys,
  roleDefinitions,
} from './authorization.js';

describe('authorization baseline', () => {
  it('defines every approved SproutUp role exactly once', () => {
    expect(new Set(roleDefinitions.map(({ key }) => key)).size).toBe(7);
  });

  it('grants every current auth capability to Super Admin', () => {
    expect(initialRolePermissions.super_admin).toEqual(permissionKeys);
  });

  it('denies capabilities absent from the resolved context', () => {
    expect(
      hasPermission(
        {
          user: { id: 'user-id', email: 'investor@example.com', name: 'Investor' },
          roles: ['investor'],
          permissions: [...initialRolePermissions.investor],
        },
        'roles.assign',
      ),
    ).toBe(false);
  });
});
