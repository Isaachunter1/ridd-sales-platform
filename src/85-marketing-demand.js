// ┌─ src/85-marketing-demand.js ───────────────────────────────────────────
// │ Marketing → Demand (per Isaac, Oct 6 2026): the growth read on one page —
// │ leads in, leads converted, what they cost — with a weekly trend and the
// │ conversion rate by provider. Every number is a semantic-layer metric
// │ (src/69-semantic.js): leads from GoHighLevel, sales from FieldRoutes
// │ (matched on phone / email), spend from QuickBooks.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const MKTG_DEMAND_C = { leads: '#2A78C2', conv: '#DF643A' };   // validated pair (colour-blind safe on light and dark)
function _mktgDemandWeek(iso) { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() - d.getDay()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _mktgDemand() {
  const y = _mktgYearSel();
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const G = (typeof ghlLeads === 'function') ? ghlLeads() : null;
  const card = (title, sub, body) => el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-sm font-bold' }, title), sub ? el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, sub) : null), body);
  if (!G) return el('div', { class: 'card p-6 text-sm', style: { color: 'var(--text-muted)' } }, state._ghl === null ? 'Loading GoHighLevel leads…' : 'No GoHighLevel leads yet — the hourly sync fills this in (Settings → Configurations → GoHighLevel sources).');
  const paid = ghlPaidSet();
  const crm = (state.reportingSubscriptions || []).length ? _attrCrmIndex() : null;
  // Memo: the match walks every lead, so keep it per (leads, book, year).
  const M = _mktgDemand._m;
  let L;
  if (M && M.g === G && M.subs === state.reportingSubscriptions && M.y === y) L = M.L;
  else {
    L = semLeadConversions(G.leads.filter(l => l.y === String(y)), crm);
    for (const x of L) { x.paid = paid.has(x.lead.prov); x.week = x.ms == null ? null : _mktgDemandWeek(x.lead.d); }
    _mktgDemand._m = { g: G, subs: state.reportingSubscriptions, y, L };
  }
  // Spend: QuickBooks, every marketing account, months of the picked year.
  const SP = state.reportingIsSpend; let spend = 0, spendMonths = 0;
  if (SP) for (let i = 0; i < 12; i++) { const mm = SP[_mktgYm(y, i)]; if (!mm) continue; let t = 0; for (const k in mm) t += Number(mm[k]) || 0; if (t) { spend += t; spendMonths++; } }
  const hasSpend = spend > 0;
  const conv = semMetric('lead_conversion_rate')(L);
  const cpl = hasSpend ? semMetric('cost_per_lead')(spend, L) : null, cps = hasSpend ? semMetric('cost_per_sale')(spend, L) : null, waste = hasSpend ? semMetric('wasted_spend')(spend, L) : null;
  const pct1 = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const usdK = (v) => v == null ? '—' : v >= 100000 ? '$' + (v / 1000).toFixed(1) + 'K' : v >= 10000 ? '$' + (v / 1000).toFixed(1) + 'K' : fmt.usd0(v);
  const tile = (value, label, note) => el('div', { class: 'card p-4', title: note || '' },
    el('div', { class: 'text-2xl font-black tabular-nums' }, value),
    el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, label),
    note ? el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-subtle)' } }, note) : null);
  const noSpend = 'no QuickBooks spend for ' + y;
  const tiles = el('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    tile(fmt.int(conv.d), 'Leads', fmt.int(L.filter(x => x.paid).length) + ' from paid providers'),
    tile(fmt.int(conv.n), 'Converted leads', 'sold within ' + SEM_LEAD_WINDOW_DAYS + ' days'),
    tile(pct1(conv.value), 'Conversion rate'),
    tile(hasSpend ? usdK(spend) : '—', 'Marketing spend', hasSpend ? 'QuickBooks · ' + spendMonths + ' month' + (spendMonths === 1 ? '' : 's') : noSpend),
    tile(cpl ? fmt.usd0(cpl.value) : '—', 'Cost per lead', cpl ? 'spend ÷ ' + fmt.int(cpl.d) + ' paid leads' : noSpend),
    tile(cps ? fmt.usd0(cps.value) : '—', 'Cost per sale', cps ? 'spend ÷ ' + fmt.int(cps.d) + ' converted paid leads' : noSpend),
    tile(waste ? usdK(waste.value) : '—', 'Wasted spend', waste ? fmt.int(waste.n) + ' paid leads did not convert' : noSpend));
  // Weekly series (weeks start Sunday), by the week the LEAD came in.
  const wk = new Map();
  for (const x of L) { if (!x.week) continue; let w = wk.get(x.week); if (!w) { w = { n: 0, c: 0 }; wk.set(x.week, w); } w.n++; if (x.converted) w.c++; }
  const weeks = [...wk.keys()].sort();
  const wkLabel = (iso) => { const d = new Date(iso + 'T00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  // By provider: every provider with enough leads to read a rate from.
  const MIN = 20; const byP = new Map();
  for (const x of L) { const k = x.lead.prov || 'Unknown'; let p = byP.get(k); if (!p) { p = { n: 0, c: 0 }; byP.set(k, p); } p.n++; if (x.converted) p.c++; }
  const provs = [...byP.entries()].filter(([, p]) => p.n >= MIN).map(([k, p]) => ({ k, n: p.n, c: p.c, r: p.c / p.n })).sort((a, b) => b.r - a.r);
  const idA = 'mktDemandA', idB = 'mktDemandB', idC = 'mktDemandC';
  const isDark = state.theme === 'dark';
  const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const mk = (id, cfg) => { const c = document.getElementById(id); if (!c) return; if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; } _chartInstances[id] = new Chart(c.getContext('2d'), cfg); };
    const xAxis = { grid: { display: false }, ticks: { color: txt, font: { size: 10 }, maxTicksLimit: 9, maxRotation: 0 } };
    const line = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 5 });
    mk(idA, { type: 'line', data: { labels: weeks.map(wkLabel), datasets: [line('Leads', weeks.map(w => wk.get(w).n), MKTG_DEMAND_C.leads), line('Converted leads', weeks.map(w => wk.get(w).c), MKTG_DEMAND_C.conv)] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 }, usePointStyle: true } }, tooltip: { callbacks: { title: (c) => 'Week of ' + c[0].label, label: (c) => ' ' + c.dataset.label + ': ' + fmt.int(c.parsed.y) } } },
        scales: { x: xAxis, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, precision: 0 } } } } });
    mk(idB, { type: 'line', data: { labels: weeks.map(wkLabel), datasets: [line('Conversion rate', weeks.map(w => { const x = wk.get(w); return x.n ? Math.round(x.c / x.n * 1000) / 10 : null; }), MKTG_DEMAND_C.leads)] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => 'Week of ' + c[0].label, label: (c) => { const x = wk.get(weeks[c.dataIndex]); return ' ' + c.parsed.y + '% · ' + fmt.int(x.c) + ' of ' + fmt.int(x.n) + ' leads'; } } } },
        scales: { x: xAxis, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => v + '%' } } } } });
    const endLabels = { id: 'endLabels', afterDatasetsDraw(chart) { const ctx = chart.ctx; ctx.save(); ctx.fillStyle = txt; ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText((provs[i].r * 100).toFixed(1) + '%', bar.x + 6, bar.y)); ctx.restore(); } };
    mk(idC, { type: 'bar', data: { labels: provs.map(p => p.k), datasets: [{ label: 'Conversion rate', data: provs.map(p => Math.round(p.r * 1000) / 10), backgroundColor: MKTG_DEMAND_C.leads, borderWidth: 0, borderRadius: 3, barThickness: 16 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 44 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const p = provs[c.dataIndex]; return ' ' + (p.r * 100).toFixed(1) + '% · ' + fmt.int(p.c) + ' of ' + fmt.int(p.n) + ' leads'; } } } },
        scales: { x: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => v + '%' } }, y: { grid: { display: false }, ticks: { color: txt, font: { size: 11 } } } } },
      plugins: [endLabels] });
  }, 50);
  const canvas = (id, h) => el('div', { class: 'p-3', style: { height: h + 'px' } }, el('canvas', { id }));
  const matchNote = crm ? '' : ' Sales are not loaded yet, so nothing shows as converted — run a sync.';
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', {}, el('div', { class: 'text-lg font-bold' }, 'Growth & marketing · ' + y),
      el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, 'Company-wide. Leads from GoHighLevel, sales matched in FieldRoutes on phone or email, spend from QuickBooks.' + matchNote)),
    tiles,
    el('div', { style: { display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' } },
      card('Weekly lead demand', 'Leads that came in each week, and how many of them have converted so far.', weeks.length ? canvas(idA, 300) : el('div', { class: 'p-6 text-xs', style: { color: 'var(--text-muted)' } }, 'No leads in ' + y + '.')),
      card('Weekly conversion rate', 'By the week the lead came in. The latest weeks read low until those leads have had time to close.', weeks.length ? canvas(idB, 300) : el('div', { class: 'p-6 text-xs', style: { color: 'var(--text-muted)' } }, 'No leads in ' + y + '.'))),
    card('Conversion rate by provider', 'Providers with at least ' + MIN + ' leads in ' + y + ', best first.', provs.length ? canvas(idC, Math.max(160, provs.length * 30 + 50)) : el('div', { class: 'p-6 text-xs', style: { color: 'var(--text-muted)' } }, 'No provider has ' + MIN + ' leads yet.')),
    el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, ...['Provider', 'Leads', 'Converted', 'Conversion rate'].map((t, i) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold ' + (i ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t)))),
      el('tbody', {}, ...[...byP.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, p]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-3 py-2 font-semibold' }, k + (paid.has(k) ? '' : ' · not paid')), el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.int(p.n)), el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.int(p.c)), el('td', { class: 'px-3 py-2 text-right tabular-nums font-bold' }, pct1(p.n ? p.c / p.n : null)))))))));
}
