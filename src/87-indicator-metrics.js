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
  ['renewals', 'Renewals', 'Renewal-source subscriptions (Office Staff: the board’s New / Total / Renewal toggle decides)'],
  ['oneTime',  'One-time', 'One-time services'],
  ['ror',      '3-day RORs', 'Sales cancelled within the 3-day right of rescission'],
  ['pending',  'Not serviced yet', 'Sold, initial still Pending (no completed service)'],
];
const _IND_PEST_EXCL = /sentricon|german\s*roach|interior\s*flea/i;
// fixed: dims the metric's formula already decides (shown, not editable).
const IND_METRIC_DEFS = [
  { key: 'count',       label: 'Sales',          def: 'Count of sales.' },
  { key: 'revenue',     label: 'Revenue',        def: 'Sum of contract value.' },
  { key: 'sellingDays', label: 'Days w/ Sale',   def: 'Distinct sold dates.' },
  { key: 'acctsPerDay', label: 'Accts/Day',      def: 'Sales ÷ days with a sale.' },
  { key: 'revPerDay',   label: '$/Day',          def: 'Revenue ÷ days with a sale.' },
  { key: 'acv',         label: 'ACV',            def: 'Revenue ÷ sales.' },
  { key: 'avgInitial',  label: 'Avg Init',       def: 'Mean initial price.' },
  { key: 'avgPest',     label: 'Pest Init',      def: 'Mean initial price, Sentricon / German Roach / Interior Flea left out.' },
  { key: 'myPct',       label: 'MY %',           def: 'Multi-year (18+ mo) ÷ (12-mo + multi-year). Other terms and the MY % excluded services are out of both sides.', fixed: { oneTime: false } },
  { key: 'autoPayPct',  label: 'APay %',         def: 'Sales with autopay on file ÷ sales.' },
  { key: 'servicedPct', label: 'Serviced %',     def: 'Sales with a completed service ÷ sales.', fixed: { pending: true } },
  { key: 'attrPct',     label: 'Attrition %',    def: 'Cancelled $ ÷ serviced $.', fixed: { oneTime: false, ror: false } },
  { key: 'cancels',     label: 'Cancels',        def: 'Sales cancelled (player card).' },
];
function _indMetricDefault(key, dept, dim) {
  const d = IND_METRIC_DEFS.find(x => x.key === key);
  if (d && d.fixed && dim in d.fixed) return d.fixed[dim];
  if (dim === 'renewals') return dept !== 'office';   // office: the board's New lens (default New = no renewals)
  return true;                                        // today everything else is in
}
function indMetricRules() { const r = (typeof _adminRules === 'function') ? _adminRules() : null; return (r && r.indMetricRules && typeof r.indMetricRules === 'object') ? r.indMetricRules : {}; }
function indMetricRule(key, dept, dim) {
  const d = IND_METRIC_DEFS.find(x => x.key === key);
  if (d && d.fixed && dim in d.fixed) return d.fixed[dim];
  if (dept === 'office' && dim === 'renewals') return _indMetricDefault(key, dept, dim);   // lens decides
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
  if (!indMetricRule(key, dept, 'renewals') && dept !== 'office' && typeof _indicatorIsRenewal === 'function' && _indicatorIsRenewal(s)) return false;
  if (!indMetricRule(key, dept, 'oneTime') && typeof _indIsOneTimeSale === 'function' && _indIsOneTimeSale(s)) return false;
  if (!indMetricRule(key, dept, 'ror') && typeof _is3DayROR === 'function' && s.cancelDate && _is3DayROR(s)) return false;
  if (!indMetricRule(key, dept, 'pending') && !((Number(s.services) || 0) > 0 || !!s.servicedDate)) return false;
  return true;
}
// Recompute ONLY the metrics whose rules differ from today's for this view.
// Returns a patch of rep fields ({} when nothing is customised).
function indMetricOverride(rep, deptView) {
  const depts = deptView === 'all' ? IND_METRIC_DEPTS.map(x => x[0]) : [deptView];
  const patch = {};
  const all = rep.sales || [];
  const days = (ss) => new Set(ss.map(s => (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '').filter(Boolean)).size;
  const rev = (ss) => ss.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
  const mean = (ss) => ss.length ? ss.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / ss.length : 0;
  for (const d of IND_METRIC_DEFS) {
    if (!depts.some(dp => _indMetricCustomized(d.key, dp))) continue;
    const ss = all.filter(s => _indKeep(s, d.key, deptView));
    const n = ss.length;
    switch (d.key) {
      case 'count': patch.count = n; break;
      case 'revenue': patch.revenue = rev(ss); break;
      case 'sellingDays': patch.sellingDays = days(ss); break;
      case 'acctsPerDay': { const k = days(ss); patch.acctsPerDay = k ? n / k : 0; break; }
      case 'revPerDay': { const k = days(ss); patch.revPerDay = k ? rev(ss) / k : 0; break; }
      case 'acv': patch.acv = n ? rev(ss) / n : 0; break;
      case 'avgInitial': patch.avgInitial = mean(ss); break;
      case 'avgPest': patch.avgPest = mean(ss.filter(s => !_IND_PEST_EXCL.test(s.subscription || ''))); break;
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
function indicatorMetricRulesTable() {
  const muted = { color: 'var(--text-muted)' };
  const th = (t, cls) => el('th', { class: (cls || 'text-left') + ' px-2 py-1.5 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const chip = (key, dept, dim, label, tip) => {
    const d = IND_METRIC_DEFS.find(x => x.key === key);
    const fixed = (d.fixed && dim in d.fixed) || (dept === 'office' && dim === 'renewals');
    const on = indMetricRule(key, dept, dim);
    const changed = !fixed && on !== _indMetricDefault(key, dept, dim);
    return el('button', { type: 'button', disabled: fixed, title: (fixed ? (dept === 'office' && dim === 'renewals' ? 'Office Staff: the leaderboard’s New / Total / Renewal toggle decides renewals' : 'Set by the metric’s own formula') : (on ? 'Included — click to leave out' : 'Left out — click to include')) + ' · ' + tip,
      class: 'rounded-full border px-2.5 text-[10px] font-semibold whitespace-nowrap', 
      style: Object.assign({ minHeight: '30px' }, on ? { background: 'rgba(95,108,91,.14)', color: '#5F6C5B', borderColor: 'rgba(95,108,91,.35)' } : { background: 'transparent', color: 'var(--text-subtle)', borderColor: 'var(--border-2)', textDecoration: 'line-through' },
        fixed ? { opacity: '.5', cursor: 'default' } : { cursor: 'pointer' }, changed ? { boxShadow: '0 0 0 1.5px var(--accent)' } : {}),
      onclick: () => { if (fixed) return; setIndMetricRule(key, dept, dim, !on); saveIndicatorState(); mountApp(); } }, label);
  };
  return el('div', { class: 'rounded-lg border mt-2', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'flex items-center gap-2 flex-wrap px-3 py-2', style: { background: 'var(--card-2)' } },
      el('span', { class: 'text-[11px] font-bold' }, 'Metric rules · what goes into each metric, by user type'),
      el('span', { class: 'text-[10px] flex-1', style: { color: 'var(--text-subtle)' } }, 'Green = included, struck through = left out; outlined = changed from the default. Every metric starts from the Pending / Serviced sales after the exclusions above. Applies to the leaderboard and player cards.'),
      Object.keys(indMetricRules()).length ? el('button', { class: 'text-[10px] underline', style: muted, onclick: () => { _setAdminRule('indMetricRules', {}); saveIndicatorState(); mountApp(); } }, 'reset all to default') : null),
    el('div', { class: 'scroll-x' }, el('table', { class: 'text-xs', style: { width: '100%', borderCollapse: 'collapse', minWidth: '980px' } },
      el('thead', {}, el('tr', {}, th('Metric'), th('Formula'), ...IND_METRIC_DEPTS.map(([, l]) => th(l)))),
      el('tbody', {}, ...IND_METRIC_DEFS.map(d => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-2 py-1.5 font-semibold whitespace-nowrap' }, d.label),
        el('td', { class: 'px-2 py-1.5 text-[11px]', style: Object.assign({ maxWidth: '280px' }, muted) }, d.def),
        ...IND_METRIC_DEPTS.map(([dept]) => el('td', { class: 'px-2 py-1.5' }, el('div', { class: 'flex flex-wrap gap-1' },
          ...IND_METRIC_DIMS.map(([dim, label, tip]) => chip(d.key, dept, dim, label, tip)))))))))));
}
