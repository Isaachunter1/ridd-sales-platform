// ┌─ src/integrations/spend-view.js ─────────────────────────────────────────
// │ Marketing → Spend, rebuilt from scratch (per Isaac, Nov 7): two things,
// │ nothing else yet.
// │   1. New revenue from FieldRoutes for the range at the top — Office Staff
// │      new sales (pending / serviced, renewals out, upsells in), the same
// │      number the CAC matrix and Pulse read.
// │   2. Every QuickBooks "Advertising & Marketing" line for the range, as
// │      QuickBooks shows it: date · type · name · memo · account · amount,
// │      with a total and a by-account strip. No mapping, no allocation —
// │      breaking it out by branch is Isaac's next step.
// │ Range = the Marketing year bar + the month picker here (one month, or the
// │ whole year). Lines come from state.reportingIsSpendPayee.lines[ym]
// │ ([day, payee, memo, amount, account leaf, txn id, 'J' for a journal entry]),
// │ pulled by netlify/functions/qbo-spend-refresh-background.js.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function mktgSpendView() {
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  const y = _mktgYearSel();
  const muted = { color: 'var(--text-muted)' };
  const usd2 = (v) => (v < 0 ? '−' : '') + '$' + Math.abs(Math.round((v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  // Month picker: the year's months (whole year first), newest first; the pick persists per session.
  const now = new Date();
  const months = []; for (let i = 11; i >= 0; i--) { if (y < now.getFullYear() || i <= now.getMonth()) months.push(_mktgYm(y, i)); }
  const pick = (state._mktSpendMonth && (state._mktSpendMonth === 'year:' + y || months.includes(state._mktSpendMonth))) ? state._mktSpendMonth : 'year:' + y;
  const yms = pick.startsWith('year:') ? months.slice().reverse() : [pick];
  const rangeLbl = pick.startsWith('year:') ? String(y) : reportingMonthLbl(pick);
  const monthSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { state._mktSpendMonth = e.target.value; mountApp(); } },
    el('option', { value: 'year:' + y, selected: pick === 'year:' + y }, 'Whole year · ' + y),
    ...months.map(k => el('option', { value: k, selected: k === pick }, reportingMonthLbl(k))));

  // 1 · New revenue (FieldRoutes) for the range.
  const A = _mktgActuals(y);
  let rev = 0, subs = 0;
  for (const ym of yms) { const i = Number(ym.slice(5, 7)) - 1; const t = A.total[i]; if (t) { rev += t.rev + t.upRev; subs += t.subs + t.upsells; } }

  // 2 · QuickBooks lines for the range.
  const P = state.reportingIsSpendPayee;
  const lines = [];
  if (P && P.lines) for (const ym of yms) for (const L of (P.lines[ym] || [])) {
    lines.push({ date: ym + '-' + String(L[0] || '').padStart(2, '0'), type: L[6] === 'J' ? 'Journal entry' : 'Expense', name: L[1] || '', memo: L[2] || '', acct: 'Advertising & Marketing' + (L[4] ? ':' + L[4] : ''), amt: Number(L[3]) || 0, txn: L[5] || '' });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)));
  const total = lines.reduce((t, L) => t + L.amt, 0);
  const byAcct = {}; for (const L of lines) byAcct[L.acct] = (byAcct[L.acct] || 0) + L.amt;
  const accts = Object.entries(byAcct).sort((a, b) => b[1] - a[1]);

  const th = (t, r) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
  const td = (t, st, r) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: st || {} }, t == null || t === '' ? '—' : t);
  const stat = (label, value, sub) => el('div', { class: 'rounded-xl p-3', style: { background: 'var(--card-2)' } },
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-xl font-black tabular-nums mt-0.5' }, value),
    sub ? el('div', { class: 'text-[10px] mt-0.5', style: muted } , sub) : null);

  const head = el('div', { class: 'card px-5 py-3 flex items-center gap-3 flex-wrap' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Spend'), el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'QuickBooks Advertising & Marketing, line by line, against FieldRoutes new revenue · ' + rangeLbl)),
    el('span', { class: 'ml-auto' }), monthSel);

  const top = el('div', { class: 'card p-5' },
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2' },
      stat('New revenue · FieldRoutes', fmt.usd0(rev), fmt.int(subs) + ' new sale' + (subs === 1 ? '' : 's') + ' · Office Staff · pending / serviced · renewals out'),
      stat('Marketing spend · QuickBooks', usd2(total), lines.length + ' line' + (lines.length === 1 ? '' : 's') + (P && P.pulledAt ? ' · pulled ' + new Date(P.pulledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')),
      stat('Spend ÷ new revenue', rev > 0 ? (total / rev * 100).toFixed(1) + '%' : '—', 'ad spend only — no wages'),
      stat('Revenue ÷ spend', total > 0 ? (rev / total).toFixed(2) + '×' : '—', 'contract value per marketing dollar')));

  if (!P) return el('div', { class: 'flex flex-col gap-4' }, head, top, el('div', { class: 'card p-6 text-sm text-center', style: muted }, state._isSpendLoading ? 'Pulling QuickBooks…' : 'QuickBooks isn’t connected or hasn’t been pulled yet — Settings → Connections.'));
  if (!P.lines) return el('div', { class: 'flex flex-col gap-4' }, head, top, el('div', { class: 'card p-6 text-sm text-center', style: muted }, 'QuickBooks is connected, but the line-by-line detail hasn’t been pulled yet. It arrives with the next QuickBooks refresh.'));

  // By-account strip (how QuickBooks groups the report), then the lines.
  const acctStrip = accts.length ? el('div', { class: 'card px-5 py-3 flex items-center gap-4 flex-wrap text-[11px]' },
    el('span', { class: 'uppercase tracking-widest font-semibold', style: { fontSize: '9px', color: 'var(--text-subtle)' } }, 'By account'),
    ...accts.map(([a, v]) => el('span', { class: 'tabular-nums' }, el('span', { style: muted }, a.replace(/^Advertising & Marketing:?/, '') || 'Advertising & Marketing'), ' ', el('strong', {}, usd2(v))))) : null;

  const csv = () => {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Date', 'Transaction type', 'Name', 'Memo/Description', 'Account', 'Amount'].join(',')];
    for (const L of lines) rows.push([L.date, L.type, L.name, L.memo, L.acct, L.amt.toFixed(2)].map(esc).join(','));
    rows.push(['', '', '', '', 'Total', total.toFixed(2)].map(esc).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); a.download = 'quickbooks-marketing-' + rangeLbl.replace(/\s+/g, '-') + '.csv'; a.click();
  };
  const table = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('div', { class: 'text-sm font-bold' }, 'QuickBooks · Advertising & Marketing · ' + rangeLbl), el('div', { class: 'text-[11px]', style: muted }, 'Every line as QuickBooks books it. The month-end entry that only moves spend between the marketing accounts is left out (it nets to $0).')),
      el('button', { class: 'ml-auto rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: csv }, '⬇ CSV')),
    lines.length === 0
      ? el('div', { class: 'p-6 text-sm text-center', style: muted }, 'No Advertising & Marketing lines in QuickBooks for ' + rangeLbl + '.')
      : el('div', { class: 'scroll-x', style: { maxHeight: '70vh', overflowY: 'auto' } },
        el('table', { class: 'w-full text-[12px]' },
          el('thead', {}, el('tr', {}, th('Date'), th('Type'), th('Name'), th('Memo / description'), th('Account'), th('Amount', true))),
          el('tbody', {},
            ...lines.map(L => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              td(L.date.slice(5, 7) + '/' + L.date.slice(8, 10) + '/' + L.date.slice(0, 4), { fontFamily: 'ui-monospace, monospace' }),
              td(L.type, muted),
              td(L.name, { fontWeight: '600' }),
              td(L.memo, Object.assign({}, muted, { maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis' })),
              td(L.acct.replace(/^Advertising & Marketing:?/, '') || 'Advertising & Marketing', muted),
              td(usd2(L.amt), L.amt < 0 ? { color: '#B91C1C' } : {}, true))),
            el('tr', { class: 'border-t', style: { borderColor: 'var(--text)', background: 'var(--card-2)' } },
              el('td', { class: 'px-3 py-2 font-black', colspan: 5 }, 'Total · ' + rangeLbl),
              el('td', { class: 'px-3 py-2 text-right tabular-nums font-black' }, usd2(total)))))));
  return el('div', { class: 'flex flex-col gap-4' }, head, top, acctStrip, table);
}
