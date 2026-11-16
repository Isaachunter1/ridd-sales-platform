// ┌─ dashp/ui ────────────────────────────────────────────────────────────────
// │ COMMISSIONS (DASHP) — the small pieces both screens are built from: stat
// │ tile, labelled line, qualifier chip, pill tabs, select, expandable card,
// │ and ONE table (dashpTable) that sorts, searches and filters in place.
// │ Self-contained on purpose (only el / fmt): nothing here reads DASHP data
// │ or app state beyond the store it is handed, so restyling the Commissions
// │ screens means editing this file and nothing else.
// │
// │ The table redraws ITSELF on a sort / search / filter instead of calling
// │ mountApp(), so typing in its search box keeps the cursor.
// └────────────────────────────────────────────────────────────────────────

function dashpCaption(text) {
  return el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, text);
}
function dashpSub(text) { return el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, text); }

// −$1,234 for money taken off, +$1,234 for money added back (signed = show the plus).
function dashpMoney(n, signed) { const v = Number(n) || 0; return (signed && v > 0 ? '+' : v < 0 ? '−' : '') + fmt.usd0(Math.abs(v)); }

function dashpStat(label, value, sub) {
  return el('div', { class: 'card p-4' }, dashpCaption(label), el('div', { class: 'text-xl font-black tabular-nums' }, value), sub ? dashpSub(sub) : null);
}
// Tiles that wrap on their own: as many across as fit, never narrower than 150px.
function dashpStatRow(...tiles) {
  return el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } }, ...tiles);
}

function dashpLine(label, sub, value, bold) {
  return el('div', { class: 'flex items-start justify-between gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)' } },
    el('div', {}, el('div', { class: bold ? 'text-sm font-bold' : 'text-xs font-semibold' }, label), sub ? dashpSub(sub) : null),
    el('div', { class: (bold ? 'text-sm font-black' : 'text-xs font-semibold') + ' tabular-nums text-right shrink-0' }, value));
}

// ok: true = green ✓, false = red ✗, null = grey (DASHP did not send that flag).
function dashpChip(ok, label, extra) {
  const style = ok == null ? { background: 'var(--card-2)', color: 'var(--text-subtle)' } : ok ? { background: 'rgba(22,163,74,.12)', color: '#16A34A' } : { background: 'rgba(220,38,38,.12)', color: '#DC2626' };
  return el('span', { class: 'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase', style },
    ok == null ? '·' : ok ? '✓' : '✗', ' ', label, extra ? el('span', { class: 'normal-case tracking-normal', style: { color: 'var(--text-subtle)', fontWeight: 600 } }, ' ' + extra) : null);
}
function dashpOkDot(ok) {
  return el('span', { class: 'inline-flex items-center justify-center rounded-full text-[10px] font-black', style: { width: '20px', height: '20px', background: ok ? 'rgba(22,163,74,.15)' : 'rgba(220,38,38,.12)', color: ok ? '#16A34A' : '#DC2626' } }, ok ? '✓' : '✗');
}

// items: [[value, label], …]
function dashpTabs(items, cur, onPick) {
  return el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...items.map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold transition', style: String(cur) === String(v) ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => onPick(v) }, l)));
}
function dashpSelect(label, val, opts, onPick) {
  return el('div', { class: 'flex items-center gap-2' }, dashpCaption(label),
    el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => onPick(e.target.value) },
      ...opts.map(([v, l]) => el('option', { value: String(v), selected: String(v) === String(val) }, l))));
}
function dashpNotice(msg) { return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, msg); }

// A card that opens in place. body = a function, so nothing inside is built until it is opened.
function dashpExpand(S, key, title, summary, body) {
  const wrap = el('div', { class: 'card overflow-hidden' });
  const draw = () => {
    const open = !!S.open[key];
    wrap.replaceChildren(
      el('button', { class: 'w-full flex items-center justify-between px-3 py-2 text-left', onclick: () => { if (body) { S.open[key] = !open; draw(); } } },
        el('span', { class: 'text-xs font-bold' }, (body ? (open ? '▾ ' : '▸ ') : '') + title), el('span', { class: 'text-xs font-semibold tabular-nums' }, summary)),
      ...(open && body ? [el('div', { class: 'px-3 pb-2' }, body())] : []));
  };
  draw();
  return wrap;
}

// ── The table ────────────────────────────────────────────────────────────────
// cfg = {
//   title,                       caption above the table
//   rows,                        the data (never mutated)
//   columns: [{ id, label, align: 'right' | 'center',
//               cell(row) → text or Node, sub(row) → small second line (optional),
//               value(row) → what a header click sorts by (omit = not sortable) }],
//   onRow(row),                  optional — the whole row is clickable; canOpen(row) can switch that off per row
//   search(row) → text,          optional — adds the search box; placeholder is its hint
//   filters: [[id, label, test(row)]], defaultFilter      optional pill filters
//   defaultSort: { id, dir: 'asc' | 'desc' },
//   summary(shownRows) → Node,   optional strip above the header row
//   empty,                       text when nothing matches
// }
// key names this table's sort / search / filter in the store, so they survive a re-render.
function dashpTable(S, key, cfg) {
  const tableHost = el('div', { class: 'card overflow-hidden' });
  const pillHost = el('div', {});
  const head = (c, sort) => {
    const on = sort && sort.id === c.id;
    return el('th', { class: 'text-[9px] uppercase tracking-widest font-semibold py-2 px-2 whitespace-nowrap ' + (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left') + (c.value ? ' cursor-pointer' : ''),
      style: { color: on ? 'var(--text)' : 'var(--text-subtle)' },
      onclick: c.value ? () => { S.sort[key] = on ? { id: c.id, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { id: c.id, dir: typeof c.value(cfg.rows[0] || {}) === 'number' ? 'desc' : 'asc' }; draw(); } : null },
      c.label + (on ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''));
  };
  const draw = () => {
    const sort = S.sort[key] || cfg.defaultSort || null;
    const q = String(S.search[key] || '').trim().toLowerCase();
    const filt = S.filter[key] || cfg.defaultFilter || 'all';
    const test = ((cfg.filters || []).find(f => f[0] === filt) || [])[2];
    let rows = cfg.rows.filter(r => (!test || test(r)) && (!q || !cfg.search || cfg.search(r).toLowerCase().includes(q)));
    const col = sort && cfg.columns.find(c => c.id === sort.id);
    if (col && col.value) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = rows.slice().sort((a, b) => {
        const av = col.value(a), bv = col.value(b);
        if (av == null || bv == null) return (av == null ? 1 : 0) - (bv == null ? 1 : 0);   // blanks always last
        return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * dir;
      });
    }
    if (cfg.filters) pillHost.replaceChildren(dashpTabs(cfg.filters.map(([v, l, t]) => [v, l + ' ' + cfg.rows.filter(r => !t || t(r)).length]), filt, (v) => { S.filter[key] = v; draw(); }));
    tableHost.replaceChildren(
      ...(cfg.summary ? [el('div', { class: 'flex items-center justify-between px-3 py-2 text-[11px]', style: { background: 'var(--card-2)' } }, cfg.summary(rows))] : []),
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
        el('thead', {}, el('tr', { style: { borderBottom: '1px solid var(--border)' } }, ...cfg.columns.map(c => head(c, sort)))),
        el('tbody', {}, ...(rows.length ? rows.map(r => {
          const open = cfg.onRow && (!cfg.canOpen || cfg.canOpen(r));
          return el('tr', { class: open ? 'cursor-pointer' : '', style: { borderBottom: '1px solid var(--border)' }, onclick: open ? () => cfg.onRow(r) : null },
            ...cfg.columns.map(c => el('td', { class: 'px-2 py-2 tabular-nums ' + (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left') },
              el('div', {}, c.cell(r)), c.sub ? (() => { const s = c.sub(r); return s == null || s === '' ? null : (s instanceof Node ? s : dashpSub(s)); })() : null)));
        }) : [el('tr', {}, el('td', { colspan: cfg.columns.length, class: 'px-3 py-6 text-center text-muted-' }, (q ? 'Nothing matches “' + q + '”.' : cfg.empty || 'Nothing to show.')))])))));
  };
  draw();
  return el('div', { class: 'flex flex-col gap-2' },
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
      dashpCaption(cfg.title || ''),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        cfg.search ? el('input', { type: 'search', placeholder: cfg.placeholder || 'Search', value: S.search[key] || '', class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '220px' }, oninput: (e) => { S.search[key] = e.target.value; draw(); } }) : null,
        cfg.filters ? pillHost : null)),
    tableHost);
}

// ── The sales table (one row per sale) — shared by both detail screens ──────
// opts.kind: 'tech' adds Personal / Upsells pills, the Upfront paid mark and the per-sale commission;
//            'd2d'  adds the agreement length and the sale's office (DASHP has no per-sale amount for sales reps).
function dashpSalesTable(S, key, sales, opts) {
  const tech = opts.kind === 'tech';
  const columns = [
    { id: 'ok', label: 'OK', align: 'center', cell: s => dashpOkDot(s.ok), value: s => (s.ok ? 1 : 0) },
    { id: 'customer', label: 'Customer', value: s => s.customer,
      cell: s => el('div', { class: 'flex items-baseline gap-2 flex-wrap' }, el('span', { class: 'font-semibold' }, s.customer), s.customerId ? el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '#' + s.customerId) : null),
      sub: s => el('div', { class: 'flex items-center gap-1 flex-wrap mt-1' }, dashpChip(s.serviced, 'Serviced'), dashpChip(s.active, 'Active'), dashpChip(s.apay, 'APAY'), dashpChip(s.noBalance, 'No balance', s.balance > 0 ? 'bal ' + fmt.usd0(s.balance) : null),
        s.reason ? el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, s.reason) : null) },
    { id: 'subscription', label: 'Subscription', value: s => s.subscription, cell: s => el('span', { class: 'font-semibold' }, s.subscription || '—'),
      sub: s => [tech ? (s.kind === 'upsell' ? 'Upsell' : 'Personal') : '', s.category, s.audit].filter(Boolean).join(' · ') },
    { id: 'sold', label: 'Sold', value: s => s.sold, cell: s => el('span', { class: 'whitespace-nowrap' }, s.soldLabel || '—'),
      sub: s => (tech ? (s.upfrontPaid ? dashpChip(true, 'Upfront paid') : null) : s.office) },
    ...(tech ? [] : [{ id: 'months', label: 'Agreement', align: 'right', value: s => s.months, cell: s => (s.months > 0 ? s.months + ' mo' : '—') }]),
    { id: 'contract', label: 'Contract', align: 'right', value: s => s.contract, cell: s => fmt.usd0(s.contract) },
    ...(tech ? [{ id: 'commission', label: 'Comm.', align: 'right', value: s => s.commission, cell: s => el('span', { class: 'font-black' }, s.commission == null ? '—' : fmt.usd0(s.commission)) }] : []),
  ];
  return dashpTable(S, key, {
    title: 'Sales detail', rows: sales, columns, defaultSort: { id: 'sold', dir: 'desc' },
    search: s => [s.customer, s.customerId, s.subscription, s.category, s.office].join(' '), placeholder: 'Search customer, ID, or subscription',
    filters: tech ? [['all', 'All'], ['personal', 'Personal', s => s.kind === 'personal'], ['upsell', 'Upsells', s => s.kind === 'upsell']]
      : [['all', 'All'], ['yes', 'Qualified', s => s.ok], ['no', 'Not qualified', s => !s.ok]],
    summary: rows => [el('span', { class: 'font-semibold' }, rows.filter(s => s.ok).length + ' of ' + rows.length + ' qualified'),
      el('span', {}, el('span', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, tech ? 'Comm. ' : 'Qualified contract '), el('span', { class: 'font-black tabular-nums' }, fmt.usd0(rows.reduce((a, s) => a + (tech ? (s.commission || 0) : (s.ok ? s.contract : 0)), 0))))],
    empty: 'No sales in this period.',
  });
}