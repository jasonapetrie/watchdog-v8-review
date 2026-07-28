'use strict';

/* ══ WATCHDOG V8 PUBLIC REVIEW MIRROR — no Supabase connection here ══
   The real constants that normally live in this spot are gone. This
   mirror's boot() always resolves window.WatchdogAuth.getClient() first
   (see auth.js in this directory, a fixture), so the line below is dead
   code kept only so boot()'s existing fallback ternary still parses —
   it is never reachable and these are not real values of any kind.    */
const SUPABASE_URL  = 'REVIEW-MIRROR-NO-URL';
const SUPABASE_ANON = 'REVIEW-MIRROR-NO-KEY';

const FOCUS_COUNTIES = ['Collin', 'Hunt', 'Rockwall', 'Van Zandt'];

/* ── State ────────────────────────────────────────────────────── */
let db = null;
var currentUserId = null;   // set by boot(userId); var so it's window-reachable for migration.js and testing
var currentUserRole = null; // set by boot(userId, role) — Administrator | Collaborator | Operator | Viewer
var rawSignals = [];       // focus-county signals as loaded from Supabase, cleaned in place (var: reachable as window.rawSignals for testing/debugging)
var displaySignals = [];   // rawSignals after display-level duplicate suppression (var: same reason)
let duplicatesHidden = 0;
let currentDetailSignal = null;
let currentMatterId = null;
let pendingPromoteSignal = null;
let pendingDismissSignal = null;

/* ══ V4 shared collaboration state — policy_matters, policy_matter_signals,
   and signal_shared_state are shared across every authenticated user
   (unlike workflowStore.records, which stays strictly personal). Loaded
   at boot, kept current via realtime.js, never written to localStorage —
   Supabase is the only source of truth for these. var throughout: keeps
   them window-reachable for testing, same reasoning as rawSignals above. */
var sharedMattersById = {};    // matterId -> local matter shape (defaultMatter() shape, minus signalIds/history which are joined in)
var matterSignalLinks = {};    // matterId -> [signalIdentity, ...], from policy_matter_signals
var sharedStateByIdentity = {}; // signalIdentity -> {leadershipAwareness, committeeAttention, sharedCoordinationNote, updatedBy, updatedAt, createdAt}
var sharedAuditEvents = [];    // raw audit_events rows, scope='Shared', oldest-first
var profilesById = {};         // userId -> {username, displayName, role, isActive}

/* ══ V5 source intelligence — source_registry rows (Source Coverage) and
   Quarantined signals (Quarantine Review). Loaded lazily on first visit
   to each tab, not at boot, since most sessions never open either. Both
   are var for the same window-reachable-for-testing reason as above. */
var sourceRegistryRows = [];
var sourceRegistryLoaded = false;
var quarantinedSignalRows = [];
var quarantineLoaded = false;
var quarantineDisplayRows = [];   // quarantinedSignalRows after the same display-level duplicate suppression as the Signals feed
var quarantineDuplicatesHidden = 0;

/* ══ V5.1 registry-grade tables — same lazy-load-on-first-visit pattern
   as sourceRegistryRows above, one flag/array pair per sub-tab. */
var sourceEndpointRows = [];
var sourceEndpointsLoaded = false;
var reporterWatchRows = [];
var reporterWatchesLoaded = false;
var geographyRuleRows = [];
var geographyRulesLoaded = false;
var specialDistrictRows = [];
var specialDistrictsLoaded = false;

/* ══ V6 hosted operations — scanner_runs / scanner_run_steps. Same
   lazy-load-on-first-visit pattern as the V5.1 tables above. Steps are
   keyed by scanner_run_id so a run card can pull its own per-scanner rows
   without a second round trip per card. ══ */
var scannerRunRows = [];
var scannerRunStepsByRunId = {};
var operationsLoaded = false;
var matterDialogLoadedUpdatedAt = null;   // updated_at of the matter shown in matterDialog when it was opened — for stale-edit detection
var sharedCoordLoadedUpdatedAt = null;    // updated_at of the shared state shown in the detail dialog when it was opened — same purpose

var activeFilters = { // var (not let): keeps this state reachable as window.activeFilters for testing/debugging
  // Primary workspace navigation (V6.1: today/signals/matters/reports are
  // the four work-oriented primary destinations; sourceCoverage/quarantine/
  // operations are reached only via the subordinate System menu — see
  // docs/watchdog-product-language.md).
  primaryView: 'today',         // 'today' | 'signals' | 'matters' | 'reports' | 'sourceCoverage' | 'quarantine' | 'operations'
  signalsSubTab: 'queue',       // 'queue' | 'monitoring' | 'escalated' | 'all'
  mattersArchive: 'active',     // 'active' | 'archive' — V6.1 Active Matters archive toggle (replaces the old standalone "Completed" primary tab)
  completedSubTab: 'closed',    // 'closed' | 'dismissed' | 'resolved-matters' — meaningful only when mattersArchive === 'archive'
  attentionQueue: '',           // '' (tile overview) | one of ATTENTION_QUEUE_DEFS keys — still used by Today's drill-down links

  // Signal filters (shared across every signal-shaped view)
  priority: 'all', county: '', jurisdiction: '', category: '', review: '', recency: '', search: '',
  workflowStatus: '', reviewStateFilter: '', sort: 'newest',

  // Policy Matter filters (Policy Matters view + Completed → Resolved Policy Matters)
  // — trimmed in V3.1 to status/priority/jurisdiction/county/sort only.
  matterCounty: '', matterJurisdiction: '', matterPriority: 'all', matterStatus: '', matterSort: 'default',

  // V5: Administrator-only visibility toggle — the Signals feed excludes
  // Suppressed/Quarantined records by default (see recomputeDisplaySet()).
  showSuppressedQuarantined: false,

  // V5 Source Coverage filters (own namespace — this view does not share
  // the signal-shaped filter fields above).
  scSearch: '', scCounty: '', scJurisdiction: '', scSourceType: '', scSourceLane: '',
  scPriority: '', scReliability: '', scMonitoringMethod: '', scActive: '',

  // V5.1: which Source Coverage sub-tab is active, and the shared search
  // box for the non-Organizations sub-tabs (endpoints/reporters/districts/
  // exclusions/health each have too few fields to warrant their own
  // dedicated filter set, so they share one simple text search).
  scSubTab: 'organizations', scSearch2: '',
};

/* ── Text cleanup: HTML-entity decoding + whitespace normalization ──
   A detached <textarea> is used because its content is parsed as
   RCDATA — no child elements or scripts are ever created, so this is
   safe to run on untrusted scraped text. The decoded result is later
   re-escaped by esc() before it touches innerHTML. Records in
   Supabase are never modified. */
const _decodeEl = document.createElement('textarea');
function decodeEntities(str) {
  if (!hasVal(str)) return '';
  _decodeEl.innerHTML = str;
  return _decodeEl.value;
}
function normalizeWhitespace(str) {
  return str.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}
function clean(str) {
  return normalizeWhitespace(decodeEntities(str));
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function hasVal(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

function isSafeUrl(url) {
  if (!hasVal(url) || url === '#') return false;
  try {
    const u = new URL(url, window.location.href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

/* V6.1 (product-clarity §11): every user-facing date/time is shown in
   Central Time, not the viewer's device timezone — Watchdog tracks Texas
   government activity, so "today"/"due today"/"detected" must agree with
   Central Time regardless of where a GAD happens to be logged in from. */
const CENTRAL_TZ = 'America/Chicago';

function relativeDate(iso) {
  if (!hasVal(iso)) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diffH = (Date.now() - d.getTime()) / 36e5;
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: CENTRAL_TZ });
}

function absoluteDate(iso) {
  if (!hasVal(iso)) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CENTRAL_TZ, timeZoneName: 'short' });
}

function dateOnly(iso) {
  if (!hasVal(iso)) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: CENTRAL_TZ });
}

/* Explicit "Detected [age]" wording for signal cards (V3.2 §4): "today",
   "1d ago", "16d ago" — never a bare, unlabeled day count. Calendar-day
   based on the CENTRAL-TIME calendar date (not the hour, and not the
   viewer's own device timezone) so it agrees with the app's other
   "today" concepts (Due Today, Reviewed Today, etc). */
function centralCalendarDayNumber(d) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return new Date(Number(map.year), Number(map.month) - 1, Number(map.day)).getTime();
}
function detectedAgeLabel(iso) {
  if (!hasVal(iso)) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diffDays = Math.round((centralCalendarDayNumber(new Date()) - centralCalendarDayNumber(d)) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays < 30) return `${diffDays}d ago`;
  return dateOnly(iso);
}

/* Clean truncation for long titles in compact contexts (Today's Activity
   list) — cuts on a word boundary where practical rather than mid-word. */
function truncateText(str, max) {
  if (!hasVal(str) || str.length <= max) return str || '';
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function normalizedPriority(s) {
  // Real data uses High / Medium / Monitor. Support legacy 'Low' as an alias for Monitor.
  const p = s.priority || s.severity || '';
  return p === 'Low' ? 'Monitor' : p;
}

function isFocusCounty(s) {
  return FOCUS_COUNTIES.includes(s.county);
}

function cap(v) { return hasVal(v) ? v.charAt(0).toUpperCase() + v.slice(1) : v; }

function isGenericStage(stage) {
  return !hasVal(stage) || stage.trim().toLowerCase() === 'signal';
}

/* Strip a trailing " - Source Name" / " – " / " — " / " | " suffix from a
   title when it exactly matches the record's own source name. The stored
   title is never modified — this only affects what's rendered. */
function stripTrailingSource(title, source) {
  if (!hasVal(title) || !hasVal(source)) return title;
  const escapedSrc = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`[\\s]*[-–—|][\\s]*${escapedSrc}\\s*$`, 'i');
  return re.test(title) ? title.replace(re, '').trim() : title;
}

/* A snippet/summary that is identical to (or a truncation of) the title
   carries no new information and should not be shown. */
function isSnippetRedundant(cleanTitle, snippetText) {
  const t = cleanTitle.toLowerCase();
  const s = snippetText.toLowerCase();
  if (!s) return true;
  if (s === t) return true;
  if (t.startsWith(s) || s.startsWith(t)) return true;
  return false;
}

/* ── Prepare: attach cleaned/derived fields to a raw record once ──── */
function prepareSignal(s) {
  const cSource = clean(s.source);
  const cTitleRaw = clean(s.title) || clean(s.snippet) || 'Untitled signal';
  s._c = {
    priority: normalizedPriority(s),
    title: cTitleRaw,
    cleanTitle: stripTrailingSource(cTitleRaw, cSource),
    snippet: clean(s.snippet),
    summary: clean(s.summary),
    source: cSource,
    category: clean(s.category),
    subcategory: clean(s.subcategory),
    jurisdiction: clean(s.jurisdiction),
    county: clean(s.county),
    stage: clean(s.stage),
    reviewStatus: clean(s.review_status),
    confidenceLevel: clean(s.confidence_level),
    confidenceReason: clean(s.confidence_reason),
    whyMatters: clean(s.why_matters),
    meetingBody: clean(s.meeting_body),
    staffContact: clean(s.staff_contact),
    relatedIssues: clean(s.related_issues),
    dismissedReason: clean(s.dismissed_reason),
    matchedKeywords: Array.isArray(s.matched_keywords) ? s.matched_keywords.map(clean).filter(hasVal) : [],
  };
  return s;
}

/* ── Conservative display-level duplicate suppression ─────────────
   Records are never deleted or modified — this only decides which
   single record represents a duplicate group in the rendered feed.  */
function completenessScore(s) {
  const fields = [
    s.title, s.snippet, s.summary, s.why_matters, s.category, s.subcategory,
    s.stage, s.confidence_level, s.confidence_reason, s.url, s.source,
    s.published_at, s.agenda_date, s.meeting_body, s.staff_contact,
    s.priority_level, s.related_issues,
  ];
  let score = fields.filter(hasVal).length;
  if (s.is_verified_public_source) score++;
  if (s.is_member_signal) score++;
  if (Array.isArray(s.matched_keywords) && s.matched_keywords.length) score++;
  return score;
}

/* Canonicalize a URL for duplicate comparison: lowercase host, drop the
   www. prefix, drop the fragment, drop common tracking params, drop a
   trailing slash — but never touch path/query case or content, since
   some feeds (e.g. Google News redirect tokens) are case-sensitive and
   otherwise-meaningful. Returns '' for missing/unparseable URLs so
   callers can require hasVal() before comparing. */
const TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']);

function canonicalHostname(url) {
  if (!hasVal(url)) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch { return ''; }
}

function canonicalizeUrl(url) {
  if (!hasVal(url)) return '';
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    const kept = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const qs = kept.map(([k, v]) => `${k}=${v}`).join('&');
    return host + path + (qs ? '?' + qs : '');
  } catch {
    return url.trim();
  }
}

/* Calendar-day distance, independent of the viewer's local timezone
   (dates are compared at UTC day granularity) so dedup results are
   deterministic regardless of who is looking at the page. */
function utcDayNumber(iso) {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function calendarDaysApart(isoA, isoB) {
  return Math.abs(utcDayNumber(isoA) - utcDayNumber(isoB)) / 86400000;
}

/* Two records are duplicates when either:
   (A) both have a non-empty canonical URL and those URLs match, or
   (B) normalized title + jurisdiction + source all match AND the dates
       corroborate — same/near publication date, or (when publication
       date data is too thin to compare) detection dates close together
       for records confirmed to share a source hostname or have exactly
       one missing publication date. Deliberately conservative: distinct
       sources, jurisdictions, or time-distant records never merge. */
function isDuplicatePair(a, b) {
  const curlA = canonicalizeUrl(a.url), curlB = canonicalizeUrl(b.url);
  if (hasVal(curlA) && hasVal(curlB) && curlA === curlB) return true;

  const tA = a._c.cleanTitle.toLowerCase(), tB = b._c.cleanTitle.toLowerCase();
  const jA = a._c.jurisdiction.toLowerCase(), jB = b._c.jurisdiction.toLowerCase();
  const sA = a._c.source.toLowerCase(), sB = b._c.source.toLowerCase();
  if (!(hasVal(tA) && tA === tB)) return false;
  if (!(hasVal(jA) && jA === jB)) return false;
  if (!(hasVal(sA) && sA === sB)) return false;

  const pubA = a.published_at, pubB = b.published_at;
  if (hasVal(pubA) && hasVal(pubB) && calendarDaysApart(pubA, pubB) <= 3) return true;

  const pubMissingCount = (hasVal(pubA) ? 0 : 1) + (hasVal(pubB) ? 0 : 1);
  const detA = a.detected_at, detB = b.detected_at;
  if (pubMissingCount === 1 && hasVal(detA) && hasVal(detB) && calendarDaysApart(detA, detB) <= 3) return true;

  const hostA = canonicalHostname(a.url), hostB = canonicalHostname(b.url);
  if (hasVal(hostA) && hostA === hostB && hasVal(detA) && hasVal(detB) && calendarDaysApart(detA, detB) <= 3) return true;

  return false;
}

function dedupe(list) {
  const n = list.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (isDuplicatePair(list[i], list[j])) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(list[i]);
  }

  const display = [];
  let hidden = 0;
  for (const group of groups.values()) {
    if (group.length === 1) { display.push(group[0]); continue; }
    hidden += group.length - 1;
    let best = group[0];
    let bestScore = completenessScore(best);
    for (let i = 1; i < group.length; i++) {
      const score = completenessScore(group[i]);
      const better = score > bestScore ||
        (score === bestScore && new Date(group[i].detected_at || 0) > new Date(best.detected_at || 0));
      if (better) { best = group[i]; bestScore = score; }
    }
    display.push(best);
  }
  return { display, hidden };
}

/* V5: the Signals feed excludes Suppressed and Quarantined records by
   default — NULL disposition (not yet validated by the backfill) is
   treated as visible, same as Accepted, so nothing that existed before
   V5 validation disappears until it's actually been classified.
   Administrator-only escape hatch: activeFilters.showSuppressedQuarantined. */
function visibleForSignalsFeed(s) {
  if (activeFilters.showSuppressedQuarantined) return true;
  return s.validation_disposition !== 'Suppressed' && s.validation_disposition !== 'Quarantined';
}

function recomputeDisplaySet() {
  const { display, hidden } = dedupe(rawSignals.filter(visibleForSignalsFeed));
  display.sort((a, b) => new Date(b.detected_at || 0) - new Date(a.detected_at || 0));
  displaySignals = display;
  duplicatesHidden = hidden;
}

/* ══════════════════════════════════════════════════════════════════
   OPERATOR WORKFLOW + POLICY MATTERS (V3) — local-only, localStorage-
   backed. Nothing in this section ever writes to Supabase. All of it
   is scoped to this browser and lost if local storage is cleared; see
   Export/Import for a manual portability path.

   Signal-level concepts, deliberately not conflated:
   - Review State (automatic, derived): Unreviewed / Reviewed, driven
     by reviewedAt — set the moment a signal's detail is opened, or the
     moment any operator action is saved (quick action or form save).
     Never operator-selectable.
   - Workflow Status (operator-selectable): blank/unassigned by default,
     or one of exactly Monitoring / Action Required / Closed / Dismissed.

   Policy Matters are a separate local record type (workflowStore.matters)
   that one or more signals can be attached to.
   ══════════════════════════════════════════════════════════════════ */
const WORKFLOW_STORAGE_KEY = 'watchdogEwsWorkflowV1'; // stable key across versions; shape/version field evolves inside
const WORKFLOW_STATUSES = ['Monitoring', 'Action Required', 'Closed', 'Dismissed']; // selectable options only
const VALID_STORED_STATUSES = ['', ...WORKFLOW_STATUSES]; // '' = unassigned (the default)
const ACTIVE_STATUSES = ['Monitoring', 'Action Required'];
const COMPLETED_STATUSES = ['Closed', 'Dismissed'];
const QUEUE_STATUSES = [''];
const RESPONSE_LEVELS = [0, 1, 2, 3, 4];
const COMMITTEE_ATTENTION_VALUES = ['None', 'Requested', 'Scheduled', 'Reviewed'];
const WORKFLOW_HISTORY_CAP = 25;

const MATTER_STATUSES = ['Monitoring', 'Action Required', 'Resolved'];
const MATTER_PRIORITIES = ['High', 'Medium', 'Monitor'];
const MATTER_HISTORY_CAP = 50;

var workflowStore = { version: 3, records: {}, matters: {} }; // var (not let): keeps this state reachable as window.workflowStore for testing/debugging

/* Migrates a single stored signal record from the pre-V3 status
   vocabulary (New / In Review / Relevant / Monitoring / Action Required /
   Closed / Dismissed) to the current one. Every other field — notes,
   history, dates, response level, etc. — passes through untouched. Runs
   once, the first time a legacy record is loaded; the migrated shape is
   persisted immediately so it's a no-op on every subsequent load. */
function migrateWorkflowRecord(rec) {
  const status = rec.status;
  let newStatus = status;
  if (status === 'New' || status === 'In Review') {
    newStatus = '';
  } else if (status === 'Relevant') {
    const hasOperatorSignal = hasVal(rec.followUpDate) || hasVal(rec.nextAction) || hasVal(rec.note) ||
      (rec.responseLevel !== null && rec.responseLevel !== undefined);
    newStatus = hasOperatorSignal ? 'Monitoring' : '';
  } else if (!VALID_STORED_STATUSES.includes(status)) {
    newStatus = ''; // defensive fallback for any other unrecognized legacy value
  }
  if (newStatus === status) return rec;
  const now = new Date().toISOString();
  return {
    ...rec,
    status: newStatus,
    history: [...(rec.history || []), { at: now, summary: `Status: ${hasVal(status) ? status : '—'} → ${hasVal(newStatus) ? newStatus : '—'} (automatic migration to updated status model)` }].slice(-WORKFLOW_HISTORY_CAP),
  };
}

/* Loads (and, if needed, migrates) the whole local workspace: signal
   workflow records to the current status vocabulary, and — new in V3 —
   ensures a `matters` object exists without touching any existing
   signal records. Idempotent: a store already on version 3 with a
   `matters` object and no legacy statuses is returned unchanged and is
   not re-written to localStorage. */
function loadWorkflowStore() {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (!raw) return { version: 3, records: {}, matters: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.records !== 'object' || parsed.records === null) {
      return { version: 3, records: {}, matters: {} };
    }
    const migratedRecords = {};
    let anyMigrated = false;
    for (const [key, rec] of Object.entries(parsed.records)) {
      const migrated = (rec && typeof rec === 'object') ? migrateWorkflowRecord(rec) : rec;
      if (migrated !== rec) anyMigrated = true;
      migratedRecords[key] = migrated;
    }
    const hadMatters = parsed.matters && typeof parsed.matters === 'object' && !Array.isArray(parsed.matters);
    const existingMatters = hadMatters ? parsed.matters : {};
    const shapeChanged = anyMigrated || parsed.version !== 3 || !hadMatters;
    const store = { version: 3, records: migratedRecords, matters: existingMatters };
    if (shapeChanged) {
      try { localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(store)); } catch { /* migrated in memory even if persisting fails */ }
    }
    return store;
  } catch (err) {
    console.error('Could not read local workflow state, starting fresh:', err);
    return { version: 3, records: {}, matters: {} };
  }
}

function persistWorkflowStore() {
  try {
    localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(workflowStore));
  } catch (err) {
    console.error('Failed to save workflow state locally:', err);
    showToast('Could not save locally — this browser’s storage may be full or disabled.');
  }
}

/* ══ V4: personal signal decisions (workflowStore.records) are Supabase-
   backed (public.signal_user_state) once authenticated — see
   loadWorkflowStoreForUser()/saveWorkflow() below. Policy Matters
   (sharedMattersById) and Leadership Awareness / Committee Attention /
   Shared Coordination Note (sharedStateByIdentity) are ALSO Supabase-
   backed as of this pass (shared, not personal — see repository.js's
   policy_matters/signal_shared_state functions). The only thing left in
   this per-user local cache is personal per-signal activity history,
   since signal_user_state has no history column and personal history is
   client-synthesized — namespaced per authenticated user id so a
   different user signing in on this browser never sees it. The old
   global WORKFLOW_STORAGE_KEY is left untouched (legacy-import source
   and, pre-authentication, the fallback store). */
function userCacheKey(userId) { return 'watchdogEwsV4Cache_' + userId; }

function loadUserScopedCache(userId) {
  try {
    const raw = localStorage.getItem(userCacheKey(userId));
    if (!raw) return { overflow: {} };
    const parsed = JSON.parse(raw);
    return { overflow: (parsed && typeof parsed.overflow === 'object' && parsed.overflow) || {} };
  } catch (err) {
    console.error('Could not read local cache, starting fresh:', err);
    return { overflow: {} };
  }
}

function saveUserScopedOverflow(userId, key, rec) {
  const cache = loadUserScopedCache(userId);
  cache.overflow[key] = { history: rec.history || [] };
  try {
    localStorage.setItem(userCacheKey(userId), JSON.stringify(cache));
  } catch (err) {
    console.error('Failed to save local cache:', err);
  }
}

function clearUserScopedCacheInMemory() {
  // Deliberately does NOT delete the persisted localStorage cache — that
  // is this same user's own personal activity history, namespaced by
  // their user id, so a different user signing in on this browser never
  // sees it regardless. This clears the in-memory copy of both personal
  // and shared state, as an explicit, defensive step ahead of the full-
  // page navigation Sign Out always performs (that navigation alone
  // already tears down all DOM/JS state). Shared state isn't personal
  // data, but clearing it too avoids a moment of stale shared content
  // being visible before the next signed-in user's own boot() re-fetches.
  workflowStore = { version: 4, records: {} };
  sharedMattersById = {};
  matterSignalLinks = {};
  sharedStateByIdentity = {};
  sharedAuditEvents = [];
  profilesById = {};
  currentUserId = null;
  currentUserRole = null;
}

/* Populates workflowStore for an authenticated session: signal_user_state
   rows from Supabase (the source of truth for personal decisions) merged
   with this browser's per-user cache (matters + the not-yet-synced
   overflow fields). Returns { store, syncOk } — syncOk is false only when
   the remote fetch itself failed, so the caller can be honest in the UI
   about whether personal decisions are actually loaded. */
async function loadWorkflowStoreForUser(userId) {
  if (!userId) return { store: loadWorkflowStore(), syncOk: false };

  const cache = loadUserScopedCache(userId);
  let remoteRecords = {};
  let syncOk = true;
  try {
    remoteRecords = await window.WatchdogRepository.fetchMySignalUserState(userId);
  } catch (err) {
    console.error('Could not load personal workspace from Supabase:', err);
    syncOk = false;
  }

  const records = {};
  for (const [key, remote] of Object.entries(remoteRecords)) {
    records[key] = { ...defaultWorkflow(), ...remote, ...(cache.overflow[key] || {}) };
  }
  for (const [key, overflow] of Object.entries(cache.overflow)) {
    if (!records[key]) records[key] = { ...defaultWorkflow(), ...overflow };
  }

  return { store: { version: 4, records }, syncOk };
}

/* Fetches every shared-collaboration collection at once and rebuilds the
   in-memory caches from scratch — used at boot and on every realtime
   change. Simpler and safer than incremental patching at this scale. */
async function loadSharedCollaborationState() {
  const [matterRows, linkRows, sharedRows, auditRows, profileRows] = await Promise.all([
    window.WatchdogRepository.fetchPolicyMatters(),
    window.WatchdogRepository.fetchPolicyMatterSignals(),
    window.WatchdogRepository.fetchSignalSharedState(),
    window.WatchdogRepository.fetchSharedAuditEvents(),
    window.WatchdogRepository.fetchAllProfiles(),
  ]);

  const byId = {};
  for (const m of matterRows) byId[m.id] = m;
  sharedMattersById = byId;

  const links = {};
  for (const link of linkRows) {
    if (!links[link.matter_id]) links[link.matter_id] = [];
    links[link.matter_id].push(link.signal_identity);
  }
  matterSignalLinks = links;

  sharedStateByIdentity = sharedRows;
  sharedAuditEvents = auditRows;

  const profiles = {};
  for (const p of profileRows) {
    profiles[p.id] = { username: p.username, displayName: p.display_name, role: p.role, isActive: p.is_active };
  }
  profilesById = profiles;
}

// A save's own audit_events row is never in sharedAuditEvents yet at the
// moment the save resolves (it was only just fetched via
// loadSharedCollaborationState() before the change was made) — without
// this, the record just changed would show stale/missing history until
// the next realtime-triggered refresh. Called at the end of every
// successful shared write below so history is accurate immediately.
async function refreshSharedAuditEvents() {
  try {
    sharedAuditEvents = await window.WatchdogRepository.fetchSharedAuditEvents();
  } catch (err) {
    console.error('Could not refresh shared activity history:', err);
  }
}

// V8 Part 3: quiet by default. A successful sync shows nothing at all —
// it no longer competes with the header for attention with a permanent
// full-width banner. Only a real sync failure becomes visible, and only
// then, as a compact error indicator.
function updateSyncBanner(synced) {
  const badge = document.getElementById('connBadge');
  if (!badge) return;
  badge.hidden = !!synced;
  if (!synced) {
    const textEl = document.getElementById('connBadgeText');
    if (textEl) textEl.textContent = 'Could not sync your workspace — showing signals without your saved decisions';
  }
}

/* Drives the "saved" indicator inside the signal detail dialog
   (wf-saved-note). Quick actions and the dismiss dialog use showToast()
   for their own Saving/Saved/Error feedback instead, since the detail
   dialog isn't open in those flows. */
function setSaveState(state) {
  const el = document.getElementById('wfSavedNote');
  if (!el) return;
  if (state === 'saving') { el.textContent = 'Saving…'; el.style.color = ''; }
  else if (state === 'saved') { el.textContent = 'Saved to your account.'; el.style.color = ''; }
  else if (state === 'error') { el.textContent = 'Could not save — check your connection and try again.'; el.style.color = '#ff9d9d'; }
  // V8 correction: a Save that changed nothing substantive is reported
  // honestly as a no-op, not silently treated the same as "Saved."
  else if (state === 'nochange') { el.textContent = 'No changes to save.'; el.style.color = ''; }
}

/* Stable identity for a displayed (deduplicated) signal, reusing the
   same canonicalization/normalization signals as duplicate detection:
   canonical URL when present, otherwise a normalized
   title+jurisdiction+source+date composite, otherwise the raw row id.
   Known limitation: if a later, more-complete duplicate with a
   different URL becomes the group's representative, the identity can
   change and previously saved workflow state (and Policy Matter
   attachments, which key off the same identity) may not carry over —
   acceptable for a local-only prototype, called out in the project
   report rather than solved with a persistent group-id scheme here. */
function signalIdentity(s) {
  const curl = canonicalizeUrl(s.url);
  if (hasVal(curl)) return 'u:' + curl;
  const c = s._c;
  const dateKey = hasVal(s.published_at) ? localDateStr(new Date(s.published_at))
    : (hasVal(s.detected_at) ? localDateStr(new Date(s.detected_at)) : '');
  if (hasVal(c.cleanTitle) && hasVal(c.jurisdiction) && hasVal(c.source) && hasVal(dateKey)) {
    return 'a:' + [c.cleanTitle.toLowerCase(), c.jurisdiction.toLowerCase(), c.source.toLowerCase(), dateKey].join('|');
  }
  return 'id:' + s.id;
}

// NOTE: localDateStr() deliberately stays on the browser's own local
// timezone, unchanged — it feeds signalIdentity()'s dateKey (see below),
// which is the stable key every signal_user_state/signal_shared_state/
// policy_matter_signals row is keyed by. Changing its timezone basis
// would silently shift that key for signals near a day boundary and
// orphan existing personal/shared records for anyone not physically in
// Central Time. Live "is this today" UI comparisons (Due Today, Reviewed
// Today, etc. — nothing persisted) use centralDateStr() below instead,
// per product-clarity §11's Central Time requirement.
function centralDateStr(d) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CENTRAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultWorkflow() {
  return {
    status: '', responseLevel: null,
    note: '', nextAction: '', followUpDate: null, dismissalReason: null,
    reviewedAt: null, closedAt: null, dismissedAt: null,
    history: [], createdAt: null, updatedAt: null,
  };
}

function getWorkflow(s) {
  const rec = workflowStore.records[signalIdentity(s)];
  return rec ? { ...defaultWorkflow(), ...rec } : defaultWorkflow();
}

/* Review State is derived, never stored as its own selectable field. */
function reviewState(wf) {
  return hasVal(wf.reviewedAt) ? 'Reviewed' : 'Unreviewed';
}

/* V8 review semantics (docs/watchdog-v8-review-mirror.md's Part 1 fix):
   opening a signal's detail view is a VIEW only — see viewSignal() in
   reviewSemantics.js, called from openDetail() — and never reaches this
   function. This function backs the explicit "Mark Reviewed" control
   shown only while a signal is still unreviewed. A no-op past the first
   call (idempotent, no duplicate history spam on repeat clicks). Saving
   any substantive operator action (form Save) also marks Reviewed, as a
   byproduct inside saveWorkflow() below — the second of the two
   "explicitly marked OR acted on" triggers; opening alone is neither.

   V8 correction (pre-review pass): Mark Reviewed is an explicit human
   decision, so it is now a genuinely awaited save, not fire-and-forget —
   this function does not touch workflowStore (the in-memory cache) or
   resolve until the repository call actually succeeds, and it THROWS on
   failure rather than swallowing the error into a console.error. The
   caller (the Mark Reviewed click handler below) is what disables the
   control, shows a Saving state, and only presents success once this
   promise actually resolves — never optimistically. */
async function markReviewed(s) {
  const prev = getWorkflow(s);
  if (hasVal(prev.reviewedAt)) return prev; // idempotent — nothing to persist, nothing changed
  const now = new Date().toISOString();
  const next = window.WatchdogReviewSemantics.applyMarkReviewed(prev, now, WORKFLOW_HISTORY_CAP);
  const key = signalIdentity(s);

  if (!currentUserId) {
    workflowStore.records[key] = next;
    persistWorkflowStore();
    return next;
  }

  const repId = s.id ?? null;
  // Awaited, not fire-and-forget: workflowStore is only updated once this
  // actually succeeds, so a failure leaves the previous (unreviewed)
  // in-memory state completely untouched — nothing to roll back.
  await window.WatchdogRepository.saveSignalUserState(currentUserId, key, repId, next);
  workflowStore.records[key] = next;
  saveUserScopedOverflow(currentUserId, key, next);
  return next;
}

function isOverdueFollowUp(wf) {
  if (!hasVal(wf.followUpDate)) return false;
  if (COMPLETED_STATUSES.includes(wf.status)) return false;
  return wf.followUpDate < centralDateStr(new Date());
}
function isDueTodayFollowUp(wf) {
  if (!hasVal(wf.followUpDate)) return false;
  if (COMPLETED_STATUSES.includes(wf.status)) return false;
  return wf.followUpDate === centralDateStr(new Date());
}

const WORKFLOW_FIELD_LABELS = {
  status: 'Status', responseLevel: 'Response Level', note: 'Operator Note', nextAction: 'Next Action',
  followUpDate: 'Follow-Up Date', dismissalReason: 'Dismissal Reason',
};

function defaultSharedState() {
  return { leadershipAwareness: null, committeeAttention: 'None', sharedCoordinationNote: '', updatedBy: null, updatedAt: null, createdAt: null };
}

function getSharedState(s) {
  const rec = sharedStateByIdentity[signalIdentity(s)];
  return rec ? { ...defaultSharedState(), ...rec } : defaultSharedState();
}

function describeWorkflowChanges(prev, next) {
  const out = [];
  for (const key of Object.keys(WORKFLOW_FIELD_LABELS)) {
    const a = prev[key] ?? '';
    const b = next[key] ?? '';
    if (String(a) !== String(b)) {
      out.push(`${WORKFLOW_FIELD_LABELS[key]}: ${hasVal(a) ? a : '—'} → ${hasVal(b) ? b : '—'}`);
    }
  }
  return out;
}

// V8 correction (pre-review pass): a Save must only ever do something —
// mark Reviewed, bump updatedAt, add history, persist — when at least
// one of the six substantive workflow fields actually changed. The diff
// is computed FIRST, from the real prev/candidate values, via the same
// describeWorkflowChanges() used for the history summary — a no-change
// Save can never disagree with what the history would have said changed.
async function saveWorkflow(s, patch) {
  const key = signalIdentity(s);
  const prev = getWorkflow(s);
  const candidateNext = { ...prev, ...patch };
  // V8 correction (pre-review pass): the diff is computed BEFORE any
  // review semantics are applied, using the same pure, directly-tested
  // decision reviewSemantics.js exposes for exactly this question — not
  // inferred from "Save was clicked." describeWorkflowChanges() below is
  // only for the human-readable history text; hasSubstantiveWorkflowChange()
  // is the authoritative yes/no gate.
  const hasChange = window.WatchdogReviewSemantics.hasSubstantiveWorkflowChange(prev, candidateNext);

  if (!hasChange) {
    // Nothing substantive changed: no reviewedAt, no updatedAt, no
    // history entry, no persistence call of any kind — a true no-op.
    setSaveState('nochange');
    return { noChanges: true, workflow: prev };
  }

  const now = new Date().toISOString();
  const next = { ...candidateNext };
  const changeSummary = describeWorkflowChanges(prev, candidateNext);
  // Saving a substantive workflow decision counts as review too (V8 Part 1)
  // — opening the signal alone no longer does (see viewSignal() in
  // reviewSemantics.js, used by openDetail()). Deliberately not included in
  // WORKFLOW_FIELD_LABELS / the diff summary above — it would otherwise add
  // a noisy "Reviewed: — → …" line to every single history entry, including
  // the very first save.
  next.reviewedAt = window.WatchdogReviewSemantics.applyReviewedOnSubstantiveSave(prev, now, hasChange).reviewedAt;
  // Closed/Dismissed timestamps: derived, not operator-selectable, and (like
  // reviewedAt) deliberately excluded from WORKFLOW_FIELD_LABELS so they
  // don't double up with the "Status: … → Closed" history line.
  next.closedAt = next.status === 'Closed' ? (prev.status === 'Closed' ? prev.closedAt : now) : null;
  next.dismissedAt = next.status === 'Dismissed' ? (prev.status === 'Dismissed' ? prev.dismissedAt : now) : null;
  next.history = [...prev.history, { at: now, summary: changeSummary.join('; ') }].slice(-WORKFLOW_HISTORY_CAP);
  next.updatedAt = now;
  next.createdAt = prev.createdAt || now;

  if (!currentUserId) {
    // Defensive fallback — should not happen once authenticated (app.html
    // always resolves a verified user id before boot()), but keeps the
    // function usable rather than throwing if it somehow did.
    workflowStore.records[key] = next;
    persistWorkflowStore();
    return next;
  }

  setSaveState('saving');
  try {
    const repId = s.id ?? null;
    await window.WatchdogRepository.saveSignalUserState(currentUserId, key, repId, next);
    workflowStore.records[key] = next;
    saveUserScopedOverflow(currentUserId, key, next);
    setSaveState('saved');
    return next;
  } catch (err) {
    console.error('Failed to save personal workflow to Supabase:', err);
    setSaveState('error');
    throw err;
  }
}

/* V8 card simplification (see docs/watchdog-v8-component-inventory.md):
   the entire card opens the signal — there is no card-level quick-action
   button of any kind anymore. Review and Create Matter both used to live
   here; both now live only inside the Signal Intelligence Workspace
   (Action tab), reached by opening the signal, so a card is never a
   mixed click target of "open" vs. "act." */

function openDismissDialog(s) {
  pendingDismissSignal = s;
  document.getElementById('dismissReasonInput').value = '';
  document.getElementById('dismissError').hidden = true;
  document.getElementById('dismissDialog').showModal();
}
function closeDismissDialog() {
  document.getElementById('dismissDialog').close();
  pendingDismissSignal = null;
}
async function confirmDismiss() {
  if (!pendingDismissSignal) return;
  const reason = document.getElementById('dismissReasonInput').value.trim();
  const errEl = document.getElementById('dismissError');
  if (!reason) {
    errEl.textContent = 'A dismissal reason is required.';
    errEl.hidden = false;
    document.getElementById('dismissReasonInput').focus();
    return;
  }
  errEl.hidden = true;
  const confirmBtn = document.getElementById('dismissConfirmBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Saving…';
  try {
    await saveWorkflow(pendingDismissSignal, { status: 'Dismissed', dismissalReason: reason });
  } catch {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Dismiss';
    errEl.textContent = 'Could not save — check your connection and try again.';
    errEl.hidden = false;
    return; // dialog stays open, the typed reason is preserved
  }
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Confirm Dismiss';
  showToast('Marked Dismissed.');
  refreshOverviewPanels();
  closeDismissDialog();
  renderMain();
}

/* ══ Policy Matters ══════════════════════════════════════════════ */
function generateMatterId() {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ══ V4: Policy Matters are shared, Supabase-backed (public.policy_matters
   + public.policy_matter_signals) — Administrator/Collaborator write,
   Operator/Viewer read-only (RLS-enforced; canEditShared() below is a
   presentation-only mirror of that, never the real boundary). No local
   storage of any kind for matters anymore; sharedMattersById/
   matterSignalLinks are the in-memory cache, populated at boot and kept
   current by realtime.js. History comes from Shared-scope audit_events,
   not a locally-synthesized array — see matterHistoryFor() below. ══════ */

function defaultMatter() {
  return {
    id: '', title: '', category: '', jurisdiction: '', county: '',
    status: 'Monitoring', priority: 'Monitor', nextAction: '', followUpDate: null, notes: '',
    assignedOwnerId: null, createdBy: null, updatedBy: null,
    createdAt: null, updatedAt: null, resolvedAt: null,
    signalIds: [], history: [],
  };
}

function getMatter(id) {
  const m = sharedMattersById[id];
  if (!m) return null;
  return { ...defaultMatter(), ...m, signalIds: matterSignalLinks[id] || [], history: matterHistoryFor(id) };
}
function allMatters() { return Object.keys(sharedMattersById).map(getMatter); }
function activeMatters() { return allMatters().filter(m => m.status !== 'Resolved'); }
function resolvedMatters() { return allMatters().filter(m => m.status === 'Resolved'); }

async function createMatter(fields) {
  const created = await window.WatchdogRepository.createPolicyMatter(fields);
  sharedMattersById[created.id] = created;
  matterSignalLinks[created.id] = [];
  await refreshSharedAuditEvents();
  return getMatter(created.id);
}

// expectedUpdatedAt enables the stale-edit check in repository.js — pass
// the updated_at the caller last loaded so a conflicting concurrent edit
// from another user is reported (staleConflict) instead of silently
// overwritten. Callers that don't have one loaded (e.g. a resolve/reopen
// quick action from a card, not an open form) pass null and skip the check.
async function saveMatter(id, patch, expectedUpdatedAt) {
  const prev = sharedMattersById[id];
  if (!prev) return null;
  const updated = await window.WatchdogRepository.updatePolicyMatter(id, patch, expectedUpdatedAt);
  sharedMattersById[id] = updated;
  await refreshSharedAuditEvents();
  return getMatter(id);
}

async function attachSignalToMatter(matterId, signalIdent, representativeSignalId) {
  const m = sharedMattersById[matterId];
  if (!m) return null;
  const links = matterSignalLinks[matterId] || [];
  if (links.includes(signalIdent)) return getMatter(matterId);
  await window.WatchdogRepository.attachSignalToMatterRemote(matterId, signalIdent, representativeSignalId === undefined ? null : representativeSignalId);
  matterSignalLinks[matterId] = [...links, signalIdent];
  await refreshSharedAuditEvents();
  return getMatter(matterId);
}

async function detachSignalFromMatter(matterId, signalIdent) {
  const m = sharedMattersById[matterId];
  const links = matterSignalLinks[matterId] || [];
  if (!m || !links.includes(signalIdent)) return m ? getMatter(matterId) : null;
  await window.WatchdogRepository.detachSignalFromMatterRemote(matterId, signalIdent);
  matterSignalLinks[matterId] = links.filter(x => x !== signalIdent);
  await refreshSharedAuditEvents();
  return getMatter(matterId);
}

function mattersForSignal(s) {
  const ident = signalIdentity(s);
  return allMatters().filter(m => m.signalIds.includes(ident));
}

/* ── Human-readable attribution ──────────────────────────────────────
   Built from Shared-scope audit_events + the profiles roster, never from
   raw IDs. Only 'created' and 'updated' actions are attributable to a
   specific record from the event alone — 'deleted' Matter Signal Link
   events (a signal removed from a matter) carry only the link row's own
   id in entity_id, not the matter_id, so they cannot be reliably tied
   back to a specific matter's history after the fact without a database
   change; skipped here rather than guessed at. This is a known,
   deliberate limitation, not an oversight. */
function resolveDisplayName(userId) {
  if (!userId) return 'Someone';
  const p = profilesById[userId];
  return (p && p.displayName) || 'A team member';
}

const MATTER_COLUMN_LABELS = {
  title: 'Title', issue_category: 'Issue Category', jurisdiction: 'Jurisdiction', county: 'County',
  matter_priority: 'Matter Priority', next_action: 'Next Action', follow_up_date: 'Follow-Up Date', notes: 'Notes',
};
const SHARED_STATE_COLUMN_LABELS = {
  committee_attention: 'Committee Attention', shared_coordination_note: 'Shared Coordination Note',
};

function renderMatterFieldChange(col, oldVal, newVal, actor) {
  if (col === 'assigned_owner_id') {
    return hasVal(newVal) ? `${actor} assigned the matter to ${resolveDisplayName(newVal)}.` : `${actor} unassigned this matter.`;
  }
  if (col === 'matter_status') {
    if (newVal === 'Resolved') return `${actor} resolved this matter.`;
    if (oldVal === 'Resolved') return `${actor} reopened this matter.`;
    return `${actor} changed Matter Status from ${hasVal(oldVal) ? oldVal : '—'} to ${hasVal(newVal) ? newVal : '—'}.`;
  }
  const label = MATTER_COLUMN_LABELS[col];
  if (!label) return null; // unrecognized/internal column — skip rather than show a raw column name
  const fmt = (v) => (col === 'follow_up_date' && hasVal(v)) ? dateOnly(v) : (hasVal(v) ? v : '—');
  return `${actor} changed ${label} from ${fmt(oldVal)} to ${fmt(newVal)}.`;
}

// Returns 0+ human-readable lines for one audit_events row (a single
// update can touch multiple columns — each gets its own sentence, all
// attributed to the same actor).
function formatAttributedLines(e) {
  const actor = resolveDisplayName(e.actor_user_id);
  if (e.entity_type === 'Policy Matter') {
    if (e.action === 'created') return [`${actor} created this Policy Matter.`];
    if (e.action !== 'updated') return [];
    return Object.entries(e.changed_fields || {})
      .map(([col, diff]) => renderMatterFieldChange(col, diff.old, diff.new, actor))
      .filter(Boolean);
  }
  if (e.entity_type === 'Signal Shared State') {
    if (e.action === 'created') return [`${actor} added Shared Coordination for this signal.`];
    if (e.action !== 'updated') return [];
    const out = [];
    for (const [col, diff] of Object.entries(e.changed_fields || {})) {
      if (col === 'leadership_awareness_required') {
        const ov = diff.old === true ? 'Yes' : diff.old === false ? 'No' : '—';
        const nv = diff.new === true ? 'Yes' : diff.new === false ? 'No' : '—';
        out.push(`${actor} updated Leadership Awareness from ${ov} to ${nv}.`);
        continue;
      }
      const label = SHARED_STATE_COLUMN_LABELS[col];
      if (!label) continue;
      out.push(`${actor} updated ${label} from ${hasVal(diff.old) ? diff.old : '—'} to ${hasVal(diff.new) ? diff.new : '—'}.`);
    }
    return out;
  }
  return [];
}

function matterHistoryFor(matterId) {
  return sharedAuditEvents
    .filter(e => e.entity_type === 'Policy Matter' && e.entity_id === matterId)
    .flatMap(e => formatAttributedLines(e).map(summary => ({ at: e.created_at, summary })));
}

function findSignalByIdentity(ident) {
  return displaySignals.find(s => signalIdentity(s) === ident) || null;
}

function isMatterOverdue(m) {
  if (!hasVal(m.followUpDate) || m.status === 'Resolved') return false;
  return m.followUpDate < centralDateStr(new Date());
}
function isMatterDueToday(m) {
  if (!hasVal(m.followUpDate) || m.status === 'Resolved') return false;
  return m.followUpDate === centralDateStr(new Date());
}

/* Default Policy Matter sort: overdue, then due-today, then Action
   Required, then priority, then most recently updated. */
function matterSortCompare(a, b) {
  const overdueA = isMatterOverdue(a), overdueB = isMatterOverdue(b);
  if (overdueA !== overdueB) return overdueA ? -1 : 1;
  const dueA = isMatterDueToday(a), dueB = isMatterDueToday(b);
  if (dueA !== dueB) return dueA ? -1 : 1;
  const actA = a.status === 'Action Required', actB = b.status === 'Action Required';
  if (actA !== actB) return actA ? -1 : 1;
  const rank = { High: 0, Medium: 1, Monitor: 2 };
  const rA = rank[a.priority] ?? 3, rB = rank[b.priority] ?? 3;
  if (rA !== rB) return rA - rB;
  return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
}

/* ══ Attention Center ════════════════════════════════════════════════
   Split, per V4: My Attention is entirely personal (signal-shaped,
   reads getWorkflow()); Shared Attention covers Leadership Awareness and
   Committee Attention (now on signal_shared_state, not personal state)
   plus three matter-shaped queues over shared policy_matters. A signal
   or matter may match more than one queue at once — no exclusivity. */
// var (not const): keeps these reachable as window.X for testing, same
// reasoning as rawSignals/workflowStore above — a const declaration does
// not attach to a vm context's global object the way var/function
// declarations do.
var MY_ATTENTION_QUEUE_DEFS = [
  { key: 'overdue', label: 'Overdue Follow-Ups', shape: 'signal' },
  { key: 'dueToday', label: 'Due Today', shape: 'signal' },
  { key: 'actionRequired', label: 'Action Required', shape: 'signal' },
  { key: 'unreviewedHM', label: 'Unreviewed High/Medium Signals', shape: 'signal' },
];
var SHARED_ATTENTION_QUEUE_DEFS = [
  { key: 'leadership', label: 'Leadership Awareness', shape: 'signal' },
  { key: 'committee', label: 'Committee Attention', shape: 'signal' },
  { key: 'matterOverdue', label: 'Overdue Policy Matters', shape: 'matter' },
  { key: 'matterDueToday', label: 'Policy Matters Due Today', shape: 'matter' },
  { key: 'matterActionRequired', label: 'Policy Matters — Action Required', shape: 'matter' },
];
var ATTENTION_QUEUE_DEFS = [...MY_ATTENTION_QUEUE_DEFS, ...SHARED_ATTENTION_QUEUE_DEFS]; // combined lookup, e.g. by key

function findAttentionQueueDef(key) {
  return ATTENTION_QUEUE_DEFS.find(d => d.key === key) || null;
}

function inAttentionQueue(s, wf, key) {
  switch (key) {
    case 'overdue': return isOverdueFollowUp(wf);
    case 'dueToday': return isDueTodayFollowUp(wf);
    case 'actionRequired': return wf.status === 'Action Required';
    case 'unreviewedHM': return !hasVal(wf.reviewedAt) && ['High', 'Medium'].includes(s._c.priority) && !hasVal(wf.status);
    case 'leadership': {
      const shared = getSharedState(s);
      return shared.leadershipAwareness === 'Yes' && !COMPLETED_STATUSES.includes(wf.status);
    }
    case 'committee': {
      const shared = getSharedState(s);
      return (shared.committeeAttention === 'Requested' || shared.committeeAttention === 'Scheduled') && !COMPLETED_STATUSES.includes(wf.status);
    }
    default: return false;
  }
}

function inMatterAttentionQueue(m, key) {
  switch (key) {
    case 'matterOverdue': return isMatterOverdue(m);
    case 'matterDueToday': return isMatterDueToday(m);
    case 'matterActionRequired': return m.status === 'Action Required';
    default: return false;
  }
}

function computeAttentionCounts() {
  const counts = {};
  for (const def of MY_ATTENTION_QUEUE_DEFS) counts[def.key] = 0;
  for (const s of displaySignals) {
    const wf = getWorkflow(s);
    for (const def of MY_ATTENTION_QUEUE_DEFS) if (inAttentionQueue(s, wf, def.key)) counts[def.key]++;
  }
  return counts;
}

function computeSharedAttentionCounts() {
  const counts = {};
  for (const def of SHARED_ATTENTION_QUEUE_DEFS) counts[def.key] = 0;
  for (const s of displaySignals) {
    const wf = getWorkflow(s);
    for (const def of SHARED_ATTENTION_QUEUE_DEFS) if (def.shape === 'signal' && inAttentionQueue(s, wf, def.key)) counts[def.key]++;
  }
  for (const m of allMatters()) {
    for (const def of SHARED_ATTENTION_QUEUE_DEFS) if (def.shape === 'matter' && inMatterAttentionQueue(m, def.key)) counts[def.key]++;
  }
  return counts;
}

function attentionQueueSignals(key) {
  return displaySignals.filter(s => inAttentionQueue(s, getWorkflow(s), key));
}
function attentionQueueMatters(key) {
  return allMatters().filter(m => inMatterAttentionQueue(m, key));
}

/* Compact Attention summary shown on the Signals screen (V3.1), extended
   in V4 with a Shared row directly beneath — clearly labeled and never
   combined into one ambiguous total with the personal pills above it. */
function renderAttentionSummary() {
  const wrap = document.getElementById('attentionSummaryWrap');
  const counts = computeAttentionCounts();
  const sharedCounts = computeSharedAttentionCounts();
  const nonzero = MY_ATTENTION_QUEUE_DEFS.filter(d => counts[d.key] > 0);
  const sharedNonzero = SHARED_ATTENTION_QUEUE_DEFS.filter(d => sharedCounts[d.key] > 0);
  if (!nonzero.length && !sharedNonzero.length) { wrap.hidden = true; return; }
  wrap.hidden = false;

  function pill(d, n) {
    // Neutral command-center treatment for ordinary queues; amber only for
    // Action Required; red only for overdue — everything else (including
    // ordinary unreviewed signals) stays low-key (V3.2 §9).
    const emphasisClass = /overdue/i.test(d.key) ? ' attn-pill-red' : /actionRequired/i.test(d.key) ? ' attn-pill-amber' : '';
    return `<button type="button" class="attn-pill${emphasisClass}" data-queue="${esc(d.key)}">
      <span class="attn-pill-n">${n}</span>${esc(d.label)}
    </button>`;
  }

  // Reuses the existing .section-label heading style and .attn-summary
  // pill-row style (moved from the outer wrapper onto each group here)
  // rather than introducing new CSS for this grouping.
  const groups = [];
  if (nonzero.length) groups.push(`<p class="section-label">My Attention</p><div class="attn-summary">${nonzero.map(d => pill(d, counts[d.key])).join('')}</div>`);
  if (sharedNonzero.length) groups.push(`<p class="section-label">Shared Attention</p><div class="attn-summary">${sharedNonzero.map(d => pill(d, sharedCounts[d.key])).join('')}</div>`);
  document.getElementById('attentionSummary').innerHTML = groups.join('');
}

/* Default Attention sort: overdue, then due-today, then Action
   Required, then High priority, then Medium priority, then newest
   detected. Available as the 'urgency' option in the Sort control. */
function attentionSortCompare(a, b) {
  const wfA = getWorkflow(a), wfB = getWorkflow(b);
  const overdueA = isOverdueFollowUp(wfA), overdueB = isOverdueFollowUp(wfB);
  if (overdueA !== overdueB) return overdueA ? -1 : 1;
  const dueA = isDueTodayFollowUp(wfA), dueB = isDueTodayFollowUp(wfB);
  if (dueA !== dueB) return dueA ? -1 : 1;
  const actA = wfA.status === 'Action Required', actB = wfB.status === 'Action Required';
  if (actA !== actB) return actA ? -1 : 1;
  const rank = { High: 0, Medium: 1, Monitor: 2 };
  const rA = rank[a._c.priority] ?? 3, rB = rank[b._c.priority] ?? 3;
  if (rA !== rB) return rA - rB;
  return new Date(b.detected_at || 0) - new Date(a.detected_at || 0);
}

/* ══ V8 Part 10 — Review metrics, semantically corrected ═════════════
   The Review Progress WALL is gone from Today (removed from app.html) —
   but the underlying computation is still used for the compact "Needs
   Review" count inside Intelligence, so it's corrected here rather than
   deleted:
   - "Reviewed" means reviewedAt is present. Unchanged, already correct.
   - "Reviewed Today" means reviewedAt occurred TODAY — no longer also
     true whenever updatedAt merely changed today (the V7.1 bug: editing
     an Operator Note today used to count as "reviewed today" even for a
     signal reviewed weeks ago).
   - Closed Signals and Resolved Matters are two distinct counts, never
     combined into one ambiguous "Completed Today" total — each is
     labeled by exactly what it counts. ═══════════════════════════════ */
function computeReviewProgress() {
  const today = centralDateStr(new Date());
  let reviewed = 0, reviewedToday = 0, closedToday = 0, dismissedToday = 0;
  for (const s of displaySignals) {
    const wf = getWorkflow(s);
    if (hasVal(wf.reviewedAt)) reviewed++;
    if (hasVal(wf.reviewedAt) && centralDateStr(new Date(wf.reviewedAt)) === today) reviewedToday++;
    if (wf.status === 'Closed' && hasVal(wf.closedAt) && centralDateStr(new Date(wf.closedAt)) === today) closedToday++;
    if (wf.status === 'Dismissed' && hasVal(wf.dismissedAt) && centralDateStr(new Date(wf.dismissedAt)) === today) dismissedToday++;
  }
  let mattersUpdatedToday = 0, mattersResolvedToday = 0;
  for (const m of allMatters()) {
    const touchedToday = hasVal(m.updatedAt) && centralDateStr(new Date(m.updatedAt)) === today;
    if (touchedToday) mattersUpdatedToday++;
    if (m.status === 'Resolved' && touchedToday) mattersResolvedToday++;
  }
  return {
    reviewed, remaining: displaySignals.length - reviewed, total: displaySignals.length,
    reviewedToday, closedToday, dismissedToday, mattersUpdatedToday, mattersResolvedToday,
  };
}

/* ══ Today's Activity — operator activity only, never scanner/Supabase
   activity. Excludes the automatic status-migration bookkeeping entry
   (not something an operator did today) but keeps it in per-signal
   history, where it's a legitimate record of what happened. ──────── */
function computeTodaysActivity(limit) {
  const today = centralDateStr(new Date());
  const items = [];
  for (const s of displaySignals) {
    const wf = getWorkflow(s);
    for (const h of wf.history) {
      if (h.summary.includes('(automatic migration')) continue;
      if (centralDateStr(new Date(h.at)) === today) items.push({ at: h.at, kind: 'Signal', label: s._c.cleanTitle, summary: h.summary });
    }
  }
  for (const m of allMatters()) {
    for (const h of m.history) {
      if (centralDateStr(new Date(h.at)) === today) items.push({ at: h.at, kind: 'Matter', label: m.title || 'Untitled matter', summary: h.summary });
    }
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return limit ? items.slice(0, limit) : items;
}

/* ── Export / Import / Reset ─────────────────────────────────────── */
function exportWorkspace() {
  // Matters are Supabase-backed (shared) as of V4 — exported here as a
  // read-only snapshot for backup purposes, same shape as the old local
  // format, but this is not an import source for matters going forward
  // (see importWorkspaceFile()'s authenticated-mode behavior below).
  const mattersSnapshot = {};
  for (const m of allMatters()) mattersSnapshot[m.id] = m;
  const payload = {
    app: 'watchdog-ews-workflow', version: 4, exportedAt: new Date().toISOString(),
    records: workflowStore.records, matters: mattersSnapshot,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `watchdog-ews-workflow-${localDateStr(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setWfToolMsg(`Exported ${Object.keys(workflowStore.records).length} signal record(s) and ${Object.keys(mattersSnapshot).length} Policy Matter(s).`);
}

function validateWorkflowImport(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'File is not a valid workflow export (expected a JSON object).' };
  }
  if (!parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) {
    return { ok: false, error: 'File is missing a valid "records" object.' };
  }
  for (const [key, rec] of Object.entries(parsed.records)) {
    if (!rec || typeof rec !== 'object') return { ok: false, error: `Entry "${key}" is not a valid record object.` };
    if (!VALID_STORED_STATUSES.includes(rec.status)) return { ok: false, error: `Entry "${key}" has an invalid Workflow Status value.` };
    if (rec.responseLevel !== null && rec.responseLevel !== undefined && !RESPONSE_LEVELS.includes(Number(rec.responseLevel))) {
      return { ok: false, error: `Entry "${key}" has an invalid Response Level value.` };
    }
    if (rec.leadershipAwareness !== null && rec.leadershipAwareness !== undefined && !['Yes', 'No'].includes(rec.leadershipAwareness)) {
      return { ok: false, error: `Entry "${key}" has an invalid Leadership Awareness value.` };
    }
    if (rec.committeeAttention !== null && rec.committeeAttention !== undefined && !COMMITTEE_ATTENTION_VALUES.includes(rec.committeeAttention)) {
      return { ok: false, error: `Entry "${key}" has an invalid Committee Attention value.` };
    }
    if (rec.status === 'Dismissed' && !hasVal(rec.dismissalReason)) {
      return { ok: false, error: `Entry "${key}" is Dismissed but has no Dismissal Reason.` };
    }
  }
  // `matters` is optional — its absence is exactly what a V2.1 export looks like, and is valid.
  let matters = {};
  if (parsed.matters !== undefined) {
    if (typeof parsed.matters !== 'object' || parsed.matters === null || Array.isArray(parsed.matters)) {
      return { ok: false, error: 'File has an invalid "matters" object.' };
    }
    for (const [id, m] of Object.entries(parsed.matters)) {
      if (!m || typeof m !== 'object') return { ok: false, error: `Matter "${id}" is not a valid object.` };
      if (!MATTER_STATUSES.includes(m.status)) return { ok: false, error: `Matter "${id}" has an invalid Matter Status value.` };
      if (!MATTER_PRIORITIES.includes(m.priority)) return { ok: false, error: `Matter "${id}" has an invalid Matter Priority value.` };
      if (m.signalIds !== undefined && !Array.isArray(m.signalIds)) return { ok: false, error: `Matter "${id}" has an invalid signalIds value.` };
    }
    matters = parsed.matters;
  }
  return { ok: true, records: parsed.records, matters };
}

function importWorkspaceFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      setWfToolMsg('Import failed: the selected file is not valid JSON.', true);
      return;
    }
    // Run any pre-existing records through the same status migration used for
    // local storage, so a V2.1 (or earlier) export can still be imported
    // instead of being flatly rejected as "invalid".
    if (parsed && typeof parsed === 'object' && parsed.records && typeof parsed.records === 'object' && !Array.isArray(parsed.records)) {
      const migrated = {};
      for (const [key, rec] of Object.entries(parsed.records)) {
        migrated[key] = (rec && typeof rec === 'object') ? migrateWorkflowRecord(rec) : rec;
      }
      parsed = { ...parsed, records: migrated };
    }
    const result = validateWorkflowImport(parsed);
    if (!result.ok) {
      setWfToolMsg(`Import failed: ${result.error}`, true);
      return;
    }
    const sigCount = Object.keys(result.records).length;
    const matterCount = Object.keys(result.matters).length;

    // V4: signal records AND Policy Matters are both Supabase-backed once
    // authenticated (personal and shared respectively) — this generic
    // file-restore control would either silently fail to persist (signals)
    // or, worse, overwrite SHARED team data other users depend on
    // (matters) from a personal backup file. Retired for authenticated
    // mode entirely; both are managed through their own synced workspaces
    // (the Migration Assistant for legacy signal decisions, the Policy
    // Matters workspace directly for matters) instead.
    if (currentUserId) {
      setWfToolMsg('Import Workspace is not available while your workspace is synced to your account. Signal decisions are managed by the Migration Assistant; Policy Matters are shared and managed directly in the Policy Matters workspace.', true);
      return;
    }

    if (!window.confirm(`Import ${sigCount} signal record(s) and ${matterCount} Policy Matter(s)? This REPLACES your current local workspace on this browser — export first if you want to keep what's currently here.`)) {
      return;
    }
    workflowStore = { version: 3, records: result.records, matters: result.matters };
    persistWorkflowStore();
    populateWorkflowStatusFilter();
    refreshOverviewPanels();
    renderMain();
    setWfToolMsg(`Imported ${sigCount} signal record(s) and ${matterCount} Policy Matter(s).`);
  };
  reader.onerror = () => setWfToolMsg('Import failed: could not read the selected file.', true);
  reader.readAsText(file);
}

function resetWorkspace() {
  // V4: signal decisions live in Supabase (your account) and Policy
  // Matters are shared Supabase data once authenticated — neither is
  // touched by this control. Only the one remaining local-only piece
  // (personal per-signal activity history, cached per user id) is reset
  // here.
  if (currentUserId) {
    const cache = loadUserScopedCache(currentUserId);
    const overflowCount = Object.keys(cache.overflow).length;
    if (!overflowCount) { setWfToolMsg('No local-only workspace data to reset.'); return; }
    if (!window.confirm(
      `This permanently deletes locally cached activity history for ${overflowCount} signal(s) on this browser.\n\n` +
      `Your saved Workflow Status, Response Level, notes, and other synced decisions in your account — and all shared Policy Matters and Shared Coordination — are NOT affected.\n\n` +
      `This cannot be undone. Continue?`
    )) return;
    for (const rec of Object.values(workflowStore.records)) rec.history = [];
    localStorage.removeItem(userCacheKey(currentUserId));
    refreshOverviewPanels();
    renderMain();
    setWfToolMsg('Local-only activity history has been reset.');
    return;
  }

  const sigCount = Object.keys(workflowStore.records).length;
  const matterCount = Object.keys(workflowStore.matters || {}).length;
  if (!sigCount && !matterCount) { setWfToolMsg('No local workspace data to reset.'); return; }
  if (!window.confirm(
    `This permanently deletes ALL local workspace data on this browser:\n` +
    `• ${sigCount} signal workflow decision(s), including local review history\n` +
    `• ${matterCount} Policy Matter(s), including matter history\n\n` +
    `This cannot be undone. Continue?`
  )) return;
  workflowStore = { version: 3, records: {}, matters: {} };
  persistWorkflowStore();
  refreshOverviewPanels();
  renderMain();
  setWfToolMsg('Local workspace has been reset.');
}

function setWfToolMsg(msg, isError) {
  const el = document.getElementById('wfToolMsg');
  el.textContent = msg;
  el.style.color = isError ? '#ff9d9d' : '';
}

/* ── Overview panels (Review Progress, Today's Activity) — all reflect
   the full deduplicated territory set, independent of active feed
   filters, and are refreshed together after anything that could change
   them. The V3 "Operator Workflow" stat row (Unreviewed/Queue/
   Monitoring/Action Required/Closed/Dismissed) was removed from the
   default view in V3.1 — every one of those counts is still available
   one click away (Signals/Completed sub-nav + feedCount, or Review
   Progress), so no computation was lost, only a redundant display. ── */
function refreshOverviewPanels() {
  updateNeedsReviewCount();
  updateTodaysActivity();
}

// V8 Part 10: replaces the removed Review Progress wall. One compact,
// precisely labeled count — "Needs Review" — inside the Intelligence
// view only (see app.html's #intelligenceNeedsReviewCount). No progress
// bar, no per-metric tile grid; computeReviewProgress()'s corrected
// numbers remain available for anything that needs them later.
function updateNeedsReviewCount() {
  const el = document.getElementById('intelligenceNeedsReviewCount');
  if (!el) return;
  const p = computeReviewProgress();
  el.textContent = `${p.remaining} need${p.remaining === 1 ? 's' : ''} review`;
}

/* Shown only through the Workspace menu (V3.1): a 3-item preview plus a
   "View All Activity" dialog with the complete, uncapped list. Long
   signal/matter titles are truncated cleanly so one long title can't
   push a compact preview list out of shape. */
function renderActivityList(containerId, items) {
  const el = document.getElementById(containerId);
  if (!items.length) {
    el.innerHTML = `<p class="wf-history-empty">No activity has been recorded today.</p>`;
    return;
  }
  el.innerHTML = items.map(it => `
    <p class="wf-history-item"><span class="wf-history-time">${esc(absoluteDate(it.at))}</span><strong>${esc(it.kind)} — ${esc(truncateText(it.label, 60))}:</strong> ${esc(it.summary)}</p>
  `).join('');
}

function updateTodaysActivity() {
  renderActivityList('todaysActivityMini', computeTodaysActivity(3));
}

function openActivityDialog() {
  renderActivityList('todaysActivityFull', computeTodaysActivity());
  document.getElementById('activityDialog').showModal();
}

/* ── Boot ─────────────────────────────────────────────────────── */
async function boot(userId, role) {
  if (typeof supabase === 'undefined') {
    renderState('error', 'The Supabase client library failed to load. Check your network connection and reload.');
    return;
  }
  currentUserId = userId || null;
  currentUserRole = role || null;
  // Reuse auth.js's single Supabase client rather than creating a second
  // instance — avoids duplicate GoTrue/Realtime connections now that
  // authentication is involved.
  db = (window.WatchdogAuth && window.WatchdogAuth.getClient)
    ? window.WatchdogAuth.getClient()
    : supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  if (window.WatchdogAuth && window.WatchdogAuth.registerCleanup) {
    window.WatchdogAuth.registerCleanup(clearUserScopedCacheInMemory);
  }

  const loaded = await loadWorkflowStoreForUser(currentUserId);
  workflowStore = loaded.store;
  updateSyncBanner(loaded.syncOk && !!currentUserId);

  try {
    await loadSharedCollaborationState();
  } catch (err) {
    console.error('Could not load shared workspace from Supabase:', err);
    showToast('Could not load the shared workspace — Policy Matters and Shared Coordination may be incomplete. Try reloading.');
  }

  applyRolePermissionsToStaticUI();
  populateWorkflowStatusFilter();
  wireControls();
  await loadSignals();
  subscribeToRealtime();

  if (currentUserId && window.WatchdogRealtime) {
    window.WatchdogRealtime.subscribeSharedChannels(handleSharedRealtimeChange);
  }

  if (currentUserId && window.WatchdogMigration) {
    window.WatchdogMigration.checkAndPromptIfNeeded(currentUserId, currentUserRole);
  }

  maybeShowOrientation();
}

/* ══ Glossary + first-time orientation (product-clarity §13) ═══════════
   Orientation shows once per browser (localStorage flag), never blocks
   an experienced user, and is always reachable again via the Glossary
   button. Glossary content matches docs/watchdog-product-language.md
   exactly — one vocabulary, defined once, referenced everywhere. ────── */
const GLOSSARY_TERMS = [
  { term: 'Signal', def: 'Newly detected information that may require review.' },
  { term: 'Priority', def: 'How urgently the issue may require attention.' },
  { term: 'Confidence', def: 'How strongly the evidence supports the classification.' },
  { term: 'Monitoring', def: 'A relevant signal being watched without immediate intervention.' },
  { term: 'Active Matter', def: 'An issue receiving deliberate, sustained government-affairs management.' },
  { term: 'Validation Queue', def: 'Signals held because geography, source identity, or jurisdiction is uncertain.' },
  { term: 'Suppressed', def: 'Confirmed out of territory or otherwise not relevant — hidden from the normal feed.' },
  { term: 'Verified Source', def: 'The signal resolved to a known, trusted official or news source.' },
  { term: 'Duplicate', def: 'A separately detected record of the same real-world event as another signal already shown — hidden, never deleted.' },
];

function renderGlossary() {
  const el = document.getElementById('glossaryList');
  if (!el) return;
  el.innerHTML = GLOSSARY_TERMS.map((g) => `
    <li class="glossary-item">
      <p class="glossary-term">${esc(g.term)}</p>
      <p class="glossary-def">${esc(g.def)}</p>
    </li>`).join('');
}

function openGlossary() {
  renderGlossary();
  document.getElementById('glossaryDialog').showModal();
}

const ORIENTATION_SEEN_KEY = 'watchdog_orientation_seen_v6_1';
function maybeShowOrientation() {
  try {
    if (localStorage.getItem(ORIENTATION_SEEN_KEY)) return;
  } catch { return; } // localStorage unavailable (private mode etc.) — never block on this
  document.getElementById('orientationDialog').showModal();
}
function dismissOrientation() {
  document.getElementById('orientationDialog').close();
  try { localStorage.setItem(ORIENTATION_SEEN_KEY, '1'); } catch { /* best-effort */ }
}

/* ── Realtime-driven shared refresh ──────────────────────────────────
   Fired (debounced) by realtime.js whenever a shared table changes.
   Always refetches the full shared dataset and re-renders; additionally
   shows a subtle notification and flags stale-edit warnings for whatever
   the current user has open, without ever touching their unsaved form
   input directly. */
async function handleSharedRealtimeChange() {
  const previousAuditIds = new Set(sharedAuditEvents.map(e => e.id));
  try {
    await loadSharedCollaborationState();
  } catch (err) {
    console.error('Could not refresh shared workspace after a realtime update:', err);
    return;
  }
  const newEvents = sharedAuditEvents.filter(e => !previousAuditIds.has(e.id) && e.actor_user_id !== currentUserId);
  notifySharedChange(newEvents);
  checkMatterDialogStale();
  checkSharedCoordStale();
  refreshOverviewPanels();
  renderMain();
}

function notifySharedChange(newEvents) {
  if (!newEvents.length) return; // nothing new, or only this user's own change (no self-notification)
  const lines = newEvents.flatMap(formatAttributedLines);
  if (lines.length === 1) showToast(lines[0]);
  else if (lines.length > 1) showToast(`${lines.length} shared workspace updates from other users.`);
  else showToast('Shared workspace updated by another user.');
}

function checkMatterDialogStale() {
  if (!currentMatterId) return;
  const m = sharedMattersById[currentMatterId];
  if (m && matterDialogLoadedUpdatedAt && m.updatedAt !== matterDialogLoadedUpdatedAt) showMatterStaleWarning();
}

function checkSharedCoordStale() {
  if (!currentDetailSignal) return;
  const shared = sharedStateByIdentity[signalIdentity(currentDetailSignal)];
  if (shared && sharedCoordLoadedUpdatedAt && shared.updatedAt !== sharedCoordLoadedUpdatedAt) showSharedCoordStaleWarning();
}

/* ── Data load ────────────────────────────────────────────────── */
async function loadSignals() {
  renderState('loading');
  try {
    const { data, error } = await db
      .from('signals')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    rawSignals = (data || []).filter(isFocusCounty).map(prepareSignal);
    recomputeDisplaySet();

    if (displaySignals.length === 0) {
      updateStats();
      refreshOverviewPanels();
      populateFilterOptions();
      populateMatterFilterOptions();
      renderState('empty');
      updateTimestamps();
      return;
    }

    populateFilterOptions();
    populateMatterFilterOptions();
    updateStats();
    refreshOverviewPanels();
    renderMain();
    updateTimestamps();
  } catch (err) {
    console.error('Supabase load error:', err);
    renderState('error', err && err.message ? err.message : 'Unknown connection error.');
  }
}

function subscribeToRealtime() {
  db.channel('signals-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals' }, (payload) => {
      const sig = payload.new;
      if (!isFocusCounty(sig)) return;
      rawSignals.unshift(prepareSignal(sig));
      recomputeDisplaySet();
      populateFilterOptions();
      populateMatterFilterOptions();
      updateStats();
      refreshOverviewPanels();
      renderMain();
      updateTimestamps();
      showToast(`New signal: ${sig._c.jurisdiction || 'Unknown'} — ${sig._c.priority || 'Unclassified'} priority`);
    })
    .subscribe();
}

// V6.1 header refinement: "Loaded" and "Newest signal" no longer render
// in the permanent header (moved out to reduce clutter — see the
// product-clarity and header-refinement briefs), but the computation
// itself is untouched so either value is one line away from resurfacing
// in Today/Intelligence/System Health later. Uses optional chaining
// rather than deleting the DOM lookups, so this keeps working unchanged
// if/when those elements return elsewhere with the same ids.
function updateTimestamps() {
  const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CENTRAL_TZ, timeZoneName: 'short' });
  const loadedEl = document.getElementById('loadedAt');
  if (loadedEl) loadedEl.textContent = `Loaded ${now}`;

  let newest = null;
  for (const s of displaySignals) {
    if (hasVal(s.detected_at) && (!newest || new Date(s.detected_at) > new Date(newest))) newest = s.detected_at;
  }
  const newestEl = document.getElementById('newestSignal');
  if (newestEl) newestEl.textContent = newest ? `Newest signal ${dateOnly(newest)}` : 'Newest signal —';
}

/* ── Controls wiring ──────────────────────────────────────────── */
function wireControls() {
  /* Primary workspace navigation */
  document.getElementById('primaryNav').addEventListener('click', (e) => {
    const sysItem = e.target.closest('.system-menu-item');
    if (sysItem) {
      activeFilters.primaryView = sysItem.dataset.primary;
      activeFilters.attentionQueue = '';
      mobileFiltersOpen = false;
      document.getElementById('systemMenu').open = false;
      renderMain();
      return;
    }
    const btn = e.target.closest('.pnav-tab');
    if (!btn) return;
    activeFilters.primaryView = btn.dataset.primary;
    activeFilters.attentionQueue = '';
    mobileFiltersOpen = false; // switching workspaces always returns to the feed, not a stale-open drawer
    renderMain();
  });

  /* Mobile filter drawer */
  document.getElementById('mobileFiltersToggle').addEventListener('click', toggleMobileFilters);
  document.querySelectorAll('.mobile-filters-close').forEach(btn => btn.addEventListener('click', closeMobileFilters));

  /* V5: Administrator-only Suppressed/Quarantined visibility toggle */
  document.getElementById('showSuppressedQuarantinedChk').addEventListener('change', (e) => {
    activeFilters.showSuppressedQuarantined = e.target.checked;
    recomputeDisplaySet();
    updateStats();
    renderMain();
  });

  /* V5 Source Coverage filters — own namespace, own always-visible bar
     (not part of the shared mobile filters-panel drawer). */
  ['scSearch', 'scCounty', 'scJurisdiction', 'scSourceType', 'scSourceLane', 'scPriority', 'scReliability', 'scMonitoringMethod', 'scActive']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', (e) => {
        activeFilters[id] = e.target.value;
        renderMain();
      });
    });
  document.getElementById('scResetBtn').addEventListener('click', () => {
    ['scSearch', 'scCounty', 'scJurisdiction', 'scSourceType', 'scSourceLane', 'scPriority', 'scReliability', 'scMonitoringMethod', 'scActive']
      .forEach((id) => { activeFilters[id] = ''; });
    document.getElementById('sourceCoverageFilters').querySelectorAll('input, select').forEach((el) => { el.value = ''; });
    renderMain();
  });

  /* V5.1 Source Coverage sub-tabs (Exact Endpoints, Reporter Watches,
     Special Districts, Exclusions, Source Health) + their shared simple
     search box. */
  document.getElementById('sourceCoverageSubNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activeFilters.scSubTab = btn.dataset.scSub;
    activeFilters.scSearch2 = '';
    const input = document.getElementById('scSearch2');
    if (input) input.value = '';
    renderMain();
  });
  document.getElementById('scGotoQuarantineBtn').addEventListener('click', () => {
    activeFilters.primaryView = 'quarantine';
    renderMain();
  });
  /* V6 Operations — manual refresh (run history isn't realtime-subscribed) */
  document.getElementById('operationsRefreshBtn').addEventListener('click', refreshOperationsData);
  document.getElementById('scSearch2').addEventListener('input', (e) => {
    activeFilters.scSearch2 = e.target.value;
    renderMain();
  });
  document.getElementById('scResetBtn2').addEventListener('click', () => {
    activeFilters.scSearch2 = '';
    document.getElementById('scSearch2').value = '';
    renderMain();
  });

  /* V5 Quarantine Review actions (delegated — cards are re-rendered wholesale) */
  document.getElementById('quarantineList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quarantine-action]');
    if (!btn) return;
    handleQuarantineAction(btn.dataset.signalId, btn.dataset.quarantineAction);
  });

  document.getElementById('signalsSubNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activeFilters.signalsSubTab = btn.dataset.sub;
    renderMain();
  });

  document.getElementById('todayContent').addEventListener('click', (e) => {
    const openSig = e.target.closest('[data-open-signal]');
    if (openSig) { openDetail(openSig.dataset.openSignal); return; }
    const openMat = e.target.closest('[data-open-matter]');
    if (openMat) { openMatterDetail(openMat.dataset.openMatter); return; }
    const tile = e.target.closest('[data-queue]');
    if (!tile || !tile.dataset.queue) return;
    if (tile.dataset.queue === '__systemHealth') {
      activeFilters.primaryView = 'operations';
      renderMain();
      return;
    }
    activeFilters.attentionQueue = tile.dataset.queue;
    activeFilters.sort = 'urgency';
    document.getElementById('sortSel').value = 'urgency';
    renderMain();
  });
  document.getElementById('attentionBackBtn').addEventListener('click', () => {
    activeFilters.attentionQueue = '';
    renderMain();
  });

  /* Signal filters */
  document.getElementById('priorityTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('#priorityTabs .tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    activeFilters.priority = btn.dataset.priority;
    renderMain();
  });
  document.getElementById('searchBox').addEventListener('input', (e) => {
    activeFilters.search = e.target.value.toLowerCase();
    renderMain();
  });
  document.getElementById('countySel').addEventListener('change', (e) => { activeFilters.county = e.target.value; renderMain(); });
  document.getElementById('jurisdictionSel').addEventListener('change', (e) => { activeFilters.jurisdiction = e.target.value; renderMain(); });
  document.getElementById('categorySel').addEventListener('change', (e) => { activeFilters.category = e.target.value; renderMain(); });
  document.getElementById('reviewSel').addEventListener('change', (e) => { activeFilters.review = e.target.value; renderMain(); });
  document.getElementById('recencySel').addEventListener('change', (e) => { activeFilters.recency = e.target.value; renderMain(); });
  document.getElementById('reviewStateSel').addEventListener('change', (e) => { activeFilters.reviewStateFilter = e.target.value; renderMain(); });
  document.getElementById('workflowSel').addEventListener('change', (e) => { activeFilters.workflowStatus = e.target.value; renderMain(); });
  document.getElementById('sortSel').addEventListener('change', (e) => { activeFilters.sort = e.target.value; renderMain(); });
  document.getElementById('resetBtn').addEventListener('click', resetFilters);

  /* Matter filters */
  document.getElementById('mfCounty').addEventListener('change', (e) => { activeFilters.matterCounty = e.target.value; renderMain(); });
  document.getElementById('mfJurisdiction').addEventListener('change', (e) => { activeFilters.matterJurisdiction = e.target.value; renderMain(); });
  document.getElementById('mfStatus').addEventListener('change', (e) => { activeFilters.matterStatus = e.target.value; renderMain(); });
  document.getElementById('mfSort').addEventListener('change', (e) => { activeFilters.matterSort = e.target.value; renderMain(); });
  document.getElementById('matterPriorityTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('#matterPriorityTabs .tab').forEach(t => {
      t.classList.remove('active'); t.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    activeFilters.matterPriority = btn.dataset.priority;
    renderMain();
  });
  document.getElementById('resetMatterFiltersBtn').addEventListener('click', resetMatterFilters);

  /* Workspace menu: Today's Activity (mini + full), Export / Import / Reset */
  document.getElementById('viewAllActivityBtn').addEventListener('click', openActivityDialog);
  document.getElementById('activityDialogClose').addEventListener('click', () => document.getElementById('activityDialog').close());
  document.getElementById('activityDialog').addEventListener('click', (e) => {
    if (e.target.id === 'activityDialog') document.getElementById('activityDialog').close();
  });
  document.getElementById('exportBtn').addEventListener('click', exportWorkspace);
  // V8 Part 3: Import Workspace's controls are gone from app.html — it
  // never worked once signed in (see importWorkspaceFile() above, kept
  // in case anonymous/local mode returns; nothing left to wire here).
  document.getElementById('resetWorkspaceBtn').addEventListener('click', resetWorkspace);

  /* Attention summary (Signals screen only) — clicking a pill jumps into
     the matching Attention queue, same as clicking its Attention tile. */
  document.getElementById('attentionSummary').addEventListener('click', (e) => {
    const btn = e.target.closest('.attn-pill');
    if (!btn) return;
    activeFilters.primaryView = 'today';
    activeFilters.attentionQueue = btn.dataset.queue;
    activeFilters.sort = 'urgency';
    document.getElementById('sortSel').value = 'urgency';
    renderMain();
  });

  /* Signal detail dialog */
  document.getElementById('wfStatus').addEventListener('change', (e) => {
    document.getElementById('wfDismissalWrap').classList.toggle('wf-optional', e.target.value !== 'Dismissed');
  });
  document.getElementById('wfSaveBtn').addEventListener('click', saveWorkflowFromForm);
  document.getElementById('wfSharedSaveBtn').addEventListener('click', saveSharedCoordinationFromForm);
  document.getElementById('sharedReloadLatestBtn').addEventListener('click', reloadSharedCoordLatest);
  document.getElementById('glossaryBtn').addEventListener('click', openGlossary);
  document.getElementById('glossaryClose').addEventListener('click', () => document.getElementById('glossaryDialog').close());
  document.getElementById('glossaryDialog').addEventListener('click', (e) => {
    if (e.target.id === 'glossaryDialog') document.getElementById('glossaryDialog').close();
  });
  document.getElementById('orientationClose').addEventListener('click', dismissOrientation);
  document.getElementById('orientationDismissBtn').addEventListener('click', dismissOrientation);
  document.getElementById('orientationDialog').addEventListener('click', (e) => {
    if (e.target.id === 'orientationDialog') dismissOrientation();
  });

  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.getElementById('detailDialog').addEventListener('click', (e) => {
    if (e.target.id === 'detailDialog') closeDetail();
  });
  document.getElementById('detailTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.detail-tab');
    if (btn) switchDetailTab(btn.dataset.dtab);
  });
  document.getElementById('detailPrimaryActions').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-detail-action]');
    if (!btn || !currentDetailSignal) return;
    const action = btn.dataset.detailAction;
    if (action === 'Create Matter') { openMatterPicker(currentDetailSignal); return; }
    if (action === 'Mark Reviewed') {
      // V8 correction (pre-review pass): a reliable, awaited save, not a
      // silent fire-and-forget. Disabling synchronously here — before
      // the first `await` runs — is also the double-click guard: a
      // disabled <button> never dispatches a second click event, so a
      // rapid repeat click on this exact element cannot race the first
      // save or duplicate its history entry.
      const signalBeingMarked = currentDetailSignal;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      let wf;
      try {
        wf = await markReviewed(signalBeingMarked);
      } catch (err) {
        console.error('Could not mark this signal Reviewed:', err);
        // Failure: the unreviewed state was never touched (markReviewed()
        // only updates workflowStore after the repository call succeeds),
        // so there is nothing to roll back — just restore the control and
        // tell the human, not only the console.
        btn.disabled = false;
        btn.textContent = 'Mark Reviewed';
        showToast('Could not mark this signal Reviewed — check your connection and try again.');
        return;
      }
      if (currentDetailSignal !== signalBeingMarked) return; // navigated away while saving
      refreshOverviewPanels();
      renderMain();
      renderDetailPrimaryActions(currentDetailSignal, wf); // re-render removes the button entirely now that it's reviewed
      populateWorkflowForm(wf);
      showToast('Marked Reviewed.');
      return;
    }
    if (action === 'Monitor') {
      showToast('Saving…');
      try { await saveWorkflow(currentDetailSignal, { status: 'Monitoring' }); }
      catch { showToast('Could not save — check your connection and try again.'); return; }
      showToast('Marked Monitoring.');
      refreshOverviewPanels();
      renderMain();
      const wf = getWorkflow(currentDetailSignal);
      renderDetailPrimaryActions(currentDetailSignal, wf);
      populateWorkflowForm(wf);
    }
  });
  document.getElementById('intelGenSection').addEventListener('click', (e) => {
    if (!currentDetailSignal) return;
    const s = currentDetailSignal;
    const genBtn = e.target.closest('#intelGenerateBtn');
    if (genBtn) {
      document.getElementById('intelGenConfirmWrap').innerHTML = intelGenConfirmHtml(s, genBtn.dataset.trigger);
      return;
    }
    const cancelBtn = e.target.closest('#intelGenCancelBtn');
    if (cancelBtn) { document.getElementById('intelGenConfirmWrap').innerHTML = ''; return; }
    const confirmBtn = e.target.closest('#intelGenConfirmBtn');
    if (confirmBtn) {
      document.getElementById('intelGenConfirmWrap').innerHTML = '';
      handleGenerateIntelligence(s, confirmBtn.dataset.trigger);
      return;
    }
    const reviewBtn = e.target.closest('[data-intel-review]');
    if (reviewBtn && !reviewBtn.disabled) {
      const analysisId = reviewBtn.dataset.intelAnalysisId;
      if (analysisId) handleReviewIntelligence(s, analysisId, reviewBtn.dataset.intelReview);
    }
  });
  document.getElementById('detailPanelAnalysis').addEventListener('click', (e) => {
    if (!currentDetailSignal) return;
    const s = currentDetailSignal;
    if (e.target.closest('#analysisEditToggleBtn')) { handleToggleEditDraft(); return; }
    if (e.target.closest('#analysisEditCancelBtn')) {
      const wrap = document.getElementById('analysisEditWrap');
      if (wrap) { wrap.innerHTML = ''; wrap.dataset.open = ''; }
      return;
    }
    const saveBtn = e.target.closest('#analysisEditSaveBtn');
    if (saveBtn && !saveBtn.disabled) { handleSaveEditDraft(s, saveBtn.dataset.analysisId); return; }
    const addBtn = e.target.closest('[data-add-row]');
    if (addBtn) { addEditListRow(addBtn.dataset.addRow); return; }
    const removeBtn = e.target.closest('[data-remove-row]');
    if (removeBtn) { removeBtn.closest('.edit-list-row').remove(); return; }
  });
  document.getElementById('manualPilotSection').addEventListener('click', (e) => {
    if (!currentDetailSignal) return;
    const s = currentDetailSignal;
    if (e.target.closest('#manualPilotBuildBtn')) { handleBuildIntelligencePacket(s); return; }
    if (e.target.closest('#manualPilotCopyBtn')) { handleCopyPacket(); return; }
    if (e.target.closest('#manualPilotDownloadBtn')) { handleDownloadPacket(); return; }
    if (e.target.closest('#manualPilotValidateBtn')) { handleValidateManualResponse(s); return; }
    if (e.target.closest('#manualPilotCancelImportBtn')) {
      document.getElementById('manualPilotResponseInput').value = '';
      document.getElementById('manualPilotImportError').hidden = true;
      const previewArea = document.getElementById('manualPilotPreviewArea');
      previewArea.hidden = true; previewArea.innerHTML = '';
      return;
    }
    if (e.target.closest('#manualPilotSaveDraftBtn')) { handleSaveManualDraft(s); return; }
    if (e.target.closest('#manualPilotCancelPreviewBtn')) {
      const previewArea = document.getElementById('manualPilotPreviewArea');
      previewArea.hidden = true; previewArea.innerHTML = '';
      return;
    }
  });
  document.getElementById('manualPilotUploadInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleManualPilotFileUpload(file);
    e.target.value = '';
  });
  document.getElementById('promoteMatterBtn').addEventListener('click', () => { if (currentDetailSignal) openMatterPicker(currentDetailSignal); });
  document.getElementById('attachMatterBtn').addEventListener('click', () => { if (currentDetailSignal) openMatterPicker(currentDetailSignal); });
  document.getElementById('signalMatterLinks').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-matter]');
    if (btn) openMatterDetail(btn.dataset.openMatter);
  });

  /* Dismiss confirmation dialog */
  document.getElementById('dismissConfirmBtn').addEventListener('click', confirmDismiss);
  document.getElementById('dismissCancelBtn').addEventListener('click', closeDismissDialog);
  document.getElementById('dismissClose').addEventListener('click', closeDismissDialog);
  document.getElementById('dismissDialog').addEventListener('click', (e) => {
    if (e.target.id === 'dismissDialog') closeDismissDialog();
  });

  /* Matter picker dialog (Promote to New Matter / Add to Existing Matter) */
  document.getElementById('matterPickerClose').addEventListener('click', closeMatterPicker);
  document.getElementById('matterPickerDialog').addEventListener('click', (e) => {
    if (e.target.id === 'matterPickerDialog') closeMatterPicker();
  });
  document.getElementById('matterPickerList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-attach-matter]');
    if (!btn || !pendingPromoteSignal || !canEditShared()) return;
    const signalToRefresh = pendingPromoteSignal;
    try {
      await attachSignalToMatter(btn.dataset.attachMatter, signalIdentity(signalToRefresh), signalToRefresh.id ?? null);
    } catch {
      showToast('Could not attach the signal — check your connection and try again.');
      return;
    }
    showToast('Signal attached to matter.');
    closeMatterPicker();
    if (currentDetailSignal && currentDetailSignal === signalToRefresh) renderSignalMatterLinks(signalToRefresh);
    refreshOverviewPanels();
    renderMain();
  });
  document.getElementById('mpCreateBtn').addEventListener('click', async () => {
    if (!pendingPromoteSignal || !canEditShared()) return;
    const title = document.getElementById('mpTitle').value.trim();
    if (!title) { showToast('A title is required to create a matter.'); return; }
    const inheritedPriority = MATTER_PRIORITIES.includes(pendingPromoteSignal._c.priority) ? pendingPromoteSignal._c.priority : 'Monitor';
    const signalToRefresh = pendingPromoteSignal;
    let m;
    try {
      m = await createMatter({
        title,
        category: document.getElementById('mpCategory').value.trim(),
        jurisdiction: document.getElementById('mpJurisdiction').value.trim(),
        county: document.getElementById('mpCounty').value.trim(),
        priority: inheritedPriority,
      });
      await attachSignalToMatter(m.id, signalIdentity(signalToRefresh), signalToRefresh.id ?? null);
    } catch {
      showToast('Could not create the matter — check your connection and try again.');
      return;
    }
    showToast('Active Matter created and signal attached.');
    closeMatterPicker();
    if (currentDetailSignal && currentDetailSignal === signalToRefresh) renderSignalMatterLinks(signalToRefresh);
    refreshOverviewPanels();
    populateMatterFilterOptions();
    renderMain();
  });

  /* Matter detail dialog */
  document.getElementById('matterDialogClose').addEventListener('click', closeMatterDialog);
  document.getElementById('matterDialog').addEventListener('click', (e) => {
    if (e.target.id === 'matterDialog') closeMatterDialog();
  });
  document.getElementById('matterSaveBtn').addEventListener('click', saveMatterFromForm);
  document.getElementById('matterReloadLatestBtn').addEventListener('click', reloadMatterDialogLatest);
  document.getElementById('matterSignalsList').addEventListener('click', async (e) => {
    const openBtn = e.target.closest('[data-matter-open-signal]');
    if (openBtn) { openDetail(openBtn.dataset.matterOpenSignal); return; }
    const rmBtn = e.target.closest('[data-matter-remove]');
    if (rmBtn && currentMatterId && canEditShared()) {
      try {
        await detachSignalFromMatter(currentMatterId, rmBtn.dataset.signalIdent);
      } catch {
        showToast('Could not remove the signal — check your connection and try again.');
        return;
      }
      const m = getMatter(currentMatterId);
      renderMatterSignalsList(m);
      renderMatterHistory(m.history);
      showToast('Signal removed from matter.');
      refreshOverviewPanels();
      renderMain();
    }
  });

  /* Feed: cards are re-created on every render, so the open-detail
     listener is delegated on the static container instead of per-card.
     Every signal card is a single click target — the whole card opens
     the signal (see renderCard); there is no separate quick-action
     button to distinguish here anymore. */
  document.getElementById('sigList').addEventListener('click', (e) => {
    const openBtn = e.target.closest('.sig-open');
    if (openBtn) { openDetail(openBtn.dataset.id); }
  });

  /* Active Matters list — also hosts the Archive's closed/dismissed-
     signals sub-case (renderArchivedSignalsIntoMattersList renders plain
     signal cards into this same list), so this delegation handles both
     .sig-open shapes (matter cards carry data-matter-id; signal cards
     carry data-id). */
  document.getElementById('mattersList').addEventListener('click', (e) => {
    const openBtn = e.target.closest('.sig-open');
    if (openBtn) {
      if (openBtn.dataset.matterId) { openMatterDetail(openBtn.dataset.matterId); return; }
      if (openBtn.dataset.id) { openDetail(openBtn.dataset.id); return; }
    }
  });
  document.getElementById('newMatterBtn').addEventListener('click', openManualMatterCreate);

  /* Active Matters — Active/Archive toggle + Archive sub-nav (V6.1) */
  document.getElementById('matterArchiveToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activeFilters.mattersArchive = btn.dataset.archive;
    if (activeFilters.mattersArchive === 'archive') activeFilters.completedSubTab = 'resolved-matters';
    renderMain();
  });
  document.getElementById('matterArchiveSubNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activeFilters.completedSubTab = btn.dataset.sub;
    renderMain();
  });

  /* Workspace menu (V3.2 §10 / §15): close on outside click, close on
     Escape. Native <details> gives neither for free. Card "More" menus
     (rebuilt on every render, so they already reset when a card's own
     action fires or the workspace switches — see renderCard) get the
     same outside-click/Escape treatment for consistency. */
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('workspaceMenu');
    if (menu.open && !menu.contains(e.target)) menu.open = false;
    document.querySelectorAll('.card-more[open]').forEach(d => {
      if (!d.contains(e.target)) d.open = false;
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const menu = document.getElementById('workspaceMenu');
    if (menu.open) menu.open = false;
    document.querySelectorAll('.card-more[open]').forEach(d => { d.open = false; });
    closeMobileFilters();
  });
}

function resetFilters() {
  // Resets the signal-level filters and sort; deliberately leaves the
  // primary/sub navigation alone, since that's workspace structure, not a filter.
  activeFilters = {
    ...activeFilters,
    priority: 'all', county: '', jurisdiction: '', category: '', review: '', recency: '', search: '',
    workflowStatus: '', reviewStateFilter: '', sort: 'newest',
  };
  document.getElementById('searchBox').value = '';
  document.getElementById('countySel').value = '';
  document.getElementById('jurisdictionSel').value = '';
  document.getElementById('categorySel').value = '';
  document.getElementById('reviewSel').value = '';
  document.getElementById('recencySel').value = '';
  document.getElementById('reviewStateSel').value = '';
  document.getElementById('workflowSel').value = '';
  document.getElementById('sortSel').value = 'newest';
  document.querySelectorAll('#priorityTabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.priority === 'all');
    t.setAttribute('aria-selected', t.dataset.priority === 'all' ? 'true' : 'false');
  });
  renderMain();
}

function resetMatterFilters() {
  activeFilters = { ...activeFilters, matterCounty: '', matterJurisdiction: '', matterPriority: 'all', matterStatus: '', matterSort: 'default' };
  document.getElementById('mfCounty').value = '';
  document.getElementById('mfJurisdiction').value = '';
  document.getElementById('mfStatus').value = '';
  document.getElementById('mfSort').value = 'default';
  document.querySelectorAll('#matterPriorityTabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.priority === 'all');
    t.setAttribute('aria-selected', t.dataset.priority === 'all' ? 'true' : 'false');
  });
  renderMain();
}

function populateWorkflowStatusFilter() {
  const statuses = activeFilters.signalsSubTab === 'monitoring' ? ['Monitoring']
    : []; // Needs Review / Escalated / All / Today drill-downs only ever contain one implicit status (or none) — no sub-filter needed
  const sel = document.getElementById('workflowSel');
  sel.innerHTML = `<option value="">All in view</option>` + statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  // This runs on every render (nav switches, keystrokes, etc.) — rebuilding
  // innerHTML resets the DOM element's displayed value to its first option,
  // so it must be explicitly re-synced with the authoritative JS state below,
  // otherwise the dropdown could visually show "All in view" while a stale
  // selection silently keeps filtering underneath it.
  if (statuses.includes(activeFilters.workflowStatus)) {
    sel.value = activeFilters.workflowStatus;
  } else {
    activeFilters.workflowStatus = '';
    sel.value = '';
  }
}

/* Populate County/Jurisdiction/Category/Review dropdowns strictly from
   values present in the deduplicated, focus-county-scoped data set
   — never fabricated options. */
function populateFilterOptions() {
  const juris = [...new Set(displaySignals.map(s => s._c.jurisdiction).filter(hasVal))].sort();
  const cats  = [...new Set(displaySignals.map(s => s._c.category).filter(hasVal))].sort();
  const revs  = [...new Set(displaySignals.map(s => s._c.reviewStatus).filter(hasVal))].sort();

  fillSelect('jurisdictionSel', juris, 'All jurisdictions');
  fillSelect('categorySel', cats, 'All categories');
  fillSelect('reviewSel', revs, 'All statuses', cap);
}

function populateMatterFilterOptions() {
  const list = allMatters();
  const counties = [...new Set(list.map(m => m.county).filter(hasVal))].sort();
  const juris = [...new Set(list.map(m => m.jurisdiction).filter(hasVal))].sort();
  fillSelect('mfCounty', counties, 'All counties');
  fillSelect('mfJurisdiction', juris, 'All jurisdictions');
}

function fillSelect(id, values, allLabel, labelFn) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(v => `<option value="${esc(v)}">${esc(labelFn ? labelFn(v) : v)}</option>`).join('');
  if (values.includes(current)) sel.value = current;
}

/* ── Stats (reflect the deduplicated, focus-county-scoped set) ────── */
// V8 Part 5 (docs/watchdog-v8-component-inventory.md's six-way counting
// distinction): the six-tile territory wall this used to feed is gone
// from Today entirely — a "Jurisdictions" or "Sources" count of the
// *current signal set* reads as a fact about the whole monitored
// territory, which it never was. That computation is deleted outright,
// not merely hidden, so it can't quietly resurface under the same
// misleading bare label later. High/Medium/Monitor counts and the
// canonical signal count remain computed (still meaningful, still
// clearly scoped to "right now"), written only if a target element
// exists — same defensive pattern as updateTimestamps() above — so nothing
// throws if no view currently displays them.
function updateStats() {
  const high = displaySignals.filter(s => s._c.priority === 'High').length;
  const med  = displaySignals.filter(s => s._c.priority === 'Medium').length;
  const mon  = displaySignals.filter(s => s._c.priority === 'Monitor').length;

  const cHigh = document.getElementById('cHigh'); if (cHigh) cHigh.textContent = high;
  const cMed = document.getElementById('cMed'); if (cMed) cMed.textContent = med;
  const cMon = document.getElementById('cMon'); if (cMon) cMon.textContent = mon;
  const cTerritory = document.getElementById('cTerritory'); if (cTerritory) cTerritory.textContent = displaySignals.length;
}

/* ══ Main render dispatcher ══════════════════════════════════════
   Primary navigation determines whether the content area shows signal
   cards, Policy Matter cards, or the Attention Center tile overview. ── */
// True whenever the current screen shows Policy Matters rather than
// signals: the Policy Matters tab itself, Completed → Resolved Policy
// Matters, or (V4) an Attention queue whose def is matter-shaped. Single
// source of truth for both renderMain() and updateNavUI() below — kept
// as one function specifically because the two independently duplicating
// this condition is exactly how the V3.2 filter-panel-leakage bug slipped
// in previously.
// V6.1: the old standalone "Completed" primary tab folded into an Archive
// toggle inside Active Matters (product-clarity §8). Archive has two
// shapes: resolved matters (matters-shaped, same renderer as Active) and
// closed/dismissed signals (signal-shaped, rendered into the same
// #mattersList so the Archive toggle bar never disappears mid-navigation).
function isArchiveSignalsView() {
  return activeFilters.primaryView === 'matters' && activeFilters.mattersArchive === 'archive'
    && activeFilters.completedSubTab !== 'resolved-matters';
}

function isMattersShapedView() {
  const queueDef = activeFilters.primaryView === 'today' && activeFilters.attentionQueue
    ? findAttentionQueueDef(activeFilters.attentionQueue) : null;
  return (activeFilters.primaryView === 'matters' && !isArchiveSignalsView()) ||
    (queueDef && queueDef.shape === 'matter');
}

function renderMain() {
  updateNavUI();

  const isMattersShaped = isMattersShapedView();
  const isArchiveSignals = isArchiveSignalsView();
  const isTodayOverview = activeFilters.primaryView === 'today' && !activeFilters.attentionQueue;
  const isSourceCoverage = activeFilters.primaryView === 'sourceCoverage';
  const isQuarantine = activeFilters.primaryView === 'quarantine';
  const isOperations = activeFilters.primaryView === 'operations';
  const isReports = activeFilters.primaryView === 'reports';

  document.getElementById('feedSection').hidden = isMattersShaped || isArchiveSignals || isTodayOverview || isSourceCoverage || isQuarantine || isOperations || isReports;
  document.getElementById('mattersSection').hidden = !(isMattersShaped || isArchiveSignals);
  document.getElementById('todaySection').hidden = !isTodayOverview;
  document.getElementById('sourceCoverageSection').hidden = !isSourceCoverage;
  document.getElementById('quarantineSection').hidden = !isQuarantine;
  document.getElementById('operationsSection').hidden = !isOperations;
  document.getElementById('reportsSection').hidden = !isReports;

  if (isTodayOverview) { renderTodayView(); return; }
  if (isSourceCoverage) { renderSourceCoverageView(); return; }
  if (isQuarantine) { renderQuarantineView(); return; }
  if (isOperations) { renderOperationsView(); return; }
  if (isReports) { renderReportsView(); return; }
  if (isMattersShaped || isArchiveSignals) {
    const queueDef = activeFilters.primaryView === 'today' && activeFilters.attentionQueue
      ? findAttentionQueueDef(activeFilters.attentionQueue) : null;
    renderActiveMattersSection({
      resolvedOnly: activeFilters.primaryView === 'matters' && activeFilters.mattersArchive === 'archive' && activeFilters.completedSubTab === 'resolved-matters',
      attentionQueue: queueDef ? queueDef.key : null,
    });
    return;
  }
  renderSignalsView();
}

const NAV_SUBTITLES = {
  today: 'What requires your attention right now.',
  signals: 'Newly detected activity — reviewed, monitored, or escalated.',
  matters: 'Issues receiving sustained government-affairs management.',
  reports: 'Jurisdiction briefings, summaries, and outcome reports.',
  sourceCoverage: 'The trusted source registry across the four-county territory.',
  quarantine: 'Signals held because geography, jurisdiction, or source identity is uncertain.',
  operations: 'Hosted scanners, source availability, and collection history.',
};

function updateNavUI() {
  document.querySelectorAll('#primaryNav .pnav-tab').forEach(b => {
    const active = b.dataset.primary === activeFilters.primaryView;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  // System menu (Sources / Validation Queue / System Health) — subordinate
  // to the four primary tabs; the trigger itself lights up when any of its
  // items is the active view, same visual language as a pnav-tab.
  const inSystemMenu = ['sourceCoverage', 'quarantine', 'operations'].includes(activeFilters.primaryView);
  const systemTrigger = document.getElementById('systemMenuTrigger');
  if (systemTrigger) systemTrigger.classList.toggle('active', inSystemMenu);
  document.querySelectorAll('#systemMenu .system-menu-item').forEach(b => {
    b.classList.toggle('active', b.dataset.primary === activeFilters.primaryView);
  });
  document.getElementById('navSubtitle').textContent = NAV_SUBTITLES[activeFilters.primaryView] || '';

  document.getElementById('signalsSubNav').hidden = activeFilters.primaryView !== 'signals';
  document.querySelectorAll('#signalsSubNav .tab').forEach(b => {
    const active = b.dataset.sub === activeFilters.signalsSubTab;
    b.classList.toggle('active', active); b.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const inMatters = activeFilters.primaryView === 'matters';
  document.getElementById('matterArchiveToggle').hidden = !inMatters;
  document.querySelectorAll('#matterArchiveToggle .tab').forEach(b => {
    const active = b.dataset.archive === activeFilters.mattersArchive;
    b.classList.toggle('active', active); b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.getElementById('matterArchiveSubNav').hidden = !inMatters || activeFilters.mattersArchive !== 'archive';
  document.querySelectorAll('#matterArchiveSubNav .tab').forEach(b => {
    const active = b.dataset.sub === activeFilters.completedSubTab;
    b.classList.toggle('active', active); b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const mattersExplain = document.getElementById('mattersExplain');
  if (mattersExplain) mattersExplain.hidden = !inMatters || activeFilters.mattersArchive === 'archive';
  document.getElementById('newMatterBtn').hidden = inMatters && activeFilters.mattersArchive === 'archive';

  // Today's overview (no queue drilled into yet) has no list to filter —
  // neither the signal filters nor the matter filters belong there. Same
  // for Sources/Validation Queue/System Health/Reports (each has its own
  // always-visible controls or none at all) and the Archive's
  // closed/dismissed-signals sub-case (a retrospective view, not a working
  // queue — see isArchiveSignalsView()).
  const isTodayOverview = activeFilters.primaryView === 'today' && !activeFilters.attentionQueue;
  const isMattersShaped = isMattersShapedView();
  const isArchiveSignals = isArchiveSignalsView();
  const isNoFilterPanelView = ['sourceCoverage', 'quarantine', 'operations', 'reports'].includes(activeFilters.primaryView)
    || isTodayOverview || isArchiveSignals;
  const showSignalFilters = !isNoFilterPanelView && !isMattersShaped;
  const showMatterFilters = !isNoFilterPanelView && isMattersShaped;
  document.getElementById('signalFiltersPanel').hidden = !showSignalFilters;
  document.getElementById('matterFiltersPanel').hidden = !showMatterFilters;
  document.getElementById('attentionBackBar').hidden = !(activeFilters.primaryView === 'today' && activeFilters.attentionQueue);
  document.getElementById('mobileFiltersToggle').hidden = isNoFilterPanelView;
  if (isNoFilterPanelView) mobileFiltersOpen = false;

  // V8 Part 4/10: the six-tile territory wall and the Review Progress
  // wall are gone entirely (not merely hidden elsewhere) — see
  // renderTodayView() and computeReviewProgress() above.

  // Attention summary and the compact Needs Review count are shown only
  // on the Intelligence screen (V8 Part 10).
  if (activeFilters.primaryView === 'signals') {
    renderAttentionSummary();
    updateNeedsReviewCount();
  } else {
    document.getElementById('attentionSummaryWrap').hidden = true;
  }

  populateWorkflowStatusFilter();
  updateAdvancedFilterIndicator();
  applyMobileFiltersState();
}

/* Count of active ADVANCED filters only (the six tucked inside "More
   Filters"): Jurisdiction, Category, Scanner Review Status, Detected
   Date, Local Review State, Workflow Status. */
function countAdvancedFilters() {
  const f = activeFilters;
  return [f.jurisdiction, f.category, f.review, f.recency, f.reviewStateFilter, f.workflowStatus]
    .filter(hasVal).length;
}

/* Count of every active signal filter, advanced or not — used for the
   mobile Filters button, where everything (including Search/County/
   Priority) is tucked behind one control, so the summary should reflect
   the whole picture, not just the advanced subset. */
function countAllSignalFilters() {
  const f = activeFilters;
  return countAdvancedFilters() +
    (hasVal(f.search) ? 1 : 0) +
    (hasVal(f.county) ? 1 : 0) +
    (f.priority !== 'all' ? 1 : 0);
}

function updateAdvancedFilterIndicator() {
  const count = countAdvancedFilters();
  const dot = document.getElementById('advFilterDot');
  dot.hidden = count === 0;
  dot.textContent = count > 0 ? String(count) : '';
}

/* ── Mobile filter drawer (V3.2 §7) ──────────────────────────────────
   On narrow screens the filter panel is collapsed by default (CSS hides
   any .filters-panel that lacks .mobile-open) so the feed is reachable
   without scrolling past filters first. One shared toggle button always
   targets whichever panel is currently relevant to the active workspace
   — never the hidden one. On desktop this state is simply inert: the
   CSS rules that hide non-.mobile-open panels only apply under the
   mobile breakpoint. */
let mobileFiltersOpen = false;

function currentFiltersPanelId() {
  return document.getElementById('signalFiltersPanel').hidden ? 'matterFiltersPanel' : 'signalFiltersPanel';
}

function applyMobileFiltersState() {
  document.querySelectorAll('.filters-panel').forEach(p => p.classList.remove('mobile-open'));
  if (mobileFiltersOpen) document.getElementById(currentFiltersPanelId()).classList.add('mobile-open');
  updateMobileFiltersButton();
}

function updateMobileFiltersButton() {
  const btn = document.getElementById('mobileFiltersToggle');
  if (!btn) return;
  const isMatters = currentFiltersPanelId() === 'matterFiltersPanel';
  const count = isMatters
    ? [activeFilters.matterCounty, activeFilters.matterJurisdiction, activeFilters.matterStatus].filter(hasVal).length +
      (activeFilters.matterPriority !== 'all' ? 1 : 0)
    : countAllSignalFilters();
  btn.textContent = count > 0 ? `Filters (${count})` : 'Filters';
  btn.setAttribute('aria-expanded', mobileFiltersOpen ? 'true' : 'false');
}

function toggleMobileFilters() {
  mobileFiltersOpen = !mobileFiltersOpen;
  applyMobileFiltersState();
}
function closeMobileFilters() {
  if (!mobileFiltersOpen) return;
  mobileFiltersOpen = false;
  applyMobileFiltersState();
}

/* ── Reports (placeholder destination — product-clarity §9) ──────────
   Fully static; establishes the future product area honestly, no
   generation of any kind happens here yet. ─────────────────────────── */
const REPORT_TYPES = [
  { name: 'Jurisdiction Briefings', body: 'A per-jurisdiction summary of everything Watchdog has tracked.' },
  { name: 'Issue Research Reports', body: 'Deep-dive background on a single issue category or Active Matter.' },
  { name: 'Weekly Intelligence Summaries', body: 'A rolling digest of the week’s new and escalated signals.' },
  { name: 'Leadership Briefs', body: 'A short, decision-ready summary for executive or board audiences.' },
  { name: 'Trend Analysis', body: 'Patterns across jurisdictions, categories, or time.' },
  { name: 'Outcome Reports', body: 'What happened after a Matter was engaged — the advocacy record.' },
];

function renderReportsView() {
  const el = document.getElementById('reportsGrid');
  if (!el || el.dataset.rendered) return; // fully static — render once
  el.dataset.rendered = '1';
  el.innerHTML = REPORT_TYPES.map((r) => `
    <div class="report-card">
      <p class="report-card-title">${esc(r.name)}</p>
      <p class="report-card-body">${esc(r.body)}</p>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════════════
   V6.1 TODAY — the default authenticated landing workspace
   (product-clarity §4). Answers "what requires my attention right now?"
   using the same underlying queue data as the old Attention Center tile
   grid (computeAttentionCounts/attentionQueueSignals/etc., unchanged),
   reorganized into named, explained sections with direct next actions.
   ══════════════════════════════════════════════════════════════════ */

function todaySectionHtml(opts) {
  const { title, explain, count, emptyText, linkLabel, linkQueueKey, bodyHtml } = opts;
  if (count === 0 && !opts.alwaysShow) {
    return `<div class="today-section">
      <div class="today-section-head"><p class="today-section-title">${esc(title)}</p></div>
      <p class="today-section-explain">${esc(emptyText || ('No ' + title.toLowerCase() + ' right now.'))}</p>
    </div>`;
  }
  const link = linkQueueKey
    ? `<button type="button" class="today-section-link" data-queue="${esc(linkQueueKey)}">${esc(linkLabel || 'View all →')}</button>`
    : '';
  return `<div class="today-section">
    <div class="today-section-head">
      <p class="today-section-title">${esc(title)} <span class="today-section-count">${count}</span></p>
      ${link}
    </div>
    ${explain ? `<p class="today-section-explain">${esc(explain)}</p>` : ''}
    ${bodyHtml}
  </div>`;
}

// "Open", never "Review" — this button only opens the signal (see the
// data-open-signal handler, which calls openDetail()); it does not mark
// anything Reviewed. Labeling it "Review" was itself part of the V7.1
// review-semantics confusion this V8 pass corrects (Part 1).
function todayMiniSignalRow(s, reasonChips) {
  const c = s._c;
  return `<div class="matter-sig-row">
    <div>
      <p class="matter-sig-title" title="${esc(displayHeadline(c))}">${esc(displayHeadline(c))}</p>
      <div class="matter-sig-meta">
        ${(reasonChips || []).map((r) => `<span class="chip chip-reason">${esc(r)}</span>`).join('')}
        <span class="chip">${esc(c.jurisdiction || 'Unknown jurisdiction')}</span>
        <span class="chip">Detected ${esc(detectedAgeLabel(s.detected_at))}</span>
      </div>
    </div>
    <div class="matter-sig-actions">
      <button type="button" class="wf-tool-btn" data-open-signal="${esc(s.id)}">Open</button>
    </div>
  </div>`;
}

function todayMiniMatterRow(m, reasonChips) {
  return `<div class="matter-sig-row">
    <div>
      <p class="matter-sig-title">${esc(m.title || 'Untitled matter')}</p>
      <div class="matter-sig-meta">
        ${(reasonChips || []).map((r) => `<span class="chip chip-reason">${esc(r)}</span>`).join('')}
        <span class="chip">${esc(m.status)}</span>
        ${hasVal(m.followUpDate) ? `<span class="chip">Follow-up ${esc(dateOnly(m.followUpDate))}</span>` : ''}
      </div>
    </div>
    <div class="matter-sig-actions">
      <button type="button" class="wf-tool-btn" data-open-matter="${esc(m.id)}">Open</button>
    </div>
  </div>`;
}

/* ══ V8 Part 4 — Today's "Requires Action" section ═══════════════════
   Merges four overlapping conditions (signal overdue/due-today/Action
   Required, matter overdue/due-today/Action Required) into ONE
   deduplicated, urgency-sorted list — a record matching more than one
   condition appears exactly once, with every matching reason shown as a
   compact chip, instead of once per condition the way the old Today
   sections did (a signal that was both overdue AND Action Required used
   to appear in two separate section lists). ══════════════════════════ */
const REQUIRES_ACTION_REASON_LABELS = {
  overdue: 'Overdue follow-up', dueToday: 'Due today', actionRequired: 'Action Required',
  matterOverdue: 'Overdue follow-up', matterDueToday: 'Due today', matterActionRequired: 'Action Required',
};
function requiresActionUrgencyRank(reasons) {
  if (reasons.includes('overdue') || reasons.includes('matterOverdue')) return 0;
  if (reasons.includes('dueToday') || reasons.includes('matterDueToday')) return 1;
  return 2; // Action Required only
}
function computeRequiresActionItems() {
  const byKey = new Map();
  function addReason(kind, key, item, reasonKey) {
    const mapKey = kind + ':' + key;
    if (!byKey.has(mapKey)) byKey.set(mapKey, { kind, item, reasons: [] });
    byKey.get(mapKey).reasons.push(reasonKey);
  }
  for (const s of displaySignals) {
    const wf = getWorkflow(s);
    const key = signalIdentity(s);
    if (isOverdueFollowUp(wf)) addReason('signal', key, s, 'overdue');
    if (isDueTodayFollowUp(wf)) addReason('signal', key, s, 'dueToday');
    if (wf.status === 'Action Required') addReason('signal', key, s, 'actionRequired');
  }
  for (const m of activeMatters()) {
    if (isMatterOverdue(m)) addReason('matter', m.id, m, 'matterOverdue');
    if (isMatterDueToday(m)) addReason('matter', m.id, m, 'matterDueToday');
    if (m.status === 'Action Required') addReason('matter', m.id, m, 'matterActionRequired');
  }
  return [...byKey.values()].sort((a, b) => requiresActionUrgencyRank(a.reasons) - requiresActionUrgencyRank(b.reasons));
}
function requiresActionRowHtml(entry) {
  // Unique reason labels only — "Overdue follow-up" should not be listed
  // twice if a record somehow matched both overdue keys.
  const labels = [...new Set(entry.reasons.map((r) => REQUIRES_ACTION_REASON_LABELS[r]))];
  return entry.kind === 'signal' ? todayMiniSignalRow(entry.item, labels) : todayMiniMatterRow(entry.item, labels);
}

async function todayOperationalWarningHtml() {
  try {
    await ensureOperationsLoaded();
  } catch { /* best-effort — Today must never fail to render because System Health couldn't load */ }
  if (!scannerRunRows.length) return '';

  const lastRun = scannerRunRows[0];
  const lastSuccessful = scannerRunRows.find((r) => r.status === 'Successful' || r.status === 'Successful With Warnings');
  const staleCutoffMs = 36 * 60 * 60 * 1000;
  const isStale = !lastSuccessful || (Date.now() - new Date(lastSuccessful.started_at).getTime()) > staleCutoffMs;
  const justFailed = lastRun.status === 'Failed';

  if (!isStale && !justFailed) return '';

  const msg = justFailed
    ? `The most recent scanner run failed (${esc(relativeDate(lastRun.started_at))}).`
    : `No successful scanner run in over 36 hours — collection may not be current.`;
  return `<div class="today-warning">
    <span class="today-warning-icon" aria-hidden="true">⚠</span>
    <span>${msg} <button type="button" class="today-section-link" data-queue="__systemHealth">Check System Health →</button></span>
  </div>`;
}

/* V8 Part 4 — Today opens directly into the work: exactly three
   ordered sections, each answering one decision a GAD actually needs
   Today to answer. Nothing here exists that doesn't support one of
   those three decisions — the six-tile territory wall and the Review
   Progress wall are both gone from this view entirely (removed from
   app.html; see docs/watchdog-v8-component-inventory.md for why they
   were administrative noise, not decisions). */
async function renderTodayView() {
  const el = document.getElementById('todayContent');
  el.innerHTML = `<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading Today…</p></div>`;

  // 1. REQUIRES ACTION — deduplicated, urgency-sorted; a record matching
  // more than one condition (e.g. both overdue AND Action Required)
  // appears exactly once, with every matching reason as a compact chip.
  const requiresAction = computeRequiresActionItems();

  // 2. NEW INTELLIGENCE — highest-value unreviewed High/Medium signals
  // only; never Monitor-priority items, and never more than 5 at a time.
  const newIntelligence = displaySignals
    .filter((s) => !window.WatchdogReviewSemantics.isReviewed(getWorkflow(s)) && ['High', 'Medium'].includes(s._c.priority))
    .sort((a, b) => {
      const rank = { High: 0, Medium: 1 };
      const r = (rank[a._c.priority] ?? 2) - (rank[b._c.priority] ?? 2);
      return r !== 0 ? r : new Date(b.detected_at || 0) - new Date(a.detected_at || 0);
    });

  // 3. ACTIVE MATTERS UPDATED — updatedAt !== createdAt only tells us a
  // field changed at some point after creation, within the last 3 days;
  // it does NOT by itself establish that the change was material or
  // meaningful — audit_events would be needed to say that, and this
  // section doesn't consult it. The heading and copy stay deliberately
  // neutral ("updated," never "material"/"meaningful") to match exactly
  // what this filter can honestly claim. activeMatters() (status !==
  // 'Resolved') excludes archived/resolved matters without deleting or
  // otherwise touching them.
  const mattersUpdated = activeMatters()
    .filter((m) => hasVal(m.updatedAt) && (Date.now() - new Date(m.updatedAt).getTime()) < 3 * 86400000 && m.updatedAt !== m.createdAt)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const warningHtml = await todayOperationalWarningHtml();
  if (activeFilters.primaryView !== 'today' || activeFilters.attentionQueue) return; // navigated away while loading

  const sections = [];

  sections.push(todaySectionHtml({
    title: 'Requires Action', count: requiresAction.length,
    explain: 'Overdue and due-today follow-ups, plus signals and Active Matters marked Action Required.',
    emptyText: 'Nothing currently requires action.',
    bodyHtml: requiresAction.length ? `<div class="matter-sig-list">${requiresAction.map(requiresActionRowHtml).join('')}</div>` : '',
  }));

  sections.push(todaySectionHtml({
    title: 'New Intelligence', count: newIntelligence.length,
    explain: 'The highest-value unreviewed High and Medium signals.',
    emptyText: 'No unreviewed High or Medium signals right now.',
    linkQueueKey: 'unreviewedHM', linkLabel: 'Go to Intelligence →',
    bodyHtml: newIntelligence.length ? `<div class="matter-sig-list">${newIntelligence.slice(0, 5).map((s) => todayMiniSignalRow(s)).join('')}</div>` : '',
  }));

  sections.push(todaySectionHtml({
    title: 'Active Matters Updated', count: mattersUpdated.length,
    explain: 'Active Matters updated within the last 3 days.',
    emptyText: 'No Active Matters were updated in the last 3 days.',
    bodyHtml: mattersUpdated.length ? `<div class="matter-sig-list">${mattersUpdated.slice(0, 5).map((m) => todayMiniMatterRow(m)).join('')}</div>` : '',
  }));

  el.innerHTML = `${warningHtml}${sections.join('')}`;
}

/* ── Signals view (Signals tab, Completed/Closed|Dismissed, Attention
   drill-down) — one shared renderer parameterized by the current bucket. */
// V6.1: a signal counts as "Escalated to Matter" once it's linked to any
// Active Matter (policy_matter_signals), regardless of its own workflow
// status — a real, existing relationship, not a new workflow state.
function isEscalatedToMatter(s) {
  const identity = signalIdentity(s);
  return Object.values(matterSignalLinks).some(ids => ids.includes(identity));
}

function currentSignalBucket() {
  const f = activeFilters;
  if (f.primaryView === 'today' && f.attentionQueue) return { type: 'attention', queue: f.attentionQueue };
  if (f.signalsSubTab === 'monitoring') return { type: 'status', statuses: ['Monitoring'] };
  if (f.signalsSubTab === 'escalated') return { type: 'escalated' };
  if (f.signalsSubTab === 'all') return { type: 'all' };
  return { type: 'status', statuses: QUEUE_STATUSES }; // 'queue' (default) — Needs Review
}

function renderSignalsView() {
  const f = activeFilters;
  const bucket = currentSignalBucket();
  const search = (f.search || '').toLowerCase();
  const cutoff = f.recency ? Date.now() - Number(f.recency) * 86400000 : null;

  const base = bucket.type === 'attention' ? attentionQueueSignals(bucket.queue)
    : bucket.type === 'escalated' ? displaySignals.filter(isEscalatedToMatter)
    : bucket.type === 'all' ? displaySignals.slice()
    : displaySignals.filter(s => bucket.statuses.includes(getWorkflow(s).status));

  const filtered = base.filter(s => {
    const wf = getWorkflow(s);
    if (f.reviewStateFilter && reviewState(wf) !== f.reviewStateFilter) return false;
    if (f.workflowStatus && wf.status !== f.workflowStatus) return false;
    if (f.priority !== 'all' && s._c.priority !== f.priority) return false;
    if (f.county && s.county !== f.county) return false;
    if (f.jurisdiction && s._c.jurisdiction !== f.jurisdiction) return false;
    if (f.category && s._c.category !== f.category) return false;
    if (f.review && s._c.reviewStatus !== f.review) return false;
    if (cutoff) {
      const t = s.detected_at ? new Date(s.detected_at).getTime() : 0;
      if (!(t >= cutoff)) return false;
    }
    if (search) {
      const hay = [s._c.cleanTitle, s._c.jurisdiction, s._c.category, s._c.summary, s._c.snippet]
        .filter(hasVal).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const sorted = f.sort === 'urgency' ? [...filtered].sort(attentionSortCompare) : sortSignals(filtered, f.sort);
  renderList(sorted);
}

function sortSignals(list, mode) {
  const arr = [...list];
  if (mode === 'oldest') {
    arr.sort((a, b) => new Date(a.detected_at || 0) - new Date(b.detected_at || 0));
  } else if (mode === 'priority') {
    const rank = { High: 0, Medium: 1, Monitor: 2 };
    arr.sort((a, b) => (rank[a._c.priority] ?? 3) - (rank[b._c.priority] ?? 3) || new Date(b.detected_at || 0) - new Date(a.detected_at || 0));
  } else if (mode === 'followup') {
    arr.sort((a, b) => {
      const fa = getWorkflow(a).followUpDate, fb = getWorkflow(b).followUpDate;
      if (!fa && !fb) return 0;
      if (!fa) return 1;
      if (!fb) return -1;
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
  } else if (mode === 'updated') {
    arr.sort((a, b) => {
      const ua = getWorkflow(a).updatedAt, ub = getWorkflow(b).updatedAt;
      if (!ua && !ub) return 0;
      if (!ua) return 1;
      if (!ub) return -1;
      return new Date(ub) - new Date(ua);
    });
  } else if (mode === 'urgency') {
    arr.sort(attentionSortCompare);
  } else {
    arr.sort((a, b) => new Date(b.detected_at || 0) - new Date(a.detected_at || 0));
  }
  return arr;
}

/* ── Rendering: states ────────────────────────────────────────── */
function renderState(kind, detail) {
  const list = document.getElementById('sigList');
  document.getElementById('feedCount').textContent = '';
  if (kind === 'loading') {
    list.innerHTML = `<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading signals…</p></div>`;
  } else if (kind === 'empty') {
    list.innerHTML = `<div class="state empty"><p>No signals have been detected yet for the Collin, Hunt, Rockwall, and Van Zandt territory.</p></div>`;
  } else if (kind === 'error') {
    list.innerHTML = `<div class="state error">
      <p>Could not load signal data from Supabase.</p>
      <p class="state-detail">${esc(detail || '')}</p>
      <button class="state-btn" type="button" onclick="loadSignals()">Retry</button>
    </div>`;
  }
}

/* ── Rendering: signal list ──────────────────────────────────── */
function signalEmptyStateMessage() {
  if (activeFilters.primaryView === 'today' && activeFilters.attentionQueue) return 'No signals currently require action.';
  if (activeFilters.signalsSubTab === 'escalated') return 'No signals are currently escalated to an Active Matter.';
  return 'No signals match these filters.';
}

function renderList(filtered) {
  const list = document.getElementById('sigList');
  const parts = [`${filtered.length} unique signal${filtered.length === 1 ? '' : 's'}`];
  if (duplicatesHidden > 0) parts.push(`${duplicatesHidden} duplicate${duplicatesHidden === 1 ? '' : 's'} hidden`);
  document.getElementById('feedCount').textContent = parts.join(' · ');

  if (!filtered.length) {
    list.innerHTML = `<div class="state no-results">
      <p>${esc(signalEmptyStateMessage())}</p>
      <button class="state-btn" type="button" onclick="resetFilters()">Reset filters</button>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(s => renderCard(s)).join('');
}

/* V3.1: simplified card — always show Priority, Jurisdiction, Title,
   Source, Detected age, and Workflow status when assigned; everything
   else that used to live on the card (tier, county, overdue badge,
   snippet, category/confidence/verified/member/matter-count chips) is
   still fully available in the detail dialog, just not duplicated here.
   One spotlighted primary quick action; the rest sit behind a native
   <details> "More" menu so nothing crowds the card or needs a custom
   popover/overlay. */
/* Combined Priority + Priority Tier badge (V3.2 §2): "P1 · HIGH" when a
   tier value exists on the record, plain "HIGH" when it doesn't — never
   a second/separate tier badge, and never an invented tier. */
function combinedPriorityLabel(s, c) {
  if (!hasVal(c.priority)) return '';
  const label = c.priority.toUpperCase();
  return hasVal(s.priority_level) ? `${s.priority_level} · ${label}` : label;
}

/* V6.1 review fix: card/Today headline text. Prefers an existing summary
   field only when it's genuinely different from the title (via the
   existing isSnippetRedundant check) — never fabricates text. Falls back
   to cleanTitle, which is itself never invented (stripTrailingSource only
   ever removes a redundant " - Source Name" suffix, never adds words) —
   the raw, unmodified s.title stays intact in the record and is shown
   verbatim in the Evidence tab (see renderDetailEvidence). */
function displayHeadline(c) {
  if (hasVal(c.summary) && !isSnippetRedundant(c.cleanTitle, c.summary)) return c.summary;
  return c.cleanTitle;
}

/* V8 Part 6 signal-card simplification: shows only what's needed to
   decide whether to open the signal — priority, Unreviewed / a
   meaningful workflow status, jurisdiction, detected age, headline,
   source. Category, confidence, verification, county, and provenance
   all remain available one click away in the Issue Brief (openDetail)
   — a card is a triage surface, not a second copy of the record. The
   entire card is one click target; there is no card-level action
   button of any kind. */
function renderCard(s) {
  const c = s._c;
  const priClass = ['High', 'Medium', 'Monitor'].includes(c.priority) ? c.priority : 'Monitor';
  const wf = getWorkflow(s);
  const unreviewed = !window.WatchdogReviewSemantics.isReviewed(wf);

  // ── Top line: combined priority badge, then exactly one review/status
  // badge — Unreviewed while still unreviewed, or the workflow status
  // only when it's itself meaningful (Action Required demands attention;
  // Monitoring/blank say nothing a reviewed card needs repeated), then
  // jurisdiction, Detected age right-aligned. ────────────────────────
  const topBadges = [];
  const priorityLabel = combinedPriorityLabel(s, c);
  if (hasVal(priorityLabel)) topBadges.push(`<span class="badge b-${priClass}">${esc(priorityLabel)}</span>`);
  if (unreviewed) topBadges.push(`<span class="chip chip-unreviewed">Unreviewed</span>`);
  else if (wf.status === 'Action Required') topBadges.push(`<span class="chip chip-action-required">Action Required</span>`);

  const cardClass = `sig p-${priClass}${wf.status === 'Action Required' ? ' wf-action-required' : ''}`;

  return `
  <div class="${cardClass}">
    <button class="sig-open" type="button" data-id="${esc(s.id)}" aria-haspopup="dialog">
      <div class="sig-top">
        ${topBadges.join('')}
        <span class="sig-juris">${esc(c.jurisdiction || 'Unknown jurisdiction')}</span>
        <span class="sig-date" title="${esc(absoluteDate(s.detected_at))}">Detected ${esc(detectedAgeLabel(s.detected_at))}</span>
      </div>
      <p class="sig-title" title="${esc(displayHeadline(c))}">${esc(displayHeadline(c))}</p>
      ${hasVal(c.source) ? `<p class="sig-source">${esc(c.source)}</p>` : ''}
    </button>
  </div>`;
}

/* ── Active Matters (V6.1 wrapper: dispatches to the matters-shaped
   renderer below, or — for the Archive's closed/dismissed-signals
   sub-case — renders signal cards into the same #mattersList so the
   Archive toggle bar stays visible throughout) ──────────────────────── */
function renderActiveMattersSection(opts) {
  if (isArchiveSignalsView() && !(opts && opts.attentionQueue)) {
    renderArchivedSignalsIntoMattersList();
    return;
  }
  renderMattersView(opts);
}

function renderArchivedSignalsIntoMattersList() {
  const statuses = activeFilters.completedSubTab === 'dismissed' ? ['Dismissed'] : ['Closed'];
  const sorted = displaySignals
    .filter(s => statuses.includes(getWorkflow(s).status))
    .sort((a, b) => new Date(b.detected_at || 0) - new Date(a.detected_at || 0));

  const label = activeFilters.completedSubTab === 'dismissed' ? 'dismissed' : 'closed';
  document.getElementById('mattersCount').textContent = `${sorted.length} ${label} signal${sorted.length === 1 ? '' : 's'}`;

  const el = document.getElementById('mattersList');
  if (!sorted.length) {
    el.innerHTML = `<div class="state no-results"><p>No ${esc(label)} signals yet.</p></div>`;
    return;
  }
  el.innerHTML = sorted.map(s => renderCard(s)).join('');
}

/* ── Policy Matters view ──────────────────────────────────────── */
function renderMattersView(opts) {
  opts = opts || {};
  const f = activeFilters;
  let base;
  if (opts.attentionQueue) base = attentionQueueMatters(opts.attentionQueue);
  else base = opts.resolvedOnly ? resolvedMatters() : activeMatters();

  const filtered = base.filter(m => {
    if (!opts.resolvedOnly && !opts.attentionQueue && f.matterStatus && m.status !== f.matterStatus) return false;
    if (f.matterPriority !== 'all' && m.priority !== f.matterPriority) return false;
    if (f.matterCounty && m.county !== f.matterCounty) return false;
    if (f.matterJurisdiction && m.jurisdiction !== f.matterJurisdiction) return false;
    return true;
  });

  const sorted = f.matterSort === 'updated'
    ? [...filtered].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    : [...filtered].sort(matterSortCompare);
  renderMatterList(sorted, opts);
}

function renderMatterList(list, opts) {
  opts = opts || {};
  const el = document.getElementById('mattersList');
  document.getElementById('mattersCount').textContent = `${list.length} matter${list.length === 1 ? '' : 's'}`;

  if (!list.length) {
    let msg;
    if (opts.attentionQueue) msg = 'No Active Matters currently require action in this queue.';
    else if (allMatters().length === 0) {
      msg = 'No Active Matters yet. Create one directly or escalate a reviewed signal when an issue requires sustained management, coordination, or follow-up.';
    }
    else if (opts.resolvedOnly) msg = 'No resolved matters match these filters.';
    else msg = 'No Active Matters match your filters.';
    el.innerHTML = `<div class="state no-results"><p>${esc(msg)}</p></div>`;
    return;
  }
  el.innerHTML = list.map(m => renderMatterCard(m)).join('');
}

function renderMatterCard(m) {
  const overdue = isMatterOverdue(m), dueToday = isMatterDueToday(m);
  const priClass = ['High', 'Medium', 'Monitor'].includes(m.priority) ? m.priority : 'Monitor';
  const badges = [
    `<span class="badge b-${priClass}">${esc(m.priority)}</span>`,
    `<span class="wf-badge${m.status === 'Action Required' ? ' wf-badge-action' : ''}">${esc(m.status)}</span>`,
  ];
  if (overdue) badges.push(`<span class="wf-badge-overdue">⏰ Overdue</span>`);
  else if (dueToday) badges.push(`<span class="wf-badge-overdue">Due Today</span>`);

  const chips = [];
  if (hasVal(m.category)) chips.push(`<span class="chip">${esc(m.category)}</span>`);
  if (hasVal(m.followUpDate)) chips.push(`<span class="chip">Follow-up ${esc(dateOnly(m.followUpDate))}</span>`);
  chips.push(`<span class="chip">${m.signalIds.length} signal${m.signalIds.length === 1 ? '' : 's'} attached</span>`);

  return `
  <div class="sig p-${priClass}${m.status === 'Action Required' ? ' wf-action-required' : ''}">
    <button class="sig-open" type="button" data-matter-id="${esc(m.id)}" aria-haspopup="dialog">
      <div class="sig-top">
        ${badges.join('')}
        <span class="sig-juris">${esc(m.jurisdiction || 'Unspecified jurisdiction')}</span>
        ${hasVal(m.county) ? `<span class="sig-county">${esc(m.county)} County</span>` : ''}
        <span class="sig-date">Updated ${esc(relativeDate(m.updatedAt))}</span>
      </div>
      <p class="sig-title">${esc(m.title || 'Untitled matter')}</p>
      ${hasVal(m.nextAction) ? `<p class="sig-snip">Next: ${esc(m.nextAction)}</p>` : ''}
      <div class="sig-meta-row">${chips.join('')}</div>
    </button>
  </div>`;
}

function canEditShared() {
  return !!(window.WatchdogSecurity && window.WatchdogSecurity.canEditShared(currentUserRole));
}

function canAdminister() {
  return !!(window.WatchdogSecurity && window.WatchdogSecurity.canAdminister(currentUserRole));
}

/* ══════════════════════════════════════════════════════════════════
   V5 SOURCE COVERAGE — read-only source_registry browser. Independent
   of the signal-shaped filter/dedup pipeline above; source_registry
   rows are a different entity entirely from signals. Loaded lazily on
   first visit to the tab, not at boot.
   ══════════════════════════════════════════════════════════════════ */

async function ensureSourceRegistryLoaded() {
  if (sourceRegistryLoaded) return;
  try {
    sourceRegistryRows = await window.WatchdogRepository.fetchSourceRegistry();
    sourceRegistryLoaded = true;
  } catch (err) {
    console.error('Could not load source_registry:', err);
  }
}

async function ensureSourceEndpointsLoaded() {
  await ensureSourceRegistryLoaded(); // for organization-name lookups
  if (sourceEndpointsLoaded) return;
  try {
    sourceEndpointRows = await window.WatchdogRepository.fetchSourceEndpoints();
    sourceEndpointsLoaded = true;
  } catch (err) {
    console.error('Could not load source_endpoints:', err);
  }
}

async function ensureReporterWatchesLoaded() {
  await ensureSourceRegistryLoaded(); // for organization-name lookups
  if (reporterWatchesLoaded) return;
  try {
    reporterWatchRows = await window.WatchdogRepository.fetchSourceReporterWatches();
    reporterWatchesLoaded = true;
  } catch (err) {
    console.error('Could not load source_reporter_watches:', err);
  }
}

async function ensureGeographyRulesLoaded() {
  if (geographyRulesLoaded) return;
  try {
    geographyRuleRows = await window.WatchdogRepository.fetchSourceGeographyRules();
    geographyRulesLoaded = true;
  } catch (err) {
    console.error('Could not load source_geography_rules:', err);
  }
}

async function ensureSpecialDistrictsLoaded() {
  if (specialDistrictsLoaded) return;
  try {
    specialDistrictRows = await window.WatchdogRepository.fetchSpecialDistrictRegistry();
    specialDistrictsLoaded = true;
  } catch (err) {
    console.error('Could not load special_district_registry:', err);
  }
}

function sourceOrgNameById(sourceId) {
  const row = sourceRegistryRows.find((r) => r.id === sourceId);
  return row ? row.source_name : null;
}

function populateSourceCoverageFilterOptions() {
  const jurisdictions = new Set(), types = new Set(), lanes = new Set();
  const priorities = new Set(), reliabilities = new Set(), methods = new Set();
  for (const r of sourceRegistryRows) {
    if (hasVal(r.jurisdiction)) jurisdictions.add(r.jurisdiction);
    for (const j of (r.jurisdictions || [])) if (hasVal(j)) jurisdictions.add(j);
    if (hasVal(r.source_type)) types.add(r.source_type);
    if (hasVal(r.source_lane)) lanes.add(r.source_lane);
    if (hasVal(r.source_priority)) priorities.add(r.source_priority);
    if (hasVal(r.reliability)) reliabilities.add(r.reliability);
    if (hasVal(r.monitoring_method)) methods.add(r.monitoring_method);
  }
  fillSelect('scJurisdiction', [...jurisdictions].sort(), 'All jurisdictions');
  fillSelect('scSourceType', [...types].sort(), 'All source types');
  fillSelect('scSourceLane', [...lanes].sort(), 'All lanes');
  fillSelect('scPriority', [...priorities].sort(), 'All priorities');
  fillSelect('scReliability', [...reliabilities].sort(), 'All reliability');
  fillSelect('scMonitoringMethod', [...methods].sort(), 'All monitoring methods');
}

async function renderSourceCoverageView() {
  document.getElementById('sourceCoverageFilters').hidden = activeFilters.scSubTab !== 'organizations';
  document.getElementById('sourceCoverageSimpleFilters').hidden = activeFilters.scSubTab === 'organizations';
  document.querySelectorAll('#sourceCoverageSubNav .tab').forEach((b) => {
    const active = b.dataset.scSub === activeFilters.scSubTab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (activeFilters.scSubTab === 'endpoints') return renderSourceEndpointsView();
  if (activeFilters.scSubTab === 'reporters') return renderReporterWatchesView();
  if (activeFilters.scSubTab === 'districts') return renderSpecialDistrictsView();
  if (activeFilters.scSubTab === 'exclusions') return renderExclusionsView();
  if (activeFilters.scSubTab === 'health') return renderSourceHealthView();
  return renderSourceOrganizationsView();
}

async function renderSourceOrganizationsView() {
  const listEl = document.getElementById('sourceCoverageList');

  if (!sourceRegistryLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading source registry…</p></div>';
    document.getElementById('sourceCoverageCount').textContent = '';
    await ensureSourceRegistryLoaded();
    if (activeFilters.primaryView !== 'sourceCoverage' || activeFilters.scSubTab !== 'organizations') return; // user navigated away while this was loading
  }

  if (!sourceRegistryLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load the source registry — check your connection and try again.</p></div>';
    return;
  }

  populateSourceCoverageFilterOptions();

  const f = activeFilters;
  const search = f.scSearch.trim().toLowerCase();
  const filtered = sourceRegistryRows.filter((r) => {
    if (f.scCounty && r.county !== f.scCounty && !(r.counties || []).includes(f.scCounty)) return false;
    if (f.scJurisdiction && r.jurisdiction !== f.scJurisdiction && !(r.jurisdictions || []).includes(f.scJurisdiction)) return false;
    if (f.scSourceType && r.source_type !== f.scSourceType) return false;
    if (f.scSourceLane && r.source_lane !== f.scSourceLane) return false;
    if (f.scPriority && r.source_priority !== f.scPriority) return false;
    if (f.scReliability && r.reliability !== f.scReliability) return false;
    if (f.scMonitoringMethod && r.monitoring_method !== f.scMonitoringMethod) return false;
    if (f.scActive === 'true' && !r.is_active) return false;
    if (f.scActive === 'false' && r.is_active) return false;
    if (search) {
      const hay = [
        r.source_name, r.reporter_name, r.county, r.jurisdiction,
        (r.counties || []).join(' '), (r.jurisdictions || []).join(' '), r.canonical_domain,
      ].filter(hasVal).join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // V8 Part 5: this is the monitored-organizations registry, precisely
  // distinguished from "active" — never a bare count that could be
  // mistaken for signals currently in the feed (that count lives on the
  // Intelligence view, not here; see docs/watchdog-v8-component-inventory.md).
  const activeInFilteredSet = filtered.filter((r) => r.is_active).length;
  document.getElementById('sourceCoverageCount').textContent = f.scActive
    ? `${filtered.length} ${f.scActive === 'true' ? 'active' : 'inactive'} organization${filtered.length === 1 ? '' : 's'} (of ${sourceRegistryRows.length} monitored)`
    : `${filtered.length} monitored organization${filtered.length === 1 ? '' : 's'} (${activeInFilteredSet} active)`;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="state no-results"><p>${esc(
      sourceRegistryRows.length === 0 ? 'No sources are registered yet.' : 'No sources match these filters.'
    )}</p></div>`;
    return;
  }

  listEl.innerHTML = filtered.map(renderSourceCoverageCard).join('');
}

function renderSourceCoverageCard(r) {
  const badges = [];
  if (hasVal(r.source_priority)) badges.push(`<span class="badge">${esc(r.source_priority)}</span>`);
  badges.push(`<span class="badge">${r.is_active ? 'Active' : 'Inactive'}</span>`);

  const dedupJoin = (arr) => arr.filter(hasVal).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  const countyLine = dedupJoin([r.county, ...(r.counties || [])]);
  const jurisdictionLine = dedupJoin([r.jurisdiction, ...(r.jurisdictions || [])]);

  const chips = [];
  if (hasVal(r.source_type)) chips.push(`<span class="chip">${esc(r.source_type)}</span>`);
  if (hasVal(r.source_lane)) chips.push(`<span class="chip">${esc(r.source_lane)}</span>`);
  if (hasVal(r.reliability)) chips.push(`<span class="chip">${esc(r.reliability)} reliability</span>`);
  if (hasVal(r.monitoring_method)) chips.push(`<span class="chip">${esc(r.monitoring_method)}</span>`);
  if (hasVal(r.reporter_name)) chips.push(`<span class="chip">Reporter: ${esc(r.reporter_name)}</span>`);
  chips.push(`<span class="chip">Last success: ${r.last_successful_collection_at ? esc(relativeDate(r.last_successful_collection_at)) : 'Never'}</span>`);
  chips.push(`<span class="chip">Last attempt: ${r.last_attempted_collection_at ? esc(relativeDate(r.last_attempted_collection_at)) : 'Never'}</span>`);
  chips.push(`<span class="chip">Failures: ${Number(r.consecutive_failure_count) || 0}</span>`);

  return `
  <div class="sig">
    <div class="sig-top">
      ${badges.join('')}
      <span class="sig-juris">${esc(jurisdictionLine || 'Unspecified jurisdiction')}</span>
      ${hasVal(countyLine) ? `<span class="sig-county">${esc(countyLine)}</span>` : ''}
    </div>
    <p class="sig-title">${esc(r.source_name)}</p>
    ${hasVal(r.known_limitations) ? `<p class="sig-snip">${esc(r.known_limitations)}</p>` : ''}
    <div class="sig-meta-row">${chips.join('')}</div>
    ${isSafeUrl(r.source_url) ? `<p class="sig-meta-row"><a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">${esc(r.canonical_domain || r.source_url)}</a></p>` : ''}
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   V5.1 SOURCE COVERAGE SUB-TABS — Exact Endpoints, Reporter Watches,
   Special Districts, Exclusions, Source Health. Each is read-only,
   loaded lazily on first visit, and shares the simple search box
   (scSearch2) rather than the Organizations tab's dedicated filter set.
   ══════════════════════════════════════════════════════════════════ */

async function renderSourceEndpointsView() {
  const listEl = document.getElementById('sourceCoverageList');
  if (!sourceEndpointsLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading exact endpoints…</p></div>';
    document.getElementById('sourceCoverageCount').textContent = '';
    await ensureSourceEndpointsLoaded();
    if (activeFilters.primaryView !== 'sourceCoverage' || activeFilters.scSubTab !== 'endpoints') return;
  }
  if (!sourceEndpointsLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load exact endpoints — check your connection and try again.</p></div>';
    return;
  }

  const search = activeFilters.scSearch2.trim().toLowerCase();
  const filtered = sourceEndpointRows.filter((r) => {
    if (!search) return true;
    const hay = [r.endpoint_name, r.endpoint_url, r.endpoint_type, r.notes, sourceOrgNameById(r.source_id)]
      .filter(hasVal).join(' ').toLowerCase();
    return hay.includes(search);
  });

  document.getElementById('sourceCoverageCount').textContent = `${filtered.length} endpoint${filtered.length === 1 ? '' : 's'}`;
  if (!filtered.length) {
    listEl.innerHTML = `<div class="state no-results"><p>${esc(
      sourceEndpointRows.length === 0 ? 'No exact endpoints are registered yet.' : 'No endpoints match this search.'
    )}</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map(renderSourceEndpointCard).join('');
}

function renderSourceEndpointCard(r) {
  const badges = [`<span class="badge">${r.is_active ? 'Active' : 'Inactive'}</span>`];
  const chips = [];
  if (hasVal(r.endpoint_type)) chips.push(`<span class="chip">${esc(r.endpoint_type)}</span>`);
  if (hasVal(r.collector_strategy)) chips.push(`<span class="chip">${esc(r.collector_strategy)}</span>`);
  chips.push(`<span class="chip">Last success: ${r.last_successful_at ? esc(relativeDate(r.last_successful_at)) : 'Never'}</span>`);
  chips.push(`<span class="chip">Last attempt: ${r.last_attempted_at ? esc(relativeDate(r.last_attempted_at)) : 'Never'}</span>`);
  chips.push(`<span class="chip">Failures: ${Number(r.consecutive_failure_count) || 0}</span>`);
  if (hasVal(r.last_http_status)) chips.push(`<span class="chip">HTTP ${esc(r.last_http_status)}</span>`);
  chips.push(`<span class="chip">New documents: ${Number(r.new_document_count) || 0}</span>`);

  const orgName = sourceOrgNameById(r.source_id);

  return `
  <div class="sig">
    <div class="sig-top">
      ${badges.join('')}
      <span class="sig-juris">${esc(r.endpoint_name)}</span>
      ${hasVal(orgName) ? `<span class="sig-county">${esc(orgName)}</span>` : ''}
    </div>
    ${hasVal(r.notes) ? `<p class="sig-snip">${esc(r.notes)}</p>` : ''}
    <div class="sig-meta-row">${chips.join('')}</div>
    ${isSafeUrl(r.endpoint_url) ? `<p class="sig-meta-row"><a href="${esc(r.endpoint_url)}" target="_blank" rel="noopener noreferrer">${esc(r.endpoint_url)}</a></p>` : '<p class="sig-meta-row"><span class="chip">URL unconfirmed — monitor manually</span></p>'}
  </div>`;
}

async function renderReporterWatchesView() {
  const listEl = document.getElementById('sourceCoverageList');
  if (!reporterWatchesLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading reporter watches…</p></div>';
    document.getElementById('sourceCoverageCount').textContent = '';
    await ensureReporterWatchesLoaded();
    if (activeFilters.primaryView !== 'sourceCoverage' || activeFilters.scSubTab !== 'reporters') return;
  }
  if (!reporterWatchesLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load reporter watches — check your connection and try again.</p></div>';
    return;
  }

  const search = activeFilters.scSearch2.trim().toLowerCase();
  const filtered = reporterWatchRows.filter((r) => {
    if (!search) return true;
    const hay = [r.reporter_name, (r.counties || []).join(' '), (r.jurisdictions || []).join(' '), (r.topics || []).join(' '), sourceOrgNameById(r.organization_id)]
      .filter(hasVal).join(' ').toLowerCase();
    return hay.includes(search);
  });

  document.getElementById('sourceCoverageCount').textContent = `${filtered.length} reporter watch${filtered.length === 1 ? '' : 'es'}`;
  if (!filtered.length) {
    listEl.innerHTML = `<div class="state no-results"><p>${esc(
      reporterWatchRows.length === 0 ? 'No reporter watches are registered yet.' : 'No reporter watches match this search.'
    )}</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map(renderReporterWatchCard).join('');
}

function renderReporterWatchCard(r) {
  const badges = [`<span class="badge">${esc(r.status || 'active')}</span>`];
  const chips = [];
  if (hasVal(r.reliability)) chips.push(`<span class="chip">${esc(r.reliability)} reliability</span>`);
  if (hasVal(r.geographic_precision)) chips.push(`<span class="chip">${esc(r.geographic_precision)} precision</span>`);
  if (hasVal(r.priority)) chips.push(`<span class="chip">${esc(r.priority)}</span>`);
  if (hasVal(r.monitoring_method)) chips.push(`<span class="chip">${esc(r.monitoring_method)}</span>`);

  const orgName = sourceOrgNameById(r.organization_id);
  const dedupJoin = (arr) => (arr || []).filter(hasVal).filter((v, i, a) => a.indexOf(v) === i).join(', ');

  return `
  <div class="sig">
    <div class="sig-top">
      ${badges.join('')}
      <span class="sig-juris">${esc(r.reporter_name)}</span>
      ${hasVal(orgName) ? `<span class="sig-county">${esc(orgName)}</span>` : ''}
    </div>
    ${hasVal(dedupJoin(r.counties)) ? `<p class="sig-snip">Counties: ${esc(dedupJoin(r.counties))}</p>` : ''}
    ${hasVal(dedupJoin(r.jurisdictions)) ? `<p class="sig-snip">Jurisdictions: ${esc(dedupJoin(r.jurisdictions))}</p>` : ''}
    ${hasVal(dedupJoin(r.topics)) ? `<p class="sig-snip">Topics: ${esc(dedupJoin(r.topics))}</p>` : ''}
    ${hasVal(r.limitations) ? `<p class="sig-snip">${esc(r.limitations)}</p>` : ''}
    ${hasVal(r.superseded_reason) ? `<p class="sig-snip"><strong>Superseded:</strong> ${esc(r.superseded_reason)}</p>` : ''}
    <div class="sig-meta-row">${chips.join('')}</div>
  </div>`;
}

async function renderSpecialDistrictsView() {
  const listEl = document.getElementById('sourceCoverageList');
  if (!specialDistrictsLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading special districts…</p></div>';
    document.getElementById('sourceCoverageCount').textContent = '';
    await ensureSpecialDistrictsLoaded();
    if (activeFilters.primaryView !== 'sourceCoverage' || activeFilters.scSubTab !== 'districts') return;
  }
  if (!specialDistrictsLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load the special district registry — check your connection and try again.</p></div>';
    return;
  }

  const search = activeFilters.scSearch2.trim().toLowerCase();
  const filtered = specialDistrictRows.filter((r) => {
    if (!search) return true;
    const hay = [r.canonical_name, r.district_type, (r.counties || []).join(' '), (r.municipalities || []).join(' ')]
      .filter(hasVal).join(' ').toLowerCase();
    return hay.includes(search);
  });

  document.getElementById('sourceCoverageCount').textContent = `${filtered.length} district${filtered.length === 1 ? '' : 's'}`;
  if (!filtered.length) {
    listEl.innerHTML = `<div class="state no-results"><p>${esc(
      specialDistrictRows.length === 0
        ? 'No special districts have been verified yet. This registry is intentionally seeded empty until individual districts (MUDs, PIDs, TIRZs, ESDs) are confirmed against the Registry-Grade Cut.'
        : 'No special districts match this search.'
    )}</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map(renderSpecialDistrictCard).join('');
}

function renderSpecialDistrictCard(r) {
  const badges = [
    `<span class="badge">${esc(r.confidence || 'Unverified')}</span>`,
    `<span class="badge">${r.is_active ? 'Active' : 'Inactive'}</span>`,
  ];
  const chips = [];
  if (hasVal(r.district_type)) chips.push(`<span class="chip">${esc(r.district_type)}</span>`);
  if (hasVal(r.last_verified_date)) chips.push(`<span class="chip">Verified ${esc(r.last_verified_date)}</span>`);

  const dedupJoin = (arr) => (arr || []).filter(hasVal).filter((v, i, a) => a.indexOf(v) === i).join(', ');

  return `
  <div class="sig">
    <div class="sig-top">
      ${badges.join('')}
      <span class="sig-juris">${esc(r.canonical_name)}</span>
      ${hasVal(dedupJoin(r.counties)) ? `<span class="sig-county">${esc(dedupJoin(r.counties))}</span>` : ''}
    </div>
    ${hasVal(r.geographic_description) ? `<p class="sig-snip">${esc(r.geographic_description)}</p>` : ''}
    ${hasVal(dedupJoin(r.municipalities)) ? `<p class="sig-snip">Municipalities: ${esc(dedupJoin(r.municipalities))}</p>` : ''}
    ${hasVal(r.limitations) ? `<p class="sig-snip">${esc(r.limitations)}</p>` : ''}
    <div class="sig-meta-row">${chips.join('')}</div>
    ${isSafeUrl(r.official_domain) ? `<p class="sig-meta-row"><a href="${esc(r.official_domain)}" target="_blank" rel="noopener noreferrer">${esc(r.official_domain)}</a></p>` : ''}
  </div>`;
}

async function renderExclusionsView() {
  const listEl = document.getElementById('sourceCoverageList');
  if (!geographyRulesLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading exclusions…</p></div>';
    document.getElementById('sourceCoverageCount').textContent = '';
    await ensureGeographyRulesLoaded();
    if (activeFilters.primaryView !== 'sourceCoverage' || activeFilters.scSubTab !== 'exclusions') return;
  }
  if (!geographyRulesLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load exclusion rules — check your connection and try again.</p></div>';
    return;
  }

  const search = activeFilters.scSearch2.trim().toLowerCase();
  const exclusions = geographyRuleRows.filter((r) => r.rule_type === 'exclusion');
  const filtered = exclusions.filter((r) => {
    if (!search) return true;
    const hay = [r.rule_key, r.rule_data && r.rule_data.entity, r.rule_data && r.rule_data.reason]
      .filter(hasVal).join(' ').toLowerCase();
    return hay.includes(search);
  });

  document.getElementById('sourceCoverageCount').textContent = `${filtered.length} exclusion${filtered.length === 1 ? '' : 's'}`;
  if (!filtered.length) {
    listEl.innerHTML = `<div class="state no-results"><p>${esc(
      exclusions.length === 0 ? 'No exclusion rules are registered yet.' : 'No exclusion rules match this search.'
    )}</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map(renderExclusionCard).join('');
}

function renderExclusionCard(r) {
  const d = r.rule_data || {};
  const badges = [`<span class="badge">${d.always_reject ? 'Always excluded' : 'Conditional'}</span>`];
  const chips = [];
  if (hasVal(d.requires)) chips.push(`<span class="chip">Requires: ${esc(d.requires)}</span>`);
  if (hasVal(r.validator_version)) chips.push(`<span class="chip">${esc(r.validator_version)}</span>`);
  if (hasVal(r.effective_date)) chips.push(`<span class="chip">Effective ${esc(r.effective_date)}</span>`);

  return `
  <div class="sig">
    <div class="sig-top">
      ${badges.join('')}
      <span class="sig-juris">${esc(d.entity || r.rule_key)}</span>
    </div>
    ${hasVal(d.reason) ? `<p class="sig-snip">${esc(d.reason)}</p>` : ''}
    <div class="sig-meta-row">${chips.join('')}</div>
  </div>`;
}

async function renderSourceHealthView() {
  const listEl = document.getElementById('sourceCoverageList');
  if (!sourceEndpointsLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading source health…</p></div>';
    document.getElementById('sourceCoverageCount').textContent = '';
    await ensureSourceEndpointsLoaded();
    if (activeFilters.primaryView !== 'sourceCoverage' || activeFilters.scSubTab !== 'health') return;
  }
  if (!sourceEndpointsLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load source health — check your connection and try again.</p></div>';
    return;
  }

  const search = activeFilters.scSearch2.trim().toLowerCase();
  const active = sourceEndpointRows.filter((r) => r.is_active);
  const filtered = active.filter((r) => {
    if (!search) return true;
    const hay = [r.endpoint_name, sourceOrgNameById(r.source_id)].filter(hasVal).join(' ').toLowerCase();
    return hay.includes(search);
  });

  // Worst health first: highest consecutive failures, then never-succeeded,
  // then most-recently-failing — so the endpoints needing attention surface
  // at the top rather than being buried alphabetically.
  filtered.sort((a, b) => {
    const fa = Number(a.consecutive_failure_count) || 0, fb = Number(b.consecutive_failure_count) || 0;
    if (fa !== fb) return fb - fa;
    const na = a.last_successful_at ? 0 : 1, nb = b.last_successful_at ? 0 : 1;
    return nb - na;
  });

  const failingCount = active.filter((r) => (Number(r.consecutive_failure_count) || 0) > 0).length;
  document.getElementById('sourceCoverageCount').textContent =
    `${filtered.length} active endpoint${filtered.length === 1 ? '' : 's'} — ${failingCount} with failures`;

  if (!filtered.length) {
    listEl.innerHTML = `<div class="state no-results"><p>${esc(
      active.length === 0 ? 'No active endpoints are registered yet.' : 'No endpoints match this search.'
    )}</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map(renderSourceHealthCard).join('');
}

function renderSourceHealthCard(r) {
  const failures = Number(r.consecutive_failure_count) || 0;
  const neverSucceeded = !r.last_successful_at && r.last_attempted_at;
  const badges = [];
  if (failures > 0) badges.push('<span class="badge">Failing</span>');
  else if (neverSucceeded) badges.push('<span class="badge">Never succeeded</span>');
  else badges.push('<span class="badge">Healthy</span>');

  const chips = [];
  chips.push(`<span class="chip">Consecutive failures: ${failures}</span>`);
  chips.push(`<span class="chip">Last success: ${r.last_successful_at ? esc(relativeDate(r.last_successful_at)) : 'Never'}</span>`);
  chips.push(`<span class="chip">Last attempt: ${r.last_attempted_at ? esc(relativeDate(r.last_attempted_at)) : 'Never'}</span>`);
  if (hasVal(r.last_http_status)) chips.push(`<span class="chip">HTTP ${esc(r.last_http_status)}</span>`);
  if (hasVal(r.last_parser_result)) chips.push(`<span class="chip">${esc(r.last_parser_result)}</span>`);
  chips.push(`<span class="chip">New documents: ${Number(r.new_document_count) || 0}</span>`);

  const orgName = sourceOrgNameById(r.source_id);

  return `
  <div class="sig">
    <div class="sig-top">
      ${badges.join('')}
      <span class="sig-juris">${esc(r.endpoint_name)}</span>
      ${hasVal(orgName) ? `<span class="sig-county">${esc(orgName)}</span>` : ''}
    </div>
    <div class="sig-meta-row">${chips.join('')}</div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   V5 QUARANTINE REVIEW — signals with validation_disposition =
   'Quarantined'. Accept/Suppress/Leave-quarantined all resolve through
   resolve_quarantined_signal(), which re-checks Administrator/
   Collaborator authorization server-side and writes an attributed
   audit_events row — the buttons here are hidden for read-only roles,
   but that is a UI convenience only, never the enforcement boundary.
   ══════════════════════════════════════════════════════════════════ */

/* Same conservative, non-destructive duplicate suppression as the
   Signals feed (see dedupe() / isDuplicatePair() above): the canonical
   record (highest completeness score) is the one shown; every other
   record in the group is hidden from this list only -- never deleted,
   never modified, still fully queryable in Supabase and still linked to
   its own provenance/history. */
function recomputeQuarantineDisplaySet() {
  const { display, hidden } = dedupe(quarantinedSignalRows);
  display.sort((a, b) => new Date(b.detected_at || 0) - new Date(a.detected_at || 0));
  quarantineDisplayRows = display;
  quarantineDuplicatesHidden = hidden;
}

async function ensureQuarantineLoaded() {
  if (quarantineLoaded) return;
  try {
    quarantinedSignalRows = (await window.WatchdogRepository.fetchQuarantinedSignals()).map(prepareSignal);
    recomputeQuarantineDisplaySet();
    quarantineLoaded = true;
  } catch (err) {
    console.error('Could not load quarantined signals:', err);
  }
}

async function renderQuarantineView() {
  const listEl = document.getElementById('quarantineList');

  if (!quarantineLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading quarantined signals…</p></div>';
    document.getElementById('quarantineCount').textContent = '';
    await ensureQuarantineLoaded();
    if (activeFilters.primaryView !== 'quarantine') return; // user navigated away while this was loading
  }

  if (!quarantineLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load the Validation Queue — check your connection and try again.</p></div>';
    return;
  }

  const countParts = [`${quarantineDisplayRows.length} quarantined signal${quarantineDisplayRows.length === 1 ? '' : 's'}`];
  if (quarantineDuplicatesHidden > 0) countParts.push(`${quarantineDuplicatesHidden} duplicate${quarantineDuplicatesHidden === 1 ? '' : 's'} hidden`);
  document.getElementById('quarantineCount').textContent = countParts.join(' · ');

  if (!quarantineDisplayRows.length) {
    listEl.innerHTML = '<div class="state no-results"><p>No signals are currently quarantined.</p></div>';
    return;
  }

  listEl.innerHTML = quarantineDisplayRows.map(renderQuarantineCard).join('');
}

function renderQuarantineCard(s) {
  const chips = [];
  const proposed = [s.matched_county, s.matched_jurisdiction].filter(hasVal).join(' / ');
  if (hasVal(proposed)) chips.push(`<span class="chip">Proposed: ${esc(proposed)}</span>`);
  if (hasVal(s.geographic_confidence)) chips.push(`<span class="chip">Geo confidence: ${esc(s.geographic_confidence)}</span>`);
  if (hasVal(s.source_confidence)) chips.push(`<span class="chip">Source confidence: ${esc(s.source_confidence)}</span>`);

  const sourceLine = [
    esc(s.source || 'Unknown source'),
    isSafeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">view source ↗</a>` : '',
  ].filter(hasVal).join(' — ');

  const actions = canEditShared() ? `
    <div class="sig-meta-row">
      <button class="wf-tool-btn" type="button" data-quarantine-action="Accepted" data-signal-id="${esc(s.id)}">Accept</button>
      <button class="wf-tool-btn" type="button" data-quarantine-action="Suppressed" data-signal-id="${esc(s.id)}">Suppress</button>
      <button class="wf-tool-btn" type="button" data-quarantine-action="Quarantined" data-signal-id="${esc(s.id)}">Leave for Later</button>
    </div>` : '';

  return `
  <div class="sig">
    <div class="sig-top">
      <span class="sig-juris">${esc(s.jurisdiction || 'Unspecified jurisdiction')}</span>
      ${hasVal(s.county) ? `<span class="sig-county">${esc(s.county)} County</span>` : ''}
      <span class="sig-date">Detected ${esc(relativeDate(s.detected_at))}</span>
    </div>
    <p class="sig-title" title="${esc(s.title || 'Untitled signal')}">${esc(s.title || 'Untitled signal')}</p>
    <p class="sig-snip">${sourceLine}</p>
    ${hasVal(s.validation_reason) ? `<p class="sig-snip">Reason: ${esc(s.validation_reason)}</p>` : ''}
    <div class="sig-meta-row">${chips.join('')}</div>
    ${actions}
  </div>`;
}

async function handleQuarantineAction(signalIdRaw, disposition) {
  if (!canEditShared()) return; // buttons are hidden for read-only roles; RLS-equivalent check in the RPC would reject this anyway
  const signalId = Number(signalIdRaw);

  let reason;
  if (disposition === 'Quarantined') {
    reason = 'Reviewed and left quarantined pending further evidence.';
  } else {
    reason = window.prompt(`Optional note for marking this signal "${disposition}":`) || null;
  }

  try {
    await window.WatchdogRepository.resolveQuarantinedSignal(signalId, disposition, reason);
  } catch (err) {
    console.error('Could not resolve quarantined signal:', err);
    showToast('Could not save this decision — check your connection and try again.');
    return;
  }

  quarantinedSignalRows = quarantinedSignalRows.filter((s) => s.id !== signalId);
  recomputeQuarantineDisplaySet();
  const idx = rawSignals.findIndex((s) => s.id === signalId);
  if (idx !== -1) rawSignals[idx].validation_disposition = disposition;
  recomputeDisplaySet();
  showToast(`Signal marked ${disposition}.`);
  renderQuarantineView();
}

/* ══════════════════════════════════════════════════════════════════
   V6 OPERATIONS — hosted/local scanner run history (scanner_runs +
   scanner_run_steps). Read-only everywhere: these rows are written only
   by the service-role hosted/local runner (watchdog_scanner_runner.py),
   never by the browser — there is no insert/update policy for
   `authenticated` at all, so nothing here can forge a run record even if
   the UI were compromised. Raw error text/per-source detail is shown only
   to Administrators (canAdminister()); every other active role sees
   counts and statuses only, matching "diagnostic summaries are
   Administrator-only, no raw stack traces for ordinary users."
   ══════════════════════════════════════════════════════════════════ */

const RUN_HISTORY_LIMIT = 25;
const STALE_RUN_HOURS = 36; // no successful run in this window -> flagged stale, independent of any one run's own status

async function ensureOperationsLoaded() {
  if (operationsLoaded) return;
  try {
    scannerRunRows = await window.WatchdogRepository.fetchScannerRuns(RUN_HISTORY_LIMIT);
    const steps = await window.WatchdogRepository.fetchScannerRunSteps(scannerRunRows.map((r) => r.id));
    scannerRunStepsByRunId = {};
    for (const step of steps) {
      (scannerRunStepsByRunId[step.scanner_run_id] ||= []).push(step);
    }
    // Reuses the Source Coverage → Health cache if already populated; this
    // is the same source_endpoints fetch, not a duplicate data model.
    await ensureSourceEndpointsLoaded();
    operationsLoaded = true;
  } catch (err) {
    console.error('Could not load scanner run history:', err);
  }
}

const STALE_SOURCE_DAYS = 7;

function sourceEndpointAttentionCounts() {
  const active = sourceEndpointRows.filter((r) => r.is_active);
  const staleCutoffMs = STALE_SOURCE_DAYS * 24 * 60 * 60 * 1000;
  let failing = 0, neverRun = 0, stale = 0;
  for (const r of active) {
    if ((Number(r.consecutive_failure_count) || 0) > 0) failing++;
    else if (!r.last_attempted_at) neverRun++;
    else if (r.last_successful_at && (Date.now() - new Date(r.last_successful_at).getTime()) > staleCutoffMs) stale++;
  }
  return { failing, neverRun, stale, total: active.length };
}

function goToSourceHealth() {
  activeFilters.primaryView = 'sourceCoverage';
  activeFilters.scSubTab = 'health';
  renderMain();
}

function refreshOperationsData() {
  operationsLoaded = false;
  scannerRunRows = [];
  scannerRunStepsByRunId = {};
  renderOperationsView();
}

function findRun(predicate) {
  return scannerRunRows.find(predicate) || null;
}

function operationsSummaryTile(label, valueHtml) {
  return `<div class="sig" style="flex:1 1 220px;">
    <div class="sig-top"><span class="sig-juris">${esc(label)}</span></div>
    <p class="sig-snip">${valueHtml}</p>
  </div>`;
}

function renderOperationsSummary() {
  const el = document.getElementById('operationsSummary');
  if (!scannerRunRows.length) {
    el.innerHTML = `<div class="state no-results"><p>No scanner runs recorded yet. Once hosted or local execution runs at least once, its history appears here.</p></div>`;
    return;
  }

  const lastComplete = findRun((r) => r.completed_at);
  const lastSuccessful = findRun((r) => r.status === 'Successful' || r.status === 'Successful With Warnings');
  const currentRunning = findRun((r) => r.status === 'Running');
  const lastHosted = findRun((r) => r.environment === 'hosted');
  const lastLocal = findRun((r) => r.environment === 'local');

  const staleCutoffMs = STALE_RUN_HOURS * 60 * 60 * 1000;
  const isStale = !lastSuccessful || (Date.now() - new Date(lastSuccessful.started_at).getTime()) > staleCutoffMs;

  const tiles = [
    operationsSummaryTile('Current Run Status', currentRunning
      ? `<span class="badge">Running</span> started ${esc(relativeDate(currentRunning.started_at))}`
      : 'Idle — no run in progress'),
    operationsSummaryTile('Last Complete Run', lastComplete
      ? `${esc(lastComplete.status)} · ${esc(relativeDate(lastComplete.completed_at || lastComplete.started_at))}`
      : 'None yet'),
    operationsSummaryTile('Last Successful Run', lastSuccessful
      ? esc(relativeDate(lastSuccessful.completed_at || lastSuccessful.started_at)) + (isStale ? ' <span class="badge">Stale</span>' : '')
      : '<span class="badge">Never</span>'),
    operationsSummaryTile('Hosted Operations', lastHosted
      ? `Last hosted run ${esc(relativeDate(lastHosted.started_at))}`
      : 'No hosted runs recorded yet'),
    operationsSummaryTile('Local Fallback', lastLocal
      ? `Last local run ${esc(relativeDate(lastLocal.started_at))}`
      : 'No local runs recorded yet'),
    operationsSummaryTile('Schedule', 'Enabled/disabled state lives in GitHub Actions repository variables, not this database — check the Actions tab or docs/hosted-operations-runbook.md for the current setting and next scheduled run time.'),
  ];

  const counts = sourceEndpointAttentionCounts();
  tiles.push(operationsSummaryTile(
    'Sources Needing Attention',
    `${counts.failing} failing · ${counts.stale} stale (no success in ${STALE_SOURCE_DAYS}+ days) · ${counts.neverRun} never run `
    + `<button type="button" class="wf-tool-btn" id="operationsGotoHealthBtn">See Source Health →</button>`
  ));

  el.innerHTML = `<div class="attn-grid" style="display:flex;flex-wrap:wrap;gap:.75rem;">${tiles.join('')}</div>`;
  const gotoBtn = document.getElementById('operationsGotoHealthBtn');
  if (gotoBtn) gotoBtn.addEventListener('click', goToSourceHealth);
}

function scannerStepChip(step) {
  const parts = [
    `${esc(step.scanner_name)}: ${esc(step.status)}`,
    `${Number(step.sources_successful) || 0}/${Number(step.sources_attempted) || 0} sources ok`,
    `${Number(step.records_inserted) || 0} inserted`,
  ];
  if (Number(step.records_quarantined) > 0) parts.push(`${step.records_quarantined} quarantined`);
  if (Number(step.records_suppressed) > 0) parts.push(`${step.records_suppressed} suppressed`);
  if (Number(step.duplicates_detected) > 0) parts.push(`${step.duplicates_detected} duplicate${step.duplicates_detected === 1 ? '' : 's'}`);
  if (Number(step.retry_count) > 0) parts.push(`${step.retry_count} retr${step.retry_count === 1 ? 'y' : 'ies'}`);
  return `<span class="chip">${esc(parts.join(' — '))}</span>`;
}

function runStatusReadable(status) {
  if (status === 'Successful') return { text: 'Completed normally', cls: 'sh-good' };
  if (status === 'Successful With Warnings') return { text: 'Completed with some failures', cls: 'sh-warn' };
  if (status === 'Failed') return { text: 'Failed', cls: 'sh-bad' };
  return { text: status || 'Running', cls: 'sh-warn' };
}

function renderRunCard(run) {
  const steps = scannerRunStepsByRunId[run.id] || [];
  const readable = runStatusReadable(run.status);
  const badges = [`<span class="sh-status ${readable.cls}"><span class="sh-status-dot"></span>${esc(readable.text)}</span>`];
  const chips = [
    `<span class="chip">${esc(run.trigger_type)} · ${esc(run.environment)}</span>`,
  ];
  chips.push(`<span class="chip">${Number(run.records_inserted) || 0} inserted</span>`);
  chips.push(`<span class="chip">${Number(run.records_accepted) || 0} accepted</span>`);
  chips.push(`<span class="chip">${Number(run.records_quarantined) || 0} quarantined</span>`);
  chips.push(`<span class="chip">${Number(run.records_suppressed) || 0} suppressed</span>`);
  chips.push(`<span class="chip">${Number(run.duplicates_detected) || 0} duplicates</span>`);
  if (Number(run.sources_failed) > 0) chips.push(`<span class="chip">${run.sources_failed} source(s) failed</span>`);

  const stepChips = steps.map(scannerStepChip).join('');

  // Commit IDs, validator versions, and raw diagnostic detail are
  // Administrator-only, behind a collapsed disclosure (product-clarity
  // §10). Everyone else sees only that something failed, not why.
  let techDisclosure = '';
  if (canAdminister()) {
    const stepErrors = steps.filter((s) => hasVal(s.error_summary)).map((s) => `${esc(s.scanner_name)}: ${esc(s.error_summary)}`);
    const allErrors = [hasVal(run.error_summary) ? esc(run.error_summary) : null, ...stepErrors].filter(hasVal);
    const techRows = [];
    if (hasVal(run.validator_version)) techRows.push(dlRow('Validator Version', esc(run.validator_version)));
    if (hasVal(run.git_commit)) techRows.push(dlRow('Git Commit', esc(String(run.git_commit).slice(0, 12))));
    if (allErrors.length) techRows.push(dlRow('Diagnostic Detail', allErrors.join(' · ')));
    if (techRows.length) {
      techDisclosure = `<details class="tech-disclosure"><summary>Administrator diagnostic detail</summary>
        <dl class="dl-grid tech-disclosure-body">${techRows.join('')}</dl>
      </details>`;
    }
  } else if (Number(run.sources_failed) > 0 || run.status === 'Failed') {
    techDisclosure = `<p class="sig-snip">Some sources failed this run. Administrators can see full diagnostic detail.</p>`;
  }

  return `
  <div class="sig">
    <div class="sig-top">
      ${badges.join('')}
      <span class="sig-juris">Run started ${esc(relativeDate(run.started_at))}</span>
      ${run.completed_at ? `<span class="sig-date">completed ${esc(relativeDate(run.completed_at))}</span>` : ''}
    </div>
    <div class="sig-meta-row">${chips.join('')}</div>
    ${stepChips ? `<div class="sig-meta-row">${stepChips}</div>` : ''}
    ${techDisclosure}
  </div>`;
}

async function renderOperationsView() {
  const listEl = document.getElementById('operationsRunList');

  if (!operationsLoaded) {
    listEl.innerHTML = '<div class="state loading"><div class="spinner" aria-hidden="true"></div><p>Loading scanner run history…</p></div>';
    document.getElementById('operationsCount').textContent = '';
    document.getElementById('operationsSummary').innerHTML = '';
    await ensureOperationsLoaded();
    if (activeFilters.primaryView !== 'operations') return; // user navigated away while this was loading
  }

  if (!operationsLoaded) {
    listEl.innerHTML = '<div class="state error"><p>Could not load System Health — check your connection and try again.</p></div>';
    return;
  }

  renderOperationsSummary();
  document.getElementById('operationsCount').textContent = `${scannerRunRows.length} recent run${scannerRunRows.length === 1 ? '' : 's'}`;

  if (!scannerRunRows.length) {
    listEl.innerHTML = '';
    return;
  }
  listEl.innerHTML = scannerRunRows.map(renderRunCard).join('');
}

// Hides the small set of static, always-in-the-DOM controls that only
// Administrator/Collaborator may use, once at boot. Per-dialog controls
// (matter Save/Assign/Attach/Remove, Shared Coordination fields) are
// re-applied every time their dialog opens/populates instead, since they
// depend on which record is open — this covers only what's visible
// before any dialog is ever opened. Database RLS remains the actual
// enforcement boundary regardless of what's hidden here.
function applyRolePermissionsToStaticUI() {
  const editable = canEditShared();
  const newMatterBtn = document.getElementById('newMatterBtn');
  if (newMatterBtn) newMatterBtn.hidden = !editable;
  const promoteBtn = document.getElementById('promoteMatterBtn');
  if (promoteBtn) promoteBtn.hidden = !editable;
  const attachBtn = document.getElementById('attachMatterBtn');
  if (attachBtn) attachBtn.hidden = !editable;

  // V5: showing Suppressed/Quarantined signals in the main feed is an
  // explicit Administrator-only escape hatch (Part 8) — Operator/
  // Collaborator/Viewer never see the toggle at all.
  const showSQField = document.getElementById('showSuppressedQuarantinedField');
  if (showSQField) showSQField.hidden = !canAdminister();
}

async function openManualMatterCreate() {
  if (!canEditShared()) return; // control is hidden for read-only roles; RLS would reject this anyway
  const title = window.prompt('Title for the new Active Matter:');
  if (title === null) return;
  if (!title.trim()) { showToast('A title is required to create a matter.'); return; }
  let created;
  try {
    created = await createMatter({ title: title.trim() });
  } catch {
    showToast('Could not create the matter — check your connection and try again.');
    return;
  }
  showToast('Active Matter created.');
  refreshOverviewPanels();
  populateMatterFilterOptions();
  renderMain();
  return created;
}

/* ── Policy Matter detail dialog ──────────────────────────────── */
function ownerOptionsHtml(selectedId) {
  const active = Object.values(profilesById).filter(p => p.isActive).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return `<option value="">— Unassigned —</option>` + active.map(p =>
    `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.displayName)}</option>`
  ).join('');
}

function attributionLine(createdBy, createdAt, updatedBy, updatedAt) {
  const parts = [];
  if (hasVal(createdBy) || hasVal(createdAt)) {
    parts.push(`Created by ${esc(resolveDisplayName(createdBy))}${hasVal(createdAt) ? ' on ' + esc(absoluteDate(createdAt)) : ''}`);
  }
  if (hasVal(updatedBy) || hasVal(updatedAt)) {
    parts.push(`Last updated by ${esc(resolveDisplayName(updatedBy))}${hasVal(updatedAt) ? ' on ' + esc(absoluteDate(updatedAt)) : ''}`);
  }
  return parts.join(' · ');
}

function openMatterDetail(id) {
  const m = getMatter(id);
  if (!m) return;
  currentMatterId = id;
  matterDialogLoadedUpdatedAt = m.updatedAt;
  document.getElementById('matterStaleWarning').hidden = true;
  document.getElementById('matterDialogTitle').textContent = m.title || 'Untitled matter';
  document.getElementById('mTitle').value = m.title || '';
  document.getElementById('mCategory').value = m.category || '';
  document.getElementById('mJurisdiction').value = m.jurisdiction || '';
  document.getElementById('mCounty').value = m.county || '';
  document.getElementById('mStatus').value = m.status;
  document.getElementById('mPriority').value = m.priority;
  document.getElementById('mFollowUp').value = m.followUpDate || '';
  document.getElementById('mNextAction').value = m.nextAction || '';
  document.getElementById('mNotes').value = m.notes || '';
  document.getElementById('mAssignedOwner').innerHTML = ownerOptionsHtml(m.assignedOwnerId);
  document.getElementById('mAttribution').innerHTML = attributionLine(m.createdBy, m.createdAt, m.updatedBy, m.updatedAt);

  const editable = canEditShared();
  ['mTitle', 'mCategory', 'mJurisdiction', 'mCounty', 'mStatus', 'mPriority', 'mFollowUp', 'mNextAction', 'mNotes', 'mAssignedOwner']
    .forEach(id2 => { document.getElementById(id2).disabled = !editable; });
  document.getElementById('matterSaveBtn').hidden = !editable;

  renderMatterSignalsList(m);
  renderMatterHistory(m.history);
  document.getElementById('matterDialog').showModal();
}

function closeMatterDialog() {
  document.getElementById('matterDialog').close();
  currentMatterId = null;
  matterDialogLoadedUpdatedAt = null;
}

function renderMatterSignalsList(m) {
  document.getElementById('matterSignalCount').textContent = m.signalIds.length;
  const el = document.getElementById('matterSignalsList');
  if (!m.signalIds.length) { el.innerHTML = `<p class="wf-history-empty">No signals attached yet.</p>`; return; }
  el.innerHTML = m.signalIds.map(ident => renderMatterSignalRow(ident)).join('');
}

function renderMatterSignalRow(ident) {
  const removeBtn = canEditShared()
    ? `<button type="button" class="qa-btn qa-danger" data-matter-remove data-signal-ident="${esc(ident)}">Remove</button>`
    : '';
  const s = findSignalByIdentity(ident);
  if (!s) {
    return `<div class="matter-sig-row">
      <span class="chip">Signal no longer in the current data set</span>
      <div class="matter-sig-actions">${removeBtn}</div>
    </div>`;
  }
  const wf = getWorkflow(s);
  const priClass = ['High', 'Medium', 'Monitor'].includes(s._c.priority) ? s._c.priority : 'Monitor';
  return `<div class="matter-sig-row">
    <div class="matter-sig-info">
      <p class="matter-sig-title">${esc(s._c.cleanTitle)}</p>
      <div class="matter-sig-meta">
        <span class="chip">${esc(s._c.jurisdiction)}</span>
        ${hasVal(s._c.priority) ? `<span class="badge b-${priClass}">${esc(s._c.priority)}</span>` : ''}
        ${hasVal(wf.status) ? `<span class="wf-badge">${esc(wf.status)}</span>` : `<span class="chip">Unassigned</span>`}
        <span class="chip">${esc(reviewState(wf))}</span>
      </div>
    </div>
    <div class="matter-sig-actions">
      <button type="button" class="qa-btn" data-matter-open-signal="${esc(s.id)}">Open</button>
      ${removeBtn}
    </div>
  </div>`;
}

function renderMatterHistory(history) {
  const el = document.getElementById('matterHistory');
  if (!history || !history.length) { el.innerHTML = `<p class="wf-history-empty">No activity recorded yet for this matter.</p>`; return; }
  el.innerHTML = [...history].slice().reverse().map(h => `
    <p class="wf-history-item"><span class="wf-history-time">${esc(absoluteDate(h.at))}</span>${esc(h.summary)}</p>
  `).join('');
}

async function saveMatterFromForm() {
  if (!currentMatterId || !canEditShared()) return;
  const patch = {
    title: document.getElementById('mTitle').value.trim(),
    category: document.getElementById('mCategory').value.trim(),
    jurisdiction: document.getElementById('mJurisdiction').value.trim(),
    county: document.getElementById('mCounty').value.trim(),
    status: document.getElementById('mStatus').value,
    priority: document.getElementById('mPriority').value,
    followUpDate: document.getElementById('mFollowUp').value || null,
    nextAction: document.getElementById('mNextAction').value.trim(),
    notes: document.getElementById('mNotes').value.trim(),
    assignedOwnerId: document.getElementById('mAssignedOwner').value || null,
  };
  const saveBtn = document.getElementById('matterSaveBtn');
  saveBtn.disabled = true;
  let saved;
  try {
    saved = await saveMatter(currentMatterId, patch, matterDialogLoadedUpdatedAt);
  } catch (err) {
    saveBtn.disabled = false;
    if (err && err.staleConflict) {
      showMatterStaleWarning();
    } else {
      showToast('Could not save — check your connection and try again. Your changes are still in this form.');
    }
    return;
  }
  saveBtn.disabled = false;
  matterDialogLoadedUpdatedAt = saved.updatedAt;
  document.getElementById('matterDialogTitle').textContent = saved.title || 'Untitled matter';
  document.getElementById('mAttribution').innerHTML = attributionLine(saved.createdBy, saved.createdAt, saved.updatedBy, saved.updatedAt);
  renderMatterHistory(saved.history);
  showToast('Active Matter saved.');
  refreshOverviewPanels();
  populateMatterFilterOptions();
  renderMain();
}

// Realtime-driven stale-edit warning: shown when a background refresh
// finds the open matter's updated_at has moved since the form was
// populated. Never re-populates the form itself — that would silently
// discard whatever the user has typed — the user chooses Reload Latest.
function showMatterStaleWarning() {
  const el = document.getElementById('matterStaleWarning');
  if (el) el.hidden = false;
}
function reloadMatterDialogLatest() {
  if (!currentMatterId) return;
  openMatterDetail(currentMatterId);
}

/* ── Matter picker dialog (Promote to New Matter / Add to Existing) ── */
function openMatterPicker(s) {
  if (!canEditShared()) return; // control is hidden for read-only roles
  pendingPromoteSignal = s;
  document.getElementById('mpTitle').value = s._c.cleanTitle || '';
  document.getElementById('mpCategory').value = s._c.category || '';
  document.getElementById('mpJurisdiction').value = s._c.jurisdiction || '';
  document.getElementById('mpCounty').value = s._c.county || '';
  renderMatterPickerList();
  document.getElementById('matterPickerDialog').showModal();
}
function closeMatterPicker() {
  document.getElementById('matterPickerDialog').close();
  pendingPromoteSignal = null;
}
function renderMatterPickerList() {
  const list = activeMatters().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const el = document.getElementById('matterPickerList');
  if (!list.length) { el.innerHTML = `<p class="wf-history-empty">No active Policy Matters yet — create one below.</p>`; return; }
  el.innerHTML = list.map(m => `
    <div class="matter-pick-row">
      <div>
        <p class="matter-sig-title">${esc(m.title || 'Untitled matter')}</p>
        <div class="matter-sig-meta">
          <span class="chip">${esc([m.jurisdiction, m.county].filter(hasVal).join(', ') || 'No location set')}</span>
          <span class="wf-badge">${esc(m.status)}</span>
        </div>
      </div>
      <button type="button" class="qa-btn" data-attach-matter="${esc(m.id)}">Attach</button>
    </div>
  `).join('');
}

/* ── Signal detail dialog ─────────────────────────────────────── */
function dlRow(label, value) {
  return `<div class="dl-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

const DETAIL_TAB_PANEL_IDS = {
  brief: 'detailPanelBrief', analysis: 'detailPanelAnalysis',
  action: 'detailPanelAction', workproducts: 'detailPanelWorkProducts',
};

function switchDetailTab(key) {
  document.querySelectorAll('#detailTabs .detail-tab').forEach((b) => {
    const active = b.dataset.dtab === key;
    b.classList.toggle('active', active); b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.detail-tab-panel').forEach((p) => p.classList.remove('active'));
  const panel = document.getElementById(DETAIL_TAB_PANEL_IDS[key]);
  if (panel) panel.classList.add('active');
  document.getElementById('detailBody').scrollTop = 0;
}

function renderDetailPrimaryActions(s, wf) {
  const el = document.getElementById('detailPrimaryActions');
  const buttons = [];
  // V8 Part 1/9: the only place "Mark Reviewed" appears — never on the
  // card, never automatic on open. Shown only while genuinely unreviewed;
  // gone the moment it's set, with no redundant "Reviewed" button left behind.
  if (!window.WatchdogReviewSemantics.isReviewed(wf)) {
    buttons.push(`<button type="button" class="qa-btn qa-primary qa-set-monitoring" data-detail-action="Mark Reviewed">Mark Reviewed</button>`);
  }
  if (!COMPLETED_STATUSES.includes(wf.status) && wf.status !== 'Monitoring') {
    buttons.push(`<button type="button" class="qa-btn" data-detail-action="Monitor">Monitor</button>`);
  }
  if (!COMPLETED_STATUSES.includes(wf.status)) {
    buttons.push(`<button type="button" class="qa-btn" data-detail-action="Create Matter">Create Matter</button>`);
  }
  el.innerHTML = buttons.join('');
}

/* ── Evidence tab ─────────────────────────────────────────────────── */
function renderDetailEvidence(s) {
  const c = s._c;
  const provenanceBadges = [];
  if (s.is_verified_public_source) provenanceBadges.push(`<span class="chip chip-good">✓ Verified source</span>`);
  if (s.is_member_signal) provenanceBadges.push(`<span class="chip chip-violet">Member-sourced</span>`);

  const orgName = s.matched_source_id ? sourceOrgNameById(s.matched_source_id) : null;

  const rows = [];
  // V6.1 review fix: the exact original source title, untouched by the
  // display-only cleanup (stripTrailingSource, summary substitution)
  // used on cards and Today — s.title itself is never modified anywhere
  // in this app, so this is always safe to show verbatim.
  if (hasVal(s.title)) rows.push(dlRow('Original Title', esc(s.title)));
  if (hasVal(c.source)) rows.push(dlRow('Primary Source', esc(c.source)));
  if (hasVal(orgName)) rows.push(dlRow('Source Organization', esc(orgName)));
  if (hasVal(c.confidenceReason)) rows.push(dlRow('Detection Basis', esc(c.confidenceReason)));
  if (hasVal(s.validation_reason)) rows.push(dlRow('Validation Result', esc(s.validation_reason)));
  if (hasVal(s.geographic_confidence)) rows.push(dlRow('Geographic Confidence', esc(s.geographic_confidence)));
  if (hasVal(s.source_confidence)) rows.push(dlRow('Source Confidence', esc(s.source_confidence)));
  if (hasVal(s.published_at)) rows.push(dlRow('Source Date', esc(absoluteDate(s.published_at))));
  if (hasVal(s.detected_at) && hasVal(s.published_at)) {
    const lagDays = Math.round((new Date(s.detected_at) - new Date(s.published_at)) / 86400000);
    rows.push(dlRow('Detection Lag', lagDays === 0 ? 'Same day' : `${Math.abs(lagDays)} day${Math.abs(lagDays) === 1 ? '' : 's'}`));
  }
  if (c.matchedKeywords.length) {
    rows.push(`<div class="dl-row"><dt>Supporting Keywords</dt><dd class="chips">${
      c.matchedKeywords.map(k => `<span class="chip">${esc(k)}</span>`).join('')
    }</dd></div>`);
  }

  const sourceLink = isSafeUrl(s.url)
    ? `<a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open Original Source ↗</a>`
    : `<p class="state-detail">No verifiable source link is available for this signal.</p>`;

  const techRows = [];
  if (hasVal(s.validator_version)) techRows.push(dlRow('Validator Version', esc(s.validator_version)));
  if (hasVal(s.matched_county)) techRows.push(dlRow('Matched County', esc(s.matched_county)));
  if (hasVal(s.matched_jurisdiction)) techRows.push(dlRow('Matched Jurisdiction', esc(s.matched_jurisdiction)));
  if (hasVal(s.last_validated_at)) techRows.push(dlRow('Last Validated', esc(absoluteDate(s.last_validated_at))));

  document.getElementById('detailEvidence').innerHTML = `
    ${provenanceBadges.length ? `<div class="dl-badges">${provenanceBadges.join('')}</div>` : ''}
    <dl class="dl-grid">${rows.join('')}</dl>
    ${sourceLink}
    ${techRows.length ? `
    <details class="tech-disclosure">
      <summary>Validation diagnostic detail</summary>
      <dl class="dl-grid tech-disclosure-body">${techRows.join('')}</dl>
    </details>` : ''}
  `;
}

/* ── Timeline tab — known events only, never fabricated ─────────────── */
function renderDetailTimeline(s, wf) {
  const events = [];
  if (hasVal(s.published_at)) events.push({ at: s.published_at, label: 'Source published' });
  if (hasVal(s.detected_at)) events.push({ at: s.detected_at, label: 'Detected by Watchdog' });
  if (hasVal(wf.reviewedAt)) events.push({ at: wf.reviewedAt, label: 'Reviewed' });
  if (wf.status === 'Monitoring' && hasVal(wf.updatedAt)) events.push({ at: wf.updatedAt, label: 'Set to Monitoring' });
  if (wf.status === 'Action Required' && hasVal(wf.updatedAt)) events.push({ at: wf.updatedAt, label: 'Marked Action Required' });
  if (hasVal(wf.closedAt)) events.push({ at: wf.closedAt, label: 'Closed' });
  if (hasVal(wf.dismissedAt)) events.push({ at: wf.dismissedAt, label: 'Dismissed', detail: wf.dismissalReason });
  if (isEscalatedToMatter(s)) events.push({ at: wf.updatedAt || s.detected_at, label: 'Escalated to an Active Matter' });
  if (hasVal(s.agenda_date) && new Date(s.agenda_date) > new Date()) {
    events.push({ at: s.agenda_date, label: 'Known decision date (upcoming)' });
  }

  const sorted = events.filter((e) => hasVal(e.at)).sort((a, b) => new Date(a.at) - new Date(b.at));
  const el = document.getElementById('detailTimeline');
  if (!sorted.length) {
    el.innerHTML = `<p class="state-detail">No dated events are recorded for this signal yet.</p>`;
    return;
  }
  el.innerHTML = `<ul class="timeline">${sorted.map((e) => `
    <li class="timeline-item">
      <p class="timeline-label">${esc(e.label)}</p>
      <p class="timeline-time">${esc(absoluteDate(e.at))}</p>
      ${hasVal(e.detail) ? `<p class="timeline-detail">${esc(e.detail)}</p>` : ''}
    </li>`).join('')}</ul>`;
}

/* ── Recommended Response tab — shows only what's already user-entered;
   never invents a recommendation (product-clarity §7). ─────────────── */
function buildRecordedResponseHtml(s, wf) {
  const recorded = [];
  if (hasVal(wf.nextAction)) recorded.push(dlRow('Next Action (your workflow)', esc(wf.nextAction)));
  const linkedMatters = Object.entries(matterSignalLinks)
    .filter(([, ids]) => ids.includes(signalIdentity(s)))
    .map(([matterId]) => sharedMattersById[matterId])
    .filter(Boolean);
  for (const m of linkedMatters) {
    if (hasVal(m.nextAction)) recorded.push(dlRow(`Next Action (${m.title || 'Active Matter'})`, esc(m.nextAction)));
    // "Ownership where available" (product-clarity §4/final-consolidation
    // §4) — the assigned owner already recorded on a linked Active
    // Matter; never fabricated, and blank when no owner is assigned.
    if (hasVal(m.assignedOwnerId)) recorded.push(dlRow(`Owner (${m.title || 'Active Matter'})`, esc(resolveDisplayName(m.assignedOwnerId))));
  }
  return recorded.length ? `
    <section class="dl-section" style="margin-bottom:16px">
      <p class="wf-section-heading">Currently Recorded</p>
      <dl class="dl-grid">${recorded.join('')}</dl>
    </section>` : '';
}

function renderDetailResponse(s, wf) {
  document.getElementById('detailResponse').innerHTML = `
    ${buildRecordedResponseHtml(s, wf)}
    <p class="wf-section-heading">Recommended Next Step</p>
    <p class="state-detail">No analysis has been saved for this signal yet, so no recommendation is available — see Intelligence Tools on the Analysis tab.</p>
  `;
}

/* ══════════════════════════════════════════════════════════════════
   V7 — Local Policy Intelligence: Analysis-tab rendering + the
   Intelligence Generation controls in the Action tab. Read path (fetching
   and displaying analyses, and the review-status RPC) goes straight to
   Supabase like everything else in this file; the one exception is
   actual generation, which calls the server-side Netlify Function
   (WatchdogRepository.generateIntelligenceDraft) — that's the only path
   that ever touches the AI provider or the service-role key, and it
   never runs in this file directly. ══════════════════════════════════ */

const ANALYSIS_EMPTY_STATE_HTML = `
  <div class="intel-empty">
    <p class="intel-empty-title">Intelligence analysis has not been generated for this signal.</p>
    <p class="intel-empty-body">Planned analysis areas:</p>
    <dl class="analysis-areas">
      <div class="analysis-area"><dt>Why It Matters</dt><dd>Not yet generated</dd></div>
      <div class="analysis-area"><dt>Organizational Relevance</dt><dd>Not yet generated</dd></div>
      <div class="analysis-area"><dt>Practical Consequences</dt><dd>Not yet generated</dd></div>
      <div class="analysis-area"><dt>Geographic Significance</dt><dd>Not yet generated</dd></div>
      <div class="analysis-area"><dt>Materiality</dt><dd>Not yet generated</dd></div>
      <div class="analysis-area"><dt>Evidence Gaps and Uncertainty</dt><dd>Not yet generated</dd></div>
      <div class="analysis-area"><dt>Position Pathway</dt><dd>Not yet generated</dd></div>
      <div class="analysis-area"><dt>Priority Rationale</dt><dd>Not yet generated</dd></div>
    </dl>
  </div>`;

function pickCurrentAnalysis(analyses) {
  if (!analyses.length) return null;
  const live = analyses.filter((a) => !['Superseded', 'Rejected'].includes(a.status));
  const pool = live.length ? live : analyses;
  return pool.reduce((best, a) => (a.analysis_version > best.analysis_version ? a : best), pool[0]);
}

function intelStatusBadgeClass(status) {
  return 'intel-status-badge intel-status-' + String(status).replace(/[^A-Za-z]/g, '');
}

// Every analysis in this codebase originates from an AI provider or the
// manual ChatGPT pilot — there is no "written from scratch by a human"
// path — so this label must stay visible for every status EXCEPT
// Approved for Internal Use, not just Draft (V7.1 hardening-pass fix:
// "AI-generated content must remain clearly labeled until human
// approval," which includes Human Reviewed — reviewed is not approved).
function aiDraftLabel(analysis) {
  if (!analysis || !analysis.provider || analysis.status === 'Approved for Internal Use') return '';
  return `<span class="ai-draft-label">⚠ AI-generated draft — human review required</span>`;
}

function renderEditHistory(analysis) {
  const entries = (analysis.usage_metadata && Array.isArray(analysis.usage_metadata.edit_history)) ? analysis.usage_metadata.edit_history : [];
  if (!entries.length) return '';
  const rows = entries.map((e) => {
    const who = e.editor ? esc(resolveDisplayName(e.editor)) : 'Unknown';
    const when = e.edited_at ? esc(new Date(e.edited_at).toLocaleString()) : 'Unknown time';
    const fields = Array.isArray(e.changed_fields) ? e.changed_fields.map(esc).join(', ') : '';
    const noteHtml = hasVal(e.note) ? ` — <em>${esc(e.note)}</em>` : '';
    const materialTag = e.material_change ? ' <span class="wf-local-tag">Position/Priority/Response change</span>' : '';
    return `<li>${who} — ${when}: ${fields}${materialTag}${noteHtml}</li>`;
  }).join('');
  return `
    <p class="wf-section-heading" style="margin-top:14px">Edit History</p>
    <ul class="intel-empty-list">${rows}</ul>`;
}

/* V8 Part 7 — every field below is read through Dashboard/analysisRendering.js
   (window.WatchdogAnalysisRendering), which is what actually fixes the
   documented V7.1 rendering defects; this function only decides layout.
   None of this mutates the analysis object or writes anything — the
   preserved baseline row (signal_intelligence_analyses.id
   e3ec122a-f750-4a7d-ad5f-f558898eb24c) is only ever read here. */
function renderAnalysisTabContent(analysis) {
  const el = document.getElementById('detailAnalysisContent');
  if (!analysis) { el.innerHTML = ANALYSIS_EMPTY_STATE_HTML; return; }

  const AR = window.WatchdogAnalysisRendering;

  const factListHtml = (entries, emptyMsg) => entries.length
    ? `<ul class="intel-empty-list">${entries.map((e) => {
        const statement = typeof e === 'string' ? e : e.statement;
        const idsTag = (e.evidenceIds && e.evidenceIds.length) ? ` <span class="evidence-id-tag">(${e.evidenceIds.map(esc).join(', ')})</span>` : '';
        return `<li>${esc(statement)}${idsTag}</li>`;
      }).join('')}</ul>`
    : `<p class="state-detail">${esc(emptyMsg)}</p>`;

  // Edit-before-review (V7.1 §10): Collaborators/Administrators may correct
  // a Draft or Human Reviewed analysis's narrative content before formal
  // approval, via edit_signal_intelligence_analysis_draft() — never status,
  // never approval fields. Approved/Rejected/Superseded/Stale analyses are
  // never editable (the SQL function itself also refuses those).
  const canEditDraft = canEditShared() && ['Draft', 'Human Reviewed'].includes(analysis.status);

  const nextStep = AR.recommendedNextStep(analysis);
  const pathway = AR.positionPathwayDisplay(analysis);
  const gov = AR.governanceInfo(analysis);
  const gaps = AR.evidenceGapEntries(analysis);
  const consequences = AR.practicalConsequenceEntries(analysis);
  const whyEntries = AR.whyThisMattersEntries(analysis);

  el.innerHTML = `
    ${aiDraftLabel(analysis)}
    <span class="${intelStatusBadgeClass(analysis.status)}">${esc(analysis.status)}</span>
    ${canEditDraft ? `<button type="button" class="wf-tool-btn" id="analysisEditToggleBtn" style="margin-left:8px">Edit Draft</button>` : ''}
    <div id="analysisEditWrap"></div>

    <section class="analysis-recommendation" aria-label="Recommended next step">
      <p class="wf-section-heading" style="margin-top:14px">Recommended Next Step</p>
      <p class="${nextStep.recorded ? 'analysis-summary-full' : 'state-detail'}">${esc(nextStep.text)}</p>
      <dl class="analysis-quick-facts">
        ${dlRow('Proposed Intelligence Priority', esc(analysis.intelligence_priority || 'Unclear'))}
        ${dlRow('Urgency', esc(analysis.urgency || 'Unclear'))}
        ${dlRow('Position Status', esc(pathway.label))}
        ${dlRow('Evidence Confidence', esc(analysis.evidence_quality || 'Unclear'))}
      </dl>
    </section>

    ${AR.executiveSummaryText(analysis) ? `
    <p class="wf-section-heading" style="margin-top:14px">Executive Summary</p>
    <p class="analysis-summary-full">${esc(AR.executiveSummaryText(analysis))}</p>` : ''}

    <p class="wf-section-heading" style="margin-top:14px">Why This Matters</p>
    ${whyEntries.length ? `<dl class="dl-grid">${whyEntries.map((e) => dlRow(e.label, esc(e.text))).join('')}</dl>` : `<p class="state-detail">Not enough stored analysis to build this yet.</p>`}

    <dl class="analysis-areas" style="margin-top:14px">
      <div class="analysis-area"><dt>Materiality</dt><dd>${esc(analysis.materiality_level || 'Unclear')} — ${esc(analysis.materiality_rationale || '')}</dd></div>
      <div class="analysis-area"><dt>Priority Rationale</dt><dd>${esc(analysis.priority_rationale || 'Not addressed')}</dd></div>
    </dl>

    <p class="wf-section-heading" style="margin-top:14px">Practical Consequences</p>
    ${consequences.entries.length
      ? (consequences.entries.length > 1 ? `<ul class="intel-empty-list">${consequences.entries.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : `<p class="state-detail">${esc(consequences.entries[0])}</p>`)
      : `<p class="state-detail">Not addressed.</p>`}

    <p class="wf-section-heading" style="margin-top:14px">Position Pathway</p>
    <p class="state-detail"><strong>${esc(pathway.label)}</strong>${pathway.description ? ' — ' + esc(pathway.description) : ''}</p>
    ${hasVal(analysis.potential_applicable_position_note) ? `
    <p class="state-detail" style="margin-top:4px">${esc(analysis.potential_applicable_position_note)} <span style="opacity:.8">(confidence: ${esc(analysis.position_confidence || 'Unclear')})</span></p>` : ''}

    <p class="wf-section-heading" style="margin-top:14px">Evidence Gaps</p>
    ${gaps.entries.length
      ? `<ul class="intel-empty-list">${gaps.entries.map((g) => `<li>${g.type === 'contradiction' ? '<strong>Contradiction:</strong> ' : ''}${esc(g.text)}</li>`).join('')}</ul>`
      : `<p class="state-detail">None recorded.</p>`}

    <p class="wf-section-heading" style="margin-top:14px">Confirmed Facts</p>
    ${factListHtml(AR.confirmedFactEntries(analysis), 'None recorded.')}
    <p class="wf-section-heading">Unresolved Questions</p>
    ${factListHtml(AR.unresolvedFactEntries(analysis), 'None recorded.')}

    ${Array.isArray(analysis.citations) && analysis.citations.length ? `
    <p class="wf-section-heading" style="margin-top:14px">Citations</p>
    <dl class="dl-grid">${analysis.citations.map((c) => dlRow(c.source_id || 'Source', esc(c.quote_or_reference || ''))).join('')}</dl>` : ''}

    <section class="wf-section" style="margin-top:14px" aria-label="Governance">
      <p class="wf-section-heading">Governance</p>
      <dl class="dl-grid">
        ${gov.required !== null ? dlRow('Governance Required', gov.required ? 'Yes' : 'No') : ''}
        ${hasVal(gov.recommendedRoute) ? dlRow('Recommended Route', esc(gov.recommendedRoute)) : ''}
        ${gov.approvalNeededFrom.length ? dlRow('Approval Needed From', esc(gov.approvalNeededFrom.join(', '))) : ''}
      </dl>
      <p class="wf-required-hint">This is a proposal from the imported analysis, not an approved organizational decision. Nothing here is applied automatically.</p>
    </section>

    ${(() => {
      const meta = analysis.usage_metadata || {};
      const inferences = Array.isArray(meta.inferences) ? meta.inferences : [];
      const warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
      return `
        ${inferences.length ? `<p class="wf-section-heading" style="margin-top:14px">Inferences</p>${factListHtml(inferences.map((i) => ({ statement: `${i.statement || i}${i.basis ? ' — basis: ' + i.basis : ''}${i.confidence ? ` (${i.confidence} confidence)` : ''}`, evidenceIds: [] })), 'None recorded.')}` : ''}
        ${warnings.length ? `<p class="wf-section-heading">Warnings</p>${factListHtml(warnings.map((w) => ({ statement: w, evidenceIds: [] })), 'None recorded.')}` : ''}
        ${hasVal(meta.analyst_note) ? `<p class="wf-section-heading">Analyst Note</p><p class="state-detail">${esc(meta.analyst_note)}</p>` : ''}
      `;
    })()}
    ${analysis.is_stale ? `<p class="wf-error" role="alert">This analysis is marked stale: ${esc(analysis.stale_reason || 'the underlying evidence may have changed.')}</p>` : ''}
    ${renderEditHistory(analysis)}
  `;
}

/* V8 Part 9: Action leads with the recommendation, not a form. Order
   matches the ticket exactly — Recommended Next Step, Response Options,
   Governance Route, Opportunity for Influence, Relationship
   Considerations — with Position/Priority/Response kept as separate,
   clearly labeled rows below, never collapsed into one combined status. */
function renderActionResponseFromAnalysis(s, wf, analysis) {
  if (!analysis) return; // renderDetailResponse() already rendered the honest empty state
  const el = document.getElementById('detailResponse');
  const AR = window.WatchdogAnalysisRendering;
  const nextStep = AR.recommendedNextStep(analysis);
  const gov = AR.governanceInfo(analysis);
  const options = Array.isArray(analysis.proposed_response_options) ? analysis.proposed_response_options : [];

  el.innerHTML = `
    ${buildRecordedResponseHtml(s, wf)}
    ${aiDraftLabel(analysis)}

    <p class="wf-section-heading">Recommended Next Step</p>
    <p class="${nextStep.recorded ? 'analysis-summary-full' : 'state-detail'}">${esc(nextStep.text)}</p>

    ${options.length ? `<p class="wf-section-heading" style="margin-top:12px">Response Options</p><ul class="intel-empty-list">${options.map((o) => `<li>${esc(typeof o === 'string' ? o : o.option || '')}</li>`).join('')}</ul>` : ''}

    <dl class="dl-grid" style="margin-top:12px">
      ${hasVal(gov.recommendedRoute) ? dlRow('Governance Route', esc(gov.recommendedRoute)) : ''}
      ${hasVal(analysis.opportunity_for_influence) ? dlRow('Opportunity for Influence', esc(analysis.opportunity_for_influence)) : ''}
      ${hasVal(analysis.relationship_considerations) ? dlRow('Relationship Considerations', esc(analysis.relationship_considerations)) : ''}
    </dl>

    <p class="wf-required-hint" style="margin-top:8px">This is a proposal, not an applied action. Nothing here is carried out automatically.</p>

    <p class="wf-section-heading" style="margin-top:14px">Position, Priority &amp; Response — kept separate, never one combined status</p>
    <dl class="dl-grid">
      ${dlRow('Position Status', esc(AR.positionPathwayDisplay(analysis).label))}
      ${hasVal(analysis.intelligence_priority) ? dlRow('Intelligence-Assessed Priority', esc(analysis.intelligence_priority)) : ''}
      ${hasVal(analysis.human_approved_priority) ? dlRow('Human-Approved Priority', esc(analysis.human_approved_priority)) : ''}
      ${hasVal(analysis.urgency) ? dlRow('Urgency', esc(analysis.urgency)) : ''}
      ${hasVal(analysis.regional_spillover) ? dlRow('Regional Spillover', esc(analysis.regional_spillover)) : ''}
      ${hasVal(analysis.precedent_risk) ? dlRow('Precedent Risk', esc(analysis.precedent_risk)) : ''}
    </dl>
  `;
}

// V8 Part 2/8: the direct "Generate Intelligence Draft" / "Regenerate
// Draft" button is never shown — direct AI generation stays disabled
// (WATCHDOG_AI_ENABLED is not configured; see
// docs/watchdog-manual-intelligence-pilot.md). Review controls
// (Mark Reviewed / Approve / Reject / Stale / Supersede) still render
// for whatever analysis already exists, however it was produced —
// including one saved through the still-active Intelligence Tools
// manual-pilot flow above.
function renderIntelGenControls(s, analysis, allAnalyses) {
  const el = document.getElementById('intelGenContent');
  const canReview = canEditShared();

  const statusLine = analysis
    ? `<span class="${intelStatusBadgeClass(analysis.status)}">${esc(analysis.status)}</span> <span class="state-detail">version ${analysis.analysis_version}${allAnalyses.length > 1 ? ` of ${allAnalyses.length}` : ''}</span>`
    : `<span class="state-detail">No analysis has been saved for this signal yet — see Intelligence Tools above.</span>`;

  const aid = analysis ? esc(analysis.id) : '';
  const reviewButtons = (canReview && analysis && !['Rejected', 'Superseded'].includes(analysis.status)) ? `
    <div class="wf-actions">
      <button type="button" class="wf-tool-btn" data-intel-analysis-id="${aid}" data-intel-review="Human Reviewed">Mark Reviewed</button>
      <button type="button" class="wf-tool-btn" data-intel-analysis-id="${aid}" data-intel-review="Approved for Internal Use">Approve for Internal Use</button>
      <button type="button" class="wf-tool-btn" data-intel-analysis-id="${aid}" data-intel-review="Rejected">Reject</button>
      <button type="button" class="wf-tool-btn" data-intel-analysis-id="${aid}" data-intel-review="Stale">Mark Stale</button>
      <button type="button" class="wf-tool-btn" data-intel-analysis-id="${aid}" data-intel-review="Superseded">Supersede</button>
    </div>` : '';

  el.innerHTML = `
    ${statusLine}
    <div id="intelGenConfirmWrap"></div>
    ${reviewButtons}
    <p class="wf-error" id="intelGenError" role="alert" hidden></p>
  `;
}

function intelGenConfirmHtml(s, triggerType) {
  const hasPrimarySource = hasVal(s.url) || hasVal(s._c.source);
  return `
  <div class="intel-gen-confirm">
    <p class="wf-section-heading" style="margin:0 0 8px">Confirm generation</p>
    <div class="intel-gen-confirm-row"><dt>Primary source available</dt><dd>${hasPrimarySource ? 'Yes' : 'No'}</dd></div>
    <div class="intel-gen-confirm-row"><dt>Jurisdiction</dt><dd>${esc(s._c.jurisdiction || 'Unknown')}</dd></div>
    <div class="intel-gen-confirm-row"><dt>Analysis status after generation</dt><dd>Draft (human review required)</dd></div>
    <p class="wf-required-hint" style="margin-top:8px">This sends the signal's title, snippet, source, and any matched position/jurisdiction context to the configured AI provider. It never sends personal workspace notes.</p>
    <div class="wf-actions" style="margin-top:10px">
      <button type="button" class="wf-save-btn" id="intelGenConfirmBtn" data-trigger="${esc(triggerType)}">Confirm &amp; Generate</button>
      <button type="button" class="wf-tool-btn" id="intelGenCancelBtn">Cancel</button>
    </div>
  </div>`;
}

// Cache of the currently-open signal's analyses, refreshed by every
// loadAndRenderIntelligence() call — reused by the manual pilot's
// priority-comparison preview (renderManualPilotPreview) and the
// edit-before-review form (handleToggleEditDraft) so they don't need a
// separate fetch just to know "what's the current analysis right now."
let currentIntelAnalyses = [];

async function loadAndRenderIntelligence(s) {
  const genEl = document.getElementById('intelGenContent');
  genEl.innerHTML = '<p class="state-detail">Loading intelligence status…</p>';
  let analyses = [];
  try {
    analyses = await window.WatchdogRepository.fetchSignalIntelligenceAnalyses(s.id);
  } catch (err) {
    console.error('Could not load intelligence analyses:', err);
    genEl.innerHTML = '<p class="state-detail">Could not load intelligence analysis status — check your connection and try again.</p>';
    return;
  }
  if (currentDetailSignal !== s) return; // navigated away while loading

  currentIntelAnalyses = analyses;
  const analysis = pickCurrentAnalysis(analyses);
  renderAnalysisTabContent(analysis);
  renderActionResponseFromAnalysis(s, getWorkflow(s), analysis);
  renderIntelGenControls(s, analysis, analyses);

  // V8 Part 8: "Intelligence Tools" (the manual-pilot Build/Copy/Import
  // flow) starts collapsed once a usable analysis already exists — no
  // need to see the import tools every time an already-drafted signal is
  // reopened. Starts open when there's nothing to review yet, so a
  // Draft-less signal doesn't hide its only available next step.
  const toolsDetails = document.getElementById('intelToolsDetails');
  if (toolsDetails) toolsDetails.open = !analysis;
}

/* ══════════════════════════════════════════════════════════════════
   V7.1 hardening pass — the Human Review Edit Form. Field list, diffing,
   and the "does this touch Position/Priority/Response" rule all live in
   Dashboard/editFormLogic.js (window.WatchdogEditFormLogic) — pure,
   DOM-free, unit-tested (Dashboard/test/run_edit_form_logic.js). This
   section only renders that field list into actual DOM and reads it back
   on save; it never re-implements the diff/material-change logic itself,
   so the browser and the test suite can never silently disagree about
   what counts as a material change. ══════════════════════════════════ */

function editFieldRowHtml(field, analysis) {
  const L = window.WatchdogEditFormLogic;
  const value = L.readFieldValue(analysis, field.key);
  const requiredTag = field.material ? ' <span class="wf-local-tag">Position/Priority/Response</span>' : '';

  if (field.kind === 'select') {
    const options = field.options.map((o) => `<option value="${esc(o)}" ${value === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
    return `<div class="manual-pilot-edit-field" data-edit-field="${field.key}" data-edit-kind="select">
      <label>${esc(field.label)}${requiredTag}</label>
      <select data-field="${field.key}">${options}</select>
    </div>`;
  }

  if (field.kind === 'text') {
    return `<div class="manual-pilot-edit-field" data-edit-field="${field.key}" data-edit-kind="text">
      <label>${esc(field.label)}${requiredTag}</label>
      <textarea data-field="${field.key}" rows="2">${esc(value || '')}</textarea>
    </div>`;
  }

  if (field.kind === 'list') {
    const rows = L.listFieldToRows(value);
    return `<div class="manual-pilot-edit-field" data-edit-field="${field.key}" data-edit-kind="list">
      <label>${esc(field.label)}${requiredTag}</label>
      <div class="edit-list-rows" data-list-for="${field.key}">
        ${rows.map((r) => editListRowHtml(field.key, r)).join('')}
      </div>
      <button type="button" class="wf-tool-btn" data-add-row="${field.key}">+ Add</button>
    </div>`;
  }

  if (field.kind === 'factList') {
    const rows = L.factListToRows(value);
    return `<div class="manual-pilot-edit-field" data-edit-field="${field.key}" data-edit-kind="factList">
      <label>${esc(field.label)}${requiredTag}</label>
      <div class="edit-list-rows" data-list-for="${field.key}">
        ${rows.map((r) => editFactRowHtml(field.key, r)).join('')}
      </div>
      <button type="button" class="wf-tool-btn" data-add-row="${field.key}">+ Add</button>
    </div>`;
  }

  if (field.kind === 'inferenceList') {
    const rows = L.inferenceListToRows(value);
    return `<div class="manual-pilot-edit-field" data-edit-field="${field.key}" data-edit-kind="inferenceList">
      <label>${esc(field.label)}${requiredTag}</label>
      <div class="edit-list-rows" data-list-for="${field.key}">
        ${rows.map((r) => editInferenceRowHtml(field.key, r)).join('')}
      </div>
      <button type="button" class="wf-tool-btn" data-add-row="${field.key}">+ Add</button>
    </div>`;
  }
  return '';
}

function editListRowHtml(fieldKey, text) {
  return `<div class="edit-list-row" data-row-for="${fieldKey}">
    <textarea class="row-text" rows="1">${esc(text || '')}</textarea>
    <button type="button" class="wf-tool-btn" data-remove-row>&times;</button>
  </div>`;
}
function editFactRowHtml(fieldKey, row) {
  return `<div class="edit-list-row" data-row-for="${fieldKey}" data-evidence-ids='${esc(JSON.stringify(row.evidence_ids || []))}'>
    <textarea class="row-text" rows="1" placeholder="Statement">${esc(row.statement || '')}</textarea>
    <span class="state-detail">${row.evidence_ids && row.evidence_ids.length ? esc(row.evidence_ids.join(', ')) : 'no citation'}</span>
    <button type="button" class="wf-tool-btn" data-remove-row>&times;</button>
  </div>`;
}
function editInferenceRowHtml(fieldKey, row) {
  return `<div class="edit-list-row edit-inference-row" data-row-for="${fieldKey}" data-evidence-ids='${esc(JSON.stringify(row.evidence_ids || []))}'>
    <textarea class="row-text" rows="1" placeholder="Statement">${esc(row.statement || '')}</textarea>
    <textarea class="row-basis" rows="1" placeholder="Basis">${esc(row.basis || '')}</textarea>
    <select class="row-confidence">
      ${['low', 'medium', 'high'].map((c) => `<option value="${c}" ${row.confidence === c ? 'selected' : ''}>${c}</option>`).join('')}
    </select>
    <button type="button" class="wf-tool-btn" data-remove-row>&times;</button>
  </div>`;
}

function handleToggleEditDraft() {
  const wrap = document.getElementById('analysisEditWrap');
  if (!wrap) return;
  if (wrap.dataset.open === '1') { wrap.innerHTML = ''; wrap.dataset.open = ''; return; }

  const analysis = pickCurrentAnalysis(currentIntelAnalyses);
  if (!analysis) return;
  const L = window.WatchdogEditFormLogic;

  const fieldsHtml = L.EDITABLE_ANALYSIS_FIELDS.map((field) => editFieldRowHtml(field, analysis)).join('');

  wrap.innerHTML = `
    <div class="manual-pilot-preview" style="margin-top:10px">
      ${fieldsHtml}
      <div class="manual-pilot-edit-field">
        <label for="analysisEditNote">Review Note <span class="state-detail">(required if Position, Priority, or Response changed)</span></label>
        <textarea id="analysisEditNote" rows="2" placeholder="Why are you making this change?"></textarea>
      </div>
      <p class="wf-error" id="analysisEditError" role="alert" hidden></p>
      <div class="wf-actions">
        <button type="button" class="wf-save-btn" id="analysisEditSaveBtn" data-analysis-id="${esc(analysis.id)}">Save Edits</button>
        <button type="button" class="wf-tool-btn" id="analysisEditCancelBtn">Cancel</button>
      </div>
    </div>`;
  wrap.dataset.open = '1';
}

function addEditListRow(fieldKey) {
  const container = document.querySelector(`.edit-list-rows[data-list-for="${fieldKey}"]`);
  if (!container) return;
  const field = window.WatchdogEditFormLogic.EDITABLE_ANALYSIS_FIELDS.find((f) => f.key === fieldKey);
  const div = document.createElement('div');
  if (field.kind === 'factList') div.innerHTML = editFactRowHtml(fieldKey, { statement: '', evidence_ids: [] });
  else if (field.kind === 'inferenceList') div.innerHTML = editInferenceRowHtml(fieldKey, { statement: '', basis: '', confidence: 'medium', evidence_ids: [] });
  else div.innerHTML = editListRowHtml(fieldKey, '');
  container.appendChild(div.firstElementChild);
}

/** Reads the current, in-progress form values out of the DOM — the ONLY
 * place this file touches the DOM for the edit form's data; everything
 * downstream (diffing, material-change detection) is pure and shared
 * with the test suite via Dashboard/editFormLogic.js. */
function readEditFormValues(wrap) {
  const L = window.WatchdogEditFormLogic;
  const values = {};
  wrap.querySelectorAll('[data-edit-field]').forEach((container) => {
    const key = container.dataset.editField;
    const kind = container.dataset.editKind;
    if (kind === 'text' || kind === 'select') {
      const input = container.querySelector('[data-field]');
      values[key] = input ? input.value : '';
    } else if (kind === 'list') {
      const rows = Array.from(container.querySelectorAll('.edit-list-row .row-text')).map((t) => t.value);
      values[key] = L.rowsToListField(rows);
    } else if (kind === 'factList') {
      const rows = Array.from(container.querySelectorAll('.edit-list-row')).map((row) => ({
        statement: row.querySelector('.row-text').value,
        evidence_ids: JSON.parse(row.dataset.evidenceIds || '[]'),
      }));
      values[key] = L.rowsToFactList(rows);
    } else if (kind === 'inferenceList') {
      const rows = Array.from(container.querySelectorAll('.edit-list-row')).map((row) => ({
        statement: row.querySelector('.row-text').value,
        basis: row.querySelector('.row-basis').value,
        confidence: row.querySelector('.row-confidence').value,
        evidence_ids: JSON.parse(row.dataset.evidenceIds || '[]'),
      }));
      values[key] = L.rowsToInferenceList(rows);
    }
  });
  return values;
}

async function handleSaveEditDraft(s, analysisId) {
  const wrap = document.getElementById('analysisEditWrap');
  const errEl = document.getElementById('analysisEditError');
  if (!wrap) return;
  const L = window.WatchdogEditFormLogic;

  const analysis = pickCurrentAnalysis(currentIntelAnalyses);
  const currentValues = readEditFormValues(wrap);
  const updates = L.diffAnalysisUpdates(analysis, currentValues);

  if (Object.keys(updates).length === 0) {
    wrap.innerHTML = ''; wrap.dataset.open = '';
    showToast('No changes to save.');
    return;
  }

  const noteInput = document.getElementById('analysisEditNote');
  const note = noteInput ? noteInput.value.trim() : '';
  if (L.requiresReviewNote(updates) && !note) {
    if (errEl) { errEl.textContent = 'A review note is required when changing Position, Priority, or Response fields.'; errEl.hidden = false; }
    return;
  }
  if (errEl) errEl.hidden = true;

  const saveBtn = document.getElementById('analysisEditSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  try {
    await window.WatchdogRepository.editIntelligenceAnalysisDraft(analysisId, updates, note || null);
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Could not save these edits.'; errEl.hidden = false; }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Edits'; }
    return;
  }
  showToast('Edits saved.');
  wrap.innerHTML = '';
  wrap.dataset.open = '';
  await loadAndRenderIntelligence(s);
}

/* ══════════════════════════════════════════════════════════════════
   V7.1 — Manual ChatGPT Intelligence Pilot
   (docs/watchdog-manual-intelligence-pilot.md). Every call here goes
   through WatchdogRepository.buildIntelligencePacket / importIntelligenceDraft
   — both server-side Netlify Functions, neither of which ever calls an AI
   provider. This file only builds the UI around that: showing the packet
   for copy/download, accepting a pasted/uploaded response, showing a
   validated preview before anything is saved, and never applying an
   imported recommendation automatically. ══════════════════════════════ */

// Holds the currently-built packet's identity for the open dialog only —
// reset on every openDetail() so a packet built for one signal can never
// be accidentally imported against another.
let manualPilotState = null;

function renderManualPilotSectionVisibility() {
  const el = document.getElementById('intelToolsDetails');
  if (el) el.hidden = !canAdminister();
}

function resetManualPilotUI() {
  manualPilotState = null;
  const buildBtn = document.getElementById('manualPilotBuildBtn');
  if (buildBtn) { buildBtn.disabled = false; buildBtn.textContent = 'Build Intelligence Packet'; }
  const meta = document.getElementById('manualPilotPacketMeta');
  if (meta) meta.innerHTML = '';
  const packetArea = document.getElementById('manualPilotPacketArea');
  if (packetArea) packetArea.hidden = true;
  const packetText = document.getElementById('manualPilotPacketText');
  if (packetText) packetText.value = '';
  const importArea = document.getElementById('manualPilotImportArea');
  if (importArea) importArea.hidden = true;
  const responseInput = document.getElementById('manualPilotResponseInput');
  if (responseInput) responseInput.value = '';
  const importErr = document.getElementById('manualPilotImportError');
  if (importErr) { importErr.hidden = true; importErr.innerHTML = ''; }
  const previewArea = document.getElementById('manualPilotPreviewArea');
  if (previewArea) { previewArea.hidden = true; previewArea.innerHTML = ''; }
  const copyStatus = document.getElementById('manualPilotCopyStatus');
  if (copyStatus) copyStatus.textContent = '';
}

async function handleBuildIntelligencePacket(s) {
  const btn = document.getElementById('manualPilotBuildBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
  let result;
  try {
    result = await window.WatchdogRepository.buildIntelligencePacket(s.id);
  } catch (err) {
    showToast(err.message || 'Could not build the intelligence packet.');
    if (btn) { btn.disabled = false; btn.textContent = 'Build Intelligence Packet'; }
    return;
  }
  if (currentDetailSignal !== s) return; // navigated away while building

  manualPilotState = { packetId: result.packetId, runId: result.runId, packetText: result.packetText, signalId: s.id };

  const meta = document.getElementById('manualPilotPacketMeta');
  if (meta) {
    meta.innerHTML = `
      <dl class="dl-grid" style="margin-top:6px">
        ${dlRow('Built', esc(new Date(result.builtAt).toLocaleString()))}
        ${dlRow('Evidence sources', esc(String(result.evidenceCount)))}
        ${dlRow('Primary source present', result.hasPrimarySource ? 'Yes' : 'No')}
        ${dlRow('Position-library matches', result.hasPositionSources ? 'Yes' : 'No')}
        ${dlRow('Jurisdiction profile', result.hasJurisdictionProfile ? 'Yes' : 'No')}
        ${dlRow('Doctrine version', esc(result.doctrineVersion))}
      </dl>`;
  }
  const packetArea = document.getElementById('manualPilotPacketArea');
  if (packetArea) packetArea.hidden = false;
  const packetTextEl = document.getElementById('manualPilotPacketText');
  if (packetTextEl) packetTextEl.value = result.packetText;
  const importArea = document.getElementById('manualPilotImportArea');
  if (importArea) importArea.hidden = false;
  const copyStatus = document.getElementById('manualPilotCopyStatus');
  if (copyStatus) copyStatus.textContent = '';

  if (btn) { btn.disabled = false; btn.textContent = 'Rebuild Intelligence Packet'; }
}

async function handleCopyPacket() {
  if (!manualPilotState) return;
  const statusEl = document.getElementById('manualPilotCopyStatus');
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no-clipboard-api');
    await navigator.clipboard.writeText(manualPilotState.packetText);
    if (statusEl) statusEl.textContent = 'Copied ✓';
  } catch {
    if (statusEl) statusEl.textContent = 'Could not copy automatically — select the text above and copy manually, or use Download Packet.';
  }
}

function handleDownloadPacket() {
  if (!manualPilotState) return;
  const blob = new Blob([manualPilotState.packetText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `watchdog-intelligence-packet-${manualPilotState.packetId}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleManualPilotFileUpload(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const input = document.getElementById('manualPilotResponseInput');
    if (input) input.value = String(reader.result || '');
  };
  reader.onerror = () => showToast('Could not read that file.');
  reader.readAsText(file);
}

async function handleValidateManualResponse(s) {
  if (!manualPilotState || manualPilotState.signalId !== s.id) {
    showToast('Build an intelligence packet first.');
    return;
  }
  const errEl = document.getElementById('manualPilotImportError');
  if (errEl) { errEl.hidden = true; errEl.innerHTML = ''; }
  const responseText = (document.getElementById('manualPilotResponseInput') || {}).value || '';
  const btn = document.getElementById('manualPilotValidateBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Validating…'; }

  try {
    const result = await window.WatchdogRepository.importIntelligenceDraft({
      signalId: s.id, packetId: manualPilotState.packetId, runId: manualPilotState.runId,
      response: responseText, dryRun: true,
    });
    renderManualPilotPreview(s, result);
  } catch (err) {
    const lines = (Array.isArray(err.errors) && err.errors.length) ? err.errors : [err.message || 'Validation failed.'];
    if (errEl) { errEl.innerHTML = lines.map((l) => `<div>${esc(l)}</div>`).join(''); errEl.hidden = false; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Validate'; }
  }
}

function renderManualPilotPreview(s, result) {
  const el = document.getElementById('manualPilotPreviewArea');
  if (!el) return;
  const p = result.preview;
  const warnings = result.warnings || [];
  const existing = pickCurrentAnalysis(currentIntelAnalyses);

  const list = (arr, keyFn) => (Array.isArray(arr) && arr.length)
    ? `<ul class="intel-empty-list">${arr.map((item) => `<li>${esc(keyFn(item))}</li>`).join('')}</ul>`
    : `<p class="state-detail">None.</p>`;

  const warningsHtml = warnings.map((w) => `<p class="manual-pilot-warning">${esc(w)}</p>`).join('');
  const staleHtml = result.isStale
    ? `<p class="manual-pilot-warning" role="alert">This response may be based on stale evidence: ${esc(result.staleReason || 'evidence changed since the packet was built.')} You can still save it as a Draft (it will be marked stale), or cancel and build a fresh packet.</p>`
    : '';

  el.innerHTML = `
    <div class="manual-pilot-preview">
      <span class="ai-draft-label">⚠ AI-GENERATED DRAFT — HUMAN REVIEW REQUIRED</span>
      ${staleHtml}
      ${warningsHtml}
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Executive Summary</p><p class="manual-pilot-preview-value">${esc(p.executive_summary)}</p></div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Confirmed Facts</p>${list(p.confirmed_facts, (f) => f.statement)}</div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Evidence Gaps / Unresolved Questions</p>${list(p.unresolved_facts, (f) => f)}</div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Why It Matters</p><p class="manual-pilot-preview-value">${esc(p.organizational_relevance)} ${esc(p.geographic_significance)}</p></div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Materiality</p><p class="manual-pilot-preview-value">${esc(p.materiality_level)} — ${esc(p.materiality_rationale)}</p></div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Position Pathway</p><p class="manual-pilot-preview-value">${esc(p.position_pathway)}${p.potential_applicable_position_note ? ' — ' + esc(p.potential_applicable_position_note) : ''} <span style="opacity:.8">(confidence: ${esc(p.position_confidence)})</span></p></div>
      <div class="manual-pilot-preview-section">
        <p class="manual-pilot-preview-label">Priority Comparison</p>
        <dl class="manual-pilot-diff-grid">
          <div class="manual-pilot-diff-cell"><dt>Scanner Priority</dt><dd>${esc(s._c.priority || 'Unset')}</dd></div>
          <div class="manual-pilot-diff-cell"><dt>Proposed Intelligence Priority</dt><dd>${esc(p.intelligence_priority)}</dd></div>
          <div class="manual-pilot-diff-cell"><dt>Human-Approved Priority</dt><dd>${esc((existing && existing.human_approved_priority) || 'Not set')}</dd></div>
        </dl>
        <p class="manual-pilot-preview-value" style="margin-top:6px">Why this priority: ${esc(p.priority_rationale)}</p>
      </div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Response Options</p>${list(p.proposed_response_options, (o) => (typeof o === 'string' ? o : o.option || ''))}</div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Governance Route</p><p class="manual-pilot-preview-value">${esc(p.recommended_governance_path || 'Not stated')}</p></div>
      <div class="manual-pilot-preview-section"><p class="manual-pilot-preview-label">Citations</p>${list(p.citations, (c) => `${c.evidence_id}: ${c.quote_or_reference || ''}`)}</div>
      <div class="wf-actions" style="margin-top:10px">
        <button type="button" class="wf-save-btn" id="manualPilotSaveDraftBtn">Save Intelligence Draft</button>
        <button type="button" class="wf-tool-btn" id="manualPilotCancelPreviewBtn">Cancel</button>
      </div>
    </div>`;
  el.hidden = false;
}

async function handleSaveManualDraft(s) {
  if (!manualPilotState || manualPilotState.signalId !== s.id) return;
  const responseText = (document.getElementById('manualPilotResponseInput') || {}).value || '';
  const saveBtn = document.getElementById('manualPilotSaveDraftBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  try {
    await window.WatchdogRepository.importIntelligenceDraft({
      signalId: s.id, packetId: manualPilotState.packetId, runId: manualPilotState.runId,
      response: responseText, dryRun: false,
    });
  } catch (err) {
    showToast(err.message || 'Could not save the draft — check your connection and try again.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Intelligence Draft'; }
    return;
  }
  showToast('Intelligence draft saved.');
  resetManualPilotUI();
  await loadAndRenderIntelligence(s);
}

async function handleGenerateIntelligence(s, triggerType) {
  const errEl = document.getElementById('intelGenError');
  if (errEl) errEl.hidden = true;
  try {
    await window.WatchdogRepository.generateIntelligenceDraft(s.id, triggerType);
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Generation failed — check your connection and try again.'; errEl.hidden = false; }
    return;
  }
  showToast('Intelligence draft generated.');
  await loadAndRenderIntelligence(s);
}

async function handleReviewIntelligence(s, analysisId, newStatus) {
  const note = ['Rejected', 'Stale', 'Superseded'].includes(newStatus)
    ? (window.prompt(`Optional note for marking this analysis "${newStatus}":`) || null)
    : null;
  try {
    await window.WatchdogRepository.reviewSignalIntelligenceAnalysis(analysisId, newStatus, note);
  } catch (err) {
    showToast('Could not save this review decision — check your connection and try again.');
    return;
  }
  showToast(`Analysis marked ${newStatus}.`);
  await loadAndRenderIntelligence(s);
}

const WORK_PRODUCT_TYPES = ['Executive Brief', 'Talking Points', 'Council Letter', 'Written Testimony', 'Member Alert', 'Local Contact Brief', 'Research Report'];
function renderWorkProductsGrid() {
  const el = document.getElementById('workProductsGrid');
  if (!el || el.dataset.rendered) return;
  el.dataset.rendered = '1';
  el.innerHTML = WORK_PRODUCT_TYPES.map((name) => `
    <div class="workprod-card">
      <p class="workprod-name">${esc(name)}</p>
      <p class="workprod-status">Generation not yet available</p>
    </div>`).join('');
}

function openDetail(id) {
  const s = displaySignals.find(x => String(x.id) === String(id));
  if (!s) return;
  const c = s._c;

  // V8 Part 1: opening a signal is a VIEW only — it must never itself
  // mark the signal Reviewed (see reviewSemantics.js's viewSignal()).
  // Reviewed only becomes true via the explicit Mark Reviewed control
  // (renderDetailPrimaryActions) or by saving a substantive workflow
  // decision (saveWorkflow). wf below always reflects the CURRENT,
  // unmodified state — nothing here writes anything.
  const wf = window.WatchdogReviewSemantics.viewSignal(getWorkflow(s));

  document.getElementById('detailTitle').textContent = displayHeadline(c);
  currentDetailSignal = s;
  switchDetailTab('brief');
  renderDetailPrimaryActions(s, wf);

  // ── Overview: what the signal IS (plain-language first) ───────────
  const intelRows = [];
  if (hasVal(c.priority)) {
    const tierSuffix = hasVal(s.priority_level) ? ` (Tier ${s.priority_level})` : '';
    intelRows.push(dlRow('Priority', esc(c.priority + tierSuffix)));
  }
  if (hasVal(c.jurisdiction)) intelRows.push(dlRow('Jurisdiction', esc(c.jurisdiction)));
  if (hasVal(c.county)) intelRows.push(dlRow('County', esc(c.county)));
  if (!isGenericStage(c.stage)) intelRows.push(dlRow('Governing Body Stage', esc(c.stage)));
  if (hasVal(c.meetingBody)) intelRows.push(dlRow('Governing Body', esc(c.meetingBody)));
  if (hasVal(c.category)) intelRows.push(dlRow('Issue Category', esc([c.category, c.subcategory].filter(hasVal).join(' / '))));
  if (hasVal(c.confidenceLevel)) intelRows.push(dlRow('Confidence', esc(c.confidenceLevel)));
  // "Review State" (local, automatic: Unreviewed/Reviewed) is distinct from
  // the Supabase-sourced "Review Status" row directly below it (new/
  // reviewed/dismissed/promoted, set by the scanner pipeline) — labeled
  // explicitly to avoid the two being confused for one field.
  const workflowStateLabel = hasVal(wf.status) ? wf.status : 'Unassigned';
  intelRows.push(dlRow('Current Workflow State', esc(workflowStateLabel)));
  if (hasVal(c.source)) intelRows.push(dlRow('Source', esc(c.source)));
  if (hasVal(s.detected_at)) intelRows.push(dlRow('Detected', esc(absoluteDate(s.detected_at))));
  if (hasVal(s.agenda_date)) intelRows.push(dlRow('Next Known Decision Date', esc(dateOnly(s.agenda_date))));
  if (hasVal(c.staffContact)) intelRows.push(dlRow('Staff contact', esc(c.staffContact)));
  if (hasVal(c.relatedIssues)) intelRows.push(dlRow('Related issues', esc(c.relatedIssues)));
  if (hasVal(c.summary)) intelRows.push(dlRow('Summary', esc(c.summary)));
  if (hasVal(c.whyMatters)) intelRows.push(dlRow('Why it matters (scanner note)', esc(c.whyMatters)));
  if (hasVal(wf.reviewedAt)) intelRows.push(dlRow('First Reviewed', esc(absoluteDate(wf.reviewedAt))));
  if (hasVal(c.reviewStatus)) intelRows.push(dlRow('Review Status (scanner)', esc(cap(c.reviewStatus))));
  if (c.reviewStatus === 'dismissed' && hasVal(c.dismissedReason)) intelRows.push(dlRow('Dismissal reason (scanner)', esc(c.dismissedReason)));

  document.getElementById('detailReadOnly').innerHTML = `
    <section class="dl-section">
      <dl class="dl-grid">${intelRows.join('')}</dl>
    </section>
  `;

  renderDetailEvidence(s);
  ensureSourceRegistryLoaded().then(() => {
    if (currentDetailSignal === s) renderDetailEvidence(s); // enrich with org name once loaded, if still open
  }).catch(() => {});
  renderDetailTimeline(s, wf);
  renderDetailResponse(s, wf);
  renderWorkProductsGrid();
  document.getElementById('detailAnalysisContent').innerHTML = ANALYSIS_EMPTY_STATE_HTML;
  document.getElementById('intelGenContent').innerHTML = '<p class="state-detail">Loading intelligence status…</p>';
  resetManualPilotUI();
  renderManualPilotSectionVisibility();
  loadAndRenderIntelligence(s).catch(() => {});

  populateWorkflowForm(wf);
  populateSharedCoordinationForm(s);
  renderSignalMatterLinks(s);
  document.getElementById('wfError').hidden = true;

  document.getElementById('detailDialog').showModal();
}

function closeDetail() {
  document.getElementById('detailDialog').close();
  currentDetailSignal = null;
  sharedCoordLoadedUpdatedAt = null;
}

function renderSignalMatterLinks(s) {
  const el = document.getElementById('signalMatterLinks');
  const matters = mattersForSignal(s);
  if (!matters.length) { el.innerHTML = `<p class="wf-history-empty">Not linked to any Active Matter yet.</p>`; return; }
  el.innerHTML = matters.map(m => `
    <div class="matter-link-row">
      <div>
        <p class="matter-sig-title">${esc(m.title || 'Untitled matter')}</p>
        <div class="matter-sig-meta">
          <span class="wf-badge${m.status === 'Action Required' ? ' wf-badge-action' : ''}">${esc(m.status)}</span>
          <span class="chip">${esc(m.priority)} priority</span>
        </div>
      </div>
      <button type="button" class="qa-btn" data-open-matter="${esc(m.id)}">Open Matter</button>
    </div>
  `).join('');
}

/* ── Operator workflow form (inside the detail dialog) — personal ──── */
function populateWorkflowForm(wf) {
  document.getElementById('wfStatus').value = wf.status;
  document.getElementById('wfResponseLevel').value = wf.responseLevel === null || wf.responseLevel === undefined ? '' : String(wf.responseLevel);
  document.getElementById('wfFollowUp').value = wf.followUpDate || '';
  document.getElementById('wfNextAction').value = wf.nextAction || '';
  document.getElementById('wfNote').value = wf.note || '';
  document.getElementById('wfDismissalReason').value = wf.dismissalReason || '';
  document.getElementById('wfDismissalWrap').classList.toggle('wf-optional', wf.status !== 'Dismissed');
  renderWorkflowHistory(wf.history);
}

function renderWorkflowHistory(history) {
  const el = document.getElementById('wfHistory');
  if (!history || !history.length) {
    el.innerHTML = `<p class="wf-history-empty">No local activity recorded yet for this signal.</p>`;
    return;
  }
  el.innerHTML = [...history].reverse().map(h => `
    <p class="wf-history-item"><span class="wf-history-time">${esc(absoluteDate(h.at))}</span>${esc(h.summary)}</p>
  `).join('');
}

/* ── Shared Coordination form (inside the detail dialog) — shared ────
   Leadership Awareness, Committee Attention, and Shared Coordination
   Note all live on signal_shared_state now — visible to every active
   authenticated user, editable only by Administrator/Collaborator. */
function populateSharedCoordinationForm(s) {
  const shared = getSharedState(s);
  sharedCoordLoadedUpdatedAt = shared.updatedAt;
  document.getElementById('sharedStaleWarning').hidden = true;
  document.getElementById('wfLeadership').value = shared.leadershipAwareness || '';
  document.getElementById('wfCommittee').value = shared.committeeAttention || 'None';
  document.getElementById('wfSharedNote').value = shared.sharedCoordinationNote || '';
  document.getElementById('wfSharedAttribution').innerHTML = (hasVal(shared.updatedBy) || hasVal(shared.updatedAt))
    ? `Last updated by ${esc(resolveDisplayName(shared.updatedBy))}${hasVal(shared.updatedAt) ? ' on ' + esc(absoluteDate(shared.updatedAt)) : ''}`
    : 'Not yet set by anyone.';

  const editable = canEditShared();
  ['wfLeadership', 'wfCommittee', 'wfSharedNote'].forEach(id => { document.getElementById(id).disabled = !editable; });
  document.getElementById('wfSharedSaveBtn').hidden = !editable;
}

async function saveSharedCoordinationFromForm() {
  if (!currentDetailSignal || !canEditShared()) return;
  const patch = {
    leadershipAwareness: document.getElementById('wfLeadership').value || null,
    committeeAttention: document.getElementById('wfCommittee').value,
    sharedCoordinationNote: document.getElementById('wfSharedNote').value.trim(),
  };
  const saveBtn = document.getElementById('wfSharedSaveBtn');
  const errorEl = document.getElementById('wfSharedError');
  errorEl.hidden = true;
  saveBtn.disabled = true;
  const key = signalIdentity(currentDetailSignal);
  let saved;
  try {
    saved = await window.WatchdogRepository.saveSignalSharedState(key, currentDetailSignal.id ?? null, patch, sharedCoordLoadedUpdatedAt);
  } catch (err) {
    saveBtn.disabled = false;
    if (err && err.staleConflict) {
      showSharedCoordStaleWarning();
    } else {
      errorEl.textContent = 'Could not save — check your connection and try again. Your changes are still in this form.';
      errorEl.hidden = false;
    }
    return;
  }
  saveBtn.disabled = false;
  sharedStateByIdentity[key] = saved;
  sharedCoordLoadedUpdatedAt = saved.updatedAt;
  document.getElementById('wfSharedAttribution').innerHTML = `Last updated by ${esc(resolveDisplayName(saved.updatedBy))}${hasVal(saved.updatedAt) ? ' on ' + esc(absoluteDate(saved.updatedAt)) : ''}`;
  showToast('Shared Coordination saved.');
  refreshOverviewPanels();
  renderMain();
}

function showSharedCoordStaleWarning() {
  const el = document.getElementById('sharedStaleWarning');
  if (el) el.hidden = false;
}
function reloadSharedCoordLatest() {
  if (currentDetailSignal) populateSharedCoordinationForm(currentDetailSignal);
}

async function saveWorkflowFromForm() {
  if (!currentDetailSignal) return;
  const errorEl = document.getElementById('wfError');
  errorEl.hidden = true;

  const responseLevelRaw = document.getElementById('wfResponseLevel').value;
  const patch = {
    status: document.getElementById('wfStatus').value,
    responseLevel: responseLevelRaw === '' ? null : Number(responseLevelRaw),
    followUpDate: document.getElementById('wfFollowUp').value || null,
    nextAction: document.getElementById('wfNextAction').value.trim(),
    note: document.getElementById('wfNote').value.trim(),
    dismissalReason: document.getElementById('wfDismissalReason').value.trim() || null,
  };

  if (patch.status === 'Dismissed' && !hasVal(patch.dismissalReason)) {
    errorEl.textContent = 'A Dismissal Reason is required before saving a Dismissed status.';
    errorEl.hidden = false;
    document.getElementById('wfDismissalReason').focus();
    return;
  }

  const saveBtn = document.getElementById('wfSaveBtn');
  saveBtn.disabled = true;
  let saved;
  try {
    saved = await saveWorkflow(currentDetailSignal, patch);
  } catch {
    saveBtn.disabled = false;
    errorEl.textContent = 'Could not save — check your connection and try again. Your changes are still in this form.';
    errorEl.hidden = false;
    return; // form fields are left exactly as typed — nothing is reset or overwritten
  }
  saveBtn.disabled = false;
  if (saved.noChanges) {
    // V8 correction: nothing was persisted, so nothing here re-renders the
    // form/overview/feed either — there is genuinely nothing to reflect.
    populateWorkflowForm(saved.workflow);
    return;
  }
  populateWorkflowForm(saved);
  refreshOverviewPanels();
  renderMain();
  showToast('Workflow decision saved to your account.');
}

/* ── Toast ────────────────────────────────────────────────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 4000);
}

/* ── Boot ─────────────────────────────────────────────────────── */
// V4: no longer auto-boots on DOMContentLoaded. app.html calls
// window.WatchdogDashboardBoot() itself, only after
// WatchdogAuth.requireActiveSession() confirms an active, authenticated
// session — so this page never requests signals while signed out.
window.WatchdogDashboardBoot = boot;
