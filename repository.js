// Watchdog EWS V8 — PUBLIC REVIEW MIRROR — repository.js (fixture)
//
// Replaces Dashboard/repository.js. Implements the identical
// window.WatchdogRepository surface (all 28 methods dashboard.js calls)
// directly against the in-memory fixtures in window.WATCHDOG_FIXTURES —
// never touches Supabase, never calls a Netlify Function, never makes a
// network request of any kind. Mutations (creating a Policy Matter,
// editing shared coordination, etc.) are applied to in-memory arrays only
// — nothing persists past a page reload, and nothing here can reach a
// real database. This is intentional: the reviewer should be able to
// click every button, but nothing they do can leave a mark anywhere.
//
// The manual-intelligence-pilot import path (buildIntelligencePacket /
// importIntelligenceDraft) always returns the sanitized V7.1 baseline
// specimen (see fixtures.js / docs/watchdog-v8-review-mirror.md) —
// regardless of what text is pasted into the response box — so the seven
// documented rendering defects are reliably reproducible for review.

(function (global) {
  'use strict';

  function fx() {
    return global.WATCHDOG_FIXTURES;
  }

  function delay(value) {
    // A microtask tick is enough to keep every caller's existing
    // await-based control flow (loading states, disabled buttons while
    // "Building…", etc.) behaving the same as it does against a real,
    // if fast, network call — without an artificial timer delay.
    return Promise.resolve(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // ── signal_user_state (personal, in-memory only) ───────────────────
  const myState = {}; // { [signalIdentity]: localFields }

  async function fetchMySignalUserState() {
    return delay(clone(myState));
  }

  async function saveSignalUserState(userId, signalIdentity, representativeSignalId, rec) {
    const existing = myState[signalIdentity] || {};
    const merged = {
      status: rec.status || '',
      responseLevel: rec.responseLevel === undefined ? (existing.responseLevel ?? null) : rec.responseLevel,
      nextAction: rec.nextAction || '',
      followUpDate: rec.followUpDate || null,
      note: rec.note || '',
      dismissalReason: rec.dismissalReason || null,
      reviewedAt: rec.reviewedAt || existing.reviewedAt || null,
      closedAt: rec.closedAt || null,
      dismissedAt: rec.dismissedAt || null,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    myState[signalIdentity] = merged;
    return delay(clone(merged));
  }

  async function bulkUpsertSignalUserState() {
    return delay([]); // legacy-migration path; no legacy localStorage key ever exists in a fresh mirror browser
  }

  async function hasExistingImport() {
    return delay(false);
  }

  async function recordWorkspaceImport() {
    return delay(undefined);
  }

  // ── policy_matters (shared, in-memory only) ─────────────────────────
  let matters = null;
  function ensureMatters() {
    if (!matters) matters = clone(fx().POLICY_MATTERS);
    return matters;
  }

  async function fetchPolicyMatters() {
    return delay(clone(ensureMatters()));
  }

  async function createPolicyMatter(fields) {
    const row = {
      id: 'mat-fixture-' + Math.random().toString(36).slice(2, 10),
      title: fields.title || '',
      category: fields.category || '',
      jurisdiction: fields.jurisdiction || '',
      county: fields.county || '',
      status: fields.status || 'Monitoring',
      priority: fields.priority || 'Monitor',
      nextAction: fields.nextAction || '',
      followUpDate: fields.followUpDate || null,
      notes: fields.notes || '',
      assignedOwnerId: fields.assignedOwnerId || null,
      createdBy: fx().PROFILE.id,
      updatedBy: fx().PROFILE.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: null,
    };
    ensureMatters().push(row);
    return delay(clone(row));
  }

  async function updatePolicyMatter(id, fields, expectedUpdatedAt) {
    const list = ensureMatters();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) throw new Error('This Policy Matter no longer exists in this review session.');
    if (expectedUpdatedAt && list[idx].updatedAt !== expectedUpdatedAt) {
      const e = new Error('This Policy Matter was changed by someone else.');
      e.staleConflict = true;
      throw e;
    }
    list[idx] = { ...list[idx], ...fields, updatedAt: new Date().toISOString() };
    return delay(clone(list[idx]));
  }

  // ── policy_matter_signals (in-memory join table) ────────────────────
  let matterSignals = [];
  async function fetchPolicyMatterSignals() {
    return delay(clone(matterSignals));
  }

  async function attachSignalToMatterRemote(matterId, signalIdentity, representativeSignalId) {
    const row = { matter_id: matterId, signal_identity: signalIdentity, representative_signal_id: representativeSignalId ?? null, created_at: new Date().toISOString() };
    matterSignals.push(row);
    return delay(clone(row));
  }

  async function detachSignalFromMatterRemote(matterId, signalIdentity) {
    matterSignals = matterSignals.filter((r) => !(r.matter_id === matterId && r.signal_identity === signalIdentity));
    return delay(undefined);
  }

  // ── signal_shared_state (in-memory only) ────────────────────────────
  const sharedState = {};

  async function fetchSignalSharedState() {
    return delay(clone(sharedState));
  }

  async function saveSignalSharedState(signalIdentity, representativeSignalId, fields, expectedUpdatedAt) {
    const existing = sharedState[signalIdentity];
    if (existing && expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      const e = new Error('Shared Coordination was changed by someone else.');
      e.staleConflict = true;
      throw e;
    }
    const merged = {
      leadershipAwareness: fields.leadershipAwareness || (existing ? existing.leadershipAwareness : 'No'),
      committeeAttention: fields.committeeAttention || (existing ? existing.committeeAttention : 'None'),
      sharedCoordinationNote: fields.sharedCoordinationNote ?? (existing ? existing.sharedCoordinationNote : ''),
      updatedBy: fx().PROFILE.id,
      updatedAt: new Date().toISOString(),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    sharedState[signalIdentity] = merged;
    return delay(clone(merged));
  }

  async function bulkUpsertSignalSharedState() {
    return delay([]); // legacy-migration path; never reached in a fresh mirror browser
  }

  // ── Shared audit history + attribution ──────────────────────────────
  async function fetchSharedAuditEvents() {
    return delay(clone(fx().AUDIT_EVENTS));
  }

  async function fetchAllProfiles() {
    return delay([clone(fx().PROFILE), clone(fx().OTHER_PROFILE)]);
  }

  // ── Registry-grade, read-only tables ─────────────────────────────────
  async function fetchSourceRegistry() {
    return delay(clone(fx().SOURCE_REGISTRY));
  }
  async function fetchSourceEndpoints() {
    return delay(clone(fx().SOURCE_ENDPOINTS));
  }
  async function fetchSourceReporterWatches() {
    return delay(clone(fx().SOURCE_REPORTER_WATCHES));
  }
  async function fetchSourceGeographyRules() {
    return delay(clone(fx().SOURCE_GEOGRAPHY_RULES));
  }
  async function fetchSpecialDistrictRegistry() {
    return delay(clone(fx().SPECIAL_DISTRICT_REGISTRY));
  }

  // ── V5 quarantine review ──────────────────────────────────────────────
  async function fetchQuarantinedSignals() {
    return delay(clone(fx().SIGNALS.filter((s) => s.validation_disposition === 'Quarantined')));
  }

  async function resolveQuarantinedSignal(signalId, newDisposition) {
    const s = fx().SIGNALS.find((sig) => sig.id === signalId);
    if (s) s.validation_disposition = newDisposition;
    return delay(undefined);
  }

  // ── V6 scanner run history ────────────────────────────────────────────
  async function fetchScannerRuns(limitCount) {
    return delay(clone(fx().SCANNER_RUNS).slice(0, limitCount || 25));
  }

  async function fetchScannerRunSteps(scannerRunIds) {
    if (!scannerRunIds || !scannerRunIds.length) return delay([]);
    return delay(clone(fx().SCANNER_RUN_STEPS.filter((s) => scannerRunIds.includes(s.scanner_run_id))));
  }

  // ── V7 / V7.1 intelligence analyses ──────────────────────────────────
  const savedAnalyses = {}; // { [signalId]: [analysis, ...] } — starts from the fixture baseline, mutable at runtime

  function ensureAnalysesFor(signalId) {
    if (!savedAnalyses[signalId]) {
      const seeded = fx().ANALYSES_BY_SIGNAL[signalId];
      savedAnalyses[signalId] = seeded ? clone(seeded) : [];
    }
    return savedAnalyses[signalId];
  }

  async function fetchSignalIntelligenceAnalyses(signalId) {
    const list = ensureAnalysesFor(signalId).slice().sort((a, b) => b.analysis_version - a.analysis_version);
    return delay(clone(list));
  }

  async function reviewSignalIntelligenceAnalysis(analysisId, newStatus, note) {
    for (const signalId of Object.keys(savedAnalyses)) {
      const row = savedAnalyses[signalId].find((a) => a.id === analysisId);
      if (row) {
        row.status = newStatus;
        row.review_note = note || row.review_note;
        row.reviewed_by = fx().PROFILE.id;
        row.reviewed_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        return delay(undefined);
      }
    }
    throw new Error('This analysis no longer exists in this review session.');
  }

  // Fully-automated AI generation was never activated in production (see
  // docs/watchdog-manual-intelligence-pilot.md) — this mirror faithfully
  // reproduces that: the button exists, but generation is not enabled.
  async function generateIntelligenceDraft() {
    const err = new Error('AI-assisted generation is not enabled for this signal. Use Build Intelligence Packet / Copy for ChatGPT instead.');
    err.code = 'ai_generation_disabled';
    throw err;
  }

  // ── V7.1 manual ChatGPT intelligence pilot ───────────────────────────
  async function buildIntelligencePacket(signalId) {
    const f = fx();
    return delay({
      packetId: 'evid-fixture-' + signalId,
      runId: 'run-intel-fixture-' + signalId,
      packetText: f.EVIDENCE_PACKET_TEXT,
      builtAt: new Date().toISOString(),
      evidenceCount: 1,
      hasPrimarySource: true,
      hasPositionSources: false,
      hasJurisdictionProfile: false,
      doctrineVersion: f.BASELINE_ANALYSIS.doctrine_version,
    });
  }

  // Always returns the sanitized V7.1 baseline specimen as the "parsed"
  // response, regardless of what was pasted — see file header. On
  // dryRun:false, also saves it as a new Draft version for this signal so
  // the Analysis tab shows it afterward, exactly like the real save flow.
  async function importIntelligenceDraft({ signalId, dryRun }) {
    const f = fx();
    const preview = clone(f.BASELINE_ANALYSIS);
    preview.signal_id = signalId;

    if (dryRun) {
      return delay({
        preview,
        warnings: preview.usage_metadata.warnings,
        isStale: false,
        staleReason: null,
      });
    }

    const list = ensureAnalysesFor(signalId);
    const nextVersion = list.length ? Math.max(...list.map((a) => a.analysis_version)) + 1 : 1;
    const saved = clone(preview);
    saved.id = 'aaaa1111-fixture-' + signalId + '-' + nextVersion;
    saved.analysis_version = nextVersion;
    saved.status = 'Draft';
    saved.created_at = new Date().toISOString();
    saved.updated_at = saved.created_at;
    list.push(saved);
    return delay({ saved: true, analysisId: saved.id });
  }

  async function editIntelligenceAnalysisDraft(analysisId, updates, note) {
    for (const signalId of Object.keys(savedAnalyses)) {
      const row = savedAnalyses[signalId].find((a) => a.id === analysisId);
      if (row) {
        Object.assign(row, updates);
        row.updated_at = new Date().toISOString();
        const history = (row.usage_metadata && row.usage_metadata.edit_history) || [];
        history.push({ editor: fx().PROFILE.id, edited_at: row.updated_at, changed_fields: Object.keys(updates), material_change: false, note: note || null });
        if (row.usage_metadata) row.usage_metadata.edit_history = history;
        return delay(undefined);
      }
    }
    throw new Error('This analysis no longer exists in this review session.');
  }

  const Repository = {
    fetchMySignalUserState,
    saveSignalUserState,
    bulkUpsertSignalUserState,
    hasExistingImport,
    recordWorkspaceImport,
    fetchPolicyMatters,
    createPolicyMatter,
    updatePolicyMatter,
    fetchPolicyMatterSignals,
    attachSignalToMatterRemote,
    detachSignalFromMatterRemote,
    fetchSignalSharedState,
    saveSignalSharedState,
    bulkUpsertSignalSharedState,
    fetchSharedAuditEvents,
    fetchAllProfiles,
    fetchSourceRegistry,
    fetchSourceEndpoints,
    fetchSourceReporterWatches,
    fetchSourceGeographyRules,
    fetchSpecialDistrictRegistry,
    fetchQuarantinedSignals,
    resolveQuarantinedSignal,
    fetchScannerRuns,
    fetchScannerRunSteps,
    fetchSignalIntelligenceAnalyses,
    reviewSignalIntelligenceAnalysis,
    generateIntelligenceDraft,
    buildIntelligencePacket,
    importIntelligenceDraft,
    editIntelligenceAnalysisDraft,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Repository;
  }
  global.WatchdogRepository = Repository;
})(typeof window !== 'undefined' ? window : globalThis);
