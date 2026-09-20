'use strict';
// ════════════════════════════════════════════════════════════════════════
// UPSELL RECORD SHAPE (AUDIT P3-6) — the ONE place a FieldRoutes ticket
// line item becomes an app `sales` row (sale_kind 'upsell'). Pure: no I/O,
// no Supabase. revhawk-sync-background.js resolves the lookups (profiles,
// service types, offices) and calls these; tools/upsell-test.js pins the
// shape with fixtures so the upcoming upsell build can't drift it silently.
//
//   ticket (warehouse row, items JSON)  ──upsellCandidates──▶  candidates
//   candidate + resolved ids            ──upsellSaleRow────▶  sales row
// ════════════════════════════════════════════════════════════════════════

// Which line items count as an upsell: the admin's configured service
// terms (substring, case-insensitive) or, with none configured, anything
// named add-on / upsell.
function makeIsAddOn(upsellServices) {
  const terms = (Array.isArray(upsellServices) ? upsellServices : []).map(x => String(x).toLowerCase()).filter(Boolean);
  return (name) => { const n = String(name || '').toLowerCase(); return terms.length ? terms.some(t => n.includes(t)) : /add[- ]?on|upsell/.test(n); };
}

// One candidate per qualifying line item. `items` may be a JSON string, an
// array, or an object keyed by index. Unparseable items JSON → no
// candidates for that ticket (never a throw). Keys are read defensively —
// FieldRoutes' items shape isn't pinned in the warehouse yet.
function upsellCandidates(ticket, isAddOn) {
  const out = [];
  let items = [];
  try {
    const raw = ticket.items;
    const j = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw || []);
    items = Array.isArray(j) ? j : Object.values(j || {});
  } catch (e) { return out; }
  items.forEach((it, idx) => {
    if (!it || typeof it !== 'object') return;
    const name = String(it.description || it.name || it.item || it.itemName || '').trim();
    if (!name || !isAddOn(name)) return;
    const qty = Number(it.quantity || it.qty || 1) || 1;
    const price = Number(it.total ?? it.amount ?? it.price ?? it.charge ?? 0) || 0;
    const amount = Math.round(price * (it.total != null ? 1 : qty) * 100) / 100;
    if (amount <= 0) return;
    const by = String(it.employeeID || it.soldBy || it.salesRep || it.assignedTo || ticket.created_by || '').trim();
    out.push({ ...ticket, ticket_id: String(ticket.ticket_id) + ':' + idx, service: name, total: amount, created_by: by });
  });
  return out;
}

const QUEUE_OF_TYPE = { '0': 'office', '2': 'd2d', '1': 'tech' };

// The `sales` row for one candidate. `ctx` carries what the sync resolved:
//   repId (profile id of the creator — required), officeId (may be null),
//   serviceTypeId (may be null), now (ISO timestamp for created_at / crm_checked_at).
function upsellSaleRow(t, ctx) {
  const tid = String(t.ticket_id || '').trim();
  const svcName = String(t.service || '').trim() || 'Add-on';
  const total = Math.round((Number(t.total) || 0) * 100) / 100;
  const now = ctx.now || new Date().toISOString();
  return {
    rep_id: ctx.repId, logged_by: null,
    sale_kind: 'upsell', crm_ticket_id: tid, parent_subscription_id: String(t.subscription_id || '') || null,
    queue_type: QUEUE_OF_TYPE[String(t.created_by_type || '')] || 'office',
    customer_name: [String(t.first_name || '').trim(), String(t.last_name || '').trim()].filter(Boolean).join(' ') || ('Customer ' + t.customer_id),
    customer_number: String(t.customer_id || ''),
    office_id: ctx.officeId ?? null,
    service_type_id: ctx.serviceTypeId || null,
    contract_months: 0, initial_amount: total, monthly_amount: 0, num_services: null, pay_per_service: false,
    paid_in_full: true, is_commercial: false, revenue_amount: total,
    sold_date: String(t.created || '').slice(0, 10), commission_date: null,
    notes: 'Auto-added upsell (add-on item) from FieldRoutes ticket #' + tid.split(':')[0],
    audit_status: 'pending', created_at: now,
    crm_status: 'verified', crm_contract_value: total, crm_subscription: svcName, crm_checked_at: now,
  };
}

module.exports = { makeIsAddOn, upsellCandidates, upsellSaleRow, QUEUE_OF_TYPE };
