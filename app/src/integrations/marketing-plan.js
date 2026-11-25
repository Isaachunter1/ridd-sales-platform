// ┌─ integrations/marketing-plan.js ──────────────────────────────────────────
// │ Marketing → Media plan (per Isaac, Nov 24 2026): the "RIDD 2027 Media &
// │ Spend Calendar" spreadsheet, as a model inside the app, so the plan, the
// │ progress against it and what is excelling or lagging sit on one screen.
// │   1. Levers — the sheet's Assumptions: new-revenue target, marketing spend
// │      as a share of it, the agency's flat fee, contract value, close rate.
// │   2. The calendar — the sheet's "2027 Calendar" tab, same arithmetic:
// │        budget         = target × ratio
// │        flexible pool  = budget − agency fee × 12 − the LSA plan
// │        a month's pool = pool × that month's share of the revenue curve
// │        a channel      = the month's pool × the channel's share of the mix
// │      The curve, the LSA plan by month and the mix are typed on the table.
// │   3. Progress — plan against actuals for the year so far, by channel.
// │ Nothing here is estimated by the app: every plan number is the levers ×
// │ the curve × the mix, and every actual is the Marketing tab's own cell
// │ (mklMonth: spend = QuickBooks, leads = Pest AI, sales and revenue =
// │ FieldRoutes, last-touch source). The 2027 defaults are the sheet's values
// │ as built Nov 19 2026.
// │ The plan is also each channel's monthly budget (mkpBudgetFor → mkbBudgetOf),
// │ so the Budget tab and Channel metrics read from it; a budget typed on the
// │ Budget tab for a month still wins for that month.
// │ Saved company-wide in adminRules.mediaPlan = { 'YYYY': plan }.
// └──────────────────────────────────────────────────────────────────────────
const MKP_DEFAULT_2027 = {
  target: 7000000, ratio: 0.39, fee: 28000, lsaExtra: 0, acv: 800, close: 0.15, roas: 2.5,   // roas = the return benchmark (per Isaac, Nov 25)
  // Share of the year's new revenue by month — the sheet's goal row ÷ the target (sums to 100).
  curve: [2.001, 3.002, 5.003, 9.006, 10.006, 12.008, 17.011, 14.009, 10.992, 10.006, 5.003, 1.953],
  // Google Local Services by month — Incline's 2027 forecast, existing markets (the sheet's "LSA 2027 plan" total row).
  lsa: [12708, 12263, 22565, 46428, 52655, 71550, 105217, 91744, 64054, 53375, 31625, 15250],
  // Share of the flexible pool. ch = the app's channel the actuals are read from ('' = everything not named here).
  mix: [
    { n: 'Facebook / Meta', ch: 'Facebook', s: 34 }, { n: 'DoLead (pay per lead)', ch: 'DoLead', s: 18, cpl: 60 },
    { n: 'Google Ads — Search', ch: 'Google Ads', s: 8 }, { n: 'Google Ads — P Max', ch: 'Google Ads', s: 4 },
    { n: 'Service Direct (pay per call)', ch: 'Service Direct', s: 8 }, { n: 'Angi / HomeAdvisor', ch: 'Angi', s: 5 },
    { n: 'Baton (referral network)', ch: 'Baton', s: 5 }, { n: 'ElectGen', ch: 'ElectGen', s: 3, cpl: 250, per: 'job' }],   // $250 a job, not per lead (per Isaac, Nov 25)
  // (No "New channels & tests" line — per Isaac, Nov 25: whatever the channels don't take is shown as Left over.)
};
const MKP_LSA_CH = 'Google Local Services';
function _mkpAgencyCh() { return typeof spqLabel === 'function' && typeof SPQ_TOOLS !== 'undefined' ? spqLabel(SPQ_TOOLS) : 'Agency'; }
// A plan saved before Nov 25 carries a "New channels & tests" line that soaked up the rest of the pool. That line is
// gone: the same plan is read without it (one object per saved plan, so the calendar's memo still holds), and the
// share it held shows as Left over until a channel is added for it.
const _mkpNormMemo = new WeakMap();
function _mkpNorm(P) {
  if (!Array.isArray(P.mix) || !P.mix.some(r => r && !r.ch && /^new channels/i.test(String(r.n || '')))) return P;
  let N = _mkpNormMemo.get(P);
  if (!N) { N = Object.assign({}, P, { mix: P.mix.filter(r => !(r && !r.ch && /^new channels/i.test(String(r.n || '')))) }); _mkpNormMemo.set(P, N); }
  return N;
}
function mkpPlan(year) {
  const R = (typeof _adminRules === 'function' && _adminRules()) || {};
  const P = R.mediaPlan && R.mediaPlan[String(year)];
  if (P && typeof P === 'object') return _mkpNorm(P);
  return Number(year) === 2027 ? MKP_DEFAULT_2027 : null;
}
function mkpSavePlan(year, P) {
  const R = (typeof _adminRules === 'function' && _adminRules()) || {};
  const all = Object.assign({}, R.mediaPlan || {}); all[String(year)] = P;
  _setAdminRule('mediaPlan', all); mkpCalc._m = null;
  try { if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {}); } catch (e) { /* syncs on the next save */ }
}
// The whole calendar from the levers. Every array is Jan–Dec.
function mkpCalc(P) {
  if (!P) return null;
  if (mkpCalc._m && mkpCalc._m.P === P) return mkpCalc._m.v;
  const n = (v) => Number(v) || 0, M = Array.from({ length: 12 }, (_, i) => i);
  const curve = M.map(i => n((P.curve || [])[i]) / 100), curveSum = curve.reduce((a, b) => a + b, 0);
  const lsaBase = M.map(i => n((P.lsa || [])[i])), lsaBaseSum = lsaBase.reduce((a, b) => a + b, 0);
  // New-location LSA dollars follow the LSA plan's own monthly shape (as on the sheet).
  const lsa = M.map(i => lsaBase[i] + (lsaBaseSum > 0 ? n(P.lsaExtra) * lsaBase[i] / lsaBaseSum : n(P.lsaExtra) / 12));
  const lsaYear = lsa.reduce((a, b) => a + b, 0);
  const budget = n(P.target) * n(P.ratio), feeYear = n(P.fee) * 12, pool = budget - feeYear - lsaYear;
  const mixSum = (P.mix || []).reduce((a, r) => a + n(r.s), 0);
  const poolM = M.map(i => pool * curve[i]);
  const rows = (P.mix || []).map(r => ({ n: String(r.n || '').replace(/Performance Max/i, 'P Max'), ch: r.ch || '',   // shown short (per Isaac, Nov 25), whatever the saved plan calls it
    s: n(r.s), m: M.map(i => poolM[i] * n(r.s) / 100) }));
  const goal = M.map(i => n(P.target) * curve[i]);
  const subs = goal.map(g => n(P.acv) > 0 ? g / n(P.acv) : 0), leads = subs.map(s => n(P.close) > 0 ? s / n(P.close) : 0);
  const fee = M.map(() => n(P.fee));
  const total = M.map(i => fee[i] + lsa[i] + rows.reduce((a, r) => a + r.m[i], 0));
  // Left over (per Isaac, Nov 25): the part of the flexible pool no channel has taken. Negative = the channels add
  // up to more than the pool, i.e. over budget. total above is what is actually assigned.
  const left = M.map(i => poolM[i] * (100 - mixSum) / 100), leftYear = pool * (100 - mixSum) / 100;
  // What the spend buys (per Isaac, Nov 25): each channel's dollars ÷ the cost typed for it. Most channels are paid
  // per LEAD, so they buy leads, and leads × the close rate are sales. A channel paid per JOB (ElectGen, $250 a job)
  // buys sales directly and no counted leads. A channel with no cost typed buys nothing here, and is named so the
  // totals are not read as complete.
  (P.mix || []).forEach((r, j) => { rows[j].cpl = n(r.cpl); rows[j].per = r.per === 'job' ? 'job' : 'lead'; });
  const lsaCpl = n(P.lsaCpl);
  const buys = M.map(i => (lsaCpl > 0 ? lsa[i] / lsaCpl : 0) + rows.reduce((a, r) => a + (r.cpl > 0 && r.per === 'lead' ? r.m[i] / r.cpl : 0), 0));
  const jobs = M.map(i => rows.reduce((a, r) => a + (r.cpl > 0 && r.per === 'job' ? r.m[i] / r.cpl : 0), 0));
  const buysSales = M.map(i => buys[i] * n(P.close) + jobs[i]);
  const noCpl = [...(lsaCpl > 0 ? [] : ['Google Local Services']), ...rows.filter(r => !(r.cpl > 0) && r.s > 0).map(r => r.n)];
  const v = { curve, curveSum, lsa, lsaYear, budget, feeYear, pool, poolM, rows, mixSum, left, leftYear, goal, subs, leads, fee, total, buys, jobs, buysSales, noCpl, lsaCpl,
    mediaRatio: n(P.target) > 0 ? (budget - feeYear) / n(P.target) : null };   // media (no agency fee) ÷ new revenue — the bar a channel is read against
  mkpCalc._m = { P, v }; return v;
}
// The plan's dollars for one app channel in one month — what mkbBudgetOf falls back to.
function mkpBudgetFor(ym, k) {
  const P = mkpPlan(String(ym).slice(0, 4)); if (!P) return null;
  const C = mkpCalc(P), i = Number(String(ym).slice(5, 7)) - 1; if (!C || !(i >= 0 && i < 12)) return null;
  let v = 0;
  if (k === MKP_LSA_CH) v = C.lsa[i]; else if (k === _mkpAgencyCh()) v = C.fee[i]; else for (const r of C.rows) if (r.ch && r.ch === k) v += r.m[i];
  return v > 0 ? Math.round(v) : null;
}
function mkpPlanChannels(year) { const P = mkpPlan(year); if (!P) return []; return [...new Set([MKP_LSA_CH, _mkpAgencyCh(), ...(P.mix || []).map(r => r.ch).filter(Boolean)])]; }

// Plan against actuals for the year so far, by channel — shown on the Dashboard as Channel metrics → Year to date
// (per Isaac, Nov 25: plan vs actual in one place). Null when the year has no plan or has not started.
function mkpProgressCard(year) {
  year = Number(year);
  const P = mkpPlan(year); if (!P || typeof mklMonth !== 'function') return null;
  const C = mkpCalc(P), muted = { color: 'var(--text-muted)' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const usd = (v) => v == null || !isFinite(v) ? '\u2014' : fmt.usd0(v), int = (v) => v == null || !isFinite(v) ? '\u2014' : fmt.int(Math.round(v));
  const pct = (v, d) => v == null || !isFinite(v) ? '\u2014' : (v * 100).toFixed(d == null ? 1 : d) + '%';
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const th = (t, right, tip) => el('th', { class: 'px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), title: tip || '', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  // ── 3. Progress: plan against actuals for the year so far ──
  const today = new Date(), openYm = typeof _mklYm === 'function' ? _mklYm(today) : '';
  const yms = MON.map((_, i) => year + '-' + String(i + 1).padStart(2, '0'));
  const upto = yms.filter(ym => ym <= openYm);
  let progress;
  if (!upto.length) {
    progress = null;
  } else {
    // Share of each month that has gone by: closed months count whole, the open month by days.
    const part = yms.map(ym => { if (ym > openYm) return 0; if (ym < openYm) return 1; const dim = new Date(year, Number(ym.slice(5, 7)), 0).getDate(); return today.getDate() / dim; });
    const Ds = yms.map(ym => ym <= openYm ? mklMonth(ym) : null);
    const hasSpend = Ds.some(D => D && D.hasSpend);
    const planTo = (m) => m.reduce((a, v, i) => a + v * part[i], 0);
    const actOf = (keys) => { const t = { spend: 0, leads: 0, s: 0, cv: 0 }; for (const D of Ds) { if (!D || !D.ch) continue; for (const k of keys) { const c = D.ch[k]; if (c) { t.spend += c.spend || 0; t.leads += c.leads || 0; t.s += c.s || 0; t.cv += c.cv || 0; } } } return t; };
    const agencyCh = _mkpAgencyCh();
    // Plan rows that read the same app channel are one line here (Search and Performance Max are both "Google Ads" in QuickBooks).
    const groups = new Map();
    for (const r of C.rows) { const key = r.ch || '\u0001new'; const g = groups.get(key) || groups.set(key, { n: r.n, ch: r.ch, m: Array(12).fill(0), names: [] }).get(key); g.names.push(r.n); r.m.forEach((v, i) => { g.m[i] += v; }); }
    for (const g of groups.values()) if (g.names.length > 1 && g.ch) g.n = g.ch + ' (' + g.names.length + ' plan lines)';
    // Channels with spend that the plan does not name are read against what the plan left over.
    { const k0 = '\u0001new', g0 = groups.get(k0) || groups.set(k0, { n: '', ch: '', m: Array(12).fill(0), names: [] }).get(k0); g0.n = 'Channels not in the plan (against Left over)'; C.left.forEach((v, i) => { g0.m[i] += Math.max(0, v); }); }
    const named = new Set([MKP_LSA_CH, agencyCh, ...C.rows.map(r => r.ch).filter(Boolean)]);
    // "New channels & tests" = every channel with spend this year that the plan does not name.
    const otherKeys = [...new Set(Ds.flatMap(D => D && D.ch ? Object.keys(D.ch).filter(k => (D.ch[k].spend || 0) > 0) : []))].filter(k => !named.has(k) && (typeof _mkxShown !== 'function' || _mkxShown(k)));
    const rowsP = [
      { n: 'Google Local Services', m: C.lsa, keys: [MKP_LSA_CH] },
      ...[...groups.values()].map(g => ({ n: g.n, m: g.m, keys: g.ch ? [g.ch] : otherKeys, tip: g.ch ? '' : (otherKeys.length ? 'Actuals: ' + otherKeys.join(', ') : 'No spend on a channel outside the plan yet') })),
      { n: 'Agency flat fee', m: C.fee, keys: [agencyCh], fee: true }].map(r => { const a = actOf(r.keys), plan = planTo(r.m);
        const ratio = !r.fee && a.spend > 0 && a.cv > 0 ? a.spend / a.cv : null;
        // The read (derived from the levers, not typed): media ÷ new revenue against the plan's own media ratio.
        const read = r.fee ? null : !hasSpend || !a.spend ? ['No spend yet', 'var(--card-2)', 'var(--text-muted)'] : a.s < 5 ? ['Too little to read', 'var(--card-2)', 'var(--text-muted)']
          : ratio <= C.mediaRatio * 0.85 ? ['Excelling', 'rgba(21,128,61,.12)', '#15803D'] : ratio >= C.mediaRatio * 1.15 ? ['Lagging', 'rgba(220,38,38,.12)', '#DC2626'] : ['On plan', 'rgba(47,93,98,.12)', '#2F5D62'];
        return Object.assign({}, r, { a, plan, ratio, read, used: plan > 0 && hasSpend ? a.spend / plan : null }); });
    const T = rowsP.reduce((t, r) => { t.plan += r.plan; t.spend += r.a.spend; return t; }, { plan: 0, spend: 0 });
    const all = Ds.reduce((t, D) => { if (D) { t.cv += D.cv || 0; t.s += D.s || 0; t.leads += D.leads || 0; } return t; }, { cv: 0, s: 0, leads: 0 });
    const goalTo = planTo(C.goal), subsTo = planTo(C.subs), leadsTo = planTo(C.leads);
    const tile = (label, big, sub2, good) => el('div', { class: 'card p-3 flex flex-col gap-0.5', style: { minWidth: '170px', flex: '1 1 170px' } },
      el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: muted }, label), el('div', { class: 'text-xl font-black tabular-nums' }, big),
      el('div', { class: 'text-[11px] tabular-nums', style: { color: good == null ? 'var(--text-muted)' : good ? '#15803D' : '#B91C1C', fontWeight: good == null ? '400' : '700' } }, sub2));
    const vsP = (act, plan) => plan > 0 ? Math.round(act / plan * 100) + '% of plan to date (' : '(';
    const through = MON[upto.length - 1] + ' ' + today.getDate();
    const tiles = el('div', { class: 'flex gap-3 flex-wrap' },
      tile('New revenue', usd(all.cv), vsP(all.cv, goalTo) + usd(goalTo) + ')', goalTo > 0 ? all.cv >= goalTo * 0.95 : null),
      tile('Marketing spend', hasSpend ? usd(T.spend) : '—', hasSpend ? vsP(T.spend, T.plan) + usd(T.plan) + ')' : 'QuickBooks has not loaded', null),
      tile('Spend ÷ new revenue', hasSpend && all.cv > 0 ? pct(T.spend / all.cv, 1) : '—', 'plan ' + pct(P.ratio, 1), hasSpend && all.cv > 0 ? T.spend / all.cv <= P.ratio * 1.05 : null),
      tile('New subscriptions', int(all.s), vsP(all.s, subsTo) + int(subsTo) + ' needed)', subsTo > 0 ? all.s >= subsTo * 0.95 : null),
      tile('Leads', int(all.leads), vsP(all.leads, leadsTo) + int(leadsTo) + ' needed)', leadsTo > 0 ? all.leads >= leadsTo * 0.95 : null));
    const tdp = (...kids) => el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap align-top' }, ...kids);
    const small = (t, color) => t ? el('div', { class: 'text-[10px]', style: { color: color || 'var(--text-subtle)' } }, t) : null;
    const bar = (used) => used == null ? null : el('div', { style: { width: '110px', height: '6px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden', margin: '3px 0' } }, el('div', { style: { width: Math.min(100, used * 100) + '%', height: '100%', borderRadius: '999px', background: used > 1.1 ? '#DC2626' : used < 0.7 ? '#D97706' : '#2F5D62' } }));
    const table = el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-provpulse' },
      el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Channel metrics \u00b7 ' + year + ' through ' + through + ' \u00b7 plan vs actual')),
      el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse', minWidth: '900px' } },
        el('thead', {}, el('tr', {}, th('Channel'), th('Plan to date', false, 'The calendar’s dollars for the months gone by; the open month counts by days'), th('Spent', false, 'QuickBooks spend booked, and the share of the plan to date used'),
          th('Leads', false, 'Pest AI leads'), th('New sales', false, 'FieldRoutes new sales by source (last touch)'), th('New revenue', false, 'Contract value of those sales'), th('Spend ÷ revenue', false, 'Against the plan’s media ratio of ' + pct(C.mediaRatio, 1) + ' (budget less the agency fee, ÷ the target)'), th('Cost per sale'),
          th('Read', false, 'Spend ÷ new revenue against the plan’s media ratio (' + pct(C.mediaRatio, 1) + '): Excelling = 15% or more under it, Lagging = 15% or more over it. Needs 5 sales.'))),
        el('tbody', {}, ...rowsP.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap align-top', title: r.tip || '' }, r.n),
          tdp(usd(r.plan), small('year ' + usd(sum(r.m)))),
          tdp(el('div', { class: 'font-semibold' }, hasSpend ? usd(r.a.spend) : '—'), bar(r.used), r.used != null ? small(Math.round(r.used * 100) + '% of plan to date', r.used > 1.1 ? '#DC2626' : r.used < 0.7 ? '#B45309' : undefined) : null),
          tdp(r.fee ? '—' : int(r.a.leads)), tdp(r.fee ? '—' : int(r.a.s)), tdp(r.fee ? '—' : usd(r.a.cv || null)),
          tdp(r.ratio != null ? el('span', { style: { fontWeight: 700, color: r.ratio <= C.mediaRatio ? '#15803D' : '#B91C1C' } }, pct(r.ratio, 1)) : '—'),
          tdp(!r.fee && hasSpend && r.a.s > 0 && r.a.spend > 0 ? usd(r.a.spend / r.a.s) : '—'),
          el('td', { class: 'px-3 py-2 align-top' }, r.read ? el('span', { class: 'rounded-full px-2 py-0.5 text-[11px] font-black whitespace-nowrap', style: { background: r.read[1], color: r.read[2] } }, r.read[0]) : null))),
          el('tr', { class: 'border-t-2', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
            el('td', { class: 'px-3 py-2 font-black', title: 'Plan and spend are the lines above. Leads, new sales and new revenue are every channel, Organic and unsourced included \u2014 the same basis as the target.' }, 'Total'), tdp(el('b', {}, usd(T.plan))), tdp(el('b', {}, hasSpend ? usd(T.spend) : '—'), T.plan > 0 && hasSpend ? small(Math.round(T.spend / T.plan * 100) + '% of plan to date') : null),
            tdp(el('b', {}, int(all.leads))), tdp(el('b', {}, int(all.s))), tdp(el('b', {}, usd(all.cv))), tdp(el('b', {}, hasSpend && all.cv > 0 ? pct(T.spend / all.cv, 1) : '—'), small('plan ' + pct(P.ratio, 1))), tdp(el('b', {}, hasSpend && all.s > 0 ? usd(T.spend / all.s) : '—')), tdp())))));
    void tiles; progress = { _mkpTable: table };
  }
  return progress && progress._mkpTable ? progress._mkpTable : null;
}

function mktgPlanView() {
  if (typeof mklMonth !== 'function') return el('div', { class: 'card p-6 text-sm' }, 'The media plan needs the Marketing metrics.');
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function' && state._ghl === undefined) ghlLoadLeads();
  const year = Number(typeof _mktgYearSel === 'function' ? _mktgYearSel() : new Date().getFullYear());
  const canEdit = typeof isAdminRole === 'function' && isAdminRole(state.profile && state.profile.role);
  const muted = { color: 'var(--text-muted)' }, subtle = { color: 'var(--text-subtle)' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const P0 = mkpPlan(year);
  // While the goal slider is being dragged the page shows the plan at that goal without saving it (state._mkpPreview);
  // letting go saves.
  const _pv = state._mkpPreview && state._mkpPreview.year === year ? Number(state._mkpPreview.target) : null;
  const P = P0 && _pv ? Object.assign({}, P0, { target: _pv }) : P0;
  if (!P) return el('div', { class: 'card p-6 flex items-center gap-3 flex-wrap' },
    el('div', { class: 'text-sm flex-1' }, el('b', {}, 'No media plan for ' + year + ' yet. '), 'The 2027 plan is built in; use the year arrows above to open it' + (canEdit ? ', or start ' + year + ' from the same levers.' : '.')),
    canEdit ? el('button', { class: 'rounded-lg px-3 py-1.5 text-[12px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => { mkpSavePlan(year, JSON.parse(JSON.stringify(MKP_DEFAULT_2027))); mountApp(); } }, 'Start ' + year + ' from the 2027 levers') : null);
  const C = mkpCalc(P);
  const usd = (v) => v == null || !isFinite(v) ? '—' : fmt.usd0(v), int = (v) => v == null || !isFinite(v) ? '—' : fmt.int(Math.round(v));
  const pct = (v, d) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d == null ? 1 : d) + '%';
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  // A change saves the whole plan and redraws; focus goes back to wherever Tab or the click landed.
  const edit = (fn) => { const next = JSON.parse(JSON.stringify(P0)); fn(next); mkpSavePlan(year, next);
    setTimeout(() => { const a = document.activeElement, id = a && a.dataset ? a.dataset.mp : ''; mountApp(); if (id) { const t = document.querySelector('[data-mp="' + id + '"]'); if (t) { t.focus(); try { t.select(); } catch (e) { /* not a text field */ } } } }, 0); };
  const num = (s) => Number(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')) || 0;
  const inp = (id, val, onSet, w, tip) => canEdit
    ? el('input', { type: 'text', inputmode: 'decimal', value: val, 'data-mp': id, title: tip || '', class: 'rounded-md border px-1.5 py-1 text-[11px] tabular-nums text-right', style: { width: (w || 70) + 'px', borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => onSet(num(e.target.value)), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } })
    : el('span', { class: 'text-[11px] tabular-nums font-semibold' }, val);

  // Return benchmark (per Isaac, Nov 25): new revenue expected per dollar of planned spend; 2.5x unless the plan says otherwise.
  const roas = Number(P.roas) > 0 ? Number(P.roas) : 2.5;
  // ── 1. Levers ──
  const lever = (label, node, note) => el('div', { class: 'flex flex-col gap-1', style: { minWidth: '150px' } },
    el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: muted }, label), node, note ? el('div', { class: 'text-[10px]', style: subtle }, note) : null);
  const isDefault = !(((typeof _adminRules === 'function' && _adminRules()) || {}).mediaPlan || {})[String(year)];
  const levers = el('div', { class: 'card p-4 flex flex-col gap-3', 'data-arrange-id': 'mkp-levers' },
    el('div', { class: 'flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Media plan · ' + year),
      el('span', { class: 'text-[11px] flex-1', style: muted }, canEdit ? 'Change a lever and the tables below all follow.' : ''),
      canEdit && !isDefault && year === 2027 ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, title: 'Puts every lever, the curve, the LSA plan and the mix back to the spreadsheet’s values', onclick: () => { mkpSavePlan(year, JSON.parse(JSON.stringify(MKP_DEFAULT_2027))); mountApp(); } }, 'Reset to the spreadsheet') : null),
    el('div', { class: 'flex gap-x-6 gap-y-3 flex-wrap' },
      lever('New-revenue target', inp('target', fmt.usd0(P.target), (v) => edit(n => { n.target = v; }), 110), 'Office Staff new sales, contract value'),
      lever('Marketing spend ÷ new revenue', inp('ratio', (P.ratio * 100).toFixed(1) + '%', (v) => edit(n => { n.ratio = v / 100; }), 70), 'Media + agency. Budget ' + usd(C.budget)),
      lever('Agency fee / month', inp('fee', fmt.usd0(P.fee), (v) => edit(n => { n.fee = v; }), 90), usd(C.feeYear) + ' a year, flat'),
      lever('LSA for new locations / year', inp('lsaExtra', fmt.usd0(P.lsaExtra || 0), (v) => edit(n => { n.lsaExtra = v; }), 90), 'On top of the LSA row; follows its shape'),
      lever('ROAS benchmark', inp('roas', roas.toFixed(2).replace(/0$/, '') + 'x', (v) => edit(n => { n.roas = v > 0 ? v : 2.5; }), 60, 'New revenue expected for each dollar of planned spend'), 'Expected revenue ' + usd(sum(C.total) * roas)),
      lever('Average contract value', inp('acv', fmt.usd0(P.acv), (v) => edit(n => { n.acv = v; }), 80), int(sum(C.subs)) + ' new subscriptions needed'),
      lever('Lead → sale close rate', inp('close', (P.close * 100).toFixed(1) + '%', (v) => edit(n => { n.close = v / 100; }), 70), int(sum(C.leads)) + ' leads needed'),
      lever('Flexible media pool', el('div', { class: 'text-sm font-black tabular-nums', style: { color: C.pool < 0 ? '#DC2626' : undefined } }, usd(C.pool)), C.pool < 0 ? 'Negative: the target is too small for LSA + the fee at this ratio' : 'Budget − agency fee − LSA ' + usd(C.lsaYear))));

  // ── 2. The calendar ──
  const th = (t, right, tip) => el('th', { class: 'px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), title: tip || '', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const first = (kids, st) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap', style: Object.assign({ position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }, st || {}) }, ...[].concat(kids));
  const cell = (t, st) => el('td', { class: 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap', style: st || {} }, t);
  const line = (label, vals, f, o) => { o = o || {}; const st = o.strong ? { fontWeight: '800' } : o.soft ? muted : {};
    return el('tr', { class: 'border-t', style: Object.assign({ borderColor: 'var(--border)' }, o.band ? { background: 'var(--card-2)', borderTop: '2px solid var(--border-2)' } : {}) },
      first(label, Object.assign({ fontWeight: o.strong ? '800' : '600' }, o.band ? { background: 'var(--card-2)' } : {}, o.soft ? muted : {})), ...vals.map(v => cell(f(v), st)), cell(o.noTotal ? '' : f(o.total != null ? o.total : sum(vals)), Object.assign({ fontWeight: '800' }, o.soft ? muted : {}))); };
  const head = (t) => el('tr', {}, el('td', { colspan: 14, class: 'px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest font-bold', style: subtle }, t));
  const curveBad = Math.abs(C.curveSum - 1) > 0.002, over = C.mixSum > 100.05, leftShare = 100 - C.mixSum;
  // (The last-year cost-per-lead hint in the empty box and its hover text were removed per Isaac, Nov 25.)
  const cplBox = (id, val, hintCh, onSet, per, onPer) => { const job = per === 'job';
    const tip = (job ? 'Cost per job \u2014 this channel is paid per sale, not per lead' : 'Average cost per lead') ;
    const unit = onPer && canEdit
      ? el('button', { class: 'text-[10px] underline', style: muted, title: 'Paid per ' + (job ? 'job' : 'lead') + ' \u2014 click to switch to per ' + (job ? 'lead' : 'job'), onclick: () => onPer(job ? 'lead' : 'job') }, job ? '/ job' : '/ lead')
      : el('span', { class: 'text-[10px]', style: muted }, job ? '/ job' : '/ lead');
    if (!canEdit) return el('span', { class: 'inline-flex items-center gap-1 text-[10px] tabular-nums', style: muted, title: tip }, val > 0 ? fmt.usd0(val) : 'no cost', unit);
    const box = inp(id, val > 0 ? fmt.usd0(val) : '', onSet, 58, tip); box.placeholder = job ? 'cost' : 'CPL';
    return el('span', { class: 'inline-flex items-center gap-1' }, box, unit); };
  // Three tables instead of one (per Isaac, Nov 25 — "split out the spend calendar a bit more, it's a little messy…
  // the most important table for 2027"): the revenue plan, the spend plan by channel, and what the spend buys. The
  // month columns line up down the page (same fixed widths in all three). In the spend plan the two things typed per
  // channel — its share of the flexible pool and its cost per lead — have columns of their own instead of sitting
  // inside the channel's name.
  const W_FIRST = 380, W_NAME = 190, W_SHARE = 66, W_COST = 124, W_MON = 78, W_YEAR = 104;
  const cols = (split) => el('colgroup', {}, ...(split ? [W_NAME, W_SHARE, W_COST] : [W_FIRST]).map(w => el('col', { style: { width: w + 'px' } })), ...MON.map(() => el('col', { style: { width: W_MON + 'px' } })), el('col', { style: { width: W_YEAR + 'px' } }));
  const tableOf = (split, headCells, rows) => el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } },
    el('table', { class: 'text-xs', style: { borderCollapse: 'collapse', tableLayout: 'fixed', width: (W_FIRST + 12 * W_MON + W_YEAR) + 'px', minWidth: '100%' } }, cols(split),
      el('thead', {}, el('tr', {}, ...headCells, ...MON.map(m => th(m, true)), th(String(year), true))), el('tbody', {}, ...rows.filter(Boolean))));
  const block = (title, sub, right, table) => el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, title), sub ? el('span', { class: 'text-[11px]', style: muted }, sub) : null, right ? el('span', { class: 'ml-auto text-sm font-black tabular-nums' }, right) : null), table);
  const dash = () => cell('—', subtle);
  // A spend-plan row: name · share of the pool · cost · 12 months · year.
  // ── Media calendar (per Isaac, Nov 25): the plan by channel and month, as Spend or as Revenue, with what actually
  // happened under each planned number and the pace for the year so far.
  //   Spend   — plan = the plan's dollars; actual = QuickBooks spend for that channel.
  //   Revenue — plan = expected revenue: the line's planned spend × the ROAS benchmark, every line the same multiple.
  //             The agency fee is a line too (it is in planned spend, so the benchmark expects a return on it) with no
  //             actual of its own — the channels have to cover it. Actual = FieldRoutes new revenue, last-touch.
  // Pace = actual so far ÷ the plan for the same stretch (closed months whole, the open month by days gone).
  // Two plan lines that read one app channel (Google Ads Search and P Max) share one set of actuals: shown on the
  // first, measured against both lines together. Nothing is shown for months that have not started.
  const calView = state._mkpCalView === 'rev' ? 'rev' : 'spend';
  const today = new Date(), pad2 = (n) => String(n).padStart(2, '0');
  const openYm = typeof _mklYm === 'function' ? _mklYm(today) : today.getFullYear() + '-' + pad2(today.getMonth() + 1);
  const yms = MON.map((_, i) => year + '-' + pad2(i + 1));
  const part = yms.map(ym => { if (ym > openYm) return 0; if (ym < openYm) return 1; const dim = new Date(year, Number(ym.slice(5, 7)), 0).getDate(); return today.getDate() / dim; });
  const started = part.some(v => v > 0);
  const Ds = started && typeof mklMonth === 'function' ? yms.map(ym => { if (ym > openYm) return null; try { return mklMonth(ym); } catch (e) { return null; } }) : yms.map(() => null);
  const showAct = started && state._mkpCalAct !== false;
  const isRev = calView === 'rev';
  // Actuals for a set of app channels, Jan–Dec (null = month not started, or — for spend — QuickBooks not in yet).
  const actOf = (keys) => Ds.map(D => { if (!D || !D.ch) return null; if (!isRev && !D.hasSpend) return null; let t = 0; for (const k of keys) { const c = D.ch[k]; if (c) t += (isRev ? c.cv : c.spend) || 0; } return t; });
  const planOf = (m) => isRev ? m.map(v => v * roas) : m;
  const toneOf = (ratio) => ratio == null || !isFinite(ratio) ? 'var(--text-muted)' : isRev ? (ratio >= 1 ? '#15803D' : ratio >= 0.9 ? '#B45309' : '#DC2626') : (ratio > 1.1 ? '#DC2626' : ratio < 0.9 ? '#B45309' : 'var(--text-muted)');
  const stack = (top, bottom, color, tip) => el('div', { title: tip || '' }, el('div', {}, top), el('div', { class: 'text-[10px] tabular-nums', style: { color: color || 'var(--text-muted)', fontWeight: '700', lineHeight: '1.2' } }, bottom));
  // A calendar row: name · share of the pool · cost · 12 months · year. o.act = the actuals (12), o.cmp = the plan the
  // actuals are measured against when it is not this row's own (shared channels).
  const spendRow = (name, share, cost, vals, o) => { o = o || {}; const st = o.strong ? { fontWeight: '800' } : o.soft ? muted : {}; const bg = o.band ? { background: 'var(--card-2)' } : {};
    const f = o.f || usd, act = showAct ? o.act : null, cmp = o.cmp || vals;
    const mcell = (v, i) => { if (!act || act[i] == null) return cell(f(v), st);
      const planTo = (cmp[i] || 0) * part[i], r = planTo > 0 ? act[i] / planTo : null;
      return cell(stack(f(v), usd(act[i]), toneOf(r), MON[i] + ': ' + usd(act[i]) + ' actual' + (planTo > 0 ? ' · ' + pct(r, 0) + ' of ' + usd(planTo) + (part[i] < 1 ? ' planned to date' : ' planned') : '')), st); };
    const tot = o.total != null ? o.total : sum(vals);
    const ycell = () => { if (!act || !act.some(v => v != null)) return cell(f(tot), Object.assign({ fontWeight: '800' }, o.soft ? muted : {}));
      const a = act.reduce((t, v) => t + (v || 0), 0), pt = cmp.reduce((t, v, i) => t + (v || 0) * part[i], 0), r = pt > 0 ? a / pt : null;
      return cell(stack(f(tot), usd(a) + (r != null ? ' · ' + pct(r, 0) : ''), toneOf(r), 'Year to date: ' + usd(a) + ' actual against ' + usd(pt) + ' planned to date' + (r != null ? ' — ' + pct(r, 0) + ' of pace' : '')), { fontWeight: '800' }); };
    return el('tr', { class: 'border-t', style: Object.assign({ borderColor: 'var(--border)' }, o.band ? { background: 'var(--card-2)', borderTop: '2px solid var(--border-2)' } : {}) },
      first(el('span', { title: o.tip || (typeof name === 'string' ? name : ''), style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: o.indent ? '14px' : undefined } }, name), Object.assign({ fontWeight: o.strong ? '800' : o.indent ? '500' : '600' }, bg, o.soft ? muted : {})),
      share || dash(), cost || dash(),
      ...vals.map(mcell), ycell()); };
  const inCell = (node) => el('td', { class: 'px-2 py-1 text-right whitespace-nowrap' }, node);
  // Actuals per plan row: the first row of an app channel carries that channel's actuals, measured against every plan
  // line that reads the same channel.
  const agencyCh = _mkpAgencyCh();
  const firstOf = new Map(); C.rows.forEach((r, j) => { if (r.ch && !firstOf.has(r.ch)) firstOf.set(r.ch, j); });
  const groupPlan = (ch) => MON.map((_, i) => C.rows.reduce((t, r) => t + (r.ch === ch ? planOf(r.m)[i] : 0), 0));
  const named = new Set([MKP_LSA_CH, agencyCh, ...C.rows.map(r => r.ch).filter(Boolean)]);
  const otherKeys = [...new Set(Ds.flatMap(D => D && D.ch ? Object.keys(D.ch).filter(k => (D.ch[k].spend || 0) > 0) : []))].filter(k => !named.has(k) && (typeof _mkxShown !== 'function' || _mkxShown(k)));
  const allKeys = [...new Set(Ds.flatMap(D => D && D.ch ? Object.keys(D.ch) : []))];
  const paidKeys = [MKP_LSA_CH, ...firstOf.keys(), ...otherKeys];
  const chanRows = C.rows.map((r, j) => { const lead = r.ch && firstOf.get(r.ch) === j, shared = r.ch && C.rows.filter(x => x.ch === r.ch).length > 1;
    return spendRow(canEdit ? el('span', { class: 'inline-flex items-center gap-1.5' },
        el('button', { class: 'text-[13px] leading-none', style: subtle, title: 'Remove ' + r.n + ' from the plan', 'aria-label': 'Remove ' + r.n, onclick: () => edit(n => { n.mix.splice(j, 1); }) }, '×'), el('span', {}, r.n)) : r.n,
      inCell(inp('mix' + j, r.s + '%', (x) => edit(n => { n.mix[j].s = x; }), 48, 'Share of the flexible pool')),
      inCell(cplBox('cpl' + j, r.cpl, r.ch, (x) => edit(n => { n.mix[j].cpl = x; }), r.per, (v) => edit(n => { n.mix[j].per = v; }))), planOf(r.m),
      { indent: true, act: lead ? actOf([r.ch]) : null, cmp: lead && shared ? groupPlan(r.ch) : null,
        tip: !r.ch ? r.n + ' — not one of the app’s channels, so it has no actuals' : shared ? (lead ? 'Actuals are all of ' + r.ch + ', measured against every ' + r.ch + ' line in the plan' : 'Actuals for ' + r.ch + ' are on its first line') : '' }); });
  const seg2 = (opts, cur, set) => el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, ...opts.map(([k, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-bold whitespace-nowrap', style: cur === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { set(k); mountApp(); } }, l)));
  const spendOff = started && !isRev && !Ds.some(D => D && D.hasSpend);
  const calHead = el('span', { class: 'inline-flex items-center gap-3 flex-wrap justify-end' },
    showAct ? el('span', { class: 'text-[10px] font-normal', style: muted }, spendOff ? 'QuickBooks spend isn’t loaded, so no actuals show' : 'Small number = actual · colour = pace against the plan') : null,
    started ? seg2([['on', 'Plan + actual'], ['off', 'Plan only']], showAct ? 'on' : 'off', (k) => { state._mkpCalAct = k === 'on'; }) : null,
    seg2([['spend', 'Spend'], ['rev', 'Revenue']], calView, (k) => { state._mkpCalView = k; }),
    isRev ? el('span', {}, usd(sum(C.total) * roas) + ' expected')
      : el('span', {}, usd(sum(C.total)) + ' planned of ' + usd(C.budget) + ' · ', el('span', { style: { color: over ? '#DC2626' : '#15803D' } }, over ? usd(-C.leftYear) + ' over budget' : usd(C.leftYear) + ' left over')));
  const heads = [th('Channel'), th('Share of pool', true, 'Each channel’s share of the flexible media pool'), th('Cost per lead', true, 'Average cost per lead (or per job for channels paid per sale). Empty = not counted in what the spend buys')];
  const lsaName = 'Google Local Services' + (P.lsaExtra ? ' + new locations' : ''), lsaCost = () => inCell(cplBox('lsaCpl', C.lsaCpl, MKP_LSA_CH, (x) => edit(n => { n.lsaCpl = x; })));
  const poolShare = () => cell(C.mixSum.toFixed(0) + '% used', { fontWeight: '800', color: over ? '#DC2626' : undefined });
  const otherTip = otherKeys.length ? 'Channels with spend that the plan does not name: ' + otherKeys.join(', ') : 'No spend on a channel outside the plan yet';
  const spendBody = () => [
      spendRow('Agency flat fee', null, null, C.fee, { act: actOf([agencyCh]) }),
      spendRow(lsaName, null, lsaCost(), C.lsa, { total: C.lsaYear, act: actOf([MKP_LSA_CH]) }),
      spendRow('Flexible media pool', poolShare(), null, C.poolM, { strong: true, band: true, act: actOf([...firstOf.keys(), ...otherKeys]), tip: 'Actual = every channel below, plus channels not in the plan' }),
      ...chanRows,
      // Add a channel (per Isaac, Nov 25): pick one of the app's channels or type a new name; it joins at 0% and takes
      // its share out of Left over.
      canEdit ? (() => { const have = new Set(C.rows.map(r => r.ch).filter(Boolean)); const opts = (typeof spqChannelOptions === 'function' ? spqChannelOptions() : []).filter(c => c !== MKP_LSA_CH && !have.has(c));
        const add = (name) => { const v = String(name || '').trim(); if (!v) return; const ch = opts.find(c => c.toLowerCase() === v.toLowerCase()) || ''; edit(n => { n.mix = (n.mix || []).concat([{ n: ch || v, ch, s: 0 }]); }); };
        const box = el('input', { type: 'text', list: 'mkpAddCh', placeholder: 'Channel name…', 'data-mp': 'addCh', class: 'rounded-md border px-2 py-1 text-[11px]', style: { width: '150px', borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--text)' }, onkeydown: (e) => { if (e.key === 'Enter') add(e.target.value); } });
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, el('td', { colspan: 16, class: 'px-3 py-1.5' }, el('span', { class: 'inline-flex items-center gap-2', style: { paddingLeft: '14px' } },
          box, el('datalist', { id: 'mkpAddCh' }, ...opts.map(c => el('option', { value: c }))),
          el('button', { class: 'rounded-md border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)', color: 'var(--accent)' }, onclick: () => add(box.value) }, '+ Add channel'),
          el('span', { class: 'text-[10px]', style: subtle }, 'Joins at 0% — give it a share and it comes out of Left over')))); })() : null,
      spendRow(over ? 'Over budget' : 'Left over', cell(leftShare.toFixed(0) + '%', { fontWeight: '800', color: over ? '#DC2626' : '#15803D' }), null, C.left,
        { indent: true, total: C.leftYear, act: otherKeys.length ? actOf(otherKeys) : null, cmp: C.left.map(v => Math.max(0, v)), tip: otherTip, f: (v) => el('span', { style: { color: v < -0.5 ? '#DC2626' : v > 0.5 ? '#15803D' : 'var(--text-muted)', fontWeight: '700' } }, usd(v)) }),
      spendRow('Total planned spend', null, null, C.total, { strong: true, band: true, act: actOf([agencyCh, ...paidKeys]) }),
      spendRow('Spend ÷ revenue goal', null, null, C.total.map((t, i) => C.goal[i] > 0 ? t / C.goal[i] : null), { soft: true, f: (v) => pct(v, 1), total: sum(C.goal) > 0 ? sum(C.total) / sum(C.goal) : null }),
      // Expected revenue (per Isaac, Nov 25): planned spend × the ROAS benchmark, and how much of the goal that is.
      spendRow('Expected revenue at ' + roas.toFixed(2).replace(/0$/, '') + 'x ROAS', null, null, C.total.map(t => t * roas), { strong: true, band: true }),
      spendRow('Of the revenue goal', null, null, C.total.map((t, i) => C.goal[i] > 0 ? t * roas / C.goal[i] : null), { soft: true, total: sum(C.goal) > 0 ? sum(C.total) * roas / sum(C.goal) : null,
        f: (v) => v == null || !isFinite(v) ? '—' : el('span', { style: { color: v >= 1 ? '#15803D' : '#B45309', fontWeight: '700' } }, pct(v, 0)) })];
  const revBody = () => [
      spendRow('Agency flat fee', null, null, planOf(C.fee), { tip: 'The fee is part of planned spend, so the benchmark expects a return on it too. It has no channel of its own, so there is no actual: the channels cover it.' }),
      spendRow(lsaName, null, lsaCost(), planOf(C.lsa), { act: actOf([MKP_LSA_CH]) }),
      spendRow('Flexible media pool', poolShare(), null, planOf(C.poolM.map((v, i) => v - C.left[i])), { strong: true, band: true, act: actOf([...firstOf.keys()]), tip: 'Expected and actual revenue of the channels below' }),
      ...chanRows,
      otherKeys.length ? spendRow('Channels not in the plan', null, null, MON.map(() => 0), { indent: true, act: actOf(otherKeys), tip: otherTip, f: () => '—' }) : null,
      spendRow('Expected revenue at ' + roas.toFixed(2).replace(/0$/, '') + 'x ROAS', null, null, C.total.map(t => t * roas), { strong: true, band: true, act: actOf(paidKeys), tip: 'Actual = new revenue from the channels above' }),
      // The whole goal, paid or not: every Office Staff new sale, including channels with no spend (Organic, referrals).
      spendRow('All new revenue vs the goal', null, null, C.goal, { strong: true, band: true, act: actOf(allKeys), tip: 'Plan = the new-revenue goal · actual = every Office Staff new sale, including channels with no spend' })];
  const spendCard = block('Media calendar · ' + year, isRev ? 'Expected revenue by channel: planned spend × the ROAS benchmark' : 'Agency fee and Local Services are fixed; each channel takes a share of the flexible pool',
    calHead, tableOf(true, heads, isRev ? revBody() : spendBody()));

  // 1 · Revenue plan
  const curveRow = el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, first(['Seasonal curve']),
    ...C.curve.map((v, i) => el('td', { class: 'px-1.5 py-1.5 text-right' }, inp('curve' + i, (v * 100).toFixed(1) + '%', (x) => edit(n => { n.curve[i] = x; }), 62, MON[i] + ' share of the year’s new revenue'))),
    cell(pct(C.curveSum, 1), { fontWeight: '800', color: curveBad ? '#DC2626' : undefined }));
  const revenueCard = block('Revenue plan · ' + year, curveBad ? null : 'The goal, spread by the seasonal curve',
    fmt.usd0(sum(C.goal)),
    tableOf(false, [th('Line')], [curveRow,
      curveBad ? el('tr', {}, el('td', { colspan: 14, class: 'px-3 pb-2 text-[11px] font-bold', style: { color: '#DC2626' } }, 'The seasonal curve adds up to ' + pct(C.curveSum, 1) + ' — it should be 100%.')) : null,
      line('New-revenue goal', C.goal, usd, { strong: true }),
      line('New subscriptions needed', C.subs, int), line('Leads needed', C.leads, int)]));


  // 3 · What the spend buys
  const buysCard = block('What the spend buys · ' + year, 'From the cost per lead typed above and the close rate',
    int(sum(C.buysSales)) + ' new sales',
    tableOf(false, [th('Line')], [
      line('Leads (spend ÷ cost per lead)', C.buys, int),
      line('New sales (leads × close rate' + (sum(C.jobs) > 0 ? ' + per-job channels' : '') + ')', C.buysSales, int, { strong: true }),
      line('Of the subscriptions needed', C.buysSales.map((b, i) => C.subs[i] > 0 ? b / C.subs[i] : null), (v) => pct(v, 0), { soft: true, total: sum(C.subs) > 0 ? sum(C.buysSales) / sum(C.subs) : null }),
      line('Media cost per new subscription', C.total.map((t, i) => C.subs[i] > 0 ? (t - C.fee[i]) / C.subs[i] : null), usd, { soft: true, total: sum(C.subs) > 0 ? (sum(C.total) - C.feeYear) / sum(C.subs) : null }),
      C.noCpl.length ? el('tr', {}, el('td', { colspan: 14, class: 'px-3 py-2 text-[10px]', style: { color: '#B45309' } }, 'Not counted yet, no cost typed: ' + C.noCpl.join(', ') + '. Organic and unpaid leads are not in these numbers either.')) : null]));
  const calendar = el('div', { class: 'flex flex-col gap-4', 'data-arrange-id': 'mkp-cal' }, spendCard, revenueCard, buysCard);

  // Plan against actuals lives on the Dashboard now (Channel metrics → Year to date); see mkpProgressCard.
  // Budgets by month (the old Budget tab, per Isaac, Nov 25): the plan's dollars per channel per month, with anything
  // typed over them. Folded here so there is one place to plan.
  // "Budgets by month" removed (per Isaac, Nov 25): the spend plan shows every channel by month, and the plan is the
  // budget — see mkbBudgetOf. mktgBudgetView stays in the code.
  const budgets = null;
  // ── The goal slider (per Isaac, Nov 25): slide the new-revenue goal and every line follows — the budget, the pool,
  // each channel's months, the leads and sales needed. Dragging redraws the levers and the calendar in place without
  // saving; letting go saves the goal. The fee and the LSA plan do not move with it, so the pool takes up the change.
  const slider = (() => {
    if (!canEdit) return null;
    const min = 1000000, max = Math.max(15000000, Math.ceil(P0.target * 2 / 1e6) * 1e6), step = 50000;
    const num = (t) => el('b', { class: 'tabular-nums', style: { color: 'var(--text)' } }, t);
    const bGoal = num(fmt.usd0(P.target)), bSpend = num(usd(C.budget)), bPool = num(usd(C.pool)), bSubs = num(int(sum(C.subs)));
    const swap = (fresh, id) => { try { const old = document.querySelector('#app [data-arrange-id="' + id + '"]'), nw = fresh.querySelector('[data-arrange-id="' + id + '"]'); if (old && nw) old.replaceWith(nw); } catch (e) { /* the release redraws everything */ } };
    const rng = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(P.target), 'data-mp': 'goalSlider', 'aria-label': 'New-revenue goal',
      style: { flex: '1 1 320px', minWidth: '220px', accentColor: 'var(--accent)', cursor: 'pointer' },
      oninput: (e) => { const v = Number(e.target.value); state._mkpPreview = { year, target: v };
        const CC = mkpCalc(Object.assign({}, P0, { target: v }));
        bGoal.textContent = fmt.usd0(v); bSpend.textContent = usd(CC.budget); bPool.textContent = usd(CC.pool); bPool.style.color = CC.pool < 0 ? '#DC2626' : 'var(--text)'; bSubs.textContent = int(sum(CC.subs));
        let fresh = null; try { fresh = mktgPlanView(); } catch (err) { fresh = null; }
        if (fresh) { swap(fresh, 'mkp-levers'); swap(fresh, 'mkp-cal'); } },
      onchange: (e) => { const v = Number(e.target.value); state._mkpPreview = null; if (v !== Number(P0.target)) edit(n => { n.target = v; }); else mountApp(); } });
    return el('div', { class: 'card px-5 py-3 flex items-center gap-x-4 gap-y-2 flex-wrap', 'data-arrange-id': 'mkp-slider' },
      el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: muted }, 'Slide the revenue goal'),
      el('span', { class: 'text-[10px] tabular-nums', style: subtle }, '$' + (min / 1e6) + 'M'), rng, el('span', { class: 'text-[10px] tabular-nums', style: subtle }, '$' + (max / 1e6) + 'M'),
      el('div', { class: 'flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px]', style: muted },
        el('span', {}, 'Goal ', bGoal), el('span', {}, 'Marketing spend ', bSpend), el('span', {}, 'Flexible pool ', bPool), el('span', {}, 'Subscriptions ', bSubs)));
  })();
  return el('div', { class: 'flex flex-col gap-4' }, levers, slider, calendar, budgets);

}
