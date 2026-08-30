import type { ApiConfig } from '../config.js';
import { createLocalFileEmailDelivery } from './local-file-email-delivery.js';

/**
 * Transport for password-reset and email-verification links. Implementations
 * are swapped at the composition root — an in-memory capture for tests, a
 * local dev outbox for development — the same pattern used for `FileStorage`.
 * No transactional-email provider is approved yet (task 02's open decisions),
 * so production resolves to the fail-closed adapter below until one is wired.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailDelivery {
  send(message: EmailMessage): Promise<void>;
}

export function createInMemoryEmailDelivery(): EmailDelivery & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

/**
 * Fails closed. Without an approved transactional-email provider, an
 * environment that reaches this adapter must not silently pretend a reset or
 * verification email was sent — it surfaces as a delivery failure instead of
 * a link nobody receives.
 */
export function createUnconfiguredEmailDelivery(): EmailDelivery {
  return {
    async send() {
      throw new Error(
        'Email delivery is not configured for this environment. Wire an approved ' +
          'transactional-email provider adapter before password reset or email ' +
          'verification can be delivered (see tasks/mvp1/02-auth-rbac-audit.md).',
      );
    },
  };
}

/** Composition-root selection: production fails closed until a real provider is approved. */
export function selectEmailDelivery(
  config: Pick<ApiConfig, 'environment' | 'emailOutboxDir'>,
): EmailDelivery {
  if (config.environment === 'production') return createUnconfiguredEmailDelivery();
  return createLocalFileEmailDelivery(config.emailOutboxDir);
}
