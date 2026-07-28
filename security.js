// Watchdog EWS V4 — security.js
//
// Shared, schema-independent security helpers used by every protected page.
// Nothing here talks to Supabase directly — it is pure DOM-safety and
// presentation-permission logic. Database RLS remains the authoritative
// enforcement layer; everything in this file is a UI convenience only and
// must never be treated as a security boundary by itself.

(function (global) {
  'use strict';

  // ── Safe DOM rendering ──────────────────────────────────────────────
  // Use for any database-supplied text (signal titles, source names,
  // notes, matter titles, usernames, display names, audit descriptions,
  // jurisdictions, categories). Never assign untrusted content to
  // innerHTML directly.

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Sets text content safely (preferred for simple text nodes — avoids
  // the HTML-parsing cost/risk of innerHTML entirely).
  function setText(el, value) {
    if (!el) return;
    el.textContent = value === null || value === undefined ? '' : String(value);
  }

  // For the rare case where a small amount of trusted-shape markup is
  // needed around escaped user content (e.g. "<strong>Mary</strong>
  // changed Matter Status…"), build it from an array of parts instead of
  // string concatenation, so every text segment is escaped and only the
  // literal tags supplied by our own code are ever raw.
  function buildSafeHtml(parts) {
    return parts
      .map((part) => {
        if (part && typeof part === 'object' && 'raw' in part) return part.raw;
        return escapeHtml(part);
      })
      .join('');
  }

  // ── Route protection helpers ────────────────────────────────────────
  // Presentation-only redirects. The actual data access is still gated by
  // RLS regardless of whether these run.

  function redirectToLogin(reason) {
    const params = reason ? '?reason=' + encodeURIComponent(reason) : '';
    global.location.replace('login.html' + params);
  }

  function redirectToApp() {
    global.location.replace('app.html');
  }

  // ── Permission checks (interface presentation only) ─────────────────
  // These mirror the database role matrix so the UI can hide controls a
  // user cannot use — but every write path must still rely on the
  // database to actually reject unauthorized changes. Never treat a
  // "true" from these as proof a write will succeed.

  const ROLE_RANK = { Viewer: 0, Operator: 1, Collaborator: 2, Administrator: 3 };

  function isKnownRole(role) {
    return Object.prototype.hasOwnProperty.call(ROLE_RANK, role);
  }

  function canUsePersonalWorkflow(role) {
    return isKnownRole(role) && role !== 'Viewer';
  }

  function canEditShared(role) {
    return role === 'Administrator' || role === 'Collaborator';
  }

  function canAdminister(role) {
    return role === 'Administrator';
  }

  function canReadProtectedApp(role) {
    return isKnownRole(role);
  }

  const Security = {
    escapeHtml,
    setText,
    buildSafeHtml,
    redirectToLogin,
    redirectToApp,
    canUsePersonalWorkflow,
    canEditShared,
    canAdminister,
    canReadProtectedApp,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Security;
  }
  global.WatchdogSecurity = Security;
})(typeof window !== 'undefined' ? window : globalThis);
