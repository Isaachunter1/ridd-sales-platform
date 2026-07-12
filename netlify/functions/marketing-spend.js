// Marketing spend relay — bridges marketing.html to Windsor.ai server-side.
// The Windsor API key can't live in the static frontend (token-leak), so this
// serverless function holds it and returns DAILY Meta + Google ad spend, which
// marketing.html merges into its embedded snapshot and re-buckets by the
// selected date range.
//
// SETUP
// -----
// 1. Create a Windsor.ai API key (Windsor dashboard → API).
// 2. Add `WINDSOR_API_KEY=...` to Netlify site env vars
//    (Site settings → Environment variables). Never commit it.
// 3. Deploy. Netlify exposes this at /.netlify/functions/marketing-spend;
//    the /api/marketing-spend redirect is already in netlify.toml.
//
// RESPONSE SHAPE (consumed by marketing.html)
// -------------------------------------------
//   { spendDaily: { "2026-06-01": [metaSpend, googleSpend], ... },
//     pulledAt: "<ISO timestamp>" }
//
// NOTE: Verify exact Windsor REST params/field names against your account docs.
// Connector slugs: "facebook" (Meta), "google_ads" (Google Ads).

const WINDSOR_BASE = 'https://connectors.windsor.ai';

// How far back to pull daily spend (days). Adjust as needed.
const LOOKBACK_DAYS = 180;

function ymd(d) { return d.toISOString().slice(0, 10); }

async function windsorDaily(apiKey, connector, from, to) {
  const url = `${WINDSOR_BASE}/${connector}?api_key=${encodeURIComponent(apiKey)}` +
    `&date_from=${from}&date_to=${to}&fields=date,spend&_renderer=json`;
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Windsor ${connector} ${r.status}`);
  const j = await r.json();
  const rows = (j && (j.data || j.result)) || [];
  const out = {};
  for (const row of rows) {
    if (!row.date) continue;
    out[row.date] = (out[row.date] || 0) + (parseFloat(row.spend) || 0);
  }
  return out;
}

exports.handler = async (event) => {
  // ── Auth: admins only (shared gate) — this endpoint serves company
  // financial/operational data and was previously open to the internet. ──
  const { requireRole } = require('../lib/auth-gate.js');
  const gate = await requireRole(event, ['admin', 'admin_rep']);
  if (!gate.ok) return gate.response;
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'WINDSOR_API_KEY env var not set' }) };
  }
  try {
    const to = new Date();
    const from = new Date(to.getTime() - LOOKBACK_DAYS * 86400000);
    const f = ymd(from), t = ymd(to);
    const [meta, google] = await Promise.all([
      windsorDaily(apiKey, 'facebook', f, t),
      windsorDaily(apiKey, 'google_ads', f, t),
    ]);
    const spendDaily = {};
    const days = new Set([...Object.keys(meta), ...Object.keys(google)]);
    for (const d of days) {
      spendDaily[d] = [
        Math.round((meta[d] || 0) * 100) / 100,
        Math.round((google[d] || 0) * 100) / 100,
      ];
    }
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800' },
      body: JSON.stringify({ spendDaily, pulledAt: new Date().toISOString() }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
