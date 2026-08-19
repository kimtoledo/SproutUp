# SproutUp Ledger Foundation

## Current scope

The provider-independent double-entry persistence foundation consists of:

- `ledger_accounts` — stable account code, name, normal balance, `PHP` currency, and active/closed control;
- `ledger_transactions` — immutable posting identity, payload hash, source reference, effective/posted time, optional actor/request, and optional original transaction for a full reversal; and
- `ledger_entries` — immutable numbered debit/credit lines with a positive `numeric(30,2)` amount and account reference.

No production chart of accounts is seeded. No wallet, cash, hold, fee, tax, revenue, loan, investor, borrower, bank, or clearing account meaning is implied by the generic tables. Those accounts and posting rules belong to their approved domain tasks.

## Database invariants

Every posted transaction must contain at least two lines and exact total debits must equal exact total credits. PostgreSQL constraint triggers are `DEFERRABLE INITIALLY DEFERRED`, so a header and all lines can be inserted in one transaction while the final balance is enforced at commit. A header with no lines and an unbalanced set both fail the database transaction.

Lines require a positive amount, one line number per transaction, and at most one line per account per transaction. Currency is currently enum-restricted to `PHP`. The global idempotency key prevents duplicate postings and the 64-character lowercase SHA-256 payload hash will bind retries to an exact canonical posting in the service layer.

Ledger transaction and entry rows are append-only: update, delete, and truncate are rejected. Account code, normal balance, and currency are immutable; name and active status may change without rewriting historical lines. At most one transaction may identify itself as the full reversal of an original transaction.

## Required posting boundary

Direct application inserts are not allowed. The posting service must:

1. validate canonical positive PHP string amounts and at least two distinct active accounts;
2. canonicalize lines independently of request order and compute the payload hash;
3. reject unequal exact debit/credit centavos before writing;
4. atomically insert the transaction, lines, and immutable audit event;
5. return the existing transaction only when an idempotency retry has the same hash;
6. reject an idempotency key reused for a different financial effect; and
7. build a full reversal by copying every original line to the opposite direction, never by editing history.

Financial/domain idempotency remains separate from transport/job idempotency. Balance queries must derive from entries and must not introduce a mutable source-of-truth balance column.

## Deliberately unresolved

- production chart/account ownership and settlement/clearing structure;
- available/held/settled balance dimensions and hold lifecycle;
- posting rules for cash-in, commitment, withdrawal, disbursement, repayment, distribution, fees, tax, referral, and reconciliation;
- approval thresholds and maker/checker roles for each posting command; and
- rate, rounding, residual, value-date, cutoff, and bank-evidence policies.
