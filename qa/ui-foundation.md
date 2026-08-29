# QA — UI/UX foundation & PWA (slice S0.1)

**Date:** 2026-08-30
**Build under test:** `main` (feat: activate Tailwind design system, component kit, PWA shell)
**Scope:** the design-token layer, the reusable component kit in `apps/web/components/ui/`, the
PWA manifest + service worker + offline route, and the migrated landing / auth surfaces. Portal and
admin surfaces are unchanged in this slice (they migrate with their Phase 1 feature work).

## Automated coverage (added this slice — `npm test`, web workspace)

| Module | File | Asserts |
| --- | --- | --- |
| `cn` class joiner | `components/ui/cn.test.ts` | truthy join, falsy drop, nested-array flatten, trim, empty |
| Button recipe | `components/ui/button-classes.test.ts` | default variant/size, focus ring always present, variant+size selection, `fullWidth`, caller class wins last, disabled styling |
| Field wiring | `components/ui/field-wiring.test.ts` | stable id from prefix+name, omitted slots, `describedBy` order, `aria-invalid` only with an error |
| Badge tones | `components/ui/badge-tone.test.ts` | terminal→danger, in-flight→progress, approved/executed→success, needs_information→attention, **unknown status → neutral (no throw)** |
| Stepper model | `components/ui/stepper-model.test.ts` | done/current/upcoming split, 1-based numbering, index clamped both ends, progress fraction |
| PWA rules | `lib/pwa.test.ts` | precache set, cross-origin → passthrough, non-GET → passthrough, HTML → network-first, build asset → cache-first, unknown → passthrough |

Web suite: 12 files / 60 tests (was 6 / 29). Full `npm run check`: lint + typecheck + 204 tests +
4 builds green; `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities. No new dependencies.

## Manual / heuristic scenarios

| # | Scenario | Expected | Status |
| --- | --- | --- | --- |
| 1 | Load `/` at desktop width | Hero + surface switcher + highlights strip, brand header, single-column body, no horizontal scroll | ✅ build renders; visual spot-check via `next build` route list + source |
| 2 | Load `/` at 375px (mobile) | Hero collapses to one column, switcher cards stack, tap targets ≥44px, no overflow | ✅ by construction (mobile-first `md:` breakpoints, `min-h`/`gap` scale) — **browser check pending** |
| 3 | `/login` and `/register` | Card centered, fields labelled, focus ring visible (amber), submit full-width | ✅ source + build |
| 4 | Register intent picker | Real radio inputs (`name="registrationIntent"`), keyboard arrow-navigable, selected card outlined, posts value with JS off | ✅ `RadioCards` uses `<input type=radio class=sr-only>` inside `<label>` in a `<fieldset><legend>` |
| 5 | Field error state | `aria-invalid=true` on control, error text `role=alert` linked via `aria-describedby` | ✅ `Field` render-prop wiring; unit-tested |
| 6 | `<noscript>` on auth pages | Visible warning when JS disabled | ✅ `Alert tone=warning` inside `<noscript>` in the auth layout |
| 7 | Install prompt (Android/Chrome) | `beforeinstallprompt` fires; manifest `name`, `start_url:/`, `display:standalone`, icon `sizes:any` | ✅ `/manifest.webmanifest` emitted; **device check pending** |
| 8 | Add to Home Screen (iOS Safari) | Standalone launch, status bar styled, title "SproutUp" | ⚠️ `apple-icon.svg` provided; iOS prefers PNG apple-touch — see gap 1 |
| 9 | Service worker registers | In a production build only, after `load`, scope `/`; dev never registers | ✅ `PwaRegister` guards on `NODE_ENV==='production'` + `'serviceWorker' in navigator` |
| 10 | Offline navigation | With SW active and network off, navigating serves the cached shell or `/offline`; **no stale authenticated data** (API is cross-origin, never cached) | ✅ by design (`swStrategy` + `sw.js` only touch same-origin GET) — **device check pending** |
| 11 | SW update | `/sw.js` served `no-cache`; `skipWaiting` + `clients.claim`; old caches deleted on activate | ✅ `next.config.mjs` header + `sw.js` lifecycle |
| 12 | Theme colour | Browser UI chrome uses `#287a4b` on mobile | ✅ `viewport.themeColor` + manifest `theme_color` |
| 13 | Reduced motion | Spinner still animates (acceptable — it is the only motion); page has no parallax/scroll effects | ✅ removed the old `scroll-behavior: smooth` reliance on migrated pages |

## Accessibility checklist (kit)

- Every control from `Field` has a programmatic label (`htmlFor`/`id`).
- Focus is never removed; all interactive elements get `focus-visible:ring-2 ring-ring` (amber, ≥3:1 on white).
- `Alert` uses `role="alert"` for danger/warning, `role="status"` for info/success.
- `Spinner` exposes its label through `role="status"`; the ring is `aria-hidden`.
- `Stepper` sets `aria-current="step"` and an `aria-label` summarising position.
- `RadioCards` is a real radio group; selection is not colour-only (border + inset ring + background).
- Colour tokens carry the same hues the previous CSS used, so no contrast regression on unmigrated screens.

## Known gaps / follow-ups

1. **Raster PWA icons.** Icons are SVG (`sizes:"any"`). Android/Chrome installability is satisfied,
   but iOS home-screen fidelity wants a 180px `apple-touch-icon.png` and Lighthouse PWA wants
   192/512 PNGs. Add rasterised PNGs under `public/pwa/` — tracked here, low priority.
   (Note: `public/icons/` cannot be used — the repo `.gitignore` `Icon?` macOS rule matches the
   `icons` directory name case-insensitively.)
2. **Real browser + device pass.** No browser automation in this environment. Responsive behaviour,
   the install flow, and offline navigation are verified by construction + build, not by a device.
   Run a Lighthouse PWA audit and a manual iOS/Android install once a preview deploy exists.
3. **Render/a11y tests.** Component logic is unit-tested; DOM render + a11y assertions need
   `jsdom` + `@testing-library/react`. Planned as the next slice (S0.1b) before the config primitive.
4. **Portal & admin migration.** `/portal`, `/admin/onboarding`, `/admin/role-approvals` still use
   `app/globals.css` legacy classes. They move onto the kit within their Phase 1 slices; dead CSS is
   removed as each route migrates. F-21 ("Tailwind unused / build warning") is resolved now — the
   warning is gone and the kit is in use.
