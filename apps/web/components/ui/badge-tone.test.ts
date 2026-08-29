import { describe, expect, it } from 'vitest';
import { badgeToneClasses, statusTone } from './badge-tone';

describe('statusTone', () => {
  it('maps terminal-negative statuses to the danger tone', () => {
    for (const status of ['rejected', 'withdrawn', 'expired', 'cancelled', 'failed']) {
      expect(statusTone(status)).toBe('danger');
    }
  });

  it('maps in-flight statuses to the progress tone', () => {
    for (const status of ['submitted', 'in_review', 'pending']) {
      expect(statusTone(status)).toBe('progress');
    }
  });

  it('maps approval/completion to success and needs_information to attention', () => {
    expect(statusTone('approved')).toBe('success');
    expect(statusTone('executed')).toBe('success');
    expect(statusTone('needs_information')).toBe('attention');
  });

  it('falls back to neutral for an unknown status instead of throwing', () => {
    expect(statusTone('some_new_backend_status')).toBe('neutral');
  });
});

describe('badgeToneClasses', () => {
  it('returns a class string for every tone', () => {
    for (const tone of ['neutral', 'progress', 'attention', 'success', 'danger'] as const) {
      expect(badgeToneClasses(tone)).toMatch(/^bg-/);
    }
  });
});
