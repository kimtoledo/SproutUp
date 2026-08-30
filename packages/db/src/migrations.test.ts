import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { permissionKeys, roleKeys } from '@sproutup/shared';
import { seedAuthorization } from './seed-authorization.js';
import type { Database } from './database.js';
import * as schema from './schema/index.js';

const database = new PGlite();

beforeAll(async () => {
  for (const migration of [
    '0000_yielding_zombie.sql',
    '0001_audit-immutability.sql',
    '0002_little_union_jack.sql',
    '0003_approval-actions-immutability.sql',
    '0004_perpetual_mikhail_rasputin.sql',
    '0005_lowly_shadow_king.sql',
    '0006_onboarding-events-immutability.sql',
    '0007_narrow_wolfsbane.sql',
    '0008_applicant-role-bootstrap.sql',
    '0009_moaning_argent.sql',
    '0010_job-attempt-evidence.sql',
    '0011_wide_nemesis.sql',
    '0012_ledger-invariants.sql',
    '0013_robust_corsair.sql',
    '0014_consent-evidence-invariants.sql',
    '0015_wise_lockjaw.sql',
    '0016_config-rule-immutability.sql',
    '0017_salty_molten_man.sql',
    '0018_document-version-immutability.sql',
    '0019_faithful_siren.sql',
    '0020_portal-identity-isolation.sql',
    '0021_backfill-portal-identities.sql',
    '0022_mean_toad_men.sql',
    '0023_real_daredevil.sql',
    '0024_customer-auth-cutover.sql',
  ]) {
    const sql = await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8');
    await database.exec(sql.replaceAll('--> statement-breakpoint', ''));
  }
});

afterAll(async () => {
  await database.close();
});

describe('initial authentication migration', () => {
  it('creates every identity, RBAC, rate-limit, and audit table', async () => {
    const result = await database.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);

    expect(result.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'accounts',
        'account_email_registry',
        'admin_accounts',
        'admin_credentials',
        'admin_rate_limits',
        'admin_role_grants',
        'admin_sessions',
        'admin_verifications',
        'approval_actions',
        'approval_requests',
        'audit_events',
        'background_job_attempts',
        'background_jobs',
        'borrower_accounts',
        'borrower_credentials',
        'borrower_rate_limits',
        'borrower_sessions',
        'borrower_verifications',
        'consent_acceptances',
        'consent_documents',
        'ledger_accounts',
        'ledger_entries',
        'ledger_transactions',
        'investor_accounts',
        'investor_credentials',
        'investor_rate_limits',
        'investor_sessions',
        'investor_verifications',
        'onboarding_case_events',
        'onboarding_cases',
        'permissions',
        'rate_limits',
        'role_permissions',
        'roles',
        'sessions',
        'user_roles',
        'users',
        'verifications',
      ]),
    );
  });

  it('isolates portal credentials and enforces one immutable global email identity', async () => {
    const adminId = '00000000-0000-4000-8000-00000000a101';
    const borrowerId = '00000000-0000-4000-8000-00000000b101';
    const investorId = '00000000-0000-4000-8000-00000000c101';
    await database.query(
      `insert into admin_accounts (id, name, email)
       values ($1, 'Portal Admin', 'portal-admin@sproutup.ph')`,
      [adminId],
    );
    await database.query(
      `insert into borrower_accounts (id, name, email)
       values ($1, 'Portal Borrower', 'portal-borrower@sproutup.ph')`,
      [borrowerId],
    );
    await database.query(
      `insert into investor_accounts (id, name, email)
       values ($1, 'Portal Investor', 'portal-investor@sproutup.ph')`,
      [investorId],
    );

    const registry = await database.query<{
      email: string;
      account_type: string;
      account_id: string;
    }>(
      `select email, account_type, account_id::text
       from account_email_registry
       where account_id in ($1, $2, $3)
       order by account_type`,
      [adminId, borrowerId, investorId],
    );
    expect(registry.rows).toEqual([
      { email: 'portal-admin@sproutup.ph', account_type: 'admin', account_id: adminId },
      { email: 'portal-borrower@sproutup.ph', account_type: 'borrower', account_id: borrowerId },
      { email: 'portal-investor@sproutup.ph', account_type: 'investor', account_id: investorId },
    ]);

    await expect(database.query(
      `insert into borrower_accounts (name, email)
       values ('Cross Portal Attempt', 'portal-admin@sproutup.ph')`,
    )).rejects.toThrow();
    await expect(database.query(
      `insert into investor_accounts (id, name, email)
       values ($1, 'Reused Identity', 'different-investor@sproutup.ph')`,
      [adminId],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into investor_accounts (name, email)
       values ('Unnormalized', 'UPPER@sproutup.ph')`,
    )).rejects.toThrow();

    await database.query(
      `insert into admin_credentials
        (provider_account_id, provider_id, admin_account_id, password)
       values ('portal-admin@sproutup.ph', 'credential', $1, 'opaque-admin-hash')`,
      [adminId],
    );
    await database.query(
      `insert into borrower_credentials
        (provider_account_id, provider_id, borrower_account_id, password)
       values ('portal-borrower@sproutup.ph', 'credential', $1, 'opaque-borrower-hash')`,
      [borrowerId],
    );
    const credentialCounts = await database.query<{ admins: number; borrowers: number }>(
      `select
        (select count(*)::int from admin_credentials) as admins,
        (select count(*)::int from borrower_credentials) as borrowers`,
    );
    expect(credentialCounts.rows[0]).toEqual({ admins: 1, borrowers: 1 });

    await database.query(
      `update borrower_accounts set status = 'suspended' where id = $1`,
      [borrowerId],
    );
    await expect(database.query(
      `update borrower_accounts set email = 'changed@sproutup.ph' where id = $1`,
      [borrowerId],
    )).rejects.toThrow('borrower account id and email are immutable');
    await expect(database.query(
      'delete from investor_accounts where id = $1',
      [investorId],
    )).rejects.toThrow('investor accounts cannot be deleted');
    await expect(database.exec('truncate table admin_accounts cascade')).rejects.toThrow(
      'portal account tables cannot be truncated',
    );
    await expect(database.exec('truncate table account_email_registry cascade')).rejects.toThrow(
      'account_email_registry cannot be truncated',
    );
  });

  it('anchors customer ownership to the registry and enforces the onboarding account class', async () => {
    const borrowerId = '00000000-0000-4000-8000-00000000b102';
    const investorId = '00000000-0000-4000-8000-00000000c102';
    const adminId = '00000000-0000-4000-8000-00000000a102';
    await database.query(
      `insert into borrower_accounts (id, name, email)
       values ($1, 'Ownership Borrower', 'ownership-borrower@sproutup.ph')`,
      [borrowerId],
    );
    await database.query(
      `insert into investor_accounts (id, name, email)
       values ($1, 'Ownership Investor', 'ownership-investor@sproutup.ph')`,
      [investorId],
    );
    await database.query(
      `insert into admin_accounts (id, name, email)
       values ($1, 'Ownership Admin', 'ownership-admin@sproutup.ph')`,
      [adminId],
    );

    const borrowerCase = await database.query<{ id: string }>(
      `insert into onboarding_cases (case_type, applicant_user_id)
       values ('borrower', $1) returning id::text`,
      [borrowerId],
    );
    await database.query(
      `insert into onboarding_case_events
        (case_id, case_version, event_type, to_status, actor_type, actor_user_id)
       values ($1, 1, 'created', 'draft', 'user', $2)`,
      [borrowerCase.rows[0]?.id, borrowerId],
    );
    await database.query(
      `insert into onboarding_cases (case_type, applicant_user_id)
       values ('investor', $1)`,
      [investorId],
    );

    await expect(database.query(
      `insert into onboarding_cases (case_type, applicant_user_id)
       values ('investor', $1)`,
      [borrowerId],
    )).rejects.toThrow('onboarding case type must match borrower or investor account class');
    await expect(database.query(
      `insert into onboarding_cases (case_type, applicant_user_id)
       values ('borrower', $1)`,
      [adminId],
    )).rejects.toThrow('onboarding case type must match borrower or investor account class');
    await expect(database.query(
      `insert into documents (owner_user_id, classification, purpose)
       values ('00000000-0000-4000-8000-00000000ffff', 'kyc_identity', 'unknown')`,
    )).rejects.toThrow();
  });

  it('enforces exact balanced append-only ledger postings at transaction commit', async () => {
    const debitAccountId = '00000000-0000-4000-8000-000000000020';
    const creditAccountId = '00000000-0000-4000-8000-000000000021';
    const transactionId = '00000000-0000-4000-8000-000000000022';
    await database.query(
      `insert into ledger_accounts (id, code, name, normal_balance)
       values
         ($1, 'test.asset', 'Test Asset', 'debit'),
         ($2, 'test.liability', 'Test Liability', 'credit')`,
      [debitAccountId, creditAccountId],
    );
    await database.exec(`
      begin;
      insert into ledger_transactions
        (id, idempotency_key, payload_hash, source_type, source_id, description, effective_at)
      values
        ('${transactionId}', 'ledger:test:balanced', repeat('a', 64), 'test', 'balanced',
         'Balanced migration test', now());
      insert into ledger_entries
        (transaction_id, line_number, account_id, direction, amount)
      values
        ('${transactionId}', 1, '${debitAccountId}', 'debit', 100.01),
        ('${transactionId}', 2, '${creditAccountId}', 'credit', 100.01);
      commit;
    `);

    const totals = await database.query<{ debit: string; credit: string }>(
      `select
        sum(amount) filter (where direction = 'debit')::text as debit,
        sum(amount) filter (where direction = 'credit')::text as credit
       from ledger_entries where transaction_id = $1`,
      [transactionId],
    );
    expect(totals.rows[0]).toEqual({ debit: '100.01', credit: '100.01' });
    await expect(
      database.query(
        `update ledger_entries set amount = 99.99
         where transaction_id = $1 and line_number = 1`,
        [transactionId],
      ),
    ).rejects.toThrow('ledger_entries is append-only');
    await expect(
      database.query('delete from ledger_transactions where id = $1', [transactionId]),
    ).rejects.toThrow('ledger_transactions is append-only');
    await expect(database.exec('truncate table ledger_entries')).rejects.toThrow(
      'ledger_entries is append-only and cannot be truncated',
    );
    await expect(
      database.query(
        `update ledger_accounts set code = 'changed' where id = $1`,
        [debitAccountId],
      ),
    ).rejects.toThrow('ledger account code, normal balance, and currency are immutable');
    await database.query(
      `update ledger_accounts set name = 'Renamed Test Asset', is_active = false where id = $1`,
      [debitAccountId],
    );

    await expect(database.exec(`
      begin;
      insert into ledger_transactions
        (idempotency_key, payload_hash, source_type, source_id, description, effective_at)
      values
        ('ledger:test:unbalanced', repeat('b', 64), 'test', 'unbalanced',
         'Unbalanced migration test', now());
      insert into ledger_entries
        (transaction_id, line_number, account_id, direction, amount)
      select id, 1, '${debitAccountId}', 'debit', 10.00
      from ledger_transactions where idempotency_key = 'ledger:test:unbalanced';
      insert into ledger_entries
        (transaction_id, line_number, account_id, direction, amount)
      select id, 2, '${creditAccountId}', 'credit', 9.99
      from ledger_transactions where idempotency_key = 'ledger:test:unbalanced';
      commit;
    `)).rejects.toThrow('is not balanced');

    await expect(database.exec(`
      begin;
      insert into ledger_transactions
        (idempotency_key, payload_hash, source_type, source_id, description, effective_at)
      values
        ('ledger:test:empty', repeat('c', 64), 'test', 'empty',
         'Empty migration test', now());
      commit;
    `)).rejects.toThrow('requires at least two entries');
  });

  it('preserves immutable versioned consent documents and exact acceptance hashes', async () => {
    const userId = '00000000-0000-4000-8000-000000000c01';
    const documentId = '00000000-0000-4000-8000-000000000c02';
    const acceptanceId = '00000000-0000-4000-8000-000000000c03';
    await database.query(
      `insert into users (id, name, email)
       values ($1, 'Consent User', 'consent-migration@sproutup.ph')`,
      [userId],
    );
    await database.query(
      `insert into borrower_accounts (id, name, email)
       values ($1, 'Consent User', 'consent-migration@sproutup.ph')`,
      [userId],
    );
    await database.query(
      `insert into consent_documents
        (id, document_key, version, title, content, content_sha256, effective_at, published_at)
       values ($1, 'pilot.terms', 1, 'Pilot Terms', 'Exact immutable terms', repeat('a', 64), now(), now())`,
      [documentId],
    );
    await database.query(
      `insert into consent_acceptances
        (id, user_id, consent_document_id, accepted_content_sha256)
       values ($1, $2, $3, repeat('a', 64))`,
      [acceptanceId, userId, documentId],
    );

    await expect(database.query(
      `insert into consent_acceptances
        (user_id, consent_document_id, accepted_content_sha256)
       values ($1, $2, repeat('b', 64))`,
      [userId, documentId],
    )).rejects.toThrow('consent acceptance content hash does not match its immutable document');
    await expect(database.query(
      'update consent_documents set title = $1 where id = $2',
      ['Changed Terms', documentId],
    )).rejects.toThrow('consent_documents is append-only');
    await expect(database.query(
      'delete from consent_acceptances where id = $1',
      [acceptanceId],
    )).rejects.toThrow('consent_acceptances is append-only');
    await expect(database.exec('truncate table consent_documents cascade')).rejects.toThrow(
      'consent_documents is append-only',
    );
  });

  it('enforces durable job idempotency, lease, retry, and attempt invariants', async () => {
    const jobId = '00000000-0000-4000-8000-000000000010';
    const attemptId = '00000000-0000-4000-8000-000000000011';
    await database.query(
      `insert into background_jobs
        (id, topic, payload, idempotency_key, status, attempt_count, lease_owner, lease_expires_at)
       values ($1, 'pilot.test', '{"caseId":"opaque"}', 'pilot:test:1', 'processing', 1,
         'worker-test-1', now() + interval '1 minute')`,
      [jobId],
    );
    await database.query(
      `insert into background_job_attempts
        (id, job_id, attempt_number, worker_id, lease_expires_at)
       values ($1, $2, 1, 'worker-test-1', now() + interval '1 minute')`,
      [attemptId, jobId],
    );

    await expect(
      database.query(
        `insert into background_jobs (topic, payload, idempotency_key)
         values ('pilot.test', '{}', 'pilot:test:1')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into background_jobs (topic, payload, idempotency_key, status)
         values ('pilot.test', '{}', 'pilot:test:no-lease', 'processing')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into background_jobs (topic, payload, idempotency_key, attempt_count, max_attempts)
         values ('pilot.test', '{}', 'pilot:test:attempt-overflow', 2, 1)`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into background_job_attempts
          (job_id, attempt_number, worker_id, lease_expires_at)
         values ($1, 1, 'worker-test-2', now() + interval '1 minute')`,
        [jobId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `update background_job_attempts set outcome = 'succeeded' where id = $1`,
        [attemptId],
      ),
    ).rejects.toThrow();
    await database.query(
      `update background_job_attempts
       set outcome = 'succeeded', finished_at = now()
       where id = $1`,
      [attemptId],
    );
    await expect(
      database.query(
        `update background_job_attempts set error_code = 'CHANGED' where id = $1`,
        [attemptId],
      ),
    ).rejects.toThrow('completed background_job_attempts evidence is immutable');
    await expect(
      database.query('delete from background_job_attempts where id = $1', [attemptId]),
    ).rejects.toThrow('background_job_attempts evidence cannot be deleted');
    await expect(database.exec('truncate table background_job_attempts')).rejects.toThrow(
      'background_job_attempts evidence cannot be truncated',
    );
  });

  it('enforces onboarding workflow uniqueness, reviewer separation, and immutable events', async () => {
    const applicantId = '00000000-0000-4000-8000-000000000005';
    const caseId = '00000000-0000-4000-8000-000000000006';
    const eventId = '00000000-0000-4000-8000-000000000007';
    await database.query(
      `insert into users (id, name, email) values ($1, 'Applicant', 'onboarding-migration@sproutup.ph')`,
      [applicantId],
    );
    await database.query(
      `insert into borrower_accounts (id, name, email)
       values ($1, 'Applicant', 'onboarding-migration@sproutup.ph')`,
      [applicantId],
    );
    await database.query(
      `insert into onboarding_cases (id, case_type, applicant_user_id)
       values ($1, 'borrower', $2)`,
      [caseId, applicantId],
    );
    await database.query(
      `insert into onboarding_case_events
        (id, case_id, event_type, to_status, case_version, actor_type, actor_user_id)
       values ($1, $2, 'created', 'draft', 1, 'user', $3)`,
      [eventId, caseId, applicantId],
    );

    await expect(
      database.query(
        `insert into onboarding_cases (case_type, applicant_user_id)
         values ('borrower', $1)`,
        [applicantId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into onboarding_cases
          (case_type, applicant_user_id, assigned_reviewer_user_id)
         values ('investor', $1, $1)`,
        [applicantId],
      ),
    ).rejects.toThrow();
    await expect(
      database.query('update onboarding_case_events set reason = $1 where id = $2', ['changed', eventId]),
    ).rejects.toThrow('onboarding_case_events is append-only');
    await expect(
      database.query('delete from onboarding_case_events where id = $1', [eventId]),
    ).rejects.toThrow('onboarding_case_events is append-only');
    await expect(database.exec('truncate table onboarding_case_events')).rejects.toThrow(
      'onboarding_case_events is append-only',
    );
  });

  it('enforces append-only approval actions in PostgreSQL', async () => {
    const userId = '00000000-0000-4000-8000-000000000002';
    const requestId = '00000000-0000-4000-8000-000000000003';
    const actionId = '00000000-0000-4000-8000-000000000004';
    await database.query(
      `insert into admin_accounts (id, name, email)
       values ($1, 'Maker', 'maker-migration@sproutup.ph')`,
      [userId],
    );
    await database.query(
      `insert into approval_requests
        (id, command_type, payload, payload_hash, maker_user_id, reason, expires_at)
       values ($1, 'role.assign', '{}', repeat('a', 64), $2, 'Migration invariant test', now() + interval '1 hour')`,
      [requestId, userId],
    );
    await database.query(
      `insert into approval_actions
        (id, request_id, action, actor_user_id, payload_hash)
       values ($1, $2, 'proposed', $3, repeat('a', 64))`,
      [actionId, requestId, userId],
    );

    await expect(
      database.query('update approval_actions set reason = $1 where id = $2', ['changed', actionId]),
    ).rejects.toThrow('approval_actions is append-only');
    await expect(database.query('delete from approval_actions where id = $1', [actionId])).rejects.toThrow(
      'approval_actions is append-only',
    );
    await expect(database.exec('truncate table approval_actions')).rejects.toThrow(
      'approval_actions is append-only',
    );
  });

  it('enforces append-only audit events in PostgreSQL', async () => {
    const auditId = '00000000-0000-4000-8000-000000000001';
    await database.query(
      `insert into audit_events
        (id, actor_type, action, outcome, resource_type)
       values ($1, 'system', 'platform.started', 'succeeded', 'platform')`,
      [auditId],
    );

    await expect(
      database.query('update audit_events set reason = $1 where id = $2', ['changed', auditId]),
    ).rejects.toThrow('audit_events is append-only');
    await expect(database.query('delete from audit_events where id = $1', [auditId])).rejects.toThrow(
      'audit_events is append-only',
    );
    await expect(database.exec('truncate table audit_events')).rejects.toThrow(
      'audit_events is append-only',
    );
  });

  it('idempotently seeds the approved roles and auth-domain grants', async () => {
    const orm = drizzle(database, { schema });
    await seedAuthorization(orm as unknown as Database);
    await seedAuthorization(orm as unknown as Database);

    const roleCount = await database.query<{ count: number }>('select count(*)::int as count from roles');
    const permissionCount = await database.query<{ count: number }>(
      'select count(*)::int as count from permissions',
    );
    const superAdminGrantCount = await database.query<{ count: number }>(
      `select count(*)::int as count
       from role_permissions
       where role_key = 'super_admin'`,
    );

    expect(roleCount.rows[0]?.count).toBe(roleKeys.length);
    expect(permissionCount.rows[0]?.count).toBe(permissionKeys.length);
    expect(superAdminGrantCount.rows[0]?.count).toBe(permissionKeys.length);
  });

  it('retires unified customer registration and authentication material', async () => {
    await expect(database.query(
      `insert into users (name, email, registration_intent)
       values ('Legacy Borrower', 'legacy-borrower@sproutup.ph', 'borrower')`,
    )).rejects.toThrow('customer registration belongs in a portal account namespace');
    await expect(database.query(
      `insert into accounts (account_id, provider_id, user_id)
       values ('retired', 'credential', '00000000-0000-4000-8000-000000000008')`,
    )).rejects.toThrow('legacy unified authentication namespace is retired');
    const legacyCounts = await database.query<{
      credentials: number;
      sessions: number;
      grants: number;
    }>(`select
      (select count(*)::int from accounts) credentials,
      (select count(*)::int from sessions) sessions,
      (select count(*)::int from user_roles) grants`);
    expect(legacyCounts.rows[0]).toEqual({ credentials: 0, sessions: 0, grants: 0 });
  });
});

describe('effective-dated configuration migration', () => {
  it('creates the rule catalogue and version relations', async () => {
    const relations = await database.query<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('rule_sets', 'rule_versions')
      order by table_name
    `);
    expect(relations.rows.map((r) => r.table_name)).toEqual(['rule_sets', 'rule_versions']);
  });

  it('rejects a non-object rule body and a non-positive version', async () => {
    await database.query(
      `insert into rule_sets (key, description) values ('test.bad_body', 'invariant test')`,
    );
    await expect(
      database.query(
        `insert into rule_versions (rule_key, version, effective_from, body)
         values ('test.bad_body', 1, now(), '[1,2,3]'::jsonb)`,
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into rule_versions (rule_key, version, effective_from, body)
         values ('test.bad_body', 0, now(), '{}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it('keeps published rule versions immutable', async () => {
    await database.query(
      `insert into rule_sets (key, description) values ('test.immutable', 'invariant test')`,
    );
    const inserted = await database.query<{ id: string }>(
      `insert into rule_versions (rule_key, version, effective_from, body)
       values ('test.immutable', 1, now(), '{"rate":"0.12"}'::jsonb)
       returning id::text`,
    );
    const versionId = inserted.rows[0]?.id;
    await expect(
      database.query(`update rule_versions set body = '{"rate":"0.99"}'::jsonb where id = $1`, [
        versionId,
      ]),
    ).rejects.toThrow('rule_versions is append-only');
    await expect(
      database.query('delete from rule_versions where id = $1', [versionId]),
    ).rejects.toThrow('rule_versions is append-only');
    await expect(database.exec('truncate table rule_versions')).rejects.toThrow(
      'rule_versions is append-only',
    );
  });

  it('permits a rule_sets description edit but not key deletion', async () => {
    await database.query(
      `insert into rule_sets (key, description) values ('test.catalogue', 'first wording')`,
    );
    await database.query(
      `update rule_sets set description = 'clearer wording' where key = 'test.catalogue'`,
    );
    const row = await database.query<{ description: string }>(
      `select description from rule_sets where key = 'test.catalogue'`,
    );
    expect(row.rows[0]?.description).toBe('clearer wording');
    await expect(
      database.query(`delete from rule_sets where key = 'test.catalogue'`),
    ).rejects.toThrow('rule_sets keys are permanent');
    await expect(
      database.query(`update rule_sets set key = 'test.renamed' where key = 'test.catalogue'`),
    ).rejects.toThrow('immutable');
  });

  it('forbids two versions of one key at the same effective instant', async () => {
    await database.query(
      `insert into rule_sets (key, description) values ('test.effective', 'invariant test')`,
    );
    await database.query(
      `insert into rule_versions (rule_key, version, effective_from, body)
       values ('test.effective', 1, '2026-09-01T00:00:00Z', '{}'::jsonb)`,
    );
    await expect(
      database.query(
        `insert into rule_versions (rule_key, version, effective_from, body)
         values ('test.effective', 2, '2026-09-01T00:00:00Z', '{}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });
});

describe('private document store migration', () => {
  const owner = '00000000-0000-4000-8000-0000000b0001';

  it('creates the document relations', async () => {
    await database.query(
      `insert into users (id, name, email) values ($1, 'Doc Owner', 'doc-migration@sproutup.ph')`,
      [owner],
    );
    await database.query(
      `insert into borrower_accounts (id, name, email)
       values ($1, 'Doc Owner', 'doc-migration@sproutup.ph')`,
      [owner],
    );
    const relations = await database.query<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('documents', 'document_versions')
      order by table_name
    `);
    expect(relations.rows.map((r) => r.table_name)).toEqual(['document_versions', 'documents']);
  });

  it('protects version evidence but allows the scan outcome to be recorded once', async () => {
    const doc = await database.query<{ id: string }>(
      `insert into documents (owner_user_id, classification, purpose)
       values ($1, 'kyc_business', 'borrower.sec_registration') returning id::text`,
      [owner],
    );
    const documentId = doc.rows[0].id;
    const version = await database.query<{ id: string }>(
      `insert into document_versions
        (document_id, version, storage_key, content_sha256, byte_size, content_type, original_filename, uploaded_by_user_id)
       values ($1, 1, 'key-001', repeat('a', 64), 12, 'application/pdf', 'sec.pdf', $2)
       returning id::text`,
      [documentId, owner],
    );
    const versionId = version.rows[0].id;

    await expect(
      database.query(`update document_versions set storage_key = 'moved' where id = $1`, [versionId]),
    ).rejects.toThrow(/immutable/);
    await expect(
      database.query(`delete from document_versions where id = $1`, [versionId]),
    ).rejects.toThrow(/cannot be deleted/);
    await expect(database.exec('truncate table document_versions')).rejects.toThrow(
      'document_versions is append-only',
    );

    // The scan outcome and its timestamp may be set.
    await database.query(
      `update document_versions set scan_state = 'clean', scanned_at = now() where id = $1`,
      [versionId],
    );
    const row = await database.query<{ scan_state: string }>(
      `select scan_state from document_versions where id = $1`,
      [versionId],
    );
    expect(row.rows[0].scan_state).toBe('clean');
  });

  it('rejects a zero byte size and a resolved scan state with no timestamp', async () => {
    const doc = await database.query<{ id: string }>(
      `insert into documents (owner_user_id, classification, purpose)
       values ($1, 'financial', 'borrower.financials') returning id::text`,
      [owner],
    );
    const documentId = doc.rows[0].id;
    await expect(
      database.query(
        `insert into document_versions
          (document_id, version, storage_key, content_sha256, byte_size, content_type, original_filename, uploaded_by_user_id)
         values ($1, 1, 'key-002', repeat('a', 64), 0, 'application/pdf', 'x.pdf', $2)`,
        [documentId, owner],
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into document_versions
          (document_id, version, storage_key, content_sha256, byte_size, content_type, original_filename, uploaded_by_user_id, scan_state)
         values ($1, 1, 'key-003', repeat('a', 64), 5, 'application/pdf', 'x.pdf', $2, 'clean')`,
        [documentId, owner],
      ),
    ).rejects.toThrow();
  });
});
