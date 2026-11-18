// ┌─ dashp/office ────────────────────────────────────────────────────────────
// │ COMMISSIONS → Office Staff (per Isaac, Nov 18): the Inside Sales / Loyalty
// │ pay, moved here from the Sales tab's Pay sub-tab, in the same two-screen
// │ shape as Technicians and Sales Reps:
// │   dashpOfficeList         one row per office rep for a pay period (or the
// │                           full year): what pays now, what is on its way,
// │                           what is building backend. A row opens the detail.
// │   dashpOfficeDetailView   one rep, one period — the live pay stub itself
// │                           (pay/pay-live.js), untouched, so the number here
// │                           is the number payroll pays.
// │ Data: the app's own sales + FieldRoutes sync (RevHawk) through the existing
// │ pay engine (payrollRunStub, getBackendAmount, payRunsFor). Nothing from
// │ DASHP, and nothing here changes a rate or a rule.
// │ Who: admins / developers see everyone; an office rep sees only themselves
// │ (the list collapses straight to their stub).
// └────────────────────────────────────────────────────────────────────────

function dashpOfficeIsRep(p) {
  return !!p && typeof repTypeGroup === 'function' && repTypeGroup(p) === 'office' && p.role !== 'auditor' && p.role !== 'disabled';
}
function dashpOfficeCanSeeAll() { const r = state.profile && state.profile.role; return isAdminRole(r) || (typeof isDeveloperRole === 'function' && isDeveloperRole(r)); }

// One rep's numbers for a period (or 'year'), through the same engine as the Pay tab (pay-live.js buckets).
function dashpOfficeFigures(prof, year, period, isCurrent) {
  const repId = prof.id;
  const all = (dashpOfficeCanSeeAll() ? state.allSales : state.mySales) || [];
  const mine = all.filter(s => s.rep_id === repId && (s.queue_type || 'office') === 'office' && String(s.sold_date || '') >= SALES_FEED_START
    && !(typeof isNonCommSale === 'function' && isNonCommSale(s)));
  const unpaid = (s) => !s.payroll_processed_at && (s.lock_status || 'pending') === 'pending';
  const booked = (s) => typeof saleHasInitialScheduled !== 'function' || saleHasInitialScheduled(s);
  const stub = (list, per) => list.length ? payrollRunStub(repId, list, per) : { total: 0, salesPay: 0, revenue: 0, lines: [] };
  const est = (list, per) => list.length ? stub(list.map(s => Object.assign({}, s, { audit_status: 'serviced' })), per).salesPay : 0;
  const backend = mine.filter(s => s.payroll_processed_at && (s.lock_status || 'pending') === 'pending' && !s.backend_payroll_processed_at);
  const backendPay = backend.reduce((a, s) => a + (typeof getBackendAmount === 'function' ? getBackendAmount(s) : 0), 0);
  const pending = mine.filter(s => unpaid(s) && booked(s) && s.audit_status === 'pending');
  const held = mine.filter(s => unpaid(s) && ((booked(s) && (s.audit_status === 'nsf' || s.audit_status === 're_audit')) || (!booked(s) && ['pending', 'serviced', 'below_minimums'].includes(s.audit_status))));
  if (period === 'year') {
    // Full year: every period's paid stub, recomputed with today's settings (same as the Pay tab's past periods).
    const periods = getPayPeriods(year);
    let paid = 0, paidN = 0, revenue = 0;
    for (const per of periods) {
      const ph = mine.filter(s => s.payroll_processed_at && Number(s.payroll_period_id) === Number(per.id) && new Date(s.payroll_processed_at).getFullYear() === Number(year));
      if (!ph.length) continue;
      const x = stub(ph, per); paid += x.total; paidN += ph.length; revenue += x.revenue;
    }
    const runs = typeof payRunsFor === 'function' ? payRunsFor(repId, year) : [];
    const backendPaid = (runs || []).filter(r => r.kind === 'backend').reduce((a, r) => a + (Number((r.totals || {}).backend_pay) || 0), 0);
    const ready = mine.filter(s => unpaid(s) && booked(s) && (s.audit_status === 'serviced' || s.audit_status === 'below_minimums'));
    const cur = getPayPeriods(year).find(p => p.id === currentPayPeriodId(year)) || getPayPeriods(year)[0];
    const sold = mine.filter(s => String(s.sold_date || '').slice(0, 4) === String(year));
    return { prof, sold: sold.length, soldRev: sold.reduce((a, s) => a + (Number(s.revenue_amount) || 0), 0), paid, paidN, revenue, backendPaid, ready: est(ready, cur), readyN: ready.length,
      pending: est(pending, cur), pendingN: pending.length, held: est(held, cur), heldN: held.length, backend: backendPay, backendN: backend.length, total: paid + backendPaid };
  }
  const ready = mine.filter(s => unpaid(s) && booked(s) && (s.audit_status === 'serviced' || s.audit_status === 'below_minimums'));
  const paidHere = mine.filter(s => s.payroll_processed_at && Number(s.payroll_period_id) === Number(period.id) && new Date(s.payroll_processed_at).getFullYear() === Number(year));
  const stubSales = isCurrent ? ready : paidHere;
  const x = stub(stubSales, period);
  const inPeriod = (s) => { const d = String(s.sold_date || ''); return d >= period.start.toISOString().slice(0, 10) && d <= period.end.toISOString().slice(0, 10); };
  const sold = mine.filter(inPeriod);
  return { prof, sold: sold.length, soldRev: sold.reduce((a, s) => a + (Number(s.revenue_amount) || 0), 0), total: x.total, stubN: stubSales.length, revenue: x.revenue, pct: x.pct, mult: x.mult,
    paidHere: isCurrent && paidHere.length ? stub(paidHere, period).total : 0, paidHereN: paidHere.length,
    pending: est(pending, period), pendingN: pending.length, held: est(held, period), heldN: held.length, backend: backendPay, backendN: backend.length };
}

function dashpOfficeList(S) {
  const year = S.year, today = new Date();
  const periods = getPayPeriods(year);
  const nowPid = currentPayPeriodId(today.getFullYear());
  const sel = S.osPeriod == null ? (year === today.getFullYear() ? nowPid : 'year') : S.osPeriod;
  S.osPeriodShown = sel;   // the top bar's Period select reads this
  const period = sel === 'year' ? 'year' : (periods.find(p => p.id === Number(sel)) || periods[0]);
  const isCurrent = period !== 'year' && year === today.getFullYear() && period.id === nowPid;
  const all = dashpOfficeCanSeeAll();
  let reps = (state.allProfiles || []).filter(dashpOfficeIsRep);
  if (!all) reps = reps.filter(p => p.id === state.profile.id);
  if (!all && !reps.length && state.profile) reps = [state.profile];
  // Reps with no sales in the feed stay out unless "Everyone" is picked (inactive logins drop off the same way).
  const rows = reps.map(p => { try { return dashpOfficeFigures(p, year, period, isCurrent); } catch (e) { console.warn('[commissions] office figures', p.id, e); return null; } }).filter(Boolean)
    .map(r => Object.assign(r, { name: r.prof.full_name || '—', active: r.prof.is_active !== false, has: !!(r.sold || r.total || r.pending || r.held || r.backend || r.paid) }));
  const open = (r) => { S.detail = { kind: 'office', id: r.prof.id, name: r.name, year, period: period === 'year' ? (periods.find(p => p.id === nowPid) || periods[0]).id : period.id }; mountApp(); };
  if (!all && rows.length === 1) { open(rows[0]); return dashpNotice('Opening your pay…'); }
  const who = { id: 'name', label: 'Rep', value: r => r.name, cell: r => el('span', { class: 'font-semibold' }, r.name), sub: r => (r.prof.rep_type === 'loyalty_rep' ? 'Loyalty' : 'Inside Sales') + (r.active ? '' : ' · inactive') };
  const search = r => r.name;
  const money = (v) => fmt.usd0(Math.round(Number(v) || 0));
  const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const label = period === 'year' ? String(year) : period.label + (isCurrent ? ' (current)' : '');

  if (period === 'year') {
    return el('div', { class: 'flex flex-col gap-4' },
      dashpStatRow(
        dashpStat('Office reps', fmt.int(rows.filter(r => r.has).length), year + ' · with pay activity'),
        dashpStat('Sales', fmt.int(sum('sold')), money(sum('soldRev')) + ' sold'),
        dashpStat('Upfront paid', money(sum('paid')), fmt.int(sum('paidN')) + ' accounts · ' + year),
        dashpStat('Backend paid', money(sum('backendPaid')), 'quarterly runs'),
        dashpStat('Ready now', money(sum('ready')), fmt.int(sum('readyN')) + ' accounts · if payroll ran today'),
        dashpStat('Building backend', money(sum('backend')), fmt.int(sum('backendN')) + ' accounts waiting on the lock'),
        dashpStat('Total paid', money(sum('total')), year)),
      dashpTable(S, 'office-year', {
        title: 'Office Staff · ' + year, rows, search, placeholder: 'Search name', defaultSort: { id: 'total', dir: 'desc' },
        filters: [['has', 'With pay activity', r => r.has], ['all', 'Everyone']], defaultFilter: 'has',
        onRow: open, empty: 'No office staff pay for ' + year + ' yet.',
        columns: [who,
          { id: 'sold', label: 'Sales', align: 'right', value: r => r.sold, cell: r => fmt.int(r.sold), sub: r => money(r.soldRev) + ' sold' },
          { id: 'paid', label: 'Upfront paid', align: 'right', value: r => r.paid, cell: r => money(r.paid), sub: r => fmt.int(r.paidN) + ' accounts' },
          { id: 'bpaid', label: 'Backend paid', align: 'right', value: r => r.backendPaid, cell: r => money(r.backendPaid) },
          { id: 'ready', label: 'Ready now', align: 'right', value: r => r.ready, cell: r => money(r.ready), sub: r => fmt.int(r.readyN) + ' accounts' },
          { id: 'pend', label: 'On its way', align: 'right', value: r => r.pending + r.held, cell: r => money(r.pending + r.held), sub: r => fmt.int(r.pendingN) + ' pending · ' + fmt.int(r.heldN) + ' held' },
          { id: 'backend', label: 'Building backend', align: 'right', value: r => r.backend, cell: r => money(r.backend), sub: r => fmt.int(r.backendN) + ' accounts' },
          { id: 'total', label: year + ' paid', align: 'right', value: r => r.total, cell: r => el('span', { class: 'font-black' }, money(r.total)) },
          { id: 'go', label: '', align: 'right', cell: () => el('span', { style: { color: 'var(--accent)' } }, 'Details →') }],
      }));
  }
  return el('div', { class: 'flex flex-col gap-4' },
    dashpStatRow(
      dashpStat('Office reps', fmt.int(rows.filter(r => r.has).length), label),
      dashpStat('Sales', fmt.int(sum('sold')), money(sum('soldRev')) + ' sold in the period'),
      dashpStat(isCurrent ? 'Pays now' : 'Paid', money(sum('total')), fmt.int(sum('stubN')) + ' accounts' + (isCurrent ? ' · if payroll ran today' : ' · ' + period.label)),
      isCurrent ? dashpStat('Already paid this period', money(sum('paidHere')), fmt.int(sum('paidHereN')) + ' accounts') : null,
      dashpStat('On its way', money(sum('pending') + sum('held')), fmt.int(sum('pendingN')) + ' pending · ' + fmt.int(sum('heldN')) + ' held (NSF / re-audit / no initial)'),
      dashpStat('Building backend', money(sum('backend')), fmt.int(sum('backendN')) + ' accounts waiting on the lock')),
    dashpTable(S, 'office-period', {
      title: 'Office Staff · ' + label, rows, search, placeholder: 'Search name', defaultSort: { id: 'total', dir: 'desc' },
      filters: [['has', 'With pay activity', r => r.has], ['all', 'Everyone']], defaultFilter: 'has',
      onRow: open, empty: 'No office staff pay for ' + label + ' yet.',
      columns: [who,
        { id: 'sold', label: 'Sales', align: 'right', value: r => r.sold, cell: r => fmt.int(r.sold), sub: r => money(r.soldRev) + ' sold' },
        { id: 'total', label: isCurrent ? 'Pays now' : 'Paid', align: 'right', value: r => r.total, cell: r => el('span', { class: 'font-black' }, money(r.total)), sub: r => fmt.int(r.stubN) + ' accounts' + (r.pct != null ? ' · passed audit ' + Math.round(r.pct * 100) + '%' : '') },
        { id: 'pend', label: 'On its way', align: 'right', value: r => r.pending + r.held, cell: r => money(r.pending + r.held), sub: r => fmt.int(r.pendingN) + ' pending · ' + fmt.int(r.heldN) + ' held' },
        { id: 'backend', label: 'Building backend', align: 'right', value: r => r.backend, cell: r => money(r.backend), sub: r => fmt.int(r.backendN) + ' accounts' },
        { id: 'go', label: '', align: 'right', cell: () => el('span', { style: { color: 'var(--accent)' } }, 'Details →') }],
    }));
}

// The detail IS the live pay stub: pay-live.js reads state.payViewRepId / payYear / payPeriodId, so point those
// at the row that was clicked and render it. The stub's own rep + period pickers keep working inside.
function dashpOfficeDetailView(S) {
  const d = S.detail;
  if (dashpOfficeCanSeeAll()) state.payViewRepId = d.id;
  if (d.year) state.payYear = d.year;
  if (d.period) state.payPeriodId = Number(d.period);
  if (typeof viewPayLive !== 'function') return dashpNotice('The pay stub is not available in this build.');
  try { return viewPayLive(); } catch (e) { console.warn('[commissions] office detail', e); return dashpNotice('The pay stub hit an error: ' + (e.message || e)); }
}
