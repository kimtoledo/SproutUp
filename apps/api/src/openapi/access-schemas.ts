import { accountTypes, permissionKeys, roleKeys } from '@sproutup/shared';
import { errorResponseSchema, successResponse } from './onboarding-schemas.js';

export const sessionIdParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionId'],
  properties: { sessionId: { type: 'string', format: 'uuid' } },
} as const;

export const sessionSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'createdAt', 'expiresAt', 'ipAddress', 'userAgent', 'current'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    ipAddress: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    userAgent: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    current: { type: 'boolean' },
  },
} as const;

export const userCatalogueQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, maximum: 10_000, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    query: { type: 'string', minLength: 2, maxLength: 100 },
    status: { type: 'string', enum: ['active', 'suspended', 'disabled'] },
  },
} as const;

export const roleSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'name', 'category', 'isActive', 'permissions'],
  properties: {
    key: { type: 'string', enum: [...roleKeys] },
    name: { type: 'string' },
    category: { type: 'string', enum: ['staff'] },
    isActive: { type: 'boolean' },
    permissions: { type: 'array', items: { type: 'string', enum: [...permissionKeys] } },
  },
} as const;

export const userAccessSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'email', 'emailVerified', 'status', 'roles', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    email: { type: 'string', format: 'email' },
    emailVerified: { type: 'boolean' },
    status: { type: 'string', enum: ['active', 'suspended', 'disabled'] },
    roles: { type: 'array', items: { type: 'string', enum: [...roleKeys] } },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const sessionListResponses = {
  200: successResponse({ type: 'array', items: sessionSummarySchema }),
  401: errorResponseSchema,
  403: errorResponseSchema,
} as const;

export const authorizationContextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accountType', 'user', 'roles', 'permissions'],
  properties: {
    accountType: { type: 'string', enum: [...accountTypes] },
    user: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'email', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
      },
    },
    roles: { type: 'array', items: { type: 'string', enum: [...roleKeys] } },
    permissions: { type: 'array', items: { type: 'string', enum: [...permissionKeys] } },
  },
} as const;
