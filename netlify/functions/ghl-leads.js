// GoHighLevel leads relay — pulls ALL contacts (leads) from GoHighLevel and
// aggregates them by source, so the marketing dashboard can show lead origin
// and lead->sold conversion. The Private Integration token can't live in the
// static frontend, so this serverless function holds it server-side.
//
// SETUP
// -----
// 1. In GoHighLevel: Settings -> Private Integrations -> create a token with at
//    least the "View Contacts" (contacts.readonly) scope. Copy the token.
// 2. Find your sub-account Location ID (Settings -> Business Profile, or the API).
// 3. In Netlify -> Site settings -> Environment variables, add:
//      GHL_PRIVATE_TOKEN = <the token>      (never commit it)
//      GHL_LOCATION_ID   = <your locationId>
// 4. Deploy. Exposed at /.netlify/functions/ghl-leads; the /api/ghl-leads
//    redirect is already in netlify.toml.
//
// RESPONSE SHAPE (consumed by marketing.html)
// -------------------------------------------
//   { leadsBySource: { "Facebook": 412, "Google": 188, ... },
//     bySourceMonth: { "2026-05": { "Facebook": 90, ... }, ... },
//     total: <number>, pulledAt: "<ISO>" }
//
// NOTE: GHL API base = https://services.leadconnectorhq.com, Version 2021-07-28.
// Verify pagination/field names against marketplace.gohighlevel.com/docs if GHL
// changes them. Contacts carry `source` and `dateAdded`.

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const LOOKBACK_DAYS = 365;
const PAGE_LIMIT = 500;      // GHL contacts/search max; fewer round-trips per pull
const MAX_PAGES = 120;       // hard cap (120 x 500 = 60k contacts)
const DEADLINE_MS = 24000;   // overall budget; return partial well before Netlify's 30s
const FETCH_MS = 8000;       // hard per-request abort so one hung call can't run to 30s

function ym(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d) ? null : d.toISOString().slice(0, 7);
}
function pickSource(c) {
  let s = c.source;
  if (s && typeof s === 'object') s = s.name || s.value || s.source || null;
  if (!s) {
    const a = c.attributionSource || c.lastAttributionSource;
    if (a && typeof a === 'object') {
      s = a.utmSource || a.sessionSource || a.medium || a.referrer
        || (a.gclid ? 'Google Ads' : a.fbclid ? 'Facebook' : null) || a.url || null;
    } else if (typeof a === 'string') s = a;
  }
  s = (s == null ? 'Unknown' : ('' + s)).trim();
  return s || 'Unknown';
}
// Normalize a phone to its core 10 digits (drop US country code + extensions).
function phone10(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length >= 10 ? d.slice(0, 10) : '';
}
async function fetchJSON(url, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { ok: r.ok, status: r.status, json, text };
  } finally { clearTimeout(timer); }
}

// Walks GHL contacts newest->oldest via the search endpoint, hard per-request and
// overall time bounds, and always returns 200 with whatever it gathered (+ diagnostics).
exports.handler = async (event) => {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GHL_PRIVATE_TOKEN and GHL_LOCATION_ID env vars required' }) };
  }
  const headers = { Authorization: `Bearer ${token}`, Version: VERSION, Accept: 'application/json', 'Content-Type': 'application/json' };
  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
  const started = Date.now();

  const leadsBySource = {};
  const bySourceMonth = {};
  const contactsOut = [];   // per-lead {p:phone10, e:email, s:source} for attribution matching
  let total = 0, pages = 0, partial = false, sampleKeys = null, note = null;
  // Resume from the cursor the client saved on its previous call, so a
  // high-volume location's full 365-day history accumulates across several
  // budget-bounded calls instead of one call that times out on a partial slice.
  let searchAfter = null, reachedCutoff = false, done = false;
  try { const q = (event && event.queryStringParameters) || {}; if (q.after) searchAfter = JSON.parse(q.after); } catch (e) { /* ignore bad cursor */ }

  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() - started > DEADLINE_MS) { partial = true; note = 'time budget reached'; break; }
    const body = { locationId, pageLimit: PAGE_LIMIT, sort: [{ field: 'dateAdded', direction: 'desc' }] };
    if (searchAfter) body.searchAfter = searchAfter;

    let res;
    try { res = await fetchJSON(`${BASE}/contacts/search`, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (e) { partial = true; note = 'request aborted/failed: ' + String(e.name || e.message || e); break; }
    if (!res.ok) { note = `contacts/search ${res.status}: ${(res.text || '').slice(0, 200)}`; break; }

    const contacts = (res.json && (res.json.contacts || res.json.data)) || [];
    if (contacts.length === 0) { done = true; break; }
    if (!sampleKeys) sampleKeys = Object.keys(contacts[0]); // shape probe
    pages++;

    for (const c of contacts) {
      const added = c.dateAdded || c.dateUpdated || c.createdAt;
      if (added && new Date(added).getTime() < cutoff) { reachedCutoff = true; continue; }
      const src = pickSource(c);
      leadsBySource[src] = (leadsBySource[src] || 0) + 1;
      total++;
      const m = added && ym(added);
      if (m) { (bySourceMonth[m] = bySourceMonth[m] || {}); bySourceMonth[m][src] = (bySourceMonth[m][src] || 0) + 1; }
      // Per-lead identity for attribution matching (phone + email) plus the
      // add date (YYYY-MM-DD) so the chart can filter by today/week/month.
      const ph = phone10(c.phone || c.phoneNumber);
      const em = String(c.email || '').trim().toLowerCase();
      const dd = added ? new Date(added).toISOString().slice(0, 10) : '';
      if (ph || em || dd) contactsOut.push({ p: ph, e: em, s: src, d: dd });
    }

    if (reachedCutoff) { done = true; break; }
    const last = contacts[contacts.length - 1];
    const next = last && (last.searchAfter || (res.json && res.json.searchAfter));
    if (!next || (searchAfter && JSON.stringify(next) === JSON.stringify(searchAfter))) { done = true; break; }
    searchAfter = next;
    if (contacts.length < PAGE_LIMIT) { done = true; break; }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800' },
    body: JSON.stringify({ leadsBySource, bySourceMonth, contacts: contactsOut, total, pages, partial, done, nextAfter: done ? null : searchAfter, note, sampleKeys, pulledAt: new Date().toISOString() }),
  };
};
