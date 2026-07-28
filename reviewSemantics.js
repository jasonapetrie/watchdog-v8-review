// Watchdog EWS V8 — reviewSemantics.js
//
// Pure, DOM-free logic correcting the V7.1 review-state defect: opening
// a signal's detail view used to silently mark it Reviewed, so casual
// inspection was indistinguishable from an actual completed review.
//
// V8 rule:
//   - Opening a signal = viewed only. viewSignal() never changes state.
//   - Explicitly choosing "Mark Reviewed" = reviewed. applyMarkReviewed().
//   - Saving a substantive workflow decision may also mark Reviewed, as
//     a side effect, but only if the signal wasn't already reviewed.
//     applyReviewedOnSubstantiveSave().
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

  // Saving any substantive workflow decision (Workflow Status, Response
  // Level, Next Action, Follow-Up Date, Operator Note, Dismissal Reason)
  // also counts as a review, per the product rule — but only sets
  // reviewedAt if it isn't already set. Never overwrites an existing
  // reviewedAt, and adds no history entry of its own (the caller's own
  // field-change summary already documents what was saved).
  function applyReviewedOnSubstantiveSave(wf, nowIso) {
    if (isReviewed(wf)) return wf;
    return { ...wf, reviewedAt: nowIso };
  }

  const ReviewSemantics = {
    isReviewed,
    viewSignal,
    applyMarkReviewed,
    applyReviewedOnSubstantiveSave,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReviewSemantics;
  }
  global.WatchdogReviewSemantics = ReviewSemantics;
})(typeof window !== 'undefined' ? window : globalThis);
