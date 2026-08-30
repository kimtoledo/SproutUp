const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] } as const;
const nullableBoolean = { anyOf: [{ type: 'boolean' }, { type: 'null' }] } as const;

// Matches @sproutup/shared's canonical PHP-amount string (exact 2-place decimal).
const phpAmount = { type: 'string', pattern: '^-?(?:0|[1-9]\\d{0,27})\\.\\d{2}$' } as const;
const nonNegativePhpAmount = { type: 'string', pattern: '^(?:0|[1-9]\\d{0,27})\\.\\d{2}$' } as const;

const creditApplicationStatusValues = [
  'draft',
  'submitted',
  'in_review',
  'needs_information',
  'recommended',
  'approved',
  'rejected',
  'withdrawn',
] as const;

const collateralTypeValues = ['real_estate', 'inventory', 'invoice', 'other'] as const;
const guarantorResidencyValues = ['local', 'permanent_resident', 'foreign'] as const;

export const collateralItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'collateralType', 'description', 'estimatedValue', 'outstandingLoan', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    collateralType: { type: 'string', enum: [...collateralTypeValues] },
    description: { type: 'string' },
    estimatedValue: { type: 'string' },
    outstandingLoan: nullableString,
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const collateralItemInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['collateralType', 'description', 'estimatedValue'],
  properties: {
    collateralType: { type: 'string', enum: [...collateralTypeValues] },
    description: { type: 'string', minLength: 1, maxLength: 500 },
    estimatedValue: nonNegativePhpAmount,
    outstandingLoan: nonNegativePhpAmount,
  },
} as const;

export const guarantorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'fullName', 'residencyStatus', 'assessedNetWorth', 'assessmentYear', 'contactPhone', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    fullName: { type: 'string' },
    residencyStatus: { type: 'string', enum: [...guarantorResidencyValues] },
    assessedNetWorth: nullableString,
    assessmentYear: nullableNumber,
    contactPhone: nullableString,
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const guarantorInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fullName', 'residencyStatus'],
  properties: {
    fullName: { type: 'string', minLength: 1, maxLength: 200 },
    residencyStatus: { type: 'string', enum: [...guarantorResidencyValues] },
    assessedNetWorth: nonNegativePhpAmount,
    assessmentYear: { type: 'integer' },
    contactPhone: { type: 'string', minLength: 1, maxLength: 30 },
  },
} as const;

const applicationCoreProperties = {
  id: { type: 'string', format: 'uuid' },
  borrowerCaseId: { type: 'string', format: 'uuid' },
  status: { type: 'string', enum: [...creditApplicationStatusValues] },
  version: { type: 'integer', minimum: 1 },
  requestedAmount: { type: 'string' },
  termMonths: { type: 'integer', minimum: 1 },
  purpose: { type: 'string' },
  industry: nullableString,
  companyEmployees: nullableNumber,
  ownershipDate: nullableString,
  isAudited: { type: 'boolean' },
  lastYear1SalesRevenue: nullableString,
  lastYear1GrossProfit: nullableString,
  lastYear1NetProfit: nullableString,
  lastYear2SalesRevenue: nullableString,
  lastYear2GrossProfit: nullableString,
  lastYear2NetProfit: nullableString,
  bankruptcyHistory: { type: 'boolean' },
  bankruptcyDischarged: nullableBoolean,
  bankruptcyYear: nullableNumber,
  assignedAnalystUserId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
  recommendationNarrative: nullableString,
  recommendedAmount: nullableString,
  recommendedTermMonths: nullableNumber,
  // (response fields stay plain `nullableString` rather than the stricter
  // canonical-amount pattern — a persisted value is already canonical by
  // construction; the pattern only guards input.)
  recommendedByUserId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
  recommendedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  decidedByUserId: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
  decidedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  decisionReason: nullableString,
  approvedAmount: nullableString,
  approvedTermMonths: nullableNumber,
  submittedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
} as const;

const applicationCoreRequired = Object.keys(applicationCoreProperties);

export const creditApplicationSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: applicationCoreRequired,
  properties: applicationCoreProperties,
} as const;

export const ownCreditApplicationDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...applicationCoreRequired, 'collateralItems', 'guarantors', 'events'],
  properties: {
    ...applicationCoreProperties,
    collateralItems: { type: 'array', items: collateralItemSchema },
    guarantors: { type: 'array', items: guarantorSchema },
    events: { type: 'array' },
  },
} as const;

export const staffCreditApplicationSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [...applicationCoreRequired, 'applicantName', 'applicantEmail'],
  properties: {
    ...applicationCoreProperties,
    applicantName: { type: 'string' },
    applicantEmail: { type: 'string', format: 'email' },
  },
} as const;

export const staffCreditApplicationDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...applicationCoreRequired, 'applicantUserId', 'applicantName', 'applicantEmail', 'collateralItems', 'guarantors', 'events'],
  properties: {
    ...applicationCoreProperties,
    applicantUserId: { type: 'string', format: 'uuid' },
    applicantName: { type: 'string' },
    applicantEmail: { type: 'string', format: 'email' },
    collateralItems: { type: 'array' },
    guarantors: { type: 'array' },
    events: { type: 'array' },
  },
} as const;

const applicationInputFields = {
  requestedAmount: nonNegativePhpAmount,
  termMonths: { type: 'integer', minimum: 1, maximum: 600 },
  purpose: { type: 'string', minLength: 1, maxLength: 1000 },
  industry: { type: 'string', minLength: 1, maxLength: 200 },
  companyEmployees: { type: 'integer', minimum: 1 },
  ownershipDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  isAudited: { type: 'boolean' },
  // Revenue is never negative; profit (gross/net) may be, in a loss year.
  lastYear1SalesRevenue: nonNegativePhpAmount,
  lastYear1GrossProfit: phpAmount,
  lastYear1NetProfit: phpAmount,
  lastYear2SalesRevenue: nonNegativePhpAmount,
  lastYear2GrossProfit: phpAmount,
  lastYear2NetProfit: phpAmount,
  bankruptcyHistory: { type: 'boolean' },
  bankruptcyDischarged: { type: 'boolean' },
  bankruptcyYear: { type: 'integer' },
  collateralItems: { type: 'array', items: collateralItemInputSchema, maxItems: 20, default: [] },
  guarantors: { type: 'array', items: guarantorInputSchema, maxItems: 10, default: [] },
} as const;

export const createCreditApplicationBody = {
  type: 'object',
  additionalProperties: false,
  required: ['borrowerCaseId', 'requestedAmount', 'termMonths', 'purpose', 'isAudited', 'bankruptcyHistory'],
  properties: {
    borrowerCaseId: { type: 'string', format: 'uuid' },
    ...applicationInputFields,
  },
} as const;

export const saveCreditApplicationBody = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion', 'requestedAmount', 'termMonths', 'purpose', 'isAudited', 'bankruptcyHistory'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    ...applicationInputFields,
  },
} as const;

export const applicationIdParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['applicationId'],
  properties: { applicationId: { type: 'string', format: 'uuid' } },
} as const;

export const versionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: { version: { type: 'integer', minimum: 1 } },
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

export const informationRequestBody = withdrawalBody;
export const rejectionBody = withdrawalBody;

export const recommendationBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'recommendationNarrative'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    recommendationNarrative: { type: 'string', minLength: 10, maxLength: 2000 },
    recommendedAmount: nonNegativePhpAmount,
    recommendedTermMonths: { type: 'integer', minimum: 1, maximum: 600 },
  },
} as const;

export const approvalBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'approvedAmount', 'approvedTermMonths', 'reason'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    approvedAmount: nonNegativePhpAmount,
    approvedTermMonths: { type: 'integer', minimum: 1, maximum: 600 },
    reason: { type: 'string', minLength: 10, maxLength: 1000 },
  },
} as const;

export const reviewQueueQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, maximum: 10_000, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    status: { type: 'string', enum: [...creditApplicationStatusValues] },
    assignedToMe: { type: 'string', enum: ['true', 'false'] },
  },
} as const;
