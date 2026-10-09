// Ad platform relay (per Isaac, Sep 30) — Facebook / Meta Ads and Google Ads
// through Windsor.ai, MONTHLY by account + campaign, for Marketing → Metrics.
// The Windsor key lives only in Netlify env (WINDSOR_API_KEY — the same key
// the QuickBooks spend feed uses). Admin / admin_rep only.
//
//   GET /api/ad-spend?year=2026
//   → { year, rows: [{ ym, platform, acct, acctName, campaign, type, spend, clicks, impr, leads }],
//       geo: [{ ym, acct, campaign, metro, spend }] (Google only), pulledAt }
//
// leads = Meta "Leads" (actions_lead) · Google "Conversions" — as each
// platform reports them (not GoHighLevel / FieldRoutes).
const WINDSOR = 'https://connectors.windsor.ai';
const PLATFORMS = {
  facebook:   { fields: 'year_month,account_id,account_name,campaign,spend,clicks,impressions,actions_lead', leads: 'actions_lead' },
  google_ads: { fields: 'year_month,account_id,account_name,campaign,campaign_type,spend,clicks,impressions,conversions', leads: 'conversions' },
};

async function pull(key, connector, from, to) {
  const P = PLATFORMS[connector];
  const url = `${WINDSOR}/${connector}?api_key=${encodeURIComponent(key)}&date_from=${from}&date_to=${to}&fields=${P.fields}&_renderer=json`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`Windsor ${connector} ${r.status}`);
    const j = await r.json();
    const rows = (j && (j.data || j.result)) || [];
    const out = [];
    for (const x of rows) {
      const spend = Number(x.spend) || 0, clicks = Number(x.clicks) || 0, impr = Number(x.impressions) || 0, leads = Number(x[P.leads]) || 0;
      if (!spend && !clicks && !leads) continue;
      const [yy, mm] = String(x.year_month || '').split('|');
      if (!yy || !mm) continue;
      out.push({ ym: yy + '-' + String(mm).padStart(2, '0'), platform: connector === 'facebook' ? 'facebook' : 'google',
        acct: String(x.account_id || ''), acctName: String(x.account_name || ''), campaign: String(x.campaign || ''),
        type: String(x.campaign_type || ''), spend: Math.round(spend * 100) / 100, clicks, impr, leads: Math.round(leads * 100) / 100 });
    }
    return out;
  } finally { clearTimeout(t); }
}

// Google Ads spend by the searcher's metro (per Isaac, Oct 9 — one account / one campaign serving several
// branches, e.g. Brand Search and PMAX): Google's location report, monthly by campaign × metro. The app maps
// each metro to a branch; this only relays it.
async function pullGeo(key, from, to) {
  const url = `${WINDSOR}/google_ads?api_key=${encodeURIComponent(key)}&date_from=${from}&date_to=${to}&fields=year_month,account_id,campaign,metro,spend&_renderer=json`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`Windsor google_ads geo ${r.status}`);
    const j = await r.json();
    const out = [];
    for (const x of (j && (j.data || j.result)) || []) {
      const spend = Number(x.spend) || 0; if (!spend) continue;
      const [yy, mm] = String(x.year_month || '').split('|'); if (!yy || !mm) continue;
      out.push({ ym: yy + '-' + String(mm).padStart(2, '0'), acct: String(x.account_id || ''), campaign: String(x.campaign || ''), metro: String(x.metro || ''), spend: Math.round(spend * 100) / 100 });
    }
    return out;
  } finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const { requireRole } = require('../lib/auth-gate.js');
  const gate = await requireRole(event, ['admin', 'admin_rep']);
  if (!gate.ok) return gate.response;
  const key = process.env.WINDSOR_API_KEY;
  if (!key) return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'WINDSOR_API_KEY not set' }) };
  const nowY = new Date().getUTCFullYear();
  const year = Math.min(nowY, Math.max(2020, Number((event.queryStringParameters || {}).year) || nowY));
  const from = year + '-01-01';
  const to = year === nowY ? new Date().toISOString().slice(0, 10) : year + '-12-31';
  const res = await Promise.allSettled([pull(key, 'facebook', from, to), pull(key, 'google_ads', from, to), pullGeo(key, from, to)]);
  const rows = [], errors = []; let geo = [];
  res.slice(0, 2).forEach((r, i) => { if (r.status === 'fulfilled') rows.push(...r.value); else errors.push((i ? 'google_ads' : 'facebook') + ': ' + String(r.reason && r.reason.message || r.reason)); });
  if (res[2].status === 'fulfilled') geo = res[2].value; else errors.push('google_ads geo: ' + String(res[2].reason && res[2].reason.message || res[2].reason));
  if (!rows.length && errors.length) return { statusCode: 502, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: errors.join(' · ') }) };
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=1800' },
    body: JSON.stringify({ year, rows, geo, errors, pulledAt: new Date().toISOString() }),
  };
};
