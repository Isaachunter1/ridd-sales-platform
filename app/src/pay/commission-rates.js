// ┌─ src/99-commission-rates-and-misc.js ─────────────────────────────────────────────────────
// │ Commission rates, avatar cropper, icons, module registry, boot.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// Look up the commission rate for a sale based on:
//   1. Contract type rate (from Pricing settings)
//   2. Volume tier override (if rep's YTD revenue crosses a threshold)
//   3. Per-rep bump (from Users settings)
//   4. Status multiplier: serviced = 100%, below_minimums = configurable (default 50%)
function getCommissionRate(repId, sale) {
  const s = effectivePaySettings(repId);
  const BASE = 0.07;
  const profile = state.allProfiles.find(p => p.id === repId) || state.profile;

  // Contract-type base upfront rate for this sale.
  const contractRate = () => {
    if (sale?.contract_type_id && s.contract_commissions) {
      const cc = s.contract_commissions.find(c => c.contract_type_id === sale.contract_type_id);
      if (cc) return cc.rate / 100;
    }
    return BASE;
  };

  // 1. Base rate (Paid-in-Full / Commercial overrides, else contract type).
  let baseRate = BASE;
  if (sale?.paid_in_full) {
    // Paid-in-Full (sheet O32): the contract base + a flat +5pt modifier —
    // 7% + 5% = 12% on ANY term. PIF accounts still earn the multi-year and
    // close-rate backend at quarter end like any other subscription (their
    // revenue sits in the same sheet columns those formulas sum).
    baseRate = contractRate() + (Number(s.pif_modifier ?? 5) / 100);
  } else if (sale?.is_commercial) {
    // Commercial (per Isaac): HALF of whatever THIS rep's upfront % is —
    // not a flat rate. Multiplier lives in Settings → Commissions (default 50%).
    const repUpfront = Number(profile?.upfront_commission_rate || BASE);
    const rate0 = repUpfront * ((Number(s.commercial_multiplier ?? 50)) / 100);
    let rate = rate0;
    if (sale?.audit_status === 'below_minimums') rate *= (s.below_min_multiplier ?? 50) / 100;
    return Math.round(rate * 10000) / 10000;
  } else if (sale?.contract_type_id && s.contract_commissions) {
    baseRate = contractRate();
  }

  // 2. Volume tier override (if any)
  const tiers = (s.commission_tiers || []).slice().sort((a, b) => b.min_revenue - a.min_revenue);
  if (tiers.length) {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
    const ytdRev = state.allSales
      .filter(sl => sl.rep_id === repId && !EXCLUDE.has(sl.audit_status) && new Date(sl.sold_date + 'T00:00') >= yearStart)
      .reduce((a, sl) => a + Number(sl.revenue_amount || 0), 0);
    for (const t of tiers) {
      if (ytdRev >= t.min_revenue) {
        baseRate = Math.max(baseRate, t.rate / 100); // tier overrides if higher
        break;
      }
    }
  }

  // 3. Per-rep bump — measured against the rep's EFFECTIVE standard rate
  //    (their Upfront % override when they have one), so an override never
  //    double-counts with the legacy per-profile upfront rate.
  const _std = (() => { const c = (s.contract_commissions || []).find(cc => /month/i.test(cc.name) && !/upsell|one\s*time/i.test(cc.name)); return c ? Number(c.rate) / 100 : BASE; })();
  const bump = Math.max(0, Number(profile?.upfront_commission_rate || _std) - _std);
  let rate = baseRate + bump;

  // 4. Status multiplier
  if (sale?.audit_status === 'below_minimums') {
    const mult = (s.below_min_multiplier ?? 50) / 100;
    rate = rate * mult;
  }

  return Math.round(rate * 10000) / 10000;
}

// ── Pay settings defaults + one-time spreadsheet alignment ────────────────
// Ensures every pay-related setting exists with the IS PAY sheet defaults,
// and (once) migrates untouched 7% legacy defaults to the sheet's actual
// rates: PIF 12%, Commercial 5%, OTS 5%, Upsells 10%. Values an admin has
// already changed away from 7.0 are left alone.
function ensurePaySettings() {
  const s = state.appSettings || (state.appSettings = {});

  // Renewal sources pay a flat $ per account by contract term (sheet: rows
  // 25-28 × $25/$30/$35/$35), not a % of revenue.
  s.renewal_flat = s.renewal_flat || { m12: 25, m18: 30, m24: 35, pif: 35 };

  // Backend pay rates (sheet O16/O18): 18mo ×2% + 24mo ×3%; renewal
  // revenue ×2% at quarter end.
  s.multi_year_rate_18   = s.multi_year_rate_18   ?? 2.0;
  s.multi_year_rate_24   = s.multi_year_rate_24   ?? 3.0;
  s.renewal_backend_rate = s.renewal_backend_rate ?? 2.0;

  // Close-rate bonus tiers (sheet O17 array formula): ≥60% → 3% of
  // subscription revenue, ≥50% → 2%, else $0. Ordered high→low.
  s.close_rate_tiers = s.close_rate_tiers || [
    { min_close_rate: 60, rate: 3.0 },
    { min_close_rate: 50, rate: 2.0 },
  ];

  // PIF modifier (sheet O32): Paid-in-Full pays the contract base + a flat
  // +5 points (7% + 5% = 12% on any term). PIF accounts STILL earn the
  // multi-year + close-rate backend like any other subscription.
  s.pif_modifier = s.pif_modifier ?? 5.0;

  // Charge-upfront tier (sheet O29-O31): % of commissionable accounts
  // where payment was collected upfront -> pays this % of the WHOLE
  // upfront commission. >=70% -> 100 · >=50% -> 95 · >=35% -> 90 · else 85.
  s.upfront_tiers = s.upfront_tiers || [
    { min: 70, pay: 100 },
    { min: 50, pay: 95 },
    { min: 35, pay: 90 },
    { min: 0,  pay: 85 },
  ];

  // One-time migration to the sheet's contract rates. Only rewrites values
  // still sitting at the legacy 7.0 default so admin overrides survive.
  if (!s.sheet_defaults_v1) {
    if (s.paid_in_full_rate == null || s.paid_in_full_rate === 7.0) s.paid_in_full_rate = 12.0;
    if (s.commercial_rate   == null || s.commercial_rate   === 7.0) s.commercial_rate   = 5.0;
    const validCtIds = new Set(state.contractTypes.map(ct => ct.id));
    if (!s.contract_commissions) {
      s.contract_commissions = state.contractTypes.map(ct => ({ contract_type_id: ct.id, name: ct.name, rate: 7.0 }));
    } else {
      s.contract_commissions = s.contract_commissions.filter(cc => validCtIds.has(cc.contract_type_id));
    }
    for (const cc of s.contract_commissions) {
      if (cc.rate !== 7.0) continue;
      if (/^upsell/i.test(cc.name))            cc.rate = 10.0;
      else if (/one time/i.test(cc.name))      cc.rate = 5.0;
    }
    s.sheet_defaults_v1 = true;
    saveDemoData();
  }
  // v2 (Sales_Loyalty Reporting sheet, Sep 2026): commercial modifier is
  // -(base × 0.5) = -3.5pts, so commercial pays 3.5% (was 5%). Only rewrites
  // the untouched default so an admin override survives.
  if (!s.sheet_defaults_v2) {
    if (s.commercial_rate === 5.0) s.commercial_rate = 3.5;
    s.sheet_defaults_v2 = true;
    saveDemoData();
  }
  return s;
}

// Is this sale from a renewal source? (Sources are managed in Settings →
// Sources; tagging a source as Renewal switches its pay to flat $/account.)
function isRenewalSource(sale) {
  if (!sale?.source_id) return false;
  const src = state.sources.find(o => o.id === sale.source_id);
  return sourceIsRenewal(src);
}
// ONE renewal rule for pay, dashboards and reporting (settings audit, Sep 30):
// the source's Revenue Type in Configurations → Lead sources (admin override,
// else the name — "…Renewal…"). The old sources.is_renewal flag only mirrored
// the name and ignored the override, so Office Staff pay and reporting could
// disagree about the same source.
function sourceIsRenewal(src) {
  if (!src) return false;
  const nm = String(src.name || '').trim();
  if (typeof reportingSourceClass === 'function' && nm) return reportingSourceClass(nm) === 'renewal';
  return !!src.is_renewal;
}

// ── Per-rep overrides (per Isaac): Settings → Commissions holds the
// DEFAULTS; a rep's profile.pay_overrides holds only the metrics that differ.
// effectivePaySettings(repId) = defaults with that rep's overrides applied —
// the ONLY thing the pay engine should read when a rep is known.
function payOverridesFor(repId) {
  const p = repId ? (state.allProfiles || []).find(x => x.id === repId) : null;
  const o = p && p.pay_overrides;
  return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
}
function hasPayOverrides(repId) { return Object.keys(payOverridesFor(repId)).length > 0; }
function effectivePaySettings(repId) {
  const base = ensurePaySettings();
  const o = payOverridesFor(repId);
  if (!Object.keys(o).length) return base;
  const e = Object.assign({}, base);
  const isStd = (cc) => /month/i.test(cc.name) && !/upsell|one\s*time/i.test(cc.name);
  if (o.upfront_pct != null || o.ots_rate != null || o.upsell_rate != null) {
    e.contract_commissions = (base.contract_commissions || []).map(cc => {
      const c = Object.assign({}, cc);
      if (isStd(cc) && o.upfront_pct != null) c.rate = Number(o.upfront_pct);
      else if (/one\s*time/i.test(cc.name) && o.ots_rate != null) c.rate = Number(o.ots_rate);
      else if (/upsell/i.test(cc.name) && o.upsell_rate != null) c.rate = Number(o.upsell_rate);
      return c;
    });
  }
  if (o.close_min != null || o.close_rate != null || o.close2_min != null || o.close2_rate != null) {
    e.close_rate_tiers = (base.close_rate_tiers || []).map(t => Object.assign({}, t));
    if (e.close_rate_tiers[0]) { if (o.close_min != null) e.close_rate_tiers[0].min_close_rate = Number(o.close_min); if (o.close_rate != null) e.close_rate_tiers[0].rate = Number(o.close_rate); }
    if (e.close_rate_tiers[1]) { if (o.close2_min != null) e.close_rate_tiers[1].min_close_rate = Number(o.close2_min); if (o.close2_rate != null) e.close_rate_tiers[1].rate = Number(o.close2_rate); }
  }
  if (Array.isArray(o.upfront_tiers) && o.upfront_tiers.length) e.upfront_tiers = o.upfront_tiers.map(t => Object.assign({}, t));
  if (o.renewal_flat && typeof o.renewal_flat === 'object') e.renewal_flat = Object.assign({}, base.renewal_flat || {}, o.renewal_flat);
  for (const k of ['pif_modifier', 'commercial_multiplier', 'below_min_multiplier', 'multi_year_rate_18', 'multi_year_rate_24', 'renewal_backend_rate']) if (o[k] != null) e[k] = Number(o[k]);
  return e;
}

// Flat renewal pay for a sale by contract term (sheet: $25/12mo, $30/18mo,
// $35/24mo, $35/PIF). Terms outside those buckets pay $0 — same as the
// sheet, which has no renewal column for upsell/commercial/OTS.
function renewalFlatFor(sale, s) {
  const flat = (s || effectivePaySettings(sale && sale.rep_id)).renewal_flat;
  // Sheet pays renewals BY TERM ($25/$30/$35) — a PIF renewal earns its
  // term's flat, not a special rate. flat.pif only covers term-less PIFs.
  const m = Number(sale?.contract_months);
  if (m === 12) return Number(flat.m12 || 0);
  if (m === 18) return Number(flat.m18 || 0);
  if (m === 24) return Number(flat.m24 || 0);
  if (sale?.paid_in_full) return Number(flat.pif || 0);
  return 0;
}

// Per-sale upfront commission in dollars. This is the single entry point
// for all pay math — renewal sources pay flat $/account, everything else
// pays revenue × getCommissionRate. Below Minimums halves either one
// (via the configurable multiplier). New sources added in Settings →
// Sources flow through automatically: standard % unless tagged Renewal.
function getCommissionAmount(repId, sale) {
  const s = effectivePaySettings(repId);
  const addonPay = getAddonCommission(repId, sale);   // add-ons: flat upfront % (Oct 2026) — never the base rate, never backend
  if (isRenewalSource(sale)) {
    let amt = renewalFlatFor(sale, s);
    if (sale?.audit_status === 'below_minimums') amt *= (s.below_min_multiplier ?? 50) / 100;
    return amt + addonPay;
  }
  return saleAddonSplit(sale).base * getCommissionRate(repId, sale) + addonPay;
}
// ── Base plan vs add-ons (per Isaac, Oct 6 2026) ─────────────────────────
// RIDD sells five base plans (Pest, Rodent, Mosquito, Termite, Mole) and
// everything else as an add-on ticket item. Pay follows that split:
//   Inside Sales  base plan = the standard structure, unchanged (upfront % +
//                 backend + close-rate bonus) · add-ons = a flat % upfront only
//   D2D Sales     base plan = the rep's own tiered rate · add-ons = a share of it
//   Technicians   base plan and add-ons = a flat % each
// Rates live in adminRules.addonPay (Configurations → Auto-log → Upsells).
// lock_invoices (per Isaac, Oct 6): an Inside Sales / Technician add-on LOCKS
// once this many invoices carrying it have been paid; if it comes off (or
// the account cancels) before that, the upfront pay is owed back. D2D
// add-ons don't count invoices — they follow the season lock date instead
// (the add-on must still be on the account at the lock).
const ADDON_PAY_DEFAULTS = { office_rate: 10, d2d_share: 50, tech_rate: 25, lock_invoices: 4 };
function addonPayRules() {
  const r = (typeof _adminRules === 'function') ? _adminRules() : null;
  return Object.assign({}, ADDON_PAY_DEFAULTS, (r && r.addonPay) || {});
}
function setAddonPayRules(patch) { _setAdminRule('addonPay', Object.assign({}, addonPayRules(), patch)); }
// One sales row → how much of its commissionable revenue is the BASE plan and
// how much is ADD-ONS credited to the same rep. The add-ons sync writes the
// split on the row (commission_split lines; revenue_amount = base + the rep's
// own add-ons, fees excluded). An add-on sold on its own is an 'upsell' row
// tied to an add_ons record — all add-on. Rows with no split are all base.
function saleAddonSplit(sale) {
  const rev = Number(sale?.revenue_amount || 0);
  if (!sale) return { base: 0, addon: 0 };
  if (sale.sale_kind === 'upsell' && sale.add_on_id != null) return { base: 0, addon: rev };
  const lines = Array.isArray(sale.commission_split) ? sale.commission_split : null;
  if (lines && lines.some(l => l && l.kind === 'base') && lines.some(l => l && l.kind === 'addon')) {
    // Service fees paid to the seller (per Isaac, Oct 17 — the sync marks them paid) count as PLAN revenue, not add-on.
    const baseV = lines.filter(l => l && (l.kind === 'base' || (l.kind === 'fee' && l.paid))).reduce((a, l) => a + (Number(l.kind === 'fee' ? l.paid_value : l.value) || 0), 0);
    const base = Math.max(0, Math.min(rev, baseV));
    return { base, addon: Math.max(0, Math.round((rev - base) * 100) / 100) };
  }
  return { base: rev, addon: 0 };
}
// Inside Sales add-on pay for one row: add-on revenue × the flat upfront %.
function getAddonCommission(repId, sale) {
  const a = saleAddonSplit(sale).addon;
  if (!(a > 0)) return 0;
  // An add-on that dropped before it locked earns nothing on a row that hasn't been paid yet.
  // (Already-paid rows keep their history; the Pay tab's Add-ons card lists what is owed back.)
  if (sale && sale.add_on_id != null && !sale.payroll_processed_at && typeof addOnOfSale === 'function') {
    const ao = addOnOfSale(sale);
    if (ao && addOnDropped(ao)) return 0;
  }
  // Below Minimums halves whatever the rule would pay — the add-on slice included (per Isaac, Oct 6).
  const _bm = (sale && sale.audit_status === 'below_minimums') ? (Number(effectivePaySettings(repId).below_min_multiplier ?? 50) / 100) : 1;
  return a * (Number(addonPayRules().office_rate) || 0) / 100 * _bm;
}
// Where an add-on stands on the stay-on rule.
function addOnDropped(a) { return !!a && a.streak_status !== 'locked' && (a.streak_status === 'broken' || a.streak_status === 'clawback' || !!a.removed_at); }
function addOnLockLabel(a) {
  if (!a) return '';
  const need = Math.max(1, Number(addonPayRules().lock_invoices) || 4);
  if (a.credited_role === 'sales_rep') return a.removed_at ? 'Came off \u2014 must be on at the lock date' : 'On \u2014 pays if still on at the lock date';
  if (a.streak_status === 'locked' || (Number(a.invoices_paid) || 0) >= need) return 'Locked';
  if (addOnDropped(a)) return 'Dropped at ' + (a.invoices_paid || 0) + ' of ' + need + (a.streak_status === 'clawback' ? ' \u2014 owed back' : '');
  return (a.invoices_paid || 0) + ' of ' + need + ' paid';
}
// Upfront pay for a set of staged rows: the base-plan commission rides the
// charge-upfront tier multiplier; add-on pay is flat and does not.
function sumUpfrontPay(repId, sales, mult) {
  let t = 0;
  for (const s of (sales || [])) { const add = getAddonCommission(repId, s); const m = (mult == null || passedAuditExempt(s)) ? 1 : mult; t += (getCommissionAmount(repId, s) - add) * m + add; }
  return t;
}
// Add-on helpers shared by the D2D engine + dashboards (state.addOns = the add_ons table).
function addOnAnnualValue(a) { return Math.round((Number(a && a.recurring_amount) || 0) * 12 * 100) / 100; }   // per-service charge × 12, same as the sync's line value
function addOnsBySubscription() {
  const all = Array.isArray(state.addOns) ? state.addOns : [];
  const M = addOnsBySubscription._m;
  if (M && M.src === all) return M.map;
  const map = new Map();
  for (const a of all) { if (!a || a.removed_at) continue; const k = String(a.subscription_id || ''); if (!k) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(a); }
  addOnsBySubscription._m = { src: all, map };
  return map;
}

// Per-sale backend pay in dollars (quarter-end). Sheet rules: standard
// sources earn 18mo ×2% / 24mo ×3% of revenue; renewal-source serviced
// revenue earns the renewal backend rate. PIF rows are included (they sit
// in the same sheet columns the multi-year formula sums).
function getBackendAmount(sale) {
  const s = effectivePaySettings(sale && sale.rep_id);
  const rev = saleAddonSplit(sale).base;   // backend is earned on the base plan only — add-ons are upfront-only (Oct 2026)
  // (PIF used to skip backend — the sheet's multi-year sums include PIF
  // rows, so PIF earns 18/24-month backend like everything else now.)
  if (isRenewalSource(sale)) return rev * (Number(s.renewal_backend_rate) / 100);
  const m = Number(sale?.contract_months);
  if (m === 18) return rev * (Number(s.multi_year_rate_18) / 100);
  if (m === 24) return rev * (Number(s.multi_year_rate_24) / 100);
  return 0;
}

// Close-rate bonus: highest tier whose threshold the rep's close rate
// meets, applied to subscription revenue (serviced 12/18/24/PIF revenue
// from standard sources — no commercial, OTS, upsells, or renewals).
function closeRateBonusFor(closeRate, subscriptionRevenue, repId) {
  return subscriptionRevenue * (closeRateTierPct(closeRate, repId ? effectivePaySettings(repId) : null) / 100);
}

// The close-rate bonus PERCENTAGE for a given close rate — the highest tier
// whose threshold the close rate meets. Used both for the live bonus and for
// the Paid-in-Full upfront estimate (which assumes a 50% close rate).
function closeRateTierPct(closeRate, s) {
  s = s || ensurePaySettings();
  const tiers = (s.close_rate_tiers || []).slice().sort((a, b) => b.min_close_rate - a.min_close_rate);
  for (const t of tiers) {
    if (closeRate * 100 >= Number(t.min_close_rate)) return Number(t.rate);
  }
  return 0;
}

// ── Charge-upfront tier (sheet O29-O31) ──────────────────────────────────
// % of commissionable accounts (serviced + below-min; renewal sources and
// upsell contract types don't count either way) where payment was collected
// upfront. The tier multiplies the WHOLE upfront commission.
function _isUpsellContract(sale) {
  const ct = (state.contractTypes || []).find(c => c.id === sale?.contract_type_id);
  return !!ct && /^(d2d |office )?upsell/i.test(String(ct.name || ''));
}
// Passed Audit % pool (per Isaac, Sep 30 — same idea as the Sales Rep Audit %):
// EVERY account the rep sold in the pay period counts in the denominator —
// passed, failed audit and not-audited-yet alike — not just the staged ones.
// (A failed-audit account is held out of staging for review, so a staged-only
// pool quietly left it out and inflated the %.) Pre-service cancels are out.
// The numerator stays the FieldRoutes Passed Audit flag (upfront_collected).
function passedAuditPool(repId, period) {
  if (!period) return [];
  return (state.allSales || []).filter(s => {
    if (String(s.rep_id) !== String(repId) || s.audit_status === 'cancelled') return false;
    const d = new Date(String(s.sold_date || '').slice(0, 10) + 'T00:00');
    return !isNaN(d) && d >= period.start && d <= period.end;
  });
}
// Sentricon accounts, add-ons and renewals don't need the Passed Audit flag (per Isaac, Oct 15): they're out
// of the Passed Audit % AND their pay isn't multiplied by the Passed Audit tier.
function passedAuditExempt(x) {
  if (!x) return false;
  if (isRenewalSource(x) || _isUpsellContract(x) || x.sale_kind === 'upsell') return true;
  const ct = (state.serviceTypes || []).find(t => t.id === x.service_type_id);
  return (!!ct && /sentricon/i.test(String(ct.name || ''))) || /sentricon/i.test(String(x._crmService || '')) || /sentricon/i.test(String(x.crm_subscription || ''));
}
function upfrontCollectedPct(sales) {
  // Rollout guard: until the "Charged Upfront" flag is actually in use
  // anywhere (old sales all default to false), the tier stays at 100% —
  // otherwise history that predates the flag would dock everyone to 85%.
  const anyFlagged = (state.allSales || []).some(x => !!x.upfront_collected)
    || (state.mySales || []).some(x => !!x.upfront_collected);
  if (!anyFlagged) return null;
  // Sentricon is excluded from the charge-upfront denominator (rep pay tab
  // C29 filters "<>Sentricon - Retreat") — termite jobs bill differently.
  // Per Isaac (Oct 15): Passed Audit doesn't count for Sentricon accounts, add-ons or renewals — they don't
  // need the flag, so they're out of the % entirely. Add-ons include the add-ons sync's rows (sale_kind
  // 'upsell'), and Sentricon is also read off the CRM plan name.
  const eligible = (sales || []).filter(x => !passedAuditExempt(x));
  if (!eligible.length) return null;   // nothing eligible — no tier penalty
  return eligible.filter(x => !!x.upfront_collected).length / eligible.length;
}
function upfrontTierPayPct(pct, repId) {
  if (pct == null) return 1;
  const s = repId ? effectivePaySettings(repId) : ensurePaySettings();
  const tiers = (s.upfront_tiers || []).slice().sort((a, b) => Number(b.min) - Number(a.min));
  for (const t of tiers) if (pct * 100 >= Number(t.min)) return Number(t.pay) / 100;
  return 1;
}

// Subscription revenue for a set of sales (sheet O8): 12/18/24-month or
// PIF contracts from standard (non-renewal) sources, excluding commercial.
function subscriptionRevenueOf(sales) {
  return sales.reduce((a, s) => {
    if (isRenewalSource(s)) return a;   // (commercial rows COUNT — sheet's E:G sums include them)
    const m = Number(s.contract_months);
    if (s.paid_in_full || m === 12 || m === 18 || m === 24) return a + saleAddonSplit(s).base;   // base plan only — the close-rate bonus doesn't ride add-ons
    return a;
  }, 0);
}

// (adminBackup removed — unreferenced; settings audit, Sep 30)

