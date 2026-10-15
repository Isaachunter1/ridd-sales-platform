// ── Add-on reconcile: tickets (= invoices) paid → 5-invoice streak ──────────
// SKELETON (per Isaac + COO, Sep 2026). For every add-on still accruing:
//   1. RevHawk FieldRoutesTicket rows on the SAME subscription with an
//      invoice date ON or after the add-on date (voided tickets ignored).
//   2. Paid = balance 0 (a FieldRoutesAppliedPayment against the ticket is
//      the stricter check; wired below as `paid_at` when present).
//   3. Item presence: RevHawk has no ticket items, so until it does the
//      worker asks FieldRoutes `ticketItem/search` for the tickets it is
//      about to count and marks has_add_on true/false; without FieldRoutes
//      env it leaves has_add_on null (= counted, flagged unverified).
//   4. streakOf() (netlify/lib/add-on-streak.js) → invoices_paid, status,
//      locked_at / broke_at. A streak that breaks after backend_paid_at is
//      set becomes 'clawback' for the pay run to act on.
// Nightly (addons-scheduled.js gates the hour). Nothing here pays anyone.

const { createClient } = require('@supabase/supabase-js');
const { applyFieldRoutesEnv, fieldRoutesBase } = require('../lib/integrations.js');
const { requireSyncSecret } = require('../lib/sync-gate.js');
const { _bq } = require('./revhawk-sync-background.js');
const { streakOf } = require('../lib/add-on-streak.js');
const { loadAdminRules } = require('../lib/rules.js');

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
function frBase() { return fieldRoutesBase(); }
async function fr(endpoint, params) {
  const q = new URLSearchParams({ authenticationKey: process.env.FIELDROUTES_AUTH_KEY || '', authenticationToken: process.env.FIELDROUTES_AUTH_TOKEN || '' });
  for (const [k, v] of Object.entries(params || {})) q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  if (Array.isArray(fr.officeIDs) && fr.officeIDs.length && !(params && 'officeIDs' in params) && !/^office\//.test(endpoint)) q.set('officeIDs', JSON.stringify(fr.officeIDs));
  const res = await fetch(frBase() + endpoint + '?' + q.toString()); const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch (e) { throw new Error(endpoint + ': non-JSON (' + res.status + ')'); }
  if (json.success === false || (json.errorMessage && json.errorMessage !== '')) throw new Error(endpoint + ': ' + (json.errorMessage || 'request failed'));
  return json;
}
// Add-on SALES follow their add-on on Pending Backend Lock (per Isaac, Oct 15): an upsell sale already paid
// upfront locks when its add-on's streak locks (N paid invoices carrying it), and goes to Chargeback the
// moment the add-on is taken off or its streak breaks / is clawed back — for any reason. Either way it STAYS on
// Pending Backend Lock until the quarterly backend payroll runs on it (that run moves Lock → History,
// Chargeback → Archived). Only undecided rows are touched; a manual Lock / Chargeback call stands.
async function syncUpsellLocks(supabase, log) {
  try {
    const { data: ups, error } = await supabase.from('sales').select('id, lock_status')
      .eq('sale_kind', 'upsell').not('payroll_processed_at', 'is', null).is('backend_payroll_processed_at', null)
      .or('lock_status.is.null,lock_status.eq.pending');
    if (error) throw error;
    const ids = (ups || []).map(x => x.id); if (!ids.length) return;
    const now = new Date().toISOString(); let n = 0;
    for (const part of chunk(ids, 500)) {
      const { data: aos } = await supabase.from('add_ons').select('sale_id, streak_status, removed_at').in('sale_id', part);
      for (const a of (aos || [])) {
        const next = (a.removed_at || ['broken', 'clawback'].includes(String(a.streak_status))) ? 'chargeback' : String(a.streak_status) === 'locked' ? 'lock' : null;
        if (!next) continue;
        const { error: ue } = await supabase.from('sales').update({ lock_status: next, audit_2_at: now }).eq('id', a.sale_id).or('lock_status.is.null,lock_status.eq.pending');
        if (!ue) n++;
      }
    }
    log.upsellLocks = n;
  } catch (e) { console.warn('[addon-reconcile] upsell lock sync skipped:', (e && e.message) || e); }
}
const listOf = (got, key) => Array.isArray(got[key]) ? got[key] : Object.values(got[key] || {});

exports.handler = async (event) => {
  const started = Date.now();
  const _gate = requireSyncSecret(event); if (_gate) return _gate;
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required' };
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const log = { addOns: 0, updated: 0, locked: 0, broken: 0, clawback: 0, unverifiedItems: 0 };
  try {
    const { data: open, error } = await supabase.from('add_ons').select('*').in('streak_status', ['accruing', 'locked']).order('id');
    if (error) throw error;
    if (!open || !open.length) { await syncUpsellLocks(supabase, log); return { statusCode: 200, body: 'no open add-ons' }; }
    log.addOns = open.length;
    const token = await _bq.getAccessToken();
    const T = (n) => '`' + _bq.PROJECT + '.' + _bq.DATASET + '.' + n + '`';
    const subIds = [...new Set(open.map(a => String(a.subscription_id)))];

    // 1–2. Tickets on those subscriptions since the earliest add-on date, with
    //      the last applied-payment date when one exists.
    const minFrom = open.map(a => a.added_at).sort()[0];
    const tickets = [];
    // Mapped by appointment / customer + service (netlify/lib/invoice-map.js): RevHawk never fills the
    // ticket's subscription id, so the old WHERE fieldRoutes_subscriptionID IN (…) found no invoices at all.
    const { ticketsForSubsSql } = require('../lib/invoice-map.js');
    for (const part of chunk(subIds, 2000)) {
      const rows = await _bq.queryObjects(token, ticketsForSubsSql(T, part, minFrom));
      tickets.push(...rows);
    }
    // (FieldRoutesAppliedPayment.fieldRoutes_ticketID / fieldRoutes_dateApplied confirmed against the RevHawk schema, Sep 22.)
    const subStatus = new Map();
    for (const part of chunk(subIds, 5000)) {
      const rows = await _bq.queryObjects(token, `
SELECT fieldRoutes_subscriptionID AS sub_id, fieldRoutes_active AS active,
       CASE WHEN fieldRoutes_dateCancelled IS NULL OR fieldRoutes_dateCancelled LIKE '0000%' THEN NULL ELSE LEFT(fieldRoutes_dateCancelled, 10) END AS cancelled_at
FROM ${T('FieldRoutesSubscription')} WHERE fieldRoutes_subscriptionID IN (${part.map(x => "'" + String(x).replace(/'/g, '') + "'").join(',')})`);
      rows.forEach(r => subStatus.set(String(r.sub_id), r));
    }
    const bySub = new Map();
    tickets.forEach(t => { const k = String(t.sub_id); (bySub.get(k) || bySub.set(k, []).get(k)).push(t); });

    // 3. Item presence via FieldRoutes (best effort).
    try { await applyFieldRoutesEnv(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })); } catch (e) { /* env fallback */ }
    if (frBase() && process.env.FIELDROUTES_AUTH_KEY) { fr.officeIDs = await require('../lib/integrations.js').frOfficeIds(fr); console.log('[fieldroutes] offices visible:', fr.officeIDs.length); }
    const canAskFr = !!(frBase() && process.env.FIELDROUTES_AUTH_KEY && process.env.FIELDROUTES_AUTH_TOKEN);
    const itemsByTicket = new Map();   // ticket_id → [item description]
    if (canAskFr) {
      const tids = [...new Set(tickets.map(t => String(t.ticket_id)))];
      try {
        for (const part of chunk(tids, 1000)) {
          const got = await fr('ticketItem/search', { ticketIDs: part.map(Number) });
          const ids = (got.ticketItemIDs || []).map(String);
          for (const ipart of chunk(ids, 1000)) {
            const det = await fr('ticketItem/get', { ticketItemIDs: ipart.map(Number) });
            listOf(det, 'ticketItems').forEach(it => { const k = String(it.ticketID || ''); (itemsByTicket.get(k) || itemsByTicket.set(k, []).get(k)).push(String(it.description || it.serviceDescription || it.productDescription || '').trim().toLowerCase()); });
          }
        }
      } catch (e) { console.warn('[addon-reconcile] ticketItem lookup unavailable — item presence unverified:', e.message); itemsByTicket.clear(); }
    }

    // 4. Streaks. Lock rule (per Isaac, Oct 6): Inside Sales / Technician
    //    add-ons lock after adminRules.addonPay.lock_invoices paid invoices
    //    (default 4). D2D add-ons never lock by count — the D2D pay stub
    //    applies the season lock date (still on the account at the lock).
    const now = new Date().toISOString();
    const AR = await loadAdminRules(supabase);
    const LOCK_N = Math.max(1, parseInt((AR.addonPay && AR.addonPay.lock_invoices), 10) || 4);
    // Upfront already paid? The linked sales row's payroll stamp says so.
    const paidSale = new Set();
    for (const part of chunk([...new Set(open.map(a => a.sale_id).filter(x => x != null))], 500)) {
      const { data } = await supabase.from('sales').select('id, payroll_processed_at').in('id', part).not('payroll_processed_at', 'is', null);
      (data || []).forEach(r => paidSale.add(String(r.id)));
    }
    for (const a of open) {
      const st = subStatus.get(String(a.subscription_id)) || {};
      const invoices = (bySub.get(String(a.subscription_id)) || []).map(t => {
        const items = itemsByTicket.get(String(t.ticket_id));
        const hasAddOn = items ? items.includes(String(a.service_name).toLowerCase()) : null;
        if (hasAddOn == null) log.unverifiedItems++;
        return { ticket_id: t.ticket_id, invoice_date: t.invoice_date, active: t.active !== '-1' && t.active !== '0',
                 paid: (Number(t.balance) || 0) <= 0 && (Number(t.total) || 0) > 0, paid_at: t.paid_at || null, amount: Number(t.total) || 0, has_add_on: hasAddOn };
      });
      const r = streakOf({ added_at: a.added_at, subscription_active: st.active !== '0' && st.active !== '-1' && !st.cancelled_at, subscription_cancelled_at: st.cancelled_at || null }, invoices,
        { lockAt: a.credited_role === 'sales_rep' ? 100000 : LOCK_N });
      let status = r.status;
      // Paid, then dropped before it locked → owed back. Add-on pay is upfront now, so "paid" = the linked sales row went through payroll (or a pay run stamped the add-on).
      if (status === 'broken' && (a.backend_paid_at || a.upfront_paid_at || (a.sale_id != null && paidSale.has(String(a.sale_id))))) status = 'clawback';
      if (a.streak_status === 'locked' && status === 'accruing') status = 'locked';  // never un-lock on a data hiccup
      const patch = { invoices_paid: r.paid, invoices: r.qualifying, streak_status: status, last_reconciled_at: now, updated_at: now,
        locked_at: status === 'locked' ? (a.locked_at || r.lockedAt || now.slice(0, 10)) : a.locked_at,
        broke_at: (status === 'broken' || status === 'clawback') ? (a.broke_at || r.brokeAt || now.slice(0, 10)) : null,
        break_reason: (status === 'broken' || status === 'clawback') ? (a.break_reason || r.reason || null) : null };
      const { error: ue } = await supabase.from('add_ons').update(patch).eq('id', a.id);
      if (ue) { console.warn('[addon-reconcile] update failed', a.id, ue.message); continue; }
      log.updated++;
      if (status === 'locked' && a.streak_status !== 'locked') log.locked++;
      if (status === 'broken' && a.streak_status !== 'broken') log.broken++;
      if (status === 'clawback' && a.streak_status !== 'clawback') log.clawback++;
    }
    console.log('[addon-reconcile] done', JSON.stringify({ ...log, ms: Date.now() - started }));
    await syncUpsellLocks(supabase, log);
    return { statusCode: 200, body: JSON.stringify({ ...log, ms: Date.now() - started }) };
  } catch (e) {
    console.error('[addon-reconcile] failed', e);
    return { statusCode: 500, body: 'addon-reconcile failed: ' + (e.message || e) };
  }
};
