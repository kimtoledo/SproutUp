# 07 — Risks & Verification Gaps

**Status:** Source-reviewed findings; remediation belongs in revamp tasks.

## Critical/high-risk observations

- Yii `1.1.14` and multiple vendored libraries are obsolete and should not be carried into the revamp.
- Public services and admin bootstraps enable PHP error display.
- Production/QA configuration artifacts are versioned and contain credential-shaped settings; credentials must be audited and rotated without copying them into documentation.
- API tokens can be accepted in request/query parameters, which can leak through browser history, proxies, and logs.
- API-key lookup is not consistently bound to service/device type; duplicate-device protection is commented out in token verification.
- GET requests bypass shared Basic service authentication, while token/public-route behavior is controlled by broad string/regex route lists.
- Broad public-route entries include all registration, site, and credit-rating actions; endpoint-level authorization needs verification.
- Paynamics polling prints a value assembled with the merchant key before hashing, risking secret disclosure in console logs.
- File serving uses custom path sanitization and authorization; private-document access requires dedicated testing.
- Active cron directories contain hardcoded one-off correction/test commands, empty/no-op commands, and broken utilities.
- The investment processor is an unbounded polling loop without an evident work-claim/lock protocol.
- No scheduler manifest exists, so actual execution, overlap, and missed-job behavior are unknown.

## Data and financial risks

- There is no complete reproducible schema or production reconciliation snapshot.
- Many relationships appear application-enforced rather than protected by foreign keys/unique constraints.
- Wallet repair commands indicate historical running-balance and hold inconsistencies.
- Financial formulas and rates are distributed across models, libraries, controllers, params, settings, and repair scripts.
- Raw SQL, direct bulk updates, and force/correction CLIs increase the chance of unaudited mutation.
- Gateway/provider state and internal ledger state are tightly coupled in legacy methods.

## Maintainability and operability risks

- Controllers/models combine validation, persistence, computation, integration calls, formatting, and notification.
- API documentation is partial compared with source endpoint inventory.
- 199 TODO/FIXME/HACK/XXX markers were found in first-party PHP.
- Test fixtures are incomplete; current automated coverage cannot be established.
- Important routines are under `trash`, while some “active” commands are disabled or one-off.
- Runtime behavior depends on ignored environment overlays and database settings.

## Verification priorities

1. Credential exposure/rotation and reachable test/control endpoints.
2. API authentication/public-route matrix and private file access.
3. Wallet, holds, investment, disbursement, repayment, distribution, and withdrawal reconciliation.
4. Production cron schedule, job ownership, and failed/backlogged work.
5. Deployed schema, constraints, views, procedures, and data-quality exceptions.
6. Active provider contracts/accounts and current operational workarounds.
