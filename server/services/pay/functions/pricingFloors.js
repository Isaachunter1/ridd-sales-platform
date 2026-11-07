// ┌─ pricingFloors ───────────────────────────────────────────────────────────
// │ The pricing rules every sale is scored against (per Isaac, Nov 7 2026).
// │ Pure: no I/O. The job (jobs/pricing-floors.js) fetches the rows; this file
// │ decides. Pinned by test/pricing-floors.test.js — change the rule, change
// │ the test.
// │
// │ Two floors per plan and per add-on, both from Configurations → Pricing
// │ minimums (app_settings.autolog.pricing):
// │   Standard  — a cent under it = Below Minimums (half upfront, full backend)
// │   Loyalty   — a cent under it = Not Payable (nothing, upfront or backend)
// │ Inside Sales (office) may sell at Loyalty pricing, so for them the Loyalty
// │ floor is the Not Payable line. Sales Reps and Technicians must sell at
// │ Standard — under it is Not Payable outright.
// │ Termite has no Loyalty sheet: Loyalty = Standard.
// │ The initial: one floor ($39, Configurations) — under it is Not Payable.
// │ Add-ons: the Pricing tab's Standard / Loyalty monthly, initial floor $0.
// │ Renewals: compared to the Loyalty sheet; under it is grandfathered pricing
// │ or a mistake — flagged for an auditor, never scored.
// │ No sheet for the plan or add-on → flagged for an auditor.
// │ No signed contract (one-time services exempt) → Not Payable, reversible:
// │ the moment the e-sign completes the sale goes back to Pending and the sync
// │ approves it as Commissionable or Below Minimums.
// │ Sold-together rule: an add-on sold the same day as the base plan drags the
// │ base sale to the add-on's verdict when that is worse. An add-on sold later
// │ is scored on its own; the original sale keeps what it earned.
// │ Everything a rule touches that Isaac wants eyes on carries a flag text.
// └────────────────────────────────────────────────────────────────────────

export const SEVERITY = { ok: 0, flagged_for_audit: 1, below_minimums: 2, not_payable: 3 };

const DEF_STD = { pest: [49, 69, 119], rodent: [49, 69, 119], mole: [69, 89, 139], mosquito: [69, 89, 139] };
const DEF_LOY = { pest: [29, 49, 99], rodent: [29, 49, 99], mole: [49, 69, 119], mosquito: [49, 69, 119] };
// Add-ons [Standard, Loyalty] per service — the Pricing tab's slicks (app/src/admin/pricing.js), Nov 2026.
const DEF_ADDONS = { mole: [40, 30], tfm: [40, 30], seasonal: [30, 15], roach: [20, 10], flea: [20, 10], pest: [20, 10], snake: [20, 10], cbee: [20, 10], rodent: [20, 10] };
export const ADDON_LABEL = { mole: 'Mole', tfm: 'Tick, Flea & Mosquito', seasonal: 'Seasonal Tick, Flea & Mosquito', roach: 'German Roach', flea: 'Interior Flea', pest: 'Pest', snake: 'Snake', cbee: 'Carpenter Bee', rodent: 'Rodent' };

const num = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
const under = (v, floor) => floor > 0 && Number.isFinite(v) && v < floor - 0.001;

// app_settings.autolog → the floors, with the Pricing tab's numbers as defaults.
export function floorConfig(autolog) {
  const PR = Object.assign({ initial_min: 39, fee: 4.87 }, (autolog && autolog.pricing) || {});
  const F = Object.assign({ start: '2027-01-01', unsigned_grace_days: 0 }, PR.floors || {});
  const std = { plans: Object.assign({}, DEF_STD, PR.plans || {}), termite: Object.assign({ initial: 399, recurring: 29 }, PR.termite || {}) };
  // Loyalty = the renewal sheet (same numbers, one place to edit); termite Loyalty = Standard unless set.
  const RN = PR.renewal || {};
  const loy = { plans: Object.assign({}, DEF_LOY, RN.plans || {}), termite: Object.assign({}, std.termite, RN.termite || {}) };
  const addons = {};
  for (const k of Object.keys(DEF_ADDONS)) { const v = (F.addons || {})[k]; addons[k] = Array.isArray(v) && v.length === 2 ? [num(v[0], DEF_ADDONS[k][0]), num(v[1], DEF_ADDONS[k][1])] : DEF_ADDONS[k].slice(); }
  return {
    start: /^\d{4}-\d{2}-\d{2}$/.test(String(F.start || '')) ? String(F.start) : '2027-01-01',
    unsignedGraceDays: Math.max(0, num(F.unsigned_grace_days, 0)),
    initialMin: num(PR.initial_min, 39),
    fee: num(PR.fee, 4.87),
    std, loy, addons,
    addonInitialMin: num(F.addon_initial_min, 0),
  };
}

// Which add-on a ticket line / service name is (null = no sheet for it).
export function matchAddon(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  if (/seasonal/.test(n)) return 'seasonal';
  if (/tick|mosquito|\btfm\b/.test(n)) return 'tfm';
  if (/mole/.test(n)) return 'mole';
  if (/roach/.test(n)) return 'roach';
  if (/flea/.test(n)) return 'flea';
  if (/snake/.test(n)) return 'snake';
  if (/carpenter|\bcbee\b|\bbee/.test(n)) return 'cbee';
  if (/rodent|mouse|mice|rat\b/.test(n)) return 'rodent';
  if (/pest|spider|ant\b|wasp/.test(n)) return 'pest';
  return null;
}

export const isOneTime = (name, months) => /^one[\s-]*time\b/i.test(String(name || '')) || (months != null && Number(months) <= 0 && !/^(pest|rodent|mole|mosquito|termite)/i.test(String(name || '')));
export const isRenewal = (sub) => /renew/i.test(String((sub && sub.subscription_source) || '') + ' ' + String((sub && sub.lead_source) || ''));

// Recurring charge with the service fee taken off when the charge carries it (same cents) — the sync's rule.
export function recurringNet(charge, fee) {
  const rc = num(charge, 0);
  const hasFee = fee > 0 && rc >= fee && Math.round(rc * 100) % 100 === Math.round(fee * 100) % 100;
  return hasFee ? Math.round((rc - fee) * 100) / 100 : rc;
}

function worse(a, b) { return SEVERITY[b.status] > SEVERITY[a.status] ? b : a; }
function merge(target, add) {
  const out = worse(target, add);
  const reasons = [...new Set([...(target.reasons || []), ...(add.reasons || [])])];
  const flags = [...new Set([...(target.flags || []), ...(add.flags || [])])];
  return { status: out.status, reasons, flags };
}
const OK = () => ({ status: 'ok', reasons: [], flags: [] });

// Score a BASE plan's prices. tier: 'office' (Loyalty allowed) | 'field' (Standard required).
export function scorePlan({ name, initial, recurring, renewal, tier }, cfg) {
  const nm = String(name || '').trim();
  const r = OK();
  if (isOneTime(nm)) return r;   // one-time services keep the sync's own current-customer rule
  let stdRec, loyRec, stdInit, loyInit, m;
  if ((m = nm.match(/^(pest|rodent|mole|mosquito)\s+(4|6|12)\b/i))) {
    const i = { 4: 0, 6: 1, 12: 2 }[m[2]], k = m[1].toLowerCase();
    stdRec = num((cfg.std.plans[k] || [])[i], 0); loyRec = num((cfg.loy.plans[k] || [])[i], 0);
    stdInit = loyInit = renewal ? 0 : cfg.initialMin;
  } else if (/^termite\b/i.test(nm)) {
    stdRec = num(cfg.std.termite.recurring, 0); loyRec = num(cfg.loy.termite.recurring, stdRec);
    stdInit = num(cfg.std.termite.initial, 0); loyInit = num(cfg.loy.termite.initial, stdInit);
    if (renewal) stdInit = loyInit = 0;
  } else {
    return { status: 'flagged_for_audit', reasons: [], flags: ['No pricing sheet for "' + nm + '" — price it by hand'] };
  }
  const rec = recurringNet(recurring, cfg.fee), init = num(initial, NaN);
  if (renewal) {
    // Renewals: the Loyalty sheet. Under it = grandfathered pricing or a mistake — an auditor decides.
    if (under(rec, loyRec)) return { status: 'flagged_for_audit', reasons: [], flags: ['Renewal recurring ' + money(rec) + ' < Loyalty ' + money(loyRec) + ' — grandfathered pricing?'] };
    return r;
  }
  if (under(init, Math.min(stdInit, loyInit) || stdInit)) r.status = 'not_payable', r.reasons.push('Initial ' + money(init) + ' < ' + money(Math.min(stdInit, loyInit) || stdInit));
  if (tier === 'field') {
    if (under(rec, stdRec)) return merge(r, { status: 'not_payable', reasons: ['Recurring ' + money(rec) + ' < Standard ' + money(stdRec) + ' (Sales Reps and Technicians sell at Standard)'], flags: [] });
    return r;
  }
  if (under(rec, loyRec)) return merge(r, { status: 'not_payable', reasons: ['Recurring ' + money(rec) + ' < Loyalty ' + money(loyRec)], flags: [] });
  if (under(rec, stdRec)) return merge(r, { status: 'below_minimums', reasons: ['Recurring ' + money(rec) + ' < Standard ' + money(stdRec) + ' (Loyalty pricing)'], flags: [] });
  return r;
}

// Score an ADD-ON (upsell sale row: one ticket line, one amount).
export function scoreAddon({ name, amount, tier }, cfg) {
  const key = matchAddon(name);
  if (!key) return { status: 'flagged_for_audit', reasons: [], flags: ['No add-on price for "' + String(name || '').trim() + '" — price it by hand'] };
  const [std, loy] = cfg.addons[key];
  const amt = num(amount, NaN), lbl = ADDON_LABEL[key];
  if (tier === 'field') {
    if (under(amt, std)) return { status: 'not_payable', reasons: [lbl + ' add-on ' + money(amt) + ' < Standard ' + money(std) + ' (Sales Reps and Technicians sell at Standard)'], flags: [] };
    return OK();
  }
  if (under(amt, loy)) return { status: 'not_payable', reasons: [lbl + ' add-on ' + money(amt) + ' < Loyalty ' + money(loy)], flags: [] };
  if (under(amt, std)) return { status: 'below_minimums', reasons: [lbl + ' add-on ' + money(amt) + ' < Standard ' + money(std) + ' (Loyalty pricing)'], flags: [] };
  return OK();
}

// The signed-contract rule. scheduled = an initial appointment on the books (pending / completed).
export function scoreContract({ contractState, scheduled, oneTime, daysSinceSale }, cfg) {
  if (oneTime || String(contractState || '') === 'signed') return OK();
  const out = OK();
  if (scheduled) out.flags.push('Scheduled without a signed contract');
  if (daysSinceSale != null && daysSinceSale < cfg.unsignedGraceDays) return out;
  out.status = 'not_payable';
  out.reasons.push(String(contractState || '') === 'sent' ? 'Agreement sent, not signed' : 'No signed contract');
  return out;
}

export const tierOf = (queueType) => (String(queueType || 'office') === 'office' ? 'office' : 'field');

// One sale, all rules. sale = the app row (+ its BigQuery subscription row as sale.sub for base plans);
// sameDayAddons = upsell rows on the same customer sold the same day (base plans only).
export function scoreSale(sale, cfg, sameDayAddons = []) {
  const tier = tierOf(sale.queue_type);
  const upsell = String(sale.sale_kind || 'sale') === 'upsell';
  const name = String(sale.crm_subscription || '').trim();
  const oneTime = !upsell && isOneTime(name, sale.contract_months);
  const days = sale.sold_date ? Math.floor((Date.parse(String(cfg.today || new Date().toISOString().slice(0, 10))) - Date.parse(String(sale.sold_date).slice(0, 10))) / 86400000) : null;
  let r = OK();
  if (!upsell) {
    r = merge(r, scoreContract({ contractState: sale.crm_contract_state, scheduled: ['pending', 'completed'].includes(String(sale.crm_initial_status || '').trim().toLowerCase()), oneTime, daysSinceSale: days }, cfg));
    const sub = sale.sub || null;
    if (sub) r = merge(r, scorePlan({ name: sub.subscription || name, initial: sub.initial_price, recurring: sub.recurring_charge, renewal: isRenewal(sub), tier }, cfg));
    for (const a of sameDayAddons) {
      const ar = scoreAddon({ name: a.crm_subscription, amount: a.revenue_amount, tier }, cfg);
      if (SEVERITY[ar.status] > SEVERITY[r.status] && ar.status !== 'flagged_for_audit') {
        r = merge(r, { status: ar.status, reasons: ar.reasons.map(x => 'Sold with it: ' + x), flags: ['Add-on sold the same day pulled this account to ' + (ar.status === 'not_payable' ? 'Not Payable' : 'Below Minimums') + ' — check'] });
      }
    }
  } else {
    r = merge(r, scoreAddon({ name, amount: sale.revenue_amount, tier }, cfg));
  }
  return r;
}

// What to write for a sale given its current row and the score. null = nothing to do.
// Only this job's own decisions are reversed (status_set_by = 'pricing-floors'); a manual pick or the sync's own
// Below Minimums is left alone. A reversal goes back to Pending so the sync approves it on its next pass.
export function planUpdate(sale, score, stamp) {
  const cur = String(sale.audit_status || 'pending');
  const mine = String(sale.status_set_by || '') === 'pricing-floors';
  if (String(sale.status_set_by || '') === 'manual') return null;
  if (!['pending', 'serviced', 'below_minimums', 'not_payable', 'flagged_for_audit'].includes(cur)) return null;
  const flag = score.flags.length ? score.flags.join(' · ') : null;
  const reason = score.reasons.length ? score.reasons.join(' · ') : null;
  const upd = {};
  if (score.status === 'ok') {
    if (mine && cur !== 'pending' && cur !== 'serviced') {
      upd.audit_status = 'pending'; upd.status_set_by = null; upd.audited_at = null; upd.payroll_skipped_at = null;
      upd.notes = ((sale.notes || '') + ' · Auto: pricing — back to Pending' + (cur === 'not_payable' && String(sale.crm_contract_state || '') === 'signed' ? ' (contract signed)' : '')).trim();
    }
    if ((sale.audit_flag || null) !== flag && (mine || sale.audit_flag_by === 'pricing-floors' || flag)) { upd.audit_flag = flag; upd.audit_flag_by = flag ? 'pricing-floors' : null; }
    if (mine && sale.crm_below_min && cur !== 'below_minimums') upd.crm_below_min = null;
    return Object.keys(upd).length ? upd : null;
  }
  if (score.status !== cur) {
    // Never demote a sale the sync already approved to a milder status: Commissionable → Below Minimums / Not Payable only.
    if (cur === 'serviced' && score.status === 'flagged_for_audit') { /* keep the approval, carry the flag */ }
    else {
      upd.audit_status = score.status; upd.status_set_by = 'pricing-floors'; upd.audited_at = stamp;
      upd.notes = ((sale.notes || '') + ' · Auto: pricing — ' + ({ not_payable: 'Not Payable', below_minimums: 'Below Minimums', flagged_for_audit: 'Flagged for audit' })[score.status] + (reason ? ' — ' + reason : '') + (flag && !reason ? ' — ' + flag : '')).trim();
      if (score.status !== 'not_payable') upd.payroll_skipped_at = null;
    }
  }
  // The reason shown on the row (crm_below_min, the sync's column) — only on this job's own decisions, so the
  // sync's own Below Minimums reason is never rewritten back and forth.
  if (upd.audit_status || mine) { const bm = (score.status === 'below_minimums' || score.status === 'not_payable') ? reason : null; if ((sale.crm_below_min || null) !== bm) upd.crm_below_min = bm; }
  if ((sale.audit_flag || null) !== flag) { upd.audit_flag = flag; upd.audit_flag_by = flag ? 'pricing-floors' : null; }
  return Object.keys(upd).length ? upd : null;
}
