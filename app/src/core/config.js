// ┌─ src/10-core.js ─────────────────────────────────────────────────────
// │ Config, state, el() builder, roles & permissions, auth/session, data loading, formatting helpers.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────

// RIDD Sales Platform — single-file-app controller
// ──────────────────────────────────────────────────────────────────────────
// Module imports via CDN (no bundler, no install)
// VENDORED (Jul 30 2026): supabase-js is bundled INTO the repo. The old
// esm.sh CDN import took the whole app down whenever esm.sh stuttered —
// a hung import = module never evaluates = splash screen forever. Built
// with: esbuild @supabase/supabase-js@2.45.4 --bundle --format=esm --minify.
import { createClient } from './vendor-supabase.js';

const CFG = window.RIDD_CONFIG;
// Feature switches (generalization, Sep 22 2026): RIDD_CONFIG.FEATURES lists
// the RIDD-specific programs a deployment runs — 'pay' (commission calculator
// + pay runs), 'competitions', 'hall_of_fame', 'scorecards', 'calendar',
// 'pricing'. Unset = everything on (RIDD). A switched-off feature drops out of
// the nav and sub-tab bars; nothing else about it changes.
const RIDD_FEATURE_KEYS = ['pay', 'competitions', 'hall_of_fame', 'scorecards', 'calendar', 'pricing'];
function featureOn(key) {
  const f = CFG && CFG.FEATURES;
  if (f == null) return true;
  if (Array.isArray(f)) return f.includes(key);
  return f[key] !== false;
}
// Sub-tab / view keys → the feature that owns them.
const VIEW_FEATURE = { pay: 'pay', commission: 'pay', hall_of_fame: 'hall_of_fame', d2d_hof: 'hall_of_fame', tech_hof: 'hall_of_fame', scorecards: 'scorecards', calendar: 'calendar', nrla: 'competitions', competitions: 'competitions' };
function viewFeatureOn(viewKey) { const f = VIEW_FEATURE[viewKey]; return !f || featureOn(f); }
const hasConfig = CFG.SUPABASE_PUBLISHABLE_KEY && !CFG.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
const DEMO = new URLSearchParams(location.search).has('demo') || location.hash === '#demo';
// Render timing (per Isaac, Oct 16 — "make Marketing load faster"): add ?perf to the URL (or set localStorage
// riddPerf = 1) and the slow sections log to the console; window.__riddPerf keeps the running totals.
const PERF_ON = (() => { try { return /[?&]perf\b/.test(location.search) || localStorage.getItem('riddPerf') === '1'; } catch (e) { return false; } })();
function perfT(label, fn) {
  if (!PERF_ON) return fn();
  const t = performance.now();
  try { return fn(); } finally {
    const ms = performance.now() - t, P = window.__riddPerf || (window.__riddPerf = {}), o = P[label] || (P[label] = { n: 0, ms: 0, max: 0 });
    o.n++; o.ms += ms; o.max = Math.max(o.max, ms); if (ms > 100) console.info('[perf] ' + label + ' ' + Math.round(ms) + 'ms');
  }
}
// Off-render memo (per Isaac, Oct 16 — the Marketing tab froze for 10+ seconds at a time): a heavy list (Needs
// attention, Auditing tasks) is never built inside a render. The render gets the last result (null the first time —
// show "checking…"); when the data behind it changed, one rebuild is scheduled shortly after, at most once every
// minGapMs, and the page re-renders when it's done. While the app is loading, the burst of data arrivals collapses
// into one rebuild instead of one per arrival.
function deferredMemo(key, depsFn, fn, opts) {
  const o = opts || {}, delay = o.delay != null ? o.delay : 1200, minGap = o.minGapMs != null ? o.minGapMs : 30000, ttl = o.ttlMs != null ? o.ttlMs : 120000;
  const C = deferredMemo._c || (deferredMemo._c = new Map());
  let e = C.get(key); if (!e) { e = { has: false, v: null, deps: null, at: 0, timer: null }; C.set(key, e); }
  const deps = depsFn();
  const same = e.has && e.deps.length === deps.length && e.deps.every((d, i) => d === deps[i]) && Date.now() - e.at < ttl;
  if (!same && !e.timer) {
    const wait = Math.max(delay, e.has ? minGap - (Date.now() - e.at) : 0);
    e.timer = setTimeout(() => {
      e.timer = null;
      try { e.v = fn(); e.has = true; } catch (err) { console.warn('[deferred] ' + key, err); if (!e.has) { e.v = []; e.has = true; } }
      e.deps = depsFn(); e.at = Date.now();
      try { mountApp(); } catch (err) { /* not mounted yet */ }
    }, wait);
  }
  return e.has ? e.v : null;
}
// Memo keyed on the identity of the data a computation reads, with a time ceiling for anything not in the key.
// Used for the heavy task lists (Needs attention, Auditing tasks) that every render was rebuilding from scratch.
function refMemo(key, deps, ttlMs, fn) {
  const C = refMemo._c || (refMemo._c = new Map());
  const hit = C.get(key);
  if (hit && Date.now() - hit.at < ttlMs && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.v;
  const v = fn();
  C.set(key, { at: Date.now(), deps, v });
  return v;
}
