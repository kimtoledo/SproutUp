const nullableDateTime = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const;

export const caseIdParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['caseId'],
  properties: { caseId: { type: 'string', format: 'uuid' } },
} as const;

export const versionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: { version: { type: 'integer', minimum: 1 } },
} as const;

export const informationRequestBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'reason'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    reason: { type: 'string', minLength: 10, maxLength: 1000 },
  },
} as const;

export const withdrawalBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'reason'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    reason: { type: 'string', minLength: 10, maxLength: 1000 },
  },
} as const;

export const rejectionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'reason'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    reason: { type: 'string', minLength: 10, maxLength: 1000 },
  },
} as const;

export const createCaseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['caseType'],
  properties: { caseType: { type: 'string', enum: ['borrower', 'investor'] } },
} as const;

export const reviewQueueQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, maximum: 10_000, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    caseType: { type: 'string', enum: ['borrower', 'investor'] },
    status: {
      type: 'string',
      enum: [
        'draft',
        'submitted',
        'in_review',
        'needs_information',
        'approved',
        'rejected',
        'withdrawn',
        'expired',
      ],
    },
    assignedToMe: { type: 'string', enum: ['true', 'false'] },
  },
} as const;

export const caseSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'caseType',
    'status',
    'version',
    'assignedReviewerUserId',
    'submittedAt',
    'decidedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    caseType: { type: 'string', enum: ['borrower', 'investor'] },
    status: {
      type: 'string',
      enum: [
        'draft',
        'submitted',
        'in_review',
        'needs_information',
        'approved',
        'rejected',
        'withdrawn',
        'expired',
      ],
    },
    version: { type: 'integer', minimum: 1 },
    assignedReviewerUserId: {
      anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
    },
    submittedAt: nullableDateTime,
    decidedAt: nullableDateTime,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const caseEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'eventType',
    'fromStatus',
    'toStatus',
    'caseVersion',
    'actorType',
    'actorUserId',
    'reason',
    'occurredAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    eventType: {
      type: 'string',
      enum: [
        'created',
        'submitted',
        'review_started',
        'information_requested',
        'approved',
        'rejected',
        'withdrawn',
        'reopened',
        'expired',
      ],
    },
    fromStatus: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    toStatus: { type: 'string' },
    caseVersion: { type: 'integer', minimum: 1 },
    actorType: { type: 'string', enum: ['user', 'system'] },
    actorUserId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    occurredAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', const: false },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
} as const;

export function successResponse(data: object) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: { success: { type: 'boolean', const: true }, data },
  } as const;
}

export const ownCaseDetailSchema = {
  ...caseSummarySchema,
  properties: { ...caseSummarySchema.properties, events: { type: 'array', items: caseEventSchema } },
  required: [...caseSummarySchema.required, 'events'],
} as const;

export const staffCaseSummarySchema = {
  ...caseSummarySchema,
  properties: {
    ...caseSummarySchema.properties,
    applicantName: { type: 'string' },
    applicantEmail: { type: 'string', format: 'email' },
  },
  required: [...caseSummarySchema.required, 'applicantName', 'applicantEmail'],
} as const;

export const staffCaseDetailSchema = {
  ...staffCaseSummarySchema,
  properties: {
    ...staffCaseSummarySchema.properties,
    applicantUserId: { type: 'string', format: 'uuid' },
    events: { type: 'array', items: caseEventSchema },
  },
  required: [...staffCaseSummarySchema.required, 'applicantUserId', 'events'],
} as const;

export const commonErrors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
} as const;
