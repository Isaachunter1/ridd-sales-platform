// ┌─ src/89-reporting-ops.js ────────────────────────────────────────────────
// │ Reporting → Operations (per Isaac, Sep 2026): the COO's "OPS 26" sheet
// │ as a live tab. Weekly (Sun–Sat) × office, from indicators/ops-stats.json
// │ (ops-stats-background: FieldRoutes appointments, tickets, time clock,
// │ reviews) + Service Pro upsell dollars from the Indicators dataset. Gross
// │ pay, management hours and Google reviews are not in FieldRoutes — they
// │ are typed in on this tab (app_settings.ops_manual) and stay in the math.
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
  if (!state._opsManualLoaded) loadOpsManual();
  const wrap = el('div', { class: 'flex flex-col gap-4' });
  const S = state.opsStats;
  const kick = el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)' }, title: 'Rebuild the weekly stats from FieldRoutes now (otherwise every 6 hours)',
    onclick: async () => { try { const r = await fetch('/api/ops-stats-now', { method: 'POST', headers: { Authorization: 'Bearer ' + (state.session && state.session.access_token) } }); const j = await r.json().catch(() => ({})); toast(j.message || j.error || ('HTTP ' + r.status), r.ok ? 'success' : 'error'); } catch (e) { toast('Could not start: ' + e.message, 'error'); } } }, '↻ Refresh now');
  if (!S) {
    wrap.append(el('div', { class: 'card p-8 text-center text-sm text-muted- flex flex-col items-center gap-3' },
      state._opsStatsMissing ? 'No operations stats yet — the worker runs every 6 hours; kick it now and reload in a minute.' : 'Loading operations stats…', kick));
    return wrap;
  }
  const names = S.officeNames || {};
  const officeIds = Object.keys(names).filter(id => Object.keys(S.cells).some(k => k.startsWith(id + '|')));
  const offices = officeIds.map(id => ({ id, name: names[id] })).sort((a, b) => a.name.localeCompare(b.name));
  const weeks = (S.weeks || []).filter(w => w <= S.end);
  const todayWs = opsWeekStart(new Date().toISOString().slice(0, 10));
  const manual = state.opsManual || {};
  const man = (o, w) => (manual[w] && manual[w][o]) || {};

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
  // Sum of cells (offices × weeks) → one aggregate, manual fields included.
  const agg = (pairs) => {
    const t = { done: 0, sch: 0, resvc: 0, prod: 0, routes: 0, mins: 0, minsn: 0, rtypes: {}, hours: 0, fr_reviews: 0, upsell: 0, pay_incl: 0, pay_excl: 0, hrs_mgmt: 0, reviews: 0, n: 0 };
    for (const [oid, w] of pairs) {
      const c = raw(oid, w), m = man(oid, w);
      for (const k of ['done', 'sch', 'resvc', 'prod', 'routes', 'mins', 'minsn', 'hours', 'fr_reviews', 'upsell']) t[k] += Number(c[k]) || 0;
      for (const k of Object.keys(c.rtypes || {})) t.rtypes[k] = (t.rtypes[k] || 0) + c.rtypes[k];
      t.pay_incl += Number(m.pay_incl) || 0; t.pay_excl += Number(m.pay_excl) || 0; t.hrs_mgmt += Number(m.hrs_mgmt) || 0; t.reviews += Number(m.reviews) || 0; t.n++;
    }
    t.hrs_excl = t.hours; t.hrs_incl = t.hours + t.hrs_mgmt;
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
    { key: 'spend_per_appt', group: 'Direct labor', label: 'Spend per appointment (mgmt excluded)', fmt: usd, calc: (t) => div(t.pay_excl, t.done), rate: true, manual: true },
    { key: 'spend_per_hr_incl', group: 'Direct labor', label: 'Spend per hour (mgmt included)', fmt: usd, calc: (t) => div(t.pay_incl, t.hrs_incl), rate: true, manual: true },
    { key: 'spend_per_hr_excl', group: 'Direct labor', label: 'Spend per hour (mgmt excluded)', fmt: usd, calc: (t) => div(t.pay_excl, t.hrs_excl), rate: true, manual: true },
    { key: 'pay_incl', group: 'Direct labor', label: 'Gross pay (mgmt included)', fmt: usd, calc: (t) => t.pay_incl, manual: true },
    { key: 'pay_excl', group: 'Direct labor', label: 'Gross pay (mgmt excluded)', fmt: usd, calc: (t) => t.pay_excl, manual: true },
    { key: 'hrs_incl', group: 'Direct labor', label: 'Hours worked (mgmt included)', fmt: num1, calc: (t) => t.hrs_incl, note: 'Tech time clock + management hours entered by hand' },
    { key: 'hrs_excl', group: 'Direct labor', label: 'Hours worked (techs, time clock)', fmt: num1, calc: (t) => t.hrs_excl },
    { key: 'reviews', group: 'Reviews', label: 'Google reviews received', fmt: num1, calc: (t) => t.reviews, manual: true },
    { key: 'fr_reviews', group: 'Reviews', label: 'FieldRoutes reviews received', fmt: num1, calc: (t) => t.fr_reviews },
  ];
  const mKey = METRICS.some(m => m.key === state._opsMetric) ? state._opsMetric : 'done';
  const M = METRICS.find(m => m.key === mKey);
  const view = ['week', 'month'].includes(state._opsView) ? state._opsView : 'week';
  const completedWeeks = Math.max(1, weeks.filter(w => w < todayWs).length);

  const months = [...new Set(weeks.map(w => w.slice(0, 7)))].sort();
  const weekCols = state._opsAllWeeks ? weeks.slice().reverse() : weeks.slice(-14).reverse();
  const cols = view === 'week'
    ? weekCols.map(w => ({ key: w, label: opsWeekLabel(w), pairsFor: (oids) => oids.map(o => [o, w]), live: w === todayWs }))
    : months.slice().reverse().map(mo => ({ key: mo, label: new Date(mo + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short' }), pairsFor: (oids) => oids.flatMap(o => weeks.filter(w => w.slice(0, 7) === mo).map(w => [o, w])), live: mo === todayWs.slice(0, 7) }));
  const base25 = OPS_BASELINE_2025[mKey] || null;
  const valueFor = (oids, col) => M.calc(agg(col.pairsFor(oids)));
  const ytdWeekly = (oids) => { const v = M.calc(agg(oids.flatMap(o => weeks.filter(w => w < todayWs).map(w => [o, w])))); return v == null ? null : (M.rate ? v : v / completedWeeks); };
  const lowerIsBetter = ['resvc_pct', 'resvc', 'spend_per_appt', 'spend_per_hr_incl', 'spend_per_hr_excl', 'svc_minutes'].includes(mKey);

  const th = (t, right, extra) => el('th', Object.assign({ class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, extra || {}), t);
  const td = (t, o = {}) => el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap ' + (o.right ? 'text-right' : 'text-left') + (o.bold ? ' font-black' : ''), style: Object.assign({}, o.muted ? { color: 'var(--text-subtle)' } : {}, o.style || {}) }, t);
  const rowFor = (label, oids, bold) => {
    const cells = [el('td', { class: 'px-2 py-1.5 whitespace-nowrap ' + (bold ? 'font-black' : 'font-semibold'), style: bold ? { background: 'var(--card-2)' } : {} }, label)];
    const yv = ytdWeekly(oids); const b = base25 && base25[label] != null ? base25[label] : null;
    cells.push(td(M.fmt(yv), { right: true, bold: true }));
    cells.push(td(b == null ? '—' : M.fmt(b), { right: true, muted: true }));
    const ch = (yv != null && b) ? (yv - b) / b : null;
    cells.push(td(ch == null ? '—' : (ch > 0 ? '+' : '') + (ch * 100).toFixed(1) + '%', { right: true, style: ch == null ? {} : { color: (lowerIsBetter ? ch <= 0 : ch >= 0) ? 'var(--ok)' : '#DC2626' } }));
    for (const c of cols) { const v = valueFor(oids, c); cells.push(td(v == null ? '—' : M.fmt(v), { right: true, muted: c.live })); }
    return el('tr', { class: 'border-t', style: { borderColor: bold ? 'var(--border-2)' : 'var(--border)', background: bold ? 'var(--card-2)' : '' } }, ...cells);
  };
  const allIds = offices.map(o => o.id);
  const table = el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
    el('thead', {}, el('tr', {}, th('Office'), th(M.rate ? 'YTD' : 'YTD wk avg', true), th('2025', true, { title: '2025 from the COO sheet (weekly average for counts, ratio for rates)' }), th('vs 2025', true), ...cols.map(c => th(c.label + (c.live ? ' · live' : ''), true)))),
    el('tbody', {}, rowFor('RIDD', allIds, true), ...offices.map(o => rowFor(o.name, [o.id], false))));

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

  const manualCard = (() => {
    const wk = weeks.includes(state._opsManualWeek) ? state._opsManualWeek : (weeks.filter(w => w < todayWs).slice(-1)[0] || weeks[weeks.length - 1]);
    const FIELDS = [['pay_incl', 'Gross pay · mgmt incl.'], ['pay_excl', 'Gross pay · mgmt excl.'], ['hrs_mgmt', 'Management hours'], ['reviews', 'Google reviews']];
    const inputs = [];
    const save = async () => {
      const next = JSON.parse(JSON.stringify(state.opsManual || {}));
      next[wk] = next[wk] || {};
      for (const { oid, key, inp } of inputs) { const v = inp.value.trim(); next[wk][oid] = next[wk][oid] || {}; if (v === '') delete next[wk][oid][key]; else next[wk][oid][key] = Number(v); if (!Object.keys(next[wk][oid]).length) delete next[wk][oid]; }
      if (!Object.keys(next[wk]).length) delete next[wk];
      state.opsManual = next;
      const r = await saveAppSettingCas('ops_manual', next, async () => { await loadOpsManual(); toast('Someone else saved this week since you opened it — reloaded, please re-enter', 'warn'); });
      if (r.ok) { toast('Week saved', 'success'); mountApp(); } else if (!r.conflict) toast('Save failed — ' + ((r.error && r.error.message) || 'unknown'), 'error');
    };
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Hand-entered inputs'), el('div', { class: 'text-[11px] text-muted-' }, 'Payroll and Google reviews are not in FieldRoutes. Type a week’s numbers here; the labor and review metrics above use them.')),
        el('div', { class: 'flex items-center gap-2' },
          el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)' }, onchange: (e) => { state._opsManualWeek = e.target.value; mountApp(); } },
            ...weeks.slice().reverse().map(w => el('option', { value: w, selected: w === wk }, opsWeekLabel(w) + (w === todayWs ? ' (current)' : '')))),
          el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: save }, 'Save week'))),
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Office'), ...FIELDS.map(([, l]) => th(l, true)), th('Tech hours (clock)', true))),
        el('tbody', {}, ...offices.map(o => { const m = man(o.id, wk); const c = raw(o.id, wk); return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-2 py-1 font-semibold whitespace-nowrap' }, o.name),
          ...FIELDS.map(([key]) => { const inp = el('input', { type: 'number', step: 'any', value: m[key] != null ? String(m[key]) : '', class: 'rounded-lg border px-2 py-0.5 text-[11px] tabular-nums text-right', style: { borderColor: 'var(--border-2)', background: 'var(--card)', width: '110px' } }); inputs.push({ oid: o.id, key, inp }); return el('td', { class: 'px-2 py-1 text-right' }, inp); }),
          td(num1(c.hours), { right: true, muted: true })); })))));
  })();

  wrap.append(
    el('div', { class: 'card p-4 flex items-center gap-3 flex-wrap' },
      el('div', { class: 'flex-1 min-w-0' }, el('h3', { class: 'text-sm font-bold' }, 'Operations'), el('div', { class: 'text-[11px] text-muted-' }, 'Sun–Sat weeks · by office · FieldRoutes appointments, tickets and time clock + Service Pro upsells from the Indicators dataset' + (S.generatedAt ? ' · built ' + new Date(S.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''))),
      el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', maxWidth: '100%' }, onchange: (e) => { state._opsMetric = e.target.value; mountApp(); } },
        ...[...new Set(METRICS.map(m => m.group))].map(g => el('optgroup', { label: g }, ...METRICS.filter(m => m.group === g).map(m => el('option', { value: m.key, selected: m.key === mKey }, m.label))))),
      el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
        ...[['week', 'Weeks'], ['month', 'Months']].map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-bold transition', style: v === view ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._opsView = v; mountApp(); } }, l))),
      view === 'week' && weeks.length > 14 ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._opsAllWeeks = !state._opsAllWeeks; mountApp(); } }, state._opsAllWeeks ? 'Last 14 weeks' : 'All ' + weeks.length + ' weeks') : null,
      kick),
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', {}, el('h3', { class: 'text-sm font-bold' }, M.label), el('div', { class: 'text-[11px] text-muted-' }, (M.note || '') + (M.manual ? (M.note ? ' · ' : '') + 'uses the hand-entered inputs below' : '') + (M.rate ? '' : ' · YTD = weekly average of completed weeks'))),
        el('div', { class: 'text-[10px] text-muted-' }, 'Current period is live and partial')),
      el('div', { class: 'scroll-x' }, table)),
    rtypeCard,
    manualCard);
  return wrap;
}
