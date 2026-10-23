// ──────────────────────────────────────────────────────────────────────────
// Boot sequence
// ──────────────────────────────────────────────────────────────────────────
async function boot() {
  // #history is a legacy hash that now routes to Sales tab + History pill.
  // Apply the side-effect (queue filter) anywhere we honor a hash.
  const applyHash = () => {
    const v = HASH_MAP[location.hash] || ((window.RIDD_MODULES || []).some(m => '#' + m.id === location.hash) ? location.hash.slice(1) : null);
    if (!v) return null;
    if (location.hash === '#history') state._salesQueueFilter = 'history';
    return v;
  };

  // Always rehydrate the indicator CSV upload (state.indicatorsData,
  // raw sales, snapshots, etc.) regardless of demo mode. Without this,
  // a refresh wiped every uploaded CSV in production — which broke
  // week-over-week comparisons between uploads.
  loadIndicatorState();

  if (DEMO) {
    loadDemoData();
    const hv = applyHash();
    if (hv) state.view = hv;
    else if (_applyResume()) { /* resume within window */ }
    mountApp();
    if (state._resumeScroll) { const y = state._resumeScroll; state._resumeScroll = 0; setTimeout(() => window.scrollTo(0, y), 400); }
    window.addEventListener('hashchange', () => {
      const v = applyHash();
      if (v && v !== state.view) { state.view = v; mountApp(); }
      else if (v === state.view && location.hash === '#history') mountApp();
    });
    return;
  }
  if (!supabase) {
    mountConfigMissing();
    return;
  }
  // Capture the URL synchronously BEFORE `supabase.auth.getSession()`
  // gets a chance to consume the fragment. The SDK strips recovery
  // tokens out of `location.hash` once it processes them, so any later
  // check would miss it.
  //
  //   Legacy implicit flow: `#access_token=...&type=recovery&...`
  //   Modern PKCE flow:     `?code=...` (no `type=recovery` hint in URL —
  //                         we rely on the PASSWORD_RECOVERY auth event
  //                         registered below to catch this case)
  const recoveryFromUrl = (location.hash || '').includes('type=recovery');
  // A refresh mid-recovery used to skip the form entirely (the recovery
  // session signs the user in), letting reps land in the app WITHOUT ever
  // setting a password. This tab-scoped flag pins the form until the save
  // actually succeeds.
  let recoveryPending = false;
  try { recoveryPending = sessionStorage.getItem('ridd_recovery_pending') === '1'; } catch { /* private mode */ }

  // Track whether we've shown the recovery form so a follow-up
  // SIGNED_IN event (Supabase fires both during PKCE recovery) doesn't
  // bounce the user out of the password-update screen back into the app.
  let recoveryShown = false;
  const showRecovery = () => {
    if (recoveryShown) return;
    recoveryShown = true;
    try { sessionStorage.setItem('ridd_recovery_pending', '1'); } catch { /* private mode */ }
    mountAuth({ mode: 'recover' });
  };

  // Listener is registered BEFORE `getSession()` so PASSWORD_RECOVERY
  // events that fire during the SDK's initial URL-detection are caught.
  // Previous version registered after the await and missed the event
  // entirely — that's why reset links just dropped users into the app.
  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') { showRecovery(); return; }
    // recoveryPending: a refresh mid-recovery re-fires INITIAL_SESSION with
    // the recovery session — without this guard the listener's async
    // loadAndRender() would mount the app OVER the pinned set-password form.
    if (recoveryShown || (recoveryPending && session)) return; // stay on the recovery form
    // TOKEN_REFRESHED fires ~hourly and on tab-focus; USER_UPDATED after
    // profile edits. The fresh session is already swapped into state above —
    // reloading here yanked users to the splash + reset their tab mid-read
    // (THE "app feels glitchy" report). Never re-splash a working session.
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    // Deferred out of the auth callback: supabase-js runs it while holding the auth lock, and loadAndRender's
    // first query asks for that same lock — the documented deadlock. setTimeout lets the callback return first.
    if (session) {
      if (state.profile) return;   // already hydrated — nothing to do
      setTimeout(() => loadAndRender(), 0);
    } else mountAuth();
  });

  if (recoveryFromUrl) {
    showRecovery();
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  if (recoveryShown) return;
  if (!session) {
    // No session → any lingering recovery flag is stale (link expired /
    // signed out). Clear it so a later normal sign-in isn't hijacked.
    recoveryPending = false;
    try { sessionStorage.removeItem('ridd_recovery_pending'); } catch { /* ignore */ }
    mountAuth();
    return;
  }
  if (recoveryPending) {
    // Refresh mid-recovery: keep them on the set-password form instead of
    // silently dropping them into the app with no password set.
    showRecovery();
    return;
  }
  // 30-DAY RE-AUTH — light security hygiene: sessions otherwise refresh
  // forever. Once a month the app asks for the password again (iOS keychain
  // autofill makes it a two-tap). Clock starts at each successful sign-in.
  if (session) {
    try {
      const REAUTH_MS = 30 * 86400000;
      const la = Number(localStorage.getItem('ridd_last_auth_v1') || 0);
      if (!la) localStorage.setItem('ridd_last_auth_v1', String(Date.now()));   // existing sessions: start the clock now
      else if (Date.now() - la > REAUTH_MS && localStorage.getItem('ridd_tv_board') !== '1') {   // the TV board never gets bounced for a re-auth (per Isaac, Sep 23)
        localStorage.removeItem('ridd_last_auth_v1');
        await supabase.auth.signOut();
        mountAuth();
        try { toast('Quick security check — please sign in again.', 'info'); } catch { /* pre-toast */ }
        return;
      }
    } catch { /* private mode — skip */ }
  }
  let _freshLogin = false; try { _freshLogin = sessionStorage.getItem('ridd_fresh_login') === '1'; sessionStorage.removeItem('ridd_fresh_login'); } catch { /* private mode */ }
  const hv2 = _freshLogin ? null : applyHash();
  if (_freshLogin) { state.view = 'dashboard'; try { history.replaceState(null, '', VIEW_TO_HASH.dashboard || '#dashboard'); } catch { /* keep */ } }   // Sales tab; the role guards send reps to their own Sales home
  else if (hv2) { state.view = hv2; state._navChosen = true; }
  else if (_applyResume()) { state._navChosen = true; /* re-opened within the window → land on the last tab */ }
  await loadAndRender();
  // Put them back at the scroll position they left (best-effort — data
  // sections finish loading async, so a slightly different height is fine).
  if (state._resumeScroll) { const y = state._resumeScroll; state._resumeScroll = 0; setTimeout(() => window.scrollTo(0, y), 400); }
  // Back onto the TV board after a version auto-reload (the board set the flag).
  try {
    if (sessionStorage.getItem('ridd_reopen_tv') === '1' || localStorage.getItem('ridd_tv_board') === '1') {
      sessionStorage.removeItem('ridd_reopen_tv');
      if (typeof openTvBoard === 'function' && state.profile) setTimeout(() => { try { openTvBoard(); } catch (e) { /* board optional */ } }, 600);
    }
  } catch { /* ignore */ }
  // Post-reload confirmation from the password-save handoff.
  try {
    if (sessionStorage.getItem('ridd_pw_saved') === '1') {
      sessionStorage.removeItem('ridd_pw_saved');
      toast("Password updated — you're all set.", 'success');
    }
  } catch { /* ignore */ }
  window.addEventListener('hashchange', () => {
    const v = applyHash();
    if (v && v !== state.view) { state.view = v; mountApp(); }
    else if (v === state.view && location.hash === '#history') mountApp();
  });
}

