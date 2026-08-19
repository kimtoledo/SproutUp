export const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'service', 'timestamp'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    service: { type: 'string', const: 'api' },
    timestamp: { type: 'string', format: 'date-time' },
    dependencies: {
      type: 'object',
      additionalProperties: false,
      required: ['database'],
      properties: { database: { type: 'string', enum: ['ok', 'unavailable'] } },
    },
  },
} as const;
