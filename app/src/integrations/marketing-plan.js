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
  target: 7000000, ratio: 0.39, fee: 28000, lsaExtra: 0, acv: 800, close: 0.15,
  // Share of the year's new revenue by month — the sheet's goal row ÷ the target (sums to 100).
  curve: [2.001, 3.002, 5.003, 9.006, 10.006, 12.008, 17.011, 14.009, 10.992, 10.006, 5.003, 1.953],
  // Google Local Services by month — Incline's 2027 forecast, existing markets (the sheet's "LSA 2027 plan" total row).
  lsa: [12708, 12263, 22565, 46428, 52655, 71550, 105217, 91744, 64054, 53375, 31625, 15250],
  // Share of the flexible pool. ch = the app's channel the actuals are read from ('' = everything not named here).
  mix: [
    { n: 'Facebook / Meta', ch: 'Facebook', s: 34 }, { n: 'DoLead (pay per lead)', ch: 'DoLead', s: 18 },
    { n: 'Google Ads — Search', ch: 'Google Ads', s: 8 }, { n: 'Google Ads — Performance Max', ch: 'Google Ads', s: 4 },
    { n: 'Service Direct (pay per call)', ch: 'Service Direct', s: 8 }, { n: 'Angi / HomeAdvisor', ch: 'Angi', s: 5 },
    { n: 'Baton (referral network)', ch: 'Baton', s: 5 }, { n: 'ElectGen', ch: 'ElectGen', s: 3 },
    { n: 'New channels & tests', ch: '', s: 15 }],
};
const MKP_LSA_CH = 'Google Local Services';
function _mkpAgencyCh() { return typeof spqLabel === 'function' && typeof SPQ_TOOLS !== 'undefined' ? spqLabel(SPQ_TOOLS) : 'Agency'; }
function mkpPlan(year) {
  const R = (typeof _adminRules === 'function' && _adminRules()) || {};
  const P = R.mediaPlan && R.mediaPlan[String(year)];
  if (P && typeof P === 'object') return P;
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
  const rows = (P.mix || []).map(r => ({ n: r.n, ch: r.ch || '', s: n(r.s), m: M.map(i => poolM[i] * n(r.s) / 100) }));
  const goal = M.map(i => n(P.target) * curve[i]);
  const subs = goal.map(g => n(P.acv) > 0 ? g / n(P.acv) : 0), leads = subs.map(s => n(P.close) > 0 ? s / n(P.close) : 0);
  const fee = M.map(() => n(P.fee));
  const total = M.map(i => fee[i] + lsa[i] + rows.reduce((a, r) => a + r.m[i], 0));
  const v = { curve, curveSum, lsa, lsaYear, budget, feeYear, pool, poolM, rows, mixSum, goal, subs, leads, fee, total,
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

function mktgPlanView() {
  if (typeof mklMonth !== 'function') return el('div', { class: 'card p-6 text-sm' }, 'The media plan needs the Marketing metrics.');
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function' && state._ghl === undefined) ghlLoadLeads();
  const year = Number(typeof _mktgYearSel === 'function' ? _mktgYearSel() : new Date().getFullYear());
  const canEdit = typeof isAdminRole === 'function' && isAdminRole(state.profile && state.profile.role);
  const muted = { color: 'var(--text-muted)' }, subtle = { color: 'var(--text-subtle)' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const P = mkpPlan(year);
  if (!P) return el('div', { class: 'card p-6 flex items-center gap-3 flex-wrap' },
    el('div', { class: 'text-sm flex-1' }, el('b', {}, 'No media plan for ' + year + ' yet. '), 'The 2027 plan is built in; use the year arrows above to open it' + (canEdit ? ', or start ' + year + ' from the same levers.' : '.')),
    canEdit ? el('button', { class: 'rounded-lg px-3 py-1.5 text-[12px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => { mkpSavePlan(year, JSON.parse(JSON.stringify(MKP_DEFAULT_2027))); mountApp(); } }, 'Start ' + year + ' from the 2027 levers') : null);
  const C = mkpCalc(P);
  const usd = (v) => v == null || !isFinite(v) ? '—' : fmt.usd0(v), int = (v) => v == null || !isFinite(v) ? '—' : fmt.int(Math.round(v));
  const pct = (v, d) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d == null ? 1 : d) + '%';
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  // A change saves the whole plan and redraws; focus goes back to wherever Tab or the click landed.
  const edit = (fn) => { const next = JSON.parse(JSON.stringify(P)); fn(next); mkpSavePlan(year, next);
    setTimeout(() => { const a = document.activeElement, id = a && a.dataset ? a.dataset.mp : ''; mountApp(); if (id) { const t = document.querySelector('[data-mp="' + id + '"]'); if (t) { t.focus(); try { t.select(); } catch (e) { /* not a text field */ } } } }, 0); };
  const num = (s) => Number(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')) || 0;
  const inp = (id, val, onSet, w, tip) => canEdit
    ? el('input', { type: 'text', inputmode: 'decimal', value: val, 'data-mp': id, title: tip || '', class: 'rounded-md border px-1.5 py-1 text-[11px] tabular-nums text-right', style: { width: (w || 70) + 'px', borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => onSet(num(e.target.value)), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } })
    : el('span', { class: 'text-[11px] tabular-nums font-semibold' }, val);

  // ── 1. Levers ──
  const lever = (label, node, note) => el('div', { class: 'flex flex-col gap-1', style: { minWidth: '150px' } },
    el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: muted }, label), node, note ? el('div', { class: 'text-[10px]', style: subtle }, note) : null);
  const isDefault = !(((typeof _adminRules === 'function' && _adminRules()) || {}).mediaPlan || {})[String(year)];
  const levers = el('div', { class: 'card p-4 flex flex-col gap-3', 'data-arrange-id': 'mkp-levers' },
    el('div', { class: 'flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Media plan · ' + year),
      el('span', { class: 'text-[11px] flex-1', style: muted }, canEdit ? 'Change a lever and the calendar, the budgets and the progress below all follow.' : ''),
      canEdit && !isDefault && year === 2027 ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, title: 'Puts every lever, the curve, the LSA plan and the mix back to the spreadsheet’s values', onclick: () => { mkpSavePlan(year, JSON.parse(JSON.stringify(MKP_DEFAULT_2027))); mountApp(); } }, 'Reset to the spreadsheet') : null),
    el('div', { class: 'flex gap-x-6 gap-y-3 flex-wrap' },
      lever('New-revenue target', inp('target', fmt.usd0(P.target), (v) => edit(n => { n.target = v; }), 110), 'Office Staff new sales, contract value'),
      lever('Marketing spend ÷ new revenue', inp('ratio', (P.ratio * 100).toFixed(1) + '%', (v) => edit(n => { n.ratio = v / 100; }), 70), 'Media + agency. Budget ' + usd(C.budget)),
      lever('Agency fee / month', inp('fee', fmt.usd0(P.fee), (v) => edit(n => { n.fee = v; }), 90), usd(C.feeYear) + ' a year, flat'),
      lever('LSA for new locations / year', inp('lsaExtra', fmt.usd0(P.lsaExtra || 0), (v) => edit(n => { n.lsaExtra = v; }), 90), 'On top of the LSA row; follows its shape'),
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
  const curveBad = Math.abs(C.curveSum - 1) > 0.002, mixBad = Math.abs(C.mixSum - 100) > 0.05;
  const curveRow = el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, first(['Share of the year (curve)']),
    ...C.curve.map((v, i) => el('td', { class: 'px-1.5 py-1.5 text-right' }, inp('curve' + i, (v * 100).toFixed(1) + '%', (x) => edit(n => { n.curve[i] = x; }), 62, MON[i] + ' share of the year’s new revenue'))),
    cell(pct(C.curveSum, 1), { fontWeight: '800', color: curveBad ? '#DC2626' : undefined }));
  const lsaRow = el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, first(['Google Local Services (Incline plan' + (P.lsaExtra ? ' + new locations' : '') + ')']),
    ...C.lsa.map((v, i) => el('td', { class: 'px-1.5 py-1.5 text-right' }, P.lsaExtra ? el('span', { class: 'text-[11px] tabular-nums', title: 'Plan ' + usd((P.lsa || [])[i]) + ' + new locations' }, usd(v)) : inp('lsa' + i, fmt.usd0(v), (x) => edit(n => { n.lsa[i] = x; }), 72, MON[i] + ' LSA plan'))),
    cell(usd(C.lsaYear), { fontWeight: '800' }));
  const mixRow = (r, j) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    first([el('span', { class: 'inline-flex items-center gap-2', style: { paddingLeft: '14px' } }, inp('mix' + j, r.s + '%', (x) => edit(n => { n.mix[j].s = x; }), 48, 'Share of the flexible pool'), el('span', {}, r.n))], { fontWeight: '500' }),
    ...r.m.map(v => cell(usd(v))), cell(usd(sum(r.m)), { fontWeight: '800' }));
  const calendar = el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkp-cal' },
    el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Spend calendar · ' + year),
      curveBad ? el('span', { class: 'text-[11px] font-bold', style: { color: '#DC2626' } }, 'The curve adds up to ' + pct(C.curveSum, 1) + ' — it should be 100%.') : null,
      mixBad ? el('span', { class: 'text-[11px] font-bold', style: { color: '#DC2626' } }, 'The channel mix adds up to ' + C.mixSum.toFixed(0) + '% — it should be 100%.') : null,
      el('span', { class: 'ml-auto text-sm font-black tabular-nums' }, usd(sum(C.total)))),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'text-xs', style: { borderCollapse: 'collapse', minWidth: '100%' } },
      el('thead', {}, el('tr', {}, th('Line'), ...MON.map(m => th(m, true)), th(String(year), true))),
      el('tbody', {},
        head('Revenue plan'), curveRow,
        line('New-revenue goal', C.goal, usd, { strong: true }),
        line('New subscriptions needed', C.subs, int), line('Leads needed', C.leads, int),
        head('Spend plan'),
        line('Agency flat fee', C.fee, usd), lsaRow,
        line('Flexible media pool', C.poolM, usd, { strong: true }),
        ...C.rows.map(mixRow),
        line('Total marketing spend', C.total, usd, { strong: true, band: true }),
        line('Spend ÷ revenue goal', C.total.map((t, i) => C.goal[i] > 0 ? t / C.goal[i] : null), (v) => pct(v, 1), { soft: true, total: sum(C.goal) > 0 ? sum(C.total) / sum(C.goal) : null }),
        line('Media cost per new subscription', C.total.map((t, i) => C.subs[i] > 0 ? (t - C.fee[i]) / C.subs[i] : null), usd, { soft: true, total: sum(C.subs) > 0 ? (sum(C.total) - C.feeYear) / sum(C.subs) : null })))));

  // ── 3. Progress: plan against actuals for the year so far ──
  const today = new Date(), openYm = typeof _mklYm === 'function' ? _mklYm(today) : '';
  const yms = MON.map((_, i) => year + '-' + String(i + 1).padStart(2, '0'));
  const upto = yms.filter(ym => ym <= openYm);
  let progress;
  if (!upto.length) {
    progress = el('div', { class: 'card p-5 text-sm', 'data-arrange-id': 'mkp-prog', style: muted }, el('b', { style: { color: 'var(--text)' } }, 'Progress starts in January ' + year + '. '), 'Each month the plan is set against QuickBooks spend, Pest AI leads and FieldRoutes new sales, by channel, with a read on what is excelling and what is lagging.');
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
    for (const g of groups.values()) if (g.names.length > 1) g.n = g.ch + ' (' + g.names.length + ' plan lines)';
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
    const table = el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkp-prog' },
      el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Progress · ' + year + ' through ' + through)),
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
    progress = el('div', { class: 'flex flex-col gap-4' }, tiles, table);
  }
  return el('div', { class: 'flex flex-col gap-4' }, levers, progress, calendar);
}
