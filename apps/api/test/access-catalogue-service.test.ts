import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type Database } from '@sproutup/db';
import { createAccessCatalogueService } from '../src/auth/access-catalogue-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const staffId = '00000000-0000-4000-8000-000000000311';
const analystId = '00000000-0000-4000-8000-000000000312';

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.roles).values([
    { key: 'sales_officer', name: 'Sales Officer', category: 'staff' },
    { key: 'credit_analyst', name: 'Credit Analyst', category: 'staff' },
  ]);
  await orm.insert(schema.permissions).values([
    { key: 'users.read', description: 'Read users' },
    { key: 'roles.read', description: 'Read roles' },
  ]);
  await orm.insert(schema.rolePermissions).values([
    { roleKey: 'sales_officer', permissionKey: 'users.read' },
    { roleKey: 'credit_analyst', permissionKey: 'roles.read' },
  ]);
  await orm.insert(schema.adminAccounts).values([
    { id: staffId, name: 'Sales Staff', email: 'catalogue-staff@sproutup.ph', emailVerified: true },
    { id: analystId, name: 'Pilot Analyst', email: 'catalogue-analyst@sproutup.ph' },
  ]);
  await orm.insert(schema.adminRoleGrants).values({
    adminAccountId: analystId,
    roleKey: 'credit_analyst',
    grantedBy: staffId,
  });
});

afterAll(async () => {
  await pglite.close();
});

describe('access catalogue service', () => {
  it('returns active roles with their effective permissions', async () => {
    const result = await createAccessCatalogueService(orm).listRoles();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'credit_analyst', permissions: ['roles.read'] }),
        expect.objectContaining({ key: 'sales_officer', permissions: ['users.read'] }),
      ]),
    );
  });

  it('returns only bounded user access summaries and supports literal search', async () => {
    const result = await createAccessCatalogueService(orm).listUsers({
      page: 1,
      pageSize: 25,
      query: 'Pilot Analyst',
      status: 'active',
    });

    expect(result.total).toBe(1);
    expect(result.users).toEqual([
      expect.objectContaining({ id: analystId, roles: ['credit_analyst'], emailVerified: false }),
    ]);
    expect(Object.keys(result.users[0] ?? {})).toEqual(
      expect.arrayContaining(['id', 'name', 'email', 'emailVerified', 'status', 'roles', 'createdAt']),
    );
    expect(JSON.stringify(result)).not.toMatch(/password|token|secret/i);
  });
});
