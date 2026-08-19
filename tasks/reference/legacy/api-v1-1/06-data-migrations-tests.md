# 06 — Data, Migrations & Tests

**Status:** Source-verified inventory with major completeness gaps.

## Data layer

- 146 common model files, predominantly Yii ActiveRecord.
- At least 118 first-party raw `createCommand()` call sites.
- At least 79 explicit database transaction starts.
- At least 31 bulk `updateAll`/`deleteAll` call sites.
- Model relations are heavily centered on `User`, `LoanBorrowListing`, `LoanLendRepaymentPlan`, `CreditRating`, `Admin`, `Request`, and `FundTransaction`.
- No complete foreign-key/index definition is available in the repository.

See the [schema catalog](../../../schema/01-legacy-schema-catalog.md) and [verification plan](../../../schema/05-schema-gaps-verification.md).

## Migrations

- 61 PHP migrations from `m170926_012717_user_tin` to `m200525_133135_email_template`.
- Migrations are raw SQL executed through `CDbMigration` and frequently create/alter multiple objects.
- Most `down()` methods explicitly state rollback is unsupported.
- The migration set introduces later features such as Paynamics, NUWallet, referrals, email blasts, points, devices, app manager, access logs, Alfred priority lanes, Coins.ph, GCash, and email templates.
- It does not contain the original tables required by most models.

## Tests

21 legacy Codeception scenarios cover portions of:

- login/signup/profile;
- investment and Product A/Product B flows;
- top-up and backend top-up/withdrawal confirmation;
- credit rating;
- promotion;
- investment trading;
- email queue, repayment, watcher, and investment bonus.

## Test limitations

- The fixture dump is only a placeholder comment.
- Runtime configs and dependencies are environment-managed/ignored.
- Some tests target legacy frontend/backend applications and old business rules.
- Presence of a scenario does not prove it currently runs or passes.
- Critical formulas and state machines need new deterministic unit/property/integration tests for the revamp.

## Required next verification

- Obtain a sanitized production schema and representative anonymized fixtures.
- Inventory current open loans, investor positions, balances, holds, pending requests, and gateway states.
- Run or reconstruct only relevant legacy tests in an isolated environment.
- Convert verified financial examples into framework-independent golden test vectors.
