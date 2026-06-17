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
  try { const { getStore } = await import('@netlify/blobs'); return getStore('qbo'); } catch { return null; }
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

exports.handler = async (event) => {
  const needed = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REALM_ID'];
  const missing = needed.filter(k => !process.env[k]);
  if (missing.length) return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars: ' + missing.join(', ') + ' (see qbo-spend.js setup notes)' }) };

  const env = process.env.QBO_ENV === 'sandbox' ? 'sandbox' : 'production';
  const store = await blobStore();
  try {
    const refreshToken = await getRefreshToken(store);
    if (!refreshToken) return { statusCode: 500, body: JSON.stringify({ error: 'No QBO_REFRESH_TOKEN set' }) };
    const { accessToken, newRefresh } = await refreshAccessToken(refreshToken);
    if (newRefresh && newRefresh !== refreshToken) await saveRefreshToken(store, newRefresh);

    // Date range: this year + last year so the YoY chart has both. Override via ?year=YYYY.
    const q = (event && event.queryStringParameters) || {};
    const now = new Date();
    const startYear = q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : now.getFullYear() - 1;
    const start = `${startYear}-01-01`;
    const end = now.toISOString().slice(0, 10);
    const url = `${apiBase(env)}/v3/company/${process.env.QBO_REALM_ID}/reports/ProfitAndLoss`
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
