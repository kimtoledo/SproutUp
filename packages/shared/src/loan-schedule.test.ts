import { describe, expect, it } from 'vitest';
import { generateLoanSchedule } from './loan-schedule';
import { addPhpMoney, formatPhpMoney, parsePhpMoney } from './money';

function sumPrincipal(periods: ReturnType<typeof generateLoanSchedule>['periods']): string {
  return formatPhpMoney(addPhpMoney(...periods.map((period) => period.principal)));
}

describe('generateLoanSchedule — interest-only', () => {
  it('charges fixed interest every period and pays the full principal only at maturity', () => {
    const schedule = generateLoanSchedule({
      principal: parsePhpMoney('120000.00'),
      annualRatePercent: '12.0000',
      termMonths: 12,
      repaymentModel: 'interest_only',
      firstDueDate: '2026-01-15',
    });
    expect(schedule.periods).toHaveLength(12);
    // 12% annual / 12 = 1% monthly, on 120000.00 => 1200.00 every period.
    for (const period of schedule.periods.slice(0, -1)) {
      expect(formatPhpMoney(period.interest)).toBe('1200.00');
      expect(formatPhpMoney(period.principal)).toBe('0.00');
      expect(formatPhpMoney(period.payment)).toBe('1200.00');
    }
    const last = schedule.periods.at(-1)!;
    expect(formatPhpMoney(last.principal)).toBe('120000.00');
    expect(formatPhpMoney(last.payment)).toBe('121200.00');
    expect(formatPhpMoney(last.closingBalance)).toBe('0.00');
    expect(formatPhpMoney(schedule.totalPrincipal)).toBe('120000.00');
    expect(formatPhpMoney(schedule.totalInterest)).toBe('14400.00');
  });

  it('never lets the outstanding balance decline before maturity', () => {
    const schedule = generateLoanSchedule({
      principal: parsePhpMoney('50000.00'),
      annualRatePercent: '9.5000',
      termMonths: 6,
      repaymentModel: 'interest_only',
      firstDueDate: '2026-03-01',
    });
    for (const period of schedule.periods.slice(0, -1)) {
      expect(formatPhpMoney(period.openingBalance)).toBe('50000.00');
      expect(formatPhpMoney(period.closingBalance)).toBe('50000.00');
    }
  });
});

describe('generateLoanSchedule — amortized', () => {
  it('reconciles exactly to the loan amount and zeroes the balance at maturity', () => {
    const schedule = generateLoanSchedule({
      principal: parsePhpMoney('250000.00'),
      annualRatePercent: '15.0000',
      termMonths: 24,
      repaymentModel: 'amortized',
      firstDueDate: '2026-02-01',
    });
    expect(sumPrincipal(schedule.periods)).toBe('250000.00');
    expect(formatPhpMoney(schedule.totalPrincipal)).toBe('250000.00');
    expect(formatPhpMoney(schedule.periods.at(-1)!.closingBalance)).toBe('0.00');
    for (const period of schedule.periods) {
      expect(formatPhpMoney(period.payment)).toBe(
        formatPhpMoney(addPhpMoney(period.principal, period.interest)),
      );
      expect(period.closingBalance.minorUnits).toBe(period.openingBalance.minorUnits - period.principal.minorUnits);
    }
    // Declining balance: interest strictly decreases period over period as principal is paid down.
    for (let index = 1; index < schedule.periods.length; index += 1) {
      expect(schedule.periods[index]!.interest.minorUnits).toBeLessThanOrEqual(
        schedule.periods[index - 1]!.interest.minorUnits,
      );
    }
  });

  it('reconciles exactly even when the term does not divide the amount evenly', () => {
    const schedule = generateLoanSchedule({
      principal: parsePhpMoney('100000.00'),
      annualRatePercent: '13.2500',
      termMonths: 7,
      repaymentModel: 'amortized',
      firstDueDate: '2026-05-10',
    });
    expect(sumPrincipal(schedule.periods)).toBe('100000.00');
    expect(formatPhpMoney(schedule.periods.at(-1)!.closingBalance)).toBe('0.00');
  });

  it('degenerates to equal principal installments with no interest at 0%', () => {
    const schedule = generateLoanSchedule({
      principal: parsePhpMoney('90000.00'),
      annualRatePercent: '0.0000',
      termMonths: 9,
      repaymentModel: 'amortized',
      firstDueDate: '2026-01-01',
    });
    expect(formatPhpMoney(schedule.totalInterest)).toBe('0.00');
    for (const period of schedule.periods) {
      expect(formatPhpMoney(period.interest)).toBe('0.00');
      expect(formatPhpMoney(period.principal)).toBe('10000.00');
    }
    expect(sumPrincipal(schedule.periods)).toBe('90000.00');
  });

  it('handles a single-period term as one full-principal-plus-interest payment', () => {
    const schedule = generateLoanSchedule({
      principal: parsePhpMoney('15000.00'),
      annualRatePercent: '10.0000',
      termMonths: 1,
      repaymentModel: 'amortized',
      firstDueDate: '2026-06-01',
    });
    expect(schedule.periods).toHaveLength(1);
    expect(formatPhpMoney(schedule.periods[0]!.principal)).toBe('15000.00');
    expect(formatPhpMoney(schedule.periods[0]!.interest)).toBe('125.00'); // 10%/12 * 15000
    expect(formatPhpMoney(schedule.periods[0]!.closingBalance)).toBe('0.00');
  });

  it('rejects a non-positive or non-integer term', () => {
    const base = {
      principal: parsePhpMoney('1000.00'),
      annualRatePercent: '5.0000',
      repaymentModel: 'amortized' as const,
      firstDueDate: '2026-01-01',
    };
    expect(() => generateLoanSchedule({ ...base, termMonths: 0 })).toThrow();
    expect(() => generateLoanSchedule({ ...base, termMonths: 1.5 })).toThrow();
  });
});

describe('generateLoanSchedule — due dates', () => {
  it('anchors to the original day of month and clamps only for shorter months', () => {
    const schedule = generateLoanSchedule({
      principal: parsePhpMoney('12000.00'),
      annualRatePercent: '6.0000',
      termMonths: 3,
      repaymentModel: 'interest_only',
      firstDueDate: '2026-01-31',
    });
    expect(schedule.periods.map((period) => period.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28', // 2026 is not a leap year — clamped from 31
      '2026-03-31', // back to the original day once the month is long enough again
    ]);
  });
});
