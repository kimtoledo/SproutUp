# UI / UX review

Heuristic evaluation of the four rendered surfaces. Method: SSR HTML inspection for public/auth
pages, full source review of the client components, and cross-checking every rendered field against
the real API payloads captured during testing. **No browser was available**, so anything marked
*(needs browser)* should be re-verified live; the functional defects (F-01, F-15, F-18) were traced
through the exact render path.

Surfaces:
- [apps/web/app/page.tsx](../apps/web/app/page.tsx) — marketing landing
- [apps/web/components/auth-card.tsx](../apps/web/components/auth-card.tsx) — `/login`, `/register`
- [apps/web/app/portal/page.tsx](../apps/web/app/portal/page.tsx) — applicant portal
- [apps/web/app/admin/onboarding/page.tsx](../apps/web/app/admin/onboarding/page.tsx) — compliance queue
- [apps/web/app/admin/role-approvals/page.tsx](../apps/web/app/admin/role-approvals/page.tsx) — maker/checker

---

## What's good

- **Consistent visual language** — one hand-rolled CSS system in `globals.css`, shared status-pill
  classes (`.case-status`, `.status-*`), a common "state screen" pattern (loading / unauthenticated
  / unavailable / forbidden) reused across portal and both admin pages.
- **Permission-driven rendering** — controls only appear when the server-returned permission keys +
  case state allow them, and every action re-hits the server, which is authoritative. Staff links on
  `/portal` appear only for the relevant permission.
- **Honest error copy** — bounded, non-leaking messages mapped from error codes; server exception
  text is never shown.
- **Optimistic-concurrency UX done right** — commands send the displayed version and the list is
  reloaded after every outcome (success *or* conflict), so the user can't act on stale data twice.
- **Reduced-motion + focus-visible** — `@media (prefers-reduced-motion: reduce)` is handled, and
  there are visible `:focus-visible` outlines on the interactive elements.
- **Timeline component** — the immutable case/approval history renders clearly with markers,
  timestamps (localised `en-PH`), version and reason.
- **Landing page degrades** — its content and links are server-rendered and usable without JS.

---

## Issues (severity from [findings.md](findings.md); UX-only items scored here)

### High / functional

| Ref | Surface | Problem |
| --- | --- | --- |
| [F-01](findings.md#f-01) | `/admin/role-approvals` | The **Approval history** panel throws on render (`shortId(undefined)` → `TypeError`) because the API returns `payload: {}`. In prod this drops the whole page to the "temporarily unavailable" state. The single most-broken screen. |
| [F-15](findings.md#f-15) | `/portal` › Active sessions | Every session card's first line (location) renders **blank** — `?? 'Unknown location'` doesn't catch the API's `""`. Looks like a rendering bug to a user. |

### Medium (UX)

| Ref | Surface | Problem |
| --- | --- | --- |
| [F-16](findings.md#f-16) | `/portal` | A **rejected** applicant sees a card that just says "Rejected" + "View history". No plain-language "you were declined", no reason surfaced inline, no "you may re-apply" affordance. "Start journey" silently re-enables with no explanation of what happened. |
| [F-17](findings.md#f-17) | `/portal` | "Resubmit case" after an information request does nothing meaningful — there are no fields to edit. The applicant is asked for information they have no way to provide. |
| [F-18](findings.md#f-18) | `/register` | "I am joining as" is two `aria-pressed` buttons, not radios — weaker for assistive tech and keyboard semantics, and the value isn't in the form (lost if JS fails). |
| — | `/register` vs `/login` | The intent picker, name field, and password hint appear/disappear between modes with no transition and the card height jumps *(needs browser to confirm severity)*. |
| — | `/admin/onboarding` | Filter changes call `setState(null)` which **unmounts the whole queue** back to the full-page "Loading compliance queue…" state on every dropdown change — a heavy flash for a list refresh. A subtle inline spinner would be less disorienting. |
| — | `/admin/role-approvals` | Same `setState(null)` full-panel blank on every history filter change. |
| — | `/admin/role-approvals` | Target user in **pending** and **history** rows is shown only as `Target 7c05f78f` (first 8 hex of the UUID). A reviewer approving a role grant can't see *who* they're granting to without cross-referencing. The pending list has the real `targetUserId` available; resolve it to name/email. (History rows can't even do that — F-01.) |

### Low (polish)

| Ref | Surface | Problem |
| --- | --- | --- |
| [F-19](findings.md#f-19) | `/portal` | "Version 7" (internal lock counter) shown as user-facing copy on case cards. |
| [F-21](findings.md#f-21) | build | Tailwind configured but unused; persistent dev warning. |
| — | `/portal` | Journey "Start" control is a plain link-styled `.text-button`; the disabled state shows "Open case exists" as the button label itself — reads oddly (label doubles as status). Consider a real disabled button + helper text. |
| — | `/portal` | `new Date(x).toLocaleString('en-PH')` runs on the client only (component is `'use client'` and data arrives via `useEffect`), so no hydration mismatch — but if any of this ever moves to SSR it will mismatch. Worth a `suppressHydrationWarning` / fixed formatter when that happens. |
| — | `/admin/onboarding` | "Waiting since {submittedAt}" uses `submittedAt` for `needs_information` too, so the age resets on every resubmit — a case bounced 3× looks "new". Intended aging semantics unclear. |
| — | auth pages | Submit button text goes "Please wait…" with no spinner; `:disabled { cursor: wait }` is the only affordance. |
| — | all | `lucide-react` `1.32.0` — pinned, fine — but icons are decorative and correctly `aria-hidden`. No issue; noted for completeness. |
| — | all | No skip-link, no `<main>` landmark on the admin "state" screens (they render `.portal-state` as `<main>` — OK — but the full pages use a single `<main>` with many sections and no `<h1>` order issues spotted). *(needs browser + AT to confirm)* |

---

## Accessibility quick pass (static)

| Check | Result |
| --- | --- |
| Form labels | PASS — every input is wrapped in a `<label>` with text |
| `autocomplete` on auth fields | PASS — `name`, `email`, `new-password` / `current-password` |
| `required` / `minLength` / `maxLength` | PASS on the markup (server is authoritative) |
| `aria-live` for async errors | PASS — error `<p>` uses `role="alert"` |
| Single-choice control semantics | FAIL — intent picker (F-18) |
| Colour-only status signalling | PARTIAL — status pills pair colour with a text label (good); the `danger-text` integrity warning is colour + text (good) |
| Focus management after route/state change | *(needs browser)* — not obviously handled; e.g. after "Sign in" the router pushes `/portal` but focus isn't moved to the new `<h1>` |
| Keyboard traps / modal focus | N/A — no modals; forms are inline |
| `<noscript>` | FAIL — none anywhere (F-18) |
| Reduced motion | PASS |
| Target size / spacing | *(needs browser)* — `.text-button` actions sit close together in `.case-actions` (gap 16px); check on touch |

---

## Responsive (from CSS only — *needs browser to confirm*)

- `@media (max-width: 760px)` collapses the hero, pillar grid, journey grid, intent picker, admin
  case grid and filters to single-column and drops the header "Portal" link. Looks considered.
- No breakpoint between 760px and the `min(1120px, …)` container — a 800–1100px tablet gets the
  desktop grid in a narrow container; check `.admin-case-main` (4-col grid
  `auto minmax(180px,1fr) auto auto`) doesn't overflow there.
- Tables: none used; lists are flex/grid and should wrap. No horizontal-scroll containers, so verify
  nothing forces body overflow on small screens (long applicant emails in `.admin-case-main`).

---

## Recommendations (priority order)

1. Fix [F-01](findings.md#f-01) — it's a broken production screen and a broken audit view from one
   schema line.
2. Resolve target users to name/email in role-approval rows (pending + history) instead of an
   8-char UUID prefix.
3. Add a proper rejected/closed treatment on `/portal` ([F-16](findings.md#f-16)) and reconsider
   showing "Request information" until there's something to correct ([F-17](findings.md#f-17)).
4. Replace the full-panel `setState(null)` blank on filter changes with an inline loading state.
5. Make the registration intent a real radio group ([F-18](findings.md#f-18)); fix the blank
   session location line ([F-15](findings.md#f-15)); drop user-facing "Version N"
   ([F-19](findings.md#f-19)).
6. Re-run this review in a real browser for the *(needs browser)* items.
