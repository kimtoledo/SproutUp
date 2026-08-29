# Effective-dated configuration (`rule_sets` / `rule_versions`)

**Status:** mechanism implemented (2026-08-30, slice S0.2). No business rule bodies are seeded yet;
each is added by its owning MVP task and flagged `ASSUMED FOR PILOT` until the owner confirms it.

## Why

`AGENTS.md` requires that rates, fees, taxes, thresholds, and their effective dates are
"configurable and auditable" and that "historical calculations are reproducible". A hardcoded rate
or a mutable settings row cannot satisfy both. This primitive is the single place every later
domain reads tunable policy from: KYC required-field / document matrices, tax rates and bases,
investment limits and EDD triggers, onboarding SLA thresholds, credit scorecard weights, penalty
and allocation rules.

## Model

| Relation | Role |
| --- | --- |
| `rule_sets` | Catalogue of known keys. `key` (PK, `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`), `description`. The description may be corrected; the key can never be deleted or renamed (DB triggers). |
| `rule_versions` | Immutable, effective-dated bodies. `rule_key` → `rule_sets`, `version` (monotonic per key), `effective_from` (timestamptz), `body` (`jsonb`, must be an object), `note`, `published_by_user_id` (null = system/seed), `published_at`. |

**Resolution:** the rule in force at time `T` for a key is the `rule_versions` row with the greatest
`effective_from <= T`. Superseding a rule is a plain insert of a later version — no row is ever
updated or deleted, so `resolve(key, historicalDate)` keeps returning the exact body that applied
then, even after newer versions exist.

**Invariants (DB-enforced):**

- `rule_versions` is append-only — `UPDATE` / `DELETE` / `TRUNCATE` raise `rule_versions is append-only`.
- `(rule_key, version)` unique; `version > 0`.
- `(rule_key, effective_from)` unique — one key cannot have two versions taking effect at the same instant.
- `jsonb_typeof(body) = 'object'` — arrays / scalars / null are rejected.
- `rule_sets` keys are permanent; `key` and `created_at` are immutable.

Migrations: `0015_wise_lockjaw.sql` (tables), `0016_config-rule-immutability.sql` (triggers).

## Service — `apps/api/src/config/rule-service.ts`

`createRuleService(database, clock?)` returns:

| Method | Behaviour |
| --- | --- |
| `registerRuleSet({ key, description })` | Idempotent catalogue insert. `{ ok: true, created }`. |
| `publish({ key, effectiveFrom, body, actor, note?, requestId? })` | Appends the next version. `unknown_rule_key` if the key is not registered; `effective_from_conflict` if a version already takes effect at that instant (pre-check + unique-index race guard). Writes a `config_rule.published` audit event (`resourceType: config_rule`, metadata = key/version/effectiveFrom/note — **never the body**). |
| `resolve(key, at?)` | The in-force version at `at` (default: now), or `null`. |
| `listVersions(key)` | All versions, newest first. |

`publish` and `registerRuleSet` own a transaction; `publishRuleVersionInTransaction` /
`registerRuleSetInTransaction` accept an existing one so a domain mutation and its config change can
commit atomically (same pattern as the ledger/consent services).

`actor` is `{ type: 'system' }` (migrations, seeds) or
`{ type: 'user', userId, roles }` (a future admin route). No HTTP route is exposed in this slice —
authority for who may publish which key is decided with the maker/checker matrix (task 22).

## Adding a rule (for a later slice)

1. `registerRuleSet` the key with a one-line description.
2. `publish` version 1 with an `effective_from` and a `note` that says `ASSUMED FOR PILOT — pending <owner>`.
3. Record the assumption in the owning task's *Open decisions*.
4. The consuming domain calls `resolve(key, effectiveDateOfTheTransaction)` — never `now()` for a
   historical recompute — and treats a `null` result as a hard configuration error, not a default.
