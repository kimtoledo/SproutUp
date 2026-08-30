import { z } from 'zod';
import { addPhpMoney, formatPhpMoney, parsePhpMoney, subtractPhpMoney, type PhpMoney } from './money';

/**
 * Amortized and interest-only schedule generation — the two repayment
 * models the product brief approves (tasks/README.md); every other legacy
 * repayment mode (Balloon/EMR/Effective-Rate's exact day-count math, the
 * dead alternate scoring-linked engine, etc. — see
 * tasks/reference/legacy/domain-loans-borrowing.md) is discovery context
 * only and is not reproduced here.
 *
 * All money arithmetic is exact bigint (via `PhpMoney`), including the
 * amortized model's periodic-payment (PMT) figure, computed as an exact
 * rational rather than with floating point — `(1+r)^n` for an integer term
 * is exact bigint exponentiation of a rational rate, so no transcendental
 * function or float ever touches a monetary value. The final period always
 * closes to exactly zero outstanding balance by construction (it is paid
 * the *remaining* balance, not a re-derived "regular" principal figure),
 * which is what guarantees the schedule reconciles to the loan amount to
 * the centavo regardless of any rounding earlier in the schedule.
 *
 * Interest convention: a fixed monthly rate of `annualRatePercent / 12`,
 * applied uniformly regardless of a period's actual calendar length
 * (a 30/360-equivalent convention) — not the legacy Effective-Rate engine's
 * actual/365 day-count, which introduces the payment-drift issue flagged in
 * that file's tech debt. This is a deliberate simplicity choice, not a
 * confirmed regulatory requirement; revisit if Philippine lending
 * disclosure rules require day-count-actual.
 */

export const repaymentModelSchema = z.enum(['amortized', 'interest_only']);
export type RepaymentModel = z.infer<typeof repaymentModelSchema>;

/** Annual rate as a percentage, up to 4 decimal places, e.g. "15.0000" for 15%. */
export const annualRatePercentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Rate must be a decimal percentage like 15.0000')
  .refine((value) => Number(value) <= 100, 'Rate must not exceed 100%');

export interface LoanScheduleInput {
  principal: PhpMoney;
  annualRatePercent: string;
  termMonths: number;
  repaymentModel: RepaymentModel;
  /** ISO `YYYY-MM-DD` due date of period 1; later periods add calendar months, clamped to a valid day. */
  firstDueDate: string;
}

export interface LoanSchedulePeriod {
  period: number;
  dueDate: string;
  openingBalance: PhpMoney;
  principal: PhpMoney;
  interest: PhpMoney;
  payment: PhpMoney;
  closingBalance: PhpMoney;
}

export interface LoanSchedule {
  repaymentModel: RepaymentModel;
  periods: LoanSchedulePeriod[];
  totalPrincipal: PhpMoney;
  totalInterest: PhpMoney;
  totalPayment: PhpMoney;
}

const RATE_DECIMALS = 4n;
const RATE_SCALE = 10n ** RATE_DECIMALS; // 10_000
const MONTHS_PER_YEAR = 12n;
// annualRatePercent (as an integer scaled by RATE_SCALE) represents rate/100
// already scaled; dividing by RATE_SCALE and by 100 and by 12 collapses to
// one denominator for exact-fraction interest math.
const MONTHLY_RATE_DENOMINATOR = RATE_SCALE * 100n * MONTHS_PER_YEAR; // 12_000_000

function parseRateScaled(annualRatePercent: string): bigint {
  const [whole, fraction = ''] = annualRatePercent.split('.');
  const paddedFraction = fraction.padEnd(Number(RATE_DECIMALS), '0');
  return BigInt(whole) * RATE_SCALE + BigInt(paddedFraction || '0');
}

function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  // Inputs here are always non-negative by construction (positive principal,
  // non-negative rate, non-negative term).
  return (numerator + denominator / 2n) / denominator;
}

/** Exact interest for one period on `balance` at `annualRatePercent` / 12. */
function periodInterest(balance: PhpMoney, rateScaled: bigint): PhpMoney {
  const minorUnits = roundHalfUpDiv(balance.minorUnits * rateScaled, MONTHLY_RATE_DENOMINATOR);
  return parsePhpMoney(formatMinorUnits(minorUnits));
}

function formatMinorUnits(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Exact level payment (annuity/PMT) for `principal` at the given scaled
 * monthly rate over `termMonths`, computed as an exact rational: the
 * monthly rate is itself a rational (`rateScaled / MONTHLY_RATE_DENOMINATOR`),
 * so `(1+r)^n` is exact bigint exponentiation of that rational, never a
 * floating-point power.
 */
function levelPayment(principal: PhpMoney, rateScaled: bigint, termMonths: number): PhpMoney {
  if (rateScaled === 0n) {
    return parsePhpMoney(formatMinorUnits(roundHalfUpDiv(principal.minorUnits, BigInt(termMonths))));
  }
  const rNum = rateScaled;
  const rDen = MONTHLY_RATE_DENOMINATOR;
  const oneNum = rDen + rNum; // (1 + r) numerator over rDen
  const n = BigInt(termMonths);
  const numN = oneNum ** n;
  const denN = rDen ** n;
  // payment = P * r * (1+r)^n / (rDen * ((1+r)^n - 1))... derived from
  // payment = P * r / (1 - (1+r)^-n) with r = rNum/rDen:
  // payment = P * rNum * numN / (rDen * (numN - denN))
  const numerator = principal.minorUnits * rNum * numN;
  const denominator = rDen * (numN - denN);
  return parsePhpMoney(formatMinorUnits(roundHalfUpDiv(numerator, denominator)));
}

function addMonthsClamped(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Invalid ISO date: ${isoDate}`);
  const targetMonthIndex = (month - 1) + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Day 0 of the *next* month is the last day of the target month.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  const date = new Date(Date.UTC(targetYear, targetMonth, clampedDay));
  return date.toISOString().slice(0, 10);
}

export function generateLoanSchedule(input: LoanScheduleInput): LoanSchedule {
  if (!Number.isInteger(input.termMonths) || input.termMonths < 1) {
    throw new Error('termMonths must be a positive integer');
  }
  annualRatePercentSchema.parse(input.annualRatePercent);
  const rateScaled = parseRateScaled(input.annualRatePercent);

  const periods: LoanSchedulePeriod[] = [];
  let outstanding = input.principal;
  let totalInterest = parsePhpMoney('0.00');

  if (input.repaymentModel === 'interest_only') {
    const fixedInterest = periodInterest(input.principal, rateScaled);
    for (let period = 1; period <= input.termMonths; period += 1) {
      const isFinal = period === input.termMonths;
      const principalPortion = isFinal ? outstanding : parsePhpMoney('0.00');
      const interest = fixedInterest;
      const payment = addPhpMoney(principalPortion, interest);
      const closingBalance = subtractPhpMoney(outstanding, principalPortion);
      periods.push({
        period,
        dueDate: addMonthsClamped(input.firstDueDate, period - 1),
        openingBalance: outstanding,
        principal: principalPortion,
        interest,
        payment,
        closingBalance,
      });
      totalInterest = addPhpMoney(totalInterest, interest);
      outstanding = closingBalance;
    }
  } else {
    const payment = levelPayment(input.principal, rateScaled, input.termMonths);
    for (let period = 1; period <= input.termMonths; period += 1) {
      const isFinal = period === input.termMonths;
      const interest = periodInterest(outstanding, rateScaled);
      const principalPortion = isFinal ? outstanding : subtractPhpMoney(payment, interest);
      const periodPayment = addPhpMoney(principalPortion, interest);
      const closingBalance = subtractPhpMoney(outstanding, principalPortion);
      periods.push({
        period,
        dueDate: addMonthsClamped(input.firstDueDate, period - 1),
        openingBalance: outstanding,
        principal: principalPortion,
        interest,
        payment: periodPayment,
        closingBalance,
      });
      totalInterest = addPhpMoney(totalInterest, interest);
      outstanding = closingBalance;
    }
  }

  const totalPrincipal = addPhpMoney(...periods.map((period) => period.principal));
  const totalPayment = addPhpMoney(...periods.map((period) => period.payment));
  return { repaymentModel: input.repaymentModel, periods, totalPrincipal, totalInterest, totalPayment };
}

export function formatLoanSchedule(schedule: LoanSchedule): {
  repaymentModel: RepaymentModel;
  totalPrincipal: string;
  totalInterest: string;
  totalPayment: string;
  periods: Array<{
    period: number;
    dueDate: string;
    openingBalance: string;
    principal: string;
    interest: string;
    payment: string;
    closingBalance: string;
  }>;
} {
  return {
    repaymentModel: schedule.repaymentModel,
    totalPrincipal: formatPhpMoney(schedule.totalPrincipal),
    totalInterest: formatPhpMoney(schedule.totalInterest),
    totalPayment: formatPhpMoney(schedule.totalPayment),
    periods: schedule.periods.map((period) => ({
      period: period.period,
      dueDate: period.dueDate,
      openingBalance: formatPhpMoney(period.openingBalance),
      principal: formatPhpMoney(period.principal),
      interest: formatPhpMoney(period.interest),
      payment: formatPhpMoney(period.payment),
      closingBalance: formatPhpMoney(period.closingBalance),
    })),
  };
}
