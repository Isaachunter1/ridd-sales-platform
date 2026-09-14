// QuickBooks marketing spend — BACKGROUND refresh via Windsor.ai.
// The general-ledger pull (month × account, ~20 months) takes Windsor
// 15-40s, past the sync-function limit, so it runs here (background
// functions get 15 min) and parks the result in Netlify Blobs. qbo-spend.js
// serves the cached copy instantly and kicks this off when it's stale.
//
// Trigger: POST with x-sync-secret: REVHAWK_SYNC_SECRET (same shared secret
// the RevHawk sync uses). Fired by qbo-spend.js (stale cache) and by
// marketing-refresh-scheduled.js (nightly).
const FETCH_MS = 240000;

async function fetchT(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
  try { const r = await fetch(url, { ...opts, signal: ac.signal }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { ok: r.ok, status: r.status, json, text }; }
  finally { clearTimeout(t); }
}
async function blobStore() {
  try { const { getStore } = await import('@netlify/blobs'); return getStore('qbo'); } catch (e) { console.error('[qbo-refresh] blobs init failed:', e && e.message); return null; }
}

async function pullWindsor(startYear) {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error('WINDSOR_API_KEY not set');
  const now = new Date();
  const from = `${startYear}-01-01`, to = now.toISOString().slice(0, 10);
  const fields = 'year_month,generalledger__item__account_name,generalledger__item__subt_nat_amount';
  const url = `https://connectors.windsor.ai/quickbooks?api_key=${encodeURIComponent(key)}&date_from=${from}&date_to=${to}&fields=${fields}&_renderer=json`;
  const r = await fetchT(url, { headers: { accept: 'application/json' } });
  if (!r.ok || !r.json) throw new Error(`Windsor quickbooks ${r.status}: ${(r.text || '').slice(0, 200)}`);
  const rows = Array.isArray(r.json) ? r.json : (r.json.data || r.json.result || []);
  const out = {};
  let any = false;
  for (const row of rows) {
    const acct = String(row.generalledger__item__account_name || '');
    if (!/^advertising\s*&\s*marketing:/i.test(acct)) continue;
    const m = String(row.year_month || '').match(/^(\d{4})\|(\d{1,2})$/); if (!m) continue;
    const ym = m[1] + '-' + m[2].padStart(2, '0');
    const amt = Number(row.generalledger__item__subt_nat_amount); if (!amt) continue;
    const name = acct.split(':').pop().trim();
    (out[ym] = out[ym] || {});
    out[ym][name] = (out[ym][name] || 0) + amt;
    any = true;
  }
  if (!any) throw new Error('Windsor returned no Advertising & Marketing rows (' + rows.length + ' ledger rows)');
  let total = 0; for (const ym in out) for (const k in out[ym]) total += out[ym][k];
  return { bySourceMonth: out, total, pulledAt: new Date().toISOString(), source: 'windsor', rows: rows.length };
}

exports.handler = async (event) => {
  console.log('[qbo-refresh] invoked');
  const need = process.env.REVHAWK_SYNC_SECRET;
  if (need) {
    const got = (event && event.headers && (event.headers['x-sync-secret'] || event.headers['X-Sync-Secret'])) || '';
    if (got !== need) return { statusCode: 401, body: 'bad secret' };
  }
  const store = await blobStore();
  if (!store) { console.error('[qbo-refresh] Netlify Blobs unavailable'); return { statusCode: 500, body: 'no blobs' }; }
  const startYear = new Date().getFullYear() - 1;
  const started = Date.now();
  try {
    await store.setJSON('spend_refreshing', { at: new Date().toISOString() });
    const data = await pullWindsor(startYear);
    await store.setJSON('spend', data);
    await store.delete('spend_refreshing').catch(() => {});
    console.log('[qbo-refresh] ok', data.rows, 'ledger rows,', Object.keys(data.bySourceMonth).length, 'months, total', Math.round(data.total), 'in', Date.now() - started, 'ms');
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    await store.delete('spend_refreshing').catch(() => {});
    await store.setJSON('spend_error', { at: new Date().toISOString(), error: String(e && e.message || e) }).catch(() => {});
    console.error('[qbo-refresh] failed after', Date.now() - started, 'ms:', e && e.message);
    return { statusCode: 500, body: String(e && e.message || e) };
  }
};
