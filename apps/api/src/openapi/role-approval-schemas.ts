import { roleKeys } from '@sproutup/shared';
import { errorResponseSchema, successResponse } from './onboarding-schemas.js';

const roleChangePayloadSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['targetUserId', 'roleKey'],
  properties: {
    targetUserId: { type: 'string', format: 'uuid' },
    roleKey: { type: 'string', enum: [...roleKeys] },
  },
} as const;

const nullableUuid = {
  anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
} as const;

const nullableDateTime = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const;

const nullableString = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

export const approvalIdParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['approvalId'],
  properties: { approvalId: { type: 'string', format: 'uuid' } },
} as const;

export const roleChangeProposalBody = {
  ...roleChangePayloadSchema,
  required: [...roleChangePayloadSchema.required, 'reason'],
  properties: {
    ...roleChangePayloadSchema.properties,
    reason: { type: 'string', minLength: 10, maxLength: 500 },
  },
} as const;

export const optionalApprovalReasonBody = {
  type: 'object',
  additionalProperties: false,
  properties: { reason: { type: 'string', minLength: 10, maxLength: 500 } },
} as const;

export const requiredApprovalReasonBody = {
  ...optionalApprovalReasonBody,
  required: ['reason'],
} as const;

export const pendingRoleChangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'payload',
    'payloadHash',
    'makerUserId',
    'reason',
    'expiresAt',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    payload: roleChangePayloadSchema,
    payloadHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    makerUserId: { type: 'string', format: 'uuid' },
    reason: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const pendingRoleChangeListResponses = {
  200: successResponse({ type: 'array', items: pendingRoleChangeSchema }),
  401: errorResponseSchema,
  403: errorResponseSchema,
} as const;

export const approvalHistoryQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, maximum: 10_000, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    commandType: { type: 'string', enum: ['role.assign', 'role.revoke'] },
    status: {
      type: 'string',
      enum: ['pending', 'executed', 'rejected', 'cancelled', 'expired', 'failed'],
    },
  },
} as const;

const approvalHistoryItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'commandType',
    'status',
    'payload',
    'payloadHash',
    'version',
    'makerUserId',
    'checkerUserId',
    'reason',
    'expiresAt',
    'executedAt',
    'createdAt',
    'updatedAt',
    'integrity',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    commandType: { type: 'string', enum: ['role.assign', 'role.revoke'] },
    status: {
      type: 'string',
      enum: ['pending', 'executed', 'rejected', 'cancelled', 'expired', 'failed'],
    },
    payload: { type: 'object' },
    payloadHash: { type: 'string', minLength: 1, maxLength: 64 },
    version: { type: 'integer', minimum: 1 },
    makerUserId: { type: 'string', format: 'uuid' },
    checkerUserId: nullableUuid,
    reason: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    executedAt: nullableDateTime,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    integrity: { type: 'string', enum: ['valid', 'invalid'] },
  },
} as const;

const approvalActionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'action',
    'actorUserId',
    'payloadHash',
    'reason',
    'occurredAt',
    'metadata',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    action: {
      type: 'string',
      enum: ['proposed', 'approved', 'executed', 'rejected', 'cancelled', 'expired', 'failed'],
    },
    actorUserId: { type: 'string', format: 'uuid' },
    payloadHash: { type: 'string', minLength: 1, maxLength: 64 },
    reason: nullableString,
    occurredAt: { type: 'string', format: 'date-time' },
    metadata: { type: 'object' },
  },
} as const;

export const approvalHistoryDetailSchema = {
  ...approvalHistoryItemSchema,
  required: [...approvalHistoryItemSchema.required, 'actions'],
  properties: {
    ...approvalHistoryItemSchema.properties,
    actions: { type: 'array', items: approvalActionSchema },
  },
} as const;

export const approvalHistoryListResponse = successResponse({
  type: 'object',
  additionalProperties: false,
  required: ['approvals', 'page', 'pageSize', 'total'],
  properties: {
    approvals: { type: 'array', items: approvalHistoryItemSchema },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
});
