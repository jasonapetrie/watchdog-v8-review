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

## What changed in the V9 hotfix pass ("remove legacy 'Workspace' migration and correct dialog behavior")

- **Migration assistant removed.** The legacy V3→V4 localStorage
  "Import Your Local Watchdog Workspace" migration dialog, its script
  (`migration.js`), and the boot-time trigger that could open it are all
  gone — it was a retired one-time upgrade utility, not an approved
  ongoing product feature. There is no replacement banner, warning, or
  hidden route; nothing is auto-imported.
- **"Workspace" retired as user-facing product language.** Every
  rendered string that said "Workspace" now says something specific:
  the Account-menu control reads "Download Data Copy" (was "Download
  Workspace Backup"), the Signal Detail tab strip's aria-label reads
  "Signal intelligence," the primary navigation's aria-label reads
  "Primary navigation," the Policy Matter Detail attribution reads
  "Saved to your team's shared Policy Matter data," and shared-data
  load-failure messages name the actual resource (Policy Matter and
  team-coordination data) instead of a generic "shared workspace."
  Internal-only identifiers that were never shown to a user
  (`workflowStore`, `exportWorkspace()`, the `workspace-menu` CSS
  class/`workspaceMenu` element id) were deliberately left alone —
  renaming them added regression risk for zero user-facing benefit.
- **Dialog height fix rescoped to Signal Detail only.** The prior
  hotfix's definite 85vh/85dvh desktop and 92vh/92dvh mobile height
  (needed so Signal Detail's tabbed body never collapses) had been
  applied to every dialog sharing the `.detail-dialog` class. It's now
  scoped to `#detailDialog` (Signal Detail) specifically — Policy
  Matter Detail, Matter Picker, Today's Activity, Glossary, and
  Orientation size to their own content again, capped at the same
  viewport percentage only as a safety ceiling, with `.detail-body`
  scrolling internally if content ever exceeds it.

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
- `sanitization-check.js` (see below) fails if the real hostname, the
  real key, a service-role-shaped key, the CDN script, or any known
  production API endpoint is ever reintroduced.

### The checker's own design

An earlier version of `sanitization-check.js` itself contained the real
production Supabase hostname, the real publishable key, the real
production Netlify hostname, and the real production custom domain as
literal detection patterns — and then excluded its own file from the
scan. That made a "0 violations" result meaningless: the repository
still contained every value the checker claimed was absent, inside the
checker itself.

The corrected design:

- **No self-exclusion.** The checker scans every file in this
  repository, including its own source. If a real production value were
  ever pasted into `sanitization-check.js` again, the checker would
  catch it there too.
- **Generic, structural rules wherever a real production value has a
  detectable shape** — any Supabase project hostname, any publishable
  or secret-shaped Supabase key, any JWT-shaped key, a Supabase SDK
  script tag or version-pinned CDN reference, any Netlify Functions
  endpoint path, any Netlify preview/production hostname. None of these
  rules contain or require the actual Watchdog-specific value to detect
  it — see `sanitization-check.js` itself for the exact patterns.
- **A one-way SHA-256 digest comparison for the one value with no
  generic structural shape** — the production custom domain. Only its
  hash is stored in the checker; the plaintext domain is not written
  anywhere in this repository. The checker extracts every domain-shaped
  token from scanned text and compares its hash against the stored
  digest — a hash cannot be reversed back into the domain that produced
  it.
- **A self-test using only fabricated canary values** (never a real
  Watchdog value, never even a fragment of one) runs before the real
  scan, to prove every rule actually fires. The canaries are assembled
  from split fragments at runtime specifically so they don't sit in the
  checker's own source as one matchable literal — otherwise a self-
  scanning checker could never pass while also self-testing.

Run `node sanitization-check.js`. It prints the self-test result first,
then scans the full repository (including itself) and exits non-zero on
any violation.

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
- `editFormLogic.js`, `security.js` — pure logic/DOM helper modules,
  unmodified from the real product (the legacy `migration.js` module was
  removed from the real product in the V9 hotfix pass — see above — and
  is no longer present here either)
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
  scans every delivered file — including its own source, deliberately,
  no self-exclusion — for production Supabase hosts/keys, service-role-
  shaped keys, the Supabase SDK CDN reference, and known Watchdog
  production API endpoints, using generic structural rules plus a one-
  way SHA-256 digest comparison for the one value with no generic shape
  (see "The checker's own design" above). Runs a fabricated-canary self-
  test first. Run it with `node sanitization-check.js`; it exits non-
  zero on any real violation or on a failed self-test. Run before every
  commit to this repository.
- `robots.txt` — disallows all crawling

No production source code, no Netlify Functions, no environment files,
no Supabase configuration, and no git history from the private
production repository are included here.
