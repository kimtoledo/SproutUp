import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EmailDelivery, EmailMessage } from './email-delivery.js';

/**
 * Development-only outbox: writes each message to its own file under
 * `rootDir` instead of a real transport, and never touches the application
 * logger — reset and verification links are single-use credentials and must
 * not enter log storage, the same rule `provision-initial-admin.ts` applies
 * to provisioned passwords. Not for production; a deployed environment uses a
 * transactional-email adapter selected during vendor/infrastructure approval.
 */
export function createLocalFileEmailDelivery(rootDir: string): EmailDelivery {
  const root = resolve(rootDir);
  return {
    async send(message: EmailMessage) {
      await mkdir(root, { recursive: true });
      const filename = `${Date.now()}-${randomUUID()}.txt`;
      const body = `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`;
      // Each filename is a fresh random id, so `wx` (fail-if-exists) only ever
      // guards against a genuine collision rather than overwriting a message.
      await writeFile(join(root, filename), body, { flag: 'wx' });
    },
  };
}
