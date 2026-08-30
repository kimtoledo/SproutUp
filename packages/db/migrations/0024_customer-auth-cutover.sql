DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users legacy
    LEFT JOIN admin_accounts admin ON admin.id = legacy.id
    WHERE admin.id IS NULL
      AND (
        EXISTS (SELECT 1 FROM user_roles grant_row WHERE grant_row.user_id = legacy.id)
        OR EXISTS (SELECT 1 FROM accounts credential WHERE credential.user_id = legacy.id)
        OR EXISTS (SELECT 1 FROM sessions session_row WHERE session_row.user_id = legacy.id)
      )
      AND (
        (SELECT count(*) FROM user_roles grant_row
         WHERE grant_row.user_id = legacy.id
           AND grant_row.role_key IN ('sme_borrower', 'investor')) <> 1
        OR (SELECT count(*) FROM user_roles grant_row WHERE grant_row.user_id = legacy.id) <> 1
      )
  ) THEN
    RAISE EXCEPTION 'customer auth cutover aborted: legacy customer identity is ambiguous';
  END IF;
END;
$$;
--> statement-breakpoint
INSERT INTO borrower_accounts (
  id, name, email, email_verified, image, status, created_at, updated_at
)
SELECT legacy.id, legacy.name, lower(btrim(legacy.email)), legacy.email_verified,
  legacy.image, legacy.status, legacy.created_at, legacy.updated_at
FROM users legacy
JOIN user_roles grant_row
  ON grant_row.user_id = legacy.id AND grant_row.role_key = 'sme_borrower'
LEFT JOIN borrower_accounts target ON target.id = legacy.id
WHERE target.id IS NULL;
--> statement-breakpoint
INSERT INTO investor_accounts (
  id, name, email, email_verified, image, status, created_at, updated_at
)
SELECT legacy.id, legacy.name, lower(btrim(legacy.email)), legacy.email_verified,
  legacy.image, legacy.status, legacy.created_at, legacy.updated_at
FROM users legacy
JOIN user_roles grant_row
  ON grant_row.user_id = legacy.id AND grant_row.role_key = 'investor'
LEFT JOIN investor_accounts target ON target.id = legacy.id
WHERE target.id IS NULL;
--> statement-breakpoint
INSERT INTO borrower_credentials (
  id, provider_account_id, provider_id, access_token, refresh_token, id_token,
  access_token_expires_at, refresh_token_expires_at, scope, password,
  created_at, updated_at, borrower_account_id
)
SELECT credential.id, credential.account_id, credential.provider_id,
  credential.access_token, credential.refresh_token, credential.id_token,
  credential.access_token_expires_at, credential.refresh_token_expires_at,
  credential.scope, credential.password, credential.created_at, credential.updated_at,
  credential.user_id
FROM accounts credential
JOIN borrower_accounts borrower ON borrower.id = credential.user_id
LEFT JOIN borrower_credentials target ON target.id = credential.id
WHERE target.id IS NULL;
--> statement-breakpoint
INSERT INTO investor_credentials (
  id, provider_account_id, provider_id, access_token, refresh_token, id_token,
  access_token_expires_at, refresh_token_expires_at, scope, password,
  created_at, updated_at, investor_account_id
)
SELECT credential.id, credential.account_id, credential.provider_id,
  credential.access_token, credential.refresh_token, credential.id_token,
  credential.access_token_expires_at, credential.refresh_token_expires_at,
  credential.scope, credential.password, credential.created_at, credential.updated_at,
  credential.user_id
FROM accounts credential
JOIN investor_accounts investor ON investor.id = credential.user_id
LEFT JOIN investor_credentials target ON target.id = credential.id
WHERE target.id IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_roles grant_row
    JOIN users legacy ON legacy.id = grant_row.user_id
    JOIN account_email_registry registry ON registry.account_id = legacy.id
    WHERE (grant_row.role_key = 'sme_borrower' AND registry.account_type <> 'borrower')
       OR (grant_row.role_key = 'investor' AND registry.account_type <> 'investor')
  ) THEN
    RAISE EXCEPTION 'customer auth cutover aborted: portal account class does not match legacy customer classification';
  END IF;

  IF EXISTS (
    SELECT 1 FROM accounts source
    JOIN borrower_accounts borrower ON borrower.id = source.user_id
    LEFT JOIN borrower_credentials target ON target.id = source.id
      AND target.borrower_account_id = source.user_id
      AND target.provider_account_id = source.account_id
      AND target.provider_id = source.provider_id
      AND target.password IS NOT DISTINCT FROM source.password
      AND target.access_token IS NOT DISTINCT FROM source.access_token
      AND target.refresh_token IS NOT DISTINCT FROM source.refresh_token
      AND target.id_token IS NOT DISTINCT FROM source.id_token
    WHERE target.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM accounts source
    JOIN investor_accounts investor ON investor.id = source.user_id
    LEFT JOIN investor_credentials target ON target.id = source.id
      AND target.investor_account_id = source.user_id
      AND target.provider_account_id = source.account_id
      AND target.provider_id = source.provider_id
      AND target.password IS NOT DISTINCT FROM source.password
      AND target.access_token IS NOT DISTINCT FROM source.access_token
      AND target.refresh_token IS NOT DISTINCT FROM source.refresh_token
      AND target.id_token IS NOT DISTINCT FROM source.id_token
    WHERE target.id IS NULL
  ) THEN
    RAISE EXCEPTION 'customer auth cutover aborted: credential reconciliation failed';
  END IF;
END;
$$;
--> statement-breakpoint
DROP TRIGGER users_bootstrap_applicant_role ON users;
--> statement-breakpoint
DROP FUNCTION bootstrap_applicant_role();
--> statement-breakpoint
DROP TRIGGER user_roles_customer_only ON user_roles;
--> statement-breakpoint
DROP FUNCTION enforce_legacy_customer_role_grant();
--> statement-breakpoint
DROP TRIGGER accounts_reject_admin ON accounts;
--> statement-breakpoint
DROP TRIGGER sessions_reject_admin ON sessions;
--> statement-breakpoint
DROP FUNCTION prevent_admin_legacy_auth_material();
--> statement-breakpoint
CREATE FUNCTION reject_retired_legacy_auth_material()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy unified authentication namespace is retired';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounts_legacy_auth_retired
BEFORE INSERT OR UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION reject_retired_legacy_auth_material();
--> statement-breakpoint
CREATE TRIGGER sessions_legacy_auth_retired
BEFORE INSERT OR UPDATE ON sessions
FOR EACH ROW EXECUTE FUNCTION reject_retired_legacy_auth_material();
--> statement-breakpoint
CREATE TRIGGER user_roles_legacy_auth_retired
BEFORE INSERT OR UPDATE ON user_roles
FOR EACH ROW EXECUTE FUNCTION reject_retired_legacy_auth_material();
--> statement-breakpoint
CREATE TRIGGER verifications_legacy_auth_retired
BEFORE INSERT OR UPDATE ON verifications
FOR EACH ROW EXECUTE FUNCTION reject_retired_legacy_auth_material();
--> statement-breakpoint
CREATE TRIGGER rate_limits_legacy_auth_retired
BEFORE INSERT OR UPDATE ON rate_limits
FOR EACH ROW EXECUTE FUNCTION reject_retired_legacy_auth_material();
--> statement-breakpoint
CREATE FUNCTION reject_legacy_customer_registration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.registration_intent IS NOT NULL THEN
    RAISE EXCEPTION 'customer registration belongs in a portal account namespace';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_legacy_customer_registration_retired
BEFORE INSERT OR UPDATE OF registration_intent ON users
FOR EACH ROW EXECUTE FUNCTION reject_legacy_customer_registration();
--> statement-breakpoint
DO $$
DECLARE
  legacy_credentials bigint;
  invalidated_sessions bigint;
  invalidated_verifications bigint;
  invalidated_rate_limits bigint;
  retired_role_grants bigint;
BEGIN
  SELECT count(*) INTO legacy_credentials FROM accounts;
  SELECT count(*) INTO invalidated_sessions FROM sessions;
  SELECT count(*) INTO invalidated_verifications FROM verifications;
  SELECT count(*) INTO invalidated_rate_limits FROM rate_limits;
  SELECT count(*) INTO retired_role_grants FROM user_roles;

  DELETE FROM sessions;
  DELETE FROM accounts;
  DELETE FROM user_roles;
  DELETE FROM verifications;
  DELETE FROM rate_limits;
  DELETE FROM role_permissions WHERE role_key IN ('sme_borrower', 'investor');
  UPDATE roles
  SET is_active = false,
      description = 'Retired legacy customer-role definition; portal account class is authoritative'
  WHERE key IN ('sme_borrower', 'investor');

  INSERT INTO audit_events (
    actor_type, actor_roles, action, outcome, resource_type, resource_id, metadata
  ) VALUES (
    'system', ARRAY[]::text[], 'identity.customer_auth_cutover_completed', 'succeeded',
    'identity_cutover', 'customer-auth-v1',
    jsonb_build_object(
      'borrowerAccounts', (SELECT count(*) FROM borrower_accounts),
      'investorAccounts', (SELECT count(*) FROM investor_accounts),
      'reconciledLegacyCredentials', legacy_credentials,
      'invalidatedLegacySessions', invalidated_sessions,
      'invalidatedLegacyVerifications', invalidated_verifications,
      'invalidatedLegacyRateLimits', invalidated_rate_limits,
      'retiredLegacyRoleGrants', retired_role_grants,
      'legacyCredentialsRemaining', (SELECT count(*) FROM accounts),
      'legacySessionsRemaining', (SELECT count(*) FROM sessions),
      'legacyRoleGrantsRemaining', (SELECT count(*) FROM user_roles)
    )
  );
END;
$$;
