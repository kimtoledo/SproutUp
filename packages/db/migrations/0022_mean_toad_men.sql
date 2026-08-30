DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM approval_requests request
		LEFT JOIN admin_accounts admin ON admin.id = request.maker_user_id
		WHERE admin.id IS NULL
	) THEN
		RAISE EXCEPTION 'admin RBAC cutover aborted: approval maker is not an admin account';
	END IF;
	IF EXISTS (
		SELECT 1 FROM approval_requests request
		LEFT JOIN admin_accounts admin ON admin.id = request.checker_user_id
		WHERE request.checker_user_id IS NOT NULL AND admin.id IS NULL
	) THEN
		RAISE EXCEPTION 'admin RBAC cutover aborted: approval checker is not an admin account';
	END IF;
	IF EXISTS (
		SELECT 1 FROM approval_actions action
		LEFT JOIN admin_accounts admin ON admin.id = action.actor_user_id
		WHERE admin.id IS NULL
	) THEN
		RAISE EXCEPTION 'admin RBAC cutover aborted: approval actor is not an admin account';
	END IF;
	IF EXISTS (
		SELECT 1 FROM onboarding_cases onboarding
		LEFT JOIN admin_accounts admin ON admin.id = onboarding.assigned_reviewer_user_id
		WHERE onboarding.assigned_reviewer_user_id IS NOT NULL AND admin.id IS NULL
	) THEN
		RAISE EXCEPTION 'admin RBAC cutover aborted: onboarding reviewer is not an admin account';
	END IF;
	IF EXISTS (
		SELECT 1 FROM role_permissions grant_row
		LEFT JOIN admin_accounts admin ON admin.id = grant_row.granted_by
		WHERE grant_row.granted_by IS NOT NULL AND admin.id IS NULL
	) THEN
		RAISE EXCEPTION 'admin RBAC cutover aborted: permission grant actor is not an admin account';
	END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE "admin_role_grants" (
	"admin_account_id" uuid NOT NULL,
	"role_key" varchar(80) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "admin_role_grants_admin_account_id_role_key_pk" PRIMARY KEY("admin_account_id","role_key")
);
--> statement-breakpoint
ALTER TABLE "approval_actions" DROP CONSTRAINT "approval_actions_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_maker_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_checker_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "onboarding_cases" DROP CONSTRAINT "onboarding_cases_assigned_reviewer_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_granted_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "admin_role_grants" ADD CONSTRAINT "admin_role_grants_admin_account_id_admin_accounts_id_fk" FOREIGN KEY ("admin_account_id") REFERENCES "public"."admin_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_grants" ADD CONSTRAINT "admin_role_grants_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_grants" ADD CONSTRAINT "admin_role_grants_granted_by_admin_accounts_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_role_grants_role_idx" ON "admin_role_grants" USING btree ("role_key");--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_user_id_admin_accounts_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_maker_user_id_admin_accounts_id_fk" FOREIGN KEY ("maker_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_checker_user_id_admin_accounts_id_fk" FOREIGN KEY ("checker_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_assigned_reviewer_user_id_admin_accounts_id_fk" FOREIGN KEY ("assigned_reviewer_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_granted_by_admin_accounts_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."admin_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO admin_role_grants (admin_account_id, role_key, granted_at, granted_by)
SELECT legacy.user_id, legacy.role_key, legacy.granted_at,
	CASE WHEN grantor.id IS NOT NULL THEN legacy.granted_by ELSE NULL END
FROM user_roles legacy
JOIN admin_accounts admin ON admin.id = legacy.user_id
JOIN roles role ON role.key = legacy.role_key AND role.category = 'staff'
LEFT JOIN admin_accounts grantor ON grantor.id = legacy.granted_by;
--> statement-breakpoint
DO $$
DECLARE
	expected_count bigint;
	actual_count bigint;
BEGIN
	SELECT count(*) INTO expected_count
	FROM user_roles legacy
	JOIN admin_accounts admin ON admin.id = legacy.user_id
	JOIN roles role ON role.key = legacy.role_key AND role.category = 'staff';
	SELECT count(*) INTO actual_count FROM admin_role_grants;
	IF expected_count <> actual_count THEN
		RAISE EXCEPTION 'admin RBAC cutover aborted: expected % grants, copied %', expected_count, actual_count;
	END IF;
END;
$$;
--> statement-breakpoint
DELETE FROM user_roles legacy
USING admin_accounts admin
WHERE legacy.user_id = admin.id;
--> statement-breakpoint
DELETE FROM sessions legacy
USING admin_accounts admin
WHERE legacy.user_id = admin.id;
--> statement-breakpoint
DELETE FROM accounts legacy
USING admin_accounts admin
WHERE legacy.user_id = admin.id;
--> statement-breakpoint
CREATE FUNCTION enforce_admin_staff_role_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM roles role
		WHERE role.key = NEW.role_key AND role.category = 'staff'
	) THEN
		RAISE EXCEPTION 'admin role grants accept staff roles only';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_role_grants_staff_only
BEFORE INSERT OR UPDATE OF role_key ON admin_role_grants
FOR EACH ROW EXECUTE FUNCTION enforce_admin_staff_role_grant();
--> statement-breakpoint
CREATE FUNCTION enforce_legacy_customer_role_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM admin_accounts admin WHERE admin.id = NEW.user_id) THEN
		RAISE EXCEPTION 'admin accounts cannot receive legacy role grants';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM roles role
		WHERE role.key = NEW.role_key AND role.category = 'customer'
	) THEN
		RAISE EXCEPTION 'legacy role grants accept customer compatibility roles only';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_roles_customer_only
BEFORE INSERT OR UPDATE OF user_id, role_key ON user_roles
FOR EACH ROW EXECUTE FUNCTION enforce_legacy_customer_role_grant();
--> statement-breakpoint
CREATE FUNCTION prevent_admin_legacy_auth_material()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM admin_accounts admin WHERE admin.id = NEW.user_id) THEN
		RAISE EXCEPTION 'admin authentication material belongs in the admin namespace';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounts_reject_admin
BEFORE INSERT OR UPDATE OF user_id ON accounts
FOR EACH ROW EXECUTE FUNCTION prevent_admin_legacy_auth_material();
--> statement-breakpoint
CREATE TRIGGER sessions_reject_admin
BEFORE INSERT OR UPDATE OF user_id ON sessions
FOR EACH ROW EXECUTE FUNCTION prevent_admin_legacy_auth_material();
--> statement-breakpoint
INSERT INTO audit_events (
	actor_type, actor_roles, action, outcome, resource_type, resource_id, metadata
)
SELECT
	'system', ARRAY[]::text[], 'identity.admin_rbac_cutover_completed', 'succeeded',
	'identity_cutover', 'admin-rbac-v1',
	jsonb_build_object(
		'adminAccounts', (SELECT count(*) FROM admin_accounts),
		'adminRoleGrants', (SELECT count(*) FROM admin_role_grants),
		'legacyAdminCredentialsRemaining', (
			SELECT count(*) FROM accounts legacy JOIN admin_accounts admin ON admin.id = legacy.user_id
		),
		'legacyAdminSessionsRemaining', (
			SELECT count(*) FROM sessions legacy JOIN admin_accounts admin ON admin.id = legacy.user_id
		)
	);
