CREATE OR REPLACE FUNCTION enforce_ledger_transaction_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_transaction_id uuid;
  entry_count integer;
  debit_total numeric(30, 2);
  credit_total numeric(30, 2);
BEGIN
  IF TG_TABLE_NAME = 'ledger_transactions' THEN
    target_transaction_id := NEW.id;
  ELSE
    target_transaction_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum(amount) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(sum(amount) FILTER (WHERE direction = 'credit'), 0)
  INTO entry_count, debit_total, credit_total
  FROM ledger_entries
  WHERE transaction_id = target_transaction_id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'ledger transaction % requires at least two entries', target_transaction_id;
  END IF;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced: debits %, credits %',
      target_transaction_id, debit_total, credit_total;
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ledger_transactions_balance_check
AFTER INSERT ON ledger_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_balance();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ledger_entries_balance_check
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_balance();--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_ledger_posting_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '% is append-only and cannot be truncated', TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER ledger_transactions_immutable_rows
BEFORE UPDATE OR DELETE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION protect_ledger_posting_evidence();--> statement-breakpoint

CREATE TRIGGER ledger_transactions_immutable_truncate
BEFORE TRUNCATE ON ledger_transactions
FOR EACH STATEMENT EXECUTE FUNCTION protect_ledger_posting_evidence();--> statement-breakpoint

CREATE TRIGGER ledger_entries_immutable_rows
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION protect_ledger_posting_evidence();--> statement-breakpoint

CREATE TRIGGER ledger_entries_immutable_truncate
BEFORE TRUNCATE ON ledger_entries
FOR EACH STATEMENT EXECUTE FUNCTION protect_ledger_posting_evidence();--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_ledger_account_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ledger_accounts cannot be truncated';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_accounts cannot be deleted';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code
    OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance
    OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'ledger account code, normal balance, and currency are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER ledger_accounts_protect_rows
BEFORE UPDATE OR DELETE ON ledger_accounts
FOR EACH ROW EXECUTE FUNCTION protect_ledger_account_identity();--> statement-breakpoint

CREATE TRIGGER ledger_accounts_protect_truncate
BEFORE TRUNCATE ON ledger_accounts
FOR EACH STATEMENT EXECUTE FUNCTION protect_ledger_account_identity();
