import { z } from 'zod';

export const phpMoneyPrecision = 30;
export const phpMoneyScale = 2;
const maximumMinorUnits = (10n ** BigInt(phpMoneyPrecision)) - 1n;
const canonicalPhpAmount = /^-?(?:0|[1-9]\d{0,27})\.\d{2}$/;

export const phpAmountSchema = z
  .string()
  .min(4)
  .max(32)
  .regex(canonicalPhpAmount, 'PHP amount must be a canonical decimal string with two places')
  .refine((value) => value !== '-0.00', 'Negative zero is not canonical');

export const nonNegativePhpAmountSchema = phpAmountSchema.refine(
  (value) => !value.startsWith('-'),
  'PHP amount must not be negative',
);

export const phpMoneyContractSchema = z.object({
  currency: z.literal('PHP'),
  amount: phpAmountSchema,
});

export type PhpAmount = z.infer<typeof phpAmountSchema>;
export type PhpMoneyContract = z.infer<typeof phpMoneyContractSchema>;

declare const phpMoneyBrand: unique symbol;

export interface PhpMoney {
  readonly currency: 'PHP';
  readonly minorUnits: bigint;
  readonly [phpMoneyBrand]: true;
}

function fromMinorUnits(minorUnits: bigint): PhpMoney {
  if (minorUnits > maximumMinorUnits || minorUnits < -maximumMinorUnits) {
    throw new RangeError('PHP amount exceeds numeric(30,2) storage precision');
  }
  return Object.freeze({ currency: 'PHP', minorUnits }) as PhpMoney;
}

export function parsePhpMoney(amount: string): PhpMoney {
  const canonical = phpAmountSchema.parse(amount);
  const negative = canonical.startsWith('-');
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [whole, fraction] = unsigned.split('.');
  if (whole === undefined || fraction === undefined) throw new Error('Invalid canonical PHP amount');
  const minorUnits = (BigInt(whole) * 100n) + BigInt(fraction);
  return fromMinorUnits(negative ? -minorUnits : minorUnits);
}

export function formatPhpMoney(money: PhpMoney): PhpAmount {
  const negative = money.minorUnits < 0n;
  const absolute = negative ? -money.minorUnits : money.minorUnits;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function phpMoneyContract(money: PhpMoney): PhpMoneyContract {
  return { currency: 'PHP', amount: formatPhpMoney(money) };
}

export function addPhpMoney(...values: readonly PhpMoney[]): PhpMoney {
  return fromMinorUnits(values.reduce((total, value) => total + value.minorUnits, 0n));
}

export function subtractPhpMoney(left: PhpMoney, right: PhpMoney): PhpMoney {
  return fromMinorUnits(left.minorUnits - right.minorUnits);
}

export function negatePhpMoney(value: PhpMoney): PhpMoney {
  return fromMinorUnits(-value.minorUnits);
}

export function comparePhpMoney(left: PhpMoney, right: PhpMoney): -1 | 0 | 1 {
  if (left.minorUnits < right.minorUnits) return -1;
  if (left.minorUnits > right.minorUnits) return 1;
  return 0;
}
