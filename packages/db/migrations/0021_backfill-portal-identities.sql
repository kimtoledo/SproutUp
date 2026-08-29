DO $$
DECLARE
  unsafe_count integer;
  target_count integer;
BEGIN
  SELECT count(*)::integer
  INTO unsafe_count
  FROM users u
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.key = ur.role_key
    WHERE ur.user_id = u.id AND r.category = 'staff'
  )
  AND (
    (
      EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'sme_borrower')
      AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'investor')
    )
    OR (
      NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'sme_borrower')
      AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'investor')
    )
  );

  IF unsafe_count > 0 THEN
    RAISE EXCEPTION
      'portal identity backfill refused: % ambiguous or unclassified users; run db:report-identity-cutover',
      unsafe_count;
  END IF;

  SELECT
    (SELECT count(*) FROM admin_accounts)
    + (SELECT count(*) FROM borrower_accounts)
    + (SELECT count(*) FROM investor_accounts)
  INTO target_count;

  IF target_count > 0 THEN
    RAISE EXCEPTION
      'portal identity backfill refused: target account tables are not empty (% rows)',
      target_count;
  END IF;
END;
$$;--> statement-breakpoint

INSERT INTO admin_accounts
  (id, name, email, email_verified, image, status, created_at, updated_at)
SELECT u.id, u.name, u.email, u.email_verified, u.image, u.status, u.created_at, u.updated_at
FROM users u
WHERE EXISTS (
  SELECT 1
  FROM user_roles ur
  JOIN roles r ON r.key = ur.role_key
  WHERE ur.user_id = u.id AND r.category = 'staff'
);--> statement-breakpoint

INSERT INTO borrower_accounts
  (id, name, email, email_verified, image, status, created_at, updated_at)
SELECT u.id, u.name, u.email, u.email_verified, u.image, u.status, u.created_at, u.updated_at
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_roles ur
  JOIN roles r ON r.key = ur.role_key
  WHERE ur.user_id = u.id AND r.category = 'staff'
)
AND EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'sme_borrower'
)
AND NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'investor'
);--> statement-breakpoint

INSERT INTO investor_accounts
  (id, name, email, email_verified, image, status, created_at, updated_at)
SELECT u.id, u.name, u.email, u.email_verified, u.image, u.status, u.created_at, u.updated_at
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_roles ur
  JOIN roles r ON r.key = ur.role_key
  WHERE ur.user_id = u.id AND r.category = 'staff'
)
AND EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'investor'
)
AND NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_key = 'sme_borrower'
);--> statement-breakpoint

INSERT INTO admin_credentials
  (id, provider_account_id, provider_id, admin_account_id, access_token, refresh_token, id_token,
   access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at)
SELECT a.id, a.account_id, a.provider_id, a.user_id, a.access_token, a.refresh_token, a.id_token,
       a.access_token_expires_at, a.refresh_token_expires_at, a.scope, a.password,
       a.created_at, a.updated_at
FROM accounts a
JOIN admin_accounts target ON target.id = a.user_id;--> statement-breakpoint

INSERT INTO borrower_credentials
  (id, provider_account_id, provider_id, borrower_account_id, access_token, refresh_token, id_token,
   access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at)
SELECT a.id, a.account_id, a.provider_id, a.user_id, a.access_token, a.refresh_token, a.id_token,
       a.access_token_expires_at, a.refresh_token_expires_at, a.scope, a.password,
       a.created_at, a.updated_at
FROM accounts a
JOIN borrower_accounts target ON target.id = a.user_id;--> statement-breakpoint

INSERT INTO investor_credentials
  (id, provider_account_id, provider_id, investor_account_id, access_token, refresh_token, id_token,
   access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at)
SELECT a.id, a.account_id, a.provider_id, a.user_id, a.access_token, a.refresh_token, a.id_token,
       a.access_token_expires_at, a.refresh_token_expires_at, a.scope, a.password,
       a.created_at, a.updated_at
FROM accounts a
JOIN investor_accounts target ON target.id = a.user_id;--> statement-breakpoint

INSERT INTO admin_sessions
  (id, token, expires_at, ip_address, user_agent, admin_account_id, created_at, updated_at)
SELECT s.id, s.token, s.expires_at, s.ip_address, s.user_agent, s.user_id, s.created_at, s.updated_at
FROM sessions s
JOIN admin_accounts target ON target.id = s.user_id;--> statement-breakpoint

INSERT INTO borrower_sessions
  (id, token, expires_at, ip_address, user_agent, borrower_account_id, created_at, updated_at)
SELECT s.id, s.token, s.expires_at, s.ip_address, s.user_agent, s.user_id, s.created_at, s.updated_at
FROM sessions s
JOIN borrower_accounts target ON target.id = s.user_id;--> statement-breakpoint

INSERT INTO investor_sessions
  (id, token, expires_at, ip_address, user_agent, investor_account_id, created_at, updated_at)
SELECT s.id, s.token, s.expires_at, s.ip_address, s.user_agent, s.user_id, s.created_at, s.updated_at
FROM sessions s
JOIN investor_accounts target ON target.id = s.user_id;--> statement-breakpoint

DO $$
DECLARE
  legacy_users integer;
  migrated_users integer;
  legacy_credentials integer;
  migrated_credentials integer;
  legacy_sessions integer;
  migrated_sessions integer;
BEGIN
  SELECT count(*)::integer INTO legacy_users FROM users;
  SELECT
    (SELECT count(*) FROM admin_accounts)
    + (SELECT count(*) FROM borrower_accounts)
    + (SELECT count(*) FROM investor_accounts)
  INTO migrated_users;
  SELECT count(*)::integer INTO legacy_credentials FROM accounts;
  SELECT
    (SELECT count(*) FROM admin_credentials)
    + (SELECT count(*) FROM borrower_credentials)
    + (SELECT count(*) FROM investor_credentials)
  INTO migrated_credentials;
  SELECT count(*)::integer INTO legacy_sessions FROM sessions;
  SELECT
    (SELECT count(*) FROM admin_sessions)
    + (SELECT count(*) FROM borrower_sessions)
    + (SELECT count(*) FROM investor_sessions)
  INTO migrated_sessions;

  IF legacy_users <> migrated_users
    OR legacy_credentials <> migrated_credentials
    OR legacy_sessions <> migrated_sessions THEN
    RAISE EXCEPTION
      'portal identity reconciliation failed: users %/%, credentials %/%, sessions %/%',
      legacy_users, migrated_users,
      legacy_credentials, migrated_credentials,
      legacy_sessions, migrated_sessions;
  END IF;

  INSERT INTO audit_events
    (actor_type, action, outcome, resource_type, reason, metadata)
  VALUES (
    'system',
    'identity.portal_backfill_completed',
    'succeeded',
    'identity_cutover',
    'Forward-only portal identity backfill completed with exact count reconciliation',
    jsonb_build_object(
      'users', migrated_users,
      'credentials', migrated_credentials,
      'sessions', migrated_sessions,
      'verificationsInvalidated', (SELECT count(*) FROM verifications),
      'rateLimitsInvalidated', (SELECT count(*) FROM rate_limits)
    )
  );
END;
$$;
