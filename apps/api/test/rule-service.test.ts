import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Database } from '@sproutup/db';
import { createRuleService } from '../src/config/rule-service.js';
import { applyMigrations } from './database-fixture.js';

const pglite = new PGlite();
const database = drizzle(pglite, { schema }) as unknown as Database;
const staffId = '00000000-0000-4000-8000-000000000e01';

beforeAll(async () => {
  await applyMigrations(pglite);
  await database.insert(schema.users).values({
    id: staffId,
    name: 'Finance Officer',
    email: 'rule-service@sproutup.ph',
  });
});

afterAll(async () => {
  await pglite.close();
});

const t = (iso: string) => new Date(iso);

describe('rule service', () => {
  it('resolves nothing for a key that was never published', async () => {
    const service = createRuleService(database);
    expect(await service.resolve('tax.unknown', t('2026-09-01T00:00:00Z'))).toBeNull();
  });

  it('refuses to publish a version for an unregistered key', async () => {
    const service = createRuleService(database);
    const result = await service.publish({
      key: 'tax.vat',
      effectiveFrom: t('2026-09-01T00:00:00Z'),
      body: { rate: '0.12' },
      actor: { type: 'system' },
    });
    expect(result).toEqual({ ok: false, reason: 'unknown_rule_key' });
  });

  it('registers a rule set idempotently', async () => {
    const service = createRuleService(database);
    expect(await service.registerRuleSet({ key: 'tax.vat', description: 'Platform-fee VAT rate' }))
      .toEqual({ ok: true, created: true });
    expect(await service.registerRuleSet({ key: 'tax.vat', description: 'Platform-fee VAT rate' }))
      .toEqual({ ok: true, created: false });
  });

  it('assigns monotonic versions and resolves the one in force at a given time', async () => {
    const service = createRuleService(database);
    await service.registerRuleSet({ key: 'investor.limits', description: 'Per-investor caps' });

    const v1 = await service.publish({
      key: 'investor.limits',
      effectiveFrom: t('2026-09-01T00:00:00Z'),
      body: { perTransactionPhp: '100000.00' },
      actor: { type: 'user', userId: staffId, roles: ['finance_officer'] },
      note: 'pilot launch caps (ASSUMED)',
    });
    const v2 = await service.publish({
      key: 'investor.limits',
      effectiveFrom: t('2026-12-01T00:00:00Z'),
      body: { perTransactionPhp: '250000.00' },
      actor: { type: 'user', userId: staffId, roles: ['finance_officer'] },
    });
    expect(v1).toMatchObject({ ok: true, version: 1 });
    expect(v2).toMatchObject({ ok: true, version: 2 });

    expect(await service.resolve('investor.limits', t('2026-08-01T00:00:00Z'))).toBeNull();

    const mid = await service.resolve('investor.limits', t('2026-10-15T00:00:00Z'));
    expect(mid).toMatchObject({ version: 1, body: { perTransactionPhp: '100000.00' } });

    const later = await service.resolve('investor.limits', t('2027-01-01T00:00:00Z'));
    expect(later).toMatchObject({ version: 2, body: { perTransactionPhp: '250000.00' } });
  });

  it('keeps a historical resolution reproducible after a newer version is published', async () => {
    const service = createRuleService(database);
    const historical = await service.resolve('investor.limits', t('2026-10-15T00:00:00Z'));
    // Same query, run after v2 exists, still returns the exact v1 body.
    expect(historical).toMatchObject({ version: 1, body: { perTransactionPhp: '100000.00' } });
  });

  it('rejects a second version at the same effective instant', async () => {
    const service = createRuleService(database);
    await service.registerRuleSet({ key: 'onboarding.sla', description: 'Queue aging thresholds' });
    const first = await service.publish({
      key: 'onboarding.sla',
      effectiveFrom: t('2026-09-01T00:00:00Z'),
      body: { reviewHours: 48 },
      actor: { type: 'system' },
    });
    expect(first).toMatchObject({ ok: true, version: 1 });
    const clash = await service.publish({
      key: 'onboarding.sla',
      effectiveFrom: t('2026-09-01T00:00:00Z'),
      body: { reviewHours: 24 },
      actor: { type: 'system' },
    });
    expect(clash).toEqual({ ok: false, reason: 'effective_from_conflict' });
  });

  it('rejects a non-object body at the contract boundary', async () => {
    const service = createRuleService(database);
    await service.registerRuleSet({ key: 'test.badbody', description: 'x' });
    await expect(
      service.publish({
        key: 'test.badbody',
        effectiveFrom: t('2026-09-01T00:00:00Z'),
        body: ['not', 'an', 'object'] as unknown as Record<string, unknown>,
        actor: { type: 'system' },
      }),
    ).rejects.toThrow();
  });

  it('writes a config_rule.published audit row without the body', async () => {
    const service = createRuleService(database);
    await service.registerRuleSet({ key: 'tax.dst', description: 'Documentary stamp tax' });
    const published = await service.publish({
      key: 'tax.dst',
      effectiveFrom: t('2026-09-01T00:00:00Z'),
      body: { ratePerThousandPhp: '1.50' },
      actor: { type: 'user', userId: staffId, roles: ['finance_officer'] },
      note: 'ASSUMED — pending BIR confirmation',
    });
    if (!published.ok) throw new Error('expected publish to succeed');

    const [row] = await database
      .select({
        action: schema.auditEvents.action,
        resourceId: schema.auditEvents.resourceId,
        metadata: schema.auditEvents.metadata,
      })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, 'config_rule.published'),
          eq(schema.auditEvents.resourceId, published.ruleVersionId),
        ),
      )
      .limit(1);
    expect(row?.metadata).toMatchObject({ key: 'tax.dst', version: 1 });
    expect(JSON.stringify(row?.metadata)).not.toContain('ratePerThousandPhp');
  });

  it('lists versions newest first', async () => {
    const service = createRuleService(database);
    const versions = await service.listVersions('investor.limits');
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('does not write a rule version when a caller transaction rolls back', async () => {
    await expect(
      database.transaction(async (tx) => {
        await tx
          .insert(schema.ruleSets)
          .values({ key: 'test.rollback', description: 'rollback probe' });
        await tx.insert(schema.ruleVersions).values({
          ruleKey: 'test.rollback',
          version: 1,
          effectiveFrom: t('2026-09-01T00:00:00Z'),
          body: { a: 1 },
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const [{ value }] = await database
      .select({ value: count() })
      .from(schema.ruleSets)
      .where(eq(schema.ruleSets.key, 'test.rollback'));
    expect(value).toBe(0);
  });
});
