import { describe, expect, it } from 'vitest';
import { canTransitionOnboardingCase, onboardingTransitions } from './onboarding.js';

describe('onboarding case state machine', () => {
  it('permits the controlled submission and review path', () => {
    expect(canTransitionOnboardingCase('draft', 'submitted')).toBe(true);
    expect(canTransitionOnboardingCase('submitted', 'in_review')).toBe(true);
    expect(canTransitionOnboardingCase('in_review', 'approved')).toBe(true);
  });

  it('requires information requests to be resubmitted before review continues', () => {
    expect(canTransitionOnboardingCase('in_review', 'needs_information')).toBe(true);
    expect(canTransitionOnboardingCase('needs_information', 'submitted')).toBe(true);
    expect(canTransitionOnboardingCase('needs_information', 'approved')).toBe(false);
  });

  it('supports correction without duplicating identity and keeps withdrawal terminal', () => {
    expect(canTransitionOnboardingCase('rejected', 'draft')).toBe(true);
    expect(canTransitionOnboardingCase('expired', 'draft')).toBe(true);
    expect(onboardingTransitions.withdrawn).toEqual([]);
  });
});
