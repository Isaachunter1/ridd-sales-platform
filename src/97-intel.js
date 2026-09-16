// ┌─ src/97-intel.js ─────────────────────────────────────────────────────
// │ Data-advantage layer (per Isaac, Sep 2026): who produces the customers
// │ that leave (seller / source / office), retained-revenue scoring, source
// │ unit economics (CAC → LTV) and add-on performance. Every card reads the
// │ subscription snapshot the Reporting tab already loads; nothing new is
// │ fetched. Memoised per snapshot so re-renders are free.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────

// ── shared: the recurring, started book with per-row outcome ─────────────
// One pass over the snapshot → rows with { sold, cxl, days (sale→cancel),
// arv, seller, source, office, type }. Cancel = a real cancel per the
// retention population rules (RORs / combined / renewals already out).
function _intelRows() {
  const snap = state.reportingSubscriptions;
  if (!Array.isArray(snap) || !snap.length) return [];
  const stamp = state.reportingSubscriptionsLoadedFor + '|' + snap.length + '|' + (state._compExtras && state._compExtras.adminRules ? JSON.stringify(state._compExtras.adminRules).length : 0);
  if (state._intelMemo && state._intelMemo.stamp === stamp) return state._intelMemo.rows;
  const recurring = reportingServiceRecurringMap();
  const excl = reportingExcludedCancelReasons();
  const popExcl = retenPopExclReasons();
  const out = [];
  for (const r of snap) {
    if (!recurring.get(r.subscription)) continue;               // one-time never counts
    const sold = String(r.sold_date || r.initial_service || '').slice(0, 10);
    if (!sold || !/^\d{4}-\d{2}-\d{2}$/.test(sold)) continue;
    const reason = _normCancelReason(reportingCancelReasonOf(r) || '');
    if (reason && popExcl.has(reason)) continue;                // ROR / combined / renewal — left the book without churning
    const cxlIso = r.subscription_date_canceled ? String(r.subscription_date_canceled).slice(0, 10) : '';
    const cxl = !!cxlIso && !(reason && excl.has(reason));      // excluded reasons (company-ended) count as retained
    const days = cxl ? Math.round((Date.parse(cxlIso) - Date.parse(sold)) / 86400000) : null;
    out.push({
      sold, cxl, days, arv: Number(r.annual_recurring_value) || 0,
      seller: String(r.sold_by || '').trim() || '—',
      type: String(r.sold_by_type || '').trim() || 'Unknown',
      source: String(r.subscription_source || '').trim() || 'Unspecified',
      office: String(r.office_name || '').trim() || '—',
      service: String(r.subscription || '').trim(),
      customer: r.customer_id != null ? String(r.customer_id) : '',
      row: r,
    });
  }
  state._intelMemo = { stamp, rows: out };
  return out;
}
const _intelAgeDays = (iso) => Math.round((Date.now() - Date.parse(iso)) / 86400000);

// Retention at N days for a set of rows: only accounts old enough to have
// reached N days are judged (a 10-day-old sale can't fail a 90-day test).
function _intelRetain(rows, N) {
  let eligible = 0, kept = 0, arvE = 0, arvK = 0;
  for (const x of rows) {
    if (_intelAgeDays(x.sold) < N) continue;
    eligible++; arvE += x.arv;
    const lost = x.cxl && x.days != null && x.days <= N;
    if (!lost) { kept++; arvK += x.arv; }
  }
  return { eligible, kept, rate: eligible ? kept / eligible : null, arvE, arvK, arvRate: arvE ? arvK / arvE : null };
}

// ── 1. Who produces the customers that leave ────────────────────────────
// Group by seller / source / office / rep type over the last 12 months of
// sales, show 90-day and 365-day retention vs the company baseline, and
// flag anything ≥ 2× the baseline cancel rate. Click a row → the accounts.
function intelLeaversCard() {
  const rows = _intelRows();
  if (!rows.length) return null;
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const recent = rows.filter(x => x.sold >= since);
  const dim = state._intelLeaverDim || 'seller';
  const N = state._intelLeaverN || 90;
  const base = _intelRetain(recent, N);
  const baseCxl = base.rate == null ? 0 : 1 - base.rate;
  const g = new Map();
  recent.forEach(x => { const k = x[dim]; if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
  const MIN = dim === 'seller' ? 8 : 15;
  const ents = [...g.entries()].map(([k, list]) => ({ k, list, r: _intelRetain(list, N), arvLost: list.filter(x => x.cxl && x.days != null && x.days <= N).reduce((a, x) => a + x.arv, 0) }))
    .filter(e => e.r.eligible >= MIN)
    .map(e => ({ ...e, cxl: e.r.rate == null ? null : 1 - e.r.rate }))
    .sort((a, b) => (b.cxl || 0) - (a.cxl || 0));
  const flag = (e) => e.cxl != null && baseCxl > 0 && e.cxl >= 2 * baseCxl;
  const sel = (value, opts, on) => el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => on(e.target.value) },
    ...opts.map(([v, l]) => el('option', { value: v, selected: String(v) === String(value) }, l)));
  const pct = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const drill = (title, list) => openReportingDrillModal({ chartTitle: title, sliceLabel: list.length.toLocaleString() + ' accounts', rows: list.map(x => x.row), formatValue: fmt.usd0 });
  const th = (t, right) => el('th', { class: 'px-3 py-2 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
  const td = (v, o = {}) => el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap ' + (o.right ? 'text-right' : '') + (o.bold ? ' font-semibold' : ''), style: o.style || {} }, v);
  const flagged = ents.filter(flag);
  return el('div', { class: 'card p-4 flex flex-col gap-3' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
      el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Who produces the customers that leave'),
        el('div', { class: 'text-[11px] text-muted-' }, 'Sales in the last 12 months · cancelled within ' + N + ' days · company ' + pct(baseCxl) + ' · ' + (flagged.length ? flagged.length + ' at 2× or worse' : 'nothing at 2× the company rate'))),
      el('div', { class: 'flex items-center gap-2' },
        sel(dim, [['seller', 'By rep'], ['source', 'By source'], ['office', 'By office'], ['type', 'By rep type']], (v) => { state._intelLeaverDim = v; mountApp(); }),
        sel(N, [[90, '90 days'], [180, '180 days'], [365, '365 days']], (v) => { state._intelLeaverN = Number(v); mountApp(); }))),
    ents.length ? el('div', { style: { overflow: 'auto', maxHeight: '420px' } }, el('table', { class: 'w-full text-xs' },
      el('thead', {}, el('tr', {}, th(dim === 'seller' ? 'Rep' : dim === 'source' ? 'Source' : dim === 'office' ? 'Office' : 'Rep type'), th('Sold', true), th('Cancelled ≤' + N + 'd', true), th('Cancel %', true), th('vs company', true), th('ARR lost', true))),
      el('tbody', {}, ...ents.map(e => el('tr', { class: 'border-t cursor-pointer hover:brightness-95', style: { borderColor: 'var(--border)', background: flag(e) ? 'rgba(220,38,38,.06)' : 'transparent' }, onclick: () => drill(e.k + ' · cancelled ≤' + N + 'd', e.list.filter(x => x.cxl && x.days != null && x.days <= N)) },
        td(el('span', { class: 'inline-flex items-center gap-1.5' }, flag(e) ? el('span', { class: 'text-[10px] font-bold px-1.5 py-0.5 rounded', style: { background: 'rgba(220,38,38,.12)', color: '#B91C1C' } }, '2×') : null, e.k), { bold: true }),
        td(e.r.eligible.toLocaleString(), { right: true }),
        td((e.r.eligible - e.r.kept).toLocaleString(), { right: true }),
        td(pct(e.cxl), { right: true, bold: true, style: flag(e) ? { color: '#B91C1C' } : {} }),
        td(e.cxl == null || !baseCxl ? '—' : (e.cxl / baseCxl).toFixed(1) + '×', { right: true, style: { color: 'var(--text-muted)' } }),
        td(fmt.usd0(e.arvLost), { right: true }))))))
    : el('div', { class: 'text-xs text-muted- py-4 text-center' }, 'Not enough accounts old enough to judge yet.'));
}

// Seller risk lookup for the Sales queues: rep name (lower) → { cxl, base }
// when the rep's 90-day cancel rate is ≥ 2× their office's. Null if the
// snapshot isn't loaded (reps / phones never pay for this).
function intelSellerRisk() {
  const rows = _intelRows();
  if (!rows.length) return null;
  if (state._intelRiskMemo && state._intelRiskMemo.stamp === state._intelMemo.stamp) return state._intelRiskMemo.map;
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const recent = rows.filter(x => x.sold >= since);
  const byOffice = new Map(), bySeller = new Map();
  recent.forEach(x => { (byOffice.get(x.office) || byOffice.set(x.office, []).get(x.office)).push(x); const k = x.seller.toLowerCase(); (bySeller.get(k) || bySeller.set(k, { office: x.office, list: [] }).get(k)).list.push(x); });
  const map = new Map();
  for (const [k, v] of bySeller) {
    const r = _intelRetain(v.list, 90); if (r.eligible < 8 || r.rate == null) continue;
    const b = _intelRetain(byOffice.get(v.office) || [], 90); if (b.rate == null) continue;
    const cxl = 1 - r.rate, base = 1 - b.rate;
    if (base > 0 && cxl >= 2 * base) map.set(k, { cxl, base, n: r.eligible });
  }
  state._intelRiskMemo = { stamp: state._intelMemo.stamp, map };
  return map;
}

// ── 2. Retained revenue (leaderboards) ───────────────────────────────────
// For the D2D board: share of contract value in the range that has NOT
// cancelled (real cancels only). Reads the same raw rows the board uses.
function intelRetainedShare(rows) {
  let cv = 0, kept = 0;
  rows.forEach(s => { const v = Number(s.contractValue) || 0; cv += v; if (!(typeof _subCancelledNow === 'function' ? _subCancelledNow(s) : (s.cancelDate || s.active === 'No')) || (typeof _isExcludableCancel === 'function' && _isExcludableCancel(s))) kept += v; });
  return { cv, kept, rate: cv ? kept / cv : null };
}

// ── 3. Source unit economics (Putis Shid) ───────────────────────────────
// Per source, last 12 months: new accounts, avg ARR, 12-month retention,
// implied lifetime (1 ÷ annual churn, capped at 8 years), LTV = avg ARR ×
// lifetime. Spend per source is a number the admin types (saved in
// app_settings.source_spend, monthly $) → CAC and LTV:CAC. Ad-platform
// spend can't be mapped to a FieldRoutes source automatically, so this is
// deliberately manual until the mapping exists.
function intelSourceEconomicsCard() {
  const rows = _intelRows();
  if (!rows.length) return null;
  if (state._sourceSpend === undefined) {
    state._sourceSpend = null;
    supabase.from('app_settings').select('value').eq('key', 'source_spend').maybeSingle().then(({ data }) => { state._sourceSpend = (data && data.value) || {}; mountApp(); });
  }
  const spend = state._sourceSpend || {};
  const saveSpend = async (src, v) => {
    const next = { ...spend }; if (v > 0) next[src] = v; else delete next[src];
    state._sourceSpend = next;
    const { error } = await supabase.from('app_settings').upsert({ key: 'source_spend', value: next }, { onConflict: 'key' });
    if (error) toast('Could not save: ' + error.message, 'error'); else mountApp();
  };
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const recent = rows.filter(x => x.sold >= since);
  const g = new Map(); recent.forEach(x => { (g.get(x.source) || g.set(x.source, []).get(x.source)).push(x); });
  const ents = [...g.entries()].map(([src, list]) => {
    const r12 = _intelRetain(list, 365), r3 = _intelRetain(list, 90);
    const avgArv = list.length ? list.reduce((a, x) => a + x.arv, 0) / list.length : 0;
    const churn = r12.rate == null ? (r3.rate == null ? null : Math.min(1, (1 - r3.rate) * 4)) : 1 - r12.rate;   // annualise 90-day when 12-mo not judgeable yet
    const life = churn == null ? null : (churn <= 0 ? 8 : Math.min(8, 1 / churn));
    const ltv = life == null ? null : avgArv * life;
    const monthly = Number(spend[src]) || 0;
    const cac = monthly > 0 && list.length ? (monthly * 12) / list.length : null;
    return { src, n: list.length, arv: list.reduce((a, x) => a + x.arv, 0), avgArv, r3: r3.rate, r12: r12.rate, est: r12.rate == null, life, ltv, monthly, cac, ratio: cac && ltv ? ltv / cac : null };
  }).sort((a, b) => b.n - a.n);
  const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
  const th = (t, right) => el('th', { class: 'px-3 py-2 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
  const td = (v, o = {}) => el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap ' + (o.right ? 'text-right' : '') + (o.bold ? ' font-semibold' : ''), style: o.style || {} }, v);
  return el('div', { class: 'card p-4 flex flex-col gap-3' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
      el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Source economics'),
        el('div', { class: 'text-[11px] text-muted-' }, 'New recurring accounts in the last 12 months by source · LTV = avg ARR × (1 ÷ annual churn, max 8 yrs) · type monthly spend to get CAC')),
      el('div', { class: 'text-[10px] text-muted-' }, '~ = 12-month retention not judgeable yet, annualised from 90-day')),
    el('div', { style: { overflow: 'auto', maxHeight: '460px' } }, el('table', { class: 'w-full text-xs' },
      el('thead', {}, el('tr', {}, th('Source'), th('New accts', true), th('Avg ARR', true), th('Ret 90d', true), th('Ret 12mo', true), th('Lifetime', true), th('LTV', true), th('Spend / mo', true), th('CAC', true), th('LTV : CAC', true))),
      el('tbody', {}, ...ents.map(e => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(e.src, { bold: true }), td(e.n.toLocaleString(), { right: true }), td(fmt.usd0(e.avgArv), { right: true }),
        td(pct(e.r3), { right: true }), td((e.est ? '~' : '') + pct(e.r12 == null ? (e.r3 == null ? null : 1 - Math.min(1, (1 - e.r3) * 4)) : e.r12), { right: true }),
        td(e.life == null ? '—' : e.life.toFixed(1) + ' yrs', { right: true }), td(e.ltv == null ? '—' : fmt.usd0(e.ltv), { right: true, bold: true }),
        el('td', { class: 'px-3 py-1 text-right' }, el('input', { type: 'number', min: '0', step: '100', value: e.monthly || '', placeholder: '$', class: 'rounded-lg border px-2 py-0.5 text-[11px] tabular-nums text-right', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '84px' }, onchange: (ev) => saveSpend(e.src, Number(ev.target.value) || 0) })),
        td(e.cac == null ? '—' : fmt.usd0(e.cac), { right: true }),
        td(e.ratio == null ? '—' : e.ratio.toFixed(1) + '×', { right: true, bold: true, style: e.ratio == null ? {} : { color: e.ratio >= 3 ? '#16A34A' : e.ratio >= 1.5 ? '#D97706' : '#DC2626' } })))))));
}

// ── 4. Add-on performance (pricing intelligence) ────────────────────────
// Reads upsell rows (sale_kind = 'upsell') once the FieldRoutes add-on
// switch is on: per item — sold, avg price, who sells it, and whether
// accounts WITH the add-on retain better than the book without it.
function intelAddonCard() {
  const ups = ((state.allSales || []).concat(...Object.values(state.queueSales || {}))).filter(s => s.sale_kind === 'upsell');
  const rows = _intelRows();
  const byCust = new Map(); rows.forEach(x => { if (x.customer) (byCust.get(x.customer) || byCust.set(x.customer, []).get(x.customer)).push(x); });
  const g = new Map();
  ups.forEach(s => { const k = nameFromId(state.serviceTypes, s.service_type_id) || s.crm_subscription || 'Add-on'; (g.get(k) || g.set(k, []).get(k)).push(s); });
  const items = [...g.entries()].map(([k, list]) => {
    const rev = list.reduce((a, s) => a + (Number(s.revenue_amount) || 0), 0);
    const custs = new Set(list.map(s => String(s.customer_number || '')).filter(Boolean));
    const withRows = []; custs.forEach(c => (byCust.get(c) || []).forEach(x => withRows.push(x)));
    const sellers = new Map(); list.forEach(s => { const n = ((state.allProfiles || []).find(p => p.id === s.rep_id) || {}).full_name || '—'; sellers.set(n, (sellers.get(n) || 0) + 1); });
    const top = [...sellers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => n + ' (' + c + ')').join(', ');
    return { k, n: list.length, rev, avg: list.length ? rev / list.length : 0, custs: custs.size, ret: _intelRetain(withRows, 90).rate, top };
  }).sort((a, b) => b.rev - a.rev);
  const baseRet = _intelRetain(rows.filter(x => x.sold >= new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)), 90).rate;
  const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
  const th = (t, right) => el('th', { class: 'px-3 py-2 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const td = (v, o = {}) => el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap ' + (o.right ? 'text-right' : '') + (o.bold ? ' font-semibold' : '') }, v);
  return el('div', { class: 'card p-4 flex flex-col gap-3' },
    el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Add-on performance'),
      el('div', { class: 'text-[11px] text-muted-' }, items.length ? 'Every add-on sold as a FieldRoutes ticket item · 90-day retention of accounts with the add-on vs ' + pct(baseRet) + ' for the book' : 'Fills in once add-ons are sold as ticket items in FieldRoutes and Upsells is set to Automatic in Configurations.')),
    items.length ? el('div', { style: { overflow: 'auto' } }, el('table', { class: 'w-full text-xs' },
      el('thead', {}, el('tr', {}, th('Add-on'), th('Sold', true), th('Revenue', true), th('Avg price', true), th('Accounts', true), th('Ret 90d w/ add-on', true), th('Top sellers'))),
      el('tbody', {}, ...items.map(e => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(e.k, { bold: true }), td(String(e.n), { right: true }), td(fmt.usd0(e.rev), { right: true }), td(fmt.usd0(e.avg), { right: true }), td(String(e.custs), { right: true }),
        td(pct(e.ret), { right: true, bold: true }), td(e.top)))))) : null);
}
