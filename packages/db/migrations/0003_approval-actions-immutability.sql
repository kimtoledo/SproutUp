CREATE FUNCTION prevent_approval_actions_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'approval_actions is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER approval_actions_reject_update_delete
BEFORE UPDATE OR DELETE ON approval_actions
FOR EACH ROW
EXECUTE FUNCTION prevent_approval_actions_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_actions_reject_truncate
BEFORE TRUNCATE ON approval_actions
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_approval_actions_mutation();
