import { z } from 'zod';

export const onboardingCaseTypeSchema = z.enum(['borrower', 'investor']);
export const onboardingCaseStatusSchema = z.enum([
  'draft',
  'submitted',
  'in_review',
  'needs_information',
  'approved',
  'rejected',
  'withdrawn',
  'expired',
]);
export const onboardingEventTypeSchema = z.enum([
  'created',
  'submitted',
  'review_started',
  'information_requested',
  'approved',
  'rejected',
  'withdrawn',
  'reopened',
  'expired',
]);

export type OnboardingCaseType = z.infer<typeof onboardingCaseTypeSchema>;
export type OnboardingCaseStatus = z.infer<typeof onboardingCaseStatusSchema>;
export type OnboardingEventType = z.infer<typeof onboardingEventTypeSchema>;

export const onboardingTransitions: Readonly<
  Record<OnboardingCaseStatus, readonly OnboardingCaseStatus[]>
> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['in_review', 'withdrawn'],
  in_review: ['needs_information', 'approved', 'rejected'],
  needs_information: ['submitted', 'withdrawn'],
  approved: ['expired'],
  rejected: ['draft'],
  withdrawn: [],
  expired: ['draft'],
};

export function canTransitionOnboardingCase(
  from: OnboardingCaseStatus,
  to: OnboardingCaseStatus,
): boolean {
  return onboardingTransitions[from].includes(to);
}
