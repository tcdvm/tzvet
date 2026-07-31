# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension ("tcvet Extension" / TZVet) for ezyVet, a veterinary practice-management web app. It runs on `https://*.ezyvet.com/*` and provides:

- **Lab trends**: scrapes lab result tables out of a patient's clinical notes DOM, normalizes/canonicalizes panel and test names per-tenant, stores them per-patient, and renders them as a trend table in a dedicated full-page tab (`src/trends`).
- **Page UI tweaks** injected via content script: normalize species labels (e.g. `Canine (Dog)` → `Canine`), collapse the page header, and replace slow-loading qtip tooltips with a placeholder/first-content-only version.

All settings are per-user toggles stored in `chrome.storage.sync`; extracted lab data lives in `chrome.storage.local` (persisted, keyed by patient id) and `chrome.storage.session` (one-off payload for the trends page to consume, keyed by a generated `labTrends:<timestamp>-<rand>` id).

## Commands

```
npm run dev       # vite dev server with CRX plugin (hot-reload into a loaded unpacked extension)
npm run build     # prepare-build.js (clean dist/) -> vite build -> generate-icons.js -> check-build.js
npm run preview   # vite preview
npm run clean     # remove dist/
npm run lint      # eslint . --ext .js
npm test          # node ./scripts/check-build.js — sanity-checks dist/ AFTER a build; does NOT run the unit tests below
```

**`npm test` is not the real test suite** — it only validates that `dist/` exists and looks installable (has a manifest, a service worker loader, and no `localhost` dev URLs baked in). It must be run after `npm run build`. The actual unit tests live in `tests/` and are run directly, since neither is wired into a package.json script:

```
node tests/extract-lab-trends.test.mjs   # plain node + assert; tests parseRowTextForTest()
npx jest tests/manifest.test.js          # jest; checks src/manifest.json shape
```

To load the extension for manual testing: `npm run build`, then in Chrome go to `chrome://extensions`, enable Developer mode, "Load unpacked", select `dist/`.

## Architecture

### Manifest and build

- `src/manifest.json` is the real, live manifest — it's what ships. `public/manifest.json` is a stale/unused template left over from scaffolding (different name/version/permissions, uses `<all_urls>`); don't edit it expecting it to take effect. `vite.config.js` explicitly prefers `src/manifest.json` when both exist, and its dev-server plugin watches that file and regenerates PNG icons from matching SVGs (via `sharp`) when it changes.
- Vite entry points (`vite.config.js` `rollupOptions.input`) are fixed and multi-page: `sidepanel/index.html`, several `sidepanel/howtos/*.html`, `options/options.html`, `trends/index.html`, plus `content-script.js` and `service-worker.js` as script entries.
- Icons: SVG sources live in `public/icons/`; `scripts/generate-icons.js` rasterizes them to PNG (128/48/16) into `dist/icons/` as part of `npm run build`.
- Styling is Tailwind v4 + daisyUI (theme: `bumblebee`), configured through `postcss.config.js`/`tailwind.config.js`, with hand-written extras in `src/styles.css` (the `lab-*` classes driving the trends table/panels, and `.sidepanel*` layout).

### Runtime pieces and how they talk to each other

- **`src/service-worker.js`** is the gatekeeper. `isAllowedUrl()` restricts everything to `https://*.ezyvet.com` (or the bare root domain). On tab update/activation it enables/disables the side panel per-tab via `chrome.sidePanel.setOptions`. On install/startup it seeds default trend-filter settings (`trendsDisablePanels`/`trendsDisableTests`) into `chrome.storage.sync` without clobbering existing user values. Also answers a `PING` message with badge feedback, used for connectivity checks.
- **`src/content-script.js`** is injected into ezyVet pages and owns three independent, storage-driven, MutationObserver-based features (species-label normalization, header collapse, qtip placeholder) that each self-initialize from `chrome.storage.sync` and react live to `chrome.storage.onChanged`. It also handles the `EXTRACT_LAB_TRENDS` runtime message: calls `extractLabTrends()`, then merges the result into `chrome.storage.local.labTrendsByPatient[patientId]`, de-duplicating observations by a joined-field signature (panel/testName/collectedAt/valueRaw/unit/lowestValue/highestValue/qualifier).
- **`src/sidepanel/sidepanel.js`** is the main control surface (toggles for the content-script features, "extract lab trends" button, per-patient stored-trends list, opens the trends page). Because the content script may not be injected yet (e.g. page loaded before install), it uses a send-message-with-inject-retry pattern rather than assuming `chrome.tabs.sendMessage` succeeds.
- **`src/options/options.js`** is a simple settings page for editing `trendsDisablePanels`/`trendsDisableTests` (newline-delimited lists) in `chrome.storage.sync`.

### Lab trend extraction pipeline (the core logic)

- **`src/trends/lab-tenant-profiles.js`** — multi-tenant configuration. `getTenantProfile(hostname)` resolves a tenant (`utcvm` is `DEFAULT_TENANT_ID`; `tamu` is the other) from the page hostname, and returns per-tenant DOM selectors, panel-name alias groups, test-name alias groups (used to canonicalize raw scraped labels to `CANONICAL_PANEL_DISPLAY_NAMES`/`CANONICAL_TEST_DISPLAY_NAMES`), and `parsingOverrides` (TAMU has a custom `extractPanelFromLines` override; UTCVM uses the generic parser).
- **`src/trends/extract-lab-trends.js`** — tenant-agnostic scraping/parsing engine. Walks the clinical-notes DOM table, isolates rows containing nested result tables, parses row header text (date, reference, panel, species) and each nested row (test name, value, unit, low/high, qualifier), then canonicalizes names via the resolved tenant profile. Exports `extractLabTrends()` (entry point used by the content script) and `parseRowTextForTest()` (test-only export used by `tests/extract-lab-trends.test.mjs`).
- **TAMU-specific behavior is documented in detail in `docs/devnotes.md`** — read it before touching TAMU parsing. Key point: unlike the generic flow, TAMU derives the panel name from the text following a `Reference: US...-DR...` line, and if that fails, the row is **dropped entirely** rather than falling back to generic parsing.
- **`src/trends/trends.js`** — the trends page UI (`src/trends/index.html`). Reads the one-shot extraction payload from `chrome.storage.session` and/or persisted per-patient data from `chrome.storage.local.labTrendsByPatient`, applies the tenant's disable-lists and unit normalization (`UNIT_NORMALIZATION_MAP`), and renders per-panel (CBC/Chemistry/Urinalysis/Other) trend tables with filtering/display options persisted to `chrome.storage.sync`.
- Sample scraped HTML for manual/offline inspection lives in `src/trends/__fixtures__/` (not wired into the automated tests).

### Multi-tenant scope note

`src/manifest.json` currently grants host permissions/content-script matches for all of `*.ezyvet.com`, but `docs/privacy.md` still describes only the UTCVM tenant/host specifically — keep that in mind if updating either file, since they're currently out of sync in scope.
