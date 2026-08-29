import { describe, expect, it } from 'vitest';
import { stepProgress, stepStates } from './stepper-model';

const steps = ['Profile', 'Documents', 'Declarations', 'Review'];

describe('stepStates', () => {
  it('marks earlier steps done, the active step current, and later steps upcoming', () => {
    expect(stepStates(steps, 2).map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
    ]);
  });

  it('numbers steps from 1', () => {
    expect(stepStates(steps, 0).map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });

  it('clamps an out-of-range index instead of losing the current marker', () => {
    expect(stepStates(steps, 99).map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
    ]);
    expect(stepStates(steps, -5)[0].state).toBe('current');
  });
});

describe('stepProgress', () => {
  it('is 0 at the first step and 1 at the last', () => {
    expect(stepProgress(steps, 0)).toBe(0);
    expect(stepProgress(steps, 3)).toBe(1);
  });

  it('is a clamped fraction in between', () => {
    expect(stepProgress(steps, 1)).toBeCloseTo(1 / 3);
    expect(stepProgress(steps, 99)).toBe(1);
  });
});
