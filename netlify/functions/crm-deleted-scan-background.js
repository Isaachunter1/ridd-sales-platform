// ── Deleted-in-FieldRoutes scan (per Isaac, Sep 2026) ────────────────────────
// RevHawk's mirror is incremental: when an account is deleted inside
// FieldRoutes the mirror simply stops receiving updates for it and the row
// lives on forever — Luz María Alonso Partida (#175864), Corey Santos
// (#155572), Angie Sanchez (#154620) all showed as Active accounts in the
// app months after they were gone from the CRM. The orphan rule only
// catches subs whose CUSTOMER row vanished, which is rare.
//
// This worker asks FieldRoutes directly which customer ids still exist:
// every customer id in the mirror is sent through customer/search in
// batches, and any id FieldRoutes no longer returns is "deleted". The
// result goes to app_settings.crm_deleted so the app excludes them app-wide
// and shows them as their own step on the Retention tab.
//
// Cost: ~1 API call per 1,000 customers (≈90 calls nightly). Safety: a batch
// that errors or comes back empty is SKIPPED (never marked deleted) — the
// list only shrinks or grows from batches FieldRoutes answered cleanly.

const { createClient } = require('@supabase/supabase-js');
const { requireSyncSecret } = require('../lib/sync-gate.js');
const { _bq } = require('./revhawk-sync-background.js');

function frBase() {
  const sub = (process.env.FIELDROUTES_SUBDOMAIN || '').trim();
  return sub ? 'https://' + sub + '.pestroutes.com/api/' : null;
}
async function fr(endpoint, params) {
  const q = new URLSearchParams({
    authenticationKey: process.env.FIELDROUTES_AUTH_KEY || '',
    authenticationToken: process.env.FIELDROUTES_AUTH_TOKEN || '',
  });
  for (const [k, v] of Object.entries(params || {})) q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  let res, txt;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(frBase() + endpoint + '?' + q.toString());
    txt = await res.text();
    const limited = res.status === 429 || /too many requests|rate limit/i.test(txt.slice(0, 300));
    if (!limited || attempt >= 2) break;
    fr.rateLimited = (fr.rateLimited || 0) + 1;
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  let json; try { json = JSON.parse(txt); } catch (e) { throw new Error(endpoint + ': non-JSON response (' + res.status + '): ' + txt.slice(0, 120)); }
  if (json.success === false || (json.errorMessage && json.errorMessage !== '')) throw new Error(endpoint + ': ' + (json.errorMessage || 'request failed'));
  return json;
}
fr.rateLimited = 0;
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

exports.handler = async (event) => {
  const started = Date.now();
  const _gate = requireSyncSecret(event); if (_gate) return _gate;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required' };
  if (!frBase() || !process.env.FIELDROUTES_AUTH_KEY || !process.env.FIELDROUTES_AUTH_TOKEN) {
    console.log('[crm-deleted] FieldRoutes API env not set — skipping');
    return { statusCode: 200, body: 'fieldroutes env not set — skipped' };
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    // 1. Every customer id the mirror knows about.
    const token = await _bq.getAccessToken();
    const T = (n) => '`' + _bq.PROJECT + '.' + _bq.DATASET + '.' + n + '`';
    const rows = await _bq.runQuery(token, `SELECT DISTINCT fieldRoutes_customerID AS id FROM ${T('FieldRoutesCustomer')} WHERE fieldRoutes_customerID IS NOT NULL AND SAFE_CAST(fieldRoutes_customerID AS INT64) > 0`);
    const mirrorIds = rows.map(r => String(r.id)).filter(Boolean);
    console.log('[crm-deleted] mirror customers:', mirrorIds.length);

    // 2. Ask FieldRoutes which of them still exist. customer/search with an
    //    IN filter returns the ids it found; anything missing is gone.
    const alive = new Set();
    const checked = new Set();
    let calls = 0, skipped = 0;
    for (const part of chunk(mirrorIds, 1000)) {
      try {
        const got = await fr('customer/search', { customerIDs: { operator: 'IN', value: part.map(Number) }, includeData: 0 });
        calls++;
        const found = Array.isArray(got.customerIDs) ? got.customerIDs.map(String)
          : (got.customerIDs && typeof got.customerIDs === 'object') ? Object.keys(got.customerIDs) : null;
        // A whole batch of 1,000 real customers can't all be gone — treat an
        // empty / malformed answer as an API hiccup and leave those ids alone.
        if (!found || (!found.length && part.length > 25)) { skipped++; continue; }
        found.forEach(id => alive.add(id));
        part.forEach(id => checked.add(id));
      } catch (e) {
        skipped++;
        console.warn('[crm-deleted] batch failed:', String(e && e.message || e).slice(0, 160));
      }
    }
    const deleted = mirrorIds.filter(id => checked.has(id) && !alive.has(id));
    console.log('[crm-deleted] calls', calls, 'rate-limited retries', fr.rateLimited, 'skipped batches', skipped, 'checked', checked.size, 'deleted', deleted.length);

    // 3. Merge with what we knew: ids from batches that were skipped tonight
    //    keep yesterday's verdict, so one flaky call never un-deletes anyone.
    const { data: prevRow } = await supabase.from('app_settings').select('value').eq('key', 'crm_deleted').maybeSingle();
    const prev = (prevRow && prevRow.value && Array.isArray(prevRow.value.ids)) ? prevRow.value.ids.map(String) : [];
    const keep = prev.filter(id => !checked.has(id));
    const ids = [...new Set([...deleted, ...keep])].sort((a, b) => Number(a) - Number(b));
    const value = { ids, scanned_at: new Date().toISOString(), mirror: mirrorIds.length, checked: checked.size, skipped_batches: skipped, calls };
    const { error } = await supabase.from('app_settings').upsert({ key: 'crm_deleted', value }, { onConflict: 'key' });
    if (error) throw error;
    return { statusCode: 200, body: JSON.stringify({ ok: true, deleted: ids.length, checked: checked.size, calls, skipped, ms: Date.now() - started }) };
  } catch (e) {
    console.error('[crm-deleted] failed:', e);
    return { statusCode: 500, body: 'crm-deleted scan failed: ' + String(e && e.message || e) };
  }
};
