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
const PAGE_LIMIT = 100;
const MAX_PAGES = 200; // safety cap (~20k contacts)

function ym(dateStr) {
  const d = new Date(dateStr);
  return isNaN(d) ? null : d.toISOString().slice(0, 7);
}

exports.handler = async () => {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GHL_PRIVATE_TOKEN and GHL_LOCATION_ID env vars required' }) };
  }
  const headers = { Authorization: `Bearer ${token}`, Version: VERSION, Accept: 'application/json' };
  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;

  const leadsBySource = {};
  const bySourceMonth = {};
  let total = 0;
  let startAfter, startAfterId;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ locationId, limit: String(PAGE_LIMIT) });
      if (startAfter) params.set('startAfter', startAfter);
      if (startAfterId) params.set('startAfterId', startAfterId);

      const r = await fetch(`${BASE}/contacts/?${params.toString()}`, { headers });
      if (!r.ok) throw new Error(`GHL contacts ${r.status}`);
      const j = await r.json();
      const contacts = j.contacts || [];
      if (contacts.length === 0) break;

      for (const c of contacts) {
        const added = c.dateAdded || c.dateUpdated;
        if (added && new Date(added).getTime() < cutoff) continue;
        const src = (c.source || 'Unknown').trim() || 'Unknown';
        leadsBySource[src] = (leadsBySource[src] || 0) + 1;
        total++;
        const m = added && ym(added);
        if (m) {
          (bySourceMonth[m] = bySourceMonth[m] || {});
          bySourceMonth[m][src] = (bySourceMonth[m][src] || 0) + 1;
        }
      }

      // pagination cursor (GHL returns meta.startAfter / meta.startAfterId)
      const meta = j.meta || {};
      startAfter = meta.startAfter;
      startAfterId = meta.startAfterId;
      if (!startAfter && !startAfterId) break;
      if (contacts.length < PAGE_LIMIT) break;
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      body: JSON.stringify({ leadsBySource, bySourceMonth, total, pulledAt: new Date().toISOString() }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
