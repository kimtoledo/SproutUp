# 21 — Borrower & Investor Portal Journeys

**Status:** WIP  
**Outcome:** Borrowers and investors can complete the controlled-pilot lifecycle through coherent, accessible, state-driven portal experiences.

## Implementation progress

- **2026-08-19 — Onboarding state contract:** Added the shared borrower/investor case statuses and allowed transitions for draft, submission, review, information request/resubmission, approval/rejection, withdrawal, expiry, and reopening.
- The persistence layer versions current state and retains an immutable event timeline, providing the future portal with resumable/server-authoritative workflow state. Portal routes, forms, accessibility behavior, and end-to-end journeys remain; this task stays **WIP**.
- Registration is fixed by the borrower or investor portal and creates only the matching physical
  account class. A normalized email cannot be reused in another portal; dual capacity therefore
  requires a future explicit product/identity policy rather than a role change.
- The portal can now create, list, inspect, and submit its own permitted onboarding case through server-authoritative APIs. Duplicate create and stale submit attempts return explicit conflicts without corrupting state; forms/profile data and UI screens remain.
- Information-request reasons appear in the owned immutable event timeline, and applicants can resubmit the same case using the latest version; profile/evidence correction forms remain unimplemented.
- The portal contract now supports reasoned withdrawal from eligible owned states with optimistic version checks. Stale, unauthorized, in-review, and terminal withdrawal attempts cannot overwrite server state; UI remains unimplemented.
- A reasoned staff rejection now appears as immutable terminal case state and timeline evidence for the owned case projection. Rejection UI/content and any correction/reopen path remain unimplemented.
- Added responsive, keyboard-focus-visible registration and sign-in pages linked from the public landing page. Registration chooses one primary SME borrower/investor journey, password guidance matches the API, and safe loading/error states are present; authenticated portal state and recovery remain unimplemented.
- Added `/portal`, which resolves server session context before owned onboarding cases, renders only permission-granted borrower/investor journey controls, and supports draft creation, exact-version submit/resubmit, and reasoned withdrawal. It includes loading, empty, unavailable, conflict-refresh, session-expiry, sign-out, and responsive states; profile/detail/timeline screens remain.
- Added lazy owned-case history inside the portal with ordered event labels, timestamps, versions, and applicant-visible reasons. Missing/foreign/malformed detail responses use bounded messages; full profile/evidence detail remains unimplemented.
- Staff accounts with the server-granted queue or role-approval capability can navigate from the portal to the matching admin workspace; customer accounts are not shown those entry points.
- **2026-08-20 — Active sessions:** Every authenticated portal account (borrower, investor, or staff) can now see and revoke their own active sessions from `/portal`, with the current device excluded from the revoke control.
- **2026-08-30 — UI foundation & PWA (slice S0.1):** Activated Tailwind with a SproutUp design-token layer (`apps/web/tailwind.config.ts`) and a reusable accessible component kit in `apps/web/components/ui/` (`Button`, `Field`/`Input`/`Textarea`/`Select`, `RadioCards`, `Badge`/`StatusBadge`, `Alert`, `Card`/`Panel`, `Spinner`, `Stepper`, `PageHeading`, `SiteHeader`); each class recipe is a unit-tested pure module. Migrated the landing page and the register/sign-in surfaces onto the kit (mobile-first, visible focus ring, real radio group for the intent picker, `<noscript>` notice). Made the app an installable PWA: web manifest (`display: standalone`), a same-origin-only service worker (HTML network-first, assets cache-first, **API origin never cached**), a `/offline` fallback route, and iOS/Android install metadata. `/portal` still renders on the legacy CSS and migrates onto the kit with its profile/evidence screens (slice S1.2+). Resolves F-21.
- **2026-08-30 — Independent portal marketing/auth surfaces:** Host-aware Admin, Borrower, and
  Investor landing and auth pages now carry distinct positioning, headlines, highlights, and
  fixed account journeys. Borrower/investor subdomains no longer show a cross-account role picker;
  the admin subdomain has no registration path and uses its isolated auth/context/sign-out APIs.
  Recommended local URLs are `admin.lvh.me:3000`, `borrower.lvh.me:3000`, and
  `investor.lvh.me:3000`.
- **2026-08-30 — Independent customer auth runtime:** Borrower and investor web auth now calls only
  its exact namespaced signup/sign-in endpoint, loads the matching account-class session context,
  and signs out/revokes devices through the matching session table. Neutral localhost retains an
  explicit account-type chooser for navigation, but it does not transmit a role or authority field.
  Portal navigation and capability rendering use `accountType` plus server-returned permissions,
  never customer roles.

## Scope

- Public eligibility, product explanation, disclosures, support, registration, login, recovery, and secure session flows.
- Resumable borrower and investor onboarding with progress, validation, document evidence, consent, correction, submission, and decision states.
- Investor marketplace, campaign detail, commitment confirmation, portfolio, repayment/distribution detail, contracts, and statements.
- Borrower application, staff questions, offer acceptance, funding progress, active loan schedule, payment instructions, receipts, and notices.
- Wallet top-up/withdrawal request, transaction history, bank management, notifications, and support entry points.
- Explicit next actions for incomplete, pending, approved, rejected, restricted, expired, overdue, and completed states.
- Philippine terminology and responsive/mobile accessibility.

## Acceptance criteria

- A pilot borrower and investor can complete their full journeys without hidden hash routes or staff-only workarounds.
- Refresh, retry, back navigation, and duplicate submission do not corrupt workflow state.
- All financial confirmations show gross amount, deductions, net amount, effective date, and reference.
- Documents and consents display the exact accepted version and timestamp.
- UI gating never substitutes for API authorization.
- Automated journey tests cover happy paths, corrections, rejection, insufficient funds, concurrency, and session expiry.

## Dependencies

- Tasks 01, 03–14, and 18.
- [Legacy user journey review](../reference/legacy/user/README.md).

## Open decisions

- Supported devices/browsers, bilingual content, borrower/investor dual capacity, notification channels, and assisted-onboarding policy.
