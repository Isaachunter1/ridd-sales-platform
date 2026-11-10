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
    el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Spend · ' + reportingMonthLbl(ym)), el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'QuickBooks marketing spend by provider and by branch, each provider’s own statement beside it, and the month’s wages')),
    el('span', { class: 'ml-auto' }), monthSel);
  const authGone = state._authExpired ? el('div', { class: 'card p-4 flex items-center gap-3 flex-wrap', style: { borderColor: 'rgba(220,38,38,.5)' } },
    el('div', { class: 'text-sm' }, el('span', { class: 'font-bold', style: { color: '#B91C1C' } }, 'Your sign-in has expired. '), 'QuickBooks and Windsor data can’t load until you sign in again.'),
    el('button', { class: 'ml-auto rounded-lg px-3 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => location.reload() }, 'Reload & sign in')) : null;
  if (!P) return el('div', { class: 'flex flex-col gap-4' }, head(), authGone, el('div', { class: 'card p-6 text-sm text-center', style: muted }, state._isSpendLoading ? 'Pulling QuickBooks…' : state._authExpired ? 'Reload the app to sign in again.' : 'QuickBooks isn’t connected or hasn’t been pulled yet — Settings → Connections.'));
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
  const waiting = Object.entries(A.waiting || {}).sort((a, b) => b[1].amt - a[1].amt);
  const waitingAmt = waiting.reduce((a, [, w]) => a + w.amt, 0);
  const openCamps = (A.AD.open || []).filter(x => vendors.includes(x.prov));

  // CSV for the controller (per Isaac, Nov 9): the By-branch table exactly as shown — one row per branch, a column
  // per vendor, a Total column, and a Total row — so the branch totals read straight off it.
  const csv = () => { const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const L = [['Branch', ...vendors.map(spqLabel), 'Total', ...(bookedTot ? ['Booked in QuickBooks'] : [])].map(esc).join(',')];
    for (const b of branches) L.push([_mktgTC(b), ...vendors.map(v => ((A.cells[v] || {})[b] || 0).toFixed(2)), brTot(b).toFixed(2), ...(bookedTot ? [(A.booked[b] || 0).toFixed(2)] : [])].map(esc).join(','));
    L.push(['Total', ...vendors.map(v => A.byProv[v].amt.toFixed(2)), allocTot.toFixed(2), ...(bookedTot ? [bookedTot.toFixed(2)] : [])].map(esc).join(','));
    L.push(''); L.push(['Marketing spend by branch · ' + reportingMonthLbl(ym) + ' · QuickBooks Advertising & Marketing ' + usd(A.total) + (A.unassigned ? ' · ' + usd(A.unassigned) + ' not yet placed' : '')].map(esc).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv' })); a.download = 'ridd-marketing-by-branch-' + ym + '.csv'; a.click(); };

  const top = el('div', { class: 'card p-5' },
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-2' },
      stat('QuickBooks · marketing', usd(A.total), A.lines.filter(L => L.prov !== SPQ_SKIP).length + ' lines' + (A.skipped ? ' · ' + usd0(A.skipped) + ' marked not marketing' : '')),
      stat('Allocated to branches', usd(allocTot), branches.length + ' branch' + (branches.length === 1 ? '' : 'es') + ' · ' + vendors.length + ' vendor' + (vendors.length === 1 ? '' : 's')),
      stat('Still to place', usd(A.unassigned + waitingAmt), [unplaced.length ? unplaced.length + ' line' + (unplaced.length === 1 ? '' : 's') + ' need a vendor' : '', waiting.length ? waiting.length + ' vendor' + (waiting.length === 1 ? '' : 's') + ' waiting on a report' : ''].filter(Boolean).join(' · ') || 'every line has a vendor and a split', A.unassigned + waitingAmt > 0 ? '#B91C1C' : '#3E5A3A'),
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

  // ── Vendors with dollars but nothing to split them by (per Isaac, Nov 9: no guessing — upload the vendor's report). ──
  // Upload the vendor's report right from its row (per Isaac, Nov 9): the file opens in the mapping card below with
  // this vendor and month preset. A platform vendor (Facebook / Google) isn't waiting on a report — its campaigns
  // need a branch (the card further down).
  const rowUpload = (v) => { const inp = el('input', { type: 'file', multiple: true, accept: '.csv,.xlsx,.xls,.tsv', class: 'hidden',
      onchange: (e) => { state._spuPreset = { channel: v, month: ym }; if (typeof _spuUpload === 'function') Promise.resolve(_spuUpload(e.target.files)).then(() => setTimeout(() => { const d = document.getElementById('spend-uploads'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 60)); e.target.value = ''; } });
    return el('label', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1', style: { background: 'var(--accent)', color: 'var(--accent-text)' } }, '↑ Upload ' + spqLabel(v) + ' report', inp); };
  const waitRow = ([v, w]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    td(spqLabel(v), { fontWeight: '700' }), td(usd(w.amt), null, true), td(String(w.n), muted, true),
    el('td', { class: 'px-3 py-1' }, el('div', { class: 'flex items-center gap-2 flex-wrap' },
      w.why === 'campaigns' ? el('span', { class: 'text-[11px]', style: { color: '#B45309', fontWeight: '600' } }, 'Its campaigns have no branch — assign them in “Campaigns with no branch” below') : admin ? rowUpload(v) : el('span', { style: muted }, 'upload its report'),
      admin ? el('select', { class: 'rounded border px-1 py-0.5 text-[10px]', style: selSt, title: 'Or split it another way', onchange: (e) => { const x = e.target.value; if (!x) return; m.qbAlloc[v] = x; state._spqMemo = {}; state._mkpMemo = null; _mktgSave(); mountApp(); } },
          el('option', { value: '' }, 'or split by…'),
          ...SPQ_METHODS.filter(([x]) => !['auto', 'platform', 'upload'].includes(x)).map(([x, l]) => el('option', { value: x }, l)),
          ...A.branches.map(b => el('option', { value: 'office:' + b }, 'All to ' + _mktgTC(b)))) : null)));
  const waitCard = waiting.length ? el('div', { class: 'card overflow-hidden', style: { borderColor: 'rgba(217,119,6,.5)' } },
    el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-base font-bold', style: { color: '#B45309' } }, 'Waiting on a report · ' + usd(waitingAmt)),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'These vendors have QuickBooks dollars this month but nothing to split them by yet. Upload each vendor’s report from its row — it opens below with the vendor and month filled in — or pick a split.')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Vendor'), th('QuickBooks', true), th('Lines', true), th('What places it'))),
      el('tbody', {}, ...waiting.map(waitRow))))) : null;

  // ── Providers (per Isaac, Nov 9): one row per provider — QuickBooks vs the provider's own statement, leads, sales. ──
  const PM = typeof prvMonthsFor === 'function' ? prvMonthsFor(ym) : {};
  const L = typeof mklMonth === 'function' ? (() => { try { return mklMonth(ym); } catch (e) { return null; } })() : null;   // GHL leads + FieldRoutes new sales by channel (Metrics page math)
  const qbOf = (v) => (A.byProv[v] ? A.byProv[v].amt : 0) + ((A.waiting || {})[v] ? A.waiting[v].amt : 0);
  const upOf = (v) => { const u = ((m.spend || {})[ym] || {})[v]; return u ? Object.values(u).reduce((a, x) => a + (Number(x) || 0), 0) : null; };
  const provNames = [...new Set([...Object.keys(A.byProv), ...Object.keys(A.waiting || {}), ...Object.keys(PM), ...(L ? Object.keys(L.ch).filter(k => L.ch[k].leads || L.ch[k].s) : [])])]
    .filter(v => v !== SPQ_TOOLS && v !== SPQ_SKIP && v && !/^unmapped|^unspecified$/i.test(v));
  const prow = (v) => {
    const qb = qbOf(v), st = PM[v] || null, up = upOf(v);
    const stmt = st ? st.net : up;                                  // the provider's own number for the month
    const spend = qb || stmt || 0;                                   // what CPL / CAC divide by: QuickBooks first
    const c = (L && L.ch[v]) || { leads: 0, s: 0, cv: 0 };
    const leadsRep = st ? st.leads : null;
    const diff = qb && stmt != null ? qb - stmt : null;
    const flag = diff != null && Math.abs(diff) > Math.max(25, Math.abs(stmt) * 0.1);
    const plat = /^(Google Ads|Google Local Services|Facebook)$/.test(v);
    const muted2 = { color: 'var(--text-muted)' };
    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      td(v, { fontWeight: '700' }),
      td(qb ? usd(qb) : '—', qb ? null : muted2, true),
      td(stmt != null ? usd(stmt) : (plat ? 'platform' : '—'), stmt != null ? null : muted2, true),
      td(diff == null ? '—' : (diff > 0 ? '+' : '') + usd(diff), diff == null ? muted2 : flag ? { color: '#B45309', fontWeight: '700' } : muted2, true),
      td(leadsRep != null ? String(leadsRep) : '—', leadsRep != null ? null : muted2, true),
      td(c.leads ? String(c.leads) : '—', c.leads ? null : muted2, true),
      td(c.s ? String(c.s) : '—', c.s ? null : muted2, true),
      td(c.cv ? usd0(c.cv) : '—', c.cv ? null : muted2, true),
      td(spend && (leadsRep || c.leads) ? usd0(spend / (leadsRep || c.leads)) : '—', null, true),
      td(spend && c.s ? usd0(spend / c.s) : '—', null, true),
      td(spend ? (c.cv / spend).toFixed(2) + 'x' : '—', spend ? { fontWeight: '700', color: c.cv / spend >= 1 ? '#3E5A3A' : '#B91C1C' } : muted2, true),
      el('td', { class: 'px-3 py-1' }, el('div', { class: 'flex items-center gap-2 flex-wrap' },
        st ? el('span', { class: 'text-[10px]', style: muted2, title: st.from || '' }, 'statement · ' + new Date(st.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
          : up != null ? el('span', { class: 'text-[10px]', style: muted2 }, 'uploaded ' + (typeof _spuCpl === 'function' && _spuCpl(v) ? 'lead report' : 'breakout')) : (!plat && admin) ? rowUpload(v) : plat ? el('span', { class: 'text-[10px]', style: muted2 }, 'Windsor') : null,
        // Per-lead price (DoLead $60, per Isaac Nov 10): every row of the lead report bills this; editable here.
        !plat && admin && typeof _spuCplInput === 'function' && (typeof _spuCpl === 'function' && _spuCpl(v) || /dolead/i.test(v)) ? el('span', { class: 'inline-flex items-center gap-1 text-[10px]', style: muted2, title: 'Fixed cost per lead — every lead on the report bills this' }, _spuCplInput(v, true), 'per lead') : null)));
  };
  const provTable = provNames.length ? el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-base font-bold' }, 'By provider · ' + reportingMonthLbl(ym)),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'QuickBooks is what left the bank; Statement is the provider’s own bill for the month (Baton nets what they owe RIDD for referrals sent). Leads from the statement and from GoHighLevel side by side; sales and revenue from FieldRoutes by the account’s source. Cost per lead and CAC use QuickBooks when it has the charge, else the statement.')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Provider'), th('QuickBooks', true), th('Statement', true), th('Δ', true), th('Leads · stmt', true), th('Leads · GHL', true), th('New sales', true), th('New revenue', true), th('Cost / lead', true), th('CAC', true), th('Return', true), th(''))),
      el('tbody', {}, ...provNames.sort((a, b) => (qbOf(b) || (PM[b] ? PM[b].net : 0)) - (qbOf(a) || (PM[a] ? PM[a].net : 0))).map(prow))))) : null;

  // ── Wages & incentives (per Isaac, Nov 9): typed in once a month from the controller; part of fully-loaded CAC. ──
  m.wages = (m.wages && typeof m.wages === 'object') ? m.wages : {}; m.incentives = (m.incentives && typeof m.incentives === 'object') ? m.incentives : {};
  const W = m.wages[ym] || {}, I = m.incentives[ym] || {};
  const pm = (() => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
  const wTot = Object.values(W).reduce((a, v) => a + (Number(v) || 0), 0), iTot = Object.values(I).reduce((a, v) => a + (Number(v) || 0), 0);
  const moneyIn = (val, onSave) => el('input', { type: 'text', inputmode: 'decimal', value: val ? String(Math.round(Number(val) * 100) / 100) : '', placeholder: '0', class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: Object.assign({ width: '96px', textAlign: 'right' }, selSt),
    onchange: (e) => { const n = parseFloat(String(e.target.value).replace(/[^0-9.-]/g, '')); onSave(isNaN(n) ? 0 : n); } });
  const setW = (store, b, n) => { const S = m[store][ym] = m[store][ym] || {}; if (n) S[b] = Math.round(n * 100) / 100; else delete S[b]; if (!Object.keys(S).length) delete m[store][ym]; state._mkpMemo = null; state._mklMemo = {}; _mktgSave(); mountApp(); };
  const wagesOpen = state._spendWagesOpen != null ? state._spendWagesOpen : !(wTot || iTot);
  const wagesCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap cursor-pointer', onclick: () => { state._spendWagesOpen = !wagesOpen; mountApp(); } },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Wages & incentives · ' + reportingMonthLbl(ym)),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, (wTot || iTot) ? usd(wTot) + ' wages · ' + usd(iTot) + ' incentives — in fully-loaded CAC on Metrics' : 'From the controller, once a month — not entered yet for ' + reportingMonthLbl(ym) + '. Goes into fully-loaded CAC on Metrics.')),
      el('span', { class: 'ml-auto text-[11px]', style: muted }, wagesOpen ? '▴' : '▾')),
    wagesOpen ? el('div', { style: { borderTop: '1px solid var(--border)' } },
      admin && (m.wages[pm] || m.incentives[pm]) && !(wTot || iTot) ? el('div', { class: 'px-5 py-2 text-[11px] flex items-center gap-2', style: muted }, 'Nothing entered yet.',
        el('button', { class: 'font-semibold underline', style: { color: 'var(--accent)' }, onclick: () => { if (m.wages[pm]) m.wages[ym] = Object.assign({}, m.wages[pm]); if (m.incentives[pm]) m.incentives[ym] = Object.assign({}, m.incentives[pm]); state._mkpMemo = null; state._mklMemo = {}; _mktgSave(); mountApp(); } }, 'Copy ' + reportingMonthLbl(pm) + '’s numbers to start')) : null,
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Branch'), th('Wages', true), th('Incentives', true), th('Total', true))),
        el('tbody', {}, ...A.branches.map(b => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(_mktgTC(b), { fontWeight: '700' }),
            el('td', { class: 'px-3 py-1 text-right' }, admin ? moneyIn(W[b], (n) => setW('wages', b, n)) : usd(Number(W[b]) || 0)),
            el('td', { class: 'px-3 py-1 text-right' }, admin ? moneyIn(I[b], (n) => setW('incentives', b, n)) : usd(Number(I[b]) || 0)),
            td(usd((Number(W[b]) || 0) + (Number(I[b]) || 0)), { fontWeight: '700' }, true))),
          el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } }, td('Total', { fontWeight: '800' }), td(usd(wTot), { fontWeight: '700' }, true), td(usd(iTot), { fontWeight: '700' }, true), td(usd(wTot + iTot), { fontWeight: '900' }, true)))))) : null);

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
  const pendingN = (state._spendPending || []).length;
  const uploads = (typeof mktgSpendUploadCard === 'function') ? el('details', { id: 'spend-uploads', class: 'card overflow-hidden', open: !!pendingN },
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
        el('td', { class: 'px-3 py-1' }, admin ? vendorPick(L, L.how === 'this charge only') : (spqLabel(L.prov) || '—'), L.how && !/^(your pick|payee|this charge only)$/.test(L.how) ? el('span', { class: 'ml-2 text-[10px]', style: muted }, L.how) : null)))))));

  // A report just uploaded maps right under the Waiting list (per Isaac, Nov 9 — it used to land below the big table,
  // out of sight); with nothing pending the upload card keeps its usual place lower down.
  return el('div', { class: 'flex flex-col gap-4' }, head(), top, placeCard, waitCard, pendingN ? uploads : null, provTable, table, wagesCard, campCard, pendingN ? null : uploads, linesCard);
}
