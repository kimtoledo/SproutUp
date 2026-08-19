import { describe, expect, it } from 'vitest';
import {
  addPhpMoney,
  comparePhpMoney,
  formatPhpMoney,
  negatePhpMoney,
  nonNegativePhpAmountSchema,
  parsePhpMoney,
  phpMoneyContract,
  phpMoneyContractSchema,
  subtractPhpMoney,
} from './money.js';

describe('exact PHP money', () => {
  it.each([
    ['0.00', 0n],
    ['0.01', 1n],
    ['1.00', 100n],
    ['12345678901234567890.99', 1234567890123456789099n],
    ['-0.01', -1n],
    ['-42.50', -4250n],
  ])('parses and formats canonical amount %s', (amount, minorUnits) => {
    const money = parsePhpMoney(amount);
    expect(money.minorUnits).toBe(minorUnits);
    expect(formatPhpMoney(money)).toBe(amount);
    expect(phpMoneyContract(money)).toEqual({ currency: 'PHP', amount });
  });

  it.each([
    '1',
    '1.0',
    '1.000',
    '01.00',
    '+1.00',
    '1e3',
    '1,000.00',
    '-0.00',
    'PHP 1.00',
    '',
  ])('rejects non-canonical input %j', (amount) => {
    expect(() => parsePhpMoney(amount)).toThrow();
  });

  it('rejects numeric JSON amounts and negative values at a non-negative boundary', () => {
    expect(() => phpMoneyContractSchema.parse({ currency: 'PHP', amount: 0.1 })).toThrow();
    expect(() => phpMoneyContractSchema.parse({ currency: 'USD', amount: '1.00' })).toThrow();
    expect(() => nonNegativePhpAmountSchema.parse('-0.01')).toThrow();
    expect(nonNegativePhpAmountSchema.parse('0.00')).toBe('0.00');
  });

  it('adds and subtracts centavos without floating-point drift', () => {
    const tenCentavos = parsePhpMoney('0.10');
    const twentyCentavos = parsePhpMoney('0.20');
    const exact = addPhpMoney(tenCentavos, twentyCentavos);
    expect(formatPhpMoney(exact)).toBe('0.30');
    expect(formatPhpMoney(subtractPhpMoney(exact, tenCentavos))).toBe('0.20');
  });

  it('supports exact signed correction arithmetic and comparison', () => {
    const original = parsePhpMoney('10000000000000000000.00');
    const correction = parsePhpMoney('-0.01');
    const corrected = addPhpMoney(original, correction);
    expect(formatPhpMoney(corrected)).toBe('9999999999999999999.99');
    expect(comparePhpMoney(correction, corrected)).toBe(-1);
    expect(formatPhpMoney(negatePhpMoney(correction))).toBe('0.01');
  });

  it('enforces the shared numeric(30,2) storage precision through arithmetic', () => {
    const maximum = parsePhpMoney('9999999999999999999999999999.99');
    expect(() => addPhpMoney(maximum, parsePhpMoney('0.01'))).toThrow(
      'exceeds numeric(30,2)',
    );
    expect(() => parsePhpMoney('10000000000000000000000000000.00')).toThrow();
  });
});
