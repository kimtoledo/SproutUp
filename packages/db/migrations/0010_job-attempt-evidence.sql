CREATE OR REPLACE FUNCTION protect_background_job_attempt_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'background_job_attempts evidence cannot be truncated';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'background_job_attempts evidence cannot be deleted';
  END IF;

  IF OLD.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'completed background_job_attempts evidence is immutable';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
    OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
    OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'background_job_attempts identity is immutable';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER background_job_attempts_protect_rows
BEFORE UPDATE OR DELETE ON background_job_attempts
FOR EACH ROW EXECUTE FUNCTION protect_background_job_attempt_evidence();--> statement-breakpoint

CREATE TRIGGER background_job_attempts_protect_truncate
BEFORE TRUNCATE ON background_job_attempts
FOR EACH STATEMENT EXECUTE FUNCTION protect_background_job_attempt_evidence();
