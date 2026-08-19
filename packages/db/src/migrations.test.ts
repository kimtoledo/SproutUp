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
        'approval_actions',
        'approval_requests',
        'audit_events',
        'background_job_attempts',
        'background_jobs',
        'ledger_accounts',
        'ledger_entries',
        'ledger_transactions',
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
      `insert into users (id, name, email) values ($1, 'Maker', 'maker-migration@sproutup.ph')`,
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

  it('atomically bootstraps only the self-selected customer role and registration audit', async () => {
    const borrowerId = '00000000-0000-4000-8000-000000000008';
    const investorId = '00000000-0000-4000-8000-000000000009';
    await database.query(
      `insert into users (id, name, email, registration_intent)
       values
         ($1, 'Borrower Applicant', 'bootstrap-borrower@sproutup.ph', 'borrower'),
         ($2, 'Investor Applicant', 'bootstrap-investor@sproutup.ph', 'investor')`,
      [borrowerId, investorId],
    );

    const grants = await database.query<{ user_id: string; role_key: string }>(
      `select user_id::text, role_key from user_roles
       where user_id in ($1, $2)
       order by user_id`,
      [borrowerId, investorId],
    );
    const audits = await database.query<{ actor_user_id: string; action: string }>(
      `select actor_user_id::text, action from audit_events
       where actor_user_id in ($1, $2)
       order by actor_user_id`,
      [borrowerId, investorId],
    );

    expect(grants.rows).toEqual([
      { user_id: borrowerId, role_key: 'sme_borrower' },
      { user_id: investorId, role_key: 'investor' },
    ]);
    expect(audits.rows).toEqual([
      { actor_user_id: borrowerId, action: 'account.registered' },
      { actor_user_id: investorId, action: 'account.registered' },
    ]);
  });
});
