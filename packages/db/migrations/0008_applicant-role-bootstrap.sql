CREATE FUNCTION bootstrap_applicant_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  applicant_role text;
BEGIN
  IF NEW.registration_intent IS NULL THEN
    RETURN NEW;
  END IF;

  applicant_role := CASE NEW.registration_intent
    WHEN 'borrower' THEN 'sme_borrower'
    WHEN 'investor' THEN 'investor'
  END;

  INSERT INTO user_roles (user_id, role_key)
  VALUES (NEW.id, applicant_role);

  INSERT INTO audit_events (
    actor_type,
    actor_user_id,
    actor_roles,
    action,
    outcome,
    resource_type,
    resource_id,
    metadata
  ) VALUES (
    'user',
    NEW.id,
    ARRAY[applicant_role],
    'account.registered',
    'succeeded',
    'user',
    NEW.id::text,
    jsonb_build_object('registrationIntent', NEW.registration_intent)
  );

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_bootstrap_applicant_role
AFTER INSERT ON users
FOR EACH ROW
WHEN (NEW.registration_intent IS NOT NULL)
EXECUTE FUNCTION bootstrap_applicant_role();
