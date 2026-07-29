# Watchdog EWS — Public Product-Review Mirror (V9 "Midnight Watch")

**DESIGN REVIEW — NOT PRODUCTION.**

This repository is a static, read-only, login-free reproduction of the
**Watchdog V9 "Midnight Watch" display-refinement pass** of Watchdog EWS
("NTX Policy Tracker"), published on the `watchdog-v9-midnight-watch-review`
branch (this repository's `main` branch, which still serves the earlier V8
review build, is untouched) so an outside reviewer — including an AI
reviewer — can navigate the corrected interface directly, on a stable
public hostname, without any relay through screenshots.

Start at **`review-index.html`** — it lists every affected page, fixture
state, and interaction this pass touched, with exact click paths and which
fixture signal demonstrates which state.

## Everything here is fabricated or sanitized

- Every signal, policy matter, source, scanner run, and intelligence
  analysis in this repository is fabricated test data. No real
  organization name, member name, private note, or production database
  row appears anywhere in this repository.
- Every URL referenced in the fixture data uses the IANA-reserved
  `example.com` domain (RFC 2606) — none of them resolve to real
  government or news content.
- There is no login, no database connection, no API key, no secret, and
  no server-side function of any kind in this repository. Every
  "network" call the real product would make (Supabase, Netlify
  Functions, an AI provider) is replaced here with an in-memory fixture
  that resolves instantly from local data and never leaves the browser.
- No production Supabase project URL or publishable key is embedded
  anywhere in this repository, and the `@supabase/supabase-js` CDN
  script is not loaded at all — see "Sanitization" below. Run
  `node sanitization-check.js` to verify this automatically.
- Every write action in the interface (saving a workflow status,
  creating a Policy Matter, importing an "intelligence draft," etc.)
  only mutates an in-memory array in the visiting browser tab. Nothing
  persists past a page reload, and nothing here can reach any real
  system.

## What changed since the V8 mirror

This build reflects the private `watchdog-v9-midnight-watch-implementation`
branch's full Midnight Watch visual identity plus a subsequent
authenticated-review correction pass: a five-tier rounded-rectangle radius
system, a cool (no warm yellow/gold/amber/bronze/copper) priority/status
color system, an individually-bordered rounded primary navigation, a
System dropdown that closes correctly on outside click/Escape/navigation/
Account-opening, a 2×2 Status filter group, corrected Today-page spacing,
a four-state (Connecting/Data Connected/Experiencing Delays/Sync Failed)
data-status indicator, a flex-column Intelligence Workspace dialog shell
with a locked background scroll and a compact mobile title state, a
corrected AI-draft/approved/stale/superseded review-state matrix, empty-
citation suppression, and a split (not one all-caps sentence) long
heading. Issue Brief, Analysis, and Action **content** — what Jason called
"exceptionally strong" — was not simplified, reordered, or regenerated at
any point in this or the prior pass.

## Sanitization (dashboard.js / index.html / auth.js)

An earlier version of this mirror embedded the real product's Supabase
project URL and publishable (anon) key inside `dashboard.js`, and loaded
the real `@supabase/supabase-js` SDK from a CDN in `index.html`. Neither
was ever actually reachable in the mirror (the fixture `auth.js` always
wins the code path that would have used them) but both were removed:

- `dashboard.js`'s `SUPABASE_URL`/`SUPABASE_ANON` constants now hold
  inert placeholders (`review-mirror-fixture.invalid` / a placeholder
  string) — they exist only because one dead fallback branch inside
  `boot()` references the identifiers syntactically; see that file's
  header comment.
- The `@supabase/supabase-js` CDN `<script>` tag is gone from
  `index.html` entirely.
- `auth.js` defines a tiny inert `window.supabase` placeholder (a
  `.createClient()` that throws if ever called) purely so `boot()`'s
  `typeof supabase === 'undefined'` load-failure guard passes — this
  mirror never calls it, since `WatchdogAuth.getClient()` always wins
  first.
- `sanitization-check.js` (see below) fails the build if the real
  hostname, the real key, a service-role-shaped key, the CDN script, or
  any known production API endpoint is ever reintroduced.

## What's in this repository

- `index.html` — the full application shell, with a small
  `position:fixed`, dismissible "REVIEW MIRROR — NOT PRODUCTION" badge
  (bottom-left corner — replaces an earlier sticky full-width banner
  that participated in document flow and threw off header/nav/
  viewport/mobile-dialog spacing relative to the private
  implementation), a link to the review index, and a
  `<meta name="robots" content="noindex, nofollow">` tag
- `dashboard.css` — styling, from the real product's current V9 branch,
  plus small REVIEW-DEMO-ONLY blocks at the end of the file (clearly
  commented) styling the fixture-state control panel and the review
  badge above
- `dashboard.js` — the real product's rendering and interaction logic,
  unmodified except for the sanitized Supabase constants described above
- `editFormLogic.js`, `security.js`, `migration.js` — pure logic/DOM
  helper modules, unmodified from the real product
- `reviewSemantics.js`, `analysisRendering.js` — pure logic modules,
  unmodified from the real product
- `app-boot.js` — page bootstrap, unmodified from the real product
- `fixtures.js` — all fabricated data this mirror displays; extended in
  the prior pass with Approved/Stale/Superseded analysis versions and
  empty/partially-empty citation cases (previously only Draft/Human
  Reviewed existed) so the full review-state matrix is directly visible
- `auth.js`, `repository.js`, `realtime.js` — fixture replacements for
  the real product's Supabase/Netlify-Function-backed equivalents;
  these are the only files that differ in *purpose* from production,
  and they contain no network calls of any kind (see Sanitization above
  for auth.js's inert `window.supabase` placeholder)
- `review-demo.js` — REVIEW DEMO ONLY: adds a small, clearly-labeled
  floating panel with buttons for the four Data Connected states (the
  one required state that can't be reached by just seeding fixture
  data, since it's driven by boot timing rather than content), and
  wires the review badge's dismiss control. Not referenced by the
  private implementation.
- `review-index.html` — the review index: lists every affected page,
  fixture state, and interaction, with exact click paths and which
  fixture signal demonstrates which state.
- `sanitization-check.js` — a small, dependency-free Node script that
  scans every delivered file for production Supabase hosts/keys,
  service-role-shaped keys, the Supabase SDK CDN reference, and known
  Watchdog production API endpoints. Run it with `node sanitization-check.js`;
  it exits non-zero on any match. Run before every commit to this
  repository.
- `robots.txt` — disallows all crawling

No production source code, no Netlify Functions, no environment files,
no Supabase configuration, and no git history from the private
production repository are included here.
