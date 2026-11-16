// ┌─ src/integrations/spend-view.js ─────────────────────────────────────────
// │ Marketing → Spend (per Isaac, Nov 16 — "spend by channel and by market in
// │ the SIMPLEST way possible"). One year at a time, Jan–Dec across:
// │   1. Spend by channel — QuickBooks Advertising & Marketing dollars, each
// │      payee under its channel (a pick is remembered for every month).
// │   2. Spend by market  — the same dollars split across markets. Each channel
// │      splits one way: the platform's own spend by market (Google / Facebook
// │      through Windsor), GoHighLevel leads by market, evenly, or all to one
// │      market. Auto = platform → uploaded breakout → GHL leads → even.
// │   3. Wages — every Inside Sales rep by month, typed in from payroll.
// │   4. QuickBooks lines — folded away; fix one charge's channel there.
// │ The engine is spend-qbo.js (spqAllocMonth). Columns always add up to
// │ QuickBooks to the cent, so the By-market table IS the month-end entry.
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
  const th = (t, r, extra) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap align-bottom ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 }, extra || {}) }, t);
  const td = (t, st, r) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: st || {} }, t == null || t === '' ? '—' : t);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ymOf = (i) => year + '-' + String(i + 1).padStart(2, '0');
  const curMi = Number(ym.slice(5, 7)) - 1;
  const thM = (t, i) => th(t, true, i === curMi ? { color: 'var(--accent)' } : null);
  const stickyTd = (t, extra) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap font-semibold', style: Object.assign({ position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }, extra || {}) }, t);
  const totRow = (label, vals) => el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } },
    stickyTd(label, { fontWeight: '900', background: 'var(--card-2)' }), ...vals.map((v, i) => td(v ? usd0(v) : '—', { fontWeight: i === vals.length - 1 ? '900' : '700' }, true)));

  const P = state.reportingIsSpendPayee;
  const head = () => el('div', { class: 'card px-5 py-3 flex items-center gap-3 flex-wrap' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Spend · ' + year), el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Wages by rep for the year — the month picked is highlighted. QuickBooks lines for that month sit at the bottom.')),
    el('span', { class: 'ml-auto' }), monthSel);
  const authGone = state._authExpired ? el('div', { class: 'card p-4 flex items-center gap-3 flex-wrap', style: { borderColor: 'rgba(220,38,38,.5)' } },
    el('div', { class: 'text-sm' }, el('span', { class: 'font-bold', style: { color: '#B91C1C' } }, 'Your sign-in has expired. '), 'QuickBooks and Windsor data can’t load until you sign in again.'),
    el('button', { class: 'ml-auto rounded-lg px-3 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => location.reload() }, 'Reload & sign in')) : null;
  if (!P) return el('div', { class: 'flex flex-col gap-4' }, head(), authGone, el('div', { class: 'card p-6 text-sm text-center', style: muted }, state._isSpendLoading ? 'Pulling QuickBooks…' : state._authExpired ? 'Reload the app to sign in again.' : 'QuickBooks isn’t connected or hasn’t been pulled yet — Settings → Connections.'));
  if (!P.lines) return el('div', { class: 'flex flex-col gap-4' }, head(), el('div', { class: 'card p-6 text-sm text-center', style: muted }, 'QuickBooks is connected, but the line-by-line detail hasn’t been pulled yet. It arrives with the next QuickBooks refresh.'));
  // Every month of the year, allocated (memoized in spqAllocMonth); null where QuickBooks has no lines.
  const AY = MON.map((_, i) => spqAllocMonth(ymOf(i)));
  const A = AY[curMi];
  const anyA = AY.some(Boolean);
  if (!anyA) return el('div', { class: 'flex flex-col gap-4' }, head(), el('div', { class: 'card p-6 text-sm text-center', style: muted }, 'No Advertising & Marketing lines in QuickBooks for ' + year + '.'));

  // ── 1. Spend by channel ──
  const chanAmt = (ch, i) => { const X = AY[i]; if (!X) return 0; return (X.byProv[ch] ? X.byProv[ch].amt : 0) + ((X.waiting || {})[ch] ? X.waiting[ch].amt : 0); };
  const channels = [...new Set(AY.flatMap(X => X ? [...Object.keys(X.byProv), ...Object.keys(X.waiting || {})] : []))].filter(c => c && c !== SPQ_SKIP);
  const chanYear = (ch) => MON.reduce((a, _, i) => a + chanAmt(ch, i), 0);
  channels.sort((a, b) => chanYear(b) - chanYear(a));
  const unTot = (i) => AY[i] ? AY[i].unassigned : 0;
  const monthTotal = (i) => channels.reduce((a, c) => a + chanAmt(c, i), 0) + unTot(i);
  // Payees with no channel yet, across the year — one pick per payee, remembered for every month.
  const chanOpts = typeof spqChannelOptions === 'function' ? spqChannelOptions() : [...new Set([...(m.channels || []), 'Google Ads', 'Google Local Services', 'Facebook'])].sort();
  const vendorPick = (lym, L, onlyThis) => el('select', { class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: Object.assign({}, selSt, L.prov ? {} : { borderColor: '#DC2626' }),
    onchange: (e) => { let v = e.target.value; if (v === SPQ_NEW) { v = spqAskNewVendor(); if (!v) { mountApp(); return; } } spqSetRule(lym, L, v, !!onlyThis); } },
    el('option', { value: '', selected: !L.prov, disabled: true }, 'Pick a channel…'),
    ...chanOpts.map(c => el('option', { value: c, selected: L.prov === c }, c)),
    el('option', { value: SPQ_TOOLS, selected: L.prov === SPQ_TOOLS }, SPQ_TOOLS_LABEL + ' (spread with the media)'),
    el('option', { value: SPQ_SKIP, selected: L.prov === SPQ_SKIP }, 'Not marketing'),
    el('option', { value: SPQ_NEW }, '+ New channel…'));
  const unByPayee = new Map();
  AY.forEach((X, i) => { if (!X) return; for (const L of X.lines) { if (L.prov) continue; const k = _spqKey(L.payee, L.memo); const g = unByPayee.get(k) || unByPayee.set(k, { L, ym: ymOf(i), months: Array(12).fill(0) }).get(k); g.months[i] += L.amt; } });
  const unRows = [...unByPayee.values()].sort((a, b) => b.months.reduce((x, y) => x + y, 0) - a.months.reduce((x, y) => x + y, 0));
  const chRow = (ch) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    stickyTd(spqLabel(ch)), ...MON.map((_, i) => td(chanAmt(ch, i) ? usd0(chanAmt(ch, i)) : '—', chanAmt(ch, i) ? null : muted, true)), td(usd0(chanYear(ch)), { fontWeight: '700' }, true));
  const unRow = (g) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: 'rgba(220,38,38,.06)' } },
    stickyTd(el('div', { class: 'flex items-center gap-2' }, el('span', { style: { color: '#B91C1C' } }, g.L.payee || '(no name)'), admin ? vendorPick(g.ym, g.L) : null), { background: 'transparent' }),
    ...g.months.map(v => td(v ? usd0(v) : '—', v ? { color: '#B91C1C' } : muted, true)), td(usd0(g.months.reduce((x, y) => x + y, 0)), { fontWeight: '700', color: '#B91C1C' }, true));
  const yearTotal = MON.reduce((a, _, i) => a + monthTotal(i), 0);
  const chanCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Spend by channel · ' + year),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'QuickBooks Advertising & Marketing, each payee under its channel. ' + (unRows.length ? unRows.length + (unRows.length === 1 ? ' payee still needs' : ' payees still need') + ' a channel (red) — pick once, it sticks for every month.' : 'Every charge has a channel.'))),
      el('span', { class: 'ml-auto text-sm font-black tabular-nums' }, usd0(yearTotal))),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Channel', false, { position: 'sticky', left: 0, zIndex: 2 }), ...MON.map(thM), th('Total', true))),
      el('tbody', {}, ...channels.map(chRow), ...unRows.map(unRow), totRow('Total', [...MON.map((_, i) => monthTotal(i)), yearTotal])))));

  // ── 2. Spend by market ──
  const markets = [...new Set(AY.flatMap(X => X ? X.branches : []))];
  const mktAmt = (b, i) => { const X = AY[i]; if (!X) return 0; let t = 0; for (const p in X.cells) t += (X.cells[p][b] || 0); return t; };
  const mktYear = (b) => MON.reduce((a, _, i) => a + mktAmt(b, i), 0);
  markets.sort((a, b) => mktYear(b) - mktYear(a));
  const placedMonth = (i) => markets.reduce((a, b) => a + mktAmt(b, i), 0);
  const notPlaced = (i) => Math.max(0, monthTotal(i) - placedMonth(i));
  const npYear = MON.reduce((a, _, i) => a + notPlaced(i), 0);
  // How each channel splits into markets — one pick per channel, the engine does the rest.
  const howOf = (ch) => { const set = m.qbAlloc[ch]; if (set && /^office:/.test(set)) return 'All to ' + _mktgTC(set.slice(7)); const L = { platform: 'Platform spend', upload: 'Uploaded breakout', leads: 'GHL leads', even: 'Even split' }; if (set && L[set]) return L[set]; const how = String(((A || AY.find(Boolean)).byProv[ch] || {}).how || ''); return 'Auto · ' + (/platform/i.test(how) ? 'platform spend' : /upload/i.test(how) ? 'uploaded breakout' : /leads/i.test(how) ? 'GHL leads' : /pro rata/i.test(how) ? 'with the media' : /even/i.test(how) ? 'even' : 'platform → leads → even'); };
  const howSel = (ch) => { const cur = m.qbAlloc[ch] || 'auto';
    return el('select', { class: 'rounded border px-1.5 py-0.5 text-[10px]', style: selSt, title: 'How ' + spqLabel(ch) + ' splits across markets',
      onchange: (e) => { const x = e.target.value; if (x === 'auto') delete m.qbAlloc[ch]; else m.qbAlloc[ch] = x; state._spqMemo = {}; state._mkpMemo = null; state._mklMemo = {}; _mktgSave(); mountApp(); } },
      el('option', { value: 'auto', selected: cur === 'auto' }, howOf(ch).startsWith('Auto') ? howOf(ch) : 'Auto'),
      ...SPQ_METHODS.filter(([x]) => x !== 'auto' && x !== 'upload').map(([x, l]) => el('option', { value: x, selected: cur === x }, l)),
      ...markets.map(b => el('option', { value: 'office:' + b, selected: cur === 'office:' + b }, 'All to ' + _mktgTC(b)))); };
  const splitChans = channels.filter(c => c !== SPQ_TOOLS);
  const howLine = el('div', { class: 'px-5 py-2 flex items-center gap-x-4 gap-y-1.5 flex-wrap text-[11px]', style: Object.assign({ borderTop: '1px solid var(--border)' }, muted) },
    el('span', { class: 'uppercase tracking-widest text-[9px] font-bold', style: { color: 'var(--text-subtle)' } }, 'How each channel splits'),
    ...splitChans.map(ch => el('span', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold', style: { color: 'var(--text)' } }, spqLabel(ch)), admin ? howSel(ch) : howOf(ch))),
    channels.includes(SPQ_TOOLS) ? el('span', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold', style: { color: 'var(--text)' } }, SPQ_TOOLS_LABEL), 'with the media') : null);
  const mkRow = (b) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    stickyTd(_mktgTC(b)), ...MON.map((_, i) => td(mktAmt(b, i) ? usd0(mktAmt(b, i)) : '—', mktAmt(b, i) ? null : muted, true)), td(usd0(mktYear(b)), { fontWeight: '700' }, true));
  const npRow = npYear > 0.5 ? el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: 'rgba(220,38,38,.06)' } },
    stickyTd(el('span', { style: { color: '#B91C1C' } }, 'Not placed yet'), { background: 'transparent' }), ...MON.map((_, i) => td(notPlaced(i) > 0.5 ? usd0(notPlaced(i)) : '—', notPlaced(i) > 0.5 ? { color: '#B91C1C' } : muted, true)), td(usd0(npYear), { fontWeight: '700', color: '#B91C1C' }, true)) : null;
  const mktCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Spend by market · ' + year),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'The same QuickBooks dollars, split across markets by each channel’s rule below. Adds up to the channel table to the cent' + (npYear > 0.5 ? ' — except the red row: charges with no channel yet.' : '.'))),
      el('span', { class: 'ml-auto text-sm font-black tabular-nums' }, usd0(yearTotal))),
    howLine,
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Market', false, { position: 'sticky', left: 0, zIndex: 2 }), ...MON.map(thM), th('Total', true))),
      el('tbody', {}, ...markets.map(mkRow), npRow, totRow('Total', [...MON.map((_, i) => monthTotal(i)), yearTotal])))));

  // ── Wages (per Isaac, Nov 16): one Jan–Dec table of every Inside Sales rep, typed in by hand. Active reps on top;
  // inactive reps fold away under a bar at the bottom so an old month can still be filled in. Saved per rep per
  // month (m.repWages[ym][profileId]); the month's total is the wages line in CAC on Metrics. Replaces Nov 9's
  // by-branch Wages & incentives card.
  m.repWages = (m.repWages && typeof m.repWages === 'object') ? m.repWages : {};
  const IS_ROLES = ['rep_office', 'rep_office_lead'];
  const _profiles = (state.allProfiles || []).filter(p => p && p.id);
  // Who has a wage entry this year that isn't an Inside Sales login: other office roles (Loyalty, D2D…) and payroll
  // names with no app login at all (keys 'name:Last, First' — per Isaac, Nov 16, the payroll report has people the
  // app doesn't). They sit in the inactive section so every dollar on the report is on the page.
  const _withWages = new Set(); for (let i = 0; i < 12; i++) for (const k in (m.repWages[year + '-' + String(i + 1).padStart(2, '0')] || {})) _withWages.add(k);
  const byName = (a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''));
  const isReps = _profiles.filter(p => IS_ROLES.includes(String(p.role || '')));
  const extraReps = _profiles.filter(p => !IS_ROLES.includes(String(p.role || '')) && _withWages.has(p.id)).map(p => Object.assign({}, p, { is_active: false, _other: true }));
  const nameReps = [..._withWages].filter(k => /^name:/.test(k)).map(k => ({ id: k, full_name: k.slice(5), is_active: false, _noLogin: true }));
  const repsAll = [...isReps, ...extraReps, ...nameReps].sort(byName);
  const repsOn = repsAll.filter(p => p.is_active !== false), repsOff = repsAll.filter(p => p.is_active === false);
  const wOf = (pid, i) => Number((m.repWages[ymOf(i)] || {})[pid]) || 0;
  const setRepW = (pid, i, n) => { const k = ymOf(i); const S = m.repWages[k] = m.repWages[k] || {}; if (n) S[pid] = Math.round(n * 100) / 100; else delete S[pid]; if (!Object.keys(S).length) delete m.repWages[k]; state._mkpMemo = null; state._mklMemo = {}; _mktgSave(); };
  const moneyIn = (val, onSave) => el('input', { type: 'text', inputmode: 'decimal', value: val ? String(Math.round(Number(val) * 100) / 100) : '', placeholder: '—', class: 'rounded border px-1.5 py-0.5 text-[11px] tabular-nums', style: Object.assign({ width: '78px', textAlign: 'right' }, selSt),
    onchange: (e) => { const n = parseFloat(String(e.target.value).replace(/[^0-9.-]/g, '')); onSave(isNaN(n) ? 0 : n, e.target); e.target.value = isNaN(n) || !n ? '' : String(Math.round(n * 100) / 100); } });
  const monTot = (i, list) => list.reduce((a, p) => a + wOf(p.id, i), 0);
  const repTot = (p) => MON.reduce((a, _, i) => a + wOf(p.id, i), 0);
  const yearTot = MON.reduce((a, _, i) => a + monTot(i, repsAll), 0);
  const wRow = (p) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    el('td', { class: 'px-3 py-1 whitespace-nowrap font-semibold', style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 } }, p.full_name || '—', p.is_active === false ? el('span', { class: 'ml-1.5 text-[9px] uppercase tracking-wider', style: muted }, p._noLogin ? 'no app login' : p._other ? 'other office role' : 'inactive') : null),
    ...MON.map((_, i) => el('td', { class: 'px-1.5 py-1 text-right' }, admin ? moneyIn(wOf(p.id, i), (n, inp) => { setRepW(p.id, i, n); const row = inp.closest('tr'); const t = row && row.querySelector('[data-tot]'); if (t) t.textContent = usd0(repTot(p)); refreshFoot(); }) : usd0(wOf(p.id, i)))),
    el('td', { class: 'px-3 py-1 text-right tabular-nums font-bold', 'data-tot': '1' }, usd0(repTot(p))));
  // Totals update in place as numbers are typed (no full re-render per cell).
  let footCells = [];
  const refreshFoot = () => { footCells.forEach((c, i) => { c.textContent = i < 12 ? usd0(monTot(i, repsAll)) : usd0(MON.reduce((a, _, j) => a + monTot(j, repsAll), 0)); }); };
  const footRow = () => { footCells = MON.map((_, i) => td(usd0(monTot(i, repsAll)), { fontWeight: '700' }, true)); const tot = td(usd0(yearTot), { fontWeight: '900' }, true); footCells.push(tot);
    return el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } }, el('td', { class: 'px-3 py-1.5 font-black', style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }, 'Total'), ...footCells); };
  const rowOf = (p) => wRow(p);
  const offOpen = !!state._spendWagesOffOpen;
  const wagesCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Wages · ' + year),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Inside Sales reps, by month, typed in from payroll. ' + (yearTot ? usd0(yearTot) + ' entered for ' + year + ' · ' : '') + 'Each month’s total is the wages line in CAC on Metrics.')),
      el('span', { class: 'ml-auto text-[11px]', style: muted }, repsOn.length + ' active · ' + repsOff.length + ' inactive')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } },
      el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Rep', false, { position: 'sticky', left: 0, zIndex: 2 }), ...MON.map(thM), th('Total', true))),
        el('tbody', {}, ...repsOn.map(rowOf),
          repsOff.length ? el('tr', { class: 'border-t cursor-pointer', style: { borderColor: 'var(--border)', background: 'var(--card-2)' }, onclick: () => { state._spendWagesOffOpen = !offOpen; mountApp(); } },
            el('td', { class: 'px-3 py-1.5 text-[11px] font-semibold', colspan: 14, style: muted }, (offOpen ? '▴ ' : '▾ ') + repsOff.length + ' inactive rep' + (repsOff.length === 1 ? '' : 's') + (offOpen ? '' : ' — expand to add wages for a past month'))) : null,
          ...(offOpen ? repsOff.map(rowOf) : []),
          footRow()))));

  // ── 4. QuickBooks lines for the picked month — folded away; fix one charge's channel here. ──
  const lines = A ? A.lines.slice().sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0)) : [];
  const linesCard = A ? el('details', { class: 'card overflow-hidden' },
    el('summary', { class: 'px-5 py-3 text-sm font-bold cursor-pointer' }, 'QuickBooks lines · ' + reportingMonthLbl(ym) + ' · ' + lines.length + ' · ' + usd(A.total + A.skipped)),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)', maxHeight: '60vh', overflowY: 'auto' } }, el('table', { class: 'w-full text-[12px]', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Date'), th('Type'), th('Payee'), th('Memo'), th('Account'), th('Amount', true), th('Channel'))),
      el('tbody', {}, ...lines.map(L => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: L.prov ? '' : 'rgba(220,38,38,.06)' } },
        td(ym.slice(5, 7) + '/' + String(L.day || '').padStart(2, '0') + '/' + ym.slice(0, 4), { fontFamily: 'ui-monospace, monospace' }), td(L.journal ? 'Journal' : 'Expense', muted), td(L.payee, { fontWeight: '600' }),
        td(L.memo, Object.assign({}, muted, { maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis' })), td(L.acctLeaf || 'Advertising & Marketing', muted), td(usd(L.amt), L.amt < 0 ? { color: '#B91C1C' } : {}, true),
        el('td', { class: 'px-3 py-1' }, admin ? vendorPick(ym, L, L.how === 'this charge only') : (spqLabel(L.prov) || '—'), L.how && !/^(your pick|payee|this charge only)$/.test(L.how) ? el('span', { class: 'ml-2 text-[10px]', style: muted }, L.how) : null))))))) : null;

  // Wages first; Spend by channel / by market are built but parked off the page for now (per Isaac, Nov 16 —
  // "get rid of them for now, I'll come back to that"). Put chanCard / mktCard back in this list to bring them back.
  void chanCard; void mktCard;
  return el('div', { class: 'flex flex-col gap-4' }, head(), wagesCard, linesCard);
}
