// ┌─ integrations/marketing-dash.js ─────────────────────────────────────────
// │ Marketing › Dashboard (per Isaac, Nov 18 — from Pest AI's "Lead Command
// │ Center" plan, the parts our data already answers): headline cards, then
// │ one grid with every CHANNEL as a row and every OFFICE as a column. Each
// │ cell is leads · booked · booking rate for the month on the Metrics bar,
// │ shaded by booking rate, and clicks through to the leads and the sales
// │ behind it. Same numbers as Metrics (mklMonth): leads = GoHighLevel
// │ opportunities, booked = FieldRoutes new sales (initial pending or serviced).
// │ Contact rate and the Untouched / Chasing / Waiting / Engaged buckets need
// │ GoHighLevel conversations, which the sync does not pull yet — the card at
// │ the bottom says so instead of showing a zero.
// └────────────────────────────────────────────────────────────────────────
function mktgDashView() {
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function' && state._ghl === undefined) ghlLoadLeads();
  const F = mklState(); const ym = F.ym;
  const D = mklMonth(ym);
  const lbl = typeof _mklLblS === 'function' ? _mklLblS(ym) : ym;
  const muted = { color: 'var(--text-muted)' };
  const skip = (k) => /^(Unspecified|No branch)$/.test(k);
  const unmappedKey = 'Unmapped GHL source';
  const X = D.x || {};
  const offices = Object.keys(D.br || {}).filter(k => !skip(k) && ((D.br[k].leads || 0) || (D.br[k].s || 0))).sort((a, b) => (D.br[b].leads || 0) - (D.br[a].leads || 0) || a.localeCompare(b));
  const channels = Object.keys(D.ch || {}).filter(k => !skip(k) && k !== unmappedKey && ((D.ch[k].leads || 0) || (D.ch[k].s || 0))).sort((a, b) => (D.ch[b].leads || 0) - (D.ch[a].leads || 0) || a.localeCompare(b));
  const cellOf = (o, c) => (X[o] && X[o][c]) || { leads: 0, s: 0, cv: 0, sales: [], leadRows: [] };
  const rowTot = (c) => D.ch[c] || { leads: 0, s: 0, cv: 0 };
  const colTot = (o) => D.br[o] || { leads: 0, s: 0, cv: 0 };
  const rate = (c) => c.leads ? c.s / c.leads : null;
  const leadsAll = D.leads || 0, booked = D.s || 0, unm = (D.ch[unmappedKey] && D.ch[unmappedKey].leads) || 0;
  const pct = (v) => v == null ? '—' : (v * 100).toFixed(0) + '%';

  // Headline cards — the color bar on top is the one Isaac asked for across the app (card-bar classes, app.css).
  const card = (bar, label, value, sub, onClick) => el('div', { class: 'card p-4 flex flex-col gap-1 ' + bar + (onClick ? ' cursor-pointer hover:brightness-95' : ''), onclick: onClick || null },
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-2xl font-black tabular-nums' }, value),
    sub ? el('div', { class: 'text-[10px]', style: muted }, sub) : null);
  const openLeads = (title, rows) => _mkdOpenLeads(title, rows);
  const cards = el('div', { class: 'grid grid-cols-2 lg:grid-cols-4 gap-3' },
    card('bar-charcoal', 'Leads · ' + lbl, D.hasLeads ? fmt.int(leadsAll) : '—', D.hasLeads ? 'GoHighLevel opportunities, one per person per 30 days' : 'GoHighLevel not loaded'),
    card('bar-sage', 'Booked', fmt.int(booked), 'FieldRoutes new sales · initial pending or serviced', booked ? () => mklOpenSales(D, 'Booked · ' + lbl) : null),
    card('', 'Booking rate', D.hasLeads && leadsAll ? pct(booked / leadsAll) : '—', 'booked ÷ leads'),
    card('bar-red', 'Unmapped leads', D.hasLeads ? fmt.int(unm) : '—', D.hasLeads && leadsAll ? pct(unm / (leadsAll)) + ' of leads · not counted in any channel until mapped' : 'map them on Metrics', unm ? () => openLeads('Unmapped GoHighLevel sources · ' + lbl, (D.ch[unmappedKey] && D.ch[unmappedKey].leadRows) || _mkdLeadsOf(D, null, unmappedKey)) : null));

  // Grid: channels × offices. Shade = booking rate (darker = better), capped so one outlier cell doesn't flatten the rest.
  const maxRate = Math.max(0.05, ...channels.flatMap(c => offices.map(o => rate(cellOf(o, c)) || 0)));
  const shade = (r) => r == null ? 'transparent' : 'rgba(95,108,91,' + (0.08 + 0.62 * Math.min(1, r / maxRate)).toFixed(2) + ')';
  const fg = (r) => r != null && r / maxRate > 0.55 ? '#fff' : 'var(--text)';
  const th = (t, right, st) => el('th', { class: 'px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap' + (right ? ' text-right' : ' text-left'), style: Object.assign({ color: 'var(--text-muted)', background: 'var(--card-2)' }, st || {}) }, t);
  const cellTd = (c, title, strong) => {
    const r = rate(c), has = c.leads || c.s;
    return el('td', { class: 'px-1.5 py-1 text-center align-middle' + (has ? ' cursor-pointer' : ''), style: { background: has ? shade(r) : 'transparent', color: has ? fg(r) : 'var(--text-subtle)', minWidth: '84px', borderLeft: '1px solid var(--border)' },
      title: has ? 'Click for the leads and sales behind this cell' : '', onclick: has ? () => _mkdOpenCell(title, c, D) : null },
      has ? el('div', { class: 'leading-tight' },
        el('div', { class: 'text-[11px] tabular-nums' + (strong ? ' font-bold' : '') }, fmt.int(c.leads || 0) + ' · ' + fmt.int(c.s || 0)),
        el('div', { class: 'text-[13px] font-black tabular-nums' }, pct(r))) : '—');
  };
  const rowOf = (ch) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    el('td', { class: 'px-3 py-1 text-xs font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 } }, ch),
    ...offices.map(o => cellTd(cellOf(o, ch), ch + ' · ' + o)),
    cellTd(Object.assign({ leadRows: _mkdLeadsOf(D, null, ch) }, rowTot(ch), { sales: _mkdSalesOf(D, null, ch) }), ch + ' · all offices', true));
  const totRow = el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } },
    el('td', { class: 'px-3 py-1.5 text-xs font-black', style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }, 'All channels'),
    ...offices.map(o => cellTd(Object.assign({ leadRows: _mkdLeadsOf(D, o, null) }, colTot(o), { sales: _mkdSalesOf(D, o, null) }), o + ' · all channels', true)),
    cellTd({ leads: leadsAll, s: booked, cv: D.cv, sales: D.sales, leadRows: _mkdLeadsOf(D, null, null) }, 'RIDD · ' + lbl, true));
  const grid = el('div', { class: 'card overflow-hidden bar-sage' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Channels × offices · ' + lbl),
        el('div', { class: 'text-[11px]', style: muted }, 'Each cell: leads · booked, then booking rate. Darker = higher booking rate. Click a cell for the leads and the sales behind it.')),
      el('span', { class: 'ml-auto text-[11px]', style: muted }, channels.length + ' channels · ' + offices.length + ' offices')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } },
      el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Channel', false, { position: 'sticky', left: 0, zIndex: 2 }), ...offices.map(o => th(o, false, { textAlign: 'center' })), th('All offices', false, { textAlign: 'center' }))),
        el('tbody', {}, ...channels.map(rowOf), totRow))),
    !channels.length ? el('div', { class: 'px-5 py-4 text-sm text-center', style: muted }, D.hasLeads ? 'No leads or sales for ' + lbl + ' yet.' : 'Waiting on GoHighLevel leads…') : null);

  // What the plan asks for that the data can't answer yet — said plainly instead of a zero.
  const soon = el('div', { class: 'card p-4 bar-charcoal' },
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Not here yet'),
    el('div', { class: 'text-sm mt-1' }, 'Contact rate, attempts and the Untouched · Chasing · Waiting on RIDD · Engaged buckets need GoHighLevel conversations (calls, texts, emails with direction). The hourly sync pulls contacts and opportunities only; once it pulls conversations, those land here as columns per channel and office.'));

  return el('div', { class: 'flex flex-col gap-4' }, cards, grid, soon);
}
// Leads behind an office / channel / both (null = all) for the month.
function _mkdLeadsOf(D, office, channel) {
  const out = [];
  for (const o in (D.x || {})) { if (office && o !== office) continue; for (const c in D.x[o]) { if (channel && c !== channel) continue; for (const l of (D.x[o][c].leadRows || [])) out.push(l); } }
  return out;
}
function _mkdSalesOf(D, office, channel) {
  const out = [];
  for (const o in (D.x || {})) { if (office && o !== office) continue; for (const c in D.x[o]) { if (channel && c !== channel) continue; for (const s of (D.x[o][c].sales || [])) out.push(s); } }
  return out;
}
function _mkdOpenCell(title, c, D) {
  const leads = c.leadRows || [], sales = c.sales || [];
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const r = c.leads ? c.s / c.leads : null;
  const btn = (t, on, cls) => el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold ' + (cls || ''), style: { background: 'var(--accent)', color: 'var(--accent-text)' }, disabled: !on, onclick: on || null }, t);
  overlay.append(el('div', { class: 'card p-5 w-full flex flex-col gap-3', style: { maxWidth: '520px' } },
    el('div', { class: 'flex items-start justify-between gap-3' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, title),
        el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, fmt.int(c.leads || 0) + ' leads · ' + fmt.int(c.s || 0) + ' booked · ' + (r == null ? '—' : (r * 100).toFixed(1) + '%') + ' booking rate' + (c.cv ? ' · ' + fmt.usd0(c.cv) + ' contracted' : ''))),
      el('button', { class: 'text-2xl leading-none text-muted- px-1', 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      btn('Leads (' + fmt.int(leads.length) + ')', leads.length ? () => { close(); _mkdOpenLeads(title + ' · leads', leads); } : null),
      btn('Booked sales (' + fmt.int(sales.length) + ')', sales.length ? () => { close(); mklOpenSales({ s: sales.length, cv: sales.reduce((a, s) => a + (Number(s.subscription_contract_value) || 0), 0), sales }, title + ' · booked'); } : null)),
    el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Leads are GoHighLevel opportunities by lead date and the office their ZIP maps to; booked are FieldRoutes new sales by sold date and office. The two are counted separately, so a lead and its sale can sit in different months.')));
  document.body.append(overlay);
}
// The leads behind a number: date, source label, channel, office, stage, type. No names on screen — GoHighLevel
// is the place to open a lead; this is the list to reconcile against.
function _mkdOpenLeads(title, rows) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const sorted = rows.slice().sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')) || String(b.t || '').localeCompare(String(a.t || '')));
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
  const td = (t, cls) => el('td', { class: 'px-2 py-1 whitespace-nowrap ' + (cls || '') }, t == null || t === '' ? '—' : String(t));
  const mask = (p) => { const s = String(p || '').replace(/\D/g, ''); return s.length >= 4 ? '···' + s.slice(-4) : ''; };
  overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '860px' } },
    el('div', { class: 'flex items-center justify-between gap-3 mb-3' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, title), el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, fmt.int(sorted.length) + ' lead' + (sorted.length === 1 ? '' : 's'))),
      el('button', { class: 'text-2xl leading-none text-muted- px-1', 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { style: { maxHeight: '62vh', overflowY: 'auto' } },
      el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Date'), th('Source (GoHighLevel)'), th('Channel'), th('Office'), th('Stage'), th('Type'), th('Phone'))),
        el('tbody', {}, ...sorted.slice(0, 1500).map(l => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(l.d, 'tabular-nums'), td(l.label), td(l.prov === 'Unmapped' ? 'Unmapped' : l.prov), td(l.market), td(l.stage), td(l.type), td(mask(l.p), 'tabular-nums')))))),
    sorted.length > 1500 ? el('div', { class: 'text-[10px] mt-2', style: { color: 'var(--text-subtle)' } }, 'Showing the newest 1,500.') : null));
  document.body.append(overlay);
}
