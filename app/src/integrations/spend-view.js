// ┌─ src/integrations/spend-view.js ─────────────────────────────────────────
// │ Marketing → Spend (per Isaac, Nov 9): close the books by branch, simply.
// │   QuickBooks is the money. Every Advertising & Marketing line for the month
// │   belongs to a VENDOR (Facebook, Google Ads, DoLead, Angi…), and each
// │   vendor's dollars are split across BRANCHES by the best driver it has —
// │   the platform's own spend by branch (Google / Facebook through Windsor),
// │   a spreadsheet Isaac uploads for that vendor, GoHighLevel leads by branch,
// │   an even split, or one branch. Columns always add up to QuickBooks to the
// │   cent, so the Branch × Vendor table IS the month-end journal entry.
// │ The engine is spend-qbo.js (spqAllocMonth); the vendor spreadsheets are
// │ spend-uploads.js. This file is only the page: one table, the pieces that
// │ still need a hand, and the CSV for the controller.
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
function mktgSpendView() {
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const m = _spqStore();
  const { ym, yms } = _mktgCtrlMonth();
  const year = Number(ym.slice(0, 4));
  if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(year);
  const admin = isAdminRole(state.profile?.role);
  const muted = { color: 'var(--text-muted)' };
  const usd = (v) => (v < 0 ? '−' : '') + '$' + Math.abs(Math.round((v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usd0 = (v) => (v < 0 ? '−' : '') + '$' + Math.abs(Math.round(v || 0)).toLocaleString('en-US');
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const monthSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { state._mktCtrlMonth = e.target.value; mountApp(); } },
    ...yms.map(k => el('option', { value: k, selected: k === ym }, reportingMonthLbl(k))));
  const stat = (label, value, sub, color) => el('div', { class: 'rounded-xl p-3', style: { background: 'var(--card-2)' } },
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-xl font-black tabular-nums mt-0.5', style: color ? { color } : {} }, value),
    sub ? el('div', { class: 'text-[10px] mt-0.5', style: muted }, sub) : null);
  const th = (t, r, extra) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap align-bottom ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 }, extra || {}) }, t);
  const td = (t, st, r) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: st || {} }, t == null || t === '' ? '—' : t);

  const P = state.reportingIsSpendPayee;
  const head = () => el('div', { class: 'card px-5 py-3 flex items-center gap-3 flex-wrap' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Spend · ' + reportingMonthLbl(ym)), el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'QuickBooks marketing spend, allocated to branches')),
    el('span', { class: 'ml-auto' }), monthSel);
  if (!P) return el('div', { class: 'flex flex-col gap-4' }, head(), el('div', { class: 'card p-6 text-sm text-center', style: muted }, state._isSpendLoading ? 'Pulling QuickBooks…' : 'QuickBooks isn’t connected or hasn’t been pulled yet — Settings → Connections.'));
  if (!P.lines) return el('div', { class: 'flex flex-col gap-4' }, head(), el('div', { class: 'card p-6 text-sm text-center', style: muted }, 'QuickBooks is connected, but the line-by-line detail hasn’t been pulled yet. It arrives with the next QuickBooks refresh.'));
  const A = spqAllocMonth(ym);
  if (!A) return el('div', { class: 'flex flex-col gap-4' }, head(), el('div', { class: 'card p-6 text-sm text-center', style: muted }, 'No Advertising & Marketing lines in QuickBooks for ' + reportingMonthLbl(ym) + '.'));

  const vendors = Object.keys(A.byProv).sort((a, b) => A.byProv[b].amt - A.byProv[a].amt);
  const branches = A.branches.filter(b => vendors.some(v => (A.cells[v] || {})[b]));
  const brTot = (b) => vendors.reduce((a, v) => a + ((A.cells[v] || {})[b] || 0), 0);
  branches.sort((a, b) => brTot(b) - brTot(a));
  const allocTot = vendors.reduce((a, v) => a + Object.values(A.cells[v] || {}).reduce((x, c) => x + c, 0), 0);
  const bookedTot = Object.values(A.booked).reduce((a, v) => a + v, 0);
  const unplaced = A.lines.filter(L => !L.prov);
  const openCamps = (A.AD.open || []).filter(x => vendors.includes(x.prov));

  // CSV for the controller: one row per branch × vendor, plus branch totals — the journal entry.
  const csv = () => { const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const L = [['Month', 'Branch', 'Vendor', 'Amount'].join(',')];
    for (const b of branches) { for (const v of vendors) { const c = (A.cells[v] || {})[b]; if (c) L.push([ym, _mktgTC(b), spqLabel(v), c.toFixed(2)].map(esc).join(',')); } L.push([ym, _mktgTC(b), 'TOTAL', brTot(b).toFixed(2)].map(esc).join(',')); }
    L.push([ym, 'ALL BRANCHES', 'TOTAL', allocTot.toFixed(2)].map(esc).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv' })); a.download = 'ridd-marketing-by-branch-' + ym + '.csv'; a.click(); };

  const top = el('div', { class: 'card p-5' },
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2' },
      stat('QuickBooks · marketing', usd(A.total), A.lines.filter(L => L.prov !== SPQ_SKIP).length + ' lines' + (A.skipped ? ' · ' + usd0(A.skipped) + ' marked not marketing' : '')),
      stat('Allocated to branches', usd(allocTot), branches.length + ' branch' + (branches.length === 1 ? '' : 'es') + ' · ' + vendors.length + ' vendor' + (vendors.length === 1 ? '' : 's')),
      stat('Still to place', usd(A.unassigned), unplaced.length ? unplaced.length + ' line' + (unplaced.length === 1 ? '' : 's') + ' need a vendor' : 'every line has a vendor', A.unassigned > 0 ? '#B91C1C' : '#3E5A3A'),
      stat('Booked in QuickBooks', bookedTot ? usd(bookedTot) : '—', bookedTot ? (Math.abs(bookedTot - allocTot) > 1 ? 'differs from this table by ' + usd(Math.abs(bookedTot - allocTot)) : 'matches this table') : 'month-end entry not booked yet', bookedTot && Math.abs(bookedTot - allocTot) > 1 ? '#B45309' : undefined)));

  // ── Lines that still need a vendor: one row per payee, one pick saves the rule for every month. ──
  const chanOpts = typeof spqChannelOptions === 'function' ? spqChannelOptions() : [...new Set([...(m.channels || []), 'Google Ads', 'Google Local Services', 'Facebook'])].sort();
  const vendorPick = (L, onlyThis) => el('select', { class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: Object.assign({}, selSt, L.prov ? {} : { borderColor: '#DC2626' }),
    onchange: (e) => { let v = e.target.value; if (v === SPQ_NEW) { v = spqAskNewVendor(); if (!v) { mountApp(); return; } } spqSetRule(ym, L, v, !!onlyThis); } },
    el('option', { value: '', selected: !L.prov, disabled: true }, 'Pick a vendor…'),
    ...chanOpts.map(c => el('option', { value: c, selected: L.prov === c }, c)),
    el('option', { value: SPQ_TOOLS, selected: L.prov === SPQ_TOOLS }, SPQ_TOOLS_LABEL + ' (spread with the media)'),
    el('option', { value: SPQ_SKIP, selected: L.prov === SPQ_SKIP }, 'Not marketing'),
    el('option', { value: SPQ_NEW }, '+ New vendor…'));
  const byPayee = new Map();
  for (const L of unplaced) { const k = _spqKey(L.payee, L.memo); (byPayee.get(k) || byPayee.set(k, []).get(k)).push(L); }
  const placeCard = unplaced.length ? el('div', { class: 'card overflow-hidden', style: { borderColor: 'rgba(220,38,38,.45)' } },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold', style: { color: '#B91C1C' } }, 'Place these · ' + usd(A.unassigned)),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Pick the vendor once per payee — it’s remembered for every month.'))),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Date(s)'), th('Type'), th('Payee'), th('Memo'), th('Amount', true), th('Vendor'))),
      el('tbody', {}, ...[...byPayee.values()].sort((a, b) => b.reduce((x, L) => x + L.amt, 0) - a.reduce((x, L) => x + L.amt, 0)).map(ls => { const L = ls[0];
        // Dates of the charges (per Isaac, Nov 9 — so a line can be found in QuickBooks): every day in the group, oldest first.
        const days = [...new Set(ls.map(x => Number(x.day) || 0).filter(Boolean))].sort((a, b) => a - b);
        const dateTxt = ym.slice(5, 7) + '/' + days.map(d => String(d).padStart(2, '0')).join(', ' + ym.slice(5, 7) + '/') + (ls.length > 1 ? ' · ' + ls.length + ' lines' : '');
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(dateTxt, { fontFamily: 'ui-monospace, monospace', whiteSpace: 'normal', maxWidth: '220px' }), td(ls.every(x => x.journal) ? 'Journal' : ls.some(x => x.journal) ? 'Mixed' : 'Expense', muted),
          td(L.payee || '(no name)', { fontWeight: '600' }), td(L.memo, Object.assign({}, muted, { maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis' })), td(usd(ls.reduce((x, y) => x + y.amt, 0)), null, true),
          el('td', { class: 'px-3 py-1' }, admin ? vendorPick(L) : '—')); }))))) : null;

  // ── The table: branches down, vendors across, how each vendor is split under its name. ──
  const methodLabel = (v) => { const set = m.qbAlloc[v]; if (set && /^office:/.test(set)) return 'All to ' + _mktgTC(set.slice(7)); const L = { platform: 'Platform spend', upload: 'Upload', leads: 'GHL leads', even: 'Even split' }; if (set && L[set]) return L[set]; const how = String((A.byProv[v] || {}).how || ''); return /platform/i.test(how) ? 'Auto · platform' : /upload/i.test(how) ? 'Auto · upload' : /leads/i.test(how) ? 'Auto · leads' : /pro rata/i.test(how) ? 'With the media' : 'Auto · even'; };
  const methodSel = (v) => { const cur = m.qbAlloc[v] || 'auto';
    return el('select', { class: 'rounded border px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal', style: Object.assign({ maxWidth: '130px' }, selSt), title: 'How ' + spqLabel(v) + ' is split across branches · ' + ((A.byProv[v] || {}).how || ''),
      onchange: (e) => { const x = e.target.value; if (x === 'auto') delete m.qbAlloc[v]; else m.qbAlloc[v] = x; state._spqMemo = {}; state._mkpMemo = null; _mktgSave(); mountApp(); } },
      el('option', { value: 'auto', selected: cur === 'auto' }, methodLabel(v).startsWith('Auto') ? methodLabel(v) : 'Auto'),
      ...SPQ_METHODS.filter(([x]) => x !== 'auto').map(([x, l]) => el('option', { value: x, selected: cur === x }, l)),
      ...A.branches.map(b => el('option', { value: 'office:' + b, selected: cur === 'office:' + b }, 'All to ' + _mktgTC(b)))); };
  const table = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'By branch · ' + reportingMonthLbl(ym)),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Each vendor’s QuickBooks dollars, split by the driver under its name. Every column adds up to QuickBooks.')),
      el('button', { class: 'ml-auto rounded-lg px-3 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: csv }, '⬇ Close the books · CSV')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)', maxHeight: '70vh', overflowY: 'auto' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Branch'),
        ...vendors.map(v => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-right align-bottom', style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 },
            title: A.lines.filter(L => L.prov === v).sort((a, b) => a.day - b.day).map(L => ym.slice(5, 7) + '/' + String(L.day).padStart(2, '0') + '  ' + (L.journal ? 'JE  ' : '') + (L.payee || L.memo || '') + '  ' + usd(L.amt)).join('\n') },
          el('div', {}, spqLabel(v)), el('div', { class: 'mt-1 font-normal normal-case tracking-normal' }, admin && v !== SPQ_TOOLS ? methodSel(v) : el('span', { style: muted }, methodLabel(v))))),
        th('Total', true, { color: 'var(--text)' }), bookedTot ? th('Booked', true) : null)),
      el('tbody', {},
        ...branches.map(b => { const t = brTot(b), bk = A.booked[b] || 0;
          return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(_mktgTC(b), { fontWeight: '700' }),
            ...vendors.map(v => td((A.cells[v] || {})[b] ? usd((A.cells[v] || {})[b]) : '—', (A.cells[v] || {})[b] ? null : muted, true)),
            td(usd(t), { fontWeight: '800' }, true), bookedTot ? td(bk ? usd(bk) : '—', Math.abs(bk - t) > 1 ? { color: '#B45309', fontWeight: '600' } : muted, true) : null); }),
        el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } }, td('Total', { fontWeight: '800' }),
          ...vendors.map(v => td(usd(A.byProv[v].amt), { fontWeight: '700' }, true)), td(usd(allocTot), { fontWeight: '900' }, true), bookedTot ? td(usd(bookedTot), { fontWeight: '700' }, true) : null)))),
    !branches.length ? el('div', { class: 'px-5 py-4 text-sm text-center', style: muted }, !A.branches.length ? 'The branch list comes from the FieldRoutes snapshot — still loading.' : 'Nothing allocated yet — place the lines above first.') : null);

  // ── Campaigns with no branch (platform spend can't steer a split until they have one). ──
  const campCard = openCamps.length ? el('details', { class: 'card overflow-hidden' },
    el('summary', { class: 'px-5 py-3 text-sm font-bold cursor-pointer', style: { color: '#B45309' } }, 'Campaigns with no branch · ' + usd(openCamps.reduce((a, x) => a + x.spend, 0)) + ' of platform spend'),
    el('div', { class: 'px-5 pb-2 text-[11px]', style: muted }, 'Give each campaign its branch once (remembered). Google campaigns that span branches split themselves by the searchers’ metro.'),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Vendor'), th('Account'), th('Campaign'), th('Platform spend', true), th('Branch'))),
      el('tbody', {}, ...openCamps.map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(x.prov), td((x.r.acctName ? x.r.acctName + ' · ' : '') + x.r.acct, muted), td(x.r.campaign), td(usd(x.spend), null, true),
        el('td', { class: 'px-3 py-1' }, admin ? spuBranchPicker(A.branches, [], (picked) => { setAdCampaignOffice(x.k, picked.length === 1 ? picked[0] : picked); mountApp(); }, { empty: 'Pick branches…', save: 'Save · split evenly' }) : '—'))))))) : null;

  // ── Vendor spreadsheets (DoLead, Angi, Baton…): the manual driver. ──
  const uploads = (typeof mktgSpendUploadCard === 'function') ? el('details', { class: 'card overflow-hidden', open: !!(state._spendPending && state._spendPending.length) },
    el('summary', { class: 'px-5 py-3 text-sm font-bold cursor-pointer' }, 'Upload a vendor’s breakout by branch'),
    el('div', { class: 'px-5 pb-2 text-[11px]', style: muted }, 'For vendors that bill one total but send a report by market (DoLead, Angi, Baton…): drop the report, say which column is the location, and that vendor splits by it from then on.'),
    mktgSpendUploadCard(_mktgBranchList(year), year)) : null;

  // ── Every QuickBooks line as booked, with its vendor (for corrections). ──
  const lines = A.lines.slice().sort((a, b) => a.day - b.day || String(a.payee).localeCompare(String(b.payee)));
  const linesCard = el('details', { class: 'card overflow-hidden' },
    el('summary', { class: 'px-5 py-3 text-sm font-bold cursor-pointer' }, 'QuickBooks lines · ' + lines.length + ' · ' + usd(A.total + A.skipped)),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)', maxHeight: '60vh', overflowY: 'auto' } }, el('table', { class: 'w-full text-[12px]', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Date'), th('Type'), th('Payee'), th('Memo'), th('Account'), th('Amount', true), th('Vendor'))),
      el('tbody', {}, ...lines.map(L => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: L.prov ? '' : 'rgba(220,38,38,.06)' } },
        td(ym.slice(5, 7) + '/' + String(L.day || '').padStart(2, '0') + '/' + ym.slice(0, 4), { fontFamily: 'ui-monospace, monospace' }), td(L.journal ? 'Journal' : 'Expense', muted), td(L.payee, { fontWeight: '600' }),
        td(L.memo, Object.assign({}, muted, { maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis' })), td(L.acctLeaf || 'Advertising & Marketing', muted), td(usd(L.amt), L.amt < 0 ? { color: '#B91C1C' } : {}, true),
        el('td', { class: 'px-3 py-1' }, admin ? vendorPick(L, L.how === 'this charge only') : (spqLabel(L.prov) || '—'), L.how && !/your pick|payee|this charge only/.test(L.how) ? el('span', { class: 'ml-2 text-[10px]', style: muted }, L.how) : null)))))));

  return el('div', { class: 'flex flex-col gap-4' }, head(), top, placeCard, table, campCard, uploads, linesCard);
}
