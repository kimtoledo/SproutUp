import { describe, expect, it } from 'vitest';
import { assertSafeAuditMetadata } from './write-audit.js';

describe('assertSafeAuditMetadata', () => {
  it('accepts identifiers and state-change context', () => {
    expect(() =>
      assertSafeAuditMetadata({ changedFields: ['status'], source: 'admin-console' }),
    ).not.toThrow();
  });

  it.each(['password', 'resetToken', 'api_key', 'authorization', 'cookie'])(
    'rejects sensitive key %s at any depth',
    (key) => {
      expect(() => assertSafeAuditMetadata({ nested: { [key]: 'sensitive' } })).toThrow(
        'Sensitive audit metadata key is not allowed',
      );
    },
  );
});
