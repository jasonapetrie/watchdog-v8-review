// Watchdog EWS V8 — reviewSemantics.js
//
// Pure, DOM-free logic correcting the V7.1 review-state defect: opening
// a signal's detail view used to silently mark it Reviewed, so casual
// inspection was indistinguishable from an actual completed review.
//
// V8 rule:
//   - Opening a signal = viewed only. viewSignal() never changes state.
//   - Explicitly choosing "Mark Reviewed" = reviewed. applyMarkReviewed().
//   - Saving a workflow decision marks Reviewed as a side effect ONLY
//     when the save actually changed at least one substantive field
//     (Status, Response Level, Operator Note, Next Action, Follow-Up
//     Date, Dismissal Reason) — never merely because Save was clicked.
//     applyReviewedOnSubstantiveSave() takes that yes/no as an explicit
//     argument; the caller (dashboard.js) computes it from the real
//     field diff via describeWorkflowChanges(), never guesses.
//   - Every transition here is idempotent: calling any of these on an
//     already-reviewed record returns it completely unchanged (same
//     reference identity where nothing changed) — no duplicate history
//     entries, no bumped timestamps, on repeat calls.
//
// dashboard.js owns all I/O (Supabase writes, DOM rendering, current
// time); this module only decides what the resulting workflow record
// should look like, given one as input — exactly the same testability
// split already used by Dashboard/editFormLogic.js.

(function (global) {
  'use strict';

  const DEFAULT_HISTORY_CAP = 25;

  // The exact six operator-selectable fields a "substantive" workflow
  // save can change — the same set dashboard.js's WORKFLOW_FIELD_LABELS
  // covers for the human-readable history summary. Kept here too, as its
  // own pure, directly-testable decision, so "was this save substantive"
  // never has to be inferred from string-diffing spread across the DOM
  // layer — a caller can ask this question with no signal object, no
  // repository, no DOM at all.
  const SUBSTANTIVE_WORKFLOW_FIELDS = ['status', 'responseLevel', 'note', 'nextAction', 'followUpDate', 'dismissalReason'];

  function normalizedFieldValue(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  // True if `next` differs from `prev` on at least one of the six
  // substantive fields. Only those six fields matter — reviewedAt,
  // closedAt, dismissedAt, updatedAt, createdAt, and history are all
  // derived/bookkeeping fields, never the basis for "did the operator
  // actually decide something."
  function hasSubstantiveWorkflowChange(prev, next) {
    const p = prev || {};
    const n = next || {};
    return SUBSTANTIVE_WORKFLOW_FIELDS.some((key) => normalizedFieldValue(p[key]) !== normalizedFieldValue(n[key]));
  }

  function isReviewed(wf) {
    return !!(wf && wf.reviewedAt);
  }

  // Opening a signal. Deliberately a no-op — kept as a named function
  // (rather than callers just skipping a call) so the "view is not a
  // mutation" rule is a single, greppable decision point.
  function viewSignal(wf) {
    return wf;
  }

  // The explicit "Mark Reviewed" control, shown only while a signal is
  // still unreviewed. Idempotent: a second call (e.g. a double-click
  // racing the UI hiding the button) returns the identical object.
  function applyMarkReviewed(wf, nowIso, historyCap) {
    if (isReviewed(wf)) return wf;
    const cap = historyCap || DEFAULT_HISTORY_CAP;
    const history = Array.isArray(wf.history) ? wf.history : [];
    return {
      ...wf,
      reviewedAt: nowIso,
      createdAt: wf.createdAt || nowIso,
      updatedAt: nowIso,
      history: [...history, { at: nowIso, summary: 'Review State: Unreviewed → Reviewed (marked reviewed)' }].slice(-cap),
    };
  }

  // Saving a workflow decision counts as review too — but ONLY when
  // hasSubstantiveChange is true, i.e. the caller already determined
  // (from the real field diff, not from "Save was clicked") that at
  // least one of Status/Response Level/Operator Note/Next Action/
  // Follow-Up Date/Dismissal Reason actually changed. A no-change Save
  // must reach this function with hasSubstantiveChange: false, or
  // (better) never call it at all — either way this returns the record
  // completely untouched: no reviewedAt, no new reference. Never
  // overwrites an existing reviewedAt, and adds no history entry of its
  // own (the caller's own field-change summary already documents what
  // was saved).
  function applyReviewedOnSubstantiveSave(wf, nowIso, hasSubstantiveChange) {
    if (isReviewed(wf)) return wf;
    if (!hasSubstantiveChange) return wf;
    return { ...wf, reviewedAt: nowIso };
  }

  const ReviewSemantics = {
    isReviewed,
    viewSignal,
    applyMarkReviewed,
    applyReviewedOnSubstantiveSave,
    hasSubstantiveWorkflowChange,
    SUBSTANTIVE_WORKFLOW_FIELDS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReviewSemantics;
  }
  global.WatchdogReviewSemantics = ReviewSemantics;
})(typeof window !== 'undefined' ? window : globalThis);
