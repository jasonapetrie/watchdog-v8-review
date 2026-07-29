'use strict';

/**
 * Watchdog EWS — PUBLIC REVIEW MIRROR — sanitization check.
 *
 * Zero dependencies, deliberately — this is a small static repository,
 * not an application, so a testing framework would be disproportionate.
 * Scans every delivered file in this repository — INCLUDING ITS OWN
 * SOURCE, deliberately, so this file can never become the place a real
 * production value hides — for production Supabase configuration,
 * service-role-shaped secrets, the Supabase SDK CDN reference, and
 * known Watchdog production API endpoints.
 *
 * Correction (self-exclusion fix): an earlier version of this script
 * contained the real production Supabase hostname, the real
 * publishable key, the real production Netlify hostname, and the real
 * production custom domain as literal detection patterns, then
 * excluded itself from the scan — meaning the repository still
 * contained every one of the values the script claimed were absent.
 * Every detection rule below is now either:
 *   (a) fully generic (a structural pattern — "any *.supabase.co
 *       hostname," "any sb_publishable_* key" — that matches the real
 *       value without ever containing it), or
 *   (b) for the one value with no generic structural shape at all (the
 *       production custom domain), a one-way SHA-256 digest comparison
 *       — the plaintext domain is never written anywhere in this
 *       repository, only a hash of it, and a hash cannot be reversed
 *       back into the domain it came from.
 * No exact production value — no fragment, no reversible encoding, no
 * comment — exists anywhere in this file or this repository.
 *
 * Run: node sanitization-check.js
 *
 * Run this before every commit to this repository. It is the durable,
 * automated backstop for the "no production configuration in the
 * public mirror" rule.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.netlify']);

// ── Generic, structural detection rules — none of these contain or
// require the actual production value to detect it. ──────────────────
const GENERIC_RULES = [
  { name: 'any *.supabase.co hostname', pattern: /\b[a-z0-9-]+\.supabase\.co\b/gi },
  { name: 'any sb_publishable_* key', pattern: /\bsb_publishable_[A-Za-z0-9_-]+\b/g },
  { name: 'any sb_secret_* key', pattern: /\bsb_secret_[A-Za-z0-9_-]+\b/g },
  { name: 'a JWT-shaped key (three base64url segments)', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  // Deliberately narrower than "any mention of the package name" — this
  // repository's own documentation legitimately explains, in prose,
  // that the Supabase SDK CDN script was removed (see README.md), and
  // that sentence must not itself be flagged as if it were the SDK
  // being loaded. This only matches an actual <script src="..."> tag
  // referencing the SDK package, or a version-pinned CDN-style
  // reference (package name immediately followed by "@" and a version
  // digit) — the two shapes a real load would take.
  { name: 'a Supabase SDK script tag or version-pinned CDN reference', pattern: /<script[^>]*\bsrc=["'][^"']*supabase-js[^"']*["']|supabase-js@\d/gi },
  // Rule name deliberately does not spell out the literal path shape in
  // plain English (a prior version's rule name read "any /.netlify/
  // functions/ path" and matched its own pattern's plain-text name once
  // self-exclusion was removed).
  { name: 'Netlify Functions endpoint pattern', pattern: /\/\.netlify\/functions\//g },
  { name: 'any *.netlify.app hostname', pattern: /\b[a-z0-9-]+\.netlify\.app\b/gi },
];

// ── Hash-based rule — for the one production value (the custom domain)
// that has no generic structural shape a regex could target without
// also matching countless unrelated real-world domains. Only a SHA-256
// digest of the known-bad value is stored; the plaintext is never
// written here. Detection works by extracting every domain-shaped token
// from the scanned text and hashing each one for comparison — the
// digest algorithm and the extraction pattern are both generic; only
// the specific hash below is Watchdog-specific, and a hash cannot be
// reversed back into the domain that produced it. ─────────────────────
const HOSTNAME_TOKEN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const KNOWN_BAD_DOMAIN_SHA256 = new Set([
  'a284fb30c6801befecb71e4795f71eed5f52274410f203e559304c444fe03693', // production custom domain (see README's Sanitization section)
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value.toLowerCase()).digest('hex');
}

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

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r\n|\n/).length;
}

// Scans one file's text against every rule; returns a list of
// {ruleName, line, matchPreview} violations. Shared by both the real
// scan and the self-test below, so the self-test exercises the exact
// same code path the real scan uses — not a reimplementation of it.
function scanText(text) {
  const found = [];

  for (const rule of GENERIC_RULES) {
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(text))) {
      found.push({ ruleName: rule.name, line: lineNumberAt(text, m.index), matchPreview: m[0] });
    }
  }

  HOSTNAME_TOKEN_PATTERN.lastIndex = 0;
  let hm;
  while ((hm = HOSTNAME_TOKEN_PATTERN.exec(text))) {
    const digest = sha256(hm[0]);
    if (KNOWN_BAD_DOMAIN_SHA256.has(digest)) {
      found.push({ ruleName: 'known-bad hostname (SHA-256 digest match)', line: lineNumberAt(text, hm.index), matchPreview: hm[0] });
    }
  }

  return found;
}

function scanRepository() {
  const files = walk(ROOT, []);
  let violations = 0;
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // binary/unreadable — nothing to scan as text
    }
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    for (const v of scanText(text)) {
      violations++;
      console.log(`FAIL - ${v.ruleName}\n       ${rel}:${v.line}  "${v.matchPreview}"`);
    }
  }
  return { files: files.length, violations };
}

// ── Self-test: fabricated canary values only — never a real Watchdog
// production value, never even a fragment of one. Proves each rule
// actually fires (a checker that silently matches nothing is worse than
// no checker) before the real scan's "0 violations" is trusted. ───────
function runSelfTest() {
  // Every canary is assembled from split, non-matching fragments at
  // runtime, not written as one contiguous literal — otherwise this
  // self-test's own fabricated values would themselves be flagged the
  // moment scanRepository() scans this file's source text (which it
  // now does, deliberately — see the header comment). This is not
  // "hiding a production value" (rule 4 in the correction ticket): none
  // of these fragments correspond to any real credential; splitting
  // them is purely so the self-test can coexist with a self-scanning
  // checker. The join() calls below produce the exact same full strings
  // a real violation would look like, so the rules are still tested
  // against their real target shape, not a diluted approximation.
  const j = (...parts) => parts.join('');
  const canary = [
    j('https://canary-project-id', '.supabase', '.co'),
    j('sb_publishable_', 'CANARY0000000000000000000000'),
    j('sb_secret_', 'CANARY0000000000000000000000'),
    j('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJjYW5hcnkiOnRydWV9', '.', 'CANARYSIGNATURE0000000000'),
    j('<script src="https://cdn.example.test/', 'supabase-js', '@', '2', '"></script>'),
    j('/', '.netlify', '/functions/', 'canary-endpoint'),
    j('canary-review-mirror-selftest', '.netlify', '.app'),
  ].join('\n');

  const genericHits = scanText(canary);
  const genericOk = GENERIC_RULES.every((rule) => genericHits.some((h) => h.ruleName === rule.name));

  // Hash-mechanism self-test: a fabricated domain, hashed and checked
  // against a FABRICATED digest set built only for this test — never
  // the real KNOWN_BAD_DOMAIN_SHA256 set, so the real domain's
  // plaintext is never needed here either.
  const fabricatedDomain = 'canary-fake-production-domain-for-selftest.example';
  const fabricatedDigestSet = new Set([sha256(fabricatedDomain)]);
  const extracted = fabricatedDomain.match(HOSTNAME_TOKEN_PATTERN) || [];
  const hashMechanismOk = extracted.some((tok) => fabricatedDigestSet.has(sha256(tok)));

  return { genericOk, genericHitCount: genericHits.length, hashMechanismOk };
}

// ── Run ─────────────────────────────────────────────────────────────
console.log('── Self-test (fabricated canaries only) ──');
const selfTest = runSelfTest();
console.log(`Generic rules all fired: ${selfTest.genericOk} (${selfTest.genericHitCount} canary matches)`);
console.log(`Hash-comparison mechanism verified: ${selfTest.hashMechanismOk}`);
if (!selfTest.genericOk || !selfTest.hashMechanismOk) {
  console.log('\nFAIL - self-test did not detect its own fabricated canaries; the checker cannot be trusted. Not running the repository scan.');
  process.exit(1);
}

console.log('\n── Repository scan (including this file itself — no self-exclusion) ──');
const result = scanRepository();
if (result.violations === 0) {
  console.log(`PASS - scanned ${result.files} files, 0 violations`);
  process.exit(0);
} else {
  console.log(`\n${result.violations} violation(s) found across ${result.files} files scanned.`);
  process.exit(1);
}
