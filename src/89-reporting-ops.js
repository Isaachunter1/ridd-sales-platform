// ┌─ src/89-reporting-ops.js ────────────────────────────────────────────────
// │ Reporting → Operations (per Isaac, Sep 2026): the COO's "OPS 26" sheet
// │ as a live tab. Weekly (Sun–Sat) × office, from indicators/ops-stats.json
// │ (ops-stats-background: FieldRoutes appointments, tickets, time clock,
// │ reviews) + Service Pro upsell dollars from the Indicators dataset. Gross
// │ (Hand-entered payroll / management hours / Google reviews retired Sep 21 —
// │ everything on the tab now comes from FieldRoutes.)
// │ 2025 baselines come from the sheet (OPS_BASELINE_2025) for % change.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────

// 2025 full-year values from the COO's sheet (column B of OPS 26) — weekly
// averages for flow metrics, ratios for rate metrics. Keyed by the app's
// office names ("SLC" in the sheet = Salt Lake).
const OPS_BASELINE_2025 = {
  upsell_per_prod: { RIDD: 0.0879, Atlanta: 0.034, Charleston: 0.0352, Destin: 0.0238, 'Myrtle Beach': 0.184, Raleigh: 0.0652, 'Salt Lake': 0.0218, 'Virginia Beach': 0.1186 },
  appts_per_route: { RIDD: 9.7745, Atlanta: 9.119, Charleston: 10.0475, Destin: 9.2894, 'Myrtle Beach': 10.3108, Raleigh: 9.9475, 'Salt Lake': 9.0323, 'Virginia Beach': 9.6537 },
  completion:      { RIDD: 0.9286, Atlanta: 0.9261, Charleston: 0.9245, Destin: 0.9233, 'Myrtle Beach': 0.9397, Raleigh: 0.9426, 'Salt Lake': 0.9462, 'Virginia Beach': 0.8961 },
  resvc_pct:       { RIDD: 0.0426, Atlanta: 0.0464, Charleston: 0.0336, Destin: 0.0454, 'Myrtle Beach': 0.0369, Raleigh: 0.0423, 'Salt Lake': 0.069, 'Virginia Beach': 0.0507 },
  upsell:          { RIDD: 30833, Atlanta: 1377.29, Charleston: 1959.5, Destin: 1210.56, 'Myrtle Beach': 17509.94, Raleigh: 3593.81, 'Salt Lake': 254, 'Virginia Beach': 4927.9 },
  done:            { RIDD: 2384.88, Atlanta: 273.23, Charleston: 366.15, Destin: 342.17, 'Myrtle Beach': 617.08, Raleigh: 391.56, 'Salt Lake': 98.33, 'Virginia Beach': 296.37 },
  sch:             { RIDD: 2568.38, Atlanta: 295.04, Charleston: 396.04, Destin: 370.6, 'Myrtle Beach': 656.69, Raleigh: 415.38, 'Salt Lake': 103.92, 'Virginia Beach': 330.71 },
  routes:          { RIDD: 264.2, Atlanta: 31.6, Charleston: 39.1, Destin: 40.5, 'Myrtle Beach': 63.9, Raleigh: 43, 'Salt Lake': 11.8, 'Virginia Beach': 34.3 },   // 2025 totals ÷ 52
  prod:            { RIDD: 381011, Atlanta: 43176, Charleston: 59916, Destin: 55910, 'Myrtle Beach': 103127, Raleigh: 59867, 'Salt Lake': 12612, 'Virginia Beach': 46403 },   // 2025 totals ÷ 52
  prod_per_appt:   { RIDD: 159.76, Atlanta: 158.02, Charleston: 163.64, Destin: 163.4, 'Myrtle Beach': 167.12, Raleigh: 152.9, 'Salt Lake': 128.27, 'Virginia Beach': 156.57 },
  resvc:           { RIDD: 129.1, Atlanta: 16.04, Charleston: 16.63, Destin: 19.75, 'Myrtle Beach': 29.48, Raleigh: 20.33, 'Salt Lake': 7.63, 'Virginia Beach': 19.23 },
  spend_per_appt:  { RIDD: 30.43, Atlanta: 33.97, Charleston: 29.53, Destin: 30, 'Myrtle Beach': 32.54, Raleigh: 28.37, 'Salt Lake': 21.2, 'Virginia Beach': 30.16 },
  spend_per_hr_incl: { RIDD: 30.61, Atlanta: 25.58, Charleston: 33.8, Destin: 27.42, 'Myrtle Beach': 34.71, Raleigh: 30.84, 'Salt Lake': 25.81, 'Virginia Beach': 30.47 },
  spend_per_hr_excl: { RIDD: 22.74, Atlanta: 26.47, Charleston: 33.2, Destin: 27.41, 'Myrtle Beach': 34.98, Raleigh: 14.46, 'Salt Lake': 10.8, 'Virginia Beach': 14.77 },
  reviews:         { RIDD: 160.37, Atlanta: 20.46, Charleston: 36.87, Destin: 14.82, 'Myrtle Beach': 35.94, Raleigh: 25.26, 'Salt Lake': 7.62, 'Virginia Beach': 19.39 },
};
// Baseline year for the "vs" column (generalization, Sep 22 2026): a company
// can store its own in adminRules.opsBaseline = { year: 2025, values: { <metric key>: { ALL: n, '<Office>': n } } }
// ('ALL' or the company name = company-wide). Nothing stored = RIDD's 2025 sheet
// above. A company with no baseline just sees '—' in those two columns.
function opsBaseline() {
  const r = (typeof _adminRules === 'function') ? _adminRules() : null;
  const b = r && r.opsBaseline && typeof r.opsBaseline === 'object' && r.opsBaseline.values ? r.opsBaseline : null;
  return b ? { year: Number(b.year) || (new Date().getFullYear() - 1), values: b.values } : { year: 2025, values: OPS_BASELINE_2025 };
}
function opsBaselineFor(metricKey, scopeName) {
  const B = opsBaseline(); const m = B.values[metricKey]; if (!m) return null;
  const isAll = scopeName === 'RIDD' || scopeName === 'ALL' || scopeName === CFG.COMPANY_NAME;
  const v = isAll ? (m.ALL != null ? m.ALL : m.RIDD != null ? m.RIDD : m[CFG.COMPANY_NAME]) : m[scopeName];
  return v == null ? null : v;
}
const OPS_RESVC_TYPES = ['Ants', 'Carpenter Bee', 'Earwigs', 'Fire Ants', 'German Roach', 'Interior Flea', 'Manager', 'Mole', 'Mosquito', 'Roach', 'Rodent', 'Snake', 'Spiders', 'Tech Error', 'VIP', 'Wasps'];

let _opsCheckedAt = 0;
async function refreshOpsStatsFromCloud(force) {
  if (DEMO || !state.profile || !isAdminRole(state.profile?.role)) return;
  if (!force && Date.now() - _opsCheckedAt < 300000) return;
  _opsCheckedAt = Date.now();
  try {
    const r = await _downloadSnapshotBlob('indicators/ops-stats.json', null, { meta: true }).catch(() => null);
    if (!r || !r.blob) { state._opsStatsMissing = true; if (state.view === 'reporting') mountApp(); return; }
    const payload = JSON.parse(await r.blob.text());
    if (!payload || !payload.cells) return;
    state.opsStats = payload; state._opsStatsMissing = false; healthReport('ops', true);
    if (state.view === 'reporting' && state.reportingSubTab === 'ops') mountApp();
  } catch (e) { healthReport('ops', false, e); }
}
async function loadOpsManual() {
  if (DEMO || !supabase || !state.profile) return;
  state._opsManualLoaded = true;
  try {
    const { data, error } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'ops_manual').maybeSingle();
    if (error) return;
    state.opsManual = (data && data.value) || {}; (state._settingsSeen = state._settingsSeen || {}).ops_manual = data ? data.updated_at : null;
    if (state.view === 'reporting' && state.reportingSubTab === 'ops') mountApp();
  } catch (e) { /* noop */ }
}
function opsWeekStart(iso) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function opsWeekLabel(ws) { const a = new Date(ws + 'T12:00:00'); const b = new Date(a); b.setDate(a.getDate() + 6); return (a.getMonth() + 1) + '/' + a.getDate() + '–' + (b.getMonth() + 1) + '/' + b.getDate(); }

function reportingOps() {
  if (!state.opsStats && !state._opsStatsMissing) refreshOpsStatsFromCloud();
  const wrap = el('div', { class: 'flex flex-col gap-4' });
  const S = state.opsStats;
  // (Refresh-now button retired per Isaac, Sep 21 — the worker runs every 6 hours.)
  if (!S) {
    wrap.append(el('div', { class: 'card p-8 text-center text-sm text-muted- flex flex-col items-center gap-3' },
      state._opsStatsMissing ? 'No operations stats yet — the worker runs every 6 hours; check back after the next run.' : 'Loading operations stats…'));
    return wrap;
  }
  const names = S.officeNames || {};
  const officeIds = Object.keys(names).filter(id => Object.keys(S.cells).some(k => k.startsWith(id + '|')));
  const offices = officeIds.map(id => ({ id, name: names[id] })).sort((a, b) => a.name.localeCompare(b.name));
  const weeks = (S.weeks || []).filter(w => w <= S.end);
  const todayWs = opsWeekStart(new Date().toISOString().slice(0, 10));

  // Service Pro upsell $ by office × week from the Indicators dataset (contract value, sold date).
  const upsell = {};
  (state._indicatorRawSales || []).forEach(s => {
    if (!TECH_UPSELL_SRC_RE.test(String(s.source || '').trim())) return;
    const iso = (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || ''; if (!iso || iso < weeks[0]) return;
    const w = opsWeekStart(iso); const o = String(s.office || '').split(',')[0].trim();
    const oid = officeIds.find(id => names[id].toLowerCase() === o.toLowerCase()) || ('name:' + o);
    upsell[oid + '|' + w] = (upsell[oid + '|' + w] || 0) + (Number(s.contractValue) || 0);
  });
  const raw = (oid, w) => Object.assign({ done: 0, sch: 0, resvc: 0, prod: 0, routes: 0, mins: 0, minsn: 0, rtypes: {}, hours: 0, fr_reviews: 0 }, S.cells[oid + '|' + w] || {}, { upsell: upsell[oid + '|' + w] || 0 });
  // Sum of cells (offices × weeks) → one aggregate.
  const agg = (pairs) => {
    const t = { done: 0, sch: 0, resvc: 0, prod: 0, routes: 0, mins: 0, minsn: 0, rtypes: {}, hours: 0, fr_reviews: 0, upsell: 0, n: 0 };
    for (const [oid, w] of pairs) {
      const c = raw(oid, w);
      for (const k of ['done', 'sch', 'resvc', 'prod', 'routes', 'mins', 'minsn', 'hours', 'fr_reviews', 'upsell']) t[k] += Number(c[k]) || 0;
      for (const k of Object.keys(c.rtypes || {})) t.rtypes[k] = (t.rtypes[k] || 0) + c.rtypes[k];
      t.n++;
    }
    t.hrs_excl = t.hours;
    return t;
  };
  const pct = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const num1 = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-US');
  const usd = (v) => v == null ? '—' : fmt.usd0(v);
  const div = (a, b) => b ? a / b : null;
  // Metric catalogue — the sheet's sections, in its order. `rate` metrics
  // are ratios (compared as-is); the rest are weekly flows (YTD = weekly average).
  const METRICS = [
    { key: 'upsell_per_prod', group: 'Upsells', label: 'Service Pro upsells per $1 serviced', fmt: pct, calc: (t) => div(t.upsell, t.prod), rate: true, note: 'Upsell contract value ÷ production serviced' },
    { key: 'upsell', group: 'Upsells', label: 'Service Pro upsells ($)', fmt: usd, calc: (t) => t.upsell, note: 'Subscriptions with source "Upsell - Service Pro", contract value, by sold date' },
    { key: 'appts_per_route', group: 'Appointments', label: 'Appointments per route run', fmt: num1, calc: (t) => div(t.done, t.routes), rate: true, note: 'Completed ÷ routes run' },
    { key: 'completion', group: 'Appointments', label: 'Job completion %', fmt: pct, calc: (t) => div(t.done, t.sch), rate: true, note: 'Completed ÷ (completed + pending)' },
    { key: 'done', group: 'Appointments', label: 'Completed appointments', fmt: num1, calc: (t) => t.done },
    { key: 'sch', group: 'Appointments', label: 'Scheduled appointments', fmt: num1, calc: (t) => t.sch },
    { key: 'routes', group: 'Appointments', label: 'Routes run', fmt: num1, calc: (t) => t.routes, note: 'Route-days with a completed stop' },
    { key: 'prod', group: 'Production', label: 'Production serviced', fmt: usd, calc: (t) => t.prod },
    { key: 'prod_per_appt', group: 'Production', label: 'Production per appointment', fmt: usd, calc: (t) => div(t.prod, t.done), rate: true },
    { key: 'prod_per_route', group: 'Production', label: 'Production per route', fmt: usd, calc: (t) => div(t.prod, t.routes), rate: true },
    { key: 'prod_per_hr', group: 'Production', label: 'Production per tech hour', fmt: usd, calc: (t) => div(t.prod, t.hrs_excl), rate: true, note: 'Production ÷ technician time-clock hours' },
    { key: 'svc_minutes', group: 'Production', label: 'Service duration (min)', fmt: num1, calc: (t) => div(t.mins, t.minsn), rate: true, note: 'Check-in → check-out on completed stops' },
    { key: 'resvc_pct', group: 'Reservices', label: 'Reservice % of completed', fmt: pct, calc: (t) => div(t.resvc, t.done), rate: true },
    { key: 'resvc', group: 'Reservices', label: 'Reservices', fmt: num1, calc: (t) => t.resvc },
    { key: 'hrs_excl', group: 'Direct labor', label: 'Tech hours worked (time clock)', fmt: num1, calc: (t) => t.hrs_excl },
    { key: 'fr_reviews', group: 'Reviews', label: 'FieldRoutes reviews received', fmt: num1, calc: (t) => t.fr_reviews },
  ];
  // Layout (per Isaac, Sep 21): no metric dropdown — EVERY metric is a row
  // on the page (the sheet's shape), columns are the periods, and an office
  // picker scopes the whole table. Click a metric row to open its by-office
  // breakdown underneath.
  const view = ['week', 'month'].includes(state._opsView) ? state._opsView : 'week';
  const completedWeeks = Math.max(1, weeks.filter(w => w < todayWs).length);
  const allIds = offices.map(o => o.id);
  const scopeId = state._opsOffice && allIds.includes(state._opsOffice) ? state._opsOffice : 'RIDD';
  const scopeName = scopeId === 'RIDD' ? CFG.COMPANY_NAME : names[scopeId];   // 'RIDD' stays the sentinel scope id; the label is the company name
  const scopeIds = scopeId === 'RIDD' ? allIds : [scopeId];
  const months = [...new Set(weeks.map(w => w.slice(0, 7)))].sort();
  const weekCols = state._opsAllWeeks ? weeks.slice().reverse() : weeks.slice(-14).reverse();
  const cols = view === 'week'
    ? weekCols.map(w => ({ key: w, label: opsWeekLabel(w), pairsFor: (oids) => oids.map(o => [o, w]), live: w === todayWs }))
    : months.slice().reverse().map(mo => ({ key: mo, label: new Date(mo + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short' }), pairsFor: (oids) => oids.flatMap(o => weeks.filter(w => w.slice(0, 7) === mo).map(w => [o, w])), live: mo === todayWs.slice(0, 7) }));
  // One aggregate per column per scope, shared by every metric row.
  const aggCache = new Map();
  const aggFor = (oids, col) => { const k = oids.join(',') + '|' + col.key; if (!aggCache.has(k)) aggCache.set(k, agg(col.pairsFor(oids))); return aggCache.get(k); };
  const ytdAggFor = (oids) => { const k = oids.join(',') + '|ytd'; if (!aggCache.has(k)) aggCache.set(k, agg(oids.flatMap(o => weeks.filter(w => w < todayWs).map(w => [o, w])))); return aggCache.get(k); };
  const ytdWeekly = (M, oids) => { const v = M.calc(ytdAggFor(oids)); return v == null ? null : (M.rate ? v : v / completedWeeks); };
  const LOWER = new Set(['resvc_pct', 'resvc', 'svc_minutes']);
  const th = (t, right, extra) => el('th', Object.assign({ class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, extra || {}), t);
  const td = (t, o = {}) => el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap ' + (o.right ? 'text-right' : 'text-left') + (o.bold ? ' font-black' : ''), style: Object.assign({}, o.muted ? { color: 'var(--text-subtle)' } : {}, o.style || {}) }, t);
  // A metric's cells for one scope: YTD · 2025 · vs · periods.
  const metricCells = (M, oids, baseName, bold) => {
    const yv = ytdWeekly(M, oids); const b = opsBaselineFor(M.key, baseName);
    const ch = (yv != null && b) ? (yv - b) / b : null;
    return [
      td(M.fmt(yv), { right: true, bold: true }),
      td(b == null ? '—' : M.fmt(b), { right: true, muted: true }),
      td(ch == null ? '—' : (ch > 0 ? '+' : '') + (ch * 100).toFixed(1) + '%', { right: true, style: ch == null ? {} : { color: (LOWER.has(M.key) ? ch <= 0 : ch >= 0) ? 'var(--ok)' : '#DC2626' } }),
      ...cols.map(c => { const v = M.calc(aggFor(oids, c)); return td(v == null ? '—' : M.fmt(v), { right: true, muted: c.live, bold: !!bold }); }),
    ];
  };
  const open = state._opsExpanded && METRICS.some(m => m.key === state._opsExpanded) ? state._opsExpanded : null;
  const headRow = () => el('tr', {}, th('Metric'), th('YTD', true, { title: 'Weekly average of completed weeks for counts; the ratio itself for rates' }), th(String(opsBaseline().year), true, { title: opsBaseline().year + ' baseline (weekly average for counts, ratio for rates)' }), th('vs ' + opsBaseline().year, true), ...cols.map(c => th(c.label + (c.live ? ' · live' : ''), true)));
  const bodyRows = [];
  let lastGroup = null;
  for (const M of METRICS) {
    if (M.group !== lastGroup) { lastGroup = M.group; bodyRows.push(el('tr', {}, el('td', { class: 'px-2 pt-3 pb-1 text-[9px] uppercase tracking-widest font-bold', colspan: String(4 + cols.length), style: { color: 'var(--text-subtle)' } }, M.group))); }
    const isOpen = open === M.key;
    bodyRows.push(el('tr', { class: 'border-t cursor-pointer hover:brightness-95 transition', style: { borderColor: 'var(--border)', background: isOpen ? 'rgba(223,100,58,.06)' : '' }, title: (M.note ? M.note + ' · ' : '') + 'Click for the by-office breakdown',
      onclick: () => { state._opsExpanded = isOpen ? null : M.key; mountApp(); } },
      el('td', { class: 'px-2 py-1.5 whitespace-nowrap font-semibold', style: { position: 'sticky', left: 0, background: isOpen ? 'rgba(223,100,58,.06)' : 'var(--card)', zIndex: 1 } }, (isOpen ? '▾ ' : '▸ ') + M.label),
      ...metricCells(M, scopeIds, scopeName, false)));
    if (isOpen && scopeId === 'RIDD') {
      // By-office breakdown, right under the metric.
      for (const o of offices) bodyRows.push(el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
        el('td', { class: 'px-2 py-1 whitespace-nowrap text-[11px]', style: { paddingLeft: '22px', color: 'var(--text-muted)', position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }, o.name),
        ...metricCells(M, [o.id], o.name, false).map(c => { c.style.fontSize = '11px'; return c; })));
    }
  }
  const table = el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } }, el('thead', {}, headRow()), el('tbody', {}, ...bodyRows));
  const officePills = el('div', { class: 'flex items-center gap-1 flex-wrap' },
    ...[['RIDD', CFG.COMPANY_NAME], ...offices.map(o => [o.id, o.name])].map(([id, l]) => el('button', { class: 'rounded-full px-2 py-0.5 text-[10px] font-bold transition hover:brightness-95', style: scopeId === id ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }, onclick: () => { state._opsOffice = id === 'RIDD' ? null : id; mountApp(); } }, l)));

  const rtypeCard = (() => {
    const t = agg(allIds.flatMap(o => weeks.map(w => [o, w])));
    const types = [...new Set([...OPS_RESVC_TYPES, ...Object.keys(t.rtypes)])];
    const rows = types.map(k => [k, t.rtypes[k] || 0]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const tot = rows.reduce((a, r) => a + r[1], 0);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('h3', { class: 'text-sm font-bold' }, 'Reservices by type · YTD'), el('div', { class: 'text-[11px] text-muted-' }, 'Completed reservice appointments by reservice service type (the part after "Reservice - ")')),
      rows.length ? el('div', { class: 'grid gap-x-6 gap-y-1 p-4', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' } },
        ...rows.map(([k, n]) => el('div', { class: 'flex items-center justify-between text-xs' }, el('span', {}, k), el('span', { class: 'tabular-nums' }, el('b', {}, fmt.int(n)), el('span', { class: 'text-[10px] ml-1', style: { color: 'var(--text-muted)' } }, tot ? Math.round(n / tot * 100) + '%' : '')))))
        : el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'No reservices yet.'));
  })();

  // (Hand-entered inputs card retired per Isaac, Sep 21 — payroll / management hours / Google reviews are out of this tab; FieldRoutes-only metrics remain.)

  wrap.append(
    el('div', { class: 'card p-4 flex flex-col gap-3' },
      el('div', { class: 'flex items-center gap-3 flex-wrap' },
        el('div', { class: 'flex-1 min-w-0' }, el('h3', { class: 'text-sm font-bold' }, 'Operations · ' + scopeName), el('div', { class: 'text-[11px] text-muted-' }, 'Sun–Sat weeks · FieldRoutes appointments, tickets and time clock + Service Pro upsells from the Indicators dataset' + (S.generatedAt ? ' · built ' + new Date(S.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '') + ' · refreshes every 6 hours · current period is live and partial · YTD = weekly average of completed weeks (ratios as-is) · click a metric for the by-office split')),
        el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
          ...[['week', 'Weeks'], ['month', 'Months']].map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-bold transition', style: v === view ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._opsView = v; mountApp(); } }, l))),
        view === 'week' && weeks.length > 14 ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._opsAllWeeks = !state._opsAllWeeks; mountApp(); } }, state._opsAllWeeks ? 'Last 14 weeks' : 'All ' + weeks.length + ' weeks') : null),
      officePills),
    el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' }, table)),
    rtypeCard);
  return wrap;
}
