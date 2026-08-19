import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { schema, type Database } from '@sproutup/db';
import { createSessionService } from '../src/auth/sessions-service.js';

const client = new PGlite();
const database = drizzle(client, { schema });

beforeAll(async () => {
  for (const migration of ['0000_yielding_zombie.sql', '0001_audit-immutability.sql']) {
    const sql = await readFile(
      new URL(`../../../packages/db/migrations/${migration}`, import.meta.url),
      'utf8',
    );
    await client.exec(sql.replaceAll('--> statement-breakpoint', ''));
  }
});

afterAll(async () => {
  await client.close();
});

describe('session service', () => {
  it('atomically revokes only the owner session and appends audit evidence', async () => {
    const userId = '00000000-0000-4000-8000-000000000020';
    const sessionId = '00000000-0000-4000-8000-000000000021';
    const requestId = '00000000-0000-4000-8000-000000000022';

    await database.insert(schema.users).values({
      id: userId,
      email: 'session-owner@example.com',
      name: 'Session Owner',
    });
    await database.insert(schema.sessions).values({
      id: sessionId,
      userId,
      token: 'test-only-session-token',
      expiresAt: new Date('2026-08-26T00:00:00Z'),
    });

    const sessions = createSessionService(database as unknown as Database);
    expect(await sessions.listOwn(userId)).toHaveLength(1);
    expect(
      await sessions.revokeOwn({
        userId,
        roles: ['investor'],
        sessionId,
        requestId,
      }),
    ).toBe(true);
    expect(await sessions.listOwn(userId)).toHaveLength(0);

    const events = await client.query<{ action: string; resource_id: string }>(
      'select action, resource_id from audit_events where request_id = $1',
      [requestId],
    );
    expect(events.rows).toEqual([{ action: 'session.revoked', resource_id: sessionId }]);
  });

  it('cannot revoke a session owned by another user', async () => {
    const ownerId = '00000000-0000-4000-8000-000000000020';
    const sessionId = '00000000-0000-4000-8000-000000000023';
    await database.insert(schema.sessions).values({
      id: sessionId,
      userId: ownerId,
      token: 'other-test-only-session-token',
      expiresAt: new Date('2026-08-26T00:00:00Z'),
    });

    const sessions = createSessionService(database as unknown as Database);
    expect(
      await sessions.revokeOwn({
        userId: '00000000-0000-4000-8000-000000000099',
        roles: ['investor'],
        sessionId,
        requestId: '00000000-0000-4000-8000-000000000098',
      }),
    ).toBe(false);
    expect(await sessions.listOwn(ownerId)).toHaveLength(1);
  });
});
