DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM rule_versions record
		LEFT JOIN admin_accounts admin ON admin.id = record.published_by_user_id
		WHERE record.published_by_user_id IS NOT NULL AND admin.id IS NULL
	) THEN
		RAISE EXCEPTION 'account ownership cutover aborted: rule publisher is not an admin account';
	END IF;
	IF EXISTS (
		SELECT 1 FROM consent_documents record
		LEFT JOIN admin_accounts admin ON admin.id = record.published_by_user_id
		WHERE record.published_by_user_id IS NOT NULL AND admin.id IS NULL
	) THEN
		RAISE EXCEPTION 'account ownership cutover aborted: consent publisher is not an admin account';
	END IF;
	IF EXISTS (
		SELECT 1 FROM (
			SELECT user_id account_id FROM consent_acceptances
			UNION ALL SELECT uploaded_by_user_id FROM document_versions
			UNION ALL SELECT owner_user_id FROM documents
			UNION ALL SELECT actor_user_id FROM ledger_transactions WHERE actor_user_id IS NOT NULL
			UNION ALL SELECT actor_user_id FROM onboarding_case_events WHERE actor_user_id IS NOT NULL
			UNION ALL SELECT applicant_user_id FROM onboarding_cases
		) referenced
		LEFT JOIN account_email_registry registry ON registry.account_id = referenced.account_id
		WHERE registry.account_id IS NULL
	) THEN
		RAISE EXCEPTION 'account ownership cutover aborted: referenced identity has no portal registry account';
	END IF;
	IF EXISTS (
		SELECT 1 FROM onboarding_cases onboarding
		JOIN account_email_registry registry ON registry.account_id = onboarding.applicant_user_id
		WHERE registry.account_type::text <> onboarding.case_type::text
			OR registry.account_type = 'admin'
	) THEN
		RAISE EXCEPTION 'account ownership cutover aborted: onboarding type does not match account class';
	END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "rule_versions" DROP CONSTRAINT "rule_versions_published_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "consent_acceptances" DROP CONSTRAINT "consent_acceptances_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "consent_documents" DROP CONSTRAINT "consent_documents_published_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "onboarding_case_events" DROP CONSTRAINT "onboarding_case_events_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "onboarding_cases" DROP CONSTRAINT "onboarding_cases_applicant_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_published_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_acceptances" ADD CONSTRAINT "consent_acceptances_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_documents" ADD CONSTRAINT "consent_documents_published_by_user_id_admin_accounts_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."admin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_actor_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_case_events" ADD CONSTRAINT "onboarding_case_events_actor_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_applicant_user_id_account_email_registry_account_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."account_email_registry"("account_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION enforce_onboarding_account_class()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	registered_type portal_account_type;
BEGIN
	SELECT account_type INTO registered_type
	FROM account_email_registry
	WHERE account_id = NEW.applicant_user_id;
	IF registered_type IS NULL OR registered_type::text <> NEW.case_type::text
		OR registered_type = 'admin' THEN
		RAISE EXCEPTION 'onboarding case type must match borrower or investor account class';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER onboarding_cases_account_class
BEFORE INSERT OR UPDATE OF applicant_user_id, case_type ON onboarding_cases
FOR EACH ROW EXECUTE FUNCTION enforce_onboarding_account_class();
--> statement-breakpoint
INSERT INTO audit_events (
	actor_type, actor_roles, action, outcome, resource_type, resource_id, metadata
)
SELECT
	'system', ARRAY[]::text[], 'identity.account_ownership_cutover_completed', 'succeeded',
	'identity_cutover', 'account-ownership-v1',
	jsonb_build_object(
		'onboardingCases', (SELECT count(*) FROM onboarding_cases),
		'onboardingEvents', (SELECT count(*) FROM onboarding_case_events),
		'documents', (SELECT count(*) FROM documents),
		'documentVersions', (SELECT count(*) FROM document_versions),
		'consentAcceptances', (SELECT count(*) FROM consent_acceptances),
		'ledgerTransactions', (SELECT count(*) FROM ledger_transactions)
	);
