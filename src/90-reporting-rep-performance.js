// ┌─ src/90-reporting-rep-performance.js ─────────────────────────────────────────────────────
// │ Reporting → rep performance tables.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// REPORTING — Rep Performance sub-tab
// ──────────────────────────────────────────────────────────────────────────
// Top-rep leaderboard with sub count, ARV, contract value, avg contract,
// plus pies for Revenue by Rep Type and Subs by Rep. Each row in the
// table opens a drill modal scoped to that rep.
function reportingRepPerformance() {
  const gate = reportingDataGate();
  if (gate) return gate;
  const scope = reportingScope();
  const { scopeA, scopeB, inCompare, office, compareOffice, officeLabel } = scope;
  const filterBar = reportingFilterBar(scope);

  const compute = (rows) => {
    const repMap = new Map();
    for (const r of rows) {
      const rep = r.sold_by || 'Unknown';
      if (!repMap.has(rep)) repMap.set(rep, { name: rep, type: r.sold_by_type || '', offices: new Set(), subs: 0, activeSubs: 0, arv: 0, activeArv: 0, contract: 0 });
      const m = repMap.get(rep);
      if (r.office_name) m.offices.add(r.office_name);
      m.subs += 1;
      const arv = Number(r.annual_recurring_value) || 0;
      m.arv += arv;
      m.contract += Number(r.subscription_contract_value) || 0;
      const isActive = (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;
      if (isActive) { m.activeSubs += 1; m.activeArv += arv; }
    }
    const reps = [...repMap.values()].sort((a, b) => b.arv - a.arv);
    return { reps };
  };

  const dataA = compute(scopeA);
  const dataB = inCompare ? compute(scopeB) : null;

  const buildLeaderboard = (data, source, side) => {
    const top = data.reps.slice(0, 20);
    const sideLabel = inCompare ? officeLabel(side === 'a' ? office : compareOffice) : null;
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'p-4 border-b', style: { borderColor: 'var(--border)' } },
        sideLabel && el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--accent)' } }, sideLabel),
        el('h2', { class: 'text-lg font-bold' }, 'Top Reps by ARV'),
        el('p', { class: 'text-xs text-muted- mt-0.5' }, 'Click a row to see that rep’s subs'),
      ),
      el('div', { class: 'overflow-x-auto' },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
            el('tr', {},
              el('th', { class: 'text-left px-3 py-2 font-semibold w-8' }, '#'),
              el('th', { class: 'text-left px-3 py-2 font-semibold' }, 'Rep'),
              el('th', { class: 'text-left px-3 py-2 font-semibold' }, 'Type'),
              el('th', { class: 'text-left px-3 py-2 font-semibold' }, 'Office'),
              el('th', { class: 'text-right px-3 py-2 font-semibold' }, 'Subs Serviced'),
              el('th', { class: 'text-right px-3 py-2 font-semibold' }, 'Subs Active'),
              el('th', { class: 'text-right px-3 py-2 font-semibold' }, 'Rev Serviced'),
              el('th', { class: 'text-right px-3 py-2 font-semibold' }, 'Rev Active'),
              el('th', { class: 'text-right px-3 py-2 font-semibold' }, 'ACV'),
            ),
          ),
          el('tbody', {},
            ...top.map((r, i) => el('tr', {
              class: 'border-t cursor-pointer hover:brightness-95 transition',
              style: { borderColor: 'var(--border)' },
              onclick: () => openReportingDrillModal({
                chartTitle: inCompare ? 'Rep Performance · ' + (sideLabel || '') : 'Rep Performance',
                sliceLabel: r.name,
                rows: source.filter(row => (row.sold_by || 'Unknown') === r.name),
                formatValue: fmt.usd0,
              }),
            },
              el('td', { class: 'px-3 py-2 text-muted- tabular-nums' }, '#' + (i + 1)),
              el('td', { class: 'px-3 py-2 font-medium' }, r.name),
              el('td', { class: 'px-3 py-2 text-muted-' }, r.type || '—'),
              el('td', { class: 'px-3 py-2 text-muted-' }, [...r.offices].join(', ') || '—'),
              el('td', { class: 'px-3 py-2 text-right tabular-nums' }, r.subs.toLocaleString()),
              el('td', { class: 'px-3 py-2 text-right tabular-nums' }, r.activeSubs.toLocaleString()),
              el('td', { class: 'px-3 py-2 text-right tabular-nums font-semibold' }, '$' + Math.round(r.arv).toLocaleString()),
              el('td', { class: 'px-3 py-2 text-right tabular-nums' }, '$' + Math.round(r.activeArv).toLocaleString()),
              el('td', { class: 'px-3 py-2 text-right tabular-nums' }, '$' + Math.round(r.subs ? r.contract / r.subs : 0).toLocaleString()),
            )),
          ),
        ),
      ),
    );
  };

  const leaderboards = inCompare
    ? el('div', { class: 'grid gap-4', style: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
        buildLeaderboard(dataA, scopeA, 'a'),
        buildLeaderboard(dataB, scopeB, 'b'))
    : buildLeaderboard(dataA, scopeA, 'a');

  return el('div', { class: 'flex flex-col gap-4' }, filterBar, leaderboards);
}

// ──────────────────────────────────────────────────────────────────────────
// REPORTING — Waterfall Attrition sub-tab
// ──────────────────────────────────────────────────────────────────────────
// Cohort retention matrix. Rows depend on mode (initial-service year /
// agreement-length tier / rep), columns are calendar years from the
// earliest sold sub to today, cells are count or ARV of cohort still
// active at year-end. Cells are color-coded by retention % so trends
// pop visually.
function buildReportingWaterfall(rows, mode, cohortYear) {
  const today = new Date();
  // Consistency with Overview + Geographic attrition: cohort retention counts
  // RECURRING subs only (one-time subs don't "retain"), and a cancellation
  // whose reason is config-excluded from attrition is treated as NOT churn —
  // the sub stays retained in the cohort. _effCancel is the effective cancel
  // date (null when there's no real-attrition cancel).
  const recurringByName = reportingServiceRecurringMap();
  const excludedReasons = reportingExcludedCancelReasons();
  rows = rows
    .filter(r => !!recurringByName.get(r.subscription))
    .filter(r => !!r.initial_service)   // retention starts at first service — unserviced subs can't retain (they used to pad Totals without ever appearing in a year column)
    .map(r => {
      const realCancel = r.subscription_date_canceled
        && !excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r)))
        && !(reportingExcludeRorChurn() && _reporting3dayRor(r))   // same ROR setting as Overview/Geographic attrition
        ? r.subscription_date_canceled : null;
      // A renewal continuation keeps the relationship's ORIGINAL first-service
      // date, so cohorts and tenure don't restart when a customer changes plans.
      return { ...r, initial_service: r.origin_initial_service || r.initial_service, _effCancel: realCancel };
    });
  const initYears = rows
    .map(r => r.initial_service ? new Date(r.initial_service + 'T00:00').getFullYear() : null)
    .filter(y => y && !Number.isNaN(y));
  if (initYears.length === 0) return { rowDefs: [], years: [], allYears: [], cohorted: false };
  const allYears = [...new Set(initYears)].sort((a, b) => a - b);
  // COHORT MODE (Contract Length / Rep): restrict the population to subs
  // whose initial service landed in the picked year, then follow exactly
  // that cohort across the columns — a true retention curve. Without it,
  // those modes mix new sales into every column (book size, not decay).
  const cohorted = !!cohortYear && cohortYear !== 'all' && (mode === 'contract' || mode === 'rep');
  if (cohorted) {
    const cy = Number(cohortYear);
    rows = rows.filter(r => r.initial_service && new Date(r.initial_service + 'T00:00').getFullYear() === cy);
  }
  const minYear = cohorted ? Number(cohortYear) : Math.min(...initYears);
  const maxYear = today.getFullYear();
  const years = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  // Determine row dimension based on mode.
  let rowIds = [];
  let rowFilter = () => () => false;
  if (mode === 'subscription' || mode === 'arv') {
    rowIds = [...new Set(initYears)].sort((a, b) => a - b);
    rowFilter = (id) => (r) => r.initial_service
      && new Date(r.initial_service + 'T00:00').getFullYear() === id;
  } else if (mode === 'contract') {
    // 12/18/24 are the real products. Every other length (odd values that
    // need CRM cleanup, legacy long terms) buckets into Other.
    const CORE_LENS = [12, 18, 24];
    const hasOther = rows.some(r => { const n = Number(r.agreement_length) || 0; return n > 0 && !CORE_LENS.includes(n); });
    rowIds = hasOther ? [...CORE_LENS, 'other'] : CORE_LENS.slice();
    rowFilter = (id) => id === 'other'
      ? (r) => { const n = Number(r.agreement_length) || 0; return n > 0 && !CORE_LENS.includes(n); }
      : (r) => (Number(r.agreement_length) || 0) === id;
  } else if (mode === 'rep') {
    const repCounts = new Map();
    for (const r of rows) {
      const rep = r.sold_by;
      if (!rep) continue;
      repCounts.set(rep, (repCounts.get(rep) || 0) + 1);
    }
    rowIds = [...repCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([rep]) => rep);
    rowFilter = (id) => (r) => r.sold_by === id;
  }

  // Cell value: count or sum of ARV of rows in this row's bucket that
  // were sold on/before yearEnd AND not canceled before yearEnd.
  const cellAggregate = mode === 'arv'
    ? (rs) => rs.reduce((s, r) => s + (Number(r.annual_recurring_value) || 0), 0)
    : (rs) => rs.length;

  const rowDefs = rowIds.map(id => {
    const rowRows = rows.filter(rowFilter(id));
    const total = cellAggregate(rowRows);
    const byYear = {};
    for (const y of years) {
      const yearEnd = y + '-12-31';
      const active = rowRows.filter(r =>
        r.initial_service && r.initial_service <= yearEnd
        && (!r._effCancel || r._effCancel > yearEnd)
      );
      byYear[y] = cellAggregate(active);
    }
    return { id, total, byYear, rowRows };
  });
  // (returned below with allYears + cohorted so the UI can build the picker
  // and color against the true cohort size)

  return { rowDefs, years, allYears, cohorted };
}

// ── COMMISSION CALCULATOR ────────────────────────────────────────────────────
// Backend commission breakdown for a FieldRoutes SALES REP, computed from the
// live CRM snapshot: revenue split into Pest / Bundle / Ancillary (via the
// configurable service map) × each rep's negotiated rates, a multi-year
// bonus/penalty, manual deductions, and the account/attrition stats. Mirrors
// the Excel "Backend Breakdown" sheet.

// Per-rep manual inputs (overrides + deductions + pay periods) live in the
// SHARED commission config (keyed by CRM employee id) so the rep's own pay view
// shows the same numbers the admin entered.
function commissionManual(empId) { return commissionConfig().manual[empId] || {}; }
function setCommissionManual(empId, obj) { const c = commissionConfig(); c.manual = Object.assign({}, c.manual); c.manual[empId] = obj; saveCommissionConfig(c); }

