// GoHighLevel contacts → Supabase (per Isaac, Sep 30). Background worker,
// kicked hourly by ghl-scheduled.js. Two passes each run:
//   1. Incremental — newest-UPDATED contacts first, until we reach what the
//      last run already saw (catches new leads AND changed attribution).
//   2. Backfill — walks the full history (newest-added → Jan 1 of last
//      year) across runs, resuming from a saved cursor, until done.
// Then it rebuilds reporting/ghl/leads.json.gz: one compact row per contact
// (date, source, first/last attribution, phone, email, ZIP) that Marketing →
// Metrics turns into leads by provider / office with last-paid-touch credit.
// Token + location: Netlify env GHL_PRIVATE_TOKEN / GHL_LOCATION_ID.
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const { requireSyncSecret } = require('../lib/sync-gate.js');

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const PAGE = 500;
const SYNC_BUDGET_MS = 11 * 60 * 1000;   // leave room for the file build inside the 15-min background limit
const FETCH_MS = 20000;

function phone10(v) { let d = String(v == null ? '' : v).replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length >= 10 ? d.slice(0, 10) : ''; }
function srcOf(c) { let s = c.source; if (s && typeof s === 'object') s = s.name || s.value || null; return s == null ? '' : String(s).trim(); }
// An attribution object → one label the app can map to a provider.
function attrLabel(a) {
  if (!a || typeof a !== 'object') return typeof a === 'string' ? a.trim() : '';
  const s = a.utmSource || a.utm_source || a.sessionSource || '';
  if (s) return String(s).trim();
  if (a.gclid) return 'gclid';
  if (a.fbclid) return 'fbclid';
  return String(a.medium || a.referrer || '').trim();
}
function toRow(c, loc) {
  const added = c.dateAdded || c.createdAt || null, upd = c.dateUpdated || added;
  return {
    id: String(c.id), location_id: loc, date_added: added, date_updated: upd,
    source: srcOf(c) || null, first_attr: attrLabel(c.attributionSource) || null, last_attr: attrLabel(c.lastAttributionSource) || null,
    phone10: phone10(c.phone || c.phoneNumber) || null, email: String(c.email || '').trim().toLowerCase() || null,
    postal_code: String(c.postalCode || '').trim().slice(0, 10) || null, city: c.city || null, state: c.state || null,
    tags: Array.isArray(c.tags) ? c.tags.slice(0, 30).map(String) : null, synced_at: new Date().toISOString(),
  };
}
async function search(headers, body) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(BASE + '/contacts/search', { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    return { ok: r.ok, status: r.status, j, txt };
  } finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const _gate = requireSyncSecret(event); if (_gate) return _gate;
  const token = process.env.GHL_PRIVATE_TOKEN, loc = process.env.GHL_LOCATION_ID;
  if (!token || !loc) { console.log('[ghl-sync] GHL env not set — skipped'); return { statusCode: 200, body: 'skipped' }; }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const started = Date.now();
  const headers = { Authorization: 'Bearer ' + token, Version: VERSION, Accept: 'application/json', 'Content-Type': 'application/json' };
  const cutoffYear = new Date().getUTCFullYear() - 1;
  const CUTOFF = Date.parse(cutoffYear + '-01-01T00:00:00Z');
  const { data: stRow } = await sb.from('app_settings').select('value').eq('key', 'ghl_sync').maybeSingle();
  const st = Object.assign({}, (stRow && stRow.value) || {});
  const log = { incremental: 0, backfill: 0, errors: [] };
  const upsert = async (contacts) => {
    const rows = contacts.filter(c => c && c.id).map(c => toRow(c, loc));
    if (!rows.length) return;
    const { error } = await sb.from('ghl_contacts').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error('upsert: ' + error.message);
  };
  const saveState = async () => { await sb.from('app_settings').upsert({ key: 'ghl_sync', value: st }, { onConflict: 'key' }); };

  try {
    // 1. Incremental (only once a backfill has started, so there's a mark to stop at).
    if (st.mark) {
      const stopAt = Date.parse(st.mark) - 3600000;
      let after = null, newest = null, field = 'dateUpdated';
      for (let p = 0; p < 400 && Date.now() - started < SYNC_BUDGET_MS / 2; p++) {
        const body = { locationId: loc, pageLimit: PAGE, sort: [{ field, direction: 'desc' }] };
        if (after) body.searchAfter = after;
        const res = await search(headers, body);
        if (!res.ok) { if (field === 'dateUpdated' && p === 0) { field = 'dateAdded'; p--; continue; } log.errors.push('incremental ' + res.status + ' ' + String(res.txt).slice(0, 160)); break; }
        const cs = (res.j && (res.j.contacts || res.j.data)) || [];
        if (!cs.length) break;
        if (!newest) newest = cs[0][field] || cs[0].dateAdded;
        await upsert(cs); log.incremental += cs.length;
        const lastT = Date.parse(cs[cs.length - 1][field] || cs[cs.length - 1].dateAdded || 0);
        if (lastT && lastT < stopAt) break;
        const nx = cs[cs.length - 1].searchAfter || (res.j && res.j.searchAfter);
        if (!nx || cs.length < PAGE) break;
        after = nx;
      }
      if (newest) st.mark = newest;
    }
    // 2. Backfill.
    if (!st.backfillDone) {
      if (!st.mark) st.mark = new Date().toISOString();
      let after = st.backfillAfter || null;
      for (let p = 0; p < 2000 && Date.now() - started < SYNC_BUDGET_MS; p++) {
        const body = { locationId: loc, pageLimit: PAGE, sort: [{ field: 'dateAdded', direction: 'desc' }] };
        if (after) body.searchAfter = after;
        const res = await search(headers, body);
        if (!res.ok) { log.errors.push('backfill ' + res.status + ' ' + String(res.txt).slice(0, 160)); break; }
        const cs = (res.j && (res.j.contacts || res.j.data)) || [];
        if (!cs.length) { st.backfillDone = true; break; }
        await upsert(cs); log.backfill += cs.length;
        const lastAdded = Date.parse(cs[cs.length - 1].dateAdded || 0);
        const nx = cs[cs.length - 1].searchAfter || (res.j && res.j.searchAfter);
        if ((lastAdded && lastAdded < CUTOFF) || !nx || cs.length < PAGE) { st.backfillDone = true; break; }
        after = nx; st.backfillAfter = after;
        if (p % 20 === 19) await saveState();
      }
      if (st.backfillDone) delete st.backfillAfter;
    }
  } catch (e) { log.errors.push(String(e.message || e)); }
  st.lastRunAt = new Date().toISOString(); st.lastRun = log;
  await saveState();

  // 3. Compact file for the app.
  try {
    const labels = [], li = new Map();
    const L = (s) => { if (!s) return -1; if (!li.has(s)) { li.set(s, labels.length); labels.push(s); } return li.get(s); };
    const rows = [];
    const from = new Date(CUTOFF).toISOString();
    for (let off = 0; off < 1000000; off += 1000) {
      const { data, error } = await sb.from('ghl_contacts').select('date_added,source,first_attr,last_attr,phone10,email,postal_code')
        .gte('date_added', from).order('date_added', { ascending: true }).order('id', { ascending: true }).range(off, off + 999);
      if (error) throw new Error('read: ' + error.message);
      for (const r of data || []) rows.push([String(r.date_added || '').slice(0, 10), L(r.source), L(r.first_attr), L(r.last_attr), r.phone10 || '', r.email || '', String(r.postal_code || '').slice(0, 5)]);
      if (!data || data.length < 1000) break;
    }
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ v: 1, at: new Date().toISOString(), backfillDone: !!st.backfillDone, labels, rows })));
    const { error } = await sb.storage.from('reporting').upload('ghl/leads.json.gz', gz, { contentType: 'application/gzip', upsert: true });
    if (error) throw new Error('upload: ' + error.message);
    console.log('[ghl-sync] ok', JSON.stringify(log), 'file rows', rows.length, 'bytes', gz.length);
  } catch (e) { console.error('[ghl-sync] build failed', e); }
  return { statusCode: 200, body: 'ok' };
};
