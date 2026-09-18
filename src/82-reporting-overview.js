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
          el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×')),
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
    { key: 'subs',      label: 'Subscriptions Serviced',  value: (_topFunnel ? _topFunnel.rows.length : (dataA.stats.servicedSubs != null ? dataA.stats.servicedSubs : dataA.stats.subs)).toLocaleString(), sub: 'received an initial service \u00b7 of ' + (_topFunnel ? _topFunnel.total : dataA.stats.subs).toLocaleString() + ' in FieldRoutes \u00b7 ' + dataA.stats.recurring.toLocaleString() + ' recurring', chartIds: ['sources', 'onetimeSubs', 'retiredSubs'] },
    { key: 'active',    label: 'Subscriptions Active',    value: (reportingActiveInclOneTime() ? dataA.stats.activeSubs : dataA.stats.activeRecurring).toLocaleString(), sub: reportingActiveInclOneTime() ? 'currently in service · incl. one-time' : 'currently in service · recurring', chartIds: ['activesubs', 'agreement'] },   // (Agreement Length Mix moved here from column 1, per Isaac)
    { key: 'customers', label: 'Customers Active',        value: (dataA.stats.activeCustomers != null ? dataA.stats.activeCustomers : dataA.stats.uniqueCustomers).toLocaleString(), sub: (dataA.stats.distinctActiveServices != null ? dataA.stats.distinctActiveServices : dataA.stats.distinctServices) + ' active services', chartIds: ['custDepth', 'tenure'] },   // (Active Customers donut retired, per Isaac; Services per Customer added)
    { key: 'arr',       label: 'Active ARR',              value: '$' + Math.round(dataA.stats.activeArr).toLocaleString(),   sub: 'from active recurring subs',                                        chartIds: ['rarr', 'rarrOffice'] },   // (One-Time Revenue donut folded into the One-Time Subscriptions toggle)
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
  const pickKey = COLUMN_CARDS.some(c => c.key === state.reportingOverviewMetric) ? state.reportingOverviewMetric : 'subs';
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
      sold: { label: 'Sold',     unit: 'contract value', col: 'Sold', color: '#16A34A', valOf: (r) => Number(r.subscription_contract_value) || 0, extra: 'Top service' },
      svc:  { label: 'Serviced', unit: 'ARR',            col: 'ARR',  color: '#2F5D62',       valOf: (r) => Number(r.annual_recurring_value) || 0,      extra: 'Top service' },
      cxl:  { label: 'Churned',  unit: 'ARR',            col: 'ARR',  color: '#DC2626',       valOf: (r) => Number(r.annual_recurring_value) || 0,      extra: 'Top reason' },
    };
    const totalOf = (k) => (sets[k] || []).reduce((a, r) => a + KINDS[k].valOf(r), 0);
    let kind = KINDS[initialKind] ? initialKind : 'sold';
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const th = (t, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
    const td = (t, o = {}) => el('td', { class: 'px-3 py-2 whitespace-nowrap tabular-nums ' + (o.right ? 'text-right' : 'text-left') + (o.bold ? ' font-black' : '') }, t);
    const top = (m) => { let k = null, n = 0; for (const [kk, v] of m) if (v > n) { k = kk; n = v; } return k ? k + ' (' + n + ')' : '—'; };
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
        td(isChurn ? top(g.reasons) : top(g.svc)));
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
      body.replaceChildren(
        el('div', { class: 'flex gap-2 flex-wrap' }, tile('sold'), tile('svc'), tile('cxl'), netTile),
        el('div', { class: 'text-[11px] text-muted-' }, K.label + ': ' + fmt.usd0(grand) + ' of ' + K.unit + ' across ' + fmt.int(rowsIn.length) + ' subscription' + (rowsIn.length === 1 ? '' : 's') + ' in ' + list.length + ' branch' + (list.length === 1 ? '' : 'es') + ' · click a branch for the accounts'),
        !rowsIn.length ? el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'Nothing ' + K.label.toLowerCase() + ' on this day.') :
        el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
          el('thead', {}, el('tr', {}, th('Branch'), th(K.col, true), th('Share', true), th(''), th('Subs', true), th('Avg / sub', true), th('Largest', true), th(K.extra))),
          el('tbody', {}, ...list.map(([k, g]) => row(k, g, false)), row('RIDD · Total', all, true)))));
    };
    render();
    overlay.append(el('div', { class: 'card p-5 flex flex-col gap-3', style: { width: 'min(980px, 94vw)', maxHeight: '88vh', overflow: 'auto' } },
      el('div', { class: 'flex items-start justify-between gap-3' },
        el('div', {}, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Daily pulse · by branch'),
          el('div', { class: 'text-lg font-black' }, longDate || dayLabel)),
        el('button', { class: 'text-xl leading-none', onclick: () => overlay.remove() }, '×')),
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
              label: (c) => ' ' + c.dataset.label + ': $' + Math.round(c.parsed.y).toLocaleString() } } },
          scales: { x: { ticks: { color: txt, maxTicksLimit: span > 30 ? 15 : 31 }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { color: txt, callback: v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) }, grid: { color: grid } } } },
      });
    }, 50);
    const stat = (label, v, color) => el('div', { class: 'text-right' },
      el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-base font-black tabular-nums', style: { color } }, fmt.usd0(v)));
    return el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-2' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, 'Daily Pulse' + (office !== 'all' ? ' · ' + officeLabel(office) : '')),
          el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } }, (single ? 'By branch: contract value SOLD (green) · ARR of accounts that received their first service (teal) · ARR that CHURNED (red). Click a bar for the day.' : 'Each day: contract value SOLD (green bars) · ARR of accounts that received their first service (teal) · ARR that CHURNED (red). Click a bar or point for the accounts.'))),
        el('div', { class: 'flex items-center gap-4 flex-wrap' },
          stat('Sold · ' + (single ? (spanRaw === 'today' ? 'today' : 'yesterday') : span + 'd'), sum(sold), C.sold), stat('Serviced', sum(serviced), C.svc), stat('Churned', sum(churned), C.cxl),
          el('select', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            onchange: (e) => { const v = e.target.value; state._rtPulseSpan = (v === 'today' || v === 'yesterday') ? v : Number(v); mountApp(); },
          }, ...[['today', 'Today'], ['yesterday', 'Yesterday'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => el('option', { value: String(v), selected: single ? spanRaw === v : span === v }, l))))),
      cvsWrap);
  })();

  return el('div', { class: 'flex flex-col gap-4' },
    filterBar,
    statsBlock,
    pulseCard,
    columnsBlock,
    chartGrid,
  );
}

