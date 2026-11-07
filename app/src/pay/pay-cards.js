// ┌─ src/pay/pay-cards.js ───────────────────────────────────────────────────
// │ Pay tab cards (per Isaac, Nov 7): all commission, read off the same pay stub
// │ Isaac sends every pay period — the numbers that stub shows, nothing else.
// │
// │   Upfront (this period)  TOTAL PAY · SALES PAY · BELOW MINIMUMS · SUBSCRIPTIONS ·
// │                          TOTAL REVENUE · UPFRONT PAY % (Passed Audit tier) ·
// │                          BELOW MINIMUMS % · EST. CLOSE RATE %
// │   Backend (waiting)      ELIGIBLE SUBSCRIPTIONS · ELIGIBLE REVENUE · EST. MULTI-YEAR
// │                          PAY · EST. RENEWAL PAY · EST. CLOSE RATE % PAY · PENDING
// │                          BACKEND PAY · CHARGEBACKS · BACKEND PAID (year)
// │
// │ Every figure is the Sales tab's own math (payrollRunStub / getBackendAmount /
// │ closeRateBonusFor / subscriptionRevenueOf), so the cards, the stub and Run
// │ payroll never disagree. The backend row is reused on the Sales tab's Pending
// │ Backend Lock tab (backendSummaryStrip) over the rows on screen.
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
function _payTile(label, value, sub, color, tip) {
  return el('div', { class: 'card px-4 py-3', title: tip || '' },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold text-muted-' }, label),
    el('div', { class: 'text-xl font-black tabular-nums', style: color ? { color } : {} }, value),
    sub ? el('div', { class: 'text-[10px] text-muted-' }, sub) : null);
}
const _payGrid = (...tiles) => el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } }, ...tiles.filter(Boolean));

// The backend numbers for a set of paid-upfront sales still waiting on (or decided for) the backend.
function backendFigures(repId, backend) {
  const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const list = backend || [];
  const lockOf = (s) => s.lock_status || 'pending';
  const eligible = list.filter(s => lockOf(s) !== 'chargeback');
  const ren = (s) => typeof isRenewalSource === 'function' && isRenewalSource(s);
  const amt = (s) => (typeof getBackendAmount === 'function' ? getBackendAmount(s) : 0);
  const multiYear = eligible.filter(s => !ren(s) && [18, 24].includes(Number(s.contract_months))).reduce((a, s) => a + amt(s), 0);
  const renewal = eligible.filter(ren).reduce((a, s) => a + amt(s), 0);
  const revenue = eligible.reduce((a, s) => a + (Number(s.revenue_amount) || 0), 0);
  const subRev = typeof subscriptionRevenueOf === 'function' ? subscriptionRevenueOf(eligible) : 0;
  const prof = (state.allProfiles || []).find(p => p.id === repId) || {};
  const closeRate = Number(prof.close_rate_target ?? 0.5);
  const closeBonus = (repId && typeof closeRateBonusFor === 'function') ? closeRateBonusFor(closeRate, subRev, repId) : 0;
  // Chargebacks recoup what was paid upfront: the stored pay-run line when loaded (_recoup), else today's estimate.
  const chargebacks = list.filter(s => lockOf(s) === 'chargeback').reduce((a, s) => {
    if (s._recoup != null) return a + (Number(s._recoup) || 0);
    if (typeof payrollRunStub !== 'function' || !s.rep_id) return a;
    const one = payrollRunStub(s.rep_id, [Object.assign({}, s, { audit_status: s.audit_status === 'below_minimums' ? 'below_minimums' : 'serviced' })], { id: 0, start: new Date(), label: '' });
    return a + (one.lines.length ? one.lines[0].amount : 0);
  }, 0);
  return { eligible: eligible.length, revenue: money(revenue), multiYear: money(multiYear), renewal: money(renewal), closeRate, closeBonus: money(closeBonus), subRev: money(subRev),
    pending: money(multiYear + renewal + closeBonus), chargebacks: money(chargebacks) };
}

// Pay tab: the two rows. x = payrollRunStub(repId, stubSales, period); backend = paid upfront, backend not run.
function payCommissionCards(repId, prof, period, x, ctx) {
  const money = (v) => fmt.usd(Math.round((Number(v) || 0) * 100) / 100);
  const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
  const lines = x.lines || [];
  const below = lines.filter(l => l.status === 'below_minimums'), full = lines.filter(l => l.status !== 'below_minimums');
  const salesPay = full.reduce((a, l) => a + l.amount, 0), belowPay = below.reduce((a, l) => a + l.amount, 0);
  const extras = (x.extras || []).reduce((a, e) => a + (Number(e[1]) || 0), 0);
  const B = backendFigures(repId, ctx.backend);
  const n = (k, w) => k + ' ' + (w || 'account') + (k === 1 ? '' : 's');
  const upfrontTier = (() => { try { const s = effectivePaySettings(repId); const t = (s.upfront_tiers || []).slice().sort((a, b) => Number(b.min) - Number(a.min)).find(t => (x.pct || 0) * 100 >= Number(t.min)); return t ? Number(t.min) + '% +' : null; } catch (e) { return null; } })();
  const head = (t) => el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-', style: { marginTop: '4px' } }, t);
  return el('div', { class: 'flex flex-col gap-3' },
    head((ctx.isCurrent ? 'Upfront · if payroll ran now · ' : 'Upfront · paid · ') + period.label),
    _payGrid(
      _payTile('Total pay', money(x.total), n(lines.length) + (extras ? ' · ' + money(extras) + ' other pay' : ''), '#3E5A3A', 'Sales pay + Below Minimums pay + other pay lines (Golden Phone, Loyalty, adjustments) — what the stub pays.'),
      _payTile('Sales pay', money(salesPay), n(full.length) + ' commissionable', undefined, 'Commissionable accounts at the full rate × the Passed Audit tier.'),
      _payTile('Below Minimums', money(belowPay), n(below.length) + ' · half upfront', below.length ? '#B8862B' : undefined, 'Sold under the Standard sheet: half the upfront commission; backend pays in full.'),
      _payTile('Subscriptions', String(lines.length), money(x.revenue) + ' total revenue', undefined, 'Accounts on the stub and their contract value.'),
      _payTile('Upfront pay %', pct(x.mult == null ? 1 : x.mult), (x.pct == null ? 'no Passed Audit flags yet' : 'Passed Audit ' + pct(x.pct) + (upfrontTier ? ' · tier ' + upfrontTier : '')), undefined, 'The Passed Audit % of this period’s accounts picks the upfront tier; the tier is the share of commission that pays upfront.'),
      _payTile('Below Minimums %', lines.length ? Math.round(below.length / lines.length * 100) + '%' : '—', 'of accounts on the stub', undefined, 'Share of this period’s accounts sold under Standard pricing.'),
      _payTile('Est. close rate %', pct(B.closeRate), 'sets the close-rate bonus tier', undefined, 'The rep’s close rate target (per rep, Settings) — picks the close-rate bonus tier paid at the backend lock.')),
    head('Backend · ' + n(B.eligible, 'account') + ' waiting on the lock'),
    _payGrid(
      _payTile('Eligible subscriptions', String(B.eligible), money(B.revenue) + ' eligible revenue', undefined, 'Paid upfront, waiting on the backend lock (4 paid invoices); chargebacks left out.'),
      _payTile('Est. multi-year pay', money(B.multiYear), '18 / 24-month plans', undefined, 'Backend on 18- and 24-month plans at the multi-year rates.'),
      _payTile('Est. renewal pay', money(B.renewal), 'renewal-source plans', undefined, 'Backend on renewals at the renewal backend rate.'),
      _payTile('Est. close rate % pay', money(B.closeBonus), 'on ' + money(B.subRev) + ' subscription revenue', undefined, 'Close-rate bonus tier × the subscription revenue (12/18/24-month + PIF base plans) of the accounts waiting to lock.'),
      _payTile('Pending backend pay', money(B.pending), 'multi-year + renewal + close rate', '#3E5A3A', 'What the quarterly backend run would pay if every waiting account locked today.'),
      _payTile('Chargebacks', money(B.chargebacks), (ctx.backend || []).filter(s => s.lock_status === 'chargeback').length + ' to recoup', B.chargebacks ? '#B91C1C' : undefined, 'Upfront pay to recoup on accounts marked Chargeback, taken off the next backend run.'),
      ctx.backendPaidYear != null ? _payTile('Backend paid · ' + ctx.year, money(ctx.backendPaidYear), 'quarterly runs this year') : null));
}

// Sales tab → Pending Backend Lock: the backend row over the rows on screen (every rep, or the rep picked in the filter).
function backendSummaryStrip(rows) {
  const list = (rows || []).filter(s => s.payroll_processed_at && !s.backend_payroll_processed_at);
  if (!list.length) return null;
  const money = (v) => fmt.usd(Math.round((Number(v) || 0) * 100) / 100);
  const reps = [...new Set(list.map(s => s.rep_id).filter(Boolean))];
  // Per rep (the close-rate tier is per rep), summed.
  const T = { eligible: 0, revenue: 0, multiYear: 0, renewal: 0, closeBonus: 0, pending: 0, chargebacks: 0 };
  for (const r of reps) { const B = backendFigures(r, list.filter(s => s.rep_id === r)); for (const k of Object.keys(T)) T[k] += B[k] || 0; }
  const n = (k, w) => k + ' ' + (w || 'account') + (k === 1 ? '' : 's');
  return el('div', { class: 'mb-4' }, _payGrid(
    _payTile('Eligible subscriptions', String(T.eligible), money(T.revenue) + ' eligible revenue · ' + n(reps.length, 'rep'), undefined, 'Paid upfront, waiting on the backend lock; chargebacks left out.'),
    _payTile('Est. multi-year pay', money(T.multiYear), '18 / 24-month plans'),
    _payTile('Est. renewal pay', money(T.renewal), 'renewal-source plans'),
    _payTile('Est. close rate % pay', money(T.closeBonus), 'per rep’s close-rate tier'),
    _payTile('Pending backend pay', money(T.pending), 'if every account locked today', '#3E5A3A'),
    _payTile('Chargebacks', money(T.chargebacks), list.filter(s => s.lock_status === 'chargeback').length + ' to recoup', T.chargebacks ? '#B91C1C' : undefined)));
}
