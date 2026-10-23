// ── CLIENT ERROR TELEMETRY ───────────────────────────────────────────────
// Uncaught errors + promise rejections post to /api/client-error (→ admin
// Slack when SLACK_ADMIN_WEBHOOK is set, Netlify logs always). Deduped per
// message, max 5 per session — a crash loop can't spam anything.
const _errSent = new Set();
function _reportClientError(message, stack) {
  try { if (typeof track === 'function') track('error', String(message || '').slice(0, 160), state.view || null, null, { stack: String(stack || '').slice(0, 400) }); } catch (e) { /* noop */ }
  try {
    if (typeof DEMO !== 'undefined' && DEMO) return;
    const key = String(message || '').slice(0, 120);
    if (!key || _errSent.has(key) || _errSent.size >= 5) return;
    _errSent.add(key);
    const tag = document.querySelector('script[src*=".immutable.js"]');
    fetch('/api/client-error', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: key,
        stack: String(stack || '').slice(0, 800),
        view: (typeof state !== 'undefined' && state.view) || '',
        role: (typeof state !== 'undefined' && state.profile && state.profile?.role) || '',
        bundle: tag ? String(tag.getAttribute('src')).split('/').pop() : 'dev',
        ua: navigator.userAgent,
      }),
    }).catch(() => { /* fire and forget */ });
  } catch { /* never let telemetry throw */ }
}
// ── Opt-in render profiler (AUDIT P1-1) ──────────────────────────────────
// localStorage.ridd_prof = '1' turns it on; each mountApp then records the
// view, total ms and per-phase ms into window.__riddProf (last 40 renders)
// so the slow phases can be read off a real login instead of guessed.
const _profOn = (() => { try { return localStorage.getItem('ridd_prof') === '1'; } catch (e) { return false; } })();
let _profCur = null;
function _profStart(view) { if (!_profOn) return; _profCur = { view, t0: performance.now(), last: performance.now(), phases: [] }; }
function _profMark(label) { if (!_profOn || !_profCur) return; const now = performance.now(); _profCur.phases.push([label, Math.round(now - _profCur.last)]); _profCur.last = now; }
function _profEnd() {
  if (!_profOn || !_profCur) return;
  _profMark('render-tail');
  const rec = { view: _profCur.view, ms: Math.round(performance.now() - _profCur.t0), phases: _profCur.phases, at: new Date().toISOString() };
  (window.__riddProf = window.__riddProf || []).push(rec); if (window.__riddProf.length > 40) window.__riddProf.shift();
  console.log('[ridd][prof] ' + rec.view + ' ' + rec.ms + 'ms ' + rec.phases.map(p => p[0] + ':' + p[1]).join(' '));
  _profCur = null;
}
// ── Usage analytics (Sep 2026) ────────────────────────────────────────────
// What people actually do: page views (time on page + render ms), key
// actions, errors, modal open/complete/dismiss pairs and searches. Batched
// and sent with keepalive fetch straight to public.app_events (own rows
// only); Admin → Usage reads the usage_summary() RPC. Never throws, never
// blocks a render, drops everything in DEMO or when signed out.
const _trk = { q: [], sid: null, timer: null, view: null, viewAt: 0, viewSub: null, off: false };
function _trkSession() {
  if (!_trk.sid) { try { _trk.sid = sessionStorage.getItem('ridd_sid'); } catch (e) { /* noop */ } }
  if (!_trk.sid) { _trk.sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { sessionStorage.setItem('ridd_sid', _trk.sid); } catch (e) { /* noop */ } }
  return _trk.sid;
}
function _trkDevice() { try { return window.matchMedia('(max-width: 640px)').matches ? 'phone' : 'desktop'; } catch (e) { return 'desktop'; } }
function track(event, name, sub, durMs, props) {
  try {
    if (_trk.off || (typeof DEMO !== 'undefined' && DEMO) || !state.profile || !state.session) return;
    _trk.q.push({ user_id: state.profile.id, role: String(state.profile.role || ''), session_id: _trkSession(), device: _trkDevice(),
      event, name: name == null ? null : String(name).slice(0, 160), sub: sub == null ? null : String(sub).slice(0, 80),
      dur_ms: durMs == null ? null : Math.max(0, Math.round(durMs)), props: props || null, at: new Date().toISOString() });
    if (_trk.q.length >= 25) _trkFlush(); else if (!_trk.timer) _trk.timer = setTimeout(_trkFlush, 8000);
  } catch (e) { /* analytics never break the app */ }
}
// Convenience: an action, stamped with how long since the current view opened
// (time-to-complete for the workflow that lives on that view).
function trackAction(name, sub, props) {
  const since = _trk.viewAt ? Math.round(performance.now() - _trk.viewAt) : null;
  track('action', name, sub, null, Object.assign({}, props || {}, since != null ? { since_view_ms: since, view: _trk.view } : {}));
}
// Modal pairs: open → done | dismiss (abandonment = opened − done).
function trackModal(name, phase, openedAt) { track('modal', name, phase, openedAt ? performance.now() - openedAt : null); }
function _trkFlush() {
  if (_trk.timer) { clearTimeout(_trk.timer); _trk.timer = null; }
  const batch = _trk.q.splice(0, 100); if (!batch.length) return;
  try {
    const tok = state.session && state.session.access_token; if (!tok || !CFG || !CFG.SUPABASE_URL) return;
    fetch(CFG.SUPABASE_URL + '/rest/v1/app_events', { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json', apikey: CFG.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + tok, Prefer: 'return=minimal' },
      body: JSON.stringify(batch) }).then(r => { if (r.status === 404 || r.status === 401) _trk.off = true; }).catch(() => {});   // table missing → stop trying this session
  } catch (e) { /* noop */ }
}
// View change: close the previous view (time on page) and open the new one.
function _trkView(view, sub, renderMs) {
  const now = performance.now();
  if (_trk.view && (_trk.view !== view || _trk.viewSub !== sub)) track('view', _trk.view, _trk.viewSub, now - _trk.viewAt, { render_ms: _trk.renderMs || 0, closed: true });
  if (_trk.view !== view || _trk.viewSub !== sub) { _trk.view = view; _trk.viewSub = sub; _trk.viewAt = now; _trk.renderMs = renderMs; track('view', view, sub, null, { render_ms: renderMs, opened: true }); }
}
try {
  window.addEventListener('pagehide', () => { try { if (_trk.view) track('view', _trk.view, _trk.viewSub, performance.now() - _trk.viewAt, { render_ms: _trk.renderMs || 0, closed: true }); _trkFlush(); } catch (e) { /* noop */ } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _trkFlush(); });
} catch (e) { /* noop */ }

