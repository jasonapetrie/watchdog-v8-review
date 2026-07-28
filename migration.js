// Watchdog EWS V4 — migration.js
//
// One-time legacy-workspace import: detects the V3 localStorage
// workspace, shows a confirmation dialog with counts, and (only after
// explicit confirmation) imports personal signal decisions into
// signal_user_state via repository.js. Never imports automatically.
// Never deletes or modifies the legacy localStorage — it stays in the
// browser as a backup regardless of import outcome.
//
// Personal signal decisions always import into signal_user_state. As of
// V4's shared-collaboration pass, an Administrator or Collaborator's
// import ALSO carries over any non-default Leadership Awareness /
// Committee Attention / Shared Coordination Note values from their
// legacy record into the shared signal_shared_state table — those are
// genuinely shared team data now, not personal. An Operator or Viewer's
// import skips this step entirely (RLS would reject the write anyway;
// skipped client-side too, per "do not write unauthorized shared
// changes") — their legacy shared-field values are simply left in their
// untouched local backup, not migrated and not reported anywhere further.
// Policy Matters in the legacy store are still never migrated by this
// pass — Policy Matters are created fresh in the shared workspace now.

(function (global) {
  'use strict';

  const LEGACY_KEY = 'watchdogEwsWorkflowV1'; // must match dashboard.js's WORKFLOW_STORAGE_KEY exactly
  const PROMPTED_KEY_PREFIX = 'watchdogEwsV4MigrationPrompted_';

  function readLegacyStore() {
    try {
      const raw = global.localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.records !== 'object' || parsed.records === null) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function countByStatus(records) {
    const counts = { reviewed: 0, monitoring: 0, actionRequired: 0, closed: 0, dismissed: 0 };
    for (const rec of Object.values(records)) {
      if (!rec || typeof rec !== 'object') continue;
      if (rec.reviewedAt) counts.reviewed++;
      if (rec.status === 'Monitoring') counts.monitoring++;
      else if (rec.status === 'Action Required') counts.actionRequired++;
      else if (rec.status === 'Closed') counts.closed++;
      else if (rec.status === 'Dismissed') counts.dismissed++;
    }
    return counts;
  }

  // A stable fingerprint of exactly what would be imported, so importing
  // the same frozen legacy snapshot twice (e.g. from a second browser
  // session) is detected and blocked, while an update to workspace_imports
  // detection logic itself doesn't require touching this format.
  async function computeFingerprint(records) {
    const keys = Object.keys(records).sort();
    const canonical = keys.map((k) => k + '=' + JSON.stringify(records[k])).join('\n');
    const enc = new TextEncoder().encode(canonical);
    const digest = await global.crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function checkAndPromptIfNeeded(userId, role) {
    if (global.localStorage.getItem(PROMPTED_KEY_PREFIX + userId)) return; // already handled once this browser
    const legacy = readLegacyStore();
    if (!legacy || !Object.keys(legacy.records).length) return; // nothing to migrate
    const counts = countByStatus(legacy.records);
    showMigrationDialog(userId, role, legacy, counts);
  }

  function showMigrationDialog(userId, role, legacy, counts) {
    const dialog = global.document.getElementById('migrationDialog');
    if (!dialog) return;
    const S = global.WatchdogSecurity;

    S.setText(global.document.getElementById('migCountReviewed'), String(counts.reviewed));
    S.setText(global.document.getElementById('migCountMonitoring'), String(counts.monitoring));
    S.setText(global.document.getElementById('migCountActionRequired'), String(counts.actionRequired));
    S.setText(global.document.getElementById('migCountClosed'), String(counts.closed));
    S.setText(global.document.getElementById('migCountDismissed'), String(counts.dismissed));

    const msgEl = global.document.getElementById('migResultMsg');
    msgEl.hidden = true;
    msgEl.style.color = '';

    const importBtn = global.document.getElementById('migImportBtn');
    const cancelBtn = global.document.getElementById('migCancelBtn');
    importBtn.disabled = false;
    importBtn.textContent = 'Import Personal Workspace';

    function markPromptedAndClose() {
      global.localStorage.setItem(PROMPTED_KEY_PREFIX + userId, '1');
      dialog.close();
      cleanup();
    }
    function cleanup() {
      importBtn.removeEventListener('click', onImport);
      cancelBtn.removeEventListener('click', onCancel);
    }
    function onCancel() {
      markPromptedAndClose();
    }
    async function onImport() {
      importBtn.disabled = true;
      importBtn.textContent = 'Importing…';
      try {
        const result = await runImport(userId, legacy, role);
        global.localStorage.setItem(PROMPTED_KEY_PREFIX + userId, '1');
        msgEl.style.color = '';
        msgEl.textContent = result.sharedCount
          ? `Imported ${result.count} signal record(s), including ${result.sharedCount} shared coordination value(s). Reloading your synced workspace…`
          : `Imported ${result.count} signal record(s). Reloading your synced workspace…`;
        msgEl.hidden = false;
        global.setTimeout(() => global.location.reload(), 1200);
      } catch (err) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import Personal Workspace';
        msgEl.style.color = '#ff9d9d';
        msgEl.textContent = err && err.alreadyImported
          ? 'This local workspace has already been imported to your account.'
          : 'Import failed — your local workspace has not been touched. You can try again.';
        msgEl.hidden = false;
        global.console.error('Workspace import failed:', err);
      }
    }

    importBtn.addEventListener('click', onImport);
    cancelBtn.addEventListener('click', onCancel);

    dialog.showModal();
  }

  async function runImport(userId, legacy, role) {
    const fingerprint = await computeFingerprint(legacy.records);
    const already = await global.WatchdogRepository.hasExistingImport(userId, fingerprint);
    if (already) {
      const e = new Error('Already imported');
      e.alreadyImported = true;
      throw e;
    }

    // Best-effort match against the currently loaded signal feed so
    // representative_signal_id can be set where possible — a legacy
    // record for a signal no longer in the current feed simply gets
    // null, which is an allowed, nullable reference.
    const currentSignals = global.rawSignals || [];
    const identityFn = global.signalIdentity;
    const matchFor = (signalIdentity) => (typeof identityFn === 'function'
      ? currentSignals.find((s) => identityFn(s) === signalIdentity)
      : null);

    const legacyEntries = Object.entries(legacy.records).filter(([, rec]) => rec && typeof rec === 'object');

    const personalRows = legacyEntries.map(([signalIdentity, rec]) => {
      const match = matchFor(signalIdentity);
      return {
        signalIdentity,
        representativeSignalId: match ? match.id : null,
        fields: {
          status: rec.status || '',
          responseLevel: rec.responseLevel === undefined ? null : rec.responseLevel,
          nextAction: rec.nextAction || '',
          followUpDate: rec.followUpDate || null,
          note: rec.note || '',
          dismissalReason: rec.dismissalReason || null,
          reviewedAt: rec.reviewedAt || null,
          // signal_user_state has no history column (personal per-signal
          // history isn't a synced field in this pass) and Closed/
          // Dismissed timestamps aren't tracked separately in the legacy
          // local shape — best-effort backfill from updatedAt so the
          // synced record isn't left with an empty closed/dismissed
          // timestamp for a record that already reached that status.
          closedAt: rec.status === 'Closed' ? (rec.updatedAt || null) : null,
          dismissedAt: rec.status === 'Dismissed' ? (rec.updatedAt || null) : null,
        },
      };
    });

    await global.WatchdogRepository.bulkUpsertSignalUserState(userId, personalRows);

    // Shared fields: only for a role that can actually write shared data
    // (Administrator/Collaborator) — an Operator/Viewer's legacy
    // Leadership Awareness / Committee Attention values are left in their
    // untouched local backup, not migrated, per "do not write unauthorized
    // shared changes."
    let sharedRowCount = 0;
    const canShare = global.WatchdogSecurity && global.WatchdogSecurity.canEditShared(role);
    if (canShare) {
      const sharedRows = legacyEntries
        .filter(([, rec]) => hasNonDefaultSharedFields(rec))
        .map(([signalIdentity, rec]) => {
          const match = matchFor(signalIdentity);
          return {
            signalIdentity,
            representativeSignalId: match ? match.id : null,
            fields: {
              leadershipAwareness: rec.leadershipAwareness || null,
              committeeAttention: rec.committeeAttention || 'None',
              sharedCoordinationNote: '', // legacy local shape never had a distinct shared-note field
            },
          };
        });
      if (sharedRows.length) {
        await global.WatchdogRepository.bulkUpsertSignalSharedState(sharedRows);
        sharedRowCount = sharedRows.length;
      }
    }

    const counts = countByStatus(legacy.records);
    await global.WatchdogRepository.recordWorkspaceImport(userId, {
      sourceFormatVersion: 'watchdog-v3-localStorage-v' + (legacy.version || 3),
      fingerprint,
      personalRecordCount: personalRows.length,
      sharedRecordCount: sharedRowCount,
      resultSummary: counts,
    });

    return { count: personalRows.length, sharedCount: sharedRowCount };
  }

  function hasNonDefaultSharedFields(rec) {
    return rec.leadershipAwareness === 'Yes' || (rec.committeeAttention && rec.committeeAttention !== 'None');
  }

  // Only checkAndPromptIfNeeded is meant to be called from app.html's own
  // boot sequence; the rest (runImport, readLegacyStore, countByStatus,
  // computeFingerprint) are exposed alongside it in the same spirit
  // dashboard.js exposes its own internals as plain globals — so tests can
  // exercise the real import logic directly instead of reimplementing it.
  global.WatchdogMigration = { checkAndPromptIfNeeded, runImport, readLegacyStore, countByStatus, computeFingerprint };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.WatchdogMigration;
  }
})(typeof window !== 'undefined' ? window : globalThis);
