// Watchdog EWS V8 — PUBLIC REVIEW MIRROR — realtime.js (fixture)
//
// Replaces Dashboard/realtime.js. Exposes the identical
// window.WatchdogRealtime surface (subscribeSharedChannels,
// closeAllChannels) but never opens a real Supabase Realtime channel or
// makes any network connection. Nothing in this mirror ever changes
// after load, so there is nothing for a live subscription to usefully
// report — onChange is simply never called.

(function (global) {
  'use strict';

  function subscribeSharedChannels(onChange) {
    if (global.WatchdogAuth && global.WatchdogAuth.registerCleanup) {
      global.WatchdogAuth.registerCleanup(closeAllChannels);
    }
    void onChange; // intentionally never invoked — static fixture data never changes underneath the reviewer
  }

  function closeAllChannels() {
    /* no-op — no channel was ever opened */
  }

  const Realtime = { subscribeSharedChannels, closeAllChannels };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Realtime;
  }
  global.WatchdogRealtime = Realtime;
})(typeof window !== 'undefined' ? window : globalThis);
