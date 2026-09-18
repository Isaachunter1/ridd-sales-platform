// ┌─ src/88-reporting-geographic.js ─────────────────────────────────────────────────────
// │ Reporting → Geographic (map, ZIP tables).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function reportingGeographic() {
  const gate = reportingDataGate();
  if (gate) return gate;
  // Time range only — the map itself is the office breakdown (per Isaac).
  const scope = reportingScope({ allOffices: true });
  const { scopeA, inCompare, office, officeLabel } = scope;
  const filterBar = reportingFilterBar(scope, { showOffice: false });

  // Geographic tab ignores compare-mode for now (a single map is hard
  // enough to read). Show a hint if the user is in compare mode.
  const compareNotice = inCompare ? el('div', {
    class: 'card p-3 text-xs',
    style: { background: 'var(--card-2)', color: 'var(--text-muted)' },
  }, 'Compare mode is paused on the map — showing data for Office A (' + officeLabel(office) + ') only. Exit compare to use the office filter normally.') : null;

  // Geographic tab shows the TRUE subscription footprint only:
  //   1. serviced — received an initial service, and
  //   2. recurring — real subscriptions (ARV > 0, or manually marked
  //      recurring in Configurations). One-time service types are excluded.
  // Other reporting tabs keep the full dataset.
  // Same recurring / active / real-cancel rules as the Overview tab
  // (reportingFilters) so the two pages agree — this tab used to run its
  // own Lifecycle-only recurring test and counted cancelled subs' ARV.
  // Base = every recurring sub in scope — the Overview's exact set — so
  // Subs / Active / Active ARR / Cancels tie to its cards. (The old
  // serviced-only gate dropped ~1,100 active subs with no initial-service
  // date on file and made every total run light.)
  const geoF = reportingFilters();
  const scopeServiced = scopeA.filter(r => geoF.isRecurring(r));
  const agg = reportingGeoAggregate(scopeServiced, geoF);

  // "Top Service" map metric — colors each area by its most common service.
  // Top 15 services (by volume) get distinct colors + a legend; everything
  // else rolls into a gray "Other".
  const svcCounts = {};
  for (const r of scopeServiced) { const k = r.subscription || 'Unknown'; svcCounts[k] = (svcCounts[k] || 0) + 1; }
  const svcTop = Object.keys(svcCounts).sort((a, b) => svcCounts[b] - svcCounts[a]).slice(0, 15);
  const svcColorMap = new Map(svcTop.map((s, i) => [s, REPORTING_PALETTE[i % REPORTING_PALETTE.length]]));

  // Service-area boundary (RIDD_SERVICE_AREAS) for the selected office. Drawn in
  // red on the ZIP map; the banner counts how many subs fall outside the line.
  const svcAreaZips = (() => {
    const names = office === 'all' ? Object.keys(RIDD_SERVICE_AREAS) : (RIDD_SERVICE_AREAS[office] ? [office] : []);
    const s = new Set();
    names.forEach(n => (RIDD_SERVICE_AREAS[n] || []).forEach(z => s.add(String(z).padStart(5, '0'))));
    return s;
  })();
  let svcOutBanner = null;
  if (svcAreaZips.size) {
    const redLine = el('span', { style: { display: 'inline-block', width: '22px', borderTop: '3px solid #e11d2e' } });
    if (office !== 'all' && RIDD_SERVICE_AREAS[office]) {
      let inN = 0, outN = 0;
      for (const r of scopeServiced) { (svcAreaZips.has(String(r.zip_code || '').slice(0, 5)) ? inN++ : outN++); }
      const tot = inN + outN;
      svcOutBanner = el('div', { class: 'card p-3 text-xs flex items-center gap-2 flex-wrap' },
        redLine,
        el('span', {}, office + ' service-area line in red — drill into the state to see it. '),
        el('b', {}, outN.toLocaleString() + ' of ' + tot.toLocaleString() + ' subs (' + (tot ? Math.round(100 * outN / tot) : 0) + '%) sit OUTSIDE the line.'),
      );
    }
    // (generic "lines shown in red" explainer retired — the red line on the
    // map speaks for itself; the office-specific out-of-area stat stays)
  }

  // Metric toggle — drives map color + table emphasis. Each metric is its own
  // tab so it can color the map independently.
  const metricKey = state.reportingGeoMetric || 'customers';
  const metrics = [
    { key: 'customers',       label: 'Customers',      fmt: (v) => Math.round(v).toLocaleString() },
    { key: 'subs',            label: 'Subscriptions',  fmt: (v) => Math.round(v).toLocaleString() },
    { key: 'revenue',         label: 'Revenue',        fmt: (v) => '$' + Math.round(v).toLocaleString() },
    { key: 'acv',             label: 'ACV',            fmt: (v) => '$' + Math.round(v).toLocaleString() },
    { key: 'attrition',       label: 'Attrition Rate', fmt: (v) => (v * 100).toFixed(1) + '%' },
    { key: 'retention',       label: 'Retention Rate', fmt: (v) => (v * 100).toFixed(1) + '%' },
    { key: 'service',         label: 'Service Types',  fmt: (v) => v || '—' },
  ];
  const isRetention = metricKey === 'retention';
  const activeMetric = metrics.find(m => m.key === metricKey) || metrics[0];

  const _phone = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
  const metricToggle = el('div', { class: 'p-3 flex items-center gap-2 flex-wrap', style: { borderBottom: '1px solid var(--border)' } },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Map metric'),
    // One dropdown everywhere (per Isaac, Sep 2026) — the seven-button row
    // is gone; the map can only color by one metric at a time anyway.
    el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer' + (_phone ? ' flex-1' : ''),
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: _phone ? undefined : '170px' },
      onchange: (e) => { state.reportingGeoMetric = e.target.value; mountApp(); },
    }, ...metrics.map(m => el('option', { value: m.key, selected: m.key === metricKey }, m.label))),
    el('div', { class: 'text-[10px] ml-auto', style: { color: 'var(--text-subtle)' } },
      (metricKey === 'attrition' || metricKey === 'retention') ? 'Uses 10+ sub floor per area · darker = '
          + (isRetention ? 'better retention' : 'higher attrition')
        : (metricKey === 'service' ? 'Only ZIPs with 11+ service types are colored · click one for its top 10' : '')),
  );

  // Legend for the Top Service metric — top 15 services + their colors.
  const svcLegend = metricKey === 'service' ? el('div', { class: 'p-3 flex items-center gap-x-4 gap-y-1.5 flex-wrap text-xs', style: { borderBottom: '1px solid var(--border)' } },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mr-1', style: { color: 'var(--text-subtle)' } }, 'Service types'),
    ...svcTop.map(s => el('div', { class: 'flex items-center gap-1.5' },
      el('span', { style: { display: 'inline-block', width: '11px', height: '11px', borderRadius: '0', background: svcColorMap.get(s) } }),
      el('span', {}, s + ' (' + svcCounts[s].toLocaleString() + ')'))),
    el('div', { class: 'flex items-center gap-1.5' },
      el('span', { style: { display: 'inline-block', width: '11px', height: '11px', borderRadius: '0', background: '#9aa0a6' } }),
      el('span', {}, 'Other')),
  ) : null;

  // Map container. A stable ID lets initReportingGeoMap tear down the
  // previous Leaflet instance before rebuilding on re-render.
  const mapId = 'reporting-geo-map';
  const mapEl = el('div', {
    id: mapId,
    style: { width: '100%', height: '500px', borderRadius: '0', overflow: 'hidden' },
  });

  const mapLevel = state.reportingMapLevel || 'country';
  const drilledState = state.reportingMapState;
  const drilledStateName = drilledState ? REPORTING_STATE_CODE_TO_NAME[drilledState] : null;
  // Within-state breakdown granularity. Only meaningful once drilled into a
  // state — the country view is always the state choropleth, so we pin it to
  // 'zip' there to keep the table in its original all-ZIPs form.
  const drillBy = (mapLevel === 'state' && drilledState) ? (state.reportingDrillBy || 'zip') : 'zip';

  // Country-level click → drill into that state. State-level click on a
  // ZIP polygon → open the per-customer drill modal.
  const onStateClick = (code) => {
    state.reportingMapLevel = 'state';
    state.reportingMapState = code;
    // Drop any stale highlight from a prior state so the new map
    // fits the whole state instead of an irrelevant ZIP.
    state.reportingHighlightedZip = null;
    mountApp();
  };
  // FULL-BRANCH DRILLS (per Isaac): offices cross state lines — Savannah
  // covers GA+SC, Myrtle Beach SC+NC — so a state drill includes every ZIP /
  // county belonging to an office with presence in that state, not just the
  // ones inside the border.
  const zipsForState = (code) => {
    const officesIn = new Set();
    for (const z of agg.zips) if (z.state === code) for (const r of z.rows) if (r.office_name) officesIn.add(r.office_name);
    return agg.zips.filter(z => z.state === code || z.rows.some(r => officesIn.has(r.office_name)));
  };
  const countiesForState = (code) => {
    const officesIn = new Set();
    for (const c of agg.counties) if (c.state === code) for (const r of c.rows) if (r.office_name) officesIn.add(r.office_name);
    return agg.counties.filter(c => c.state === code || c.rows.some(r => officesIn.has(r.office_name)));
  };
  // Area click → HIGH-LEVEL COMPARISON first (rank vs peers per metric);
  // the customer table is one click deeper inside that modal.
  const onZipClick = (z) => {
    if (metricKey === 'service') {
      openReportingServicesModal(z, 'ZIP ' + z.zip + ' · ' + (z.state || ''));
      return;
    }
    openReportingAreaStatsModal({
      area: z, kind: 'ZIP',
      peers: (mapLevel === 'state' && drilledState) ? zipsForState(drilledState) : agg.zips,
    });
  };
  const onCountyClick = (c) => {
    if (metricKey === 'service') {
      openReportingServicesModal(c, (c.county || 'Unknown') + ' County · ' + (c.state || ''));
      return;
    }
    openReportingAreaStatsModal({
      area: c, kind: 'County',
      peers: (mapLevel === 'state' && drilledState) ? countiesForState(drilledState) : agg.counties,
    });
  };

  // Defer map init so the canvas is in the DOM. Re-tries every 200ms
  // (up to 1s) in case Leaflet's deferred script hasn't loaded yet.
  let attempt = 0;
  const tryInit = () => {
    if (typeof L === 'undefined' || typeof turf === 'undefined') {
      // First geographic render: pull the map stack now, re-init when it
      // lands. The attempt cap only bounds the DOM-not-ready fallback.
      ensureMapLibs()
        .then(() => { if (attempt++ < 20) tryInit(); })
        .catch((e) => console.warn('[ridd] map libraries unavailable', e && e.message));
      return;
    }
    if (mapLevel === 'state' && drilledState) {
      if (drillBy === 'county') {
        const countiesInState = countiesForState(drilledState);
        initReportingCountyMap(
          mapId, drilledState, countiesInState,
          metricKey, activeMetric.label, activeMetric.fmt,
          onCountyClick,
          state.reportingHighlightedCounty,
          svcAreaZips,
          svcColorMap,
        );
      } else {
        const zipsInState = zipsForState(drilledState);
        initReportingZipMap(
          mapId, drilledState, zipsInState,
          metricKey, activeMetric.label, activeMetric.fmt,
          onZipClick,
          state.reportingHighlightedZip,
          svcAreaZips,
          svcColorMap,
        );
      }
    } else {
      initReportingGeoMap(mapId, agg.states, metricKey, activeMetric.label, activeMetric.fmt, onStateClick, svcColorMap);
    }
  };
  setTimeout(tryInit, 50);

  // Breadcrumb / back button — only visible when drilled into a state.
  // Also includes a "View all customers" shortcut so the user can pull
  // up the per-customer drill modal without first finding the right ZIP
  // on the map. Especially useful for states with only 1-2 subs where
  // the zip-level map is overkill.
  const stateSubsForBreadcrumb = mapLevel === 'state' && drilledState
    ? scopeServiced.filter(r => (r.state || '') === drilledState)
    : [];
  const zipsInDrilledState = mapLevel === 'state' && drilledState
    ? zipsForState(drilledState)
    : [];
  const countiesInDrilledState = mapLevel === 'state' && drilledState
    ? countiesForState(drilledState)
    : [];

  // Segmented By ZIP / By County toggle — only sensible once drilled into a
  // state, where it swaps both the map and the breakdown table below.
  const drillToggle = el('div', {
    class: 'flex items-center gap-0.5 rounded-lg p-0.5',
    style: { background: 'var(--card-2)', border: '1px solid var(--border)' },
  },
    ...[['zip', 'By ZIP'], ['county', 'By County']].map(([key, label]) => {
      const active = drillBy === key;
      return el('button', {
        class: 'px-2.5 py-1 rounded-md text-[11px] font-semibold transition hover:brightness-95',
        style: active
          ? { background: 'var(--accent)', color: 'var(--accent-text)' }
          : { background: 'transparent', color: 'var(--text-muted)' },
        onclick: () => {
          if ((state.reportingDrillBy || 'zip') === key) return;
          state.reportingDrillBy = key;
          // Drop both highlights so the freshly shown map fits the whole
          // state instead of zooming to a stale selection from the other mode.
          state.reportingHighlightedZip = null;
          state.reportingHighlightedCounty = null;
          mountApp();
        },
      }, label);
    }),
  );

  const breadcrumbUnitCount = drillBy === 'county' ? countiesInDrilledState.length : zipsInDrilledState.length;
  const breadcrumbUnitLabel = drillBy === 'county'
    ? (breadcrumbUnitCount === 1 ? ' county' : ' counties')
    : (' ZIP' + (breadcrumbUnitCount === 1 ? '' : 's'));
  const breadcrumb = mapLevel === 'state' && drilledState
    ? el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => {
            state.reportingMapLevel = 'country';
            state.reportingMapState = null;
            state.reportingHighlightedZip = null;
            state.reportingHighlightedCounty = null;
            mountApp();
          },
        }, '← Back to USA'),
        el('div', { class: 'text-xs flex-1', style: { color: 'var(--text-muted)', minWidth: '160px' } },
          el('span', { style: { color: 'var(--text-subtle)' } }, 'Viewing '),
          el('span', { class: 'font-semibold', style: { color: 'var(--text)' } }, drilledStateName || drilledState),
          el('span', { style: { color: 'var(--text-subtle)' } },
            ' · ' + breadcrumbUnitCount.toLocaleString() + breadcrumbUnitLabel
            + ' · ' + stateSubsForBreadcrumb.length.toLocaleString() + ' sub'
            + (stateSubsForBreadcrumb.length === 1 ? '' : 's')),
        ),
        drillToggle,
        stateSubsForBreadcrumb.length > 0 && el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border)' },
          onclick: () => openReportingDrillModal({
            chartTitle: drilledStateName || drilledState,
            sliceLabel: 'All customers',
            rows: stateSubsForBreadcrumb,
            formatValue: fmt.usd0,
          }),
        }, 'View all ' + stateSubsForBreadcrumb.length.toLocaleString() + ' sub'
           + (stateSubsForBreadcrumb.length === 1 ? '' : 's')),
      )
    : null;

  // ── Breakdown table ─────────────────────────────────────────────────
  // Mode-aware: county rows when drilled into a state with By County
  // selected, otherwise ZIP rows. Scoped to the drilled state at state
  // level so the table and map agree on what's being shown.
  const breakdown = drillBy === 'county'
    ? {
        labelCol: 'County', labelKey: 'county',
        title: 'County-level breakdown', nounPlural: 'counties',
        items: countiesInDrilledState,
        cellLabel: (it) => it.county || 'Unknown',
        drillTitle: (it) => (it.county || 'Unknown') + ' County · ' + (it.state || ''),
        applyHighlight: (it) => {
          state.reportingDrillBy = 'county';
          state.reportingHighlightedCounty = it.county;
          state.reportingHighlightedZip = null;
        },
      }
    : {
        labelCol: 'ZIP', labelKey: 'zip',
        title: 'ZIP-level breakdown', nounPlural: 'ZIPs',
        items: (mapLevel === 'state' && drilledState) ? zipsInDrilledState : agg.zips,
        cellLabel: (it) => it.zip,
        drillTitle: (it) => 'ZIP ' + it.zip + ' · ' + (it.state || ''),
        applyHighlight: (it) => {
          state.reportingDrillBy = 'zip';
          state.reportingHighlightedZip = it.zip;
          state.reportingHighlightedCounty = null;
        },
      };

  // Office dropdown on the breakdown (per Isaac): All (default) or one
  // branch. Filtering re-aggregates that branch's rows so a border ZIP shows
  // only the selected office's accounts, not the majority office's.
  const bOffices = [...new Set(scopeServiced.map(r => (r.office_name || '').trim()).filter(Boolean))].sort();
  const bOffice = bOffices.includes(state.reportingGeoBreakdownOffice) ? state.reportingGeoBreakdownOffice : 'all';
  if (bOffice !== 'all') {
    const bAgg = reportingGeoAggregate(scopeServiced.filter(r => (r.office_name || '').trim() === bOffice), geoF);
    const inState = (it) => !(mapLevel === 'state' && drilledState) || it.state === drilledState;
    breakdown.items = (breakdown.labelKey === 'county' ? bAgg.counties : bAgg.zips).filter(inState);
  }
  const bOfficeSel = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer font-semibold',
    style: { borderColor: bOffice !== 'all' ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: bOffice !== 'all' ? 'var(--accent)' : 'var(--text)' },
    title: 'Limit the table to one branch\u2019s accounts',
    onchange: (e) => { state.reportingGeoBreakdownOffice = e.target.value; mountApp(); },
  },
    el('option', { value: 'all', selected: bOffice === 'all' }, 'All offices'),
    ...bOffices.map(o => el('option', { value: o, selected: bOffice === o }, _mktgTC(o))));

  let sortKey = state.reportingZipSort || 'subs';
  const sortDir = state.reportingZipSortDir || 'desc';
  // If the active sort column is the *other* mode's label column, fall back
  // to subs — sorting county rows by a missing 'zip' field (or vice versa)
  // would silently render an unsorted table.
  if ((sortKey === 'zip' || sortKey === 'county') && sortKey !== breakdown.labelKey) sortKey = 'subs';
  const sortedItems = [...breakdown.items].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === bv) return 0;
    return (sortDir === 'asc' ? 1 : -1) * (av < bv ? -1 : 1);
  });

  // Hover descriptors for every column (per Isaac).
  const HEADER_TIPS = {
    zip: 'Five-digit ZIP code. Click a row to see how it compares and drill to its customers.',
    county: 'County. Click a row to see how it compares and drill to its customers.',
    state: 'State the area sits in.',
    office: 'The branch that services most of this area\u2019s subscriptions.',
    customers: 'Distinct customers with a recurring subscription here.',
    subs: 'Recurring subscriptions (a customer with two plans counts twice) \u2014 the same set the Overview counts.',
    avgContract: 'Average contract value per subscription.',
    arv: 'Active ARR \u2014 annual recurring revenue from the active subscriptions here (same figure as the Overview card).',
    cancellations: 'Real cancels — excludes the cancel reasons marked as not-attrition in Configurations.',
    cancelRate: (isRetention ? 'Retention = 1 \u2212 cancels \u00f7 subs' : 'Attrition = cancels \u00f7 subs') + '. Only shown with 10+ subs so a single cancel can\u2019t swing it.',
    avgTenure: 'Average months each subscription has been on the books \u2014 first service to cancel date, or to today if still active.',
    twoYrPct: 'Share of subscriptions that have lasted 24 months or more. Higher = stickier area.',
    sentriconPct: 'Share of customers here that have a Sentricon (termite) plan on their account.',
    ltv: 'Realized recurring revenue per customer: each sub\u2019s ARV \u00f7 12 \u00d7 months on the books, summed, \u00f7 distinct customers.',
  };
  const tableHeader = (label, key, alignRight) => {
    const isActive = sortKey === key;
    return el('th', {
      class: 'px-3 py-2 font-semibold cursor-pointer select-none' + ' text-left',
      title: (HEADER_TIPS[key] || '') + ' Click to sort.',
      style: { background: 'var(--card-2)', color: isActive ? 'var(--accent)' : undefined, fontWeight: isActive ? '800' : undefined },
      onclick: () => {
        if (state.reportingZipSort === key) {
          state.reportingZipSortDir = state.reportingZipSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.reportingZipSort = key;
          state.reportingZipSortDir = 'desc';
        }
        mountApp();
      },
    }, label);
  };

  const fmtPctTable = (z) => {
    if (!z.attritionEligible) {
      return el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '< 10 subs');
    }
    const v = isRetention ? (1 - z.cancelRate) : z.cancelRate;
    return el('span', {}, (v * 100).toFixed(1) + '%');
  };

  const exportScopeTag = (mapLevel === 'state' && drilledState) ? drilledState : 'all';
  const breakdownTable = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'p-4 border-b flex items-start justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'min-w-0' },
        el('div', { class: 'flex items-baseline gap-2 flex-wrap' },
          el('h2', { class: 'text-lg font-bold' }, breakdown.title),
          el('span', { class: 'text-[11px] font-semibold tabular-nums', style: { color: 'var(--accent)' }, title: 'Distinct ' + breakdown.nounPlural + ' with at least one recurring subscription' },
            sortedItems.length.toLocaleString() + ' distinct ' + breakdown.nounPlural)),
      ),
      el('div', { class: 'flex items-center gap-2 shrink-0' },
        bOfficeSel,
        el('button', {
          class: 'shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          title: 'Download these ' + breakdown.nounPlural + ' as a CSV (account counts per ' + (breakdown.labelKey === 'county' ? 'county' : 'ZIP') + ')',
          onclick: () => exportReportingGeoCsv(sortedItems, breakdown.labelKey, exportScopeTag + (bOffice !== 'all' ? '-' + bOffice.toLowerCase().replace(/\s+/g, '_') : '')),
        }, '⬇ Export CSV')),
    ),
    el('div', { style: { overflow: 'auto', maxHeight: '500px' } },
      el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider sticky top-0', style: { background: 'var(--card-2)', color: 'var(--text-muted)', zIndex: 2 } },
          el('tr', {},
            el('th', { class: 'px-3 py-2 font-semibold text-left', style: { background: 'var(--card-2)', width: '40px', position: 'sticky', left: 0, zIndex: 3 } }, '#'),
            (() => { const h = tableHeader(breakdown.labelCol, breakdown.labelKey); Object.assign(h.style, { position: 'sticky', left: '40px', zIndex: 3, boxShadow: '1px 0 0 var(--border)' }); return h; })(),
            tableHeader('State',       'state'),
            tableHeader('Office',      'office'),
            tableHeader('Customers',   'customers',  true),
            tableHeader('Subs',        'subs',       true),
            tableHeader('ACV',         'avgContract', true),
            tableHeader('Active ARR',  'arv',         true),
            tableHeader('Cancels',     'cancellations', true),
            tableHeader(isRetention ? 'Retention %' : 'Attrition %', 'cancelRate',  true),
            tableHeader('Avg Tenure',  'avgTenure',   true),
            tableHeader('2yr+ %',      'twoYrPct',    true),
            tableHeader('Sentricon %', 'sentriconPct', true),
            tableHeader('LTV / Cust',  'ltv',         true),
          ),
        ),
        el('tbody', {},
          // 𝕽 RIDD — everything in the table rolled up (per Isaac, like the leaderboards).
          (() => {
            const T = reportingGeoTotal(sortedItems);
            if (!T.subs) return null;
            const td = (v, cls) => el('td', { class: 'px-3 py-2 text-left font-black ' + (cls || '') }, v);
            return el('tr', { class: 'tabular-nums', style: { background: 'var(--card-2)', boxShadow: 'inset 0 -2px 0 var(--border-2)' } },
              el('td', { class: 'px-3 py-2 text-base leading-none', style: { fontFamily: 'Georgia, "Times New Roman", serif', position: 'sticky', left: 0, zIndex: 1, background: 'var(--card-2)' } }, '\ud835\udd7d'),
              el('td', { class: 'px-3 py-2 text-left font-black', style: { position: 'sticky', left: '40px', zIndex: 1, background: 'var(--card-2)', boxShadow: '1px 0 0 var(--border)' } }, 'RIDD'), td('All'), td(bOffice !== 'all' ? _mktgTC(bOffice) : 'All'),
              td(T.customers.toLocaleString()), td(T.subs.toLocaleString()),
              td('$' + Math.round(T.avgContract).toLocaleString()), td('$' + Math.round(T.arv).toLocaleString()),
              td(T.cancellations.toLocaleString()),
              td(((isRetention ? 1 - T.cancelRate : T.cancelRate) * 100).toFixed(1) + '%'),
              td(T.avgTenure ? T.avgTenure.toFixed(1) + ' mo' : '\u2014'), td(Math.round(T.twoYrPct * 100) + '%'),
              td(Math.round(T.sentriconPct * 100) + '%'), td('$' + Math.round(T.ltv).toLocaleString()));
          })(),
          ...sortedItems.map((it, i) => el('tr', {
            class: 'border-t cursor-pointer hover:brightness-95 transition tabular-nums',
            style: { borderColor: 'var(--border)' },
            // Row click does three things in order:
            //   1. Drill the map to the row's state (if not already)
            //   2. Highlight that row's polygon (ZIP or county) + zoom to it
            //   3. Open the customer drill modal
            // Re-renders the tab before opening the modal so the map
            // updates underneath are visible when the user closes it.
            onclick: () => {
              if (it.state) {
                state.reportingMapLevel = 'state';
                state.reportingMapState = it.state;
              }
              breakdown.applyHighlight(it);
              mountApp();
              openReportingAreaStatsModal({
                area: it,
                kind: breakdown.labelKey === 'county' ? 'County' : 'ZIP',
                peers: breakdown.items,
              });
            },
          },
            el('td', { class: 'px-3 py-2 text-muted-', style: { position: 'sticky', left: 0, zIndex: 1, background: 'var(--card)' } }, String(i + 1)),
            el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap', style: { position: 'sticky', left: '40px', zIndex: 1, background: 'var(--card)', boxShadow: '1px 0 0 var(--border)' } }, breakdown.cellLabel(it)),
            el('td', { class: 'px-3 py-2' }, it.state || '—'),
            el('td', { class: 'px-3 py-2 whitespace-nowrap', title: 'Branch servicing most of this area\u2019s subs' }, it.office ? _mktgTC(it.office) : '—'),
            el('td', { class: 'px-3 py-2 text-left' }, it.customers.toLocaleString()),
            el('td', { class: 'px-3 py-2 text-left' }, it.subs.toLocaleString()),
            el('td', { class: 'px-3 py-2 text-left' }, '$' + Math.round(it.avgContract).toLocaleString()),
            el('td', { class: 'px-3 py-2 text-left' }, '$' + Math.round(it.arv).toLocaleString()),
            el('td', { class: 'px-3 py-2 text-left' }, it.cancellations.toLocaleString()),
            el('td', { class: 'px-3 py-2 text-left' }, fmtPctTable(it)),
            el('td', { class: 'px-3 py-2 text-left', title: 'Average months on the books (first service → cancel, or → today if still active)' }, it.avgTenure ? it.avgTenure.toFixed(1) + ' mo' : '—'),
            el('td', { class: 'px-3 py-2 text-left', title: 'Share of subs that have lasted 24+ months' }, it.subs ? Math.round(it.twoYrPct * 100) + '%' : '—'),
            el('td', { class: 'px-3 py-2 text-left', title: 'Share of customers with a Sentricon plan' }, it.customers ? Math.round(it.sentriconPct * 100) + '%' : '—'),
            el('td', { class: 'px-3 py-2 text-left font-semibold', title: 'Realized recurring revenue per customer — ARV ÷ 12 × months on the books' }, it.ltv ? '$' + Math.round(it.ltv).toLocaleString() : '—'),
          )),
        ),
      ),
    ),
  );

  // ── State-by-state summary (country level only) ─────────────────────
  // Answers "how does THIS branch do in NC vs SC?" — set the office filter
  // and each row is that branch's book within one state. Attrition/retention
  // uses the same 10-sub floor as everywhere else on the tab.
  const stateSummaryTable = (mapLevel !== 'state') ? (() => {
    // Office (default) ⇄ State — per Isaac. Same columns either way.
    const summaryBy = state.reportingGeoSummaryBy === 'state' ? 'state' : 'office';
    const rows = summaryBy === 'state'
      ? Object.entries(agg.states || {})
          .filter(([code]) => code && code !== 'Unknown')
          .map(([code, s]) => ({ code, name: REPORTING_STATE_CODE_TO_NAME[code] || code, ...s }))
          .sort((a, b) => b.subs - a.subs)
      : Object.entries(agg.offices || {})
          .map(([name, s]) => ({ code: null, name: name === 'Unknown' ? 'No office' : _mktgTC(name), _unknown: name === 'Unknown', ...s }))
          .sort((a, b) => (a._unknown - b._unknown) || (b.subs - a.subs));
    if (rows.length < 1) return null;
    const floor = (agg.attritionMinSubs || 10);
    const byToggle = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...[['office', 'Office'], ['state', 'State']].map(([v, l]) => el('button', {
        class: 'px-2.5 py-1 text-[11px] font-bold transition',
        style: summaryBy === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
        onclick: () => { state.reportingGeoSummaryBy = v; mountApp(); },
      }, l)));
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'p-4 border-b flex items-start gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex-1 min-w-0' },
          el('h2', { class: 'text-lg font-bold' }, summaryBy === 'state' ? 'State breakdown' : 'Office breakdown')),
        byToggle),
      el('div', { style: { overflow: 'auto', maxHeight: '70vh' } },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)', position: 'sticky', top: 0, zIndex: 2 } },
            el('tr', {},
              el('th', { class: 'px-3 py-2 text-left font-semibold', style: { position: 'sticky', left: 0, zIndex: 3, background: 'var(--card-2)', boxShadow: '1px 0 0 var(--border)' }, title: summaryBy === 'state' ? 'Click a row to drill the map into that state' : 'Branch' }, summaryBy === 'state' ? 'State' : 'Office'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Distinct customers with a recurring subscription' }, 'Customers'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Recurring subscriptions (same set as the Overview)' }, 'Subs'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Subscriptions currently active (status Active, no cancel date)' }, 'Active'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Average contract value per subscription' }, 'ACV'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Active ARR \u2014 annual recurring revenue from active subs (same figure as the Overview card)' }, 'Active ARR'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Real cancels (excluded reasons from Configurations don\u2019t count)' }, 'Cancels'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: isRetention ? 'Retention = 1 \u2212 cancels \u00f7 subs (10+ subs)' : 'Attrition = cancels \u00f7 subs (10+ subs)' }, isRetention ? 'Retention %' : 'Attrition %'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Active subs ÷ all subs' }, 'Active %'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Average months on the books' }, 'Avg Tenure'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Share of subs past 24 months' }, '2yr+ %'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Share of customers with a Sentricon (termite) plan on their account' }, 'Sentricon %'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: 'Realized recurring revenue per customer' }, 'LTV / Cust'),
              el('th', { class: 'px-3 py-2 text-left font-semibold', title: summaryBy === 'state' ? 'Branches servicing this state, biggest first' : 'States this branch services, biggest first' }, summaryBy === 'state' ? 'Offices' : 'States'))),
          el('tbody', {},
            (() => {
              const T = reportingGeoTotal(rows);
              if (!T.subs) return null;
              const td = (v, o = {}) => el('td', { class: 'px-3 py-2 text-left font-black', style: o.style || {} }, v);
              return el('tr', { class: 'tabular-nums', style: { background: 'var(--card-2)', boxShadow: 'inset 0 -2px 0 var(--border-2)' } },
                td('RIDD', { style: { position: 'sticky', left: 0, zIndex: 1, background: 'var(--card-2)', boxShadow: '1px 0 0 var(--border)' } }),
                td(T.customers.toLocaleString()), td(T.subs.toLocaleString()), td(T.active.toLocaleString()),
                td('$' + Math.round(T.avgContract).toLocaleString()), td('$' + Math.round(T.arv).toLocaleString()),
                td(T.cancellations.toLocaleString()),
                td(((isRetention ? 1 - T.cancelRate : T.cancelRate) * 100).toFixed(1) + '%'),
                td(T.subs ? Math.round(T.active / T.subs * 100) + '%' : '\u2014'),
                td(T.avgTenure ? T.avgTenure.toFixed(1) + ' mo' : '\u2014'), td(Math.round(T.twoYrPct * 100) + '%'),
                td(Math.round(T.sentriconPct * 100) + '%'), td('$' + Math.round(T.ltv).toLocaleString()),
                td(rows.length + (summaryBy === 'state' ? ' states' : ' offices')));
            })(),
            ...rows.map(s => {
              const rated = s.subs >= floor;
              const v = isRetention ? (1 - s.cancelRate) : s.cancelRate;
              return el('tr', {
                class: 'border-t tabular-nums' + (s.code ? ' cursor-pointer hover:brightness-95 transition' : ''),
                style: { borderColor: 'var(--border)' },
                title: s.code ? 'Drill into ' + s.name : '',
                onclick: s.code ? () => onStateClick(s.code) : undefined,
              },
                el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, zIndex: 1, background: 'var(--card)', boxShadow: '1px 0 0 var(--border)' } }, s.name),
                el('td', { class: 'px-3 py-2 text-left' }, s.customers.toLocaleString()),
                el('td', { class: 'px-3 py-2 text-left' }, s.subs.toLocaleString()),
                el('td', { class: 'px-3 py-2 text-left' }, s.active.toLocaleString()),
                el('td', { class: 'px-3 py-2 text-left' }, '$' + Math.round(s.avgContract).toLocaleString()),
                el('td', { class: 'px-3 py-2 text-left' }, '$' + Math.round(s.arv).toLocaleString()),
                el('td', { class: 'px-3 py-2 text-left' }, s.cancellations.toLocaleString()),
                el('td', { class: 'px-3 py-2 text-left font-semibold', style: rated && !isRetention && s.cancelRate > 0.25 ? { color: '#DC2626' } : {} },
                  rated ? (v * 100).toFixed(1) + '%' : el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '< ' + floor + ' subs')),
                el('td', { class: 'px-3 py-2 text-left' }, s.subs ? Math.round(s.active / s.subs * 100) + '%' : '—'),
                el('td', { class: 'px-3 py-2 text-left' }, s.avgTenure ? s.avgTenure.toFixed(1) + ' mo' : '—'),
                el('td', { class: 'px-3 py-2 text-left' }, s.subs ? Math.round((s.twoYrPct || 0) * 100) + '%' : '—'),
                el('td', { class: 'px-3 py-2 text-left' }, s.customers ? Math.round((s.sentriconPct || 0) * 100) + '%' : '—'),
                el('td', { class: 'px-3 py-2 text-left font-semibold' }, s.ltv ? '$' + Math.round(s.ltv).toLocaleString() : '—'),
                el('td', { class: 'px-3 py-2 whitespace-nowrap text-muted-' }, (() => {
                  const c = new Map();
                  for (const r of (s.rows || [])) { const o = summaryBy === 'state' ? r.office_name : (r.state || ''); c.set(o, (c.get(o) || 0) + 1); }
                  const ents = [...c.entries()].sort((a, b) => b[1] - a[1]);
                  if (!ents.length) return '\u2014';
                  // Phones: just the count — tap for a table of the states (each
                  // row opens the customer drill), so the column stays narrow.
                  if (_phone) {
                    return el('button', {
                      class: 'px-1.5 py-0.5 rounded text-[10px] font-semibold',
                      style: { background: 'var(--card-2)', border: '1px solid var(--border-2)', color: 'var(--text)' },
                      onclick: (e) => {
                        e.stopPropagation();
                        const overlay = el('div', { class: 'modal-overlay' });
                        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
                        const unitLabel = summaryBy === 'state' ? 'office' : 'state';
                        overlay.append(el('div', { class: 'card p-4 flex flex-col gap-3', style: { width: 'min(520px, 94vw)', maxHeight: '85vh', overflow: 'auto' } },
                          el('div', { class: 'flex items-start justify-between gap-3' },
                            el('div', {}, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, s.name), el('div', { class: 'text-lg font-black' }, ents.length + ' ' + unitLabel + (ents.length === 1 ? '' : 's'))),
                            el('button', { class: 'text-xl leading-none', onclick: () => overlay.remove() }, '×')),
                          el('table', { class: 'w-full text-xs' },
                            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } }, el('tr', {}, el('th', { class: 'py-1 text-left' }, unitLabel), el('th', { class: 'py-1 text-right' }, 'Subs'), el('th', { class: 'py-1 text-right' }, 'Active ARR'))),
                            el('tbody', {}, ...ents.map(([o, n]) => {
                              const rs = (s.rows || []).filter(r => (summaryBy === 'state' ? r.office_name : (r.state || '')) === o);
                              const arr = rs.reduce((a, r) => a + ((typeof reportingFilters === 'function' && reportingFilters().isActive(r)) ? (Number(r.annual_recurring_value) || 0) : 0), 0);
                              return el('tr', { class: 'border-t cursor-pointer', style: { borderColor: 'var(--border)' }, onclick: () => openReportingDrillModal({ chartTitle: s.name + ' \u2014 customers filed under ' + (o || 'no ' + unitLabel), sliceLabel: rs.length.toLocaleString() + ' subscription' + (rs.length === 1 ? '' : 's'), rows: rs, formatValue: fmt.usd0 }) },
                                el('td', { class: 'py-1.5 font-semibold' }, o || '??'), el('td', { class: 'py-1.5 text-right tabular-nums' }, n.toLocaleString()), el('td', { class: 'py-1.5 text-right tabular-nums' }, '$' + Math.round(arr).toLocaleString()));
                            })))));
                        document.body.append(overlay);
                      },
                    }, ents.length + ' ' + (summaryBy === 'state' ? 'office' : 'state') + (ents.length === 1 ? '' : 's'));
                  }
                  // Office view: every state is a chip → click for the customers
                  // filed under it (per Isaac — spotting wrong states in the CRM).
                  return el('span', { class: 'flex items-center gap-1 flex-wrap' }, ...ents.map(([o, n]) => summaryBy === 'state'
                    ? el('span', {}, _mktgTC(o))
                    : el('button', {
                        class: 'px-1.5 py-0.5 rounded text-[10px] font-semibold transition hover:brightness-95',
                        style: { background: 'var(--card-2)', border: '1px solid var(--border-2)', color: 'var(--text)' },
                        title: n.toLocaleString() + ' sub' + (n === 1 ? '' : 's') + ' filed under ' + (o || 'no state') + ' \u2014 click to see the customers',
                        onclick: (e) => {
                          e.stopPropagation();
                          const rows = (s.rows || []).filter(r => (r.state || '') === o);
                          openReportingDrillModal({ chartTitle: s.name + ' \u2014 customers filed under ' + (o || 'no state'), sliceLabel: rows.length.toLocaleString() + ' subscription' + (rows.length === 1 ? '' : 's'), rows, formatValue: fmt.usd0 });
                        },
                      }, (o || '??') + ' \u00b7 ' + n.toLocaleString())));
                })()));
            })))));
  })() : null;

  return el('div', { class: 'flex flex-col gap-4' },
    filterBar,
    compareNotice,
    svcOutBanner,
    breadcrumb,
    // Metric picker (and service legend) live INSIDE the map card — they only
    // drive the map, so they sit flush on top of it.
    el('div', { class: 'card overflow-hidden' }, metricToggle, svcLegend, mapEl),
    stateSummaryTable,
    breakdownTable,
  );
}

