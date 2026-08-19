# SeedIn Revamp Tasks

This directory consolidates the revamp discovery and implementation tasks into three dependency-ordered MVP work packages. All MVPs are currently **WIP**; the grouping is a planning baseline and should be refined as requirements, compliance rules, and production data are validated.

> **AI working context:** Before changing any task, read this file and [LOGS.md](./LOGS.md). After making a meaningful update, append an entry to `LOGS.md` so the next AI session can continue from the latest known state.

## Workspace background

The workspace contains three legacy applications and one planning workspace for the replacement platform:

| Project | Role |
| --- | --- |
| `seedin-live-admin` | Legacy admin and back-office application |
| `seedin-live-user` | Legacy borrower/investor-facing application |
| `seedin-live-api-v1-1` | Legacy API and shared business-logic implementation |
| `seedin-revamp` | Planning and future implementation workspace for the rebuilt platform |

The legacy repositories are evidence of existing workflows, calculations, data structures, and operational edge cases. They are **not automatically the specification for the revamp**. When legacy behavior conflicts with the target product direction below, record the conflict and follow the approved revamp requirement.

### Discovery provenance

The initial legacy functionality, module, and feature inventory was produced by a **Claude Code scan** of `seedin-live-admin`, `seedin-live-user`, and `seedin-live-api-v1-1`. Those scan results are preserved under [`reference/legacy`](./reference/legacy/README.md).

Use the scan as a starting map for locating existing behavior, not as proof that every feature is active, correct, complete, or required in the revamp. Before implementation, verify critical findings directly against source code, configuration, database schema/data where available, scheduled jobs, integrations, and current business operations.

## Target platform overview

SeedIn Revamp is a debt-based crowdfunding lending platform that connects Philippine SMEs with investors through an admin-managed marketplace. SMEs apply for financing, approved campaigns are funded by investors, borrowers repay the platform, and the platform automatically allocates principal and returns to investors.

### User roles

- Super Admin
- Sales Officer
- Credit Analyst
- Compliance Officer
- Finance Officer
- SME Borrower
- Investor

### Main workflow

1. SME registration and KYC
2. Document submission
3. Credit evaluation and risk scoring
4. Approval and campaign publishing
5. Investor registration and KYC
6. Crowdfunding/funding period
7. Loan disbursement
8. Repayment collection
9. Automatic distribution to investors

### Repayment models

- **Amortized:** monthly principal plus interest.
- **Interest only:** monthly interest with the full principal returned at maturity.

### Business model example

| Item | Example |
| --- | ---: |
| Loan amount | PHP 1,000,000 |
| Borrower interest rate | 15% per annum |
| Investor return | 8% per annum |
| Indicative platform spread | 7% plus applicable origination/service fees |

These values illustrate the model and are not hardcoded production rates. Rates, fees, rounding rules, and effective dates must be configurable and approved before implementation.

### Referral model

The revamp target is a **one-level lifetime referral program**. A direct referrer may earn from future qualifying investments made by the referred investor while the referral remains active and compliant. Referral rewards come only from the platform's commission—not from investor principal or investor returns.

Example: for a PHP 100,000 investment with a 1% platform commission, the platform commission is PHP 1,000. If the referral share is 10% of that commission, the referrer receives PHP 100 and the platform retains PHP 900 before other applicable charges.

### Tax and compliance direction

The system must support configurable Philippine tax treatment, including:

- VAT or percentage tax on platform fees, depending on the operating entity's BIR registration;
- withholding tax on investor interest where applicable;
- Documentary Stamp Tax on covered loan documents;
- possible withholding tax on referral commissions; and
- gross and net calculations with downloadable tax and reconciliation reports.

Exact applicability, rates, bases, timing, rounding, filing outputs, and accounting treatment require confirmation from Philippine legal, compliance, and tax owners before implementation.

### Recommended modules

| Target module | Current planning coverage |
| --- | --- |
| KYC & Compliance | MVP 1 — Borrower/Investor Onboarding, Documents, Auth/RBAC |
| Borrower Management | MVP 1 — Borrower Onboarding, Underwriting, Campaigns, Collections |
| Investor Management | MVP 1 — Investor Onboarding, Commitments, Wallet, Distribution |
| Campaign Management | MVP 1 — Campaign & Loan Management |
| Credit Scoring | MVP 1 — Credit Scoring & Underwriting |
| Loan Management | MVP 1 — Campaign/Loan, Disbursement, Repayment |
| Repayment & Collections | MVP 1 baseline; MVP 2 automation |
| Referral Management | MVP 2 — One-Level Referral Program |
| Accounting & Tax | MVP 1 baseline; MVP 2 automation |
| Reports & Dashboard | MVP 1 operational reports; MVP 2 business intelligence |

## Requirement authority for AI

When planning or implementing work, use this order of authority:

1. The latest explicit user-approved product direction.
2. Confirmed decisions recorded in `LOGS.md` and the relevant MVP README.
3. Revamp task requirements and acceptance criteria.
4. Verified legacy implementation details, used only as discovery evidence and migration context.
5. Unverified observations from automated legacy-code scans.

Do not copy a legacy rule merely because it exists in code. Surface conflicts—especially Singapore-specific KYC, multi-level introducer commissions, legacy repayment variants, currencies, taxes, hardcoded rates, and deprecated integrations—before turning them into revamp requirements.

## MVP overview

| MVP | Status | Focus | Domains |
| --- | --- | --- | --- |
| [MVP 1](./mvp1/README.md) | WIP | Controlled end-to-end pilot | Onboarding through funding, disbursement, repayment, payout, tax baseline, and reconciliation |
| [MVP 2](./mvp2/README.md) | WIP | Automation and growth | Payment automation, auto-invest, one-level referral, servicing, BI, and hardening |
| [MVP 3](./mvp3/README.md) | WIP / uncommitted | Optional advanced capabilities | External accounting data, secondary market, and advanced portfolio analytics |

## Delivery order

1. **MVP 1 — Controlled Pilot:** deliver the complete lending loop with manual bank operations allowed. This is the recommended first release because a foundation-only build cannot validate the business model or financial reconciliation.
2. **MVP 2 — Automation & Growth:** automate proven manual operations and add auto-invest and the approved one-level referral program.
3. **MVP 3 — Optional Advanced Capabilities:** evaluate external accounting data, secondary-market trading, and advanced analytics separately; these are not committed launch requirements.

## Status convention

- **WIP** — discovery, decisions, or implementation are still in progress.
- **Ready** — scope and acceptance criteria are agreed and dependencies are available.
- **Done** — implementation, tests, operational checks, and documentation are complete.

## Working rules

- Keep task filenames ordered with a two-digit numeric prefix (`01-`, `02-`, and so on); use `00-overview.md` for each MVP's scope and release gates.
- Treat every domain document as discovery input, not automatically approved requirements.
- Use PHP as the target product currency unless a later approved requirement introduces multi-currency support.
- Keep rates, fees, taxes, thresholds, and their effective dates configurable and auditable; examples must never become hardcoded defaults by accident.
- Preserve gross, deduction, and net amounts separately for financial and tax reporting.
- Keep referral rewards isolated from investor principal and investor returns.
- Resolve every item called out as missing, conflicting, hardcoded, or under-specified before implementation.
- Version and test all financial formulas, rates, state transitions, permissions, and compliance rules.
- Keep the wallet and transaction ledger append-only and auditable; do not make downstream features their own financial source of truth.
- Do not begin an MVP solely because the previous folder is complete: confirm its explicit dependencies and business decisions first.
- Update the relevant MVP README when a task changes status or moves between releases.
- Append material task changes, decisions, blockers, and handoff notes to `LOGS.md`; do not silently rewrite prior log entries.

## Definition of done

A task is done only when its requirements are confirmed, implementation is reviewed, automated tests cover critical rules and failure paths, migrated data is reconciled where applicable, operational monitoring/runbooks exist, and the product owner has accepted the result.

## Reference files

- [LOGS.md](./LOGS.md) — chronological AI and project handoff record.
- [MVP 1 README](./mvp1/README.md) — controlled-pilot checklist.
- [MVP 2 README](./mvp2/README.md) — automation-and-growth checklist.
- [MVP 3 README](./mvp3/README.md) — optional advanced-capability checklist.
- [Reference README](./reference/README.md) — legacy discovery and migration evidence.
- [`seedin-live-api-v1-1` source review](./reference/legacy/api-v1-1/README.md) — verified application, endpoint, module, role, cron, integration, data, and risk inventory.
- [`seedin-live-admin` source review](./reference/legacy/admin/README.md) — verified navigation, staff workflows, permissions, reports, and control-gap inventory.
- [`seedin-live-user` source review](./reference/legacy/user/README.md) — verified portal architecture and borrower/investor journey inventory.
- [Cross-application workflow map](./reference/legacy/09-cross-application-workflows.md) — legacy UI/API responsibilities and target boundary.
- [Schema documentation](./schema/README.md) — legacy catalog, relationships, money flow, proposed revamp schema, and verification gaps.
