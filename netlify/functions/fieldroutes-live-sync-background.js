// ── FieldRoutes LIVE pull → Sales queues (per Isaac, Sep 2026) ──────────────
// RevHawk mirrors FieldRoutes once a night, so an account sold at 10am does
// not reach the app until ~2am. This worker asks FieldRoutes directly, every
// 15 minutes during selling hours, for subscriptions added in the last two
// days and creates the same `sales` rows the RevHawk auto-log creates
// (queue_type + crm_subscription_id), so the Sales tabs fill the same day.
// The nightly RevHawk pass dedupes on crm_subscription_id and adds the
// lifecycle stamps (serviced / signed / balance) — nothing is double-logged.
//
// Env (Netlify): FIELDROUTES_SUBDOMAIN (e.g. "ridd" for ridd.pestroutes.com),
//                FIELDROUTES_AUTH_KEY, FIELDROUTES_AUTH_TOKEN,
//                SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Off until all three FieldRoutes vars exist AND app_settings.autolog.enabled.

const { createClient } = require('@supabase/supabase-js');
const { applyFieldRoutesEnv, fieldRoutesBase, recordIntegrationStatus } = require('../lib/integrations.js');
const { requireSyncSecret } = require('../lib/sync-gate.js');

let EXCLUDED_SVCS = new Set(require('../lib/rules.js').FR_GLOBAL_EXCLUDED);   // refreshed per run with admin-Hidden service types
// Branch names exactly as the nightly RevHawk sync writes them (its
// OFFICE_NAMES baseline), so a live row and the dataset's row for the same
// sale land on the same branch; FieldRoutes' own office name is the fallback.
const BRANCH_NAMES = {
  '1': 'Salt Lake', '6': 'Charleston', '7': 'Myrtle Beach', '10': 'Destin', '13': 'Atlanta',
  '15': 'Virginia Beach', '16': 'Raleigh', '18': 'Detroit', '19': 'Joplin', '20': 'Little Rock',
};
const QUEUE_OF = { 'Office Staff': 'office', 'Sales Rep': 'd2d', 'Technician': 'tech' };
const TYPE_LABEL = { '0': 'Office Staff', '1': 'Technician', '2': 'Sales Rep' };

function frBase() { return fieldRoutesBase(); }
async function fr(endpoint, params) {
  const base = frBase();
  const q = new URLSearchParams({
    authenticationKey: process.env.FIELDROUTES_AUTH_KEY || '',
    authenticationToken: process.env.FIELDROUTES_AUTH_TOKEN || '',
  });
  for (const [k, v] of Object.entries(params || {})) q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  if (Array.isArray(fr.officeIDs) && fr.officeIDs.length && !(params && 'officeIDs' in params) && !/^office\//.test(endpoint)) q.set('officeIDs', JSON.stringify(fr.officeIDs));
  // FieldRoutes rate limit (429 / "too many requests"): back off and retry
  // twice before giving up, and count it so the log says why a run was thin.
  let res, txt;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(base + endpoint + '?' + q.toString());
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
const norm = (x) => String(x || '').trim().toLowerCase();
// Signed via customer notes (per Isaac, Oct 14): when a customer e-signs,
// FieldRoutes logs a "Contract Email" note (typeID 42) reading "… signed
// contract". That note matched completed contracts ~99.5% of the time over
// 30 days, and it shows up the minute they sign — so it backs up the
// contract/search lookup, which has been coming back empty same-day.
// Returns the set of customer IDs with such a note. Throws only on API error.
async function signedViaNotes(custIds) {
  const out = new Set();
  for (const part of chunk([...new Set(custIds.map(String))], 500)) {
    const got = await fr('note/search', { customerIDs: part.map(Number) });
    const nids = got.noteIDs || got.noteIDsNoDataExported || [];
    for (const npart of chunk(nids.map(String), 1000)) {
      const det = await fr('note/get', { noteIDs: npart.map(Number) });
      const list = Array.isArray(det.notes) ? det.notes : Object.values(det.notes || {});
      list.forEach(n => {
        // Type 42 only: the phrase also turns up in a handful of pasted
        // emails / cancel requests (60-day check: 7,290 type-42 vs 10 others).
        const isType = String(n.typeID || '') === '42' || /contract email/i.test(String(n.type || ''));
        const says = /signed contract/i.test(String(n.notes || n.note || ''));
        if (isType && says) out.add(String(n.customerID));
      });
    }
  }
  return out;
}

// Signed via FORM documents (per FieldRoutes support, Oct 15): an agreement generated from a form
// template (e-signature) lives on form/search + form/get, not contract/*. Same dateSigned field
// (0000-00-00 until signed) and documentState (WIP / COMPLETED). Returns signed customer IDs.
async function signedViaForms(custIds) {
  const out = new Set();
  for (const part of chunk([...new Set(custIds.map(String))], 500)) {
    const got = await fr('form/search', { customerIDs: part.map(Number) });
    const fids = got.formIDs || got.documentIDs || got.formIDsNoDataExported || [];
    for (const fpart of chunk(fids.map(String), 500)) {
      const det = await fr('form/get', { formIDs: fpart.map(Number) });
      const list = Array.isArray(det.forms) ? det.forms : Object.values(det.forms || det.documents || {});
      list.forEach(f => {
        const ds = String(f.dateSigned || '').trim();
        const signed = (ds && !ds.startsWith('0000')) || String(f.documentState || '').toUpperCase() === 'COMPLETED';
        if (signed && f.customerID) out.add(String(f.customerID));
      });
    }
  }
  return out;
}

// When each customer last SIGNED anything, as YYYY-MM-DD (per Isaac, Oct 15 — reconcile vs the FieldRoutes
// Sales Report's "Signed Agreement" column). A sale only counts as signed when the signature is dated ON or
// AFTER the sale — #83389 / #152408 read "signed" off an older agreement while the report said No.
// Sources: contract/* and form/* (dateSigned; documentState COMPLETED) and the "signed contract" note.
const _day = (v) => { const t = String(v || '').trim().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) && !t.startsWith('0000') ? t : ''; };
async function signedAtByCustomer(custIds) {
  const at = new Map(), bump = (cid, d) => { if (!cid || !d) return; const k = String(cid); if (!at.has(k) || d > at.get(k)) at.set(k, d); };
  const ids = [...new Set((custIds || []).map(String))];
  try {
    for (const part of chunk(ids, 500)) {
      const got = await fr('contract/search', { customerIDs: part.map(Number), documentState: 'COMPLETED' });
      for (const cpart of chunk((got.contractIDs || got.documentIDs || []).map(String), 500)) {
        const det = await fr('contract/get', { contractIDs: cpart.map(Number) });
        (Array.isArray(det.contracts) ? det.contracts : Object.values(det.contracts || det.documents || {})).forEach(c => {
          if (String(c.documentState || c.state || 'COMPLETED').toUpperCase() !== 'COMPLETED' && !_day(c.dateSigned)) return;
          bump(c.customerID, _day(c.dateSigned) || _day(c.dateUpdated) || _day(c.dateAdded));
        });
      }
    }
  } catch (e) { console.warn('[fr-live] contract lookup unavailable:', e.message); }
  try {
    for (const part of chunk(ids, 500)) {
      const got = await fr('form/search', { customerIDs: part.map(Number) });
      for (const fpart of chunk((got.formIDs || got.documentIDs || got.formIDsNoDataExported || []).map(String), 500)) {
        const det = await fr('form/get', { formIDs: fpart.map(Number) });
        (Array.isArray(det.forms) ? det.forms : Object.values(det.forms || det.documents || {})).forEach(f => {
          const d = _day(f.dateSigned) || (String(f.documentState || '').toUpperCase() === 'COMPLETED' ? (_day(f.dateUpdated) || _day(f.dateAdded)) : '');
          bump(f.customerID, d);
        });
      }
    }
  } catch (e) { console.warn('[fr-live] form lookup unavailable:', e.message); }
  try {
    for (const part of chunk(ids, 500)) {
      const got = await fr('note/search', { customerIDs: part.map(Number) });
      for (const npart of chunk((got.noteIDs || got.noteIDsNoDataExported || []).map(String), 1000)) {
        const det = await fr('note/get', { noteIDs: npart.map(Number) });
        (Array.isArray(det.notes) ? det.notes : Object.values(det.notes || {})).forEach(n => {
          const isType = String(n.typeID || '') === '42' || /contract email/i.test(String(n.type || ''));
          if (isType && /signed contract/i.test(String(n.notes || n.note || ''))) bump(n.customerID, _day(n.date) || _day(n.dateAdded));
        });
      }
    }
  } catch (e) { console.warn('[fr-live] signed-note lookup unavailable:', e.message); }
  return at;
}

exports.handler = async (event) => {
  const started = Date.now();
  const _gate = requireSyncSecret(event); if (_gate) return _gate;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required' };
  // Credentials come from Settings → Data sources (public.integrations) first, Netlify env as the fallback.
  try { await applyFieldRoutesEnv(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })); } catch (e) { /* env fallback */ }
  if (frBase() && process.env.FIELDROUTES_AUTH_KEY) { fr.officeIDs = await require('../lib/integrations.js').frOfficeIds(fr); console.log('[fieldroutes] offices visible:', fr.officeIDs.length); }
  if (!frBase() || !process.env.FIELDROUTES_AUTH_KEY || !process.env.FIELDROUTES_AUTH_TOKEN) {
    console.log('[fr-live] FieldRoutes API env not set — skipping');
    return { statusCode: 200, body: 'fieldroutes env not set — skipped' };
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const { data: alRow } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
    const AL = Object.assign({ enabled: false, start: '2026-01-01', types: ['Office Staff', 'Sales Rep', 'Technician'], require_appt: true, require_billing: true, require_signed: true }, (alRow && alRow.value) || {});
    if (!AL.enabled) return { statusCode: 200, body: 'autolog disabled — skipped' };
    EXCLUDED_SVCS = await require('../lib/rules.js').loadNonSaleServices(supabase);
    const TYPES = new Set(Array.isArray(AL.types) && AL.types.length ? AL.types : Object.keys(QUEUE_OF));
    const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const START = String(AL.start || '2026-01-01').slice(0, 10);
    const from = since > START ? since : START;

    // 1. Which subscriptions were added since `from`?
    const search = await fr('subscription/search', { dateAdded: { operator: '>=', value: from } });
    const ids = (search.subscriptionIDs || []).map(String);
    if (!ids.length) { await recordIntegrationStatus(supabase, 'fieldroutes', { last_run_at: new Date().toISOString(), last_run_ok: true, last_run_message: 'no new subscriptions since ' + from, last_run_ms: Date.now() - started }); return { statusCode: 200, body: 'no new subscriptions' }; }

    // 2. Already logged? (either by this worker or the nightly pass)
    const { data: have } = await supabase.from('sales').select('crm_subscription_id').in('crm_subscription_id', ids);
    const haveSub = new Set((have || []).map(r => String(r.crm_subscription_id)));
    const fresh = ids.filter(id => !haveSub.has(id));
    // (Already-logged subs get their amounts trued up in step 3b.)

    // 3. Details + the people/lookups to attribute them.
    const subs = [];
    for (const part of chunk(fresh, 1000)) {
      const got = await fr('subscription/get', { subscriptionIDs: part.map(Number) });
      const list = Array.isArray(got.subscriptions) ? got.subscriptions : Object.values(got.subscriptions || {});
      subs.push(...list);
    }
    // Every sub seen this run (fresh + already logged), for the TV's live feed below.
    const liveSubs = new Map(subs.map(s => [String(s.subscriptionID), s]));
    const custIds = [...new Set(subs.map(s => String(s.customerID || '')).filter(Boolean))];
    const custById = new Map();
    for (const part of chunk(custIds, 1000)) {
      const got = await fr('customer/get', { customerIDs: part.map(Number) });
      const list = Array.isArray(got.customers) ? got.customers : Object.values(got.customers || {});
      list.forEach(c => custById.set(String(c.customerID), c));
    }
    // Signed agreements (customer-level e-sign docs in COMPLETED state). Best
    // effort: if the endpoint is unavailable nothing is treated as signed here —
    // the nightly RevHawk pass (which reads FieldRoutesContract) logs it then.
    const _anySigned = AL.require_signed !== false || Object.values(AL.approval || {}).some(a => a && a.signed);
    let signedAt = new Map();
    if (_anySigned) signedAt = await signedAtByCustomer(custIds);
    const signedCust = new Set([...signedAt.entries()].filter(([, d]) => d >= from).map(([c]) => c));   // signed within the window
    const [rosterQ, profQ, offQ, svcQ, srcQ, ctQ] = await Promise.all([
      supabase.from('fieldroutes_employees').select('employee_id, employee_ids, type_label, fname, lname'),
      supabase.from('profiles').select('id, fieldroutes_employee_id, office_id').not('fieldroutes_employee_id', 'is', null),
      supabase.from('offices').select('id, name'),
      supabase.from('service_types').select('id, name'),
      supabase.from('sources').select('id, name'),
      supabase.from('contract_types').select('id, name'),
    ]);
    // employee id (any of a person's branch ids) → profile + CRM type
    const masterOf = new Map(), typeOfEmp = new Map(), nameOfEmp = new Map();
    (rosterQ.data || []).forEach(e => {
      const idsAll = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
      const nm = [String(e.lname || '').trim(), String(e.fname || '').trim()].filter(Boolean).join(', ');   // "Last, First" like the snapshot
      idsAll.forEach(id => { masterOf.set(id, String(e.employee_id)); typeOfEmp.set(id, e.type_label || null); if (nm) nameOfEmp.set(id, nm); });
      typeOfEmp.set(String(e.employee_id), e.type_label || null); if (nm) nameOfEmp.set(String(e.employee_id), nm);
    });
    const profByEmp = new Map();
    (profQ.data || []).forEach(p => { const pid = String(p.fieldroutes_employee_id || '').trim(); if (pid) { profByEmp.set(pid, p); const m = masterOf.get(pid) || pid; if (!profByEmp.has(m)) profByEmp.set(m, p); } });
    (rosterQ.data || []).forEach(e => {
      const idsAll = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
      const hit = idsAll.map(id => profByEmp.get(id)).find(Boolean);
      if (hit) idsAll.forEach(id => { if (!profByEmp.has(id)) profByEmp.set(id, hit); });
    });
    const officeByFrId = new Map();   // FieldRoutes officeID → app office id (by name, via the offices table's names)
    const officeNameByFrId = new Map();   // FieldRoutes officeID → CRM office name (the TV live feed)
    const officeByName = new Map((offQ.data || []).map(o => [norm(o.name), o.id]));
    try {
      const og = await fr('office/get', {});
      const list = Array.isArray(og.offices) ? og.offices : Object.values(og.offices || {});
      list.forEach(o => { if (o.officeName) officeNameByFrId.set(String(o.officeID), String(o.officeName)); const id = officeByName.get(norm(o.officeName)); if (id) officeByFrId.set(String(o.officeID), id); });
    } catch (e) { console.warn('[fr-live] office lookup skipped:', e.message); }
    const svcByName = new Map((svcQ.data || []).map(o => [norm(o.name), o.id]));
    const srcByName = new Map((srcQ.data || []).map(o => [norm(o.name), o.id]));
    const ctByName = new Map((ctQ.data || []).map(o => [norm(o.name), o.id]));

    // 4. Build rows — same shape as the nightly auto-log.
    let added = 0, skippedNoRep = 0, skippedType = 0, skippedNotYet = 0, svcCreated = 0;
    const UNLINKED_OK = AL.log_unlinked !== false;   // Settings switch; default on
    const batch = [];
    const hasAppt = (s) => { const id = String(s.initialAppointmentID || '').trim(); return !!id && id !== '0'; };
    const hasBilling = (c) => { const a = String((c && (c.aPay || c.autoPay)) || '').trim().toLowerCase(); return !!a && !['no', '0', 'false', 'none', 'null'].includes(a); };
    const stamp = new Date().toISOString();
    for (const s of subs) {
      const subId = String(s.subscriptionID || '');
      const sub = String(s.serviceType || '').trim() || 'Unknown';
      if (EXCLUDED_SVCS.has(sub)) continue;
      const soldIso = String(s.dateAdded || '').slice(0, 10);
      if (!soldIso || soldIso < START) continue;
      const soldById = String(s.soldBy || '').trim();
      const type = typeOfEmp.get(soldById) || typeOfEmp.get(masterOf.get(soldById) || '') || null;
      if (!type || !TYPES.has(type)) { skippedType++; continue; }
      const prof = profByEmp.get(soldById) || profByEmp.get(masterOf.get(soldById) || '') || null;
      // No app account yet → logged anyway under the FieldRoutes seller (per Isaac, Oct 15); handed to the rep
      // the moment their account is linked (step 3c). Needs 20261015_sales_unlinked_sellers.sql.
      if (!prof) skippedNoRep++;
      if (!prof && (!soldById || !UNLINKED_OK)) continue;
      let svcId = svcByName.get(norm(sub));
      if (!svcId) {
        const ins = await supabase.from('service_types').insert({ name: sub }).select('id').maybeSingle();
        if (ins.data && ins.data.id) { svcId = ins.data.id; svcCreated++; svcByName.set(norm(sub), svcId); }
      }
      if (!svcId) continue;
      const cust = custById.get(String(s.customerID)) || {};
      // Every subscription lands (per Isaac); eligibility is stamped on the row.
      const _appt = hasAppt(s), _bill = hasBilling(cust), _signed = (signedAt.get(String(s.customerID)) || '') >= soldIso;   // signed on/after the sale
      if (!(_appt && _bill && _signed)) skippedNotYet++;
      const cv = Number(s.contractValue) || 0;
      // Straight from the subscription (per Isaac): Initial = FieldRoutes'
      // initial service total, Monthly = its recurring charge — no deriving.
      const initial = Number(s.initialServiceTotal) || 0;
      const months = Number(s.agreementLength) || 12;
      const monthly = Number(s.recurringCharge) > 0 ? Math.round(Number(s.recurringCharge) * 100) / 100 : Math.max(0, Math.round(((cv - initial) / 11) * 100) / 100);
      batch.push({
        rep_id: prof ? prof.id : null,
        ...(prof ? {} : { crm_seller_id: masterOf.get(soldById) || soldById, crm_seller_name: nameOfEmp.get(soldById) || nameOfEmp.get(masterOf.get(soldById) || '') || null }),
        queue_type: QUEUE_OF[type] || 'office',
        crm_subscription_id: subId,
        logged_by: null,
        customer_name: [String(cust.fname || '').trim(), String(cust.lname || '').trim()].filter(Boolean).join(' ') || ('Customer ' + s.customerID),
        customer_number: String(s.customerID),
        office_id: officeByFrId.get(String(s.officeID)) ?? (prof ? prof.office_id : null) ?? null,
        service_type_id: svcId,
        source_id: srcByName.get(norm(s.source)) ?? null,
        contract_type_id: ctByName.get(norm(months + ' Months')) ?? null,
        contract_months: months,
        initial_amount: initial,
        monthly_amount: monthly,
        num_services: null,
        pay_per_service: false,
        paid_in_full: cv > 0 && initial >= 0.9 * cv,
        is_commercial: false,
        revenue_amount: cv,
        sold_date: soldIso,
        commission_date: null,
        notes: 'Auto-added from FieldRoutes (live)',
        audit_status: 'pending',
        created_at: stamp,
        crm_status: 'verified', crm_contract_value: cv, crm_subscription: sub, crm_checked_at: stamp,
        crm_initial_status: _appt ? (String(s.initialStatusText || s.initialStatus || 'Pending')) : 'None',
        crm_autopay: _bill,
        crm_contract_state: _signed ? 'signed' : 'none',
      });
      added++;
    }
    for (const part of chunk(batch, 500)) {
      let { error } = await supabase.from('sales').insert(part);
      if (error && /rep_id|crm_seller/i.test(error.message || '')) {
        // Migration not run yet: drop the unlinked-seller rows, keep the rest (old behaviour).
        console.warn('[fr-live] unlinked sellers not logged (run migrations/20261015_sales_unlinked_sellers.sql):', error.message);
        const linked = part.filter(x => x.rep_id); ({ error } = linked.length ? await supabase.from('sales').insert(linked) : { error: null });
      }
      if (error && /crm_initial_status|crm_autopay|crm_contract_state/i.test(error.message || '')) {
        part.forEach(x => { delete x.crm_initial_status; delete x.crm_autopay; delete x.crm_contract_state; });
        ({ error } = await supabase.from('sales').insert(part));
      }
      if (error) {
        // A row the nightly pass logged between our check and insert trips the
        // unique index — retry one by one so the rest of the batch still lands.
        if (/duplicate|unique/i.test(error.message)) { for (const row of part) { await supabase.from('sales').insert(row); } }
        else throw new Error(error.message);
      }
    }
    // 3a. Appointment status for the subs we ALREADY have from the last two
    // days (per Isaac, Sep 22): the TV board only shows a sale once its initial
    // appointment is on the books, and the appointment is usually scheduled
    // minutes after the subscription is created — so re-read these every run
    // (one batched call) and flip crm_initial_status the moment it changes.
    let apptFlipped = 0;
    try {
      const known = ids.filter(id => haveSub.has(id));
      if (known.length) {
        const { data: cur } = await supabase.from('sales').select('id, crm_subscription_id, crm_initial_status').in('crm_subscription_id', known);
        const curBy = new Map((cur || []).map(r => [String(r.crm_subscription_id), r]));
        for (const part of chunk(known, 1000)) {
          const got = await fr('subscription/get', { subscriptionIDs: part.map(Number) });
          const list = Array.isArray(got.subscriptions) ? got.subscriptions : Object.values(got.subscriptions || {});
          for (const s of list) {
            liveSubs.set(String(s.subscriptionID), s);
            const row = curBy.get(String(s.subscriptionID)); if (!row) continue;
            const next = hasAppt(s) ? String(s.initialStatusText || s.initialStatus || 'Pending') : 'None';
            if (String(row.crm_initial_status || '') === next) continue;
            const { error } = await supabase.from('sales').update({ crm_initial_status: next, crm_checked_at: new Date().toISOString() }).eq('id', row.id);
            if (!error) apptFlipped++;
          }
        }
      }
    } catch (e) { console.warn('[fr-live] appointment refresh skipped:', e.message); }

    // 3a-1b. Initial = the first appointment on the plan BOOKED AFTER the sale (per Isaac, Oct 15) — any
    // appointment (not cancelled) added at/after the subscription's dateAdded, earliest date wins. Read straight
    // from FieldRoutes, since RevHawk only has a same-day appointment after a later pass. Stamps
    // crm_initial_appt_at (20260921_sales_initial_appt.sql); the RevHawk sync applies the same rule later.
    try {
      const subsW = [...liveSubs.values()];
      if (subsW.length) {
        const appts = [];
        for (const part of chunk(subsW.map(x => String(x.subscriptionID)), 500)) {
          const found = await fr('appointment/search', { subscriptionIDs: part.map(Number), dateAdded: { operator: '>=', value: from } });
          for (const ap of chunk((found.appointmentIDs || []).map(String), 500)) {
            const got = await fr('appointment/get', { appointmentIDs: ap.map(Number) });
            appts.push(...(Array.isArray(got.appointments) ? got.appointments : Object.values(got.appointments || {})));
          }
        }
        const firstAfter = new Map();
        for (const x of subsW) {
          const added = String(x.dateAdded || '').slice(0, 19);
          const mine = appts.filter(a => String(a.subscriptionID) === String(x.subscriptionID) && !['-1', '-2'].includes(String(a.status)) && a.date && !String(a.date).startsWith('0000')
            && String(a.dateAdded || '').slice(0, 19) >= added).map(a => String(a.date).slice(0, 10)).sort();
          if (mine.length) firstAfter.set(String(x.subscriptionID), mine[0]);
        }
        if (firstAfter.size) {
          const { data: rowsA } = await supabase.from('sales').select('id, crm_subscription_id, crm_initial_appt_at').in('crm_subscription_id', [...firstAfter.keys()]);
          for (const r of (rowsA || [])) {
            const day = firstAfter.get(String(r.crm_subscription_id));
            if (!day || String(r.crm_initial_appt_at || '').slice(0, 10) === day) continue;
            const { error } = await supabase.from('sales').update({ crm_initial_appt_at: day }).eq('id', r.id);
            if (error) { console.warn('[fr-live] initial appointment stamp skipped:', error.message); break; }
          }
        }
      }
    } catch (e) { console.warn('[fr-live] initial appointment dates skipped:', e.message); }

    // 3a-2. Signed-agreement refresh (per Isaac, Oct 13): a sale is stamped at
    // the moment the pull first sees it — almost always BEFORE the customer
    // signs — so re-check the last two days' unsigned rows every run and flip
    // them to signed the moment FieldRoutes has a COMPLETED e-sign document.
    let signFlipped = 0;
    const signedRecent = new Set(signedCust);   // every customer seen signed this run (first sight + re-check)
    if (_anySigned) {
      try {
        const known = ids.filter(id => haveSub.has(id));
        if (known.length) {
          const { data: cur } = await supabase.from('sales').select('id, crm_subscription_id, customer_number, crm_contract_state, sold_date').in('crm_subscription_id', known);
          const open = (cur || []).filter(r => String(r.crm_contract_state || '') !== 'signed' && r.customer_number);
          const openCust = [...new Set(open.map(r => String(r.customer_number)))];
          const reAt = await signedAtByCustomer(openCust);
          const done = new Set();
          open.forEach(r => { const d = reAt.get(String(r.customer_number)) || ''; if (d && d >= String(r.sold_date || '').slice(0, 10)) done.add(String(r.id)); });
          reAt.forEach((d, c) => { if (d >= from) signedRecent.add(c); });
          console.log('[fr-live] signed re-check: ' + open.length + ' unsigned row(s) · ' + done.size + ' signed on/after their sale');
          for (const r of open) {
            if (!done.has(String(r.id))) continue;
            const { error } = await supabase.from('sales').update({ crm_contract_state: 'signed', crm_checked_at: new Date().toISOString() }).eq('id', r.id);
            if (!error) signFlipped++;
          }
        }
      } catch (e) { console.warn('[fr-live] signed refresh skipped:', e.message); }
    }
    // Publish who signed (per Isaac, Oct 14 — #178104's One Time German Roach was
    // signed at 2:24 PM, but one-time / no-account sales are never logged as
    // app sales, so the TV only had the day-old snapshot to go on). The TV reads
    // this list for CRM sales with no app row. Written only when it changes.
    if (_anySigned) {
      try {
        const idsNow = [...signedRecent].sort();
        const { data: cur } = await supabase.from('app_settings').select('value').eq('key', 'crm_signed_recent').maybeSingle();
        const prev = (cur && cur.value && Array.isArray(cur.value.customer_ids)) ? cur.value.customer_ids : [];
        if (prev.join(',') !== idsNow.join(',')) await supabase.from('app_settings').upsert({ key: 'crm_signed_recent', value: { at: new Date().toISOString(), since: from, customer_ids: idsNow } });
      } catch (e) { console.warn('[fr-live] signed list not published:', e.message); }
    }

    // 3a-3. Live feed for the TV board (per Isaac, Oct 14: "move the tv display
    // to the 15 minute pull — as live as possible"). Every subscription added
    // in the window — including the one-time jobs, renewals and sellers with
    // no app account that never become app sales rows — in the same shape as
    // the Indicators feed's raw rows, plus the subscription id. The TV adds the
    // ones the RevHawk dataset doesn't have yet and refreshes the rest.
    // No customer names (app_settings is readable company-wide) — ids only.
    // Written only when it changes.
    let livePublished = 0;
    try {
      // Customers we haven't loaded yet (subs already logged in an earlier run).
      const needCust = [...new Set([...liveSubs.values()].map(s => String(s.customerID || '')).filter(id => id && !custById.has(id)))];
      for (const part of chunk(needCust, 1000)) {
        const got = await fr('customer/get', { customerIDs: part.map(Number) });
        const list = Array.isArray(got.customers) ? got.customers : Object.values(got.customers || {});
        list.forEach(c => custById.set(String(c.customerID), c));
      }
      const mmddyyyy = (str) => { const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/); return m ? (m[2] + '/' + m[3] + '/' + m[1] + (m[4] ? ' ' + m[4] : '')) : ''; };
      const rows = [];
      for (const s of liveSubs.values()) {
        const added = String(s.dateAdded || '');
        if (!added || added.startsWith('0000') || added.slice(0, 10) < from) continue;
        const cust = custById.get(String(s.customerID)) || {};
        const custOff = Number(cust.officeID) > 0 ? String(cust.officeID) : null;   // branch = the CUSTOMER's office (same rule as the nightly sync)
        const offId = custOff || String(s.officeID || '');
        const soldById = String(s.soldBy || '').trim();
        const done = String(s.completedAppointmentIDs || '').split(',').map(x => x.trim()).filter(x => x && x !== '0').length;
        const cancelled = String(s.dateCancelled || '');
        const activeText = String(s.activeText || (String(s.active) === '1' ? 'Active' : String(s.active) === '0' ? 'Inactive' : String(s.active) === '-1' ? 'Frozen' : ''));
        rows.push({
          subscriptionId: String(s.subscriptionID),
          customerId: String(s.customerID || ''),
          office: String(BRANCH_NAMES[offId] || officeNameByFrId.get(offId) || ('Office ' + offId)).toUpperCase(),
          subscription: String(s.serviceType || '').trim(),
          active: activeText,
          status: activeText,
          dateSold: mmddyyyy(added),
          soldAt: added.slice(0, 19),
          cancelDate: cancelled && !cancelled.startsWith('0000') ? cancelled.slice(0, 10) : '',
          initialStatus: (String(s.initialAppointmentID || '').trim() && String(s.initialAppointmentID) !== '0') ? String(s.initialStatusText || s.initialStatus || 'Pending') : 'No Appointment',
          services: done,
          source: String(s.source || '').trim(),
          contract: Number(s.agreementLength) || 0,
          initialPrice: Number(s.initialServiceTotal) || 0,
          contractValue: Number(s.contractValue) || 0,
          recurring: Number(s.annualRecurringValue) || 0,
          monthly: Number(s.recurringCharge) || 0,
          autoPay: String(cust.aPay || cust.autoPay || '').trim(),
          signed: signedRecent.has(String(s.customerID)),
          rep: nameOfEmp.get(soldById) || nameOfEmp.get(masterOf.get(soldById) || '') || '',
          repId: soldById,
          repType: typeOfEmp.get(soldById) || typeOfEmp.get(masterOf.get(soldById) || '') || '',
        });
      }
      rows.sort((a, b) => a.subscriptionId.localeCompare(b.subscriptionId));
      const { data: cur } = await supabase.from('app_settings').select('value').eq('key', 'crm_live_recent').maybeSingle();
      const prevRows = (cur && cur.value && Array.isArray(cur.value.rows)) ? cur.value.rows : null;
      if (JSON.stringify(prevRows) !== JSON.stringify(rows)) {
        const { error } = await supabase.from('app_settings').upsert({ key: 'crm_live_recent', value: { at: new Date().toISOString(), since: from, rows } });
        if (!error) livePublished = rows.length;
      }
    } catch (e) { console.warn('[fr-live] TV live feed not published:', e.message); }

    // 3c. Unlinked sellers → their rep (per Isaac, Oct 15): any sale logged under a FieldRoutes seller with no
    //     app account gets that person's rep_id (and office if blank) once their account is linked.
    let relinked = 0;
    try {
      const { data: orphan } = await supabase.from('sales').select('id, crm_seller_id, office_id').is('rep_id', null).not('crm_seller_id', 'is', null).limit(2000);
      for (const r of (orphan || [])) {
        const prof = profByEmp.get(String(r.crm_seller_id)) || profByEmp.get(masterOf.get(String(r.crm_seller_id)) || '') || null;
        if (!prof) continue;
        const { error } = await supabase.from('sales').update({ rep_id: prof.id, ...(r.office_id == null && prof.office_id != null ? { office_id: prof.office_id } : {}) }).eq('id', r.id);
        if (!error) relinked++;
      }
    } catch (e) { /* migration not run yet */ }

    // 3b. True-up: auto-added rows whose Initial / Monthly / Revenue drifted
    // from FieldRoutes (e.g. the old derived Monthly) get the CRM's numbers.
    // Runs over the 400 auto-added rows checked longest ago (all of this
    // year's book cycles through in a few hours at the 15-minute cadence).
    let fixed = 0;
    {
      try {
        const { data: rows } = await supabase.from('sales').select('id, crm_subscription_id, initial_amount, monthly_amount, revenue_amount, notes, commission_split')
          .gte('sold_date', START).not('crm_subscription_id', 'is', null).ilike('notes', '%auto-added from fieldroutes%')
          .order('crm_checked_at', { ascending: true, nullsFirst: true }).limit(400);
        const auto = (rows || []);
        const stampNow = new Date().toISOString();
        for (const part of chunk(auto.map(r => r.crm_subscription_id), 1000)) {
          const got = await fr('subscription/get', { subscriptionIDs: part.map(Number) });
          const list = Array.isArray(got.subscriptions) ? got.subscriptions : Object.values(got.subscriptions || {});
          for (const s of list) {
            const row = auto.find(r => String(r.crm_subscription_id) === String(s.subscriptionID));
            if (!row) continue;
            const cv = Number(s.contractValue) || 0;
            const initial = Number(s.initialServiceTotal) || 0;
            const monthly = Number(s.recurringCharge) > 0 ? Math.round(Number(s.recurringCharge) * 100) / 100 : Number(row.monthly_amount) || 0;
            const patch = {};
            if (Math.abs((Number(row.initial_amount) || 0) - initial) >= 0.01) patch.initial_amount = initial;
            if (Math.abs((Number(row.monthly_amount) || 0) - monthly) >= 0.01) patch.monthly_amount = monthly;
            // A row the add-ons sync split (base + own add-ons, fees out) keeps its commissionable revenue.
            if (cv > 0 && !row.commission_split && Math.abs((Number(row.revenue_amount) || 0) - cv) >= 0.01) patch.revenue_amount = cv;
            patch.crm_checked_at = stampNow;
            const { error } = await supabase.from('sales').update(patch).eq('id', row.id);
            if (!error && Object.keys(patch).length > 1) fixed++;
          }
        }
      } catch (e) { console.warn('[fr-live] true-up skipped:', e.message); }
    }
    const msg = '[fr-live] ' + ids.length + ' subs since ' + from + ' across ' + ((fr.officeIDs || []).length || 'the key’s home') + ' office(s) · +' + added + ' logged · ' + fixed + ' trued up · ' + apptFlipped + ' appt status changed · ' + signFlipped + ' newly signed · ' + (relinked ? relinked + ' handed to newly linked rep(s) · ' : '') + (livePublished ? livePublished + ' live row(s) published · ' : '') + skippedNoRep + ' seller(s) with no app account (logged unlinked) · ' + skippedType + ' skipped by type · ' + skippedNotYet + ' logged but not yet eligible (appt/billing/signed) · ' + svcCreated + ' service type(s) created · ' + (Date.now() - started) + 'ms';
    console.log(msg + (fr.rateLimited ? ' · ' + fr.rateLimited + ' rate-limited retr' + (fr.rateLimited === 1 ? 'y' : 'ies') : ''));
    await recordIntegrationStatus(supabase, 'fieldroutes', { last_run_at: new Date().toISOString(), last_run_ok: true, last_run_message: msg.replace('[fr-live] ', ''), last_run_ms: Date.now() - started, rate_limited: fr.rateLimited || 0 });
    return { statusCode: 200, body: msg };
  } catch (e) {
    console.error('[fr-live]', e);
    await recordIntegrationStatus(supabase, 'fieldroutes', { last_run_at: new Date().toISOString(), last_run_ok: false, last_run_message: String((e && e.message) || e).slice(0, 300) });
    return { statusCode: 500, body: String((e && e.message) || e) };
  }
};
