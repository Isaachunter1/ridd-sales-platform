// Mounts — top-level views
// ──────────────────────────────────────────────────────────────────────────
function mount(view) {
  const app = $('#app');
  app.innerHTML = '';
  app.append(view);
}

function mountConfigMissing() {
  mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6' },
    el('div', { class: 'card p-8 max-w-xl text-center' },
      el('div', { class: 'text-4xl font-black tracking-tight mb-1', style: { color: 'var(--accent)' } }, 'RIDD'),
      el('div', { class: 'text-xs text-muted- tracking-widest mb-6' }, 'SALES PLATFORM'),
      el('h1', { class: 'text-xl font-semibold mb-3' }, 'Configuration needed'),
      el('p', { class: 'text-muted- text-sm mb-4' },
        'Open ', el('code', { style: { color: 'var(--accent)' } }, 'index.html'),
        ' and paste your Supabase publishable key into the ',
        el('code', { style: { color: 'var(--accent)' } }, 'RIDD_CONFIG'), ' block at the top of the file.'),
      el('p', { class: 'text-muted- text-xs mb-6' },
        'Supabase Dashboard → Settings → API Keys → "Publishable and secret API keys" → Create new API keys'),
      el('div', { class: 'pt-4 border-t', style: { borderColor: 'var(--border)' } },
        el('p', { class: 'text-xs text-muted- mb-3' }, 'Or explore the UI with mock data:'),
        el('a', {
          href: '?demo',
          class: 'inline-block px-5 py-2.5 rounded-xl font-semibold text-sm transition hover:brightness-95', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        }, 'View demo →'),
      ),
    )));
}

function mountLoading() {
  // ONE loading screen (per Isaac): if the static HTML boot splash (RIDD ·
  // Service Above All) is still on screen, leave it alone — replacing it
  // with a different "Loading…" spinner read as two loading screens. When
  // the splash is already gone (mid-session re-auth), render the SAME
  // splash markup so the brand screen is the only loader anywhere.
  if (document.getElementById('splashMark')) { _armSplashWatchdog(); return; }
  // Same markup + viewport pin as the static splash in index.html (per Isaac, Oct 18), so a hand-off between
  // the two never moves the wordmark or spinner.
  mount(el('div', { style: { position: 'fixed', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', zIndex: '1' } },
    el('div', { style: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' } },
      el('div', { id: 'splashMark', style: { color: 'var(--text)', lineHeight: '0' } }, (typeof riddmadeWordmark === 'function') ? riddmadeWordmark(220) : 'RIDDMADE'),
      el('span', { class: 'spinner', style: { width: '20px', height: '20px', marginTop: '2px' } }),
      el('div', { id: 'splash-watchdog', style: { position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)' } }))));
  _armSplashWatchdog();
}
// Splash watchdog — if the spinner is still on screen after 12s, offer a
// way out (Retry / Sign out) instead of an infinite brand screen. Sign-out
// matters: a corrupt session is a common cause and reload alone loops.
let _splashWatchTimer = null;
function _armSplashWatchdog() {
  clearTimeout(_splashWatchTimer);
  _splashWatchTimer = setTimeout(() => {
    let host = document.getElementById('splash-watchdog');
    if (!host || !host.isConnected) {
      const mark = document.getElementById('splashMark');
      if (!mark) return;   // splash already gone — booted fine
      // Hangs below the spinner without taking layout space, so the wordmark never shifts up when it appears.
      host = el('div', { id: 'splash-watchdog', class: 'flex flex-col items-center', style: { position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' } });
      (mark.parentElement || mark).append(host);
    }
    host.append(
      el('div', { class: 'flex flex-col items-center', style: { gap: '10px', marginTop: '18px' } },
        el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, 'Taking longer than usual\u2026'),
        el('div', { class: 'flex items-center', style: { gap: '10px' } },
          el('button', {
            class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold',
            style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: () => location.reload(),
          }, 'Retry'),
          el('button', {
            class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold',
            style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
            onclick: async () => { try { await supabase.auth.signOut(); } catch (e) { /* best effort */ } location.reload(); },
          }, 'Sign out'))));
  }, 12000);
}

// ── NEW-VERSION BANNER ───────────────────────────────────────────────────
// Installed PWAs never reload on their own — reps resume the same page for
// DAYS, running whatever bundle was live when they last opened it. Poll
// version.json (on boot, every 2 min, and whenever the app comes back to
// the foreground); when a newer deploy is live, pin a banner across the
// top — "New version is available, refresh here" — with a Refresh button.
// Nothing reloads by itself (per Isaac): the user picks the moment.
(() => {
  const _myBundle = (() => {
    try {
      const tag = document.querySelector('script[src*=".immutable.js"]');
      return tag ? String(tag.getAttribute('src')).split('/').pop() : null;
    } catch { return null; }
  })();
  if (!_myBundle) return;   // sandbox / plain app.js — no version to watch
  let _shownFor = '';
  const showBanner = (hash) => {
    if (_shownFor === hash || document.getElementById('newVersionBanner')) return;
    // Login screen (per Isaac): no banner. Signing in always boots from a
    // clean load, so the sign-in itself becomes the refresh — remember the
    // hash so that reload is stamped like a banner refresh would be.
    if (!state.profile) { window.__riddNewVersion = hash; try { sessionStorage.setItem('ridd_reloaded_for', hash); } catch { /* private */ } return; }
    // Mobile mis-tap audit (Sep 29): the banner pushes the whole page down
    // ~40px. Appearing mid-scroll or mid-tap moved the row under a rep's
    // thumb, so the tap landed on the element above. Wait for a quiet
    // moment (no touch / scroll / key for 1.5s), like background repaints.
    if (Date.now() - _lastUserActivity < 1500) { setTimeout(() => showBanner(hash), 1000); return; }
    _shownFor = hash;
    const bar = el('div', {
      id: 'newVersionBanner',
      role: 'status',
      style: { position: 'fixed', top: '0', left: '0', right: '0', zIndex: '10000',
               background: 'var(--accent)', color: 'var(--accent-text, #fff)',
               display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap',
               padding: 'calc(8px + env(safe-area-inset-top, 0px)) 16px 8px', font: '600 13px/1.3 Archivo, Arial, sans-serif',
               boxShadow: '0 6px 20px -8px rgba(0,0,0,.35)' },
    },
      el('span', {}, 'New version is available, refresh here'),
      el('button', {
        style: { background: '#fff', color: 'var(--accent)', border: 0, borderRadius: '999px', padding: '5px 14px', font: '700 12px/1.2 Archivo, Arial, sans-serif', letterSpacing: '.04em', textTransform: 'uppercase', cursor: 'pointer' },
        onclick: () => { try { sessionStorage.setItem('ridd_reloaded_for', hash); } catch { /* private */ } location.reload(); },
      }, 'Refresh'),
    );
    document.body.append(bar);
    // Push the fixed page header down so the banner never covers the title.
    // (CSS in index.html reads --nv-banner: body.has-nv-banner shifts the
    // fixed header, the Indicators bar and main down by that much, and it
    // survives every re-render because it's a class, not inline styles.)
    const fix = () => { document.documentElement.style.setProperty('--nv-banner', bar.getBoundingClientRect().height + 'px'); };
    document.body.classList.add('has-nv-banner');
    fix(); window.addEventListener('resize', fix);
  };
  // Auto-reload on resume (per Isaac, Sep 23): installed apps drifted weeks
  // behind because the banner waits for a tap nobody makes. When the app
  // comes back to the foreground after ≥ 30 min away and a newer build is
  // live, reload right then — the one moment nobody is mid-anything. Under
  // 30 min, or while someone is working, it stays the banner. Guardrails:
  // no open modal, no typed-in field, and at most once per new version.
  const RESUME_RELOAD_MS = 30 * 60 * 1000;
  let _hiddenAt = 0, _resumeCheck = false;
  const _busy = () => {
    try {
      if (document.querySelector('.modal-overlay')) return true;
      const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox') return true;
      return [...document.querySelectorAll('input[type="text"], input[type="number"], input[type="search"], textarea')].some(i => i.value && i.value.trim() && !i.readOnly && !i.disabled && i.type !== 'search');
    } catch { return false; }
  };
  const check = async () => {
    const resumed = _resumeCheck; _resumeCheck = false;
    try {
      const r = await fetch('/version.json', { cache: 'no-store' });
      if (!r.ok) return;
      const v = await r.json();
      if (!v || !v.hash || v.hash === _myBundle) return;
      if (resumed && state.profile && !state._tvOpen && !_busy()) {
        let done = null; try { done = sessionStorage.getItem('ridd_auto_reloaded_for'); } catch { /* private */ }
        if (done !== v.hash) {
          try { sessionStorage.setItem('ridd_auto_reloaded_for', v.hash); sessionStorage.setItem('ridd_reloaded_for', v.hash); } catch { /* private */ }
          console.log('[version] newer build live after a long background — reloading');
          location.reload(); return;
        }
      }
      // Every screen gets new builds (per Isaac, Oct 16 — Pere's TV display was still on an old build): a session
      // nobody has touched for 10 minutes (a dashboard left up on a TV, a desk tab) reloads itself onto the new
      // build — once per build, never with a modal open or something typed in.
      if (state.profile && Date.now() - _lastUserActivity >= 10 * 60 * 1000 && !_busy()) {
        let done = null; try { done = sessionStorage.getItem('ridd_auto_reloaded_for'); } catch { /* private */ }
        if (done !== v.hash) {
          try { sessionStorage.setItem('ridd_auto_reloaded_for', v.hash); sessionStorage.setItem('ridd_reloaded_for', v.hash); if (state._tvOpen) { localStorage.setItem('ridd_tv_board', '1'); sessionStorage.setItem('ridd_reopen_tv', '1'); } } catch { /* private */ }
          console.log('[version] newer build live and this screen is idle — reloading');
          location.reload(); return;
        }
      }
      // The TV board is an unattended screen (per Isaac, Sep 18): nobody is
      // there to press Refresh, and the board's overlay hides the banner
      // anyway. Reload straight away and come back up on the board.
      // …but a reload drops element-fullscreen (browsers need a real key
      // press to re-enter it), so a daytime deploy used to knock the wall
      // screen out of fullscreen every time (per Isaac, Sep 21). The board
      // now takes new builds overnight (1–5am on the board's clock) or when
      // someone presses R on it; data keeps refreshing every 30s regardless.
      // (Per Isaac, Sep 23: take the build NOW — the wall screen must never
      // sit on stale code, and it comes straight back up on the board. Use
      // the browser's own full screen (⌃⌘F / F11) rather than the board's F
      // key so the reload keeps it; element fullscreen can't survive one.)
      if (state._tvOpen) {
        try { localStorage.setItem('ridd_tv_board', '1'); sessionStorage.setItem('ridd_reopen_tv', '1'); sessionStorage.setItem('ridd_reloaded_for', v.hash); } catch { /* private */ }
        location.reload(); return;
      }
      showBanner(v.hash);
    } catch { /* offline — next cycle */ }
  };
  setTimeout(check, 4000);
  setInterval(check, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { _hiddenAt = Date.now(); return; }
    _resumeCheck = _hiddenAt > 0 && Date.now() - _hiddenAt >= RESUME_RELOAD_MS;
    setTimeout(check, 800);
  });
})();

// ── RESUME RESYNC ────────────────────────────────────────────────────────
// Everything except sales realtime loads ONCE at boot. Desktop users reload
// all day so they never notice; a phone resumes the same page for days and
// keeps showing the calendar / scorecards / settings / sales as they were
// when it was last opened (Isaac: "mobile isn't syncing"). Re-pull the
// cloud stores whenever the app comes back to the foreground (at most once
// a minute) and every 5 minutes while it stays visible, then remount when
// the user isn't mid-modal or typing.
let _resyncAt = 0, _resyncBusy = false;
async function resyncFromCloud(reason) {
  if ((typeof DEMO !== 'undefined' && DEMO) || typeof supabase === 'undefined' || !supabase || !state.profile) return;
  if (_resyncBusy || Date.now() - _resyncAt < 60 * 1000) return;
  _resyncBusy = true; _resyncAt = Date.now();
  const jobs = [];
  const safe = (fn) => { try { const p = fn(); if (p && p.catch) jobs.push(p.catch(() => {})); } catch (e) { /* skip */ } };
  safe(() => refreshSalesData());
  safe(() => refreshProfilesData());
  safe(() => refreshCompetitionsData());
  safe(() => loadIndicatorConfigFromSupabase());
  safe(() => loadAppSettings());
  safe(() => loadCommissionConfig());
  safe(() => loadCompanyGoal());
  safe(() => loadDeptGoals());
  // Calendar: only when nothing local is waiting to push (a pending
  // debounced edit would otherwise be clobbered by the server copy).
  if (typeof _calFp === 'function' && _calFp() === _calCloudFp) safe(() => loadCalendarFromCloud());
  // Reporting snapshot (provenance audit): the snapshot was loaded once per
  // session and never refreshed, so Overview / Daily Pulse / Retention could
  // sit on the morning's data all day. If a newer upload exists and the user
  // is on "latest" (not pinned to an older snapshot), advance and prefetch.
  // select('*'): the row MUST carry storage_path — a copy without it made the
  // loader take the legacy DB-rows path (0 rows) and then "migrate" that empty
  // load over the real snapshot file (Sep 21, 18:31 — Reporting went blank).
  safe(() => supabase.from('reporting_uploads').select('*').order('uploaded_at', { ascending: false }).limit(1).then(({ data }) => {
    const newest = data && data[0]; if (!newest) return;
    const onLatest = !state.reportingActiveUploadId || state.reportingActiveUploadId === state._reportingLatestId;
    if (newest.id !== state._reportingLatestId) {
      state.reportingUploads = [newest, ...(state.reportingUploads || []).filter(u => u.id !== newest.id)];
      state._reportingLatestId = newest.id;
      if (onLatest) {
        state.reportingActiveUploadId = newest.id;
        state._reportingPrefetching = false;
        if (typeof prefetchReportingSnapshot === 'function') prefetchReportingSnapshot();
      }
    }
  }));
  // Scorecards: drop the per-period cache so the next render refetches.
  state._scorecardCloudFor = null;
  if (typeof loadScorecardMeetingsCloud === 'function') safe(() => loadScorecardMeetingsCloud(true));
  try { await Promise.all(jobs); } catch (e) { /* individual jobs already swallowed */ }
  _resyncBusy = false;
  const busyTyping = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (busyTyping || document.querySelector('.modal-overlay')) return;
  scheduleBackgroundRemount();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => resyncFromCloud('resume'), 300); });
window.addEventListener('online', () => setTimeout(() => resyncFromCloud('online'), 300));
setInterval(() => { if (document.visibilityState === 'visible') resyncFromCloud('interval'); }, 5 * 60 * 1000);

