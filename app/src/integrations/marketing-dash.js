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
// Folded into Marketing › Dashboard (the old Metrics tab) per Isaac, Nov 18: the channels × offices grid and the
// hour chart sit below the tiles and above the year grid; the separate tab and its headline cards are gone.
function mktgDashBlocks(ym) {
  const D = mklMonth(ym);
  const lbl = typeof _mklLblS === 'function' ? _mklLblS(ym) : ym;
  return [mktgDashGridCard(D, lbl), mktgDashHoursCard(D, lbl)];
}
function mktgDashGridCard(D, lbl) {
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
  const unl = (c) => (c.unlinked || []).length;
  const linkedOf = (c) => c.linked != null ? c.linked : (c.s || 0) - unl(c);
  const rateL = (c) => c.leads ? linkedOf(c) / c.leads : null;
  const orphan = (c) => unl(c) > 0;

  // Grid: channels × offices. Shade = booking rate (darker = better), capped so one outlier cell doesn't flatten the rest.
  const maxRate = Math.max(0.05, ...channels.flatMap(c => offices.map(o => rateL(cellOf(o, c)) || 0)));
  const shade = (r) => r == null ? 'transparent' : 'rgba(95,108,91,' + (0.08 + 0.62 * Math.min(1, r / maxRate)).toFixed(2) + ')';
  const fg = (r) => r != null && r / maxRate > 0.55 ? '#fff' : 'var(--text)';
  const th = (t, right, st) => el('th', { class: 'px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap' + (right ? ' text-right' : ' text-left'), style: Object.assign({ color: 'var(--text-muted)', background: 'var(--card-2)' }, st || {}) }, t);
  // Red (per Isaac, Nov 18): sales with no GoHighLevel lead behind them — each sale is matched to the latest
  // opportunity on its phone or email on or before the sold date (mklMonth). A red cell has at least one such sale:
  // a lead that booked under another name / phone / email (expected now and then) or a sale with no opportunity at
  // all. Booking rate = linked sales ÷ leads, so a sale with no lead never inflates a channel's rate.
  const cellTd = (c, title, strong) => {
    const r = rateL(c), has = c.leads || c.s, red = orphan(c);
    return el('td', { class: 'px-1.5 py-1 text-center align-middle' + (has ? ' cursor-pointer' : ''), style: { background: red ? 'rgba(220,38,38,.14)' : has ? shade(r) : 'transparent', color: red ? '#B91C1C' : has ? fg(r) : 'var(--text-subtle)', minWidth: '84px', borderLeft: '1px solid var(--border)' },
      title: red ? unl(c) + ' sale' + (unl(c) === 1 ? '' : 's') + ' with no GoHighLevel lead on the phone or email — click for the list' : has ? 'Click for the leads and sales behind this cell' : '', onclick: has ? () => _mkdOpenCell(title, c, D) : null },
      has ? el('div', { class: 'leading-tight' },
        el('div', { class: 'text-[11px] tabular-nums' + (strong ? ' font-bold' : '') }, fmt.int(c.leads || 0) + ' · ' + fmt.int(linkedOf(c))),
        el('div', { class: 'text-[13px] font-black tabular-nums' }, pct(r)),
        red ? el('div', { class: 'text-[9px] font-bold' }, '+' + fmt.int(unl(c)) + ' no lead') : null) : '—');
  };
  const rowOf = (ch) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    el('td', { class: 'px-3 py-1 text-xs font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 } }, ch),
    ...offices.map(o => cellTd(cellOf(o, ch), ch + ' · ' + o)),
    cellTd(_mkdAgg(D, null, ch, rowTot(ch)), ch + ' · all offices', true));
  const totRow = el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } },
    el('td', { class: 'px-3 py-1.5 text-xs font-black', style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }, 'All channels'),
    ...offices.map(o => cellTd(_mkdAgg(D, o, null, colTot(o)), o + ' · all channels', true)),
    cellTd(_mkdAgg(D, null, null, { leads: leadsAll, s: booked, cv: D.cv }), 'RIDD · ' + lbl, true));
  const orphanN = (D.unlinked || []).length;
  const grid = el('div', { class: 'card overflow-hidden bar-sage' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Channels × offices · ' + lbl),
        el('div', { class: 'text-[11px]', style: muted }, 'Each cell: leads · booked (sales linked to a GoHighLevel lead by phone or email), then booking rate. Darker = higher; red = sales with no lead to link back to. Click a cell for the leads and the sales behind it.')),
      el('span', { class: 'ml-auto text-[11px]', style: muted }, channels.length + ' channels · ' + offices.length + ' offices' + (orphanN ? ' · ' : ''), orphanN ? el('span', { style: { color: '#B91C1C', fontWeight: 700 } }, orphanN + ' sale' + (orphanN === 1 ? '' : 's') + ' with no lead') : null)),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } },
      el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Channel', false, { position: 'sticky', left: 0, zIndex: 2 }), ...offices.map(o => th(o, false, { textAlign: 'center' })), th('All offices', false, { textAlign: 'center' }))),
        el('tbody', {}, ...channels.map(rowOf), totRow))),
    !channels.length ? el('div', { class: 'px-5 py-4 text-sm text-center', style: muted }, D.hasLeads ? 'No leads or sales for ' + lbl + ' yet.' : 'Waiting on GoHighLevel leads…') : null);

  return grid;
}
// Totals for a row / column / the whole grid, carrying the lead rows, sales, and the linked / unlinked split.
function _mkdAgg(D, office, channel, base) {
  const sales = _mkdSalesOf(D, office, channel);
  const unlinked = sales.filter(s => !s._mklLead);
  return Object.assign({ leadRows: _mkdLeadsOf(D, office, channel) }, base, { sales, unlinked, linked: sales.length - unlinked.length });
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
  const unlinked = c.unlinked || sales.filter(s => !s._mklLead), linkedN = c.linked != null ? c.linked : sales.length - unlinked.length;
  const r = c.leads ? linkedN / c.leads : null;
  const btn = (t, on, cls) => el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold ' + (cls || ''), style: { background: 'var(--accent)', color: 'var(--accent-text)' }, disabled: !on, onclick: on || null }, t);
  overlay.append(el('div', { class: 'card p-5 w-full flex flex-col gap-3', style: { maxWidth: '520px' } },
    el('div', { class: 'flex items-start justify-between gap-3' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, title),
        el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, fmt.int(c.leads || 0) + ' leads · ' + fmt.int(linkedN) + ' booked from a lead · ' + (r == null ? '—' : (r * 100).toFixed(1) + '%') + ' booking rate' + (c.cv ? ' · ' + fmt.usd0(c.cv) + ' contracted' : '')),
        unlinked.length ? el('div', { class: 'text-xs font-semibold', style: { color: '#B91C1C' } }, fmt.int(unlinked.length) + ' sale' + (unlinked.length === 1 ? '' : 's') + ' with no GoHighLevel lead on the phone or email') : null),
      el('button', { class: 'text-2xl leading-none text-muted- px-1', 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      btn('Leads (' + fmt.int(leads.length) + ')', leads.length ? () => { close(); _mkdOpenLeads(title + ' · leads', leads); } : null),
      btn('Booked sales (' + fmt.int(sales.length) + ')', sales.length ? () => { close(); mklOpenSales({ s: sales.length, cv: sales.reduce((a, s) => a + (Number(s.subscription_contract_value) || 0), 0), sales }, title + ' · booked'); } : null),
      unlinked.length ? el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold border', style: { borderColor: '#DC2626', color: '#DC2626' }, onclick: () => { close(); mklOpenSales({ s: unlinked.length, cv: unlinked.reduce((a, s) => a + (Number(s.subscription_contract_value) || 0), 0), sales: unlinked }, title + ' · booked with no lead'); } }, 'No lead (' + fmt.int(unlinked.length) + ')') : null),
    el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Leads are GoHighLevel opportunities by lead date and office; booked are FieldRoutes new sales by sold date and office, each matched to the latest opportunity on its phone or email on or before the sale (up to 180 days back). A lead and its sale can sit in different months.')));
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

// ── Traffic by hour (per Isaac, Nov 18): when leads come in — Calls, Forms, AI calls — as bars by hour of the
// day for the month on the bar. The sync stores each opportunity's time in UTC; every lead is shifted to its
// office's local clock (Eastern unless the office is Central or Mountain) so "after hours" means after hours.
// Lead type = the first stage the sync saw it in (AI Calls / New Lead - Forms / New Lead - Calls); leads that had
// already moved stage before the sync first saw them are "unknown" and shown as their own count, not guessed.
const MKD_OFFICE_TZ = { 'DESTIN': 'America/Chicago', 'JOPLIN': 'America/Chicago', 'LITTLE ROCK': 'America/Chicago', 'SALT LAKE': 'America/Denver', 'SALT LAKE CITY': 'America/Denver' };
function _mkdLocalHour(l) {
  if (!l.d || !l.t) return null;
  const tz = MKD_OFFICE_TZ[String(l.market || '').toUpperCase()] || 'America/New_York';
  const dt = new Date(l.d + 'T' + l.t + ':00Z');
  if (isNaN(dt)) return null;
  try { return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(dt)) % 24; } catch (e) { return dt.getUTCHours(); }
}
function mktgDashHoursCard(D, lbl) {
  const kind = state._mkdHourKind || 'call';
  const leads = _mkdLeadsOf(D, null, null);
  const typed = leads.filter(l => l.type === kind);
  const unknown = leads.filter(l => !l.type).length;
  const hours = new Array(24).fill(0); let counted = 0;
  for (const l of typed) { const h = _mkdLocalHour(l); if (h == null) continue; hours[h]++; counted++; }
  const max = Math.max(1, ...hours);
  const biz = (h) => h >= 8 && h < 18;   // shaded bars = 8am–6pm local
  const afterN = hours.reduce((a, v, h) => a + (biz(h) ? 0 : v), 0);
  const lab = (h) => h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p';
  const COL = { call: '#DF643A', form: '#5F6C5B', ai: '#323230' };
  const toggle = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...[['call', 'Calls'], ['form', 'Forms'], ['ai', 'AI calls']].map(([v, t]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-bold', style: kind === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._mkdHourKind = v; mountApp(); } }, t + ' ' + fmt.int(leads.filter(l => l.type === v).length))));
  const bars = el('div', { class: 'flex items-end gap-1', style: { height: '150px' } },
    ...hours.map((v, h) => el('div', { class: 'flex-1 flex flex-col items-center justify-end gap-1', title: lab(h) + ' · ' + fmt.int(v) + (biz(h) ? ' · business hours' : ' · after hours') },
      v ? el('div', { class: 'text-[9px] tabular-nums', style: { color: 'var(--text-muted)' } }, fmt.int(v)) : null,
      el('div', { style: { width: '100%', height: Math.max(2, Math.round(120 * v / max)) + 'px', background: COL[kind], opacity: biz(h) ? '1' : '.45', borderRadius: '2px 2px 0 0' } }))));
  const axis = el('div', { class: 'flex gap-1 mt-1' }, ...hours.map((_, h) => el('div', { class: 'flex-1 text-center text-[9px] tabular-nums', style: { color: h % 3 === 0 ? 'var(--text-muted)' : 'transparent' } }, lab(h))));
  return el('div', { class: 'card p-4', style: { borderTopColor: COL[kind] } },
    el('div', { class: 'flex items-center gap-3 flex-wrap mb-3' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Traffic by hour · ' + lbl),
        el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Each office’s local time · solid = 8am–6pm, faded = after hours · ' + fmt.int(afterN) + ' of ' + fmt.int(counted) + ' after hours' + (unknown ? ' · ' + fmt.int(unknown) + ' leads of unknown type (moved stage before the sync saw them)' : ''))),
      el('span', { class: 'ml-auto' }), toggle),
    counted ? el('div', {}, bars, axis) : el('div', { class: 'py-8 text-center text-sm', style: { color: 'var(--text-muted)' } }, 'No ' + ({ call: 'calls', form: 'forms', ai: 'AI calls' })[kind] + ' for ' + lbl + ' yet' + (unknown ? ' — the sync started keeping the entry stage on Nov 18; older leads show as unknown.' : '.')));
}
