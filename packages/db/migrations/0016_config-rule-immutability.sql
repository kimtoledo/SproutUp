-- Effective-dated configuration integrity.
--
-- rule_versions rows are immutable evidence: a published rule body must never
-- change, so historical fee/tax/eligibility calculations remain reproducible.
-- rule_sets is a catalogue: its description may be corrected, but a key is
-- never deleted while versions may reference it.

CREATE FUNCTION prevent_rule_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rule_versions is append-only; publish a new version instead';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rule_versions_reject_update_delete
BEFORE UPDATE OR DELETE ON rule_versions
FOR EACH ROW
EXECUTE FUNCTION prevent_rule_version_mutation();
--> statement-breakpoint
CREATE TRIGGER rule_versions_reject_truncate
BEFORE TRUNCATE ON rule_versions
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_rule_version_mutation();
--> statement-breakpoint
CREATE FUNCTION prevent_rule_set_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rule_sets keys are permanent; they cannot be deleted or truncated';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rule_sets_reject_delete
BEFORE DELETE ON rule_sets
FOR EACH ROW
EXECUTE FUNCTION prevent_rule_set_removal();
--> statement-breakpoint
CREATE TRIGGER rule_sets_reject_truncate
BEFORE TRUNCATE ON rule_sets
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_rule_set_removal();
--> statement-breakpoint
CREATE FUNCTION prevent_rule_set_key_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key <> OLD.key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'rule_sets key and created_at are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rule_sets_protect_identity
BEFORE UPDATE ON rule_sets
FOR EACH ROW
EXECUTE FUNCTION prevent_rule_set_key_change();
