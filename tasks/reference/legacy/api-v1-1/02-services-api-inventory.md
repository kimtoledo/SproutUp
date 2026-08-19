# 02 — Services API Inventory

**Status:** Source-verified method inventory; request/response contracts still need endpoint-by-endpoint extraction.

The services application contains 32 `Service*Controller` files and 164 callable-style endpoint method declarations. Routing exposes multiple URL prefixes over the same controllers.

## Account, identity, and profile

| Controller | Observed operations |
| --- | --- |
| `User` | login/logout, password verification, account details, Facebook login, privileged access-as-user, summary, notices, investor/risk confirmation, contract/terms, voucher/referral flags, user settings, GCash settings, OTP sender |
| `Register` | standard, validation, Facebook, and PitakaMo registration |
| `Password` | update, request reset, verify token, reset |
| `Profile` | acknowledgements, photo/profile/KYC/escrow, dashboard type, documents, references, bank accounts, income/TIN, mobile OTP, onboarding navigation, PitakaMo profile |
| `Security` | security settings, OTP enablement, biometric enablement |
| `Contract` | user contract retrieval |
| `Activity` | activity list and detail |

## Borrowing, credit, campaigns, and investing

| Controller | Observed operations |
| --- | --- |
| `CreditRating` | step validation, invoice detail, apply, QuickBooks pull, Xero pull |
| `Borrow` | applications, fundings, repayments |
| `Loan` | invest, PitakaMo direct invest, filters, detail, confirm held repayment, interest registration, calculator, contract |
| `Investment` | list, detail, cancel, voucher link |
| `AutoInvest` | list/detail, configuration, update/delete, agreement, enablement, industries |
| `Fund` | on-hold list |

## Wallet, requests, and transactions

| Controller | Observed operations |
| --- | --- |
| `Request` | bank top-up, Paynamics confirm/cancel, NUWallet confirm/cancel, withdrawal, Coins.ph withdrawal/top-up, legacy withdrawal, PitakaMo withdrawal |
| `Transaction` | transaction list, additional-credit comment, forced-withdrawal comment |
| `Paynamics` | GET/POST notification callbacks |
| `CoinsPH` | invoice and status check |

## Referral, promotion, and engagement

| Controller | Observed operations |
| --- | --- |
| `Referral` | stats, list, activities, edit/reinvite/add/delete, gamified level stats |
| `Voucher` | available/history, redeem, store, points buyout |
| `Points` | point history and login reward acquisition |
| `Notification` | stats/list/detail, mark read/all read, prompts |

## Content, application, and public settings

| Controller | Observed operations |
| --- | --- |
| `Site` | funded-to-business aggregate, web/mobile settings, homepage loan, donation campaign |
| `Newsflash` | index/detail/list/homepage content |
| `Videos` | index/list |
| `AppInfo` | release changes and change details |
| `ApiInfo` | latest API version |
| `File` | images, profiles, investments, identity, transfer evidence, banners, credit files, factsheets, invoices, loans, contracts, escrow, documents, banks |
| `Contact` | contact-message submission |
| `Env` | environment/application information |
| `Test` | GET/POST test behavior remains in deployable source |

## External accounting callbacks

- `QuickBooks/StoredAuth`
- `Xero/StoredAuth`

## Contract concerns

- The bundled RAML has 18 top-level resources and does not represent all current controller operations.
- Several routes are public by wildcard/prefix, and GET requests bypass shared Basic authentication before token checks.
- Tokens may be accepted as request parameters, including query parameters.
- Response formatting and error codes are custom and not consistently tied to HTTP semantics.
- File endpoints have bespoke authorization and path logic and require a separate security review.
