# Cross-Application Workflow Map

**Status:** WIP — source-derived

## Current interaction model

| Journey | User application | Services/API | Admin application |
| --- | --- | --- | --- |
| Registration/KYC | Collects identity/company data, files, bank, suitability, consent | Validates and stores profile/application data | Reviews request, requests correction, approves/rejects, sends contract |
| SME financing | Collects multi-step application and evidence | Stores credit-rating/application state | Underwrites, approves/rejects, creates loan/campaign |
| Campaign funding | Displays listing and accepts commitment | Checks eligibility/funds and records investment | Publishes/monitors campaign, handles allocation exceptions |
| Cash in/out | Submits top-up/withdrawal evidence | Records request and wallet/transaction effects | Verifies evidence, approves/rejects, executes/reconciles |
| Loan servicing | Shows schedules, notices, and history | Computes/stores loan and investor records | Records payments, penalties, restructures, distribution, completion |

## Target boundary

```text
Borrower / Investor UI       Staff Admin UI
          \                    /
           \                  /
       Authoritative versioned API
          | policy | commands | queries |
          | audit  | idempotency       |
          +----------------------------+
          Domain services + ledger + jobs
```

Both frontends should consume the same workflow states, permissions, and financial projections. Neither frontend should write domain tables directly or own formulas.

## Cutover concerns

- Legacy repositories duplicate shared code but contain behavior drift.
- Old and new clients may coexist, so contract compatibility and ownership of each mutation must be explicit.
- Tokens in URLs, broad public routes, locally generated contracts, and direct file access must not carry into the new boundary.
- Data migration must preserve actor/timestamps, status history, document/consent versions, wallet balances, open commitments, repayment schedules, and reconciliation evidence.
