CREATE OR REPLACE FUNCTION register_portal_account_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO account_email_registry (email, account_type, account_id)
    VALUES (NEW.email, TG_ARGV[0]::portal_account_type, NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION '% account id and email are immutable', TG_ARGV[0];
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% accounts cannot be deleted; disable the account instead', TG_ARGV[0];
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION block_portal_account_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'portal account tables cannot be truncated';
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_account_email_registry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'account_email_registry cannot be truncated';
  END IF;
  RAISE EXCEPTION 'account_email_registry is immutable';
END;
$$;--> statement-breakpoint

CREATE TRIGGER admin_accounts_email_registry
BEFORE INSERT OR UPDATE OR DELETE ON admin_accounts
FOR EACH ROW EXECUTE FUNCTION register_portal_account_email('admin');--> statement-breakpoint
CREATE TRIGGER borrower_accounts_email_registry
BEFORE INSERT OR UPDATE OR DELETE ON borrower_accounts
FOR EACH ROW EXECUTE FUNCTION register_portal_account_email('borrower');--> statement-breakpoint
CREATE TRIGGER investor_accounts_email_registry
BEFORE INSERT OR UPDATE OR DELETE ON investor_accounts
FOR EACH ROW EXECUTE FUNCTION register_portal_account_email('investor');--> statement-breakpoint

CREATE TRIGGER admin_accounts_no_truncate
BEFORE TRUNCATE ON admin_accounts
FOR EACH STATEMENT EXECUTE FUNCTION block_portal_account_truncate();--> statement-breakpoint
CREATE TRIGGER borrower_accounts_no_truncate
BEFORE TRUNCATE ON borrower_accounts
FOR EACH STATEMENT EXECUTE FUNCTION block_portal_account_truncate();--> statement-breakpoint
CREATE TRIGGER investor_accounts_no_truncate
BEFORE TRUNCATE ON investor_accounts
FOR EACH STATEMENT EXECUTE FUNCTION block_portal_account_truncate();--> statement-breakpoint

CREATE TRIGGER account_email_registry_no_update_delete
BEFORE UPDATE OR DELETE ON account_email_registry
FOR EACH ROW EXECUTE FUNCTION protect_account_email_registry();--> statement-breakpoint
CREATE TRIGGER account_email_registry_no_truncate
BEFORE TRUNCATE ON account_email_registry
FOR EACH STATEMENT EXECUTE FUNCTION protect_account_email_registry();
