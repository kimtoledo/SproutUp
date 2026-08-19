import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type Database } from '@sproutup/db';
import { createAccessCatalogueService } from '../src/auth/access-catalogue-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const orm = drizzle(pglite, { schema }) as unknown as Database;
const staffId = '00000000-0000-4000-8000-000000000311';
const investorId = '00000000-0000-4000-8000-000000000312';

beforeAll(async () => {
  await applyMigrations(pglite);
  await orm.insert(schema.roles).values([
    { key: 'sales_officer', name: 'Sales Officer', category: 'staff' },
    { key: 'investor', name: 'Investor', category: 'customer' },
  ]);
  await orm.insert(schema.permissions).values([
    { key: 'users.read', description: 'Read users' },
    { key: 'sessions.read_own', description: 'Read own sessions' },
  ]);
  await orm.insert(schema.rolePermissions).values([
    { roleKey: 'sales_officer', permissionKey: 'users.read' },
    { roleKey: 'investor', permissionKey: 'sessions.read_own' },
  ]);
  await orm.insert(schema.users).values([
    { id: staffId, name: 'Sales Staff', email: 'catalogue-staff@sproutup.ph', emailVerified: true },
    { id: investorId, name: 'Pilot Investor', email: 'catalogue-investor@sproutup.ph' },
  ]);
  await orm.insert(schema.userRoles).values({ userId: investorId, roleKey: 'investor', grantedBy: staffId });
});

afterAll(async () => {
  await pglite.close();
});

describe('access catalogue service', () => {
  it('returns active roles with their effective permissions', async () => {
    const result = await createAccessCatalogueService(orm).listRoles();

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'investor', permissions: ['sessions.read_own'] }),
        expect.objectContaining({ key: 'sales_officer', permissions: ['users.read'] }),
      ]),
    );
  });

  it('returns only bounded user access summaries and supports literal search', async () => {
    const result = await createAccessCatalogueService(orm).listUsers({
      page: 1,
      pageSize: 25,
      query: 'Pilot Investor',
      status: 'active',
    });

    expect(result.total).toBe(1);
    expect(result.users).toEqual([
      expect.objectContaining({ id: investorId, roles: ['investor'], emailVerified: false }),
    ]);
    expect(Object.keys(result.users[0] ?? {})).toEqual(
      expect.arrayContaining(['id', 'name', 'email', 'emailVerified', 'status', 'roles', 'createdAt']),
    );
    expect(JSON.stringify(result)).not.toMatch(/password|token|secret/i);
  });
});
