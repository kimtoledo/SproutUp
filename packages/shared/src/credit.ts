import { z } from 'zod';

/**
 * Credit application lifecycle. Deliberately separate from
 * `onboarding_case_status`: underwriting needs a `recommended` state between
 * review and a final decision so an analyst's recommendation and the actual
 * approval are two distinct, separately authorized actions (task 06
 * acceptance criterion: "separation between calculated score, analyst
 * recommendation, and final approval"). There is no calculated score or risk
 * grade here — the scorecard itself is an unresolved business decision (see
 * tasks/mvp1/06-credit-scoring-underwriting.md); this only captures inputs
 * and the human recommendation/decision around them.
 */
export const creditApplicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'in_review',
  'needs_information',
  'recommended',
  'approved',
  'rejected',
  'withdrawn',
]);
export const creditApplicationEventTypeSchema = z.enum([
  'created',
  'submitted',
  'review_started',
  'information_requested',
  'recommended',
  'approved',
  'rejected',
  'withdrawn',
  'reopened',
]);
export const creditCollateralTypeSchema = z.enum(['real_estate', 'inventory', 'invoice', 'other']);
export const creditGuarantorResidencySchema = z.enum(['local', 'permanent_resident', 'foreign']);

export type CreditApplicationStatus = z.infer<typeof creditApplicationStatusSchema>;
export type CreditApplicationEventType = z.infer<typeof creditApplicationEventTypeSchema>;
export type CreditCollateralType = z.infer<typeof creditCollateralTypeSchema>;
export type CreditGuarantorResidency = z.infer<typeof creditGuarantorResidencySchema>;

export const creditApplicationTransitions: Readonly<
  Record<CreditApplicationStatus, readonly CreditApplicationStatus[]>
> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['in_review', 'withdrawn'],
  // No direct path to `approved` — every approval must pass through
  // `recommended` first, even when an analyst wants to reject outright.
  in_review: ['needs_information', 'recommended', 'rejected'],
  needs_information: ['submitted', 'withdrawn'],
  // The approver is not bound by the recommendation's direction.
  recommended: ['approved', 'rejected'],
  approved: [],
  rejected: ['draft'],
  withdrawn: [],
};

export function canTransitionCreditApplication(
  from: CreditApplicationStatus,
  to: CreditApplicationStatus,
): boolean {
  return creditApplicationTransitions[from].includes(to);
}
