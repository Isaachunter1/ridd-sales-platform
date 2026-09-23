// ┌─ src/82-reporting-overview.js ─────────────────────────────────────────────────────
// │ Reporting → Overview cards and charts.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function reportingOverview() {
  const gate = reportingDataGate();
  if (gate) return gate;

  const scope = reportingScope();
  const { office, compareOffice, inCompare, scopeA, scopeB, officeLabel } = scope;
  const dataA = reportingChartData(scopeA, state.reportingServiceConfig || []);
  const dataB = inCompare ? reportingChartData(scopeB, state.reportingServiceConfig || []) : null;
  const filterBar = reportingFilterBar(scope);

  // ── Stat tiles (single mode) or comparison table (compare mode) ─────
  const statTile = (label, value, sub) => el('div', { class: 'card p-4 flex-1', style: { minWidth: '180px' } },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-2xl font-bold mt-1 tabular-nums' }, value),
    sub && el('div', { class: 'text-[11px] text-muted- mt-1' }, sub),
  );

  // Comparison row — same label on both sides plus a "diff" column. The
  // diff is signed % change from A to B so the reader can see at a glance
  // which office is leading on each metric.
  const diffPct = (a, b) => {
    if (!a) return b ? '+∞' : '0%';
    const d = ((b - a) / a) * 100;
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
  };
  const diffColor = (a, b, higherIsBetter = true) => {
    if (a === b) return 'var(--text-muted)';
    const better = higherIsBetter ? (b > a) : (b < a);
    return better ? '#DF643A' : '#dc2626';
  };
  const compareRow = (label, valA, valB, formatter, higherIsBetter = true, sub) => el('div', {
    class: 'grid items-center py-2.5 px-4 text-sm border-t',
    style: { borderColor: 'var(--border)', gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr' },
  },
    el('div', { class: 'font-medium' },
      el('div', {}, label),
      sub && el('div', { class: 'text-[10px] text-muted-' }, sub),
    ),
    el('div', { class: 'tabular-nums text-right' }, formatter(valA)),
    el('div', { class: 'tabular-nums text-right' }, formatter(valB)),
    el('div', { class: 'tabular-nums text-right font-bold', style: { color: diffColor(valA, valB, higherIsBetter) } }, diffPct(valA, valB)),
  );

  const statsBlock = inCompare
    ? el('div', { class: 'card overflow-hidden' },
        el('div', {
          class: 'grid items-center px-4 py-2 text-[10px] uppercase tracking-widest font-semibold',
          style: { background: 'var(--card-2)', color: 'var(--text-muted)', gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr' },
        },
          el('div', {}, 'Metric'),
          el('div', { class: 'text-right' }, officeLabel(office)),
          el('div', { class: 'text-right' }, officeLabel(compareOffice)),
          el('div', { class: 'text-right' }, 'Δ'),
        ),
        compareRow('Subscriptions Serviced', dataA.stats.servicedSubs != null ? dataA.stats.servicedSubs : dataA.stats.subs, dataB.stats.servicedSubs != null ? dataB.stats.servicedSubs : dataB.stats.subs, (n) => n.toLocaleString()),
        compareRow('Active Recurring',  dataA.stats.activeRecurring, dataB.stats.activeRecurring, (n) => n.toLocaleString()),
        compareRow('Active ARV',        dataA.stats.activeArr,       dataB.stats.activeArr,       (n) => '$' + Math.round(n).toLocaleString()),
        compareRow('Unique Customers',  dataA.stats.uniqueCustomers, dataB.stats.uniqueCustomers, (n) => n.toLocaleString()),
        // For cancellations, lower is better — flip the color logic so
        // the lower-cancellation office reads as the winner (green).
        compareRow('Cancellations',     dataA.stats.realCancels,     dataB.stats.realCancels,     (n) => n.toLocaleString(), false, 'Recurring subs only'),
        compareRow('Cancellation Rate', dataA.stats.cancelRate,      dataB.stats.cancelRate,      (n) => n.toFixed(2) + '%', false),
      )
    : null; // single mode renders the popped column-header cards below

  // ── Charts ──────────────────────────────────────────────────────────
  // In compare mode, build a shared color map per chart so the same
  // service is the same color in both offices' pies. Outside compare
  // mode the cards fall back to palette-by-index.
  const colorMaps = inCompare ? {
    rarr:          reportingColorMap(dataA.slices.rarr,          dataB.slices.rarr),
    rarrOffice:    reportingColorMap(dataA.slices.rarrOffice,    dataB.slices.rarrOffice),
    customers:     reportingColorMap(dataA.slices.customers,     dataB.slices.customers),
    activeSubs:    reportingColorMap(dataA.slices.activeSubs,    dataB.slices.activeSubs),
    serviced:      reportingColorMap(dataA.slices.serviced,      dataB.slices.serviced),
    aging:         reportingColorMap(dataA.slices.aging,         dataB.slices.aging),
    pastDueOffice: reportingColorMap(dataA.slices.pastDueOffice, dataB.slices.pastDueOffice),
    tenure:        reportingColorMap(dataA.slices.tenure,        dataB.slices.tenure),
    agreement:     reportingColorMap(dataA.slices.agreement,     dataB.slices.agreement),
    cancels:       reportingColorMap(dataA.slices.cancels,       dataB.slices.cancels),
    sources:       reportingColorMap(dataA.slices.sources,       dataB.slices.sources),
    onetimeSubs:   reportingColorMap(dataA.slices.onetimeSubs,   dataB.slices.onetimeSubs),
    onetimeRev:    reportingColorMap(dataA.slices.onetimeRev,    dataB.slices.onetimeRev),
    retiredSubs:   reportingColorMap(dataA.slices.retiredSubs,   dataB.slices.retiredSubs),
  } : {};

  // Each chart definition fired through both offices when in compare mode.
  const chartDefs = [
    { id: 'rarr',       title: 'Recurring Annual Value by Service', subline: 'Sum of Annual Recurring Value · active subs',           totalLabel: 'Active ARV',          formatValue: fmt.usd0, sliceKey: 'rarr',
      footer: (d) => ({
        label: '🧮 Combine service types → total ARR',
        onClick: () => openReportingArrCombineModal(d, 'Recurring Annual Value by Service'),
      }) },
    { id: 'rarrOffice', title: 'Recurring Annual Value by Office',  subline: 'Sum of Annual Recurring Value · active subs',           totalLabel: 'Active ARV',          formatValue: fmt.usd0, sliceKey: 'rarrOffice' },
    { id: 'activesubs', title: 'Subscriptions Active',     subline: 'Currently in service · by subscription type',           totalLabel: 'Subscriptions active',         sliceKey: 'activeSubs' },
    // Receivables — one card, two lenses (per Isaac, Sep 2026): every
    // customer's real balance by AGE (Current → 90+), or the past-due
    // portion (31+ days) by OFFICE. Same dollars either way; the office
    // view is the aging donut minus its Current slice.
    { id: 'aging',      title: 'Receivables',
      subline: (d) => state._rtArView === 'office'
        ? 'Past due (31+ days) by office \u00b7 $' + Math.round(d.stats.pastDueAmount).toLocaleString() + ' past due \u00b7 ' + d.stats.pastDuePct.toFixed(1) + '% of $' + Math.round(d.stats.totalAR).toLocaleString() + ' AR'
        : 'Customer balances by age \u00b7 $' + Math.round(d.stats.totalAR).toLocaleString() + ' total AR \u00b7 ' + d.stats.pastDueCount.toLocaleString() + ' past due (31+ days)',
      totalLabel: state._rtArView === 'office' ? 'Past due $' : 'Total AR', formatValue: fmt.usd0,
      sliceKey: state._rtArView === 'office' ? 'pastDueOffice' : 'aging', preserveOrder: state._rtArView !== 'office',
      headerRight: () => el('div', { class: 'inline-flex shrink-0', style: { border: '1px solid var(--border-2)' } },
        ...[['age', 'By age'], ['office', 'By office']].map(([v, l]) => el('button', {
          class: 'px-2 py-0.5 text-[10px] font-bold transition hover:brightness-95',
          style: (state._rtArView || 'age') === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card)', color: 'var(--text-muted)' },
          onclick: () => { state._rtArView = v; mountApp(); },
        }, l))) },
    // Customers Active, second donut (per Isaac, Sep 2026): how deep each
    // active customer is (1 / 2 / 3+ active services) or where they are.
    { id: 'custDepth',  title: 'Services per Customer',
      subline: state._rtCustView === 'office' ? 'Distinct active customers by office' : 'Active customers by how many services they hold \u00b7 cross-sell depth',
      totalLabel: 'Active customers', sliceKey: state._rtCustView === 'office' ? 'custOffice' : 'custDepth', preserveOrder: state._rtCustView !== 'office',
      headerRight: () => el('div', { class: 'inline-flex shrink-0', style: { border: '1px solid var(--border-2)' } },
        ...[['depth', 'Depth'], ['office', 'By office']].map(([v, l]) => el('button', {
          class: 'px-2 py-0.5 text-[10px] font-bold transition hover:brightness-95',
          style: (state._rtCustView || 'depth') === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card)', color: 'var(--text-muted)' },
          onclick: () => { state._rtCustView = v; mountApp(); },
        }, l))) },
    { id: 'tenure',     title: 'Customer Tenure',          subline: 'Subs by years since initial service',                    totalLabel: 'Subs',                sliceKey: 'tenure',    preserveOrder: true },
    { id: 'agreement',  title: 'Agreement Length Mix',     subline: 'Distribution by contract length (months)',               totalLabel: 'Subs w/ term',        sliceKey: 'agreement', preserveOrder: true },
    { id: 'cancels',    title: 'Cancellation Reasons',     subline: 'All canceled recurring subs',                            totalLabel: 'Cancellations',       sliceKey: 'cancels' },
    { id: 'sources',    title: 'Subscription Sources',     subline: 'Distribution of every visible subscription',             totalLabel: 'Subscriptions',       sliceKey: 'sources' },
    { id: 'onetimeSubs', title: 'One-Time Subscriptions',  subline: state._rtOneTimeRev ? 'Contract value of non-recurring subs that received an initial service \u00b7 by service \u00b7 = Attrition Steps one-time step' : 'Non-recurring subs that received an initial service \u00b7 by service type \u00b7 = Attrition Steps one-time step', totalLabel: state._rtOneTimeRev ? 'One-time revenue' : 'One-time subs', sliceKey: state._rtOneTimeRev ? 'onetimeRev' : 'onetimeSubs', formatValue: state._rtOneTimeRev ? fmt.usd0 : undefined,
      // Count ⇄ revenue toggle (per Isaac) — one card, two lenses.
      headerRight: () => el('div', { class: 'inline-flex shrink-0', style: { border: '1px solid var(--border-2)' } },
        ...[[false, 'Subs'], [true, 'Revenue']].map(([v, l]) => el('button', {
          class: 'px-2 py-0.5 text-[10px] font-bold transition hover:brightness-95',
          style: !!state._rtOneTimeRev === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card)', color: 'var(--text-muted)' },
          onclick: () => { state._rtOneTimeRev = v; mountApp(); },
        }, l))),
      // Inspect link → active subs that data-hygiene flags as "should be
      // closed" (config-driven lifecycle rules in the Configurations tab).
      footer: (d) => {
        const flagged = (d.drill?.flaggedActive?.source) || [];
        if (!flagged.length) {
          return {
            label: '✓ No active subs flagged for cleanup',
            onClick: () => toast('No active subscriptions are flagged. Set service Lifecycle in Configurations to add rules.', 'info'),
          };
        }
        return {
          label: '⚑ ' + flagged.length.toLocaleString() + ' active subs likely should be closed →',
          onClick: () => openReportingDrillModal({
            chartTitle: 'Flagged — Should Be Closed',
            sliceLabel: flagged.length.toLocaleString() + ' active subs flagged by lifecycle rules',
            rows: flagged,
            formatValue: fmt.usd0,
          }),
        };
      } },
    { id: 'retiredSubs', title: 'Retired Services',        subline: 'Active subs on discontinued services · should be closed', totalLabel: 'Active retired subs', sliceKey: 'retiredSubs' },
  ];

  // Cards that only earn a slot when they have something to say (per Isaac):
  // Retired Services stays hidden until an active sub sits on a retired type.
  const _emptyHidden = new Set(['retiredSubs']);
  const _cardHidden = (def, data) => _emptyHidden.has(def.id) && !((data.slices[def.sliceKey] || []).some(sl => (sl.value || 0) > 0));
  const makeCard = (def, data, side) => _cardHidden(def, data) ? null : reportingPieCard({
    key:         def.id + '-' + side,
    title:       def.title,
    // Subline may be a function for data-aware text (e.g., aging shows
    // total sub count, past-due shows the past-due rate).
    subline:     typeof def.subline === 'function' ? def.subline(data) : def.subline,
    totalLabel:  def.totalLabel,
    formatValue: def.formatValue,
    headerRight: typeof def.headerRight === 'function' ? def.headerRight() : undefined,
    slices:      data.slices[def.sliceKey],
    officeLabel: inCompare ? officeLabel(side === 'a' ? office : compareOffice) : null,
    colorMap:    inCompare ? colorMaps[def.sliceKey] : undefined,
    preserveOrder: !!def.preserveOrder,
    // Optional bottom-of-card inspect link (e.g. "show all active one-time").
    footerAction: typeof def.footer === 'function' ? def.footer(data) : undefined,
    onSliceClick: (sliceLabel) => {
      const drill = data.drill?.[def.sliceKey];
      if (!drill) return;
      const drillRows = drill.source.filter(r => drill.key(r) === sliceLabel);
      // In compare mode, suffix the chart title with which office's rows
      // these are so the modal makes sense out of context.
      const chartTitle = inCompare
        ? def.title + ' · ' + officeLabel(side === 'a' ? office : compareOffice)
        : def.title;
      // Analysis first (per Isaac) — the raw customer table is one click
      // deeper inside the report card.
      openReportingSliceStatsModal({
        chartTitle,
        sliceLabel,
        rows: drillRows,
        siblings: data.slices[def.sliceKey],
        formatValue: def.formatValue,
      });
    },
    // "Other (N)" → BREAKDOWN FIRST (per Isaac): the smaller categories with
    // their values relative to the chart, each clickable through to accounts;
    // the combined account dump is one more click away at the bottom.
    onOtherClick: (otherLabels, otherTotal, otherSlices, overall) => {
      const drill = data.drill?.[def.sliceKey];
      if (!drill) return;
      const chartTitle = inCompare
        ? def.title + ' · ' + officeLabel(side === 'a' ? office : compareOffice)
        : def.title;
      const fmtV = def.formatValue || ((v) => fmt.int(v));
      const overlay = el('div', { class: 'modal-overlay' });
      const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
      document.addEventListener('keydown', _escClose);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      const drillTo = (label) => {
        overlay.remove();
        const rows = drill.source.filter(r => drill.key(r) === label);
        openReportingSliceStatsModal({ chartTitle, sliceLabel: label, rows, siblings: data.slices[def.sliceKey], formatValue: def.formatValue });
      };
      const maxV = otherSlices && otherSlices.length ? otherSlices[0].value : 1;
      const rowsEls = (otherSlices || []).map(s => el('div', {
        class: 'py-2 cursor-pointer rounded-lg px-2 -mx-2 transition hover:brightness-95 border-t border-',
        title: 'Click to see the accounts under "' + s.label + '"',
        onclick: () => drillTo(s.label),
      },
        el('div', { class: 'flex items-center justify-between gap-3 text-xs' },
          el('span', { class: 'font-semibold truncate' }, s.label),
          el('span', { class: 'tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } },
            fmtV(s.value) + (overall > 0 ? ' · ' + (s.value / overall * 100).toFixed(1) + '%' : ''))),
        el('div', { class: 'mt-1 rounded-full overflow-hidden', style: { height: '4px', background: 'var(--card-2)' } },
          el('div', { style: { width: Math.max(2, s.value / Math.max(1, maxV) * 100) + '%', height: '100%', background: 'var(--accent)', opacity: '.8' } }))));
      const card = el('div', { class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
        el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
          el('div', {},
            el('h2', { class: 'text-base font-bold' }, chartTitle + ' — the other ' + otherLabels.length),
            el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
              fmtV(otherTotal) + ' combined' + (overall > 0 ? ' · ' + (otherTotal / overall * 100).toFixed(1) + '% of total' : '') + ' · click a category for its accounts')),
          el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×')),
        el('div', { class: 'px-4 pb-2 overflow-y-auto' }, ...rowsEls),
        el('div', { class: 'p-4 pt-2' },
          el('button', {
            class: 'w-full rounded-xl px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
            style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
            onclick: () => {
              overlay.remove();
              const labelSet = new Set(otherLabels);
              const rows = drill.source.filter(r => labelSet.has(drill.key(r)));
              openReportingDrillModal({ chartTitle, sliceLabel: 'Other — ' + otherLabels.length + ' smaller categories', rows, formatValue: def.formatValue });
            },
          }, 'View all ' + otherLabels.length + ' combined → accounts')));
      overlay.append(card);
      document.body.append(overlay);
    },
  });

  // ── Column-header cards + aligned donuts (single mode) ───────────────
  // Each headline card pops (accent top bar, big number) and the related
  // donut sits directly beneath it so column = metric.
  // EXACT calculation breakdowns for the headline cards — these are the
  // source of truth, so they spell out every filter (lockstep with
  // reportingFilters(): isActive / isRecurring / isRealCancel).
  const scopeNote = (office === 'all'
    ? 'Scope: all offices'
    : 'Scope: ' + officeLabel(office) + ' office only')
    + (dataA.stats.subs != null ? '. Hidden service types (Configurations tab) are always excluded.' : '');
  const CARD_HELP = {
    customers: 'Distinct Customer IDs that have AT LEAST ONE active subscription. A customer with 3 active subs counts once; a customer whose subs are all Frozen/cancelled is not counted.\n\n' + scopeNote,
    subs:      'COUNT of every subscription in FieldRoutes whose initial service is marked Completed \u2014 Active AND Frozen, recurring AND one-time, BEFORE the hidden-type / excluded-source / excluded-branch rules. This is the same number as step 1 on the Retention tab and matches a raw FieldRoutes pull filtered to \u201creceived an initial service\u201d. The sub-line shows every row in the snapshot. \u201cRecurring\u201d = Annual Recurring Value > $0 (or manually flagged recurring in Configurations).\n\n' + scopeNote,
    active:    'COUNT of subscriptions that are BOTH:\n• Status = "Active" (exactly), AND\n• have NO cancellation date (a date there means frozen/lapsed),\nAND are recurring (ARV > $0 or flagged recurring). Frozen subs are excluded.\n\n' + scopeNote,
    arr:       'SUM of Annual Recurring Value across the Active recurring subscriptions above (same Active + recurring filter). Frozen and one-time subs contribute $0.\n\n' + scopeNote,
    cancels:   'COUNT of subscriptions that have a cancellation date AND are recurring (one-time cancels are NOT counted — they\'re not real attrition; 3-day RORs ARE counted). Rate = these ÷ all visible subs in scope.\n\n' + scopeNote,
  };
  // Subscriptions Serviced = the SAME number as Retention's step 1 (per
  // Isaac): everything in the snapshot with a completed initial, before the
  // hidden-type / excluded-source / excluded-branch rules — the true top of
  // the funnel that matches a raw FieldRoutes pull. Office scope still applies.
  const _topFunnel = (() => {
    const g = (typeof retenGroundZero === 'function') ? reportingFilterByOffice(retenGroundZero(), office) : null;
    if (!g) return null;
    const rows = g.filter(r => !!r.initial_service);
    return { rows, total: g.length };
  })();
  const COLUMN_CARDS = [
    { key: 'arr',       label: 'Active ARR',              value: '$' + Math.round(dataA.stats.activeArr).toLocaleString(),   sub: 'from active recurring subs',                                        chartIds: ['rarr', 'rarrOffice'] },   // (One-Time Revenue donut folded into the One-Time Subscriptions toggle)
    { key: 'subs',      label: 'Subscriptions Serviced',  value: (_topFunnel ? _topFunnel.rows.length : (dataA.stats.servicedSubs != null ? dataA.stats.servicedSubs : dataA.stats.subs)).toLocaleString(), sub: 'received an initial service \u00b7 of ' + (_topFunnel ? _topFunnel.total : dataA.stats.subs).toLocaleString() + ' in FieldRoutes \u00b7 ' + dataA.stats.recurring.toLocaleString() + ' recurring', chartIds: ['sources', 'onetimeSubs', 'retiredSubs'] },
    { key: 'active',    label: 'Subscriptions Active',    value: (reportingActiveInclOneTime() ? dataA.stats.activeSubs : dataA.stats.activeRecurring).toLocaleString(), sub: reportingActiveInclOneTime() ? 'currently in service · incl. one-time' : 'currently in service · recurring', chartIds: ['activesubs', 'agreement'] },   // (Agreement Length Mix moved here from column 1, per Isaac)
    { key: 'customers', label: 'Customers Active',        value: (dataA.stats.activeCustomers != null ? dataA.stats.activeCustomers : dataA.stats.uniqueCustomers).toLocaleString(), sub: (dataA.stats.distinctActiveServices != null ? dataA.stats.distinctActiveServices : dataA.stats.distinctServices) + ' active services', chartIds: ['custDepth', 'tenure'] },   // (Active Customers donut retired, per Isaac; Services per Customer added)
    { key: 'cancels',   label: 'Subscriptions Cancelled', value: dataA.stats.realCancels.toLocaleString(),                   sub: dataA.stats.cancelRate.toFixed(2) + '% rate · recurring subs only',  chartIds: ['cancels', 'aging'] },
  ];
  // "Other active" customers = active customers whose active subs are all
  // non-recurring (one-time). Surfaced so the user can click in + fix any
  // service that should actually be marked recurring.
  const otherActiveRows = (dataA.drill && dataA.drill.customers)
    ? dataA.drill.customers.source.filter(r => dataA.drill.customers.key(r) === 'Other active')
    : [];

  const popTile = (t, labelNode) => {
    const help = CARD_HELP[t.key];
    // The ⓘ badge carries the hover/tap calculation explainer; keeping it
    // separate from the card body so a card-level click (drill) and the
    // explainer don't fight each other.
    const info = help ? (() => {
      const b = el('span', {
        class: 'inline-flex items-center justify-center rounded-full text-[9px] font-bold ml-1',
        style: { width: '13px', height: '13px', background: 'var(--card-2)', color: 'var(--text-muted)', cursor: 'help', verticalAlign: 'middle', position: 'relative', zIndex: '2' },
      }, 'ⓘ');
      attachExplainer(b, { title: t.label, desc: help });
      return b;
    })() : null;
    const clickable = !!t.onClick;
    // Same size for every headline card (per Isaac): fixed height, one-line
    // sub text and a reserved click-hint line.
    // Phones: the WHOLE card is the dropdown — an invisible <select> sits over
    // the card so a tap anywhere opens the metric picker; only the
    // "inspect" line stays a normal drill link (it sits above the overlay).
    const asPicker = labelNode instanceof HTMLSelectElement;
    if (asPicker) Object.assign(labelNode.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', zIndex: '1', cursor: 'pointer' });
    return el('div', {
      class: 'card p-4 sm:p-5 flex flex-col' + (clickable && !asPicker ? ' cursor-pointer hover:brightness-95 transition' : ''),
      style: { height: '164px', position: asPicker ? 'relative' : undefined },
      title: clickable && !asPicker ? t.clickTitle || '' : '',
      onclick: clickable && !asPicker ? (e) => { if (e.target.closest('span[style*="cursor: help"]')) return; t.onClick(); } : undefined,
    },
      asPicker ? labelNode : null,
      el('div', { class: 'text-[10px] uppercase tracking-widest font-bold flex items-center truncate', style: { color: 'var(--text-muted)' } }, asPicker ? t.label + ' \u25be' : t.label, info),
      el('div', { class: 'font-display text-4xl mt-1.5 tabular-nums leading-none truncate' }, t.value),
      el('div', { class: 'text-[11px] text-muted- mt-2 truncate', title: t.sub || '' }, t.sub || '\u00a0'),
      el('div', { class: 'text-[10px] mt-auto font-semibold truncate', style: { color: 'var(--text-muted)', position: asPicker ? 'relative' : undefined, zIndex: asPicker ? '2' : undefined, cursor: clickable ? 'pointer' : undefined },
        onclick: clickable && asPicker ? (e) => { e.stopPropagation(); t.onClick(); } : undefined }, clickable ? (t.clickLabel || 'Click to inspect →') : '\u00a0'),
    );
  };
  // Make Customers Active drillable into its "Other active" group.
  const cardCust = COLUMN_CARDS.find(c => c.key === 'customers');
  const otherActiveCount = (((dataA.slices && dataA.slices.customers) || []).find(s => s.label === 'Other active') || {}).value || 0;
  if (cardCust && otherActiveRows.length) {
    cardCust.onClick = () => openReportingDrillModal({
      chartTitle: 'Other Active Customers',
      sliceLabel: otherActiveCount.toLocaleString() + ' active customers with NO recurring subscription',
      rows: otherActiveRows,
      formatValue: fmt.usd0,
    });
    cardCust.clickLabel = otherActiveCount.toLocaleString() + ' "Other active" — click to inspect →';
    cardCust.clickTitle = 'See the active customers whose subs are all one-time / non-recurring';
  }
  // Make the remaining headline cards drill into their full underlying row
  // list — the same set the number is counting — so any miscategorized sub is
  // one click away. Row sources are pulled from the chart drill specs.
  const cardDrills = {
    subs:    { rows: _topFunnel ? _topFunnel.rows : ((dataA.drill && dataA.drill.serviced && dataA.drill.serviced.source) || []), label: 'subscriptions with a completed initial service (same as Retention step 1)' },
    active:  { rows: (dataA.drill && dataA.drill.rarr    && dataA.drill.rarr.source)    || [], label: 'active recurring subscriptions' },
    arr:     { rows: (dataA.drill && dataA.drill.rarr    && dataA.drill.rarr.source)    || [], label: 'active recurring subscriptions' },
    cancels: { rows: (dataA.drill && dataA.drill.cancels && dataA.drill.cancels.source) || [], label: 'cancelled recurring subscriptions' },
  };
  // Active ARR (per Isaac, Sep 2026): not a row list — the step-by-step
  // walk from everything in FieldRoutes down to Active ARR, exactly the way
  // the Retention tab's Attrition Steps read, so what counts and what
  // doesn't is one click away.
  const cardArr = COLUMN_CARDS.find(c => c.key === 'arr');
  if (cardArr && !cardArr.onClick) {
    cardArr.onClick = () => openArrStepsModal(scope, dataA);
    cardArr.clickLabel = 'Click for the step-by-step \u2192';
    cardArr.clickTitle = 'Everything in FieldRoutes \u2192 Active ARR, one rule at a time';
  }
  for (const c of COLUMN_CARDS) {
    if (c.onClick) continue;                 // 'customers' already wired above
    const d = cardDrills[c.key];
    if (!d || !d.rows.length) continue;
    c.onClick = () => openReportingDrillModal({
      chartTitle: c.label,
      sliceLabel: c.value + ' · ' + d.label,
      rows: d.rows,
      formatValue: fmt.usd0,
    });
    c.clickLabel = 'Click to inspect ' + d.rows.length.toLocaleString() + ' rows →';
    c.clickTitle = 'See ' + d.label;
  }
  const defById = Object.fromEntries(chartDefs.map(d => [d.id, d]));
  const usedChartIds = new Set(COLUMN_CARDS.flatMap(c => c.chartIds));
  // One metric at a time (per Isaac): a dropdown picks the headline card,
  // that card pops, and only ITS charts render beneath it — instead of five
  // columns side by side.
  const pickKey = COLUMN_CARDS.some(c => c.key === state.reportingOverviewMetric) ? state.reportingOverviewMetric : 'arr';   // Active ARR first / default (per Isaac, Sep 23)
  const picked = COLUMN_CARDS.find(c => c.key === pickKey);
  // The card's own label IS the picker on phones — a select styled like the
  // small-caps label with a caret, so the card reads as a dropdown.
  const metricPick = el('select', {
    class: 'text-[10px] uppercase tracking-widest font-bold cursor-pointer',
    style: { border: '0', background: 'transparent', color: 'var(--text-muted)', padding: '0 18px 0 0', appearance: 'auto', maxWidth: '100%' },
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => { state.reportingOverviewMetric = e.target.value; mountApp(); },
  }, ...COLUMN_CARDS.map(c => el('option', { value: c.key, selected: c.key === pickKey }, c.label + ' · ' + c.value)));
  // Phones only (per Isaac) — desktop keeps the five columns side by side.
  // Anything under 1024px (phones, tablets, a narrow window) — the five
  // columns need ~1230px, so below that the card-dropdown is the layout.
  const phone = (() => { try { return window.matchMedia('(max-width: 1023px)').matches; } catch { return false; } })();
  const columnsBlock = inCompare ? null : phone
    ? el('div', { class: 'flex flex-col gap-4' },
        popTile(picked, metricPick),
        ...picked.chartIds.map(id => defById[id] ? makeCard(defById[id], dataA, 'a') : null))
    : el('div', { class: 'overflow-x-auto' },
        el('div', { class: 'grid gap-4 rep-cols', style: { gridTemplateColumns: 'repeat(5, minmax(235px, 1fr))', minWidth: '1230px', alignItems: 'start' } },
          ...COLUMN_CARDS.map(c => el('div', { class: 'flex flex-col gap-4' },
            popTile(c),
            ...c.chartIds.map(id => defById[id] ? makeCard(defById[id], dataA, 'a') : null)))));

  const chartGrid = inCompare
    ? el('div', { class: 'grid gap-4 rep-cols', style: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
        ...chartDefs.flatMap(def => [makeCard(def, dataA, 'a'), makeCard(def, dataB, 'b')]),
      )
    : el('div', { class: 'grid gap-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } },
        ...chartDefs.filter(def => !usedChartIds.has(def.id)).map(def => makeCard(def, dataA, 'a')),
      );

  // ── DAILY PULSE (per Isaac, Sep 2026): what the business did each day —
  // revenue SOLD (contract value by sold date), NEW revenue SERVICED (ARV of
  // subs whose initial service was completed that day) and revenue CHURNED
  // (ARV of counted cancels by cancel date). Office scope follows the tab;
  // the window is the card's own (7 / 30 / 90 days) so the Time range
  // picker above doesn't collapse it. Bars = sold, lines = serviced / churned.
  // Pulse drill (per Isaac): not a row list — WHICH BRANCHES made the day and
  // how: dollars, share, subs, average per sub, the biggest single account and
  // (for churn) the top cancel reason; the account list is one click deeper.
  // Daily pulse drill (per Isaac, Sep 2026): one modal for the whole day —
  // Sold, Serviced and Churned side by side in a summary strip, then a
  // by-branch table for whichever of the three is selected. Opens on the
  // series that was clicked, switches without closing.
  const openPulseDayDrill = (dayLabel, longDate, sets, initialKind) => {
    const KINDS = {
      sold: { label: 'Sold',     unit: 'contract value', col: 'Sold', color: '#16A34A', valOf: (r) => Number(r.subscription_contract_value) || 0, extra: 'Sold by \u00b7 D2D / Office / Tech' },
      svc:  { label: 'Serviced', unit: 'ARR',            col: 'ARR',  color: '#2F5D62',       valOf: (r) => Number(r.annual_recurring_value) || 0,      extra: 'Sold by \u00b7 D2D / Office / Tech' },
      cxl:  { label: 'Churned',  unit: 'ARR',            col: 'ARR',  color: '#DC2626',       valOf: (r) => Number(r.annual_recurring_value) || 0,      extra: 'Top reason' },
    };
    const totalOf = (k) => (sets[k] || []).reduce((a, r) => a + KINDS[k].valOf(r), 0);
    let kind = KINDS[initialKind] ? initialKind : 'sold';
    // Vertical-only (per Isaac): nothing in this modal scrolls sideways. On
    // phones the wide tables become stacked rows; on desktop they fit 94vw.
    const narrow = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } })();
    const overlay = el('div', { class: 'modal-overlay' });
    const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
    document.addEventListener('keydown', _escClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const th = (t, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
    const td = (t, o = {}) => el('td', { class: 'px-3 py-2 whitespace-nowrap tabular-nums ' + (o.right ? 'text-right' : 'text-left') + (o.bold ? ' font-black' : '') }, t);
    const tdw = (t) => el('td', { class: 'px-3 py-1.5 text-left', style: { overflowWrap: 'anywhere' } }, t);
    const top = (m) => { let k = null, n = 0; for (const [kk, v] of m) if (v > n) { k = kk; n = v; } return k ? k + ' (' + n + ')' : '—'; };
    // Who sold the accounts (per Isaac): share of accounts by seller type —
    // Sales Rep (D2D) / Office Staff / Technician — as a 3-segment bar + %.
    const TYPE_COLORS = { 'Sales Rep': '#DF643A', 'Office Staff': '#5F6C5B', 'Technician': '#2F5D62' };
    const TYPE_SHORT = { 'Sales Rep': 'D2D', 'Office Staff': 'Office', 'Technician': 'Tech' };
    const typeMix = (rows) => {
      const n = rows.length; if (!n) return el('span', { style: { color: 'var(--text-subtle)' } }, '\u2014');
      const c = { 'Sales Rep': 0, 'Office Staff': 0, 'Technician': 0, Other: 0 };
      for (const r of rows) { const t = String(r.sold_by_type || '').trim(); c[t in c ? t : 'Other']++; }
      const parts = Object.entries(c).filter(([, v]) => v > 0);
      return el('div', { class: 'flex items-center gap-2', style: { minWidth: '190px' } },
        el('div', { class: 'flex overflow-hidden', style: { height: '6px', width: '70px', background: 'var(--card-2)', flexShrink: 0 } },
          ...parts.map(([t, v]) => el('div', { style: { width: (v / n * 100) + '%', background: TYPE_COLORS[t] || 'var(--border-2)' }, title: t + ' \u00b7 ' + v }))),
        el('span', { class: 'text-[11px] tabular-nums whitespace-nowrap' }, ...parts.map(([t, v], i) => el('span', { style: { color: TYPE_COLORS[t] || 'var(--text-muted)', fontWeight: 700 } }, (i ? ' \u00b7 ' : '') + (TYPE_SHORT[t] || t) + ' ' + Math.round(v / n * 100) + '%'))));
    };
    const body = el('div', { class: 'flex flex-col gap-3' });
    const render = () => {
      const K = KINDS[kind], rowsIn = sets[kind] || [], isChurn = kind === 'cxl';
      const by = new Map();
      for (const r of rowsIn) { const k = (r.office_name || '').trim() || 'Unassigned'; if (!by.has(k)) by.set(k, { rows: [], total: 0, reasons: new Map(), svc: new Map() }); const g = by.get(k); g.rows.push(r); g.total += K.valOf(r);
        if (isChurn) { const re = reportingCancelReasonOf(r) || 'Unspecified'; g.reasons.set(re, (g.reasons.get(re) || 0) + 1); }
        const sv = String(r.subscription || '').trim() || '—'; g.svc.set(sv, (g.svc.get(sv) || 0) + 1); }
      const grand = rowsIn.reduce((a, r) => a + K.valOf(r), 0);
      const list = [...by.entries()].sort((a, b) => b[1].total - a[1].total);
      const all = { rows: rowsIn, total: grand, reasons: new Map(), svc: new Map() };
      for (const [, g] of by) { for (const [k, v] of g.reasons) all.reasons.set(k, (all.reasons.get(k) || 0) + v); for (const [k, v] of g.svc) all.svc.set(k, (all.svc.get(k) || 0) + v); }
      const row = (k, g, bold) => el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95' + (bold ? ' font-bold' : ''), style: { borderColor: bold ? 'var(--border-2)' : 'var(--border)', background: bold ? 'var(--card-2)' : '' }, title: 'Click for the accounts',
        onclick: () => openReportingDrillModal({ chartTitle: 'Daily pulse · ' + K.label + ' · ' + dayLabel + ' · ' + k, sliceLabel: g.rows.length.toLocaleString() + ' subscription' + (g.rows.length === 1 ? '' : 's') + ' · ' + fmt.usd0(g.total), rows: g.rows, formatValue: fmt.usd0 }) },
        td(k, { bold }),
        td(fmt.usd0(g.total), { right: true, bold: true }),
        td(grand ? (g.total / grand * 100).toFixed(1) + '%' : '—', { right: true }),
        el('td', { class: 'px-3 py-2', style: { minWidth: '120px' } }, el('div', { style: { height: '6px', background: 'var(--card-2)' } }, el('div', { style: { height: '100%', width: (grand ? g.total / grand * 100 : 0) + '%', background: K.color } }))),
        td(fmt.int(g.rows.length), { right: true }),
        td(g.rows.length ? fmt.usd0(g.total / g.rows.length) : '—', { right: true }),
        td(fmt.usd0(Math.max(0, ...g.rows.map(K.valOf))), { right: true }),
        isChurn ? td(top(g.reasons)) : el('td', { class: 'px-3 py-2' }, typeMix(g.rows)));
      // Phone version of a branch row: one block, no sideways scroll.
      const stack = (k, g, bold) => el('div', { class: 'rounded-lg border px-3 py-2 cursor-pointer', style: { borderColor: bold ? 'var(--border-2)' : 'var(--border)', background: bold ? 'var(--card-2)' : '' },
        onclick: () => openReportingDrillModal({ chartTitle: 'Daily pulse · ' + K.label + ' · ' + dayLabel + ' · ' + k, sliceLabel: g.rows.length.toLocaleString() + ' subscription' + (g.rows.length === 1 ? '' : 's') + ' · ' + fmt.usd0(g.total), rows: g.rows, formatValue: fmt.usd0 }) },
        el('div', { class: 'flex items-center justify-between gap-2' },
          el('div', { class: 'text-xs font-bold truncate' }, k),
          el('div', { class: 'text-sm font-black tabular-nums whitespace-nowrap' }, fmt.usd0(g.total), el('span', { class: 'text-[10px] font-semibold ml-1', style: { color: 'var(--text-muted)' } }, grand ? (g.total / grand * 100).toFixed(1) + '%' : ''))),
        el('div', { style: { height: '4px', background: 'var(--card-2)', margin: '4px 0' } }, el('div', { style: { height: '100%', width: (grand ? g.total / grand * 100 : 0) + '%', background: K.color } })),
        el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)', overflowWrap: 'anywhere' } },
          fmt.int(g.rows.length) + ' subs · avg ' + (g.rows.length ? fmt.usd0(g.total / g.rows.length) : '—') + ' · largest ' + fmt.usd0(Math.max(0, ...g.rows.map(K.valOf))) + (isChurn ? ' · top reason: ' + top(g.reasons) : '')),
        isChurn ? null : el('div', { class: 'mt-1' }, typeMix(g.rows)));
      // summary strip — the three series for the day, each one a switch
      const tile = (k) => { const K2 = KINDS[k], n = (sets[k] || []).length, on = k === kind; return el('button', {
        class: 'text-left rounded-lg px-3 py-2 transition hover:brightness-95 flex-1',
        style: { minWidth: '140px', background: on ? 'var(--card-2)' : 'transparent', border: '1px solid ' + (on ? K2.color : 'var(--border)'), boxShadow: on ? 'inset 0 0 0 1px ' + K2.color : 'none' },
        onclick: () => { kind = k; render(); } },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: K2.color } }, K2.label + (k === 'sold' ? ' · contract value' : ' · ARR')),
        el('div', { class: 'text-lg font-black tabular-nums leading-tight' }, fmt.usd0(totalOf(k))),
        el('div', { class: 'text-[10px] text-muted-' }, fmt.int(n) + ' subscription' + (n === 1 ? '' : 's'))); };
      const net = totalOf('svc') - totalOf('cxl');
      const netTile = el('div', { class: 'text-left rounded-lg px-3 py-2 flex-1', style: { minWidth: '140px', border: '1px dashed var(--border-2)' }, title: 'ARR that started service today minus ARR that cancelled today' },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Net ARR · serviced − churned'),
        el('div', { class: 'text-lg font-black tabular-nums leading-tight', style: { color: net >= 0 ? '#16A34A' : '#DC2626' } }, (net < 0 ? '−' : '+') + fmt.usd0(Math.abs(net))),
        el('div', { class: 'text-[10px] text-muted-' }, 'for the day'));
      // Churn view (per Isaac): WHERE the churn came from — reason, lead
      // source and service — plus the accounts themselves, right here.
      const churnBlocks = !isChurn || !rowsIn.length ? [] : (() => {
        const bucket = (keyOf) => { const m = new Map(); for (const r of rowsIn) { const k = keyOf(r) || 'Unspecified'; const g = m.get(k) || { n: 0, arr: 0 }; g.n++; g.arr += K.valOf(r); m.set(k, g); } return [...m.entries()].sort((a, b) => b[1].arr - a[1].arr); };
        const mini = (title, list, keyLabel) => el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', minWidth: '0' } },
          el('div', { class: 'px-3 py-2 text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)', background: 'var(--card-2)' } }, title),
          el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
            el('thead', {}, el('tr', {}, th(keyLabel), th('Subs', true), th('ARR', true), th('Share', true))),
            el('tbody', {}, ...list.slice(0, 8).map(([k, g]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-3 py-1.5', style: { overflowWrap: 'anywhere' }, title: k }, k),
              td(fmt.int(g.n), { right: true }), td(fmt.usd0(g.arr), { right: true, bold: true }), td(grand ? (g.arr / grand * 100).toFixed(0) + '%' : '\u2014', { right: true }))),
              list.length > 8 ? el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, el('td', { class: 'px-3 py-1.5 text-[10px] text-muted-', colspan: 4 }, '+ ' + (list.length - 8) + ' more')) : null)));
        const byReason = bucket(r => reportingCancelReasonOf(r));
        const bySource = bucket(r => (typeof reportingSourceOf === 'function' ? reportingSourceOf(r) : r.subscription_source));
        const bySvc = bucket(r => String(r.subscription || '').trim());
        const nameOf = (r) => { const l = (r.last_name || '').trim(), f = (r.first_name || '').trim(); return l && f ? l + ', ' + f : (l || f || r.customer_id || '\u2014'); };
        const ageMo = (r) => { const a = r.initial_service || r.sold_date; if (!a) return null; const d = (new Date(String(r.subscription_date_canceled).slice(0, 10) + 'T00:00') - new Date(String(a).slice(0, 10) + 'T00:00')) / 2629800000; return isFinite(d) ? Math.max(0, Math.round(d)) : null; };
        const accts = rowsIn.slice().sort((a, b) => K.valOf(b) - K.valOf(a));
        // (Save-attempt logging retired from this list per Isaac, Sep 2026.)
        const canSave = false;
        if (canSave) { state._saveAttemptsOnLoad = () => { if (overlay.isConnected) render(); }; saveAttemptsFor(accts.slice(0, 200).map(r => r.customer_id)); }
        const saveBtn = (r) => !canSave || !r.customer_id ? null : el('button', { class: 'text-[10px] font-bold whitespace-nowrap', style: { color: 'var(--accent)' }, onclick: (e) => { e.stopPropagation(); openSaveAttemptModal(r, () => { if (overlay.isConnected) render(); }); } }, (saveAttemptChip(r.customer_id) ? 'Log another' : 'Log save attempt'));
        const acctTable = el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'px-3 py-2 flex items-center justify-between gap-2 flex-wrap', style: { background: 'var(--card-2)' } },
            el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Churned accounts \u00b7 ' + fmt.int(accts.length)),
            el('button', { class: 'text-[10px] font-bold', style: { color: 'var(--accent)' }, onclick: () => openReportingDrillModal({ chartTitle: 'Daily pulse \u00b7 Churned \u00b7 ' + dayLabel, sliceLabel: fmt.int(accts.length) + ' subscription' + (accts.length === 1 ? '' : 's') + ' \u00b7 ' + fmt.usd0(grand), rows: accts, formatValue: fmt.usd0 }) }, 'Full table \u2192')),
          narrow ? el('div', { class: 'flex flex-col', style: { maxHeight: '360px', overflowY: 'auto', overflowX: 'hidden' } }, ...accts.slice(0, 200).map(r => el('div', { class: 'px-3 py-2 border-t', style: { borderColor: 'var(--border)' } },
              el('div', { class: 'flex items-center justify-between gap-2' },
                el('div', { class: 'text-xs font-semibold truncate' }, nameOf(r), r.customer_id ? el('span', { class: 'text-[10px] text-muted- ml-1' }, '#' + r.customer_id) : null),
                el('div', { class: 'text-xs font-black tabular-nums whitespace-nowrap' }, fmt.usd0(K.valOf(r)))),
              el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)', overflowWrap: 'anywhere' } }, [(r.office_name || '').trim(), String(r.subscription || '').trim(), String(r.subscription_source || '').trim(), ageMo(r) == null ? '' : ageMo(r) + ' mo'].filter(Boolean).join(' · ')),
              el('div', { class: 'text-[10px]', style: { overflowWrap: 'anywhere' } }, reportingCancelReasonOf(r) || '\u2014'),
              canSave ? el('div', { class: 'flex items-center gap-2 mt-1' }, saveAttemptChip(r.customer_id), saveBtn(r)) : null)),
              accts.length > 200 ? el('div', { class: 'px-3 py-1.5 text-[10px] text-muted-' }, 'Showing 200 of ' + fmt.int(accts.length) + ' \u2014 open the full table for the rest') : null) :
          el('div', { style: { maxHeight: '320px', overflowY: 'auto', overflowX: 'hidden' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse', tableLayout: 'fixed' } },
            el('thead', {}, el('tr', {}, th('Customer'), th('Office'), th('Service'), th('Source'), th('ARR', true), th('Age', true), th('Reason'), canSave ? th('Save') : null)),
            el('tbody', {}, ...accts.slice(0, 200).map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-3 py-1.5 font-semibold', style: { overflowWrap: 'anywhere' } }, nameOf(r), r.customer_id ? el('span', { class: 'text-[10px] text-muted- ml-1' }, '#' + r.customer_id) : null),
              tdw((r.office_name || '').trim() || '\u2014'), tdw(String(r.subscription || '').trim() || '\u2014'), tdw(String(r.subscription_source || '').trim() || '\u2014'),
              td(fmt.usd0(K.valOf(r)), { right: true, bold: true }),
              td(ageMo(r) == null ? '\u2014' : ageMo(r) + ' mo', { right: true }),
              el('td', { class: 'px-3 py-1.5', style: { overflowWrap: 'anywhere' }, title: reportingCancelReasonOf(r) || '' }, reportingCancelReasonOf(r) || '\u2014'),
              canSave ? el('td', { class: 'px-3 py-1.5' }, el('div', { class: 'flex items-center gap-1.5 flex-wrap' }, saveAttemptChip(r.customer_id), saveBtn(r))) : null)),
              accts.length > 200 ? el('tr', {}, el('td', { class: 'px-3 py-1.5 text-[10px] text-muted-', colspan: 8 }, 'Showing 200 of ' + fmt.int(accts.length) + ' \u2014 open the full table for the rest')) : null))));
        return [
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mt-1', style: { color: 'var(--text-subtle)' } }, 'Where the churn came from'),
          el('div', { class: 'grid gap-3', style: { gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))' } }, mini('By cancel reason', byReason, 'Reason'), mini('By lead source', bySource, 'Source'), mini('By service', bySvc, 'Service')),
          acctTable,
        ];
      })();
      body.replaceChildren(
        el('div', { class: 'flex gap-2 flex-wrap' }, tile('sold'), tile('svc'), tile('cxl'), netTile),
        el('div', { class: 'text-[11px] text-muted-' }, K.label + ': ' + fmt.usd0(grand) + ' of ' + K.unit + ' across ' + fmt.int(rowsIn.length) + ' subscription' + (rowsIn.length === 1 ? '' : 's') + ' in ' + list.length + ' office' + (list.length === 1 ? '' : 's') + ' · click a branch for the accounts'),
        !rowsIn.length ? el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'Nothing ' + K.label.toLowerCase() + ' on this day.') :
        narrow ? el('div', { class: 'flex flex-col gap-2' }, ...list.map(([k, g]) => stack(k, g, false)), stack('RIDD · Total', all, true)) :
        el('div', { style: { overflowX: 'hidden' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
          el('thead', {}, el('tr', {}, th('Office'), th(K.col, true), th('Share', true), th(''), th('Subs', true), th('Avg / sub', true), th('Largest', true), th(K.extra))),
          el('tbody', {}, ...list.map(([k, g]) => row(k, g, false)), row('RIDD · Total', all, true)))),
        ...churnBlocks);
    };
    render();
    overlay.append(el('div', { class: 'card p-5 flex flex-col gap-3', style: { width: 'min(980px, 94vw)', maxHeight: '88vh', overflowY: 'auto', overflowX: 'hidden', touchAction: 'pan-y' } },
      el('div', { class: 'flex items-start justify-between gap-3' },
        el('div', {}, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Daily pulse · by office'),
          el('div', { class: 'text-lg font-black' }, longDate || dayLabel)),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×')),
      body));
    document.body.append(overlay);
  };
  const pulseCard = (() => {
    // Window: today / yesterday (one day, broken out by branch) or the last
    // 7 / 30 / 90 days (one bar per day). Per Isaac, Sep 2026.
    const spanRaw = state._rtPulseSpan;
    const single = spanRaw === 'today' || spanRaw === 'yesterday';
    const span = single ? 1 : ([7, 30, 90].includes(Number(spanRaw)) ? Number(spanRaw) : 30);
    const rows = reportingFilterByOffice(scope.visible, office);
    const { isRealCancel } = reportingFilters();
    const today = new Date();
    if (spanRaw === 'yesterday') today.setDate(today.getDate() - 1);
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const days = [];
    for (let i = span - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push(iso(d)); }
    const idx = new Map(days.map((d, i) => [d, i]));
    const sold = new Array(span).fill(0), serviced = new Array(span).fill(0), churned = new Array(span).fill(0);
    const soldRows = days.map(() => []), svcRows = days.map(() => []), cxlRows = days.map(() => []);
    for (const r of rows) {
      const sd = String(r.sold_date || '').slice(0, 10);
      if (idx.has(sd)) { const i = idx.get(sd); sold[i] += Number(r.subscription_contract_value) || 0; soldRows[i].push(r); }
      const initDone = String(r.initial_status || '').toLowerCase() === 'completed' || !!r.initial_serviced_date;
      const svd = initDone ? String(r.initial_serviced_date || r.initial_service || '').slice(0, 10) : '';
      if (svd && idx.has(svd)) { const i = idx.get(svd); serviced[i] += Number(r.annual_recurring_value) || 0; svcRows[i].push(r); }
      const cd = String(r.subscription_date_canceled || '').slice(0, 10);
      if (cd && idx.has(cd) && isRealCancel(r)) { const i = idx.get(cd); churned[i] += Number(r.annual_recurring_value) || 0; cxlRows[i].push(r); }
    }
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const id = 'rptPulse' + (office !== 'all' ? '_' + String(office).replace(/\W/g, '') : '');
    const cvsWrap = el('div', { style: { position: 'relative', height: '260px', width: '100%' } }, el('canvas', { id }));
    const isDark = state.theme === 'dark';
    // Sold is a positive number, so it reads green (per Isaac); serviced is the deep teal so the two don't blur.
    const C = { sold: '#16A34A', svc: '#2F5D62', cxl: '#DC2626' };
    setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      const cvsEl = document.getElementById(id); if (!cvsEl) return;
      if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
      const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
      const lbl = days.map(d => { const dt = new Date(d + 'T00:00'); return (dt.getMonth() + 1) + '/' + dt.getDate(); });
      // Long-form date (per Isaac): "Wednesday, September 6th, 2026" — tooltip title and the drill header.
      const longDate = (i) => { const dt = new Date(days[i] + 'T00:00'); const n = dt.getDate(); const sfx = (n % 10 === 1 && n !== 11) ? 'st' : (n % 10 === 2 && n !== 12) ? 'nd' : (n % 10 === 3 && n !== 13) ? 'rd' : 'th'; return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long' }) + ' ' + n + sfx + ', ' + dt.getFullYear(); };
      // Single day: one grouped bar per branch (sold / serviced / churned)
      // instead of a lone bar — the day's story is WHERE it happened.
      let labels = lbl, dsSold = sold, dsSvc = serviced, dsCxl = churned;
      if (single) {
        const ofc = (r) => (r.office_name || '').trim() || 'Unassigned';
        const agg = new Map();
        const add = (set, k, valOf) => { for (const r of set) { const o = ofc(r); if (!agg.has(o)) agg.set(o, { sold: 0, svc: 0, cxl: 0 }); agg.get(o)[k] += valOf(r); } };
        add(soldRows[0], 'sold', (r) => Number(r.subscription_contract_value) || 0);
        add(svcRows[0], 'svc', (r) => Number(r.annual_recurring_value) || 0);
        add(cxlRows[0], 'cxl', (r) => Number(r.annual_recurring_value) || 0);
        const list = [...agg.entries()].sort((a, b) => (b[1].sold + b[1].svc) - (a[1].sold + a[1].svc));
        labels = list.map(([k]) => k); dsSold = list.map(([, v]) => v.sold); dsSvc = list.map(([, v]) => v.svc); dsCxl = list.map(([, v]) => v.cxl);
      }
      _chartInstances[id] = new Chart(cvsEl.getContext('2d'), {
        data: { labels, datasets: single ? [
          { type: 'bar', label: 'Sold', data: dsSold, backgroundColor: C.sold, borderWidth: 0 },
          { type: 'bar', label: 'Serviced (new ARR)', data: dsSvc, backgroundColor: C.svc, borderWidth: 0 },
          { type: 'bar', label: 'Churned (ARR)', data: dsCxl, backgroundColor: C.cxl, borderWidth: 0 },
        ] : [
          { type: 'bar', label: 'Sold', data: sold, backgroundColor: C.sold, borderWidth: 0, order: 3 },
          { type: 'line', label: 'Serviced (new ARR)', data: serviced, borderColor: C.svc, backgroundColor: C.svc, borderWidth: 2, tension: 0.3, pointRadius: 2, order: 1 },
          { type: 'line', label: 'Churned (ARR)', data: churned, borderColor: C.cxl, backgroundColor: C.cxl, borderWidth: 2, tension: 0.3, pointRadius: 2, order: 2 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          onClick: (evt, els) => {
            if (!els || !els.length) return;
            const i = single ? 0 : els[0].index, dsi = els[0].datasetIndex;
            if (!soldRows[i].length && !svcRows[i].length && !cxlRows[i].length) return;
            openPulseDayDrill(lbl[i], longDate(i), { sold: soldRows[i], svc: svcRows[i], cxl: cxlRows[i] }, dsi === 0 ? 'sold' : dsi === 1 ? 'svc' : 'cxl');
          },
          plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } },
            tooltip: { callbacks: {
              // Long-form date in the tooltip title (per Isaac): "Wednesday, September 6th, 2026".
              title: (items) => { const i = items && items[0] ? items[0].dataIndex : -1; return i < 0 ? '' : single ? (labels[i] + ' · ' + longDate(0)) : longDate(i); },
              label: (c) => ' ' + c.dataset.label + ': $' + Math.round(c.parsed.y).toLocaleString(),
              // Net = Sold − Churned for the hovered day / branch (per Isaac, Sep 22).
              footer: (items) => { const i = items && items[0] ? items[0].dataIndex : -1; if (i < 0) return ''; const n = (Number(dsSold[i]) || 0) - (Number(dsCxl[i]) || 0); return ' Net (sold − churned): ' + (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString(); } } } },
          scales: { x: { ticks: { color: txt, maxTicksLimit: span > 30 ? 15 : 31 }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { color: txt, callback: v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) }, grid: { color: grid } } } },
      });
    }, 50);
    // The three headline numbers open the same drill for the WHOLE window
    // (per Isaac — tap Churned to see the day's/window's lost accounts,
    // where they came from and what each branch lost).
    const flat = (arr) => arr.reduce((a, x) => a.concat(x), []);
    const winLabel = single ? (spanRaw === 'today' ? 'Today' : 'Yesterday') : 'Last ' + span + ' days';
    const winLong = single ? (() => { const dt = new Date(days[0] + 'T00:00'); return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); })() : winLabel + ' \u00b7 ' + days[0] + ' \u2192 ' + days[days.length - 1];
    const openWindow = (kind) => openPulseDayDrill(winLabel, winLong, { sold: flat(soldRows), svc: flat(svcRows), cxl: flat(cxlRows) }, kind);
    // SUBSCRIPTIONS LOST (per Isaac, Sep 2026): right on the main page, under
    // the chart — RIDD first, then each office — how many subscriptions and
    // how much ARR churned in the window. Same rows as the red series above
    // (counted cancels only: 3-day RORs and non-real cancels are excluded).
    const lostBlock = (() => {
      // Per Isaac: alongside what was lost, what was SOLD in the same window
      // and the net — for subscriptions and for revenue. Revenue sold is
      // contract value (the green series); revenue lost is ARR (the red
      // series) — the same numbers as the chart above.
      const cxlAll = flat(cxlRows), soldAll = flat(soldRows);
      const arrOf = (r) => Number(r.annual_recurring_value) || 0;
      const cvOf = (r) => Number(r.subscription_contract_value) || 0;
      const ofc = (r) => (r.office_name || '').trim() || 'Unassigned';
      const by = new Map();
      const g0 = () => ({ sn: 0, srev: 0, ln: 0, lrev: 0, sold: [], lost: [] });
      for (const r of soldAll) { const k = ofc(r); const g = by.get(k) || g0(); g.sn++; g.srev += cvOf(r); g.sold.push(r); by.set(k, g); }
      for (const r of cxlAll) { const k = ofc(r); const g = by.get(k) || g0(); g.ln++; g.lrev += arrOf(r); g.lost.push(r); by.set(k, g); }
      const tot = g0(); for (const g of by.values()) { tot.sn += g.sn; tot.srev += g.srev; tot.ln += g.ln; tot.lrev += g.lrev; tot.sold.push(...g.sold); tot.lost.push(...g.lost); }
      const list = [...by.entries()].sort((a, b) => (b[1].lrev + b[1].srev) - (a[1].lrev + a[1].srev));
      const hd = (t, right) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
      const cell = (t, o = {}) => el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap ' + (o.right ? 'text-right' : 'text-left') + (o.bold ? ' font-black' : ''), style: o.color ? { color: o.color } : {} }, t);
      const signed = (v, money) => (v < 0 ? '\u2212' : v > 0 ? '+' : '') + (money ? fmt.usd0(Math.abs(v)) : fmt.int(Math.abs(v)));
      const netColor = (v) => v > 0 ? C.sold : v < 0 ? C.cxl : '';
      const drill = (label, rows, what, val) => openReportingDrillModal({ chartTitle: what + ' \u00b7 ' + winLabel + ' \u00b7 ' + label, sliceLabel: fmt.int(rows.length) + ' subscription' + (rows.length === 1 ? '' : 's') + ' \u00b7 ' + val, rows, formatValue: fmt.usd0 });
      const numCell = 'px-2 py-1.5 tabular-nums whitespace-nowrap text-right font-bold';
      const clickable = (rows, onclick) => rows.length ? { class: numCell + ' cursor-pointer hover:underline', onclick: (e) => { e.stopPropagation(); onclick(); } } : { class: numCell };
      const line = (label, g, bold) => el('tr', { class: 'border-t', style: { borderColor: bold ? 'var(--border-2)' : 'var(--border)', background: bold ? 'var(--card-2)' : '' } },
        el('td', { class: 'px-2 py-1.5 whitespace-nowrap ' + (bold ? 'font-black' : 'font-semibold'), style: bold ? { background: 'var(--card-2)' } : {} }, label),
        el('td', { style: { color: g.sn ? C.sold : '' }, title: 'Click for the sold accounts', ...clickable(g.sold, () => drill(label, g.sold, 'Subscriptions sold', fmt.usd0(g.srev) + ' contract value')) }, fmt.int(g.sn)),
        el('td', { style: { color: g.ln ? C.cxl : '' }, title: 'Click for the lost accounts', ...clickable(g.lost, () => drill(label, g.lost, 'Subscriptions lost', fmt.usd0(g.lrev) + ' ARR')) }, fmt.int(g.ln)),
        cell(signed(g.sn - g.ln, false), { right: true, bold: true, color: netColor(g.sn - g.ln) }),
        cell(fmt.usd0(g.srev), { right: true, color: g.srev ? C.sold : '' }),
        cell(fmt.usd0(g.lrev), { right: true, color: g.lrev ? C.cxl : '' }),
        cell(signed(g.srev - g.lrev, true), { right: true, bold: true, color: netColor(g.srev - g.lrev) }));
      const tbl = el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, hd('Office'), hd('Subs sold', true), hd('Subs lost', true), hd('Net subs', true), hd('Revenue sold', true), hd('Revenue lost', true), hd('Net revenue', true))),
        // Collapsed by default (per Isaac): the RIDD line plus an expand row; the office lines open on demand.
        el('tbody', {}, line('RIDD', tot, true), ...(state._pulseOfficesOpen ? list.map(([k, g]) => line(k, g, false)) : []),
          list.length ? el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-2 py-1.5', colspan: 7 }, el('button', { class: 'text-[11px] font-bold', style: { color: 'var(--accent)' }, onclick: () => { state._pulseOfficesOpen = !state._pulseOfficesOpen; mountApp(); } },
              state._pulseOfficesOpen ? '\u25be Hide offices' : '\u25b8 Show ' + list.length + ' office' + (list.length === 1 ? '' : 's')))) : null,
          !cxlAll.length && !soldAll.length ? el('tr', {}, el('td', { class: 'px-2 py-2 text-[10px] text-muted-', colspan: 7 }, 'Nothing sold or lost in this window.')) : null));
      // ── DAILY view (per Isaac): one row per day — exactly what was lost
      // each day, with the reason and office behind it — plus a few
      // insights (worst day, weekday pattern, last 7 vs prior 7).
      const dayView = state._pulseLostView === 'day';
      const dayLong = (iso) => { const dt = new Date(iso + 'T00:00'); return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
      const dayShort = (iso) => { const dt = new Date(iso + 'T00:00'); return (dt.getMonth() + 1) + '/' + dt.getDate(); };
      const dayFull = (iso) => { const dt = new Date(iso + 'T00:00'); const n = dt.getDate(); const sfx = (n % 10 === 1 && n !== 11) ? 'st' : (n % 10 === 2 && n !== 12) ? 'nd' : (n % 10 === 3 && n !== 13) ? 'rd' : 'th'; return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long' }) + ' ' + n + sfx + ', ' + dt.getFullYear(); };
      const topOf = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r) || 'Unspecified'; m.set(k, (m.get(k) || 0) + 1); } let best = '', n = 0; for (const [k, v] of m) if (v > n) { best = k; n = v; } return best ? best + ' (' + n + ')' : '\u2014'; };
      const dayRows = days.map((d, i) => ({ d, i, sn: soldRows[i].length, srev: soldRows[i].reduce((a, r) => a + cvOf(r), 0), ln: cxlRows[i].length, lrev: cxlRows[i].reduce((a, r) => a + arrOf(r), 0),
        reason: topOf(cxlRows[i], reportingCancelReasonOf), office: topOf(cxlRows[i], ofc) }));
      const dayLine = (r) => el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95', style: { borderColor: 'var(--border)' }, title: 'Click for this day\u2019s drilldown',
        onclick: () => openPulseDayDrill(dayShort(r.d), dayFull(r.d), { sold: soldRows[r.i], svc: svcRows[r.i], cxl: cxlRows[r.i] }, 'cxl') },
        el('td', { class: 'px-2 py-1.5 whitespace-nowrap font-semibold' }, dayLong(r.d), r.d === days[days.length - 1] && spanRaw !== 'yesterday' ? el('span', { class: 'ml-1 text-[9px] font-semibold', style: { color: 'var(--text-subtle)' } }, 'live') : null),
        cell(fmt.int(r.sn), { right: true, bold: true, color: r.sn ? C.sold : '' }),
        cell(fmt.int(r.ln), { right: true, bold: true, color: r.ln ? C.cxl : '' }),
        cell(signed(r.sn - r.ln, false), { right: true, bold: true, color: netColor(r.sn - r.ln) }),
        cell(fmt.usd0(r.srev), { right: true, color: r.srev ? C.sold : '' }),
        cell(fmt.usd0(r.lrev), { right: true, color: r.lrev ? C.cxl : '' }),
        cell(signed(r.srev - r.lrev, true), { right: true, bold: true, color: netColor(r.srev - r.lrev) }),
        el('td', { class: 'px-2 py-1.5 whitespace-nowrap text-[11px]', style: { color: 'var(--text-muted)' } }, r.reason),
        el('td', { class: 'px-2 py-1.5 whitespace-nowrap text-[11px]', style: { color: 'var(--text-muted)' } }, r.office));
      const dayTbl = el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, hd('Day'), hd('Subs sold', true), hd('Subs lost', true), hd('Net subs', true), hd('Revenue sold', true), hd('Revenue lost', true), hd('Net revenue', true), hd('Top cancel reason'), hd('Office losing most'))),
        // Last 7 days by default (per Isaac); "Show all N days" reveals the rest of the window. The total row stays the whole window.
        el('tbody', {}, ...(state._pulseDaysAll || dayRows.length <= 8 ? dayRows.slice().reverse() : dayRows.slice(-7).reverse()).map(dayLine),
          (!state._pulseDaysAll && dayRows.length > 8) ? el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-2 py-1.5', colspan: '9' }, el('button', { class: 'text-[11px] font-bold', style: { color: 'var(--accent)' }, onclick: () => { state._pulseDaysAll = true; mountApp(); } }, 'Show all ' + dayRows.length + ' days \u2192'))) : null,
          (state._pulseDaysAll && dayRows.length > 8) ? el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-2 py-1.5', colspan: '9' }, el('button', { class: 'text-[11px] font-bold', style: { color: 'var(--accent)' }, onclick: () => { state._pulseDaysAll = false; mountApp(); } }, 'Show last 7 days'))) : null,
          el('tr', { class: 'border-t font-bold', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
            el('td', { class: 'px-2 py-1.5', style: { background: 'var(--card-2)' } }, winLabel), cell(fmt.int(tot.sn), { right: true, color: C.sold }), cell(fmt.int(tot.ln), { right: true, color: C.cxl }), cell(signed(tot.sn - tot.ln, false), { right: true, color: netColor(tot.sn - tot.ln) }),
            cell(fmt.usd0(tot.srev), { right: true, color: C.sold }), cell(fmt.usd0(tot.lrev), { right: true, color: C.cxl }), cell(signed(tot.srev - tot.lrev, true), { right: true, color: netColor(tot.srev - tot.lrev) }), cell(''), cell(''))));
      // Insights — only meaningful over a multi-day window.
      const insights = (() => {
        if (span < 7) return null;
        const done = dayRows.filter(r => r.d < days[days.length - 1] || spanRaw === 'yesterday');   // completed days only
        if (!done.length) return null;
        const avgLost = done.reduce((a, r) => a + r.ln, 0) / done.length;
        const worst = done.reduce((a, r) => (r.ln > a.ln ? r : a), done[0]);
        const best = done.reduce((a, r) => (r.ln < a.ln ? r : a), done[0]);
        const byDow = [0, 1, 2, 3, 4, 5, 6].map(dw => { const rs = done.filter(r => new Date(r.d + 'T00:00').getDay() === dw); return { dw, avg: rs.length ? rs.reduce((a, r) => a + r.ln, 0) / rs.length : null, n: rs.length }; }).filter(x => x.avg != null);
        const heavy = byDow.slice().sort((a, b) => b.avg - a.avg)[0];
        const dowName = (dw) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dw];
        const last7 = done.slice(-7).reduce((a, r) => a + r.ln, 0), prior7 = done.slice(-14, -7).reduce((a, r) => a + r.ln, 0);
        const trend = done.length >= 14 && prior7 ? (last7 - prior7) / prior7 : null;
        const reason = topOf(cxlAll, reportingCancelReasonOf);
        const tile = (label, v, sub, color) => el('div', { class: 'rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)', minWidth: '150px', flex: '1 1 150px' } },
          el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
          el('div', { class: 'text-base font-black tabular-nums leading-tight', style: color ? { color } : {} }, v),
          sub ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)', overflowWrap: 'anywhere' } }, sub) : null);
        return el('div', { class: 'flex gap-2 flex-wrap mb-2' },
          tile('Avg lost per day', avgLost.toFixed(1) + ' subs', fmt.usd0(done.reduce((a, r) => a + r.lrev, 0) / done.length) + ' ARR / day', C.cxl),
          tile('Worst day', dayLong(worst.d), worst.ln + ' subs \u00b7 ' + fmt.usd0(worst.lrev) + ' \u00b7 ' + worst.reason, C.cxl),
          tile('Best day', dayLong(best.d), best.ln + ' subs \u00b7 ' + fmt.usd0(best.lrev), C.sold),
          heavy ? tile('Heaviest weekday', dowName(heavy.dw), 'avg ' + heavy.avg.toFixed(1) + ' subs lost (' + heavy.n + ' ' + dowName(heavy.dw) + 's)') : null,
          trend != null ? tile('Last 7 days vs prior 7', (trend > 0 ? '+' : '') + Math.round(trend * 100) + '%', last7 + ' vs ' + prior7 + ' subs lost', trend > 0 ? C.cxl : C.sold) : null,
          tile('Top cancel reason', reason.replace(/ \(\d+\)$/, ''), reason.match(/\((\d+)\)$/) ? reason.match(/\((\d+)\)$/)[1] + ' of ' + fmt.int(cxlAll.length) + ' cancels' : ''));
      })();
      // Pill tabs (the Revenue Goal pattern) — the ad-hoc segmented control
      // rendered blank / dead on phones (per Isaac, Sep 23).
      const viewBtn = (v, l) => el('button', { type: 'button', 'data-active': String(dayView ? v === 'day' : v === 'office'), onclick: () => { state._pulseLostView = v; mountApp(); } }, l);
      return el('div', { class: 'mt-3 pt-3 border-t', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center justify-between gap-2 flex-wrap mb-1' },
          el('div', {},
            el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' }, title: 'Revenue sold = contract value \u00b7 revenue lost = ARR of counted cancels' + (span > 1 ? ' \u00b7 RIDD is losing ' + (tot.ln / span).toFixed(1) + ' subs / day' : '') }, 'Subscriptions sold vs lost \u00b7 ' + winLabel.toLowerCase() + (dayView ? ' \u00b7 by day' : ' \u00b7 by office')),
            null),
          el('div', { class: 'flex items-center gap-2 flex-wrap justify-end', style: { marginLeft: 'auto' } },   // right-justified (per Isaac, Sep 23)
            el('div', { class: 'pill-tabs' }, viewBtn('office', 'By office'), viewBtn('day', 'Daily')),
            el('button', { class: 'text-[10px] font-bold', style: { color: 'var(--accent)' }, title: 'Where the churn came from — the window\'s lost accounts, by office', onclick: () => openWindow('cxl') }, 'See more \u2192'))),
        dayView ? insights : null,
        el('div', { class: 'scroll-x' }, dayView ? dayTbl : tbl));
    })();
    const stat = (label, v, color, kind) => el('button', { class: 'text-left cursor-pointer transition hover:brightness-95', title: 'See the ' + label.toLowerCase() + ' accounts, by office \u2014 and where churn came from', onclick: () => openWindow(kind) },
      el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-base font-black tabular-nums', style: { color } }, fmt.usd0(v)));
    return el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-2' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold', title: (single ? 'By office: contract value SOLD (green) · ARR of accounts that received their first service (teal) · ARR that CHURNED (red). Click a bar for the day.' : 'Each day: contract value SOLD (green bars) · ARR of accounts that received their first service (teal) · ARR that CHURNED (red). Click a bar or point for the accounts.') }, 'Daily Pulse' + (office !== 'all' ? ' · ' + officeLabel(office) : ''))),
        el('div', { class: 'flex items-center gap-4 flex-wrap' },
          stat('Sold · ' + (single ? (spanRaw === 'today' ? 'today' : 'yesterday') : span + 'd'), sum(sold), C.sold, 'sold'), stat('Serviced', sum(serviced), C.svc, 'svc'), stat('Churned', sum(churned), C.cxl, 'cxl'),
          // Net = Sold − Churned for the selected window (per Isaac, Sep 22).
          (() => { const n = sum(sold) - sum(churned); return el('div', { class: 'text-left', title: 'Sold − Churned for this window' },
            el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Net'),
            el('div', { class: 'text-base font-black tabular-nums', style: { color: n >= 0 ? C.sold : C.cxl } }, (n < 0 ? '−' : '') + fmt.usd0(Math.abs(n)))); })(),
          el('select', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            onchange: (e) => { const v = e.target.value; state._rtPulseSpan = (v === 'today' || v === 'yesterday') ? v : Number(v); mountApp(); },
          }, ...[['today', 'Today'], ['yesterday', 'Yesterday'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => el('option', { value: String(v), selected: single ? spanRaw === v : span === v }, l))))),
      cvsWrap,
      lostBlock);
  })();

  return el('div', { class: 'flex flex-col gap-4' },
    reportingPinBar('overview', filterBar),
    statsBlock,
    pulseCard,
    columnsBlock,
    chartGrid,
  );
}


// ── Active ARR · steps (per Isaac, Sep 2026) ───────────────────────────────
// The same rules reportingFilters() / reportingChartData() apply, replayed
// one at a time with what each one removes (subs + ARR) and what remains, so
// the headline reconciles to the last line. Every step drills to its rows.
function openArrStepsModal(scope, dataA) {
  const F = reportingFilters();
  const arr = (r) => Number(r.annual_recurring_value) || 0;
  const sumArr = (rows) => rows.reduce((a, r) => a + arr(r), 0);
  const excludedSources = reportingExcludedSources();
  const exclBranches = (typeof reportingExcludedBranches === 'function') ? reportingExcludedBranches() : new Set();
  const raw = state.reportingSubscriptions || [];
  const officeLabel = scope.officeLabel || ((o) => o);
  const steps = [];
  let cur = raw;
  const step = (title, detail, keep, tag) => {
    const kept = cur.filter(keep), removed = cur.filter(r => !keep(r));
    steps.push({ title, detail, removed, kept, tag });
    cur = kept;
  };
  step('Remove excluded branches', 'Offices switched off in Reporting → Configurations → Branches.', r => !exclBranches.has((r.office_name || '').trim()), 'config');
  step('Remove hidden service types', 'Service types marked Hidden in Configurations (internal / test services).', r => !F.isHidden(r), 'config');
  step('Remove excluded lead sources', 'Sources excluded from all reporting in Configurations (e.g. Miscellaneous).', r => !excludedSources.has(reportingSourceOf(r)), 'config');
  step('Remove subs that never started', 'No initial service ever completed AND frozen/removed in the CRM or cancelled as Sold-Not-Started / No Initial — dead cards, not customers.', r => !reportingNeverStarted(r), 'app rule');
  if (scope.dateStart || scope.dateEnd) {
    const inDate = new Set(reportingFilterByDate(cur, scope.dateStart, scope.dateEnd));
    step('Keep the selected time range', 'Time range on this tab: ' + scope.dateLabel + '. Subs sold outside it leave here.', r => inDate.has(r), 'filter');
  }
  if (scope.office && scope.office !== 'all') {
    const inOffice = new Set(reportingFilterByOffice(cur, scope.office));
    step('Keep the selected office(s)', 'Office filter on this tab: ' + officeLabel(scope.office) + '.', r => inOffice.has(r), 'filter');
  }
  step('Remove non-recurring service types', 'One-time services and any service type not classed Recurring (Configurations → Services). Their ARV never counts toward ARR.', r => F.isRecurring(r), 'app rule');
  step('Remove cancelled subscriptions', 'Any cancel date on the subscription — whatever the reason. (Attrition rules about RORs and excluded reasons decide what counts as churn, not what is active.)', r => !r.subscription_date_canceled, 'app rule');
  step('Keep only status = Active', 'Frozen, inactive, pending and every other CRM status leaves here. What remains is the Active ARR book.', r => (r.subscription_status || '').toLowerCase() === 'active', 'app rule');
  const active = cur;
  const zeroArr = active.filter(r => arr(r) <= 0);
  const total = sumArr(active);
  const headline = Number(dataA && dataA.stats && dataA.stats.activeArr) || 0;

  const n = (v) => Number(v || 0).toLocaleString('en-US');
  const drill = (title, rows, what) => rows.length ? () => openReportingDrillModal({ chartTitle: 'Active ARR steps · ' + title, sliceLabel: n(rows.length) + ' subscription' + (rows.length === 1 ? '' : 's') + ' · ' + fmt.usd0(sumArr(rows)) + ' ARV · ' + what, rows, formatValue: fmt.usd0 }) : null;
  const clickable = (node, fn) => { if (fn) { node.classList.add('cursor-pointer', 'hover:underline'); node.onclick = (e) => { e.stopPropagation(); fn(); }; } return node; };
  const chip = (t) => el('span', { class: 'text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0', style: { color: 'var(--text-subtle)', border: '1px solid var(--border)' } }, t);
  const row = (i, st) => el('div', { class: 'flex items-start gap-3 py-2 border-t', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0', style: { background: 'var(--card-2)' } }, String(i)),
    el('div', { class: 'flex-1 min-w-0' }, el('div', { class: 'text-sm font-semibold' }, st.title), el('div', { class: 'text-[11px] text-muted-' }, st.detail)),
    el('div', { class: 'text-right shrink-0 tabular-nums' },
      clickable(el('div', { class: 'text-sm font-bold', style: { color: st.removed.length ? '#DC2626' : 'var(--text-subtle)' } }, st.removed.length ? '−' + n(st.removed.length) + ' subs' : '0'), drill(st.title, st.removed, 'removed by this step')),
      clickable(el('div', { class: 'text-[10px] font-semibold', style: { color: st.removed.length ? '#DC2626' : 'var(--text-subtle)' } }, st.removed.length ? '−' + fmt.usd0(sumArr(st.removed)) + ' ARV' : ''), drill(st.title, st.removed, 'removed by this step')),
      clickable(el('div', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-muted)' } }, n(st.kept.length) + ' remain · ' + fmt.usd0(sumArr(st.kept))), drill(st.title + ' · remaining', st.kept, 'still in after this step'))),
    chip(st.tag));
  const totalRow = (label, rows, sub, strong) => el('div', { class: 'flex items-center justify-between gap-3 py-2 border-t-2', style: { borderColor: 'var(--border-2)' } },
    el('div', {}, el('div', { class: 'text-sm font-black' }, label), sub ? el('div', { class: 'text-[11px] text-muted-' }, sub) : null),
    clickable(el('div', { class: 'text-right tabular-nums' }, el('div', { class: (strong ? 'text-lg' : 'text-base') + ' font-black' }, fmt.usd0(sumArr(rows))), el('div', { class: 'text-[10px] text-muted-' }, n(rows.length) + ' subscriptions')), drill(label, rows, 'included')));

  const overlay = el('div', { class: 'modal-overlay' });
  const closeKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', closeKey); } };
  document.addEventListener('keydown', closeKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', closeKey); } });
  overlay.append(el('div', { class: 'card p-5 flex flex-col gap-2', style: { width: 'min(860px, 94vw)', maxHeight: '88vh', overflowY: 'auto', overflowX: 'hidden' } },
    el('div', { class: 'flex items-start justify-between gap-3' },
      el('div', {}, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Active ARR · step by step'),
        el('div', { class: 'text-lg font-black' }, 'Everything in FieldRoutes → Active ARR'),
        el('div', { class: 'text-[11px] text-muted-' }, 'The same rules the Overview applies, one at a time. ARV = each subscription’s annual recurring value in FieldRoutes. Click any number for the accounts.')),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => { overlay.remove(); document.removeEventListener('keydown', closeKey); } }, '×')),
    totalRow('Everything in FieldRoutes', raw, 'Every subscription in the synced snapshot, any status, any service type — the top of the funnel.', false),
    ...steps.map((st, i) => row(i + 1, st)),
    totalRow('Active ARR', active, zeroArr.length ? n(zeroArr.length) + ' of these active subs carry $0 ARV in FieldRoutes and add nothing — click to see them' : 'Sum of ARV across active recurring subscriptions.', true),
    zeroArr.length ? clickable(el('div', { class: 'text-[10px] font-semibold text-right', style: { color: 'var(--text-muted)' } }, n(zeroArr.length) + ' active subs at $0 ARV →'), drill('Active subs with $0 ARV', zeroArr, 'active but contributing no ARR')) : null,
    Math.abs(total - headline) > 1 ? el('div', { class: 'text-[10px] font-semibold', style: { color: '#B45309' } }, 'Note: the card shows ' + fmt.usd0(headline) + '; these steps total ' + fmt.usd0(total) + '. The difference means a rule changed since the page rendered — reload the tab.') : null));
  document.body.append(overlay);
}
