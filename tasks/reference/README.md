# Reference Material

Files in this directory support discovery and migration planning. They are not automatically approved revamp requirements.

The initial domain inventory was generated through a Claude Code scan of the three legacy repositories. It should be treated as an automated discovery result that still requires verification for financially critical, security-sensitive, compliance-related, ambiguous, or apparently dead behavior.

## Legacy domain inventory

The [legacy](./legacy/) folder contains behavior observed across:

- `seedin-live-admin`
- `seedin-live-user`
- `seedin-live-api-v1-1`

Use these documents to identify calculations, state transitions, data dependencies, integrations, operational exceptions, and migration needs. Resolve conflicts against the target Philippine product direction in [the main task README](../README.md) before implementation.

## Direct repository reviews

- [`seedin-live-api-v1-1`](./legacy/api-v1-1/README.md) — source-level inventory of API/backend surfaces, modules, roles, jobs, integrations, data, and risks.
- [`seedin-live-admin`](./legacy/admin/README.md) — back-office navigation, operational workflows, roles, reports, control gaps, and revamp disposition.
- [`seedin-live-user`](./legacy/user/README.md) — portal architecture, onboarding, investor/borrower journeys, wallet, communications, and optional-feature disposition.
- [Cross-application workflow map](./legacy/09-cross-application-workflows.md) — user/admin/API responsibilities and target cutover boundary.
- [Schema documentation](../schema/README.md) — cross-repository legacy schema evidence and proposed revamp model.
