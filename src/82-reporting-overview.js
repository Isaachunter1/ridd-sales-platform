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
    { id: 'customers',  title: 'Active Customers',         subline: 'Distinct customers with at least one active sub',       totalLabel: 'Active customers',    sliceKey: 'customers' },
    { id: 'activesubs', title: 'Active Subscriptions',     subline: 'Currently in service · by subscription type',           totalLabel: 'Active subs',         sliceKey: 'activeSubs' },
    { id: 'aging',      title: 'Receivables Aging',        subline: (d) => 'Customer balances by age · $' + Math.round(d.stats.totalAR).toLocaleString() + ' total AR · ' + d.stats.pastDueCount.toLocaleString() + ' past due (31+ days)', totalLabel: 'Total AR',             formatValue: fmt.usd0, sliceKey: 'aging', preserveOrder: true },
    { id: 'pastdue',    title: 'Past Due Balances by Office', subline: (d) => '$' + Math.round(d.stats.pastDueAmount).toLocaleString() + ' past due (31+ days) · ' + d.stats.pastDuePct.toFixed(1) + '% of AR',      totalLabel: 'Past due $',           formatValue: fmt.usd0, sliceKey: 'pastDueOffice' },
    { id: 'tenure',     title: 'Customer Tenure',          subline: 'Subs by years since initial service',                    totalLabel: 'Subs',                sliceKey: 'tenure',    preserveOrder: true },
    { id: 'agreement',  title: 'Agreement Length Mix',     subline: 'Distribution by contract length (months)',               totalLabel: 'Subs w/ term',        sliceKey: 'agreement', preserveOrder: true },
    { id: 'cancels',    title: 'Cancellation Reasons',     subline: 'All canceled recurring subs',                            totalLabel: 'Cancellations',       sliceKey: 'cancels' },
    { id: 'sources',    title: 'Subscription Sources',     subline: 'Distribution of every visible subscription',             totalLabel: 'Subscriptions',       sliceKey: 'sources' },
    { id: 'onetimeSubs', title: 'One-Time Subscriptions',  subline: state._rtOneTimeRev ? 'Contract value of non-recurring subs \u00b7 by service' : 'Non-recurring subs by service type', totalLabel: state._rtOneTimeRev ? 'One-time revenue' : 'One-time subs', sliceKey: state._rtOneTimeRev ? 'onetimeRev' : 'onetimeSubs', formatValue: state._rtOneTimeRev ? fmt.usd0 : undefined,
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
    { id: 'onetimeRev',  title: 'One-Time Revenue',        subline: 'Contract value of non-recurring subs · by service',     totalLabel: 'One-time revenue',    formatValue: fmt.usd0, sliceKey: 'onetimeRev' },
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
    { key: 'customers', label: 'Customers Active',        value: (dataA.stats.activeCustomers != null ? dataA.stats.activeCustomers : dataA.stats.uniqueCustomers).toLocaleString(), sub: (dataA.stats.distinctActiveServices != null ? dataA.stats.distinctActiveServices : dataA.stats.distinctServices) + ' active services', chartIds: ['tenure'] },   // (Active Customers donut retired, per Isaac)
    { key: 'arr',       label: 'Active ARR',              value: '$' + Math.round(dataA.stats.activeArr).toLocaleString(),   sub: 'from active recurring subs',                                        chartIds: ['rarr', 'rarrOffice'] },   // (One-Time Revenue donut folded into the One-Time Subscriptions toggle)
    { key: 'cancels',   label: 'Subscriptions Cancelled', value: dataA.stats.realCancels.toLocaleString(),                   sub: dataA.stats.cancelRate.toFixed(2) + '% rate · recurring subs only',  chartIds: ['cancels', 'aging', 'pastdue'] },
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
  const openPulseBranchDrill = (title, rowsIn, valOf, unit, isChurn) => {
    const by = new Map();
    for (const r of rowsIn) { const k = (r.office_name || '').trim() || 'Unassigned'; if (!by.has(k)) by.set(k, { rows: [], total: 0, reasons: new Map(), svc: new Map() }); const g = by.get(k); g.rows.push(r); g.total += valOf(r);
      if (isChurn) { const re = reportingCancelReasonOf(r) || 'Unspecified'; g.reasons.set(re, (g.reasons.get(re) || 0) + 1); }
      const sv = String(r.subscription || '').trim() || '—'; g.svc.set(sv, (g.svc.get(sv) || 0) + 1); }
    const grand = rowsIn.reduce((a, r) => a + valOf(r), 0);
    const list = [...by.entries()].sort((a, b) => b[1].total - a[1].total);
    const top = (m) => { let k = null, n = 0; for (const [kk, v] of m) if (v > n) { k = kk; n = v; } return k ? k + ' (' + n + ')' : '—'; };
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const th = (t, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
    const td = (t, o = {}) => el('td', { class: 'px-3 py-2 whitespace-nowrap tabular-nums ' + (o.right ? 'text-right' : 'text-left') + (o.bold ? ' font-black' : '') }, t);
    const row = (k, g, bold) => el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95' + (bold ? ' font-bold' : ''), style: { borderColor: bold ? 'var(--border-2)' : 'var(--border)', background: bold ? 'var(--card-2)' : '' }, title: 'Click for the accounts',
      onclick: () => openReportingDrillModal({ chartTitle: 'Daily pulse · ' + title + ' · ' + k, sliceLabel: g.rows.length.toLocaleString() + ' subscription' + (g.rows.length === 1 ? '' : 's') + ' · ' + fmt.usd0(g.total), rows: g.rows, formatValue: fmt.usd0 }) },
      td(k, { bold }),
      td(fmt.usd0(g.total), { right: true, bold: true }),
      td(grand ? (g.total / grand * 100).toFixed(1) + '%' : '—', { right: true }),
      el('td', { class: 'px-3 py-2', style: { minWidth: '120px' } }, el('div', { style: { height: '6px', background: 'var(--card-2)' } }, el('div', { style: { height: '100%', width: (grand ? g.total / grand * 100 : 0) + '%', background: isChurn ? '#DC2626' : 'var(--accent)' } }))),
      td(fmt.int(g.rows.length), { right: true }),
      td(g.rows.length ? fmt.usd0(g.total / g.rows.length) : '—', { right: true }),
      td(fmt.usd0(Math.max(0, ...g.rows.map(valOf))), { right: true }),
      td(isChurn ? top(g.reasons) : top(g.svc)));
    const all = { rows: rowsIn, total: grand, reasons: new Map(), svc: new Map() };
    for (const [, g] of by) { for (const [k, v] of g.reasons) all.reasons.set(k, (all.reasons.get(k) || 0) + v); for (const [k, v] of g.svc) all.svc.set(k, (all.svc.get(k) || 0) + v); }
    overlay.append(el('div', { class: 'card p-5 flex flex-col gap-3', style: { width: 'min(980px, 94vw)', maxHeight: '88vh', overflow: 'auto' } },
      el('div', { class: 'flex items-start justify-between gap-3' },
        el('div', {}, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Daily pulse · by branch'),
          el('div', { class: 'text-lg font-black' }, title),
          el('div', { class: 'text-[11px] text-muted-' }, fmt.usd0(grand) + ' of ' + unit + ' across ' + fmt.int(rowsIn.length) + ' subscription' + (rowsIn.length === 1 ? '' : 's') + ' in ' + list.length + ' branch' + (list.length === 1 ? '' : 'es') + ' · click a branch for the accounts')),
        el('button', { class: 'text-xl leading-none', onclick: () => overlay.remove() }, '\u00d7')),
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Branch'), th(unit === 'ARR' ? 'ARR' : 'Sold', true), th('Share', true), th(''), th('Subs', true), th('Avg / sub', true), th('Largest', true), th(isChurn ? 'Top reason' : 'Top service'))),
        el('tbody', {}, ...list.map(([k, g]) => row(k, g, false)), row('RIDD · Total', all, true))))));
    document.body.append(overlay);
  };
  const pulseCard = (() => {
    const span = [7, 30, 90].includes(Number(state._rtPulseSpan)) ? Number(state._rtPulseSpan) : 30;
    const rows = reportingFilterByOffice(scope.visible, office);
    const { isRealCancel } = reportingFilters();
    const today = new Date();
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
    const C = { sold: '#DF643A', svc: '#5F6C5B', cxl: '#DC2626' };
    setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      const cvsEl = document.getElementById(id); if (!cvsEl) return;
      if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
      const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
      const lbl = days.map(d => { const dt = new Date(d + 'T00:00'); return (dt.getMonth() + 1) + '/' + dt.getDate(); });
      _chartInstances[id] = new Chart(cvsEl.getContext('2d'), {
        data: { labels: lbl, datasets: [
          { type: 'bar', label: 'Sold', data: sold, backgroundColor: C.sold, borderWidth: 0, order: 3 },
          { type: 'line', label: 'Serviced (new ARR)', data: serviced, borderColor: C.svc, backgroundColor: C.svc, borderWidth: 2, tension: 0.3, pointRadius: 2, order: 1 },
          { type: 'line', label: 'Churned (ARR)', data: churned, borderColor: C.cxl, backgroundColor: C.cxl, borderWidth: 2, tension: 0.3, pointRadius: 2, order: 2 },
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          onClick: (evt, els) => {
            if (!els || !els.length) return;
            const i = els[0].index, dsi = els[0].datasetIndex;
            const set = dsi === 0 ? soldRows[i] : dsi === 1 ? svcRows[i] : cxlRows[i];
            const what = dsi === 0 ? 'Sold' : dsi === 1 ? 'Serviced (first initial)' : 'Churned';
            const valOf = dsi === 0 ? (r) => Number(r.subscription_contract_value) || 0 : (r) => Number(r.annual_recurring_value) || 0;
            if (set.length) openPulseBranchDrill(what + ' · ' + lbl[i], set, valOf, dsi === 0 ? 'contract value' : 'ARR', dsi === 2);
          },
          plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } },
            tooltip: { callbacks: {
              // Long-form date in the tooltip title (per Isaac): "Wednesday, September 6th, 2026".
              title: (items) => { const i = items && items[0] ? items[0].dataIndex : -1; if (i < 0) return ''; const dt = new Date(days[i] + 'T00:00'); const n = dt.getDate(); const sfx = (n % 10 === 1 && n !== 11) ? 'st' : (n % 10 === 2 && n !== 12) ? 'nd' : (n % 10 === 3 && n !== 13) ? 'rd' : 'th'; return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long' }) + ' ' + n + sfx + ', ' + dt.getFullYear(); },
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
          el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } }, 'Each day: contract value SOLD (bars) · ARR of accounts that received their first service (green) · ARR that CHURNED (red). Click a bar or point for the accounts.')),
        el('div', { class: 'flex items-center gap-4 flex-wrap' },
          stat('Sold · ' + span + 'd', sum(sold), C.sold), stat('Serviced', sum(serviced), C.svc), stat('Churned', sum(churned), C.cxl),
          el('select', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            onchange: (e) => { state._rtPulseSpan = Number(e.target.value); mountApp(); },
          }, ...[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => el('option', { value: String(v), selected: span === v }, l))))),
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

