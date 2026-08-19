CREATE FUNCTION prevent_onboarding_case_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'onboarding_case_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER onboarding_case_events_reject_update_delete
BEFORE UPDATE OR DELETE ON onboarding_case_events
FOR EACH ROW
EXECUTE FUNCTION prevent_onboarding_case_events_mutation();
--> statement-breakpoint
CREATE TRIGGER onboarding_case_events_reject_truncate
BEFORE TRUNCATE ON onboarding_case_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_onboarding_case_events_mutation();
