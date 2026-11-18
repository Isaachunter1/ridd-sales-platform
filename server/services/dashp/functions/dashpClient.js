// ┌─ dashpClient ────────────────────────────────────────────────────────────
// │ Read-only client for the DASHP commission API (the separate platform that
// │ computes technician and d2d commissions). This server is a PASS-THROUGH:
// │ it adds the API key, forwards an allowlisted GET, and hands back DASHP's
// │ own status and JSON envelope untouched ({ ok, data } / { ok:false, error,
// │ message }). Nothing is recalculated or reshaped here.
// │
// │ Why a small cache: DASHP allows 60 requests a minute, shared by every
// │ caller, and its numbers only change when commissions are recalculated
// │ (hourly). Successful answers are kept in memory for a few minutes so a
// │ screen that re-renders does not spend the allowance. It is best-effort —
// │ a cold start just means the next request goes upstream.
// │
// │ No imports from config/ on purpose: everything arrives as arguments, so
// │ this is fixture-tested with a fake fetch (server/test/dashp-client.test.js).
// └────────────────────────────────────────────────────────────────────────

// The only upstream paths this server will call.
export const ROUTES = new Set([
  'company-summary',
  'd2d-commissions',
  'd2d-commission',
  'technician-commissions',
  'technician-commission',
]);

// The only query parameters forwarded. DASHP validates the values itself and
// answers 400 with a message naming the parameter; that answer is passed on.
export const PARAMS = ['year', 'quarter', 'employee_id', 'type', 'compare_type'];

// route + query → the upstream URL, or null for a route that is not allowed.
// baseUrl may carry a path (a Cloud Function URL does), so the route is
// resolved relative to it rather than to the host root.
export function upstreamUrl(baseUrl, route, query = {}) {
  if (!ROUTES.has(route)) return null;
  const u = new URL(route, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  for (const k of PARAMS) {
    const v = query[k];
    if (typeof v === 'string' && v !== '' && v.length <= 50) u.searchParams.set(k, v);
  }
  return u;
}

const fail = (status, error, message) => ({ status, body: { ok: false, error, message }, retryAfter: null, cache: 'none' });

export function createDashpClient({ baseUrl, token, fetchImpl = fetch, ttlMs = 5 * 60000, maxEntries = 300, timeoutMs = 15000, now = Date.now } = {}) {
  const configured = !!baseUrl && !!token;
  const cache = new Map();   // upstream URL → { at, body }

  async function call(url, headers) {
    const res = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON — handled by the caller */ }
    return { res, body };
  }

  // One allowlisted read. Always resolves to { status, body, retryAfter, cache }.
  async function get(route, query) {
    if (!configured) return fail(503, 'dashp_not_configured', 'DASHP is not connected yet: set DASHP_API_URL and DASHP_API_TOKEN on the server.');
    const url = upstreamUrl(baseUrl, route, query);
    if (!url) return fail(404, 'unknown_route', 'No such DASHP route: ' + route + '. Valid: ' + [...ROUTES].join(', '));
    const key = url.toString();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return { status: 200, body: hit.body, retryAfter: null, cache: 'hit' };
    let out;
    try { out = await call(key, { 'X-API-Token': token, Accept: 'application/json' }); }
    catch (e) { return fail(502, 'dashp_unreachable', 'DASHP did not answer: ' + String((e && e.message) || e).slice(0, 200)); }
    const { res, body } = out;
    if (!body || typeof body !== 'object') return fail(502, 'dashp_bad_response', 'DASHP answered HTTP ' + res.status + ' without JSON.');
    if (res.status === 200 && body.ok === true) {
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);   // oldest out
      cache.set(key, { at: now(), body });
    }
    return { status: res.status, body, retryAfter: res.headers.get('retry-after'), cache: 'miss' };
  }

  // "Is it wired up?" — DASHP's health check (no key), then one real, keyed
  // read, so a wrong URL and a wrong key are told apart. Never cached.
  //   reachable  = /health answered 200, or the keyed read came back as DASHP's own JSON envelope
  //   authorized = the keyed read is a 200 (so the key is right)
  // /health, not /healthz: DASHP runs on Cloud Run, where Google's front end
  // answers its own 404 for /healthz and the request never reaches the
  // container (the same reason this server uses /health — see index.js).
  async function status() {
    const out = { configured, reachable: false, authorized: false, upstream_status: null, message: '' };
    if (!configured) { out.message = 'Set DASHP_API_URL and DASHP_API_TOKEN on the server.'; return out; }
    try {
      const h = await call(new URL('health', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString(), {});
      const r = await call(upstreamUrl(baseUrl, 'company-summary', {}).toString(), { 'X-API-Token': token, Accept: 'application/json' });
      out.upstream_status = r.res.status;
      const envelope = !!r.body && typeof r.body === 'object' && typeof r.body.ok === 'boolean';
      out.reachable = h.res.status === 200 || envelope;
      out.authorized = envelope && r.res.status === 200;
      out.message = out.authorized ? 'Connected.'
        : out.reachable ? ((r.body && r.body.message) || 'DASHP answered HTTP ' + r.res.status)
        : 'HTTP ' + r.res.status + ' from that URL, but not a DASHP answer — check DASHP_API_URL.';
    } catch (e) { out.message = 'DASHP did not answer: ' + String((e && e.message) || e).slice(0, 200); }
    return out;
  }

  return { configured, get, status };
}