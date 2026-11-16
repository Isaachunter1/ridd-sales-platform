// ┌─ dashp/technicians ───────────────────────────────────────────────────────
// │ COMMISSIONS → Technicians. Two screens, both read-only:
// │   dashpTechList    one row per technician for a year — pick a quarter to
// │                    see that quarter's numbers, or "Full year" for the year
// │                    totals with a Q1–Q4 column each. A row (or a quarter
// │                    cell) opens the detail.
// │   dashpTechDetailView   one technician, one quarter: the payout ladder,
// │                    sales volume, deductions, and every sale — qualified or
// │                    not, why, and whether the upfront advance was paid.
// │ Data: dashp/api.js (dashpLoad, dashpTechDetail). Pieces: dashp/ui.js.
// │ To change WHAT a table shows, edit its `columns` list below — each column
// │ is one line: a header, what the cell prints, and what it sorts by.
// └────────────────────────────────────────────────────────────────────────

// The quarter shown when none is picked: this quarter if it has results, else the latest one that does.
function dashpTechDefaultQuarter(summary, year) {
  const bq = dashpArr(summary && summary.by_quarter), now = new Date();
  const has = (q) => dashpNum(dashpObj(bq[q - 1]).technician_count) > 0;
  const cur = Math.floor(now.getMonth() / 3) + 1;
  if (year === now.getFullYear() && has(cur)) return cur;
  for (let q = 4; q >= 1; q--) if (has(q)) return q;
  return 'year';
}

function dashpTechList(S) {
  const slot = dashpLoad('technician-commissions?year=' + S.year);
  if (slot.status === 'loading') return dashpNotice('Loading ' + S.year + ' technician commissions…');
  if (slot.status === 'error') return dashpNotice(slot.error);
  const data = dashpObj(slot.data), sum = dashpObj(data.summary), rows = dashpArr(data.rows);
  const q = S.techQuarter != null ? S.techQuarter : dashpTechDefaultQuarter(sum, S.year);
  S.techQuarterShown = q;   // the top bar's Quarter select reads this
  const open = (r, quarter) => { S.detail = { kind: 'tech', id: r.employee_id, name: r.name, year: S.year, quarter }; mountApp(); };
  const who = { id: 'name', label: 'Technician', value: r => r.name, cell: r => el('span', { class: 'font-semibold' }, r.name || '—'),
    sub: r => '#' + r.employee_id + (r.eligible === false ? ' · not eligible' : '') };
  const search = r => r.name + ' ' + r.employee_id;

  if (q === 'year') {
    // One quarter's net payout as a link into that quarter's detail (a dash when the quarter has no result yet).
    const qCol = (n) => ({ id: 'q' + n, label: 'Q' + n + ' net', align: 'right', value: r => r['q' + n + '_net_payout'],
      cell: r => (r['q' + n + '_net_payout'] == null ? '—' : el('button', { class: 'font-semibold tabular-nums', style: { color: 'var(--accent)' }, onclick: () => open(r, n) }, fmt.usd0(r['q' + n + '_net_payout']))) });
    return el('div', { class: 'flex flex-col gap-4' },
      dashpStatRow(
        dashpStat('Technicians', fmt.int(sum.technician_count), S.year + ' · full year'),
        dashpStat('Sales', fmt.int(sum.total_sales), fmt.int(sum.qualified_sales) + ' qualified'),
        dashpStat('Qualified contract value', fmt.usd0(sum.qualified_dollars), fmt.usd0(sum.total_dollars) + ' sold'),
        dashpStat('Gross commission', fmt.usd0(sum.gross_commission)),
        dashpStat('Already paid', dashpMoney(-Math.abs(dashpNum(sum.already_paid))), 'upfront advances'),
        dashpStat('Clawbacks', dashpMoney(-Math.abs(dashpNum(sum.clawbacks)))),
        dashpStat('Net payout', fmt.usd0(sum.net_payout))),
      dashpTable(S, 'tech-year', {
        title: 'Technicians · ' + S.year, rows, search, placeholder: 'Search name or ID', defaultSort: { id: 'net', dir: 'desc' }, empty: 'No technician commissions for ' + S.year + ' yet.',
        columns: [who,
          { id: 'sales', label: 'Sales', align: 'right', value: r => r.total_sales, cell: r => fmt.int(r.total_sales), sub: r => fmt.int(r.qualified_sales) + ' qualified' },
          { id: 'split', label: 'Personal / Upsell', align: 'right', value: r => r.personal_sales, cell: r => fmt.int(r.personal_sales) + ' / ' + fmt.int(r.upsell_sales) },
          { id: 'qd', label: 'Qualified CV', align: 'right', value: r => r.qualified_dollars, cell: r => fmt.usd0(r.qualified_dollars), sub: r => fmt.usd0(r.total_dollars) + ' sold' },
          { id: 'gross', label: 'Gross', align: 'right', value: r => r.gross_commission, cell: r => fmt.usd0(r.gross_commission) },
          { id: 'paid', label: 'Already paid', align: 'right', value: r => r.already_paid, cell: r => dashpMoney(-Math.abs(dashpNum(r.already_paid))) },
          { id: 'claw', label: 'Clawbacks', align: 'right', value: r => r.clawbacks, cell: r => dashpMoney(-Math.abs(dashpNum(r.clawbacks))) },
          { id: 'net', label: 'Net payout', align: 'right', value: r => r.net_payout, cell: r => el('span', { class: 'font-black' }, fmt.usd0(r.net_payout)) },
          qCol(1), qCol(2), qCol(3), qCol(4)],
      }));
  }

  const p = 'q' + q + '_', bq = dashpObj(dashpArr(sum.by_quarter)[q - 1]);
  const hasQ = r => r[p + 'net_payout'] != null;
  return el('div', { class: 'flex flex-col gap-4' },
    dashpStatRow(
      dashpStat('Technicians', fmt.int(bq.technician_count), 'with a Q' + q + ' ' + S.year + ' result'),
      dashpStat('Sales', fmt.int(bq.total_sales), fmt.int(bq.qualified_sales) + ' qualified'),
      dashpStat('Qualified contract value', fmt.usd0(bq.qualified_dollars), fmt.usd0(bq.total_dollars) + ' sold'),
      dashpStat('Gross commission', fmt.usd0(bq.gross_commission)),
      dashpStat('Net payout', fmt.usd0(bq.net_payout), 'Q' + q + ' ' + S.year)),
    dashpTable(S, 'tech-q', {
      title: 'Technicians · Q' + q + ' ' + S.year, rows, search, placeholder: 'Search name or ID', defaultSort: { id: 'net', dir: 'desc' },
      // A technician with no result for this quarter is hidden until "Everyone" is picked (their cells are dashes).
      filters: [['has', 'With a Q' + q + ' result', hasQ], ['all', 'Everyone']], defaultFilter: 'has',
      onRow: r => open(r, q), canOpen: hasQ, empty: 'No technician commissions for Q' + q + ' ' + S.year + ' yet.',
      columns: [who,
        { id: 'sales', label: 'Sales', align: 'right', value: r => r[p + 'total_sales'], cell: r => (hasQ(r) ? fmt.int(r[p + 'total_sales']) : '—'), sub: r => (hasQ(r) ? fmt.int(r[p + 'qualified_sales']) + ' qualified' : '') },
        { id: 'qd', label: 'Qualified CV', align: 'right', value: r => r[p + 'qualified_dollars'], cell: r => (hasQ(r) ? fmt.usd0(r[p + 'qualified_dollars']) : '—') },
        { id: 'net', label: 'Q' + q + ' net payout', align: 'right', value: r => r[p + 'net_payout'], cell: r => el('span', { class: 'font-black' }, hasQ(r) ? fmt.usd0(r[p + 'net_payout']) : '—') },
        { id: 'ytd', label: S.year + ' net', align: 'right', value: r => r.net_payout, cell: r => fmt.usd0(r.net_payout), sub: r => dashpNum(r.quarters_computed) + ' quarter' + (dashpNum(r.quarters_computed) === 1 ? '' : 's') },
        { id: 'go', label: '', align: 'right', cell: r => (hasQ(r) ? el('span', { style: { color: 'var(--accent)' } }, 'Details →') : '') }],
    }));
}

function dashpTechDetailView(S) {
  const d = S.detail, period = 'Q' + d.quarter + ' ' + d.year;
  const slot = dashpLoad('technician-commission?employee_id=' + encodeURIComponent(d.id) + '&year=' + d.year + '&quarter=' + d.quarter);
  if (slot.status === 'loading') return dashpNotice('Loading ' + (d.name || 'technician') + ' · ' + period + '…');
  if (slot.status === 'error') return dashpNotice(slot.error);
  const data = dashpObj(slot.data), R = slot.status === 'ok' ? dashpTechDetail(data.results) : null;
  if (!R) return dashpNotice('No commission result for ' + (d.name || 'this technician') + ' in ' + period + ' yet.');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].slice((d.quarter - 1) * 3, d.quarter * 3).join(' · ');
  const vol = (label, v) => dashpLine(label, v.q + ' of ' + v.n + ' qualified', el('div', {}, el('div', {}, fmt.usd0(v.qDollars)), dashpSub(fmt.usd0(v.dollars) + ' total')));
  const jobs = (n) => n + ' job' + (n === 1 ? '' : 's');
  const paidJobs = R.paid.months.reduce((a, m) => a + m.jobs, 0);
  const manualLabel = R.manual.total < 0 ? 'Manual credits' : 'Manual deductions';
  const adjRows = (rows, sign) => () => el('div', {}, ...rows.map(a => el('div', { class: 'flex items-start justify-between gap-3 py-1.5 border-t text-[11px]', style: { borderColor: 'var(--border)' } },
    el('div', {}, el('div', { class: 'font-semibold' }, a.customer + (a.customerId ? ' #' + a.customerId : '')),
      dashpSub([a.subscription, a.soldIn ? 'sold ' + a.soldIn : '', a.reason, a.contract ? 'CV ' + fmt.usd0(a.contract) : ''].filter(Boolean).join(' · '))),
    el('div', { class: 'tabular-nums font-semibold text-right shrink-0' }, el('div', {}, dashpMoney(sign * Math.abs(a.amount), true)), a.basis ? dashpSub(a.basis) : null))));
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
      el('h3', { class: 'text-base font-black' }, R.name + (R.eligible ? '' : ' · not eligible')),
      el('span', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, period + ' · ' + months + (data.computed_at ? ' · calculated ' + fmt.dateMed(data.computed_at) : ''))),
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-3 gap-4 items-start' },
      // The ladder is DASHP's own: gross − upfront advances − clawbacks + reverse clawbacks − manual = net.
      el('div', { class: 'card p-4' },
        dashpCaption(period + ' · ' + Math.round(R.rate * 100) + '% commission'),
        el('div', { class: 'mt-2' }, dashpCaption('Expected net payout')),
        el('div', { class: 'text-3xl font-black tabular-nums mb-2' }, fmt.usd0(R.net)),
        dashpLine('Gross commission', null, fmt.usd0(R.gross)),
        dashpLine('Upfront advances already paid', null, dashpMoney(-Math.abs(R.paid.total))),
        dashpLine('Clawbacks', null, dashpMoney(-Math.abs(R.clawbacks.total))),
        R.reverse.total ? dashpLine('Reverse clawbacks', null, dashpMoney(Math.abs(R.reverse.total), true)) : null,
        R.manual.total ? dashpLine(manualLabel, null, dashpMoney(-R.manual.total, true)) : null,
        dashpLine('Net payout', null, fmt.usd0(R.net), true)),
      el('div', { class: 'card p-4' },
        el('div', { class: 'mb-1' }, dashpCaption('Sales volume')),
        vol('Total', R.total), vol('Personal', R.personal), vol('Upsells', R.upsells)),
      el('div', { class: 'card p-4' },
        el('div', { class: 'mb-1' }, dashpCaption('Commission')),
        dashpLine('Personal sales', null, fmt.usd0(R.personalGross)),
        dashpLine('Upsells', null, fmt.usd0(R.upsellGross)),
        dashpLine('Gross commission', Math.round(R.rate * 100) + '% of qualified contract value', fmt.usd0(R.gross), true))),
    el('div', { class: 'flex flex-col gap-2' },
      dashpCaption('Deduction breakdown'),
      dashpExpand(S, 'tech-paid', 'Already paid', R.paid.months.length ? dashpMoney(-Math.abs(R.paid.total)) + ' (' + jobs(paidJobs) + ')' : 'No upfront advances this quarter',
        R.paid.months.length ? () => el('div', {}, ...R.paid.months.map(m => dashpLine(m.label, jobs(m.jobs), dashpMoney(-Math.abs(m.amount))))) : null),
      dashpExpand(S, 'tech-claw', 'Clawbacks', R.clawbacks.rows.length ? dashpMoney(-Math.abs(R.clawbacks.total)) + ' (' + jobs(R.clawbacks.rows.length) + ')' : 'None carried into this quarter',
        R.clawbacks.rows.length ? adjRows(R.clawbacks.rows, -1) : null),
      R.reverse.rows.length ? dashpExpand(S, 'tech-rev', 'Reverse clawbacks', dashpMoney(Math.abs(R.reverse.total), true) + ' (' + jobs(R.reverse.rows.length) + ')', adjRows(R.reverse.rows, 1)) : null,
      R.manual.rows.length ? dashpExpand(S, 'tech-manual', manualLabel, dashpMoney(-R.manual.total, true) + ' (' + R.manual.rows.length + ' item' + (R.manual.rows.length === 1 ? '' : 's') + ')',
        () => el('div', {}, ...R.manual.rows.map(m => dashpLine(m.title, m.note, dashpMoney(-m.amount, true))))) : null),
    dashpSalesTable(S, 'tech-sales', R.sales, { kind: 'tech' }));
}