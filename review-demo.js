// Watchdog EWS V9 — PUBLIC REVIEW MIRROR — review-demo.js
//
// REVIEW DEMO ONLY. This file, and everything it adds to the page, exists
// ONLY in this sanitized public mirror — it is never loaded by the real
// product (Dashboard/app.html does not reference it) and never ships to
// production. It exists purely so a reviewer (ChatGPT included) can reach
// the Data Connected states directly, without waiting for real network
// timing or editing browser storage by hand.
//
// It calls only the same public window.updateSyncBanner() function the
// real app already calls itself at boot (see dashboard.js) — nothing here
// reaches into private internals. Every OTHER required fixture state
// (Requires Action populated/empty, review-state matrix, citations) is
// reached either by real interaction (the same click path a production
// user would use) or by fixture data already seeded on specific signals —
// see review-index.html for exactly which signal shows which state, so
// nothing here needs to fake a personal-workflow write through a
// mismatched identity key.

(function () {
  'use strict';

  function addPanel() {
    const panel = document.createElement('div');
    panel.id = 'reviewDemoPanel';
    panel.setAttribute('aria-label', 'Review demo controls');
    panel.innerHTML = `
      <p class="review-demo-label">REVIEW DEMO ONLY</p>
      <p class="review-demo-title">Data Connected state</p>
      <div class="review-demo-row">
        <button type="button" data-demo-conn="connecting">Connecting…</button>
        <button type="button" data-demo-conn="connected">Data Connected</button>
        <button type="button" data-demo-conn="delayed">Experiencing Delays</button>
        <button type="button" data-demo-conn="failed">Sync Failed</button>
      </div>
      <p class="review-demo-note">Requires Action starts empty (no personal workflow decisions exist yet in a
        fresh mirror tab) — see the review index for the one real click that populates it.
        Analysis review states (Draft / Human Reviewed / Approved / Stale / Superseded) and citation states
        are pre-seeded on specific signals — see the review index for which signal shows which state.</p>
    `;
    document.body.appendChild(panel);

    panel.addEventListener('click', (e) => {
      const connBtn = e.target.closest('[data-demo-conn]');
      if (!connBtn) return;
      const state = connBtn.dataset.demoConn;
      if (state === 'connected') {
        window.updateSyncBanner({ signalsOk: true, personalOk: true, sharedOk: true });
      } else if (state === 'failed') {
        window.updateSyncBanner({ signalsOk: true, personalOk: false, sharedOk: true });
      } else {
        window.updateSyncBanner({ state });
      }
    });
  }

  // Phase C: the review identifier badge itself is static markup in
  // index.html (not injected here), but its dismiss control is fixture-
  // only interactive behavior, so it's wired here alongside the rest of
  // the demo-only JS. Dismissing it is a plain class toggle — no
  // localStorage, no persistence — so a reload always starts with the
  // badge visible again, and dismissing it never causes a layout shift
  // (the badge is position:fixed, already outside document flow, both
  // before and after removal).
  function wireBadgeDismiss() {
    const badge = document.getElementById('reviewMirrorBadge');
    const dismissBtn = document.getElementById('reviewMirrorBadgeDismiss');
    if (!badge || !dismissBtn) return;
    dismissBtn.addEventListener('click', () => badge.classList.add('is-dismissed'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { addPanel(); wireBadgeDismiss(); });
  } else {
    addPanel();
    wireBadgeDismiss();
  }
})();
