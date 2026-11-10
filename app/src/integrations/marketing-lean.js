// ┌─ src/integrations/marketing-lean.js ───────────────────────────────────
// │ Marketing → Metrics, cut down to what decides budget (per Isaac, Nov 9 —
// │ "QuickBooks and FieldRoutes new revenue are the most true numbers… GHL is
// │ also a good one… information overload"). One closed month at a time:
// │   Spend        = QuickBooks Advertising & Marketing, allocated on the Spend
// │                  tab (spqAllocMonth) — the same dollars the controller books.
// │   New revenue  = FieldRoutes Office Staff new sales (initial booked or
// │                  done, renewals out): count + contract value.
// │   Leads        = GoHighLevel opportunities, deduped (mkpAllLeads).
// │ Derived: cost per lead, CAC (spend ÷ new sales), return (new revenue ÷
// │ spend), close rate (new sales ÷ leads). Two tables — by branch, by channel —
// │ and one chart (spend vs new revenue by month). Nothing is estimated: a
// │ vendor still waiting on its report shows its dollars at the channel level
// │ and sits out of the branch split until the report is uploaded.
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
const _mklYm = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const _mklShift = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return _mklYm(d); };
const _mklLbl = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const _mklLblS = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
// Default month = the last CLOSED month (per Isaac, Nov 9: QuickBooks is only complete once the month closes).
function mklState() {
  const F = state._mkl || (state._mkl = {});
  const now = new Date(), lastClosed = _mklYm(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  if (!/^\d{4}-\d{2}$/.test(F.ym || '')) F.ym = lastClosed;
  return F;
}
const _mklUsd = (v) => v == null || !isFinite(v) ? '—' : fmt.usd0(v);
const _mklPct = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
const _mklX = (v) => v == null || !isFinite(v) ? '—' : v.toFixed(2) + 'x';
const _mklNum = (v) => v == null ? '—' : fmt.int(v);
const _mklAgo = (iso) => { if (!iso) return ''; const h = (Date.now() - Date.parse(iso)) / 3600000; return !isFinite(h) ? '' : h < 1 ? Math.max(1, Math.round(h * 60)) + 'm ago' : h < 48 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
// FieldRoutes source → the channel name the Spend tab and GoHighLevel use (same rules as GHL labels).
function _mklChannelOfSource(src) {
  if (typeof frChannelOf === 'function') return frChannelOf(src);   // Configurations → FieldRoutes sources → channel
  const s = String(src || '').trim(); if (!s) return 'Unspecified';
  const p = typeof ghlAutoProvider === 'function' ? ghlAutoProvider(s) : '';
  if (p === GHL_NOT_LEAD) return s;   // e.g. Door to Door on an office sale — shown as is, so the mis-source is visible
  return p || s;
}
// One month's truth, by branch and by channel. Memoized per month + data identity.
function mklMonth(ym) {
  const subs = state.reportingSubscriptions || [];
  const AL = typeof mkpAllLeads === 'function' ? mkpAllLeads() : null;
  const A = typeof spqAllocMonth === 'function' ? spqAllocMonth(ym) : null;
  const sig = [ym, subs.length, AL ? AL.leads.length : -1, A ? A.total + '|' + Object.keys(A.waiting || {}).length + '|' + JSON.stringify(Object.keys(A.byProv)) : 'noA', typeof frSourceMap === 'function' ? JSON.stringify(frSourceMap()) : ''].join('§');
  const M = state._mklMemo || (state._mklMemo = {});
  if (M[ym] && M[ym].sig === sig && M[ym].subs === subs && M[ym].al === AL) return M[ym].v;
  const br = {}, ch = {};
  const cell = (o, k) => o[k] || (o[k] = { spend: 0, leads: 0, s: 0, cv: 0, waiting: 0 });
  const TC = (b) => typeof _mktgTC === 'function' ? _mktgTC(b) : String(b || '');
  // Spend (QuickBooks, allocated).
  let spend = null, spendWaiting = 0, spendUnassigned = 0, spendLines = 0;
  if (A) {
    spend = A.total; spendUnassigned = A.unassigned || 0; spendLines = A.lines.filter(L => L.prov !== SPQ_SKIP).length;
    for (const p in A.cells) for (const b in A.cells[p]) { cell(br, TC(b)).spend += A.cells[p][b]; }
    for (const p in A.byProv) cell(ch, typeof spqLabel === 'function' ? spqLabel(p) : p).spend += A.byProv[p].amt;
    for (const p in (A.waiting || {})) { const c = cell(ch, p); c.spend += A.waiting[p].amt; c.waiting += A.waiting[p].amt; spendWaiting += A.waiting[p].amt; }
  }
  // New revenue (FieldRoutes): Office Staff, initial booked or done, renewals out, sold this month.
  const booked = (s) => { const ist = String(s.initial_status || '').trim().toLowerCase(); return !!s.initial_serviced_date || ist === 'completed' || ist === 'pending'; };
  const notRen = (s) => typeof reportingSourceClass !== 'function' || reportingSourceClass(reportingSourceOf(s)) !== 'renewal';
  let s = 0, cv = 0; const sales = [];
  for (const r of subs) {
    if (String(r.sold_by_type || '').trim() !== 'Office Staff' || String(r.sold_date || '').slice(0, 7) !== ym || !booked(r) || !notRen(r)) continue;
    if (typeof reportingNonSaleService === 'function' && reportingNonSaleService(r.subscription)) continue;
    const v = Number(r.subscription_contract_value) || 0; s++; cv += v; sales.push(r);
    const b = cell(br, TC(r.office_name || 'No branch')); b.s++; b.cv += v;
    const c = cell(ch, _mklChannelOfSource(reportingSourceOf(r))); c.s++; c.cv += v;
  }
  // Leads (GoHighLevel, deduped).
  let leads = null;
  if (AL) {
    leads = 0;
    for (const l of AL.leads) { if (String(l.d).slice(0, 7) !== ym) continue; leads++; cell(br, l.market || 'No branch').leads++; cell(ch, l.prov === 'Unmapped' ? 'Unmapped GHL source' : l.prov).leads++; }
  }
  // Wages + incentives by branch (Spend tab → Wages & incentives; per Isaac, Nov 9 — part of CAC).
  let labor = 0, hasLabor = false;
  try { const m = _mktgStore(); const W = (m.wages || {})[ym] || {}, I = (m.incentives || {})[ym] || {}; for (const b of new Set([...Object.keys(W), ...Object.keys(I)])) { const v = (Number(W[b]) || 0) + (Number(I[b]) || 0); if (!v) continue; hasLabor = true; labor += v; cell(br, TC(b)).labor = (cell(br, TC(b)).labor || 0) + v; } } catch (e) { /* no store yet */ }
  const v = { ym, A, spend, spendWaiting, spendUnassigned, spendLines, s, cv, sales, leads, br, ch, labor, hasLabor, hasSpend: !!A, hasLeads: !!AL, hasSubs: subs.length > 0 };
  M[ym] = { sig, subs, al: AL, v };
  return v;
}
// Spend vs new revenue, last 12 months ending at ym — totals only (cheap).
function mklSeries(ym) {
  const out = [];
  for (let i = 11; i >= 0; i--) { const m = _mklShift(ym, -i); const D = mklMonth(m); out.push({ ym: m, spend: D.hasSpend ? D.spend : null, cv: D.hasSubs ? D.cv : null, s: D.s }); }
  return out;
}

function mktgLeanView() { return perfT('lean:view', () => _mktgLeanView()); }
function _mktgLeanView() {
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function' && state._ghl === undefined) ghlLoadLeads();
  const F = mklState(); const ym = F.ym, pm = _mklShift(ym, -1);
  if (typeof reportingLoadAdSpend === 'function') { reportingLoadAdSpend(Number(ym.slice(0, 4))); if (pm.slice(0, 4) !== ym.slice(0, 4)) reportingLoadAdSpend(Number(pm.slice(0, 4))); }
  const cur = mklMonth(ym), prev = mklMonth(pm);
  const muted = { color: 'var(--text-muted)' };
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const months = []; for (let i = 0; i < 18; i++) months.push(_mklYm(new Date(new Date().getFullYear(), new Date().getMonth() - i, 1)));
  const monthSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { F.ym = e.target.value; mountApp(); } },
    ...months.map(k => el('option', { value: k, selected: k === ym }, _mklLblS(k) + (k === months[0] ? ' · open' : ''))));
  const goSpend = () => { state._mktSub = 'spend'; state._mktCtrlMonth = ym; mountApp(); };

  // ── Data line: where each number comes from and how fresh it is. ──
  const G = state._ghl, P = state.reportingIsSpendPayee;
  const dot = (ok, label) => el('span', { class: 'inline-flex items-center gap-1.5 text-[11px]', style: muted }, el('span', { class: 'inline-block rounded-full', style: { width: '7px', height: '7px', background: ok ? 'var(--ok)' : '#DC2626' } }), label);
  const fresh = el('div', { class: 'flex items-center gap-4 flex-wrap text-[11px]' },
    el('span', { class: 'uppercase tracking-widest text-[10px] font-bold', style: muted }, 'Sources'),
    dot(cur.hasSpend, 'QuickBooks marketing' + (P && P.pulledAt ? ' · ' + _mklAgo(P.pulledAt) : cur.hasSpend ? '' : ' · no lines for ' + _mklLblS(ym))),
    dot(cur.hasSubs, 'FieldRoutes new sales' + (state.reportingSubscriptions ? '' : ' · loading')),
    dot(!!(G && G.opps), 'GoHighLevel leads' + (G && G.at ? ' · ' + _mklAgo(G.at) : G === undefined || (G && G.loading) ? ' · loading' : '')));

  // ── Tiles: the three truths, then what they make. ──
  const d = (a, b) => a == null || b == null || !isFinite(a) || !isFinite(b) || b === 0 ? null : (a - b) / Math.abs(b);
  const delta = (v, upGood) => { if (v == null) return el('span', { class: 'text-[11px]', style: muted }, 'no prior'); const good = upGood == null ? null : (v >= 0) === upGood; return el('span', { class: 'text-[11px] font-semibold tabular-nums', style: { color: good == null ? 'var(--text-muted)' : good ? '#3E5A3A' : '#B91C1C' } }, (v >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(v * 100)) + '% vs ' + _mklLblS(pm)); };
  const tile = (label, val, dl, note, onClick) => el('div', { class: 'card p-4 flex flex-col gap-1' + (onClick ? ' cursor-pointer' : ''), onclick: onClick || null },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: muted }, label),
    el('div', { class: 'text-2xl font-black tabular-nums', style: { fontFamily: 'ui-monospace, monospace' } }, val), dl, note ? el('div', { class: 'text-[11px]', style: muted }, note) : null);
  const cac = (D) => D.hasSpend && D.spend && D.s ? D.spend / D.s : null, ret = (D) => D.hasSpend && D.spend ? D.cv / D.spend : null, cpl = (D) => D.hasSpend && D.spend && D.leads ? D.spend / D.leads : null, close = (D) => D.leads ? D.s / D.leads : null;
  const spendNote = !cur.hasSpend ? 'No QuickBooks lines for this month yet' : [cur.spendLines + ' charges', cur.spendUnassigned > 0 ? _mklUsd(cur.spendUnassigned) + ' need a vendor' : '', cur.spendWaiting > 0 ? _mklUsd(cur.spendWaiting) + ' waiting on vendor reports' : ''].filter(Boolean).join(' · ') + ' → Spend tab';
  const tiles = el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
    tile('Marketing spend · QuickBooks', _mklUsd(cur.hasSpend ? cur.spend : null), delta(d(cur.spend, prev.hasSpend ? prev.spend : null), null), spendNote, goSpend),
    tile('New revenue · FieldRoutes', _mklUsd(cur.hasSubs ? cur.cv : null), delta(d(cur.cv, prev.hasSubs ? prev.cv : null), true), cur.s + ' new sale' + (cur.s === 1 ? '' : 's') + ' · Office Staff · contract value', () => mklOpenSales(cur, 'New sales · ' + _mklLbl(ym))),
    tile('New leads · GoHighLevel', _mklNum(cur.leads), delta(d(cur.leads, prev.leads), true), cur.hasLeads ? 'opportunities, one per person per 30 days' : 'GoHighLevel not loaded'),
    tile('Return on spend', _mklX(ret(cur)), delta(d(ret(cur), ret(prev)), true), 'new revenue ÷ spend'),
    tile('CAC', _mklUsd(cac(cur)), delta(d(cac(cur), cac(prev)), false), 'marketing spend ÷ new sales'),
    tile('CAC · fully loaded', cur.hasLabor && cur.s ? _mklUsd(((cur.hasSpend ? cur.spend : 0) + cur.labor) / cur.s) : '—', cur.hasLabor && prev.hasLabor ? delta(d(cur.s ? ((cur.hasSpend ? cur.spend : 0) + cur.labor) / cur.s : null, prev.s ? ((prev.hasSpend ? prev.spend : 0) + prev.labor) / prev.s : null), false) : el('span', { class: 'text-[11px]', style: muted }, cur.hasLabor ? 'no prior' : 'wages not entered'), cur.hasLabor ? '(spend + ' + _mklUsd(cur.labor) + ' wages & incentives) ÷ new sales' : 'enter wages on the Spend tab'),
    tile('Cost per lead', _mklUsd(cpl(cur)), delta(d(cpl(cur), cpl(prev)), false), 'spend ÷ leads'),
    tile('Close rate', _mklPct(close(cur)), delta(d(close(cur), close(prev)), true), 'new sales ÷ leads'),
    tile('Avg contract', _mklUsd(cur.s ? cur.cv / cur.s : null), delta(d(cur.s ? cur.cv / cur.s : null, prev.s ? prev.cv / prev.s : null), true), 'new revenue ÷ new sales'));

  // ── Tables: by branch, by channel — the same seven columns. ──
  const th = (t, r, extra) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ color: 'var(--text-muted)', background: 'var(--card-2)', whiteSpace: 'nowrap' }, extra || {}) }, t);
  const td = (t, st, r) => el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap ' + (r ? 'text-right' : ''), style: Object.assign({ fontFamily: 'ui-monospace, monospace' }, st || {}) }, t);
  const row = (name, c, bold, note) => { const _cac = c.s && c.spend ? c.spend / c.s : null, _ret = c.spend ? c.cv / c.spend : null, _cpl = c.leads && c.spend ? c.spend / c.leads : null, _close = c.leads ? c.s / c.leads : null, _lab = c.labor || 0, _fcac = c.s && (c.spend || _lab) ? (c.spend + _lab) / c.s : null;
    return el('tr', { class: 'border-t', style: Object.assign({ borderColor: 'var(--border)' }, bold ? { background: 'var(--card-2)', borderTop: '2px solid var(--text)' } : {}) },
      el('td', { class: 'px-3 py-1.5 whitespace-nowrap', style: { fontWeight: bold ? '800' : '700', fontFamily: 'inherit' } }, name, note ? el('span', { class: 'text-[10px] ml-2 font-normal', style: { color: '#B45309' } }, note) : null),
      td(c.spend ? _mklUsd(c.spend) : '—', c.spend ? null : muted, true), td(c.leads ? _mklNum(c.leads) : '—', c.leads ? null : muted, true), td(c.s ? _mklNum(c.s) : '—', c.s ? null : muted, true), td(c.cv ? _mklUsd(c.cv) : '—', c.cv ? null : muted, true),
      td(_mklPct(_close), _close == null ? muted : null, true), td(_mklUsd(_cpl), _cpl == null ? muted : null, true), td(_mklUsd(_cac), _cac == null ? muted : null, true),
      ...(showLabor ? [td(_lab ? _mklUsd(_lab) : '—', _lab ? null : muted, true), td(_mklUsd(_fcac), _fcac == null ? muted : null, true)] : []),
      td(_mklX(_ret), _ret == null ? muted : { fontWeight: '700', color: _ret >= 1 ? '#3E5A3A' : '#B91C1C' }, true)); };
  let showLabor = false;   // set per table: the branch table shows wages + fully-loaded CAC when any are entered
  const head = () => el('tr', {}, th('', false, { background: 'var(--card-2)' }), th('Spend', true), th('Leads', true), th('New sales', true), th('New revenue', true), th('Close rate', true), th('Cost / lead', true), th('CAC', true), ...(showLabor ? [th('Wages', true), th('CAC · loaded', true)] : []), th('Return', true));
  const sumOf = (o, keys) => keys.reduce((t, k) => { const c = o[k]; t.spend += c.spend; t.leads += c.leads; t.s += c.s; t.cv += c.cv; t.labor += c.labor || 0; return t; }, { spend: 0, leads: 0, s: 0, cv: 0, labor: 0 });
  const table = (title, sub, o, extraRows, noteOf, withLabor) => {
    showLabor = !!withLabor && Object.values(o).some(c => c.labor);
    const keys = Object.keys(o).filter(k => o[k].spend || o[k].leads || o[k].s || o[k].labor).sort((a, b) => (o[b].spend - o[a].spend) || (o[b].cv - o[a].cv) || (o[b].leads - o[a].leads));
    const tot = sumOf(o, keys);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-base font-bold' }, title), el('div', { class: 'text-[11px] mt-0.5', style: muted }, sub)),
      el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, head()),
        el('tbody', {}, ...keys.map(k => row(k, o[k], false, noteOf ? noteOf(k, o[k]) : null)), ...(extraRows || []), keys.length ? row('Total', tot, true) : null))),
      !keys.length ? el('div', { class: 'px-5 py-4 text-sm text-center', style: muted }, 'Nothing for ' + _mklLbl(ym) + ' yet.') : null);
  };
  // Branch: spend placed on the Spend tab; waiting vendors are out of this split until their report lands.
  const brTable = table('By branch · ' + _mklLblS(ym), 'Spend as allocated on the Spend tab' + (cur.spendWaiting > 0 ? ' — ' + _mklUsd(cur.spendWaiting) + ' of vendor spend is not in any branch yet (waiting on reports), so branch CAC runs low until it lands' : '') + '. Leads by the lead’s ZIP; new sales by the account’s office.' + (cur.hasLabor ? ' Wages & incentives from the Spend tab; CAC · loaded = (spend + wages) ÷ new sales.' : ''), cur.br, null, null, true);
  const chTable = table('By channel · ' + _mklLblS(ym), 'Spend by vendor from QuickBooks; leads by GoHighLevel source; new sales by the FieldRoutes source on the account (last touch). Close rate = new sales ÷ leads, so a channel whose GHL label and FieldRoutes source don\u2019t line up will read high or low — map them the same in Configurations.', cur.ch, null,
    (k, c) => c.waiting > 0 ? 'waiting on its report — not in branches yet' : k === 'Unmapped GHL source' ? 'map these in Configurations → GoHighLevel sources' : k === 'Unspecified' ? 'no source on the account — fix in FieldRoutes' : (c.s && !c.leads) ? 'sales but no leads — no GoHighLevel label maps here (Configurations → sources)' : (c.leads && !c.s && !c.spend) ? 'leads but no sales — no FieldRoutes source maps here' : null);

  // ── Chart: spend vs new revenue, last 12 months. ──
  const S = mklSeries(ym), idC = 'mklTrend';
  setTimeout(() => {
    if (typeof Chart === 'undefined') return; const c = document.getElementById(idC); if (!c) return;
    const reg = typeof _chartInstances !== 'undefined' ? _chartInstances : (window._mklCharts = window._mklCharts || {});
    if (reg[idC]) { reg[idC].destroy(); delete reg[idC]; }
    const ink = state.theme === 'dark' ? '#E6E6DC' : '#323230', txt = state.theme === 'dark' ? '#C9C9BE' : '#555', grid = state.theme === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    reg[idC] = new Chart(c.getContext('2d'), { data: { labels: S.map(x => _mklLblS(x.ym)), datasets: [
        { type: 'bar', label: 'Marketing spend (QuickBooks)', data: S.map(x => x.spend), backgroundColor: ink, borderRadius: 2, order: 2 },
        { type: 'line', label: 'New revenue (FieldRoutes)', data: S.map(x => x.cv), borderColor: '#DF643A', backgroundColor: '#DF643A', borderWidth: 2.4, pointRadius: 3, tension: 0.3, spanGaps: true, order: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ': ' + (x.parsed.y == null ? '—' : fmt.usd0(x.parsed.y)), afterBody: (items) => { const x = S[items[0].dataIndex]; return x && x.spend && x.cv != null ? ['Return ' + (x.cv / x.spend).toFixed(2) + 'x · CAC ' + (x.s ? fmt.usd0(x.spend / x.s) : '—')] : []; } } } },
        scales: { x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 }, maxRotation: 0 } }, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => fmt.usd0(v) } } } } });
  }, 40);
  const chart = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-base font-bold' }, 'Spend vs new revenue · last 12 months'), el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Bars are QuickBooks marketing spend by charge month; the line is Office Staff new-sale contract value by sale month. A month with no QuickBooks lines shows no bar, not $0.')),
    el('div', { class: 'p-3', style: { height: '240px' } }, el('canvas', { id: idC })));

  const headBar = el('div', { class: 'card px-5 py-3 flex items-center gap-3 flex-wrap' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Marketing · ' + _mklLbl(ym)), el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Spend from QuickBooks, new revenue from FieldRoutes, leads from GoHighLevel — compared with ' + _mklLblS(pm) + '.')),
    el('span', { class: 'ml-auto' }), monthSel);
  return el('div', { class: 'flex flex-col gap-4' }, headBar, fresh, tiles, brTable, chTable, chart);
}
// The month's new sales behind the New revenue tile (same rows the table counts).
function mklOpenSales(D, title) {
  if (typeof openReportingDrillModal !== 'function') return;
  openReportingDrillModal({ chartTitle: title, sliceLabel: D.s + ' new sale' + (D.s === 1 ? '' : 's') + ' · ' + fmt.usd0(D.cv) + ' contracted', rows: D.sales, formatValue: fmt.usd0 });
}
