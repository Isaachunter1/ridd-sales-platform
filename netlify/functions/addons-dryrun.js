// Admin-only DRY RUN for the add-ons worker (per Isaac, Sep 29): given a
// FieldRoutes customer ID, ask the FieldRoutes API what it holds for that
// account's subscriptions, recurring tickets and ticket items — and return
// it as-is (trimmed). Writes NOTHING. Used to confirm the real endpoint
// names / field names before fieldroutes-addons-sync-background goes live.
//   POST /api/addons-dryrun  { customerID: "68003" }   (admin JWT)
// Credentials are read server-side (Data sources → Netlify env fallback);
// nothing secret is ever returned.
const { createClient } = require('@supabase/supabase-js');
const { applyFieldRoutesEnv, fieldRoutesBase } = require('../lib/integrations.js');
const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body, null, 1) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json(500, { error: 'Server missing Supabase env' });
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Sign in required' });
  const { data: userRes } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt);
  if (!userRes || !userRes.user) return json(401, { error: 'Invalid session' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: prof } = await admin.from('profiles').select('role').eq('id', userRes.user.id).maybeSingle();
  if (!prof || !['admin', 'admin_rep'].includes(prof.role)) return json(403, { error: 'Admins only' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
  const customerID = String(body.customerID || '').replace(/\D/g, '');
  if (!customerID) return json(400, { error: 'customerID required' });

  try { await applyFieldRoutesEnv(admin); } catch (e) { /* env fallback */ }
  const base = fieldRoutesBase();
  if (!base || !process.env.FIELDROUTES_AUTH_KEY || !process.env.FIELDROUTES_AUTH_TOKEN) return json(200, { ok: false, error: 'FieldRoutes credentials not set on the server' });
  const calls = [];
  const fr = async (endpoint, params) => {
    const q = new URLSearchParams({ authenticationKey: process.env.FIELDROUTES_AUTH_KEY, authenticationToken: process.env.FIELDROUTES_AUTH_TOKEN });
    for (const [k, v] of Object.entries(params || {})) q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    const rec = { endpoint, params };
    try {
      const res = await fetch(base + endpoint + '?' + q.toString()); const txt = await res.text();
      rec.http = res.status;
      let j = null; try { j = JSON.parse(txt); } catch (e) { rec.error = 'non-JSON: ' + txt.slice(0, 160); calls.push(rec); return null; }
      if (j.success === false || (j.errorMessage && j.errorMessage !== '')) rec.error = j.errorMessage || 'success=false';
      rec.keys = Object.keys(j);
      calls.push(rec); return j;
    } catch (e) { rec.error = String(e && e.message || e); calls.push(rec); return null; }
  };
  const listOf = (got, key) => !got ? [] : Array.isArray(got[key]) ? got[key] : Object.values(got[key] || {});
  const trim = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 400) ? v.slice(0, 400) + '…' : v));

  // 1. Subscriptions on the customer (recurringTicket / addOns live here).
  const subSearch = await fr('subscription/search', { customerIDs: [Number(customerID)] });
  const subIds = (subSearch && (subSearch.subscriptionIDs || subSearch.subscriptionIDsNoDataExported)) || [];
  const subGet = subIds.length ? await fr('subscription/get', { subscriptionIDs: subIds.map(Number) }) : null;
  const subs = listOf(subGet, 'subscriptions');
  const active = subs.filter(s => String(s.active) === '1');
  // 2. Recurring ticket templates on the active subs.
  const recIds = [...new Set(active.map(s => s.recurringTicket && (s.recurringTicket.ticketID || s.recurringTicket)).filter(x => x && typeof x !== 'object').map(String))];
  const recTicket = recIds.length ? await fr('ticket/get', { ticketIDs: recIds.map(Number) }) : null;
  // 3. Ticket items — try the likely endpoint shapes.
  const itemSearchByTicket = recIds.length ? await fr('ticketItem/search', { ticketIDs: recIds.map(Number) }) : null;
  const itemSearchByCust = await fr('ticketItem/search', { customerIDs: [Number(customerID)] });
  const itemIds = [...new Set([...((itemSearchByTicket && itemSearchByTicket.ticketItemIDs) || []), ...((itemSearchByCust && itemSearchByCust.ticketItemIDs) || [])].map(String))];
  const itemGet = itemIds.length ? await fr('ticketItem/get', { ticketItemIDs: itemIds.slice(0, 200).map(Number) }) : null;

  return json(200, trim({
    ok: true, customerID,
    calls,
    subscriptions: active.map(s => ({ subscriptionID: s.subscriptionID, serviceType: s.serviceType, recurringCharge: s.recurringCharge, addOns: s.addOns, recurringTicket: s.recurringTicket })),
    recurringTickets: listOf(recTicket, 'tickets'),
    ticketItems: listOf(itemGet, 'ticketItems').slice(0, 50),
  }));
};
