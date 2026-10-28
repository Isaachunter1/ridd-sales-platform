// ┌─ src/87-indicator-metrics.js ────────────────────────────────────────────
// │ Indicator metric rules (per Isaac, Sep 30): every Indicators metric, and
// │ for each user type (Sales Rep · Office Staff · Technician) what goes into
// │ it — renewals, one-time services, 3-day RORs, sales not serviced yet.
// │ Settings → Configurations → Indicators → Metric rules. Defaults are
// │ exactly today's behaviour; a metric only recomputes (leaderboard + player
// │ card) when an admin changes one of its rules for that user type.
// │ Base pool for every metric = Indicators' Pending / Serviced sales after
// │ the Configurations exclusions (services, teams, sources, deleted).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const IND_METRIC_DEPTS = [['d2d', 'Sales Reps'], ['office', 'Office Staff'], ['techs', 'Technicians']];
const IND_METRIC_DIMS = [
  ['renewals', 'Renewals', 'Renewal-source subscriptions'],
  ['oneTime',  'One-time', 'One-time services'],
  ['ror',      '3-day RORs', 'Sales cancelled within the 3-day right of rescission'],
  ['pending',  'Not serviced yet', 'Sold, initial still Pending (no completed service)'],
  // Add-ons (per Isaac, Oct 16): FieldRoutes ticket-item add-ons credited to the rep. Indicators never counted them,
  // so they're off by default everywhere; turning one on adds the rep's add-ons in the window to that metric.
  ['addOns',   'Add-ons', 'FieldRoutes add-ons (ticket items) credited to the rep in the window'],
];
const _IND_PEST_EXCL = { test: (v) => pestInitialExclRe().test(String(v == null ? '' : v)) };
// fixed: dims the metric's formula already decides (shown, not editable).
const IND_METRIC_DEFS = [
  { key: 'count',       label: 'Subscriptions',          def: 'Count of sales.' },
  { key: 'revenue',     label: 'Revenue',        def: 'Sum of contract value.' },
  { key: 'sellingDays', label: 'Days w/ Sale',   def: 'Distinct sold dates.' },
  { key: 'acctsPerDay', label: 'Accts/Day',      def: 'Sales ÷ days with a sale.' },
  { key: 'revPerDay',   label: '$/Day',          def: 'Revenue ÷ days with a sale.' },
  { key: 'acv',         label: 'ACV',            def: 'Contract value ÷ sales, recurring new only (one-time services and renewals are always out — see Weighted / One-Time / Renewal ACV on the leaderboard).', fixed: { oneTime: false, renewals: false } },
  { key: 'avgInitial',  label: 'Avg Init',       def: 'Mean initial price.' },
  { key: 'avgPest',     label: 'Pest Init',      def: 'Mean initial price, Sentricon / German Roach / Interior Flea left out.', fixed: { addOns: false } },
  { key: 'myPct',       label: 'Multi-Year %',           def: 'Multi-year (18+ mo) ÷ (12-mo + multi-year). Other terms and the MY % excluded services are out of both sides.', fixed: { oneTime: false, addOns: false } },
  { key: 'autoPayPct',  label: 'Auto Pay %',         def: 'Sales with autopay on file ÷ sales.' },
  { key: 'servicedPct', label: 'Serviced %',     def: 'Sales with a completed service ÷ sales.', fixed: { pending: true, addOns: false } },
  { key: 'attrPct',     label: 'Attrition %',    def: 'Cancelled $ ÷ serviced $.', fixed: { oneTime: false, ror: false, addOns: false } },
  { key: 'cancels',     label: 'Cancels',        def: 'Sales cancelled (player card).', fixed: { addOns: false } },
];
function _indMetricDefault(key, dept, dim) {
  const d = IND_METRIC_DEFS.find(x => x.key === key);
  if (d && d.fixed && dim in d.fixed) return d.fixed[dim];
  if (dim === 'addOns') return false;                 // add-ons were never in Indicators
  return true;                                        // today everything else is in
}
function indMetricRules() { const r = (typeof _adminRules === 'function') ? _adminRules() : null; return (r && r.indMetricRules && typeof r.indMetricRules === 'object') ? r.indMetricRules : {}; }
function indMetricRule(key, dept, dim) {
  const d = IND_METRIC_DEFS.find(x => x.key === key);
  if (d && d.fixed && dim in d.fixed) return d.fixed[dim];
  const v = ((indMetricRules()[key] || {})[dept] || {})[dim];
  return typeof v === 'boolean' ? v : _indMetricDefault(key, dept, dim);
}
function setIndMetricRule(key, dept, dim, val) {
  const all = JSON.parse(JSON.stringify(indMetricRules()));
  all[key] = all[key] || {}; all[key][dept] = all[key][dept] || {};
  if (val === _indMetricDefault(key, dept, dim)) delete all[key][dept][dim]; else all[key][dept][dim] = !!val;
  if (!Object.keys(all[key][dept]).length) delete all[key][dept];
  if (!Object.keys(all[key]).length) delete all[key];
  _setAdminRule('indMetricRules', all);
}
function _indMetricCustomized(key, dept) {
  return IND_METRIC_DIMS.some(([dim]) => indMetricRule(key, dept, dim) !== _indMetricDefault(key, dept, dim));
}
function _indSaleDept(s, fallback) { return (typeof _indicatorDeptOf === 'function' ? _indicatorDeptOf(s) : null) || fallback; }
function _indKeep(s, key, deptView) {
  const dept = deptView === 'all' ? _indSaleDept(s, 'office') : deptView;
  if (s && s._addOn) return indMetricRule(key, dept, 'addOns');
  if (!indMetricRule(key, dept, 'renewals') && typeof _indicatorIsRenewal === 'function' && _indicatorIsRenewal(s)) return false;
  if (!indMetricRule(key, dept, 'oneTime') && typeof _indIsOneTimeSale === 'function' && _indIsOneTimeSale(s)) return false;
  if (!indMetricRule(key, dept, 'ror') && typeof _is3DayROR === 'function' && s.cancelDate && _is3DayROR(s)) return false;
  if (!indMetricRule(key, dept, 'pending') && !((Number(s.services) || 0) > 0 || !!s.servicedDate)) return false;
  return true;
}
// Recompute ONLY the metrics whose rules differ from today's for this view.
// Returns a patch of rep fields ({} when nothing is customised).
// The rep's FieldRoutes add-ons in the window, shaped like Indicators sales
// (same rows the player card lists). bounds = { start, end } as Dates or ISO
// days; defaults to the page's range, else the span of the rep's own sales.
const _IND_FEE_LIKE = /\bfee\b|\btax\b|discount|surcharge/i;
// An add-on sold WITH its base plan is already inside that plan's recurring / CV — FieldRoutes folds it into
// the subscription (per Isaac, Oct 28: Pest 4 at $73.87 / $1,116 already holds the $20 Interior Flea). So it is
// shown on the plan's row ("Pest 4 + Interior Flea") and never counted a second time. An add-on only stands on
// its own when it was the ONLY thing added — sold onto an account that already had its plan (no plan row for
// that customer within a day of it, the Sales tab's own tolerance).
function indStandaloneAddOns(saleRows, addOnRows) {
  if (!addOnRows || !addOnRows.length) return [];
  const dayMs = (v) => { const iso = (typeof dateSoldToIso === 'function' && dateSoldToIso(v)) || String(v || '').slice(0, 10); const t = Date.parse(iso + 'T00:00'); return Number.isFinite(t) ? t : null; };
  const byCust = new Map();
  for (const x of (saleRows || [])) { if (!x || x._addOn) continue; const k = String(x.customerId || ''); const t = dayMs(x.dateSold); if (t == null) continue; (byCust.get(k) || byCust.set(k, []).get(k)).push(t); }
  return addOnRows.filter(a => { const t = dayMs(a.dateSold); const ts = byCust.get(String(a.customerId || '')) || []; return !(t != null && ts.some(d => Math.abs(d - t) <= 86400000)); });
}
function _indAddOnRows(rep, bounds) {
  const sales = rep.sales || [];
  const ids = new Set(sales.map(x => String(x.repId || '')).filter(Boolean));
  if (!ids.size) return [];
  const iso = (v) => v instanceof Date ? (v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0')) : String(v || '').slice(0, 10);
  let lo = bounds && iso(bounds.start), hi = bounds && iso(bounds.end);
  if (!lo || !hi) {
    if (state.indicatorsView === 'range' && typeof indicatorRangeBounds === 'function') { const b = indicatorRangeBounds(state.indicatorsRangePreset, { start: state.indicatorsCustomStart, end: state.indicatorsCustomEnd }); lo = b.start; hi = b.end; }
    else { const ds = sales.map(x => (typeof dateSoldToIso === 'function' && dateSoldToIso(x.dateSold)) || '').filter(Boolean).sort(); lo = ds[0]; hi = ds[ds.length - 1]; }
  }
  if (!lo || !hi) return [];
  const byCust = new Map(sales.map(x => [String(x.customerId || ''), x]));
  const src = (Array.isArray(state.addOns) && state.addOns.length) ? state.addOns : (state._tvAddOns || []);
  const out = [];
  for (const a of src) {
    if (!a || a.removed_at || !a.added_at || !ids.has(String(a.credited_employee_id || '')) || _IND_FEE_LIKE.test(String(a.service_name || ''))) continue;
    const day = String(a.added_at).slice(0, 10);
    if (day < lo || day > hi) continue;
    const parent = byCust.get(String(a.customer_id || '')) || sales[0] || {};
    const [y, m, d] = day.split('-');
    const rec = Number(a.recurring_amount) || 0;
    out.push(Object.assign({}, parent, { _addOn: true, customerId: a.customer_id || '', subscription: 'ADD ON \u00b7 ' + (a.service_name || 'Add-on'),
      dateSold: Number(m) + '/' + Number(d) + '/' + y + ' 00:00:00', initialPrice: a.initial_amount != null ? Number(a.initial_amount) || 0 : null,
      recurring: rec * 12, contractValue: typeof addOnAnnualValue === 'function' ? addOnAnnualValue(a) : rec * 12,
      status: 'Active', cancelDate: '', cancelReason: '' }));
  }
  return out;
}
function indMetricOverride(rep, deptView, bounds) {
  const depts = deptView === 'all' ? IND_METRIC_DEPTS.map(x => x[0]) : [deptView];
  const patch = {};
  // Office Staff renewals switched on (per Isaac, Oct 16): count them even when
  // the board's toggle is on New — so start from the rep's unfiltered sales.
  const _lensNew = false;   // the Office Staff New lens is retired (Oct 16) — boards count total
  const _anyAddOns = IND_METRIC_DEFS.some(d => depts.some(dp => indMetricRule(d.key, dp, 'addOns')));
  const _ao = _anyAddOns ? _indAddOnRows(rep._orig || rep, bounds) : [];
  const days = (ss) => new Set(ss.map(s => (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '').filter(Boolean)).size;
  const rev = (ss) => ss.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
  const mean = (ss) => { const xs = ss.filter(s => !(s._addOn && s.initialPrice == null)); return xs.length ? xs.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / xs.length : 0; };
  for (const d of IND_METRIC_DEFS) {
    if (!depts.some(dp => _indMetricCustomized(d.key, dp))) continue;
    const base = (_lensNew && indMetricRule(d.key, 'office', 'renewals')) ? rep._orig.sales : (rep.sales || []);
    const ss = base.concat(indStandaloneAddOns(rep._orig ? rep._orig.sales : base, _ao)).filter(s => _indKeep(s, d.key, deptView));   // add-ons sold with the plan are already in its CV
    const n = ss.length;
    switch (d.key) {
      case 'count': patch.count = n; break;
      case 'revenue': patch.revenue = rev(ss); break;
      case 'sellingDays': patch.sellingDays = days(ss); break;
      case 'acctsPerDay': { const k = days(ss); patch.acctsPerDay = k ? n / k : 0; break; }
      case 'revPerDay': { const k = days(ss); patch.revPerDay = k ? rev(ss) / k : 0; break; }
      case 'acv': patch.acv = (typeof indAcvSplit === 'function') ? indAcvSplit(ss).acv : (n ? rev(ss) / n : 0); break;
      case 'avgInitial': patch.avgInitial = mean(ss); break;
      case 'avgPest': patch.avgPest = mean(ss.filter(s => avgPestEligible(s))); break;
      case 'myPct': { let m = 0, t = 0; for (const s of ss) { const b = typeof myBucketOf === 'function' ? myBucketOf(s) : null; if (b === 'multi') m++; else if (b === 'twelve') t++; } patch.myPct = (m + t) ? m / (m + t) : 0; patch.multi = m; patch.twelve = t; break; }
      case 'autoPayPct': patch.autoPayPct = n ? ss.filter(s => s.autoPay && s.autoPay !== 'No').length / n : 0; break;
      case 'servicedPct': { const k = ss.filter(s => (Number(s.services) || 0) > 0 || !!s.servicedDate).length; patch.servicedPct = n ? k / n : 0; patch.servicedN = k; break; }
      case 'attrPct': { let sv = 0, cx = 0; for (const s of ss) { const p = typeof _attrRevParts === 'function' ? _attrRevParts(s) : { serv: 0, cxl: 0 }; sv += p.serv; cx += p.cxl; } patch.attrPct = sv ? cx / sv : 0; break; }
      case 'cancels': patch.cancels = ss.filter(s => typeof _repCancelCounts === 'function' && _repCancelCounts(s)).length; break;
    }
  }
  return patch;
}

// Settings → Configurations → Indicators: the metric × user-type matrix.
// One dropdown per cell (per Isaac, Oct 16 — same control as the Permissions
// tab): the button reads "4/5 counted", the panel ticks each kind of sale.
function indicatorMetricRulesTable() {
  const muted = { color: 'var(--text-muted)' };
  const th = (t, cls) => el('th', { class: (cls || 'text-left') + ' px-2 py-1.5 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const isFixed = (d, dept, dim) => !!(d.fixed && dim in d.fixed);
  const cell = (d, dept) => {
    const key = 'mr:' + d.key + ':' + dept;
    const open = state._mrOpen === key;
    const on = IND_METRIC_DIMS.filter(([dim]) => indMetricRule(d.key, dept, dim));
    const changed = _indMetricCustomized(d.key, dept);
    const out = IND_METRIC_DIMS.filter(([dim]) => !indMetricRule(d.key, dept, dim)).map(x => x[1]);
    const tip = out.length ? 'Left out: ' + out.join(', ') : 'Every kind of sale counts';
    const wrap = el('div', { class: 'relative', 'data-mr': key });
    const btn = el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer flex items-center justify-between gap-2',
      style: { borderColor: changed ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '170px', justifyContent: 'space-between', textAlign: 'left' },
      title: tip + (changed ? ' · changed from the default' : ''),
      onclick: (e) => { e.stopPropagation(); state._mrOpen = open ? null : key; mountApp(); },
    }, el('span', { class: 'truncate' }, on.length + '/' + IND_METRIC_DIMS.length + ' counted'), el('span', { style: { fontSize: '9px', opacity: .7 } }, '\u25be'));
    wrap.append(btn);
    if (open) {
      const panel = el('div', { class: 'card absolute p-1.5', style: { top: 'calc(100% + 6px)', left: '0', width: '280px', maxWidth: 'calc(100vw - 32px)', zIndex: '40', boxShadow: 'var(--shadow-lg)' } },
        el('div', { class: 'flex items-center gap-2 px-2 pt-1 pb-1.5 mb-1 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' } },
          el('span', { class: 'flex-1' }, d.label + ' \u00b7 ' + (IND_METRIC_DEPTS.find(x => x[0] === dept) || [, dept])[1]),
          changed ? el('button', { class: 'text-[10px] font-semibold normal-case tracking-normal', style: { color: 'var(--accent)' }, onclick: (e) => { e.stopPropagation();
            for (const [dim] of IND_METRIC_DIMS) if (!isFixed(d, dept, dim)) setIndMetricRule(d.key, dept, dim, _indMetricDefault(d.key, dept, dim));
            saveIndicatorState(); mountApp(); } }, 'Reset') : null),
        ...IND_METRIC_DIMS.map(([dim, label, help]) => {
          const fixed = isFixed(d, dept, dim);
          const v = indMetricRule(d.key, dept, dim);
          const diff = !fixed && v !== _indMetricDefault(d.key, dept, dim);
          const note = fixed ? 'Set by the metric’s formula'
            : help;
          const c = el('input', { type: 'checkbox', disabled: fixed, style: { accentColor: 'var(--accent)', marginTop: '2px' },
            onchange: (e) => { setIndMetricRule(d.key, dept, dim, e.target.checked); saveIndicatorState(); mountApp(); } });
          c.checked = v;
          return el('label', { class: 'w-full flex items-start gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold', style: { background: v ? 'var(--card-2)' : 'transparent', color: 'var(--text)', cursor: fixed ? 'default' : 'pointer', opacity: fixed ? '.55' : '1' } },
            c, el('span', { class: 'flex-1' }, label, el('span', { class: 'block text-[10px] font-normal', style: muted }, note)),
            diff ? el('span', { class: 'text-[9px]', style: { color: 'var(--accent)' }, title: 'Changed from default' }, '\u25cf') : null);
        }));
      wrap.append(panel);
      try { if (typeof clampDropdownPanel === 'function') clampDropdownPanel(panel); } catch (err) { /* optional */ }
      setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
        if (ev.target.closest && ev.target.closest('[data-mr="' + key + '"]')) return;
        document.removeEventListener('mousedown', closer);
        if (state._mrOpen === key) { state._mrOpen = null; mountApp(); }
      }), 0);
    }
    return wrap;
  };
  return el('div', { class: 'rounded-lg border mt-2', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'flex items-center gap-2 flex-wrap px-3 py-2', style: { background: 'var(--card-2)' } },
      el('span', { class: 'text-[10px] flex-1', style: { color: 'var(--text-subtle)' } }, 'Pick which kinds of sales each metric counts: renewals, one-time services, 3-day RORs, sales not serviced yet and add-ons. An orange outline means it’s changed from the default. Every metric starts from the Pending / Serviced sales after the exclusions above, and the rules apply to the leaderboard and player cards.'),
      Object.keys(indMetricRules()).length ? el('button', { class: 'text-[10px] underline', style: muted, onclick: () => { _setAdminRule('indMetricRules', {}); saveIndicatorState(); mountApp(); } }, 'reset all to default') : null),
    el('div', { class: 'scroll-x' }, el('table', { class: 'text-xs', style: { width: '100%', borderCollapse: 'collapse', minWidth: '820px' } },
      el('thead', {}, el('tr', {}, th('Metric'), th('Formula'), ...IND_METRIC_DEPTS.map(([, l]) => th(l)))),
      el('tbody', {}, ...IND_METRIC_DEFS.map(d => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-2 py-1.5 font-semibold whitespace-nowrap' }, d.label),
        el('td', { class: 'px-2 py-1.5 text-[11px]', style: Object.assign({ maxWidth: '300px' }, muted) }, d.def),
        ...IND_METRIC_DEPTS.map(([dept]) => el('td', { class: 'px-2 py-1.5' }, cell(d, dept)))))))));
}
