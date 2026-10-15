// ┌─ src/85-marketing-metrics.js ──────────────────────────────────────────
// │ Marketing → Metrics, rebuilt (per Isaac, Oct 15) around the lead COHORT:
// │ the NEW leads that came into GoHighLevel in a date range, and what became
// │ of them — matched to FieldRoutes on phone / email (the same match as the
// │ rest of Marketing: semLeadConversions, a sale within SEM_LEAD_WINDOW_DAYS
// │ of the lead). One date range + one channel picker drive the whole page.
// │   · Lead → Sold → Job (initial scheduled or completed) → Serviced
// │   · Spend = the QuickBooks lines as linked on the Spend tab (spqAllocMonth),
// │     pro-rated by day when the range covers part of a month
// │   · Cost per lead, cost per job, revenue, ROAS, days to close
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// The app's own kit (per Isaac, Oct 15): charcoal for leads, RIDD orange for jobs, sage for the rate.
const MKM_C = { get leads() { return state.theme === 'dark' ? '#E6E6DC' : '#323230'; }, jobs: '#DF643A', rate: '#5F6C5B' };
// Office Staff only (per Isaac, Oct 15): the cohort tracks new inbound leads and what the office did with them,
// so a lead counts as converted only when an Office Staff login sold the plan (door-to-door and technician sales
// to the same person don't). Same index shape as _attrCrmIndex, built from the office's subscriptions.
function _mkmOfficeCrmIndex() {
  const subs = state.reportingSubscriptions || [];
  if (_mkmOfficeCrmIndex._m && _mkmOfficeCrmIndex._m.src === subs) return _mkmOfficeCrmIndex._m;
  const cust = new Map(), byPhone = new Map(), byEmail = new Map();
  for (const r of subs) {
    if (String(r.sold_by_type || '').trim() !== 'Office Staff') continue;
    const id = String(r.customer_id != null ? r.customer_id : ''); if (!id) continue;
    let c = cust.get(id); if (!c) { c = { id, subs: [] }; cust.set(id, c); }
    c.subs.push(r);
    const ph = typeof _attrDigits === 'function' ? _attrDigits(r.phone) : '', em = typeof _attrEmail === 'function' ? _attrEmail(r.email) : '';
    if (ph) byPhone.set(ph, id); if (em) byEmail.set(em, id);
  }
  return (_mkmOfficeCrmIndex._m = { src: subs, cust, byPhone, byEmail });
}
// Date range = the sales dashboard's own picker (per Isaac, Oct 15): same presets (Today, Yesterday, This/Last
// week, This/Last month, This/Last year, every older year in the data, All time, Custom) and the same bounds.
function _mkmIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function appRangeOptions() { return (typeof indicatorPresetOptions === 'function') ? indicatorPresetOptions() : [{ id: 'this_month', label: 'This Month' }, { id: 'custom', label: 'Custom…' }]; }
function appRangeBounds(preset, custom) {
  if (preset === 'all_time') return { start: null, end: null };
  return (typeof indicatorRangeBounds === 'function') ? indicatorRangeBounds(preset, custom) : { start: null, end: null };
}
// The page's range: { from, to, preset, label } (to is inclusive).
function mkmRange() {
  const R = state._mkmRange || (state._mkmRange = { preset: 'this_month' });
  const opts = appRangeOptions();
  const preset = opts.some(o => o.id === R.preset) ? R.preset : 'this_month';
  const t = _mkmIso(new Date());
  let b = preset === 'all_time' ? { start: '2015-01-01', end: t } : appRangeBounds(preset, { start: R.from, end: R.to });
  let from = b.start || '2015-01-01', to = b.end || t;
  if (from > to) { const x = from; from = to; to = x; }
  const label = preset === 'custom' ? fmt.dateShortYear(from) + ' – ' + fmt.dateShortYear(to) : ((opts.find(o => o.id === preset) || {}).label || 'Range');
  return { from, to, preset, label };
}
function _mkmDays(a, b) { return Math.round((Date.parse(b + 'T12:00') - Date.parse(a + 'T12:00')) / 86400000) + 1; }
// The range picker that sits in the Marketing bar on Metrics (replaces the year arrows there).
function mkmRangeControl() {
  const R = mkmRange();
  const st = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const set = (patch) => { state._mkmRange = Object.assign({}, state._mkmRange || {}, patch); state._mkmMemo = null; mountApp(); };
  return el('div', { class: 'inline-flex items-center gap-1.5 flex-wrap' },
    el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: st, title: 'Date range — the leads that came into GoHighLevel in it',
      onchange: (e) => { const v = e.target.value; set(v === 'custom' ? { preset: 'custom', from: R.from, to: R.to } : { preset: v }); } },
      ...appRangeOptions().map(o => el('option', { value: o.id, selected: R.preset === o.id }, o.label))),
    R.preset === 'custom' ? el('input', { type: 'date', value: R.from, class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: st, onchange: (e) => set({ from: e.target.value }) }) : null,
    R.preset === 'custom' ? el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'to') : null,
    R.preset === 'custom' ? el('input', { type: 'date', value: R.to, class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: st, onchange: (e) => set({ to: e.target.value }) }) : null,
    R.preset !== 'custom' ? el('span', { class: 'text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } }, fmt.dateShort(R.from) + ' – ' + fmt.dateShort(R.to)) : null);
}
// Spend per channel in the range, from the Spend tab's QuickBooks lines (pro-rated by day for part months).
function mkmSpendByChannel(from, to) {
  const out = { byProv: new Map(), total: 0, months: 0, missing: [] };
  if (typeof spqAllocMonth !== 'function') return out;
  const d = new Date(from.slice(0, 7) + '-01T12:00'), end = to.slice(0, 7);
  for (let guard = 0; guard < 60; guard++) {
    const ym = _mkmIso(d).slice(0, 7); if (ym > end) break;
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const a = ym + '-01' < from ? from : ym + '-01', b = ym + '-' + String(dim).padStart(2, '0') > to ? to : ym + '-' + String(dim).padStart(2, '0');
    const f = _mkmDays(a, b) / dim;
    const A = spqAllocMonth(ym);
    if (!A) out.missing.push(ym);
    else { out.months++; for (const p in A.byProv) { if (p === SPQ_TOOLS) continue; const v = A.byProv[p].amt * f; out.byProv.set(p, (out.byProv.get(p) || 0) + v); out.total += v; }
      // Agency & tools: real marketing cost, not one channel's — it stays in the company total only.
      if (A.byProv[SPQ_TOOLS]) { const v = A.byProv[SPQ_TOOLS].amt * f; out.tools = (out.tools || 0) + v; out.total += v; }
      // Lines not linked to a channel yet still count in the company total (link them on the Spend tab).
      if (A.unassigned) { const v = A.unassigned * f; out.unlinked = (out.unlinked || 0) + v; out.total += v; } }
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
// One converted lead's sale → stage.
function _mkmStage(x) {
  if (!x.converted || !x.sale) return 'lead';
  const s = x.sale, ist = String(s.initial_status || '').trim().toLowerCase();
  if (s.initial_serviced_date || ist === 'completed') return 'serviced';
  if (ist === 'pending') return 'job';
  return 'sold';
}

function mktgMetricsView() {
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const R = mkmRange();
  const G = (typeof ghlLeads === 'function') ? ghlLeads() : null;
  const muted = { color: 'var(--text-muted)' };
  if (!G) return el('div', { class: 'card p-6 text-sm', style: muted }, state._ghl === null ? 'Loading GoHighLevel leads…' : 'No GoHighLevel leads yet — the GoHighLevel sync fills this in (Settings → Configurations → GoHighLevel sources).');
  const crm = (state.reportingSubscriptions || []).length ? _mkmOfficeCrmIndex() : null;
  const paid = ghlPaidSet();
  // Cohort: every new lead that came in during the range, matched to FieldRoutes. Memo per (file, book, range, map).
  const sig = R.from + '|' + R.to + '|' + JSON.stringify(ghlSourceMap());
  let ALL;
  const M = state._mkmMemo;
  if (M && M.g === G && M.subs === state.reportingSubscriptions && M.sig === sig) ALL = M.L;
  else {
    ALL = semLeadConversions(G.leads.filter(l => l.d >= R.from && l.d <= R.to), crm);
    for (const x of ALL) { x.paid = paid.has(x.lead.prov); x.stage = _mkmStage(x); x.days = x.sale && x.ms != null ? Math.max(0, Math.round((_semMs(x.sale.sold_date) - x.ms) / 86400000)) : null; x.rev = x.sale ? (Number(x.sale.subscription_contract_value) || 0) : 0; }
    state._mkmMemo = { g: G, subs: state.reportingSubscriptions, sig, L: ALL };
  }
  const SP = mkmSpendByChannel(R.from, R.to);
  // Channel picker: every channel with leads or spend in the range.
  const chCount = new Map(); for (const x of ALL) chCount.set(x.lead.prov || 'Unknown', (chCount.get(x.lead.prov || 'Unknown') || 0) + 1);
  for (const p of SP.byProv.keys()) if (!chCount.has(p)) chCount.set(p, 0);
  const ch = chCount.has(state._mkmChannel) ? state._mkmChannel : '';
  const L = ch ? ALL.filter(x => (x.lead.prov || 'Unknown') === ch) : ALL;
  const spend = ch ? (SP.byProv.get(ch) || 0) : SP.total;
  const hasSpend = SP.months > 0;
  const n = L.length, conv = L.filter(x => x.converted), jobs = conv.filter(x => x.stage === 'job' || x.stage === 'serviced'), serviced = conv.filter(x => x.stage === 'serviced');
  const paidLeads = ch ? n : L.filter(x => x.paid).length, paidJobs = ch ? jobs.length : jobs.filter(x => x.paid).length;
  const rev = jobs.reduce((a, x) => a + x.rev, 0);
  const daysArr = conv.map(x => x.days).filter(v => v != null).sort((a, b) => a - b);
  const medDays = daysArr.length ? daysArr[Math.floor(daysArr.length / 2)] : null;
  const fresh = L.filter(x => x.ms != null && (Date.now() - x.ms) < SEM_LEAD_WINDOW_DAYS * 86400000).length;
  const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(1) + '%' : '—';
  const usd = (v) => v == null ? '—' : fmt.usd0(v);
  const tile = (value, label, note, color) => el('div', { class: 'card p-4', title: note || '' },
    el('div', { class: 'text-2xl font-black tabular-nums', style: color ? { color } : {} }, value),
    el('div', { class: 'text-xs', style: muted }, label),
    note ? el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-subtle)' } }, note) : null);
  const noSpend = hasSpend ? null : 'no QuickBooks lines for this range yet';
  const cpl = hasSpend && paidLeads ? spend / paidLeads : null, cpj = hasSpend && paidJobs ? spend / paidJobs : null;
  const roas = hasSpend && spend > 0 ? rev / spend : null;
  const tiles = el('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))' } },
    tile(fmt.int(n), 'New leads', ch ? ch : fmt.int(L.filter(x => x.paid).length) + ' from paid channels'),
    tile(fmt.int(jobs.length), 'Jobs', fmt.int(serviced.length) + ' serviced · ' + fmt.int(conv.length - jobs.length) + ' sold, not booked'),
    tile(pct(jobs.length, n), 'Closed lead %', 'jobs ÷ every new lead (unqualified included) · ' + pct(conv.length, n) + ' became a sale of any kind'),
    tile(hasSpend ? usd(spend) : '—', 'Marketing spend', noSpend || ('QuickBooks · ' + (SP.missing.length ? SP.missing.length + ' month(s) not in yet' : 'as linked on Spend') + (SP.months && !['this_month', 'last_month'].includes(R.preset) ? ' · part months pro-rated' : ''))),
    tile(usd(cpl), 'Cost per lead', cpl != null ? 'spend ÷ ' + fmt.int(paidLeads) + (ch ? '' : ' paid') + ' leads' : noSpend),
    tile(usd(cpj), 'Cost per job', cpj != null ? 'spend ÷ ' + fmt.int(paidJobs) + (ch ? '' : ' paid-channel') + ' jobs' : noSpend),
    tile(usd(rev), 'Job revenue', 'contract value of the jobs · avg ' + usd(jobs.length ? rev / jobs.length : null)),
    tile(roas == null ? '—' : roas.toFixed(2) + 'x', 'ROAS', roas == null ? noSpend : 'job revenue ÷ spend', roas == null ? null : roas >= 1 ? '#5F6C5B' : '#DC2626'),
    tile(medDays == null ? '—' : medDays + 'd', 'Lead to sale', medDays == null ? 'no sales yet' : 'median days · ' + fmt.int(daysArr.length) + ' sales'));
  // ── Funnel ──
  const opp = (typeof _mktgOppIndex === 'function') ? _mktgOppIndex() : null;
  const withOpp = opp && (G.opps || state._ghl && state._ghl.opps || []).length ? L.filter(x => _mktgOppFor(x.lead, opp)).length : null;
  const steps = [['New leads', n], withOpp != null ? ['Opportunity in GHL', withOpp] : null, ['Sold in FieldRoutes', conv.length], ['Job booked', jobs.length], ['Serviced', serviced.length]].filter(Boolean);
  const funnel = el('div', { class: 'card p-4' },
    el('div', { class: 'text-sm font-bold mb-1' }, 'Funnel' + (ch ? ' · ' + ch : '')),
    el('div', { class: 'text-[11px] mb-3', style: muted }, 'The leads that came in ' + R.label.toLowerCase() + ', and how far each got. A lead converts when the same person (phone or email) is sold in FieldRoutes within ' + SEM_LEAD_WINDOW_DAYS + ' days.' + (fresh ? ' ' + fmt.int(fresh) + ' of these leads are under ' + SEM_LEAD_WINDOW_DAYS + ' days old, so the rates still climb.' : '')),
    el('div', { class: 'flex flex-col gap-2' }, ...steps.map(([lbl, v], i) => el('div', { class: 'flex items-center gap-3' },
      el('div', { class: 'text-[11px] font-semibold', style: { width: '150px', flexShrink: '0' } }, lbl),
      el('div', { style: { flex: '1', minWidth: '0', background: 'var(--card-2)', borderRadius: '4px', height: '22px', position: 'relative' } },
        el('div', { style: { width: (n ? Math.max(0.5, v / n * 100) : 0) + '%', height: '100%', borderRadius: '4px', background: i === 0 ? MKM_C.leads : i === steps.length - 1 ? MKM_C.rate : MKM_C.jobs, opacity: i === 0 || i === steps.length - 1 ? '1' : String(1 - (i - 1) * 0.18) } })),
      el('div', { class: 'text-[11px] tabular-nums text-left', style: { width: '120px', flexShrink: '0' } }, fmt.int(v) + (i ? ' · ' + pct(v, n) : ''))))));
  // ── Trend: leads and jobs per bucket (by the day the LEAD came in) + closed lead % ──
  const span = _mkmDays(R.from, R.to), unit = span <= 45 ? 'day' : span <= 210 ? 'week' : 'month';
  const keyOf = (iso) => { if (unit === 'day') return iso; if (unit === 'month') return iso.slice(0, 7); const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() - d.getDay()); return _mkmIso(d); };
  const B = new Map();
  { const d = new Date(R.from + 'T12:00'); for (let g = 0; g < 800; g++) { const iso = _mkmIso(d); if (iso > R.to) break; const k = keyOf(iso); if (!B.has(k)) B.set(k, { n: 0, j: 0 }); d.setDate(d.getDate() + 1); } }
  for (const x of L) { const b = B.get(keyOf(x.lead.d)); if (!b) continue; b.n++; if (x.stage === 'job' || x.stage === 'serviced') b.j++; }
  const keys = [...B.keys()];
  const kLbl = (k) => unit === 'month' ? new Date(k + '-01T12:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : new Date(k + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const isDark = state.theme === 'dark', txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  const idT = 'mkmTrend';
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const c = document.getElementById(idT); if (!c) return;
    if (_chartInstances[idT]) { _chartInstances[idT].destroy(); delete _chartInstances[idT]; }
    _chartInstances[idT] = new Chart(c.getContext('2d'), { data: { labels: keys.map(kLbl), datasets: [
        { type: 'bar', label: 'Leads', data: keys.map(k => B.get(k).n), backgroundColor: MKM_C.leads, borderRadius: 2, yAxisID: 'y', order: 2 },
        { type: 'bar', label: 'Jobs', data: keys.map(k => B.get(k).j), backgroundColor: MKM_C.jobs, borderRadius: 2, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Closed lead %', data: keys.map(k => { const b = B.get(k); return b.n ? Math.round(b.j / b.n * 1000) / 10 : null; }), borderColor: MKM_C.rate, backgroundColor: MKM_C.rate, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, yAxisID: 'y2', order: 1, spanGaps: true }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + (c.dataset.yAxisID === 'y2' ? c.parsed.y + '%' : fmt.int(c.parsed.y)) } } },
        scales: { x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 }, maxTicksLimit: 12, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 } } },
          y2: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: txt, font: { size: 10 }, callback: (v) => v + '%' } } } } });
  }, 50);
  const trend = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-sm font-bold' }, 'Leads and jobs by ' + unit + (ch ? ' · ' + ch : '')),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'By the ' + unit + ' the lead came in. Recent ' + unit + 's read low until those leads have had time to close.')),
    n ? el('div', { class: 'p-3', style: { height: '300px' } }, el('canvas', { id: idT })) : el('div', { class: 'p-6 text-xs', style: muted }, 'No new leads in this range' + (ch ? ' for ' + ch : '') + '.'));
  // ── By channel ──
  const byCh = new Map();
  for (const x of ALL) { const k = x.lead.prov || 'Unknown'; let c = byCh.get(k); if (!c) { c = { k, n: 0, sold: 0, jobs: 0, svc: 0, rev: 0, days: [] }; byCh.set(k, c); } c.n++; if (x.converted) { c.sold++; if (x.days != null) c.days.push(x.days); } if (x.stage === 'job' || x.stage === 'serviced') { c.jobs++; c.rev += x.rev; } if (x.stage === 'serviced') c.svc++; }
  for (const p of SP.byProv.keys()) if (!byCh.has(p)) byCh.set(p, { k: p, n: 0, sold: 0, jobs: 0, svc: 0, rev: 0, days: [] });
  const sortKey = state._mkmSort || 'n';
  const rows = [...byCh.values()].map(c => { const s = SP.byProv.get(c.k) || 0; c.spend = s; c.cpl = s && c.n ? s / c.n : null; c.cpj = s && c.jobs ? s / c.jobs : null; c.roas = s ? c.rev / s : null; c.rate = c.n ? c.jobs / c.n : null; c.med = c.days.length ? c.days.sort((a, b) => a - b)[Math.floor(c.days.length / 2)] : null; return c; })
    .sort((a, b) => { const v = (r) => r[sortKey] == null ? -1 : r[sortKey]; return sortKey === 'cpl' || sortKey === 'cpj' ? ((a[sortKey] == null) - (b[sortKey] == null) || v(a) - v(b)) : v(b) - v(a); });
  const th = (t, key, tip) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-left whitespace-nowrap' + (key ? ' cursor-pointer' : ''), title: tip || '', style: { color: sortKey === key ? 'var(--text)' : 'var(--text-muted)', background: 'var(--card-2)' },
    onclick: key ? () => { state._mkmSort = key; mountApp(); } : null }, t + (sortKey === key ? ' ↓' : ''));
  const td = (t, st) => el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap', style: st || {} }, t == null || t === '' ? '—' : t);
  const tot = rows.reduce((a, c) => ({ n: a.n + c.n, sold: a.sold + c.sold, jobs: a.jobs + c.jobs, svc: a.svc + c.svc, rev: a.rev + c.rev, spend: a.spend + c.spend }), { n: 0, sold: 0, jobs: 0, svc: 0, rev: 0, spend: 0 });
  const chTable = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-sm font-bold' }, 'By channel · ' + R.label),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Click a channel to filter the page to it; ⓘ opens its leads and where each stands in GoHighLevel. Spend is each channel’s QuickBooks lines as linked on the Spend tab' + (SP.tools ? ' (' + fmt.usd0(SP.tools) + ' of agency & tools sits in the total only)' : '') + '.' + (SP.unlinked ? ' ' + fmt.usd0(SP.unlinked) + ' of QuickBooks lines aren’t linked to a channel yet — link them on the Spend tab.' : ''))),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Channel'), th('Leads', 'n'), th('Sold', 'sold'), th('Jobs', 'jobs', 'Initial scheduled or completed'), th('Serviced', 'svc'), th('Closed lead %', 'rate'), th('Spend', 'spend'), th('Cost / lead', 'cpl'), th('Cost / job', 'cpj'), th('Revenue', 'rev'), th('ROAS', 'roas'), th('Days to sale', 'med', 'Median days from lead to sale'), th(''))),
      el('tbody', {}, ...rows.map(c => el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95', style: { borderColor: 'var(--border)', background: c.k === ch ? 'rgba(223,100,58,.08)' : '' },
          onclick: (e) => { if (e.target.closest('button')) return; state._mkmChannel = c.k === ch ? '' : c.k; mountApp(); } },
          td(c.k, { fontWeight: '700' }), td(fmt.int(c.n)), td(fmt.int(c.sold)), td(fmt.int(c.jobs)), td(fmt.int(c.svc)), td(c.rate == null ? '—' : (c.rate * 100).toFixed(1) + '%'),
          td(c.spend ? fmt.usd0(c.spend) : '—', c.spend ? {} : { color: 'var(--text-subtle)' }), td(c.cpl == null ? '—' : fmt.usd0(c.cpl)), td(c.cpj == null ? '—' : fmt.usd0(c.cpj)), td(c.rev ? fmt.usd0(c.rev) : '—'),
          td(c.roas == null ? '—' : c.roas.toFixed(2) + 'x', c.roas == null ? {} : { color: c.roas >= 1 ? '#5F6C5B' : '#DC2626', fontWeight: '600' }), td(c.med == null ? '—' : c.med + 'd'),
          el('td', { class: 'px-2 py-1' }, c.n ? el('button', { type: 'button', title: 'Open ' + c.k + '’s leads', class: 'text-[11px] font-semibold', style: { color: 'var(--accent)', background: 'transparent', border: '0', cursor: 'pointer' },
            onclick: () => openMktgProviderDrill(c.k, ALL.filter(x => (x.lead.prov || 'Unknown') === c.k), R.label) }, 'ⓘ') : null))),
        el('tr', { style: { borderTop: '2px solid var(--text)' } }, td('Total', { fontWeight: '700' }), td(fmt.int(tot.n), { fontWeight: '700' }), td(fmt.int(tot.sold), { fontWeight: '700' }), td(fmt.int(tot.jobs), { fontWeight: '700' }), td(fmt.int(tot.svc), { fontWeight: '700' }),
          td(tot.n ? (tot.jobs / tot.n * 100).toFixed(1) + '%' : '—', { fontWeight: '700' }), td(hasSpend ? fmt.usd0(SP.total) : '—', { fontWeight: '700' }), td(hasSpend && tot.n ? fmt.usd0(SP.total / Math.max(1, ALL.filter(x => x.paid).length)) : '—', { fontWeight: '700' }), td(hasSpend && tot.jobs ? fmt.usd0(SP.total / Math.max(1, ALL.filter(x => x.paid && (x.stage === 'job' || x.stage === 'serviced')).length)) : '—', { fontWeight: '700' }), td(tot.rev ? fmt.usd0(tot.rev) : '—', { fontWeight: '700' }),
          td(hasSpend && SP.total ? (tot.rev / SP.total).toFixed(2) + 'x' : '—', { fontWeight: '700' }), td(''), td(''))))));
  // ── By office (the lead's ZIP → the branch that serves it) ──
  const byOff = new Map();
  for (const x of L) { const k = x.lead.office || ''; let c = byOff.get(k); if (!c) { c = { n: 0, jobs: 0, rev: 0 }; byOff.set(k, c); } c.n++; if (x.stage === 'job' || x.stage === 'serviced') { c.jobs++; c.rev += x.rev; } }
  const offRows = [...byOff.entries()].sort((a, b) => b[1].n - a[1].n);
  const offCard = offRows.length ? el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-sm font-bold' }, 'By office' + (ch ? ' · ' + ch : '')),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'The office whose customers share the lead’s ZIP code in FieldRoutes.')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Office'), th('Leads'), th('Jobs'), th('Closed lead %'), th('Revenue'))),
      el('tbody', {}, ...offRows.map(([k, c]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(k ? (typeof _mktgTC === 'function' ? _mktgTC(k) : k) : 'No office (ZIP not in FieldRoutes)', { fontWeight: '600', color: k ? undefined : 'var(--text-muted)' }), td(fmt.int(c.n)), td(fmt.int(c.jobs)), td(pct(c.jobs, c.n)), td(c.rev ? fmt.usd0(c.rev) : '—'))))))) : null;
  // ── Header: channel picker ──
  const st = { borderColor: ch ? 'var(--accent)' : 'var(--border-2)', background: ch ? 'var(--accent)' : 'var(--card)', color: ch ? 'var(--accent-text)' : 'var(--text)' };
  const chSel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: st, title: 'Narrow the whole page to one channel',
    onchange: (e) => { state._mkmChannel = e.target.value; mountApp(); } },
    el('option', { value: '', selected: !ch }, 'All channels'),
    ...[...chCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => el('option', { value: k, selected: k === ch }, k + (v ? ' (' + fmt.int(v) + ')' : ' (spend only)'))));
  const matchNote = crm ? '' : ' FieldRoutes isn’t loaded yet, so nothing shows as converted — run a sync.';
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-end justify-between gap-3 flex-wrap' },
      el('div', {}, el('div', { class: 'text-lg font-bold' }, 'Office Staff lead cohort · ' + R.label + (ch ? ' · ' + ch : '')),
        el('div', { class: 'text-xs', style: muted }, fmt.dateShortYear(R.from) + ' – ' + fmt.dateShortYear(R.to) + ' · new inbound leads from GoHighLevel and what the office did with them: a lead converts when an Office Staff login sells that person (phone or email) in FieldRoutes. Spend from QuickBooks.' + matchNote)),
      chSel),
    tiles, funnel, trend, chTable, offCard);
}
