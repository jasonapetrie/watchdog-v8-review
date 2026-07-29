// Watchdog EWS V8 — PUBLIC REVIEW MIRROR — auth.js (fixture)
//
// Replaces Dashboard/auth.js. Exposes the identical window.WatchdogAuth
// surface dashboard.js and repository.js expect, but never contacts
// Supabase Auth or any network endpoint. requireActiveSession() always
// resolves immediately to a fixture Administrator profile — there is no
// login, no session, no redirect, in this mirror.
//
// getClient() returns a fixture "db" object supporting the exact two
// chain shapes dashboard.js calls directly on it:
//   db.from('signals').select('*').order(...).limit(...)   (loadSignals)
//   db.channel('signals-live').on('postgres_changes', ...).subscribe()
// Every other data access goes through window.WatchdogRepository
// (repository.js in this directory), which never touches db at all.

(function (global) {
  'use strict';

  function thenableResolve(value) {
    return Promise.resolve(value);
  }

  // A chain where every method returns `this`, and the object itself is
  // thenable — robust to whatever order dashboard.js chains calls in.
  function makeQueryChain(resolveValue) {
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: () => chain,
      in: () => chain,
      maybeSingle: () => chain,
      single: () => chain,
      then: (resolve, reject) => thenableResolve(resolveValue).then(resolve, reject),
      catch: (reject) => thenableResolve(resolveValue).catch(reject),
    };
    return chain;
  }

  function makeChannel() {
    const channel = {
      on: () => channel,
      subscribe: () => channel,
      // realtime.js (fixture) calls removeChannel(channel) on cleanup —
      // nothing to actually tear down here since no subscription was made.
    };
    return channel;
  }

  function getClient() {
    return {
      from(table) {
        if (table === 'signals') {
          const fixtures = global.WATCHDOG_FIXTURES;
          return makeQueryChain({ data: fixtures ? fixtures.SIGNALS : [], error: null });
        }
        // No other table is queried directly through db in this mirror —
        // everything else goes through WatchdogRepository.
        return makeQueryChain({ data: [], error: null });
      },
      channel() {
        return makeChannel();
      },
      removeChannel() {
        /* no-op — no real subscription exists to tear down */
      },
      rpc() {
        return thenableResolve({ data: null, error: null });
      },
    };
  }

  const cleanupHandlers = [];
  function registerCleanup(fn) {
    if (typeof fn === 'function') cleanupHandlers.push(fn);
  }
  function runCleanup() {
    while (cleanupHandlers.length) {
      const fn = cleanupHandlers.pop();
      try { fn(); } catch (err) { console.error('Watchdog auth cleanup handler failed', err); }
    }
  }

  function fixtureProfile() {
    const fixtures = global.WATCHDOG_FIXTURES;
    return fixtures ? fixtures.PROFILE : { id: 'fixture-user', username: 'reviewer', display_name: 'Review Mirror User', role: 'Administrator', is_active: true };
  }

  async function signIn() {
    return { error: { message: 'This is a read-only design-review mirror. Sign-in is disabled — the interface is already unlocked.' } };
  }

  async function requestPasswordReset() {
    return { data: true };
  }

  async function completePasswordReset() {
    return { data: true };
  }

  async function signOut() {
    runCleanup();
  }

  async function getSession() {
    return { session: { user: { id: fixtureProfile().id }, expires_at: Math.floor(Date.now() / 1000) + 3600 } };
  }

  function needsRefresh() {
    return false;
  }

  async function getFreshSession() {
    return getSession();
  }

  async function loadProfile() {
    return { profile: fixtureProfile() };
  }

  function onAuthStateChange() {
    return { unsubscribe() {} };
  }

  // Always resolves immediately — no redirect, no real session check, no
  // network request. This is the one function real auth.js uses to gate
  // app.html; here it just hands back the fixture identity every time.
  async function requireActiveSession() {
    return { user: { id: fixtureProfile().id }, profile: fixtureProfile() };
  }

  const Auth = {
    getClient,
    signIn,
    signOut,
    requestPasswordReset,
    completePasswordReset,
    getSession,
    getFreshSession,
    needsRefresh,
    loadProfile,
    onAuthStateChange,
    requireActiveSession,
    registerCleanup,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Auth;
  }
  global.WatchdogAuth = Auth;

  // Sanitization pass: the real @supabase/supabase-js CDN script (and the
  // real project URL/publishable key it would be given) has been removed
  // from this mirror entirely — see index.html and the header comment in
  // dashboard.js. boot() still checks `typeof supabase === 'undefined'`
  // as a load-failure guard before it ever reaches WatchdogAuth.getClient()
  // (which is what this mirror actually uses), so a bare inert identifier
  // is defined here purely to satisfy that guard. .createClient() is never
  // called in this mirror — WatchdogAuth.getClient() always wins the
  // ternary in boot() first — but it throws rather than silently no-op-ing
  // if that ever changed, so this can never accidentally start acting like
  // a real Supabase client.
  if (typeof global.supabase === 'undefined') {
    global.supabase = {
      createClient() {
        throw new Error('This is a sanitized review mirror — no real Supabase client exists. See auth.js.');
      },
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
