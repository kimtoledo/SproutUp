import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins truthy string values with a single space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values but keeps a literal zero out', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('flattens nested arrays', () => {
    expect(cn('a', ['b', false, ['c', 'd']], 'e')).toBe('a b c d e');
  });

  it('trims individual entries', () => {
    expect(cn('  a  ', ' b')).toBe('a b');
  });

  it('returns an empty string when nothing is truthy', () => {
    expect(cn(false, null, undefined, '')).toBe('');
  });
});
