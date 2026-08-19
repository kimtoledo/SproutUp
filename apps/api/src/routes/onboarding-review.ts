import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPermission, onboardingCaseStatusSchema, onboardingCaseTypeSchema } from '@sproutup/shared';
import { resolveAuthenticatedRequest } from '../auth/request.js';
import type { AuthServices } from '../auth/types.js';
import type { OnboardingReviewService } from '../onboarding/review-service.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  caseType: onboardingCaseTypeSchema.optional(),
  status: onboardingCaseStatusSchema.optional(),
  assignedToMe: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
const parametersSchema = z.object({ caseId: z.uuid() });
const versionSchema = z.object({ version: z.number().int().positive() });

interface Options {
  auth: AuthServices;
  review: OnboardingReviewService;
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({ success: false, error: { code: 'UNAUTHENTICATED', message: 'A valid active session is required' } });
}

function forbidden(reply: FastifyReply) {
  return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'The required onboarding review permission is not granted' } });
}

function failure(reply: FastifyReply, reason: string) {
  const failures: Record<string, { status: number; code: string; message: string }> = {
    not_found: { status: 404, code: 'CASE_NOT_FOUND', message: 'Onboarding case not found' },
    self_review_not_allowed: { status: 409, code: 'SELF_REVIEW_NOT_ALLOWED', message: 'An applicant cannot review their own case' },
    assigned_to_other: { status: 409, code: 'CASE_ASSIGNED_TO_OTHER', message: 'The case is assigned to another reviewer' },
    stale_version: { status: 409, code: 'STALE_CASE_VERSION', message: 'The onboarding case changed; reload before retrying' },
    invalid_transition: { status: 409, code: 'INVALID_CASE_TRANSITION', message: 'Review cannot start from the current case state' },
  };
  const mapped = failures[reason] ?? { status: 500, code: 'INTERNAL_ERROR', message: 'Onboarding review could not be processed' };
  return reply.status(mapped.status).send({ success: false, error: { code: mapped.code, message: mapped.message } });
}

export async function registerOnboardingReviewRoutes(app: FastifyInstance, options: Options): Promise<void> {
  app.get('/v1/admin/onboarding/cases', async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'onboarding_cases.read')) return forbidden(reply);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid onboarding queue filters' } });
    }
    const { assignedToMe, ...filters } = parsed.data;
    return reply.send({
      success: true,
      data: await options.review.list({
        ...filters,
        reviewerUserId: assignedToMe ? identity.authorization.user.id : undefined,
      }),
    });
  });

  app.post('/v1/admin/onboarding/cases/:caseId/start-review', async (request, reply) => {
    const identity = await resolveAuthenticatedRequest(request, options.auth);
    if (!identity) return unauthenticated(reply);
    if (!hasPermission(identity.authorization, 'onboarding_cases.review')) return forbidden(reply);
    const parameters = parametersSchema.safeParse(request.params);
    const body = versionSchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A valid case ID and positive version are required' } });
    }
    const result = await options.review.startReview({
      reviewerUserId: identity.authorization.user.id,
      reviewerRoles: identity.authorization.roles,
      caseId: parameters.data.caseId,
      expectedVersion: body.data.version,
      requestId: request.id,
    });
    if (!result.ok) return failure(reply, result.reason);
    return reply.send({ success: true, data: result.case });
  });
}
