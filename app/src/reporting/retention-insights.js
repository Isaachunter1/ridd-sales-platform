// ┌─ src/96-retention-insights.js ────────────────────────────────────────────
// │ Retention → Attrition Steps → Insights › (per Isaac, Oct 13)
// │ How one branch's attrition compares with the rest of the company, and WHY
// │ it differs: which cancel reasons carry the gap, when in the customer's
// │ life it happens, how much is the branch's mix (contract length, channel)
// │ versus how it performs on a like-for-like book, and the account traits
// │ (autopay, multi-year, past due, price) that travel with high attrition.
// │ Same book and same Trailing-12 definition as the headline tile, so every
// │ number here ties to the tiles above.
// └────────────────────────────────────────────────────────────────────────
const RI_LIFE = [
  { k: 'm0', lo: 0, hi: 3, label: 'Months 0–3', note: 'onboarding / first bills' },
  { k: 'm3', lo: 3, hi: 6, label: 'Months 3–6', note: 'collections cliff' },
  { k: 'm6', lo: 6, hi: 10, label: 'Months 6–10', note: 'mid-contract' },
  { k: 'm10', lo: 10, hi: 14, label: 'Months 10–14', note: 'first contract ending' },
  { k: 'm14', lo: 14, hi: 24, label: 'Months 14–24', note: 'second year' },
  { k: 'm24', lo: 24, hi: 1e9, label: 'Month 24+', note: 'long-term' },
];
const RI_MIN_BASE = 150;   // smaller branches are listed but kept out of rankings and correlations
const _riMemo = { book: null, key: '', out: null };
function _riAutopay(r) { const v = String(r.customer_auto_pay == null ? '' : r.customer_auto_pay).trim(); return !!v && !/^(no|0|false|none)$/i.test(v); }
function _riTerm(r) { const n = Number(r.agreement_length) || 0; return n >= 24 ? '24+' : n >= 18 ? '18' : n >= 12 ? '12' : 'other'; }
function _riChannel(r) { return /door\s*to\s*door/i.test(String(r.subscription_source || '')) ? 'D2D' : 'Inside'; }
function _riStats(base, counted) {
  const S = { base: base.length, cancels: counted.length, rate: base.length ? counted.length / base.length : null, reasons: {}, life: {}, cells: {}, ap: 0, multi: 0, d2d: 0, arv: 0, arvN: 0, activeNow: 0, pastDue: 0, cancelRows: counted, baseRows: base };
  RI_LIFE.forEach(b => { S.life[b.k] = 0; });
  S.band = [0, 0, 0, 0];   // cancels by life month: 0–6, 6–12, 12–18, 18–24
  const cset = new Set(counted);
  for (const r of base) {
    if (_riAutopay(r)) S.ap++;
    if ((Number(r.agreement_length) || 0) >= 18) S.multi++;
    if (_riChannel(r) === 'D2D') S.d2d++;
    const v = Number(r.annual_recurring_value) || 0; if (v > 0) { S.arv += v; S.arvN++; }
    const cell = _riTerm(r) + '|' + _riChannel(r); const c = S.cells[cell] || (S.cells[cell] = { base: 0, cancels: 0 }); c.base++; if (cset.has(r)) c.cancels++;
    if (!r._effCancel) { S.activeNow++; if ((Number(r.days_past_due) || 0) >= 30) S.pastDue++; }
  }
  for (const r of counted) {
    const k = String(reportingCancelReasonOf(r) || 'Unspecified').trim() || 'Unspecified';
    S.reasons[k] = (S.reasons[k] || 0) + 1;
    const life = semLifeMonths(r);
    const b = RI_LIFE.find(x => life != null && life >= x.lo && life < x.hi) || RI_LIFE[RI_LIFE.length - 1];
    S.life[b.k]++;
    if (life != null && life >= 0 && life < 24) S.band[Math.floor(life / 6)]++;
  }
  const pct = (a, d) => d ? a / d : null;
  S.apPct = pct(S.ap, S.base); S.multiPct = pct(S.multi, S.base); S.d2dPct = pct(S.d2d, S.base); S.arvAvg = S.arvN ? S.arv / S.arvN : null; S.pastDuePct = pct(S.pastDue, S.activeNow);
  S.earlyPct = pct(S.life.m0 + S.life.m3, S.cancels);
  S.bandPct = S.band.map(v => pct(v, S.cancels));
  return S;
}
// Company + every branch, on the full retention book (all branches in), memoized on the book.
function retenBranchInsightsData() {
  if (typeof retenGroundZero !== 'function' || typeof semRetentionBook !== 'function') return null;
  const ground = retenGroundZero();
  const pop = retenScopeSteps(ground).out;
  const book = semRetentionBook(pop);
  // Window (per Isaac, Oct 13): 't12' = trailing 12 months · 'year:YYYY' = the book on Jan 1 followed through that year
  // · 'cohort:YYYY' = everything first serviced in that year, and how much of it has been lost to date.
  const mode = String(state._retenInsMode || 't12');
  const key = String(book.length) + '|' + new Date().toISOString().slice(0, 10) + '|' + mode;
  if (_riMemo.book === book && _riMemo.key === key) return _riMemo.out;
  let baseAll, countedAll, st, en, label;
  const mm = /^(year|cohort):(\d{4})$/.exec(mode);
  const bm = /^branchyr:(\d)$/.exec(mode);
  // Branch's own year N (per Isaac, Oct 13 — apples to apples): every branch's Nth FULL calendar year of selling (the
  // year after its first month of sales, unless that month was January), each measured the same way — lost within
  // the first 12 months of the customer's life, counting only customers at least 12 months old.
  const branchYear = {};
  if (bm) {
    const firstMo = {};
    for (const r of book) { const o = String(r.office_name || '—').trim(); const ym = String(r.initial_service || '').slice(0, 7); if (/^20\d\d-\d\d$/.test(ym) && (!firstMo[o] || ym < firstMo[o])) firstMo[o] = ym; }
    for (const o in firstMo) { const y = Number(firstMo[o].slice(0, 4)), m = Number(firstMo[o].slice(5, 7)); branchYear[o] = (m === 1 ? y : y + 1) + Number(bm[1]) - 1; }
  }
  if (mm && mm[1] === 'year') { const A = semMetric('annual_attrition')(book, Number(mm[2])); baseAll = A.rows.boy; countedAll = A.rows.counted; st = A.st; en = A.en; label = mm[2] + (Number(mm[2]) === new Date().getFullYear() ? ' to date' : '') + ' · book on Jan 1, lost during the year'; }
  else if (mm) { const y = mm[2]; baseAll = book.filter(r => String(r.initial_service || '').slice(0, 4) === y); countedAll = baseAll.filter(r => r._effCancel); st = y + '-01-01'; en = new Date().toISOString().slice(0, 10); label = y + ' cohort · first serviced in ' + y + ', lost to date'; }
  else if (bm) {
    const cut = new Date(); cut.setFullYear(cut.getFullYear() - 1); const cutIso = cut.toISOString().slice(0, 10);
    baseAll = book.filter(r => { const o = String(r.office_name || '—').trim(); return branchYear[o] && String(r.initial_service || '').slice(0, 4) === String(branchYear[o]) && String(r.initial_service) <= cutIso; });
    countedAll = baseAll.filter(r => { if (!r._effCancel) return false; const l = semLifeMonths(r); return l != null && l < 12; });
    st = ''; en = ''; label = 'Each office’s year ' + bm[1] + ' · lost in the first 12 months';
  }
  else { const T = semMetric('trailing12_attrition')(book); baseAll = T.rows.boy; countedAll = T.rows.counted; st = T.st; en = T.en; label = 'Trailing 12 months (' + st + ' → ' + en + ')'; }
  const years = [...new Set(book.map(r => String(r.initial_service || '').slice(0, 4)).filter(y => /^20\d\d$/.test(y)))].sort().reverse();
  const company = _riStats(baseAll, countedAll);
  const byB = new Map(), cByB = new Map();
  for (const r of baseAll) { const o = String(r.office_name || '—').trim(); (byB.get(o) || byB.set(o, []).get(o)).push(r); }
  for (const r of countedAll) { const o = String(r.office_name || '—').trim(); (cByB.get(o) || cByB.set(o, []).get(o)).push(r); }
  const branches = [...byB.entries()].map(([name, base]) => Object.assign(_riStats(base, cByB.get(name) || []), { name }))
    .sort((a, b) => (b.base >= RI_MIN_BASE) - (a.base >= RI_MIN_BASE) || (a.rate || 0) - (b.rate || 0));
  // Mix-adjusted expectation: each branch's own contract-length × channel mix at the COMPANY's rate for each cell.
  const cellRate = {}; for (const k in company.cells) { const c = company.cells[k]; cellRate[k] = c.base ? c.cancels / c.base : 0; }
  branches.forEach(b => { let e = 0; for (const k in b.cells) e += b.cells[k].base * (cellRate[k] != null ? cellRate[k] : (company.rate || 0)); b.expected = b.base ? e / b.base : null; });
  const ranked = branches.filter(b => b.base >= RI_MIN_BASE);
  ranked.forEach((b, i) => { b.rank = i + 1; });
  // Across-branch relationships (Pearson r) between a trait of the book and the branch's attrition.
  const corr = (f) => { const xs = ranked.map(f), ys = ranked.map(b => b.rate); const ok = xs.map((x, i) => x != null && ys[i] != null); const X = xs.filter((_, i) => ok[i]), Y = ys.filter((_, i) => ok[i]); const n = X.length; if (n < 5) return null;
    const mx = X.reduce((a, v) => a + v, 0) / n, my = Y.reduce((a, v) => a + v, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; };
  const rels = [
    { k: 'ap', label: 'autopay share', f: b => b.apPct },
    { k: 'multi', label: 'multi-year (18–24 mo) share', f: b => b.multiPct },
    { k: 'd2d', label: 'door-to-door share', f: b => b.d2dPct },
    { k: 'arv', label: 'average annual price', f: b => b.arvAvg },
    { k: 'pd', label: 'share of active accounts 30+ days past due', f: b => b.pastDuePct },
  ].map(x => Object.assign(x, { r: corr(x.f) })).filter(x => x.r != null);
  branches.forEach(b => { b.cohortYear = branchYear[b.name] || null; });
  const notReady = bm ? Object.keys(branchYear).filter(o => !branches.some(b => b.name === o)).map(o => ({ name: o, year: branchYear[o] })) : [];
  const out = { company, branches, ranked, rels, st, en, label, mode, years, isBranchYr: !!bm, notReady };
  _riMemo.book = book; _riMemo.key = key; _riMemo.out = out;
  return out;
}
// The focus branch: exactly one branch left in the 🏢 picker, else the one clicked in the table here.
function _riFocusName(D) {
  const off = (typeof retenBranchesOff === 'function') ? retenBranchesOff() : new Set();
  const inB = D.branches.filter(b => !off.has(b.name));
  if (off.size && inB.length === 1) return inB[0].name;
  if (state._retenInsBranch && D.branches.some(b => b.name === state._retenInsBranch)) return state._retenInsBranch;
  return null;
}
function retenInsightsCard() {
  let D; try { D = retenBranchInsightsData(); } catch (e) { console.warn('[insights]', e); D = null; }
  if (!D || !D.company.base) return null;
  const C = D.company;
  const pct = (v, d) => v == null ? '—' : (v * 100).toFixed(d == null ? 1 : d) + '%';
  const pts = (v) => v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + ' pts';
  const n = (v) => Number(v || 0).toLocaleString();
  const bad = '#DC2626', good = '#15803D';
  const tc = (s) => (typeof _titleCaseWords === 'function' ? _titleCaseWords(s) : s);
  const focus = _riFocusName(D);
  const B = focus ? D.branches.find(b => b.name === focus) : null;
  const drill = (title, rows) => rows && rows.length ? () => openReportingDrillModal({ chartTitle: 'Insights · ' + title, sliceLabel: n(rows.length) + ' subscriptions', rows, formatValue: fmt.usd0 }) : null;
  const sec = (title, sub, ...kids) => el('div', { class: 'flex flex-col gap-2' },
    el('div', {}, el('div', { class: 'text-[11px] uppercase tracking-widest font-bold' }, title), sub ? el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, sub) : null), ...kids);
  // A diverging bar: the branch's points above (red) or below (green) the company.
  const gapBar = (label, d, extra, onClick) => {
    const w = Math.min(100, Math.abs(d || 0) / 0.10 * 100);   // 10 pts fills one side of the track
    return el('div', { class: 'flex items-center gap-2 text-[11px]' + (onClick ? ' cursor-pointer hover:brightness-95' : ''), onclick: onClick || null, title: onClick ? 'Click for the accounts' : '' },
      el('span', { class: 'truncate', style: { width: '210px', flexShrink: 0 } }, label),
      el('div', { style: { position: 'relative', flex: '1', height: '10px', background: 'var(--card-2)', borderRadius: '3px', minWidth: '120px' } },
        el('div', { style: { position: 'absolute', left: '50%', top: '-2px', bottom: '-2px', width: '1px', background: 'var(--border-2)' } }),
        el('div', { style: { position: 'absolute', top: '0', bottom: '0', borderRadius: '3px', background: d > 0 ? bad : good, left: d > 0 ? '50%' : (50 - w / 2) + '%', width: (w / 2) + '%' } })),
      el('span', { class: 'tabular-nums font-bold', style: { width: '74px', textAlign: 'right', color: d > 0 ? bad : good } }, pts(d)),
      extra ? el('span', { class: 'tabular-nums', style: { width: '170px', color: 'var(--text-muted)' } }, extra) : null);
  };

  // ── League table (always) ──
  // Life-month bands (share of the cancels): only the ones this window can reach —
  // a branch's year N is measured over 12 months, a cohort only as old as it is.
  const RI_BANDS = [[0, 'Lost in months 0–6'], [6, 'Lost in months 6–12'], [12, 'Lost in months 12–18'], [18, 'Lost in months 18–24']];
  const _cohY = /^cohort:(\d{4})/.exec(D.mode || ''); const _cohAge = _cohY ? (Date.now() - new Date(+_cohY[1], 0, 1).getTime()) / (30.44 * 864e5) : null;
  const bands = RI_BANDS.map((x, i) => ({ i, lo: x[0], label: x[1] })).filter(x => D.isBranchYr ? x.lo < 12 : _cohAge != null ? x.lo < _cohAge : true);
  const cols = [[D.isBranchYr ? 'Office · cohort year' : 'Office', 'left'], [/^cohort/.test(D.mode) || D.isBranchYr ? 'Cohort size' : D.mode === 't12' ? 'Book a year ago' : 'Book on Jan 1', 'right'], ['Cancels', 'right'], [D.mode === 't12' ? 'T12 attrition' : /^cohort/.test(D.mode) ? 'Lost to date' : D.isBranchYr ? 'Lost in 1st 12 mo' : 'Attrition', 'right'], ['vs company', 'right'], ['Expected for its mix', 'right'], ['Multi-year', 'right'], ...bands.map(x => [x.label, 'right']), ['Past due 30+', 'right']];
  const th = (l, a) => el('th', { class: 'px-2 py-1.5 font-semibold whitespace-nowrap', style: { textAlign: a } }, l);
  const td = (v, a, sty) => el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap', style: Object.assign({ textAlign: a }, sty || {}) }, v);
  const row = (b, isCo) => el('tr', { class: 'border-t' + (isCo ? '' : ' cursor-pointer hover:brightness-95'), style: { borderColor: 'var(--border)', background: B && b === B ? 'rgba(223,100,58,.08)' : isCo ? 'var(--card-2)' : '', fontWeight: isCo ? '700' : '' },
      onclick: isCo ? null : () => { state._retenInsBranch = state._retenInsBranch === b.name ? null : b.name; mountApp(); }, title: isCo ? '' : 'Click to compare this office with the company' },
    td((b.rank ? '#' + b.rank + ' ' : '') + (isCo ? (D.isBranchYr ? 'All offices' : 'Company') : tc(b.name)) + (!isCo && D.isBranchYr && b.cohortYear ? ' · ' + b.cohortYear : '') + (b.base < RI_MIN_BASE && !isCo ? ' (small)' : ''), 'left'),
    td(n(b.base), 'right'), td(n(b.cancels), 'right'),
    td(pct(b.rate), 'right', { fontWeight: '700' }),
    td(isCo ? '—' : pts((b.rate || 0) - (C.rate || 0)), 'right', isCo ? {} : { color: (b.rate || 0) > (C.rate || 0) ? bad : good }),
    td(isCo ? '—' : pct(b.expected), 'right', { color: 'var(--text-muted)' }),
    td(pct(b.multiPct, 0), 'right'),
    ...bands.map(x => td(pct((b.bandPct || [])[x.i], 0), 'right', { color: 'var(--text-muted)' })),
    td(pct(b.pastDuePct, 0), 'right'));
  const league = el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
    el('thead', { class: 'text-[9px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } }, el('tr', {}, ...cols.map(([l, a]) => th(l, a)))),
    el('tbody', {}, row(C, true), ...D.branches.map(b => row(b, false)),
      ...(D.notReady || []).map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } },
        el('td', { class: 'px-2 py-1.5 whitespace-nowrap' }, tc(x.name) + ' · ' + x.year), el('td', { colspan: cols.length - 1, class: 'px-2 py-1.5 text-[11px]' }, 'Year ' + D.mode.slice(-1) + ' isn’t 12 months old yet — nothing to compare'))))));

  // ── Patterns across branches ──
  const relLines = D.rels.filter(x => Math.abs(x.r) >= 0.45).sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).map(x =>
    el('div', { class: 'text-[11px]' }, '• Offices with a higher ', el('b', {}, x.label), x.r < 0 ? ' tend to have LOWER attrition' : ' tend to have HIGHER attrition', el('span', { style: { color: 'var(--text-muted)' } }, ' (r = ' + x.r.toFixed(2) + ' across ' + D.ranked.length + ' offices)')));

  let focusBlock = null;
  const _nr = focus && !B && (D.notReady || []).find(x => x.name === focus);
  if (_nr) focusBlock = el('div', { class: 'rounded-xl p-3 text-[12px]', style: { background: 'var(--card-2)' } }, tc(_nr.name) + '\u2019s year ' + D.mode.slice(-1) + ' is ' + _nr.year + ' — those customers aren\u2019t 12 months old yet, so there\u2019s no like-for-like first-year number for it. Pick an earlier year or another window.');
  if (B) {
    // Compared with the OTHER branches (per Isaac: "how that branch is comparing to other branches"), not a company
    // total that includes the branch itself.
    const R = _riStats(C.baseRows.filter(r => String(r.office_name || '—').trim() !== B.name), C.cancelRows.filter(r => String(r.office_name || '—').trim() !== B.name));
    { const cr = {}; for (const k in R.cells) { const c = R.cells[k]; cr[k] = c.base ? c.cancels / c.base : 0; } let e = 0; for (const k in B.cells) e += B.cells[k].base * (cr[k] != null ? cr[k] : (R.rate || 0)); B.expectedVsRest = B.base ? e / B.base : null; }
    const gap = (B.rate || 0) - (R.rate || 0), mixGap = (B.expectedVsRest || 0) - (R.rate || 0), perfGap = (B.rate || 0) - (B.expectedVsRest || 0);
    // Reasons: each reason's share of the book lost, branch minus the other branches — the bars sum to the total gap.
    const keys = [...new Set(Object.keys(B.reasons).concat(Object.keys(R.reasons)))];
    const rs = keys.map(k => ({ k, b: (B.reasons[k] || 0) / B.base, c: (R.reasons[k] || 0) / R.base, n: B.reasons[k] || 0 })).map(x => Object.assign(x, { d: x.b - x.c })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const topR = rs.slice(0, 8);
    const lifeRows = RI_LIFE.map(L => ({ L, b: (B.life[L.k] || 0) / B.base, c: (R.life[L.k] || 0) / R.base, n: B.life[L.k] || 0 })).map(x => Object.assign(x, { d: x.b - x.c }));
    const worstLife = lifeRows.slice().sort((a, b) => b.d - a.d)[0];
    const worstR = rs.filter(x => x.d > 0)[0], bestR = rs.filter(x => x.d < 0)[0];
    // Like-for-like: the branch vs the other branches inside each contract × channel cell.
    const cellRows = Object.keys(B.cells).map(k => { const b = B.cells[k], c = R.cells[k] || { base: 0, cancels: 0 }; return { k, base: b.base, b: b.base ? b.cancels / b.base : null, c: c.base ? c.cancels / c.base : null }; })
      .filter(x => x.base >= 40).sort((a, b) => b.base - a.base);
    const trait = (label, bv, cv, higherIsWorse, fmtv) => {
      const worse = bv != null && cv != null && (higherIsWorse ? bv > cv * 1.05 : bv < cv * 0.95);
      const better = bv != null && cv != null && (higherIsWorse ? bv < cv * 0.95 : bv > cv * 1.05);
      return el('div', { class: 'rounded-xl border px-3 py-2', style: { borderColor: worse ? 'rgba(220,38,38,.4)' : better ? 'rgba(22,163,74,.4)' : 'var(--border)' } },
        el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)' } }, label),
        el('div', { class: 'text-base font-black tabular-nums', style: { color: worse ? bad : better ? good : 'var(--text)' } }, fmtv(bv)),
        el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, 'other offices ' + fmtv(cv)));
    };
    // Plain-English read: the three things that explain most of this branch's difference.
    const say = [];
    if (D.isBranchYr) say.push(tc(B.name) + '\u2019s year ' + D.mode.slice(-1) + ' (' + (B.cohortYear || '—') + ', ' + n(B.base) + ' customers) lost ' + pct(B.rate) + ' in their first 12 months, versus ' + pct(R.rate) + ' for the other offices\u2019 own year ' + D.mode.slice(-1) + ' (' + n(R.base) + ' customers across ' + (D.branches.length - 1) + ' offices) — ' + pts(gap) + (B.rank ? ', #' + B.rank + ' of ' + D.ranked.length + '.' : '.'));
    else say.push(tc(B.name) + ' lost ' + pct(B.rate) + ' of its ' + n(B.base) + ' accounts (' + D.label.split(' · ')[0].replace(/ \(.*\)/, '') + ') versus ' + pct(R.rate) + ' of ' + n(R.base) + ' at the other offices (' + pts(gap) + ')' + (B.rank ? ', #' + B.rank + ' of ' + D.ranked.length + ' offices.' : '.'));
    if (Math.abs(mixGap) >= 0.01) say.push('Its mix accounts for ' + pts(mixGap) + ' (' + (mixGap > 0 ? 'more' : 'fewer') + ' of the contract lengths and channels that churn more at the other offices); the other ' + pts(perfGap) + ' is how the office performs on a like-for-like book.');
    else say.push('Its contract-length and channel mix is close to the other offices’, so the difference (' + pts(perfGap) + ') is performance on a like-for-like book.');
    if (worstR) say.push('The biggest driver is ' + worstR.k + ': ' + pct(worstR.b) + ' of the book lost to it vs ' + pct(worstR.c) + ' at the other offices (' + pts(worstR.d) + ').' + (bestR ? ' Best relative showing: ' + bestR.k + ' (' + pts(bestR.d) + ').' : ''));
    if (worstLife && worstLife.d > 0.005) say.push('By timing, the excess sits in ' + worstLife.L.label.toLowerCase() + ' (' + worstLife.L.note + '): ' + pts(worstLife.d) + ' above the other offices.');
    if (B.apPct != null && R.apPct != null && Math.abs(B.apPct - R.apPct) >= 0.05) say.push((B.apPct < R.apPct ? 'Autopay is lower' : 'Autopay is higher') + ' than the other offices (' + pct(B.apPct, 0) + ' vs ' + pct(R.apPct, 0) + ')' + (D.rels.find(x => x.k === 'ap' && x.r < -0.45) ? ' — and across offices, lower autopay goes with higher attrition.' : '.'));
    focusBlock = el('div', { class: 'flex flex-col gap-4' },
      el('div', { class: 'rounded-xl p-3 flex flex-col gap-1', style: { background: gap > 0 ? 'rgba(220,38,38,.06)' : 'rgba(22,163,74,.07)' } },
        el('div', { class: 'text-sm font-black' }, tc(B.name) + ' vs the other offices'),
        ...say.map(t => el('div', { class: 'text-[12px]' }, t))),
      el('div', { class: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
        trait(D.mode === 't12' ? 'Trailing-12 attrition' : /^cohort/.test(D.mode) ? 'Cohort lost to date' : D.isBranchYr ? 'Lost in first 12 months' : 'Attrition that year', B.rate, R.rate, true, v => pct(v)),
        // Size of what's being compared (per Isaac, Oct 13) — so a small cohort isn't read like a big one.
        el('div', { class: 'rounded-xl border px-3 py-2', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)' } }, /^cohort/.test(D.mode) || D.isBranchYr ? 'Cohort size' : 'Accounts compared'),
          el('div', { class: 'text-base font-black tabular-nums' }, n(B.base) + (D.isBranchYr && B.cohortYear ? ' · ' + B.cohortYear : '')),
          el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, 'other offices ' + n(R.base))),
        trait('Expected for its mix', B.expectedVsRest, R.rate, true, v => pct(v)),
        trait('Autopay', B.apPct, R.apPct, false, v => pct(v, 0)),
        trait('Multi-year (18–24 mo)', B.multiPct, R.multiPct, false, v => pct(v, 0)),
        trait('Door-to-door share', B.d2dPct, R.d2dPct, true, v => pct(v, 0)),
        trait('Avg annual price', B.arvAvg, R.arvAvg, false, v => v == null ? '—' : fmt.usd0(v)),
        trait('Active 30+ days past due', B.pastDuePct, R.pastDuePct, true, v => pct(v, 1)),
        trait('Cancels in months 0–6', B.earlyPct, R.earlyPct, true, v => pct(v, 0))),
      sec('What the gap is made of — by cancel reason', 'Share of the book lost to each reason, office minus the other offices. The bars add up to the total gap. Click one for the office’s accounts.',
        ...topR.map(x => gapBar(x.k, x.d, pct(x.b) + ' vs ' + pct(x.c) + ' · ' + n(x.n) + ' lost', drill(tc(B.name) + ' · ' + x.k, B.cancelRows.filter(r => (String(reportingCancelReasonOf(r) || 'Unspecified').trim() || 'Unspecified') === x.k))))),
      sec('When they leave — by month of customer life', 'Share of the book lost at each stage of the customer’s life, office minus the other offices.',
        ...lifeRows.map(x => gapBar(x.L.label + ' · ' + x.L.note, x.d, pct(x.b) + ' vs ' + pct(x.c) + ' · ' + n(x.n) + ' lost', drill(tc(B.name) + ' · ' + x.L.label, B.cancelRows.filter(r => { const l = semLifeMonths(r); return l != null && l >= x.L.lo && l < x.L.hi; }))))),
      sec('Like for like — same contract length and channel', 'Attrition inside each slice of the book, office vs the other offices. Gaps here are performance, not mix.',
        ...cellRows.map(x => gapBar(x.k.replace('|', ' mo · ').replace('other mo', 'Other term') + ' (' + n(x.base) + ' accts)', (x.b || 0) - (x.c || 0), pct(x.b) + ' vs ' + pct(x.c)))));
  }
  const offN = (typeof retenBranchesOff === 'function') ? retenBranchesOff().size : 0;
  return el('div', { class: 'card p-4 flex flex-col gap-4' },
    el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
      el('div', {},
        el('h3', { class: 'text-base font-bold' }, '🔎 Office insights'),
        el('div', { class: 'flex items-center gap-2 flex-wrap mt-1' },
          el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, title: 'Which window the comparison reads',
            onchange: (e) => { state._retenInsMode = e.target.value; mountApp(); } },
            el('option', { value: 't12', selected: D.mode === 't12' }, 'Trailing 12 months'),
            el('optgroup', { label: 'Calendar year (book on Jan 1)' }, ...D.years.map(y => el('option', { value: 'year:' + y, selected: D.mode === 'year:' + y }, y))),
            el('optgroup', { label: 'Office’s own year (lost in first 12 months)' }, ...[1, 2, 3].map(n => el('option', { value: 'branchyr:' + n, selected: D.mode === 'branchyr:' + n }, 'Year ' + n + ' of each office'))),
            el('optgroup', { label: 'Start-year cohort (lost to date)' }, ...D.years.map(y => el('option', { value: 'cohort:' + y, selected: D.mode === 'cohort:' + y }, y + ' cohort'))))),
        el('div', { class: 'text-[11px] mt-1', style: { color: 'var(--text-muted)' } }, D.label + ', same book and rules as the tiles above. '
          + (B ? '' : (offN ? 'Leave exactly one office ticked in 🏢, or c' : 'Pick one office in 🏢 (or c') + 'lick an office below' + (offN ? '' : ')') + ' to see why it differs from the company.'))),
      el('button', { class: 'text-[11px] font-bold', style: { color: 'var(--text-muted)' }, onclick: () => { state._retenInsightsOpen = false; mountApp(); } }, 'Close ✕')),
    focusBlock,
    sec('All offices', '"Expected for its mix" = what the office would lose at the other offices’ rate for each contract length and channel it sells. Above it = underperforming on a like-for-like book. Ranked best → worst; offices under ' + RI_MIN_BASE + ' accounts are listed but not ranked. "Lost in months" = the share of the office’s cancels that came in that stretch of the customer’s life.', league),
    relLines.length ? sec('Patterns across offices', null, ...relLines) : null);
}
