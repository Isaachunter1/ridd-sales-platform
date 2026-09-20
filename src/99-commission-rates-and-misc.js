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
  return !!src?.is_renewal;
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
  if (isRenewalSource(sale)) {
    let amt = renewalFlatFor(sale, s);
    if (sale?.audit_status === 'below_minimums') amt *= (s.below_min_multiplier ?? 50) / 100;
    return amt;
  }
  return Number(sale?.revenue_amount || 0) * getCommissionRate(repId, sale);
}

// Per-sale backend pay in dollars (quarter-end). Sheet rules: standard
// sources earn 18mo ×2% / 24mo ×3% of revenue; renewal-source serviced
// revenue earns the renewal backend rate. PIF rows are included (they sit
// in the same sheet columns the multi-year formula sums).
function getBackendAmount(sale) {
  const s = effectivePaySettings(sale && sale.rep_id);
  const rev = Number(sale?.revenue_amount || 0);
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
function upfrontCollectedPct(sales) {
  // Rollout guard: until the "Charged Upfront" flag is actually in use
  // anywhere (old sales all default to false), the tier stays at 100% —
  // otherwise history that predates the flag would dock everyone to 85%.
  const anyFlagged = (state.allSales || []).some(x => !!x.upfront_collected)
    || (state.mySales || []).some(x => !!x.upfront_collected);
  if (!anyFlagged) return null;
  // Sentricon is excluded from the charge-upfront denominator (rep pay tab
  // C29 filters "<>Sentricon - Retreat") — termite jobs bill differently.
  const _isSentricon = (x) => { const ct = (state.serviceTypes || []).find(t => t.id === x?.service_type_id); return !!ct && /sentricon/i.test(String(ct.name || '')) || /sentricon/i.test(String(x?._crmService || '')); };
  const eligible = (sales || []).filter(x => !isRenewalSource(x) && !_isUpsellContract(x) && !_isSentricon(x));
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
    if (s.paid_in_full || m === 12 || m === 18 || m === 24) return a + Number(s.revenue_amount || 0);
    return a;
  }, 0);
}

function adminBackup() {
  const log = state.auditLog || [];

  // Action label + chip-style mapping. Keep this exhaustive so every new
  // logActivity call rolls up to a readable badge here without having to
  // touch the table each time.
  const ACTION_META = {
    sale_logged:               { label: 'Logged',        bg: 'rgba(223,100,58,.12)', fg: '#DF643A' },
    sale_edited:               { label: 'Edited',        bg: 'rgba(223,100,58,.15)', fg: '#A9441F' },
    audit:                     { label: 'Audited',       bg: 'rgba(156,63,30,.10)',  fg: '#A9441F' },
    staged:                    { label: 'Staged',        bg: 'rgba(95,108,91,.10)', fg: '#5F6C5B' },
    payroll_processed:         { label: 'Processed',     bg: 'rgba(223,100,58,.18)', fg: '#DF643A' },
    backend_payroll_processed: { label: 'Backend Paid',  bg: 'rgba(61,122,102,.18)', fg: '#5F6C5B' },
    lock_status_changed:       { label: 'Lock',          bg: 'rgba(200,85,46,.18)',  fg: '#C8552E' },
    audit2_assigned:           { label: 'Auditor 2',     bg: 'rgba(147,51,234,.12)', fg: '#7E22CE' },
    slack_dm_sent:             { label: 'Slack DM',      bg: 'rgba(74,21,75,.14)',   fg: '#7E22CE' },
    slack_post:                { label: 'Slack Post',    bg: 'rgba(95,108,91,.14)', fg: '#5F6C5B' },
    indicators_upload:         { label: 'Indicators CSV',bg: 'rgba(156,63,30,.12)', fg: '#9C3F1E' },
    report_upload:             { label: 'Report Upload', bg: 'rgba(61,122,102,.14)', fg: '#5F6C5B' },
    user_edited:               { label: 'User',          bg: 'rgba(223,100,58,.15)', fg: '#A9441F' },
    team_change:               { label: 'Teams',         bg: 'rgba(95,108,91,.12)', fg: '#5F6C5B' },
    comp_change:               { label: 'Comp',          bg: 'rgba(156,63,30,.12)',   fg: '#9C3F1E' },
    config_change:             { label: 'Config',        bg: 'rgba(95,108,91,.18)',fg: '#5F6C5B' },
    snapshot_change:           { label: 'Snapshot',      bg: 'rgba(156,63,30,.12)',  fg: '#A9441F' },
  };

  if (state._activityLogSearch == null) state._activityLogSearch = '';
  if (state._activityLogAction == null) state._activityLogAction = 'all';
  const q = state._activityLogSearch.trim().toLowerCase();
  const actionFilter = state._activityLogAction;

  // Map a sale (live) → which Sales-tab queue it currently lives in. Mirrors
  // the predicates in viewSales so this stays in sync with the actual nav.
  const TAB_META = {
    'Sales':     { bg: 'rgba(223,100,58,.15)', fg: '#DF643A' },
    'Pending':   { bg: 'rgba(156,63,30,.12)',  fg: '#A9441F' },
    'Cancelled': { bg: 'rgba(220,38,38,.12)',  fg: '#B91C1C' },
    'History':   { bg: 'rgba(95,108,91,.18)', fg: 'var(--text-muted)' },
  };
  const tabFromSale = (sale) => {
    if (!sale) return null;
    const lock = sale.lock_status || 'pending';
    if ((lock === 'lock' || lock === 'chargeback') && sale.backend_payroll_processed_at) return 'History';
    if (sale.audit_status === 'cancelled') return 'Cancelled';
    if (sale.audit_status === 'not_payable' || sale.audit_status === 'reschedule') return 'History';
    if (sale.audit_status === 'pending') return 'Pending';
    return 'Sales';
  };
  const tabFromEntry = (entry) => {
    if (entry.sale_id != null) {
      const sale = state.allSales.find(s => s.id === entry.sale_id)
                || state.mySales.find(s => s.id === entry.sale_id);
      if (sale) return tabFromSale(sale);
    }
    // Fallback when the sale's been hard-deleted or we only have the log row.
    const ns = (entry.new_status || '').toLowerCase();
    if (ns === 'cancelled') return 'Cancelled';
    if (ns === 'pending') return 'Pending';
    if (ns === 'deleted' || ns === 'not_payable' || ns === 'reschedule') return 'History';
    if (entry.action === 'backend_payroll_processed') return 'History';
    return 'Sales';
  };

  // Filter pipeline: action filter first (cheap), then text query against
  // sale ID, customer name, rep name, by_user, formatted status, and the
  // live tab bucket so a search for "history" finds settled sales.
  // Drill-down (per Isaac): the log opens as a list of USERS; picking one
  // shows that user's entries. `state._activityLogUser` is the drill key.
  const drillUser = state._activityLogUser || null;
  const userKey = (e) => (e.by_user || '').trim() || 'Unknown';
  const filtered = log.filter(e => {
    if (drillUser && userKey(e) !== drillUser) return false;
    if (actionFilter !== 'all' && e.action !== actionFilter) return false;
    if (!q) return true;
    const hay = [
      e.sale_id != null ? '#' + e.sale_id : '',
      e.customer_name || '',
      e.rep_name || '',
      e.by_user || '',
      e.old_status || '',
      e.new_status || '',
      e.detail || '',
      tabFromEntry(e) || '',
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const visible = filtered.slice(0, 200);

  // ── Users roll-up (default view) ──
  const byUser = new Map();
  for (const e of log) {
    const k = userKey(e);
    let u = byUser.get(k);
    if (!u) { u = { name: k, n: 0, last: 0, actions: new Map() }; byUser.set(k, u); }
    u.n += 1;
    const ts = new Date(e.timestamp).getTime() || 0;
    if (ts > u.last) u.last = ts;
    u.actions.set(e.action, (u.actions.get(e.action) || 0) + 1);
  }
  const users = [...byUser.values()]
    .filter(u => !q || u.name.toLowerCase().includes(q))
    .sort((a, b) => b.last - a.last);
  const fmtWhen = (ms) => { if (!ms) return '—'; const t = new Date(ms); return t.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) + ' ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const usersTable = el('div', { class: 'scroll-x', style: { maxHeight: '480px', overflowY: 'auto' } },
    el('table', { class: 'w-full text-[12px]' },
      el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- sticky top-0', style: { background: 'var(--card)' } },
        el('tr', {},
          el('th', { class: 'text-left pl-5 pr-2 py-2 font-semibold' }, 'User'),
          el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Entries'),
          el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Last activity'),
          el('th', { class: 'text-left pl-2 pr-5 py-2 font-semibold' }, 'Top actions'))),
      el('tbody', {},
        users.length === 0 ? el('tr', {}, el('td', { class: 'p-6 text-center text-muted- text-sm italic', colspan: 4 }, 'No users match your search.')) : null,
        ...users.map(u => el('tr', {
          class: 'border-t border- cursor-pointer hover:brightness-95 transition',
          title: 'View ' + u.name + '\u2019s activity',
          onclick: () => { state._activityLogUser = u.name; state._activityLogSearch = ''; state._activityLogAction = 'all'; mountApp(); },
        },
          el('td', { class: 'pl-5 pr-2 py-2 font-semibold whitespace-nowrap' }, u.name + ' \u203a'),
          el('td', { class: 'px-2 py-2 tabular-nums' }, fmt.int(u.n)),
          el('td', { class: 'px-2 py-2 text-muted- tabular-nums whitespace-nowrap' }, fmtWhen(u.last)),
          el('td', { class: 'pl-2 pr-5 py-2 whitespace-nowrap' },
            ...[...u.actions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => {
              const meta = ACTION_META[k] || { label: k, bg: 'rgba(95,108,91,.18)', fg: 'var(--text-muted)' };
              return el('span', { class: 'chip mr-1', style: { background: meta.bg, color: meta.fg } }, meta.label + ' \u00d7' + n);
            })))))));

  return el('div', { class: 'flex flex-col gap-5' },
    el('h2', { class: 'text-xl font-bold' }, 'Activity Log'),

    // ── Activity Log ──
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center gap-3 flex-wrap' },
          drillUser && el('button', {
            class: 'text-[11px] font-semibold px-2.5 py-1 rounded-lg border',
            style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
            onclick: () => { state._activityLogUser = null; state._activityLogSearch = ''; state._activityLogAction = 'all'; mountApp(); },
          }, '\u2190 All users'),
          el('h3', { class: 'text-sm font-bold' }, drillUser ? drillUser : 'Users'),
          el('span', { class: 'text-[11px] text-muted-' },
            drillUser
              ? ((q || actionFilter !== 'all') ? filtered.length + ' of ' + log.filter(e => userKey(e) === drillUser).length + ' match' : filtered.length + ' entr' + (filtered.length === 1 ? 'y' : 'ies'))
              : byUser.size + ' user' + (byUser.size === 1 ? '' : 's') + ' \u00b7 ' + log.length + ' entr' + (log.length === 1 ? 'y' : 'ies'),
          ),
        ),
        log.length > 0 && el('button', {
          class: 'text-xs text-muted- hover:text-red-500 transition',
          onclick: () => {
            if (!confirm('Clear the entire activity log? This cannot be undone.')) return;
            state.auditLog = []; saveDemoData(); mountApp();
          },
        }, 'Clear log'),
      ),

      // Search + action filter row
      log.length > 0 && el('div', { class: 'px-5 py-3 border-b flex items-center gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'relative flex-1 min-w-[220px]' },
          el('input', {
            type: 'text',
            placeholder: drillUser ? 'Search by customer, sale ID (#42), or rep…' : 'Search users…',
            value: state._activityLogSearch,
            class: 'w-full rounded-lg border pl-8 pr-3 py-2 text-xs',
            style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' },
            oninput: (e) => {
              state._activityLogSearch = e.target.value;
              // Re-render lazily so typing doesn't lag — debounce via rAF.
              if (state._activityLogRaf) cancelAnimationFrame(state._activityLogRaf);
              state._activityLogRaf = requestAnimationFrame(() => mountApp());
            },
          }),
          el('span', { class: 'absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-', style: { pointerEvents: 'none', fontSize: '12px' } }, '🔍'),
          state._activityLogSearch && el('button', {
            class: 'absolute right-2 top-1/2 -translate-y-1/2 text-muted- hover:text-red-500 text-base leading-none',
            onclick: () => { state._activityLogSearch = ''; mountApp(); },
            title: 'Clear',
          }, '×'),
        ),
        drillUser && el('select', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
          style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' },
          onchange: (e) => { state._activityLogAction = e.target.value; mountApp(); },
        },
          el('option', { value: 'all', selected: actionFilter === 'all' }, 'All actions'),
          ...Object.entries(ACTION_META).map(([k, m]) =>
            el('option', { value: k, selected: actionFilter === k }, m.label)),
        ),
      ),

      log.length === 0
        ? el('div', { class: 'p-6 text-center text-muted- text-sm' }, 'No activity yet.')
        : !drillUser
        ? usersTable
        : visible.length === 0
          ? el('div', { class: 'p-6 text-center text-muted- text-sm italic' }, 'No entries match your search.')
          : el('div', { class: 'scroll-x', style: { maxHeight: '480px', overflowY: 'auto' } },
              el('table', { class: 'w-full text-[12px]' },
                el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- sticky top-0', style: { background: 'var(--card)' } },
                  el('tr', {},
                    el('th', { class: 'text-left pl-5 pr-2 py-2 font-semibold' }, 'Time'),
                    el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Action'),
                    el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Sale'),
                    el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Customer'),
                    el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Rep'),
                    el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Status'),
                    el('th', { class: 'text-left pl-2 pr-5 py-2 font-semibold' }, 'By'),
                  ),
                ),
                el('tbody', {},
                  visible.map(entry => {
                    const meta = ACTION_META[entry.action] || { label: entry.action, bg: 'rgba(95,108,91,.18)', fg: 'var(--text-muted)' };
                    const t = new Date(entry.timestamp);
                    const timeStr = t.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) + ' ' +
                      t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    const tab = tabFromEntry(entry);
                    const tabMeta = TAB_META[tab] || TAB_META['History'];
                    return el('tr', { class: 'border-t border-' },
                      el('td', { class: 'pl-5 pr-2 py-2 text-muted- tabular-nums whitespace-nowrap' }, timeStr),
                      el('td', { class: 'px-2 py-2 font-medium whitespace-nowrap' },
                        el('span', {
                          class: 'chip',
                          style: { background: meta.bg, color: meta.fg },
                        }, meta.label),
                      ),
                      el('td', { class: 'px-2 py-2 text-muted- tabular-nums whitespace-nowrap' },
                        entry.sale_id != null ? '#' + entry.sale_id : '—'),
                      el('td', { class: 'px-2 py-2 truncate max-w-[180px]' }, entry.customer_name || '—'),
                      el('td', { class: 'px-2 py-2 text-muted- truncate max-w-[140px]' }, entry.rep_name || '—'),
                      el('td', { class: 'px-2 py-2 whitespace-nowrap' },
                        el('span', {
                          class: 'chip',
                          style: { background: tabMeta.bg, color: tabMeta.fg },
                        }, tab),
                      ),
                      el('td', { class: 'pl-2 pr-5 py-2 text-muted- whitespace-nowrap' }, entry.by_user || '—'),
                    );
                  }),
                  filtered.length > visible.length && el('tr', {},
                    el('td', { class: 'p-3 text-center text-[11px] text-muted- italic', colspan: 7 },
                      'Showing first ' + visible.length + ' · narrow your search to see older entries'),
                  ),
                ),
              ),
            ),
    ),

  );
}

// ── Settings → Competitions (per Isaac) ─────────────────────────────────
// The competition calendar: every comp with its start / end, how it
// recurs, and the weekday it kicks off on — plus a month grid so you can
// see when the next rounds land. Planning data only (the boards keep
// their own scoring windows); synced to every admin via _compExtras.
const COMP_RECUR = [['none', 'One-off'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']];
const COMP_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// ★ Default competition (admin): one at a time, synced to everyone.
// Virtual comps (Mystery Boxes, KOTH, …) persist their star in the synced
// extras map; config-backed comps carry it on the comp object itself.
function setCompDefault(comps, sel, on) {
  const _cXtra = (state._compExtras && typeof state._compExtras === 'object') ? state._compExtras : (state._compExtras = {});
  comps.forEach(c => { delete c.favorite; });
  state._compFavoriteMystery = false;
  Object.keys(_cXtra).forEach(k => { if (_cXtra[k] && typeof _cXtra[k] === 'object') delete _cXtra[k].favorite; });
  if (on) {
    if (sel.id === 'mystery_box') state._compFavoriteMystery = true;
    else {
      sel.favorite = true;
      const _cfgBacked = (typeof getIndicatorCompetitions === 'function' ? getIndicatorCompetitions() : []).some(c => c.id === sel.id);
      if (!_cfgBacked) _cXtra[sel.id] = { ..._cXtra[sel.id], favorite: true };
    }
  }
  logActivity('comp_change', { detail: on ? sel.name + ' set as the DEFAULT competition' : sel.name + ' unset as default competition' });
  saveDemoData();
  if (typeof saveIndicatorState === 'function') saveIndicatorState();
  mountApp();
}
// Is this competition inside one of its scheduled windows (Settings →
// Competitions) right now? Used to auto-feature running comps.
function compRunningNow(compId, now = new Date()) {
  const cfg = compScheduleStore()[compId];
  if (!cfg || !cfg.start) return null;
  const t = new Date(now); t.setHours(12, 0, 0, 0);
  const occ = compOccurrences(cfg).find(o => { const a = new Date(o.start); a.setHours(0, 0, 0, 0); const b = new Date(o.end); b.setHours(23, 59, 59, 999); return a <= t && t <= b; });
  return occ || null;
}
function compScheduleStore() {
  state._compExtras = state._compExtras || {};
  const sc = state._compExtras.compSchedule;
  return (sc && typeof sc === 'object') ? sc : (state._compExtras.compSchedule = {});
}
function compScheduleSave() {
  saveDemoData();
  if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
}
// Every competition the landing page can show, with its group.
function compScheduleList() {
  const out = [];
  const seen = new Set();
  const push = (id, name, group) => { if (!seen.has(id)) { seen.add(id); out.push({ id, name, group }); } };
  try { (getIndicatorCompetitions() || []).forEach(c => push(c.id, c.name, 'Sales Reps')); } catch (e) { /* no config yet */ }
  push('kobe_week', 'Kobe Week', 'Sales Reps');
  (typeof COMP_2026_NEW !== 'undefined' ? COMP_2026_NEW : []).forEach(([id, name]) => push(id, name, 'Sales Reps'));
  push('koth', 'KOTH', 'Sales Reps'); push('mystery_box', 'Mystery Boxes', 'Sales Reps');
  push('isl', 'Inside Sales League', 'Office Staff');
  const sc = compScheduleStore();
  Object.keys(sc).forEach(id => { if (sc[id] && sc[id].custom) push(id, sc[id].name || 'Custom', sc[id].group || 'Sales Reps'); });
  return out;
}
const _csIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const _csDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null; };
// Occurrences of a scheduled comp from its start, out `horizonDays` — each
// { start, end } as Date. Weekday pin (dow) snaps monthly/quarterly/yearly
// repeats to the first matching weekday on/after the nominal date.
function compOccurrences(cfg, horizonDays = 548) {
  const s0 = _csDate(cfg.start); if (!s0) return [];
  const e0 = _csDate(cfg.end) || s0;
  const len = Math.max(0, Math.round((e0 - s0) / 86400000));
  const stop = new Date(); stop.setDate(stop.getDate() + horizonDays);
  const out = [];
  const dow = cfg.dow === '' || cfg.dow == null ? null : Number(cfg.dow);
  const snap = (d) => { if (dow == null) return d; const x = new Date(d); while (x.getDay() !== dow) x.setDate(x.getDate() + 1); return x; };
  let i = 0;
  while (out.length < 60) {
    let st;
    if (cfg.recur === 'weekly') { st = new Date(s0); st.setDate(s0.getDate() + 7 * i); }
    else if (cfg.recur === 'biweekly') { st = new Date(s0); st.setDate(s0.getDate() + 14 * i); }
    else if (cfg.recur === 'monthly') { st = new Date(s0); st.setMonth(s0.getMonth() + i); st = snap(st); }
    else if (cfg.recur === 'quarterly') { st = new Date(s0); st.setMonth(s0.getMonth() + 3 * i); st = snap(st); }
    else if (cfg.recur === 'yearly') { st = new Date(s0); st.setFullYear(s0.getFullYear() + i); st = snap(st); }
    else { if (i > 0) break; st = s0; }
    if (st > stop) break;
    const en = new Date(st); en.setDate(st.getDate() + len);
    out.push({ start: st, end: en });
    i++;
  }
  return out;
}
function adminCompetitionSchedule() {
  if (!isAdminRole(state.profile?.role)) return el('div', { class: 'card p-8 text-center text-sm text-muted-' }, 'Admins only.');
  const sc = compScheduleStore();
  const comps = compScheduleList();
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const COLORS = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
  const colorOf = (i) => COLORS[i % COLORS.length];
  const fmtD = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const inp = (id, key, type, extra = {}) => el('input', Object.assign({
    type, value: (sc[id] && sc[id][key]) || '',
    class: 'rounded-lg border px-2.5 py-1 text-[11px]',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { sc[id] = sc[id] || {}; sc[id][key] = e.target.value; if (key === 'start' && (sc[id].dow == null || sc[id].dow === '')) { const d = _csDate(e.target.value); if (d) sc[id].dow = String(d.getDay()); } compScheduleSave(); mountApp(); },
  }, extra));
  const sel = (id, key, opts) => el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { sc[id] = sc[id] || {}; sc[id][key] = e.target.value; compScheduleSave(); mountApp(); },
  }, ...opts.map(([v, l]) => el('option', { value: v, selected: String((sc[id] && sc[id][key]) ?? '') === String(v) }, l)));

  // ── Table ──
  const th = (t) => el('th', { class: 'text-left px-2 py-2 text-[9px] uppercase tracking-wider font-semibold text-muted- whitespace-nowrap' }, t);
  const rows = comps.map((c, i) => {
    const cfg = sc[c.id] || {};
    const occ = compOccurrences(cfg);
    const upcoming = occ.filter(o => o.end >= today).slice(0, 3);
    const live = occ.find(o => o.start <= today && o.end >= today);
    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      el('td', { class: 'px-2 py-2 whitespace-nowrap' },
        el('span', { class: 'inline-block mr-2 align-middle', style: { width: '9px', height: '9px', background: colorOf(i) } }),
        cfg.custom
          ? el('input', { type: 'text', value: cfg.name || '', class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', width: '150px' }, onchange: (e) => { cfg.name = e.target.value; compScheduleSave(); mountApp(); } })
          : el('span', { class: 'font-semibold' }, c.name),
        live ? el('span', { class: 'ml-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: 'rgba(61,122,102,.16)', color: '#5F6C5B' } }, 'Live') : null),
      el('td', { class: 'px-2 py-2' }, inp(c.id, 'start', 'date')),
      el('td', { class: 'px-2 py-2' }, inp(c.id, 'end', 'date')),
      el('td', { class: 'px-2 py-2' }, sel(c.id, 'recur', COMP_RECUR)),
      el('td', { class: 'px-2 py-2' }, sel(c.id, 'dow', [['', 'Any'], ...COMP_DOW.map((d, k) => [String(k), d])])),
      el('td', { class: 'px-2 py-2 text-[11px] text-muted- whitespace-nowrap' },
        upcoming.length ? upcoming.map(o => fmtD(o.start) + (o.end > o.start ? ' – ' + fmtD(o.end) : '')).join(' · ') : (cfg.start ? 'Ended' : '—')),
      el('td', { class: 'px-2 py-2 whitespace-nowrap' }, cfg.custom ? el('button', {
        class: 'text-[11px] font-semibold', style: { color: '#DC2626' },
        onclick: () => { if (!confirm('Remove ' + (cfg.name || 'this competition') + ' from the schedule?')) return; delete sc[c.id]; compScheduleSave(); mountApp(); },
      }, 'Remove') : (cfg.start ? el('button', {
        class: 'text-[11px] font-semibold text-muted-',
        onclick: () => { delete sc[c.id]; compScheduleSave(); mountApp(); },
      }, 'Clear') : null)));
  });
  // One card per group (per Isaac): Sales Reps · Office Staff · Technicians.
  const groupCard = (group) => {
    const idx = comps.map((c, i) => [c, i]).filter(([c]) => ((sc[c.id] && sc[c.id].group) || c.group) === group);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 flex items-center gap-3 border-b flex-wrap', style: { borderColor: 'var(--border)' } },
        el('h3', { class: 'text-sm font-bold' }, group),
        el('span', { class: 'text-[11px] text-muted-' }, idx.length + ' competition' + (idx.length === 1 ? '' : 's')),
        el('button', {
          class: 'ml-auto rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => { const id = 'custom_' + Date.now(); sc[id] = { custom: true, name: 'New competition', group, recur: 'none' }; compScheduleSave(); mountApp(); },
        }, '+ Competition')),
      idx.length
        ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
            el('thead', {}, el('tr', {}, th('Competition'), th('Start'), th('End'), th('Repeats'), th('Starts on'), th('Next runs'), th(''))),
            el('tbody', {}, ...idx.map(([, i]) => rows[i]))))
        : el('div', { class: 'px-4 py-6 text-center text-xs text-muted- italic' }, 'No ' + group.toLowerCase() + ' competitions scheduled yet.'));
  };
  const table = el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'text-[11px] text-muted-' }, 'Set each comp’s first run + how it repeats; "Starts on" pins the weekday for monthly / quarterly / yearly repeats.'),
    groupCard('Sales Reps'), groupCard('Office Staff'), groupCard('Technicians'));

  // ── Month calendar ──
  if (!state._compCalYm) state._compCalYm = _csIso(today).slice(0, 7);
  const [cy, cm] = state._compCalYm.split('-').map(Number);
  const first = new Date(cy, cm - 1, 1, 12), daysIn = new Date(cy, cm, 0).getDate();
  const shiftMonth = (n) => { const d = new Date(cy, cm - 1 + n, 1); state._compCalYm = _csIso(d).slice(0, 7); mountApp(); };
  const perDay = Array.from({ length: daysIn }, () => []);
  comps.forEach((c, i) => {
    const cfg = sc[c.id]; if (!cfg || !cfg.start) return;
    compOccurrences(cfg).forEach(o => {
      for (let d = 1; d <= daysIn; d++) {
        const day = new Date(cy, cm - 1, d, 12);
        if (day >= o.start && day <= o.end) perDay[d - 1].push({ name: cfg.name || c.name, color: colorOf(i), starts: _csIso(day) === _csIso(o.start) });
      }
    });
  });
  const cells = [];
  for (let k = 0; k < first.getDay(); k++) cells.push(el('div', { class: 'p-1', style: { minHeight: '64px', background: 'var(--card-2)', opacity: '.5' } }));
  for (let d = 1; d <= daysIn; d++) {
    const isToday = _csIso(new Date(cy, cm - 1, d, 12)) === _csIso(today);
    const items = perDay[d - 1];
    cells.push(el('div', { class: 'p-1 flex flex-col gap-0.5', style: { minHeight: '64px', borderTop: '1px solid var(--border)', background: isToday ? 'rgba(223,100,58,.08)' : 'var(--card)' } },
      el('div', { class: 'text-[10px] tabular-nums font-semibold', style: { color: isToday ? 'var(--accent)' : 'var(--text-muted)' } }, String(d)),
      ...items.slice(0, 3).map(it => el('div', { class: 'text-[9px] font-bold truncate px-1', style: { background: it.color, color: '#fff', opacity: it.starts ? '1' : '.75' }, title: it.name + (it.starts ? ' — starts' : '') }, (it.starts ? '▸ ' : '') + it.name)),
      items.length > 3 ? el('div', { class: 'text-[9px] text-muted-' }, '+' + (items.length - 3) + ' more') : null));
  }
  const calendar = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 flex items-center gap-2 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, 'Calendar'),
      el('div', { class: 'ml-auto flex items-center gap-1' },
        el('button', { class: 'px-2.5 py-1 text-[11px] rounded-lg border', style: { borderColor: 'var(--border-2)' }, onclick: () => shiftMonth(-1) }, '‹'),
        el('span', { class: 'text-[11px] font-semibold px-2 tabular-nums' }, first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })),
        el('button', { class: 'px-2.5 py-1 text-[11px] rounded-lg border', style: { borderColor: 'var(--border-2)' }, onclick: () => shiftMonth(1) }, '›'),
        el('button', { class: 'px-2.5 py-1 text-[11px] rounded-lg border ml-1', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._compCalYm = _csIso(today).slice(0, 7); mountApp(); } }, 'Today'))),
    el('div', { class: 'grid grid-cols-7' }, ...COMP_DOW.map(d => el('div', { class: 'px-1 py-1 text-[9px] uppercase tracking-wider font-semibold text-muted-', style: { background: 'var(--card-2)' } }, d))),
    el('div', { class: 'grid grid-cols-7' }, ...cells));

  return el('div', { class: 'flex flex-col gap-4' },
    el('h2', { class: 'text-lg font-bold' }, 'Competitions'),
    table, calendar);
}

function adminSlack() {
  const s = state.appSettings || (state.appSettings = {});
  s.slack_bot_token = s.slack_bot_token || '';
  if (!s.slack_channels) s.slack_channels = [
    { id: 1, name: '#insidesales', webhook: '' },
  ];
  s.first_blood = s.first_blood || {
    enabled: true,
    message: '[Rep name] first blood today!',
    image_url: 'https://i.imgur.com/TjjGnM1.png',
  };
  s.daily_update = s.daily_update || {
    enabled: false,
    send_time: '17:00',
    include_week: true,
    include_month: true,
    include_year: true,
  };
  if (s.paystub_dm_enabled == null) s.paystub_dm_enabled = true;

  const persist = () => saveDemoData();

  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile];

  // Status pills surface the wiring state of each card so the UI doesn't lie
  // about which feature actually fires. live = browser webhook;
  // server = bot-token DM, needs Netlify Function (demo stub fires today);
  // cron = needs an external scheduler (won't fire from the browser).
  const statusPill = (kind) => {
    const m = {
      live:   { label: 'Live · webhook',                                         bg: 'rgba(223,100,58,.18)', fg: '#DF643A' },
      server: { label: DEMO ? 'Demo stub · needs server' : 'Live · server',      bg: 'rgba(95,108,91,.14)', fg: '#5F6C5B' },
      cron:   { label: 'Needs cron host',                                        bg: 'rgba(223,100,58,.16)', fg: '#A9441F' },
    };
    const meta = m[kind] || m.live;
    return el('span', {
      class: 'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded',
      style: { background: meta.bg, color: meta.fg, whiteSpace: 'nowrap' },
    }, meta.label);
  };

  // Subsection inside a consolidated card. The first subsection in a card
  // skips the top divider; we pass `first` to control that.
  const subsection = (opts, ...children) => el('div', {
    style: opts.first ? {} : { borderTop: '1px solid var(--border)', paddingTop: '20px', marginTop: '20px' },
  },
    el('div', { class: 'flex items-center gap-2 mb-1 flex-wrap' },
      opts.icon ? el('span', { class: 'text-base' }, opts.icon) : null,
      el('h4', { class: 'text-sm font-bold' }, opts.title),
      opts.statusKind ? statusPill(opts.statusKind) : null,
    ),
    opts.hint ? el('p', { class: 'text-xs text-muted- mb-3' }, opts.hint) : null,
    ...children,
  );

  // Generic "enable + channel picker" combo used by Sale Broadcast and
  // Competition Updates — both just route to a channel webhook.
  const channelToggleBlock = (key, defaultObj, label) => {
    if (!s[key]) s[key] = defaultObj;
    return el('div', { class: 'flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3' },
      el('label', { class: 'flex items-center gap-2 text-sm' },
        el('input', {
          type: 'checkbox', class: 'accent-lime w-4 h-4',
          checked: s[key].enabled || false,
          onchange: (e) => { s[key].enabled = e.target.checked; persist(); },
        }),
        label,
      ),
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] flex-1',
        onchange: (e) => { s[key].channel = e.target.value; persist(); },
      },
        el('option', { value: '' }, 'Select channel…'),
        ...s.slack_channels.map(ch => el('option', { value: ch.name, selected: s[key].channel === ch.name }, ch.name)),
      ),
    );
  };

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center justify-between mb-1' },
      el('h2', { class: 'text-xl font-bold' }, 'Slack'),
    ),

    // ── 1. Architecture banner ──
    el('div', { class: 'card p-5', style: { background: 'var(--card-2)' } },
      el('h3', { class: 'text-sm font-bold mb-2 flex items-center gap-2' },
        el('span', {}, '📡'), 'How Slack integration works',
      ),
      el('div', { class: 'text-xs flex flex-col gap-1.5', style: { color: 'var(--text-muted)' } },
        el('div', {}, statusPill('live'),   ' — Channel posts use webhook URLs you configure below. Browser POSTs straight to Slack.'),
        el('div', {}, statusPill('server'), ' — DM features use the bot token. Deploy ', el('code', { style: { color: 'var(--accent)' } }, 'netlify/functions/slack-paystub.js'), ' and set ', el('code', { style: { color: 'var(--accent)' } }, 'SLACK_BOT_TOKEN'), ' in Netlify env. Demo mode logs to Admin → Activity Log.'),
        el('div', {}, statusPill('cron'),   ' — Scheduled posts need an external cron host (Netlify Scheduled Functions, GitHub Actions). Settings persist; trigger is external.'),
      ),
    ),

    // ── 2. Connection — Bot Token + Channels ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-3' }, 'Connection'),

      subsection({ first: true, title: 'Bot Token', statusKind: 'server',
        hint: 'Required for DMs. The browser never reads this at runtime — add the value to your Netlify env as SLACK_BOT_TOKEN. Field below is for reference.',
      },
        el('input', {
          type: 'password',
          class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] font-mono',
          placeholder: 'xoxb-...',
          value: s.slack_bot_token,
          oninput: (e) => { s.slack_bot_token = e.target.value; persist(); },
        }),
      ),

      subsection({ title: 'Channels', statusKind: 'live',
        hint: 'Each row is a Slack channel + its incoming webhook URL. Test posts straight from your browser — no server needed.',
      },
        el('div', { class: 'flex flex-col gap-2' },
          ...s.slack_channels.map((ch, i) => el('div', { class: 'flex items-center gap-2 flex-wrap' },
            el('input', {
              class: 'rounded-lg border px-2.5 py-1 text-[11px]',
              style: { width: '160px' },
              value: ch.name,
              oninput: (e) => { ch.name = e.target.value; persist(); },
            }),
            el('input', {
              class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono',
              style: { minWidth: '240px' },
              placeholder: 'https://hooks.slack.com/services/...',
              value: ch.webhook,
              oninput: (e) => { ch.webhook = e.target.value; persist(); },
            }),
            el('button', {
              class: 'px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition',
              style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
              onclick: async (ev) => {
                if (!ch.webhook) { toast('Add a webhook URL first', 'warn'); return; }
                const btn = ev.currentTarget;
                const orig = btn.textContent;
                btn.textContent = '…'; btn.disabled = true;
                const res = await slack.postWebhook(ch.webhook, {
                  text: '✅ Test post from RIDD Sales App — webhook for ' + ch.name + ' is wired up.',
                });
                btn.textContent = orig; btn.disabled = false;
                toast(res.ok ? 'Posted to ' + ch.name : 'Failed: ' + res.error, res.ok ? 'success' : 'error');
              },
            }, 'Test'),
            el('button', {
              class: 'text-xs text-muted- hover:text-red-500 transition px-2',
              onclick: () => { s.slack_channels.splice(i, 1); persist(); mountApp(); },
              title: 'Remove',
            }, '×'),
          )),
        ),
        el('button', {
          class: 'mt-3 px-2.5 py-1 rounded-lg border text-[11px] font-medium',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: () => {
            const nextId = Math.max(0, ...s.slack_channels.map(c => c.id)) + 1;
            s.slack_channels.push({ id: nextId, name: '#new-channel', webhook: '' });
            persist();
            mountApp();
          },
        }, '+ Add Channel'),
      ),
    ),

    // ── 3. Channel Posts — Sale Broadcast / First Blood / Weekly Digest / Competition Updates ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-3' }, 'Channel Posts'),

      subsection({ first: true, icon: '📢', title: 'Sale Broadcast', statusKind: 'live',
        hint: 'Every sale logged auto-posts the rep, customer, service, and ACV to the chosen channel.',
      },
        channelToggleBlock('sale_broadcast', { enabled: false, channel: '' }, 'Enabled'),
      ),

      subsection({ icon: '🩸', title: 'First Blood', statusKind: 'live',
        hint: 'Fires automatically on the rep\'s first sale of the day. Posts to the Sale Broadcast channel.',
      },
        el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
          el('input', {
            type: 'checkbox', class: 'accent-lime w-4 h-4',
            checked: s.first_blood.enabled,
            onchange: (e) => { s.first_blood.enabled = e.target.checked; persist(); },
          }),
          'Enabled',
        ),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 items-center mb-2' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Message'),
          el('div', { class: 'flex items-center gap-2' },
            el('span', { class: 'text-xs text-muted- font-mono shrink-0' }, '[Rep name]'),
            el('input', {
              class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px]',
              value: s.first_blood.message,
              oninput: (e) => { s.first_blood.message = e.target.value; persist(); },
            }),
          ),
        ),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2 items-center' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Image URL'),
          el('input', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px]',
            placeholder: 'https://i.imgur.com/...',
            value: s.first_blood.image_url,
            oninput: (e) => { s.first_blood.image_url = e.target.value; persist(); },
          }),
        ),
      ),

      subsection({ icon: '📋', title: 'Weekly Digest', statusKind: 'cron',
        hint: 'End-of-week leaderboard summary. Settings persist here; the schedule is fired by your cron host.',
      },
        el('div', { class: 'flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3' },
          el('label', { class: 'flex items-center gap-2 text-sm shrink-0' },
            el('input', {
              type: 'checkbox', class: 'accent-lime w-4 h-4',
              checked: s.weekly_digest?.enabled || false,
              onchange: (e) => { if (!s.weekly_digest) s.weekly_digest = {}; s.weekly_digest.enabled = e.target.checked; persist(); },
            }),
            'Enabled',
          ),
          el('select', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px]',
            onchange: (e) => { if (!s.weekly_digest) s.weekly_digest = {}; s.weekly_digest.day = e.target.value; persist(); },
          },
            ...['Friday', 'Saturday', 'Sunday', 'Monday'].map(d =>
              el('option', { value: d, selected: (s.weekly_digest?.day || 'Friday') === d }, d)),
          ),
          el('input', {
            type: 'time', class: 'rounded-lg border px-3 py-2 text-sm',
            value: s.weekly_digest?.time || '17:00',
            onchange: (e) => { if (!s.weekly_digest) s.weekly_digest = {}; s.weekly_digest.time = e.target.value; persist(); },
          }),
        ),
      ),

      subsection({ icon: '🏅', title: 'Competition Updates', statusKind: 'live',
        hint: 'Auto-post when a rep completes a bingo square or hits a milestone.',
      },
        channelToggleBlock('comp_updates', { enabled: false, channel: '' }, 'Enabled'),
      ),
    ),

    // ── 4. Direct Messages — Pay Stub DMs + Daily Update ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-3' }, 'Direct Messages'),

      subsection({ first: true, icon: '💰', title: 'Pay Stub DMs', statusKind: 'server',
        hint: 'DM each rep their pay stub the moment payroll runs. Demo mode logs the intent to Admin → Activity Log.',
      },
        el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
          el('input', {
            type: 'checkbox', class: 'accent-lime w-4 h-4',
            checked: s.paystub_dm_enabled,
            onchange: (e) => { s.paystub_dm_enabled = e.target.checked; persist(); },
          }),
          'Auto-DM when payroll runs',
          el('span', { class: 'text-[10px] text-muted- italic' }, '(Upfront + Backend)'),
        ),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-center' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Manual send'),
          el('select', {
            id: 'paystub-rep-picker',
            class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          },
            el('option', { value: '' }, 'Select a rep…'),
            el('option', { value: '__all__' }, '— All active reps —'),
            ...profiles.filter(p => p.is_active !== false).map(p => el('option', { value: p.id }, p.full_name)),
          ),
          el('button', {
            class: 'px-2.5 py-1 rounded-lg text-[11px] font-semibold',
            style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: () => {
              const sel = document.getElementById('paystub-rep-picker');
              if (!sel.value) return toast('Pick a rep first', 'warn');
              const today = new Date();
              const periodId = currentPayPeriodId(today.getFullYear());
              const period = getPayPeriods(today.getFullYear()).find(p => p.id === periodId);
              if (!period) return toast('Could not resolve current pay period', 'warn');
              const repIds = sel.value === '__all__'
                ? profiles.filter(p => p.is_active !== false && p.role !== 'auditor').map(p => p.id)
                : [sel.value];
              const sales = (state.allSales || []).filter(x =>
                repIds.includes(x.rep_id) &&
                new Date(x.sold_date + 'T00:00') >= period.start &&
                new Date(x.sold_date + 'T00:00') <= period.end
              );
              if (!sales.length) return toast('No sales in the current period for that selection', 'warn');
              const prev = s.paystub_dm_enabled;
              s.paystub_dm_enabled = true;
              notifyPayrollRun(sales, period, 'upfront');
              s.paystub_dm_enabled = prev;
            },
          }, 'Send'),
        ),
      ),

      subsection({ icon: '📊', title: 'Daily Update', statusKind: 'cron',
        hint: 'DM each rep their daily/weekly/monthly/yearly totals. Schedule fired by cron host.',
      },
        el('div', { class: 'flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 mb-3' },
          el('label', { class: 'flex items-center gap-2 text-sm shrink-0' },
            el('input', {
              type: 'checkbox', class: 'accent-lime w-4 h-4',
              checked: s.daily_update.enabled,
              onchange: (e) => { s.daily_update.enabled = e.target.checked; persist(); },
            }),
            'Enabled',
          ),
          el('input', {
            type: 'time',
            class: 'rounded-lg border px-3 py-2 text-sm',
            value: s.daily_update.send_time,
            onchange: (e) => { s.daily_update.send_time = e.target.value; persist(); },
          }),
        ),
        el('div', { class: 'flex flex-wrap gap-x-4 gap-y-2' },
          ...[['include_week', 'Week total'], ['include_month', 'Month total'], ['include_year', 'Year total']].map(([k, label]) =>
            el('label', { class: 'flex items-center gap-2 text-sm' },
              el('input', {
                type: 'checkbox',
                class: 'accent-lime w-4 h-4',
                checked: s.daily_update[k],
                onchange: (e) => { s.daily_update[k] = e.target.checked; persist(); },
              }),
              label,
            )
          ),
        ),
      ),
    ),

    // ── 5. Rep Slack User IDs ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Rep Slack User IDs'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Find a rep\'s Slack User ID in their Slack profile → ⋮ → Copy member ID. Looks like ',
        el('code', { style: { color: 'var(--accent)' } }, 'U01AB2CD3EF'),
        '. Required for DMs.',
      ),
      el('div', { class: 'flex flex-col gap-2' },
        ...profiles.map(p => el('div', { class: 'flex items-center gap-3' },
          el('div', { class: 'flex items-center gap-2 w-44 shrink-0' },
            avatarNode(p.avatar_url, p.initials, 'w-6 h-6 text-[8px]'),
            el('span', { class: 'text-sm font-medium truncate' }, p.full_name),
          ),
          el('input', {
            class: 'flex-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono',
            placeholder: 'U01AB2CD3EF',
            value: p.slack_user_id || '',
            oninput: (e) => { p.slack_user_id = e.target.value; persist(); },
          }),
          p.slack_user_id
            ? el('span', { class: 'text-[10px] font-bold shrink-0', style: { color: '#DF643A' } }, '✓')
            : el('span', { class: 'text-[10px] text-muted- italic shrink-0', style: { whiteSpace: 'nowrap' } }, 'no DM'),
        )),
      ),
    ),
  );
}

// Delete a sale entirely. Admin-only — wired up from the × button on each
// row of the Sales tab after a confirm dialog. Removes from both collections
// in demo mode; deletes the row from Supabase in production.
async function deleteSale(saleId) {
  const sale = state.allSales.find(s => s.id === saleId) || state.mySales.find(s => s.id === saleId);
  const customerName = sale?.customer_name || 'sale';
  if (DEMO) {
    state.mySales  = state.mySales.filter(s => s.id !== saleId);
    state.allSales = state.allSales.filter(s => s.id !== saleId);
    logActivity('audit', { sale_id: saleId, customer_name: customerName, old_status: sale?.audit_status, new_status: 'deleted' });
    toast('Deleted "' + customerName + '"', 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const { error } = await supabase.from('sales').delete().eq('id', saleId);
    if (error) throw error;
    toast('Deleted "' + customerName + '"', 'success');
    await refreshSalesData();
    await recomputeAllProgress();
    mountApp();
  } catch (err) {
    toast(err.message || 'Failed to delete', 'error');
  }
}

// Restore a cancelled sale back to Pending so it can be re-audited. Only
// applies to cancelled sales (other terminal statuses need a chargeback flow,
// not a simple revert). Clears the audit stamps and un-stages from payroll.
async function reinstateSale(saleId) {
  if (DEMO) {
    for (const list of [state.mySales, state.allSales]) {
      const sale = list.find(s => s.id === saleId);
      if (sale) {
        sale.audit_status = 'pending';
        sale.audited_by = null;
        sale.audited_at = null;
        sale.staged_for_payroll = false;
        sale.staged_at = null;
      }
    }
    const sale = state.allSales.find(s => s.id === saleId);
    logActivity('audit', { sale_id: saleId, customer_name: sale?.customer_name, old_status: 'cancelled', new_status: 'pending' });
    toast('Sale reinstated', 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const { error } = await supabase.from('sales').update({
      audit_status: 'pending',
      audited_by: null,
      audited_at: null,
      staged_for_payroll: false,
      staged_at: null,
    }).eq('id', saleId);
    if (error) throw error;
    toast('Sale reinstated', 'success');
    await refreshSalesData();
    await recomputeAllProgress();
    mountApp();
  } catch (err) {
    toast(err.message || 'Failed', 'error');
  }
}

// Status (audit_status) and Auditor (audited_by) are independent decisions.
// A sale only stages for payroll when BOTH conditions are met:
//   1. Status is payroll-eligible (serviced or below_minimums), AND
//   2. An auditor has been assigned (audited_by != null)
// Either change re-evaluates staging — set them in any order, change the
// status back to Pending and it un-stages, etc.
function _evalStaging(sale) {
  const isPayrollStatus = sale.audit_status === 'serviced' || sale.audit_status === 'below_minimums';
  const hasAuditor = !!sale.audited_by;
  if (isPayrollStatus && hasAuditor) {
    if (!sale.staged_for_payroll) sale.staged_at = new Date().toISOString();
    sale.staged_for_payroll = true;
  } else {
    sale.staged_for_payroll = false;
    sale.staged_at = null;
  }
}

async function auditSale(saleId, status) {
  if (DEMO) {
    for (const list of [state.mySales, state.allSales]) {
      const sale = list.find(s => s.id === saleId);
      if (sale) {
        sale.audit_status = status;
        // Note: we do NOT touch audited_by here — that's set independently
        // via the Audit dropdown so admins can credit the right auditor
        // (which may not be the person clicking Status).
        _evalStaging(sale);
      }
    }
    const sale = state.allSales.find(s => s.id === saleId);
    logActivity('audit', { sale_id: saleId, customer_name: sale?.customer_name, old_status: sale?.audit_status, new_status: status });
    toast('Sale ' + status.replace('_', ' '), 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    // Re-derive staging on the server side too — find the sale, compute
    // staged_for_payroll based on the new status + existing audited_by.
    const sale = state.allSales.find(s => s.id === saleId) || state.mySales.find(s => s.id === saleId);
    const isPayrollStatus = status === 'serviced' || status === 'below_minimums';
    const hasAuditor = !!sale?.audited_by;
    const willStage = isPayrollStatus && hasAuditor;
    const { error } = await supabase.from('sales').update({
      audit_status: status,
      staged_for_payroll: willStage,
      staged_at: willStage ? new Date().toISOString() : null,
    }).eq('id', saleId);
    if (error) throw error;
    toast('Sale ' + status.replace('_', ' '), 'success');
    // Slack DM to the sale's rep (their ⚙ My Settings opt-in decides
    // whether it sends) — first event wired to per-user notifications.
    try {
      if (sale && sale.profile_id && sale.profile_id !== state.profile?.id) {
        const _lbl = { pending: 'Pending', serviced: 'Commissionable \u2705', below_minimums: 'Below Minimums', cancelled: 'Cancelled', nsf: 'NSF', not_payable: 'Not Payable', reschedule: 'Reschedule' }[status] || status;
        notifySlack(sale.profile_id, '\ud83d\udd0e Audit update \u2014 your sale for ' + (sale.customer_name || 'a customer') + ' was marked *' + _lbl + '*.');
      }
    } catch (e2) { /* best-effort */ }
    await refreshSalesData();
    await recomputeAllProgress();
    mountApp();
  } catch (err) {
    toast(err.message || 'Failed', 'error');
  }
}

function adminCompetitions() {
  const host = el('div', { class: 'flex flex-col gap-4' });
  host.append(
    el('button', {
      class: 'self-start px-2.5 py-1 rounded-xl bg-lime text-eerie font-semibold text-[11px]',
      onclick: () => openCompEditor(),
    }, '+ New competition'),
  );
  if (state.competitions.length === 0) {
    host.append(el('div', { class: 'card p-6 text-center text-battle-2 text-sm' }, 'No competitions yet.'));
  } else {
    state.competitions.forEach(c => host.append(
      el('div', { class: 'card p-4 flex items-center justify-between gap-3' },
        el('div', { class: 'flex-1' },
          el('div', { class: 'font-semibold' }, c.name),
          el('div', { class: 'text-xs text-battle-2' },
            `${c.category.replace('_', ' ')} · ${c.type} · ${fmt.dateShort(c.start_date)} → ${fmt.dateShort(c.end_date)} · ${state.compRules.filter(r => r.competition_id === c.id).length} rules`),
        ),
        el('div', { class: 'flex gap-2' },
          el('button', {
            class: 'text-[11px] px-2.5 py-1 rounded-lg border border-battleship text-battle-2 hover:border-lime hover:text-lime',
            onclick: () => openCompEditor(c),
          }, 'Edit'),
          el('button', {
            class: 'text-[11px] px-2.5 py-1 rounded-lg border border- text-muted- hover:border-red-500 hover:text-red-400 transition',
            onclick: async () => {
              if (!confirm('Delete "' + c.name + '" and all its rules?')) return;
              if (DEMO) {
                state.competitions = state.competitions.filter(x => x.id !== c.id);
                state.compRules    = state.compRules.filter(r => r.competition_id !== c.id);
                state.compProgress = state.compProgress.filter(p => p.competition_id !== c.id);
                toast('Deleted (demo)', 'success');
      saveDemoData();
                mountApp();
                return;
              }
              const { error } = await supabase.from('competitions').delete().eq('id', c.id);
              if (error) return toast(error.message, 'error');
              toast('Deleted', 'success');
              await refreshCompetitionsData();
              mountApp();
            },
          }, 'Delete'),
        ),
      ),
    ));
  }
  return host;
}

function openCompEditor(existing = null) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/70 z-40 flex items-start justify-center p-4 overflow-y-auto' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const form = el('form', {
    class: 'card p-6 w-full max-w-2xl my-8 flex flex-col gap-4',
    onsubmit: async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const payload = {
        name: data.name,
        category: data.category,
        type: data.type,
        start_date: data.start_date,
        end_date: data.end_date,
        prize_text: data.prize_text || null,
        description: data.description || null,
        min_qualifying_revenue: data.min_qualifying_revenue ? parseFloat(data.min_qualifying_revenue) : null,
        is_active: true,
      };
      try {
        // The rules editor was removed from this modal — RIDD Topia is the
        // only bingo comp and its squares are seeded in code / Supabase.
        // Saving the comp now only touches the comp row itself; any
        // existing rules (RIDD Topia's bingo squares) are left untouched.
        if (DEMO) {
          if (existing) {
            Object.assign(existing, payload);
          } else {
            const compId = Math.max(0, ...state.competitions.map(c => c.id)) + 1;
            state.competitions.push({ ...payload, id: compId, created_by: state.profile.id });
          }
          toast('Saved (demo)', 'success');
          saveDemoData();
          overlay.remove();
          mountApp();
          return;
        }

        if (existing) {
          const { error } = await supabase.from('competitions').update(payload).eq('id', existing.id);
          if (error) throw error;
        } else {
          payload.created_by = state.profile.id;
          const { error } = await supabase.from('competitions').insert(payload);
          if (error) throw error;
        }
        toast('Competition saved', 'success');
        await refreshCompetitionsData();
        await recomputeAllProgress();
        overlay.remove();
        mountApp();
      } catch (err) {
        toast(err.message || 'Save failed', 'error');
      }
    },
  });

  const inp = (name, attrs = {}) => el('input', { name, class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]', ...attrs });
  const mk = (label, input) => el('label', { class: 'block text-sm' },
    el('span', { class: 'text-battle-2 block mb-1 text-xs' }, label), input);

  // Loyalty Royalty + Golden Phone (and any future royalty-style comp)
  // always run a full calendar year, so pre-fill new comps with the
  // current year's Jan 1 → Dec 31. RIDD Topia and other bingo sprints
  // override these manually when they're created.
  const _yr  = new Date().getFullYear();
  const _jan = _yr + '-01-01';
  const _dec = _yr + '-12-31';

  form.append(
    el('h2', { class: 'text-xl font-bold' }, existing ? 'Edit competition' : 'New competition'),
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3' },
      mk('Name', inp('name', { required: true, value: existing?.name || '' })),
      mk('Category', el('select', { name: 'category', class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]' },
        el('option', { value: 'inside_sales', selected: existing?.category === 'inside_sales' }, 'Inside Sales'),
        el('option', { value: 'loyalty', selected: existing?.category === 'loyalty' }, 'Loyalty'),
      )),
      mk('Type', el('select', { name: 'type', class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]' },
        el('option', { value: 'bingo', selected: existing?.type === 'bingo' }, 'Bingo'),
        el('option', { value: 'royalty', selected: existing?.type === 'royalty' }, 'Royalty'),
      )),
      mk('Prize text', inp('prize_text', { placeholder: '$300/mo · 150,000 RC · etc.', value: existing?.prize_text || '' })),
      mk('Start date', inp('start_date', { type: 'date', required: true, value: existing?.start_date || _jan })),
      mk('End date',   inp('end_date',   { type: 'date', required: true, value: existing?.end_date   || _dec })),
      mk('Min qualifying revenue (royalty only)', inp('min_qualifying_revenue', { type: 'number', step: '0.01', value: existing?.min_qualifying_revenue || '' })),
    ),
    mk('Description', el('textarea', { name: 'description', rows: 2, class: 'w-full rounded-lg border px-3 py-2 text-sm' }, existing?.description || '')),
  );

  // Rules / Bingo squares editor was removed — RIDD Topia is the only
  // bingo comp and its squares are seeded elsewhere (loadDemoData /
  // Supabase). Edits to the comp itself (name, dates, prize) leave the
  // rules untouched, so the bingo card keeps working.

  form.append(
    el('div', { class: 'flex justify-end gap-2 pt-2 border-t border-eerie3' },
      el('button', { type: 'button', class: 'px-2.5 py-1 rounded-lg text-battle-2 hover:text-smoke text-[11px]', onclick: () => overlay.remove() }, 'Cancel'),
      el('button', { type: 'submit', class: 'px-2.5 py-1 rounded-lg bg-lime text-eerie font-semibold text-[11px]' }, 'Save'),
    ),
  );

  overlay.append(form);
  document.body.append(overlay);
}

// ── FieldRoutes roster (mirrored by the sync into fieldroutes_employees) ──
// Loaded lazily for admins. Powers the "in CRM, not in the app yet" list and
// the email auto-link review on the Users screen.
async function loadFieldRoutesRoster(force) {
  if (typeof DEMO !== 'undefined' && DEMO) { if (!state.frRoster) state.frRoster = []; return state.frRoster; }
  if (state._frRosterLoading) return state.frRoster;
  if (state.frRoster && !force) return state.frRoster;
  state._frRosterLoading = true;
  try {
    const { data, error } = await supabase.from('fieldroutes_employees').select('*');
    state.frRoster = error ? [] : (data || []);
    state._frRosterError = error ? error.message : null;
    if (error) console.warn('[fr roster] load failed:', error.message);
  } catch (e) { state.frRoster = []; state._frRosterError = String((e && e.message) || e); console.warn('[fr roster]', e); }
  finally { state._frRosterLoading = false; }
  // Roster in hand → re-run the auto-alias pass so CRM-LINKED multi-branch
  // accounts merge even when the roster loads after the sales data did.
  try { if ((state.frRoster || []).length && (state._indicatorRawSales || []).length) _autoAliasByRepId(state._indicatorRawSales); } catch { /* non-fatal */ }
  return state.frRoster;
}
const _frEmpName  = (e) => ([(e.nickname || e.fname), e.lname].filter(Boolean).join(' ')).trim() || (e.email || ('Employee ' + e.employee_id));
const _frNormEmail = (s) => String(s || '').trim().toLowerCase();
// Normalized full name for fallback matching when an app login email differs
// from the CRM email (e.g. cameron@riddpest.com vs crprymak@gmail.com).
const _frNormName  = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// First+last from a FieldRoutes record (ignores nickname so it matches the app
// profile's real name, e.g. "Cameron Prymak").
const _frRealName  = (e) => _frNormName([e.fname, e.lname].filter(Boolean).join(' '));
// Write a FieldRoutes link onto an existing profile (admin RLS allows it).
async function applyFieldRoutesLink(profileId, empId) {
  if (typeof DEMO !== 'undefined' && DEMO) {
    const p = (state.allProfiles || []).find(x => x.id === profileId);
    if (p) p.fieldroutes_employee_id = empId;
    saveDemoData(); toast('Linked', 'success'); mountApp(); return;
  }
  const { error } = await supabase.from('profiles').update({ fieldroutes_employee_id: empId }).eq('id', profileId);
  if (error) { toast('Link failed: ' + error.message, 'error'); return; }
  const p = (state.allProfiles || []).find(x => x.id === profileId);
  if (p) p.fieldroutes_employee_id = empId;
  toast('Linked to FieldRoutes', 'success'); mountApp();
}
// Flip an app user's active state (Users screen inline toggle). Guards against
// an admin locking themselves out.
// One-press password-reset email — used by the user editor's Send Reset
// Link button and the activate flow below. (The row-level 🔑 was retired;
// resets live inside Edit User now.)
async function sendPasswordResetLink(email) {
  if (!email) { toast('No email on file for this user.', 'error'); return false; }
  if (typeof DEMO !== 'undefined' && DEMO) { toast('Demo mode — would email a password reset link to ' + email, 'info'); return true; }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authEmailRedirectUrl() });
    if (error) throw error;
    toast('Reset link sent to ' + email, 'success');
    return true;
  } catch (err) {
    toast(err.message || 'Could not send reset link', 'error');
    return false;
  }
}
async function setProfileActive(p, active) {
  if (p.id === state.profile?.id && !active) { toast('You can’t deactivate your own account.', 'error'); return; }
  if (typeof DEMO !== 'undefined' && DEMO) { p.is_active = active; saveDemoData(); toast(active ? 'Activated' : 'Deactivated', 'success'); mountApp(); return; }
  const { error } = await supabase.from('profiles').update({ is_active: active }).eq('id', p.id);
  if (error) { toast('Update failed: ' + error.message, 'error'); return; }
  p.is_active = active; toast(active ? 'Activated' : 'Deactivated', 'success'); mountApp();
  // Just ACTIVATED → offer the reset-link email right here, one press.
  if (active && p.email && confirm('Also email ' + p.email + ' a password-reset link so they can set their password?')) {
    await sendPasswordResetLink(p.email);
  }
}
// Which rep-type tab a person belongs to. App users inherit their linked (or
// email-matched) FieldRoutes type; otherwise infer from role.
const REP_TYPE_TABS = ['All', 'Office Staff', 'Technician', 'Sales Rep'];
const REP_TYPE_TAB_LABEL = { 'All': 'All', 'Office Staff': 'Office Staff', 'Technician': 'Technicians', 'Sales Rep': 'Sales Reps' };

// ── Adoption drill-down (per Isaac): the numbers on the Adoption cards,
// opened up — per-user activity, per-tab views, and the raw feedback. All
// from usage_events already in memory (state._usageStats); no extra query.
function openAdoptionDrill(kind, allRows, o = {}) {
  const rows = (allRows || []).filter(r => new Date(r.at).getTime() >= (o.since || 0));
  const profOf = (id) => (state.allProfiles || []).find(p => p.id === id) || null;
  const nameOf = (id) => (profOf(id) || {}).full_name || 'Unknown (' + String(id || '').slice(0, 8) + ')';
  const roleOf = (id) => { const p = profOf(id); return p ? ((typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[p.role]) || p.role || '') : ''; };
  const tabName = (d) => (typeof TAB_TITLES !== 'undefined' && TAB_TITLES[d]) ? String(TAB_TITLES[d]).replace(/^\w/, c => c.toUpperCase()) : (d || '\u2014');
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', { class: 'card w-full max-w-4xl p-5 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(modal);
  const th = (t, right) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-widest font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)' } }, t);
  const td = (t, right, cls = '') => el('td', { class: 'px-2 py-1.5 text-[12px] ' + (right ? 'text-right tabular-nums ' : '') + cls }, t);
  const table = (heads, body) => el('div', { class: 'overflow-x-auto mt-3' }, el('table', { class: 'w-full' }, el('thead', { style: { background: 'var(--card-2)' } }, el('tr', {}, ...heads)), el('tbody', {}, ...body)));
  const head = (title, sub, extra) => el('div', { class: 'flex items-start justify-between gap-3' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, title), el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, sub)),
    el('div', { class: 'flex items-center gap-2' }, extra || null, el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => overlay.remove() }, 'Close')));
  const dayKey = (iso) => String(iso || '').slice(0, 10);
  const perUser = () => {
    const m = new Map();
    for (const r of rows) {
      const u = m.get(r.profile_id) || (m.set(r.profile_id, { id: r.profile_id, events: 0, views: 0, days: new Set(), tabs: {}, last: 0, first: Infinity, feedback: 0 }), m.get(r.profile_id));
      const t = new Date(r.at).getTime();
      u.events++; if (r.event === 'view') { u.views++; if (r.detail) u.tabs[r.detail] = (u.tabs[r.detail] || 0) + 1; }
      if (r.event === 'feedback') u.feedback++;
      u.days.add(dayKey(r.at)); if (t > u.last) u.last = t; if (t < u.first) u.first = t;
    }
    return [...m.values()].sort((a, b) => b.last - a.last);
  };
  if (kind === 'users') {
    const users = perUser();
    let q = '';
    const body = el('tbody');
    const draw = () => {
      body.replaceChildren(...users.filter(u => !q || nameOf(u.id).toLowerCase().includes(q) || roleOf(u.id).toLowerCase().includes(q)).map(u => {
        const top = Object.entries(u.tabs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => tabName(k) + ' \u00d7' + n).join(' \u00b7 ');
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(el('span', { class: 'font-semibold' }, nameOf(u.id))),
          td(el('span', { style: { color: 'var(--text-muted)' } }, roleOf(u.id))),
          td(String(u.days.size), true), td(String(u.views), true), td(String(u.events), true),
          td(el('span', { title: new Date(u.last).toLocaleString() }, timeAgo(new Date(u.last).toISOString())), false, 'whitespace-nowrap'),
          td(el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, top || '\u2014')));
      }));
      if (!body.children.length) body.append(el('tr', {}, el('td', { class: 'px-2 py-4 text-center text-[11px]', colspan: '7', style: { color: 'var(--text-muted)' } }, 'No activity in this window.')));
    };
    draw();
    const search = el('input', { type: 'text', placeholder: 'Search name or role\u2026', class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '180px' }, oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });
    modal.append(head(o.title + ' \u00b7 ' + users.length + (users.length === 1 ? ' user' : ' users'), o.sub, search),
      el('div', { class: 'overflow-x-auto mt-3' }, el('table', { class: 'w-full' },
        el('thead', { style: { background: 'var(--card-2)' } }, el('tr', {}, th('User'), th('Access profile'), th('Days active', true), th('Tab views', true), th('Events', true), th('Last active'), th('Top tabs'))),
        body)));
  } else if (kind === 'tabs') {
    const views = rows.filter(r => r.event === 'view' && r.detail);
    const byTab = new Map();
    for (const r of views) { const t = byTab.get(r.detail) || (byTab.set(r.detail, { key: r.detail, n: 0, users: new Map() }), byTab.get(r.detail)); t.n++; t.users.set(r.profile_id, (t.users.get(r.profile_id) || 0) + 1); }
    const tabs = [...byTab.values()].sort((a, b) => b.n - a.n);
    const detail = el('div', { class: 'mt-3' });
    const showTab = (t) => {
      detail.replaceChildren(el('div', { class: 'rounded-lg border p-3', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'text-[11px] font-bold mb-1' }, tabName(t.key) + ' \u00b7 who opened it'),
        el('div', { class: 'flex flex-wrap gap-1.5' }, ...[...t.users.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] border', style: { borderColor: 'var(--border-2)' } }, nameOf(id) + ' \u00d7' + n)))));
    };
    modal.append(head(o.title + ' \u00b7 ' + views.length + ' views', o.sub),
      table([th('Tab'), th('Views', true), th('Unique users', true), th('Views / user', true), th('')],
        tabs.map(t => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(el('span', { class: 'font-semibold' }, tabName(t.key))), td(String(t.n), true), td(String(t.users.size), true), td((t.n / Math.max(1, t.users.size)).toFixed(1), true),
          td(el('button', { class: 'rounded-lg border px-2 py-0.5 text-[10px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => showTab(t) }, 'who \u2192'), true)))),
      detail);
  } else {
    const fb = rows.filter(r => r.event === 'feedback');
    // Attachments live in the private "feedback" bucket — admins get short
    // signed URLs; images inline as thumbnails, videos play in place.
    const attachBox = (r) => {
      const atts = (r.meta && Array.isArray(r.meta.attachments)) ? r.meta.attachments : [];
      if (!atts.length) return null;
      const box = el('div', { class: 'flex flex-wrap gap-2 mt-2' });
      atts.forEach(async (a) => {
        const slot = el('div', { class: 'rounded-lg border overflow-hidden', style: { borderColor: 'var(--border)', maxWidth: '260px' } },
          el('div', { class: 'text-[10px] px-2 py-1 truncate', style: { color: 'var(--text-muted)' } }, a.name || a.path));
        box.append(slot);
        try {
          const { data, error } = await supabase.storage.from('feedback').createSignedUrl(a.path, 3600);
          if (error || !data || !data.signedUrl) { slot.append(el('div', { class: 'text-[10px] px-2 pb-1', style: { color: '#B91C1C' } }, 'file unavailable')); return; }
          const url = data.signedUrl;
          if (/^image\//.test(a.type || '')) slot.prepend(el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, style: { display: 'block', maxWidth: '260px', maxHeight: '180px', objectFit: 'cover' } })));
          else if (/^video\//.test(a.type || '')) slot.prepend(el('video', { src: url, controls: true, preload: 'metadata', style: { display: 'block', maxWidth: '260px', maxHeight: '180px', background: '#000' } }));
          else slot.append(el('a', { href: url, target: '_blank', rel: 'noopener', class: 'text-[11px] font-semibold px-2 pb-1 block', style: { color: 'var(--accent)' } }, 'Open \u2192'));
        } catch (e) { slot.append(el('div', { class: 'text-[10px] px-2 pb-1', style: { color: '#B91C1C' } }, 'file unavailable')); }
      });
      return box;
    };
    modal.append(head(o.title + ' \u00b7 ' + fb.length, o.sub),
      fb.length ? el('div', { class: 'flex flex-col gap-2 mt-3' }, ...fb.map(r => el('div', { class: 'rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center justify-between gap-2 text-[10px]', style: { color: 'var(--text-muted)' } }, el('span', { class: 'font-bold', style: { color: 'var(--text)' } }, nameOf(r.profile_id) + ' \u00b7 ' + roleOf(r.profile_id)), el('span', { title: new Date(r.at).toLocaleString() }, timeAgo(r.at))),
        el('div', { class: 'text-[12px] mt-1 whitespace-pre-wrap' }, r.detail || ''),
        attachBox(r))))
      : el('div', { class: 'mt-3 text-[11px] text-center py-6', style: { color: 'var(--text-muted)' } }, 'No feedback in the last 30 days.'));
  }
  document.body.append(overlay);
}

function adminReps() {
  const host = el('div', { class: 'flex flex-col gap-4' });
  // ── 📊 Adoption — who's actually using the app (usage_events). Card
  // renders only once the telemetry table exists and has rows; silent
  // otherwise. Cached 5 minutes so opening Users doesn't hammer the DB. ──
  if (!(typeof DEMO !== 'undefined' && DEMO)) {
    const _stale = !state._usageStats || (Date.now() - state._usageStats.at) > 5 * 60000;
    if (_stale && !state._usageStatsLoading) {
      state._usageStatsLoading = true;
      (async () => {
        try {
          const since = new Date(Date.now() - 30 * 86400000).toISOString();
          let { data, error } = await supabase.from('usage_events')
            .select('profile_id, event, detail, at, meta').gte('at', since)
            .order('at', { ascending: false }).limit(5000);
          if (error && /meta/i.test(error.message || '')) ({ data, error } = await supabase.from('usage_events')   // migration not run yet
            .select('profile_id, event, detail, at').gte('at', since).order('at', { ascending: false }).limit(5000));
          state._usageStats = { at: Date.now(), rows: error ? null : (data || []) };
        } catch (e) { state._usageStats = { at: Date.now(), rows: null }; }
        state._usageStatsLoading = false;
        if (state.view === 'admin' && state.adminSection === 'users') mountApp();
      })();
    }
    const us = state._usageStats;
    if (us && us.rows && us.rows.length) {
      const wk = Date.now() - 7 * 86400000, day = Date.now() - 86400000;
      const nameOf = (id) => ((state.allProfiles || []).find(p => p.id === id) || {}).full_name || 'Unknown';
      const rows7 = us.rows.filter(r => new Date(r.at).getTime() >= wk);
      const active1 = new Set(us.rows.filter(r => new Date(r.at).getTime() >= day).map(r => r.profile_id));
      const active7 = new Set(rows7.map(r => r.profile_id));
      const tabCounts = {};
      rows7.forEach(r => { if (r.event === 'view' && r.detail) tabCounts[r.detail] = (tabCounts[r.detail] || 0) + 1; });
      const topTabs = Object.entries(tabCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const fb = us.rows.filter(r => r.event === 'feedback').slice(0, 3);
      // Every card drills down (per Isaac): who exactly, how often, which tabs.
      const stat = (label, val, drill) => el('button', { class: 'rounded-lg border px-3 py-2 text-center transition hover:brightness-95 w-full', style: { borderColor: 'var(--border)', background: 'var(--card-2)', cursor: 'pointer' }, title: 'Click for the breakdown', onclick: drill },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
        el('div', { class: 'text-lg font-bold tabular-nums' }, val),
        el('div', { class: 'text-[9px]', style: { color: 'var(--text-subtle)' } }, 'details \u2192'));
      host.append(el('div', { class: 'card p-4' },
        el('div', { class: 'flex items-center justify-between flex-wrap gap-2' },
          el('h3', { class: 'text-base font-bold' }, '\ud83d\udcca Adoption'),
          el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'last 30 days')),
        el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3' },
          stat('Active today', String(active1.size), () => openAdoptionDrill('users', us.rows, { since: day, title: 'Active today', sub: 'everyone with any activity in the last 24 hours' })),
          stat('Active \u00b7 7d', String(active7.size), () => openAdoptionDrill('users', us.rows, { since: wk, title: 'Active \u00b7 last 7 days', sub: 'everyone with any activity in the last 7 days' })),
          stat('Tab views \u00b7 7d', String(rows7.filter(r => r.event === 'view').length), () => openAdoptionDrill('tabs', us.rows, { since: wk, title: 'Tab views \u00b7 last 7 days', sub: 'which screens are getting opened, and by whom' })),
          stat('Feedback \u00b7 30d', String(us.rows.filter(r => r.event === 'feedback').length), () => openAdoptionDrill('feedback', us.rows, { since: 0, title: 'Feedback \u00b7 last 30 days', sub: 'everything sent through the feedback button' }))),
        ...fb.map(r => el('div', { class: 'mt-2 text-[11px] rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)' } },
          el('span', { class: 'font-bold' }, '\ud83d\udce3 ' + nameOf(r.profile_id) + ': '), r.detail || '',
          (r.meta && Array.isArray(r.meta.attachments) && r.meta.attachments.length) ? el('span', { class: 'ml-2 text-[10px]', style: { color: 'var(--text-subtle)' } }, '\ud83d\udcce ' + r.meta.attachments.length) : null))));
    }
  }
  // Pull the CRM roster the first time an admin opens this screen.
  if (!(typeof DEMO !== 'undefined' && DEMO) && state.frRoster == null && !state._frRosterLoading) {
    loadFieldRoutesRoster().then(() => { if (state.view === 'admin') mountApp(); });
  }

  // Persisted UI state: which rep-type tab, active/inactive/all, search box.
  if (!REP_TYPE_TABS.includes(state._adminUserTypeTab)) state._adminUserTypeTab = 'All';
  if (state._adminUserActiveFilter == null) state._adminUserActiveFilter = 'active';
  if (state._adminUserSearch == null) state._adminUserSearch = '';
  const typeTab = state._adminUserTypeTab;
  const activeFilter = state._adminUserActiveFilter;
  const q = state._adminUserSearch.trim().toLowerCase();

  const allProfiles = state.allProfiles.length ? state.allProfiles : [state.profile];
  const roster = state.frRoster || [];
  const rosterById = new Map(roster.map(e => [e.employee_id, e]));

  // ── Merge app profiles + CRM roster into one "people" list ──
  // A person is either an app user (a real login) or a CRM-only employee
  // (display-only until provisioned). App users inherit their FieldRoutes type
  // (via link or email match); roster-only people use their CRM type.
  // The FieldRoutes employee behind an app user — linked first, then email
  // match, then full-name match (covers app logins whose email differs from
  // the CRM email, e.g. cameron@riddpest.com vs crprymak@gmail.com).
  const profFrEmp = (p) => {
    const linked = frRosterRowForProfile(p) || (p.fieldroutes_employee_id ? rosterById.get(p.fieldroutes_employee_id) : null);
    if (linked) return linked;
    const byEmail = roster.find(e => e.email && _frNormEmail(e.email) === _frNormEmail(p.email));
    if (byEmail) return byEmail;
    const pn = _frNormName(p.full_name);
    return (pn && roster.find(e => _frRealName(e) === pn || _frNormName(_frEmpName(e)) === pn)) || null;
  };
  const appByEmpId = new Map();
  const appEmails = new Set();
  allProfiles.forEach(p => { if (p.fieldroutes_employee_id) appByEmpId.set(p.fieldroutes_employee_id, p); if (p.email) appEmails.add(_frNormEmail(p.email)); });

  // Every CRM employee an app user resolves to — so they never also appear as a
  // separate "in CRM" row (which is what duplicated Cameron).
  const matchedEmpIds = new Set();
  const people = allProfiles.map(p => {
    const fr = profFrEmp(p);
    if (fr) matchedEmpIds.add(fr.employee_id);
    return {
      isApp: true, profile: p, frEmp: fr, name: p.full_name || '(no name)', email: p.email || '',
      // Rep type comes from FieldRoutes when we know it; role is only a fallback.
      type: (fr && fr.type_label) || (p.role === 'rep' ? 'Sales Rep' : 'Office Staff'),
      active: p.is_active !== false,
    };
  });
  roster.forEach(e => {
    if (appByEmpId.has(e.employee_id)) return;                       // already a linked app user
    if (matchedEmpIds.has(e.employee_id)) return;                    // matched to an app user (email or name)
    if (e.email && appEmails.has(_frNormEmail(e.email))) return;     // matches an app user's email
    people.push({ isApp: false, emp: e, name: _frEmpName(e), email: e.email || '', type: e.type_label || 'Office Staff', active: false });
  });

  const byName = (a, b) => a.name.localeCompare(b.name);
  const countByType = (t) => t === 'All' ? people.length : people.filter(x => x.type === t).length;

  // ── Header ──
  // Rep-type tabs sit right of the title (per Isaac — saves a row).
  // Phones (per Isaac): the four type tabs share ONE row — tighter padding
  // and the counts drop, so Sales Reps fits beside Technicians.
  const _phoneU = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } })();
  const _typeTabs = el('div', { class: 'flex items-center gap-1' + (_phoneU ? '' : ' flex-wrap'), style: _phoneU ? { width: '100%' } : {} },
    ...REP_TYPE_TABS.map(t => {
      const on = typeTab === t;
      return el('button', {
        class: (_phoneU ? 'px-2 py-1 flex-1 justify-center' : 'px-2.5 py-1') + ' text-[11px] font-semibold transition whitespace-nowrap flex items-center gap-2 rounded-lg',
        style: { background: on ? 'rgba(223,100,58,.10)' : 'transparent', color: on ? 'var(--text)' : 'var(--text-muted)', boxShadow: on ? 'inset 0 -2px 0 var(--accent)' : 'none' },
        onclick: () => { state._adminUserTypeTab = t; mountApp(); },
      }, REP_TYPE_TAB_LABEL[t],
        _phoneU ? null : el('span', { class: 'text-[10px] tabular-nums px-1.5 py-0.5 rounded', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } }, countByType(t).toLocaleString()));
    }));
  // The eye (view-as) + New user move down to the status row on phones so
  // everything sits on one line: [Active | Inactive | All] [+ New user] [Filters] [👁].
  const _actionsRow = el('div', { class: 'flex items-center gap-2' });
  host.append(el('div', { class: 'flex items-center justify-between flex-wrap gap-3' },
    el('div', { class: 'flex items-center gap-4 flex-wrap' + (_phoneU ? ' w-full' : '') },
      el('h3', { class: 'text-lg font-bold' }, 'Users'), _typeTabs),
    _actionsRow));
  _actionsRow.append(
      // 👁 View-as — icon only; the hover tip explains it, the click opens
      // a small role menu. Renders the app exactly as that role sees it (the
      // floating pill brings you back to admin).
      (() => {
        const wrap = el('div', { class: 'relative' });
        const menu = el('div', {
          class: 'card',
          style: { position: 'absolute', top: 'calc(100% + 6px)', right: '0', minWidth: '190px', padding: '6px', display: 'none', zIndex: '50', boxShadow: 'var(--shadow-lg)' },
        },
          el('div', { class: 'px-3 pt-1.5 pb-2 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'View the app as\u2026'),
          ...['rep_sales', 'rep_partner', 'rep_team_lead', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'auditor'].map(v => [v, ROLE_LABEL[v]]).map(([v, label]) => el('button', {
            class: 'w-full text-left px-2.5 py-1 rounded-lg text-[11px] font-medium transition',
            style: { color: 'var(--text)' },
            onmouseenter: (e) => { e.currentTarget.style.background = 'var(--card-2)'; },
            onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
            onclick: () => setViewAsRole(v),
          }, label)),
          // ── View as a specific PERSON (per Isaac): their whole identity —
          // name, id, role, office, team reach — so the page is exactly what
          // they get (team card, drills, permissions), not just their role.
          el('div', { class: 'px-3 pt-2 pb-1 mt-1 border-t text-[10px] uppercase tracking-widest font-semibold', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } }, 'View as a person\u2026'),
          (() => {
            const list = el('div', { class: 'flex flex-col', style: { maxHeight: '220px', overflowY: 'auto' } });
            const roleRank = (r) => (['rep_partner', 'rep_team_lead', 'rep_office_lead', 'rep_loyalty_lead', 'rep_office', 'rep_loyalty', 'rep_sales'].indexOf(r) + 1) || 99;
            const people = (state.allProfiles || []).filter(p => p && p.id && p.is_active !== false && !isAdminRole(p.role))
              .sort((a, b) => (roleRank(a.role) - roleRank(b.role)) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
            const shortRole = (r) => (ROLE_LABEL[r] || r || '').replace(/^Rep - /, '');
            const draw = (q) => {
              list.replaceChildren();
              const needle = String(q || '').trim().toLowerCase();
              const hits = needle ? people.filter(p => (String(p.full_name || '') + ' ' + shortRole(p.role)).toLowerCase().includes(needle)) : people;
              if (!hits.length) { list.append(el('div', { class: 'px-2.5 py-1 text-[10px]', style: { color: 'var(--text-subtle)' } }, 'No match')); return; }
              let lastRole = null;
              hits.forEach(p => {
                if (!needle && p.role !== lastRole) {
                  lastRole = p.role;
                  list.append(el('div', { class: 'px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, shortRole(p.role)));
                }
                list.append(el('button', {
                  class: 'w-full text-left px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center justify-between gap-2',
                  style: { color: 'var(--text)' },
                  onmouseenter: (e) => { e.currentTarget.style.background = 'var(--card-2)'; },
                  onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
                  onclick: () => setViewAsProfile(p),
                }, el('span', { class: 'truncate' }, p.full_name || p.email || p.id),
                  needle ? el('span', { class: 'text-[9px] uppercase tracking-wider shrink-0', style: { color: 'var(--text-subtle)' } }, shortRole(p.role)) : null));
              });
            };
            const inp = el('input', { type: 'text', placeholder: 'Search a name or role\u2026', class: 'rounded-lg border px-2.5 py-1 text-[11px] w-full mb-1', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
              oninput: (e) => draw(e.target.value), onclick: (e) => e.stopPropagation() });
            draw('');
            return el('div', { class: 'px-1.5 pb-1' }, inp, list);
          })());
        const btn = el('button', {
          class: 'icon-btn show',
          title: 'Change rep type view',
          onclick: () => {
            const open = menu.style.display === 'block';
            if (!open) {
              // Anchor to whichever side has room — right-anchored clipped
              // off-screen when the wrapped mobile header put the eye at
              // the LEFT edge.
              const r = wrap.getBoundingClientRect();
              if (r.left < 210) { menu.style.right = 'auto'; menu.style.left = '0'; }
              else { menu.style.left = 'auto'; menu.style.right = '0'; }
            }
            menu.style.display = open ? 'none' : 'block';
            if (!open) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
              if (!wrap.contains(ev.target)) { menu.style.display = 'none'; document.removeEventListener('mousedown', closer); }
            }), 0);
          },
        }, '\ud83d\udc41');
        wrap.append(btn, menu);
        return wrap;
      })(),
      el('button', {
        class: 'px-2.5 py-1 rounded-xl font-semibold text-[11px] transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)', height: '28px' },
        onclick: () => openUserEditor(),
      }, '+ New user'));
  // (the two action controls are re-homed into the status row below)
  const _eyeWrap = _actionsRow.children[0], _newUserBtn = _actionsRow.children[1];

  // ── Roster status banner — tells the admin exactly why the CRM roster is
  // empty (table missing → run the SQL; loaded 0 → run a sync; or an error). ──
  if (!(typeof DEMO !== 'undefined' && DEMO) && roster.length === 0) {
    const err = state._frRosterError || '';
    const missingTable = /relation .*does not exist|could not find the table|schema cache/i.test(err);
    host.append(el('div', { class: 'card p-4', style: { borderLeft: '3px solid var(--accent)' } },
      el('div', { class: 'text-sm font-bold mb-1' }, 'FieldRoutes roster not loaded yet'),
      el('div', { class: 'text-xs text-muted-' },
        missingTable
          ? 'The fieldroutes_employees table doesn’t exist yet — run fieldroutes_link.sql in Supabase; the next scheduled sync (hourly) fills it.'
          : err
            ? ('Couldn’t read the roster: ' + err)
            : 'The table is empty — the next scheduled sync (hourly during the day) pulls the FieldRoutes roster automatically.')));
  }

  // ── Active / Inactive / All + column filters + search — ONE row:
  // status toggle on the left; ⚲ filters sit just left of the search box. ──
  const inTab = typeTab === 'All' ? people : people.filter(x => x.type === typeTab);
  const aCount = inTab.filter(x => x.active).length;
  const F = state._adminUserFilters || (state._adminUserFilters = {});
  const _roleOpts = [...new Set(inTab.filter(x => x.isApp).map(x => String(x.profile.role || '')))].filter(Boolean).sort();
  const _officeOpts = [...new Set(inTab.flatMap(x => { const e = x.frEmp || x.emp; return String((e && e.office_name) || '').split(',').map(s => s.trim()).filter(Boolean); }))].sort();
  const _fActive = ['role', 'office', 'tier'].filter(k => F[k]).length;
  const _fSel = (key, label, opts) => el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer w-full',
    style: { borderColor: F[key] ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', fontWeight: F[key] ? '700' : '400' },
    title: 'Filter the list by ' + label.toLowerCase(),
    onchange: (e) => { F[key] = e.target.value; mountApp(); },
  },
    el('option', { value: '', selected: !F[key] }, label + ' — all'),
    ...opts.map(o => el('option', { value: o.v, selected: F[key] === o.v }, o.t)));
  // ONE row: status toggle · Filters dropdown (Access Profile / Branch /
  // Tier + Clear live inside) · search stretching to fill what's left —
  // on phones the search wraps to its own full-width line.
  const _filtersWrap = (() => {
    const wrap = el('div', { class: 'relative' });
    const _fLabel = (t) => el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold px-0.5 pb-1', style: { color: 'var(--text-subtle)' } }, t);
    const panel = el('div', {
      class: 'card absolute p-3 flex flex-col gap-2',
      style: { top: 'calc(100% + 6px)', left: '0', minWidth: '250px', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._adminUserFiltersOpen ? 'flex' : 'none' },
    },
      el('div', {}, _fLabel('Access Profile'), _fSel('role', 'Access Profile', [..._roleOpts.map(r => ({ v: r, t: roleLabel(r) })), { v: '__crm', t: 'In CRM (not added)' }])),
      el('div', {}, _fLabel('Branch'), _fSel('office', 'Branch', _officeOpts.map(o => ({ v: o, t: o })))),
      el('div', {}, _fLabel('Tier'), _fSel('tier', 'Tier', (typeof REP_TIERS !== 'undefined' ? REP_TIERS : []).map(t => ({ v: t.id, t: t.label })))),
      _fActive ? el('button', {
        class: 'text-[11px] font-bold px-2.5 py-1 rounded-lg border transition hover:brightness-95',
        style: { borderColor: 'var(--accent)', color: 'var(--accent)' },
        onclick: () => { state._adminUserFilters = {}; mountApp(); },
      }, '× Clear (' + _fActive + ')') : null);
    const btn = el('button', {
      class: 'px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition hover:brightness-95 flex items-center gap-1.5',
      style: _fActive
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'flex';
        panel.style.display = open ? 'none' : 'flex';
        state._adminUserFiltersOpen = !open;
        if (!open) clampDropdownPanel(panel);
        if (!open) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
          if (wrap.contains(ev.target)) return;
          panel.style.display = 'none'; state._adminUserFiltersOpen = false;
          document.removeEventListener('mousedown', closer);
        }), 0);
      },
    }, 'Filters' + (_fActive ? ' · ' + _fActive : ''));
    if (state._adminUserFiltersOpen) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
      if (wrap.contains(ev.target)) return;
      panel.style.display = 'none'; state._adminUserFiltersOpen = false;
      document.removeEventListener('mousedown', closer);
    }), 0);
    wrap.append(btn, panel);
    clampDropdownPanel(panel);
    return wrap;
  })();
  _actionsRow.remove();
  host.append(el('div', { class: 'flex items-center flex-wrap gap-2' },
    el('div', { class: 'inline-flex rounded-xl border overflow-hidden shrink-0', style: { borderColor: 'var(--border-2)', height: '28px' } },
      ...[
        { id: 'active', label: 'Active', count: aCount },
        { id: 'inactive', label: 'Inactive', count: inTab.length - aCount },
        { id: 'all', label: 'All', count: inTab.length },
      ].map(t => el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition flex items-center gap-1.5',
        style: activeFilter === t.id ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'transparent', color: 'var(--text)' },
        onclick: () => { state._adminUserActiveFilter = t.id; mountApp(); },
      }, el('span', {}, t.label),
        el('span', { class: 'text-[10px] tabular-nums px-1.5 py-0.5 rounded', style: activeFilter === t.id ? { background: 'rgba(0,0,0,.15)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)' } }, t.count.toLocaleString())))),
    el('input', {
      id: 'admin-user-search',
      class: 'rounded-xl border px-2.5 py-1 text-[11px] flex-1 min-w-0', style: { borderColor: 'var(--border-2)', minWidth: '180px' },
      placeholder: 'Search ' + REP_TYPE_TAB_LABEL[typeTab] + '…', value: state._adminUserSearch,
      // The debounced mountApp() rebuilds the whole page, which replaces
      // this input and dropped focus mid-word - typing felt like the page
      // refreshed on every character. The list is paginated with per-tab
      // counts, so rows can't just be hidden in place like the leaderboard
      // search; instead the remount re-focuses the rebuilt input with the
      // caret back where it was.
      oninput: (e) => {
        state._adminUserSearch = e.target.value;
        clearTimeout(state._adminUserSearchT);
        state._adminUserSearchT = setTimeout(() => {
          mountApp();
          const inp = document.getElementById('admin-user-search');
          if (inp) { inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (err) { /* non-text input */ } }
        }, 200);
      },
    }),
    // Right-hand cluster (per Isaac): search sits left, actions pinned right.
    el('div', { class: 'flex items-center gap-2 shrink-0 ml-auto' }, _newUserBtn, _filtersWrap, _eyeWrap)));

  // ── Build the filtered, capped list for this tab ──
  let list = inTab;
  if (activeFilter === 'active') list = list.filter(x => x.active);
  else if (activeFilter === 'inactive') list = list.filter(x => !x.active);
  if (q) list = list.filter(x => (x.name + ' ' + x.email).toLowerCase().includes(q));
  if (F.role) list = list.filter(x => (x.isApp ? String(x.profile.role || '') : '__crm') === F.role);
  if (F.office) list = list.filter(x => { const e = x.frEmp || x.emp; return String((e && e.office_name) || '').split(',').map(s => s.trim()).includes(F.office); });
  // (Tier filter is applied a few lines down, once repKeyForPerson exists.)

  const statusChip = (active) => el('span', { class: 'chip', style: active
    ? { background: 'rgba(223,100,58,.14)', color: '#DF643A', border: '1px solid rgba(223,100,58,.4)' }
    : { background: 'rgba(220,38,38,.08)', color: '#B91C1C', border: '1px solid rgba(220,38,38,.25)' } }, active ? 'Active' : 'Inactive');

  // Readable last-login from the CRM string ("YYYY-MM-DD HH:MM:SS" or blank).
  const fmtLogin = (s) => {
    if (!s || /^0+[^0-9]/.test(String(s)) || /^0000/.test(String(s))) return 'Never';
    const d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  };
  const td  = (v, extra) => el('td', { class: 'px-2.5 py-2.5 ' + (extra || '') }, v == null || v === '' ? '—' : v);
  const tdM = (v) => td(v, 'text-muted-');

  // ── Team + Tier columns (read from the same maps Manage Teams writes) ──
  // Those maps are keyed by the canonical sales-data rep name ("Last, First"),
  // while a profile carries "First Last". Bridge them with a format-agnostic
  // name signature, the same trick Manage Teams uses. Team is per-Team-Year;
  // Tier is global.
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const _repKeyBySig = {};
  const _seedKey = (name) => { if (!name) return; const s = _sig(name); if (s && !_repKeyBySig[s]) _repKeyBySig[s] = name; };
  Object.keys(_activeTeamMap() || {}).forEach(_seedKey);
  Object.keys(state._indicatorRepTier || {}).forEach(_seedKey);
  (state.reportingSubscriptions || []).forEach(r => { if (r.sold_by) _seedKey(getCanonicalRepName(r.sold_by)); });
  // The canonical rep name to read/write team & tier for this person.
  const repKeyForPerson = (x) => {
    const s = _sig(x.name);
    if (_repKeyBySig[s]) return _repKeyBySig[s];
    const frName = x.frEmp ? _frEmpName(x.frEmp) : (x.emp ? _frEmpName(x.emp) : '');
    if (frName) { const s2 = _sig(frName); if (_repKeyBySig[s2]) return _repKeyBySig[s2]; }
    return x.name; // no match yet — key under their own name
  };
  // Tier filter needs repKeyForPerson, so it lands here; then split the list.
  if (F.tier) list = list.filter(x => (getRepTier(repKeyForPerson(x)) || '') === F.tier);
  // ── Click-to-sort — any column header toggles asc/desc. App users and
  // CRM-only rows each sort within their own block (app users stay on top).
  if (!state._adminUserSort) state._adminUserSort = { key: 'name', asc: true };
  const _us = state._adminUserSort;
  const _sortVal = (x, key) => {
    const p = x.profile, e2 = x.frEmp || x.emp;
    switch (key) {
      case 'id':       return Number((e2 && e2.employee_id) || 0) || 0;
      case 'username': return String((e2 && e2.username) || '').toLowerCase();
      case 'role':     return x.isApp ? roleLabelOf(p).toLowerCase() : '~in crm';
      case 'reptype':  return (x.type || '').toLowerCase();
      case 'phone':    return String((p && p.phone) || (e2 && e2.phone) || '');
      case 'email':    return String((p && p.email) || (e2 && e2.email) || '').toLowerCase();
      case 'tier':     return getRepTier(repKeyForPerson(x)) || '~';
      case 'status':   return x.active ? 0 : 1;
      default:         return (x.name || '').toLowerCase();
    }
  };
  const bySort = (a, b) => {
    const va = _sortVal(a, _us.key), vb = _sortVal(b, _us.key);
    const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb));
    return (_us.asc ? cmp : -cmp) || byName(a, b);
  };
  const appPeople = list.filter(x => x.isApp).sort(bySort);
  const rosterPeople = list.filter(x => !x.isApp).sort(bySort);
  // CRM-only rows are PAGED — 25 per page with arrows under the table. The
  // page resets whenever the tab / search / filters change the list.
  const PAGE_SIZE = 25;
  const _pageSig = [typeTab, activeFilter, q, F.role || '', F.office || '', F.tier || ''].join('|');
  if (state._adminUserPageSig !== _pageSig) { state._adminUserPageSig = _pageSig; state._adminUserRosterPage = 0; }
  const pageCount = Math.max(1, Math.ceil(rosterPeople.length / PAGE_SIZE));
  const page = Math.min(state._adminUserRosterPage || 0, pageCount - 1);
  state._adminUserRosterPage = page;
  const rosterShown = rosterPeople.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // Tier cell. Currently writes the manual Rookie/Vet tag (shared with Manage
  // Teams). TODO: once FieldRoutes carries a rookie/vet designation, source this
  // read-only from the roster instead of the manual tag.
  const tierCell = (x) => {
    const key = repKeyForPerson(x);
    const curTier = getRepTier(key);
    const tierMeta = (typeof repTierMeta === 'function') ? repTierMeta(curTier) : null;
    const tierSel = el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: tierMeta ? 'rgba(223,100,58,.08)' : 'var(--card-2)', color: tierMeta ? tierMeta.color : 'var(--text)', fontWeight: tierMeta ? '700' : '400' },
      onchange: (e) => { setRepTier(key, e.target.value); mountApp(); },
    },
      el('option', { value: '', selected: !curTier }, '— Tier —'),
      ...REP_TIERS.map(t => el('option', { value: t.id, selected: curTier === t.id }, t.label)));
    return el('td', { class: 'px-3 py-3' }, tierSel);
  };

  // Avatar that opens a photo picker on click (app users only) — saves straight
  // from the table without opening the editor. Hover shows an accent ring + 📷.
  const clickableAvatar = (p) => {
    const wrap = el('button', {
      class: 'relative shrink-0 cursor-pointer rounded-full',
      title: 'Click to change photo',
      style: { lineHeight: '0', borderRadius: '0', transition: 'box-shadow .12s' },
      onmouseenter: (e) => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'; const b = e.currentTarget.querySelector('[data-cam]'); if (b) b.style.opacity = '1'; },
      onmouseleave: (e) => { e.currentTarget.style.boxShadow = 'none'; const b = e.currentTarget.querySelector('[data-cam]'); if (b) b.style.opacity = '0'; },
      onclick: (e) => { e.stopPropagation(); changeProfileAvatar(p); },
    },
      avatarNode(p.avatar_url, p.initials, 'w-9 h-9 text-[10px]'),
      el('div', { 'data-cam': '1', class: 'absolute rounded-full flex items-center justify-center',
        style: { bottom: '-2px', right: '-2px', width: '16px', height: '16px', background: '#323230', border: '2px solid var(--card)', opacity: '0', transition: 'opacity .12s' } },
        el('span', { style: { color: '#F3F3F3', fontSize: '8px' } }, '📷')));
    return wrap;
  };

  const appRow = (x) => {
    const p = x.profile, active = x.active, fr = x.frEmp;
    return el('tr', { class: 'border-t border-' + (!active ? ' opacity-60' : '') },
      tdM(fr ? fr.employee_id : null),                                    // ID (CRM)
      el('td', { class: 'px-4 py-3' }, el('div', { class: 'flex items-center gap-3' },
        clickableAvatar(p),
        el('div', {}, el('div', { class: 'font-semibold' }, p.full_name),
          fr && !p.fieldroutes_employee_id ? el('div', { class: 'text-[10px]', style: { color: 'var(--accent)' } }, '↔ match — confirm to link') : null))),
      tdM(fr ? fr.username : null),                                       // User ID (CRM username)
      td(roleLabelOf(p), p.is_owner ? 'font-bold' : ''),                 // Access Profile (app role)
      td(fr ? fr.type_label : null, fr ? '' : 'text-muted- italic'),      // Rep Type (CRM)
      tdM(p.phone || (fr ? fr.phone : null)),                             // Phone (profile wins, else CRM)
      (() => { const em = p.email || (fr ? fr.email : null);              // Email — truncated, full on hover
        return el('td', { class: 'px-2.5 py-2.5 text-muted- max-w-[180px] truncate', title: em || '' }, em || '—'); })(),
      // Last Login moved into Edit User — it was costing a whole column.
      tierCell(x),                                                       // Tier
      el('td', { class: 'px-3 py-3 text-center' },
        el('button', { title: active ? 'Click to deactivate' : 'Click to activate (offers a reset-link email)', onclick: () => setProfileActive(p, !active) }, statusChip(active))),
      el('td', { class: 'px-3 py-3 text-right whitespace-nowrap' },
        // Row-level password-reset button retired (per Isaac) - the reset
        // link lives in Edit User (sendPasswordResetLink via the editor's
        // Send Reset Link button), so the row stays one action wide.
        el('button', { class: 'text-[11px] px-2.5 py-1 rounded-lg border border- text-muted- hover:text-default transition', onclick: () => openUserEditor(p) }, 'Edit')));
  };
  const rosterRow = (x) => {
    const e = x.emp;
    return el('tr', { class: 'border-t border- opacity-80' },
      tdM(e.employee_id),                                                 // ID
      el('td', { class: 'px-4 py-3' }, el('div', { class: 'flex items-center gap-3' },
        avatarNode(null, (e.fname || '?')[0] + (e.lname || '')[0], 'w-9 h-9 text-[10px]'),
        // Branch list moved off the row (it made Name eat the table) — hover
        // the name to see which branches this person has access to.
        el('div', { class: 'font-semibold whitespace-nowrap', title: e.office_name ? 'Branches: ' + e.office_name : undefined }, x.name))),
      tdM(e.username),                                                    // User ID
      el('td', { class: 'px-3 py-3 text-muted- italic' }, 'In CRM'),      // Access Profile (none yet)
      td(e.type_label),                                                   // Rep Type
      tdM(e.phone),                                                       // Phone
      (() => el('td', { class: 'px-2.5 py-2.5 text-muted- max-w-[180px] truncate', title: e.email || '' }, e.email || '—'))(),  // Email
      tierCell(x),                                                       // Tier
      el('td', { class: 'px-3 py-3 text-center' }, statusChip(false)),
      el('td', { class: 'px-3 py-3 text-right' },
        el('button', { class: 'text-[11px] px-2.5 py-1 rounded-lg font-bold transition hover:brightness-95 whitespace-nowrap', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => openUserEditor(null, {
            // REAL first+last (matches CRM sold_by), never the nickname —
            // a nickname profile can't match its own sales rows.
            full_name: _frRealName(e).replace(/\b\w/g, c => c.toUpperCase()) || x.name,
            email: e.email || '', phone: e.phone || '',
            role: /office\s*staff/i.test(e.type_label || '') ? 'rep_office' : 'rep_sales',
            fieldroutes_employee_id: e.employee_id }) }, '+ Add to app')));
  };

  const th = (label, align, key) => key
    ? el('th', {
        class: (align || 'text-left') + ' px-3 py-3 cursor-pointer select-none transition hover:brightness-110 whitespace-nowrap',
        style: _us.key === key ? { color: 'var(--accent)', fontWeight: '800' } : {},
        title: 'Sort by ' + label + (_us.key === key ? (_us.asc ? ' — descending next' : ' — ascending next') : ''),
        onclick: () => { if (_us.key === key) { _us.asc = !_us.asc; } else { _us.key = key; _us.asc = true; } mountApp(); },
      }, label)
    : el('th', { class: (align || 'text-left') + ' px-3 py-3' }, label);
  host.append(el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' },
    el('table', { class: 'w-full text-sm whitespace-nowrap' },
      el('thead', { class: 'text-[10px] uppercase tracking-widest text-muted-' }, el('tr', {},
        th('ID', null, 'id'), th('Name', 'text-left', 'name'), th('User Name', null, 'username'), th('Access Profile', null, 'role'),
        th('Rep Type', null, 'reptype'), th('Phone', null, 'phone'), th('Email', null, 'email'),
        th('Tier', null, 'tier'), th('Status', 'text-center', 'status'), th('', 'text-right'))),
      el('tbody', {},
        (appPeople.length + rosterShown.length) === 0
          ? el('tr', {}, el('td', { class: 'px-4 py-8 text-center text-xs text-muted- italic', colspan: 10 },
              q ? 'No ' + REP_TYPE_TAB_LABEL[typeTab] + ' match “' + state._adminUserSearch + '”.' : 'No ' + REP_TYPE_TAB_LABEL[typeTab] + ' in this view.'))
          : null,
        ...appPeople.map(appRow),
        ...rosterShown.map(rosterRow))))));

  if (rosterPeople.length > PAGE_SIZE) {
    const _pFirst = page * PAGE_SIZE + 1;
    const _pLast = Math.min(rosterPeople.length, (page + 1) * PAGE_SIZE);
    const pagerBtn = (label, enabled, go) => el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold transition' + (enabled ? ' hover:brightness-95 cursor-pointer' : ''),
      style: enabled
        ? { borderColor: 'var(--border-2)', color: 'var(--text)' }
        : { borderColor: 'var(--border)', color: 'var(--text-subtle)', cursor: 'default' },
      disabled: !enabled,
      title: label === '‹' ? 'Previous page' : 'Next page',
      onclick: enabled ? go : undefined,
    }, label);
    host.append(el('div', { class: 'flex items-center justify-between flex-wrap gap-2' },
      el('div', { class: 'text-[11px] text-muted-' },
        'Showing ' + _pFirst + '–' + _pLast + ' of ' + rosterPeople.length.toLocaleString() + ' CRM-only ' + REP_TYPE_TAB_LABEL[typeTab]),
      el('div', { class: 'flex items-center gap-1' },
        pagerBtn('‹', page > 0, () => { state._adminUserRosterPage = page - 1; mountApp(); }),
        el('span', { class: 'text-[11px] font-semibold px-2 tabular-nums' }, 'Page ' + (page + 1) + ' of ' + pageCount),
        pagerBtn('›', page < pageCount - 1, () => { state._adminUserRosterPage = page + 1; mountApp(); }))));
  }

  // ── Auto-link review (email matches) — kept as a banner above the list ──
  if (roster.length) {
    const linkedIds = new Set(allProfiles.map(p => p.fieldroutes_employee_id).filter(Boolean));
    const suggestions = [];
    for (const p of allProfiles) {
      if (p.fieldroutes_employee_id) continue;
      const hit = profFrEmp(p); // email or full-name match
      if (hit && !linkedIds.has(hit.employee_id)) suggestions.push({ p, e: hit });
    }
    if (suggestions.length) {
      host.append(el('div', { class: 'card p-4' },
        el('div', { class: 'flex items-center justify-between flex-wrap gap-2 mb-3' },
          el('div', {},
            el('h3', { class: 'text-base font-bold' }, '↔ FieldRoutes links to review'),
            el('p', { class: 'text-xs text-muted-' }, suggestions.length + ' app user' + (suggestions.length === 1 ? '' : 's') + ' matched a CRM employee by email. Confirm to link.')),
          el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: async () => { for (const s of suggestions) { await applyFieldRoutesLink(s.p.id, s.e.employee_id); } } }, 'Link all ' + suggestions.length)),
        el('div', { class: 'flex flex-col divide-y', style: { borderColor: 'var(--border)' } },
          ...suggestions.slice(0, 30).map(({ p, e }) => el('div', { class: 'flex items-center justify-between gap-3 py-2 text-sm' },
            el('div', { class: 'min-w-0' },
              el('span', { class: 'font-semibold' }, p.full_name),
              el('span', { class: 'text-muted-' }, ' → ' + _frEmpName(e) + (e.office_name ? ' · ' + e.office_name : '') + (e.type_label ? ' · ' + e.type_label : '')),
              el('div', { class: 'text-[11px] text-muted-' }, p.email)),
            el('button', { class: 'text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition hover:brightness-95', style: { borderColor: 'var(--border-2)' },
              onclick: () => applyFieldRoutesLink(p.id, e.employee_id) }, 'Link'))))));
    }
  }

  return host;
}

// ──────────────────────────────────────────────────────────────────────────
// USER EDITOR MODAL (admin)
// ──────────────────────────────────────────────────────────────────────────
// `prefill` lets "Add to app" from the FieldRoutes roster seed a NEW user with
// the CRM's name/email/phone (+ the fieldroutes_employee_id link) so nothing is
// re-typed. It only applies when existing == null.
// Click-to-change avatar straight from the Users table — no need to open the
// editor. Pops a file picker, center-crops to the same 80×80 JPEG thumbnail the
// editor uses, persists to the profile, and re-renders. App users only (a
// CRM-only person has no profiles row to save to yet).
// ── Avatar crop modal — drag + zoom behind a fixed circle guide ──────────
// Shared by every avatar upload path. The photo sits under a circular
// cut-out (exactly how avatars render app-wide); drag to position, slide to
// zoom, Save exports the same compact 80×80 JPEG the old auto-crop produced.
function openAvatarCropModal(file, onDone) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read that image', 'error'); };
  img.onload = () => {
    const V = Math.min(300, Math.max(220, Math.floor(window.innerWidth * 0.7)));   // viewport px (square)
    const baseScale = V / Math.min(img.width, img.height);                          // "cover" at zoom 1
    let zoom = 1;
    let offX = (V - img.width * baseScale) / 2;                                     // centered start
    let offY = (V - img.height * baseScale) / 2;
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => { overlay.remove(); URL.revokeObjectURL(url); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);

    const canvas = el('canvas', { width: String(V), height: String(V), style: { display: 'block', touchAction: 'none', cursor: 'grab' } });
    const ctx = canvas.getContext('2d');
    const clamp = () => {
      const s = baseScale * zoom;
      offX = Math.min(0, Math.max(V - img.width * s, offX));
      offY = Math.min(0, Math.max(V - img.height * s, offY));
    };
    const draw = () => {
      clamp();
      const s = baseScale * zoom;
      ctx.clearRect(0, 0, V, V);
      ctx.drawImage(img, offX, offY, img.width * s, img.height * s);
    };
    // Drag to reposition (pointer events cover mouse + touch).
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - offX, y: e.clientY - offY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; offX = e.clientX - drag.x; offY = e.clientY - drag.y; draw(); });
    const endDrag = () => { drag = null; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    const zoomInput = el('input', {
      type: 'range', min: '1', max: '3', step: '0.01', value: '1', class: 'w-full',
      title: 'Zoom',
      oninput: (e) => {
        // Zoom around the viewport center so the framed subject stays put.
        const next = parseFloat(e.target.value) || 1;
        const s0 = baseScale * zoom, s1 = baseScale * next;
        const cx = V / 2, cy = V / 2;
        offX = cx - ((cx - offX) / s0) * s1;
        offY = cy - ((cy - offY) / s0) * s1;
        zoom = next;
        draw();
      },
    });

    const card = el('div', { class: 'card p-5 flex flex-col gap-4 items-center', style: { width: (V + 40) + 'px', maxWidth: '94vw' } },
      el('div', { class: 'w-full flex items-center justify-between' },
        el('div', {},
          el('h2', { class: 'text-base font-bold' }, 'Position Your Photo'),
          el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Drag to move · slide to zoom — the circle is what everyone sees')),
        el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
      el('div', { class: 'relative rounded-xl overflow-hidden', style: { width: V + 'px', height: V + 'px', background: '#111' } },
        canvas,
        // Circle guide — dark everywhere except the circular window, plus a
        // crisp ring so the crop line is unmistakable.
        el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none',
          background: 'radial-gradient(circle ' + (V / 2 - 8) + 'px at 50% 50%, transparent 98%, rgba(0,0,0,.55) 100%)' } }),
        el('div', { style: { position: 'absolute', left: '8px', top: '8px', right: '8px', bottom: '8px', pointerEvents: 'none',
          border: '2px solid rgba(255,255,255,.9)', borderRadius: '50%', boxShadow: '0 0 0 1px rgba(0,0,0,.35)' } })),
      el('div', { class: 'w-full flex items-center gap-3' },
        el('span', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, '🔍'),
        zoomInput),
      el('div', { class: 'w-full flex gap-2 justify-end' },
        el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-semibold border', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: close }, 'Cancel'),
        el('button', {
          class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => {
            // Export the circle's bounding square. 160px (≈8-15KB) — big
            // enough that the profile-card lightbox looks clean, still small
            // enough that a full roster of avatars loads instantly.
            const SIZE = 160;
            const s = baseScale * zoom;
            const out = document.createElement('canvas');
            out.width = SIZE; out.height = SIZE;
            out.getContext('2d').drawImage(img, -offX / s, -offY / s, V / s, V / s, 0, 0, SIZE, SIZE);
            const dataUrl = out.toDataURL('image/jpeg', 0.6);
            close();
            onDone(dataUrl);
          },
        }, 'Save Photo')));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.append(card);
    document.body.append(overlay);
    draw();
  };
  img.src = url;
}

function changeProfileAvatar(p) {
  if (!p || !p.id) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/png,image/gif,image/webp';
  inp.style.display = 'none';
  inp.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    inp.remove();
    if (!file) return;
    openAvatarCropModal(file, async (dataUrl) => {
      p.avatar_url = dataUrl;
      if (state.profile && p.id === state.profile.id) state.profile.avatar_url = dataUrl;
      if (typeof DEMO !== 'undefined' && DEMO) {
        saveDemoData(); toast('Photo updated', 'success'); mountApp(); return;
      }
      try {
        const { error } = await supabase.from('profiles').update({ avatar_url: dataUrl }).eq('id', p.id);
        if (error) throw error;
        logActivity('user_edited', { detail: (p.full_name || 'user') + ' photo updated' });
        toast('Photo updated', 'success');
      } catch (err) {
        console.warn('[ridd] avatar update failed', err);
        toast('Photo save failed — ' + (err.message || err), 'error');
      }
      mountApp();
    });
  };
  document.body.append(inp);
  inp.click();
}

function openUserEditor(existing = null, prefill = null) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Modal-local state so we can track avatar changes + active toggle
  const modal = {
    avatar_url: existing?.avatar_url || '',
    is_active: existing ? (existing.is_active !== false) : true,
    // The CRM identity link — carried through Save onto the profile.
    fr_id: existing?.fieldroutes_employee_id || prefill?.fieldroutes_employee_id || null,
  };

  const form = el('form', {
    class: 'card w-full max-w-xl my-8 flex flex-col',
    style: { maxHeight: 'calc(100vh - 64px)' },
    onsubmit: async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      // Commission: standard base rate is 7%. The "Commission Override" field
      // is a BUMP added on top of the base (e.g. 0.5 means 7.5% total).
      const BASE_COMMISSION = 0.07;
      // Commission Bump left Edit User (per Isaac — it lives in Settings →
      // Commissions → individual overrides now), so a save keeps whatever
      // rate the profile already carries.
      const bumpRaw = data.commission_override?.trim();
      const bumpPct = bumpRaw === '' || bumpRaw == null ? 0 : parseFloat(bumpRaw);
      const totalRate = ('commission_override' in data) ? BASE_COMMISSION + (bumpPct / 100)
        : (existing?.upfront_commission_rate != null ? Number(existing.upfront_commission_rate) : BASE_COMMISSION);
      // Annual goal only applies to sellers (rep / admin_rep). Non-sellers
      // (admin / auditor) get 0 — the column is NOT NULL, and 0 is treated
      // as "no goal" by the leaderboard rendering.
      const seller = isSellerRole(data.role);
      const goalParsed = parseFloat(data.annual_revenue_goal);
      // Blank keeps whatever the rep already has; a NEW user starts at 0,
      // which the app already renders as "no goal" (the column is NOT NULL).
      // The old 250k default is gone (per Isaac) - goals are set on purpose.
      const annualGoal = !seller ? 0
        : Number.isFinite(goalParsed) ? goalParsed
        : (existing?.annual_revenue_goal ?? 0);
      const payload = {
        full_name: data.full_name,
        email: data.email,
        role: data.role,
        // Initials input retired (per Isaac) - they only feed the avatar
        // fallback, so keep what's stored or derive from the name, same as
        // the leaderboard does for CRM-only sellers.
        initials: existing?.initials
          || String(data.full_name || '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
          || null,
        avatar_url: modal.avatar_url || null,
        annual_revenue_goal: annualGoal,
        is_active: modal.is_active,
        // Round to 4 decimal places to avoid float noise (0.07+0.005=0.074999...)
        upfront_commission_rate: Math.round(totalRate * 10000) / 10000,
        // Close rate is an admin-set, hand-maintained input per rep (per
        // Isaac — matches the sheet's SETTINGS tab; never derived).
        close_rate_target: Number.isFinite(parseFloat(data.close_rate_pct)) ? Math.max(0, Math.min(100, parseFloat(data.close_rate_pct))) / 100 : (existing?.close_rate_target ?? 0.50),
        // Pay Stub personalization (drives the Pay tab's Upfront Pay rows).
        rep_type: data.rep_type || 'sales_rep',
        // The field only shows for office-staff roles; a hidden input still
        // submits its (prefilled) value, and blank falls back to the record
        // so a save can never silently wipe a stored amount.
        golden_phone_amount:    Number.isFinite(parseFloat(data.golden_phone_amount)) ? parseFloat(data.golden_phone_amount) : (existing?.golden_phone_amount ?? 0),
        loyalty_royalty_amount: parseFloat(data.loyalty_royalty_amount) || 0,
        loyalty_pay_amount:     Number.isFinite(parseFloat(data.loyalty_pay_amount)) ? parseFloat(data.loyalty_pay_amount) : (existing?.loyalty_pay_amount ?? 0),
        other_pay_amount:       Number.isFinite(parseFloat(data.other_pay_amount)) ? parseFloat(data.other_pay_amount) : (existing?.other_pay_amount ?? 0),
        // CRM bridge — phone carried from FieldRoutes, plus the employee-ID link
        // that joins this app user to their CRM sales.
        phone: (data.phone || '').trim() || null,
        fieldroutes_employee_id: modal.fr_id || null,
      };

      // Password field is admin-set: leave blank to keep existing /
      // skip during invite. Treat short strings as a typo rather than a
      // valid password so we don't silently set "abc" as someone's pw.
      const newPassword = (data.password || '').trim();
      if (newPassword && newPassword.length < 8) {
        toast('Password must be at least 8 characters (leave blank to skip).', 'error');
        return;
      }

      if (DEMO) {
        if (existing) {
          Object.assign(existing, payload);
          if (existing.id === state.profile.id) Object.assign(state.profile, payload);
        } else {
          const newId = 'demo-' + (state.allProfiles.length + 1);
          state.allProfiles.push({ id: newId, ...payload });
        }
        if (newPassword) {
          toast('Saved · password "' + newPassword + '" would be set in production', 'info');
        } else {
          logActivity('user_edited', { detail: (existing?.full_name || 'user') + ' profile updated' });
          toast('Saved', 'success');
        }
        saveDemoData();
        overlay.remove();
        mountApp();
        return;
      }

      // Instant feedback — the button reads Saving… for the whole round trip.
      const _submitBtn = form.querySelector('button[type="submit"]');
      if (_submitBtn) { _submitBtn.disabled = true; _submitBtn.textContent = 'Saving…'; }
      try {
        // Hoisted ABOVE the existing/create fork: it was declared inside the
        // if (existing) branch, so the two CREATE branches referenced a const
        // outside their scope and every new user failed with
        // "_stampNewProfile is not defined" (Dante Salgado, Aug 2026).
        // Stamp the FULL form payload onto the new profile row — the invite
        // row only carries a subset, and the old best-effort patch silently
        // dropped pay-affecting fields (commission bump, close-rate target,
        // rep type). Keyed by id + verified, so failure is LOUD.
        const _stampNewProfile = async (created) => {
          const uid = created && created.user_id;
          if (!uid) throw new Error('Create returned no user id — open the user and re-save their details.');
          const patch = { ...payload };
          delete patch.email;   // auth owns the login email; the trigger already copied it
          const { data: _row, error: _pErr } = await supabase.from('profiles')
            .update(patch).eq('id', uid).select('id').single();
          if (_pErr || !_row) throw new Error('Login created, but saving the profile details failed'
            + (_pErr ? ' — ' + _pErr.message : '') + '. Open the user and re-save.');
        };
        if (existing) {
          const { error } = await supabase.from('profiles').update(payload).eq('id', existing.id);
          if (error) throw error;
          // Email changed? The profile row alone isn't enough — LOGIN runs on
          // auth.users, so push the new address through the admin function
          // too. Otherwise the rep can only sign in with the OLD email (the
          // exact FieldRoutes-email lockout Isaac hit).
          const _emailChanged = payload.email && existing.email
            && payload.email.trim().toLowerCase() !== String(existing.email).trim().toLowerCase();
          if (newPassword || _emailChanged) {
            await callAdminSetPassword({
              mode: 'update', user_id: existing.id,
              ...(newPassword ? { password: newPassword } : {}),
              ...(_emailChanged ? { email: payload.email.trim() } : {}),
            });
            toast('Saved' + (_emailChanged ? ' · login email is now ' + payload.email.trim() : '') + (newPassword ? ' · password updated' : ''), 'success');
          } else {
            logActivity('user_edited', { detail: (existing?.full_name || 'user') + ' profile updated' });
          toast('Saved', 'success');
          }
        } else if (newPassword) {
          // Admin set a password on a NEW user — skip the magic-link
          // flow entirely and create the auth user with the password
          // directly. handle_new_user() picks up the pending_invites
          // row via the function, so the profiles row appears the same
          // way it would after a magic-link signup.
          const _created = await callAdminSetPassword({
            mode:                'create',
            email:               payload.email,
            password:            newPassword,
            full_name:           payload.full_name,
            role:                payload.role,
            office_id:           payload.office_id ?? null,
            initials:            payload.initials ?? null,
            avatar_url:          payload.avatar_url ?? null,
            annual_revenue_goal: payload.annual_revenue_goal ?? null,
          });
          await _stampNewProfile(_created);
          logActivity('user_edited', { detail: 'Created user ' + (payload.full_name || payload.email || '') });
          toast('Created · ' + payload.email + ' can sign in with that password', 'success');
        } else {
          // No password typed on a NEW user → create the account immediately
          // with a RANDOM throwaway password, then email a set-your-own-
          // password link. The set screen enforces the password policy
          // (8+ chars, a capital, a special character). This replaces the old
          // magic-link + "now go use Forgot password" dance.
          const _alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
          const _rnd = 'Aa1!' + Array.from(crypto.getRandomValues(new Uint8Array(20)))
            .map(b => _alphabet[b % _alphabet.length]).join('');
          const _created = await callAdminSetPassword({
            mode:                'create',
            email:               payload.email,
            password:            _rnd,
            full_name:           payload.full_name,
            role:                payload.role,
            office_id:           payload.office_id ?? null,
            initials:            payload.initials ?? null,
            avatar_url:          payload.avatar_url ?? null,
            annual_revenue_goal: payload.annual_revenue_goal ?? null,
          });
          await _stampNewProfile(_created);
          await sendPasswordResetLink(payload.email);
          logActivity('user_edited', { detail: 'Created user ' + (payload.full_name || payload.email || '') + ' — set-password email sent' });
          toast('Created — ' + payload.email + ' got an email to set their own password', 'success');
        }
        // Surgical refresh — the server write is already confirmed, so patch
        // the one row locally (edits) or pull just the profiles list (creates)
        // instead of re-fetching every table. One render, no screen bouncing.
        if (existing) {
          Object.assign(existing, payload);
          const _i = state.allProfiles.findIndex(p => p.id === existing.id);
          if (_i >= 0) state.allProfiles[_i] = Object.assign({}, state.allProfiles[_i], payload);
          if (state._realProfile && existing.id === state._realProfile.id) {
            Object.assign(state._realProfile, payload);
            _applyViewAsOverlay();
          } else if (existing.id === state.profile.id) {
            Object.assign(state.profile, payload);
          }
        } else {
          await refreshProfilesData();
        }
        overlay.remove();
        mountApp();
      } catch (err) {
        // Duplicate login with a REAL owner: jump straight to that user's
        // editor instead of dead-ending on a toast that points at a user
        // the admin may not be able to find (their profile email can have
        // drifted from the login email, hiding them from the CRM match).
        const _dupId = err && err.body && err.body.existing_user_id;
        const _dupProf = _dupId && (state.allProfiles || []).find(x => x.id === _dupId);
        if (_dupProf) {
          overlay.remove();
          toast('That login belongs to ' + (_dupProf.full_name || 'an existing user') + ' — opening their profile. Link their FieldRoutes ID here to stop the CRM row showing separately.', 'warn');
          openUserEditor(_dupProf, prefill ? { fr_id: prefill.fieldroutes_employee_id || prefill.fr_id } : null);
        } else {
          toast(err.message || 'Save failed', 'error');
        }
      } finally {
        if (_submitBtn) { _submitBtn.disabled = false; _submitBtn.textContent = 'Save'; }
      }
    },
  });

  const inp = (name, attrs = {}) => el('input', { name, class: 'w-full rounded-lg border px-3 py-2 text-sm', ...attrs });
  const mk = (label, input) => el('label', { class: 'block text-sm' },
    el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' }, label),
    input,
  );

  // ── Avatar upload (click-to-upload) ──
  const hiddenFile = el('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/gif,image/webp',
    style: { display: 'none' },
    onchange: (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Crop modal — circle guide + drag/zoom; returns the compact 80×80
      // JPEG data URL (a few KB, safe for localStorage).
      openAvatarCropModal(file, (dataUrl) => {
        modal.avatar_url = dataUrl;
        renderAvatar();
      });
    },
  });

  const avatarDisplay = el('div', { class: 'relative cursor-pointer', onclick: () => hiddenFile.click() });
  function renderAvatar() {
    avatarDisplay.innerHTML = '';
    avatarDisplay.append(
      avatarNode(modal.avatar_url, existing?.initials || '??', 'w-20 h-20 text-base'),
      el('div', {
        class: 'absolute rounded-full flex items-center justify-center',
        style: {
          bottom: '0', right: '0',
          width: '26px', height: '26px',
          background: '#323230', border: '2px solid var(--card)',
        },
      }, el('span', { style: { color: '#F3F3F3', fontSize: '12px' } }, '📷')),
      hiddenFile,
    );
  }
  renderAvatar();

  // ── Active/Deactivate pill ──
  const activeToggle = el('button', {
    type: 'button',
    class: 'flex items-center gap-1.5 text-xs font-semibold transition',
    onclick: () => { modal.is_active = !modal.is_active; renderActiveToggle(); },
  });
  function renderActiveToggle() {
    activeToggle.innerHTML = '';
    if (modal.is_active) {
      activeToggle.style.color = 'var(--accent)';
      activeToggle.append(
        el('span', { style: { color: 'var(--accent)' } }, '☑'),
        el('span', {}, 'Active '),
        el('span', { class: 'font-normal text-muted-' }, '(click to deactivate)'),
      );
    } else {
      activeToggle.style.color = '#DC2626';
      activeToggle.append(
        el('span', { style: { color: '#DC2626' } }, '☒'),
        el('span', {}, 'Inactive '),
        el('span', { class: 'font-normal text-muted-' }, '(click to activate)'),
      );
    }
  }
  renderActiveToggle();

  // ── Header ──
  const header = el('div', { class: 'px-6 pt-6 pb-4' },
    el('div', { class: 'flex items-center justify-between mb-4' },
      el('h2', { class: 'text-xl font-bold' }, existing ? 'Edit User' : 'New User'),
      el('div', { class: 'flex items-center gap-4' },
        activeToggle,
        el('button', { type: 'button', class: 'text-2xl text-muted-', onclick: () => overlay.remove() }, '×')),
    ),
    el('button', {
      type: 'button',
      class: 'text-xs text-muted- hover:text-default transition',
      onclick: () => overlay.remove(),
    }, '← Back to Users'),
  );

  // ── Avatar section ──
  const avatarSection = el('div', { class: 'px-6 pb-4 flex items-center gap-4' },
    avatarDisplay,
    el('div', { class: 'flex-1' },
      el('div', { class: 'text-sm font-medium' }, 'Click avatar to upload photo'),
      el('div', { class: 'text-[11px] text-muted- mt-0.5' }, 'JPG, PNG, GIF supported'),
    ),
  );

  // ── Form body ──
  const body = el('div', { class: 'px-6 pb-4 overflow-y-auto flex-1 flex flex-col gap-4' },
    // CRM link badge — shown when this user is (or will be) tied to a
    // FieldRoutes employee, so their app sales reconcile against the CRM.
    modal.fr_id ? el('div', { class: 'rounded-lg px-3 py-2 text-xs flex items-center gap-2', style: { background: 'rgba(223,100,58,.12)', border: '1px solid rgba(223,100,58,.35)', color: 'var(--text)' } },
      el('span', { style: { color: 'var(--accent)', fontWeight: '700' } }, '↔ Linked to FieldRoutes'),
      el('span', { class: 'text-muted-' }, 'Employee #' + modal.fr_id + (prefill ? ' · details pre-filled from the CRM' : ''))) : null,
    // Last app login lives here now (was a whole column on the Users table).
    existing ? el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } },
      '🕐 Last app login: ' + (existing.last_login_at
        ? new Date(existing.last_login_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'never')) : null,
    (() => {
      // User Role sits at the very top (per Isaac) — everything below keys
      // off it. Legacy 'rep' accounts preselect Rep - Sales Rep here, so
      // saving them migrates to an explicit role.
      let seedRole = existing?.role || prefill?.role || 'rep_sales';
      if (seedRole === 'rep') seedRole = 'rep_sales';
      // Owner rules (per Isaac): only the owner admin can make or unmake an
      // admin. Everyone else sees the admin options greyed out, and an
      // existing admin's role is locked for them entirely.
      // Until an owner exists (migration not run yet / nobody has claimed
      // it), every admin keeps the old powers — nobody gets locked out.
      const _ownerExists = (state.allProfiles || []).some(p => p && p.is_owner);
      const _owner = isOwnerUser() || !_ownerExists;
      const _targetAdmin = !!existing && (existing.role === 'admin' || existing.role === 'admin_rep');
      const _lockRole = !_owner && _targetAdmin;
      const roleSelect = el('select', { name: 'role', class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]', disabled: _lockRole,
        title: _lockRole ? 'Only the Admin - Owner can change an admin\u2019s access' : '' },
        ...['rep_sales', 'rep_partner', 'rep_team_lead', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead'].map(v => el('option', { value: v, selected: seedRole === v, disabled: !!(existing && existing.is_owner) }, ROLE_LABEL[v])),
        el('option', { value: 'admin_rep',  selected: seedRole === 'admin_rep', disabled: !_owner && seedRole !== 'admin_rep' },  'Admin + Sales'),
        el('option', { value: 'admin',      selected: seedRole === 'admin', disabled: !_owner && seedRole !== 'admin' },      'Admin (no sales)'),
        el('option', { value: 'auditor',    selected: seedRole === 'auditor', disabled: !!(existing && existing.is_owner) },    'Auditor'),
      );
      // A disabled select drops out of FormData — carry the locked role along.
      const roleHidden = _lockRole ? el('input', { type: 'hidden', name: 'role', value: seedRole }) : null;
      // (Commission Bump, Revenue Goal, Close Rate, Other Pay and Loyalty Pay
      // left this modal per Isaac — pay lives in Settings → Commissions.)
      const wrapper = document.createDocumentFragment();
      wrapper.append(mk('User Role', roleSelect));
      if (roleHidden) wrapper.append(roleHidden);
      if (existing && existing.is_owner) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--accent)', fontWeight: '700' } }, '\u2605 Owner admin \u2014 the only login that can grant or remove admin access.'));
      else if (!_ownerExists && isAdminRole(state.profile?.role)) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--text-muted)' } }, 'No Admin - Owner yet \u2014 pick \u201cAdmin - Owner\u201d on your own account to claim it.'));
      else if (_lockRole) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--text-muted)' } }, 'This is an admin account \u2014 only the Admin - Owner can change its access.'));
      else if (!_owner) wrapper.append(el('div', { class: 'text-[11px] -mt-2', style: { color: 'var(--text-muted)' } }, 'Admin roles can only be granted by the Admin - Owner.'));
      // Transfer ownership — owner only, to another admin, two taps.
      if (_owner && existing && !existing.is_owner && _targetAdmin && existing.id !== (state._realProfile || state.profile || {}).id) {
        let armed = false;
        const xfer = el('button', {
          type: 'button',
          class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95 self-start',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          title: 'Hand the owner admin role to this person. You stay an admin; they become the only one who can change admin access.',
          onclick: async () => {
            if (!armed) { armed = true; xfer.textContent = 'Confirm \u2014 make ' + (existing.full_name || 'this user') + ' the Admin - Owner'; xfer.style.background = 'var(--accent)'; xfer.style.color = 'var(--accent-text)'; xfer.style.borderColor = 'var(--accent)'; return; }
            xfer.disabled = true; xfer.textContent = 'Transferring\u2026';
            try {
              const { error } = await supabase.from('profiles').update({ is_owner: true }).eq('id', existing.id);
              if (error) throw error;
              existing.is_owner = true;
              (state.allProfiles || []).forEach(p => { p.is_owner = p.id === existing.id; });
              if (state._realProfile) state._realProfile.is_owner = false;
              if (state.profile) state.profile.is_owner = state.profile.id === existing.id;
              logActivity('user_edited', { detail: 'Ownership transferred to ' + (existing.full_name || existing.email || '') });
              toast((existing.full_name || 'They') + ' is now the Admin - Owner', 'success');
              overlay.remove(); mountApp();
            } catch (err) { toast(err.message || 'Transfer failed', 'error'); xfer.disabled = false; armed = false; xfer.textContent = 'Make this user the Admin - Owner'; }
          },
        }, 'Make this user the Admin - Owner');
        wrapper.append(el('div', { class: 'flex' }, xfer));
      }
      // ── Teams led — right under the role, only once Partner (or Team
      // Lead) is picked. Drives leaderboard + player-card reach.
      if (existing && existing.id) {
        const teamsBox = el('div', { class: 'flex flex-wrap gap-1.5' });
        const drawTeams = () => {
          teamsBox.innerHTML = '';
          const chosen = new Set(partnerTeamsOf(existing.id));
          const names = allTeamNames();
          if (!names.length) { teamsBox.append(el('span', { class: 'text-[11px] text-muted-' }, 'No teams set up yet (Indicators \u2192 Manage Teams).')); return; }
          names.forEach(t => teamsBox.append(el('button', {
            type: 'button',
            class: 'rounded-full px-2.5 py-1 text-[11px] font-semibold border transition',
            style: chosen.has(t) ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
            onclick: () => { const c = new Set(partnerTeamsOf(existing.id)); if (c.has(t)) c.delete(t); else c.add(t); setPartnerTeams(existing.id, [...c]); drawTeams(); },
          }, t)));
        };
        drawTeams();
        const teamsSection = el('div', { class: 'flex flex-col gap-2' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block font-semibold' }, 'Teams led'),
          el('p', { class: 'text-[11px] text-muted-' }, 'This partner sees a team card, team trends and the drill-down for every rep on these teams. Saves as you click.'),
          teamsBox);
        const _showTeams = () => { teamsSection.style.display = (roleSelect.value === 'rep_partner' || roleSelect.value === 'rep_team_lead') ? '' : 'none'; };
        roleSelect.addEventListener('change', _showTeams);
        _showTeams();
        wrapper.append(teamsSection);
      }
      return wrapper;
    })(),
    mk('Full Name', inp('full_name', { required: true, value: existing?.full_name || prefill?.full_name || '' })),
    mk('Email', inp('email', { type: 'email', required: true, value: existing?.email || prefill?.email || '' })),
    mk('Phone', inp('phone', { type: 'tel', value: existing?.phone || prefill?.phone || '', placeholder: 'From FieldRoutes' })),
    el('label', { class: 'block text-sm' },
      el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' },
        'Password ',
        el('span', { class: 'normal-case text-muted- font-normal tracking-normal text-[10px]' },
          existing
            ? '— reset it here: type a new password + Save, then tell the user. Takes effect immediately, no email needed. Leave blank to keep current.'
            : '— optional; if set, the rep can sign in immediately with email + password'),
      ),
      inp('password', {
        type: 'password',
        placeholder: existing ? 'Leave blank to keep current' : 'Set an initial password (≥ 8 chars)',
        autocomplete: 'new-password',
        minlength: '8',
      }),
    ),
    // ── Pay Stub personalization ──
    // Drives which rows show on the rep's Pay tab + the manual additives that
    // flow into Total Upfront Pay each period. Hidden for auditors (no stub).
    (() => {
      const moneyInp = (name, value) => el('div', { class: 'relative' },
        el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
        inp(name, {
          type: 'number', step: '0.01', min: 0,
          placeholder: '0.00',
          value: value ? Number(value).toFixed(2) : '',
          class: 'w-full rounded-lg border pl-7 pr-3 py-2 text-sm',
        }),
      );

      const repTypeSelect = el('select', { name: 'rep_type', class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]' },
        el('option', { value: 'sales_rep',   selected: (existing?.rep_type || 'sales_rep') === 'sales_rep' }, 'Sales Rep'),
        el('option', { value: 'loyalty_rep', selected: existing?.rep_type === 'loyalty_rep' }, 'Loyalty Rep'),
      );

      // Pay Stub rows that live HERE in Edit User are the fixed quarterly
      // additives an admin sets ahead of time per rep. Golden Phone's input
      // was retired (per Isaac) - the stub still SHOWS any stored amount,
      // and the save path preserves it, but sales reps get no editor field.
      // Golden Phone is an OFFICE STAFF program (per Isaac) - the top
      // inside-sales royalty. Sales reps never see the field; office-staff
      // roles do, unless the rep is typed Loyalty (who get Loyalty Royalty
      // instead).
      const goldenPhoneRow    = mk('Golden Phone',    moneyInp('golden_phone_amount',    existing?.golden_phone_amount));
      const loyaltyRoyaltyRow = mk('Loyalty Royalty', moneyInp('loyalty_royalty_amount', existing?.loyalty_royalty_amount));
      // (Close Rate / Other Pay / Loyalty Pay moved to Settings → Commissions, per Isaac.)

      const OFFICE_ROLES = new Set(['rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead']);
      const grid = el('div', { class: 'flex flex-col gap-3' });
      const applyRepTypeVisibility = () => {
        const isLoyalty = repTypeSelect.value === 'loyalty_rep';
        const roleSel = form.querySelector('select[name="role"]');
        const isOffice = roleSel ? OFFICE_ROLES.has(roleSel.value) : false;
        goldenPhoneRow.style.display    = (isOffice && !isLoyalty) ? '' : 'none';
        loyaltyRoyaltyRow.style.display = isLoyalty ? '' : 'none';
      };
      repTypeSelect.addEventListener('change', applyRepTypeVisibility);
      grid.append(goldenPhoneRow, loyaltyRoyaltyRow);

      const section = el('div', { class: 'flex flex-col gap-3 pt-3 border-t', style: { borderColor: 'var(--border)' } },
        el('h4', { class: 'text-[11px] uppercase tracking-widest font-bold text-muted-' }, 'Pay Stub'),
        mk('Rep Type', repTypeSelect),
        grid,
      );

      // Auditors and Admin (no sales) don't get a pay stub — neither sells,
      // so Rep Type / Golden Phone are irrelevant. Hide the whole section.
      // Wired via the role select that lives in the IIFE above.
      setTimeout(() => {
        applyRepTypeVisibility();
        const roleSel = form.querySelector('select[name="role"]');
        if (!roleSel) return;
        const checkRole = () => {
          // Sales reps have nothing left here (per Isaac) — only office-staff
          // roles keep Rep Type + Golden Phone / Loyalty Royalty.
          section.style.display = OFFICE_ROLES.has(roleSel.value) ? '' : 'none';
          applyRepTypeVisibility();   // Golden Phone visibility depends on the role too
        };
        roleSel.addEventListener('change', checkRole);
        checkRole();
      }, 0);

      return section;
    })(),
  );

  // ── Footer ──
  // (Remove User retired, per Isaac: users are deactivated and reactivated,
  // never removed - history and sales attribution stay intact.)

  // ── Send Password Reset — fires Supabase's recovery-email flow.
  // Different from Resend Invite: that gets a passwordless sign-in link
  // (good for first login); this lands the rep on a page where they
  // pick a new password themselves. Useful for "I forgot mine and the
  // Forgot Password link on the sign-in screen isn't working for me."
  const resetBtn = existing ? el('button', {
    type: 'button',
    class: 'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition hover:brightness-95',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
    onclick: async (e) => {
      const btn = e.currentTarget;
      if (!existing.email) {
        toast('No email on file for this user.', 'error');
        return;
      }
      if (!confirm('Email ' + existing.email + ' a password-reset link?')) return;
      if (DEMO) {
        toast('Demo mode — would email a password reset link to ' + existing.email, 'info');
        return;
      }
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Sending…';
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(existing.email, {
          redirectTo: authEmailRedirectUrl(),
        });
        if (error) throw error;
        toast('Reset link sent to ' + existing.email, 'success');
      } catch (err) {
        toast(err.message || 'Could not send reset link', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    },
  }, 'Send Reset Link') : null;

  // (Resend Invite retired, per Isaac. It emailed a passwordless magic
  // sign-in link - the first-login flow from before admins created users
  // WITH passwords. Send Reset Link covers every remaining case: the rep
  // lands on a page and picks a password. A profile with NO auth login at
  // all is surfaced by the update path's 404, which points the admin at
  // create-with-password.)

  const footer = el('div', { class: 'px-6 py-4 border-t flex items-center gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
    el('button', { type: 'submit', class: 'px-2.5 py-1 rounded-lg font-semibold text-[11px]', style: { background: '#323230', color: '#F3F3F3' } }, 'Save'),
    el('button', { type: 'button', class: 'px-2.5 py-1 rounded-lg font-semibold text-[11px] border', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => overlay.remove() }, 'Cancel'),
    resetBtn,
  );

  form.append(header, avatarSection, body, footer);
  overlay.append(form);
  document.body.append(overlay);
}

// ──────────────────────────────────────────────────────────────────────────
// BINGO / RULE ENGINE
// Evaluates rules against sales data and writes results back to
// competition_progress. Runs after any audit action.
// ──────────────────────────────────────────────────────────────────────────
async function recomputeAllProgress() {
  if (DEMO) return;
  if (!state.competitions.length || !state.compRules.length) return;
  try {
    // Need EVERY rep's sales for full leaderboard eval, not just mine.
    // If I'm not an admin I can only see my own, so I only compute my own progress.
    const scope = isAdminRole(state.profile?.role) ? state.allSales : state.mySales;
    const salesByRep = groupBy(scope, s => s.rep_id);
    const repIds = Object.keys(salesByRep);
    if (!isAdminRole(state.profile?.role) && !repIds.includes(state.profile.id)) repIds.push(state.profile.id);

    const rows = [];
    for (const comp of state.competitions) {
      const rules = state.compRules.filter(r => r.competition_id === comp.id);
      if (!rules.length) continue;
      for (const repId of repIds) {
        const repSales = salesByRep[repId] || [];
        for (const rule of rules) {
          const val = evaluateRule(rule, comp, repSales);
          const met = compare(val, rule.operator, Number(rule.threshold));
          rows.push({
            competition_id: comp.id,
            rule_id: rule.id,
            rep_id: repId,
            current_value: val,
            met,
            last_computed_at: new Date().toISOString(),
          });
        }
      }
    }
    if (!rows.length) return;
    const { error } = await supabase.from('competition_progress').upsert(rows, { onConflict: 'rule_id,rep_id' });
    if (error) console.warn('progress upsert', error);
    // refresh cached
    const { data: refreshed } = await supabase.from('competition_progress').select('*');
    state.compProgress = refreshed || [];
  } catch (err) {
    console.warn('recomputeAllProgress', err);
  }
}

function evaluateRule(rule, comp, sales) {
  // filter sales to the rule window
  const now = new Date();
  const startWin = windowStart(rule.window, comp);
  const endWin   = windowEnd(rule.window, comp);

  // only count approved/serviced sales toward competitions
  const eligible = sales.filter(s => {
    if (!['approved','serviced'].includes(s.audit_status)) return false;
    const d = new Date(s.sold_date + 'T00:00');
    if (d < startWin || d > endWin) return false;
    // filters
    const f = rule.filters || {};
    if (f.source_id && Array.isArray(f.source_id) && !f.source_id.includes(s.source_id)) return false;
    if (f.service_type_id && Array.isArray(f.service_type_id) && !f.service_type_id.includes(s.service_type_id)) return false;
    if (f.office_id && Array.isArray(f.office_id) && !f.office_id.includes(s.office_id)) return false;
    if (f.min_revenue && Number(s.revenue_amount) < f.min_revenue) return false;
    return true;
  });

  switch (rule.metric) {
    case 'count':        return eligible.length;
    case 'sum_revenue':  return eligible.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
    case 'sum_initial':  return eligible.reduce((a, s) => a + Number(s.initial_amount || 0), 0);
    case 'sum_monthly':  return eligible.reduce((a, s) => a + Number(s.monthly_amount || 0), 0);
    case 'avg_initial':  return eligible.length ? eligible.reduce((a, s) => a + Number(s.initial_amount || 0), 0) / eligible.length : 0;
    case 'close_rate':   return 0.6; // placeholder — needs lead data
    default: return 0;
  }
}

function windowStart(window, comp) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (window) {
    case 'day':         return d;
    case 'week': { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); return s; }
    case 'month':       return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'competition': return new Date(comp.start_date + 'T00:00');
    default: return new Date(0);
  }
}
function windowEnd(window, comp) {
  const now = new Date();
  switch (window) {
    case 'day':         return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    case 'week':        return now;
    case 'month':       return now;
    case 'competition': return new Date(comp.end_date + 'T23:59');
    default: return now;
  }
}
function compare(a, op, b) {
  switch (op) {
    case '>':  return a > b;
    case '>=': return a >= b;
    case '<':  return a < b;
    case '<=': return a <= b;
    case '=':  return a === b;
    case '!=': return a !== b;
    default:   return false;
  }
}
function metricLabel(m) {
  return ({
    count: 'Count',
    sum_revenue: 'Σ Revenue',
    sum_initial: 'Σ Initial',
    sum_monthly: 'Σ Monthly',
    avg_initial: 'Avg Initial',
    close_rate: 'Close rate',
    saves_count: 'Saves',
  })[m] || m;
}
function groupBy(arr, fn) {
  return arr.reduce((acc, x) => { const k = fn(x); (acc[k] ||= []).push(x); return acc; }, {});
}

// ──────────────────────────────────────────────────────────────────────────
// KPI helpers
// ──────────────────────────────────────────────────────────────────────────
function computeMyKpis() {
  const mine = state.mySales;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const mtd = mine.filter(s => new Date(s.sold_date + 'T00:00') >= monthStart);
  const approved = mtd.filter(s => ['approved','serviced'].includes(s.audit_status));
  const pending  = mine.filter(s => s.audit_status === 'pending');
  const below    = mine.filter(s => s.audit_status === 'below_minimums');

  const revenueMtd  = approved.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
  const repId = state.profile.id;
  const estPay      = approved.reduce((a, s) => a + Number(s.revenue_amount || 0) * getCommissionRate(repId, s), 0)
                    + below.reduce((a, s) => a + Number(s.revenue_amount || 0) * getCommissionRate(repId, s), 0);
  const closeRate   = mtd.length ? approved.length / mtd.length : 0;

  return {
    approvedCount: approved.length,
    pendingCount: pending.length,
    belowCount: below.length,
    revenueMtd, estPay, closeRate,
  };
}
function sumSales(sales, predicate) {
  const matched = sales.filter(predicate);
  return {
    count: matched.length,
    revenue: matched.reduce((a, s) => a + Number(s.revenue_amount || 0), 0),
  };
}
function isCompActive(c) {
  const now = new Date();
  return new Date(c.start_date) <= now && new Date(c.end_date + 'T23:59') >= now;
}

// ──────────────────────────────────────────────────────────────────────────
// Utility: CSV export
// ──────────────────────────────────────────────────────────────────────────
function downloadCsv(rows) {
  if (!rows.length) return toast('Nothing to export', 'warn');
  const headers = [
    'customer_name','customer_number','office','service_type','source',
    'initial','monthly','revenue','sold_date','bill_date','status',
    'audit_1','audit_2','lock_status','notes',
  ];
  const auditorName = (id) => (state.allProfiles || []).find(p => p.id === id)?.full_name || '';
  const lines = [headers.join(',')];
  for (const s of rows) {
    lines.push([
      csvEsc(s.customer_name),
      csvEsc(s.customer_number || ''),
      csvEsc(nameFromId(state.offices, s.office_id)),
      csvEsc(nameFromId(state.serviceTypes, s.service_type_id)),
      csvEsc(nameFromId(state.sources, s.source_id)),
      s.initial_amount, s.monthly_amount, s.revenue_amount,
      s.sold_date, s.bill_date || '', s.audit_status,
      csvEsc(auditorName(s.audited_by)),
      csvEsc(auditorName(s.audit_2_by)),
      s.lock_status || 'pending',
      csvEsc(s.notes || ''),
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `ridd-sales-${new Date().toISOString().slice(0,10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function csvEsc(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ──────────────────────────────────────────────────────────────────────────
// Icons (inline SVG)
// ──────────────────────────────────────────────────────────────────────────
function svg(paths, size = 20) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const div = document.createElement('div');
  div.innerHTML = s;
  return div.firstElementChild;
}
function iconDashboard() { return svg('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'); }
// Inside Sales — a headset (phone reps), distinct from the Commission dollar sign.
function iconSales()     { return svg('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'); }   // price tag — sales
function iconPay()       { return svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'); }
function iconTrophy()    { return svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'); }
function iconHistory()   { return svg('<path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'); }
function iconShield()    { return svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'); }
function iconCrown()     { return svg('<path d="M2 20h20l-2-10-5 3-5-8-5 8-5-3 2 10z"/><path d="M6 20v0"/><path d="M18 20v0"/>'); }
function iconChart(s)    { return svg('<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>', s || 20); }
function iconPie(s)      { return svg('<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>', s || 20); }
function iconClipboard(s){ return svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/>', s || 20); }
function iconNote(s)     { return svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>', s || 16); }
function iconGrid(s)     { return svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>', s || 20); }
function iconMoon(s)     { return svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>', s || 20); }
function iconSun(s)      { return svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', s || 20); }
function iconGear(s)     { return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>', s || 20); }

function iconBell(s) { return svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>', s || 20); }
// RevHawk "Sync" — the classic two-arrow refresh loop.
function iconSync(s) { return svg('<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>', s || 20); }
// Commission — a dollar sign.
function iconDollar(s) { return svg('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', s || 20); }
// Coach Mode — represented by a "team / users" glyph since the panel is
// about people who need coaching attention.
function iconCoach(s) { return svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', s || 20); }
function iconTv(s)    { return svg('<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', s || 20); }
function iconCalendar(s) { return svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', s || 20); }
function iconSearch(s) { return svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>', s || 20); }

function timeAgo(isoStr) {
  const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

// ──────────────────────────────────────────────────────────────────────────
// Go
// ──────────────────────────────────────────────────────────────────────────
boot().catch(err => {
  // Anything that escapes boot()'s own handling must never strand the user
  // on a forever-splash — show the classified error screen, or reload.
  try { mountError(err); } catch (e) { location.reload(); }
});

