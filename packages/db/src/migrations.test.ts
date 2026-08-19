import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { permissionKeys, roleKeys } from '@sproutup/shared';
import { seedAuthorization } from './seed-authorization.js';
import type { Database } from './database.js';
import * as schema from './schema/index.js';

const database = new PGlite();

beforeAll(async () => {
  for (const migration of ['0000_yielding_zombie.sql', '0001_audit-immutability.sql']) {
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
    await database.exec(sql.replaceAll('--> statement-breakpoint', ''));
  }
});

afterAll(async () => {
  await database.close();
});

describe('initial authentication migration', () => {
  it('creates every identity, RBAC, rate-limit, and audit table', async () => {
    const result = await database.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);

    expect(result.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'accounts',
        'audit_events',
        'permissions',
        'rate_limits',
        'role_permissions',
        'roles',
        'sessions',
        'user_roles',
        'users',
        'verifications',
      ]),
    );
  });

  it('enforces append-only audit events in PostgreSQL', async () => {
    const auditId = '00000000-0000-4000-8000-000000000001';
    await database.query(
      `insert into audit_events
        (id, actor_type, action, outcome, resource_type)
       values ($1, 'system', 'platform.started', 'succeeded', 'platform')`,
      [auditId],
    );

    await expect(
      database.query('update audit_events set reason = $1 where id = $2', ['changed', auditId]),
    ).rejects.toThrow('audit_events is append-only');
    await expect(database.query('delete from audit_events where id = $1', [auditId])).rejects.toThrow(
      'audit_events is append-only',
    );
    await expect(database.exec('truncate table audit_events')).rejects.toThrow(
      'audit_events is append-only',
    );
  });

  it('idempotently seeds the approved roles and auth-domain grants', async () => {
    const orm = drizzle(database, { schema });
    await seedAuthorization(orm as unknown as Database);
    await seedAuthorization(orm as unknown as Database);

    const roleCount = await database.query<{ count: number }>('select count(*)::int as count from roles');
    const permissionCount = await database.query<{ count: number }>(
      'select count(*)::int as count from permissions',
    );
    const superAdminGrantCount = await database.query<{ count: number }>(
      `select count(*)::int as count
       from role_permissions
       where role_key = 'super_admin'`,
    );

    expect(roleCount.rows[0]?.count).toBe(roleKeys.length);
    expect(permissionCount.rows[0]?.count).toBe(permissionKeys.length);
    expect(superAdminGrantCount.rows[0]?.count).toBe(permissionKeys.length);
  });
});
