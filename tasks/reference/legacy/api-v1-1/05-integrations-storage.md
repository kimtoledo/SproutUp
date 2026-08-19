# 05 — Integrations & Storage

**Status:** Source inventory; provider accounts and production usage are unverified.

## Payment and wallet providers

- **Paynamics:** cash-in request/notification/query flow, API response storage, polling queue, signatures, admin views.
- **Coins.ph:** invoice cash-in, status checking, withdrawal/transfer utilities, callback/state model.
- **NUWallet:** confirmation/cancellation transaction flow.
- **PitakaMo:** partner registration, token-assisted access, direct investing, withdrawal, settlement/request handling.
- **PayPal:** legacy payment/history models and library; earlier review indicates stale/broken behavior.
- **Bank transfer/OCBC:** proof upload, manual approval, reconciliation/reporting, legacy OCBC-specific notices/reports.

## Identity, signing, and communication

- Facebook login/signup SDK integration.
- DocuSign envelope/recipient tracking and signed/unsigned contract storage.
- SMS abstraction with Twilio and legacy provider selection through settings.
- SendGrid and SwiftMailer email paths with queue/log/template support.
- Telegram operational alerts across security and transaction flows.
- APNS and FCM push libraries; push behavior appears partially disabled/archived.

## Accounting and data providers

- Xero OAuth/data/invoice models and background libraries.
- QuickBooks OAuth/data models and a large vendored legacy SDK including examples/dev utilities.
- Google API client is declared in the shared Composer manifest.

## File/document storage

The repository defines separate directories for profile photos, identity, KYC/documents, escrow evidence, bank transfer proof, bank documents, credit-rating attachments, factsheets, loan files, invoices, contracts, media, banners, and promotion images.

`BucketLib`/`BucketFile` indicate optional object-storage behavior controlled by feature flags. Local upload directories are also present, and file endpoints implement custom lookup/download/image-resize behavior.

## Integration decisions for revamp

- MVP 1: manual bank transfer, one SMS provider, one email provider, secure object storage, e-signature if legally required, and operational alerting.
- MVP 2: select one automated Philippine payment provider after commercial/technical review.
- MVP 3: Xero/QuickBooks and partner channels only with a current business case.
- Retire provider SDK examples/dev scripts from deployable artifacts.
- Store secrets in a managed secret store; rotate any credential that has been committed or logged.
- Verify callbacks using signatures, timestamps/nonces, idempotency, source validation where appropriate, and reconciliation—not callback payload alone.
