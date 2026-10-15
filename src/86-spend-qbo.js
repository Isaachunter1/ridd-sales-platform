// ┌─ src/86-spend-qbo.js ────────────────────────────────────────────────────
// │ Marketing → Spend, rebuilt (per Isaac, Oct 12): QuickBooks is the money.
// │ Every Advertising & Marketing expense line for the month (card charges,
// │ vendor bills, the ROR invoice…) is read from QuickBooks and
// │   1. given a PROVIDER — from the payee / card descriptor. Google charges
// │      carry the last four of the Google Ads account, which says PPC vs
// │      Local Services; anything the app can't place is asked once and
// │      remembered;
// │   2. split across OFFICES by the best driver that provider has —
// │      the platform's own spend by office (Google per account, Facebook),
// │      an uploaded breakout (Angi, Baton, DoLead…), its GoHighLevel leads
// │      by office, an even split, or one office;
// │ so the Office × Provider table always adds up to QuickBooks to the cent.
// │ The month-end journal entry that moves Executive Marketing out to the
// │ branch accounts is NOT spend — it is the controller booking this table —
// │ and is only shown beside it as a check. CAC reads this allocation.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const SPQ_TOOLS = 'Agency & tools';      // agency fees, software, creative — spread with the media they support
const SPQ_SKIP = '__skip';               // not marketing spend (booked to the wrong account)
const SPQ_METHODS = [['auto', 'Auto'], ['platform', 'Platform spend'], ['upload', 'Uploaded breakout'], ['leads', 'GHL leads'], ['even', 'Even split']];

function _spqStore() {
  const m = _mktgStore();
  m.qbRules = (m.qbRules && typeof m.qbRules === 'object') ? m.qbRules : {};   // { line key: provider | SPQ_TOOLS | SPQ_SKIP }
  m.qbAlloc = (m.qbAlloc && typeof m.qbAlloc === 'object') ? m.qbAlloc : {};   // { provider: method | 'office:BRANCH' }
  m.qbLineRules = (m.qbLineRules && typeof m.qbLineRules === 'object') ? m.qbLineRules : {};   // { one charge: provider } — beats the payee rule
  return m;
}
// The key a remembered pick is stored under: the payee, or (no payee) the memo with numbers / refs taken out.
function _spqKey(payee, memo) {
  const p = String(payee || '').trim();
  if (p && !/^\(no name\)/i.test(p)) return 'p:' + p.toLowerCase();
  return 'm:' + String(memo || '').toLowerCase().replace(/ref\s*#.*$/, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
}
// One charge's own key ("this charge only" picks): month, day, payee, memo, amount.
function _spqLineKey(ym, day, payee, memo, amt) { return [ym, String(day || ''), String(payee || '').trim(), String(memo || '').trim(), (Number(amt) || 0).toFixed(2)].join('|'); }
// Assign a QuickBooks line to a provider (Spend tab + Marketing Pulse). onlyThis = just this charge; otherwise the
// payee is remembered for every month (and any one-off pick on this charge is cleared).
function spqSetRule(ym, L, prov, onlyThis) {
  const m = _spqStore(), lk = _spqLineKey(ym, L.day, L.payee, L.memo, L.amt);
  if (onlyThis) m.qbLineRules[lk] = prov; else { m.qbRules[_spqKey(L.payee, L.memo)] = prov; delete m.qbLineRules[lk]; }
  state._spqMemo = {}; state._mkpMemo = null; _mktgSave(); mountApp();
}
function spqChannelOptions() { const m = _spqStore(); return [...new Set([...(m.channels || []), 'Google Ads', 'Google Local Services', 'Facebook'])].sort(); }
// Google Ads accounts the platform feed knows: last four → { acct, name, lsa }.
function _spqGoogleAccts(year) {
  const S = (state._adSpend || {})[year] || {};
  const out = {};
  for (const r of S.rows || []) {
    if (r.platform !== 'google') continue;
    const d = String(r.acct || '').replace(/\D/g, ''); if (d.length < 4) continue;
    const k = d.slice(-4);
    const x = out[k] || (out[k] = { acct: r.acct, name: r.acctName || '', lsa: false });
    if (/\blsa\b|local services/i.test(r.acctName || '') || adProviderOf(r) === 'Google Local Services') x.lsa = true;
  }
  return out;
}
// One QuickBooks line → { prov, how, acct? }.
function _spqClassify(line, m, gAccts, ym) {
  const [, payee, memo] = line;
  const one = ym ? m.qbLineRules[_spqLineKey(ym, line[0], payee, memo, line[3])] : null;
  if (one) return { prov: one, how: 'this charge only' };
  const rule = m.qbRules[_spqKey(payee, memo)];
  if (rule) return { prov: rule, how: 'your pick' };
  const txt = (payee + ' ' + memo);
  // Google: the card descriptor names the Ads account ("GOOGLE *ADSXXXXX2490") — that account decides PPC vs LSA.
  const g = /google/i.test(txt) ? /ADS[X\d]*?(\d{4})(?:CC|\b)/i.exec(memo) : null;
  if (g) { const a = gAccts[g[1]]; return a ? { prov: a.lsa ? 'Google Local Services' : 'Google Ads', how: 'Google account ' + a.acct + (a.name ? ' · ' + a.name : ''), acct: a.acct } : { prov: 'Google Ads', how: 'Google account ····' + g[1] + ' (not in the ad feed)' }; }
  if (/google\s*ads|google\s*\*?ads/i.test(txt)) return { prov: 'Google Ads', how: 'payee' };
  if (/facebk|facebook|\bmeta\b/i.test(txt)) return { prov: 'Facebook', how: 'payee' };
  if (/\bror\b/i.test(txt)) return { prov: 'Facebook', how: 'ROR invoice (Facebook agency)' };
  const pv = typeof qboPayeeProvider === 'function' ? qboPayeeProvider(payee) : '';
  if (pv) return { prov: pv, how: 'payee' };
  return { prov: '', how: '' };
}
// Shares {BRANCH: weight} for a provider in a month, and how they were found.
function _spqShares(prov, ym, branches, ctx, acct) {
  const m = ctx.m, set = m.qbAlloc[prov] || 'auto';
  const norm = (o) => { const t = Object.values(o).reduce((a, v) => a + (v > 0 ? v : 0), 0); if (!(t > 0)) return null; const r = {}; for (const b in o) if (o[b] > 0) r[b] = o[b] / t; return r; };
  if (/^office:/.test(set)) { const b = set.slice(7); return { w: { [b]: 1 }, how: 'all to ' + _mktgTC(b) }; }
  const platform = () => {
    if (acct) { const w = norm(ctx.acctCells(acct)); if (w) return { w, how: 'platform spend · account ' + acct }; }
    const C = (ctx.AD.cells || {})[prov] || {}, w = norm(C); if (!w) return null;
    // Campaigns with no office yet don't steer the split — say how much of the platform is still unplaced.
    const placed = Object.values(C).reduce((a, v) => a + v, 0), open = (ctx.AD.open || []).filter(x => x.prov === prov).reduce((a, x) => a + x.spend, 0);
    return { w, how: 'platform spend by office' + (open > 0 ? ' · ⚠ ' + Math.round(open / (open + placed) * 100) + '% of the platform spend has no office yet (step 3)' : '') };
  };
  const upload = () => { const w = norm(((m.spend || {})[ym] || {})[prov] || {}); return w ? { w, how: 'uploaded breakout' } : null; };
  const leads = () => { const c = ctx.leads[prov]; const w = c ? norm(c) : null; return w && Object.values(c).reduce((a, v) => a + v, 0) >= 5 ? { w, how: 'GoHighLevel leads by office' } : null; };
  const even = () => { const bs = (m.spendEvenBranches && m.spendEvenBranches[prov] && m.spendEvenBranches[prov].length) ? m.spendEvenBranches[prov] : branches; return { w: Object.fromEntries(bs.map(b => [b, 1 / bs.length])), how: 'even across ' + bs.length + ' offices' }; };
  if (set === 'platform') return platform() || even();
  if (set === 'upload') return upload() || even();
  if (set === 'leads') return leads() || even();
  if (set === 'even') return even();
  return (/^(Google Ads|Google Local Services|Facebook)$/.test(prov) ? platform() : null) || upload() || leads() || even();
}
// The month, allocated. { lines:[{…line, prov, how}], byProv:{prov:{amt, n, how, cells}}, cells:{prov:{B:$}}, total, open, booked, … }
function spqAllocMonth(ym) {
  const P = state.reportingIsSpendPayee;
  const raw = P && P.lines && P.lines[ym];
  if (!raw || !raw.length) return null;
  const m = _spqStore(), y = Number(ym.slice(0, 4));
  const BL = _mktgBranchList(y), branches = BL.all;
  const sig = [ym, raw.length, JSON.stringify(m.qbRules), JSON.stringify(m.qbLineRules), JSON.stringify(m.qbAlloc), JSON.stringify((m.spend || {})[ym] || {}), JSON.stringify(m.spendEvenBranches || {}), (state._adSpend && state._adSpend[y] && state._adSpend[y].pulledAt) || '', JSON.stringify(typeof adCampaignOfficeMap === 'function' ? adCampaignOfficeMap() : {}), JSON.stringify(typeof adMetroMap === 'function' ? adMetroMap() : {}), branches.join('|')].join('§');
  state._spqMemo = state._spqMemo || {};
  if (state._spqMemo[ym] && state._spqMemo[ym].sig === sig) return state._spqMemo[ym].v;
  const gAccts = _spqGoogleAccts(y);
  const AD = _mktgAdSpendMonth(ym, branches);
  // Platform spend by office for ONE Google account (each card charge follows its own account's campaigns).
  const S = (state._adSpend || {})[y] || {};
  const acctCells = (acct) => { const c = {}; for (const r of S.rows || []) { if (r.acct !== acct || r.ym !== ym || !(r.spend > 0)) continue;
    const offs = adOfficesOf(r, branches).filter(b => branches.includes(b));
    if (offs.length) { for (const b of offs) c[b] = (c[b] || 0) + r.spend / offs.length; continue; }
    const G = typeof adGeoSplit === 'function' ? adGeoSplit(r, branches) : null; if (G) for (const b in G.by) c[b] = (c[b] || 0) + G.by[b]; }
    return c; };
  const leads = {};
  const GL = typeof ghlLeads === 'function' ? ghlLeads() : null;
  if (GL) for (const l of GL.leads) { if (String(l.d).slice(0, 7) !== ym || !l.office || !branches.includes(l.office)) continue; const c = leads[l.prov] || (leads[l.prov] = {}); c[l.office] = (c[l.office] || 0) + 1; }
  const ctx = { m, AD, acctCells, leads };
  const lines = raw.map(L => Object.assign({ day: L[0], payee: L[1], memo: L[2], amt: Number(L[3]) || 0, acctLeaf: L[4] || '' }, _spqClassify(L, m, gAccts, ym)));
  const cells = {}, byProv = {}; let total = 0, unassigned = 0, skipped = 0;
  const add = (prov, b, v) => { const c = cells[prov] || (cells[prov] = {}); c[b] = (c[b] || 0) + v; };
  const tools = [];
  for (const L of lines) {
    if (L.prov === SPQ_SKIP) { skipped += L.amt; continue; }
    total += L.amt;
    if (!L.prov) { unassigned += L.amt; continue; }
    const bp = byProv[L.prov] || (byProv[L.prov] = { amt: 0, n: 0, hows: new Set() }); bp.amt += L.amt; bp.n++;
    if (L.prov === SPQ_TOOLS) { tools.push(L); continue; }
    const sh = _spqShares(L.prov, ym, branches, ctx, L.acct); bp.hows.add(sh.how);
    for (const b in sh.w) add(L.prov, b, L.amt * sh.w[b]);
  }
  // Agency & tools follow the media they support: pro rata to every other provider's dollars by office.
  if (tools.length) {
    const base = {}; for (const p in cells) for (const b in cells[p]) base[b] = (base[b] || 0) + cells[p][b];
    const bt = Object.values(base).reduce((a, v) => a + v, 0);
    for (const L of tools) { if (bt > 0) for (const b in base) add(SPQ_TOOLS, b, L.amt * base[b] / bt); else { const w = 1 / branches.length; for (const b of branches) add(SPQ_TOOLS, b, L.amt * w); } }
    byProv[SPQ_TOOLS].hows.add('pro rata to the media spend by office');
  }
  // Round to cents, keeping every provider's column equal to its QuickBooks dollars.
  for (const p in cells) { const C = cells[p]; let s = 0, big = null; for (const b in C) { C[b] = Math.round(C[b] * 100) / 100; s += C[b]; if (!big || C[b] > C[big]) big = b; } if (big && byProv[p]) C[big] = Math.round((C[big] + byProv[p].amt - s) * 100) / 100; }
  for (const p in byProv) byProv[p].how = [...byProv[p].hows].join(' · ');
  // What the controller has booked to the branch accounts this month (the month-end journal entry), for the check.
  const booked = {}; const SP = (state.reportingIsSpend || {})[ym] || {};
  for (const acct in SP) { const off = typeof _mktgQboOffice === 'function' ? _mktgQboOffice(acct) : null; if (off) booked[off] = (booked[off] || 0) + (Number(SP[acct]) || 0); }
  const v = { ym, lines, cells, byProv, total: Math.round(total * 100) / 100, unassigned, skipped, booked, AD, branches, gAccts };
  state._spqMemo[ym] = { sig, v };
  return v;
}
// Office totals for a month (CAC): { BRANCH: $ } — null when QuickBooks has no lines for it.
function spqOfficeTotals(ym) {
  const A = spqAllocMonth(ym); if (!A) return null;
  const o = {}; for (const p in A.cells) for (const b in A.cells[p]) o[b] = (o[b] || 0) + A.cells[p][b];
  return o;
}

// ── The tab ────────────────────────────────────────────────────────────────
function mktgSpendQboView() {
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const m = _spqStore();
  const { ym, yms } = _mktgCtrlMonth();
  if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(Number(ym.slice(0, 4)));
  const muted = { color: 'var(--text-muted)' };
  const usd = (v) => '$' + (Math.round((v || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const admin = isAdminRole(state.profile?.role);
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const monthSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { state._mktCtrlMonth = e.target.value; mountApp(); } },
    ...yms.map(k => el('option', { value: k, selected: k === ym }, reportingMonthLbl(k))));
  const P = state.reportingIsSpendPayee;
  const head = (sub) => el('div', { class: 'card px-5 py-3 flex items-center gap-3 flex-wrap' },
    el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Spend · QuickBooks'), el('div', { class: 'text-[11px] mt-0.5', style: muted }, sub)),
    el('span', { class: 'ml-auto' }), monthSel);
  if (!P) return el('div', { class: 'flex flex-col gap-4' }, head(state._isSpendLoading ? 'Pulling QuickBooks…' : 'QuickBooks isn’t connected or hasn’t been pulled yet.'));
  if (!P.lines) return el('div', { class: 'flex flex-col gap-4' }, head('QuickBooks is connected, but the line-by-line marketing detail hasn’t been pulled yet. It arrives with the next QuickBooks refresh after this update is deployed.'));
  const A = spqAllocMonth(ym);
  if (!A) return el('div', { class: 'flex flex-col gap-4' }, head('No Advertising & Marketing expense lines in QuickBooks for ' + reportingMonthLbl(ym) + ' yet.'));
  const provs = Object.keys(A.byProv).sort((a, b) => A.byProv[b].amt - A.byProv[a].amt);
  const chanOpts = [...new Set([...(m.channels || []), 'Google Ads', 'Google Local Services', 'Facebook'])].sort();
  const th = (t, r) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
  const td = (t, st, r) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: st || {} }, t == null || t === '' ? '—' : t);
  const setRule = (L, v) => { m.qbRules[_spqKey(L.payee, L.memo)] = v; _mktgSave(); mountApp(); };
  const provPick = (L) => el('select', { class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: Object.assign({}, selSt, L.prov ? {} : { borderColor: '#DC2626' }), onchange: (e) => setRule(L, e.target.value) },
    el('option', { value: '', selected: !L.prov, disabled: true }, 'Pick a provider…'),
    ...chanOpts.map(c => el('option', { value: c, selected: L.prov === c }, c)),
    el('option', { value: SPQ_TOOLS, selected: L.prov === SPQ_TOOLS }, SPQ_TOOLS + ' (spread with the media)'),
    el('option', { value: SPQ_SKIP, selected: L.prov === SPQ_SKIP }, 'Not marketing — leave out'));

  // 1 · QuickBooks lines by provider.
  const open = state._spqOpen || {};
  const unl = A.lines.filter(L => !L.prov);
  const provRows = [...provs, ...(unl.length ? [''] : [])].map(p => {
    const ls = A.lines.filter(L => (L.prov || '') === p && L.prov !== SPQ_SKIP);
    const amt = ls.reduce((a, L) => a + L.amt, 0), isOpen = !p || open[p];
    return [el('tr', { class: 'border-t cursor-pointer', style: { borderColor: 'var(--border)', background: p ? '' : 'rgba(220,38,38,.06)' }, onclick: () => { state._spqOpen = Object.assign({}, open, { [p]: !open[p] }); mountApp(); } },
      td((isOpen ? '▾ ' : '▸ ') + (p || 'Needs a provider'), { fontWeight: '700', color: p ? undefined : '#B91C1C' }), td(fmt.int(ls.length) + ' line' + (ls.length === 1 ? '' : 's'), muted), td(usd(amt), { fontWeight: '700' }, true), td(p ? (A.byProv[p] || {}).how : 'Pick once — remembered for every month', muted)),
      ...(isOpen ? ls.sort((a, b) => b.amt - a.amt).map(L => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', fontSize: '11px' } },
        td('    ' + ym.slice(5) + '/' + L.day + ' · ' + (L.payee || '—'), { paddingLeft: '28px' }), td(L.memo, Object.assign({}, muted, { maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis' })), td(usd(L.amt), null, true),
        el('td', { class: 'px-3 py-1' }, admin ? provPick(L) : (L.prov || '—'), L.how && L.how !== 'your pick' ? el('span', { class: 'ml-2 text-[10px]', style: muted }, L.how) : null))) : [])];
  }).flat();
  const linesCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, '1 · QuickBooks lines → provider'),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, fmt.int(A.lines.length) + ' Advertising & Marketing expense lines · ' + usd(A.total) + (A.skipped ? ' · ' + usd(A.skipped) + ' left out as not marketing' : '') + '. Google charges are matched to their Ads account by the card’s last four, which separates PPC from Local Services.')),
      unl.length ? el('span', { class: 'ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold', style: { background: 'rgba(220,38,38,.10)', color: '#B91C1C' } }, unl.length + ' to place · ' + usd(A.unassigned)) : el('span', { class: 'ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold', style: { background: 'rgba(95,108,91,.16)', color: '#5F6C5B' } }, '✓ every line has a provider')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Provider'), th('Lines'), th('QuickBooks', true), th('How'))), el('tbody', {}, ...provRows))));

  // 2 · Office × provider.
  const offices = A.branches.filter(b => provs.some(p => (A.cells[p] || {})[b]));
  const offTot = (b) => provs.reduce((a, p) => a + ((A.cells[p] || {})[b] || 0), 0);
  offices.sort((a, b) => offTot(b) - offTot(a));
  const methodSel = (p) => { const cur = m.qbAlloc[p] || 'auto';
    return el('select', { class: 'rounded border px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal', style: Object.assign({ maxWidth: '120px' }, selSt), title: 'How ' + p + ' is split across offices', onchange: (e) => { const v = e.target.value; if (v === 'auto') delete m.qbAlloc[p]; else m.qbAlloc[p] = v; _mktgSave(); mountApp(); } },
      ...SPQ_METHODS.map(([v, l]) => el('option', { value: v, selected: cur === v }, l)), ...A.branches.map(b => el('option', { value: 'office:' + b, selected: cur === 'office:' + b }, 'All to ' + _mktgTC(b)))); };
  const bookedTot = Object.values(A.booked).reduce((a, v) => a + v, 0);
  const allocTot = provs.reduce((a, p) => a + Object.values(A.cells[p] || {}).reduce((x, v) => x + v, 0), 0);
  const csv = () => { const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const L = [['Month', 'Office', 'Provider', 'Amount'].join(',')];
    for (const b of offices) for (const p of provs) { const v = (A.cells[p] || {})[b]; if (v) L.push([ym, _mktgTC(b), p, v.toFixed(2)].map(esc).join(',')); }
    const url = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv' })); const a = el('a', { href: url, download: 'ridd-marketing-allocation-' + ym + '.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  const tableCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, '2 · Allocation · office × provider · ' + reportingMonthLbl(ym)),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Each provider’s QuickBooks dollars split by its driver (pick one in the column header). Columns add up to QuickBooks to the cent. This is what the month-end journal entry should book.')),
      el('button', { class: 'ml-auto rounded-lg px-3 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: csv }, '⬇ CSV for the controller')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Office'), ...provs.map(p => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-right align-top', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, el('div', {}, p), admin && p !== SPQ_TOOLS ? el('div', { class: 'mt-1' }, methodSel(p)) : el('div', { class: 'mt-1 text-[9px] normal-case tracking-normal' }, p === SPQ_TOOLS ? 'pro rata to media' : ''))), th('Total', true), bookedTot ? th('Booked in QBO', true) : null)),
      el('tbody', {}, ...offices.map(b => { const t = offTot(b), bk = A.booked[b] || 0;
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(_mktgTC(b), { fontWeight: '700' }), ...provs.map(p => td((A.cells[p] || {})[b] ? usd(A.cells[p][b]) : '—', null, true)), td(usd(t), { fontWeight: '700' }, true),
          bookedTot ? td(usd(bk), Math.abs(bk - t) > 1 ? { color: '#B45309', fontWeight: '600' } : muted, true) : null); }),
        el('tr', { style: { borderTop: '2px solid var(--text)' } }, td('Total', { fontWeight: '700' }), ...provs.map(p => td(usd(A.byProv[p].amt), { fontWeight: '700' }, true)), td(usd(allocTot), { fontWeight: '800' }, true), bookedTot ? td(usd(bookedTot), { fontWeight: '700' }, true) : null)))),
    A.unassigned ? el('div', { class: 'px-5 py-2 text-[11px] border-t', style: { borderColor: 'var(--border)', color: '#B91C1C', fontWeight: '600' } }, usd(A.unassigned) + ' of QuickBooks lines have no provider yet, so they aren’t in the table — place them in step 1.') : null,
    bookedTot && Math.abs(bookedTot - allocTot) > 1 ? el('div', { class: 'px-5 py-2 text-[11px] border-t', style: { borderColor: 'var(--border)', color: '#B45309' } }, 'Booked to the branch accounts: ' + usd(bookedTot) + ' vs ' + usd(allocTot) + ' allocated here. Orange offices differ by more than $1 — the journal entry should match this table.') : null);

  // 3 · Platform campaigns with no office (they can't help split their provider's dollars until they have one).
  const openCamps = (A.AD.open || []).filter(x => provs.includes(x.prov));
  const campCard = openCamps.length ? el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-sm font-bold', style: { color: '#B91C1C' } }, '3 · Platform campaigns with no office · ' + usd(openCamps.reduce((a, x) => a + x.spend, 0))),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'These campaigns’ platform spend is left out of the split above until they have an office (remembered for every month). Google campaigns that span offices split themselves by the searchers’ metro.')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Provider'), th('Account'), th('Campaign'), th('Platform spend', true), th('Office'))),
      el('tbody', {}, ...openCamps.map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(x.prov), td((x.r.acctName ? x.r.acctName + ' · ' : '') + x.r.acct, muted), td(x.r.campaign), td(usd(x.spend), null, true),
        el('td', { class: 'px-3 py-1' }, admin ? spuBranchPicker(A.branches, [], (picked) => { setAdCampaignOffice(x.k, picked.length === 1 ? picked[0] : picked); mountApp(); }, { empty: 'Pick offices…', save: 'Save · split evenly' }) : '—'))))))) : null;

  // 4 · Vendor breakouts (uploads) — the driver for providers that send a report by location.
  const up = (typeof mktgSpendUploadCard === 'function') ? el('details', { class: 'card overflow-hidden', open: !!(state._spendPending && state._spendPending.length) },
    el('summary', { class: 'px-5 py-3 text-sm font-bold cursor-pointer' }, '4 · Vendor breakouts (uploads) — optional driver for Angi, Baton, DoLead…'),
    mktgSpendUploadCard(_mktgBranchList(Number(ym.slice(0, 4))), Number(ym.slice(0, 4)))) : null;

  return el('div', { class: 'flex flex-col gap-4' },
    head(usd(A.total) + ' of Advertising & Marketing in QuickBooks for ' + reportingMonthLbl(ym) + ' · ' + provs.length + ' providers · ' + offices.length + ' offices'),
    linesCard, tableCard, campCard, up);
}
