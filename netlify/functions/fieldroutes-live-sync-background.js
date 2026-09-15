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

const EXCLUDED_SVCS = new Set(['ACH Chargeback', 'Early Cancellation Fee', 'German Roach Initial', 'Rodent Station Removal']);
const QUEUE_OF = { 'Office Staff': 'office', 'Sales Rep': 'd2d', 'Technician': 'tech' };
const TYPE_LABEL = { '0': 'Office Staff', '1': 'Technician', '2': 'Sales Rep' };

function frBase() {
  const sub = (process.env.FIELDROUTES_SUBDOMAIN || '').trim();
  return sub ? 'https://' + sub + '.pestroutes.com/api/' : null;
}
async function fr(endpoint, params) {
  const base = frBase();
  const q = new URLSearchParams({
    authenticationKey: process.env.FIELDROUTES_AUTH_KEY || '',
    authenticationToken: process.env.FIELDROUTES_AUTH_TOKEN || '',
  });
  for (const [k, v] of Object.entries(params || {})) q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const res = await fetch(base + endpoint + '?' + q.toString());
  const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch (e) { throw new Error(endpoint + ': non-JSON response (' + res.status + '): ' + txt.slice(0, 120)); }
  if (json.success === false || (json.errorMessage && json.errorMessage !== '')) throw new Error(endpoint + ': ' + (json.errorMessage || 'request failed'));
  return json;
}
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const norm = (x) => String(x || '').trim().toLowerCase();

exports.handler = async (event) => {
  const started = Date.now();
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required' };
  if (!frBase() || !process.env.FIELDROUTES_AUTH_KEY || !process.env.FIELDROUTES_AUTH_TOKEN) {
    console.log('[fr-live] FieldRoutes API env not set — skipping');
    return { statusCode: 200, body: 'fieldroutes env not set — skipped' };
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const { data: alRow } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
    const AL = Object.assign({ enabled: false, start: '2026-01-01', types: ['Office Staff', 'Sales Rep', 'Technician'] }, (alRow && alRow.value) || {});
    if (!AL.enabled) return { statusCode: 200, body: 'autolog disabled — skipped' };
    const TYPES = new Set(Array.isArray(AL.types) && AL.types.length ? AL.types : Object.keys(QUEUE_OF));
    const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const START = String(AL.start || '2026-01-01').slice(0, 10);
    const from = since > START ? since : START;

    // 1. Which subscriptions were added since `from`?
    const search = await fr('subscription/search', { dateAdded: { operator: '>=', value: from } });
    const ids = (search.subscriptionIDs || []).map(String);
    if (!ids.length) return { statusCode: 200, body: 'no new subscriptions' };

    // 2. Already logged? (either by this worker or the nightly pass)
    const { data: have } = await supabase.from('sales').select('crm_subscription_id').in('crm_subscription_id', ids);
    const haveSub = new Set((have || []).map(r => String(r.crm_subscription_id)));
    const fresh = ids.filter(id => !haveSub.has(id));
    if (!fresh.length) return { statusCode: 200, body: ids.length + ' subscriptions, all logged' };

    // 3. Details + the people/lookups to attribute them.
    const subs = [];
    for (const part of chunk(fresh, 1000)) {
      const got = await fr('subscription/get', { subscriptionIDs: part.map(Number) });
      const list = Array.isArray(got.subscriptions) ? got.subscriptions : Object.values(got.subscriptions || {});
      subs.push(...list);
    }
    const custIds = [...new Set(subs.map(s => String(s.customerID || '')).filter(Boolean))];
    const custById = new Map();
    for (const part of chunk(custIds, 1000)) {
      const got = await fr('customer/get', { customerIDs: part.map(Number) });
      const list = Array.isArray(got.customers) ? got.customers : Object.values(got.customers || {});
      list.forEach(c => custById.set(String(c.customerID), c));
    }
    const [rosterQ, profQ, offQ, svcQ, srcQ, ctQ] = await Promise.all([
      supabase.from('fieldroutes_employees').select('employee_id, employee_ids, type_label'),
      supabase.from('profiles').select('id, fieldroutes_employee_id, office_id').not('fieldroutes_employee_id', 'is', null),
      supabase.from('offices').select('id, name'),
      supabase.from('service_types').select('id, name'),
      supabase.from('sources').select('id, name'),
      supabase.from('contract_types').select('id, name'),
    ]);
    // employee id (any of a person's branch ids) → profile + CRM type
    const masterOf = new Map(), typeOfEmp = new Map();
    (rosterQ.data || []).forEach(e => {
      const idsAll = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
      idsAll.forEach(id => { masterOf.set(id, String(e.employee_id)); typeOfEmp.set(id, e.type_label || null); });
      typeOfEmp.set(String(e.employee_id), e.type_label || null);
    });
    const profByEmp = new Map();
    (profQ.data || []).forEach(p => { const pid = String(p.fieldroutes_employee_id || '').trim(); if (pid) { profByEmp.set(pid, p); const m = masterOf.get(pid) || pid; if (!profByEmp.has(m)) profByEmp.set(m, p); } });
    (rosterQ.data || []).forEach(e => {
      const idsAll = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
      const hit = idsAll.map(id => profByEmp.get(id)).find(Boolean);
      if (hit) idsAll.forEach(id => { if (!profByEmp.has(id)) profByEmp.set(id, hit); });
    });
    const officeByFrId = new Map();   // FieldRoutes officeID → app office id (by name, via the offices table's names)
    const officeByName = new Map((offQ.data || []).map(o => [norm(o.name), o.id]));
    try {
      const og = await fr('office/get', {});
      const list = Array.isArray(og.offices) ? og.offices : Object.values(og.offices || {});
      list.forEach(o => { const id = officeByName.get(norm(o.officeName)); if (id) officeByFrId.set(String(o.officeID), id); });
    } catch (e) { console.warn('[fr-live] office lookup skipped:', e.message); }
    const svcByName = new Map((svcQ.data || []).map(o => [norm(o.name), o.id]));
    const srcByName = new Map((srcQ.data || []).map(o => [norm(o.name), o.id]));
    const ctByName = new Map((ctQ.data || []).map(o => [norm(o.name), o.id]));

    // 4. Build rows — same shape as the nightly auto-log.
    let added = 0, skippedNoRep = 0, skippedType = 0, svcCreated = 0;
    const batch = [];
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
      if (!prof) { skippedNoRep++; continue; }
      let svcId = svcByName.get(norm(sub));
      if (!svcId) {
        const ins = await supabase.from('service_types').insert({ name: sub }).select('id').maybeSingle();
        if (ins.data && ins.data.id) { svcId = ins.data.id; svcCreated++; svcByName.set(norm(sub), svcId); }
      }
      if (!svcId) continue;
      const cust = custById.get(String(s.customerID)) || {};
      const cv = Number(s.contractValue) || 0;
      const initial = Number(s.initialServiceTotal) || 0;
      const months = Number(s.agreementLength) || 12;
      const monthly = Math.max(0, Math.round(((cv - initial) / 11) * 100) / 100);
      batch.push({
        rep_id: prof.id,
        queue_type: QUEUE_OF[type] || 'office',
        crm_subscription_id: subId,
        logged_by: null,
        customer_name: [String(cust.fname || '').trim(), String(cust.lname || '').trim()].filter(Boolean).join(' ') || ('Customer ' + s.customerID),
        customer_number: String(s.customerID),
        office_id: officeByFrId.get(String(s.officeID)) ?? prof.office_id ?? null,
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
      });
      added++;
    }
    for (const part of chunk(batch, 500)) {
      const { error } = await supabase.from('sales').insert(part);
      if (error) {
        // A row the nightly pass logged between our check and insert trips the
        // unique index — retry one by one so the rest of the batch still lands.
        if (/duplicate|unique/i.test(error.message)) { for (const row of part) { await supabase.from('sales').insert(row); } }
        else throw new Error(error.message);
      }
    }
    const msg = '[fr-live] ' + ids.length + ' subs since ' + from + ' · +' + added + ' logged · ' + skippedNoRep + ' seller(s) with no app account · ' + skippedType + ' skipped by type · ' + svcCreated + ' service type(s) created · ' + (Date.now() - started) + 'ms';
    console.log(msg);
    return { statusCode: 200, body: msg };
  } catch (e) {
    console.error('[fr-live]', e);
    return { statusCode: 500, body: String((e && e.message) || e) };
  }
};
