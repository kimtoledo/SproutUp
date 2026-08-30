import { z } from 'zod';

/**
 * Philippine SME entity types the borrower KYB profile captures today.
 * Required fields/documents per type are an open compliance decision
 * (tasks/mvp1/03-borrower-onboarding-kyc.md); this enum only fixes the shape.
 */
export const borrowerEntityTypeSchema = z.enum([
  'sole_proprietorship',
  'partnership',
  'corporation',
]);

export type BorrowerEntityType = z.infer<typeof borrowerEntityTypeSchema>;
