import { createHash } from 'node:crypto';
import type { RoleKey } from '@sproutup/shared';
import type { Database } from './database.js';
import { auditEvents } from './schema/audit.js';

const sensitiveKey = /(authorization|cookie|password|secret|token|api.?key|credential)/i;

/**
 * One-way SHA-256 of a client IP for audit evidence. Storing the hash keeps the
 * evidence useful for correlation without persisting the raw address. Returns
 * `undefined` for a missing/blank value so callers can pass it through directly.
 */
export function hashIpAddress(ip: string | null | undefined): string | undefined {
  const value = ip?.trim();
  if (!value) return undefined;
  return createHash('sha256').update(value).digest('hex');
}

export interface WriteAuditInput {
  actorType: 'user' | 'system';
  actorUserId?: string;
  actorRoles?: RoleKey[];
  action: string;
  outcome: 'succeeded' | 'denied' | 'failed';
  resourceType: string;
  resourceId?: string;
  requestId?: string;
  reason?: string;
  ipAddressHash?: string;
  metadata?: Record<string, unknown>;
}

export type AuditWriterDatabase = Pick<Database, 'insert'>;

export function assertSafeAuditMetadata(value: unknown, path = 'metadata'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeAuditMetadata(item, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      throw new Error(`Sensitive audit metadata key is not allowed: ${path}.${key}`);
    }
    assertSafeAuditMetadata(nestedValue, `${path}.${key}`);
  }
}

export async function writeAudit(
  database: AuditWriterDatabase,
  input: WriteAuditInput,
): Promise<string> {
  const metadata = input.metadata ?? {};
  assertSafeAuditMetadata(metadata);

  const [event] = await database
    .insert(auditEvents)
    .values({
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles ?? [],
      action: input.action,
      outcome: input.outcome,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId,
      reason: input.reason,
      ipAddressHash: input.ipAddressHash,
      metadata,
    })
    .returning({ id: auditEvents.id });

  if (!event) {
    throw new Error('Audit event was not persisted');
  }

  return event.id;
}
