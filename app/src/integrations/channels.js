// ┌─ src/integrations/channels.js ─────────────────────────────────────────
// │ Marketing → Channels (per Isaac, Nov 10 — the Attribution tab, redone
// │ "very similar to how we have the auditing tab structured… Leads, then
// │ bookings, then revenue, and spend… only build out data you know you can
// │ verify"). One row per channel, the same filter bar and sortable wide
// │ table as Auditing, a Total row, and a click-through card per channel.
// │
// │ Where every column comes from (nothing estimated):
// │   Leads     GoHighLevel opportunities, deduped (mkpAllLeads), by the
// │             label → provider mapping; office = the lead's ZIP office.
// │   Bookings  FieldRoutes Office Staff new sales (renewals and non-sale
// │             services out), by the account's source → channel
// │             (frChannelOf): Sold · Booked (initial on the calendar or done)
// │             · Serviced · Active · Cancelled. Close = sold ÷ leads.
// │   Revenue   contract value of those sales: sold, serviced, active.
// │   Spend     QuickBooks Advertising & Marketing by vendor for every month
// │             the range touches (spqAllocMonth — the Spend tab's numbers);
// │             an office filter reads the vendor's branch split. Whole months.
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
function _chIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _chMonths(from, to) { const out = []; for (let ym = from.slice(0, 7); ym <= to.slice(0, 7); ) { out.push(ym); const d = new Date(ym + '-01T12:00'); d.setMonth(d.getMonth() + 1); ym = _chIso(d).slice(0, 7); } return out; }

function channelsView() {
  const gate = typeof reportingDataGate === 'function' ? reportingDataGate() : null;
  if (gate) return gate;
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function' && state._ghl === undefined) ghlLoadLeads();
  // ── Filters: the Auditing tab's range presets + office. ──
  if (!state.chRange) state.chRange = 'this_month';
  if (!state.chOffice) state.chOffice = 'all';
  const presetOpts = [['this_month', 'This Month'], ['last_month', 'Last Month'], ['this_year', 'This Year'], ['last_year', 'Last Year'], ['custom', 'Custom…']];
  const preset = presetOpts.some(([v]) => v === state.chRange) ? state.chRange : 'this_month';
  const bounds = indicatorRangeBounds(preset, { start: state.chCustomStart, end: state.chCustomEnd });
  const today = _chIso(new Date());
  const from = bounds.start, to = bounds.end && bounds.end < today ? bounds.end : today;
  const months = _chMonths(from, to);
  for (const ym of months) if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(Number(ym.slice(0, 4)));
  const TC = (b) => typeof _mktgTC === 'function' ? _mktgTC(b) : String(b || '');
  const subsAll = state.reportingSubscriptions || [];
  const offices = [...new Set(subsAll.map(r => TC(r.office_name)).filter(Boolean))].sort();
  const off = state.chOffice;

  // ── Sales (FieldRoutes) → channel. ──
  const booked = (s) => { const ist = String(s.initial_status || '').trim().toLowerCase(); return !!s.initial_serviced_date || ist === 'completed' || ist === 'pending'; };
  const serviced = (s) => !!s.initial_serviced_date || String(s.initial_status || '').trim().toLowerCase() === 'completed' || (Number(s.subscription_completed_services) || 0) > 0;
  const active = (s) => String(s.subscription_status || '').trim().toLowerCase() === 'active' && !s.subscription_date_canceled;
  const notRen = (s) => typeof reportingSourceClass !== 'function' || reportingSourceClass(reportingSourceOf(s)) !== 'renewal';
  const chOf = (s) => typeof frChannelOf === 'function' ? frChannelOf(reportingSourceOf(s)) : String(reportingSourceOf(s) || 'Unspecified');
  const mk = () => ({ leads: 0, sold: 0, booked: 0, serviced: 0, active: 0, cancelled: 0, soldRev: 0, servicedRev: 0, activeRev: 0, cancelledRev: 0, spend: 0, spendWaiting: 0, sales: [], leadRows: [] });
  const C = {}, tot = mk();
  const cell = (k) => C[k] || (C[k] = mk());
  const aside = { sales: {}, labels: {}, unmappedLeads: [] };   // what stays out of the rows (per Isaac, Nov 16) — shown under the table instead
  for (const s of subsAll) {
    if (String(s.sold_by_type || '').trim() !== 'Office Staff') continue;
    const d = String(s.sold_date || '').slice(0, 10); if (!d || d < from || d > to) continue;
    if (!notRen(s)) continue;
    if (typeof reportingNonSaleService === 'function' && reportingNonSaleService(s.subscription)) continue;
    if (off !== 'all' && TC(s.office_name) !== off) continue;
    const cv = Number(s.subscription_contract_value) || 0;
    // Not a lead channel (per Isaac, Nov 16): a blank source, or a source the lead rules call not-a-lead (Door to
    // Door, current customer…) on an Office Staff sale — kept out of the rows, listed under the table to fix.
    const _src = String(reportingSourceOf(s) || '').trim();
    const _notLead = typeof ghlAutoProvider === 'function' && ghlAutoProvider(_src) === GHL_NOT_LEAD;
    if (!_src || _notLead) { const k = !_src ? '(no source)' : _src; const g = aside.sales[k] || (aside.sales[k] = { n: 0, cv: 0, rows: [] }); g.n++; g.cv += cv; g.rows.push(s); continue; }
    const c = cell(chOf(s));
    for (const x of [c, tot]) {
      x.sold++; x.soldRev += cv; x.sales.push(s);
      if (booked(s)) x.booked++;
      if (serviced(s)) { x.serviced++; x.servicedRev += cv; if (active(s)) { x.active++; x.activeRev += cv; } else if (s.subscription_date_canceled) { x.cancelled++; x.cancelledRev += cv; } }
    }
  }
  // ── Leads (GoHighLevel). ──
  const AL = typeof mkpAllLeads === 'function' ? mkpAllLeads() : null;
  if (AL) for (const l of AL.leads) {
    const d = String(l.d).slice(0, 10); if (d < from || d > to) continue;
    if (off !== 'all' && l.market !== off) continue;
    if (l.prov === 'Unmapped') { const lb = l.label || '(blank label)'; aside.labels[lb] = (aside.labels[lb] || 0) + 1; aside.unmappedLeads.push(l); continue; }
    const c = cell(l.prov); c.leads++; tot.leads++; c.leadRows.push(l);
  }
  // ── Spend (QuickBooks, whole months the range touches). ──
  let spendMonths = 0;
  for (const ym of months) {
    const A = typeof spqAllocMonth === 'function' ? spqAllocMonth(ym) : null; if (!A) continue; spendMonths++;
    const lbl = (p) => typeof spqLabel === 'function' ? spqLabel(p) : p;
    const amtOf = (p) => off === 'all' ? A.byProv[p].amt : ((A.cells[p] || {})[Object.keys(A.cells[p] || {}).find(b => TC(b) === off)] || 0);
    // Agency & tools isn't a channel (per Isaac, Nov 16): its dollars ride on the media channels pro rata to their spend.
    const media = Object.keys(A.byProv).filter(p => p !== SPQ_SKIP && p !== SPQ_TOOLS); const mediaTot = media.reduce((t, p) => t + (amtOf(p) || 0), 0);
    const agency = A.byProv[SPQ_TOOLS] ? (amtOf(SPQ_TOOLS) || 0) : 0;
    for (const p of media) { const amt = amtOf(p); if (!amt) continue; const add = amt + (mediaTot > 0 ? agency * amt / mediaTot : 0); const c = cell(lbl(p)); c.spend += add; tot.spend += add; }
    if (off === 'all') for (const p in (A.waiting || {})) { const c = cell(p); c.spend += A.waiting[p].amt; c.spendWaiting += A.waiting[p].amt; tot.spend += A.waiting[p].amt; tot.spendWaiting += A.waiting[p].amt; }
  }

  // ── Table (the Auditing pattern: sortable, sticky name column, total row). ──
  const pct = (a, b) => b > 0 ? a / b : null;
  const cols = [
    { id: 'name', label: 'Channel', tip: 'FieldRoutes source → channel (Settings → Marketing → FieldRoutes sources) and GoHighLevel label → provider; spend by the vendor picked on the Spend tab.' },
    { id: 'leads', label: 'Leads', grp: 'Leads', tip: 'GoHighLevel opportunities in the range, one per person per 30 days, by the lead’s source label.' },
    { id: 'sold', label: 'Sold', grp: 'Bookings', tip: 'Office Staff new sales sold in the range, by the account’s FieldRoutes source. Renewals and non-sale services out.' },
    { id: 'booked', label: 'Booked', grp: 'Bookings', tip: 'Sold accounts with an initial appointment on the calendar or already done.' },
    { id: 'serviced', label: 'Serviced', grp: 'Bookings', tip: 'Sold accounts whose initial service has been completed.' },
    { id: 'close', label: 'Close rate', grp: 'Bookings', tip: 'Sold ÷ leads. Only meaningful when the channel’s GoHighLevel label and FieldRoutes source point at the same name.' },
    { id: 'svcPct', label: 'Sold → Svc', grp: 'Bookings', tip: 'Serviced ÷ sold.' },
    { id: 'soldRev', label: 'Sold Rev', grp: 'Revenue', tip: 'Contract value of everything sold in the range.' },
    { id: 'servicedRev', label: 'Serviced Rev', grp: 'Revenue', tip: 'Contract value of the sold accounts that have been serviced.' },
    { id: 'activeRev', label: 'Active Rev', grp: 'Revenue', tip: 'Serviced and still active.' },
    { id: 'cancelledRev', label: 'Cancelled Rev', grp: 'Revenue', tip: 'Serviced, then cancelled (3-day RORs included).' },
    { id: 'spend', label: 'Spend', grp: 'Spend', tip: 'QuickBooks Advertising & Marketing for every month the range touches, by vendor (the Spend tab’s allocation). Whole months, not pro-rated.' },
    { id: 'cpl', label: 'Cost / lead', grp: 'Spend', tip: 'Spend ÷ leads.' },
    { id: 'cac', label: 'CAC', grp: 'Spend', tip: 'Spend ÷ sold.' },
    { id: 'ret', label: 'Return', grp: 'Spend', tip: 'Sold revenue ÷ spend.' },
  ];
  const val = (id, name, s) => { switch (id) {
    case 'name': return name; case 'close': { const v = pct(s.sold, s.leads); return v == null ? -1 : v; } case 'svcPct': { const v = pct(s.serviced, s.sold); return v == null ? -1 : v; }
    case 'cpl': { const v = s.leads && s.spend ? s.spend / s.leads : null; return v == null ? -1 : v; } case 'cac': { const v = s.sold && s.spend ? s.spend / s.sold : null; return v == null ? -1 : v; }
    case 'ret': { const v = s.spend ? s.soldRev / s.spend : null; return v == null ? -1 : v; } default: return Number(s[id]) || 0; } };
  const fmtV = (id, name, s) => { const v = val(id, name, s);
    if (id === 'name') return name;
    if (['close', 'svcPct'].includes(id)) return v < 0 ? '—' : (v * 100).toFixed(1) + '%';
    if (['cpl', 'cac'].includes(id)) return v < 0 ? '—' : fmt.usd0(v);
    if (id === 'ret') return v < 0 ? '—' : v.toFixed(2) + 'x';
    if (/Rev$|^spend$/.test(id)) return v ? fmt.usd0(v) : '—';
    return v ? fmt.int(v) : '—'; };
  if (!state.chSort) state.chSort = { key: 'sold', dir: 'desc' };
  const sortState = state.chSort;
  const entries = Object.entries(C).filter(([, s]) => s.leads || s.sold || s.spend).sort((a, b) => { const va = val(sortState.key, a[0], a[1]), vb = val(sortState.key, b[0], b[1]); const c = typeof va === 'string' ? String(va).localeCompare(String(vb)) : va - vb; return sortState.dir === 'asc' ? c : -c; });
  const th = (c, i) => el('th', { class: 'px-3 py-2 text-[9px] uppercase tracking-wide font-semibold text-left cursor-pointer select-none whitespace-nowrap',
    style: Object.assign({ background: 'var(--card-2)', color: sortState.key === c.id ? 'var(--accent)' : 'var(--text-muted)', fontWeight: sortState.key === c.id ? '800' : undefined }, i === 0 ? { position: 'sticky', left: 0, zIndex: 2 } : {}),
    title: c.tip || '', onclick: () => { state.chSort = { key: c.id, dir: sortState.key === c.id ? (sortState.dir === 'asc' ? 'desc' : 'asc') : (c.id === 'name' ? 'asc' : 'desc') }; mountApp(); } }, c.label);
  const grpRow = el('tr', {}, el('th', { style: { background: 'var(--card-2)', position: 'sticky', left: 0, zIndex: 2 } }),
    ...['Leads', 'Bookings', 'Revenue', 'Spend'].map(g => el('th', { colspan: String(cols.filter(c => c.grp === g).length), class: 'px-3 pt-2 text-[9px] uppercase tracking-widest font-bold text-left', style: { background: 'var(--card-2)', color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' } }, g)));
  const red = '#DC2626', good = '#3E5A3A';
  const row = (name, s, total) => el('tr', { class: 'border-t' + (total ? '' : ' cursor-pointer hover:brightness-95'), style: Object.assign({ borderColor: 'var(--border)' }, total ? { background: 'var(--card-2)', borderTop: '2px solid var(--text)' } : {}), onclick: total ? null : () => openChannelCard(name, s, { from, to, off, months: spendMonths }) },
    ...cols.map((c, i) => { const v = val(c.id, name, s); const txt = fmtV(c.id, name, s);
      const color = c.id === 'ret' && v >= 0 ? (v >= 1 ? good : red) : c.id === 'cancelledRev' && v > 0 ? red : null;
      return el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap' + (i === 0 ? ' font-bold' : ' text-right'), style: Object.assign({ fontWeight: total ? '800' : undefined, color: txt === '—' ? 'var(--text-muted)' : color || undefined }, i === 0 ? { position: 'sticky', left: 0, zIndex: 1, background: total ? 'var(--card-2)' : 'var(--card)' } : {}) },
        txt, i === 0 && s.spendWaiting ? el('span', { class: 'ml-1 text-[9px] font-normal', style: { color: '#B45309' }, title: fmt.usd0(s.spendWaiting) + ' of this vendor’s QuickBooks spend is still waiting on its report (not in any branch yet)' }, '· waiting') : null); }));

  const sel = (value, opts, onChange) => el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => onChange(e.target.value) }, ...opts.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  const dateIn = (v, on) => el('input', { type: 'date', value: v || '', class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => on(e.target.value) });
  const bar = el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' },
    sel(preset, presetOpts, (v) => { state.chRange = v; mountApp(); }),
    preset === 'custom' ? dateIn(state.chCustomStart, (v) => { state.chCustomStart = v; mountApp(); }) : null, preset === 'custom' ? dateIn(state.chCustomEnd, (v) => { state.chCustomEnd = v; mountApp(); }) : null,
    el('span', { class: 'text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } }, from + ' → ' + to),
    sel(off, [['all', 'All offices'], ...offices.map(o => [o, o])], (v) => { state.chOffice = v; mountApp(); }),
    el('span', { class: 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, (AL ? fmt.int(tot.leads) + ' leads' : 'GoHighLevel loading…') + ' · ' + fmt.int(tot.sold) + ' sold · ' + (spendMonths ? fmt.usd0(tot.spend) + ' spend over ' + spendMonths + ' month' + (spendMonths === 1 ? '' : 's') : 'no QuickBooks months loaded')));
  const table = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Channels'),
      el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Click a channel for its card · click a header to sort')),
    el('div', { class: 'scroll-x', style: { overflow: 'auto', maxHeight: '70vh' } }, el('table', { class: 'w-full frozen-table', style: { borderCollapse: 'collapse', fontSize: '11px' } },
      el('thead', { style: { position: 'sticky', top: 0, zIndex: 3 } }, grpRow, el('tr', {}, ...cols.map(th))),
      el('tbody', {}, ...entries.map(([n, s]) => row(n, s, false)), row('TOTAL', tot, true)))),
    el('div', { class: 'px-4 py-2 border-t text-[10px]', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
      'Leads: GoHighLevel. Sold / Booked / Serviced and revenue: FieldRoutes Office Staff new sales by the account’s source. Spend: QuickBooks by vendor for ' + (months.length === 1 ? months[0] : months[0] + ' → ' + months[months.length - 1]) + ' (whole months)' + (off !== 'all' ? ', the vendor’s ' + off + ' share' : '') + '. Agency & tools spend rides on the media channels pro rata. Leads are counted on the lead’s date and sales on the sold date, so a channel can show more sold than leads in a short range when the leads came in earlier. More sold than leads over a long range means a GoHighLevel label isn’t mapped to that channel — Settings → Configurations → GoHighLevel sources.'));
  // Under the table (per Isaac, Nov 16): what was kept out of the rows, and what to fix so it lands in one.
  const asideCard = (() => {
    const sk = Object.keys(aside.sales).sort((a, b) => aside.sales[b].n - aside.sales[a].n), lk = Object.entries(aside.labels).sort((a, b) => b[1] - a[1]);
    if (!sk.length && !lk.length) return null;
    const line = (...kids) => el('div', { class: 'flex items-start gap-2 text-[11px] flex-wrap' }, ...kids);
    const lk8 = lk.slice(0, 10), more = lk.length - lk8.length, unN = lk.reduce((t, [, n]) => t + n, 0);
    const openRows = (title, rows) => () => openReportingDrillModal({ chartTitle: 'Channels · ' + title, sliceLabel: rows.length + ' sale' + (rows.length === 1 ? '' : 's') + ' · ' + from + ' → ' + to, rows, formatValue: fmt.usd0 });
    return el('div', { class: 'card p-4 flex flex-col gap-2', style: { borderColor: 'rgba(217,119,6,.5)' } },
      el('div', { class: 'text-[11px] uppercase tracking-widest font-bold', style: { color: '#B45309' } }, 'Not in a channel yet — fix these'),
      ...sk.map(k => { const g = aside.sales[k]; return line(el('span', { class: 'font-bold', style: { color: '#B91C1C' } }, fmt.int(g.n) + ' sale' + (g.n === 1 ? '' : 's') + ' · ' + fmt.usd0(g.cv)),
        el('span', {}, k === '(no source)' ? 'with no source on the FieldRoutes account — set the source on each account.' : 'sourced “' + k + '” by Office Staff — not a lead channel; re-source them in FieldRoutes (Auditing → Source lists them too).'),
        el('button', { class: 'font-semibold underline', style: { color: 'var(--accent)' }, onclick: openRows(k, g.rows) }, 'See them →')); }),
      lk.length ? line(el('span', { class: 'font-bold', style: { color: '#B91C1C' } }, fmt.int(unN) + ' lead' + (unN === 1 ? '' : 's')),
        el('span', {}, 'on GoHighLevel labels with no channel — map each in Settings → Configurations → GoHighLevel sources: ' + lk8.map(([l, n]) => l + ' (' + n + ')').join(' · ') + (more > 0 ? ' · +' + more + ' more' : ''))) : null);
  })();
  const audit = (() => { try { return chAttributionAudit(subsAll.filter(s => { if (String(s.sold_by_type || '').trim() !== 'Office Staff') return false; const d = String(s.sold_date || '').slice(0, 10); if (!d || d < from || d > to) return false; if (!notRen(s)) return false; if (typeof reportingNonSaleService === 'function' && reportingNonSaleService(s.subscription)) return false; return off === 'all' || TC(s.office_name) === off; }), from, to); } catch (e) { console.warn('[channels] audit', e); return null; } })();
  return el('div', { class: 'flex flex-col gap-4' }, bar, table, asideCard, audit);
}

// ── Misattributed in FieldRoutes (per Isaac, Nov 13): Pest AI's opportunity timestamps are the one source of truth
// for last touch. For every Office Staff new sale in the range, the latest GoHighLevel opportunity on that phone at
// or before the sale is the touch that should have been credited; when FieldRoutes' source lands on a different
// channel, the sale is listed with both and the gap, and the list exports. Phone-less sales and phones GoHighLevel
// never saw are counted, not guessed. ──
const _chPhone10 = (v) => { let d = String(v == null ? '' : v).replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length >= 10 ? d.slice(0, 10) : ''; };
function chAttributionAudit(sales, from, to) {
  const G = state._ghl;
  const muted = { color: 'var(--text-muted)' };
  const card = (...kids) => el('div', { class: 'card overflow-hidden' }, ...kids);
  const head = (sub) => el('div', { class: 'px-4 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Misattributed in FieldRoutes'), el('div', { class: 'text-[11px] mt-0.5', style: muted }, sub)));
  if (!G || !G.opps || !G.opps.length) return card(head('Pest AI (GoHighLevel) opportunities ' + (G === null || G === undefined ? 'loading…' : 'not loaded — nothing to compare against')));
  const lab = G.labels || [];
  // Opportunities by phone, each [date, HH:MM, provider, label].
  const byPhone = new Map();
  for (const o of G.opps) {
    const ph = _chPhone10(o[2]); if (!ph) continue;
    const pv = o[1] >= 0 ? ghlProviderOf(lab[o[1]]) : null; if (!pv || pv === GHL_NOT_LEAD) continue;
    (byPhone.get(ph) || byPhone.set(ph, []).get(ph)).push([o[0], o[4] || '', pv, lab[o[1]]]);
  }
  for (const v of byPhone.values()) v.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const rows = []; let noPhone = 0, unseen = 0, agree = 0, noPrior = 0;
  for (const s of sales) {
    const ph = _chPhone10(s.phone); if (!ph) { noPhone++; continue; }
    const ops = byPhone.get(ph); if (!ops) { unseen++; continue; }
    const sold = String(s.sold_date || '').slice(0, 10);
    const before = ops.filter(o => o[0] <= sold);               // the sale day counts: the touch that opened the call
    if (!before.length) { noPrior++; continue; }
    const last = before[before.length - 1];
    const frSrc = reportingSourceOf(s), frCh = typeof frChannelOf === 'function' ? frChannelOf(frSrc) : String(frSrc || 'Unspecified');
    if (String(frCh).toLowerCase() === String(last[2]).toLowerCase()) { agree++; continue; }
    const others = before.slice(0, -1).map(o => o[2]).filter((v, i, a) => a.indexOf(v) === i);
    rows.push({ s, ph, sold, frSrc: frSrc || '(blank)', frCh, last, others, after: ops.filter(o => o[0] > sold).length });
  }
  rows.sort((a, b) => b.sold.localeCompare(a.sold));
  const sub = fmt.int(sales.length) + ' Office Staff new sales ' + from + ' → ' + to + ' · ' + fmt.int(agree) + ' agree with Pest AI’s last touch · ' + fmt.int(rows.length) + ' do not' + (noPrior ? ' · ' + fmt.int(noPrior) + ' had no Pest AI touch before the sale' : '') + (unseen ? ' · ' + fmt.int(unseen) + ' phones Pest AI never saw' : '') + (noPhone ? ' · ' + fmt.int(noPhone) + ' with no phone on the account' : '');
  const th = (t) => el('th', { class: 'px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: Object.assign({ background: 'var(--card-2)' }, muted) }, t);
  const td = (t, st) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap tabular-nums', style: st || {} }, t);
  const stamp = (o) => o[0] + (o[1] ? ' ' + o[1] + ' UTC' : '');
  const tr = (r) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    td('#' + (r.s.customer_id || '—')), td(r.sold), td(typeof _mktgTC === 'function' ? _mktgTC(r.s.office_name) : r.s.office_name || '—'),
    td(r.frSrc + (r.frCh !== r.frSrc ? ' → ' + r.frCh : ''), { color: '#B91C1C', fontWeight: '700' }),
    td(r.last[2] + (r.last[3] && r.last[3] !== r.last[2] ? ' (' + r.last[3] + ')' : ''), { color: 'var(--ok)', fontWeight: '700' }), td(stamp(r.last), muted),
    td(r.others.length ? r.others.join(' · ') : '—', muted), td(r.after ? String(r.after) : '—', muted), td(fmt.usd0(Number(r.s.subscription_contract_value) || 0)));
  const csv = () => {
    const esc = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [['customer_number', 'sold_date', 'office', 'fieldroutes_source', 'fieldroutes_channel', 'pest_ai_last_touch', 'pest_ai_label', 'last_touch_at_utc', 'earlier_touches', 'touches_after_sale', 'contract_value'].join(',')];
    for (const r of rows) lines.push([r.s.customer_id, r.sold, r.s.office_name, r.frSrc, r.frCh, r.last[2], r.last[3], stamp(r.last), r.others.join(' | '), r.after, Number(r.s.subscription_contract_value) || 0].map(esc).join(','));
    const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: 'ridd-misattributed-' + from + '-to-' + to + '.csv' }); document.body.append(a); a.click(); a.remove();
  };
  return card(
    el('div', { class: 'px-4 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Misattributed in FieldRoutes'), el('div', { class: 'text-[11px] mt-0.5', style: muted }, sub)),
      rows.length ? el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: csv }, '⬇ Export ' + rows.length) : null),
    rows.length ? el('div', { class: 'scroll-x', style: { overflow: 'auto', maxHeight: '60vh', borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full', style: { borderCollapse: 'collapse', fontSize: '11px' } },
      el('thead', { style: { position: 'sticky', top: 0, zIndex: 2 } }, el('tr', {}, th('Customer'), th('Sold'), th('Office'), th('FieldRoutes source'), th('Pest AI last touch'), th('Touched at'), th('Earlier touches'), th('After sale'), th('Contract'))),
      el('tbody', {}, ...rows.map(tr))))
      : el('div', { class: 'px-4 py-4 text-sm text-center', style: muted }, 'Every sale with a Pest AI touch agrees with its last touch.'),
    el('div', { class: 'px-4 py-2 border-t text-[10px]', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
      'Last touch = the latest GoHighLevel opportunity on the account’s phone on or before the sold date (opportunity timestamps, UTC). FieldRoutes source is read through Configurations → FieldRoutes sources → channel, so a different spelling of the same channel is not a mismatch. Fix the source in FieldRoutes; the next sync clears the row.'));
}

// One channel's card: the table's numbers as grouped tiles, each sales tile drilling to the accounts.
function openChannelCard(name, s, ctx) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const pctS = (p) => p == null || !isFinite(p) ? '—' : (p * 100).toFixed(1) + '%';
  const money = (v) => v ? fmt.usd0(v) : '—';
  const good = '#DF643A', bad = '#DC2626';
  const tile = (label, val, sub, color, onClick) => el('div', { class: 'rounded-xl p-3' + (onClick ? ' cursor-pointer hover:brightness-95 transition' : ''), style: { background: 'var(--card-2)' }, onclick: onClick || undefined, title: onClick ? 'Click to see these accounts' : undefined },
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-xl font-black tabular-nums mt-0.5', style: color ? { color } : {} }, val),
    sub ? el('div', { class: 'text-[10px] text-muted- mt-0.5' }, sub) : null);
  const group = (title, tiles) => el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, title), el('div', { class: 'grid grid-cols-2 sm:grid-cols-3 gap-2' }, ...tiles.filter(Boolean)));
  const drill = (label, pred) => () => { const rows = s.sales.filter(pred); if (!rows.length) return; openReportingDrillModal({ chartTitle: name + ' — ' + label, sliceLabel: fmt.int(rows.length) + ' account' + (rows.length === 1 ? '' : 's'), rows, formatValue: fmt.usd0 }); };
  const booked = (x) => { const ist = String(x.initial_status || '').trim().toLowerCase(); return !!x.initial_serviced_date || ist === 'completed' || ist === 'pending'; };
  const serviced = (x) => !!x.initial_serviced_date || String(x.initial_status || '').trim().toLowerCase() === 'completed' || (Number(x.subscription_completed_services) || 0) > 0;
  const active = (x) => String(x.subscription_status || '').trim().toLowerCase() === 'active' && !x.subscription_date_canceled;
  const card = el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'p-5 pb-3 flex items-start justify-between gap-3', style: { borderBottom: '1px solid var(--border)' } },
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--accent)' } }, 'Channel'), el('h2', { class: 'text-xl font-bold mt-0.5' }, name),
        el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-subtle)' } }, ctx.from + ' → ' + ctx.to + (ctx.off !== 'all' ? ' · ' + ctx.off : ''))),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { class: 'p-5 overflow-auto flex flex-col gap-4' },
      group('Leads', [tile('Leads', fmt.int(s.leads), 'GoHighLevel · ' + name), tile('Close rate', pctS(s.leads ? s.sold / s.leads : null), 'sold ÷ leads')]),
      group('Bookings', [
        tile('Sold', fmt.int(s.sold), null, null, drill('Sold', () => true)),
        tile('Booked', fmt.int(s.booked), 'initial on the calendar or done', null, drill('Booked', booked)),
        tile('Serviced', fmt.int(s.serviced), null, null, drill('Serviced', serviced)),
        tile('Active', fmt.int(s.active), 'serviced, still active', good, drill('Active', (x) => serviced(x) && active(x))),
        tile('Cancelled', fmt.int(s.cancelled), 'serviced, then cancelled', s.cancelled ? bad : null, drill('Cancelled', (x) => serviced(x) && !!x.subscription_date_canceled)),
        tile('Sold → Serviced', pctS(s.sold ? s.serviced / s.sold : null))]),
      group('Revenue · contract value', [
        tile('Sold', money(s.soldRev), null, null, drill('Sold revenue', () => true)),
        tile('Serviced', money(s.servicedRev), null, null, drill('Serviced revenue', serviced)),
        tile('Active', money(s.activeRev), null, null, drill('Active revenue', (x) => serviced(x) && active(x))),
        tile('Cancelled', money(s.cancelledRev), null, s.cancelledRev ? bad : null, drill('Cancelled revenue', (x) => serviced(x) && !!x.subscription_date_canceled)),
        tile('Avg contract', money(s.sold ? s.soldRev / s.sold : 0))]),
      group('Spend · QuickBooks, ' + (ctx.months || 0) + ' month' + (ctx.months === 1 ? '' : 's'), [
        tile('Spend', money(s.spend), s.spendWaiting ? fmt.usd0(s.spendWaiting) + ' waiting on a report' : 'by vendor, whole months', null),
        tile('Cost / lead', s.leads && s.spend ? fmt.usd0(s.spend / s.leads) : '—'),
        tile('CAC', s.sold && s.spend ? fmt.usd0(s.spend / s.sold) : '—', 'spend ÷ sold'),
        tile('Return', s.spend ? (s.soldRev / s.spend).toFixed(2) + 'x' : '—', 'sold revenue ÷ spend', s.spend ? (s.soldRev / s.spend >= 1 ? '#3E5A3A' : bad) : null)])));
  overlay.append(card); document.body.append(overlay);
}
