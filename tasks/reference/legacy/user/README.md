# `seedin-live-user` Source Review

**Status:** WIP — static source review  
**Reviewed:** 2026-08-19  
**Branch:** `main`

This is a direct review of the legacy borrower/investor-facing application.

## Snapshot

- Yii `1.1.14` server-rendered website and hash-routed account dashboard.
- 27 page controllers, 18 browser-facing server/proxy controllers, 298 view files, 9 form models, and 27 local common-model files.
- The portal generally proxies commands and queries to `seedin-live-api-v1-1` through `NewunionServiceLib`, but some pages and file/contract paths still use local model or direct HTTP behavior.
- Investor and issuer experiences share one account and dashboard shell.
- Legacy optional features include auto-invest, referrals, points, vouchers, provider top-ups, external accounting capture, and extensive public content.

## Review documents

- [01 — Architecture & API Proxy Boundary](./01-architecture-api-proxy-boundary.md)
- [02 — Registration, Authentication & Onboarding](./02-registration-auth-onboarding.md)
- [03 — Investor Journey](./03-investor-journey.md)
- [04 — Issuer/Borrower Journey](./04-borrower-journey.md)
- [05 — Wallet, Servicing, Rewards & Communications](./05-wallet-servicing-rewards-communications.md)
- [06 — Revamp Impact & Disposition](./06-revamp-impact-disposition.md)

## Interpretation rule

Legacy UI labels and gates are not approved requirements. In particular, Singapore-oriented account types, investor classifications, escrow/OCBC behavior, multi-level referral UI, and legacy repayment products must be reconciled with the Philippine target platform.
