import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseServices {
  db: Database;
  check(): Promise<void>;
  close(): Promise<void>;
}

export const REQUIRED_DATABASE_RELATIONS = [
  'users',
  'sessions',
  'accounts',
  'verifications',
  'rate_limits',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'audit_events',
  'approval_requests',
  'approval_actions',
  'background_jobs',
  'background_job_attempts',
  'ledger_accounts',
  'ledger_transactions',
  'ledger_entries',
  'onboarding_cases',
  'onboarding_case_events',
  'consent_documents',
  'consent_acceptances',
  'rule_sets',
  'rule_versions',
  'documents',
  'document_versions',
  'account_email_registry',
  'admin_accounts',
  'admin_sessions',
  'admin_credentials',
  'admin_verifications',
  'admin_rate_limits',
  'borrower_accounts',
  'borrower_sessions',
  'borrower_credentials',
  'borrower_verifications',
  'borrower_rate_limits',
  'investor_accounts',
  'investor_sessions',
  'investor_credentials',
  'investor_verifications',
  'investor_rate_limits',
] as const;

export function createDatabase(databaseUrl: string): DatabaseServices {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    db: drizzle(client, { schema }),
    async check() {
      await client`select 1 as ready`;
      const checks = await Promise.all(
        REQUIRED_DATABASE_RELATIONS.map(async (relation) => {
          const [result] = await client<{ relation: string | null }[]>`
            select to_regclass(${`public.${relation}`})::text as relation
          `;
          return { relation, exists: Boolean(result?.relation) };
        }),
      );
      const missing = checks.filter(({ exists }) => !exists).map(({ relation }) => relation);
      if (missing.length > 0) {
        throw new Error(`Database schema is not ready; missing relations: ${missing.join(', ')}`);
      }
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
