export const documentClassificationValues = [
  'kyc_identity',
  'kyc_address',
  'kyc_business',
  'financial',
  'contract',
  'other',
] as const;

export const documentScanStateValues = ['pending', 'clean', 'infected', 'error'] as const;

export const uploadDocumentMultipartBody = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'purpose', 'file'],
  properties: {
    classification: { type: 'string', enum: [...documentClassificationValues] },
    purpose: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$' },
    file: { type: 'string', format: 'binary' },
  },
} as const;

export const documentVersionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['documentId', 'documentVersionId', 'version', 'contentSha256', 'byteSize'],
  properties: {
    documentId: { type: 'string', format: 'uuid' },
    documentVersionId: { type: 'string', format: 'uuid' },
    version: { type: 'integer', minimum: 1 },
    contentSha256: { type: 'string' },
    byteSize: { type: 'integer', minimum: 1 },
  },
} as const;

export const ownedDocumentSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'documentId',
    'classification',
    'purpose',
    'latestVersion',
    'latestVersionId',
    'scanState',
    'byteSize',
    'contentType',
    'originalFilename',
    'uploadedAt',
  ],
  properties: {
    documentId: { type: 'string', format: 'uuid' },
    classification: { type: 'string', enum: [...documentClassificationValues] },
    purpose: { type: 'string' },
    latestVersion: { type: 'integer', minimum: 1 },
    latestVersionId: { type: 'string', format: 'uuid' },
    scanState: { type: 'string', enum: [...documentScanStateValues] },
    byteSize: { type: 'integer', minimum: 1 },
    contentType: { type: 'string' },
    originalFilename: { type: 'string' },
    uploadedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const documentIdParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['documentId'],
  properties: { documentId: { type: 'string', format: 'uuid' } },
} as const;

export const documentVersionIdParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['documentVersionId'],
  properties: { documentVersionId: { type: 'string', format: 'uuid' } },
} as const;
