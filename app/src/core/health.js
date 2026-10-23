// ── Source health (P1-7 in AUDIT.md) ─────────────────────────────────────
// Every loader reports ok / error per SOURCE instead of console.warn being
// the terminal state. The header's "Last sync" pill reads the worst of them
// and the status sheet lists each one with when it last worked.
const HEALTH_SOURCES = {
  ops: 'Operations stats (FieldRoutes)',
  indicators: 'Sales dataset (FieldRoutes via RevHawk)',
  reporting:  'Reporting snapshot',
  techstats:  'Technician route stats',
  qbo:        'QuickBooks spend (Windsor)',
  pay:        'Pay settings',
  commission: 'Commission config',
  calendar:   'Calendar cloud save',
  rosters:    'Competition rosters',
  settings:   'Reporting configuration',
};
function healthReport(source, ok, msg) {
  const h = state._health || (state._health = {});
  const cur = h[source] || {};
  h[source] = ok
    ? { ok: true, at: Date.now(), okAt: Date.now(), msg: '' }
    : { ok: false, at: Date.now(), okAt: cur.okAt || null, msg: String(msg && msg.message || msg || 'failed').slice(0, 200) };
  if (!ok) console.warn('[ridd][health] ' + source + ': ' + h[source].msg);
}
// Worst recent problem across sources (errors older than 3h age out).
function healthWorst() {
  const h = state._health || {};
  const bad = Object.entries(h).filter(([, v]) => v && !v.ok && (Date.now() - v.at) < 3 * 3600000);
  return bad.length ? bad.map(([k, v]) => ({ source: k, label: HEALTH_SOURCES[k] || k, ...v })) : [];
}
function openHealthSheet() {
  if (typeof trackAction === 'function') trackAction('health_sheet', 'open');
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const fmtT = (t) => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '\u2014';
  const rows = Object.keys(HEALTH_SOURCES).map(k => {
    const v = (state._health || {})[k];
    const st = !v ? 'not loaded yet' : v.ok ? 'ok' : 'error';
    const color = st === 'ok' ? '#5F6C5B' : st === 'error' ? '#DC2626' : 'var(--text-subtle)';
    return el('div', { class: 'flex items-start justify-between gap-3 px-3 py-2 text-xs', style: { borderTop: '1px solid var(--border)' } },
      el('div', { class: 'min-w-0' }, el('div', { class: 'font-semibold' }, HEALTH_SOURCES[k]),
        el('div', { class: 'text-[10px] text-muted-' }, st === 'error' ? ('Failed ' + fmtT(v.at) + (v.okAt ? ' \u00b7 last worked ' + fmtT(v.okAt) : '') + ' \u00b7 ' + v.msg) : st === 'ok' ? 'Last loaded ' + fmtT(v.at) : 'Loads when its tab opens')),
      el('span', { class: 'text-[10px] font-bold uppercase tracking-wider shrink-0', style: { color } }, st));
  });
  // Server side (admins): the sync worker's own heartbeat + newest reporting
  // snapshot from /api/sync-status — "the job ran at 3:00 and finished ok
  // in 41 s" instead of only what this browser managed to load.
  const serverRow = isAdminRole(state.profile?.role) ? el('div', { class: 'px-3 py-2 text-xs', style: { borderTop: '1px solid var(--border)' } },
    el('div', { class: 'font-semibold' }, 'Sync worker (server)'),
    el('div', { class: 'text-[10px] text-muted-' }, 'Checking\u2026')) : null;
  if (serverRow) {
    fetch('/api/sync-status', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const lr = j.lastRun || {}, snap = (j.recentSnapshots || [])[0];
      const ok = lr.ok === true || lr.stage === 'finished';
      const bits = [];
      if (lr.at) bits.push((lr.stage === 'failed' ? 'Failed ' : lr.stage === 'finished' ? 'Finished ' : (lr.stage ? 'Running \u00b7 ' + lr.stage + ' \u00b7 ' : '')) + fmtT(lr.at) + (lr.ms ? ' in ' + Math.round(lr.ms / 1000) + ' s' : ''));
      if (lr.error) bits.push(lr.error);
      if (snap && snap.uploaded_at) bits.push('Newest snapshot ' + fmtT(snap.uploaded_at) + (snap.rows ? ' \u00b7 ' + Number(snap.rows).toLocaleString() + ' rows' : ''));
      if (j.minutesSinceLastSnapshot != null) bits.push(j.minutesSinceLastSnapshot + ' min ago');
      if (lr.dataAsOf) bits.unshift('CRM data as of ' + fmtT(lr.dataAsOf));
      serverRow.replaceChildren(
        el('div', { class: 'flex items-start justify-between gap-3' },
          el('div', { class: 'min-w-0' }, el('div', { class: 'font-semibold' }, 'Sync worker (server)'), el('div', { class: 'text-[10px] text-muted-', style: { overflowWrap: 'anywhere' } }, bits.join(' \u00b7 ') || 'No heartbeat yet')),
          el('span', { class: 'text-[10px] font-bold uppercase tracking-wider shrink-0', style: { color: lr.stage === 'failed' ? '#DC2626' : ok ? '#5F6C5B' : 'var(--text-subtle)' } }, lr.stage === 'failed' ? 'error' : ok ? 'ok' : (lr.stage || 'unknown'))));
    }).catch(() => { serverRow.lastChild.textContent = 'Could not reach /api/sync-status'; });
  }
  overlay.append(el('div', { class: 'card p-0 flex flex-col', style: { width: 'min(520px, 94vw)', maxHeight: '80vh', overflow: 'auto' } },
    el('div', { class: 'px-4 py-3 flex items-center justify-between gap-3' },
      el('div', {}, el('div', { class: 'text-sm font-bold', title: SYNC_CADENCE_TEXT }, 'Data sources'), el('div', { class: 'text-[10px] text-muted-' }, (typeof appSyncStampStr === 'function' ? 'Last sync ' + appSyncStampStr() : ''))),
      el('div', { class: 'flex items-center gap-2' },
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => { overlay.remove(); try { refreshIndicatorsFromCloud(true); toast('Refreshing\u2026', 'success'); } catch (e) { /* poll retries */ } } }, '\u21bb Refresh'),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '\u00d7'))),
    serverRow,
    ...rows));
  document.body.append(overlay);
}
window.addEventListener('error', (e) => _reportClientError(e.message, e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason || {};
  _reportClientError(r.message || String(e.reason), r.stack);
});

// ── DESKTOP ZOOM/PAN LOCK — the app is an app, not a document ───────────
// Mobile pinch-zoom is already off (viewport meta + touch-action). Desktop
// still zoomed via trackpad pinch (delivered as ctrl+wheel), Safari gesture
// events, and Cmd/Ctrl +/−/0. All blocked here — EXCEPT inside a Leaflet
// map, where pinch/scroll zoom is the whole point.
(() => {
  const inMap = (t) => !!(t && t.closest && t.closest('.leaflet-container'));
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey && !inMap(e.target)) e.preventDefault();   // trackpad pinch / ctrl+scroll zoom
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t =>
    window.addEventListener(t, (e) => { if (!inMap(e.target)) e.preventDefault(); }, { passive: false }));
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (['+', '-', '=', '_', '0'].includes(e.key)) e.preventDefault();  // keyboard browser zoom
  });
})();

function mountError(err) {
  _reportClientError('mountError: ' + (err && err.message || err), err && err.stack);
  const msg = String((err && err.message) || err || 'Unknown error');
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
  const isAuth = /jwt|session|token|not signed in|401/i.test(msg);
  const isNet  = offline || /failed to fetch|networkerror|network request|timed? ?out|load failed/i.test(msg);
  const headline = isNet ? 'Can\u2019t reach the server' : isAuth ? 'Session needs a refresh' : 'Something went wrong';
  const friendly = isNet
    ? (offline ? 'You\u2019re offline \u2014 reconnect and tap Try again.' : 'The connection dropped or the server didn\u2019t answer. Your data is safe \u2014 try again in a moment.')
    : isAuth ? 'Your sign-in expired or got out of sync. Sign in again and you\u2019ll land right back in the app.'
    : 'An unexpected error stopped the app from loading.';
  mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6' },
    el('div', { class: 'card p-6 max-w-lg' },
      el('h1', { class: 'text-lg font-semibold mb-2', style: { color: (isNet || isAuth) ? 'var(--text)' : '#f87171' } }, headline),
      el('div', { class: 'text-sm mb-3', style: { color: 'var(--text-muted)' } }, friendly),
      el('details', { class: 'mb-1' },
        el('summary', { class: 'text-[11px] cursor-pointer', style: { color: 'var(--text-subtle)' } }, 'Technical details'),
        el('pre', { class: 'text-xs whitespace-pre-wrap mt-1', style: { color: 'var(--text-subtle)' } }, msg)),
      el('div', { class: 'flex items-center gap-2 mt-3' },
        el('button', {
          class: 'px-2.5 py-1 rounded-lg font-semibold text-[11px]', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => location.reload(),
        }, isNet ? 'Try again' : 'Reload'),
        isAuth && el('button', {
          class: 'px-2.5 py-1 rounded-lg border font-semibold text-[11px]',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: async () => { try { await supabase.auth.signOut(); } catch (e) { /* best effort */ } location.reload(); },
        }, 'Sign in again')))));
}

// ──────────────────────────────────────────────────────────────────────────
