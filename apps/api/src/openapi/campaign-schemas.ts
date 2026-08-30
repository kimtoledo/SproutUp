const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
const nullableDateTime = { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] } as const;
const nullableUuid = { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] } as const;

const campaignStatusValues = ['draft', 'pending_approval', 'published', 'cancelled'] as const;
const repaymentModelValues = ['amortized', 'interest_only'] as const;
// Matches @sproutup/shared's canonical PHP-amount string (exact 2-place decimal).
const nonNegativePhpAmount = { type: 'string', pattern: '^(?:0|[1-9]\\d{0,27})\\.\\d{2}$' } as const;
const annualRatePercent = { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,4})?$' } as const;

const campaignCoreProperties = {
  id: { type: 'string', format: 'uuid' },
  creditApplicationId: { type: 'string', format: 'uuid' },
  borrowerCaseId: { type: 'string', format: 'uuid' },
  status: { type: 'string', enum: [...campaignStatusValues] },
  version: { type: 'integer', minimum: 1 },
  loanAmount: { type: 'string' },
  termMonths: { type: 'integer', minimum: 1 },
  repaymentModel: { type: 'string', enum: [...repaymentModelValues] },
  borrowerAnnualRatePercent: { type: 'string' },
  investorAnnualRatePercent: { type: 'string' },
  minimumCommitmentAmount: { type: 'string' },
  fundingWindowDays: { type: 'integer', minimum: 1 },
  firstRepaymentDueDate: { type: 'string' },
  purposeSummary: { type: 'string' },
  createdByUserId: { type: 'string', format: 'uuid' },
  submittedByUserId: nullableUuid,
  submittedAt: nullableDateTime,
  publishedByUserId: nullableUuid,
  publishedAt: nullableDateTime,
  cancelledByUserId: nullableUuid,
  cancelledAt: nullableDateTime,
  decisionReason: nullableString,
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
} as const;
const campaignCoreRequired = Object.keys(campaignCoreProperties);

export const campaignSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: campaignCoreRequired,
  properties: campaignCoreProperties,
} as const;

const schedulePeriodSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['period', 'dueDate', 'openingBalance', 'principal', 'interest', 'payment', 'closingBalance'],
  properties: {
    period: { type: 'integer', minimum: 1 },
    dueDate: { type: 'string' },
    openingBalance: { type: 'string' },
    principal: { type: 'string' },
    interest: { type: 'string' },
    payment: { type: 'string' },
    closingBalance: { type: 'string' },
  },
} as const;

const scheduleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['repaymentModel', 'totalPrincipal', 'totalInterest', 'totalPayment', 'periods'],
  properties: {
    repaymentModel: { type: 'string', enum: [...repaymentModelValues] },
    totalPrincipal: { type: 'string' },
    totalInterest: { type: 'string' },
    totalPayment: { type: 'string' },
    periods: { type: 'array', items: schedulePeriodSchema },
  },
} as const;

export const campaignDetailSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...campaignCoreRequired, 'schedule', 'events'],
  properties: {
    ...campaignCoreProperties,
    schedule: scheduleSchema,
    events: { type: 'array' },
  },
} as const;

const campaignFieldProperties = {
  loanAmount: nonNegativePhpAmount,
  termMonths: { type: 'integer', minimum: 1, maximum: 600 },
  repaymentModel: { type: 'string', enum: [...repaymentModelValues] },
  borrowerAnnualRatePercent: annualRatePercent,
  investorAnnualRatePercent: annualRatePercent,
  minimumCommitmentAmount: nonNegativePhpAmount,
  fundingWindowDays: { type: 'integer', minimum: 1, maximum: 365 },
  firstRepaymentDueDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  purposeSummary: { type: 'string', minLength: 1, maxLength: 2000 },
} as const;
const campaignFieldRequired = Object.keys(campaignFieldProperties);

export const createCampaignBody = {
  type: 'object',
  additionalProperties: false,
  required: ['creditApplicationId', ...campaignFieldRequired],
  properties: {
    creditApplicationId: { type: 'string', format: 'uuid' },
    ...campaignFieldProperties,
  },
} as const;

export const updateCampaignBody = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion', ...campaignFieldRequired],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    ...campaignFieldProperties,
  },
} as const;

export const campaignIdParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['campaignId'],
  properties: { campaignId: { type: 'string', format: 'uuid' } },
} as const;

export const versionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: { version: { type: 'integer', minimum: 1 } },
} as const;

export const reasonedVersionBody = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'reason'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    reason: { type: 'string', minLength: 10, maxLength: 1000 },
  },
} as const;

export const campaignQueueQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, maximum: 10_000, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    status: { type: 'string', enum: [...campaignStatusValues] },
  },
} as const;
