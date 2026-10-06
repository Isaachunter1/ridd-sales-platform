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
  // The weekly chart can be narrowed to one provider (per Isaac, Oct 6).
  const _provCount = new Map(); for (const x of L) { const k = x.lead.prov || 'Unknown'; _provCount.set(k, (_provCount.get(k) || 0) + 1); }
  const wkProv = _provCount.has(state._mktDemandProv) ? state._mktDemandProv : '';
  const wk = new Map();
  for (const x of L) { if (!x.week) continue; if (wkProv && (x.lead.prov || 'Unknown') !== wkProv) continue; let w = wk.get(x.week); if (!w) { w = { n: 0, c: 0 }; wk.set(x.week, w); } w.n++; if (x.converted) w.c++; }
  const weeks = [...wk.keys()].sort();
  const wkLabel = (iso) => { const d = new Date(iso + 'T00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  // By provider: every provider with enough leads to read a rate from.
  const MIN = 20; const byP = new Map();
  for (const x of L) { const k = x.lead.prov || 'Unknown'; let p = byP.get(k); if (!p) { p = { n: 0, c: 0 }; byP.set(k, p); } p.n++; if (x.converted) p.c++; }
  const provs = [...byP.entries()].filter(([, p]) => p.n >= MIN).map(([k, p]) => ({ k, n: p.n, c: p.c, r: p.c / p.n })).sort((a, b) => b.r - a.r);
  const QP = qboSpendByProvider(y);   // QuickBooks charges by payee → provider (null until the refresh has run)
  const idA = 'mktDemandA', idB = 'mktDemandB', idC = 'mktDemandC';
  const isDark = state.theme === 'dark';
  const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const mk = (id, cfg) => { const c = document.getElementById(id); if (!c) return; if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; } _chartInstances[id] = new Chart(c.getContext('2d'), cfg); };
    const xAxis = { grid: { display: false }, ticks: { color: txt, font: { size: 10 }, maxTicksLimit: 9, maxRotation: 0 } };
    const line = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 5 });
    mk(idB, { type: 'line', data: { labels: weeks.map(wkLabel), datasets: [line('Conversion rate', weeks.map(w => { const x = wk.get(w); return x.n ? Math.round(x.c / x.n * 1000) / 10 : null; }), MKTG_DEMAND_C.leads)] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => 'Week of ' + c[0].label, label: (c) => { const x = wk.get(weeks[c.dataIndex]); return ' ' + c.parsed.y + '% · ' + fmt.int(x.c) + ' of ' + fmt.int(x.n) + ' leads'; } } } },
        scales: { x: xAxis, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => v + '%' } } } } });
    const endLabels = { id: 'endLabels', afterDatasetsDraw(chart) { const ctx = chart.ctx; ctx.save(); ctx.fillStyle = txt; ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText((provs[i].r * 100).toFixed(1) + '%', bar.x + 6, bar.y)); ctx.restore(); } };
    mk(idC, { type: 'bar', data: { labels: provs.map(p => p.k), datasets: [{ label: 'Conversion rate', data: provs.map(p => Math.round(p.r * 1000) / 10), backgroundColor: MKTG_DEMAND_C.leads, borderWidth: 0, borderRadius: 3, barThickness: 16 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 44 } },
        onClick: (evt, els) => { if (!els || !els.length) return; const pk = provs[els[0].index].k; openMktgProviderDrill(pk, L.filter(x => (x.lead.prov || 'Unknown') === pk), y); },
        onHover: (evt, els) => { const t = evt.native && evt.native.target; if (t) t.style.cursor = els && els.length ? 'pointer' : 'default'; },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => { const p = provs[c.dataIndex]; const sp = QP ? (QP.byProv.get(p.k) || 0) : 0; const L1 = ' ' + (p.r * 100).toFixed(1) + '% · ' + fmt.int(p.c) + ' of ' + fmt.int(p.n) + ' leads'; return sp ? [L1, ' ' + fmt.usd0(sp) + ' spend · ' + fmt.usd0(sp / p.n) + ' per lead' + (p.c ? ' · ' + fmt.usd0(sp / p.c) + ' per sale' : '')] : L1; } } } },
        scales: { x: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => v + '%' } }, y: { grid: { display: false }, ticks: { color: txt, font: { size: 11 } } } } },
      plugins: [endLabels] });
  }, 50);
  // Lead flow check (per Isaac, Oct 6): GoHighLevel is the source of truth for leads. The ad platforms' own lead counts
  // are a second opinion: if a platform reports many more leads than GoHighLevel holds, leads are not flowing in.
  if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(y);
  const _B = _mktgBranchList(y);
  const AP = (typeof adPlatformIndex === 'function') ? adPlatformIndex(y, _B.all) : null;
  const flowCard = (() => {
    if (!AP) return null;
    const rowsF = [...AP.has].map(pv => { let plat = 0; for (let i = 0; i < 12; i++) plat += AP.cell([pv], null, i, 'leads') || 0; const g = (byP.get(pv) || { n: 0 }).n; return { pv, plat, g }; }).filter(r => r.plat > 0 || r.g > 0).sort((a, b) => b.plat - a.plat);
    if (!rowsF.length) return null;
    const th = (t, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
    return card('Lead flow check · ' + y, 'GoHighLevel is where every lead should land. This compares it with what each ad platform says it delivered. A platform reporting far more than GoHighLevel holds means leads are being lost on the way in.',
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Provider'), th('Platform says', true), th('In GoHighLevel', true), th('Difference', true), th('Captured', true))),
        el('tbody', {}, ...rowsF.map(r => { const cap = r.plat > 0 ? r.g / r.plat : null; const low = cap != null && cap < 0.8;
          return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-3 py-2 font-semibold' }, r.pv), el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.int(r.plat)), el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.int(r.g)),
            el('td', { class: 'px-3 py-2 text-right tabular-nums' }, (r.g - r.plat > 0 ? '+' : r.g - r.plat < 0 ? '−' : '') + fmt.int(Math.abs(r.g - r.plat))),
            el('td', { class: 'px-3 py-2 text-right tabular-nums font-bold', style: low ? { color: '#DC2626' } : {} }, cap == null ? '—' : (cap * 100).toFixed(0) + '%' + (low ? ' ⚠' : ''))); })))));
  })();
  const canvas = (id, h) => el('div', { class: 'p-3', style: { height: h + 'px' } }, el('canvas', { id }));
  const matchNote = crm ? '' : ' Sales are not loaded yet, so nothing shows as converted — run a sync.';
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', {}, el('div', { class: 'text-lg font-bold' }, 'Growth & marketing · ' + y),
      el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, 'Company-wide. Leads from GoHighLevel, sales matched in FieldRoutes on phone or email, spend from QuickBooks.' + matchNote)),
    tiles,
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Weekly conversion rate' + (wkProv ? ' · ' + wkProv : '')),
          el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, 'By the week the lead came in. The latest weeks read low until those leads have had time to close. Hover a week for the counts.')),
        el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, title: 'Show the weekly rate for one provider',
          onchange: (e) => { state._mktDemandProv = e.target.value; mountApp(); } },
          el('option', { value: '', selected: !wkProv }, 'All providers'),
          ...[..._provCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => el('option', { value: k, selected: wkProv === k }, k + ' (' + fmt.int(n) + ')')))),
      weeks.length ? canvas(idB, 320) : el('div', { class: 'p-6 text-xs', style: { color: 'var(--text-muted)' } }, 'No leads in ' + y + (wkProv ? ' for ' + wkProv : '') + '.')),
    card('Conversion rate by provider', 'Providers with at least ' + MIN + ' leads in ' + y + ', best first. Click a bar for its leads and where each one stands in GoHighLevel.', provs.length ? canvas(idC, Math.max(160, provs.length * 30 + 50)) : el('div', { class: 'p-6 text-xs', style: { color: 'var(--text-muted)' } }, 'No provider has ' + MIN + ' leads yet.')),
    // Revenue by provider (rank + monthly trend) — moved here from Metrics (per Isaac, Oct 6). FieldRoutes revenue by the provider that earned the sale.
    (() => { try { return _mktgProviders(true); } catch (e) { console.warn('[demand] revenue by provider skipped', e); return null; } })(),
    // (Provider list table removed per Isaac, Oct 6: the bars carry it; hover a bar for leads, converted, spend and cost.)
    flowCard,
    null);   // (QuickBooks spend-by-provider mapping card removed from the page per Isaac, Oct 6; names still map to providers automatically)
}

// ── QuickBooks spend by provider (per Isaac, Oct 6) ──────────────────────
// QuickBooks books every marketing charge under a Name (Google, Facebook,
// PESTNET.COM …). Each Name maps to a lead provider: the same auto rules the
// GoHighLevel labels use, or an admin's pick (adminRules.qboPayeeMap). The
// branch split still comes from the controller's allocation after close.
const QBO_PAYEE_SKIP = '__skip';
function qboPayeeMap() { const R = (typeof _adminRules === 'function') ? _adminRules() : null; return (R && R.qboPayeeMap) || {}; }
function setQboPayee(payee, val) { const m = Object.assign({}, qboPayeeMap()); const k = String(payee).trim().toLowerCase(); if (val == null || val === '') delete m[k]; else m[k] = val; _setAdminRule('qboPayeeMap', m); }
// → provider name, QBO_PAYEE_SKIP (not marketing spend on leads), or '' (not mapped yet).
function qboPayeeProvider(payee) {
  const k = String(payee || '').trim().toLowerCase(); if (!k) return '';
  const o = qboPayeeMap()[k]; if (o) return o;
  const a = (typeof ghlAutoProvider === 'function') ? ghlAutoProvider(k.replace(/\.com\b/, '')) : '';
  return (a && a !== GHL_NOT_LEAD && a !== 'Organic' && a !== 'Referral') ? a : '';
}
// One year of QuickBooks spend rolled up: by provider, what is unmapped, and every payee with its total.
function qboSpendByProvider(year) {
  const P = state.reportingIsSpendPayee; if (!P || !P.months) return null;
  const byProv = new Map(), payees = new Map(); let unmapped = 0, skipped = 0, total = 0, journal = 0;
  for (let i = 0; i < 12; i++) {
    const ym = _mktgYm(year, i); journal += Number((P.journal || {})[ym]) || 0;
    const M = P.months[ym]; if (!M) continue;
    for (const name in M) { const amt = Number(M[name]) || 0; if (!amt) continue; payees.set(name, (payees.get(name) || 0) + amt);
      const pv = qboPayeeProvider(name);
      if (pv === QBO_PAYEE_SKIP) { skipped += amt; continue; }
      total += amt;
      if (!pv) unmapped += amt; else byProv.set(pv, (byProv.get(pv) || 0) + amt); }
  }
  return { byProv, payees, unmapped, skipped, total, journal, memo: P.memo || {}, pulledAt: P.pulledAt };
}
// The mapping card: every QuickBooks payee this year, biggest first, with the provider it counts toward.
function _mktgPayeeCard(year, providers) {
  const Q = qboSpendByProvider(year);
  const head = (t, s) => el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-sm font-bold' }, t), el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, s));
  if (!Q) return el('div', { class: 'card overflow-hidden' }, head('QuickBooks spend by provider', 'Arrives with the next QuickBooks refresh (it runs nightly, and whenever the cached copy is more than a few hours old). Until then cost per lead is company-wide only.'));
  const canEdit = isAdminRole(state.profile && state.profile.role);
  const opts = [...new Set([...providers, ...(typeof MKTG_DEFAULT_CHANNELS !== 'undefined' ? MKTG_DEFAULT_CHANNELS : []), ...Q.byProv.keys()])].filter(Boolean).sort();
  const rows = [...Q.payees.entries()].sort((a, b) => b[1] - a[1]);
  const th = (t, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  return el('div', { class: 'card overflow-hidden' },
    head('QuickBooks spend by provider · ' + year, fmt.usd0(Q.total) + ' in marketing charges, ' + (Q.unmapped > 0 ? fmt.usd0(Q.unmapped) + ' not mapped to a provider yet' : 'all mapped') + '. Each QuickBooks name counts toward the provider picked here; journal entries (the branch allocation at close) are left out so nothing is counted twice.'),
    el('div', { style: { overflow: 'auto', maxHeight: '420px' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', { style: { position: 'sticky', top: 0 } }, el('tr', {}, th('QuickBooks name'), th('Example description'), th('Spend', true), th('Counts toward'))),
      el('tbody', {}, ...rows.map(([name, amt]) => { const pv = qboPayeeProvider(name), manual = !!qboPayeeMap()[String(name).trim().toLowerCase()];
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, name),
          el('td', { class: 'px-3 py-2', style: { color: 'var(--text-muted)' } }, Q.memo[name] || ''),
          el('td', { class: 'px-3 py-2 text-right tabular-nums' }, fmt.usd0(amt)),
          el('td', { class: 'px-3 py-2' }, canEdit
            ? el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: pv ? 'var(--border-2)' : '#DC2626', background: 'var(--card)', color: 'var(--text)' }, title: manual ? 'Picked by an admin' : (pv ? 'Matched automatically by name' : 'Not mapped yet'),
                onchange: (e) => { setQboPayee(name, e.target.value); _mktgDemand._m = null; mountApp(); } },
                el('option', { value: '', selected: !pv }, manual ? '↺ Back to automatic' : 'Not mapped'),
                ...opts.map(o => el('option', { value: o, selected: pv === o }, o)),
                el('option', { value: QBO_PAYEE_SKIP, selected: pv === QBO_PAYEE_SKIP }, 'Not lead spend (leave out)'))
            : el('span', {}, pv === QBO_PAYEE_SKIP ? 'Left out' : (pv || 'Not mapped')))); })))));
}

// ── Provider drilldown (per Isaac, Oct 6): every GoHighLevel lead credited to one provider, with where it stands —
// its GoHighLevel opportunity status and pipeline stage, and whether the same person became a sale in FieldRoutes.
// GoHighLevel opportunities by person (phone / email), built once per loaded file.
function _mktgOppIndex() {
  const G = state._ghl; if (!G || !G.opps) return null;
  if (_mktgOppIndex._m && _mktgOppIndex._m.src === G.opps) return _mktgOppIndex._m;
  const byPhone = new Map(), byEmail = new Map(); const stages = G.stages || [];
  for (const o of G.opps) { const rec = { d: o[0], status: String(o[5] || '').toLowerCase(), stage: (o[6] != null && o[6] >= 0 && stages[o[6]]) || '' };
    if (o[2]) { if (!byPhone.has(o[2])) byPhone.set(o[2], []); byPhone.get(o[2]).push(rec); }
    if (o[3]) { if (!byEmail.has(o[3])) byEmail.set(o[3], []); byEmail.get(o[3]).push(rec); } }
  return (_mktgOppIndex._m = { src: G.opps, byPhone, byEmail, hasStages: stages.length > 0 });
}
// The opportunity that belongs to a lead: the first one opened on or after the lead came in, else the person's latest.
function _mktgOppFor(lead, IX) {
  if (!IX) return null;
  const L = (lead.p && IX.byPhone.get(lead.p)) || (lead.e && IX.byEmail.get(lead.e)); if (!L || !L.length) return null;
  let after = null, last = null;
  for (const o of L) { if (!last || o.d > last.d) last = o; if (o.d >= lead.d && (!after || o.d < after.d)) after = o; }
  return after || last;
}
function openMktgProviderDrill(provider, list, year) {
  const IX = _mktgOppIndex();
  const STATUS = { open: 'Open', won: 'Won', lost: 'Lost', abandoned: 'Abandoned' };
  const rows = list.map(x => { const o = _mktgOppFor(x.lead, IX); const s = x.sale;
    return { d: x.lead.d, phone: x.lead.p || '', email: x.lead.e || '', own: x.lead.own || '', how: x.lead.how || '', office: x.lead.office || '',
      status: o ? (STATUS[o.status] || (o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : 'Open')) : 'No opportunity', stage: o ? o.stage : '',
      converted: !!x.converted, cust: s ? [String(s.first_name || '').trim(), String(s.last_name || '').trim()].filter(Boolean).join(' ') : '', svc: s ? String(s.subscription || '') : '', sold: s ? String(s.sold_date || '').slice(0, 10) : '', subStatus: s ? String(s.subscription_status || '') : '' }; })
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  let filt = null;   // { k: 'status' | 'stage' | 'conv', v }
  const tally = (key) => { const m = new Map(); for (const r of rows) { const k = r[key] || '—'; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  const conv = rows.filter(r => r.converted).length;
  const body = el('div', {});
  const SHOW = 400;
  const paint = () => {
    const shown = rows.filter(r => !filt || (filt.k === 'conv' ? r.converted === filt.v : (r[filt.k] || '—') === filt.v));
    const chip = (label, n, f) => { const on = filt && f && filt.k === f.k && filt.v === f.v;
      return el('button', { class: 'rounded-xl px-3 py-2 text-left transition hover:brightness-95', style: { background: on ? 'var(--accent)' : 'var(--card-2)', color: on ? 'var(--accent-text)' : 'var(--text)', minWidth: '104px', border: '1px solid var(--border)' }, title: f ? 'Click to show only these leads' : '', onclick: () => { filt = on || !f ? null : f; paint(); } },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { opacity: '.75' } }, label), el('div', { class: 'text-lg font-black tabular-nums leading-tight' }, fmt.int(n)),
        el('div', { class: 'text-[10px] tabular-nums', style: { opacity: '.75' } }, rows.length ? (n / rows.length * 100).toFixed(1) + '%' : '')); };
    const lab = (t) => el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold mt-3 mb-1', style: { color: 'var(--text-subtle)' } }, t);
    const th = (t) => el('th', { class: 'px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
    const td = (t, o = {}) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap' + (o.bold ? ' font-semibold' : ''), style: { color: o.color } }, t);
    const stCol = (s) => s === 'Won' ? '#15803D' : s === 'Lost' || s === 'Abandoned' ? '#B91C1C' : s === 'No opportunity' ? 'var(--text-subtle)' : undefined;
    body.replaceChildren(...[
      el('div', { class: 'px-6 pb-4' },
        lab('Outcome in FieldRoutes (this is what the conversion rate counts)'),
        el('div', { class: 'flex gap-2 flex-wrap' }, chip('All leads', rows.length, null), chip('Became a sale', conv, { k: 'conv', v: true }), chip('No sale yet', rows.length - conv, { k: 'conv', v: false })),
        lab('Status in GoHighLevel'),
        el('div', { class: 'flex gap-2 flex-wrap' }, ...tally('status').map(([k, n]) => chip(k, n, { k: 'status', v: k }))),
        IX && IX.hasStages ? lab('Pipeline stage in GoHighLevel') : null,
        IX && IX.hasStages ? el('div', { class: 'flex gap-2 flex-wrap' }, ...tally('stage').slice(0, 12).map(([k, n]) => chip(k === '—' ? 'No stage' : k, n, { k: 'stage', v: k }))) : el('div', { class: 'text-[11px] mt-2', style: { color: 'var(--text-muted)' } }, 'Pipeline stages arrive with the next GoHighLevel sync after this update is deployed.')),
      el('div', { class: 'overflow-auto', style: { borderTop: '1px solid var(--border)', maxHeight: '46vh' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, ...['Lead date', 'Phone', 'Email', 'GoHighLevel source', 'Credited by', 'GHL status', 'GHL stage', 'FieldRoutes sale', 'Sold', 'Service', 'Account'].map(th))),
        el('tbody', {}, ...shown.slice(0, SHOW).map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(r.d), td(r.phone ? r.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : ''), td(r.email), td(r.own), td(r.how), td(r.status, { bold: true, color: stCol(r.status) }), td(r.stage),
          td(r.converted ? (r.cust || 'Yes') : 'No', { bold: r.converted, color: r.converted ? '#15803D' : 'var(--text-subtle)' }), td(r.sold), td(r.svc), td(r.subStatus)))))),
      shown.length > SHOW ? el('div', { class: 'px-6 py-2 text-[11px]', style: { color: 'var(--text-muted)' } }, 'Showing the newest ' + SHOW + ' of ' + fmt.int(shown.length) + '. Export for all of them.') : null].filter(Boolean));
  };
  const exportCsv = () => { const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Lead date', 'Phone', 'Email', 'GoHighLevel source', 'Credited by', 'GHL status', 'GHL stage', 'Became a sale', 'Customer', 'Sold', 'Service', 'Account status'].join(',')];
    for (const r of rows) lines.push([r.d, r.phone, r.email, r.own, r.how, r.status, r.stage, r.converted ? 'Yes' : 'No', r.cust, r.sold, r.svc, r.subStatus].map(esc).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); const a = el('a', { href: url, download: ('ridd-leads-' + provider + '-' + year).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  paint();
  overlay.append(el('div', { class: 'card w-full my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)', overflowY: 'auto' } },
    el('div', { class: 'flex items-start justify-between p-6 pb-2' },
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Leads in GoHighLevel · ' + year),
        el('h2', { class: 'text-xl font-bold mt-0.5' }, provider),
        el('div', { class: 'text-xs mt-1', style: { color: 'var(--text-muted)' } }, fmt.int(rows.length) + ' leads credited to this provider · ' + fmt.int(conv) + ' became a sale (' + (rows.length ? (conv / rows.length * 100).toFixed(1) : '0') + '%). Click a tile to filter.')),
      el('div', { class: 'flex items-center gap-2 shrink-0' },
        el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border cursor-pointer', style: { background: 'var(--card-2)', color: 'var(--text)', borderColor: 'var(--border)' }, onclick: exportCsv }, '↓ Export CSV'),
        el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, 'aria-label': 'Close', onclick: close }, '×'))),
    body));
  document.body.append(overlay);
  if (typeof trackAction === 'function') trackAction('drill', 'Marketing demand · provider', { rows: rows.length });
}

// ── Marketing task: lead flow gaps (per Isaac, Oct 6) ────────────────────
// One line at the top of every Marketing sub-tab: any ad platform whose own lead count is well above what GoHighLevel
// holds for it this year (GoHighLevel captured under 80%). Click to open Demand, where the Lead flow check has the numbers.
const MKTG_FLOW_MIN = 0.8;
function mktgLeadFlowTask() {
  const y = _mktgYearSel();
  if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(y);
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const G = (typeof ghlLeads === 'function') ? ghlLeads() : null;
  const AP = (typeof adPlatformIndex === 'function') ? adPlatformIndex(y, _mktgBranchList(y).all) : null;
  if (!G || !AP) return null;
  const ghlN = new Map(); for (const l of G.leads) if (l.y === String(y)) ghlN.set(l.prov, (ghlN.get(l.prov) || 0) + 1);
  const gaps = [...AP.has].map(pv => { let plat = 0; for (let i = 0; i < 12; i++) plat += AP.cell([pv], null, i, 'leads') || 0; const g = ghlN.get(pv) || 0; return { pv, plat, g, cap: plat > 0 ? g / plat : null }; })
    .filter(r => r.plat >= 20 && r.cap != null && r.cap < MKTG_FLOW_MIN).sort((a, b) => a.cap - b.cap);
  const n = gaps.length;
  return el('div', { class: 'card overflow-hidden' },
    el('button', { class: 'w-full flex items-center gap-2 px-4 py-2.5 text-left', title: 'Jump to the Lead flow check on Metrics', onclick: () => { state._mktSub = 'providers'; state._mktProvView = 'cac'; mountApp(); setTimeout(() => { const h = [...document.querySelectorAll('.text-sm.font-bold')].find(x => /^Lead flow check/.test(x.textContent)); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300); } },
      el('span', { class: 'inline-block rounded-full shrink-0', style: { width: '8px', height: '8px', background: n ? '#DC2626' : 'var(--ok)' } }),
      el('span', { class: 'text-[11px] uppercase tracking-widest font-bold shrink-0' }, 'To do · Lead flow gaps'),
      el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, n
        ? gaps.map(r => r.pv + ': GoHighLevel has ' + fmt.int(r.g) + ' of the ' + fmt.int(r.plat) + ' leads the platform reports (' + (r.cap * 100).toFixed(0) + '%)').join(' · ') + '. Check the form or integration that sends these leads in.'
        : 'All clear — GoHighLevel holds at least ' + (MKTG_FLOW_MIN * 100).toFixed(0) + '% of the leads each ad platform reports for ' + y + '.'),
      n ? el('span', { class: 'ml-auto text-sm font-black tabular-nums', style: { color: '#DC2626' } }, String(n)) : null,
      el('span', { class: n ? 'text-[11px]' : 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, '\u2192')));
}
