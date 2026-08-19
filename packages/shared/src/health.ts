import { z } from 'zod';

export const serviceStatusSchema = z.enum(['ok', 'degraded']);
export const dependencyStatusSchema = z.enum(['ok', 'unavailable']);

export const healthResponseSchema = z.object({
  status: serviceStatusSchema,
  service: z.literal('api'),
  timestamp: z.iso.datetime(),
  dependencies: z
    .object({
      database: dependencyStatusSchema,
    })
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
