// QuickBooks marketing-spend relay — pulls "Advertising & Marketing" expense
// from QuickBooks Online (by branch, by month) so the Marketing tab can show
// LIVE spend straight from the books instead of a static file.
//
// RESPONSE SHAPE (matches the old is-spend.json the app already reads)
// -------------------------------------------------------------------
//   { bySourceMonth: { "2026-06": { "Atlanta Marketing": 26960.08, ... }, ... },
//     total: <number>, pulledAt: "<ISO>" }
//   (the app also accepts the same object under `spend`/top-level ym keys)
//
// SETUP — one-time (QuickBooks uses OAuth2, not a simple API key)
// --------------------------------------------------------------
// 1. Create an app at https://developer.intuit.com (Production keys).
// 2. Run the OAuth2 flow once (Intuit's OAuth Playground works) with scope
//    `com.intuit.quickbooks.accounting` to get a REFRESH TOKEN and your
//    company's REALM ID (a.k.a. companyId).
// 3. In Netlify → Site settings → Environment variables add:
//      QBO_CLIENT_ID      = <app client id>
//      QBO_CLIENT_SECRET  = <app client secret>
//      QBO_REFRESH_TOKEN  = <the refresh token from step 2>
//      QBO_REALM_ID       = <your company / realm id>
//      QBO_ENV            = production           (or "sandbox" for testing)
// 4. Deploy. Exposed at /.netlify/functions/qbo-spend; the /api/qbo-spend
//    redirect is in netlify.toml.
//
// REFRESH-TOKEN ROTATION: QuickBooks rotates the refresh token every time it's
// used. We persist the newest one in Netlify Blobs so the function keeps
// working across calls. If Blobs isn't available it falls back to the env var
// (valid for a 24h grace window per Intuit), so set up Blobs for long-running
// reliability — or just re-paste a fresh QBO_REFRESH_TOKEN periodically.

const OAUTH_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const FETCH_MS = 12000;

function apiBase(env) {
  return env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
}
async function fetchT(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
  try { const r = await fetch(url, { ...opts, signal: ac.signal }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { ok: r.ok, status: r.status, json, text }; }
  finally { clearTimeout(t); }
}

// ── Rotating refresh-token store (Netlify Blobs, optional) ──────────────────
async function blobStore() {
  try { const { getStore } = await import('@netlify/blobs'); return getStore('qbo'); } catch (e) { console.warn('[qbo-spend] blobs init failed:', e && e.message); return null; }
}
async function getRefreshToken(store) {
  if (store) { try { const v = await store.get('refresh_token'); if (v) return v; } catch {} }
  return process.env.QBO_REFRESH_TOKEN || null;
}
async function saveRefreshToken(store, token) {
  if (store && token) { try { await store.set('refresh_token', token); } catch {} }
}

async function refreshAccessToken(refreshToken) {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  const r = await fetchT(OAUTH_URL, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  if (!r.ok || !r.json) throw new Error(`token refresh ${r.status}: ${(r.text || '').slice(0, 160)}`);
  return { accessToken: r.json.access_token, newRefresh: r.json.refresh_token };
}

// Map each report column index → 'YYYY-MM' from its MetaData StartDate.
function monthCols(report) {
  const cols = (report.Columns && report.Columns.Column) || [];
  return cols.map(c => {
    const md = (c.MetaData || []).find(m => m.Name === 'StartDate' || m.Name === 'EndDate');
    const v = md && md.Value;
    return v && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null;
  });
}
// Walk the nested report, collecting any leaf data row whose account name
// contains "Marketing" (the branch accounts: Atlanta Marketing, etc.). Skips
// "Total for ..." summary rows so we don't double-count.
function collectMarketing(rows, monthsByCol, out) {
  for (const row of rows) {
    if (row.Header && row.Rows && row.Rows.Row) collectMarketing(row.Rows.Row, monthsByCol, out);
    const cd = row.ColData;
    if (Array.isArray(cd) && cd.length > 1) {
      const name = String(cd[0].value || '').trim();
      if (name && /marketing|advertis/i.test(name) && !/^total/i.test(name)) {
        for (let j = 1; j < cd.length; j++) {
          const ym = monthsByCol[j]; if (!ym) continue;
          const amt = parseFloat(cd[j].value); if (!amt) continue;
          (out[ym] = out[ym] || {});
          out[ym][name] = (out[ym][name] || 0) + amt;
        }
      }
    }
    if (row.Rows && row.Rows.Row && !row.Header) collectMarketing(row.Rows.Row, monthsByCol, out);
  }
}

// ── Path A: QuickBooks via Windsor.ai (per Isaac — QuickBooks is connected
// to the Windsor account the site already uses, so no Intuit developer app
// is needed). The ledger pull is slow (15-40s), so it runs in
// qbo-spend-refresh-background.js and lands in Netlify Blobs; this handler
// serves the cached copy and kicks a refresh when it's older than 6h (or
// on ?_= force). Same response shape as the direct Intuit path.
const CACHE_MS = 6 * 3600 * 1000;
async function kickRefresh(event) {
  try {
    const h = (event && event.headers) || {};
    const base = process.env.URL || `${h['x-forwarded-proto'] || 'https'}://${h['x-forwarded-host'] || h.host}`;
    // Background functions ack with 202 immediately — no need to await the work.
    await fetch(`${base}/.netlify/functions/qbo-spend-refresh-background`, { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } });
  } catch (e) { console.warn('[qbo-spend] could not kick refresh:', e && e.message); }
}
async function windsorCached(event, force) {
  if (!process.env.WINDSOR_API_KEY) { console.warn('[qbo-spend] WINDSOR_API_KEY not set — skipping Windsor path'); return null; }
  const { kvStore } = require('../lib/kv-store.js');
  const store = kvStore('qbo');
  if (!store) { console.warn('[qbo-spend] cache store unavailable (SUPABASE_SERVICE_ROLE_KEY?) — skipping Windsor path'); return null; }
  let cached = null, refreshing = null, lastErr = null;
  try { cached = await store.get('spend'); } catch (e) { console.warn('[qbo-spend] cache read failed:', e && e.message); }
  try { refreshing = await store.get('spend_refreshing'); } catch {}
  try { lastErr = await store.get('spend_error'); } catch {}
  if (lastErr) console.warn('[qbo-spend] last background refresh error:', JSON.stringify(lastErr));
  const age = cached && cached.pulledAt ? Date.now() - new Date(cached.pulledAt).getTime() : Infinity;
  const inFlight = refreshing && refreshing.at && Date.now() - new Date(refreshing.at).getTime() < 5 * 60 * 1000;
  if ((force || age > CACHE_MS) && !inFlight) await kickRefresh(event);
  if (cached && cached.bySourceMonth) return { ...cached, stale: age > CACHE_MS, refreshing: !!(inFlight || force || age > CACHE_MS) };
  return { pending: true };
}
// ?full=1 → the whole ledger (every account × month) for the Putis Shid tab.
async function ledgerCached() {
  const { kvStore } = require('../lib/kv-store.js');
  const store = kvStore('qbo');
  if (!store) return null;
  try { return await store.get('ledger'); } catch (e) { console.warn('[qbo-spend] ledger read failed:', e && e.message); return null; }
}

exports.handler = async (event) => {
  // ── Auth: admins only (shared gate) — this endpoint serves company
  // financial/operational data and was previously open to the internet. ──
  const { requireRole } = require('../lib/auth-gate.js');
  const gate = await requireRole(event, ['admin', 'admin_rep']);
  if (!gate.ok) return gate.response;
  {
    const q0 = (event && event.queryStringParameters) || {};
    try {
      const w = await windsorCached(event, !!q0._);
      if (q0.full) {
        const L = await ledgerCached();
        if (L && L.months) {
          // Completed jobs per branch per month (FieldRoutes via the RevHawk
          // sync, cached as qbo:jobs) ride along so Putis Shid can price a job.
          let jobs = null;
          try { const { kvStore } = require('../lib/kv-store.js'); const js = kvStore('qbo'); if (js) jobs = await js.get('jobs'); } catch (e) { console.warn('[qbo-spend] jobs read failed:', e && e.message); }
          return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=300' }, body: JSON.stringify({ ...L, jobs: jobs || null, refreshing: !!(w && w.refreshing) }) };
        }
        return { statusCode: 202, headers: { 'content-type': 'application/json', 'retry-after': '20' }, body: JSON.stringify({ pending: true, error: 'QuickBooks ledger is being pulled from Windsor — retry in ~30s' }) };
      }
      if (w && w.bySourceMonth) {
        return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=300' }, body: JSON.stringify(w) };
      }
      if (w && w.pending) {
        // First-ever pull is running in the background — tell the client to
        // retry shortly instead of falling through to the Intuit path.
        return { statusCode: 202, headers: { 'content-type': 'application/json', 'retry-after': '20' }, body: JSON.stringify({ pending: true, error: 'QuickBooks spend is being pulled from Windsor — retry in ~30s' }) };
      }
    } catch (e) { console.warn('[qbo-spend] windsor cache path failed, trying direct Intuit:', e && e.message); }
  }
  const needed = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET'];
  const missing = needed.filter(k => !process.env[k]);
  if (missing.length) return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars: ' + missing.join(', ') + ' (see qbo-spend.js setup notes)' }) };

  const env = process.env.QBO_ENV === 'sandbox' ? 'sandbox' : 'production';
  const store = await blobStore();
  try {
    const refreshToken = await getRefreshToken(store);
    // Realm (company) id: stored by the one-click connect (qbo-callback.js),
    // env var as the manual fallback.
    let realmId = process.env.QBO_REALM_ID || null;
    if (store) { try { const v = await store.get('realm_id'); if (v) realmId = v; } catch {} }
    if (!refreshToken || !realmId) return { statusCode: 409, body: JSON.stringify({ error: 'QuickBooks not connected yet — use Connect QuickBooks on the Marketing tab', notConnected: true }) };
    const { accessToken, newRefresh } = await refreshAccessToken(refreshToken);
    if (newRefresh && newRefresh !== refreshToken) await saveRefreshToken(store, newRefresh);

    // Date range: this year + last year so the YoY chart has both. Override via ?year=YYYY.
    const q = (event && event.queryStringParameters) || {};
    const now = new Date();
    const startYear = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : now.getFullYear() - 1;
    const start = `${startYear}-01-01`;
    const end = now.toISOString().slice(0, 10);
    const url = `${apiBase(env)}/v3/company/${realmId}/reports/ProfitAndLoss`
      + `?start_date=${start}&end_date=${end}&summarize_column_by=Month&accounting_method=Accrual&minorversion=70`;
    const r = await fetchT(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (!r.ok || !r.json) return { statusCode: 502, body: JSON.stringify({ error: `P&L report ${r.status}: ${(r.text || '').slice(0, 200)}` }) };

    const report = r.json;
    const monthsByCol = monthCols(report);
    const bySourceMonth = {};
    collectMarketing((report.Rows && report.Rows.Row) || [], monthsByCol, bySourceMonth);
    let total = 0;
    for (const ym in bySourceMonth) for (const k in bySourceMonth[ym]) total += bySourceMonth[ym][k];

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      body: JSON.stringify({ bySourceMonth, total, pulledAt: new Date().toISOString() }),
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
