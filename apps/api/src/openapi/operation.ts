import type { FastifySchema } from 'fastify';
import type { PermissionKey } from '@sproutup/shared';

export interface SproutUpOperationMetadata {
  actor: 'authenticated_user' | 'authenticated_customer' | 'staff';
  permissions: PermissionKey[];
  permissionMode: 'any' | 'all';
  retryModel: 'safe_read' | 'idempotent_delete' | 'unique_open_case' | 'optimistic_version';
  sideEffects: string[];
  auditEvent: string | null;
}

type SproutUpFastifySchema = FastifySchema & {
  'x-sproutup': SproutUpOperationMetadata;
};

export function operation(input: {
  operationId: string;
  summary: string;
  tags: string[];
  metadata: SproutUpOperationMetadata;
  http?: Pick<FastifySchema, 'body' | 'querystring' | 'params' | 'response'>;
}): SproutUpFastifySchema {
  return {
    ...input.http,
    operationId: input.operationId,
    summary: input.summary,
    tags: input.tags,
    security: [{ sessionCookie: [] }],
    'x-sproutup': input.metadata,
  };
}
