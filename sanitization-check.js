'use strict';

/**
 * Watchdog EWS — PUBLIC REVIEW MIRROR — sanitization check.
 *
 * Zero dependencies, deliberately — this is a small static repository,
 * not an application, so a testing framework would be disproportionate.
 * Scans every delivered file in this repository (everything except
 * .git/, node_modules/, and this script's own source) for production
 * Supabase configuration, service-role-shaped secrets, the Supabase SDK
 * CDN reference, and known Watchdog production API endpoints. Exits
 * non-zero — and prints exactly what matched, in which file, on which
 * line — the moment any of those is found.
 *
 * Run: node sanitization-check.js
 *
 * Run this before every commit to this repository. It is the durable,
 * automated backstop for the "no production configuration in the public
 * mirror" rule — not a substitute for reviewing a diff before
 * committing, but a check that can't be forgotten or skipped by
 * accident the way a manual review step can.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SELF = path.basename(__filename);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.netlify']);

// ── What counts as a violation ─────────────────────────────────────
const RULES = [
  {
    name: 'real Supabase project hostname (specific, known project)',
    pattern: /hoyovnrdwgvotvzaxbla\.supabase\.co/g,
  },
  {
    name: 'any Supabase project hostname (general pattern — catches a different real project too)',
    pattern: /\b[a-z0-9-]+\.supabase\.co\b/gi,
  },
  {
    name: 'the real Watchdog publishable key',
    pattern: /sb_publishable_zSDg5rH_nGYlhOK1LpCeGw_7sZ2Labg/g,
  },
  {
    name: 'a Supabase service-role-shaped key (sb_secret_... format)',
    pattern: /sb_secret_[A-Za-z0-9_-]+/g,
  },
  {
    name: 'a JWT-shaped key (legacy Supabase anon/service-role format — three base64url segments)',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: 'the @supabase/supabase-js CDN script being loaded',
    pattern: /supabase-js@\d/g,
  },
  {
    name: 'a Netlify Functions path (production API endpoint shape)',
    pattern: /\/\.netlify\/functions\//g,
  },
  {
    name: 'the production Netlify site hostname',
    pattern: /ntxwatchdogszn\.netlify\.app/g,
  },
  {
    name: 'the production custom domain',
    pattern: /monitorntxpolicytracker\.com/g,
  },
];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

let violations = 0;
const files = walk(ROOT, []).filter((f) => path.basename(f) !== SELF);

for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable — nothing to scan as text
  }
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = text.split(/\r\n|\n/);
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text))) {
      const upToMatch = text.slice(0, match.index);
      const lineNo = upToMatch.split(/\r\n|\n/).length;
      violations++;
      console.log(`FAIL - ${rule.name}\n       ${rel}:${lineNo}  "${match[0]}"`);
      if (!rule.pattern.global) break; // safety: avoid infinite loop on a non-global regex
    }
  }
}

if (violations === 0) {
  console.log(`PASS - scanned ${files.length} files, 0 violations`);
  process.exit(0);
} else {
  console.log(`\n${violations} violation(s) found across ${files.length} files scanned.`);
  process.exit(1);
}
