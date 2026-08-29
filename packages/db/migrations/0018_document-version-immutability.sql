-- Uploaded document bytes are immutable evidence. A version's identity, storage
-- location, hash, size, and provenance can never change; only the malware-scan
-- outcome (scan_state / scanned_at) and the retention date may be updated.
-- Replacing a file means inserting a new version, never editing one.

CREATE FUNCTION protect_document_version_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document_versions rows cannot be deleted';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.document_id <> OLD.document_id
     OR NEW.version <> OLD.version
     OR NEW.storage_key <> OLD.storage_key
     OR NEW.content_sha256 <> OLD.content_sha256
     OR NEW.byte_size <> OLD.byte_size
     OR NEW.content_type <> OLD.content_type
     OR NEW.original_filename <> OLD.original_filename
     OR NEW.uploaded_by_user_id <> OLD.uploaded_by_user_id
     OR NEW.uploaded_at <> OLD.uploaded_at
  THEN
    RAISE EXCEPTION 'document_versions evidence columns are immutable; only scan_state, scanned_at, retention_until may change';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_versions_protect_evidence
BEFORE UPDATE OR DELETE ON document_versions
FOR EACH ROW
EXECUTE FUNCTION protect_document_version_evidence();
--> statement-breakpoint
CREATE FUNCTION prevent_document_version_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'document_versions is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_versions_reject_truncate
BEFORE TRUNCATE ON document_versions
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_document_version_truncate();
--> statement-breakpoint
CREATE TRIGGER documents_reject_delete_truncate
BEFORE DELETE OR TRUNCATE ON documents
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_document_version_truncate();
