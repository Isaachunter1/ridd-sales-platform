// ── Office Staff Pay tab — live pay stub (per Isaac, Oct 15) ────────────────
// The same stub Run payroll prints (payStubCard + payrollRunStub, so the math is
// the Sales tab's), showing where the rep's pay stands right now: what would pay
// if payroll ran today, plus everything still on its way — Pending approval,
// NSF / Re-Audit holds, sold-but-no-initial, paid this period, and accounts
// waiting on the backend lock. Nothing here writes; the run stays on the Sales tab.
// A past period shows what was paid in it (recomputed with today's settings).
function viewPayLive() {
  const today = new Date();
  if (state.payYear == null) state.payYear = today.getFullYear();
  if (state.payPeriodId == null) state.payPeriodId = currentPayPeriodId(state.payYear);
  const periods = getPayPeriods(state.payYear);
  const period = periods.find(p => p.id === state.payPeriodId) || periods[0];
  const nowPid = currentPayPeriodId(today.getFullYear());
  const isCurrent = state.payYear === today.getFullYear() && period.id === nowPid;
  const isAdmin = isAdminRole(state.profile?.role);
  const pickable = (state.allProfiles || []).filter(p => p.is_active !== false && p.role !== 'auditor' && p.role !== 'disabled'
    && (p.id === state.profile.id || (typeof repTypeGroup === 'function' ? repTypeGroup(p) === 'office' : true)))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const prof = (isAdmin && state.payViewRepId) ? (pickable.find(p => p.id === state.payViewRepId) || state.profile) : state.profile;
  const repId = prof.id;
  const money = (v) => fmt.usd(Math.round((Number(v) || 0) * 100) / 100);

  // The rep's Office Staff sales in the new flow (same scope as the Sales tab's feed).
  const mine = ((isAdmin ? state.allSales : state.mySales) || []).filter(s => s.rep_id === repId
    && (s.queue_type || 'office') === 'office' && String(s.sold_date || '') >= SALES_FEED_START
    && !(typeof isNonCommSale === 'function' && isNonCommSale(s)));
  const unpaid = (s) => !s.payroll_processed_at && (s.lock_status || 'pending') === 'pending';
  const booked = (s) => typeof saleHasInitialScheduled !== 'function' || saleHasInitialScheduled(s);
  const ready = mine.filter(s => unpaid(s) && booked(s) && (s.audit_status === 'serviced' || s.audit_status === 'below_minimums'));
  const pending = mine.filter(s => unpaid(s) && booked(s) && s.audit_status === 'pending');
  const noInitial = mine.filter(s => unpaid(s) && !booked(s) && ['pending', 'serviced', 'below_minimums'].includes(s.audit_status));
  const nsf = mine.filter(s => unpaid(s) && s.audit_status === 'nsf');
  const reAudit = mine.filter(s => unpaid(s) && s.audit_status === 're_audit');
  const paidHere = mine.filter(s => s.payroll_processed_at && Number(s.payroll_period_id) === Number(period.id)
    && new Date(s.payroll_processed_at).getFullYear() === Number(state.payYear));
  const backend = mine.filter(s => s.payroll_processed_at && (s.lock_status || 'pending') === 'pending' && !s.backend_payroll_processed_at);

  // The stub: today's would-be payroll for the current period; what was paid for a past one.
  const stubSales = isCurrent ? ready : paidHere;
  const x = payrollRunStub(repId, stubSales, period);
  // Estimated pay of the held buckets = what each would pay once Commissionable (same tier as the stub).
  const est = (list) => list.length ? payrollRunStub(repId, list.map(s => Object.assign({}, s, { audit_status: 'serviced' })), period).salesPay : 0;
  const pendingPay = est(pending), nsfPay = est(nsf), reAuditPay = est(reAudit), noInitialPay = est(noInitial);
  const paidPay = isCurrent ? (paidHere.length ? payrollRunStub(repId, paidHere, period).salesPay : 0) : x.salesPay;
  const backendPay = backend.reduce((a, s) => a + (typeof getBackendAmount === 'function' ? getBackendAmount(s) : 0), 0);
  const estLine = new Map();
  for (const list of [pending, nsf, reAudit, noInitial]) if (list.length)
    payrollRunStub(repId, list.map(s => Object.assign({}, s, { audit_status: 'serviced' })), period).lines.forEach(l => estLine.set(l.sale_id, l.amount));

  // ── Controls: rep (admins) + pay period.
  const sel = (value, opts, onChange, w) => el('select', { class: 'rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: w || '0' }, onchange: (e) => onChange(e.target.value) },
    ...opts.map(([v, l]) => el('option', { value: String(v), selected: String(v) === String(value) }, l)));
  const controls = el('div', { class: 'flex items-center gap-2 flex-wrap' },
    isAdmin ? sel(repId, pickable.map(p => [p.id, p.full_name || 'Rep']), (v) => { state.payViewRepId = v; mountApp(); }, '220px') : null,
    sel(period.id, periods.map(p => [p.id, p.label + (state.payYear === today.getFullYear() && p.id === nowPid ? ' (current)' : '')]), (v) => { state.payPeriodId = Number(v); mountApp(); }, '200px'),
    isAdmin ? el('button', { type: 'button', class: 'text-[11px] underline text-muted-', onclick: () => { state._payClassic = true; mountApp(); } }, 'Classic pay tab') : null);

  // ── Status tiles: where every dollar stands.
  const tile = (label, value, sub, color, tip) => el('div', { class: 'card px-4 py-3', title: tip || '' },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold text-muted-' }, label),
    el('div', { class: 'text-xl font-black tabular-nums', style: color ? { color } : {} }, value),
    el('div', { class: 'text-[10px] text-muted-' }, sub));
  const n = (list, word) => list.length + ' ' + (word || 'account') + (list.length === 1 ? '' : 's');
  const C = (k) => (typeof SALE_STATUS_COLOR !== 'undefined' && SALE_STATUS_COLOR[k]) || undefined;
  const tiles = el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    isCurrent
      ? tile('Ready to pay', money(x.total), n(ready) + ' · if payroll ran now', C('serviced'), 'Commissionable / Below Minimums, initial booked, not paid yet — exactly what Run payroll would pay this rep today.')
      : tile('Paid ' + period.label, money(x.total), n(paidHere), C('serviced'), 'Accounts paid in this period’s payroll run (recomputed with today’s settings).'),
    tile('Pending approval', money(pendingPay), n(pending), C('pending'), 'Initial booked, waiting on the audit (or auto-approve). Estimated at the Commissionable rate.'),
    tile('No initial yet', money(noInitialPay), n(noInitial), 'var(--text-muted)', 'Sold, but no initial appointment booked after the sale — not on the Sales tab until one is.'),
    tile('NSF', money(nsfPay), n(nsf), nsf.length ? '#B91C1C' : undefined, 'Card declined since the sale and nothing has gone through. Pays once the customer pays.'),
    tile('Re-Audit', money(reAuditPay), n(reAudit), reAudit.length ? C('re_audit') : undefined, 'Held for a second look by an auditor.'),
    isCurrent ? tile('Paid this period', money(paidPay), n(paidHere), undefined, 'Already paid in a payroll run for ' + period.label + '.') : null,
    tile('Backend waiting', money(backendPay), n(backend), undefined, 'Paid upfront, waiting on the backend lock (4 paid invoices). Multi-year / renewal backend pays at the lock.'));

  // ── The stub itself.
  const saleById = new Map([...stubSales, ...pending, ...nsf, ...reAudit, ...noInitial, ...backend].map(s => [s.id, s]));
  const stub = payStubCard(x, period, saleById, {
    label: (isCurrent ? 'Pay stub so far · ' : 'Paid · ') + period.label,
    note: isCurrent ? 'Live: this is what payroll pays if it runs now. It fills in as sales are approved; Pending, NSF and Re-Audit accounts join once they’re Commissionable.' : null,
  });

  // ── Everything not on the stub yet, in the stub's table style.
  const th = (t, right) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const td = (t, right, extra) => el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: extra || {} }, t);
  const plan = (s) => el('span', { style: { fontSize: '12px' } }, saleServiceWithAddOns(s, (typeof nameFromId === 'function' ? nameFromId(state.serviceTypes, s.service_type_id) : '') || s.crm_subscription || '—', saleAddOnsFor(s), { size: '12px', weight: '600' }));
  const why = (s) => {
    if (s.audit_status === 'nsf') return s.crm_declined_at ? 'Card declined ' + fmt.dateShort(s.crm_declined_at) : 'Payment failed';
    if (s.audit_status === 're_audit') return 'Held for re-audit';
    if (!booked(s)) return 'No initial booked after the sale';
    if (s.crm_paid_since_sale === false) return 'Card declined ' + (s.crm_declined_at ? fmt.dateShort(s.crm_declined_at) : '');
    if ((typeof saleAuditFlag === 'function' ? saleAuditFlag(s) : s.crm_audit) === 'failed') return 'Failed Audit flag in FieldRoutes';   // renewals exempt (Oct 28)
    const ist = String(s.crm_initial_status || '').toLowerCase();
    if (!s.crm_serviced_at && ist !== 'completed') return 'Initial ' + (s.crm_initial_appt_at ? fmt.dateShort(String(s.crm_initial_appt_at).slice(0, 10)) : 'booked') + ' — approves once serviced';
    return 'Waiting on the audit';
  };
  const statusOf = (s) => el('span', { class: 'inline-flex items-center gap-1.5 text-[11px] font-semibold' },
    el('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: C(s.audit_status) || C('pending'), display: 'inline-block' } }),
    (typeof SALE_STATUS_LABEL !== 'undefined' && SALE_STATUS_LABEL[s.audit_status]) || s.audit_status);
  const holdRows = [...nsf, ...reAudit, ...pending, ...noInitial].sort((a, b) => String(b.sold_date).localeCompare(String(a.sold_date)));
  const holdCard = holdRows.length ? el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 pt-3 pb-2 text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Not on the stub yet · ' + n(holdRows) + ' · ' + money(pendingPay + nsfPay + reAuditPay + noInitialPay) + ' est.'),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
      el('thead', {}, el('tr', {}, th('Customer'), th('Plan'), th('Sold'), th('Status'), th('Why it’s waiting'), th('Est. pay', 1))),
      el('tbody', {}, ...holdRows.map(s => el('tr', { class: 'border-t border-', style: { background: typeof saleStatusTint === 'function' ? saleStatusTint(s.audit_status) : '' } },
        td(el('span', {}, el('span', { class: 'text-muted-' }, '#' + (s.customer_number || '')), ' ', s.customer_name || '')),
        td(plan(s)), td(fmt.dateShortYear(s.sold_date)), td(statusOf(s)),
        td(why(s), 0, { color: 'var(--text-muted)' }),
        td(money(estLine.get(s.id) || 0), 1, { fontWeight: '700' }))))))) : null;
  const backendCard = backend.length ? el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 pt-3 pb-2 text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Waiting on the backend lock · ' + n(backend)),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
      el('thead', {}, el('tr', {}, th('Customer'), th('Plan'), th('Paid'), th('Invoices'), th('Aging', 1), th('Backend', 1))),
      el('tbody', {}, ...backend.map(s => { const inv = Number(s.crm_paid_invoices) || 0; return el('tr', { class: 'border-t border-' },
        td(el('span', {}, el('span', { class: 'text-muted-' }, '#' + (s.customer_number || '')), ' ', s.customer_name || '')),
        td(plan(s)), td(fmt.dateShortYear(String(s.payroll_processed_at).slice(0, 10))),
        td(inv + ' / 4 paid', 0, { color: inv >= 4 ? '#15803D' : 'var(--text)', fontWeight: '600' }),
        td((Number(s.crm_days_past_due) || 0) + 'd', 1, { color: Number(s.crm_days_past_due) > 0 ? '#DC2626' : 'var(--text-muted)' }),
        td(money(typeof getBackendAmount === 'function' ? getBackendAmount(s) : 0), 1, { fontWeight: '700' })); }))))) : null;

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-end justify-between gap-3 flex-wrap' },
      el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Office Staff · pay'),
        el('h2', { class: 'text-2xl font-black' }, (prof.full_name || 'My') + (prof.full_name ? ' — ' : ' ') + period.label)),
      controls),
    // Running YTD ledger of every account this rep sold (per Isaac, Oct 16) — display only, above the stub.
    typeof payAccountsLedger === 'function' ? (() => { try { return payAccountsLedger(prof, state.payYear); } catch (e) { console.warn('[pay] accounts ledger', e); return null; } })() : null,
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-', style: { marginTop: '4px' } }, 'Pay stub · ' + period.label),
    tiles, stub, holdCard, backendCard,
    !mine.length ? el('div', { class: 'card p-8 text-center text-sm text-muted-' }, 'No Office Staff sales since ' + fmt.dateShortYear(SALES_FEED_START) + ' for this rep yet.') : null);
}
