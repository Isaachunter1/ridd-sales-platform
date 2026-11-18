// ┌─ dashp/d2d ───────────────────────────────────────────────────────────────
// │ COMMISSIONS → Sales Reps (door-to-door). Same pattern as technicians.js,
// │ but a sales rep's result is for a whole YEAR, and DASHP keeps up to three
// │ versions of it (the top bar's Version select):
// │   live    the running calculation      pinned   a held snapshot
// │   final   the closed-out year
// │ Two screens, both read-only:
// │   dashpD2dList         one row per rep for the year. A row opens the detail.
// │   dashpD2dDetailView   one rep: the payout waterfall, commission by
// │                        category, audits, multi-year, and every sale.
// │ Data: dashp/api.js (dashpLoad, dashpD2dDetail). Pieces: dashp/ui.js.
// └────────────────────────────────────────────────────────────────────────

function dashpD2dList(S) {
  const type = S.d2dType || 'live';
  const slot = dashpLoad('d2d-commissions?year=' + S.year + '&type=' + type);
  if (slot.status === 'loading') return dashpNotice('Loading ' + S.year + ' sales rep commissions…');
  if (slot.status === 'error') return dashpNotice(slot.error);
  const data = dashpObj(slot.data), sum = dashpObj(data.summary), rows = dashpArr(data.rows);
  const pct = (v) => (v == null ? '—' : fmt.pct(v));
  const offices = [...new Set(rows.map(r => r.office_name || 'Unassigned'))].sort();
  return el('div', { class: 'flex flex-col gap-4' },
    dashpStatRow(
      dashpStat('Sales reps', fmt.int(sum.rep_count), S.year + ' · ' + type),
      dashpStat('Sales', fmt.int(sum.total_sales), fmt.int(sum.qualified_sales) + ' qualified · ' + fmt.int(sum.cancels) + ' cancels'),
      dashpStat('Qualified revenue', fmt.usd0(sum.qualified_revenue), fmt.usd0(sum.total_revenue) + ' sold'),
      dashpStat('Expected commission', fmt.usd0(sum.expected_commission), 'before deductions'),
      dashpStat('Final commission', fmt.usd0(sum.final_commission), 'after deductions'),
      dashpStat('Audit pass rate', pct(sum.audit_pass_percent), fmt.int(sum.audits_failed) + ' failed of ' + fmt.int(sum.audits_total))),
    dashpTable(S, 'd2d-list', {
      title: 'Sales reps · ' + S.year, rows, defaultSort: { id: 'final', dir: 'desc' },
      search: r => [r.name, r.employee_id, r.office_name].join(' '), placeholder: 'Search name, ID, or office',
      // One pill per home office (reps with none are "Unassigned").
      filters: offices.length > 1 ? [['all', 'All'], ...offices.map(o => [o, o, r => (r.office_name || 'Unassigned') === o])] : null,
      onRow: r => { S.detail = { kind: 'd2d', id: r.employee_id, name: r.name, year: S.year, type }; mountApp(); },
      empty: 'No sales rep commissions for ' + S.year + ' (' + type + ') yet.',
      columns: [
        { id: 'name', label: 'Sales rep', value: r => r.name, cell: r => el('span', { class: 'font-semibold' }, r.name || '—'), sub: r => '#' + r.employee_id + ' · ' + (r.office_name || 'Unassigned') },
        { id: 'sales', label: 'Sales', align: 'right', value: r => r.total_sales, cell: r => fmt.int(r.total_sales), sub: r => fmt.int(r.qualified_sales) + ' qualified' },
        { id: 'cancels', label: 'Cancels', align: 'right', value: r => r.cancels, cell: r => fmt.int(r.cancels) },
        { id: 'mix', label: 'Pest / Bundle / Anc.', align: 'right', value: r => r.pest_sales, cell: r => fmt.int(r.pest_sales) + ' / ' + fmt.int(r.bundle_sales) + ' / ' + fmt.int(r.ancillary_sales) },
        { id: 'rev', label: 'Qualified revenue', align: 'right', value: r => r.qualified_revenue, cell: r => fmt.usd0(r.qualified_revenue), sub: r => fmt.usd0(r.total_revenue) + ' sold' },
        { id: 'expected', label: 'Expected', align: 'right', value: r => r.expected_commission, cell: r => fmt.usd0(r.expected_commission) },
        { id: 'my', label: 'Multi-year', align: 'right', value: r => r.multi_year_adjustment, cell: r => (dashpNum(r.multi_year_adjustment) ? dashpMoney(r.multi_year_adjustment, true) : '—') },
        { id: 'auditded', label: 'Audit ded.', align: 'right', value: r => r.audit_deduction, cell: r => (dashpNum(r.audit_deduction) ? dashpMoney(-Math.abs(r.audit_deduction)) : '—') },
        { id: 'final', label: 'Final commission', align: 'right', value: r => r.final_commission, cell: r => el('span', { class: 'font-black' }, fmt.usd0(r.final_commission)) },
        { id: 'audit', label: 'Audit pass', align: 'right', value: r => r.audit_pass_percent, cell: r => pct(r.audit_pass_percent), sub: r => fmt.int(r.audits_failed) + ' failed of ' + fmt.int(r.audits_total) },
        { id: 'bal', label: 'With balance', align: 'right', value: r => r.accounts_with_balance, cell: r => fmt.int(r.accounts_with_balance) },
        { id: 'go', label: '', align: 'right', cell: () => el('span', { style: { color: 'var(--accent)' } }, 'Details →') }],
    }));
}

function dashpD2dDetailView(S) {
  const d = S.detail;
  const slot = dashpLoad('d2d-commission?employee_id=' + encodeURIComponent(d.id) + '&year=' + d.year + '&type=' + d.type);
  if (slot.status === 'loading') return dashpNotice('Loading ' + (d.name || 'sales rep') + ' · ' + d.year + '…');
  if (slot.status === 'error') return dashpNotice(slot.error);
  const data = dashpObj(slot.data), R = slot.status === 'ok' ? dashpD2dDetail(data.results) : null;
  if (!R) return dashpNotice('No ' + d.type + ' commission result for ' + (d.name || 'this rep') + ' in ' + d.year + ' yet.');
  // Each step of the waterfall is shown as what it took off (or added) on the way from Expected to Final.
  const step = (label, from, to) => dashpLine(label, null, to - from ? dashpMoney(to - from, true) : '—');
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
      el('h3', { class: 'text-base font-black' }, R.name),
      el('span', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, [d.year + ' · ' + d.type, R.office, data.last_updated ? 'calculated ' + fmt.dateMed(data.last_updated) : ''].filter(Boolean).join(' · '))),
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-3 gap-4 items-start' },
      el('div', { class: 'card p-4' },
        dashpCaption(d.year + ' · ' + d.type),
        el('div', { class: 'mt-2' }, dashpCaption('Final commission')),
        el('div', { class: 'text-3xl font-black tabular-nums mb-2' }, R.hasSteps ? fmt.usd0(R.final) : '—'),
        ...(R.hasSteps ? [
          dashpLine('Expected commission', 'before deductions', fmt.usd0(R.expected)),
          step('Attrition', R.expected, R.afterAttrition),
          step('Multi-year ' + (R.multiYearBonus ? 'bonus' : 'adjustment'), R.afterAttrition, R.afterMultiYear),
          step('Failed-audit deduction', R.afterMultiYear, R.afterAudit),
          step('Deduction table', R.afterAudit, R.final),
          dashpLine('Final commission', null, fmt.usd0(R.final), true)]
          : [dashpSub('This result was stored without its step-by-step breakdown.')])),
      el('div', { class: 'card p-4' },
        el('div', { class: 'mb-1' }, dashpCaption('Commission by category')),
        ...R.categories.map(c => dashpLine(c.label, c.soldQualified + ' of ' + c.sold + ' qualified · ' + fmt.usd0(c.qualified) + ' × ' + Math.round(c.rate * 1000) / 10 + '%', fmt.usd0(c.expected))),
        dashpLine('Qualified revenue', fmt.usd0(R.revenue) + ' sold', fmt.usd0(R.revenueQualified), true)),
      el('div', { class: 'card p-4' },
        el('div', { class: 'mb-1' }, dashpCaption('Accounts and audits')),
        dashpLine('Accounts sold', R.cancels + ' cancelled · ' + R.withBalance + ' with a balance', fmt.int(R.sold)),
        ...R.notQualified.map(x => dashpLine(x.label, 'not qualified', fmt.int(x.n))),
        dashpLine('Audits passed', R.auditsFailed + ' failed of ' + R.audits, R.auditPass == null ? '—' : fmt.pct(R.auditPass)),
        dashpLine('Multi-year share of revenue', null, R.multiYearPct == null ? '—' : fmt.pct(R.multiYearPct)))),
    dashpSalesTable(S, 'd2d-sales', R.sales, { kind: 'd2d' }));
}