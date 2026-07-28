# Watchdog EWS — Public Product-Review Mirror (V8)

**DESIGN REVIEW — NOT PRODUCTION.**

This repository is a static, read-only, login-free reproduction of the
**Watchdog V8 product-simplification pass** of Watchdog EWS ("NTX Policy
Tracker"), published solely so an outside reviewer can navigate the
product's screens and layout directly, on a stable public hostname,
without any relay through screenshots.

This build reflects the `watchdog-v8-product-simplification` branch —
review semantics corrected, all documented V7.1 Analysis-tab rendering
defects fixed, Today/Intelligence/Action reorganized around the
decisions a Government Affairs Director actually needs to make, and
interface residue (the six-tile metric wall, the Review Progress wall,
the misleading "Jurisdictions" metric, card-level quick actions, the
permanent sync banner) removed. See this repository's commit history and
the private repository's `watchdog-v8-product-simplification` branch for
the complete change list.

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
- Every write action in the interface (saving a workflow status,
  creating a Policy Matter, importing an "intelligence draft," etc.)
  only mutates an in-memory array in the visiting browser tab. Nothing
  persists past a page reload, and nothing here can reach any real
  system.

## What changed since the V7.1 baseline mirror

The previous version of this mirror deliberately preserved seven
documented V7.1 rendering defects (empty "Confirmed Facts" bullets, a
"Not addressed" Why-It-Matters fallback, a truncated Executive Summary,
`insufficient_evidence` rendering identically to "no organizational
position established," and others) as a baseline for review. This V8
build is the corrected product: those defects are fixed here, using the
same underlying data shapes a real signal_intelligence_analyses row
actually has — nothing about the fixture data was simplified to make the
fixes look better than they'd behave on a real saved analysis. Opening a
signal also no longer marks it "Reviewed" by itself; that now requires
an explicit "Mark Reviewed" action, reachable from the Action tab.

## What's in this repository

Fourteen static files, built from the reviewed and verified Watchdog V8
branch, plus this README and an empty `.nojekyll` (so GitHub Pages
serves the files as-is rather than running them through Jekyll):

- `index.html` — the full application shell, with a visible
  "DESIGN REVIEW — NOT PRODUCTION" banner and a
  `<meta name="robots" content="noindex, nofollow">` tag
- `dashboard.css` — styling, from the real product's V8 branch
- `dashboard.js` — the real product's rendering and interaction logic,
  unmodified except for one dead constants block (see the comment at
  the top of the file) that used to hold a live database connection
  string
- `editFormLogic.js`, `security.js`, `migration.js` — pure logic/DOM
  helper modules, unmodified from the real product
- `reviewSemantics.js` — new in V8: pure logic distinguishing "viewed" a
  signal from "reviewed" it (see the file header for the full rule)
- `analysisRendering.js` — new in V8: pure logic backing every corrected
  Analysis-tab rendering defect (confirmed facts, evidence gaps, position
  pathway distinction, executive summary, why-this-matters, recommended
  next step, governance) — each function documents which V7.1 defect it
  fixes and why the fix needs no database schema change
- `app-boot.js` — page bootstrap, unmodified from the real product
- `fixtures.js` — all fabricated data this mirror displays, including a
  sanitized reconstruction of a real manual-pilot-imported analysis with
  a full original-response shape (`usage_metadata.raw_imported_response`)
  so the V8 fixes render exactly as they would against a genuine row
- `auth.js`, `repository.js`, `realtime.js` — fixture replacements for
  the real product's Supabase/Netlify-Function-backed equivalents;
  these are the only three files that differ in *purpose* from
  production, and they contain no network calls of any kind
- `robots.txt` — disallows all crawling

No production source code, no Netlify Functions, no environment files,
no Supabase configuration, and no git history from the private
production repository are included here.
