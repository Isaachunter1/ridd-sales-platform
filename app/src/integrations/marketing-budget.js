// ┌─ integrations/marketing-budget.js ────────────────────────────────────────
// │ Marketing → Budget (per Isaac, Nov 25 2026): the lead-provider spend plan he
// │ used to keep in a spreadsheet, next to what actually happened, so that when a
// │ provider runs out of budget and asks for more the answer is on one screen.
// │   1. The year: one row per channel, twelve months. An admin types the budget
// │      for a month; under it sits what QuickBooks has booked for that month.
// │   2. One month, plan vs actual: at this budget what SHOULD come back, what
// │      has come back for the money spent so far, and whether the provider is
// │      ahead of or behind that.
// │ "Should" is not a typed-in target and not an estimate of ours: it is the
// │ provider's own record over its last three closed months before that month —
// │ its cost per lead, cost per booking and revenue per booking — applied to the
// │ dollars. A provider with no spend in those months has no expectation.
// │ Budgets are saved company-wide in adminRules.provBudgetsYM = { 'YYYY-MM':
// │ { channel: dollars } }; the single per-provider number typed on Channel
// │ metrics before this tab existed (adminRules.provBudgets) still counts for a
// │ month that has nothing typed here.
// │ Every actual is the Marketing tab's own cell (mklMonth): spend = QuickBooks,
// │ leads = Pest AI, bookings and revenue = FieldRoutes (last-touch source).
// └──────────────────────────────────────────────────────────────────────────
function mkbBudgetOf(ym, k) {
  const R = (typeof _adminRules === 'function' && _adminRules()) || {};
  const M = R.provBudgetsYM && R.provBudgetsYM[ym];
  if (M && M[k] != null) return Number(M[k]) > 0 ? Number(M[k]) : null;
  const flat = R.provBudgets && R.provBudgets[k];
  return Number(flat) > 0 ? Number(flat) : null;
}
function mkbSetBudget(ym, k, v) {
  const R = (typeof _adminRules === 'function' && _adminRules()) || {};
  const all = Object.assign({}, R.provBudgetsYM || {}), M = Object.assign({}, all[ym] || {});
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  M[k] = n > 0 ? Math.round(n) : 0;   // 0 = "typed: no budget this month" (so the old single number no longer applies)
  all[ym] = M;
  _setAdminRule('provBudgetsYM', all);
  try { if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {}); } catch (e) { /* syncs on the next save */ }
}
// The provider's own record over the three closed months before `ym`.
function mkbBaseline(ym, k) {
  const open = _mklYm(new Date());
  const t = { spend: 0, leads: 0, s: 0, cv: 0, months: [] };
  for (let i = 1, got = 0; i <= 12 && got < 3; i++) {
    const m = _mklShift(ym, -i); if (m >= open) continue;
    const D = mklMonth(m); if (!D || !D.hasSpend) continue;
    got++; t.months.push(m);
    const c = (D.ch || {})[k]; if (!c) continue;
    t.spend += c.spend || 0; t.leads += c.leads || 0; t.s += c.s || 0; t.cv += c.cv || 0;
  }
  t.cpl = t.spend > 0 && t.leads > 0 ? t.spend / t.leads : null;
  t.cac = t.spend > 0 && t.s > 0 ? t.spend / t.s : null;
  t.revPer = t.s > 0 ? t.cv / t.s : null;
  return t;
}
function mktgBudgetView() {
  if (typeof mklMonth !== 'function') return el('div', { class: 'card p-6 text-sm' }, 'Budget needs the Marketing metrics.');
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function' && state._ghl === undefined) ghlLoadLeads();
  const year = typeof _mktgYearSel === 'function' ? _mktgYearSel() : new Date().getFullYear();
  const canEdit = typeof isAdminRole === 'function' && isAdminRole(state.profile && state.profile.role);
  const today = new Date(), openYm = _mklYm(today), muted = { color: 'var(--text-muted)' };
  const yms = Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const Ds = yms.map(ym => ym <= openYm ? mklMonth(ym) : null);
  const R = (typeof _adminRules === 'function' && _adminRules()) || {};
  const shown = (k) => typeof _mkxShown === 'function' ? _mkxShown(k) : true;
  // Rows: every channel with a budget typed, or with QuickBooks spend or leads this year.
  const set = new Set();
  for (const ym of yms) for (const k in ((R.provBudgetsYM || {})[ym] || {})) set.add(k);
  for (const k in (R.provBudgets || {})) set.add(k);
  Ds.forEach(D => { if (D && D.ch) for (const k in D.ch) if (D.ch[k].spend > 0 || D.ch[k].leads > 0) set.add(k); });
  const keys = [...set].filter(shown).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const usd = (v) => v == null || !isFinite(v) ? '—' : fmt.usd0(v);
  const th = (t, tip, right) => el('th', { class: 'px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), title: tip || '', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);

  // ── 1. The year plan ──
  const totalCells = {}, rowTotals = {};
  const colSum = (ym) => keys.reduce((t, k) => t + (mkbBudgetOf(ym, k) || 0), 0);
  const rowSum = (k) => yms.reduce((t, ym) => t + (mkbBudgetOf(ym, k) || 0), 0);
  const refresh = (ym, k) => { if (totalCells[ym]) totalCells[ym].textContent = usd(colSum(ym) || null); if (rowTotals[k]) rowTotals[k].textContent = usd(rowSum(k) || null); if (totalCells.all) totalCells.all.textContent = usd(yms.reduce((t, m) => t + colSum(m), 0) || null); };
  const cell = (k, ym, i) => {
    const b = mkbBudgetOf(ym, k), D = Ds[i], act = D && D.hasSpend && D.ch && D.ch[k] ? D.ch[k].spend : null;
    const over = b && act != null && act > b * 1.02;
    return el('td', { class: 'px-1.5 py-1.5 align-top text-right', style: { background: ym === openYm ? 'rgba(223,100,58,.05)' : undefined } },
      canEdit ? el('input', { type: 'text', inputmode: 'numeric', value: b ? String(b) : '', placeholder: '—', class: 'rounded-md border px-1.5 py-1 text-[11px] tabular-nums text-right', style: { width: '74px', borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--text)' },
        title: k + ' · ' + MON[i] + ' ' + year + ' budget',
        // No re-render on a save: the totals are patched in place so Tab keeps moving across the row.
        onchange: (e) => { mkbSetBudget(ym, k, e.target.value); const nb = mkbBudgetOf(ym, k); e.target.value = nb ? String(nb) : ''; refresh(ym, k); state._mkbDirty = true; }, onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } })
        : el('div', { class: 'text-[11px] tabular-nums font-semibold' }, b ? usd(b) : '—'),
      act != null && (act > 0 || b) ? el('div', { class: 'text-[10px] tabular-nums mt-0.5', title: 'QuickBooks spend booked for ' + MON[i] + (ym === openYm ? ' so far' : ''), style: { color: over ? '#DC2626' : 'var(--text-subtle)' } }, usd(act) + (b ? ' · ' + Math.round(act / b * 100) + '%' : '')) : null);
  };
  const planCard = el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkb-plan' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Lead provider budgets · ' + year),
      el('span', { class: 'text-[11px] flex-1', style: muted }, (canEdit ? 'Type a month’s budget; it saves for everyone. ' : '') + 'Under each budget: what QuickBooks has booked that month, and the share of budget used.'),
      canEdit ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, title: 'Re-run Plan vs actual with the budgets just typed', onclick: () => mountApp() }, '↻ Update plan vs actual') : null),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'text-xs', style: { borderCollapse: 'collapse', minWidth: '100%' } },
      el('thead', {}, el('tr', {}, th('Provider'), ...MON.map((m, i) => th(m + (yms[i] === openYm ? ' · open' : ''), '', true)), th('Total', '', true))),
      el('tbody', {}, ...keys.map(k => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-3 py-1.5 font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 } }, k),
        ...yms.map((ym, i) => cell(k, ym, i)),
        (rowTotals[k] = el('td', { class: 'px-3 py-1.5 text-right tabular-nums font-black whitespace-nowrap' }, usd(rowSum(k) || null))))),
        el('tr', { class: 'border-t-2', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
          el('td', { class: 'px-3 py-2 font-black', style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }, 'Total'),
          ...yms.map((ym, i) => { const D = Ds[i], act = D && D.hasSpend ? keys.reduce((t, k) => t + ((D.ch[k] && D.ch[k].spend) || 0), 0) : null;
            return el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap' }, (totalCells[ym] = el('div', { class: 'font-black' }, usd(colSum(ym) || null))), act != null ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, usd(act)) : null); }),
          (totalCells.all = el('td', { class: 'px-3 py-2 text-right tabular-nums font-black whitespace-nowrap' }, usd(yms.reduce((t, m) => t + colSum(m), 0) || null))))))),
    !keys.length ? el('div', { class: 'px-5 pb-4 text-sm', style: muted }, 'No provider has spend, leads or a budget in ' + year + ' yet.') : null);

  // ── 2. One month: plan vs actual ──
  const pickable = yms.filter(ym => ym <= openYm);
  let ym = state._mkbMonth; if (!pickable.includes(ym)) ym = pickable.includes(openYm) ? openYm : pickable[pickable.length - 1];
  if (!ym) return el('div', { class: 'flex flex-col gap-4' }, planCard);
  const D = mklMonth(ym) || { ch: {} }, isOpen = ym === openYm;
  const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate(), day = isOpen ? today.getDate() : dim;
  const rows = keys.map(k => {
    const c = (D.ch || {})[k] || { spend: 0, leads: 0, s: 0, cv: 0 }, b = mkbBudgetOf(ym, k), base = mkbBaseline(ym, k);
    const spend = D.hasSpend ? (c.spend || 0) : null;
    const exp = { leads: b && base.cpl ? b / base.cpl : null, s: b && base.cac ? b / base.cac : null }; exp.cv = exp.s != null && base.revPer ? exp.s * base.revPer : null;
    const due = { leads: spend && base.cpl ? spend / base.cpl : null, s: spend && base.cac ? spend / base.cac : null };   // what the money spent SO FAR should have bought
    const ratio = due.s && due.s >= 3 ? c.s / due.s : null;
    const perDay = day > 0 && spend ? spend / day : 0, runOut = b && perDay > 0 ? Math.ceil(b / perDay) : null;
    return { k, c, b, base, spend, exp, due, ratio, runOut, cac: spend && c.s ? spend / c.s : null };
  }).filter(r => r.b || r.spend || r.c.leads || r.c.s).sort((a, b2) => (b2.b || 0) - (a.b || 0) || (b2.spend || 0) - (a.spend || 0) || b2.c.leads - a.c.leads);
  const td = (...kids) => el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap align-top' }, ...kids);
  const sub = (t, color) => t ? el('div', { class: 'text-[10px]', style: { color: color || 'var(--text-subtle)' } }, t) : null;
  const vs = (act, due) => due == null || !(due > 0) ? null : sub('should be ' + fmt.int(Math.round(due)) + ' by now', act >= due * 0.9 ? '#15803D' : '#B91C1C');
  const verdict = (r) => {
    if (r.spend == null) return ['No QuickBooks spend yet', 'var(--card-2)', 'var(--text-muted)', 'QuickBooks has no marketing lines for this month yet.'];
    if (!r.base.cac) return ['No record to compare', 'var(--card-2)', 'var(--text-muted)', 'No spend with bookings in its last three closed months, so there is nothing to expect yet.'];
    if (r.ratio == null) return ['Too early', 'var(--card-2)', 'var(--text-muted)', 'The spend so far should have bought under 3 bookings — too little to judge.'];
    const t = fmt.int(r.c.s) + ' bookings against ' + fmt.int(Math.round(r.due.s)) + ' expected for ' + usd(r.spend) + ' spent (' + Math.round(r.ratio * 100) + '%).';
    return r.ratio >= 1.1 ? ['Ahead of plan', 'rgba(21,128,61,.12)', '#15803D', t + ' More budget is buying at better than its usual cost.']
      : r.ratio >= 0.9 ? ['On plan', 'rgba(47,93,98,.12)', '#2F5D62', t] : ['Behind plan', 'rgba(220,38,38,.12)', '#DC2626', t + ' More budget would buy at worse than its usual cost.'];
  };
  const lbl = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthSel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { state._mkbMonth = e.target.value; mountApp(); } },
    ...pickable.slice().reverse().map(m => el('option', { value: m, selected: m === ym }, MON[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4) + (m === openYm ? ' · open' : ''))));
  const tot = rows.reduce((t, r) => { t.b += r.b || 0; t.spend += r.spend || 0; t.leads += r.c.leads; t.s += r.c.s; t.cv += r.c.cv || 0; t.es += r.exp.s || 0; t.ecv += r.exp.cv || 0; return t; }, { b: 0, spend: 0, leads: 0, s: 0, cv: 0, es: 0, ecv: 0 });
  const vsCard = el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkb-vs' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Plan vs actual · ' + lbl + (isOpen ? ' · day ' + day + ' of ' + dim : '')),
      el('span', { class: 'text-[11px] flex-1', style: muted }, 'Expected = the provider’s own last three closed months, applied to the dollars'), monthSel),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse', minWidth: '1040px' } },
      el('thead', {}, el('tr', {}, th('Provider'), th('Budget'), th('Expected at this budget', 'Budget ÷ its usual cost per lead and cost per booking, and those bookings × its usual revenue per booking'), th('Spent', 'QuickBooks spend booked this month, share of budget, and when the budget runs out at this daily pace'),
        th('Leads', 'Pest AI leads this month, against what the spend so far should have bought'), th('Bookings', 'New sales (initial booked or serviced) by FieldRoutes source, against what the spend so far should have bought'), th('Revenue', 'Contract value of those bookings'), th('CAC', 'Spend ÷ bookings, next to its usual'), th('Read', 'Bookings so far ÷ the bookings the spend so far should have bought. Ahead = 110% or more, behind = under 90%. Needs at least 3 expected bookings.'))),
      el('tbody', {}, ...rows.map(r => { const V = verdict(r), used = r.b && r.spend != null ? r.spend / r.b : null, late = r.runOut != null && isOpen && r.runOut < dim;
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap align-top' }, r.k),
          td(el('div', { class: 'font-semibold' }, r.b ? usd(r.b) : '—')),
          td(r.exp.s != null ? el('div', { class: 'font-semibold' }, fmt.int(Math.round(r.exp.s)) + ' bookings') : el('span', { style: muted }, r.b ? 'no record yet' : '—'),
            sub(r.exp.leads != null ? fmt.int(Math.round(r.exp.leads)) + ' leads' + (r.exp.cv != null ? ' · ' + usd(r.exp.cv) + ' revenue' : '') : ''), sub(r.base.cac ? 'usual CAC ' + usd(r.base.cac) + (r.base.cpl ? ' · ' + usd(r.base.cpl) + ' a lead' : '') : '')),
          td(el('div', { class: 'font-semibold' }, r.spend == null ? '—' : usd(r.spend)),
            used != null ? el('div', { style: { width: '110px', height: '6px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden', margin: '3px 0' } }, el('div', { style: { width: Math.min(100, used * 100) + '%', height: '100%', borderRadius: '999px', background: used >= 1 ? '#DC2626' : late ? '#D97706' : '#2F5D62' } })) : null,
            used != null ? sub(Math.round(used * 100) + '% of budget' + (used >= 1 ? ' · used up' : late ? ' · runs out about day ' + r.runOut : ''), used >= 1 ? '#DC2626' : late ? '#B45309' : undefined) : null),
          td(el('div', { class: 'font-semibold' }, fmt.int(r.c.leads)), vs(r.c.leads, r.due.leads)),
          td(el('div', { class: 'font-black' }, fmt.int(r.c.s)), vs(r.c.s, r.due.s)),
          td(el('div', { class: 'font-semibold' }, r.c.cv ? usd(r.c.cv) : '—'), sub(r.exp.cv != null ? 'plan ' + usd(r.exp.cv) : '')),
          td(el('div', { class: 'font-semibold' }, usd(r.cac)), sub(r.base.cac ? 'usual ' + usd(r.base.cac) : '', r.cac && r.base.cac ? (r.cac <= r.base.cac ? '#15803D' : '#B91C1C') : undefined)),
          el('td', { class: 'px-3 py-2 align-top' }, el('span', { class: 'rounded-full px-2 py-0.5 text-[11px] font-black whitespace-nowrap', style: { background: V[1], color: V[2] } }, V[0]),
            el('div', { class: 'text-[10px] mt-1', style: { color: 'var(--text-subtle)', whiteSpace: 'normal', maxWidth: '250px' } }, V[3]))); }),
        el('tr', { class: 'border-t-2', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
          el('td', { class: 'px-3 py-2 font-black' }, 'Total'), td(el('b', {}, usd(tot.b || null))), td(el('b', {}, tot.es ? fmt.int(Math.round(tot.es)) + ' bookings' : '—'), sub(tot.ecv ? usd(tot.ecv) + ' revenue' : '')),
          td(el('b', {}, D.hasSpend ? usd(tot.spend) : '—'), sub(tot.b && D.hasSpend ? Math.round(tot.spend / tot.b * 100) + '% of budget' : '')), td(el('b', {}, fmt.int(tot.leads))), td(el('b', {}, fmt.int(tot.s))), td(el('b', {}, usd(tot.cv || null))), td(el('b', {}, D.hasSpend && tot.s ? usd(tot.spend / tot.s) : '—')), td())))),
    el('div', { class: 'px-5 py-2 text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Spend is what QuickBooks has booked, so a provider that bills late reads low and its row can look ahead of plan until the bill lands. Bookings are counted on the FieldRoutes source — keep Auditing → Attribution → Source check clear.'));
  return el('div', { class: 'flex flex-col gap-4' }, vsCard, planCard);
}
