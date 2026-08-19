CREATE FUNCTION prevent_consent_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_documents_reject_update_delete
BEFORE UPDATE OR DELETE ON consent_documents
FOR EACH ROW
EXECUTE FUNCTION prevent_consent_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER consent_documents_reject_truncate
BEFORE TRUNCATE ON consent_documents
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_consent_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER consent_acceptances_reject_update_delete
BEFORE UPDATE OR DELETE ON consent_acceptances
FOR EACH ROW
EXECUTE FUNCTION prevent_consent_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER consent_acceptances_reject_truncate
BEFORE TRUNCATE ON consent_acceptances
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_consent_evidence_mutation();
--> statement-breakpoint
CREATE FUNCTION validate_consent_acceptance_content_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  document_hash varchar(64);
BEGIN
  SELECT content_sha256
  INTO document_hash
  FROM consent_documents
  WHERE id = NEW.consent_document_id;

  IF document_hash IS NULL OR document_hash <> NEW.accepted_content_sha256 THEN
    RAISE EXCEPTION 'consent acceptance content hash does not match its immutable document';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_acceptances_validate_content_hash
BEFORE INSERT ON consent_acceptances
FOR EACH ROW
EXECUTE FUNCTION validate_consent_acceptance_content_hash();
