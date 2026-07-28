# Watchdog EWS — Public Product-Review Mirror

**DESIGN REVIEW — NOT PRODUCTION.**

This repository is a static, read-only, login-free reproduction of the
current Watchdog EWS ("NTX Policy Tracker") interface, published solely
so an outside reviewer can navigate the real product's screens and
layout directly, on a stable public hostname, without any relay through
screenshots.

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

## Why some interface behavior looks unfinished or odd

This mirror is a **baseline for review, not an improved version**. It
intentionally preserves several known rendering defects from the real
product exactly as they currently appear (empty "Confirmed Facts"
bullets, a "Not addressed" Why-It-Matters fallback, a truncated
Executive Summary, and others) so a reviewer can evaluate the product as
it actually behaves today, not a cleaned-up version of it.

## What's in this repository

Twelve static files, copied unmodified from the reviewed and verified
Watchdog V8 review mirror, plus this README and an empty `.nojekyll`
(so GitHub Pages serves the files as-is rather than running them
through Jekyll):

- `index.html` — the full application shell, with a visible
  "DESIGN REVIEW — NOT PRODUCTION" banner and a
  `<meta name="robots" content="noindex, nofollow">` tag
- `dashboard.css` — styling, unmodified from the real product
- `dashboard.js` — the real product's rendering and interaction logic,
  unmodified except for one dead constants block (see the comment at
  the top of the file) that used to hold a live database connection
  string
- `editFormLogic.js`, `security.js`, `migration.js` — pure logic/DOM
  helper modules, unmodified from the real product
- `app-boot.js` — page bootstrap, unmodified from the real product
- `fixtures.js` — all fabricated data this mirror displays
- `auth.js`, `repository.js`, `realtime.js` — fixture replacements for
  the real product's Supabase/Netlify-Function-backed equivalents;
  these are the only three files that differ in *purpose* from
  production, and they contain no network calls of any kind
- `robots.txt` — disallows all crawling

No production source code, no Netlify Functions, no environment files,
no Supabase configuration, and no git history from the private
production repository are included here.
