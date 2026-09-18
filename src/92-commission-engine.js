// ┌─ src/92-commission-engine.js ─────────────────────────────────────────────────────
// │ D2D commission engine (commissionCompute) and office-staff compute.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// Compute the full breakdown for one roster employee over [startMs,endMs],
// with lockMs deciding which cancels are "after lock" (excluded from attrition).
function commissionCompute(emp, startMs, endMs, lockMs) {
  const cfg = commissionConfig();
  const empIds = new Set(String(emp.employee_ids || emp.employee_id || '').split(',').map(s => s.trim()).filter(Boolean));
  const cv = (r) => Number(r.subscription_contract_value) || 0;
  const catOf = (r) => cfg.serviceCategories[r.subscription] || 'unclassified';
  const rows0 = (state.reportingSubscriptions || []).filter(r => {
    if (!empIds.has(String(r.sold_by_id || '').trim())) return false;
    const sd = Date.parse(r.sold_date || String(r.sold_at || '').slice(0, 10));
    if (isNaN(sd)) return false;
    if (startMs && sd < startMs) return false;
    if (endMs && sd > endMs) return false;
    return true;
  });
  // ── Canonical gates — the SAME configurations the rest of the app runs on,
  // so Pay reconciles with Indicators/Reporting instead of raw CRM rows:
  //   · FieldRoutes global excluded services (billing artifacts, not sales)
  //   · excluded lead sources (Settings → Configurations)
  //   · renewal-source subs (continuations — not D2D commissionable revenue)
  //   · sold-not-started (initial appt neither Pending nor Completed — the
  //     account never became real; blank status = legacy snapshot, passes)
  // Gated rows are counted + shown, never silently dropped.
  const _exclSrcSet = (typeof reportingExcludedSources === 'function') ? reportingExcludedSources() : new Set();
  const gates = { global: { n: 0, rev: 0 }, source: { n: 0, rev: 0 }, renewal: { n: 0, rev: 0 }, sns: { n: 0, rev: 0 } };
  const _gate = (k, v) => { gates[k].n++; gates[k].rev += v; };
  const rows = [];
  for (const r of rows0) {
    const v = cv(r);
    if (FR_GLOBAL_EXCLUDED_SERVICES.has(String(r.subscription || '').trim())) { _gate('global', v); continue; }
    if (_exclSrcSet.has(String(r.subscription_source || '').trim())) { _gate('source', v); continue; }
    if (typeof reportingSourceClass === 'function' && reportingSourceClass(r.subscription_source) === 'renewal') { _gate('renewal', v); continue; }
    const ist = String(r.initial_status || '').toLowerCase();
    if (ist && ist !== 'pending' && ist !== 'completed') { _gate('sns', v); continue; }
    rows.push(r);
  }
  let pestRev = 0, bundleRev = 0, ancRev = 0, exclRev = 0, unclRev = 0;
  const unclassified = new Map();
  for (const r of rows) {
    const c = catOf(r), v = cv(r);
    if (c === 'pest') pestRev += v; else if (c === 'bundle') bundleRev += v; else if (c === 'ancillary') ancRev += v;
    else if (c === 'exclude') exclRev += v; else { unclRev += v; unclassified.set(r.subscription, (unclassified.get(r.subscription) || 0) + v); }
  }
  const typeLabel = emp.type_label || 'Sales Rep';
  const rt = commissionRatesFor(emp.employee_id, typeLabel);
  const pestRate = rt.pest, bundleRate = rt.bundleRate, ancRate = rt.ancRate, ancMult = rt.ancMult, bundleMult = rt.bundleMult;
  const pestComm = pestRev * pestRate, bundleComm = bundleRev * bundleRate, ancComm = ancRev * ancRate;
  const payableRev = pestRev + bundleRev + ancRev;
  // Multi-year: term from agreement_length, only on commissionable categories.
  let rev18 = 0, rev24 = 0, myRev = 0;
  for (const r of rows) {
    const c = catOf(r); if (!(c === 'pest' || c === 'bundle' || c === 'ancillary')) continue;
    const t = Number(r.agreement_length) || 0, v = cv(r);
    if (t >= 24) { rev24 += v; myRev += v; } else if (t >= 18) { rev18 += v; myRev += v; }
  }
  const myPct = payableRev > 0 ? (myRev / payableRev * 100) : 0;
  const MY = commissionRulesForType(typeLabel).multiYear;
  let multiYearAmt = 0;
  if (myPct > MY.hiPct) multiYearAmt = rev18 * (MY.rate18 / 100) + rev24 * (MY.rate24 / 100);
  else if (myPct >= MY.loPct) multiYearAmt = 0;
  else multiYearAmt = -(payableRev * (MY.penalty / 100));
  // Account stats — cancels follow the canonical churn rules: reasons
  // excluded in Settings → Configurations (Combined etc.) don't count.
  const _exclReasons = (typeof reportingExcludedCancelReasons === 'function') ? reportingExcludedCancelReasons() : new Set();
  const _reasonOf = (r) => (typeof _normCancelReason === 'function' && typeof reportingCancelReasonOf === 'function')
    ? _normCancelReason(reportingCancelReasonOf(r)) : String(r.subscription_cancellation_reason || '').trim().toLowerCase();
  const canceledAll = rows.filter(r => r.subscription_date_canceled);
  const reasonExcl = canceledAll.filter(r => _exclReasons.has(_reasonOf(r)));
  const canceled = canceledAll.filter(r => !_exclReasons.has(_reasonOf(r)));
  // Quality stats — same conventions as the boards: APay = autopay field
  // present and not the literal "No"; Last Resort = initial under $99.
  const apayN = rows.filter(r => r.customer_auto_pay && r.customer_auto_pay !== 'No').length;
  const lastResort = rows.filter(r => (Number(r.initial_price) || 0) < 99).length;
  const ror = canceled.filter(r => { const s = Date.parse(r.sold_date), c = Date.parse(r.subscription_date_canceled); return !isNaN(s) && !isNaN(c) && (c - s) >= 0 && (c - s) / 86400000 <= 3; });
  const afterLock = lockMs ? canceled.filter(r => { const c = Date.parse(r.subscription_date_canceled); return !isNaN(c) && c > lockMs; }) : [];
  const agingDays = (typeof reportingAgingDays === 'function') ? reportingAgingDays() : 7;
  const withBalance = rows.filter(r => (Number(r.days_past_due) || 0) >= agingDays && !r.subscription_date_canceled);
  const sold = rows.length;
  const finalAttrCount = Math.max(0, canceled.length - ror.length - afterLock.length);
  const m = commissionManual(emp.employee_id);
  const overrides = Number(m.overrides) || 0, rent = Number(m.rent) || 0, paidYtd = Number(m.paidYtd) || 0;
  const other = Number(m.other) || 0, audit = Number(m.audit) || 0, payPeriods = Number(m.payPeriods) || 26;
  const totalCommission = pestComm + bundleComm + ancComm + overrides + multiYearAmt;
  const netDue = totalCommission - rent - paidYtd - other - audit;
  const biWeekly = payPeriods ? netDue / payPeriods : netDue;
  return {
    rows, pestRev, bundleRev, ancRev, exclRev, unclRev, unclassified, payableRev,
    pestRate, bundleRate, ancRate, ancMult, bundleMult, overridden: rt.overridden, pestComm, bundleComm, ancComm,
    rev18, rev24, myPct, multiYearAmt, MY,
    overrides, rent, paidYtd, other, audit, payPeriods, totalCommission, netDue, biWeekly,
    sold, canceled: canceled.length, ror: ror.length, afterLock: afterLock.length,
    withBalance: withBalance.length, finalAttrCount, finalAttrition: sold > 0 ? finalAttrCount / sold * 100 : 0,
    rawMatched: rows0.length, gates, reasonExcl: reasonExcl.length, apayN, lastResort,
  };
}

// Shared breakdown + accounts/attrition cards. B is a plain object carrying the
// computed fields — used by the admin calculator (live) AND a rep's own pay view
// (from the published snapshot), so they always look identical.
function commissionRenderCards(B, repName) {
  const money = (n) => { const v = Math.round((n || 0) * 100) / 100; return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const pct = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2) + '%';
  const ROW = (label, valNode, kind) => el('div', {
    class: 'flex items-center justify-between gap-3 px-3 py-2 text-sm',
    style: { borderTop: '1px solid var(--border)',
      background: kind === 'rev' ? 'rgba(95,108,91,.08)' : kind === 'comm' ? 'rgba(223,100,58,.10)' : kind === 'total' ? 'rgba(223,100,58,.18)' : 'transparent' } },
    el('span', { class: kind === 'total' ? 'font-bold' : '' }, label),
    el('span', { class: 'tabular-nums ' + (kind === 'total' ? 'font-bold' : '') }, valNode));
  const breakdown = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-3 py-2 font-display text-xl', style: { background: 'var(--text)', color: 'var(--bg)' } }, 'Backend Breakdown'),
    ROW('Sales Rep', repName),
    ROW('Pest Revenue', money(B.pestRev), 'rev'),
    ROW('Pest Commission (' + pct(B.pestRate * 100) + ')', money(B.pestComm), 'comm'),
    ROW('Bundle Revenue', money(B.bundleRev), 'rev'),
    ROW('Bundle Commission (' + pct(B.bundleRate * 100) + ')', money(B.bundleComm), 'comm'),
    ROW('Ancillary Revenue', money(B.ancRev), 'rev'),
    ROW('Ancillary Commission (' + pct(B.ancRate * 100) + ')', money(B.ancComm), 'comm'),
    ROW('Overrides', money(B.overrides), 'comm'),
    ROW('Multi-Year Bonus/Deduction', money(B.multiYearAmt), 'comm'),
    ROW('Total Commission', money(B.totalCommission), 'total'),
    ROW('Rent', money(-B.rent)),
    ROW('Paid Year-to-Date', money(-B.paidYtd)),
    ROW('Other Additions/Deductions', money(-B.other)),
    ROW('Audit Deduction', money(-B.audit)),
    ROW('Net Due', money(B.netDue), 'total'),
    ROW('Bi-Weekly Pay (÷ ' + B.payPeriods + ')', money(B.biWeekly), 'total'),
    el('div', { class: 'px-3 py-2 text-sm flex items-center justify-between', style: { background: 'rgba(95,108,91,.08)', borderTop: '1px solid var(--border)' } },
      el('span', { class: 'font-semibold' }, 'Total Payable Rev'), el('span', { class: 'tabular-nums font-semibold' }, money(B.payableRev))));
  const statRow = (label, val, tone) => el('div', { class: 'flex items-center justify-between px-3 py-1.5 text-sm', style: { borderTop: '1px solid var(--border)' } },
    el('span', {}, label), el('span', { class: 'tabular-nums font-semibold', style: tone ? { color: tone } : {} }, val));
  const stats = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-3 py-2 font-display text-lg', style: { background: 'var(--text)', color: 'var(--bg)' } }, 'Accounts & Attrition'),
    statRow('Total Accounts Sold', B.sold),
    statRow('Canceled Accounts', B.canceled + '  (' + pct(B.sold ? B.canceled / B.sold * 100 : 0) + ')', B.canceled ? '#DC2626' : null),
    statRow('Accounts with Balance', B.withBalance + '  (' + pct(B.sold ? B.withBalance / B.sold * 100 : 0) + ')'),
    statRow('Multi-Year %', pct(B.myPct)),
    B.apayN != null ? statRow('AutoPay %', pct(B.sold ? B.apayN / B.sold * 100 : 0)) : null,
    B.lastResort != null ? statRow('Last Resort (<$99 initial)', B.lastResort + '  (' + pct(B.sold ? B.lastResort / B.sold * 100 : 0) + ')', B.lastResort ? '#A9441F' : null) : null,
    B.reasonExcl != null && B.reasonExcl > 0 ? statRow('Cancels w/ excluded reason (not counted)', B.reasonExcl) : null,
    statRow('Total 3-Day Right of Rescission', B.ror),
    statRow('Accounts Canceled After Lock Date', B.afterLock),
    el('div', { class: 'flex items-center justify-between px-3 py-2.5', style: { borderTop: '2px solid var(--text)', background: 'var(--text)', color: 'var(--bg)' } },
      el('span', { class: 'font-display text-lg' }, 'FINAL ATTRITION'),
      el('span', { class: 'font-display text-lg tabular-nums' }, pct(B.finalAttrition))));
  return { breakdown, stats };
}

// Plain serializable summary of a computed run — what we publish for the rep.
function commissionSnapshot(R, emp, period) {
  const keys = ['pestRev', 'bundleRev', 'ancRev', 'payableRev', 'pestRate', 'ancRate', 'bundleRate',
    'pestComm', 'bundleComm', 'ancComm', 'overrides', 'multiYearAmt', 'totalCommission',
    'rent', 'paidYtd', 'other', 'audit', 'netDue', 'biWeekly', 'payPeriods',
    'sold', 'canceled', 'withBalance', 'myPct', 'ror', 'afterLock', 'finalAttrition',
    'rawMatched', 'gates', 'reasonExcl', 'apayN', 'lastResort'];
  const o = { name: _frEmpName(emp), period, at: new Date().toISOString() };
  for (const k of keys) o[k] = R[k];
  return o;
}

// ──────────────────────────────────────────────────────────────────────────
// D2D SALES GROUP — Dashboard + Sales sub-tabs (Pay = viewCommission below).
// Runs entirely on the CRM shared dataset filtered to the D2D department;
// same privacy model as Indicators: headline leaderboard for everyone, the
// full rep card gated by canViewRepDetails (admin: anyone · self: always ·
// partner: own team).
// ──────────────────────────────────────────────────────────────────────────
function d2dRawSales() {
  const prevDept = state.indicatorDept;
  const prevAcct = state.indicatorAcctStatus;
  let raw = [];
  // D2D dashboard stays on the Pending/Serviced basis it launched with —
  // pinned so the Indicators-page default (Total) can't drift it.
  try { state.indicatorDept = 'd2d'; state.indicatorAcctStatus = 'pending_serviced'; raw = indicatorSales(); }
  catch (e) { raw = []; }
  finally { state.indicatorDept = prevDept; state.indicatorAcctStatus = prevAcct; }
  return raw;
}
// One-time cloud kick so a fresh login fills in without a manual refresh.
function _d2dKickIfEmpty() {
  if ((state._indicatorRawSales || []).length) return false;
  if (!state._d2dCrmKick && !(typeof DEMO !== 'undefined' && DEMO) && typeof refreshIndicatorsFromCloud === 'function') {
    state._d2dCrmKick = true;
    Promise.resolve(refreshIndicatorsFromCloud(true))
      .then(() => { if (D2D_SALES_TAB_KEYS.has(state.view)) mountApp(); })
      .catch(() => {});
  }
  return true;
}
function _d2dIso(s) { return (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || ''; }
function _d2dTodayIso() { return (typeof bizTodayIso === 'function') ? bizTodayIso() : new Date().toISOString().slice(0, 10); }

function viewD2dDashboard() {
  const wrap = el('div', { class: 'flex flex-col gap-4 w-full' });
  const loading = _d2dKickIfEmpty();
  const raw = d2dRawSales();
  if (!raw.length) {
    wrap.append(el('div', { class: 'card p-10 text-center text-sm text-muted-' },
      loading ? 'Loading the CRM dataset…' : 'No D2D sales in the CRM snapshot yet — hit the ↻ sync icon.'));
    return wrap;
  }
  const todayIso = _d2dTodayIso();
  // Company week: Sunday–Saturday (Sunday is day 1).
  const _td = new Date(todayIso + 'T12:00:00');
  const _ws = new Date(_td); _ws.setDate(_td.getDate() - _td.getDay());
  const weekStartIso = _ws.toISOString().slice(0, 10);
  const monthIso = todayIso.slice(0, 7);
  const yearIso = todayIso.slice(0, 4);
  const _yd = new Date(_td); _yd.setDate(_td.getDate() - 1);
  const yesterdayIso = _yd.toISOString().slice(0, 10);
  const inRange = (iso, r) => r === 'today' ? iso === todayIso
    : r === 'yesterday' ? iso === yesterdayIso
    : r === 'week' ? (iso >= weekStartIso && iso <= todayIso)
    : r === 'month' ? iso.slice(0, 7) === monthIso
    : r === 'custom' ? (iso >= (state._d2dCustomStart || todayIso) && iso <= (state._d2dCustomEnd || todayIso))
    : iso.slice(0, 4) === yearIso;

  // ── Range control (top right) — one range drives the record tiles AND
  // the leaderboard below. "Custom…" opens a start/end date pair. ──
  if (!state._d2dLbRange) state._d2dLbRange = 'today';
  const lbHost = el('div', { class: 'flex flex-col gap-4' });
  const rangeHost = el('div', { class: 'flex items-center justify-end gap-2 flex-wrap' });
  const _rebuildBoards = () => { lbHost.innerHTML = ''; lbHost.append(buildBoards()); };
  const renderRange = () => {
    rangeHost.innerHTML = '';
    const _rangeKids = [
      el('select', {
        class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
        onchange: (e) => {
          state._d2dLbRange = e.target.value;
          if (state._d2dLbRange === 'custom') {
            if (!state._d2dCustomStart) state._d2dCustomStart = todayIso;
            if (!state._d2dCustomEnd) state._d2dCustomEnd = todayIso;
          }
          renderRange(); _rebuildBoards();
        },
      }, ...[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month'], ['year', 'This Year'], ['custom', 'Custom…']]
        .map(([v, l]) => el('option', { value: v, selected: state._d2dLbRange === v }, l))),
      state._d2dLbRange === 'custom' ? el('div', { class: 'flex items-center gap-2' },
        el('input', { type: 'date', class: 'rounded-xl px-2.5 py-1 text-[11px]', value: state._d2dCustomStart || '', onchange: (e) => { state._d2dCustomStart = e.target.value; _rebuildBoards(); } }),
        el('span', { class: 'text-muted- text-xs' }, '→'),
        el('input', { type: 'date', class: 'rounded-xl px-2.5 py-1 text-[11px]', value: state._d2dCustomEnd || '', onchange: (e) => { state._d2dCustomEnd = e.target.value; _rebuildBoards(); } })) : null,
    ];
    rangeHost.append(..._rangeKids.filter(Boolean));   // append() stringifies null — filter first
  };
  // (Range control lives in the Leaderboard header, right side — per Isaac —
  // since the hero card above is fixed Today/Week/Month/Year.)

  // ── Hero: Today · This Week · This Month · This Year — ONE combined
  // card with four stats side by side (per Isaac, same look as the Inside
  // Sales KPI cards) instead of four separate tiles. ──
  const kpiMulti = (stats, cols) => el('div', { class: 'card p-4 sm:p-5 grid kpi-multi ' + (cols === 3 ? 'kpi-multi-3 grid-cols-1 sm:grid-cols-3' : 'kpi-multi-4 grid-cols-2 sm:grid-cols-4') },
    ...stats.map(([label, value, sub], i) => el('div', {
      class: 'min-w-0 flex flex-col justify-center px-2 sm:px-4 text-center' + (i > 0 ? ' border-l' : ''),
      style: i > 0 ? { borderColor: 'var(--border)' } : {},
    },
      el('div', { class: 'text-[9px] sm:text-[10px] text-muted- uppercase tracking-widest font-semibold truncate' }, label),
      typeof value === 'string' ? el('div', { class: 'font-display text-2xl sm:text-4xl mt-1.5 tabular-nums truncate leading-none' }, value) : value,
      sub ? el('div', { class: 'text-[11px] text-muted- tabular-nums mt-1 truncate' }, sub) : null)));
  const byRange = (r) => raw.filter(s => { const iso = _d2dIso(s); return iso && inRange(iso, r); });
  const heroStat = (label, rows) => {
    const cv = rows.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    return [label, fmt.usd0(cv), rows.length + (rows.length === 1 ? ' account' : ' accounts')];
  };
  wrap.append(kpiMulti([
    heroStat('Today', byRange('today')), heroStat('This Week', byRange('week')),
    heroStat('This Month', byRange('month')), heroStat('This Year', byRange('year'))], 4));

  const buildBoards = () => {
    const r = state._d2dLbRange;
    const rows = byRange(r);
    const byRep = new Map();
    const PEST_EXCL = /sentricon|german\s*roach|interior\s*flea/i;   // Avg Pest Init formula (matches player cards)
    rows.forEach(s => {
      const nm = getCanonicalRepName(s.rep);
      if (!nm) return;
      const o = byRep.get(nm) || { name: nm, n: 0, cv: 0, apay: 0, init: 0, pestInit: 0, pestN: 0, multi: 0, twelve: 0, lastResort: 0, office: '', keptCv: 0 };
      if (!o.office && s.office) o.office = String(s.office).split(',')[0].trim();
      o.n++; o.cv += Number(s.contractValue) || 0;
      if (s.autoPay && s.autoPay !== 'No') o.apay++;
      o.init += Number(s.initialPrice) || 0;
      if (!PEST_EXCL.test(String(s.subscription || ''))) { o.pestN++; o.pestInit += Number(s.initialPrice) || 0; }
      const _mo = Number(s.contract) || 0;
      const _myb = myBucketOf(s);
      if (_myb === 'multi') o.multi++; else if (_myb === 'twelve') o.twelve++;
      if ((Number(s.initialPrice) || 0) < 99) o.lastResort++;   // Last Resort — same <$99 rule as Indicators/LMS
      // Retained $ (per Isaac): contract value still on the books — real
      // cancels only (RORs / sold-not-started / combined / renewals don't count against the rep).
      if (!(_subCancelledNow(s) && !_isExcludableCancel(s))) o.keptCv += Number(s.contractValue) || 0;
      byRep.set(nm, o);
    });
    // Sortable headers (per Isaac) — default revenue desc.
    if (!state._d2dLbSort) state._d2dLbSort = { key: 'cv', dir: 'desc' };
    const _sortKey = state._d2dLbSort.key, _sortDir = state._d2dLbSort.dir;
    const _metric = (o, k) => k === 'name' ? o.name : k === 'team' ? (getRepTeam(o.name) || '')
      : k === 'n' ? o.n : k === 'cv' ? o.cv : k === 'acv' ? (o.n ? o.cv / o.n : 0)
      : k === 'my' ? ((o.multi + o.twelve) ? o.multi / (o.multi + o.twelve) : 0)
      : k === 'apay' ? (o.n ? o.apay / o.n : 0) : k === 'init' ? (o.n ? o.init / o.n : 0)
      : k === 'pest' ? (o.pestN ? o.pestInit / o.pestN : 0) : k === 'lr' ? (o.n ? o.lastResort / o.n : 0) : k === 'ret' ? (o.cv ? o.keptCv / o.cv : 0) : 0;
    const reps = [...byRep.values()].sort((a, b) => {
      const va = _metric(a, _sortKey), vb = _metric(b, _sortKey);
      const c = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
      return (_sortDir === 'asc' ? c : -c) || (b.cv - a.cv);
    });
    const _setSort = (k) => {
      const cur = state._d2dLbSort;
      state._d2dLbSort = { key: k, dir: cur.key === k ? (cur.dir === 'desc' ? 'asc' : 'desc') : (k === 'name' || k === 'team' ? 'asc' : 'desc') };
      _rebuildBoards();
    };
    const _stickyL = (left) => ({ position: 'sticky', left: left, background: 'var(--card)', zIndex: 1 });
    const _sigMe = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const meSig = _sigMe(state.profile?.full_name);
    // Branch color chip (workbook palette) — used on the leaderboard rows
    // and the sales list so every line reads its branch at a glance.
    const _ofcChip = (office) => {
      const label = branchAlias(office);
      const bc = (typeof BRANCH_COLORS !== 'undefined') ? BRANCH_COLORS[label.toUpperCase()] : null;
      return bc ? el('span', {
        title: label.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
        style: { width: '9px', height: '9px', borderRadius: '0', background: bc, border: '1px solid var(--border-2)', display: 'inline-block', flexShrink: '0', marginRight: '7px' },
      }) : null;
    };
    const showDate = r !== 'today' && r !== 'yesterday';
    const _tod = (s) => { const t = _parseIndicatorTime(s); return t ? t.hour * 60 + t.minute : null; };
    const _timeStr = (s) => { const t = _parseIndicatorTime(s); return t ? ((t.hour % 12 || 12) + ':' + String(t.minute).padStart(2, '0') + (t.hour < 12 ? 'a' : 'p') + ' ' + _officeTzShort(s.office)) : '—'; };
    const _feedTitle = ({ today: "Today's Sales", yesterday: "Yesterday's Sales", week: "This Week's Sales", month: "This Month's Sales", year: "This Year's Sales", all: 'All Sales' })[r] || 'Sales';
    // Inline accounts table (used by every rep row AND the Total row).
    const _sortRows = (list) => [...list].sort((a, b) => {
      const _da = _d2dIso(a) || '', _db = _d2dIso(b) || '';
      if (_da !== _db) return _db.localeCompare(_da);
      const ta = _tod(a), tb = _tod(b);
      return (tb == null ? -1 : tb) - (ta == null ? -1 : ta);
    });
    const accountsTable = (title, list, withRep) => el('td', { colspan: 11, class: 'px-4 py-2' },
      el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-1' }, title + ' \u00b7 ' + list.length + ' account' + (list.length === 1 ? '' : 's')),
      el('table', { class: 'w-full text-[12px]' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' }, el('tr', {},
          el('th', { class: 'text-left px-2 py-1 font-semibold' }, showDate ? 'Date' : 'Time'),
          withRep ? el('th', { class: 'text-left px-2 py-1 font-semibold' }, 'Rep') : null,
          el('th', { class: 'text-left px-2 py-1 font-semibold' }, 'Customer'),
          el('th', { class: 'text-left px-2 py-1 font-semibold' }, 'Service'),
          el('th', { class: 'text-left px-2 py-1 font-semibold' }, 'Contract'),
          el('th', { class: 'text-left px-2 py-1 font-semibold' }, 'Initial'),
          el('th', { class: 'text-left px-2 py-1 font-semibold' }, 'Value'),
          el('th', { class: 'text-left px-2 py-1 font-semibold' }, 'APay'))),
        el('tbody', {}, ...list.slice(0, 400).map(sr => {
          const _m = Number(sr.contract) || 0;
          return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-2 py-1.5 text-muted- tabular-nums whitespace-nowrap' }, showDate ? (_d2dIso(sr) || '\u2014') : _timeStr(sr)),
            withRep ? el('td', { class: 'px-2 py-1.5 whitespace-nowrap' }, el('span', { class: 'flex items-center' }, _ofcChip(sr.office), getCanonicalRepName(sr.rep) || '\u2014')) : null,
            el('td', { class: 'px-2 py-1.5 font-semibold whitespace-nowrap' }, String(sr.customer || '\u2014')),
            el('td', { class: 'px-2 py-1.5 text-muted- whitespace-nowrap overflow-hidden', style: { maxWidth: '180px', textOverflow: 'ellipsis' } }, String(sr.subscription || '\u2014')),
            el('td', { class: 'px-2 py-1.5 text-muted- whitespace-nowrap' }, /sentricon/i.test(String(sr.subscription || '')) ? '12 Mo' : (_m > 1 ? _m + ' Mo' : 'One-Time')),
            el('td', { class: 'px-2 py-1.5 tabular-nums' }, fmt.usd0(Number(sr.initialPrice) || 0)),
            el('td', { class: 'px-2 py-1.5 tabular-nums font-semibold' }, fmt.usd0(Number(sr.contractValue) || 0)),
            el('td', { class: 'px-2 py-1.5 text-muted-' }, (sr.autoPay && sr.autoPay !== 'No') ? 'Yes' : 'No'));
        }))));
    const lbCard = el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 flex items-center justify-between flex-wrap gap-2 border-b', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'font-display text-lg' }, 'Leaderboard'),
        rangeHost),
      reps.length ? el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
        el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
          ...[['#', null], ['Rep', 'name'], ['Team', 'team'], ['Accts', 'n'], ['Revenue', 'cv'], ['ACV', 'acv'], ['MY %', 'my'], ['APay %', 'apay'], ['Avg Initial', 'init'], ['Avg Pest Init', 'pest'], ['Last Resort %', 'lr'], ['Retained %', 'ret']].map(([h, k], i) => el('th', {
            class: 'px-4 py-2 whitespace-nowrap' + (k ? ' cursor-pointer select-none' : ''),
            style: Object.assign({}, i === 0 ? Object.assign(_stickyL('0'), { zIndex: 2, minWidth: '40px', width: '40px' }) : i === 1 ? Object.assign(_stickyL('40px'), { zIndex: 2 }) : {}, k && _sortKey === k ? { color: 'var(--accent)', fontWeight: '800' } : {}),
            title: h === 'MY %' ? 'Multi-year mix \u2014 18mo+ \u00f7 (12mo + 18mo+)' : h === 'Last Resort %' ? 'Accounts under $99 initial \u00f7 all accounts' : h === 'Retained %' ? 'Revenue still on the books \u00f7 revenue sold \u2014 real cancels only (RORs, sold-not-started, combined and renewals do not count against the rep)' : (k ? 'Sort by ' + h : ''),
            onclick: k ? () => _setSort(k) : undefined,
          }, h)))),
        el('tbody', {},
          // Total row (per Isaac — mirrors the Indicators leaderboard): sums +
          // sales-weighted rates across every rep shown; click expands the
          // range's accounts.
          ...(() => {
            const T = reps.reduce((t, o) => ({ n: t.n + o.n, cv: t.cv + o.cv, apay: t.apay + o.apay, init: t.init + o.init, pestInit: t.pestInit + o.pestInit, pestN: t.pestN + o.pestN, multi: t.multi + o.multi, twelve: t.twelve + o.twelve, lastResort: t.lastResort + o.lastResort, keptCv: t.keptCv + o.keptCv }),
              { n: 0, cv: 0, apay: 0, init: 0, pestInit: 0, pestN: 0, multi: 0, twelve: 0, lastResort: 0, keptCv: 0 });
            // Click = expand every account sold in this range (per Isaac),
            // not the combined player card.
            const canTot = rows.length > 0;
            const totOpen = state._d2dLbOpen === '__total__';
            const openTot = () => { state._d2dLbOpen = totOpen ? null : '__total__'; _rebuildBoards(); };
            const tdT = (v, cls) => el('td', { class: 'px-4 py-2 tabular-nums font-bold ' + (cls || '') }, v);
            const totDetail = totOpen ? el('tr', { style: { background: 'var(--card-2)' } }, accountsTable(_feedTitle, _sortRows(rows), true)) : null;
            return [el('tr', {
              class: canTot ? 'cursor-pointer transition hover:brightness-95' : '',
              title: canTot ? (totOpen ? 'Hide accounts' : 'Show every account sold in this range') : '',
              onclick: canTot ? openTot : undefined,
              style: { background: 'var(--card-2)', boxShadow: 'inset 0 -2px 0 var(--border-2), inset 0 1px 0 var(--border)' },
            },
              el('td', { class: 'px-4 py-2 text-base leading-none', style: Object.assign(_stickyL('0'), { background: 'var(--card-2)', fontFamily: 'Georgia, "Times New Roman", serif' }) }, '\ud835\udd7d'),
              el('td', { class: 'px-4 py-2 whitespace-nowrap', style: Object.assign(_stickyL('40px'), { background: 'var(--card-2)' }) },
                el('span', { class: 'font-black text-[11px] uppercase tracking-wider' }, 'Total'),
                el('span', { class: 'text-[10px] text-muted- ml-1.5' }, reps.length + ' reps')),
              el('td', { class: 'px-4 py-2 font-bold whitespace-nowrap' }, 'RIDD'),
              tdT(String(T.n)), tdT(fmt.usd0(T.cv)), tdT(fmt.usd0(T.n ? T.cv / T.n : 0)),
              tdT(((T.multi + T.twelve) ? Math.round(T.multi / (T.multi + T.twelve) * 100) : 0) + '%'),
              tdT((T.n ? Math.round(T.apay / T.n * 100) : 0) + '%'),
              tdT(fmt.usd0(T.n ? T.init / T.n : 0)), tdT(fmt.usd0(T.pestN ? T.pestInit / T.pestN : 0)),
              tdT((T.n ? (T.lastResort / T.n * 100).toFixed(1) : '0.0') + '%'),
              tdT((T.cv ? (T.keptCv / T.cv * 100).toFixed(1) : '0.0') + '%')), totDetail];
          })().filter(Boolean),
          ...reps.slice(0, 100).flatMap((o, i) => {
          const team = getRepTeam(o.name) || '';
          const clickable = true;   // any rep may open the Sales view (per Isaac)
          const isMe = _sigMe(o.name) === meSig || isMyRepName(o.name);
          // Click = expand the rep's accounts for this range inline (per
          // Isaac — not the player card). One rep open at a time.
          const isOpen = state._d2dLbOpen === o.name;
          const repRows = isOpen ? _sortRows(rows.filter(x => getCanonicalRepName(x.rep) === o.name)) : [];
          const detailRow = isOpen ? el('tr', { style: { background: 'var(--card-2)' } }, accountsTable(o.name, repRows, false)) : null;
          return [el('tr', {
            class: 'border-t' + (clickable ? ' cursor-pointer' : ''),
            style: { borderColor: 'var(--border)', background: isMe ? 'rgba(223,100,58,.08)' : (isOpen ? 'var(--card-2)' : '') },
            title: clickable ? (isOpen ? 'Hide accounts' : 'Show accounts sold in this range') : '',
            onclick: clickable ? () => { state._d2dLbOpen = isOpen ? null : o.name; _rebuildBoards(); } : undefined,
            onmouseenter: clickable ? (e) => { if (!isMe) e.currentTarget.style.background = 'var(--card-2)'; } : undefined,
            onmouseleave: clickable ? (e) => { if (!isMe) e.currentTarget.style.background = isOpen ? 'var(--card-2)' : ''; } : undefined,
          },
            el('td', { class: 'px-4 py-2 tabular-nums text-muted-', style: Object.assign(_stickyL('0'), isMe || isOpen ? { background: 'var(--card-2)' } : {}) }, String(i + 1)),
            el('td', { class: 'px-4 py-2 font-semibold whitespace-nowrap', style: Object.assign(_stickyL('40px'), isMe || isOpen ? { background: 'var(--card-2)' } : {}) }, _ofcChip(o.office), o.name + (isMe ? ' · You' : '')),
            el('td', { class: 'px-4 py-2 text-muted- whitespace-nowrap' }, team || '—'),
            el('td', { class: 'px-4 py-2 tabular-nums' }, String(o.n)),
            el('td', { class: 'px-4 py-2 tabular-nums font-semibold' }, fmt.usd0(o.cv)),
            el('td', { class: 'px-4 py-2 tabular-nums' }, fmt.usd0(o.n ? o.cv / o.n : 0)),
            el('td', { class: 'px-4 py-2 tabular-nums' }, ((o.multi + o.twelve) ? Math.round(o.multi / (o.multi + o.twelve) * 100) : 0) + '%'),
            el('td', { class: 'px-4 py-2 tabular-nums' }, (o.n ? Math.round(o.apay / o.n * 100) : 0) + '%'),
            el('td', { class: 'px-4 py-2 tabular-nums' }, fmt.usd0(o.n ? o.init / o.n : 0)),
            el('td', { class: 'px-4 py-2 tabular-nums' }, fmt.usd0(o.pestN ? o.pestInit / o.pestN : 0)),
            el('td', { class: 'px-4 py-2 tabular-nums', style: (o.n && o.lastResort / o.n >= 0.2) ? { color: '#DC2626', fontWeight: '600' } : {} }, (o.n ? (o.lastResort / o.n * 100).toFixed(1) : '0.0') + '%'),
            el('td', { class: 'px-4 py-2 tabular-nums font-semibold', style: o.cv && o.keptCv / o.cv < 0.8 ? { color: '#DC2626' } : {} }, (o.cv ? (o.keptCv / o.cv * 100).toFixed(1) : '0.0') + '%')), detailRow].filter(Boolean);
        }))))
        : el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'No sales in this range yet.'));
    // ── Day records: earliest · latest · biggest sale in the range ──
    // Times are each selling office's local clock, so "earliest" means the
    // earliest knock in that rep's own day (not the earliest in UTC).
    const timed = rows.filter(s => _tod(s) != null);
    const earliestSale = timed.length ? timed.reduce((a, b) => (_tod(b) < _tod(a) ? b : a)) : null;
    const latestSale = timed.length ? timed.reduce((a, b) => (_tod(b) > _tod(a) ? b : a)) : null;
    const biggestSale = rows.length ? rows.reduce((a, b) => ((Number(b.contractValue) || 0) > (Number(a.contractValue) || 0) ? b : a)) : null;
    // Records: one combined card, three stats side by side.
    const recordStat = (label, s, leadValue) => [label,
      s ? el('div', { class: 'font-display text-2xl mt-1.5 flex items-center justify-center whitespace-nowrap overflow-hidden leading-none' },
            _ofcChip(s.office), leadValue ? fmt.usd0(Number(s.contractValue) || 0) : _timeStr(s))
        : el('div', { class: 'font-display text-2xl mt-1.5 text-muted- leading-none' }, '—'),
      s ? (getCanonicalRepName(s.rep) || '—') + ' · ' + (leadValue ? _timeStr(s) : fmt.usd0(Number(s.contractValue) || 0)) + (showDate ? ' · ' + _d2dIso(s) : '') : ''];
    const recordsCard = rows.length ? kpiMulti([
      recordStat('Earliest Sale', earliestSale),
      recordStat('Latest Sale', latestSale),
      recordStat('Biggest Sale', biggestSale, true)], 3) : null;
    // \u2500\u2500 Sales feed (per Isaac) \u2014 same Today's Sales list as the Inside
    // Sales dashboard: newest first, ~10 rows visible, the rest scroll.
    const _feedRows = [...rows].sort((a, b) => {
      const _da = _d2dIso(a) || '', _db = _d2dIso(b) || '';
      if (_da !== _db) return _db.localeCompare(_da);
      const ta = _tod(a), tb = _tod(b);
      return (tb == null ? -1 : tb) - (ta == null ? -1 : ta);
    });
    const feedCard = el('div', { class: 'card overflow-hidden flex flex-col' },
      el('div', { class: 'px-5 py-3 flex items-center justify-between border-b', style: { borderColor: 'var(--border)' } },
        el('h3', { class: 'text-base font-bold' }, _feedTitle),
        el('span', { class: 'text-xs text-muted-' }, fmt.int(_feedRows.length))),
      _feedRows.length === 0
        ? el('div', { class: 'flex-1 flex items-center justify-center py-16 text-muted- text-sm' }, 'No sales')
        : el('div', { class: 'scroll-x', style: { maxHeight: '412px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-[12px]' },
            el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-', style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: '1' } },
              el('tr', {},
                el('th', { class: 'text-left pl-4 pr-2 py-1.5 font-semibold' }, showDate ? 'Date' : 'Time'),
                el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Rep'),
                el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Service'),
                el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Contract'),
                el('th', { class: 'text-right pr-4 pl-2 py-1.5 font-semibold' }, 'Value'))),
            el('tbody', {},
              ..._feedRows.slice(0, 400).map(sr => {
                const _m = Number(sr.contract) || 0;
                return el('tr', { class: 'border-t border-' },
                  el('td', { class: 'pl-4 pr-2 py-2 text-muted- tabular-nums text-[11px] whitespace-nowrap' }, showDate ? (_d2dIso(sr) || '\u2014') : _timeStr(sr)),
                  el('td', { class: 'px-2 py-2 whitespace-nowrap' }, el('span', { class: 'flex items-center' }, _ofcChip(sr.office), (getCanonicalRepName(sr.rep) || '\u2014').split(' ')[0])),
                  el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap overflow-hidden', style: { maxWidth: '150px', textOverflow: 'ellipsis' } }, String(sr.subscription || '\u2014')),
                  el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap' }, /sentricon/i.test(String(sr.subscription || '')) ? '12 Mo' : (_m > 1 ? _m + ' Mo' : 'One-Time')),
                  el('td', { class: 'pr-4 pl-2 py-2 text-right font-semibold tabular-nums' }, fmt.usd0(Number(sr.contractValue) || 0)));
              })))));
    // (Sales feed dropped from this tab per Isaac — the leaderboard gets the full width.)
    void feedCard;
    return el('div', { class: 'flex flex-col gap-4' }, recordsCard, lbCard);
  };
  renderRange();
  lbHost.append(buildBoards());
  wrap.append(lbHost);
  return wrap;
}

// ── D2D UPFRONT PAY — the season pay-stub model, live from FieldRoutes ─────
// Category rates paid on contract value off the top (Pest / Bundle /
// Ancillary), mirroring the old stub tool. Same row pool + canonical gates
// as commissionCompute, so Upfront and Pay (backend) always reconcile on
// accounts — they just price them differently.
function viewD2dUpfront() {
  const money = (n) => { const v = Math.round((n || 0) * 100) / 100; return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }); };
  const pctS = (n) => (Math.round((n || 0) * 10) / 10) + '%';
  if (!isAdminRole(state.profile?.role)) {
    return el('div', { class: 'flex flex-col gap-4 w-full' },
      el('h1', { class: 'text-2xl font-bold' }, 'Upfront Pay'),
      el('div', { class: 'card p-10 text-center text-sm text-muted-' },
        'Your upfront pay stub will live here — your admin runs and publishes it. Check the Pay tab for your published commission.'));
  }
  // Roster: CRM Sales Reps (same source as the calculator).
  if (state.frRoster == null && !state._frRosterLoading) loadFieldRoutesRoster().then(() => { if (state.view === 'commission') mountApp(); });
  const roster = state.frRoster || [];
  const salesReps = roster.filter(e => e.type_label === 'Sales Rep').sort((a, b) => _frEmpName(a).localeCompare(_frEmpName(b)));
  if (!salesReps.length) return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'No Sales Reps in the roster yet — run a sync first.');
  if (!state._commEmpId || !salesReps.find(e => e.employee_id === state._commEmpId)) state._commEmpId = salesReps[0].employee_id;
  const emp = salesReps.find(e => e.employee_id === state._commEmpId);
  // CRM snapshot on demand (identical guard to the calculator).
  const activeId = state.reportingActiveUploadId;
  if (!activeId) return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'No CRM snapshot yet — hit the ↻ sync icon to pull FieldRoutes, then come back.');
  if (state.reportingSubscriptionsLoadedFor !== activeId) {
    loadReportingSubscriptions(activeId).then(rows => { if (rows && state.reportingActiveUploadId === activeId) { state.reportingSubscriptions = rows; state.reportingSubscriptionsLoadedFor = activeId; mountApp(); } });
    return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'Loading the CRM snapshot…');
  }
  const yr = new Date().getFullYear();
  // Default period: the PREVIOUS completed week (Sun–Sat) — payroll runs on
  // the week that just closed (per Isaac). Own state, so the Pay tab's YTD
  // default stays untouched.
  if (state._upfrontStart == null || state._upfrontEnd == null) {
    const _n = new Date(); _n.setHours(12, 0, 0, 0);
    const _sun = new Date(_n); _sun.setDate(_n.getDate() - _n.getDay() - 7);
    const _sat = new Date(_sun); _sat.setDate(_sun.getDate() + 6);
    state._upfrontStart = _sun.toISOString().slice(0, 10);
    state._upfrontEnd = _sat.toISOString().slice(0, 10);
  }
  // ── PAY-PERIOD LOCK WORKFLOW (draft → locked) ──────────────────────────
  // Locks are shared across admins (app_settings 'commission_locks').
  // Run Commissions requires the period to be LOCKED first, so every admin
  // runs the same frozen window and reps can trust the stub they receive.
  // Unlocking is allowed (admin) but leaves the ledger of who locked what.
  if (state._commLocks === undefined && supabase && !DEMO) {
    state._commLocks = null; // loading
    supabase.from('app_settings').select('value').eq('key', 'commission_locks').maybeSingle()
      .then(({ data }) => {
        state._commLocks = (data && data.value && data.value.locks) || {};
        if (state.view === 'commission') mountApp();
      }).catch(() => { state._commLocks = {}; });
  }
  const _lockKey = String(state._upfrontStart) + '|' + String(state._upfrontEnd);
  const _lock = (state._commLocks || {})[_lockKey] || null;
  const _saveLocks = async (locks) => {
    state._commLocks = locks;
    try {
      const { error } = await supabase.from('app_settings').upsert({ key: 'commission_locks', value: { locks } }, { onConflict: 'key' });
      if (error) toast('Lock save failed: ' + error.message, 'error');
    } catch (e2) { toast('Lock save failed: ' + ((e2 && e2.message) || e2), 'error'); }
    mountApp();
  };
  const startMs = state._upfrontStart ? Date.parse(state._upfrontStart) : 0;
  const endMs   = state._upfrontEnd ? Date.parse(state._upfrontEnd) + 86399000 : 0;

  const R = commissionCompute(emp, startMs, endMs, 0);   // same pool, same gates
  const typeLabel = emp.type_label || 'Sales Rep';
  const U = upfrontRatesFor(emp.employee_id, typeLabel);
  const man = commissionManual(emp.employee_id);
  const saveMan = (patch) => { setCommissionManual(emp.employee_id, Object.assign({}, man, patch)); mountApp(); };
  const saveU = (patch) => { const c = commissionConfig(); c.upfrontRepRates = Object.assign({}, c.upfrontRepRates); c.upfrontRepRates[emp.employee_id] = Object.assign({}, c.upfrontRepRates[emp.employee_id], patch); saveCommissionConfig(c); mountApp(); };
  const clearU = () => { const c = commissionConfig(); c.upfrontRepRates = Object.assign({}, c.upfrontRepRates); delete c.upfrontRepRates[emp.employee_id]; saveCommissionConfig(c); mountApp(); };

  const pestPay = R.pestRev * U.pest, bundlePay = R.bundleRev * U.bundle, ancPay = R.ancRev * U.anc;
  const upOverrides = Number(man.upfrontOverrides) || 0;
  const upDeduct = Number(man.upfrontDeduct) || 0;
  // D2D pays out WEEKLY (per Isaac) — 52 periods, own field (the Pay tab's
  // 26 bi-weekly periods are an inside-sales thing).
  const payPeriods = Number(man.upfrontPayPeriods) || 52;
  const totalUpfront = pestPay + bundlePay + ancPay + upOverrides;
  const netDue = totalUpfront - upDeduct;
  const weeklyPay = payPeriods ? netDue / payPeriods : netDue;
  // Account stats — canceled per canonical rules + frozen from the pool.
  const frozenN = R.rows.filter(r => /frozen/i.test(String(r.subscription_status || '')) && !r.subscription_date_canceled).length;
  const lostN = R.canceled + frozenN;
  const activeN = Math.max(0, R.sold - lostN);

  const stat = (label, val, sub, edge) => el('div', { class: 'card p-4 min-w-0', style: edge ? { borderLeft: '3px solid ' + edge } : {} },
    el('div', { class: 'text-2xl font-display tabular-nums' }, val),
    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mt-0.5' }, label),
    sub ? el('div', { class: 'text-[10px] text-muted-' }, sub) : null);
  const lblS = (t) => el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold block mb-1' }, t);
  const dateInput = (val, onCommit) => el('input', { type: 'date', value: val || '', class: 'rounded-xl border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onchange: (e) => { onCommit(e.target.value); mountApp(); } });
  const repSelect = el('select', { class: 'rounded-xl border px-2.5 py-1 text-[11px] font-medium', style: { borderColor: 'var(--border-2)', maxWidth: '260px' }, onchange: (e) => { state._commEmpId = e.target.value; mountApp(); } },
    ...salesReps.map(e => el('option', { value: e.employee_id, selected: e.employee_id === state._commEmpId }, _frEmpName(e) + (e.office_name ? ' · ' + e.office_name : ''))));
  const rateField = (label, frac, key) => el('label', { class: 'block' }, lblS(label),
    el('div', { class: 'flex items-center gap-1' },
      el('input', { type: 'number', step: '1', min: '0', max: '100', value: Math.round(frac * 1000) / 10,
        class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] text-left tabular-nums', style: { borderColor: 'var(--border-2)' },
        onchange: (e) => saveU({ [key]: (parseFloat(e.target.value) || 0) / 100 }) }),
      el('span', { class: 'text-xs text-muted-' }, '%')));
  const numField = (label, val, onCommit) => el('label', { class: 'block' }, lblS(label),
    el('input', { type: 'number', step: '0.01', value: (val == null ? '' : val),
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] text-left tabular-nums', style: { borderColor: 'var(--border-2)' },
      onchange: (e) => onCommit(e.target.value) }));

  const earnRow = (label, rev, rate, pay) => el('div', { class: 'flex items-center gap-4 gap-3 px-3 py-2.5 text-sm', style: { borderTop: '1px solid var(--border)' } },
    el('div', { class: 'min-w-0' },
      el('div', { class: 'font-semibold' }, label),
      el('div', { class: 'text-[11px] text-muted- tabular-nums' }, money(rev) + ' revenue')),
    el('div', { class: 'flex items-center gap-3 shrink-0' },
      el('span', { class: 'text-xs font-bold px-2 py-1 rounded-lg tabular-nums', style: { background: 'var(--card-2)' } }, Math.round(rate * 100) + '%'),
      el('span', { class: 'tabular-nums font-bold', style: { minWidth: '90px', textAlign: 'left' } }, money(pay))));

  const earnings = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-3 py-2 font-display text-xl', style: { background: 'var(--text)', color: 'var(--bg)' } }, 'Upfront Earnings'),
    earnRow('Personal Pest', R.pestRev, U.pest, pestPay),
    earnRow('Personal Bundle', R.bundleRev, U.bundle, bundlePay),
    earnRow('Personal Ancillary', R.ancRev, U.anc, ancPay),
    el('div', { class: 'flex items-center gap-4 px-3 py-2 text-sm', style: { borderTop: '1px solid var(--border)' } },
      el('span', {}, 'Overrides (downline)'), el('span', { class: 'tabular-nums' }, money(upOverrides))),
    el('div', { class: 'flex items-center gap-4 px-3 py-2 text-sm', style: { borderTop: '1px solid var(--border)' } },
      el('span', {}, 'Deductions'), el('span', { class: 'tabular-nums' }, money(-upDeduct))),
    el('div', { class: 'flex items-center gap-4 px-3 py-2.5', style: { borderTop: '2px solid var(--text)', background: 'rgba(223,100,58,.18)' } },
      el('span', { class: 'font-display text-lg' }, 'NET DUE'), el('span', { class: 'font-display text-lg tabular-nums' }, money(netDue))),
    el('div', { class: 'flex items-center gap-4 px-3 py-2 text-sm', style: { borderTop: '1px solid var(--border)', background: 'rgba(95,108,91,.08)' } },
      el('span', { class: 'font-semibold' }, 'Weekly Pay (÷ ' + payPeriods + ')'), el('span', { class: 'tabular-nums font-semibold' }, money(weeklyPay))),
    R.unclRev > 0 ? el('div', { class: 'px-3 py-2 text-[11px]', style: { borderTop: '1px solid var(--border)', color: '#A9441F' } },
      '⚠ ' + money(R.unclRev) + ' in unmapped service types earns $0 here — map them in Settings → Commissions.') : null);

  const ratesPanel = el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center gap-4 gap-2 mb-1' },
      el('div', { class: 'text-sm font-bold' }, 'Upfront rates · ' + _frEmpName(emp)),
      U.overridden ? el('button', { class: 'text-[11px] rounded px-2.5 py-1 border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, onclick: clearU }, 'Reset to default') : null),
    el('div', { class: 'text-[11px] text-muted- mb-3' }, 'Paid on contract value, off the top. These are separate from the backend (Pay tab) rates. Editing here overrides just this rep.'),
    el('div', { class: 'grid grid-cols-3 gap-3' },
      rateField('Pest %', U.pest, 'pest'), rateField('Bundle %', U.bundle, 'bundle'), rateField('Ancillary %', U.anc, 'anc')));

  const manualPanel = el('div', { class: 'card p-4' },
    el('div', { class: 'text-sm font-bold mb-3' }, 'This run — overrides & deductions'),
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-3 gap-3' },
      numField('Overrides (downline)', man.upfrontOverrides, v => saveMan({ upfrontOverrides: v })),
      numField('Deductions', man.upfrontDeduct, v => saveMan({ upfrontDeduct: v })),
      numField('Pay Periods (weekly)', man.upfrontPayPeriods == null ? 52 : man.upfrontPayPeriods, v => saveMan({ upfrontPayPeriods: v }))),
    el('div', { class: 'text-[11px] text-muted- mt-2' }, 'Deductions entered as a positive number. D2D pays weekly — 52 periods by default.'));

  return el('div', { class: 'flex flex-col gap-4 w-full' },
    el('div', { class: 'flex items-end gap-4 flex-wrap gap-3' },
      el('div', {},
        el('h1', { class: 'text-2xl font-bold' }, 'Upfront Pay'),
        el('p', { class: 'text-xs text-muted-' }, 'The season pay-stub model — live from FieldRoutes with the same gates as the Pay tab, priced at upfront rates.')),
      el('div', { class: 'flex items-end gap-2 flex-wrap' },
        el('label', { class: 'block' }, lblS('Sales Rep'), repSelect),
        // Weekly pay periods (Sun–Sat company weeks) — picking one sets the
        // Sold from/to dates; manual dates still work for odd ranges.
        (() => {
          const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          const now = new Date(); now.setHours(0, 0, 0, 0);
          const curSun = new Date(now); curSun.setDate(now.getDate() - now.getDay());
          const fmtD = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const opts = [];
          for (let i = 0; i < 10; i++) {
            const s = new Date(curSun); s.setDate(curSun.getDate() - i * 7);
            const e = new Date(s); e.setDate(s.getDate() + 6);
            opts.push({ v: iso(s) + '|' + iso(e), label: (i === 0 ? 'This week · ' : i === 1 ? 'Last week · ' : '') + fmtD(s) + ' – ' + fmtD(e) });
          }
          const yr0 = now.getFullYear() + '-01-01';
          const curVal = state._upfrontStart + '|' + state._upfrontEnd;
          return el('label', { class: 'block' }, lblS('Pay period'),
            el('select', {
              class: 'rounded-xl border px-2.5 py-1 text-[11px] font-medium',
              style: { borderColor: 'var(--border-2)' },
              onchange: (e) => {
                const v = e.target.value; if (!v) return;
                const [s, en] = v.split('|');
                state._upfrontStart = s; state._upfrontEnd = en; mountApp();
              },
            },
              el('option', { value: '', selected: curVal !== (yr0 + '|' + iso(now)) && !opts.find(o => o.v === curVal) }, 'Custom…'),
              el('option', { value: yr0 + '|' + iso(now), selected: curVal === (yr0 + '|' + iso(now)) }, 'YTD'),
              ...opts.map(o => el('option', { value: o.v, selected: o.v === curVal }, o.label))));
        })(),
        el('label', { class: 'block' }, lblS('Sold from'), dateInput(state._upfrontStart, v => state._upfrontStart = v)),
        el('label', { class: 'block' }, lblS('Sold to'), dateInput(state._upfrontEnd, v => state._upfrontEnd = v)),
        // Period status — Draft until an admin locks it; Run requires Locked.
        el('label', { class: 'block' }, lblS('Period status'),
          el('div', { class: 'flex items-center gap-1.5' },
            el('span', {
              class: 'text-xs font-bold px-2.5 py-2 rounded-xl whitespace-nowrap',
              style: _lock ? { background: 'rgba(223,100,58,.18)', color: '#DF643A' } : { background: 'rgba(240,172,30,.16)', color: '#A9441F' },
              title: _lock ? ('Locked by ' + (_lock.name || 'admin') + ' · ' + String(_lock.at || '').slice(0, 10)) : 'Draft — numbers may still move; lock before running commissions',
            }, _lock ? '🔒 Locked' : '📝 Draft'),
            el('button', {
              class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold border cursor-pointer transition hover:brightness-95 whitespace-nowrap',
              style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
              title: _lock ? 'Reopen this period (the lock history note is replaced)' : 'Freeze this pay period so commissions can be run against it',
              onclick: () => {
                const locks = { ...(state._commLocks || {}) };
                if (_lock) {
                  if (!confirm('Unlock ' + state._upfrontStart + ' → ' + state._upfrontEnd + '? Reps may already have stubs from this period.')) return;
                  delete locks[_lockKey];
                } else {
                  locks[_lockKey] = { by: state.profile.id, name: state.profile.full_name || '', at: new Date().toISOString() };
                }
                _saveLocks(locks);
              },
            }, _lock ? 'Unlock' : 'Lock'))),
        // ── RUN COMMISSIONS — computes every Sales Rep for this period,
        // publishes their result, and emails each rep at the address on
        // their FieldRoutes account. Admin-JWT-gated server side.
        el('button', {
          class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95 whitespace-nowrap',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          title: 'Compute every rep for this period, publish, and email each rep at their FieldRoutes address',
          onclick: async (e) => {
            const btn = e.currentTarget;
            const periodLabel = state._upfrontStart + ' → ' + state._upfrontEnd;
            // Draft periods can't be run — locking first means every admin
            // runs the same frozen window and stubs are reproducible.
            if (!_lock) { toast('Lock the period first (Period status → Lock) — Draft periods can\u2019t be run', 'warn'); return; }
            const withEmail = salesReps.filter(x => /@/.test(String(x.email || '')));
            const noEmail = salesReps.length - withEmail.length;
            if (!confirm('Run commissions for ' + periodLabel + '?\n\n' + salesReps.length + ' Sales Reps will be computed and published; ' + withEmail.length + ' will be emailed at their FieldRoutes address' + (noEmail ? ' (' + noEmail + ' have no email on file and will be skipped)' : '') + '.')) return;
            btn.disabled = true; const orig = btn.textContent;
            const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
            const recipients = [];
            let computed = 0;
            try {
              for (const rep of salesReps) {
                btn.textContent = 'Computing ' + (++computed) + '/' + salesReps.length + '…';
                const Rr = commissionCompute(rep, startMs, endMs, 0);
                if (!Rr.sold) continue;   // nothing sold this period — no stub, no email
                const Ur = upfrontRatesFor(rep.employee_id, rep.type_label || 'Sales Rep');
                try { await publishCommissionResult(rep.employee_id, commissionSnapshot(Rr, rep, periodLabel), periodLabel); } catch (pubErr) { /* email still goes */ }
                if (!/@/.test(String(rep.email || ''))) continue;
                const rowsHtml = [
                  ['Pest', Rr.pestRev, Ur.pest], ['Bundle', Rr.bundleRev, Ur.bundle], ['Ancillary', Rr.ancRev, Ur.anc],
                ].map(([lb, rev, rate]) => '<tr><td style="padding:6px 10px;border-top:1px solid #eee">' + lb + '</td><td style="padding:6px 10px;border-top:1px solid #eee;text-align:right">' + money(rev) + '</td><td style="padding:6px 10px;border-top:1px solid #eee;text-align:right">' + Math.round(rate * 100) + '%</td><td style="padding:6px 10px;border-top:1px solid #eee;text-align:right"><b>' + money(rev * rate) + '</b></td></tr>').join('');
                const upTotal = Rr.pestRev * Ur.pest + Rr.bundleRev * Ur.bundle + Rr.ancRev * Ur.anc;
                recipients.push({
                  email: String(rep.email).trim(),
                  name: _frEmpName(rep),
                  subject: 'RIDD Commission · ' + periodLabel,
                  html: '<div style="font-family:Arial,sans-serif;max-width:520px">'
                    + '<h2 style="margin:0 0 4px">RIDD — Commission Run</h2>'
                    + '<div style="color:#666;font-size:13px;margin-bottom:14px">' + esc(_frEmpName(rep)) + ' · sold ' + esc(periodLabel) + '</div>'
                    + '<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="text-align:left;color:#888;font-size:11px;text-transform:uppercase"><th style="padding:6px 10px">Category</th><th style="padding:6px 10px;text-align:right">Revenue</th><th style="padding:6px 10px;text-align:right">Rate</th><th style="padding:6px 10px;text-align:right">Pay</th></tr>'
                    + rowsHtml
                    + '<tr><td colspan="3" style="padding:8px 10px;border-top:2px solid #222"><b>Upfront total</b></td><td style="padding:8px 10px;border-top:2px solid #222;text-align:right"><b>' + money(upTotal) + '</b></td></tr></table>'
                    + '<div style="font-size:13px;color:#444;margin-top:12px">' + Rr.sold + ' accounts sold · MY ' + (Math.round(Rr.myPct * 10) / 10) + '% · open the RIDD Sales app → Sales → Pay for your full published breakdown.</div>'
                    + '</div>',
                });
              }
              if (!recipients.length) { toast('Nothing to send — no reps with sales and an email this period', 'warn'); return; }
              btn.textContent = 'Emailing ' + recipients.length + '…';
              const h = await _apiAuthHeaders({ 'Content-Type': 'application/json' });
              const res = await fetch('/api/commission-email', { method: 'POST', headers: h, body: JSON.stringify({ period: periodLabel, recipients }) });
              const j = await res.json().catch(() => null);
              if (res.ok && j && j.ok) {
                toast('Commissions run — ' + j.sent + ' email' + (j.sent === 1 ? '' : 's') + ' sent' + (j.failed && j.failed.length ? ' · ' + j.failed.length + ' failed (see function logs)' : ''), j.failed && j.failed.length ? 'warn' : 'success');
              } else {
                toast('Emails failed: ' + ((j && j.error) || ('HTTP ' + res.status)) + ' — check RESEND_API_KEY / COMMISSION_FROM_EMAIL in Netlify', 'error');
              }
            } catch (err) {
              toast('Run failed: ' + ((err && err.message) || err), 'error');
            } finally { btn.disabled = false; btn.textContent = orig; }
          },
        }, '▶ Run Commissions'))),
    el('div', { class: 'grid grid-cols-2 lg:grid-cols-4 gap-3' },
      stat('Net Due (period)', money(netDue), 'take-home after deductions', '#DF643A'),
      stat('Weekly Pay', money(weeklyPay), 'across ' + payPeriods + ' weekly periods'),
      stat('Accounts Sold', String(R.sold), money(R.payableRev) + ' payable revenue'),
      stat('Active Accounts', String(activeN), null, '#DF643A'),
      stat('Canceled / Frozen', lostN + ' (' + pctS(R.sold ? lostN / R.sold * 100 : 0) + ')', R.canceled + ' canceled · ' + frozenN + ' frozen', lostN ? '#DC2626' : null),
      stat('With Balance', R.withBalance + ' (' + pctS(R.sold ? R.withBalance / R.sold * 100 : 0) + ')'),
      stat('Multi-Year Rate', pctS(R.myPct)),
      stat('AutoPay %', pctS(R.sold ? (R.apayN || 0) / R.sold * 100 : 0))),
    el('div', { class: 'flex flex-col lg:flex-row gap-5 items-start' },
      el('div', { class: 'flex flex-col gap-4 w-full lg:w-[440px] lg:shrink-0' }, earnings),
      el('div', { class: 'flex flex-col gap-4 flex-1 w-full min-w-0' }, ratesPanel, manualPanel)),
    // ── The accounts behind the numbers — every account sold in the period,
    // matched to its category / rate / pay so the run can be verified row
    // by row before commissions go out.
    (() => {
      const cats = commissionConfig().serviceCategories;
      const catOf = (r) => cats[r.subscription] || 'unclassified';
      const CAT_LBL = { pest: 'Pest', bundle: 'Bundle', ancillary: 'Ancillary', exclude: 'Excluded', unclassified: 'Unmapped' };
      const rateOf = (c) => c === 'pest' ? U.pest : c === 'bundle' ? U.bundle : c === 'ancillary' ? U.anc : 0;
      const rowsSorted = R.rows.slice().sort((x, y) => String(y.sold_date || '').localeCompare(String(x.sold_date || '')));
      const CAP = 250;
      const statusCell = (r) => r.subscription_date_canceled
        ? el('span', { class: 'text-xs font-bold', style: { color: '#DC2626' }, title: String(r.subscription_cancellation_reason || 'Cancelled') + ' · ' + r.subscription_date_canceled }, 'Canceled')
        : /frozen/i.test(String(r.subscription_status || ''))
          ? el('span', { class: 'text-xs font-bold', style: { color: '#A9441F' } }, 'Frozen')
          : el('span', { class: 'text-xs font-bold', style: { color: '#DF643A' } }, 'Active');
      const payTotal = rowsSorted.reduce((a, r) => a + (Number(r.subscription_contract_value) || 0) * rateOf(catOf(r)), 0);
      return el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'px-4 py-3 flex items-center gap-4 flex-wrap gap-2 border-b', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'font-display text-lg' }, 'Accounts in this run · ' + _frEmpName(emp)),
          el('div', { class: 'text-xs text-muted- tabular-nums' }, rowsSorted.length + ' accounts · ' + money(payTotal) + ' upfront pay')),
        rowsSorted.length ? el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-sm' },
          el('thead', {}, el('tr', { class: 'text-left text-[10px] uppercase tracking-widest text-muted-' },
            ...['Sold', 'Customer', 'Service', 'Category', 'Contract Value', 'Rate', 'Pay', 'Status'].map(h => el('th', { class: 'px-4 py-2 whitespace-nowrap' }, h)))),
          el('tbody', {}, ...rowsSorted.slice(0, CAP).map(r => {
            const c = catOf(r);
            const cv2 = Number(r.subscription_contract_value) || 0;
            const rate = rateOf(c);
            return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-4 py-2 tabular-nums text-muted- whitespace-nowrap' }, String(r.sold_date || '').slice(0, 10)),
              el('td', { class: 'px-4 py-2 whitespace-nowrap' },
                el('span', { class: 'font-semibold' }, [r.last_name, r.first_name].filter(Boolean).join(', ') || '—'),
                r.customer_id ? el('span', { class: 'text-muted- text-xs' }, ' #' + r.customer_id) : null),
              el('td', { class: 'px-4 py-2 whitespace-nowrap' }, String(r.subscription || '—')),
              el('td', { class: 'px-4 py-2 whitespace-nowrap' },
                el('span', { class: 'text-xs font-bold px-2 py-0.5 rounded-full', style: c === 'unclassified'
                  ? { background: 'rgba(223,100,58,.14)', color: '#A9441F' }
                  : c === 'exclude' ? { background: 'var(--card-2)', color: 'var(--text-subtle)' }
                  : { background: 'rgba(223,100,58,.12)', color: '#DF643A' } }, CAT_LBL[c] || c)),
              el('td', { class: 'px-4 py-2 tabular-nums' }, money(cv2)),
              el('td', { class: 'px-4 py-2 tabular-nums' }, rate ? Math.round(rate * 100) + '%' : '—'),
              el('td', { class: 'px-4 py-2 tabular-nums font-semibold' }, rate ? money(cv2 * rate) : '—'),
              el('td', { class: 'px-4 py-2' }, statusCell(r)));
          }))))
          : el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'No accounts sold in this period.'),
        rowsSorted.length > CAP ? el('div', { class: 'px-4 py-2 text-xs text-muted- border-t', style: { borderColor: 'var(--border)' } }, 'Showing the latest ' + CAP + ' of ' + rowsSorted.length + '.') : null);
    })());
}

