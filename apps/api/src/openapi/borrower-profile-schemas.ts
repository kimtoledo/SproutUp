const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

export const beneficialOwnerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'fullName', 'ownershipPercentage', 'nationality', 'isPep', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    fullName: { type: 'string' },
    ownershipPercentage: { type: 'string' },
    nationality: nullableString,
    isPep: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const beneficialOwnerInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fullName', 'ownershipPercentage', 'isPep'],
  properties: {
    fullName: { type: 'string', minLength: 1, maxLength: 200 },
    ownershipPercentage: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$' },
    nationality: { type: 'string', minLength: 1, maxLength: 80 },
    isPep: { type: 'boolean' },
  },
} as const;

export const borrowerProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'caseId',
    'entityType',
    'version',
    'registeredName',
    'tradeName',
    'registrationNumber',
    'tin',
    'principalAddress',
    'contactPersonName',
    'contactPersonEmail',
    'contactPersonPhone',
    'dateEstablished',
    'createdAt',
    'updatedAt',
    'beneficialOwners',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    caseId: { type: 'string', format: 'uuid' },
    entityType: { type: 'string', enum: ['sole_proprietorship', 'partnership', 'corporation'] },
    version: { type: 'integer', minimum: 1 },
    registeredName: { type: 'string' },
    tradeName: nullableString,
    registrationNumber: nullableString,
    tin: nullableString,
    principalAddress: nullableString,
    contactPersonName: nullableString,
    contactPersonEmail: nullableString,
    contactPersonPhone: nullableString,
    dateEstablished: nullableString,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    beneficialOwners: { type: 'array', items: beneficialOwnerSchema },
  },
} as const;

export const saveBorrowerProfileBody = {
  type: 'object',
  additionalProperties: false,
  required: ['entityType', 'registeredName'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    entityType: { type: 'string', enum: ['sole_proprietorship', 'partnership', 'corporation'] },
    registeredName: { type: 'string', minLength: 1, maxLength: 300 },
    tradeName: { type: 'string', minLength: 1, maxLength: 300 },
    registrationNumber: { type: 'string', minLength: 1, maxLength: 100 },
    tin: { type: 'string', minLength: 1, maxLength: 30 },
    principalAddress: { type: 'string', minLength: 1, maxLength: 500 },
    contactPersonName: { type: 'string', minLength: 1, maxLength: 200 },
    contactPersonEmail: { type: 'string', format: 'email' },
    contactPersonPhone: { type: 'string', minLength: 1, maxLength: 30 },
    dateEstablished: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    beneficialOwners: {
      type: 'array',
      items: beneficialOwnerInputSchema,
      maxItems: 20,
      default: [],
    },
  },
} as const;
