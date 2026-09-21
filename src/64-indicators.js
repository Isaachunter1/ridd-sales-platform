// ┌─ src/64-indicators.js ─────────────────────────────────────────────────────
// │ Indicators tab: branch/team/rep tables, power ranking, leaderboard, records, class metrics.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewIndicators() {
  if (!state.indicatorsData) state.indicatorsData = null;
  // Weekly mode retired — the preset dropdown (This Year default) drives the
  // whole tab. 'weekly' state from older sessions heals to range here.
  state.indicatorsView = 'range';
  // Rep accounts: apply their ✏️ Customize default date range once per
  // session (before any window math runs).
  if (!isAdminRole(state.profile && state.profile?.role) && !state._repDateDefaultApplied) {
    state._repDateDefaultApplied = true;
    try { const _pl = _repLayoutPrefs(); if (_pl.dateDefault) state.indicatorsRangePreset = _pl.dateDefault; } catch { /* fresh */ }
  }
  // Pull the newest shared upload (any admin's) — throttled to one check
  // every 2 minutes; re-renders automatically if something fresher exists.
  refreshIndicatorsFromCloud();
  // (The keep-fresh watcher that used to live here is now GLOBAL — installed
  // in mountApp for every view, since the War Room and Sales tabs read the
  // same CRM dataset and PWAs never reboot on their own.)
  // Migration: legacy 'cumulative' becomes the new YTD-default 'range' mode
  if (state.indicatorsView === 'cumulative') state.indicatorsView = 'range';
  // Migrate old preset ids (ytd / since_mar1 / 90d / 60d / 30d) to the new
  // labeled set so saved demos don't crash on load.
  const VALID_PRESETS = new Set(INDICATOR_RANGE_PRESETS.map(p => p.id));
  if (!state.indicatorsRangePreset || (!VALID_PRESETS.has(state.indicatorsRangePreset) && !/^year:\d{4}$/.test(state.indicatorsRangePreset))) {
    state.indicatorsRangePreset = 'this_year';
  }
  if (state.indicatorsCustomStart == null) state.indicatorsCustomStart = '';
  if (state.indicatorsCustomEnd   == null) state.indicatorsCustomEnd   = '';
  if (state.indicatorsWeek == null) state.indicatorsWeek = -1; // -1 = latest
  if (!state.indicatorsGroupBy) state.indicatorsGroupBy = 'branch';

  // No data yet — Indicators now come from the RevHawk sync, not a CSV upload.
  if (!state.indicatorsData || !state.indicatorsData.length) {
    const _admin = isAdminRole(state.profile?.role);
    // Rep-UX audit #7: force ONE immediate pull (throttle bypassed) instead
    // of stranding a fresh device on a "wait for the next run" message.
    if (!state._indEmptyPulled && typeof refreshIndicatorsFromCloud === 'function') {
      state._indEmptyPulled = true;
      refreshIndicatorsFromCloud(true).catch(() => {});
    }
    return el('div', { class: 'flex flex-col gap-5 w-full' },
      el('h1', { class: 'text-2xl font-bold' }, 'Indicators'),
      el('div', { class: 'card p-10 text-center' },
        el('div', { class: 'text-4xl mb-3' }, '📊'),
        el('h2', { class: 'text-lg font-bold mb-2' },
          typeof DecompressionStream === 'undefined' ? 'This browser is too old for RIDD data' : 'Loading the latest data\u2026'),
        el('p', { class: 'text-sm text-muted- mb-4 max-w-md mx-auto' },
          // Old Safari (iOS < 16.4) can't decompress the snapshots — the old
          // copy said "Loading\u2026" forever. Say the truth + the fix.
          typeof DecompressionStream === 'undefined'
            ? 'Update this device (Settings \u2192 General \u2192 Software Update) or open the app in Chrome \u2014 this browser can\u2019t unpack the synced dataset.'
            : _admin
            ? 'Pulling the shared dataset now \u2014 this page refreshes itself. Indicators also sync automatically from RevHawk every hour on the hour.'
            : 'Pulling the shared dataset now \u2014 this page refreshes itself. If it never loads, ask an admin to check that the rep data access SQL (nrla_rep_access.sql) has been run.'),
      ),
    );
  }

  // Branch-vs-Teams aggregation. When grouping by Teams, we re-aggregate the
  // raw sales by team and reuse them everywhere `data`/`branches` are consumed
  // (table, charts, rankings). Teams mode requires raw sales — falls back
  // gracefully to Branch mode otherwise.
  const rawSalesAvailable = Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length > 0;
  // Company rollup (RPS / RPC) is ADMIN-ONLY — heal the state for anyone else.
  if (state.indicatorsGroupBy === 'company' && !isAdminRole(state.profile?.role)) state.indicatorsGroupBy = 'branch';
  // Department grouping was retired from the filters panel (per Isaac). Heal
  // any saved preset or persisted session still holding it, otherwise the
  // page would sit in a mode the dropdown can no longer show or leave.
  if (state.indicatorsGroupBy === 'dept') state.indicatorsGroupBy = 'branch';
  // Partners / team leads (per Isaac, Sep 2026): the table + Power Ranking
  // open in TEAMS mode — a partner's team may sell across offices, so the
  // branch column is the wrong lens. Once per session; the Group filter
  // still lets them switch to branches.
  if (!state._indPartnerGroupInit && rawSalesAvailable && !state.indicatorsComps
      && ((typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role)) || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role)))) {
    state._indPartnerGroupInit = true;
    state.indicatorsGroupBy = 'teams';
  }
  const wantTeams = state.indicatorsGroupBy === 'teams';
  const wantDept  = state.indicatorsGroupBy === 'dept';
  const wantCompany = state.indicatorsGroupBy === 'company';
  // Comps are a BRANCH-level competition — Teams/Department modes are locked
  // out while Comps is on (you compete by branch).
  const groupBy = (rawSalesAvailable && !state.indicatorsComps)
    ? (wantTeams ? 'teams' : wantDept ? 'dept' : wantCompany ? 'company' : 'branch')
    : 'branch';
  // If teams/dept/company mode can't run (no raw sales cached), heal the
  // stale state so labels + header colors render in branch form.
  if ((wantTeams || wantDept || wantCompany) && !rawSalesAvailable) state.indicatorsGroupBy = 'branch';

  let allData;
  if (groupBy === 'teams') {
    allData = aggregateByTeam(indicatorSales(), state.indicatorsData);
  } else if (groupBy === 'company') {
    allData = aggregateByCompany(indicatorSales(), state.indicatorsData);
  } else if (groupBy === 'dept') {
    allData = aggregateByDept(indicatorSales(), state.indicatorsData);
  } else if (rawSalesAvailable) {
    // Re-aggregate from raw sales (rather than using the pre-computed
    // state.indicatorsData) so that Excluded reps drop out of EVERY branch
    // metric — table, charts, ranking. Pre-aggregated CSVs without raw sales
    // can't apply the exclusion (no rep info per row), so they fall back.
    allData = aggregateByBranch(indicatorSales(), state.indicatorsData);
  } else {
    allData = state.indicatorsData;
  }
  const allWeeks = [...new Set(allData.map(r => r.week))].sort((a, b) => a - b);
  // In team mode the synthetic "Unassigned" group stays in the by-team
  // table (so its rows + the RIDD total still include reps without a
  // team), but it's filtered out of `rankableBranches` below so it
  // doesn't get scored. Reps without a team are still visible in Manage
  // Teams' "(unassigned)" filter so admins can fix them.
  const branches = [...new Set(allData.map(r => r.branch))].sort();
  const isRange = state.indicatorsView === 'range';

  // Range bounds (only used when view === 'range')
  const rangeBounds = indicatorRangeBounds(state.indicatorsRangePreset, {
    start: state.indicatorsCustomStart, end: state.indicatorsCustomEnd,
  });
  // For range mode, restrict the row pool to the selected window. Weekly mode
  // keeps the full data so the week selector still lists every week.
  const data = isRange
    ? allData.filter(r => isInIndicatorRange(r, rangeBounds))
    : allData;
  const weeks = isRange
    ? [...new Set(data.map(r => r.week))].sort((a, b) => a - b)
    : allWeeks;
  const currentWeek = state.indicatorsWeek === -1 ? allWeeks[allWeeks.length - 1] : state.indicatorsWeek;

  // Aggregate data. Range mode with raw sales aggregates by EXACT sale date —
  // so a custom competition window like 6/1–6/3 counts only those days, not
  // the whole containing week. Weekly mode + pre-aggregated CSVs keep the
  // weekly-row math.
  const rangeStartD = isRange ? new Date(rangeBounds.start + 'T00:00:00') : null;
  const rangeEndD   = isRange ? new Date(rangeBounds.end   + 'T23:59:59') : null;
  const branchData = {};
  // Range mode: bucket the windowed sales by branch/team ONCE up front.
  // Previously this filtered indicatorSales() and re-parsed EVERY sale's date
  // separately for each branch/team column — O(columns × sales) per render,
  // the main reason the Branch/Teams toggle felt slow. Now it's a single pass.
  let _rangeGroups = null;
  if (isRange && rawSalesAvailable) {
    _rangeGroups = {};
    const groupKeyOf = groupBy === 'teams'
      ? (s) => (getRepTeam(s.rep) || 'Unassigned')
      : groupBy === 'dept'
      ? (s) => (DEPT_GROUP_LABELS[_indicatorDeptOf(s)] || 'OFFICE STAFF')
      : groupBy === 'company'
      ? (s) => companyGroupOf(s.office)
      : (s) => s.office || 'Unknown';
    for (const s of indicatorSales()) {
      if (!s.rep) continue;
      if (groupBy === 'teams' && isRepExcluded(s.rep)) continue;
      // Teams are Sales-Rep-only — office staff / technician sales never
      // group by team (they'd all land in a bogus "Unassigned" column).
      if (groupBy === 'teams' && typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
      const d = _parseIndicatorDay(s);
      if (!d || d < rangeStartD || d > rangeEndD) continue;
      const k = groupKeyOf(s);
      (_rangeGroups[k] || (_rangeGroups[k] = [])).push(s);
    }
  }
  // ── $20K PRA qualification — COMPANY-WIDE (per Isaac, Jul 2026) ──
  // Reps sell across branches. Qualifying per-column both double-counted
  // (> $20K in two branches = counted twice in RIDD) and dropped split reps
  // ($15K + $12K = $27K total but no single branch over $20K = counted
  // nowhere). So: the bar is the rep's TOTAL in-window production, and each
  // qualified rep is counted in exactly ONE column — where they sold most.
  const _praHome = (() => {
    const agg = {};                       // rep -> { total, by: {group: rev} }
    const bump = (s, k) => {
      if (!s.rep) return;
      const x = agg[s.rep] || (agg[s.rep] = { total: 0, by: {} });
      const cv = Number(s.contractValue) || 0;
      x.total += cv; x.by[k] = (x.by[k] || 0) + cv;
    };
    if (isRange && rawSalesAvailable && _rangeGroups) {
      for (const [k, arr] of Object.entries(_rangeGroups)) arr.forEach(s => bump(s, k));
    } else if (rawSalesAvailable) {
      const keyOf = groupBy === 'teams' ? (s) => (getRepTeam(s.rep) || 'Unassigned')
        : groupBy === 'dept' ? (s) => (DEPT_GROUP_LABELS[_indicatorDeptOf(s)] || 'OFFICE STAFF')
        : groupBy === 'company' ? (s) => companyGroupOf(s.office)
        : (s) => s.office || 'Unknown';
      for (const s of (indicatorSales() || [])) {
        if (!s.rep) continue;
        if (isRange ? !weeks.includes(s.week) : s.week !== currentWeek) continue;
        bump(s, keyOf(s));
      }
    }
    const homeOf = {}, qualified = new Set();
    for (const [rep, x] of Object.entries(agg)) {
      let best = null, bv = -1;
      for (const [k, v] of Object.entries(x.by)) if (v > bv) { bv = v; best = k; }
      homeOf[rep] = best;
      if (x.total > 20000) qualified.add(rep);
    }
    return { homeOf, qualified, agg };
  })();
  const _reps20kOf = (b) => { let n = 0; _praHome.qualified.forEach(r => { if (_praHome.homeOf[r] === b) n++; }); return n; };
  branches.forEach(b => {
    if (isRange && rawSalesAvailable) {
      const ss = _rangeGroups[b] || [];
      if (!ss.length) { branchData[b] = null; return; }
      const count = ss.length;
      const rev = ss.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
      const revRenewal = ss.reduce((a, s) => a + (_indicatorIsRenewal(s) ? (Number(s.contractValue) || 0) : 0), 0);
      // Avg Pest Initial rules (exclude Sentricon / German Roach / Interior
      // Flea) apply to Teams view AND the Office Staff dept.
      const usePestExclude = groupBy === 'teams' || state.indicatorDept === 'd2d';
      const pest = usePestExclude ? ss.filter(s => !TEAM_PEST_EXCLUDE.test(s.subscription || '')) : ss;
      const avgInit = pest.length > 0 ? pest.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / pest.length : 0;
      const multi = ss.filter(s => myBucketOf(s) === 'multi').length;
      const twelve = ss.filter(s => myBucketOf(s) === 'twelve').length;
      const autoPayCount = ss.filter(s => s.autoPay && s.autoPay !== 'No').length;
      // Audit % = accounts NOT flagged "Failed Audit" ÷ all accounts. Without
      // this the range view left audit_pct undefined → the column rendered NaN%.
      const auditFail = ss.filter(s => /failed\s*audit/i.test(s.customerFlags || '')).length;
      const lastResort = ss.filter(s => (Number(s.initialPrice) || 0) < 99).length;
      const reps = new Set(ss.map(s => s.rep).filter(Boolean)).size;
      // $20K PRA qualification — company-wide bar, home-column attribution
      // (see _praHome above). Each qualified rep counts in exactly one column.
      const reps20k = _reps20kOf(b);
      branchData[b] = {
        sold_accounts: count,
        revenue: rev,
        new_revenue: rev - revRenewal,
        renewal_revenue: revRenewal,
        avg_initial: avgInit,
        avg_initial_count: pest.length,
        acv: count > 0 ? rev / count : 0,
        pra: reps20k > 0 ? rev / reps20k : 0,
        reps20k,
        multi_year_pct: (twelve + multi) > 0 ? multi / (twelve + multi) : 0,
        auto_pay_pct: count > 0 ? autoPayCount / count : 0,
        audit_pct: count > 0 ? (count - auditFail) / count : 0,
        last_resort_pct: count > 0 ? lastResort / count : 0,
        reps,
      };
      return;
    }
    const rows = isRange
      ? data.filter(r => r.branch === b)
      : allData.filter(r => r.branch === b && r.week === currentWeek);
    if (!rows.length) { branchData[b] = null; return; }
    const sold = rows.reduce((a, r) => a + r.sold_accounts, 0);
    const rev  = rows.reduce((a, r) => a + r.revenue, 0);
    const multi= rows.reduce((a, r) => a + r.multi_years, 0);       // count of 18+24 month contracts
    const twelve = rows.reduce((a, r) => a + r.twelve_month, 0);    // count of 12 month contracts
    // Reps W/ A Sale = count of unique rep names for this branch.
    // Range: union across every week in window. Single-week: just that week.
    // Falls back to MAX of weekly counts if raw sales aren't available (pre-agg CSV).
    let reps;
    let reps20k = null;
    const raw = indicatorSales();
    if (Array.isArray(raw) && raw.length) {
      // Group key matching: branch view compares against s.office; team view
      // compares against the rep's team (the previous code only matched office,
      // which made every team's reps count = 0 → PRA always 0 in team mode).
      const groupKeyMatches = groupBy === 'teams'
        ? (s) => (getRepTeam(s.rep) || 'Unassigned') === b
        : (s) => s.office === b;
      const inWindow = (s) => {
        if (isRange) return weeks.includes(s.week) && groupKeyMatches(s);
        return groupKeyMatches(s) && s.week === currentWeek;
      };
      const _win = raw.filter(inWindow);
      reps = new Set(_win.map(s => s.rep).filter(Boolean)).size;
      // $20K PRA qualification — company-wide bar, home-column attribution.
      reps20k = _reps20kOf(b);
    } else {
      // Pre-aggregated CSV: no per-rep revenue — fall back to the old
      // denominator so PRA still renders instead of blanking out.
      reps = isRange ? Math.max(...rows.map(r => r.reps)) : rows[0]?.reps || 0;
      reps20k = null;
    }
    // Avg Pest Initial — weight by the row's own non-Sentricon count (avg_initial_count).
    // Falls back to sold_accounts for pre-aggregated CSV rows that don't have it.
    const avgInitDen = rows.reduce((a, r) => a + (r.avg_initial_count != null ? r.avg_initial_count : r.sold_accounts), 0);
    const avgInit = avgInitDen > 0
      ? rows.reduce((a, r) => a + r.avg_initial * (r.avg_initial_count != null ? r.avg_initial_count : r.sold_accounts), 0) / avgInitDen
      : 0;
    const autoPay = rows.reduce((a, r) => a + r.auto_pay_pct * r.sold_accounts, 0) / (sold || 1);
    // Audit % = accounts NOT flagged Failed Audit ÷ all accounts in window.
    const auditFail = rows.reduce((a, r) => a + (r.audit_fail || 0), 0);
    const lastResort = rows.reduce((a, r) => a + (r.last_resort || 0), 0);
    // Multi Year % = count(18+24 month) / count(12+18+24 month contracts)
    const contractTotal = twelve + multi;
    branchData[b] = {
      sold_accounts: sold,
      revenue: rev,
      new_revenue: rev,        // pre-aggregated CSV has no renewal split
      renewal_revenue: 0,
      avg_initial: avgInit,
      avg_initial_count: avgInitDen, // for proper RIDD-level weighting (excludes Sentricon)
      acv: sold > 0 ? rev / sold : 0,
      pra: reps20k != null ? (reps20k > 0 ? rev / reps20k : 0) : (reps > 0 ? rev / reps : 0),
      reps20k: reps20k != null ? reps20k : reps,
      multi_year_pct: contractTotal > 0 ? multi / contractTotal : 0,
      auto_pay_pct: autoPay,
      audit_pct: sold > 0 ? (sold - auditFail) / sold : 0,
      last_resort_pct: sold > 0 ? lastResort / sold : 0,
      reps: reps,
    };
  });

  // Compute RIDD totals
  const riddTotal = {};
  // activeBranches drives the table columns + RIDD totals — keeps the
  // synthetic "Unassigned" group so its numbers still roll up into the
  // company total. rankableBranches is what the ranking math uses —
  // strips Unassigned so a bucket that doesn't represent a real team
  // can't score Power Rank points.
  const activeBranches   = branches.filter(b => branchData[b]);
  // Deselected offices/teams stay ON THE BOARD (still in activeBranches, so the
  // column + stats render and roll into RIDD totals) but are excluded from the
  // Power Ranking — no points, and they don't shift anyone else's ranks. Like
  // Unassigned, they just sit out the ranking math.
  const rankableBranches = activeBranches.filter(b =>
    !(groupBy === 'teams' && b === 'Unassigned')
    && !isRankExcluded(b));
  INDICATOR_METRICS.forEach(m => {
    if (m.key === 'avg_initial') {
      // Weighted by non-Sentricon account count; falls back to sold_accounts for pre-agg branches
      const weightOf = (b) => (branchData[b]?.avg_initial_count != null ? branchData[b].avg_initial_count : branchData[b]?.sold_accounts) || 0;
      const totalW = activeBranches.reduce((a, b) => a + weightOf(b), 0);
      riddTotal[m.key] = totalW > 0
        ? activeBranches.reduce((a, b) => a + (branchData[b]?.avg_initial || 0) * weightOf(b), 0) / totalW
        : 0;
    } else if (m.key === 'auto_pay_pct' || m.key === 'appruv_pct' || m.key === 'multi_year_pct' || m.key === 'audit_pct' || m.key === 'last_resort_pct') {
      const totalSold = activeBranches.reduce((a, b) => a + (branchData[b]?.sold_accounts || 0), 0);
      riddTotal[m.key] = totalSold > 0
        ? activeBranches.reduce((a, b) => a + (branchData[b]?.[m.key] || 0) * (branchData[b]?.sold_accounts || 0), 0) / totalSold
        : 0;
    } else if (m.key === 'acv') {
      const totalSold = activeBranches.reduce((a, b) => a + (branchData[b]?.sold_accounts || 0), 0);
      const totalRev = activeBranches.reduce((a, b) => a + (branchData[b]?.revenue || 0), 0);
      riddTotal[m.key] = totalSold > 0 ? totalRev / totalSold : 0;
    } else if (m.key === 'pra') {
      const totalRev = activeBranches.reduce((a, b) => a + (branchData[b]?.revenue || 0), 0);
      const totalReps = activeBranches.reduce((a, b) => a + (branchData[b]?.reps20k ?? branchData[b]?.reps ?? 0), 0);
      riddTotal[m.key] = totalReps > 0 ? totalRev / totalReps : 0;
    } else {
      riddTotal[m.key] = activeBranches.reduce((a, b) => a + (branchData[b]?.[m.key] || 0), 0);
    }
  });

  // Compute per-metric rankings (rank 1 = best on that metric). Built
  // from rankableBranches so the synthetic "Unassigned" group can't
  // outrank a real team on a metric just by virtue of having data.
  const rankings = {};
  INDICATOR_METRICS.forEach(m => {
    const sorted = rankableBranches
      .filter(b => branchData[b])
      .map(b => ({ branch: b, val: branchData[b][m.key] || 0 }))
      .sort((a, b) => b.val - a.val);
    rankings[m.key] = sorted.map((s, i) => ({ ...s, rank: i + 1, points: rankableBranches.length - i }));
  });

  // Click-to-verify drill for the two context rows ("Reps W/ A Sale" and
  // "Reps > $20K"): lists exactly which reps are attributed to a column in
  // the current window with their revenue, so the counts can be audited
  // by eye. Recomputes with the SAME window + grouping logic branchData
  // used — raw rep spellings included, since that's what the counts key on.
  const openRepsDrill = (b) => {
    const rev = {};
    const add = (s) => { if (s.rep) rev[s.rep] = (rev[s.rep] || 0) + (Number(s.contractValue) || 0); };
    if (isRange && _rangeGroups) {
      (_rangeGroups[b] || []).forEach(add);
    } else {
      const matches = groupBy === 'teams'
        ? (s) => (getRepTeam(s.rep) || 'Unassigned') === b
        : groupBy === 'dept'
        ? (s) => (DEPT_GROUP_LABELS[_indicatorDeptOf(s)] || 'OFFICE STAFF') === b
        : groupBy === 'company'
        ? (s) => companyGroupOf(s.office) === b
        : (s) => s.office === b;
      (indicatorSales() || []).forEach(s => {
        if (!s.rep || !matches(s)) return;
        if (isRange ? !weeks.includes(s.week) : s.week !== currentWeek) return;
        add(s);
      });
    }
    const entries = Object.entries(rev).sort((x, y) => y[1] - x[1]);
    const nQual = _reps20kOf(b);
    let winLabel = '';
    try {
      winLabel = isRange
        ? indicatorPresetLabel(state.indicatorsRangePreset)
        : indicatorWeekLabel(currentWeek, { short: true });
    } catch { /* label is cosmetic */ }
    const overlay = el('div', { class: 'modal-overlay' });
    const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
    document.addEventListener('keydown', _escClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '440px' } },
      el('div', { class: 'flex items-center justify-between mb-1' },
        el('h3', { class: 'text-base font-bold' }, b),
        el('button', { class: 'text-2xl leading-none text-muted- cursor-pointer px-2', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×')),
      el('p', { class: 'text-xs text-muted- mb-3' },
        (winLabel ? winLabel + ' · ' : '') + entries.length + ' rep' + (entries.length === 1 ? '' : 's') + ' w/ a sale · ' + nQual + ' counted for PRA (> $20K company-wide, home column here)'),
      el('div', { style: { maxHeight: '60vh', overflowY: 'auto' } },
        el('table', { class: 'w-full text-sm' },
          el('tbody', {},
            ...entries.map(([name, v], i) => {
              const q    = _praHome.qualified.has(name);
              const home = _praHome.homeOf[name];
              const tot  = (_praHome.agg[name] && _praHome.agg[name].total) || 0;
              const mark = !q ? '—' : (home === b ? '✓ counted here' : '→ in ' + home);
              return el('tr', { class: 'border-t border-' },
                el('td', { class: 'py-1.5 pr-2 tabular-nums text-muted- text-xs' }, '#' + (i + 1)),
                el('td', { class: 'py-1.5 pr-2 font-semibold' }, name),
                el('td', { class: 'py-1.5 text-right tabular-nums', title: tot > v + 0.5 ? 'Company-wide this window: ' + fmt.usd0(tot) : '' }, fmt.usd0(v)),
                el('td', { class: 'py-1.5 pl-2 text-right text-xs font-bold whitespace-nowrap', style: { color: q ? (home === b ? '#DF643A' : 'var(--text-muted)') : 'var(--text-muted)' },
                  title: q ? ('Sold ' + fmt.usd0(tot) + ' company-wide — counted in their top-revenue column') : ('Under $20K company-wide (' + fmt.usd0(tot) + ')') }, mark),
              );
            })))),
    ));
    document.body.append(overlay);
  };

  // Total Points = sum of per-metric ranks (golf scoring: lower = better).
  // Reps W/ A Sale is intentionally excluded — having more reps doesn't make
  // a branch/team a better seller, just a bigger one. The metric is still
  // ranked and shown in the matrix for context, but it doesn't contribute
  // points here.
  // Best-possible score = POWER_RANKING_METRICS.length (rank 1 on every metric).
  // Worst-possible = N × POWER_RANKING_METRICS.length.
  // Audit % is shown in the table for context but intentionally NOT scored —
  // it's a quality flag, not a selling-effectiveness signal, so it shouldn't
  // move a branch/team up or down the Power Ranking.
  const POWER_RANKING_METRICS = INDICATOR_METRICS.filter(m => m.key !== 'reps' && m.key !== 'new_revenue' && m.key !== 'renewal_revenue' && m.key !== 'audit_pct' && m.key !== 'last_resort_pct');
  const worstRank = rankableBranches.length;
  const totalPoints = {};
  rankableBranches.forEach(b => {
    totalPoints[b] = POWER_RANKING_METRICS.reduce((sum, m) => {
      const entry = rankings[m.key]?.find(r => r.branch === b);
      return sum + (entry?.rank || worstRank);
    }, 0);
  });
  // Tie-breakers (best → worst):
  //   1. Lower Total Points (primary)
  //   2. Higher D2D Revenue
  //   3. Higher Avg Pest Initial
  const powerRankCompare = (a, b) => {
    const tp = (totalPoints[a] || 0) - (totalPoints[b] || 0);
    if (tp !== 0) return tp;
    const rev = (branchData[b]?.revenue || 0) - (branchData[a]?.revenue || 0);
    if (rev !== 0) return rev;
    return (branchData[b]?.avg_initial || 0) - (branchData[a]?.avg_initial || 0);
  };
  const powerRanking = rankableBranches.slice().sort(powerRankCompare);

  // ── Previous-week comparison for the Power Ranking card ──
  // In weekly mode we re-run the same ranking pipeline on the prior week's
  // pre-aggregated rows. In range mode the concept doesn't apply (no single
  // "previous week"), so prevRankByBranch stays empty and the column is
  // suppressed in render.
  const prevRankByBranch = {};
  const prevPointsByBranch = {};
  let prevWeek = null;
  if (!isRange) {
    const idx = allWeeks.indexOf(currentWeek);
    if (idx > 0) prevWeek = allWeeks[idx - 1];
  }
  if (prevWeek != null) {
    const prevBranchData = {};
    // Iterate the FULL branch set, not just activeBranches — a group that had
    // data last week but no sales this week still mattered to last week's
    // ranking, and excluding it would shift every other group's prev rank by
    // one. We rank within whoever was present in the prior week, exactly as
    // the user would see if they navigated to that week directly.
    branches.forEach(b => {
      const row = allData.find(r => r.branch === b && r.week === prevWeek);
      if (!row) return;
      const sold = row.sold_accounts || 0;
      const rev = row.revenue || 0;
      const multi = row.multi_years || 0;
      const twelve = row.twelve_month || 0;
      const ctTotal = twelve + multi;
      prevBranchData[b] = {
        sold_accounts: sold,
        revenue: rev,
        avg_initial: row.avg_initial || 0,
        avg_initial_count: row.avg_initial_count != null ? row.avg_initial_count : sold,
        acv: sold > 0 ? rev / sold : 0,
        pra: row.reps > 0 ? rev / row.reps : 0,
        multi_year_pct: ctTotal > 0 ? multi / ctTotal : 0,
        auto_pay_pct: row.auto_pay_pct || 0,
        reps: row.reps || 0,
      };
    });
    const prevBranchesPresent = branches.filter(b => prevBranchData[b]);
    const prevWorstRank = prevBranchesPresent.length;
    const prevRankings = {};
    POWER_RANKING_METRICS.forEach(m => {
      const sorted = prevBranchesPresent
        .map(b => ({ branch: b, val: prevBranchData[b][m.key] || 0 }))
        .sort((a, b) => b.val - a.val);
      prevRankings[m.key] = sorted.map((s, i) => ({ ...s, rank: i + 1 }));
    });
    prevBranchesPresent.forEach(b => {
      prevPointsByBranch[b] = POWER_RANKING_METRICS.reduce((sum, m) => {
        const entry = prevRankings[m.key]?.find(r => r.branch === b);
        return sum + (entry?.rank || prevWorstRank);
      }, 0);
    });
    const prevSorted = prevBranchesPresent.slice().sort((a, b) => {
      const tp = (prevPointsByBranch[a] || 0) - (prevPointsByBranch[b] || 0);
      if (tp !== 0) return tp;
      const rev = (prevBranchData[b]?.revenue || 0) - (prevBranchData[a]?.revenue || 0);
      if (rev !== 0) return rev;
      return (prevBranchData[b]?.avg_initial || 0) - (prevBranchData[a]?.avg_initial || 0);
    });
    prevSorted.forEach((b, i) => { prevRankByBranch[b] = i + 1; });
  }

  // Date label for current week
  const weekRow = data.find(r => r.week === currentWeek);
  const dateLabel = weekRow?.date || '';

  // Build the rep-level sections ONCE here (instead of inline in the return)
  // so we can lift the Avg Pest Initial / Raffle competition card up to the
  // top of the page, right under the competition selector — same spot as the
  // Spring Cleaning board — when one of those comps is selected.
  const _repWindowLabel = (() => {
    if (isRange) {
      const presetLabel = indicatorPresetLabel(state.indicatorsRangePreset);
      if (state.indicatorsRangePreset === 'custom') return `${rangeBounds.start} → ${rangeBounds.end}`;
      return `${presetLabel} · ${rangeBounds.start} → ${rangeBounds.end}`;
    }
    const wkRow = (allData || []).find(r => r.week === currentWeek);
    const dl = (wkRow?.date || '').trim();
    return indicatorWeekLabel(currentWeek, { rows: allData }) + (dl ? ' · ' + dl : '');
  })();
  const _repSections = indicatorRepSections(data, isRange, currentWeek, isRange ? rangeBounds : null, allWeeks, allData, _repWindowLabel);
  // Splice out the D2D comp card so it can render at the top.
  let _topCompCard = null;
  {
    const idx = _repSections.findIndex(n => n && n.getAttribute && n.getAttribute('data-section') === 'd2d-comp');
    if (idx >= 0) _topCompCard = _repSections.splice(idx, 1)[0];
  }
  // Focused comp view: when a competition with its OWN table (Spring Cleaning,
  // Avg Pest & Raffle) is selected, render just the selector + comp window +
  // that table and skip the Chart.js-heavy power ranking / weekly charts / rep
  // analytics. Keeps comp switching + the comp window snappy instead of
  // re-rendering several canvases each time.
  // REP-LITE — sales-rep-type accounts get Indicators trimmed to the
  // power-ranking metrics (by-branch table + rankings/power panel) and the
  // Rep Leaderboard. No comps mode (that lives on the Competitions tab),
  // no charts, no admin tooling, no other rep sections.
  // Comps mode retired on this tab — competitions live on the Competitions
  // tab for every role. Clears any persisted ON state so nobody's stuck.
  state.indicatorsComps = false;
  const _repLite = !isAdminRole(state.profile?.role);
  // "Analyst layout" (pinned card + admin tables/charts): driven by the
  // Settings → Permissions matrix now — any role granted the Indicators
  // table or Power Ranking chart gets it. Defaults: partners + office
  // team leads. (Office dept still hides branch charts, same as admin.)
  const _isPartner = _repLite && (userCan('ind_table') || userCan('ind_power_chart'));
  // Sales-rep page order (per Isaac): player card → Your Performance Trends
  // → Indicators table → Power Ranking → Leaderboard. Partners / office leads
  // keep their own order (PARTNER_LAYOUT_SECTIONS), so this is D2D-only.
  const _repSalesLayout = _isPartner
    && !((typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role)) || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role)));
  // Admin default filters (per Isaac, Jul 2026): every fresh session opens
  // Indicators on Pending/Serviced revenue · Type = Sales Rep · This Year ·
  // Branch/Office grouping. Seeds the first render only — filter changes
  // made afterward stick for the rest of the session.
  if (state._indCtxCollapsed === undefined) {
    try { state._indCtxCollapsed = localStorage.getItem('ridd_ind_ctx_collapsed') === '1'; }
    catch { state._indCtxCollapsed = false; }
  }
  if (!_repLite && !state._indDeptDefaulted) {
    state._indDeptDefaulted = true;
    state.indicatorDept = 'd2d';
    state.indicatorAcctStatus = 'pending_serviced';
    state.indicatorsRangePreset = 'this_year';
    state.indicatorsCustomStart = '';
    state.indicatorsCustomEnd = '';
    state.indicatorsGroupBy = 'branch';
  }
  if (_repLite) {
    // Stats default to the viewer's OWN rep type — office staff land on
    // Office Staff stats, sales reps on Sales Rep stats. Seeds the first
    // render only; flipping the dropdown afterward sticks for the session.
    // Non-admins are PINNED to their own type (per Isaac): a sales rep only
    // ever sees Sales Rep stats, office staff only Office Staff — the Type
    // filter doesn't render for them at all.
    state._indDeptDefaulted = true;
    state.indicatorDept = (typeof repTypeGroup === 'function' && repTypeGroup(state.profile) === 'tech') ? 'techs'
      : isOfficeStaffRole(state.profile?.role) ? 'office' : 'd2d';
    // Performance Trends defaults to the SIGNED-IN rep (they can re-scope to
    // company/branch/team with the pickers). Waits for the dataset so the
    // name match can actually land; runs once per session.
    if (!state._indTrendDefaulted && (state._indicatorRawSales || []).length) {
      state._indTrendDefaulted = true;
      const _sigT = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
      const _mine = _sigT(state.profile.full_name);
      const _match = [...myRepNameSet()][0]
        || [...new Set((state._indicatorRawSales || []).map(s => getCanonicalRepName(s.rep || '')).filter(Boolean))].find(n => _sigT(n) === _mine);
      if (_match) { state._indicatorTrendScope = { type: 'company' }; state._indicatorRepDrillDown = _match; }
    }
    if (!(state._indicatorRawSales || []).length && !state._nrlaPublicPulled && typeof refreshIndicatorsFromCloud === 'function') {
      state._nrlaPublicPulled = true;
      refreshIndicatorsFromCloud(true).catch(() => {});
    }
  }
  const _focusedComp = state.indicatorsComps
    && (['spring_cleaning', 'avg_pest_initial', 'top_gun', 'last_man_standing', 'nrla'].includes(getActiveComp().scoring || '')
        || isLastManStandingComp() || isNrlaComp());

  return el('div', { class: 'flex flex-col gap-5 w-full' },

    // ── Fixed filter bar — pinned just below the page header at all times,
    // so the user can change week / range / scope from anywhere on the page.
    // Uses position:fixed (vs sticky) because the parent flex-col + main's
    // overflow-x-hidden combo broke sticky in some browsers. Spacer below
    // reserves the bar's vertical footprint so the rest of the content
    // doesn't slide up under it.
    (() => {
      const isCustom = isRange && state.indicatorsRangePreset === 'custom';
      const barHeight = isCustom ? 100 : 56;
      // The hardcoded heights above are only an initial guess — the toolbar
      // WRAPS to extra rows at narrower widths / different toggle states, so
      // after mount we measure the real bar height and size the spacer to
      // match. Without this, toggling tabs left a mismatched gap or let
      // content slide under the bar.
      const syncBarSpacer = () => {
        const bar = document.getElementById('indFixedBar');
        const sp  = document.getElementById('indBarSpacer');
        if (!bar || !sp) return;
        // Reserve EXACTLY enough that content clears the fixed bar's bottom
        // edge (+6px breathing room). Reserving the bar's full height used
        // to overshoot by the bar/header overlap — dead whitespace above
        // the first table.
        // The bar is position:FIXED — its rect is viewport-relative and must
        // NOT get scrollY added (doing so inflated the spacer by however far
        // the page was scrolled when this ran → giant white void). The
        // spacer's own top IS absolute, so it does need scrollY.
        // Measure from LAYOUT (offsetTop chain + offsetHeight), not from
        // viewport rects: on iOS the rect/scrollY pair drifts while the URL
        // bar collapses or the page rubber-bands, which left a ~100px void
        // above the first table on phones (per Isaac).
        let spTopAbs = 0;
        for (let n = sp; n; n = n.offsetParent) spTopAbs += n.offsetTop || 0;
        const barTop    = parseFloat(getComputedStyle(bar).top) || 0;      // fixed bar's declared top
        const barBottom = barTop + bar.offsetHeight;
        // Visual gap under the bar = the bar's own 12px inner padding, so the
        // toolbar sits centred between the header and the first card (per
        // Isaac). The page column already adds a 20px flex gap after the
        // spacer, so subtract that back out.
        sp.style.height = Math.max(0, barBottom + 12 - 20 - spTopAbs) + 'px';
      };
      setTimeout(() => {
        syncBarSpacer();
        // The Filters panel lives INSIDE this fixed bar — opening it grows
        // the bar, and the spacer measured at that moment left a dead gap
        // when the panel closed without a re-render (outside click). A
        // ResizeObserver keeps the spacer glued to the bar's REAL height.
        const bar = document.getElementById('indFixedBar');
        if (bar && typeof ResizeObserver !== 'undefined' && !bar._spacerRO) {
          bar._spacerRO = new ResizeObserver(() => { try { syncBarSpacer(); } catch (e) { /* torn down */ } });
          bar._spacerRO.observe(bar);
        }
      }, 0);
      if (!window._indBarResizeBound) {
        window._indBarResizeBound = true;
        window.addEventListener('resize', () => { try { syncBarSpacer(); } catch {} });
      }
      return el('div', {},
        // The fixed bar itself (out of flow)
        el('div', {
          id: 'indFixedBar',
          style: {
            position: 'fixed', top: (() => { try { const h = document.querySelector('header.page-header'); return h ? Math.round(h.getBoundingClientRect().height) + 'px' : '60px'; } catch (e) { return '60px'; } })(), left: '0', right: '0', zIndex: 15,
            background: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
            paddingTop: '18px', paddingBottom: '14px',   // (bumped down a touch per Isaac — the row sat on the header rule)
          },
        },
          el('div', { class: 'w-full mx-auto px-4 sm:px-6', style: { maxWidth: '1648px' } },   // = main's gutter + 1600px content box, so Presets/Filters sit flush with the cards (per Isaac)
            el('div', { class: 'flex flex-col gap-2' },
              el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
              // Presets button — left-justified on the Filters row (per Isaac).
              indPresetRibbon(),
              el('div', { class: 'flex items-center justify-end gap-2 flex-wrap ml-auto' },
        // (🔧 edit mode moved to the GLOBAL top bar — it now drives section
        // layout on every tab plus the row editing here.)
        // ⛃ FILTERS — Metric / Type / Date / Group live in ONE dropdown so
        // the toolbar is just [Filters] ... [icon cluster]. The panel stays
        // open across re-renders (state._indFiltersOpen) so changing several
        // filters in a row doesn't mean re-opening it each time. The button
        // border goes accent + shows a count when any filter is off default.
        (() => {
          const _fRow = (label, node) => node ? el('div', { class: 'flex flex-col gap-1' },
            el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-muted)' } }, label),
            node) : null;
          // STAGED edits — the selects no longer re-render the whole page on
          // every change (each mountApp re-crunches the full tab, which made
          // the panel feel molasses-slow). Changes collect here and the
          // Apply button commits them with ONE re-render.
          const _staged = {
            acct: state.indicatorAcctStatus || 'pending_serviced',
            dept: state.indicatorDept || 'all',
            preset: state.indicatorsRangePreset,
            group: state.indicatorsGroupBy || 'branch',
          };
          let _applyBtn = null;
          const _markDirty = () => {
            if (!_applyBtn) return;
            _applyBtn.style.background = 'var(--accent)';
            _applyBtn.style.color = 'var(--accent-text)';
            _applyBtn.style.borderColor = 'var(--accent)';
            _applyBtn.textContent = 'Apply changes';
          };
          // Primary Metric — REP ACCOUNTS ARE LOCKED to Pending/Serviced:
          // "Total Revenue" counts cancelled + sold-not-started rows too — an
          // admin analysis lens that just makes a rep's number look bigger
          // than anything comps or payroll will ever pay on.
          // Metric stays LOCKED to Pending/Serviced for plain reps ("Total
          // Revenue" counts cancelled + sold-not-started rows — an analysis
          // lens, not a payroll number). Team leads / partners get the pick
          // (per Isaac, Sep 2026 — Pere's view).
          const _metricLocked = _repLite && !((typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role)) || (typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role)));
          const metricSel = _metricLocked ? (() => { state.indicatorAcctStatus = 'pending_serviced'; _staged.acct = 'pending_serviced'; return null; })() : el('select', {
              class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer w-full',
              style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
              onchange: e => { _staged.acct = e.target.value; _markDirty(); },
            },
              el('option', { value: 'pending_serviced', selected: _staged.acct === 'pending_serviced' }, 'Pending / Serviced Revenue'),
              el('option', { value: 'all', selected: _staged.acct === 'all' }, 'Total Revenue'),
            );
          // Exclude — one-time services / 3-day RORs / renewals (per Isaac),
          // same switches as the Performance Trends card (shared state).
          const _stExcl = { ...indicatorExcl() };
          const exclBox = (key, lab) => el('label', { class: 'flex items-center gap-1.5 text-[11px] font-medium cursor-pointer', style: { color: 'var(--text)' } },
            el('input', { type: 'checkbox', checked: !!_stExcl[key], style: { width: '13px', height: '13px' }, onchange: (e) => { _stExcl[key] = !!e.target.checked; _markDirty(); } }), lab);
          const exclSel = el('div', { class: 'flex flex-col gap-1 rounded-xl px-2.5 py-1.5', style: { border: '1px solid var(--border-2)', background: 'var(--card)' } },
            exclBox('oneTime', 'One-time services'), exclBox('ror', '3-day RORs'), exclBox('renewal', 'Renewals'));
          // Emp Type — classified from the Customer Report's "Sold By Type".
          const typeSel = el('select', {
            class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer w-full',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            onchange: e => { _staged.dept = e.target.value; _markDirty(); },
          },
            el('option', { value: 'all', selected: _staged.dept === 'all' }, 'All'),
            el('option', { value: 'd2d', selected: _staged.dept === 'd2d' }, 'Sales Rep'),
            el('option', { value: 'office', selected: _staged.dept === 'office' }, 'Office Staff'),
            el('option', { value: 'techs', selected: _staged.dept === 'techs' }, 'Technician'),
          );
          // Date — range presets (weekly mode retired; This Week / Last Week
          // presets cover it). Selecting Custom pre-fills THIS WEEK's range;
          // the actual custom pickers render in their own row below the bar.
          const dateSel = isRange ? el('select', {
            class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer w-full',
            onchange: e => { _staged.preset = e.target.value; _markDirty(); },
          },
            ...indicatorPresetOptions().map(p => el('option', {
              value: p.id, selected: _staged.preset === p.id,
            }, p.label)),
          ) : el('select', {
            class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer w-full',
            onchange: e => { state.indicatorsWeek = Number(e.target.value); mountApp(); },
          },
            ...allWeeks.map(w => {
              const dateLabel = (allData.find(r => r.week === w)?.date || '').trim();
              return el('option', {
                value: w,
                selected: w === currentWeek,
              }, indicatorWeekLabel(w, { rows: allData }) + (dateLabel ? ' · ' + dateLabel : ''));
            }),
          );
          // Group By — Branch (Office) vs Teams. Teams needs raw sales +
          // Comps off; an invalid pick heals to Branch.
          const groupSel = el('select', {
            class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer w-full',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            title: (rawSalesAvailable && !state.indicatorsComps) ? '' : 'Teams needs a raw-sales upload and Comps off',
            onchange: e => { _staged.group = e.target.value; _markDirty(); },
          },
            el('option', { value: 'branch', selected: _staged.group === 'branch' }, 'Branch / Office'),
            el('option', { value: 'teams', selected: _staged.group === 'teams' }, 'Teams'),
            isAdminRole(state.profile?.role) ? el('option', { value: 'company', selected: _staged.group === 'company' }, 'Company (RIDD Pest Control / RIDD Pest Solutions)') : null,
          );
          const panel = el('div', {
            class: 'card',
            style: { position: 'absolute', right: '0', top: 'calc(100% + 6px)', zIndex: '60', minWidth: '250px', padding: '12px', boxShadow: 'var(--shadow-lg)', display: state._indFiltersOpen ? 'block' : 'none' },
          },
            el('div', { class: 'flex flex-col gap-3' },
              // Off-default filters get an orange outline so the badge count
              // is traceable to the box that caused it (per Isaac).
              ...(() => {
                const hl = (node, on) => { if (node && on) { node.style.borderColor = 'var(--accent)'; node.style.boxShadow = '0 0 0 2px rgba(223,100,58,.25)'; } return node; };
                return [
                  _metricLocked ? null : _fRow('Metric', hl(metricSel, (state.indicatorAcctStatus || 'pending_serviced') !== 'pending_serviced')),
                  _fRow('Exclude', hl(exclSel, !!indicatorExclKey())),
                  _repLite ? null : _fRow('Type',   hl(typeSel,   (state.indicatorDept || 'all') !== 'all')),
                  _fRow('Date',   hl(dateSel,   isRange && state.indicatorsRangePreset !== 'this_year')),
                  _fRow('Group',  hl(groupSel,  groupBy !== 'branch')),
                ];
              })(),
              (_applyBtn = el('button', {
                class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 w-full',
                style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
                onclick: () => {
                  if (_staged.group === 'teams' && (!rawSalesAvailable || state.indicatorsComps)) {
                    toast(state.indicatorsComps ? 'Competitions are branch-level — turn Comps off first' : 'This grouping needs a raw-sales upload', 'warn');
                    return;
                  }
                  state.indicatorAcctStatus = _staged.acct;
                  state.indicatorExcl = { ..._stExcl };
                  state.indicatorDept = _staged.dept;
                  if (_staged.preset !== state.indicatorsRangePreset) {
                    state.indicatorsRangePreset = _staged.preset;
                    if (_staged.preset === 'custom') {
                      const wk = indicatorRangeBounds('this_week');
                      state.indicatorsCustomStart = wk.start;
                      state.indicatorsCustomEnd   = wk.end;
                    }
                  }
                  state.indicatorsGroupBy = _staged.group;
                  state._indFiltersOpen = false;   // one commit, one render, panel closes
                  if (typeof trackAction === 'function') trackAction('filters_apply', 'indicators', { dept: state.indicatorDept || 'all', group: _staged.group, acct: state.indicatorAcctStatus || '' });
                  mountApp();
                },
              }, 'Apply')),
            ),
          );
          const nonDefault = [
            (state.indicatorAcctStatus || 'pending_serviced') !== 'pending_serviced',
            !!indicatorExclKey(),
            !_repLite && (state.indicatorDept || 'all') !== 'all',
            isRange && state.indicatorsRangePreset !== 'this_year',
            groupBy !== 'branch',
          ].filter(Boolean).length;
          const bindCloser = () => setTimeout(() => {
            const closer = (ev) => {
              document.removeEventListener('mousedown', closer);
              if (!panel.isConnected) return;                      // re-render replaced us — a fresh closer was bound
              if (panel.contains(ev.target) || btn.contains(ev.target)) { document.addEventListener('mousedown', closer); return; }
              panel.style.display = 'none'; state._indFiltersOpen = false;
            };
            document.addEventListener('mousedown', closer);
          }, 0);
          const btn = el('button', {
            class: 'relative rounded-xl px-2.5 py-1 text-[11px] font-semibold border transition hover:brightness-95 shrink-0',
            style: { borderColor: nonDefault ? 'var(--accent)' : 'var(--border-2)', color: 'var(--text)' },
            title: 'Filters — Metric, Exclude, Type, Date, Group',
            onclick: (e) => {
              e.stopPropagation();
              const open = panel.style.display === 'block';
              panel.style.display = open ? 'none' : 'block';
              state._indFiltersOpen = !open;
              if (!open) { bindCloser(); clampDropdownPanel(panel); }
            },
          },
            'Filters',
            nonDefault ? el('span', {
              class: 'absolute tabular-nums',
              style: { top: '-5px', right: '-5px', minWidth: '14px', height: '14px', padding: '0 3px', borderRadius: '0', background: 'var(--accent)', color: '#3A1D12', fontSize: '9px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1' },
            }, String(nonDefault)) : null,
          );
          if (state._indFiltersOpen) bindCloser();                 // panel restored open after a filter change re-render
          clampDropdownPanel(panel);
          return el('div', { style: { position: 'relative' } }, btn, panel);
        })(),
        // ✏️ Customize (rep accounts) — reorder / show-hide the page
        // sections + personal default date range, saved on this device.
        // (✏️ Customize-my-page retired for rep accounts — keep it simple, per Isaac.)
        null,
        // Custom date pickers still render in their own row below this bar
        // when the Date preset is Custom (see the dedicated row after the
        // toolbar div).
          // 🏆 Manage Teams (per Isaac: the trophy is THE teams button now — the
          // Power Ranking scoring picker lives inside Manage Teams).
          (() => {
            if (_repLite) return null;
            const excludedNow = (typeof rankExcludedSet === 'function') ? rankExcludedSet() : new Set();
            const icon = iconTrophy();
            icon.style.width = '15px'; icon.style.height = '15px';
            return el('button', {
              class: 'relative rounded-xl border cursor-pointer transition hover:brightness-95 shrink-0 flex items-center justify-center text-[11px]',
              // Square (per Isaac): same height as the Filters button beside it, width to match.
              style: { color: excludedNow.size ? 'var(--accent)' : 'var(--text)', borderColor: excludedNow.size ? 'var(--accent)' : 'var(--border-2)', alignSelf: 'stretch', aspectRatio: '1 / 1', padding: '0', minWidth: '28px' },
              title: 'Manage teams — assign reps, pick a color, and choose which offices/teams are scored in the Power Ranking'
                + (excludedNow.size ? ' · ' + excludedNow.size + ' out of the ranking' : ''),
              onclick: () => openManageTeamsModal(),
            },
              icon,
              excludedNow.size ? el('span', {
                class: 'absolute tabular-nums',
                style: { top: '-5px', right: '-5px', minWidth: '14px', height: '14px', padding: '0 3px', borderRadius: '0', background: 'var(--accent)', color: '#3A1D12', fontSize: '9px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center' },
              }, String(excludedNow.size)) : null);
          })(),
        // Manual-data mode (admin, THIS browser only): upload the CRM's
        // SalesReport CSV and pin the whole Indicators tab to it — a
        // side-by-side truth check against the sync. Amber pill = active.
        // PDF reports now live inside Manage Teams (per Isaac). The button
        // there needs this view's grouping + windowed sales, which only exist
        // in this closure, so stash a builder the panel can call. Rebuilt on
        // every Indicators render, so it always reflects the current timeframe.
        (() => {
          state._indTeamReportCtx = !_repLite ? () => {
            const weeksInScope = isRange ? new Set(data.map(r => r.week)) : new Set([currentWeek]);
            const applyExclusion = state.indicatorsGroupBy === 'teams';
            const windowedRawSales = (state._indicatorRawSales || []).filter(s2 =>
              (!applyExclusion || !isRepExcluded(s2.rep)) && weeksInScope.has(s2.week));
            return {
              branches, branchData, rankings, powerRanking,
              rawSales: windowedRawSales,
              chartBuckets: buildReportBuckets(windowedRawSales),
              groupMode: groupBy === 'teams' ? 'team' : 'branch',
              windowLabel: isRange
                ? indicatorPresetLabel(state.indicatorsRangePreset)
                : indicatorWeekLabel(currentWeek, { short: true }),
            };
          } : null;
          return null;
        })(),
        // CSV menu — import a fresh sales report or export the current
        // by-branch/team table (with a pulled-at timestamp up top).
        !_repLite && (() => {
          const hiddenImport = csvUploadButton('sm');
          hiddenImport.style.display = 'none';
          let menu = null;
          if (state.indicatorsCsvMenu) {
            const opt = (label, fn) => el('button', {
              class: 'w-full text-left px-2.5 py-1 rounded-lg text-[11px] font-semibold transition hover:brightness-95',
              style: { color: 'var(--text)' },
              onclick: (e) => { e.stopPropagation(); state.indicatorsCsvMenu = false; if (menu) menu.style.display = 'none'; fn(); },
            }, label);
            menu = el('div', {
              class: 'card',
              style: { position: 'absolute', right: '0', top: 'calc(100% + 6px)', zIndex: '50', minWidth: '170px', padding: '6px', boxShadow: 'var(--shadow-lg)' },
            },
              opt('⬆ Import CSV…', () => hiddenImport.click()),
              opt(state.indicatorsComps ? '⬇ Export Competition (.xlsx)' : '⬇ Export CSV', async () => {
                const groupLabel = groupBy === 'teams' ? 'Team' : 'Office';

                // ── COMPS ON → competition-specific 2-sheet workbook ──
                // Sheet 1 = metrics that matter (already computed under the
                // active competition's exclusions). Sheet 2 = every account
                // attributed to the competition (excluded teams removed).
                if (state.indicatorsComps) {
                  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
                  const XLSX = window.XLSX;
                  if (!XLSX) { toast('Excel library missing after load', 'error'); return; }
                  const comp = getActiveComp();
                  const winLabel = isRange
                    ? (rangeBounds ? rangeBounds.start + ' → ' + rangeBounds.end : 'Range')
                    : indicatorWeekLabel(currentWeek, { short: true });
                  const numOrBlank0 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : ''; };

                  // ── SPRING CLEANING → Standings + Counting + Excluded ──
                  if (isSpringCleaningComp(comp)) {
                    const weeksInScope = isRange ? new Set(data.map(r => r.week)) : new Set([currentWeek]);
                    const windowed = (state._indicatorRawSales || []).filter(s => weeksInScope.has(s.week));
                    const sc = springCleaningCompute(windowed, branches);

                    // Sheet 1 — Standings + excluded summary
                    const st = [];
                    st.push(['Spring Cleaning — Standings']);
                    st.push(['Scope', winLabel + ' · Door-to-Door only']);
                    st.push(['Note', 'Standings include passed-audit + pending (assumed passing). Excluded = Failed Audit + Last Resort (<$99).']);
                    st.push(['Pulled', new Date().toLocaleString()]);
                    st.push([]);
                    st.push(['Branch', 'Reps', 'Accounts', 'Revenue', 'Avg Pest Init', 'PRA', 'ACV', '24+ Mo %', 'Autopay %', 'Total Pts', 'Place', 'Bugs']);
                    sc.ranked.forEach(m => st.push([
                      m.office, m.reps, m.n, Math.round(m.revenue), +m.avgPestInitial.toFixed(2), Math.round(m.pra),
                      +m.acv.toFixed(2), +(m.pct24 * 100).toFixed(1), +(m.autopayPct * 100).toFixed(1), m.totalPoints, m.place, m.bugs,
                    ]));
                    st.push([]);
                    st.push(['EXCLUDED (not counting)']);
                    st.push(['Accounts excluded', sc.excludedSummary.count]);
                    st.push(['Revenue excluded', Math.round(sc.excludedSummary.revenue)]);
                    st.push(['— Last Resort (<$99)', sc.excludedSummary.lastResort]);
                    st.push(['— Failed audit', sc.excludedSummary.failedAudit]);
                    st.push([]);
                    st.push(['PENDING (awaiting audit — still out there)']);
                    st.push(['Accounts pending', sc.pendingSummary.count]);
                    st.push(['Revenue pending', Math.round(sc.pendingSummary.revenue)]);

                    const acctHeader = ['Rep', 'Office', 'Customer', 'Customer ID', 'Date Sold', 'Subscription', 'Source',
                      'Initial Price', 'Contract Value', 'Contract Months', 'Auto Pay', 'Customer Flags'];
                    const acctRow = (s) => [
                      s.rep || '', s.office || '', s.customer || '', s.customerId || '', s.dateSold || '',
                      s.subscription || '', s.source || '', numOrBlank0(s.initialPrice), numOrBlank0(s.contractValue),
                      numOrBlank0(s.contract), s.autoPay || '', s.customerFlags || '',
                    ];
                    const counting = [acctHeader, ...sc.counting.map(acctRow)];
                    const pending  = [acctHeader, ...sc.pending.map(acctRow)];
                    // Split excluded into its two reasons, each on its own sheet.
                    const lastResortRows = sc.excluded.filter(s => (Number(s.initialPrice) || 0) < 99);
                    const failedAuditRows = sc.excluded.filter(s => (Number(s.initialPrice) || 0) >= 99);
                    const failedAudit = [acctHeader, ...failedAuditRows.map(acctRow)];
                    const lastResort  = [acctHeader, ...lastResortRows.map(acctRow)];

                    const wbS = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(st), 'Standings');
                    XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(counting), 'Passed Audit');
                    XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(pending), 'Pending Audit');
                    XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(failedAudit), 'Failed Audit');
                    XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(lastResort), 'Last Resort');
                    XLSX.writeFile(wbS, 'RIDD-Spring-Cleaning-' + new Date().toISOString().slice(0, 10) + '.xlsx');
                    toast('Exported Spring Cleaning — ' + sc.counting.length.toLocaleString() + ' counting, '
                      + sc.pending.length.toLocaleString() + ' pending, ' + failedAuditRows.length.toLocaleString() + ' failed audit, '
                      + lastResortRows.length.toLocaleString() + ' last resort', 'success');
                    return;
                  }

                  const excludedList = distinctTeams().filter(isTeamExcluded);

                  // Sheet 1 — Metrics
                  const m = [];
                  m.push(['RIDD Indicators — ' + comp.name]);
                  m.push(['Scope', groupLabel + ' · ' + winLabel]);
                  m.push(['Excluded teams', excludedList.length ? excludedList.join(', ') : 'none']);
                  m.push(['Pulled', new Date().toLocaleString()]);
                  m.push([]);
                  m.push([groupLabel, 'Revenue', 'Avg Initial', 'ACV', 'PRA', 'Multi-Year %', 'Auto-Pay %', 'Reps']);
                  branches.forEach(b => {
                    const d = branchData[b]; if (!d) return;
                    m.push([b, Math.round(d.revenue), +d.avg_initial.toFixed(2), +d.acv.toFixed(2), +d.pra.toFixed(2),
                      +(d.multi_year_pct * 100).toFixed(1), +(d.auto_pay_pct * 100).toFixed(1), d.reps]);
                  });

                  // Sheet 2 — Accounts attributed to the competition
                  const weeksInScope = isRange ? new Set(data.map(r => r.week)) : new Set([currentWeek]);
                  const accounts = (state._indicatorRawSales || []).filter(s =>
                    weeksInScope.has(s.week) && !isRepExcluded(s.rep));
                  const numOrBlank = (v) => { const n = Number(v); return Number.isFinite(n) ? n : ''; };
                  const a = [];
                  a.push(['Rep', 'Team', 'Office', 'Customer', 'Customer ID', 'Date Sold', 'Week',
                    'Subscription', 'Source', 'Status', 'Initial Price', 'Contract Value', 'Contract Months', 'Auto Pay']);
                  accounts.forEach(s => a.push([
                    s.rep || '', getRepTeam(s.rep) || '', s.office || '', s.customer || '', s.customerId || '',
                    s.dateSold || '', s.week || '', s.subscription || '', s.source || '', s.status || '',
                    numOrBlank(s.initialPrice), numOrBlank(s.contractValue), numOrBlank(s.contract), s.autoPay || '',
                  ]));

                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(m), 'Metrics');
                  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), 'Accounts');
                  const safe = comp.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
                  XLSX.writeFile(wb, 'RIDD-' + safe + '-' + new Date().toISOString().slice(0, 10) + '.xlsx');
                  toast('Exported ' + comp.name + ' — ' + accounts.length.toLocaleString() + ' accounts', 'success');
                  return;
                }

                // ── COMPS OFF → plain table CSV ──
                const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
                const out = [];
                out.push(['RIDD Indicators — ' + groupLabel + ' table']);
                out.push(['Pulled', new Date().toLocaleString()]);
                out.push([]);
                out.push([groupLabel, 'Revenue', 'Avg Initial', 'ACV', 'PRA', 'Multi-Year %', 'Auto-Pay %', 'Reps']);
                branches.forEach(b => {
                  const d = branchData[b]; if (!d) return;
                  out.push([b, Math.round(d.revenue), d.avg_initial.toFixed(2), d.acv.toFixed(2), d.pra.toFixed(2),
                    (d.multi_year_pct * 100).toFixed(1) + '%', (d.auto_pay_pct * 100).toFixed(1) + '%', d.reps]);
                });
                const blob = new Blob([out.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
                const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob);
                a2.download = 'ridd-indicators-' + (groupBy === 'teams' ? 'teams' : 'branch') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
                a2.click();
              }),
            );
          }
          // CSV import retired — Indicators now come from the RevHawk sync
          // (↻ icon in the top bar). Exports live on each competition's card.
          return null;
        })(),
        ), // close right-hand cluster
        ), // close toolbar row (Presets left · cluster right)
        // Custom date pickers — own row inside the sticky filter bar's
        // flex-col, only visible when Custom is selected.
        isRange && state.indicatorsRangePreset === 'custom' && el('div', { class: 'flex items-center gap-1 justify-end flex-wrap' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mr-1' }, 'Custom range'),
          el('input', { type: 'date', class: 'rounded-xl border px-2.5 py-1 text-[11px]', value: state.indicatorsCustomStart || rangeBounds.start, onchange: e => { state.indicatorsCustomStart = e.target.value; mountApp(); } }),
          el('span', { class: 'text-muted- text-xs' }, '→'),
          el('input', { type: 'date', class: 'rounded-xl border px-2.5 py-1 text-[11px]', value: state.indicatorsCustomEnd   || rangeBounds.end,   onchange: e => { state.indicatorsCustomEnd   = e.target.value; mountApp(); } }),
        ),
              ), // close inner flex-col gap-2
            ), // close max-w wrapper
          ), // close fixed bar
        // Reserve vertical space below the page header equal to the bar's
        // height since position:fixed takes it out of normal flow.
        el('div', { id: 'indBarSpacer', style: { height: barHeight + 'px' } }),
        // (Title + freshness stamp live in the fixed page header now.)
      );
    })(),

    // ── Competition selector — only while Comps is ON. Pick which competition
    // you're viewing; rules for each are wired in code. "+ Add" creates a new
    // one. The active competition's rules drive every number below. ──
    (state.indicatorsComps ? (() => {
      const comps = getIndicatorCompetitions();
      const activeId = getActiveCompId();
      const liveRerender = () => {
        const sx = window.scrollX, sy = window.scrollY;
        setTimeout(() => { mountApp(); requestAnimationFrame(() => window.scrollTo(sx, sy)); }, 0);
      };
      return el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
        el('span', { class: 'text-[11px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Competition'),
        ...comps.map(c => {
          const on = c.id === activeId;
          return el('button', {
            class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border transition cursor-pointer whitespace-nowrap',
            style: on
              ? { background: 'var(--text)', color: 'var(--bg)', borderColor: 'var(--text)' }
              : { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-2)' },
            onclick: () => { setActiveCompId(c.id); liveRerender(); },
          }, c.name);
        }),
        // "+ Add" → inline name input, or the add button.
        state._indicatorAddingComp
          ? (() => {
              const input = el('input', {
                type: 'text', placeholder: 'Competition name…',
                class: 'rounded border px-2.5 py-1 text-[11px]',
                style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
              });
              const save = () => { const v = input.value.trim(); if (v) { addCompetition(v); } state._indicatorAddingComp = false; liveRerender(); };
              input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') { state._indicatorAddingComp = false; liveRerender(); }
              });
              setTimeout(() => input.focus(), 0);
              return el('span', { class: 'flex items-center gap-1' },
                input,
                el('button', { class: 'text-[11px] font-bold rounded px-2.5 py-1 cursor-pointer', style: { background: 'var(--text)', color: 'var(--bg)' }, onclick: save }, 'Save'),
                el('button', { class: 'text-[11px] rounded px-2.5 py-1 cursor-pointer', style: { color: 'var(--text-muted)' }, onclick: () => { state._indicatorAddingComp = false; liveRerender(); } }, 'Cancel'),
              );
            })()
          : el('button', {
              class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border border-dashed cursor-pointer transition hover:brightness-95',
              style: { color: 'var(--text-muted)', borderColor: 'var(--border-2)' },
              onclick: () => { state._indicatorAddingComp = true; liveRerender(); },
            }, '+ Add'),
        // Manage the SELECTED competition — rename (fix a typo) or remove it.
        (() => {
          const active = comps.find(c => c.id === activeId);
          if (!active || state._indicatorAddingComp) return null;
          if (state._indicatorRenamingComp === active.id) {
            const input = el('input', {
              type: 'text', value: active.name,
              class: 'rounded border px-2.5 py-1 text-[11px]',
              style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            });
            const save = () => { const v = input.value.trim(); if (v) renameCompetition(active.id, v); state._indicatorRenamingComp = null; liveRerender(); };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { state._indicatorRenamingComp = null; liveRerender(); } });
            setTimeout(() => input.focus(), 0);
            return el('span', { class: 'flex items-center gap-1 ml-auto' },
              input,
              el('button', { class: 'text-[11px] font-bold rounded px-2.5 py-1 cursor-pointer', style: { background: 'var(--text)', color: 'var(--bg)' }, onclick: save }, 'Save'),
              el('button', { class: 'text-[11px] rounded px-2.5 py-1 cursor-pointer', style: { color: 'var(--text-muted)' }, onclick: () => { state._indicatorRenamingComp = null; liveRerender(); } }, 'Cancel'),
            );
          }
          return el('span', { class: 'flex items-center gap-1 ml-auto' },
            el('button', { class: 'text-[11px] rounded px-2.5 py-1 cursor-pointer border leading-none', style: { color: 'var(--text-muted)', borderColor: 'var(--border-2)' }, title: 'Rename', onclick: () => { state._indicatorRenamingComp = active.id; liveRerender(); } }, '✏️'),
            comps.length > 1
              ? el('button', { class: 'text-[11px] rounded px-2.5 py-1 cursor-pointer border leading-none', style: { color: '#DC2626', borderColor: 'rgba(220,38,38,.4)' }, title: 'Remove', onclick: () => { if (window.confirm('Remove competition “' + active.name + '”? This can’t be undone.')) { deleteCompetition(active.id); liveRerender(); } } }, '🗑')
              : null,
          );
        })(),
      );
    })() : null),

    // ── Comp window — shown whenever Comps is on. Sets the date range for the
    // selected competition (Spring Cleaning round, Avg Pest & Raffle window).
    // Hidden for NRLA — that league runs on its own round schedule. ──
    (state.indicatorsComps && !isNrlaComp() ? (() => {
      const cf = state._indicatorCompFilter || (state._indicatorCompFilter = { start: '', end: '' });
      const apply = () => { const sx = window.scrollX, sy = window.scrollY; setTimeout(() => { mountApp(); requestAnimationFrame(() => window.scrollTo(sx, sy)); }, 0); };
      // Spring Cleaning: the bar hosts the four ROUND windows — the comp
      // window derives first-set → last-set date (separate dates were
      // redundant, per Isaac).
      if (isSpringCleaningComp()) {
        const comp = getActiveComp();
        if (!Array.isArray(comp.rounds) || comp.rounds.length === 0) comp.rounds = SPRING_DEFAULT_ROUNDS.map(r => ({ ...r }));
        const rIn = (r, key, i) => el('input', {
          type: 'date', value: r[key] || '',
          class: 'rounded border',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', fontSize: '10px', padding: '1px 2px', width: '106px' },
          onchange: (e) => { r[key] = e.target.value; logActivity('comp_change', { detail: 'Spring round ' + (i + 1) + ' ' + key + ' → ' + r[key] }); saveDemoData(); apply(); },
        });
        const ds = comp.rounds.flatMap(r => [r.start, r.end]).filter(Boolean).sort();
        return el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
          el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'),
          ...comp.rounds.map((r, i) => el('span', { class: 'flex items-center gap-1' },
            el('span', { class: 'text-[10px] font-black', style: { color: 'var(--text-subtle)' } }, 'R' + (i + 1)),
            rIn(r, 'start', i), el('span', { class: 'text-muted-' }, '–'), rIn(r, 'end', i))));
      }
      const dateInput = (key) => el('input', {
        type: 'date', value: cf[key] || '',
        class: 'rounded border px-2.5 py-1 text-[11px]',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => { cf[key] = e.target.value; apply(); },
      });
      return el('div', { class: 'card p-2.5 flex items-center gap-2 flex-wrap', style: { borderLeft: '3px solid var(--text)' } },
        el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Comp Window'),
        dateInput('start'),
        el('span', { class: 'text-muted-' }, '→'),
        dateInput('end'),
        el('span', { class: 'text-[11px] ml-1', style: { color: 'var(--text-muted)' } }, '· date range for the selected competition'),
        getActiveComp().scoring === 'avg_pest_initial' ? el('button', {
          class: 'ml-auto rounded-full flex items-center justify-center font-black cursor-pointer transition hover:brightness-95 border',
          style: { width: '26px', height: '26px', borderColor: 'var(--border-2)', color: 'var(--text)', fontSize: '13px', flexShrink: '0' },
          title: 'Competition rules',
          onclick: () => openAvgPestRaffleHelpModal(),
        }, 'ⓘ') : null,
      );
    })() : null),

    // ── Spring Cleaning scoreboard — when that competition is active. Uses
    // the Comp Window above as the round. ──
    (state.indicatorsComps && isSpringCleaningComp() ? (() => {
      const comp = getActiveComp();
      const _ds = (comp.rounds || []).flatMap(r => [r.start, r.end]).filter(Boolean).sort();
      const bounds = _ds.length ? { s: new Date(_ds[0] + 'T00:00'), e: new Date(_ds[_ds.length - 1] + 'T23:59') } : null;
      const windowed = bounds
        ? (state._indicatorRawSales || []).filter(s => { const d = _parseIndicatorDay(s); return d && d >= bounds.s && d <= bounds.e; })
        : (state._indicatorRawSales || []);
      // Spring Cleaning is always branch (office) level and D2D-only, regardless
      // of the app's Branch/Teams toggle.
      const offices = [...new Set(windowed.filter(s => _indicatorDeptOf(s) === 'd2d').map(s => s.office).filter(Boolean))];
      const winLabel = _ds.length ? _ds[0] + ' → ' + _ds[_ds.length - 1] : 'all dates';
      // Live board on top (the round you're watching), standings poster
      // directly underneath.
      return el('div', { class: 'flex flex-col gap-4' },
        indicatorSpringCleaningBoard(windowed, offices, winLabel),
        springStandingsCard());
    })() : null),

    // ── Last Man Standing — Saturday-only weekly elimination bracket. ──
    (state.indicatorsComps && isLastManStandingComp() ? (() => {
      const cf = state._indicatorCompFilter || {};
      const bounds = (cf.start && cf.end) ? { s: new Date(cf.start + 'T00:00'), e: new Date(cf.end + 'T23:59') } : null;
      const windowed = bounds
        ? (state._indicatorRawSales || []).filter(s => { const d = _parseIndicatorDay(s); return d && d >= bounds.s && d <= bounds.e; })
        : (state._indicatorRawSales || []);
      const winLabel = (cf.start && cf.end) ? cf.start + ' → ' + cf.end : 'all dates';
      return lastManStandingBoard(windowed, winLabel);
    })() : null),

    // ── Top Gun — three-class per-rep production board (Rookies/Vets/Pros). ──
    (state.indicatorsComps && (getActiveComp().scoring === 'top_gun') ? (() => {
      const cf = state._indicatorCompFilter || {};
      const bounds = (cf.start && cf.end) ? { s: new Date(cf.start + 'T00:00'), e: new Date(cf.end + 'T23:59') } : null;
      const allD2d = (state._indicatorRawSales || []).filter(s => _indicatorDeptOf(s) === 'd2d');
      // Pro class = top 7 Vet reps by revenue THIS YEAR (full-year data, not the
      // comp window). Table values below use the comp window.
      const yr = new Date().getFullYear();
      const yearD2d = allD2d.filter(s => { const d = _parseIndicatorDay(s); return d && d.getFullYear() === yr; });
      const proSet = topGunProSet(yearD2d);
      const windowedD2d = bounds
        ? allD2d.filter(s => { const d = _parseIndicatorDay(s); return d && d >= bounds.s && d <= bounds.e; })
        : allD2d;
      return indicatorTopGunBoard(windowedD2d, proSet);
    })() : null),

    // ── NRLA — branch-vs-branch round-robin league. Runs on its own 2-day
    // round schedule (season start + baseline set on the board itself), so
    // the Comp Window above is intentionally not applied. ──
    (state.indicatorsComps && isNrlaComp() ? nrlaBoard(state._indicatorRawSales || []) : null),

    // Avg Pest Initial / Raffle competition card, lifted to the top.
    // Hidden on the NRLA tab — that comp shows ONLY its own dashboard.
    // Hidden in rep-lite too.
    (_repLite || (state.indicatorsComps && isNrlaComp()) ? null : _topCompCard),

    // Rep - Partner: their OWN player card pinned at the very top of the
    // page (above the metrics table + charts) — per Isaac. Respects the
    // Customize hide toggle; the stack below skips 'card' so it can't
    // render twice.
    // Partners / office leads with a team default to the TEAM card, with a
    // Team / Me toggle to flip to their personal card (per Isaac).
    _isPartner && !_focusedComp && userCan('ind_card') && !(_repLayoutPrefs().hidden || []).includes('card') && partnerLandingCard(),
    // Sales reps: Your Performance Trends sits right under the player card,
    // ahead of the Indicators table + Power Ranking (per Isaac).
    _repSalesLayout && !_focusedComp && userCan('ind_yoy') && !(_repLayoutPrefs().hidden || []).includes('yoy') && indicatorYoYTrendChart(),

    // ── Main metrics table (click metric name to sort branches) ──
    // Rep accounts get the focused view (Performance Trends + Rep
    // Leaderboard); PARTNERS also get this Power Ranking table (per Isaac).
    // Edit-mode controls inside stay admin-only via their own gates.
    !_focusedComp && (!_repLite || userCan('ind_table')) && (() => {
      // Sort state: which metric is sorting the columns, and direction
      if (!state._indicatorSort) state._indicatorSort = { key: null, asc: false };
      const sort = state._indicatorSort;

      // Determine column order (branches sorted by the selected metric)
      let sortedBranches = [...branches];
      if (sort.key === '_points') {
        // Total Points lives outside branchData — sort by it directly. Lower = better (golf scoring).
        // Ties: higher D2D Revenue, then higher Avg Pest Initial.
        sortedBranches.sort((a, b) => {
          const cmp = powerRankCompare(a, b);
          return sort.asc ? cmp : -cmp;
        });
      } else if (sort.key) {
        sortedBranches.sort((a, b) => {
          const va = branchData[a]?.[sort.key] || 0;
          const vb = branchData[b]?.[sort.key] || 0;
          return sort.asc ? va - vb : vb - va;
        });
      }

      // Dept-aware metric rows: Office Staff drops PRA + Audit % and shows the
      // New / Renewal revenue split; every other dept hides the split and keeps
      // PRA + Audit %.
      const _deptT = state.indicatorDept || 'all';
      const _visibleMetrics = INDICATOR_METRICS.filter(m => {
        if (m.key === 'new_revenue' || m.key === 'renewal_revenue') return _deptT === 'office';
        // Audit % only appears on the Sales Rep tab; Last Resort % shows for
        // EVERY dept in both branch + team views (per Isaac) — context only,
        // still not a Power Ranking scorer.
        if (m.key === 'audit_pct') return _deptT === 'd2d';
        if (_deptT === 'office' && m.key === 'pra') return false;
        return true;
      });
      // Hidden rows (per Isaac): the ✕ on a row's label hides that metric
      // FOR THE CURRENT TYPE ONLY (All / Sales Rep / Office Staff /
      // Technician each keep their own list) — the "Hidden rows" strip at
      // the bottom of the table adds them back. Synced to every admin.
      const _hm = (state._indHiddenMetrics && typeof state._indHiddenMetrics === 'object') ? state._indHiddenMetrics : (state._indHiddenMetrics = {});
      const _hiddenKeys = Array.isArray(_hm[_deptT]) ? _hm[_deptT] : [];
      const _hiddenMetricDefs = _visibleMetrics.filter(m => _hiddenKeys.includes(m.key));
      const _shownMetrics = _visibleMetrics.filter(m => !_hiddenKeys.includes(m.key));
      const _saveHidden = (keys) => {
        _hm[_deptT] = keys;
        saveDemoData();
        if (typeof saveIndicatorState === 'function') saveIndicatorState();
        mountApp();
      };
      // The three hard-coded context rows are hideable too (per Isaac) —
      // they ride the same hidden list under pseudo-keys.
      const _CTX_EXTRA_ROWS = [['_pct_rev', '% of Revenue'], ['_reps_sale', 'Reps W/ A Sale'], ['_reps20k', 'Reps > $20K']];
      const _rowHidden = (key) => _hiddenKeys.includes(key);
      const _rowXBtn = (key) => (isAdminRole(state.profile?.role) && state._editMode) ? el('span', {
        class: 'ml-1.5 cursor-pointer select-none',
        style: { color: 'var(--text-subtle)', fontSize: '9px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '.04em' },
        title: 'Hide this row for the current Type — bring it back from the "Hidden rows" strip (nothing is deleted)',
        onclick: (e) => { e.stopPropagation(); _saveHidden([..._hiddenKeys, key]); },
      }, 'hide') : null;
      // SCORED metrics on top, CONTEXT metrics below a bold cutoff line
      // (per Isaac) — the same exclusion set Power Rank scoring uses.
      const _PR_CTX = new Set(['new_revenue', 'renewal_revenue', 'audit_pct', 'last_resort_pct']);
      const tableMetrics = [..._shownMetrics.filter(m => !_PR_CTX.has(m.key)), ..._shownMetrics.filter(m => _PR_CTX.has(m.key))];
      const _prDividerAt = _shownMetrics.some(m => _PR_CTX.has(m.key)) ? tableMetrics.filter(m => !_PR_CTX.has(m.key)).length : null;
      // Phone + rep/partner view (per Isaac): one branch column at a time —
      // defaults to THEIR branch (where their team / they sell the most),
      // with a dropdown to look at another branch. RIDD total stays.
      // Admins default to the RIDD (company) column; reps/partners to their own branch.
      const _narrowT = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
      let _branchSel = null;
      if (_narrowT && sortedBranches.length > 1) {
        const homeBranch = (() => {
          const pool = _rangeGroups ? Object.entries(_rangeGroups) : [];
          const mineTeams = (typeof myReachTeams === 'function') ? myReachTeams() : new Set();
          const tally = new Map();
          pool.forEach(([b, rows]) => rows.forEach(x => {
            const nm = x.rep ? getCanonicalRepName(x.rep) : '';
            if (!nm) return;
            const mine = (typeof isMyRepName === 'function' && isMyRepName(x.rep)) || mineTeams.has(getRepTeam(nm) || '');
            if (mine) tally.set(b, (tally.get(b) || 0) + 1);
          }));
          let best = '', n = 0; tally.forEach((v, k) => { if (v > n) { n = v; best = k; } });
          return best;
        })();
        const chosen = state._indMobileBranch === 'ridd' ? 'ridd'
          : sortedBranches.includes(state._indMobileBranch) ? state._indMobileBranch
          : !_repLite ? 'ridd'
          : (sortedBranches.includes(homeBranch) ? homeBranch : sortedBranches[0]);
        const _lblB = (b) => b.split(' ').map(w => (w[0] || '') + w.slice(1).toLowerCase()).join(' ');
        _branchSel = el('div', { class: 'flex items-center gap-2 px-3 py-2 border-b', style: { borderColor: 'var(--border)' } },
          el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, groupBy === 'teams' ? 'Team' : 'Office'),
          el('select', {
            class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold flex-1',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            onchange: (e) => { state._indMobileBranch = e.target.value; mountApp(); },
          },
            el('option', { value: 'ridd', selected: chosen === 'ridd' }, 'RIDD'),
            ...sortedBranches.map(b => el('option', { value: b, selected: chosen === b }, _lblB(b) + (b === homeBranch ? ' \u00b7 mine' : '')))));
        if (chosen === 'ridd' || chosen === 'all') sortedBranches = [];
        else sortedBranches = [chosen];
      }
      return el('div', { class: 'card overflow-hidden' },
        _branchSel,
        el('div', { class: 'scroll-x' },
          // Real table display (the phone CSS turns card tables into blocks
          // so they can scroll — that also stops them filling the width once
          // there's only one branch column, per Isaac).
          el('table', { class: 'w-full text-xs', style: { display: 'table', width: '100%' } },
            el('thead', {},
              el('tr', {},
                el('th', { class: 'text-left px-3 py-2 text-[10px] uppercase tracking-wider text-muted- font-semibold sticky left-0', style: { background: 'var(--card)', zIndex: 2 } },
                  'Indicators'),
                // Column headers click through to a pooled entity player card
                // (branch or team, matching the grouping mode) ranked against
                // its peer columns — same card as a rep, fed the group's sales.
                ...sortedBranches.map((b, i) => (() => {
                  const _lbl = b.split(' ').map(w => (w[0] || '') + w.slice(1).toLowerCase()).join(' ');
                  const _canOpen = !!(_rangeGroups && (_rangeGroups[b] || []).length);
                  // Rank-excluded columns (trophy picker) read as OUT of the
                  // competition: faded header with a strike through the name.
                  // (Excluded columns are NOT faded on the table anymore —
                  // the exclusion reads in the 🏆 dropdown instead, per Isaac.)
                  return el('th', {
                    class: 'text-center px-3 py-2 text-[10px] uppercase tracking-wider font-bold' + (_canOpen ? ' cursor-pointer select-none' : ''),
                    style: { background: getGroupColor(b), color: groupHeaderTextColor(getGroupColor(b)), minWidth: '100px' },
                    title: _canOpen ? 'Open the ' + _lbl + ' player card' : '',
                    onclick: _canOpen ? () => {
                      const peers = sortedBranches
                        .map(x => ({ name: x.split(' ').map(w => (w[0] || '') + w.slice(1).toLowerCase()).join(' '), sales: _rangeGroups[x] || [] }))
                        .filter(p => p.sales.length);
                      openIndicatorRepCard(_scopeRep({ name: _lbl, sales: _rangeGroups[b] }, () => true), peers);
                    } : undefined,
                  },
                    sort.key ? (i + 1) + '. ' : '',
                    _lbl,
                  );
                })()),
                (() => {
                  const _all = _rangeGroups ? Object.values(_rangeGroups).flat() : [];
                  return el('th', {
                    class: 'text-center px-3 py-2 text-[10px] uppercase tracking-wider font-bold' + (_all.length ? ' cursor-pointer select-none' : ''),
                    style: { background: '#323230', color: RIDD_COLOR, minWidth: '100px' },
                    title: _all.length ? 'Open the company-wide RIDD player card' : '',
                    onclick: _all.length ? () => openIndicatorRepCard(_scopeRep({ name: 'RIDD', sales: _all }, () => true), [{ name: 'RIDD', sales: _all }]) : undefined,
                  }, 'RIDD');
                })(),
              ),
            ),
            el('tbody', {},
              ...tableMetrics.flatMap((m, _mi) => {
                const isSorting = sort.key === m.key;
                // Bold cutoff: everything above counts toward Power Rank,
                // everything below is context.
                // The divider bar IS the collapse control (per Isaac): click
                // it to fold every context row below — the Power Rank row
                // always stays.
                const _divider = (_prDividerAt != null && _mi === _prDividerAt) ? [el('tr', {},
                  el('td', {
                    colspan: String(sortedBranches.length + 2),
                    class: 'px-3 py-1 text-[9px] uppercase tracking-widest font-bold select-none cursor-pointer',
                    style: { borderTop: '3px solid var(--text)', background: 'var(--card-2)', color: 'var(--text-muted)' },
                    title: state._indCtxCollapsed ? 'Show the context rows' : 'Collapse the context rows \u2014 only Power Rank stays below the metrics',
                    onclick: () => {
                      state._indCtxCollapsed = !state._indCtxCollapsed;
                      try { localStorage.setItem('ridd_ind_ctx_collapsed', state._indCtxCollapsed ? '1' : '0'); } catch { /* private mode */ }
                      mountApp();
                    },
                  }, '\u25b2 counted in Power Rank \u00b7 ' + (state._indCtxCollapsed ? '\u25b8' : '\u25be') + ' context only' + (state._indCtxCollapsed ? ' \u2014 click to expand' : '')))] : [];
                // Collapsed: context metrics (Audit %, Last Resort %, …) fold
                // away too — only the divider itself stays as the handle.
                if (state._indCtxCollapsed && _PR_CTX.has(m.key)) return _divider;
                return [..._divider, el('tr', { class: 'border-t border-' + (isSorting ? ' font-bold' : '') },
                  (() => {
                    const cell = el('td', {
                      class: 'px-3 py-2 font-semibold text-xs sticky left-0 select-none',
                      style: { background: 'var(--card)', zIndex: 1, cursor: 'help', color: isSorting ? 'var(--accent)' : '' },
                    },
                      indicatorMetricLabel(m),
                      // "hide" hides this row for the current Type (per
                      // Isaac) — add it back from the strip under the table.
                      (isAdminRole(state.profile?.role) && state._editMode) ? el('span', {
                        class: 'ml-1.5 cursor-pointer select-none',
                        style: { color: 'var(--text-subtle)', fontSize: '9px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '.04em' },
                        title: 'Hide this row for the current Type — bring it back from the "Hidden rows" strip under the table (nothing is deleted)',
                        onclick: (e) => { e.stopPropagation(); _saveHidden([..._hiddenKeys, m.key]); },
                      }, 'hide') : null,
                    );
                    attachExplainer(cell, { title: indicatorMetricLabel(m), desc: indicatorMetricHelp(m.key) });
                    return cell;
                  })(),
                  ...sortedBranches.map(b => el('td', { class: 'px-3 py-2 text-center tabular-nums' },
                    branchData[b] ? m.fmt(branchData[b][m.key]) : '—',
                  )),
                  el('td', { class: 'px-3 py-2 text-center tabular-nums font-bold' }, m.fmt(riddTotal[m.key])),
                )];
              }),
              // Reps W/ A Sale row — context, not a scored metric. Sits
              // between the scored metrics and the Power Rank row so the
              // manager can read "branch X put up these numbers with N
              // reps." Sortable like any metric row; RIDD total sums
              // branch reps (same convention PRA uses for its
              // denominator — accepts the cross-branch double-count of a
              // rep who worked multiple offices in the window).
              // % of Revenue — each column's share of the RIDD total, i.e.
              // the weight that branch / team / department leg is pulling.
              // ── Collapsible context rows (% of Revenue · Reps W/ A Sale ·
              // Reps > $20K): the ▾ on the right folds them away so the
              // table reads scored metrics → Power Rank directly. Sticky
              // per browser via localStorage.
              // (collapsed-state expand handle lives on the divider bar now)
              (state._indCtxCollapsed || _rowHidden('_pct_rev')) ? null : (() => {
                const totRev = activeBranches.reduce((a, b) => a + (branchData[b]?.revenue || 0), 0);
                const cell = el('td', {
                  class: 'px-3 py-2 font-semibold text-xs sticky left-0 select-none',
                  style: { background: 'var(--card)', zIndex: 1, cursor: 'help' },
                },
                  // (collapse toggle lives on the divider bar now — per Isaac)
                  '% of Revenue', _rowXBtn('_pct_rev'));
                attachExplainer(cell, { title: '% of Revenue', desc: 'This column\u2019s revenue \u00f7 the RIDD total for the same window \u2014 the share of company production each ' + (groupBy === 'dept' ? 'department' : groupBy === 'teams' ? 'team' : 'branch') + ' is contributing.' });
                return el('tr', { class: 'border-t border-' },
                  cell,
                  ...sortedBranches.map(b => el('td', { class: 'px-3 py-2 text-center tabular-nums font-semibold', style: { color: 'var(--accent)' } },
                    (branchData[b] && totRev > 0) ? ((branchData[b].revenue || 0) / totRev * 100).toFixed(1) + '%' : '—',
                  )),
                  el('td', { class: 'px-3 py-2 text-center tabular-nums font-bold whitespace-nowrap' },
                    totRev > 0 ? '100%' : '—'),
                );
              })(),
              (state._indCtxCollapsed || _rowHidden('_reps_sale')) ? null : (() => {
                const isSortingReps = sort.key === 'reps';
                const totalReps = activeBranches.reduce((a, b) => a + (branchData[b]?.reps || 0), 0);
                return el('tr', { class: 'border-t border-' + (isSortingReps ? ' font-bold' : '') },
                  (() => {
                    const cell = el('td', {
                      class: 'px-3 py-2 font-semibold text-xs sticky left-0 select-none',
                      style: { background: 'var(--card)', zIndex: 1, cursor: 'help', color: isSortingReps ? 'var(--accent)' : '' },
                    },
                      'Reps W/ A Sale', _rowXBtn('_reps_sale'),
                    );
                    attachExplainer(cell, { title: 'Reps W/ A Sale', desc: indicatorMetricHelp('reps') });
                    return cell;
                  })(),
                  ...sortedBranches.map(b => el('td', {
                    class: 'px-3 py-2 text-center tabular-nums' + (branchData[b] ? ' cursor-pointer hover:underline' : ''),
                    title: branchData[b] ? 'Click to see exactly which reps are counted here' : '',
                    onclick: branchData[b] ? (() => openRepsDrill(b)) : null,
                  },
                    branchData[b] ? fmt.int(branchData[b].reps || 0) : '—',
                  )),
                  el('td', { class: 'px-3 py-2 text-center tabular-nums font-bold' }, fmt.int(totalReps)),
                );
              })(),
              // Reps > $20K — the PRA denominator. Context only, never
              // scored: shows how many reps actually cleared the $20K
              // qualification bar in each column's window.
              (state._indCtxCollapsed || _rowHidden('_reps20k')) ? null : (() => {
                const total20 = activeBranches.reduce((a, b) => a + (branchData[b]?.reps20k ?? branchData[b]?.reps ?? 0), 0);
                const cell = el('td', {
                  class: 'px-3 py-2 font-semibold text-xs sticky left-0 select-none',
                  style: { background: 'var(--card)', zIndex: 1, cursor: 'help' },
                }, 'Reps > $20K', _rowXBtn('_reps20k'));
                attachExplainer(cell, { title: 'Reps > $20K', desc: indicatorMetricHelp('reps20k') });
                return el('tr', { class: 'border-t border-' },
                  cell,
                  ...sortedBranches.map(b => el('td', {
                    class: 'px-3 py-2 text-center tabular-nums' + (branchData[b] ? ' cursor-pointer hover:underline' : ''),
                    title: branchData[b] ? 'Click to see exactly which reps qualify (and who misses the $20K bar)' : '',
                    onclick: branchData[b] ? (() => openRepsDrill(b)) : null,
                  },
                    branchData[b] ? fmt.int(branchData[b].reps20k ?? branchData[b].reps ?? 0) : '—',
                  )),
                  el('td', { class: 'px-3 py-2 text-center tabular-nums font-bold' }, fmt.int(total20)),
                );
              })(),
              // Restore strip — one chip per hidden metric for this Type.
              // Sits right above Power Rank (per Isaac).
              (() => {
                const _hiddenChips = [
                  ..._hiddenMetricDefs.map(m => [m.key, indicatorMetricLabel(m)]),
                  ..._CTX_EXTRA_ROWS.filter(([k]) => _hiddenKeys.includes(k)),
                ];
                if (!_hiddenChips.length || !isAdminRole(state.profile?.role) || !state._editMode) return null;
                return el('tr', {},
                el('td', {
                  colspan: String(sortedBranches.length + 2),
                  class: 'px-3 py-1.5 text-[10px]',
                  style: { background: 'var(--card-2)', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' },
                },
                  el('span', { class: 'font-bold uppercase tracking-widest text-[9px] mr-2' }, 'Hidden rows:'),
                  ..._hiddenChips.map(([k, lbl]) => el('button', {
                    class: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold cursor-pointer transition hover:brightness-95 mr-1.5',
                    style: { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
                    title: 'Add \u201c' + lbl + '\u201d back to the table',
                    onclick: () => _saveHidden(_hiddenKeys.filter(x => x !== k)),
                  }, '+ ' + lbl))));
              })(),
              // Power Rank row — shows each branch's overall rank (1 = best).
              // Underlying total points still drive the ranking and remain
              // visible on the Power Ranking card below.
              (() => {
                const rankByBranch = {};
                powerRanking.forEach((b, i) => { rankByBranch[b] = i + 1; });
                return el('tr', { class: 'border-t-2', style: { borderColor: 'var(--accent)' } },
                  (() => {
                    const cell = el('td', {
                      class: 'px-3 py-2 font-bold text-xs sticky left-0 select-none',
                      style: { background: 'var(--card)', zIndex: 1, cursor: 'help', color: sort.key === '_points' ? 'var(--accent)' : '' },
                    },
                      'Power Rank',
                    );
                    attachExplainer(cell, { title: 'Power Rank', desc: indicatorMetricHelp('_points') });
                    return cell;
                  })(),
                  ...sortedBranches.map(b => el('td', {
                    class: 'px-3 py-2 text-center tabular-nums font-black text-base whitespace-nowrap',
                    style: rankByBranch[b] === 1 ? { color: 'var(--accent)' } : {},
                  }, rankByBranch[b]
                    ? el('span', {}, '#' + rankByBranch[b],
                        el('span', { class: 'text-[10px] font-semibold text-muted- ml-1' }, (totalPoints[b] || 0) + ' pts'))
                    : '—')),
                  el('td', {}),
                );
              })(),
            ),
          ),
        ),
      );
    })(),

    // (Rankings matrix + Power Ranking cards removed — the main Indicators
    // table's Power Rank row now carries rank AND total points per column,
    // so the two cards below were redundant. Per-metric rank detail still
    // feeds the PDF reports via `rankings`/`powerRanking`.)

    // ── Charts ──
    // Granularity follows the range selector: ≤31 days plots DAILY points
    // (so This Week / Last Week actually graph), ≤180 days stays weekly,
    // longer ranges roll up to months — same rules as getChartBuckets.
    // Day/month axes aggregate straight from the raw sales.
    (!_repLite || userCan('ind_power_chart')) && !_focusedComp && (() => {
      let chartData = isRange ? data : allData;
      let chartWeeks = isRange ? weeks : allWeeks;
      let chartLabels = null;
      let grain = 'Weekly';
      const rawAvail = Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length > 0;
      if (isRange && rawAvail && rangeBounds) {
        const buckets = getChartBuckets(rangeBounds, allWeeks, state.indicatorsData);
        if (buckets.length > 0 && buckets[0].kind !== 'week') {
          const groupFn = state.indicatorsGroupBy === 'teams'
            ? (s => getRepTeam(s.rep) || 'Unassigned')
            : state.indicatorsGroupBy === 'dept'
              ? (s => DEPT_GROUP_LABELS[_indicatorDeptOf(s)] || 'OFFICE STAFF')   // was office names — dept ranks were alphabetical ties
              : (s => s.office || 'Unknown');
          chartData = aggregateRawSalesByBucket(indicatorSales(), groupFn, buckets,
            state.indicatorsGroupBy === 'teams', indicatorAvgInitialIsPest() ? TEAM_PEST_EXCLUDE : null);
          chartWeeks = buckets.map((b, i) => i);
          chartLabels = buckets.map(b => b.label);
          grain = buckets[0].kind === 'day' ? 'Daily' : 'Monthly';
        }
      }
      // TREND RULE: lines end at the last COMPLETED period. A half-filled
      // week/month plots as a cliff-dive on every line — the live numbers
      // belong to the tables, not the trend shape. Detect "last bucket
      // includes today" via the bucket matcher (range mode) or the week
      // math (weekly mode), then slice it off every chart series.
      const _todaySale = (() => { const t = new Date(); return { dateSold: (t.getMonth() + 1) + '/' + t.getDate() + '/' + t.getFullYear() }; })();
      let _liveTail = false;
      if (isRange && rawAvail && rangeBounds && chartLabels) {
        const bks = getChartBuckets(rangeBounds, allWeeks, state.indicatorsData);
        const lb = bks[bks.length - 1];
        _liveTail = !!(lb && lb.match && lb.match(_todaySale));
      } else if (Array.isArray(chartWeeks) && chartWeeks.length) {
        // weekly mode: the newest week bucket is live if any sale THIS week exists
        const lastW = chartWeeks[chartWeeks.length - 1];
        _liveTail = (state._indicatorRawSales || []).some(x => x && x.week === lastW && (() => {
          const d = (typeof _parseIndicatorDay === 'function') ? _parseIndicatorDay(x) : null;
          if (!d) return false;
          const t = new Date(); t.setHours(0, 0, 0, 0);
          const ws = new Date(t); ws.setDate(ws.getDate() - ws.getDay());
          return d >= ws;
        })());
      }
      if (_liveTail && chartWeeks.length > 1) {
        chartWeeks = chartWeeks.slice(0, -1);
        if (chartLabels) chartLabels = chartLabels.slice(0, -1);
      }
      // Office Staff hides the branch-level charts (Power Ranking / PRA /
      // Revenue) — only the YoY trend stays.
      const _hideBranchCharts = state.indicatorDept === 'office';
      return el('div', { class: 'flex flex-col gap-4' },
        !_hideBranchCharts && el('div', {},
          indicatorChart('Power Ranking', chartData, branches, '_power_ranking', chartWeeks, true, chartLabels),
        ),
        // Monthly/Weekly PRA + Revenue cards RETIRED (Jul 2026, per Isaac) —
        // the Performance Trends chart covers them via its Scope picker and
        // the Weeks/Months/Years view in the Years dropdown.
        false && el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
          indicatorChart(grain + ' PRA',     chartData, branches, 'pra',     chartWeeks, false, chartLabels),
          indicatorChart(grain + ' Revenue', chartData, branches, 'revenue', chartWeeks, false, chartLabels),
        ),
        // Partners get the YoY/Performance Trends chart inside their
        // personalized stack (yoy builder) — rendering it here too would
        // double it up.
        !_repLite && indicatorYoYTrendChart(),
      );
    })(),

    // ════════════════════════════════════════════════════════════════
    // REP-LEVEL ANALYTICS (computed from raw sales if available)
    // ════════════════════════════════════════════════════════════════
    ...(_focusedComp ? [] : (_repLite
      ? (() => {
          // Rep home page — PERSONALIZED: section order + visibility come
          // from ✏️ Customize (per device). Default order: player card,
          // YTD chart, weekly trend, leaderboard.
          const prefs = _repLayoutPrefs();
          const builders = {
            // Every section is gated by the Settings → Permissions matrix.
            card:  () => (!_isPartner && userCan('ind_card')) ? [repLandingPlayerCard()] : [],   // analyst layout pins it at page top instead
            yoy:   () => (!_repSalesLayout && userCan('ind_yoy')) ? [indicatorYoYTrendChart()] : [],   // sales reps: pinned under the player card instead
            trend: () => userCan('ind_trend') ? _repSections.filter(n => n && n.getAttribute && n.getAttribute('data-indsection') === 'repTrend') : [],
            board: () => userCan('ind_board') ? _repSections.filter(n => n && n.getAttribute && n.getAttribute('data-section') === 'rep-leaderboard') : [],
            records: () => userCan('ind_records') ? _repSections.filter(n => n && n.getAttribute && n.getAttribute('data-section') === 'agg-records') : [],
            class:   () => userCan('ind_class') ? _repSections.filter(n => n && n.getAttribute && n.getAttribute('data-section') === 'class-metrics') : [],
            mix:     () => userCan('ind_mix') ? _repSections.filter(n => n && n.getAttribute && n.getAttribute('data-section') === 'sales-mix') : [],
          };
          const out = [];
          prefs.order.forEach(k => {
            if (prefs.hidden.includes(k) || !builders[k]) return;
            builders[k]().forEach(n => { if (n) out.push(n); });
          });
          return out.length ? out : [repLandingPlayerCard()];
        })()
      : _repSections)),
  );
}

// ── Weekly recap (#9) — in-app, no Slack dependency. ─────────────────────
// First time a rep opens the app each week, a recap card pops: last week's
// production vs the week before, best day, accounts. Shown once per ISO week
// per browser (localStorage stamp). Admins are skipped — this is rep candy.
function maybeShowWeeklyRecap() {
  // Retired for every user type (per Isaac, Sep 2026) — the popup is gone;
  // the numbers still live on My Stats / the player card.
  return;
  try {
    if ((typeof DEMO !== 'undefined' && DEMO) || !state.profile || isAdminRole(state.profile?.role)) return;
    // Office staff skip the recap popup (per Isaac) — they live in the app
    // daily and land straight on the Sales tab; the popup is D2D rep candy.
    if (typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(state.profile)) return;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    // Company week runs Sunday–Saturday (per Isaac) — key on the Sunday.
    const sunday = new Date(now); sunday.setDate(now.getDate() - now.getDay());
    const weekKey = sunday.toISOString().slice(0, 10);
    const KEY = 'ridd_recap_shown_for::' + ((state.profile && state.profile.id) || 'anon');
    if (localStorage.getItem(KEY) === weekKey) return;

    // Same dual-path rows as My Stats: CRM dataset by name (D2D), else logged sales.
    const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const mySig = _sig(state.profile.full_name);
    const d2d = (state._indicatorRawSales || []).filter(s => s && s.rep && frPendingServiced(s) && (isMyRepName(s.rep) || _sig(getCanonicalRepName(s.rep)) === mySig))
      .map(s => ({ d: _parseIndicatorDay(s), rev: Number(s.contractValue) || 0 })).filter(r => r.d);
    const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
    const rows = d2d.length ? d2d : (state.mySales || []).filter(s => !EXCLUDE.has(s.audit_status))
      .map(s => ({ d: s.sold_date ? new Date(s.sold_date + 'T00:00') : null, rev: Number(s.revenue_amount) || 0 }))
      .filter(r => r.d && !isNaN(r.d));
    const lastMon = new Date(sunday); lastMon.setDate(sunday.getDate() - 7);
    const prevMon = new Date(sunday); prevMon.setDate(sunday.getDate() - 14);
    const inWin = (r, a, b) => r.d >= a && r.d < b;
    const lastWk = rows.filter(r => inWin(r, lastMon, sunday));
    const prevWk = rows.filter(r => inWin(r, prevMon, lastMon));
    if (!lastWk.length && !prevWk.length) { localStorage.setItem(KEY, weekKey); return; }  // nothing to recap

    localStorage.setItem(KEY, weekKey);
    const sum = (a) => a.reduce((s, r) => s + r.rev, 0);
    const lastRev = sum(lastWk), prevRev = sum(prevWk);
    const byDay = {};
    lastWk.forEach(r => { const k = r.d.toISOString().slice(0, 10); byDay[k] = (byDay[k] || 0) + r.rev; });
    const bestDayEntry = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
    const money = (n) => '$' + Math.round(n || 0).toLocaleString();
    const delta = lastRev - prevRev;
    const cheer = lastRev === 0 ? 'Fresh week, clean slate — go get one today.'
      : delta >= 0 && prevRev > 0 ? 'Up ' + money(delta) + ' on the week before — keep the streak rolling. 🔥'
      : delta >= 0 ? 'On the board — build on it this week. 💪'
      : 'Down ' + money(-delta) + ' vs the week before — this week\'s the bounce-back.';

    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const statBox = (label, val) => el('div', { class: 'rounded-lg border p-3 text-center', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
      el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-lg font-bold tabular-nums mt-1' }, val));
    overlay.append(el('div', { class: 'card w-full max-w-sm p-5 flex flex-col gap-4' },
      el('div', { class: 'flex items-center justify-between' },
        el('div', {},
          el('h2', { class: 'text-lg font-bold' }, '📬 Your Week in Review'),
          el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } },
            lastMon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' +
            new Date(sunday.getTime() - 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
      el('div', { class: 'grid grid-cols-3 gap-2' },
        statBox('Revenue', money(lastRev)),
        statBox('Accounts', String(lastWk.length)),
        statBox('Best Day', bestDayEntry ? money(bestDayEntry[1]) : '—')),
      prevRev > 0 || lastRev > 0 ? el('div', { class: 'text-xs text-center font-semibold', style: { color: delta >= 0 ? '#DF643A' : '#A9441F' } },
        (prevRev > 0 ? (delta >= 0 ? '▲ ' : '▼ ') + money(Math.abs(delta)) + ' vs the week before · ' : '') + cheer) : null,
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: close,
      }, 'Let\'s go')));
    document.body.append(overlay);
  } catch (e) { console.warn('[ridd] weekly recap skipped', e); }
}

// ── My Stats — the rep's personal card at the top of their Indicators. ────
// Goal pace uses the goal THEY set in ⚙ My Settings. Sales come from the
// shared CRM dataset matched by name (D2D reps); office staff fall back to
// the sales they logged in the app. Returns null when there's nothing to
// show yet.
function myStatsCard() {
  const p = state.profile || {};
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const mySigName = _sig(p.full_name);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const jan1 = new Date(now.getFullYear(), 0, 1);

  // D2D path: match this rep's rows in the shared dataset by name signature,
  // through the same FR Pending/Serviced gate as every leaderboard number.
  const d2dSales = (state._indicatorRawSales || []).filter(s =>
    s && s.rep && frPendingServiced(s) && _sig(getCanonicalRepName(s.rep)) === mySigName);
  let rows;
  if (d2dSales.length) {
    rows = d2dSales.map(s => ({ d: _parseIndicatorDay(s), rev: Number(s.contractValue) || 0 })).filter(r => r.d);
  } else {
    // Office-staff path: the sales they logged in the app.
    const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
    rows = (state.mySales || []).filter(s => !EXCLUDE.has(s.audit_status))
      .map(s => ({ d: s.sold_date ? new Date(s.sold_date + 'T00:00') : null, rev: Number(s.revenue_amount) || 0 }))
      .filter(r => r.d && !isNaN(r.d));
  }
  if (!rows.length && !(p.annual_revenue_goal > 0)) return null;

  const ytd = rows.filter(r => r.d >= jan1);
  const ytdRev = ytd.reduce((a, r) => a + r.rev, 0);
  const ytdCount = ytd.length;
  // This week (Sun–Sat window containing today — company week).
  const dow = now.getDay();                                 // Sun=0
  const wkStart = new Date(now); wkStart.setDate(now.getDate() - dow);
  const weekRev = rows.filter(r => r.d >= wkStart && r.d <= now).reduce((a, r) => a + r.rev, 0);
  // Streak: consecutive selling DAYS (Sundays don't break it) ending today
  // or yesterday.
  const dayKey = (d) => d.toISOString().slice(0, 10);
  const daysWith = new Set(rows.map(r => dayKey(r.d)));
  let streak = 0;
  const cur = new Date(now);
  if (!daysWith.has(dayKey(cur))) cur.setDate(cur.getDate() - 1);   // today hasn't happened yet? start yesterday
  for (;;) {
    if (cur.getDay() === 0) { cur.setDate(cur.getDate() - 1); continue; }   // Sundays skip
    if (!daysWith.has(dayKey(cur))) break;
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  // Personal bests (day + week) across everything loaded.
  const byDay = {}, byWeek = {};
  for (const r of rows) {
    const dk = dayKey(r.d);
    byDay[dk] = (byDay[dk] || 0) + r.rev;
    const ws = new Date(r.d); ws.setDate(r.d.getDate() - r.d.getDay());   // Sun–Sat week
    const wk = dayKey(ws);
    byWeek[wk] = (byWeek[wk] || 0) + r.rev;
  }
  const bestDay = Math.max(0, ...Object.values(byDay));
  const bestWeek = Math.max(0, ...Object.values(byWeek));
  // Selling-day averages (YTD): only days with ≥1 sale count — days off never
  // drag the average.
  const _ytdDays = new Set(ytd.map(r => dayKey(r.d)));
  const sellDays = _ytdDays.size;
  const revPerDay = sellDays > 0 ? ytdRev / sellDays : 0;
  const acctsPerDay = sellDays > 0 ? ytdCount / sellDays : 0;

  // Goal pace — where they SHOULD be today if the year tracked evenly.
  const goal = Number(p.annual_revenue_goal) || 0;
  const yearFrac = (now - jan1) / (new Date(now.getFullYear() + 1, 0, 1) - jan1);
  const expected = goal * yearFrac;
  const delta = ytdRev - expected;
  const pct = goal > 0 ? Math.min(100, Math.round(100 * ytdRev / goal)) : 0;

  const money = (n) => '$' + Math.round(n || 0).toLocaleString();
  const stat = (label, val, sub, color) => el('div', { class: 'rounded-lg border p-3', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-lg font-bold tabular-nums mt-1', style: color ? { color } : {} }, val),
    sub ? el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } }, sub) : null);

  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between flex-wrap gap-2 mb-3' },
      el('div', { class: 'text-sm font-bold' }, 'My Stats'),
      el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } },
        goal > 0 ? 'Annual goal' : 'No annual goal set')),
    goal > 0 ? el('div', { class: 'mb-3' },
      el('div', { class: 'flex items-baseline justify-between text-xs mb-1' },
        el('span', { class: 'font-semibold' }, money(ytdRev) + ' of ' + money(goal) + ' YTD'),
        el('span', { class: 'font-bold tabular-nums', style: { color: delta >= 0 ? '#DF643A' : '#DC2626' } },
          (delta >= 0 ? '▲ ' + money(delta) + ' ahead of pace' : '▼ ' + money(-delta) + ' behind pace'))),
      el('div', { style: { height: '10px', borderRadius: '0', background: 'var(--card-2)', overflow: 'hidden', position: 'relative' } },
        el('div', { style: { height: '100%', width: pct + '%', background: 'var(--accent)', borderRadius: '0' } }),
        // Pace marker — where today sits in the year.
        el('div', { title: 'Where today sits in the year', style: { position: 'absolute', top: '0', bottom: '0', left: Math.min(99.5, yearFrac * 100) + '%', width: '2px', background: 'var(--text)' } }))) : null,
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
      stat('This Week', money(weekRev), null),
      stat('Streak', streak + (streak === 1 ? ' day' : ' days'), 'consecutive selling days · Sundays don\'t break it', streak >= 3 ? '#A9441F' : null),
      stat('Best Day', bestDay > 0 ? money(bestDay) : '—', null),
      stat('Best Week', bestWeek > 0 ? money(bestWeek) : '—', null),
      stat('Selling Days', String(sellDays), 'days with ≥1 sale · YTD'),
      stat('$ / Selling Day', sellDays > 0 ? money(revPerDay) : '—', 'days off don\'t count'),
      stat('Accts / Day', sellDays > 0 ? acctsPerDay.toFixed(1) : '—', 'per selling day')),
    ytdCount ? el('div', { class: 'text-[10px] mt-2', style: { color: 'var(--text-subtle)' } }, ytdCount + ' accounts YTD') : null);
}

// ── Rep-level sections for Indicators tab ──
// ── Avg Pest Initial / Raffle comp card ──────────────────────────────────
// Standalone so BOTH homes can render it: Indicators → Comps (via the thin
// buildD2DCompSection wrapper) and the Competitions tab. `rerender` is how
// the card's own comp-window inputs refresh their host.
function buildAvgPestCompCard({ cf, allRawSales, rawSales, windowLabel, applyExclusion, rerender }) {
    const compBounds = (cf.start && cf.end)
      ? { start: new Date(cf.start + 'T00:00'), end: new Date(cf.end + 'T23:59') }
      : null;
    const compRawSales = compBounds
      ? (allRawSales || []).filter(s => {
          if (applyExclusion && isRepExcluded(s.rep)) return false;
          const d = _parseIndicatorDay(s);
          if (!d) return false;
          return d >= compBounds.start && d <= compBounds.end;
        })
      : rawSales;
    const compWindowLabel = compBounds
      ? compBounds.start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) + ' – ' + compBounds.end.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
      : (windowLabel || 'page filter');

    // Comp-scoped rep stats for the Avg Pest Initial comp (top 5 win,
    // top 15 visible). Independent of the page-level allReps map so the
    // comp window can move freely.
    // Eligibility = subscription is not Sentricon / German Roach /
    // Interior Flea. Post-service cancels still count — once the rep
    // ran the initial, the credit is earned. 3-day RORs and Sold-Not-
    // Started DON'T count because no initial was ever performed (rows
    // are kept in the dataset for Cancel Analysis but filtered here).
    //
    // Serviced-by-Friday gate: accounts in the window must be SERVICED
    // (≥1 service on the account) to qualify — the deadline is the Friday
    // after the window ends, so judge/export after that Friday. Pending
    // accounts that still haven't been serviced don't count. Skipped
    // entirely when the CSV has no services data (all zeros/missing) so a
    // thin export can't blank the whole comp.
    const _hasServicesData = compRawSales.some(s => Number(s.services) > 0);
    const compRepStats = {};
    let compPendingExcluded = 0;
    compRawSales.forEach(s => {
      const rep = s.rep || 'Unknown';
      if (!compRepStats[rep]) compRepStats[rep] = { name: rep, office: s.office, count: 0, pestSum: 0, pestCount: 0 };
      const r = compRepStats[rep];
      if (RAFFLE_EXCLUDE_RE.test(s.subscription || '')) return;
      if (_isExcludableCancel(s)) return;
      if (_hasServicesData && (Number(s.services) || 0) < 1) { compPendingExcluded++; return; }
      r.count++;
      r.pestSum += Number(s.initialPrice || 0);
      r.pestCount++;
    });
    // Two slices off the same ranked list:
    //   avgInitialQualifiers (top 5) → the comp's actual winners; drives
    //     the export download.
    //   avgInitialBoard (top 15) → on-screen table, so an admin can see
    //     who's close to making the top 5 without leaving the page.
    const rankedByPest = Object.values(compRepStats)
      .map(r => ({ ...r, avgPest: r.pestCount > 0 ? r.pestSum / r.pestCount : 0 }))
      .filter(r => r.count > AVG_PEST_MIN_ACCOUNTS)
      .sort((a, b) => b.avgPest - a.avgPest);
    const avgInitialQualifiers = rankedByPest.slice(0, 5);
    const avgInitialBoard      = rankedByPest.slice(0, 15);

    const raffleByRep = {};
    compRawSales.forEach(s => {
      if (RAFFLE_EXCLUDE_RE.test(s.subscription || '')) return;
      if (!isActiveAccount(s)) return;
      const tickets = ticketsForInitial(s.initialPrice);
      if (tickets === 0) return;
      if (!raffleByRep[s.rep]) raffleByRep[s.rep] = { name: s.rep, office: s.office, total: 0, tier1: 0, tier2: 0, tier3: 0 };
      const r = raffleByRep[s.rep];
      r.total += tickets;
      if (tickets === 1) r.tier1++;
      else if (tickets === 2) r.tier2++;
      else if (tickets === 3) r.tier3++;
    });
    const raffleSorted = Object.values(raffleByRep).sort((a, b) => b.total - a.total || b.tier3 - a.tier3 || b.tier2 - a.tier2);
    const raffleTotalTickets = raffleSorted.reduce((a, r) => a + r.total, 0);

    // Filter bar lives inline inside the unified section wrapper rather
    // than as its own card, so the visual chain "filter → these 2 cards"
    // is one bounded region.
    const compFilterBar = el('div', { class: 'flex items-center gap-3 flex-wrap px-3 py-2.5 mb-3 rounded-lg border', style: { borderColor: 'var(--border-2)', background: 'var(--card)' } },
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'D2D Comp Window'),
        el('span', { class: 'text-[10px] text-muted- italic' }, '· filters the two cards below'),
      ),
      el('div', { class: 'flex items-center gap-2 text-xs' },
        el('input', {
          type: 'date',
          value: cf.start,
          class: 'rounded border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)' },
          onchange: (e) => { cf.start = e.target.value; rerender(); },
        }),
        el('span', { class: 'text-muted-' }, '→'),
        el('input', {
          type: 'date',
          value: cf.end,
          class: 'rounded border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)' },
          onchange: (e) => { cf.end = e.target.value; rerender(); },
        }),
      ),
      el('div', { class: 'text-[11px] text-muted- ml-auto tabular-nums' },
        fmt.int(compRawSales.length) + ' sales · ' + compWindowLabel,
      ),
    );

  // Export every sale logged by the top-5 reps in the comp window —
  // includes the excluded-from-comp ones (Sentricon / German Roach /
  // Interior Flea) so the admin can audit why a rep's avg landed where
  // it did. First two columns flag each row's eligibility so the file
  // is sort/filter-friendly in Excel.
  // Sale is excluded from the comp if its subscription matches the
  // excluded categories (Sentricon / German Roach / Interior Flea).
  // Post-service cancels still count toward the comp, so we don't flag
  // those here. We return ALL applicable reasons (joined with " + ") so
  // an admin auditing the export can see the full story per row.
  const _excludeReason = (sale) => {
    const reasons = [];
    const sub = (sale.subscription || '').toLowerCase();
    if (/sentricon/.test(sub))       reasons.push('Sentricon');
    if (/german\s*roach/.test(sub))  reasons.push('German Roach');
    if (/interior\s*flea/.test(sub)) reasons.push('Interior Flea');
    return reasons.join(' + ');
  };
  const exportAvgPestCsv = () => {
    if (avgInitialQualifiers.length === 0) return toast('No top-5 reps to export', 'warn');
    const top5Names = new Set(avgInitialQualifiers.map(r => r.name));
    const top5Sales = compRawSales.filter(s => top5Names.has(s.rep || ''));
    if (top5Sales.length === 0) return toast('No sales to export', 'warn');

    // Sort: rep alphabetical, then included-first within each rep, then
    // newest first so each rep's "what counted" block reads top-to-bottom.
    top5Sales.sort((a, b) => {
      if (a.rep !== b.rep) return (a.rep || '').localeCompare(b.rep || '');
      const ae = _excludeReason(a) ? 1 : 0;
      const be = _excludeReason(b) ? 1 : 0;
      if (ae !== be) return ae - be;
      return (b.dateSold || '').localeCompare(a.dateSold || '');
    });

    const lines = [];
    const rawHeaders = state._indicatorRawHeaders;
    const haveRaw = Array.isArray(rawHeaders) && rawHeaders.length > 0
      && Array.isArray(top5Sales[0]._rawRow);

    if (haveRaw) {
      lines.push(['included_in_comp', 'exclusion_reason', ...rawHeaders.map(csvEsc)].join(','));
      top5Sales.forEach(s => {
        const reason = _excludeReason(s);
        const cells = (s._rawRow || []).map(csvEsc);
        while (cells.length < rawHeaders.length) cells.push('');
        cells.length = rawHeaders.length;
        lines.push([
          reason ? 'No' : 'Yes',
          csvEsc(reason),
          ...cells,
        ].join(','));
      });
    } else {
      const headers = [
        'included_in_comp', 'exclusion_reason',
        'rep', 'customer', 'customer_id', 'office', 'subscription', 'date_sold', 'week',
        'contract', 'initial_price', 'contract_value', 'recurring', 'services',
        'auto_pay', 'status', 'active', 'source', 'age', 'cancel_reason', 'cancel_date',
      ];
      lines.push(headers.join(','));
      top5Sales.forEach(s => {
        const reason = _excludeReason(s);
        lines.push([
          reason ? 'No' : 'Yes',
          csvEsc(reason),
          csvEsc(s.rep || ''),
          csvEsc(s.customer || ''),
          csvEsc(s.customerId || ''),
          csvEsc(s.office || ''),
          csvEsc(s.subscription || ''),
          csvEsc(s.dateSold || ''),
          s.week ?? '',
          s.contract ?? '',
          Number(s.initialPrice || 0).toFixed(2),
          Number(s.contractValue || 0).toFixed(2),
          Number(s.recurring || 0).toFixed(2),
          s.services ?? '',
          csvEsc(s.autoPay || ''),
          csvEsc(s.status || ''),
          csvEsc(s.active || ''),
          csvEsc(s.source || ''),
          s.age ?? 0,
          csvEsc(s.cancelReason || ''),
          csvEsc(s.cancelDate || ''),
        ].join(','));
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a = el('a', {
      href: url,
      download: 'ridd-top5-avg-pest-initial-' + new Date().toISOString().slice(0, 10) + '.csv',
    });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    const includedCount = top5Sales.filter(s => !_excludeReason(s)).length;
    toast('Exported ' + top5Sales.length + ' sales (' + includedCount + ' counted, ' + (top5Sales.length - includedCount) + ' excluded)', 'success');
  };

  // ── Card 1: Avg Pest Initial — ALL qualifying reps (6+ accounts), ranked. ──
  const avgInitialCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
        el('div', {},
          el('h3', { class: 'text-base font-black', style: { letterSpacing: '0.02em', textTransform: 'uppercase' } }, '🏆 Avg Pest Initial'),
        ),
        el('button', { class: 'px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition hover:brightness-95 shrink-0', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, title: 'Export top-5 avg pest initial sales', onclick: exportAvgPestCsv }, '↓ Export'),
      ),
    ),
    compPendingExcluded > 0 && el('div', {
      class: 'px-5 py-1.5 text-[10px] italic',
      style: { color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' },
      title: 'Accounts must be serviced by the Friday after the window ends to qualify — re-upload the CSV after that Friday for the final standings.',
    }, '⏳ ' + compPendingExcluded + ' pending account' + (compPendingExcluded === 1 ? '' : 's') + ' not yet serviced — excluded until serviced (deadline: Friday after window ends)'),
    rankedByPest.length === 0
      ? el('div', { class: 'p-6 text-center text-xs text-muted- italic' }, 'No reps with more than ' + AVG_PEST_MIN_ACCOUNTS + ' accounts in this window.')
      : el('div', { class: 'scroll-x', style: { maxHeight: '320px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', {
              class: 'text-[9px] uppercase tracking-wider text-muted-',
              style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: 1 },
            },
              el('tr', {},
                el('th', { class: 'text-left pl-5 pr-2 py-2 w-8' }, '#'),
                el('th', { class: 'text-left px-2 py-2' }, 'Rep'),
                el('th', { class: 'text-left px-2 py-2' }, 'Accounts'),
                el('th', { class: 'text-left pl-2 pr-5 py-2 font-bold' }, 'Avg Initial'),
              ),
            ),
            el('tbody', {},
              ...rankedByPest.map((r, i) => el('tr', { class: 'border-t border-' },
                el('td', { class: 'pl-5 pr-2 py-2 font-bold tabular-nums', style: i === 0 ? { color: '#DF643A' } : {} }, i + 1),
                el('td', { class: 'px-2 py-2 font-semibold' }, r.name),
                el('td', { class: 'px-2 py-2 text-left tabular-nums text-muted-' }, fmt.int(r.count)),
                el('td', { class: 'pl-2 pr-5 py-2 text-left tabular-nums font-black', style: i === 0 ? { color: '#DF643A' } : {} }, fmt.usd(r.avgPest)),
              )),
            ),
          ),
        ),
  );

  // ── Card 2: Raffle Tickets — all reps with tickets, ranked by total. ──
  const raffleCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-start justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex items-baseline gap-2 flex-wrap' },
        el('h3', { class: 'text-base font-black', style: { letterSpacing: '0.02em', textTransform: 'uppercase' } }, '🎟️ Raffle Tickets'),
        el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Entries'),
        el('span', { class: 'text-base font-black tabular-nums', style: { color: '#DF643A' } }, fmt.int(raffleTotalTickets)),
      ),
      el('div', { class: 'flex items-center gap-3' },
        el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95', style: { background: '#DF643A', color: '#323230' }, title: 'Spin a wheel to pick a winner (weighted by tickets)', onclick: () => openRaffleSpinModal(raffleSorted, raffleTotalTickets, compWindowLabel) }, '🎰 Spin'),
        el('button', { class: 'px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition hover:brightness-95', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, title: 'Export raffle tickets', onclick: () => exportRaffleCsv() }, '↓ Export'),
      ),
    ),
    raffleSorted.length === 0
      ? el('div', { class: 'p-6 text-center text-xs text-muted- italic' }, 'No qualifying sales (initial ≥ $149) in this window.')
      : el('div', { class: 'scroll-x', style: { maxHeight: '320px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', {
              class: 'text-[9px] uppercase tracking-wider text-muted-',
              style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: 1 },
            },
              el('tr', {},
                el('th', { class: 'text-left pl-5 pr-2 py-2 w-8' }, '#'),
                el('th', { class: 'text-left px-2 py-2' }, 'Rep'),
                el('th', { class: 'text-left px-2 py-2' }, '×1'),
                el('th', { class: 'text-left px-2 py-2' }, '×2'),
                el('th', { class: 'text-left px-2 py-2' }, '×3'),
                el('th', { class: 'text-left pl-2 pr-5 py-2 font-bold' }, 'Tickets'),
              ),
            ),
            el('tbody', {},
              ...raffleSorted.map((r, i) => el('tr', { class: 'border-t border-' },
                el('td', { class: 'pl-5 pr-2 py-2 font-bold tabular-nums', style: i === 0 ? { color: '#DF643A' } : {} }, i + 1),
                el('td', { class: 'px-2 py-2 font-semibold' }, r.name),
                el('td', { class: 'px-2 py-2 text-left tabular-nums text-muted-' }, r.tier1 ? fmt.int(r.tier1) : '—'),
                el('td', { class: 'px-2 py-2 text-left tabular-nums text-muted-' }, r.tier2 ? fmt.int(r.tier2) : '—'),
                el('td', { class: 'px-2 py-2 text-left tabular-nums text-muted-' }, r.tier3 ? fmt.int(r.tier3) : '—'),
                el('td', { class: 'pl-2 pr-5 py-2 text-left tabular-nums font-black', style: { color: '#DF643A' } }, fmt.int(r.total)),
              )),
            ),
          ),
        ),
  );

  const exportRaffleCsv = () => {
    if (raffleSorted.length === 0) return toast('No raffle entries to export', 'warn');

    // One row per qualifying sale, grouped by rep and sorted by tickets desc
    // within each rep so each rep's biggest contributors come first. Every
    // row has the full customer info from the upload + the tickets earned
    // on that specific sale. Scoped to compRawSales (the D2D Comp Window
    // filter that drives the table above) so the export always mirrors
    // exactly what the admin is looking at.
    const qualifying = compRawSales
      .filter(s => !RAFFLE_EXCLUDE_RE.test(s.subscription || '') && isActiveAccount(s) && ticketsForInitial(s.initialPrice) > 0)
      .sort((a, b) => {
        if (a.rep !== b.rep) return (a.rep || '').localeCompare(b.rep || '');
        const ta = ticketsForInitial(a.initialPrice);
        const tb = ticketsForInitial(b.initialPrice);
        if (ta !== tb) return tb - ta;
        return Number(b.initialPrice || 0) - Number(a.initialPrice || 0);
      });

    if (qualifying.length === 0) return toast('No qualifying sales to export', 'warn');

    // Two columns up front so the rep + tickets info is the first thing
    // visible when the file opens, then the rest of the CSV columns
    // (raw passthrough when available, parsed fields otherwise).
    const lines = [];
    const rawHeaders = state._indicatorRawHeaders;
    const haveRaw = Array.isArray(rawHeaders) && rawHeaders.length > 0
      && Array.isArray(qualifying[0]._rawRow);

    if (haveRaw) {
      // Lead with rep + tickets_earned + total_tickets_for_rep, then the full
      // original CSV columns so the user can fact-check byte-for-byte.
      const totalsByRep = {};
      raffleSorted.forEach(r => { totalsByRep[r.name] = r.total; });
      lines.push(['tickets_earned','rep_total_tickets', ...rawHeaders.map(csvEsc)].join(','));
      qualifying.forEach(s => {
        const cells = (s._rawRow || []).map(csvEsc);
        while (cells.length < rawHeaders.length) cells.push('');
        cells.length = rawHeaders.length;
        lines.push([
          ticketsForInitial(s.initialPrice),
          totalsByRep[s.rep] || 0,
          ...cells,
        ].join(','));
      });
    } else {
      // Fallback when the source row + headers weren't captured (older save).
      // Same idea — rep + tickets first, then all the parsed customer fields.
      const totalsByRep = {};
      raffleSorted.forEach(r => { totalsByRep[r.name] = r.total; });
      const detailHeaders = [
        'tickets_earned','rep_total_tickets',
        'rep','customer','customer_id','office','subscription','date_sold','week',
        'contract','initial_price','contract_value','recurring','services',
        'auto_pay','status','active','source','age','cancel_reason','cancel_date',
      ];
      lines.push(detailHeaders.join(','));
      qualifying.forEach(s => {
        lines.push([
          ticketsForInitial(s.initialPrice),
          totalsByRep[s.rep] || 0,
          csvEsc(s.rep || ''),
          csvEsc(s.customer || ''),
          csvEsc(s.customerId || ''),
          csvEsc(s.office || ''),
          csvEsc(s.subscription || ''),
          csvEsc(s.dateSold || ''),
          s.week ?? '',
          s.contract ?? '',
          Number(s.initialPrice || 0).toFixed(2),
          Number(s.contractValue || 0).toFixed(2),
          Number(s.recurring || 0).toFixed(2),
          s.services ?? '',
          csvEsc(s.autoPay || ''),
          csvEsc(s.status || ''),
          csvEsc(s.active || ''),
          csvEsc(s.source || ''),
          s.age ?? 0,
          csvEsc(s.cancelReason || ''),
          csvEsc(s.cancelDate || ''),
        ].join(','));
      });
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = el('a', { href: url, download: `ridd-raffle-${new Date().toISOString().slice(0,10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${qualifying.length} qualifying sales across ${raffleSorted.length} reps`, 'success');
  };

    // The wrapper carries a data-section marker so replaceD2DCompSection()
    // can find and swap just this chunk on date changes — no full re-render.
    // The shaded outer card visually unifies the filter + the two scoped
    // tables so it's clear the filter only applies to those two.
    return el('div', {
      'data-section': 'd2d-comp',
      class: 'rounded-xl border overflow-hidden',
      style: { borderColor: '#DF643A', background: 'var(--card-2)' },
    },
      // Spanning banner that unifies both scoped tables under one competition
      // heading while keeping the two cards visually separate below it.
      el('div', { style: { background: '#DF643A', padding: '12px 16px', borderBottom: '3px solid #A9441F' } },
        el('div', { class: 'flex items-center justify-between gap-3' },
          el('div', { class: 'flex items-center gap-3' },
            el('div', { style: { fontSize: '26px', lineHeight: '1' } }, '🏆'),
            el('div', {},
              el('div', { style: { fontWeight: '900', fontSize: '20px', letterSpacing: '-0.01em', color: '#323230', textTransform: 'uppercase', lineHeight: '1' } }, 'Avg Pest Initial Competitions'),
              el('div', { style: { fontWeight: '800', fontSize: '10px', letterSpacing: '0.08em', color: '#323230', opacity: '0.8', marginTop: '3px', textTransform: 'uppercase' } }, 'Door-to-Door · by RIDDMADE™'),
              indicatorCompWindowStr() !== 'All dates' && el('div', { style: { display: 'inline-block', marginTop: '6px', padding: '3px 10px', borderRadius: '0', background: '#323230', color: '#DF643A', fontWeight: '900', fontSize: '11px', letterSpacing: '0.03em' } }, '📅 ' + indicatorCompWindowStr()),
              indicatorLastUpdatedStr() && el('div', { style: { fontSize: '10px', color: '#323230', opacity: '0.7', marginTop: '3px', fontWeight: '700' } }, indicatorLastUpdatedStr()),
            ),
          ),
          // (ⓘ rules button rides the shared Comp Window bar now — per Isaac)
        ),
      ),
      // Date window now lives in the shared Comp Window bar at the top.
      el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-3 p-3' }, avgInitialCard, raffleCard),
    );
}

// ── Avg Pest / Raffle comp helpers — MODULE scope. The comp card was
// lifted to the top of the section builder ages ago, but these stayed
// defined in the original (later) block — so activating the comp threw
// "RAFFLE_EXCLUDE_RE is not defined". The later local duplicates shadow
// these with identical values; both paths now resolve.
const RAFFLE_EXCLUDE_RE = /sentricon|german\s*roach|interior\s*flea/i;
const AVG_PEST_MIN_ACCOUNTS = 5;
const ticketsForInitial = (amount) => {
  const v = Number(amount) || 0;
  if (v >= 250) return 3;
  if (v >= 200) return 2;
  if (v >= 149) return 1;
  return 0;
};
// Active = not cancelled AND status is Active (Frozen / Inactive / No are
// NOT active). Robust across formats: RevHawk sends "Active"/"Frozen"; an
// old CSV sent "Yes"/"No".
const isActiveAccount = (s) => {
  if (_subCancelledNow(s)) return false;   // save-backs stay ACTIVE (status trumps the date)
  const _a = String(s.active || '').trim().toLowerCase();
  return _a !== 'no' && _a !== 'frozen' && _a !== 'inactive';
};

let _fullWeeklyCache = { src: null, byRep: null, latest: null };
function _fullWeeklyByRepCached(fullRawSales) {
  if (_fullWeeklyCache.src === fullRawSales && _fullWeeklyCache.byRep) return _fullWeeklyCache;
  let latest = null;
  const byRep = {};
  for (const s of fullRawSales) {
    const d = _parseIndicatorDay(s);
    if (!d) continue;
    if (!latest || d > latest) latest = d;
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
    const wk = ws.toISOString().slice(0, 10);   // same key shape as before
    const rep = s.rep || 'Unknown';
    const m = byRep[rep] || (byRep[rep] = {});
    m[wk] = (m[wk] || 0) + Number(s.contractValue || 0);
  }
  _fullWeeklyCache = { src: fullRawSales, byRep, latest };
  return _fullWeeklyCache;
}

function indicatorRepSections(data, isRange, currentWeek, rangeBounds, allWeeksUnfiltered, allDataUnfiltered, windowLabel) {
  // We need the raw sales data — stored alongside aggregated rows.
  // Department-scoped so the rep leaderboard matches the toggle selection.
  // Honors the Filters ▸ Metric setting like the rest of the page — and the
  // page DEFAULT is now Total (all accounts sold), per Isaac. One filter,
  // one basis, everywhere on this tab.
  const allRawSales = indicatorSales();
  // Match the range filter the rest of the page uses. In Range mode we keep
  // only sales whose week falls inside the filtered indicator data; in Weekly
  // mode the leaderboard stays YTD (because the user may want comparison).
  const weeksInScope = isRange
    ? new Set(data.map(r => r.week))
    : null;
  // Excluded-team reps are dropped only when the user is viewing the page in
  // team mode. In branch mode (the default) every rep is included so the
  // numbers match the underlying CSV exactly. The scope picker on the trend
  // panel does its own per-scope filtering (team scope hides excluded reps;
  // branch and company scopes show everyone) regardless of this flag.
  const applyExclusion = state.indicatorsGroupBy === 'teams';
  // Page-level filter (team exclusion + week scope). Cancel Analysis
  // reads this version (rawSalesAll) directly so it can still surface
  // 3-day RORs and Sold-Not-Started rows in its breakdown.
  // Range mode scopes by EXACT sale date (matches the power-ranking table's
  // day-precision), not by containing week.
  const repRangeStart = (isRange && rangeBounds) ? new Date(rangeBounds.start + 'T00:00:00') : null;
  const repRangeEnd   = (isRange && rangeBounds) ? new Date(rangeBounds.end   + 'T23:59:59') : null;
  const inRepScope = (s) => {
    if (!isRange || !rangeBounds) return true;
    const d = _parseIndicatorDay(s);
    return d && d >= repRangeStart && d <= repRangeEnd;
  };
  const rawSalesAll = (allRawSales || []).filter(s =>
    (!applyExclusion || !isRepExcluded(s.rep)) && inRepScope(s));
  // Default for every other consumer (leaderboard, D2D comp, PDF reports,
  // sub-mix, rep drill-downs): EVERYTHING counts — including 3-day RORs and
  // Sold-Not-Starteds — so the board reconciles 1:1 with the CRM's rep
  // revenue cards. TWO families deliberately narrow it: Cancel %, which uses
  // its own clean denominator below and the _isReportableCancel numerator,
  // and RECORDS (best day/week/month/PRA), which gate on Pending/Serviced
  // inside aggregateRecords/topRecords/bestPRADayRecord/topPRADays — see
  // _recordEligible. Records therefore no longer tie 1:1 to leaderboard
  // revenue, on purpose.
  const rawSales = rawSalesAll;
  if (!allRawSales || !allRawSales.length) {
    // Always render a visible placeholder so admins know these tables exist
    // and what's needed to populate them.
    return [
      el('div', { class: 'card p-6 text-center', style: { borderStyle: 'dashed', borderColor: 'var(--border-2)' } },
        el('div', { class: 'text-2xl mb-2' }, '📋'),
        el('h3', { class: 'text-base font-bold mb-1' }, 'Rep-level analytics'),
        el('p', { class: 'text-xs text-muted- max-w-md mx-auto' },
          'Rep Leaderboard, Cancel Analysis, Attrition by Office, and Subscription Mix tables show up here when you upload a raw-sales CSV (one row per sale, with Rep + Subscription columns). The pre-aggregated CSV doesn\'t include rep names, so these stay hidden on that import.'),
      ),
    ];
  }

  _profMark('ind:table+charts');
  const sections = [];

  // ── Compute rep stats ──
  // Sales are bucketed by CANONICAL rep name — so if "Joseph Boineau"
  // has been merged into "Joe Boineau", his CSV sales count under Joe.
  // This means every per-rep metric (revenue, sales count, ranking,
  // sparklines, leaderboard) treats merged reps as one — no double
  // counting even when the CSV still references the old spelling.
  const parseNum = (s) => parseFloat(String(s || '').replace(/[$,%]/g,'').replace(/,/g,'').trim()) || 0;
  const repMap = {};
  rawSales.forEach(s => {
    const rep = getCanonicalRepName(s.rep || 'Unknown');
    if (!repMap[rep]) repMap[rep] = { name: rep, office: s.office, officeRev: {}, recRev: {}, sales: [], cancels: 0, cancelEligible: 0, attrServRev: 0, attrCxlRev: 0, revenue: 0, newRevenue: 0, renewalRevenue: 0, multi: 0, twelve: 0, autoPay: 0, aged: 0 };
    if (s.office) repMap[rep].officeRev[s.office] = (repMap[rep].officeRev[s.office] || 0) + (Number(s.contractValue) || 0);
    // Per-CRM-record split: raw rep spelling + employee id + office. When a
    // person exists as multiple FieldRoutes employee records, each line here
    // matches what a per-record CRM tool shows for that record.
    const _recKey = String(s.rep || '?') + (s.repId ? ' · #' + s.repId : '') + (s.office ? ' · ' + s.office : '');
    repMap[rep].recRev[_recKey] = (repMap[rep].recRev[_recKey] || 0) + (Number(s.contractValue) || 0);
    const r = repMap[rep];
    r.sales.push(s);
    r.revenue += s.contractValue;
    // New vs renewal split (renewal sources are named "Renewal - …"). D2D has
    // none, so newRevenue == revenue there; office staff carry both.
    if (_indicatorIsRenewal(s)) r.renewalRevenue += s.contractValue;
    else                        r.newRevenue += s.contractValue;
    const _myb = myBucketOf(s);
    if (_myb === 'multi') r.multi++; else if (_myb === 'twelve') r.twelve++;
    if (s.autoPay && s.autoPay !== 'No') r.autoPay++;
    if (_repCancelCounts(s)) r.cancels++;
    // Cancel % denominator: sales excluding whatever the ROR toggle
    // currently strips — excluded rows neither count as a cancel nor pad
    // the base. (Volume/revenue metrics above include those rows.)
    if (!_repCancelExcluded(s)) r.cancelEligible++;
    { const _ap = _attrRevParts(s); r.attrServRev += _ap.serv; r.attrCxlRev += _ap.cxl; }
    if (/failed\s*audit/i.test(s.customerFlags || '')) r.auditFail = (r.auditFail || 0) + 1;
    if (s.age > 0) r.aged++;
  });
  // 3-day RORs that indicatorSales() dropped as "never serviced" aren't in
  // rawSales, so "Count 3-Day RORs" would only ever move the handful of serviced
  // ones. When the toggle is ON, fold the dropped RORs (same window + team scope)
  // into each rep's Cancels and Cancel-% base so the toggle reflects ALL RORs.
  if (state._indicatorRepIncludeRor) {
    const _inRaw = new Set(rawSales);
    (state._indicatorRawSales || []).forEach(s => {
      if (_inRaw.has(s) || !s.cancelDate || !_is3DayROR(s)) return;
      if (!inRepScope(s)) return;
      if (applyExclusion && isRepExcluded(s.rep)) return;
      const r = repMap[getCanonicalRepName(s.rep || 'Unknown')];
      if (r) { r.cancels++; r.cancelEligible++; }
    });
  }
  // Decorate every rep with derived metrics so we can sort on any of them.
  // `avg_pest` here mirrors the chart's per-rep formula — Sentricon, German
  // Roach, and Interior Flea are excluded.
  const REP_AVG_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;
  // Sparkline runs off the FULL raw sales (not the range-filtered set) so
  // the 12-week trend column stays useful even when the page range is short
  // (e.g. "This Week" otherwise leaves the sparkline mostly empty). All
  // other rep stats use the range-filtered sales as expected.
  const fullRawSales = state._indicatorRawSales || [];
  // CACHED single pass (keyed on dataset identity): latest sold date +
  // per-rep weekly buckets. The old code ran two uncached full scans with
  // per-row `new Date(string)` + `toISOString()` on every render — the
  // hottest cost in the Indicators page on a phone. _parseIndicatorDay is
  // the memoized parser the rest of the page already uses.
  const _fullWk = _fullWeeklyByRepCached(fullRawSales);
  const _globalLatestDate = _fullWk.latest;
  const _globalLastWeekStart = _globalLatestDate
    ? (() => { const ws = new Date(_globalLatestDate); ws.setDate(ws.getDate() - ws.getDay()); return ws; })()
    : null;
  const _fullWeeklyByRep = _fullWk.byRep;
  const allReps = Object.values(repMap).map(r => {
    const count = r.sales.length;
    // MY % = multi-year contracts (anything other than 12 months) / all contract sales (12 + multi)
    const ctTotal = r.twelve + r.multi;
    const eligibleForPest = r.sales.filter(s => !REP_AVG_PEST_EXCLUDE.test(s.subscription || ''));
    const avgPest = eligibleForPest.length > 0
      ? eligibleForPest.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / eligibleForPest.length
      : 0;
    // Avg Initial across ALL sales (including Sentricon / German Roach /
    // Interior Flea) — useful for the raffle / overall pricing comp where
    // every sale counts.
    const avgInitial = r.sales.length > 0
      ? r.sales.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / r.sales.length
      : 0;
    // Best Day / Week / Month: bucket the rep's sales by sold-DATE,
    // sunday-anchored week, and YYYY-MM. `dateSold` is often
    // "MM/DD/YY HH:MM AM/PM" so two sales on the same calendar day would
    // otherwise live in different buckets and Best Day would just be the
    // biggest single sale, not the biggest day total. Each record stores
    // the dollar amount + a label for display, and a numeric timestamp so
    // the column sorts by RECENCY.
    const byDate = {}, byWeek = {}, byMonth = {};
    // Records follow the OFFICE revenue lens (per Isaac): New (the office
    // default) = everything MINUS the renewal source types; Renewal = only
    // those sources; Total = everything. D2D records are untouched (no
    // renewal motion there — always total).
    const _recMode = state.indicatorDept === 'office' ? (state._indRepRevMode || 'new') : 'total';
    const _recRows = _recMode === 'total' ? r.sales : r.sales.filter(s => {
      const ren = (typeof _indicatorIsRenewal === 'function') && _indicatorIsRenewal(s);
      return _recMode === 'renewal' ? ren : !ren;
    });
    _recRows.forEach(s => {
      const dayKey = (s.dateSold || '').split(' ')[0].trim();
      if (!dayKey) return;
      const d = new Date(dayKey);
      const v = Number(s.contractValue || 0);
      byDate[dayKey] = (byDate[dayKey] || 0) + v;
      if (!Number.isFinite(d.getTime())) return;
      const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
      const wk = ws.toISOString().slice(0, 10);
      byWeek[wk] = (byWeek[wk] || 0) + v;
      const mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      byMonth[mk] = (byMonth[mk] || 0) + v;
    });
    const pickBest = (obj) => {
      let bestKey = '', bestVal = 0;
      for (const [k, v] of Object.entries(obj)) {
        if (v > bestVal) { bestVal = v; bestKey = k; }
      }
      return { key: bestKey, value: bestVal };
    };
    const bD = pickBest(byDate), bW = pickBest(byWeek), bM = pickBest(byMonth);
    const bestDayTime   = bD.key ? new Date(bD.key).getTime() : 0;
    const bestWeekTime  = bW.key ? new Date(bW.key).getTime() : 0;
    const bestMonthTime = bM.key ? new Date(bM.key + '-01').getTime() : 0;
    // 12-week revenue sparkline anchored at the dataset's last week so all
    // reps line up on the same x-axis. Each bar is the full Sun–Sat sum
    // for that week (showing a short bar for an in-progress week is
    // expected — it's reality, and the eye reads it).
    const weeklyTrend12 = [];
    const fullByWeek = _fullWeeklyByRep[r.name] || {};
    if (_globalLastWeekStart) {
      for (let i = 11; i >= 0; i--) {
        const ws = new Date(_globalLastWeekStart); ws.setDate(ws.getDate() - i * 7);
        const key = ws.toISOString().slice(0, 10);
        weeklyTrend12.push(fullByWeek[key] || 0);
      }
    }
    // trendSlope uses APPLES-TO-APPLES windows — WTD vs the same number
    // of days last week — so the sort key + arrow on the column doesn't
    // falsely tag a steady rep as down 40% just because today is
    // Wednesday. See _weekToDateWindows for the rationale.
    let thisWeek = 0, lastWeek = 0;
    if (_globalLatestDate) {
      const wow = _weekToDateWindows(_globalLatestDate);
      for (const s of r.sales) {
        const d = _parseIndicatorDay(s);
        if (!d) continue;
        if (d >= wow.thisStart && d < wow.thisEnd) thisWeek += Number(s.contractValue || 0);
        else if (d >= wow.lastStart && d < wow.lastEnd) lastWeek += Number(s.contractValue || 0);
      }
    }
    const trendSlope = lastWeek > 0
      ? (thisWeek / lastWeek) - 1
      : (thisWeek > 0 ? 1 : 0);
    // Selling-day averages — only days the rep ACTUALLY SOLD count, so days
    // off / skipped days never drag the average (exactly what the reps asked
    // for; no start-date assumptions).
    const _sellDaySet = new Set();
    for (const s of r.sales) {
      const d = _parseIndicatorDay(s);
      if (d) _sellDaySet.add(d.toISOString().slice(0, 10));
    }
    const sellingDays = _sellDaySet.size;
    return {
      sellingDays,
      revPerDay:   sellingDays > 0 ? r.revenue / sellingDays : 0,
      acctsPerDay: sellingDays > 0 ? count / sellingDays : 0,
      ...r,
      count,
      team: getRepTeam(r.name),
      tier: getRepTier(r.name), // 'rookie' | 'vet' | ''
      acv: count > 0 ? r.revenue / count : 0,
      avgPest,
      avgInitial,
      myPct: ctTotal > 0 ? r.multi / ctTotal : 0,
      autoPayPct: count > 0 ? r.autoPay / count : 0,
      cancelPct: r.cancelEligible > 0 ? r.cancels / r.cancelEligible : 0,
      // Attrition % by revenue — same math as the player card headline.
      attrPct: r.attrServRev > 0 ? r.attrCxlRev / r.attrServRev : 0,
      // Audit % = accounts NOT flagged Failed Audit ÷ all accounts (passed,
      // no-audit and pending all count as good — same rule as the branch row).
      auditPct: count > 0 ? (count - (r.auditFail || 0)) / count : 0,
      bestDay:        bD.value,
      bestDayDate:    bD.key,
      bestDayTime:    Number.isFinite(bestDayTime)   ? bestDayTime   : 0,
      bestWeek:       bW.value,
      bestWeekStart:  bW.key,
      bestWeekTime:   Number.isFinite(bestWeekTime)  ? bestWeekTime  : 0,
      bestMonth:      bM.value,
      bestMonthKey:   bM.key,
      bestMonthTime:  Number.isFinite(bestMonthTime) ? bestMonthTime : 0,
      weeklyTrend12,
      trendSlope,
    };
  });

  // ── D2D MINI-COMPS (side-by-side) — hoisted to render directly under the
  // Branch Power Ranking chart at the top of the rep-level section.
  // Left: Top 15 reps by Avg Pest Initial, gated to 5+ accounts (the
  // existing door-to-door comp — top 5 win, rows 6–15 are visibility
  // into who's close). Right: Raffle Tickets ranking with CSV export.
  //
  // These comps run on a SEPARATE date window from the rest of the page —
  // they're typically a 2-week competition period, not aligned to the
  // weekly/range filter the indicators table uses. The user picks the
  // window via a small filter bar above the cards (default: last 2 weeks
  // ending at the most recent sale).
  _profMark('ind:lb-reps');
  const RAFFLE_EXCLUDE_RE = /sentricon|german\s*roach|interior\s*flea/i;
  const AVG_PEST_MIN_ACCOUNTS = 5;
  const ticketsForInitial = (amount) => {
    const v = Number(amount) || 0;
    if (v >= 250) return 3;
    if (v >= 200) return 2;
    if (v >= 149) return 1;
    return 0;
  };
  // Active = not cancelled AND status is Active (Frozen / Inactive / No are NOT
  // active — a frozen account is paused, not generating recurring revenue).
  // Robust across formats: RevHawk sends "Active"/"Frozen"; an old CSV sent
  // "Yes"/"No".
  const isActiveAccount = (s) => {
    if (_subCancelledNow(s)) return false;   // save-backs stay ACTIVE (status trumps the date)
    const _a = String(s.active || '').trim().toLowerCase();
    return _a !== 'no' && _a !== 'frozen' && _a !== 'inactive';
  };

  function _latestSaleDate(sales) {
    let latest = null;
    for (const s of sales) {
      const d = _parseIndicatorDay(s);
      if (d && (!latest || d > latest)) latest = d;
    }
    return latest;
  }
  // Default the comp window to the prior 2 weeks ending at the latest sale.
  // The user always adjusts from there, so we just expose two date inputs
  // with a sensible starting position.
  if (!state._indicatorCompFilter || !state._indicatorCompFilter.start || !state._indicatorCompFilter.end) {
    const latest = _latestSaleDate(allRawSales || []);
    if (latest) {
      const end = new Date(latest);
      const start = new Date(latest); start.setDate(start.getDate() - 13);
      const fmtIso = (d) => d.toISOString().slice(0, 10);
      state._indicatorCompFilter = { start: fmtIso(start), end: fmtIso(end) };
    } else {
      state._indicatorCompFilter = { start: '', end: '' };
    }
  }
  const cf = state._indicatorCompFilter;

  // ── D2D Comp section is built inside a closure so we can swap just THIS
  // chunk of the DOM when the date inputs change, instead of triggering a
  // full mountApp() that re-renders Chart.js canvases (which flicker).
  // One merged card: Avg Pest Initial ranking + raffle ticket columns.
  function buildD2DCompSection() {
    // Extracted to buildAvgPestCompCard so the Competitions tab can render
    // the SAME card (no more Indicators-only gatekeeping).
    return buildAvgPestCompCard({ cf, allRawSales, rawSales, windowLabel, applyExclusion, rerender: replaceD2DCompSection });
  }

  function replaceD2DCompSection() {
    const old = document.querySelector('[data-section="d2d-comp"]');
    if (old) old.replaceWith(buildD2DCompSection());
  }

  // Coach Mode — surfaces reps who need attention so managers can intervene
  // before a slump compounds. Each rule produces a colored chip; severity
  // (med vs high) drives the chip color. Sorted by severity then alphabetical.
  function buildCoachModeCard() {
    const NO_SALE_DAYS_MED      = 5;
    const NO_SALE_DAYS_HIGH     = 14;
    const NO_SALE_DAYS_INACTIVE = 30;
    const TREND_DECLINE_MED     = -0.20;
    const TREND_DECLINE_HIGH    = -0.40;
    const CANCEL_PCT_MED        = 0.15;
    const CANCEL_PCT_HIGH       = 0.25;
    const AVG_DROP_PCT_MED      = -0.15;
    const AVG_DROP_PCT_HIGH     = -0.30;
    const RATIO_DROP_PP_MED     = -0.10;
    const RATIO_DROP_PP_HIGH    = -0.20;
    const MIN_VOLUME_FOR_RATE_RULES = 5;   // ignore reps with too few sales for rate stats
    const MIN_VOLUME_FOR_AVG_WINDOW = 5;   // both 14d windows must clear this
    const RECENT_WINDOW_DAYS    = 14;
    const PEST_EXCLUDE_RE       = /sentricon|german\s*roach|interior\s*flea/i;

    // Teams excluded from Coach Mode flagging — Termite Pros operate on a
    // different cadence than the door-to-door teams (longer cycles, fewer
    // sales) so the standard "no sale in 5 days" / declining-revenue
    // heuristics produce noise rather than signal for them.
    const COACH_EXCLUDED_TEAMS = new Set(['Termite Pros']);

    // Per-rep aggregate over a 14-day window. Mirrors the helper in
    // computeCoachFlags() so the two surfaces emit identical flags.
    const windowStats = (sales, start, end) => {
      const startMs = start.getTime(), endMs = end.getTime();
      let count = 0, revenue = 0, twelve = 0, multi = 0, autoPay = 0;
      let initialSum = 0, pestInitialSum = 0, pestCount = 0;
      for (const s of sales) {
        const d = _parseIndicatorDay(s);
        if (!d) continue;
        const ms = d.getTime();
        if (ms < startMs || ms > endMs) continue;
        count++;
        revenue += Number(s.contractValue || 0);
        const _myb = myBucketOf(s);
        if (_myb === 'twelve') twelve++; else if (_myb === 'multi') multi++;
        if (s.autoPay && s.autoPay !== 'No') autoPay++;
        const initPrice = Number(s.initialPrice || 0);
        initialSum += initPrice;
        if (!PEST_EXCLUDE_RE.test(s.subscription || '')) {
          pestInitialSum += initPrice;
          pestCount++;
        }
      }
      if (count === 0) return null;
      const ctTotal = twelve + multi;
      return {
        count, revenue,
        acv:        revenue / count,
        myPct:      ctTotal > 0 ? multi / ctTotal : 0,
        autoPayPct: autoPay / count,
        avgInitial: initialSum / count,
        avgPest:    pestCount > 0 ? pestInitialSum / pestCount : 0,
      };
    };

    const flagged = [];
    for (const r of allReps) {
      // Skip reps marked Inactive in Manage Teams — same gate the
      // module-scope computeCoachFlags uses, so the page card and the
      // top-bar icon stay in lockstep.
      if (!isRepActive(r.name)) continue;
      if (COACH_EXCLUDED_TEAMS.has(r.team)) continue;
      const issues = [];

      // Compute days-since-last-sale once; drives both the standard
      // silent rule and the "Mark Inactive?" short-circuit below.
      let daysSinceLastSale = null;
      if (_globalLatestDate) {
        let lastSale = null;
        for (const s of r.sales) {
          const d = _parseIndicatorDay(s);
          if (d && (!lastSale || d > lastSale)) lastSale = d;
        }
        if (lastSale) daysSinceLastSale = Math.round((_globalLatestDate - lastSale) / 86400000);
      }

      // Rule 1A: ≥30 days silent → roster-cleanup suggestion, not a
      // coaching flag. Skip all other rules since the averages would
      // be stale anyway.
      if (daysSinceLastSale != null && daysSinceLastSale >= NO_SALE_DAYS_INACTIVE) {
        issues.push({
          kind: 'inactive_candidate',
          label: '💤 Mark Inactive? · ' + daysSinceLastSale + ' days silent',
          severity: 'med',
          sortVal: daysSinceLastSale,
        });
        flagged.push({ rep: r, issues, worstSeverity: 'med' });
        continue;
      }
      // Rule 1B: Standard silence
      if (daysSinceLastSale != null && daysSinceLastSale >= NO_SALE_DAYS_MED) {
        issues.push({
          kind: 'silent',
          label: 'No sale in ' + daysSinceLastSale + ' days',
          severity: daysSinceLastSale >= NO_SALE_DAYS_HIGH ? 'high' : 'med',
          sortVal: daysSinceLastSale,
        });
      }
      // Rule 2: Trend decline (uses precomputed r.trendSlope, which now
      // compares WTD vs same period last week — equal elapsed days).
      if (r.trendSlope <= TREND_DECLINE_MED && r.count >= MIN_VOLUME_FOR_RATE_RULES) {
        issues.push({
          kind: 'declining',
          label: 'Revenue down ' + Math.abs(r.trendSlope * 100).toFixed(0) + '% (WTD vs same period last week)',
          severity: r.trendSlope <= TREND_DECLINE_HIGH ? 'high' : 'med',
          sortVal: -r.trendSlope * 100,
        });
      }
      // Rule 3: High cancel rate
      if (r.cancelPct >= CANCEL_PCT_MED && r.count >= MIN_VOLUME_FOR_RATE_RULES) {
        issues.push({
          kind: 'cancels',
          label: 'Cancel rate ' + (r.cancelPct * 100).toFixed(0) + '%',
          severity: r.cancelPct >= CANCEL_PCT_HIGH ? 'high' : 'med',
          sortVal: r.cancelPct * 100,
        });
      }

      // Rules 4–8: Average-trend declines. Last 14 days vs prior 14
      // days; both windows need ≥5 sales for the comparison to be a
      // real signal rather than one-contract noise.
      if (_globalLatestDate && r.count >= MIN_VOLUME_FOR_RATE_RULES) {
        const recentEnd   = _globalLatestDate;
        const recentStart = new Date(_globalLatestDate);     recentStart.setDate(recentStart.getDate() - RECENT_WINDOW_DAYS + 1);
        const priorEnd    = new Date(recentStart);           priorEnd.setDate(priorEnd.getDate() - 1);
        const priorStart  = new Date(priorEnd);              priorStart.setDate(priorStart.getDate() - RECENT_WINDOW_DAYS + 1);
        const recent = windowStats(r.sales, recentStart, recentEnd);
        const prior  = windowStats(r.sales, priorStart,  priorEnd);
        if (recent && prior && recent.count >= MIN_VOLUME_FOR_AVG_WINDOW && prior.count >= MIN_VOLUME_FOR_AVG_WINDOW) {
          const ratioRule = (kind, label, recentVal, priorVal) => {
            const dpp = recentVal - priorVal;
            if (dpp <= RATIO_DROP_PP_MED) {
              issues.push({
                kind, label: label + ' down ' + Math.abs(dpp * 100).toFixed(0) + 'pp (14d vs prior 14d)',
                severity: dpp <= RATIO_DROP_PP_HIGH ? 'high' : 'med',
                sortVal: -dpp * 100,
              });
            }
          };
          const dollarRule = (kind, label, recentVal, priorVal) => {
            if (priorVal <= 0) return;
            const pct = (recentVal - priorVal) / priorVal;
            if (pct <= AVG_DROP_PCT_MED) {
              issues.push({
                kind, label: label + ' down ' + Math.abs(pct * 100).toFixed(0) + '% (14d vs prior 14d)',
                severity: pct <= AVG_DROP_PCT_HIGH ? 'high' : 'med',
                sortVal: -pct * 100,
              });
            }
          };
          ratioRule('myPct',      'MY %',          recent.myPct,      prior.myPct);
          ratioRule('autoPayPct', 'Auto Pay %',    recent.autoPayPct, prior.autoPayPct);
          dollarRule('acv',       'ACV',           recent.acv,        prior.acv);
          dollarRule('avgInit',   'Avg Init',      recent.avgInitial, prior.avgInitial);
          dollarRule('avgPest',   'Avg Pest Init', recent.avgPest,    prior.avgPest);
        }
      }

      if (issues.length > 0) {
        const worstSeverity = issues.some(i => i.severity === 'high') ? 'high' : 'med';
        flagged.push({ rep: r, issues, worstSeverity });
      }
    }
    // Sort: high-severity first, then by issue count desc, then alphabetical
    flagged.sort((a, b) => {
      if (a.worstSeverity !== b.worstSeverity) return a.worstSeverity === 'high' ? -1 : 1;
      if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
      return a.rep.name.localeCompare(b.rep.name);
    });

    const highCount = flagged.filter(f => f.worstSeverity === 'high').length;
    const medCount  = flagged.length - highCount;

    if (!state._coachModeOpen) state._coachModeOpen = false;
    const isOpen = state._coachModeOpen;

    const headerCounts = el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('h3', { class: 'text-base font-bold' }, '🚨 Coach Mode'),
      el('span', { class: 'text-[11px] text-muted-' },
        flagged.length === 0
          ? 'No reps flagged — everyone’s on track'
          : flagged.length + ' rep' + (flagged.length === 1 ? '' : 's') + ' need attention',
      ),
      highCount > 0 && el('span', {
        class: 'text-[10px] font-bold px-1.5 py-0.5 rounded',
        style: { background: 'rgba(220,38,38,.12)', color: '#B91C1C' },
      }, highCount + ' high'),
      medCount > 0 && el('span', {
        class: 'text-[10px] font-bold px-1.5 py-0.5 rounded',
        style: { background: 'rgba(223,100,58,.15)', color: '#A9441F' },
      }, medCount + ' med'),
    );

    const toggleBtn = flagged.length > 0
      ? el('button', {
          class: 'text-xs font-semibold transition hover:brightness-95',
          style: { color: 'var(--text-muted)' },
          onclick: () => { state._coachModeOpen = !state._coachModeOpen; mountApp(); },
        }, isOpen ? 'Hide ▴' : 'Show ▾')
      : null;

    function chipFor(issue) {
      const isHigh = issue.severity === 'high';
      return el('span', {
        class: 'text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 whitespace-nowrap',
        style: isHigh
          ? { background: 'rgba(220,38,38,.12)', color: '#B91C1C' }
          : { background: 'rgba(223,100,58,.15)', color: '#A9441F' },
      }, issue.label);
    }

    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        headerCounts,
        toggleBtn,
      ),
      flagged.length === 0
        ? el('div', { class: 'p-4 text-center text-xs text-muted- italic' }, 'Nothing to flag in this window. 🎉')
        : (isOpen
            ? el('div', { class: 'scroll-x', style: { maxHeight: '360px', overflowY: 'auto' } },
                el('table', { class: 'w-full text-xs' },
                  el('thead', {
                    class: 'text-[9px] uppercase tracking-wider text-muted-',
                    style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: 1 },
                  },
                    el('tr', {},
                      el('th', { class: 'text-left pl-5 pr-2 py-2' }, 'Rep'),
                      el('th', { class: 'text-left px-2 py-2' }, 'Team'),
                      el('th', { class: 'text-left px-2 py-2' }, 'Issues'),
                      el('th', { class: 'text-right pl-2 pr-5 py-2' }, ''),
                    ),
                  ),
                  el('tbody', {},
                    ...flagged.map(({ rep, issues, worstSeverity }) => el('tr', {
                      class: 'border-t border- cursor-pointer hover:brightness-95 transition',
                      style: worstSeverity === 'high' ? { background: 'rgba(220,38,38,.04)' } : {},
                      onclick: () => openIndicatorRepCard(rep, allReps),
                    },
                      el('td', { class: 'pl-5 pr-2 py-2 font-semibold whitespace-nowrap' }, rep.name),
                      el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap' }, rep.team || '—'),
                      el('td', { class: 'px-2 py-2' },
                        el('div', { class: 'flex flex-wrap gap-1.5' },
                          ...issues.map(chipFor),
                        ),
                      ),
                      el('td', { class: 'pl-2 pr-5 py-2 text-right text-[10px] text-muted-' }, 'Open card →'),
                    )),
                  ),
                ),
              )
            : el('div', { class: 'px-5 py-2 flex flex-wrap gap-1.5 text-xs' },
                ...flagged.slice(0, 8).map(({ rep, worstSeverity }) => el('span', {
                  class: 'rounded-full px-2 py-0.5 font-semibold cursor-pointer hover:brightness-95 transition',
                  style: worstSeverity === 'high'
                    ? { background: 'rgba(220,38,38,.12)', color: '#B91C1C' }
                    : { background: 'rgba(223,100,58,.15)', color: '#A9441F' },
                  onclick: () => openIndicatorRepCard(rep, allReps),
                }, rep.name)),
                flagged.length > 8 && el('span', { class: 'text-muted- italic px-1' }, '+' + (flagged.length - 8) + ' more'),
              )),
    );
  }

  // Aggregate records — 3x3 grid (Company / Top Branch / Top Team × Day /
  // Week / Month). The Top Branch/Team row picks whichever branch or team
  // owns the highest-revenue period in each category, with attribution.
  // Click Top Branch or Top Team to expand a full ranked list of every
  // branch/team's own best day/week/month.
  function buildAggregateRecordsCard() {
    if (!state._aggRecordsExpanded) state._aggRecordsExpanded = null;   // 'company' | 'branch' | 'team' | null
    if (!state._aggRecordsMetric)   state._aggRecordsMetric   = 'revenue'; // 'revenue' | 'count'
    // Per-scope sub-drill: which individual branch/team is opened inside
    // the parent drill. Keyed by scope so a user can have a branch open
    // and a team open simultaneously without one collapsing the other.
    if (!state._aggRecordsGroupExpanded) state._aggRecordsGroupExpanded = { branch: null, team: null, rep: null };
    if (state._aggRecordsGroupExpanded.rep === undefined) state._aggRecordsGroupExpanded.rep = null;
    const expanded = state._aggRecordsExpanded;
    const byMetric = state._aggRecordsMetric;
    const groupExpanded = state._aggRecordsGroupExpanded;

    // Min-rep thresholds keep "Best PRA Day" honest: a day where a single
    // rep happened to sell alone has a degenerate PRA (= the full sale).
    // Higher floors at company scope reflect that we expect dozens of reps
    // active on a normal workday.
    const PRA_MIN_COMPANY = 10;
    const PRA_MIN_BRANCH  = 5;
    const PRA_MIN_TEAM    = 3;

    // Memoized (P1-1): the company / branch / team / rep aggregation is
    // ~1.7 s on a full admin dataset and nothing on this card changes it
    // except the sales set, the metric and the team/alias config. Keyed on
    // the indicatorSales() array identity (it's cached per dept+filters),
    // the leaderboard scope, the metric and _indCfgRev.
    const _recKeyMemo = [allRawSales.length, applyExclusion ? 1 : 0, isRange ? (rangeBounds ? rangeBounds.start + '..' + rangeBounds.end : 'r') : 'w', byMetric, (typeof _indCfgRev !== 'undefined') ? _indCfgRev : 0, state.indicatorDept || 'all'].join('|');
    const _recMemo = (window._indRecordsMemo && window._indRecordsMemo.src === allRawSales && window._indRecordsMemo.key === _recKeyMemo) ? window._indRecordsMemo.val : null;
    const _recCompute = () => {
    const company = aggregateRecords(rawSales, byMetric);
    const companyPRA = bestPRADayRecord(rawSales, PRA_MIN_COMPANY, byMetric);

    const groupBests = (groupKeyFn, praMin) => {
      const groups = {};
      for (const s of rawSales) {
        const k = groupKeyFn(s);
        if (!k) continue;
        if (!groups[k]) groups[k] = [];
        groups[k].push(s);
      }
      return Object.entries(groups).map(([name, sales]) => {
        const agg = aggregateRecords(sales, byMetric);
        const pra = bestPRADayRecord(sales, praMin, byMetric);
        return { name, ...agg, bestPRA: pra };
      });
    };
    const branchAll = groupBests(s => s.office,           PRA_MIN_BRANCH);
    const teamAll   = groupBests(s => getRepTeam(s.rep),  PRA_MIN_TEAM);
    // Rep scope (per Isaac): each rep's own best day/week/month. PRA floor
    // is 1 by definition — a rep's PRA day IS their best solo day.
    const repAll    = groupBests(s => getCanonicalRepName(s.rep), 1);

    // Per-group sales maps so the sub-drill (each individual branch/team
    // inside the parent drill) can compute its own top 10 days/weeks/
    // months/PRA days without re-iterating the full rawSales each time.
    const salesByBranch = {};
    const salesByTeam   = {};
    const salesByRep    = {};
    for (const s of rawSales) {
      if (s.office) {
        if (!salesByBranch[s.office]) salesByBranch[s.office] = [];
        salesByBranch[s.office].push(s);
      }
      const t = getRepTeam(s.rep);
      if (t) {
        if (!salesByTeam[t]) salesByTeam[t] = [];
        salesByTeam[t].push(s);
      }
      const rn = getCanonicalRepName(s.rep);
      if (rn) {
        if (!salesByRep[rn]) salesByRep[rn] = [];
        salesByRep[rn].push(s);
      }
    }
    return { company, companyPRA, branchAll, teamAll, repAll, salesByBranch, salesByTeam, salesByRep };
    };
    const _rec = _recMemo || _recCompute();
    if (!_recMemo) window._indRecordsMemo = { src: allRawSales, key: _recKeyMemo, val: _rec };
    const { company, companyPRA, branchAll, teamAll, repAll, salesByBranch, salesByTeam, salesByRep } = _rec;

    // Top winner per category, used for the summary rows. Comparator
    // honors the active metric so toggling Revenue ↔ Sales picks new winners.
    const topOf = (groups) => {
      let bestDay = null, bestWeek = null, bestMonth = null, bestPRA = null;
      for (const g of groups) {
        if (g.bestDay   && (!bestDay   || g.bestDay[byMetric]   > bestDay[byMetric]))   bestDay   = { group: g.name, ...g.bestDay };
        if (g.bestWeek  && (!bestWeek  || g.bestWeek[byMetric]  > bestWeek[byMetric]))  bestWeek  = { group: g.name, ...g.bestWeek };
        if (g.bestMonth && (!bestMonth || g.bestMonth[byMetric] > bestMonth[byMetric])) bestMonth = { group: g.name, ...g.bestMonth };
        if (g.bestPRA   && (!bestPRA   || g.bestPRA.pra         > bestPRA.pra))         bestPRA   = { group: g.name, ...g.bestPRA };
      }
      return { bestDay, bestWeek, bestMonth, bestPRA };
    };
    const branch = topOf(branchAll);
    const team   = topOf(teamAll);
    const rep    = topOf(repAll);

    const fmtMonth = (m) => {
      if (!m) return '';
      const [y, mo] = m.split('-');
      return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    };
    const titleCase = (s) => (s || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const labelFor = (rec, kind) => kind === 'day' ? rec.date
      : kind === 'week' ? 'Week of ' + rec.weekStart
      : kind === 'month' ? fmtMonth(rec.month) : '';

    function recCell(rec, opts = {}) {
      if (!rec || rec.revenue === 0) {
        return el('td', { class: 'p-3 text-muted- italic text-xs' }, '—');
      }
      const groupLine = rec.group
        ? el('div', { class: 'text-[10px] font-semibold mt-0.5', style: { color: 'var(--accent)' } }, opts.groupKind === 'branch' ? titleCase(rec.group) : rec.group)
        : null;
      // The toggle decides which value gets the headline treatment;
      // the other shows as the secondary line alongside the date. Rep
      // count (unique reps who contributed) appears whenever the
      // upstream helper attached it — gives a quick read on whether the
      // record was a team effort or one rep carrying the day.
      const primary   = byMetric === 'count' ? fmt.int(rec.count)    : fmt.usd0(rec.revenue);
      const metricBit = byMetric === 'count' ? fmt.usd0(rec.revenue) : (rec.count + ' sale' + (rec.count === 1 ? '' : 's'));
      const repsBit   = rec.reps ? ' · ' + rec.reps + ' rep' + (rec.reps === 1 ? '' : 's') : '';
      return el('td', { class: 'p-3 align-top' },
        el('div', { class: 'text-base font-bold tabular-nums' }, primary),
        el('div', { class: 'text-[10px] text-muted- mt-0.5 tabular-nums' }, metricBit + repsBit + ' · ' + labelFor(rec, opts.kind)),
        groupLine,
      );
    }

    // PRA value formatter — currency in revenue mode, decimal sales/rep in
    // count mode. The secondary line surfaces the OTHER metric so swapping
    // modes never hides the underlying total.
    const fmtPRA = (v) => byMetric === 'count' ? Number(v).toFixed(1) : fmt.usd0(v);
    const praSecondary = (rec) => byMetric === 'count'
      ? (rec.reps + ' rep' + (rec.reps === 1 ? '' : 's') + ' · ' + rec.count + ' sale' + (rec.count === 1 ? '' : 's') + ' · ' + rec.date)
      : (rec.reps + ' rep' + (rec.reps === 1 ? '' : 's') + ' · ' + fmt.usd0(rec.revenue) + ' · ' + rec.date);

    function praCell(rec, opts = {}) {
      if (!rec || !rec.pra || rec.reps === 0) {
        return el('td', { class: 'p-3 text-muted- italic text-xs' }, '—');
      }
      const groupLine = rec.group
        ? el('div', { class: 'text-[10px] font-semibold mt-0.5', style: { color: 'var(--accent)' } }, opts.groupKind === 'branch' ? titleCase(rec.group) : rec.group)
        : null;
      return el('td', { class: 'p-3 align-top' },
        el('div', { class: 'text-base font-bold tabular-nums' }, fmtPRA(rec.pra)),
        el('div', { class: 'text-[10px] text-muted- mt-0.5 tabular-nums' }, praSecondary(rec)),
        groupLine,
      );
    }

    function summaryRow(label, rollup, expandKey, groupKind) {
      const isOpen = expanded === expandKey;
      const clickable = !!expandKey;
      return el('tr', {
        class: 'border-t border-' + (clickable ? ' cursor-pointer hover:brightness-95 transition' : ''),
        style: isOpen ? { background: 'rgba(223,100,58,.08)' } : {},
        onclick: clickable ? () => { state._aggRecordsExpanded = isOpen ? null : expandKey; mountApp(); } : undefined,
      },
        // Scope column stays frozen while the record columns scroll (per Isaac).
        el('td', { class: 'pl-5 pr-3 py-3 align-top', style: { position: 'sticky', left: '0', zIndex: '1', background: isOpen ? 'var(--card-2)' : 'var(--card)', boxShadow: '1px 0 0 var(--border)' } },
          // No caret (per Isaac) — the row is still clickable; the header
          // copy already says so.
          el('div', { class: 'flex items-center gap-1.5' },
            el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold' + (isOpen ? '' : ' text-muted-'), style: isOpen ? { color: 'var(--accent)' } : {} }, label),
          ),
        ),
        recCell(rollup.bestDay,   { kind: 'day',   groupKind }),
        recCell(rollup.bestWeek,  { kind: 'week',  groupKind }),
        recCell(rollup.bestMonth, { kind: 'month', groupKind }),
        praCell(rollup.bestPRA, { groupKind }),
      );
    }

    // Drill-down expansion. Renders 4 mini-tables — one per category
    // (Best Day / Week / Month / PRA Day) — each capped at the top 10.
    //   Company scope: top 10 raw aggregates from the full sales slice.
    //                  Each row = a single day/week/month/PRA day.
    //   Branch/Team:   top 10 branches/teams by best in that category.
    //                  Each row = a group + the date their record fell on.
    // PRA columns use the same per-scope minReps gates the summary uses.
    function expansionRow(scope) {
      const isGroup = scope === 'branch' || scope === 'team' || scope === 'rep';
      const groups = scope === 'branch' ? branchAll
                   : scope === 'team'   ? teamAll
                   : scope === 'rep'    ? repAll
                   :                       null;
      const praMin = scope === 'company' ? PRA_MIN_COMPANY
                   : scope === 'branch'  ? PRA_MIN_BRANCH
                   : scope === 'rep'     ? 1
                   :                       PRA_MIN_TEAM;

      // Per-category sorted top-10 lists for the chosen scope.
      let topDays, topWeeks, topMonths, topPRA;
      if (isGroup) {
        // PURE company-wide top 10 (per Isaac, Jul 2026): every group's
        // period aggregates compete in ONE global list, so the same rep /
        // branch / team can hold several of the ten slots. Each group
        // contributes its own top 10 per category — the global list can
        // never need more than that.
        const salesMap = scope === 'branch' ? salesByBranch : scope === 'rep' ? salesByRep : salesByTeam;
        const dayL = [], weekL = [], monthL = [], praL = [];
        for (const g of groups) {
          const subSales = salesMap[g.name] || [];
          if (!subSales.length) continue;
          const t = topRecords(subSales, 10, byMetric);
          t.topDays.forEach(r => dayL.push({ ...r, group: g.name }));
          t.topWeeks.forEach(r => weekL.push({ ...r, group: g.name }));
          t.topMonths.forEach(r => monthL.push({ ...r, group: g.name }));
          (topPRADays(subSales, 10, praMin, byMetric) || []).forEach(r => praL.push({ ...r, group: g.name }));
        }
        const top10 = (arr, key) => arr
          .filter(r => (r[key] || 0) > 0)
          .sort((x, y) => (y[key] || 0) - (x[key] || 0))
          .slice(0, 10);
        topDays   = top10(dayL, byMetric);
        topWeeks  = top10(weekL, byMetric);
        topMonths = top10(monthL, byMetric);
        topPRA    = top10(praL, 'pra');
      } else {
        const tops = topRecords(rawSales, 10, byMetric);
        topDays   = tops.topDays;
        topWeeks  = tops.topWeeks;
        topMonths = tops.topMonths;
        topPRA    = topPRADays(rawSales, 10, praMin, byMetric);
      }

      // Category-aware label for the date/period cell.
      const labelOf = (rec, cat) => cat === 'day' ? rec.date
        : cat === 'week'  ? 'Wk ' + rec.weekStart
        : cat === 'month' ? fmtMonth(rec.month)
        : /* pra */         rec.date;
      // Value column. For pra we show the per-rep average; everything
      // else mirrors the active metric toggle.
      const valueOf = (rec, cat) => cat === 'pra'
        ? fmtPRA(rec.pra)
        : (byMetric === 'count' ? fmt.int(rec[byMetric] || 0) : fmt.usd0(rec[byMetric] || 0));
      // Secondary line under the value — sales count or revenue plus,
      // whenever it was tracked, how many unique reps contributed to
      // the record. PRA rows lead with rep count since that's the
      // denominator of the metric.
      const subOf = (rec, cat) => {
        if (cat === 'pra') return rec.reps + ' rep' + (rec.reps === 1 ? '' : 's');
        const metricBit = byMetric === 'count'
          ? fmt.usd0(rec.revenue || 0)
          : (rec.count + ' sale' + (rec.count === 1 ? '' : 's'));
        const repsBit = rec.reps ? ' · ' + rec.reps + ' rep' + (rec.reps === 1 ? '' : 's') : '';
        return metricBit + repsBit;
      };

      // renderRow / miniTable both take an explicit `isGroupTable` so the
      // same helper renders the rollup tables (one row per group, with a
      // Branch/Team column) AND the per-group sub-drill tables (raw
      // aggregates, no group column).
      const renderRow = (entry, cat, i, isGroupRow) => {
        const rec = entry; // group rows are raw records tagged with .group
        const groupName = entry.group;

        const rankCell = el('td', {
          class: 'pl-3 pr-2 py-1.5 font-bold tabular-nums w-8',
          style: i === 0 ? { color: 'var(--accent)' } : { color: 'var(--text-muted)' },
        }, '#' + (i + 1));
        const valueCell = el('td', { class: 'pl-2 pr-3 py-1.5 text-right' },
          el('div', { class: 'tabular-nums font-semibold' }, valueOf(rec, cat)),
          el('div', { class: 'text-[9px] text-muted- tabular-nums' }, subOf(rec, cat)),
        );
        if (isGroupRow) {
          return el('tr', { class: 'border-t border-' },
            rankCell,
            el('td', { class: 'px-2 py-1.5 font-semibold' }, scope === 'branch' ? titleCase(groupName) : groupName),
            el('td', { class: 'px-2 py-1.5 text-[10px] text-muted- tabular-nums whitespace-nowrap' }, labelOf(rec, cat)),
            valueCell,
          );
        }
        return el('tr', { class: 'border-t border-' },
          rankCell,
          el('td', { class: 'px-2 py-1.5 text-[10px] text-muted- tabular-nums whitespace-nowrap' }, labelOf(rec, cat)),
          valueCell,
        );
      };

      const valueColLabel = byMetric === 'count' ? 'Sales' : 'Revenue';
      const miniTable = (title, cat, entries, isGroupTable) => {
        const headerCells = isGroupTable
          ? [
              el('th', { class: 'text-left pl-3 pr-2 py-1.5 w-8' }, '#'),
              el('th', { class: 'text-left px-2 py-1.5' }, scope === 'branch' ? 'Office' : scope === 'rep' ? 'Rep' : 'Team'),
              el('th', { class: 'text-left px-2 py-1.5' }, 'When'),
              el('th', { class: 'text-right pl-2 pr-3 py-1.5' }, cat === 'pra' ? 'PRA' : valueColLabel),
            ]
          : [
              el('th', { class: 'text-left pl-3 pr-2 py-1.5 w-8' }, '#'),
              el('th', { class: 'text-left px-2 py-1.5' }, 'When'),
              el('th', { class: 'text-right pl-2 pr-3 py-1.5' }, cat === 'pra' ? 'PRA' : valueColLabel),
            ];
        return el('div', { class: 'rounded border overflow-hidden', style: { borderColor: 'var(--border)', background: 'var(--card)' } },
          el('div', {
            class: 'px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold border-b',
            style: { color: 'var(--accent)', borderColor: 'var(--border)', background: 'var(--card-2)' },
          }, title),
          entries.length === 0
            ? el('div', { class: 'p-3 text-center text-[11px] text-muted- italic' }, 'No entries')
            : el('table', { class: 'w-full text-[11px]' },
                el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
                  el('tr', {}, ...headerCells)),
                el('tbody', {}, ...entries.map((e, i) => renderRow(e, cat, i, isGroupTable))),
              ),
        );
      };

      const scopeLabel = scope === 'company' ? 'Company-wide records'
                       : scope === 'branch'  ? 'Top offices per category'
                       :                       'Top teams per category';
      const dayLabel    = 'Top 10 Days';
      const weekLabel   = 'Top 10 Weeks';
      const monthLabel  = 'Top 10 Months';
      const praLabel    = 'Top 10 PRA Days';

      // Per-group sub-drill. Inside Branch/Team scope, list every group
      // sorted by best-day metric (so the biggest movers anchor the top
      // of the list). Each row is an accordion — clicking expands to
      // show THAT group's top 10 days/weeks/months/PRA days as 4 mini-
      // tables, mirroring the Company drill but scoped to one branch
      // or team. Sub-expansion state is per-scope so a user can have
      // one branch and one team open at the same time.
      const subDrillSection = !isGroup ? null : el('div', { class: 'mt-4' },
        el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' },
          'By ' + (scope === 'branch' ? 'branch' : scope === 'rep' ? 'rep' : 'team')
            + ' · click any ' + (scope === 'branch' ? 'branch' : scope === 'rep' ? 'rep' : 'team')
            + ' to see their own top 10 per category'),
        el('div', { class: 'flex flex-col gap-1.5' },
          ...(() => {
            // Top 10 by default with a "Show more" (per Isaac) — the full
            // rep list ran to a page of accordions. An open row past the cut
            // keeps the list expanded so it never hides behind the fold.
            const _sorted = groups.slice().sort((a, b) => (b.bestDay?.[byMetric] || 0) - (a.bestDay?.[byMetric] || 0));
            const _LIM = 10;
            if (!state._recSubShowAll) state._recSubShowAll = {};
            const _openIdx = _sorted.findIndex(g => groupExpanded[scope] === g.name);
            const _all = !!state._recSubShowAll[scope] || _openIdx >= _LIM;
            const _vis = _all ? _sorted : _sorted.slice(0, _LIM);
            const _more = _sorted.length - _LIM;
            const _rows = _vis.map(g => {
              const isOpen = groupExpanded[scope] === g.name;
              const subSales = (scope === 'branch' ? salesByBranch : scope === 'rep' ? salesByRep : salesByTeam)[g.name] || [];
              const subTops = isOpen ? topRecords(subSales, 10, byMetric) : null;
              const subPRA  = isOpen ? topPRADays(subSales, 10, praMin, byMetric) : null;
              const bestDayValue = g.bestDay
                ? (byMetric === 'count' ? fmt.int(g.bestDay.count) : fmt.usd0(g.bestDay.revenue))
                : '—';
              return el('div', {
                class: 'rounded border overflow-hidden',
                style: {
                  borderColor: isOpen ? 'var(--accent)' : 'var(--border)',
                  background: 'var(--card)',
                },
              },
                el('div', {
                  class: 'flex items-center justify-between gap-3 px-3 py-2 cursor-pointer hover:brightness-95 transition',
                  style: isOpen ? { background: 'rgba(223,100,58,.08)' } : {},
                  onclick: () => {
                    groupExpanded[scope] = isOpen ? null : g.name;
                    mountApp();
                  },
                },
                  el('div', { class: 'flex items-center gap-2 min-w-0' },
                    el('span', {
                      class: 'inline-block text-muted-',
                      style: {
                        width: '10px',
                        transition: 'transform .15s ease',
                        transform: isOpen ? 'rotate(90deg)' : 'none',
                        transformOrigin: 'center',
                      },
                    }, '▸'),
                    el('span', { class: 'font-bold' }, scope === 'branch' ? titleCase(g.name) : g.name),
                    el('span', { class: 'text-[10px] text-muted-' },
                      subSales.length + ' sale' + (subSales.length === 1 ? '' : 's')),
                  ),
                  el('div', { class: 'text-[10px] text-muted- tabular-nums flex items-center gap-2 whitespace-nowrap' },
                    el('span', {}, 'Best Day'),
                    el('span', { class: 'font-semibold' }, bestDayValue),
                  ),
                ),
                isOpen && el('div', {
                  class: 'border-t p-3',
                  style: { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.04)' },
                },
                  el('div', { class: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3' },
                    miniTable('Top 10 Days',     'day',   subTops.topDays,   false),
                    miniTable('Top 10 Weeks',    'week',  subTops.topWeeks,  false),
                    miniTable('Top 10 Months',   'month', subTops.topMonths, false),
                    miniTable('Top 10 PRA Days', 'pra',   subPRA,            false),
                  ),
                ),
              );
            });
            if (_more > 0) _rows.push(el('button', {
              class: 'rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition hover:brightness-95 self-center mt-1',
              style: { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
              onclick: () => { state._recSubShowAll[scope] = !_all; mountApp(); },
            }, _all ? 'Show top ' + _LIM : 'Show ' + _more + ' more'));
            return _rows;
          })(),
        ),
      );

      return el('tr', { class: 'border-t border-', style: { background: 'rgba(223,100,58,.04)' } },
        el('td', { class: 'p-0', colspan: 5 },
          el('div', { class: 'p-3' },
            el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' },
              scopeLabel + ' · ' + (byMetric === 'count' ? 'sales' : 'revenue') + ' mode'
                + ' · PRA gated to May 1 onward (≥' + praMin + ' rep' + (praMin === 1 ? '' : 's') + ')',
            ),
            el('div', { class: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3' },
              miniTable(dayLabel,   'day',   topDays,   isGroup),
              miniTable(weekLabel,  'week',  topWeeks,  isGroup),
              miniTable(monthLabel, 'month', topMonths, isGroup),
              miniTable(praLabel,   'pra',   topPRA,    isGroup),
            ),
            subDrillSection,
          ),
        ),
      );
    }

    // Company row uses the standalone aggregate + standalone PRA (no group attribution)
    const companyRollup = { ...company, bestPRA: companyPRA };

    const tbodyRows = [
      summaryRow('Company',    companyRollup, 'company', null),
      ...(expanded === 'company' ? [expansionRow('company')] : []),
      summaryRow('Top Office', branch,        'branch',  'branch'),
      ...(expanded === 'branch'  ? [expansionRow('branch')]  : []),
      summaryRow('Top Team',   team,          'team',    'team'),
      ...(expanded === 'team'    ? [expansionRow('team')]    : []),
      summaryRow('Top Rep',    rep,           'rep',     'rep'),
      ...(expanded === 'rep'     ? [expansionRow('rep')]     : []),
    ];

    const metricToggle = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...[
        { id: 'revenue', label: 'Revenue' },
        { id: 'count',   label: 'Sales' },
      ].map(m => el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition',
        style: byMetric === m.id
          ? { background: 'var(--accent)', color: 'var(--accent-text)' }
          : { background: 'transparent', color: 'var(--text)' },
        onclick: () => { state._aggRecordsMetric = m.id; mountApp(); },
      }, m.label)),
    );

    return el('div', { class: 'card overflow-hidden', 'data-section': 'agg-records' },
      el('div', { class: 'px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center gap-3 flex-wrap' },
          el('h3', { class: 'text-base font-bold' }, 'Records'),
          el('span', { class: 'text-[11px] text-muted-' }, 'Click any row to see the top 10 per category'),
        ),
        el('div', { class: 'flex items-center gap-3 flex-wrap' },
          windowLabel && el('span', { class: 'text-[10px] tabular-nums px-2 py-0.5 rounded font-semibold', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } }, windowLabel),
          metricToggle,
        ),
      ),
      el('div', { class: 'scroll-x' },
        el('table', { class: 'w-full text-xs records-table' },
          el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
            el('tr', {},
              el('th', { class: 'text-left pl-5 pr-3 py-2 w-32', style: { position: 'sticky', left: '0', zIndex: '2', background: 'var(--card)', boxShadow: '1px 0 0 var(--border)' } }, 'Scope'),
              el('th', { class: 'text-left p-2' }, 'Best Day'),
              el('th', { class: 'text-left p-2' }, 'Best Week'),
              el('th', { class: 'text-left p-2' }, 'Best Month'),
              el('th', { class: 'text-left p-2', title: byMetric === 'count'
                ? 'Highest sales ÷ active reps on a single day at this scope'
                : 'Highest revenue ÷ active reps on a single day at this scope' }, 'Best PRA Day'),
            ),
          ),
          el('tbody', {}, ...tbodyRows),
        ),
      ),
    );
  }

  // ── COACH MODE moved to a top-bar icon (🚨) — see openCoachModeModal().
  // D2D Comp section + Aggregate Records card are pushed AFTER the rep
  // leaderboard so the trend chart and leaderboard sit immediately beneath
  // the Branch Power Ranking chart at the top of the page.

  // ── 1. PERFORMANCE TREND CHART (above the leaderboard) ──
  if (!state._indicatorRepChart) state._indicatorRepChart = { mode: 'rep', metric: 'revenue', selected: [] };
  // Normalize legacy values (top_revenue / top_count → 'rep'; selected → custom)
  if (!state._indicatorRepChart.metric) state._indicatorRepChart.metric = 'revenue';
  if (state._indicatorRepChart.metric === 'pra') state._indicatorRepChart.metric = 'revenue';
  if (state._indicatorRepChart.mode === 'top_revenue') state._indicatorRepChart.mode = 'rep';
  if (state._indicatorRepChart.mode === 'top_count')   state._indicatorRepChart.mode = 'rep';
  if (state._indicatorRepChart.mode === 'top')         state._indicatorRepChart.mode = 'rep';
  if (state._indicatorRepChart.mode === 'selected')    state._indicatorRepChart.mode = 'custom';
  if (!state._indicatorRepChart.mode)   state._indicatorRepChart.mode   = 'rep';
  if (!Array.isArray(state._indicatorRepChart.selected)) state._indicatorRepChart.selected = [];
  _profMark('ind:lb-helpers');
  const repChartCfg = state._indicatorRepChart;

  // Pick the reps that will be plotted in 'rep' or 'custom' modes. Team and
  // branch modes derive their groups from rawSales inside the chart card.
  let repsToChart = [];
  if (repChartCfg.mode === 'rep') {
    // Selection rules per metric:
    //   - revenue / count: top 10 by that metric
    //   - avg_pest: top 10 by avgPest, but only reps with > 5 accounts so a
    //     single high-priced sale can't dominate
    //   - my_pct / acv: top 10 by REVENUE — these are percentage/average
    //     metrics where the absolute leaders aren't useful (a rep with one
    //     multi-year sale = 100% MY). Showing top revenue reps' MY%/ACV
    //     trend gives a meaningful comparison between actual top performers.
    const sortKeyForMetric = (metric) => {
      if (metric === 'my_pct' || metric === 'acv') return 'revenue';
      return ({ revenue: 'revenue', count: 'count', avg_pest: 'avgPest' })[metric] || 'revenue';
    };
    const effectiveSortKey = sortKeyForMetric(repChartCfg.metric);
    let pool = allReps.slice();
    if (repChartCfg.metric === 'avg_pest') pool = pool.filter(r => r.count > 5);
    repsToChart = pool.sort((a, b) => (b[effectiveSortKey] || 0) - (a[effectiveSortKey] || 0)).slice(0, 10).map(r => r.name);
  } else if (repChartCfg.mode === 'custom') {
    repsToChart = repChartCfg.selected.filter(n => repMap[n]); // drop names that are no longer present
  }

  // X-axis buckets — picks daily/weekly/monthly resolution based on the
  // selected range. Range mode flows through getChartBuckets. Weekly mode
  // shows the FULL season as weekly buckets (mirrors the Branch Power Ranking
  // chart) — the table's week selector picks the focus week, but the trend
  // chart's job is to show movement over time, so collapsing to a single
  // bucket made it useless.
  const weeksFromSales = [...new Set(rawSales.map(s => s.week))].sort((a, b) => a - b);
  let chartBuckets;
  if (isRange && rangeBounds) {
    chartBuckets = getChartBuckets(rangeBounds, weeksFromSales, allDataUnfiltered || data);
  } else {
    const indicatorRows = allDataUnfiltered || data || [];
    chartBuckets = weeksFromSales.map(w => {
      const row = indicatorRows.find(r => r.week === w);
      return {
        kind: 'week',
        key: 'wk-' + w,
        label: indicatorWeekLabel(w, { short: true, rows: indicatorRows }) + (row?.date ? '\n' + row.date : ''),
        week: w,
        match: (s) => s.week === w,
        cumThrough: (s) => s.week <= w,
      };
    });
  }

  // ── Rookie vs Vet cohort breakdown ──
  // Aggregates the same window of raw sales the rest of this section uses,
  // bucketing reps by their indicator tier (rookie / vet). Reps without a
  // tier are not counted on either side — admins tag them in Manage Teams.
  // Rendered UNDERNEATH the 🏅 Records card (stashed here, pushed later) so
  // the Performance Trend chart sits right under the page-level cards.
  _profMark('ind:lb-chart-prep');
  let _tierCardSection = null;
  (() => {
    const tierBuckets = { rookie: [], vet: [] };
    let untagged = 0;
    const untaggedReps = [];   // for the badge drill-down (per Isaac)
    // DOOR-TO-DOOR ONLY — rookie/vet is a knocking cohort. Office staff and
    // technician production never counts here, no matter what the page's
    // Type filter says: each rep's sales are re-fenced to Sales Rep dept and
    // reps with no D2D production drop out entirely.
    const allBucket = [];   // every D2D seller, tagged or not — the ALL column
    // Scope (per Isaac): break the cohorts down by team or office. Stored
    // as 'all' | 'team:<name>' | 'office:<name>'.
    let _scope = String(state._classScope || 'all');
    let _scopeKind = _scope.startsWith('team:') ? 'team' : _scope.startsWith('office:') ? 'office' : 'all';
    let _scopeVal = _scope.replace(/^(team|office):/, '');
    const _repOffice = (r) => String(r.office || ((r.sales || []).find(x => x.office) || {}).office || '').trim();
    const _inScope = (r) => _scopeKind === 'all' ? true
      : _scopeKind === 'team' ? (getRepTeam(r.name) || '') === _scopeVal
      : _repOffice(r).toUpperCase() === _scopeVal.toUpperCase();
    // Partners / team leads (per Isaac): RIDD (all D2D) + the team(s) they
    // lead only — no other teams, no offices.
    const _cmReach = (!isAdminRole(state.profile?.role)
      && ((typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role)) || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role)))
      && typeof myReachTeams === 'function') ? myReachTeams() : null;
    const _teamOpts = [...new Set(Object.values(repMap).map(r => getRepTeam(r.name) || '').filter(Boolean))].sort()
      .filter(t => !_cmReach || _cmReach.has(t));
    const _officeOpts = _cmReach ? [] : [...new Set(Object.values(repMap).map(_repOffice).filter(Boolean))].sort();
    // A partner can't sit on a scope outside their reach.
    if (_cmReach && _scopeKind !== 'all' && !(_scopeKind === 'team' && _cmReach.has(_scopeVal))) { state._classScope = 'all'; _scope = 'all'; _scopeKind = 'all'; _scopeVal = ''; }
    const _scopedNames = new Set();
    Object.values(repMap).forEach(r => {
      if (!_inScope(r)) return;
      _scopedNames.add(r.name);
      const d2dSales = (r.sales || []).filter(s => (typeof _indicatorDeptOf === 'function' ? _indicatorDeptOf(s) === 'd2d' : true));
      if (!d2dSales.length) return;
      allBucket.push({ ...r, sales: d2dSales });
      const t = getRepTier(r.name);
      if (t === 'rookie' || t === 'vet') tierBuckets[t].push({ ...r, sales: d2dSales });
      else { untagged++; untaggedReps.push({ ...r, sales: d2dSales }); }
    });

    const aggForTier = (reps) => {
      const sales = reps.reduce((acc, r) => acc.concat(r.sales), []);
      const totalRevenue = sales.reduce((a, s) => a + Number(s.contractValue || 0), 0);
      const pestEligible = sales.filter(s => !REP_AVG_PEST_EXCLUDE.test(s.subscription || ''));
      const avgInit = pestEligible.length > 0
        ? pestEligible.reduce((a, s) => a + Number(s.initialPrice || 0), 0) / pestEligible.length
        : 0;
      // Avg Initial across ALL subscriptions (no pest exclusions) — per Isaac.
      const avgInitial = sales.length > 0
        ? sales.reduce((a, s) => a + Number(s.initialPrice || 0), 0) / sales.length
        : 0;
      const twelve = sales.filter(s => myBucketOf(s) === 'twelve').length;
      const multi  = sales.filter(s => myBucketOf(s) === 'multi').length;
      const myDen  = twelve + multi;
      const apYes  = sales.filter(s => s.autoPay && s.autoPay !== 'No').length;
      // $20K PRA qualification — same rule as the Indicators table: only
      // reps who sold MORE than $20K in the window count toward this
      // cohort's PRA denominator. Shown as its own row so the class sizes
      // stay honest next to the gated average.
      const reps20k = reps.filter(r =>
        (r.sales || []).reduce((a, s) => a + Number(s.contractValue || 0), 0) > 20000).length;
      // Reps w/ a serviced account (per Isaac) — same serviced evidence the
      // P/S gate uses: ≥1 completed service OR a serviced date. PRA·Serviced
      // divides the cohort's revenue by THAT rep count.
      const _svcEv = (s) => (Number(s.services) || 0) > 0 || !!s.servicedDate;
      const repsServiced = reps.filter(r => (r.sales || []).some(_svcEv)).length;
      return {
        reps:    reps.length,
        reps20k,
        repsServiced,
        sold:    sales.length,
        revenue: totalRevenue,
        avgInit,
        avgInitial,
        pra:     reps20k > 0 ? totalRevenue / reps20k : 0,
        praServiced: repsServiced > 0 ? totalRevenue / repsServiced : 0,
        acv:     sales.length > 0 ? totalRevenue / sales.length : 0,
        myPct:   myDen > 0 ? multi / myDen : 0,
        apPct:   sales.length > 0 ? apYes / sales.length : 0,
      };
    };
    const rookie = aggForTier(tierBuckets.rookie);
    const vet    = aggForTier(tierBuckets.vet);
    const alls   = aggForTier(allBucket);   // combined — includes untagged sellers

    // Company-wide totals for the weight % math below. Counts every
    // sale in the windowed rawSales (so untagged reps' contributions
    // are in the denominator) — that way "% of company" tells the
    // truth: rookie + vet won't sum to 100% when there are untagged
    // reps still selling, which is exactly the story the manager needs.
    // Same D2D fence as the cohorts above — "% of co." means percent of
    // DOOR-TO-DOOR production, not company-wide across departments.
    const _d2dAll = (rawSales || []).filter(s => (typeof _indicatorDeptOf === 'function' ? _indicatorDeptOf(s) === 'd2d' : true)
      && (_scopeKind === 'all' || _scopedNames.has(getCanonicalRepName(s.rep))));
    const companyTotalSold    = _d2dAll.length;
    const companyTotalRevenue = _d2dAll.reduce((a, s) => a + Number(s.contractValue || 0), 0);

    // Side-by-side metric row — leading metric labels in the center column
    // so the two values sit symmetrically. Adds a small delta arrow per
    // metric so trends are readable at a glance.
    const fmtVal = {
      sold:    v => fmt.int(v),
      reps20k: v => fmt.int(v),
      repsServiced: v => fmt.int(v),
      praServiced:  v => fmt.usd0(v),
      revenue: v => fmt.usdShort(v),   // $16.99M — the full figure squished the phone columns (per Isaac)
      avgInit: v => fmt.usd0(v),
      avgInitial: v => fmt.usd0(v),
      pra:     v => fmt.usd0(v),
      acv:     v => fmt.usd0(v),
      myPct:   v => (v * 100).toFixed(1) + '%',
      apPct:   v => (v * 100).toFixed(1) + '%',
    };
    // Metrics grouped into labeled sections (per Isaac) — the flat list got
    // messy as the stat count grew. Same 3-column compare inside each band.
    const ROW_SECTIONS = [
      ['Volume', [
        ['sold',    'Subscriptions'],
        ['revenue', 'Revenue'],
      ]],
      ['Pricing', [
        ['avgInitial', 'Avg Initial'],
        ['avgInit',    'Avg Pest Initial'],
        ['acv',        'ACV'],
      ]],
      ['Per Rep', [
        ['reps20k',      'Reps > $20K'],
        ['pra',          'PRA'],
        ['repsServiced', 'Reps W/ Serviced'],
        ['praServiced',  'PRA \u00b7 Serviced'],
      ]],
      ['Quality', [
        ['myPct', 'Multi-Year %'],
        ['apPct', 'Auto-Pay %'],
      ]],
    ];

    const ROOKIE_COLOR = '#5F6C5B';
    const VET_COLOR    = '#DF643A';
    const ALL_COLOR    = '#7C857A';

    const sideCell = (val, color, leader, subtitle) => el('div', {
      class: 'flex-1 px-2 py-2 text-center min-w-0',
      style: {
        background: leader ? color + '14' : 'transparent',
        borderRadius: '0',
      },
    },
      // Font shrinks on narrow screens so a full revenue figure never
      // bleeds past the card edge.
      el('div', { class: 'font-black tabular-nums whitespace-nowrap', style: { color: leader ? color : 'var(--text)', fontSize: 'clamp(11px, 3.4vw, 16px)' } }, val),
      // Subtitle = "X% of company" for the volume rows — shows the
      // weight each cohort carries against the whole denominator
      // (including untagged reps), so rookie + vet won't sum to 100%
      // when there are still untagged reps selling.
      subtitle && el('div', {
        class: 'text-[10px] mt-0.5 tabular-nums',
        style: { color: leader ? color : 'var(--text-muted)', fontWeight: leader ? '700' : '500' },
      }, subtitle),
    );

    // Percent-of-company helper — returns "X% of co." when we have a
    // valid denominator, or null when there's nothing to compare against.
    const pctOfCo = (val, total) =>
      total > 0 ? (val / total * 100).toFixed(0) + '% of co.' : null;

    const tierRow = (label, key) => {
      const rVal = rookie[key], vVal = vet[key];
      // "leader" highlights the higher-of-the-two for revenue-style metrics.
      // For the percent metrics + averages we still highlight the higher
      // number — admins can read the chart faster that way.
      const rLead = rVal > vVal;
      const vLead = vVal > rVal;
      // Weight subtitle only on the volume rows — Sold Accounts and
      // Revenue. Averages and percent metrics aren't meaningful to
      // weight against a company total (you'd be comparing averages of
      // averages, which is misleading).
      let rSub = null, vSub = null;
      if (key === 'sold') {
        rSub = pctOfCo(rVal, companyTotalSold);
        vSub = pctOfCo(vVal, companyTotalSold);
      } else if (key === 'revenue') {
        rSub = pctOfCo(rVal, companyTotalRevenue);
        vSub = pctOfCo(vVal, companyTotalRevenue);
      }
      return el('div', { class: 'grid items-center gap-2 px-3 py-1.5', style: { gridTemplateColumns: 'minmax(88px,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', borderTop: '1px solid var(--border)' } },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-muted)' } }, label),
        sideCell(fmtVal[key](rVal), ROOKIE_COLOR, rLead, rSub),
        sideCell(fmtVal[key](vVal), VET_COLOR, vLead, vSub),
        // ALL — the combined cohort (rookies + vets + untagged), neutral, no
        // leader highlight: it's the reference line the halves compare to.
        sideCell(fmtVal[key](alls[key]), ALL_COLOR, false,
          key === 'sold' || key === 'revenue' ? 'all D2D' : null),
      );
    };

    // Class name on top, rep count underneath (per Isaac).
    const headerCell = (label, color, count) => el('div', { class: 'flex-1 flex flex-col items-center justify-center py-3 px-3' },
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'inline-block w-3 h-3 rounded-full', style: { background: color } }),
        el('div', { class: 'text-sm font-black uppercase tracking-wide', style: { color } }, label)),
      el('span', { class: 'text-xs font-semibold', style: { color: 'var(--text-muted)' } }, count + ' rep' + (count === 1 ? '' : 's')),
    );

    const scopePicker = el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      title: 'Break the Rookie / Vet cohorts down by team or office',
      onchange: (e) => { state._classScope = e.target.value; mountApp(); },
    },
      el('option', { value: 'all', selected: _scope === 'all' }, _cmReach ? 'RIDD' : 'All D2D'),
      _teamOpts.length ? el('optgroup', { label: 'Teams' }, ..._teamOpts.map(t => el('option', { value: 'team:' + t, selected: _scope === 'team:' + t }, t))) : null,
      _officeOpts.length ? el('optgroup', { label: 'Offices' }, ..._officeOpts.map(o => el('option', { value: 'office:' + o, selected: _scope === 'office:' + o }, _mktgTC(o)))) : null);
    const tierCard = el('div', { class: 'card overflow-hidden', 'data-section': 'class-metrics' },
      // Header: title left, scope dropdown top-right (per Isaac). The
      // "N untagged" chip is gone — untagged reps surface in Manage Teams.
      el('div', { class: 'px-5 py-3 border-b flex items-center justify-between gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('h3', { class: 'text-base font-bold', title: 'Tiers auto-set from sales history \u2014 first season selling = Rookie, returning reps = Vet. Manage Teams tags override. PRA divides by the Reps > $20K row; PRA \u00b7 Serviced divides by Reps W/ Serviced.' }, 'Class Metrics'),
        scopePicker,
      ),
      el('div', { class: 'grid items-center gap-2 px-3', style: { gridTemplateColumns: 'minmax(88px,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)' } },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-muted)' } }, 'Class'),
        headerCell('Rookie', ROOKIE_COLOR, rookie.reps),
        headerCell('Vet', VET_COLOR, vet.reps),
        headerCell('All', ALL_COLOR, alls.reps),
      ),
      (rookie.reps === 0 && vet.reps === 0)
        ? el('div', { class: 'p-6 text-center text-xs italic', style: { color: 'var(--text-muted)' } },
            'No tagged reps in this window. Tag reps as Rookie or Vet in Manage Teams.')
        : el('div', {}, ...ROW_SECTIONS.flatMap(([sec, defs]) => [
            el('div', { class: 'px-3 py-1 text-[9px] uppercase tracking-widest font-bold', style: { background: 'var(--card-2)', color: 'var(--text-subtle)', borderTop: '1px solid var(--border)' } }, sec),
            ...defs.map(([key, label]) => tierRow(label, key)),
          ])),
    );
    _tierCardSection = tierCard;
  })();

  // 📈 Metric Trends card RETIRED (Jul 2026, per Isaac) — merged into the
  // Performance Trends chart above via its Scope picker (offices / teams /
  // reps overlay with Years × Type). repTrendChartCard still powers the
  // rep-facing "Your Performance Trends" section.

  // ── 2. REP LEADERBOARD ──
  if (!state._indicatorRepSort) state._indicatorRepSort = { key: 'revenue', dir: 'desc' };
  // One-time migration: the leaderboard used to default to sales COUNT —
  // flip stored defaults to revenue (an explicit user pick after this
  // migration sticks like normal).
  if (!state._repSortRevenueV1) { state._repSortRevenueV1 = true; state._indicatorRepSort = { key: 'revenue', dir: 'desc' }; saveDemoData(); }
  // Migrate legacy Best Day sort dir from the old 'desc' value to the new
  // explicit 'date' / 'amount' modes (default to date — most recent first).
  // Best Week and Best Month follow the same pattern.
  _profMark('ind:class-metrics-build');
  const RECORD_SORT_KEYS = new Set(['bestDayTime', 'bestWeekTime', 'bestMonthTime']);
  if (RECORD_SORT_KEYS.has(state._indicatorRepSort.key) && state._indicatorRepSort.dir !== 'date' && state._indicatorRepSort.dir !== 'amount') {
    state._indicatorRepSort = { key: state._indicatorRepSort.key, dir: 'date' };
  }
  // _indicatorRepOffice is now the rep→office MAP (set by the CSV
  // auto-sync); the office-FILTER lives under _indicatorRepOfficeFilter
  // so the two don't trample each other. The default empty string means
  // "no filter — show every rep".
  if (state._indicatorRepOfficeFilter == null) state._indicatorRepOfficeFilter = '';
  if (state._indicatorRepTeamFilter   == null) state._indicatorRepTeamFilter   = '';
  if (state._indicatorRepTierFilter   == null) state._indicatorRepTierFilter   = '';

  // Define columns once so headers, sorting, and cell rendering stay in lockstep
  let repCols = [
    { key: 'name',       label: 'Rep',      align: 'left',  defaultDir: 'asc',  cell: r => {
        const meta = repTierMeta(r.tier);
        return el('td', { class: 'px-2 py-2' },
          el('div', { class: 'flex items-center gap-1.5' },
            el('span', { class: 'font-semibold' }, r.name),
            meta && el('span', {
              class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
              style: { background: meta.color + '22', color: meta.color },
            }, meta.label),
          ),
        );
      } },
    // Team + Office don't apply to office staff (they're not on D2D team
    // rosters and all share the office) — dropped when that dept is scoped.
    ...(state.indicatorDept === 'office' ? [] : [
      { key: 'team',       label: 'Team',     align: 'left',  defaultDir: 'asc',  cell: r => el('td', { class: 'px-2 py-2 text-muted-' }, r.team || '—') },
      { key: 'office',     label: 'Office',   align: 'left',  defaultDir: 'asc',  cell: r => {
          // Multi-branch reps (per Isaac): show the office they sold the
          // MOST in, with "+N" for the rest and the full revenue split on
          // hover — so the merged total is always explainable against
          // per-branch CRM reports.
          const _tc = (o) => (o || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
          const ent = Object.entries(r.officeRev || {}).sort((a2, b2) => b2[1] - a2[1]);
          const recs = Object.entries(r.recRev || {}).sort((a2, b2) => b2[1] - a2[1]);
          const label = _tc(ent.length ? ent[0][0] : r.office);
          // The hover reconciles this MERGED person against per-record CRM
          // tools: each line = one FieldRoutes employee record's revenue.
          const title = recs.length > 1
            ? 'Merged from ' + recs.length + ' CRM records:\n' + recs.map(([k, v]) => k + ' \u2014 ' + fmt.usd0(v)).join('\n')
            : '';
          return el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap', title }, label);
        } },
    ]),
    { key: 'count',      label: 'Sales',    align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums' }, fmt.int(r.count)) },
    { key: 'revenue',    label: 'Revenue',  align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums font-semibold' }, fmt.usd0(r.revenue)) },
    // 12-week revenue sparkline with WoW slope. Sort key = trendSlope so
    // clicking surfaces reps with the biggest week-over-week jump (or drop).
    { key: 'auditPct', label: 'Audit %', align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap' },
        el('span', {
          class: 'font-semibold',
          style: { color: r.auditPct >= 0.9 ? '#DF643A' : r.auditPct < 0.7 ? '#DC2626' : 'var(--text)' },
          title: 'Accounts not flagged Failed Audit ÷ all accounts (no-audit + pending count as good)',
        }, (r.auditPct * 100).toFixed(1) + '%')) },
    { key: 'acv',        label: 'ACV',      align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums' }, fmt.usd(r.acv)) },
    // Selling-day metrics — averages over days WITH ≥1 sale only.
    { key: 'sellingDays', label: 'Days',   align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums', title: 'Days with at least one sale' }, fmt.int(r.sellingDays || 0)) },
    { key: 'revPerDay',   label: '$/Day',     align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums', title: 'Average revenue per SELLING day (days off don\'t count)' }, fmt.usd0(r.revPerDay || 0)) },
    { key: 'acctsPerDay', label: 'Accts/Day', align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums', title: 'Average accounts per SELLING day' }, (r.acctsPerDay || 0).toFixed(1)) },
    // Avg Pest Initial = avg of initialPrice EXCLUDING Sentricon / German Roach
    // / Interior Flea (matches the door-to-door comp). Avg Initial = avg of
    // every sale's initialPrice with no exclusions (overall pricing power).
    { key: 'avgPest',    label: 'Pest Init', align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums' }, r.avgPest > 0 ? fmt.usd(r.avgPest) : '—') },
    { key: 'avgInitial', label: 'Avg Init',      align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums' }, r.avgInitial > 0 ? fmt.usd(r.avgInitial) : '—') },
    { key: 'myPct',      label: 'MY %',     align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums' }, (r.myPct * 100).toFixed(1) + '%') },
    { key: 'autoPayPct', label: 'APay %', align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums' }, (r.autoPayPct * 100).toFixed(1) + '%') },
    // (Cancels column retired from the leaderboard per Isaac, Sep 21 — fewer columns so the table fits without a scroll; Attrition % carries the read, and the player card keeps the count.)
    { key: 'attrPct',    label: 'Attrition %', align: 'left', defaultDir: 'desc', title: 'Cancelled $ ÷ serviced $ · 3-day RORs + one-time services removed from both sides (same number as the player card)', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums', style: r.attrPct > 0.1 ? { color: '#DC2626', fontWeight: '600' } : {} }, r.attrPct > 0 ? (r.attrPct * 100).toFixed(1) + '%' : '—') },
    // ─── Records: Best Day / Week / Month moved to the end of the row so
    // they don't push the regular metrics off-screen. Sort dir 'date' picks
    // the rep whose biggest record happened MOST RECENTLY; 'amount' picks
    // the biggest dollar record. Toggle by re-clicking the header.
    // Bold left rule (also on the header th below) breaks the Best Day/Week/
    // Month records out from the stat columns — per Isaac.
    { key: 'bestDayTime', label: 'Best Day', align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap', style: { borderLeft: '1px solid var(--border-2)' } },
        r.bestDay > 0
          ? el('div', {},
              el('div', { class: 'font-semibold' }, fmt.usd0(r.bestDay)),
              el('div', { class: 'text-[10px] text-muted-' }, r.bestDayDate || ''),
            )
          : '—',
      ) },
    { key: 'bestWeekTime', label: 'Best Week', align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums whitespace-nowrap' },
        r.bestWeek > 0
          ? el('div', {},
              el('div', { class: 'font-semibold' }, fmt.usd0(r.bestWeek)),
              el('div', { class: 'text-[10px] text-muted-' }, r.bestWeekStart || ''),
            )
          : '—',
      ) },
    { key: 'bestMonthTime', label: 'Best Month', align: 'left', defaultDir: 'desc', cell: r => el('td', { class: 'pl-2 pr-5 py-2 text-left tabular-nums whitespace-nowrap' },
        r.bestMonth > 0
          ? el('div', {},
              el('div', { class: 'font-semibold' }, fmt.usd0(r.bestMonth)),
              el('div', { class: 'text-[10px] text-muted-' }, r.bestMonthKey
                ? new Date(r.bestMonthKey + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                : ''),
            )
          : '—',
      ) },
  ];

  // ── Per-rep-type columns (driven by the dept toggle) ──
  // Office staff revenue includes renewals, so show Revenue (incl. renewals),
  // New Rev (renewals stripped), and Renewal Rev — and drop Audit %, which
  // isn't meaningful for inside/office sales. D2D + Techs keep the single
  // Revenue column (renewals are ~zero there) and Audit %.
  if ((state.indicatorDept || 'all') === 'office') {
    repCols = repCols.filter(c => c.key !== 'auditPct');
    const usdCol = (key, label, bold) => ({
      key, label, align: 'left', defaultDir: 'desc',
      cell: r => el('td', { class: 'px-2 py-2 text-left tabular-nums' + (bold ? ' font-semibold' : '') }, fmt.usd0(r[key] || 0)),
    });
    const ri = repCols.findIndex(c => c.key === 'revenue');
    if (ri >= 0) repCols.splice(ri, 1,
      usdCol('revenue', 'Revenue', true),
      usdCol('newRevenue', 'New Rev', false),
      usdCol('renewalRevenue', 'Renewal Rev', false),
    );
  }

  // Hideable COLUMNS (per Isaac, edit mode): ✕ on a header hides that
  // column for the current Type; the "Hidden columns" strip in the header
  // row brings them back. Same synced storage pattern as the Indicators
  // hidden rows. # and Rep never hide.
  const _lbHm = (state._indHiddenLbCols && typeof state._indHiddenLbCols === 'object') ? state._indHiddenLbCols : (state._indHiddenLbCols = {});
  const _lbDept = state.indicatorDept || 'all';
  const _lbHiddenKeys = Array.isArray(_lbHm[_lbDept]) ? _lbHm[_lbDept] : [];
  const _lbHiddenDefs = repCols.filter(c => _lbHiddenKeys.includes(c.key));
  repCols = repCols.filter(c => !_lbHiddenKeys.includes(c.key));
  const _lbSaveHidden = (keys) => {
    _lbHm[_lbDept] = keys;
    saveDemoData();
    if (typeof saveIndicatorState === 'function') saveIndicatorState();
    mountApp();
  };
  // Sorting by a column that just got hidden strands the sort — heal it.
  if (state._indicatorRepSort && _lbHiddenKeys.includes(state._indicatorRepSort.key)) {
    state._indicatorRepSort = { key: 'revenue', dir: 'desc' };
  }

  // Apply office + team + tier + name-search filters. Reps flipped to
  // Inactive in Manage Teams drop out unconditionally — they're already
  // off the team, no point ranking them. (Same gate Coach Mode uses.)
  const officeFilter = state._indicatorRepOfficeFilter;
  let teamFilter   = state._indicatorRepTeamFilter;
  let tierFilter   = state._indicatorRepTierFilter;
  // "Unassigned" only exists while some rep ON THE BOARD actually lacks a
  // tier / team. Inactive reps now make the board (they sold in range), so
  // they count here too. If a stale Unassigned filter would strand the
  // board on "0 of N reps", clear it.
  const _activeUnassignedTier = allReps.some(r => !r.tier);
  const _activeUnassignedTeam = allReps.some(r => !r.team);
  if (tierFilter === '__unassigned__' && !_activeUnassignedTier) tierFilter = state._indicatorRepTierFilter = '';
  if (teamFilter === '__unassigned__' && !_activeUnassignedTeam) teamFilter = state._indicatorRepTeamFilter = '';
  const nameSearch   = (state._indicatorRepNameSearch || '').trim().toLowerCase();
  // ── Rep pick (a "downline") ─────────────────────────────────────────────
  // Partners run downlines that cut across teams, so team/office filters
  // cannot express them. An explicit rep list can. Empty = everyone, so the
  // board behaves exactly as before until someone picks. Saved per user via
  // the Presets ribbon (_indicatorRepPick is in IND_PRESET_KEYS), which is
  // keyed on profile id and synced through user_prefs - one partner's
  // downline never leaks onto another's screen.
  const _pickArr = Array.isArray(state._indicatorRepPick) ? state._indicatorRepPick.filter(Boolean) : null;
  const repPick = (_pickArr && _pickArr.length) ? new Set(_pickArr) : null;
  const filteredReps = allReps.filter(r => {
    if (repPick && !repPick.has(r.name)) return false;
    // NO active-status gate here, per Isaac: if a rep sold accounts inside
    // the selected range they belong on the board, whether or not they are
    // still selling. allReps is built from in-range sales, so this is
    // already "everyone with production". A rep who churned mid-season kept
    // their revenue out of YTD totals and made the board silently disagree
    // with the CRM. Inactive reps are badged instead of hidden. Coach flags
    // and the Kobe board still skip them - those are about who to work with
    // now, not who produced.
    if (officeFilter && r.office !== officeFilter) return false;
    if (teamFilter) {
      if (teamFilter === '__unassigned__') { if (r.team) return false; }
      else if (r.team !== teamFilter) return false;
    }
    if (tierFilter) {
      if (tierFilter === '__unassigned__') { if (r.tier) return false; }
      else if (r.tier !== tierFilter) return false;
    }
    // Name search is applied client-side (show/hide rows) so typing never
    // triggers a full re-render — see the search input's oninput below.
    return true;
  });

  // ── Office-staff revenue lens (per Isaac): NEW revenue is the default —
  // renewals are a different motion and drowned the new-business race.
  // Toggle: New (default) / Total / Renewal. Other departments stay Total.
  const _repRevMode = state.indicatorDept === 'office' ? (state._indRepRevMode || 'new') : 'total';
  let boardReps = filteredReps;
  if (_repRevMode !== 'total') {
    const _isRenS = (s) => (typeof _indicatorIsRenewal === 'function') && _indicatorIsRenewal(s);
    boardReps = filteredReps.map(r => {
      const sales = (r.sales || []).filter(s => _repRevMode === 'renewal' ? _isRenS(s) : !_isRenS(s));
      const revenue = sales.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
      const days = new Set(sales.map(s => (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '').filter(Boolean)).size;
      return Object.assign({}, r, { _orig: r, sales, revenue, count: sales.length, sellingDays: days, revPerDay: days > 0 ? revenue / days : 0 });
    }).filter(r => r.count > 0);
  }

  // Sort by the selected column
  const sortKey = state._indicatorRepSort.key;
  const sortDir = state._indicatorRepSort.dir;
  const cmpVal = (v) => typeof v === 'string' ? v.toLowerCase() : (v ?? 0);
  // Best Day / Week / Month toggle between two distinct sort modes — neither
  // is "asc" because reading "old best record" first isn't useful.
  //   dir 'date'   → most recent record first, ties broken by $$
  //   dir 'amount' → biggest record $$ first, ties broken by recency
  const RECORD_SORT_FIELDS = {
    bestDayTime:   { time: 'bestDayTime',   amount: 'bestDay'   },
    bestWeekTime:  { time: 'bestWeekTime',  amount: 'bestWeek'  },
    bestMonthTime: { time: 'bestMonthTime', amount: 'bestMonth' },
  };
  boardReps.sort((a, b) => {
    const recFields = RECORD_SORT_FIELDS[sortKey];
    if (recFields) {
      if (sortDir === 'amount') {
        const dv = (b[recFields.amount] || 0) - (a[recFields.amount] || 0);
        if (dv !== 0) return dv;
        return (b[recFields.time] || 0) - (a[recFields.time] || 0);
      }
      const dt = (b[recFields.time] || 0) - (a[recFields.time] || 0);
      if (dt !== 0) return dt;
      return (b[recFields.amount] || 0) - (a[recFields.amount] || 0);
    }
    const va = cmpVal(a[sortKey]);
    const vb = cmpVal(b[sortKey]);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Render every filtered rep. The desktop table is wrapped in a
  // fixed-height scroll container (see maxHeight below) sized to show
  // ~10 rows out of the gate; rows 11+ scroll inside the card so the
  // page doesn't stretch indefinitely.
  const displayReps = boardReps;

  const offices = [...new Set(allReps.map(r => r.office).filter(Boolean))].sort();

  // Re-apply an active name search after the render mounts, so it survives
  // tier/office pill changes (which DO re-render) without a per-keystroke one.
  if (state._indicatorRepNameSearch && state._indicatorRepNameSearch.trim()) {
    setTimeout(() => {
      const q = state._indicatorRepNameSearch.trim().toLowerCase();
      document.querySelectorAll('[data-replb]').forEach(row => {
        const n = row.getAttribute('data-replb') || '';
        row.style.display = (!q || n.includes(q)) ? '' : 'none';
      });
    }, 0);
  }

  // Stash the full roster for the Top-15 PDF (Manage Teams → Reports).
  state._indLbAllReps = allReps;
  _profMark('ind:leaderboard-compute');
  sections.push(
    // overflow-visible while the Filters menu is open so the dropdown isn't
    // clipped at the card edge (per Isaac).
    el('div', { class: 'card' + (state._repCancelMenuOpen ? '' : ' overflow-hidden'), 'data-section': 'rep-leaderboard' },
      // Mobile (per Isaac): title + Filters share the top row, the search
      // box gets the whole bottom row, the rep count drops (lb-head CSS).
      el('div', { class: 'lb-head px-5 py-3 border-b flex items-center justify-between flex-wrap gap-3', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'lb-title flex items-center gap-3 flex-wrap' },
          el('h3', { class: 'text-base font-bold' }, 'Leaderboard'),
          el('span', { class: 'lb-count text-xs text-muted-' },
            filteredReps.length === allReps.length
              ? filteredReps.length + ' reps'
              : filteredReps.length + ' of ' + allReps.length + ' reps'),
        ),
        el('div', { class: 'lb-tools flex items-center gap-2 flex-wrap flex-1 sm:flex-initial' },
          // Search on the left; ONE Filters button on the right — tier,
          // team, office, and the cancel-type toggles all live inside its
          // panel now instead of crowding the header.
          //
          // Search: mountApp() rebuilds the entire page, so firing it
          // per-keystroke felt laggy on big rosters — rows filter IN PLACE
          // (show/hide) so the input keeps focus with zero flicker.
          el('input', {
            id: 'rep-leaderboard-search',
            type: 'text',
            placeholder: 'Search rep…',
            value: state._indicatorRepNameSearch || '',
            class: 'lb-search rounded-lg border px-2.5 py-1 text-[11px] flex-1 min-w-0',
            style: { borderColor: 'var(--border-2)', minWidth: '160px' },
            onchange: (e) => { if (e.target.value.trim() && typeof trackAction === 'function') trackAction('search:leaderboard', null, { len: e.target.value.trim().length }); },
            oninput: (e) => {
              state._indicatorRepNameSearch = e.target.value;
              const q = e.target.value.trim().toLowerCase();
              document.querySelectorAll('[data-replb]').forEach(row => {
                const n = row.getAttribute('data-replb') || '';
                row.style.display = (!q || n.includes(q)) ? '' : 'none';
              });
            },
          }),
          // Rep picker — check specific reps to build a downline view.
          (() => {
            const btn = el('button', {
              class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 whitespace-nowrap',
              style: { borderColor: repPick ? 'var(--accent)' : 'var(--border-2)', color: repPick ? 'var(--accent)' : 'var(--text)' },
              title: 'Pick specific reps (a downline). Save the selection with the Presets ribbon on the left edge.',
              onclick: (e) => { e.stopPropagation(); state._indRepPickOpen = !state._indRepPickOpen; mountApp(); },
            }, repPick ? (repPick.size + ' reps picked') : 'Pick reps');
            if (!state._indRepPickOpen) return el('span', { style: { position: 'relative' } }, btn);
            const setPick = (arr) => {
              state._indicatorRepPick = (arr && arr.length) ? arr : null;
              mountApp();
            };
            const cur = new Set(_pickArr || []);
            const panel = el('div', {
              class: 'card',
              style: { width: '260px', padding: '8px', boxShadow: 'var(--shadow-lg)' },
            },
              el('div', { class: 'flex items-center justify-between gap-2 px-1 pb-2' },
                el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-bold' }, 'Downline'),
                el('div', { class: 'flex items-center gap-2' },
                  el('button', { class: 'text-[10px] font-bold', style: { color: 'var(--text-muted)', background: 'transparent' },
                    onclick: () => setPick(null) }, 'Clear'))),
              // Typing filters the list IN PLACE so the input keeps focus on a
              // big roster - same trick the leaderboard search uses.
              el('input', {
                type: 'text', placeholder: 'Find a rep\u2026',
                class: 'rounded-lg border px-2.5 py-1 text-[11px] w-full',
                style: { borderColor: 'var(--border-2)' },
                oninput: (e) => {
                  const q = (e.target.value || '').trim().toLowerCase();
                  document.querySelectorAll('[data-reppick]').forEach(row => {
                    const n = row.getAttribute('data-reppick') || '';
                    row.style.display = (!q || n.includes(q)) ? '' : 'none';
                  });
                },
              }),
              el('div', { class: 'flex flex-col mt-1.5', style: { maxHeight: '240px', overflowY: 'auto' } },
                ...allReps.slice().sort((a, b) => (cur.has(b.name) - cur.has(a.name)) || (a.name || '').localeCompare(b.name || '')).map(r => {
                  const cb = el('input', { type: 'checkbox', style: { cursor: 'pointer', flexShrink: '0', accentColor: 'var(--accent)' } });
                  if (cur.has(r.name)) cb.setAttribute('checked', '');
                  cb.checked = cur.has(r.name);
                  cb.onchange = () => {
                    if (cb.checked) cur.add(r.name); else cur.delete(r.name);
                    setPick([...cur]);
                  };
                  return el('label', {
                    'data-reppick': (r.name || '').toLowerCase(),
                    class: 'flex items-center gap-2 px-1 py-1.5 rounded-lg cursor-pointer text-xs',
                  }, cb, el('span', { class: 'truncate' }, r.name));
                })),
              el('div', { class: 'text-[10px] text-muted- px-1 pt-2' },
                'Save this selection from the Presets ribbon on the left edge.'));
            _anchorPopover(panel, btn, 'left');
            return el('span', { style: { position: 'relative' } }, btn, panel);
          })(),

          state.indicatorDept === 'office' ? el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
            ...[['new', 'New'], ['total', 'Total'], ['renewal', 'Renewal']].map(([v, l]) => el('button', {
              class: 'px-2.5 py-1 text-[11px] font-bold transition cursor-pointer',
              style: (state._indRepRevMode || 'new') === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
              title: v === 'new' ? 'New business only (default)' : v === 'renewal' ? 'Renewal-source revenue only' : 'Everything',
              onclick: () => { state._indRepRevMode = v; mountApp(); },
            }, l))) : null,
          (() => {
            // One-time migration: the old default EXCLUDED these three kinds.
            // New default = include everything (uncheck to exclude).
            if (!state._repFiltersV2) {
              state._repFiltersV2 = true;
              state._indicatorRepIncludeRor = true;
              state._indicatorRepIncludeOneTime = true;
              state._indicatorRepIncludeRenewals = true;
              saveDemoData();
            }
            const opts = [
              ['_indicatorRepIncludeRor',      'Count 3-Day RORs',        'Cancels within 3 days of sale (Right of Rescission)'],
              ['_indicatorRepIncludeOneTime',  'Count one-time services', 'Cancels on "One Time …" service types (completed jobs closing out)'],
              ['_indicatorRepIncludeRenewals', 'Count renewals',          'Cancels where the customer renewed onto a new subscription (Renewal - …)'],
            ];
            const offCount = opts.filter(([k]) => !state[k]).length;
            const activeN = offCount + (tierFilter ? 1 : 0) + (teamFilter ? 1 : 0) + (officeFilter ? 1 : 0);
            const wrap = el('div', { class: 'relative' });
            wrap.append(el('button', {
              class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition border flex items-center gap-1.5',
              style: activeN
                ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
                : { borderColor: 'var(--border-2)', color: 'var(--text)' },
              title: 'Tier, team, office, and cancel-type filters',
              onclick: (e) => { e.stopPropagation(); state._repCancelMenuOpen = !state._repCancelMenuOpen; mountApp(); },
            },
              el('span', {}, 'Filters' + (activeN ? ' · ' + activeN : ''))));
            if (state._repCancelMenuOpen) {
              const secLabel = (t) => el('div', { class: 'px-2.5 pt-2 pb-1 text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, t);
              // Tier pills (All / Rookie / Vet / Unassigned)
              const hasUnassignedTier = _activeUnassignedTier;
              const pillOpts = [
                { id: '', label: 'All' },
                ...REP_TIERS.map(t => ({ id: t.id, label: t.label, color: t.color })),
              ];
              if (hasUnassignedTier && isAdminRole(state.profile?.role)) pillOpts.push({ id: '__unassigned__', label: 'Unassigned' });
              const tierRow = el('div', { class: 'px-2.5 pb-1' },
                el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
                  ...pillOpts.map(p => el('button', {
                    class: 'px-2.5 py-1 text-[11px] font-semibold transition',
                    style: tierFilter === p.id
                      ? { background: p.color || 'var(--accent)', color: '#fff' }
                      : { background: 'transparent', color: 'var(--text)' },
                    onclick: (e) => { e.stopPropagation(); state._indicatorRepTierFilter = p.id; mountApp(); },
                  }, p.label))));
              // Team select: admins see every team; partners / team leads get
              // it too (per Isaac, Sep 2026) so they can look at their own team.
              const _teamSelOk = isAdminRole(state.profile?.role) || (typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role)) || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role));
              const teamSel = _teamSelOk ? (() => {
                const teams = distinctTeams().filter(t => !isTeamExcluded(t));
                const hasUnassigned = _activeUnassignedTeam;
                return el('select', {
                  class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer w-full',
                  style: { borderColor: 'var(--border-2)' },
                  onchange: (e) => { state._indicatorRepTeamFilter = e.target.value; mountApp(); },
                },
                  el('option', { value: '', selected: !teamFilter }, 'All teams'),
                  ...teams.map(t => el('option', { value: t, selected: teamFilter === t }, t)),
                  hasUnassigned && el('option', { value: '__unassigned__', selected: teamFilter === '__unassigned__' }, '— Unassigned —'));
              })() : null;
              const officeSel = el('select', {
                class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer w-full',
                style: { borderColor: 'var(--border-2)' },
                onchange: (e) => { state._indicatorRepOfficeFilter = e.target.value; mountApp(); },
              },
                el('option', { value: '', selected: !officeFilter }, 'All offices'),
                ...offices.map(o => el('option', { value: o, selected: officeFilter === o },
                  o.split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' '))));
              const _lbPanel = el('div', { class: 'card absolute p-1.5', style: { top: 'calc(100% + 6px)', right: '0', minWidth: '270px', zIndex: '40', boxShadow: 'var(--shadow-lg)' } },
                secLabel('Tier'), tierRow,
                teamSel && secLabel('Team'), teamSel && el('div', { class: 'px-2.5 pb-1' }, teamSel),
                secLabel('Office'), el('div', { class: 'px-2.5 pb-1' }, officeSel),
                ...(isAdminRole(state.profile?.role) ? [secLabel('Cancel types')] : []),
                ...(isAdminRole(state.profile?.role) ? opts : []).map(([key, label, tip]) => el('button', {
                  class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
                  style: { color: 'var(--text)', background: state[key] ? 'var(--card-2)' : 'transparent' },
                  title: tip,
                  onclick: (e) => { e.stopPropagation(); state[key] = !state[key]; saveDemoData(); mountApp(); },
                },
                  el('span', { style: { fontSize: '13px' } }, state[key] ? '☑' : '☐'),
                  el('span', {}, label))),
                el('div', { class: 'px-2.5 pt-1.5 pb-1 text-[10px]', style: { color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', marginTop: '4px' } },
                  'Checked cancel types count (the default). Uncheck to exclude. Sold-Not-Started & Combined never count.'));
              wrap.append(_lbPanel);
              clampDropdownPanel(_lbPanel);
              if (window._repCancelMenuCloser) document.removeEventListener('mousedown', window._repCancelMenuCloser);
              window._repCancelMenuCloser = (ev) => {
                const w = document.getElementById('rep-cancel-filter-wrap');
                if (w && w.contains(ev.target)) return;
                document.removeEventListener('mousedown', window._repCancelMenuCloser);
                window._repCancelMenuCloser = null;
                if (state._repCancelMenuOpen) { state._repCancelMenuOpen = false; mountApp(); }
              };
              setTimeout(() => document.addEventListener('mousedown', window._repCancelMenuCloser), 0);
            }
            wrap.id = 'rep-cancel-filter-wrap';
            return wrap;
          })(),
          // (Top-15 PDF export moved into Manage Teams → Reports — per Isaac.)
        ),
      ),
      // Desktop / tablet: full table with horizontal scroll if needed.
      // Sized to comfortably show ~10 rows + the sticky header before
      // scrolling kicks in (each row averages ~44px once the Best
      // Day/Week/Month two-line cells render, plus the ~32px header).
      el('div', { class: 'hidden sm:block scroll-x', style: { maxHeight: '520px', overflowY: 'auto' } },
        el('table', { class: 'w-full text-xs' },
          el('thead', {
            class: 'text-[9px] uppercase tracking-wider text-muted-',
            style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: 1 },
          },
            el('tr', {},
              el('th', { class: 'text-left pl-5 pr-2 py-2 font-semibold w-8' }, '#'),
              ...repCols.map(c => {
                const isSorting = sortKey === c.key;
                const isRecordCol = RECORD_SORT_KEYS.has(c.key);
                // Best Day/Week/Month show which custom mode is active
                // (date or amount) — other columns use the standard
                // asc/desc arrow.
                const arrow = isSorting && isRecordCol
                  ? (sortDir === 'amount' ? ' · by $' : ' · by date')
                  : '';   // direction arrows retired — active header is highlighted
                const align = c.align === 'right' ? 'text-right' : 'text-left';
                const padLeft = (c.key === 'cancelPct' || c.key === 'attrPct') ? 'pl-2 pr-5' : 'px-2';
                return el('th', {
                  class: align + ' ' + padLeft + ' py-2 font-semibold cursor-pointer select-none hover:text-default transition whitespace-nowrap',
                  style: isSorting ? { color: 'var(--accent)' } : {},   // (bold Best-Day rule starts on the body rows, not the header — per Isaac)
                  onclick: () => {
                    // Record columns cycle between two custom sort modes —
                    // date (most recent first) and amount (biggest $ first)
                    // — no asc/desc toggle since old best records aren't
                    // useful at the top either way.
                    if (isRecordCol) {
                      const cur = sortKey === c.key ? sortDir : 'date';
                      state._indicatorRepSort = { key: c.key, dir: cur === 'date' ? 'amount' : 'date' };
                    } else if (sortKey === c.key) {
                      state._indicatorRepSort = { key: c.key, dir: sortDir === 'asc' ? 'desc' : 'asc' };
                    } else {
                      state._indicatorRepSort = { key: c.key, dir: c.defaultDir };
                    }
                    mountApp();
                  },
                }, c.label + arrow,
                  (isAdminRole(state.profile?.role) && state._editMode && c.key !== 'name') ? el('span', {
                    class: 'ml-1 cursor-pointer select-none',
                    style: { color: 'var(--text-subtle)', fontSize: '9px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '.04em' },
                    title: 'Hide this column for the current Type — bring it back from the "Hidden columns" strip (nothing is deleted)',
                    onclick: (e) => { e.stopPropagation(); _lbSaveHidden([..._lbHiddenKeys, c.key]); },
                  }, 'hide') : null);
              }),
            ),
            // Σ Totals row (per Isaac) — whole-board rollup pinned at the top,
            // recomputed from the FILTERED rep set so it always matches the
            // "N reps" count in the card header. Percent columns are sales-
            // weighted; $/Day style columns divide the summed numerators by
            // the summed denominators; Best Day/Week/Month show the biggest
            // single-rep record on the board.
            (() => {
              if (!displayReps.length) return null;
              const T = { count: 0, revenue: 0, newRevenue: 0, renewalRevenue: 0, sellingDays: 0, cancels: 0, attrServRev: 0, attrCxlRev: 0 };
              let wAudit = 0, wMy = 0, wAuto = 0, wPest = 0, nPest = 0, wInit = 0, nInit = 0;
              let bDay = 0, bWeek = 0, bMonth = 0;
              displayReps.forEach(r => {
                const c = Number(r.count) || 0;
                T.count += c;
                T.revenue += Number(r.revenue) || 0;
                T.newRevenue += Number(r.newRevenue) || 0;
                T.renewalRevenue += Number(r.renewalRevenue) || 0;
                T.sellingDays += Number(r.sellingDays) || 0;
                T.cancels += Number(r.cancels) || 0;
                T.attrServRev += Number(r.attrServRev) || 0;
                T.attrCxlRev += Number(r.attrCxlRev) || 0;
                wAudit += (Number(r.auditPct) || 0) * c;
                wMy    += (Number(r.myPct) || 0) * c;
                wAuto  += (Number(r.autoPayPct) || 0) * c;
                if (r.avgPest > 0)    { wPest += r.avgPest * c;    nPest += c; }
                if (r.avgInitial > 0) { wInit += r.avgInitial * c; nInit += c; }
                if ((r.bestDay || 0) > bDay)     bDay = r.bestDay;
                if ((r.bestWeek || 0) > bWeek)   bWeek = r.bestWeek;
                if ((r.bestMonth || 0) > bMonth) bMonth = r.bestMonth;
              });
              const pct = (v) => T.count > 0 ? ((v / T.count) * 100).toFixed(1) + '%' : '—';
              const vals = {
                name: 'Total',
                count: fmt.int(T.count),
                revenue: fmt.usd0(T.revenue),
                newRevenue: fmt.usd0(T.newRevenue),
                renewalRevenue: fmt.usd0(T.renewalRevenue),
                auditPct: pct(wAudit),
                acv: T.count > 0 ? fmt.usd(T.revenue / T.count) : '—',
                // Days = AVERAGE selling days per rep (per Isaac) — a summed
                // rep-day count read as a nonsense "total". $/Day and Accts/Day
                // still divide by the rep-day sum, so they stay per-rep-day.
                sellingDays: displayReps.length > 0 ? (T.sellingDays / displayReps.length).toFixed(1) : '—',
                revPerDay: T.sellingDays > 0 ? fmt.usd0(T.revenue / T.sellingDays) : '—',
                acctsPerDay: T.sellingDays > 0 ? (T.count / T.sellingDays).toFixed(1) : '—',
                avgPest: nPest > 0 ? fmt.usd(wPest / nPest) : '—',
                avgInitial: nInit > 0 ? fmt.usd(wInit / nInit) : '—',
                myPct: pct(wMy),
                autoPayPct: pct(wAuto),
                cancels: T.cancels > 0 ? fmt.int(T.cancels) : '—',
                cancelPct: (T.count > 0 && T.cancels > 0) ? ((T.cancels / T.count) * 100).toFixed(1) + '%' : '—',
                attrPct: (T.attrServRev > 0 && T.attrCxlRev > 0) ? ((T.attrCxlRev / T.attrServRev) * 100).toFixed(1) + '%' : '—',
                bestDayTime: bDay > 0 ? fmt.usd0(bDay) : '—',
                bestWeekTime: bWeek > 0 ? fmt.usd0(bWeek) : '—',
                bestMonthTime: bMonth > 0 ? fmt.usd0(bMonth) : '—',
              };
              const tips = {
                auditPct: 'Sales-weighted average across the reps shown',
                myPct: 'Sales-weighted average across the reps shown',
                autoPayPct: 'Sales-weighted average across the reps shown',
                acv: 'Total revenue ÷ total sales',
                sellingDays: 'Average days with at least one sale per rep shown',
                revPerDay: 'Total revenue ÷ total rep selling days',
                acctsPerDay: 'Total sales ÷ total rep selling days',
                avgPest: 'Sales-weighted average across reps with a value',
                avgInitial: 'Sales-weighted average across reps with a value',
                cancelPct: 'Total cancels ÷ total sales',
                attrPct: 'Cancelled $ ÷ serviced $ · excl. 3-day ROR + one-time',
                bestDayTime: 'Biggest single-rep record among the reps shown',
                bestWeekTime: 'Biggest single-rep record among the reps shown',
                bestMonthTime: 'Biggest single-rep record among the reps shown',
              };
              // Click the totals row -> the SAME player card a rep gets, fed
              // the combined sales of every rep currently shown (per Isaac).
              // Same pattern as the company-wide RIDD card on the comps
              // table; openIndicatorRepCard's own privacy gate still applies.
              const _totSales = displayReps.flatMap(r => ((r._orig || r).sales) || []);
              const _canOpenTot = _totSales.length > 0 && canViewAggregate(displayReps);
              const _openTot = () => {
                if (!_canOpenTot) return;
                const peers = displayReps
                  .map(r => ({ name: r.name, sales: ((r._orig || r).sales) || [] }))
                  .filter(p => p.sales.length);
                const _tot = _scopeRep({ name: 'Total', sales: _totSales }, () => true);
                _tot._members = displayReps.map(r => ({ name: r.name, team: r.team }));
                openIndicatorRepCard(_tot, peers);
              };
              return el('tr', {
                class: _canOpenTot ? 'cursor-pointer transition hover:brightness-95' : '',
                title: _canOpenTot ? 'Open the combined player card for every rep shown' : '',
                onclick: _canOpenTot ? _openTot : undefined,
                style: { background: 'var(--card-2)', boxShadow: 'inset 0 -2px 0 var(--border-2), inset 0 1px 0 var(--border)' } },
                el('td', { class: 'pl-5 pr-2 py-2 text-base leading-none', style: { fontFamily: 'Georgia, "Times New Roman", serif' } }, '\ud835\udd7d'),
                ...repCols.map(c => {
                  if (c.key === 'name') return el('td', { class: 'px-2 py-2' },
                    el('span', { class: 'font-black text-[11px] uppercase tracking-wider' }, 'Total'),
                    el('span', { class: 'text-[10px] text-muted- ml-1.5 normal-case tracking-normal' }, displayReps.length + ' reps'));
                  if (c.key === 'team' || c.key === 'office') return el('td', { class: 'px-2 py-2' }, '');
                  const st = { fontWeight: '700' };
                  if (c.key === 'bestDayTime') st.borderLeft = '1px solid var(--border-2)';
                  const pad = c.key === 'bestMonthTime' ? 'pl-2 pr-5' : ((c.key === 'cancelPct' || c.key === 'attrPct') ? 'pl-2 pr-5' : 'px-2');
                  return el('td', { class: pad + ' py-2 text-left tabular-nums whitespace-nowrap', style: st, title: tips[c.key] || '' },
                    vals[c.key] != null ? vals[c.key] : '—');
                }));
            })(),
            // Restore strip — one chip per hidden column for this Type.
            (isAdminRole(state.profile?.role) && state._editMode && _lbHiddenDefs.length) ? el('tr', {},
              el('th', {
                colspan: String(repCols.length + 1),
                class: 'text-left px-5 py-1.5 text-[10px] font-normal',
                style: { background: 'var(--card-2)', color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 'normal' },
              },
                el('span', { class: 'font-bold uppercase tracking-widest text-[9px] mr-2' }, 'Hidden columns:'),
                ..._lbHiddenDefs.map(c => el('button', {
                  class: 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold cursor-pointer transition hover:brightness-95 mr-1.5',
                  style: { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
                  title: 'Add \u201c' + c.label + '\u201d back to the leaderboard',
                  onclick: () => _lbSaveHidden(_lbHiddenKeys.filter(k => k !== c.key)),
                }, '+ ' + c.label)))) : null,
          ),
          el('tbody', {},
            ...(displayReps.length === 0
              ? [el('tr', {}, el('td', { class: 'px-5 py-6 text-center text-xs text-muted-', colspan: repCols.length + 1 }, 'No reps match the current filters.'))]
              : (() => {
                  // 📌 The signed-in rep's OWN row pinned first — bold, accent
                  // stripe, keeps their true board rank — then the full list.
                  const _meSig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
                  const mySig = _meSig(state.profile && state.profile.full_name);
                  let myIdx = displayReps.findIndex(r => isMyRepName(r.name));
                  if (myIdx < 0) myIdx = mySig ? displayReps.findIndex(r => _meSig(r.name) === mySig) : -1;
                  // Frozen under the sticky header + Total row (per Isaac): the
                  // rep scrolls the board and still sees themselves AND the
                  // company. `top` = the thead's live height, measured on mount.
                  const _pinTr = myIdx >= 0 ? el('tr', {
                    class: 'border-t cursor-pointer transition hover:brightness-95',
                    style: { background: 'color-mix(in srgb, var(--accent) 10%, var(--card))', boxShadow: 'inset 3px 0 0 var(--accent), inset 0 -1px 0 var(--border-2)', position: 'sticky', top: '0px', zIndex: 2 },
                    title: 'You — your live spot on the board (rank #' + (myIdx + 1) + ')',
                    onclick: () => openIndicatorRepCard(displayReps[myIdx], allReps),
                  },
                    el('td', { class: 'pl-5 pr-2 py-2 font-black tabular-nums', style: { color: 'var(--accent)' } }, '#' + (myIdx + 1)),
                    ...repCols.map(c => { const td2 = c.cell(displayReps[myIdx]); td2.style.fontWeight = '700'; return td2; }),
                  ) : null;
                  if (_pinTr) requestAnimationFrame(() => { try { const th = _pinTr.closest('table').querySelector('thead'); if (th) _pinTr.style.top = th.getBoundingClientRect().height + 'px'; } catch (e) { /* not mounted */ } });
                  const pinned = _pinTr ? [_pinTr] : [];
                  return [...pinned, ...displayReps.map((r, i) => {
                    return el('tr', {
                      'data-replb': (r.name || '').toLowerCase(),
                      class: 'border-t border- cursor-pointer transition hover:brightness-95',
                      onclick: () => openIndicatorRepCard(r._orig || r, allReps),
                    },
                      el('td', { class: 'pl-5 pr-2 py-2 font-bold tabular-nums', style: i === 0 ? { color: 'var(--accent)' } : {} }, i + 1),
                      ...repCols.map(c => c.cell(r)),
                    );
                  })];
                })()),
          ),
        ),
      ),
      // Mobile: stacked card per rep. Same data as the table, but laid out
      // top-down so it's readable on a phone without horizontal scroll.
      el('div', { class: 'sm:hidden p-3 flex flex-col gap-2' },
        // Σ Mobile Total card (per Isaac) — the desktop table's Σ Totals row
        // never made it to the stacked-card layout. Same filtered rep set,
        // same combined player card on tap. Days = average per rep.
        ...(() => {
          if (!displayReps.length) return [];
          let tCount = 0, tRev = 0, tDays = 0;
          displayReps.forEach(r => { tCount += Number(r.count) || 0; tRev += Number(r.revenue) || 0; tDays += Number(r.sellingDays) || 0; });
          const tRevPerDay = tDays > 0 ? tRev / tDays : 0;
          const tAvgDays = (tDays / displayReps.length).toFixed(1);
          const _totSales = displayReps.flatMap(r => ((r._orig || r).sales) || []);
          const _canOpenTot = _totSales.length > 0 && canViewAggregate(displayReps);
          const _openTot = () => {
            if (!_canOpenTot) return;
            const peers = displayReps
              .map(r => ({ name: r.name, sales: ((r._orig || r).sales) || [] }))
              .filter(p => p.sales.length);
            const _tot = _scopeRep({ name: 'Total', sales: _totSales }, () => true);
            _tot._members = displayReps.map(r => ({ name: r.name, team: r.team }));
            openIndicatorRepCard(_tot, peers);
          };
          return [el('div', {
            class: 'rounded-xl border px-3 py-2 flex flex-col' + (_canOpenTot ? ' cursor-pointer transition hover:brightness-95' : ''),
            style: { borderColor: 'var(--border-2)', background: 'var(--card-2)', borderLeftWidth: '3px' },
            title: _canOpenTot ? 'Open the combined player card for every rep shown' : '',
            onclick: _canOpenTot ? _openTot : undefined,
          },
            el('div', { class: 'flex items-center gap-2' },
              el('span', { class: 'font-black text-[11px] uppercase tracking-wider' }, 'Total'),
              el('span', { class: 'text-[10px] text-muted-' }, displayReps.length + ' reps'),
              el('span', { class: 'text-xl leading-none font-black tabular-nums ml-auto shrink-0' }, fmt.usd0(tRev))),
            el('div', { class: 'flex items-baseline justify-between gap-2 mt-0.5' },
              el('span', { class: 'text-[10px]' },
                el('span', { style: { color: 'var(--text-muted)' } }, 'Avg Days w/ a Sale: '),
                el('span', { class: 'font-semibold tabular-nums', title: 'Average days with at least one sale per rep shown' }, tAvgDays)),
              el('span', { class: 'shrink-0 text-[11px] text-muted-' },
                fmt.int(tCount) + ' sales' + (tRevPerDay > 0 ? ' · ' + fmt.usd0(tRevPerDay) + '/day' : ''))),
          )];
        })(),
        // 📌 Mobile: pinned "You" card first with the true rank.
        ...(() => {
          const _meSig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
          const mySig = _meSig(state.profile && state.profile.full_name);
          let myIdx = displayReps.findIndex(r => isMyRepName(r.name));
          if (myIdx < 0) myIdx = mySig ? displayReps.findIndex(r => _meSig(r.name) === mySig) : -1;
          if (myIdx < 0) return [];
          const me = displayReps[myIdx];
          return [el('div', {
            class: 'rounded-xl border px-3 py-2 flex flex-col cursor-pointer',
            style: { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.08)', borderLeftWidth: '3px' },
            onclick: () => openIndicatorRepCard(me._orig || me, allReps),
          },
            el('div', { class: 'flex items-center gap-2' },
              el('span', { class: 'font-black tabular-nums text-xs', style: { color: 'var(--accent)' } }, '#' + (myIdx + 1)),
              el('span', { class: 'font-bold truncate text-sm' }, me.name),
              el('span', { class: 'text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0', style: { background: 'var(--accent)', color: 'var(--accent-text)' } }, 'You'),
              el('span', { class: 'text-xl leading-none font-black tabular-nums ml-auto shrink-0' }, fmt.usd0(me.revenue || 0))),
            el('div', { class: 'flex items-baseline justify-between gap-2 mt-0.5' },
              el('span', { class: 'text-[11px] font-bold', style: { color: 'var(--accent)' } }, 'View my player card →'),
              el('span', { class: 'text-[11px] text-muted-' },
                fmt.int(me.count || 0) + ' sales' + (me.revPerDay > 0 ? ' · ' + fmt.usd0(me.revPerDay) + '/day' : ''))))];
        })(),
        ...(displayReps.length === 0
          ? [el('div', { class: 'text-center text-xs text-muted- italic py-6' }, 'No reps match the current filters.')]
          : (state._repLbShowAll ? displayReps : displayReps.slice(0, 10)).map((r, i) => {   // mobile: top 10 (per Isaac)
              const tierMeta = repTierMeta(r.tier);
              const teamColor = r.team ? getTeamColor(r.team) : null;
              // Multi-branch reps (per Isaac): primary office = where they
              // sold the most; extra offices show as "+N" with the split in
              // the hover — so the app's merged total is always explainable
              // against per-branch CRM tools.
              const _tcOff = (o) => (o || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
              const _offEntries = Object.entries(r.officeRev || {}).sort((a2, b2) => b2[1] - a2[1]);
              const officeName = _tcOff(_offEntries.length ? _offEntries[0][0] : r.office)
                + (_offEntries.length > 1 ? ' +' + (_offEntries.length - 1) : '');
              const officeTitle = _offEntries.length > 1
                ? 'Sold across ' + _offEntries.length + ' branches: ' + _offEntries.map(([o, v]) => _tcOff(o) + ' ' + fmt.usd0(v)).join(' · ')
                : '';
              // Inline label→value pair for the detail lines. Values keep the
              // text color; labels recede. Dot separators, no boxes — calm.
              const iv = (label, value, danger) => el('span', { class: 'whitespace-nowrap' },
                el('span', { style: { color: 'var(--text-muted)' } }, label + ' '),
                el('span', { class: 'font-semibold tabular-nums', style: danger ? { color: '#DC2626' } : {} }, value));
              const dot = () => el('span', { style: { color: 'var(--text-subtle)' } }, ' · ');
              return el('div', {
                'data-replb': (r.name || '').toLowerCase(),
                class: 'rounded-xl border px-3 py-2 flex flex-col cursor-pointer transition hover:brightness-95',
                style: {
                  borderColor: 'var(--border)',
                  borderLeftWidth: '3px',
                  borderLeftColor: teamColor || 'var(--border-2)',
                },
                onclick: () => openIndicatorRepCard(r._orig || r, allReps),
              },
                // Rank + name on the left, THE number — revenue — big on the right
                el('div', { class: 'flex items-center gap-2' },
                  el('span', { class: 'font-black tabular-nums shrink-0 text-xs', style: { color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' } }, '#' + (i + 1)),
                  el('span', { class: 'font-bold truncate text-sm' }, r.name),
                  tierMeta && el('span', {
                    class: 'text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0',
                    style: { background: tierMeta.color + '18', color: tierMeta.color },
                  }, tierMeta.label),
                  (typeof isRepActive === 'function' && !isRepActive(r.name)) && el('span', {
                    class: 'text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0',
                    style: { background: 'var(--card-2)', color: 'var(--text-muted)' },
                    title: 'No sale within 75 days of the latest sale in the dataset. Still on the board because they sold inside this range.',
                  }, 'Inactive'),
                  el('span', { class: 'text-xl leading-none font-black tabular-nums ml-auto shrink-0' }, fmt.usd0(r.revenue)),
                ),
                // Sales pace right under the revenue. (Team + office names
                // dropped — the colored left border still hints the team, and
                // multi-market office tags kept reading wrong to reps.)
                // Second line: Days w/ a Sale on the left, sales · $/day on the
                // right (per Isaac — the stat used to sit a full line lower).
                el('div', { class: 'flex items-baseline justify-between gap-2 mt-0.5' },
                  el('span', { class: 'text-[10px]' }, iv('Days w/ a Sale:', fmt.int(r.sellingDays || 0))),
                  el('span', { class: 'shrink-0 text-[11px] text-muted-' },
                    fmt.int(r.count) + ' sales' + (r.revPerDay > 0 ? ' · ' + fmt.usd0(r.revPerDay) + '/day' : '')),
                ),
              );
            }).concat(displayReps.length > 10 ? [el('button', {
              class: 'rounded-xl border px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
              style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
              onclick: (e) => { e.stopPropagation(); state._repLbShowAll = !state._repLbShowAll; mountApp(); },
            }, state._repLbShowAll ? 'Show top 10' : 'Show all ' + displayReps.length + ' reps')] : [])),
      ),
    ),
  );


  // (Group Leaderboard card retired — folded into the TOP Indicators table:
  // the Group filter now has a Department mode, a "% of Revenue" row shows
  // each column's weight, and column headers click through to the pooled
  // entity player cards. One table instead of two.)

  // Keep the legacy `reps` reference alive for downstream sections that read it
  const reps = allReps.slice().sort((a, b) => b.sales.length - a.sales.length);

  // ── 2.5 REP DETAIL — moved to a modal player card. Click a row in the
  // Rep Leaderboard above to open openIndicatorRepCard(rep).

  // D2D Comp + Aggregate Records pushed here so the trend chart and rep
  // leaderboard sit immediately under the Branch Power Ranking chart at
  // the top of the page; these comp / records cards land below them.
  // The Avg Pest Initial + Raffle mini-comps now live behind the Comps
  // selector: each shows only when its competition is the active one. With
  // Comps off, neither shows.
  if (state.indicatorsComps && getActiveComp().scoring === 'avg_pest_initial') {
    _profMark('ind:leaderboard-dom'); sections.push(buildD2DCompSection()); _profMark('ind:comps');
  }
  sections.push(buildAggregateRecordsCard()); _profMark('ind:records');
  // Rookie vs Vet lives directly under the Records card (built earlier).
  if (_tierCardSection && state.indicatorDept !== 'office') sections.push(_tierCardSection); _profMark('ind:class-metrics');

  // ── 3. (Cancel Analysis card retired — per Isaac. Reasons live in the
  // Retention tab's drills; package/office/team attrition lives in the
  // Sales Mix table below via its Attr % column and group switcher.) ──

  // ── SALES MIX (was Subscription Mix) — one table, three row dimensions:
  // Subscriptions, Offices, Teams (the Offices/Teams views absorbed from
  // the retired Cancel Analysis card; Attr % column covers the cancel-rate
  // job). Table itself lives in indicatorSubscriptionMixCard, shared with
  // the rep player cards. ──
  // (The "All offices" dropdown is gone — per Isaac. Drill in instead:
  // on the Offices or Teams view, click a row to see THAT office's / team's
  // subscription breakdown; a back chip returns to the group list.)
  const mixGroup = ['office', 'team'].includes(state._indicatorMixGroup) ? state._indicatorMixGroup : 'subscription';
  const _mixTC = (o) => String(o || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const officeKeyOf = (s) => _mixTC(s.office || 'Unknown');
  const teamKeyOf   = (s) => (typeof getRepTeam === 'function' && getRepTeam(s.rep)) || 'Unassigned';
  // Partners / team leads (per Isaac, Sep 2026): the mix is THEIR team's —
  // every view here (Subscriptions / Offices / Teams) reads from the sales
  // of the team(s) they lead, not the whole company.
  const _mixReach = (!isAdminRole(state.profile?.role)
    && ((typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role)) || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role)))
    && typeof myReachTeams === 'function') ? myReachTeams() : null;
  const _mixScoped = (_mixReach && _mixReach.size) ? rawSales.filter(s => _mixReach.has(teamKeyOf(s))) : rawSales;
  const _mixScopeLabel = (_mixReach && _mixReach.size) ? [..._mixReach].sort().join(' + ') : '';
  const drill = (state._indicatorMixDrill && state._indicatorMixDrill.group === mixGroup && mixGroup !== 'subscription')
    ? state._indicatorMixDrill : null;
  const subSales = drill
    ? _mixScoped.filter(s => (mixGroup === 'office' ? officeKeyOf(s) : teamKeyOf(s)) === drill.key)
    : _mixScoped;
  const mixGroupTabs = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...[['subscription', 'Subscriptions'], ['office', 'Offices'], ['team', 'Teams']].map(([v, l]) => el('button', {
      class: 'px-2.5 py-1 text-[11px] font-semibold transition',
      style: mixGroup === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
      onclick: () => { state._indicatorMixGroup = v; state._indicatorMixDrill = null; mountApp(); },
    }, l)));
  const groupNoun = mixGroup === 'office' ? 'Office' : mixGroup === 'team' ? 'Team' : 'Subscription';
  const _mixCardNode = indicatorSubscriptionMixCard(subSales, {
    keyOf: drill ? null : mixGroup === 'office' ? officeKeyOf : mixGroup === 'team' ? teamKeyOf : null,
    firstCol: drill ? 'Subscription' : groupNoun,
    title: drill ? 'Sales Mix \u00b7 ' + drill.key : (_mixScopeLabel ? 'Sales Mix \u00b7 ' + _mixScopeLabel : undefined),
    onRowClick: (!drill && mixGroup !== 'subscription')
      ? (name) => { state._indicatorMixDrill = { group: mixGroup, key: name }; mountApp(); }
      : null,
    rowTitle: (!drill && mixGroup !== 'subscription') ? 'Click for this ' + groupNoun.toLowerCase() + '\u2019s subscription breakdown' : '',
    headerExtra: el('div', { class: 'flex items-center gap-2 flex-wrap' },
      drill ? el('button', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => { state._indicatorMixDrill = null; mountApp(); },
      }, '\u2190 All ' + groupNoun.toLowerCase() + 's') : null,
      mixGroupTabs),
  });
  _mixCardNode.setAttribute('data-section', 'sales-mix');   // partners pick it up by this tag
  sections.push(_mixCardNode); _profMark('ind:sales-mix');

  return sections;
}

// ── Sales Mix table — shared by the Indicators page (grouped by
// Subscription / Office / Team) and the rep player cards (scoped to one
// rep's accounts). Same columns whatever the grouping: Count, % Mix,
// Revenue, ACV, Avg Init, MY %, Auto-pay, Attr %. ──
function indicatorSubscriptionMixCard(subSales, opts = {}) {
  const keyOf = opts.keyOf || ((s) => s.subscription || 'Unknown');
  const subMix = {};
  subSales.forEach(s => {
    const sub = keyOf(s);
    if (!subMix[sub]) subMix[sub] = { count: 0, revenue: 0, cancels: 0, initSum: 0, multi: 0, twelve: 0, apOn: 0 };
    const m = subMix[sub];
    m.count++;
    m.revenue += s.contractValue;
    m.initSum += Number(s.initialPrice) || 0;
    const _myb = myBucketOf(s);
    if (_myb === 'multi') m.multi++; else if (_myb === 'twelve') m.twelve++;
    if (s.autoPay && s.autoPay !== 'No') m.apOn++;
    if (typeof _isReportableCancel === 'function' ? _isReportableCancel(s) : !!s.cancelDate) m.cancels++;
  });
  const totalSubCount = subSales.length; // includes Unknown
  const topSubscriptions = Object.entries(subMix)
    .map(([name, v]) => ({
      name, ...v,
      share: totalSubCount > 0 ? v.count / totalSubCount : 0,
      acv: v.count > 0 ? v.revenue / v.count : 0,
      avgInit: v.count > 0 ? v.initSum / v.count : 0,
      attr: v.count > 0 ? v.cancels / v.count : 0,
      myPct: (v.multi + v.twelve) > 0 ? v.multi / (v.multi + v.twelve) : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Blended totals across ALL accounts (the reference row on top).
  const T = (() => {
    let _rev = 0, _init = 0, _mu = 0, _tw = 0, _ap = 0, _cx = 0;
    subSales.forEach(s => {
      _rev += s.contractValue; _init += Number(s.initialPrice) || 0;
      const _myb = myBucketOf(s);
      if (_myb === 'multi') _mu++; else if (_myb === 'twelve') _tw++;
      if (s.autoPay && s.autoPay !== 'No') _ap++;
      if (typeof _isReportableCancel === 'function' ? _isReportableCancel(s) : !!s.cancelDate) _cx++;
    });
    const _n = totalSubCount;
    return { n: _n, rev: _rev, init: _init, my: (_mu + _tw) > 0 ? _mu / (_mu + _tw) : null, ap: _ap, attr: _n > 0 ? _cx / _n : 0 };
  })();
  const attrColor = (a) => a >= 0.10 ? '#DC2626' : a >= 0.05 ? '#A9441F' : '#DF643A';
  // Metric columns — one definition drives the desktop table AND the phone
  // view, where a dropdown picks the single column to show (per Isaac).
  const COLS = [
    { key: 'share', label: '% Mix', w: 'w-14', total: () => el('div', { class: 'w-14 text-right tabular-nums font-bold shrink-0', style: { color: 'var(--accent)' } }, '100%'),
      row: (s) => el('div', { class: 'w-14 text-right tabular-nums font-bold shrink-0', style: { color: 'var(--accent)' } }, (s.share * 100).toFixed(1) + '%') },
    { key: 'revenue', label: 'Revenue', w: 'w-24', total: () => el('div', { class: 'w-24 text-right tabular-nums shrink-0 font-black' }, fmt.usd0(T.rev)),
      row: (s) => el('div', { class: 'w-24 text-right tabular-nums shrink-0 font-semibold' }, fmt.usd0(s.revenue)) },
    { key: 'acv', label: 'ACV', w: 'w-16', total: () => el('div', { class: 'w-16 text-right tabular-nums shrink-0 font-bold' }, T.n > 0 ? fmt.usd0(T.rev / T.n) : '—'),
      row: (s) => el('div', { class: 'w-16 text-right tabular-nums text-muted- shrink-0' }, s.acv > 0 ? fmt.usd0(s.acv) : '—') },
    { key: 'avgInit', label: 'Avg Init', w: 'w-16', title: 'Average initial price', total: () => el('div', { class: 'w-16 text-right tabular-nums shrink-0 font-bold' }, T.n > 0 ? fmt.usd0(T.init / T.n) : '—'),
      row: (s) => el('div', { class: 'w-16 text-right tabular-nums text-muted- shrink-0' }, s.avgInit > 0 ? fmt.usd0(s.avgInit) : '—') },
    { key: 'my', label: 'MY %', w: 'w-12', title: 'Multi-year share of contract sales', total: () => el('div', { class: 'w-12 text-right tabular-nums shrink-0 font-bold' }, T.my == null ? '—' : (T.my * 100).toFixed(0) + '%'),
      row: (s) => el('div', { class: 'w-12 text-right tabular-nums text-muted- shrink-0' }, s.myPct == null ? '—' : (s.myPct * 100).toFixed(0) + '%') },
    { key: 'apay', label: 'APay', w: 'w-14', title: 'Auto-pay share', total: () => el('div', { class: 'w-14 text-right tabular-nums shrink-0 font-bold' }, T.n > 0 ? (T.ap / T.n * 100).toFixed(0) + '%' : '—'),
      row: (s) => el('div', { class: 'w-14 text-right tabular-nums text-muted- shrink-0' }, s.count > 0 ? (s.apOn / s.count * 100).toFixed(0) + '%' : '—') },
    { key: 'attr', label: 'Attr %', w: 'w-14', title: 'Reportable cancels ÷ accounts (RORs, SNS, combined, one-time and renewals excluded)', total: () => el('div', { class: 'w-14 text-right tabular-nums font-black shrink-0', style: { color: attrColor(T.attr) } }, (T.attr * 100).toFixed(1) + '%'),
      row: (s) => el('div', { class: 'w-14 text-right tabular-nums font-semibold shrink-0', style: { color: attrColor(s.attr) } }, (s.attr * 100).toFixed(1) + '%') },
  ];
  const narrow = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
  const body = el('div');
  const paint = () => {
    const pick = narrow ? (COLS.find(c => c.key === state._mixMobileCol) || COLS[1]) : null;
    const cols = pick ? [pick] : COLS;
    // Fixed-width label column so every bar starts at the same x (per Isaac).
    const firstCol = (cls, txt, title) => el('div', { class: (narrow ? '' : 'w-[200px] sm:w-[240px]') + ' shrink-0 ' + cls, title: title || undefined, style: narrow ? { width: '112px', minWidth: '112px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : { position: 'sticky', left: '0', background: 'var(--card)', zIndex: 1 } }, txt);
    const maxShare = topSubscriptions.reduce((m, s) => Math.max(m, s.share), 0.0001);
    body.replaceChildren(el('div', { class: narrow ? '' : 'scroll-x' }, el('div', { style: narrow ? {} : { minWidth: '860px' } },
      el('div', { class: 'flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted- font-semibold pb-1.5' },
        firstCol('', opts.firstCol || 'Subscription'),
        el('div', { class: 'flex-1 text-right pr-2' }, 'Total'),
        ...cols.map(c => el('div', { class: c.w + ' text-right shrink-0', title: c.title || undefined }, c.label))),
      topSubscriptions.length === 0
        ? el('div', { class: 'text-xs text-muted- italic py-3 text-center' }, 'No accounts here.')
        : el('div', { class: 'flex flex-col' },
            el('div', { class: 'flex items-center gap-3 text-[13px] py-2.5', style: { borderBottom: '3px solid var(--text)' } },
              firstCol('truncate font-black', 'Total'),
              el('div', { class: 'flex-1 rounded-full', style: { background: 'var(--text)', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '9px' } },
                el('span', { class: 'tabular-nums font-black', style: { color: 'var(--accent)', fontSize: '11.5px', lineHeight: '1' } }, fmt.int(T.n))),
              ...cols.map(c => c.total())),
            ...topSubscriptions.map((s, i) => {
              const _pct = Math.max(1.5, s.share / maxShare * 100);
              // In-bar label only when the bar is wide enough for the digits —
              // phone bars are ~330px, so 15% clipped "1,477" (per Isaac).
              // Phones need more room per digit ("45" at ~19% still spilled, per Isaac): 22% floor, 9%/digit.
              const _inBar = narrow ? _pct >= Math.max(22, fmt.int(s.count).length * 9) : _pct >= Math.max(15, fmt.int(s.count).length * 3);
              return el('div', {
                class: 'flex items-center gap-3 text-[13px] py-2.5 transition hover:brightness-95 rounded' + (i > 0 ? ' border-t border-' : '') + (opts.onRowClick ? ' cursor-pointer' : ''),
                title: opts.rowTitle || '',
                onclick: opts.onRowClick ? () => opts.onRowClick(s.name) : undefined,
              },
                firstCol('truncate font-medium', s.name, s.name),
                el('div', { class: 'flex-1 rounded-full relative', style: { background: 'var(--card-2)', height: '22px' } },
                  el('div', { style: { width: _pct + '%', height: '100%', background: 'var(--accent)', borderRadius: '0', opacity: String(0.55 + 0.45 * (s.share / maxShare)), transition: 'width .3s', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '9px' } },
                    _inBar ? el('span', { class: 'tabular-nums font-black', style: { color: '#fff', fontSize: '11.5px', lineHeight: '1', textShadow: '0 1px 1px rgba(0,0,0,.2)' } }, fmt.int(s.count)) : null),
                  _inBar ? null : el('span', { class: 'tabular-nums font-black', style: { position: 'absolute', left: 'calc(' + _pct + '% + 8px)', top: '50%', transform: 'translateY(-50%)', color: 'var(--text)', fontSize: '11.5px', lineHeight: '1' } }, fmt.int(s.count))),
                ...cols.map(c => c.row(s)));
            })))));
  };
  paint();
  // Phone: a metric dropdown replaces the seven columns (per Isaac).
  const mobileSel = narrow ? el('select', {
    class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onchange: (e) => { state._mixMobileCol = e.target.value; paint(); },
  }, ...COLS.map(c => el('option', { value: c.key, selected: (state._mixMobileCol || 'revenue') === c.key }, c.label))) : null;

  return el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center justify-between mb-4 flex-wrap gap-3' },
        el('div', {},
          el('h3', { class: 'text-base font-bold' }, opts.title || 'Sales Mix'),
        ),
        el('div', { class: 'flex items-center gap-2 flex-wrap' }, opts.headerExtra || null, mobileSel),
      ),
      body,
    );
}

// CSV upload button
// Backend report apply — XLOOKUPs by customer_number against state.allSales/
// state.mySales and stashes the matched fields onto each sale row. The four
// known columns (subscriptions, appointments_completed, aging, subscription
// type) get parsed; anything else in the CSV is ignored for now until we
// formalize what extra signals matter. Returns { total, matched, unmatched }.
function applyBackendReport(text) {
  function parseCsvLine(line) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === ',' && !q) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  const lines = text.replace(/^﻿/, '').trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const header = parseCsvLine(lines[0]).map(norm);
  // Look up each known column by a few common spelling variants. Falls back
  // to -1 if absent — the field just doesn't get set on the sale.
  const idx = (...aliases) => {
    for (const a of aliases.map(norm)) {
      const i = header.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iCust  = idx('customer #', 'customer number', 'customer id', 'cust #', 'cust id', 'custid', 'customerno');
  const iSubs  = idx('subscriptions', '# subscriptions', 'sub count', 'subs');
  const iAppts = idx('appointments completed', 'appts completed', 'appointments', 'completed appts', 'apptscompleted');
  const iAging = idx('aging', 'age', 'days aging', 'days');
  const iType  = idx('subscription type', 'sub type', 'type');
  if (iCust === -1) throw new Error('CSV needs a customer # column to match against');

  // Build a lookup so we don't scan state.allSales N times.
  const byCust = new Map();
  for (const list of [state.mySales, state.allSales]) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      if (s.customer_number) {
        const k = String(s.customer_number).trim();
        if (!byCust.has(k)) byCust.set(k, []);
        byCust.get(k).push(s);
      }
    }
  }

  let matched = 0;
  const stamp = new Date().toISOString();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const cust = String(cols[iCust] || '').trim();
    if (!cust) continue;
    const matches = byCust.get(cust);
    if (!matches || matches.length === 0) continue;
    matched++;
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    for (const s of matches) {
      if (iSubs  !== -1) s.subscriptions          = num(cols[iSubs]);
      if (iAppts !== -1) s.appointments_completed = num(cols[iAppts]);
      if (iAging !== -1) s.aging                  = num(cols[iAging]);
      if (iType  !== -1) s.subscription_type      = (cols[iType] || '').trim() || null;
      s.backend_report_uploaded_at = stamp;
    }
  }
  return { total: lines.length - 1, matched, unmatched: (lines.length - 1) - matched };
}

function clearBackendReport() {
  for (const list of [state.mySales, state.allSales]) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      delete s.subscriptions;
      delete s.appointments_completed;
      delete s.aging;
      delete s.subscription_type;
      delete s.backend_report_uploaded_at;
    }
  }
  state.backendReportUploadedAt = null;
  state.backendReportFileName = null;
  saveDemoData();
}

// ── Manual-data mode (admin, temporary) ─────────────────────────────────
// Pin the ENTIRE Indicators tab to a CRM SalesReport CSV the admin uploads,
// instead of the synced RevHawk dataset — a side-by-side truth check while
// sync discrepancies are being reconciled. Scope is deliberately narrow:
// • THIS browser only — nothing uploads to Supabase, other users unaffected.
// • Background cloud refresh is paused while active (see the guard in
//   refreshIndicatorsFromCloud) and resumes the moment you switch back.
// • A reload quietly falls back to the synced dataset (the stamp is
//   backdated so the server copy wins on the next poll).
// CRM SalesReport exports carry no Office column, so one is synthesized per
// row from what the app already knows: each rep's majority office in the
// synced data, then the persisted rep→office map, else "UNKNOWN".
function _indManualApply(text, fname, opts) {
  const recs = _crmReconCsv(text);
  if (recs.length < 2) throw new Error('CSV has no data rows');
  const hdr = recs[0].map(h => String(h || '').trim().toLowerCase());
  const hasOffice = hdr.some(h => h.includes('office') || h.includes('branch'));
  let csvText = text;
  if (!hasOffice) {
    const iRep = hdr.findIndex(h => h.includes('sales rep') || h === 'rep');
    if (iRep < 0) throw new Error('No "Sales Rep" column found');
    const counts = {};
    const syncedSales = (state._indSyncStash && state._indSyncStash.sales) || state._indicatorRawSales || [];
    syncedSales.forEach(s => {
      const k = getCanonicalRepName(s.rep || '');
      if (!k || !s.office) return;
      (counts[k] = counts[k] || {})[s.office] = (counts[k][s.office] || 0) + 1;
    });
    const topOf = {};
    Object.entries(counts).forEach(([k, m]) => { topOf[k] = Object.entries(m).sort((x, y) => y[1] - x[1])[0][0]; });
    const esc = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const out = [recs[0].concat('Office').map(esc).join(',')];
    for (let i = 1; i < recs.length; i++) {
      const rep = getCanonicalRepName(String(recs[i][iRep] || ''));
      const office = topOf[rep] || (state._indicatorRepOffice || {})[rep] || 'UNKNOWN';
      out.push(recs[i].concat(office).map(esc).join(','));
    }
    csvText = out.join('\n');
  }
  // Stash the synced dataset ONCE so "Back to sync" is instant and lossless.
  if (!state._indManualMode) {
    state._indSyncStash = {
      data: state.indicatorsData, sales: state._indicatorRawSales,
      headers: state._indicatorRawHeaders, at: state.indicatorsUploadedAt,
      name: state.indicatorsFileName,
    };
  }
  state.indicatorsData = parseIndicatorsCsv(csvText);   // also sets _indicatorRawSales
  // NO blending with the synced dataset (per Isaac): the manual sheet is a
  // COMPLETELY separate backend dataset — what's in the CSV is what shows.
  // Columns the export doesn't carry (audit flags, lead source, initial-appt
  // status, cancel reasons) simply have no data in manual mode, so metrics
  // built on them (Audit %) read as unaudited/100% rather than borrowing
  // per-account values from the sync. The ONLY synced fact used is each
  // rep's branch, because the export has no Office column and the entire
  // tab is structured around branches.
  // Backdate the stamp so a reload lets the server copy win again — manual
  // mode is meant to die with the session, never to fight the sync.
  const _syncAt = state._indSyncStash && state._indSyncStash.at;
  state.indicatorsUploadedAt = new Date((_syncAt ? new Date(_syncAt).getTime() : Date.now()) - 1000).toISOString();
  state.indicatorsFileName = 'MANUAL — ' + (fname || 'upload.csv');
  state._indManualMode = true;
  state.indicatorsView = 'range';
  state.indicatorsRangePreset = 'this_year';
  state.indicatorsCustomStart = '';
  state.indicatorsCustomEnd = '';
  state.indicatorsWeek = -1;
  mountApp();
  // Persist the sheet so the button works as a pure toggle from now on —
  // flip to this exact upload any time without re-picking the file.
  if (!opts || !opts.noSave) {
    _idbSet('manual-sheet', { text, name: fname || 'upload.csv', savedAt: Date.now() })
      .then(ok => { if (!ok) console.warn('[ridd] manual sheet not persisted — toggle will ask for the file again after reload'); });
  }
  toast('Manual sheet ON — Indicators read ' + (fname || 'your upload') + ' (this browser). Toggle again for synced data.', 'success');
}
// The saved sheet lives in IndexedDB (multi-MB CSVs overflow localStorage),
// so one upload persists across reloads and the button becomes a pure
// on/off toggle: OFF = synced data, ON = the saved backend sheet.
function _idbKv() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('ridd-manual', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function _idbGet(k) {
  try {
    const db = await _idbKv();
    return await new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  } catch { return null; }
}
async function _idbSet(k, v) {
  try {
    const db = await _idbKv();
    await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); t.onsuccess = res; t.onerror = () => rej(t.error); });
    return true;
  } catch { return false; }
}
async function _indManualToggle(inp) {
  if (state._indManualMode) { _indManualRevert(); return; }
  const saved = await _idbGet('manual-sheet');
  if (saved && saved.text) {
    try { _indManualApply(saved.text, saved.name || 'saved sheet', { noSave: true }); return; }
    catch (e) { toast('Saved manual sheet failed to load: ' + ((e && e.message) || e) + ' — upload a fresh CSV', 'error'); }
  }
  if (inp) inp.click();
  else toast('No manual sheet saved yet — upload a CSV first', 'info');
}
function _indManualRevert() {
  const st = state._indSyncStash;
  state._indManualMode = false;
  if (st) {
    state.indicatorsData = st.data;
    state._indicatorRawSales = st.sales;
    state._indicatorRawHeaders = st.headers;
    state.indicatorsUploadedAt = st.at;
    state.indicatorsFileName = st.name;
  }
  state._indSyncStash = null;
  state.indicatorsWeek = -1;
  mountApp();
  try { refreshIndicatorsFromCloud(true); } catch { /* next poll catches up */ }
  toast('Back on synced data', 'success');
}

function csvUploadButton(size) {
  const fileInput = el('input', {
    type: 'file', accept: '.csv,.txt', style: { display: 'none' },
    onchange: (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          state.indicatorsData = parseIndicatorsCsv(ev.target.result);
          state.indicatorsWeek = -1;
          state.indicatorsUploadedAt = new Date().toISOString();
          state.indicatorsFileName = file.name || '';
          // Reset the page to YTD on every upload so the newly imported
          // data shows the full season picture. Otherwise we'd land on
          // whatever date range the user had set previously — usually a
          // single-day custom window that makes the fresh CSV look empty.
          state.indicatorsView         = 'range';
          state.indicatorsRangePreset  = 'this_year';
          state.indicatorsCustomStart  = '';
          state.indicatorsCustomEnd    = '';
          captureIndicatorSnapshot();
          saveDemoData();
          // Share this upload with every other admin — and make the outcome
          // VISIBLE. A silent sync failure means everyone else keeps
          // reading yesterday's shared copy while this browser looks fine.
          syncIndicatorsToCloud().then(r => {
            if (r?.ok) toast('Upload shared — other admins pick it up automatically', 'success');
            else {
              const why = r?.msg ? ' Reason: ' + r.msg + '.' : '';
              const hint = /bucket|not.*found|404/i.test(r?.msg || '')
                ? ' Fix: run reporting_storage.sql in the Supabase SQL Editor, then re-upload.'
                : ' Check the reporting storage bucket (reporting_storage.sql) or re-upload.';
              toast('Upload saved on THIS browser, but sharing to other admins FAILED — they will still see the previous upload.' + why + hint, 'error');
            }
          });
          logActivity('indicators_upload', { detail: (state.indicatorsFileName || 'CSV') + ' · ' + state.indicatorsData.length + ' rows' });
          toast('CSV loaded — ' + state.indicatorsData.length + ' rows', 'success');
          mountApp();
          // Compute + surface a high-level "what changed in this upload"
          // popup (trending reps, branch/team movers, broken records,
          // biggest sale). Computed AFTER mountApp so the modal lands
          // on top of the freshly rendered indicators view. Wrapped in
          // try/catch so a downstream rendering bug never blocks the
          // upload itself from succeeding.
          try {
            const insights = computeImportInsights();
            if (insights) openImportInsightsModal(insights);
          } catch (e) {
            console.warn('[ridd] import insights failed', e);
          }
        } catch (err) {
          toast('CSV parse error: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    },
  });
  return el('button', {
    class: size === 'sm'
      ? 'px-3 py-2 rounded-xl border text-xs font-medium transition hover:brightness-95'
      : 'px-5 py-3 rounded-xl text-sm font-bold transition hover:brightness-95',
    style: size === 'sm'
      ? { borderColor: 'var(--border-2)', color: 'var(--text)' }
      : { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: () => fileInput.click(),
  }, fileInput, size === 'sm' ? '📁 Upload CSV' : '📁 Upload CSV File');
}

// Parse raw CSV text — handles BOTH formats:
//   1. Raw sales report (one row per sale: Customer, Office, Date Sold, Contract, etc.)
//   2. Pre-aggregated indicators (Week, Branch, Sold Accounts, Revenue, etc.)
// ── Rep-ID auto-merge ──────────────────────────────────────────────────────
// Sales rows carry the FieldRoutes employee ID ("Sales Rep Id"). Two name
// spellings sharing one ID are the SAME person — alias the minority
// spelling(s) to the most common one automatically, through the same alias
// store manual merges use. Kills duplicate-rep bugs ("Sabbach , Jacob" vs
// "Sabbach, Jacob", "Lex" vs "Alexander") at the source, forever.
function _autoAliasByRepId(sales) {
  try {
    const byId = new Map();
    for (const s of (sales || [])) {
      const id = s && s.repId ? String(s.repId).trim() : '';
      if (!id || !s.rep) continue;
      const nm = _cleanRepName(s.rep);
      if (!nm) continue;
      let m = byId.get(id);
      if (!m) { m = new Map(); byId.set(id, m); }
      m.set(nm, (m.get(nm) || 0) + 1);
    }
    let changed = 0;
    byId.forEach((names) => {
      if (names.size < 2) return;
      const ranked = [...names.entries()].sort((a, b) => b[1] - a[1]);
      const canonical = getCanonicalRepName(ranked[0][0]);
      ranked.slice(1).forEach(([nm]) => {
        if (nm === canonical) return;
        if (!state._indicatorRepAlias) state._indicatorRepAlias = {};
        if (state._indicatorRepAlias[nm] === canonical) return;
        state._indicatorRepAlias[nm] = canonical;
        changed++;
      });
    });
    // Pass 2 — CRM-LINKED accounts. The roster groups one person's per-branch
    // employee rows (employee_ids = every branch id). Sales under ANY of
    // those ids belong to ONE human, so all their name spellings alias to a
    // single canonical — a rep selling out of Atlanta AND Destin accounts
    // (Tyler Trump) no longer splits into two contenders on comps and
    // leaderboards. Skipped silently until the roster is loaded.
    for (const e of (state.frRoster || [])) {
      const ids = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
      if (ids.length < 2) continue;
      const names = new Map();
      for (const id of ids) {
        const m = byId.get(id);
        if (m) m.forEach((n, nm) => names.set(nm, (names.get(nm) || 0) + n));
      }
      if (names.size < 2) continue;
      const ranked = [...names.entries()].sort((a, b) => b[1] - a[1]);
      const canonical = getCanonicalRepName(ranked[0][0]);
      ranked.forEach(([nm]) => {
        if (nm === canonical || getCanonicalRepName(nm) === canonical) return;
        if (!state._indicatorRepAlias) state._indicatorRepAlias = {};
        state._indicatorRepAlias[nm] = canonical;
        changed++;
      });
    }
    // Pass 3 — NAME-VARIANT accounts the roster could NOT group (different
    // emails, no linked ids — the Pere LeSueur class). Spellings whose
    // squeeze signatures intersect ("Pere LeSueur" / "Pere Le Sueur" /
    // "LeSueur, Pere") merge into the most common spelling. Order-preserving,
    // so different humans ("Aidan Smith" vs "Nadia Smith") can never fuse.
    {
      const nameCounts = new Map();
      for (const s of (sales || [])) {
        const nm = _cleanRepName(s && s.rep);
        if (nm) nameCounts.set(nm, (nameCounts.get(nm) || 0) + 1);
      }
      const keyOwner = new Map();   // squeeze sig → group representative
      const groups = new Map();     // representative → Map(name → count)
      nameCounts.forEach((n, nm) => {
        const sigs = _nameSqueezeSigs(nm);
        if (!sigs.length) return;
        let repKey = null;
        for (const sg of sigs) { if (keyOwner.has(sg)) { repKey = keyOwner.get(sg); break; } }
        if (!repKey) repKey = nm;
        sigs.forEach(sg => keyOwner.set(sg, repKey));
        let g = groups.get(repKey); if (!g) { g = new Map(); groups.set(repKey, g); }
        g.set(nm, n);
      });
      groups.forEach((names) => {
        if (names.size < 2) return;
        const ranked = [...names.entries()].sort((a, b) => b[1] - a[1]);
        const canonical = getCanonicalRepName(ranked[0][0]);
        ranked.forEach(([nm]) => {
          if (nm === canonical || getCanonicalRepName(nm) === canonical) return;
          if (!state._indicatorRepAlias) state._indicatorRepAlias = {};
          state._indicatorRepAlias[nm] = canonical;
          changed++;
        });
      });
    }
    if (changed) {
      console.info('[ridd] rep-ID auto-merge: ' + changed + ' duplicate spelling(s)/linked account(s) aliased to their canonical rep');
      if (typeof _invalidateRepSigIndex === 'function' && state._indicatorRepAlias) _invalidateRepSigIndex(state._indicatorRepAlias);
    }
  } catch (e) { console.warn('[ridd] rep-ID auto-merge failed', e); }
}

function parseIndicatorsCsv(text) {
  // Handle quoted CSV fields properly (commas inside quotes, etc.)
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }

  const lines = text.replace(/^\uFEFF/, '').trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const headerRow = parseCsvLine(lines[0]);
  const headers = headerRow.map(h => h.toLowerCase().trim());

  const findCol = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));

  // Detect format: if there's an "Office" or "Customer" column, it's raw sales
  const iOffice    = findCol('office', 'branch');
  // Customer ID and Customer Name as DISTINCT columns. The earlier `findCol`
  // matched any header containing "customer", which made an "id" column win
  // over a "name" column when both existed. Be explicit:
  const iCustId    = headers.findIndex(h => h.includes('customer id') || h.includes('cust id') || h.includes('account id') || h.includes('account number') || h.includes('account #'));
  const iCustName  = headers.findIndex((h, idx) => idx !== iCustId && h.includes('customer'));
  // Backwards-compat: keep iCustomer as a generic fallback that prefers ID
  const iCustomer  = iCustId >= 0 ? iCustId : iCustName;
  const iDateSold  = findCol('date sold');
  const iContract  = findCol('contract');
  const iInitPrice = findCol('initial service price', 'initial price');
  const iRecurring = findCol('recurring');
  const iServices  = findCol('services');
  const iContractVal = findCol('contract value');
  const iStatus    = findCol('status');
  const iAPay      = findCol('apay', 'auto pay');
  const iRep       = findCol('sales rep', 'rep');
  const iSub       = findCol('subscription');
  const iActive    = findCol('active');
  // FieldRoutes headers vary: "Cancel Reason" vs "Cancellation Reason" (and
  // the same for the date column). Match both spellings — without this the
  // reason column is silently dropped (blank everywhere in the app) and the
  // reason-based exclusions (ROR / Sold-Not-Started / Combined) can't fire.
  const iCancelR   = findCol('cancel reason', 'cancellation reason', 'cancelation reason', 'cxl reason');
  const iCancelD   = findCol('cancel date', 'cancellation date', 'cancelation date', 'cxl date', 'date cancelled', 'date canceled');
  const iAge       = findCol('age');
  const iSource    = findCol('source');
  const iCustFlags = findCol('customer flags', 'customer flag', 'flags');
  const iServicedDate = findCol('serviced date', 'date serviced', 'service date');
  const iInitialStatus = findCol('initial status');
  // FieldRoutes employee ID for the selling rep ("Sales Rep Id" — added by the
  // RevHawk snapshot). Stable identity: name spellings sharing one ID are the
  // same human. Manual CSV exports without the column parse fine (blank).
  const iRepId = headers.findIndex(h => h.includes('rep id'));
  // The selling rep's CRM employee type ("Sales Rep Type") — authoritative
  // per-sale department: no more guessing office staff into the D2D view.
  const iRepType = headers.findIndex(h => h.includes('rep type'));

  const isRawSales = iCustomer >= 0 && iDateSold >= 0 && iOffice >= 0;

  if (isRawSales) {
    return parseRawSalesReport(lines, headerRow, headers, {
      iOffice, iDateSold, iContract, iInitPrice, iContractVal, iStatus, iAPay, iRep, iRepId, iRepType, iRecurring, iServices,
      iSub, iActive, iCancelR, iCancelD, iAge, iSource, iCustName, iCustId, iCustFlags, iServicedDate, iInitialStatus
    });
  }

  // Fallback: pre-aggregated format
  if (iOffice === -1) throw new Error('No "Office" or "Branch" column found');
  return parsePreAggregated(lines, headers, iOffice);
}

function parseRawSalesReport(lines, headerRow, headers, cols) {
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }

  const parseNum = (s) => parseFloat(String(s || '').replace(/[$,%]/g, '').replace(/,/g, '').trim()) || 0;

  // Parse all sales rows
  const sales = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    let office = (c[cols.iOffice] || '').toUpperCase().trim();
    if (/^OFFICE\s*20$/.test(office)) office = 'LITTLE ROCK';   // named in the sync going forward
    if (!office) continue;
    if (/^office\s*-\s*\d/i.test(office)) continue;   // phantom CRM offices (negative IDs → "Office -1"/"Office -7") — never real branches
    const dateSold = c[cols.iDateSold] || '';
    // Parse date: "MM/DD/YY HH:MM AM/PM" or "MM/DD/YYYY"
    let dateObj = null;
    if (dateSold) {
      const parts = dateSold.split(' ')[0].split('/');
      if (parts.length === 3) {
        let [m, d, y] = parts.map(Number);
        if (y < 100) y += 2000;
        dateObj = new Date(y, m - 1, d);
      }
    }
    sales.push({
      office,
      date: dateObj,
      customer:   cols.iCustName >= 0 ? (c[cols.iCustName] || '').trim() : '',
      customerId: cols.iCustId   >= 0 ? (c[cols.iCustId]   || '').trim()
                  : (cols.iCustName >= 0 ? (c[cols.iCustName] || '').trim() : ''),
      subscription: cols.iSub >= 0 ? (c[cols.iSub] || '').trim() : '',
      active: cols.iActive >= 0 ? (c[cols.iActive] || '').trim() : '',
      cancelReason: cols.iCancelR >= 0 ? (c[cols.iCancelR] || '').trim() : '',
      cancelDate: cols.iCancelD >= 0 ? (c[cols.iCancelD] || '').trim() : '',
      age: cols.iAge >= 0 ? parseNum(c[cols.iAge]) : 0,
      source: cols.iSource >= 0 ? (c[cols.iSource] || '').trim() : '',
      contract: parseNum(c[cols.iContract]),
      initialPrice: parseNum(c[cols.iInitPrice]),
      contractValue: parseNum(c[cols.iContractVal]),
      recurring: parseNum(c[cols.iRecurring]),
      services: parseNum(c[cols.iServices]),
      status: (c[cols.iStatus] || '').trim(),
      autoPay: (c[cols.iAPay] || '').trim(),
      customerFlags: cols.iCustFlags >= 0 ? (c[cols.iCustFlags] || '').trim() : '',
      servicedDate: cols.iServicedDate >= 0 ? (c[cols.iServicedDate] || '').trim() : '',
      initialStatus: cols.iInitialStatus >= 0 ? (c[cols.iInitialStatus] || '').trim() : '',
      rep: (c[cols.iRep] || '').trim(),
      repId: cols.iRepId >= 0 ? (c[cols.iRepId] || '').trim() : '',
      repType: cols.iRepType >= 0 ? (c[cols.iRepType] || '').trim() : '',
      dateSold: dateSold,
      // Preserve the full original row + the upload's header order so the
      // raffle export can dump EVERY column the user uploaded, not just the
      // known set the parser extracts above.
      _rawRow: c.slice(),
    });
  }

  if (!sales.length) throw new Error('No valid sales rows found');

  // Same human, different spellings? The FieldRoutes employee ID settles it.
  _autoAliasByRepId(sales);

  // Note: 3-day RORs and Sold-Not-Started rows are NOT stripped here.
  // We keep them in the raw set so the Cancel Analysis card can still
  // surface them (they're useful signal for the analyst — a spike in
  // "Sold, Not Started" usually means an installer problem). Every
  // OTHER consumer filters them out at display time via the module-
  // level _isReportableCancel helper, so cancel counts on the
  // leaderboard, in rep drill-downs, in subscription mix, etc., reflect
  // only real post-service attrition.

  // Find the earliest date → week 0 start (round to Monday)
  const validDates = sales.filter(s => s.date).map(s => s.date.getTime());
  const minDate = new Date(Math.min(...validDates));
  const weekStart = new Date(minDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday start
  weekStart.setHours(0, 0, 0, 0);

  // Assign week numbers
  sales.forEach(s => {
    if (s.date) {
      s.week = Math.floor((s.date.getTime() - weekStart.getTime()) / (7 * 86400000));
    } else {
      s.week = 0;
    }
  });

  // Group by office + week and aggregate
  const groups = {};
  sales.forEach(s => {
    const key = s.office + '|' + s.week;
    if (!groups[key]) groups[key] = { office: s.office, week: s.week, sales: [] };
    groups[key].sales.push(s);
  });

  // Build indicator rows from groups
  const rows = [];
  const isSentricon = (s) => /sentricon/i.test(s.subscription || '');
  for (const g of Object.values(groups)) {
    const ss = g.sales;
    const count = ss.length;
    const revenue = ss.reduce((a, s) => a + s.contractValue, 0);
    // Avg Pest Initial — exclude any Sentricon accounts so termite installs
    // don't drag the pest figure up. Track the non-Sentricon count separately
    // so the branch + RIDD weighting uses the right denominator.
    const pestSales = ss.filter(s => !isSentricon(s));
    const avgInit = pestSales.length > 0 ? pestSales.reduce((a, s) => a + s.initialPrice, 0) / pestSales.length : 0;
    const avgInitCount = pestSales.length;
    // MY% drops Sentricon from BOTH sides (see myBucketOf). This path is
    // mirrored in netlify/lib/indicators-derive.js and diffed by
    // tools/derive-parity-test.js, so the rule is INLINED here rather than
    // read from settings - the server derive runs headless with no app
    // state. Changing the Settings list does not move these derived branch
    // rollups; it governs the live client metrics.
    const _MY_EXCL_DERIVE = /sentricon/i;
    const _myEligible = ss.filter(s => !_MY_EXCL_DERIVE.test(s.subscription || ''));
    const multiYears = _myEligible.filter(s => s.contract >= 18).length;   // multi-year (18+ mo, includes 36/60)
    const twelveMonth = _myEligible.filter(s => s.contract === 12).length; // 12 month contracts
    const autoPayCount = ss.filter(s => s.autoPay && s.autoPay !== 'No').length;
    const auditFail = ss.filter(s => /failed\s*audit/i.test(s.customerFlags || '')).length;
    const lastResort = ss.filter(s => (Number(s.initialPrice) || 0) < 99).length;
    const uniqueReps = new Set(ss.map(s => s.rep).filter(Boolean)).size;

    // Date label for this week
    const weekStartDate = new Date(weekStart.getTime() + g.week * 7 * 86400000);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * 86400000);
    const dateLabel = (weekStartDate.getMonth() + 1) + '/' + weekStartDate.getDate() + '-' +
                      (weekEndDate.getMonth() + 1) + '/' + weekEndDate.getDate();
    const isoStart = weekStartDate.toISOString().slice(0, 10);

    rows.push({
      week: g.week,
      date: dateLabel,
      iso_start: isoStart,
      branch: g.office,
      sold_accounts: count,
      revenue,
      avg_initial: avgInit,
      avg_initial_count: avgInitCount, // # of accounts the avg was computed over (Sentricon excluded)
      auto_pay_pct: count > 0 ? autoPayCount / count : 0,
      audit_fail: auditFail,
      last_resort: lastResort,
      multi_years: multiYears,
      twelve_month: twelveMonth,
      reps: uniqueReps,
    });
  }

  if (!rows.length) throw new Error('No data after aggregation');

  // Store raw sales for rep-level analytics (cancel analysis, aging, subscription mix, etc.)
  // `week` is included so we can compute true unique-rep counts per office on demand.
  // `_rawRow` + state._indicatorRawHeaders give the raffle export full passthrough
  // of every column from the upload (so admins can fact-check ticket counts
  // against the source CSV byte-for-byte).
  state._indicatorRawHeaders = headerRow.slice();
  state._indicatorRawSales = sales.map(s => ({
    customer: s.customer || '',
    customerId: s.customerId || s.customer || '',
    office: s.office,
    subscription: s.subscription || '',
    active: s.active || '',
    cancelReason: s.cancelReason || '',
    cancelDate: s.cancelDate || '',
    rep: s.rep,
    week: s.week,
    dateSold: s.dateSold || '',
    status: s.status,
    autoPay: s.autoPay,
    customerFlags: s.customerFlags || '',
    servicedDate: s.servicedDate || '',
    initialStatus: s.initialStatus || '',
    age: s.age || 0,
    source: s.source || '',
    contract: s.contract,
    initialPrice: s.initialPrice,
    contractValue: s.contractValue,
    recurring: s.recurring,
    services: s.services,
    _rawRow: s._rawRow || null,
  }));

  // Bring back any Inactive rep who sold again in this upload.
  reactivateRecentSellers();

  // Auto-sync rep → office from every CSV upload. The Manage Teams modal
  // and other views show the office for each rep; reps not in the latest
  // upload would otherwise have a blank. We compute each rep's MOST
  // FREQUENT office across the CSV (handles reps who moved between
  // offices mid-period — the latest dominant office wins) and merge into
  // the persisted rep_offices map. Existing entries are overwritten so
  // an admin always sees the freshest data; reps not in the CSV keep
  // whatever office was previously assigned.
  const repOfficeCounts = {};
  state._indicatorRawSales.forEach(s => {
    if (!s.rep || !s.office) return;
    if (!repOfficeCounts[s.rep]) repOfficeCounts[s.rep] = {};
    repOfficeCounts[s.rep][s.office] = (repOfficeCounts[s.rep][s.office] || 0) + 1;
  });
  if (!state._indicatorRepOffice) state._indicatorRepOffice = {};
  let updated = 0;
  Object.entries(repOfficeCounts).forEach(([rep, counts]) => {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top && state._indicatorRepOffice[rep] !== top) {
      state._indicatorRepOffice[rep] = top;
      updated++;
    }
  });
  if (updated > 0) {
    _invalidateRepSigIndex(state._indicatorRepOffice);
    // Fire the same persistence pipe the team/tier maps use — localStorage
    // for the local cache + Supabase mirror. Silent on success; only
    // surfaces an error toast if the upload-time sync fails.
    if (typeof saveIndicatorState === 'function') saveIndicatorState();
  }

  return rows;
}

function parsePreAggregated(lines, headers, iOffice) {
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }
  const findCol = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));
  const parseNum = (s) => parseFloat(String(s || '').replace(/[$,%]/g, '').replace(/,/g, '').trim()) || 0;
  const parsePct = (s) => { const v = parseNum(s); return v > 1 ? v / 100 : v; };

  const iWeek     = findCol('week');
  const iDate     = findCol('date');
  const iSold     = findCol('sold account', 'sold');
  const iRevenue  = findCol('revenue', 'sold revenue');
  const iAvgInit  = findCol('avg', 'initial');
  const iAutoPay  = findCol('auto pay');
  const iAppruv   = findCol('appruv');
  const iMulti    = findCol('multi');
  const iReps     = findCol('reps');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const branch = (cols[iOffice] || '').toUpperCase().trim();
    if (!branch || branch === 'RIDD') continue;
    const sold  = iSold  >= 0 ? parseNum(cols[iSold])  : 0;
    const multi = iMulti >= 0 ? parseNum(cols[iMulti]) : 0;
    rows.push({
      week:          iWeek >= 0 ? parseInt(cols[iWeek]) || 0 : 0,
      date:          iDate >= 0 ? cols[iDate] || '' : '',
      branch,
      sold_accounts: sold,
      revenue:       iRevenue >= 0 ? parseNum(cols[iRevenue]) : 0,
      avg_initial:   iAvgInit >= 0 ? parseNum(cols[iAvgInit]) : 0,
      auto_pay_pct:  iAutoPay >= 0 ? parsePct(cols[iAutoPay]) : 0,
      multi_years:   multi,
      // Pre-agg CSV doesn't have a 12-month column; back into it from total accounts
      twelve_month:  Math.max(0, sold - multi),
      reps:          iReps >= 0 ? parseNum(cols[iReps]) : 0,
    });
  }
  if (!rows.length) throw new Error('No valid data rows found');
  return rows;
}

// Chart rendering
// Track chart instances so we can destroy them before re-creating (prevents stacking)
const _chartInstances = {};

// ── Performance Trend chart ─────────────────────────────────────────────
// Plots one line per included entity (rep / team / branch / custom mix) over
// the weeks in scope. Mode:
//   • rep    — auto-pick the top 10 reps by the selected metric
//   • team   — one line per team
//   • branch — one line per branch
//   • custom — admin picks each rep from the chip row
// Metric: revenue | count | acv | avg_pest | my_pct (per-week values).
const REP_TREND_PALETTE = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
function repTrendColor(idx) { return REP_TREND_PALETTE[idx % REP_TREND_PALETTE.length]; }

function repTrendChartCard({ repsToChart, repMap, allReps, rawSales, chartBuckets, cfg }) {
  // Controls in this card (scope, compare, metric pickers) repaint ONLY this
  // card — shadow the global mountApp with a local section refresh.
  const mountApp = () => refreshIndSection('repTrend');
  // Rep accounts see a FIXED YTD window: Sunday-anchored weekly buckets from
  // Jan 1 → today (same week convention as the YoY chart), matched on the
  // sale DATE rather than the season week so the page's date filter can't
  // shrink or shift what a rep sees.
  if (!isAdminRole(state.profile && state.profile?.role)) {
    const _y = new Date().getFullYear();
    const _today = new Date(); _today.setHours(23, 59, 59, 999);
    const _anchor = new Date(_y, 0, 1); _anchor.setDate(_anchor.getDate() - _anchor.getDay());
    const _wkCount = Math.max(1, Math.floor((_today - _anchor) / 604800000) + 1);
    chartBuckets = Array.from({ length: _wkCount }, (_, i) => {
      const ws = new Date(_anchor); ws.setDate(ws.getDate() + i * 7);
      const we = new Date(ws); we.setDate(we.getDate() + 7);
      const label = (ws.getMonth() + 1) + '/' + ws.getDate();
      return {
        kind: 'week',
        key: 'ytd-wk-' + (i + 1),
        label,
        match: (s) => {
          const iso = dateSoldToIso(s.dateSold);
          if (!iso) return false;
          const d = new Date(iso + 'T00:00');
          return !isNaN(d) && d >= ws && d < we;
        },
        cumThrough: (s) => {
          const iso = dateSoldToIso(s.dateSold);
          if (!iso) return false;
          const d = new Date(iso + 'T00:00');
          return !isNaN(d) && d >= _anchor && d < we;
        },
      };
    });
  }
  const canvasId = 'chart-rep-trend';
  const canvasWrap = el('div', { style: { position: 'relative', height: '320px', width: '100%' } });
  const canvas = el('canvas', { id: canvasId });
  canvasWrap.append(canvas);

  // Build the list of "groups" (one chart line per group) based on the
  // current mode. Each group resolves to the same shape so the dataset
  // builder, click handler, and tooltip can stay agnostic about whether
  // they're plotting reps, teams, or branches.
  //   { name, kind: 'rep' | 'team' | 'branch', sales, color, repCount? }
  const titleCase = (s) => (s || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  let groups = [];
  if (cfg.mode === 'rep') {
    groups = repsToChart.map((repName, i) => {
      const rep = repMap[repName];
      if (!rep) return null;
      const team = getRepTeam(repName);
      return { name: repName, kind: 'rep', sales: rep.sales,
        color: team ? getTeamColor(team) : repTrendColor(i) };
    }).filter(Boolean);
  } else if (cfg.mode === 'custom') {
    groups = repsToChart.map((repName, i) => {
      const rep = repMap[repName];
      if (!rep) return null;
      const team = getRepTeam(repName);
      return { name: repName, kind: 'rep', sales: rep.sales,
        color: team ? getTeamColor(team) : repTrendColor(i) };
    }).filter(Boolean);
  } else if (cfg.mode === 'team') {
    // Bucket every sale by team. Excluded teams stay out of the chart so the
    // y-axis scale doesn't get warped by orgs that aren't actually selling.
    const byTeam = {};
    (rawSales || []).forEach(s => {
      const t = getRepTeam(s.rep) || 'Unassigned';
      if (isTeamExcluded(t)) return;
      (byTeam[t] = byTeam[t] || []).push(s);
    });
    groups = Object.keys(byTeam)
      .map(t => ({
        name: t, kind: 'team', sales: byTeam[t],
        color: getTeamColor(t),
        repCount: new Set(byTeam[t].map(s => s.rep).filter(Boolean)).size,
      }))
      .sort((a, b) => {
        const ar = a.sales.reduce((acc, s) => acc + (Number(s.contractValue) || 0), 0);
        const br = b.sales.reduce((acc, s) => acc + (Number(s.contractValue) || 0), 0);
        return br - ar;
      });
  } else if (cfg.mode === 'branch') {
    const byBranch = {};
    (rawSales || []).forEach(s => {
      const b = s.office;
      if (!b) return;
      (byBranch[b] = byBranch[b] || []).push(s);
    });
    groups = Object.keys(byBranch)
      .map((b, i) => ({
        name: b, kind: 'branch', sales: byBranch[b],
        color: BRANCH_COLORS[String(b).toUpperCase()] || repTrendColor(i),
        repCount: new Set(byBranch[b].map(s => s.rep).filter(Boolean)).size,
      }))
      .sort((a, b) => {
        const ar = a.sales.reduce((acc, s) => acc + (Number(s.contractValue) || 0), 0);
        const br = b.sales.reduce((acc, s) => acc + (Number(s.contractValue) || 0), 0);
        return br - ar;
      });
  }

  // Subtitle text — adapts to mode. The empty state lives in the body so the
  // header reads cleanly even when no data is plotted yet.
  const groupNoun = cfg.mode === 'team' ? 'team'
    : cfg.mode === 'branch' ? 'branch'
    : 'rep';
  const groupNounPlural = groupNoun === 'branch' ? 'branches' : groupNoun + 's';
  const grainLabel = chartBucketsGrainLabel(chartBuckets);
  const grainOne = grainLabel === 'days' ? 'day' : grainLabel === 'months' ? 'month' : 'week';
  const subtitleText = groups.length === 0
    ? (cfg.mode === 'custom' ? 'No reps picked yet — choose some below'
      : 'Nothing to chart yet')
    : (cfg.mode === 'rep' ? 'Top ' : '') + groups.length + ' ' + (groups.length === 1 ? groupNoun : groupNounPlural)
      + ' · ' + chartBuckets.length + ' ' + (chartBuckets.length === 1 ? grainOne : grainLabel);

  // Header: title + mode pills + metric dropdown
  const header = el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-3' },
    el('div', {},
      el('h3', { class: 'text-base font-bold' }, '📈 Performance Trend'),
      el('div', { class: 'text-[11px] text-muted- mt-0.5' }, subtitleText),
    ),
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      // Mode pills — switching mode keeps the metric dropdown unchanged so a
      // user comparing Revenue across reps can flip to teams/branches and
      // immediately see the same metric at the new aggregation level.
      el('div', { class: 'inline-flex rounded-xl border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
        ...[
          { id: 'rep',    label: 'Rep' },
          { id: 'team',   label: 'Team' },
          { id: 'branch', label: 'Office' },
          { id: 'custom', label: 'Custom' },
        ].map(m => el('button', {
          class: 'px-2.5 py-1 text-[11px] font-semibold transition',
          style: cfg.mode === m.id
            ? { background: 'var(--accent)', color: 'var(--accent-text)' }
            : { background: 'transparent', color: 'var(--text)' },
          onclick: () => {
            cfg.mode = m.id;
            // Switching modes invalidates the rep drill-down (the clicked rep
            // may not even be on the chart anymore). Clear it so the drill
            // panel falls back to the scope view.
            state._indicatorRepDrillDown = null;
            saveDemoData();
            mountApp();
          },
        }, m.label)),
      ),
      // Metric dropdown — match the height/padding of the mode pills so the
      // toolbar reads as one row of equal-sized controls. Browser defaults
      // make <select> taller than buttons, so we explicitly clamp height.
      el('select', {
        class: 'rounded-xl border text-[11px] font-semibold cursor-pointer bg-transparent',
        style: {
          borderColor: 'var(--border-2)',
          appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
          height: '28.5px', lineHeight: '1', boxSizing: 'border-box',
          padding: '0 1.5rem 0 0.75rem',
          backgroundImage: 'linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%)',
          backgroundPosition: 'calc(100% - 14px) 50%, calc(100% - 9px) 50%',
          backgroundSize: '5px 5px, 5px 5px',
          backgroundRepeat: 'no-repeat',
        },
        onchange: (e) => { cfg.metric = e.target.value; saveDemoData(); mountApp(); },
      },
        ...[
          { id: 'revenue',   label: 'Revenue' },
          { id: 'count',     label: 'Sales' },
          { id: 'acv',       label: 'ACV' },
          { id: 'avg_pest',  label: 'Avg Pest Initial' },
          { id: 'my_pct',    label: 'MY %' },
        ].map(m => el('option', { value: m.id, selected: cfg.metric === m.id }, m.label)),
      ),
    ),
  );

  // Custom-mode chip row — only shows in 'custom' mode. v1 picks reps only;
  // we'll extend to teams + branches once we see how it gets used.
  let chipRow = null;
  if (cfg.mode === 'custom') {
    const officeFilter = state._indicatorRepOfficeFilter;
    const eligibleReps = (officeFilter ? allReps.filter(r => r.office === officeFilter) : allReps)
      .slice().sort((a, b) => b.revenue - a.revenue);
    chipRow = el('div', { class: 'flex flex-wrap gap-1.5 mb-3 max-h-[120px] overflow-y-auto p-2 rounded-lg', style: { background: 'var(--card-2)' } },
      ...eligibleReps.map(r => {
        const isOn = cfg.selected.includes(r.name);
        return el('button', {
          class: 'rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
          style: isOn
            ? { background: 'var(--accent)', color: 'var(--accent-text)' }
            : { background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' },
          onclick: () => {
            if (isOn) cfg.selected = cfg.selected.filter(n => n !== r.name);
            else      cfg.selected = [...cfg.selected, r.name];
            saveDemoData();
            mountApp();
          },
        }, (isOn ? '✓ ' : '+ ') + r.name);
      }),
      eligibleReps.length === 0 && el('span', { class: 'text-xs text-muted- italic px-2 py-1' }, 'No reps available'),
    );
  }

  // Empty-state when nothing's plotted (custom mode with no picks).
  let body;
  if (cfg.mode === 'custom' && groups.length === 0) {
    body = el('div', { class: 'text-center text-xs text-muted- italic py-12' },
      'Click a rep above to add them to the chart.');
  } else if (groups.length === 0) {
    body = el('div', { class: 'text-center text-xs text-muted- italic py-12' },
      'No ' + groupNounPlural + ' to chart for this date range.');
  } else {
    body = canvasWrap;

    // Build the chart asynchronously (after DOM insertion)
    setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      const cvs = document.getElementById(canvasId);
      if (!cvs) return;

      // Per-rep, per-week values for the chosen metric.
      //
      // Revenue / Sales count: per-week (the value of THAT week alone).
      // ACV / Avg Pest Initial / MY %: cumulative-to-date — running average or
      // ratio across all sales the rep has made up to and including week `w`.
      // Per-week percentages are too volatile to read as a "trend" (one
      // multi-year sale = 100%, one 12-mo sale = 0%); cumulative smooths it
      // out and the value at the latest week matches the leaderboard column
      // for the same metric, which is the natural reference point.
      //
      // Avg Pest Initial uses a STRICTER exclusion than the branch table —
      // drops Sentricon, German Roach, AND Interior Flea subscriptions.
      const REP_AVG_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;
      // Same metric semantics for any group with a `.sales` array — works
      // identically for one rep, a team's combined sales, or a branch's.
      const valueFor = (group, bucket) => {
        if (cfg.metric === 'revenue') {
          const sales = group.sales.filter(bucket.match);
          return sales.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
        }
        if (cfg.metric === 'count') {
          return group.sales.filter(bucket.match).length;
        }
        // Cumulative metrics: include every sale up through the current bucket
        const through = group.sales.filter(bucket.cumThrough);
        if (through.length === 0) return 0;
        if (cfg.metric === 'avg_pest') {
          const eligible = through.filter(s => !REP_AVG_PEST_EXCLUDE.test(s.subscription || ''));
          if (eligible.length === 0) return 0;
          return eligible.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / eligible.length;
        }
        if (cfg.metric === 'my_pct') {
          const twelve = through.filter(s => myBucketOf(s) === 'twelve').length;
          const multi  = through.filter(s => myBucketOf(s) === 'multi').length;
          const total  = twelve + multi;
          return total > 0 ? multi / total : 0;
        }
        // acv (cumulative): total revenue / total sales through this bucket
        const rev = through.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
        return rev / through.length;
      };

      const datasets = groups.map(g => ({
        label: g.name,
        data: chartBuckets.map(b => valueFor(g, b)),
        borderColor: g.color,
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      }));

      // Destroy existing chart instance before re-creating
      if (_chartInstances[canvasId]) {
        _chartInstances[canvasId].destroy();
        delete _chartInstances[canvasId];
      }

      const isDark = state.theme === 'dark';
      const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
      const tickColor = isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)';

      const labels = chartBuckets.map(b => b.label);

      _chartInstances[canvasId] = new Chart(cvs.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 10, right: 16, bottom: 5, left: 5 } },
          // Click on the chart → drill into the clicked group AND filter the
          // verification table below to just that week's stats. NOTE:
          // interaction.mode is 'index' (so the tooltip lists every line at
          // the x-position), which means the `els` array passed in is also
          // index-ordered — els[0] is always the first dataset, not the one
          // the user actually clicked. Re-query with 'nearest' + xy axis so
          // the clicked line wins regardless of dataset order.
          onClick: (evt, _els, chart) => {
            const hit = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false, axis: 'xy' }, false);
            if (!hit.length) return;
            const ds = chart.data.datasets[hit[0].datasetIndex];
            const clicked = ds && ds.label;
            if (clicked) {
              if (cfg.mode === 'team') {
                state._indicatorRepDrillDown = null;
                state._indicatorTrendScope = { type: 'team', value: clicked };
              } else if (cfg.mode === 'branch') {
                state._indicatorRepDrillDown = null;
                state._indicatorTrendScope = { type: 'branch', value: clicked };
              } else {
                state._indicatorRepDrillDown = clicked;
              }
            }
            const clickedBucket = chartBuckets[hit[0].index];
            // Only set _indicatorRepChartWeek when the bucket maps cleanly to
            // a CSV week — daily/monthly buckets don't drive the verification
            // table's per-week filter.
            if (clickedBucket?.week != null) state._indicatorRepChartWeek = clickedBucket.week;
            mountApp();
          },
          onHover: (e, els) => {
            // Pointer cursor over points so it reads as clickable
            if (e?.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default';
          },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 10, font: { size: 11 }, usePointStyle: true } },
            tooltip: {
              backgroundColor: '#323230', titleFont: { size: 12 }, bodyFont: { size: 11 }, padding: 10, cornerRadius: 8,
              // Sort items so the leader is on top of the tooltip stack
              itemSort: (a, b) => b.parsed.y - a.parsed.y,
              callbacks: {
                label: (ctx) => {
                  const w = ctx.dataIndex;
                  const me = ctx.parsed.y;
                  // Rank = how many other reps have a strictly higher value at this week + 1.
                  // Ties share the same rank (skip-style: 1, 1, 3, 4...).
                  let rank = 1;
                  ctx.chart.data.datasets.forEach(ds => {
                    if (ds.data[w] > me) rank++;
                  });
                  const lbl = ctx.dataset.label;
                  const isCurrency = cfg.metric === 'revenue' || cfg.metric === 'acv' || cfg.metric === 'avg_pest' || cfg.metric === 'pra';
                  const isPct = cfg.metric === 'my_pct';
                  const formatted = isCurrency ? '$' + Math.round(me).toLocaleString()
                    : isPct ? (me * 100).toFixed(1) + '%'
                    : String(me);
                  return rank + '. ' + lbl + ': ' + formatted;
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: gridColor },
              ticks: { font: { size: 10 }, color: tickColor,
                callback: (cfg.metric === 'revenue' || cfg.metric === 'acv' || cfg.metric === 'avg_pest' || cfg.metric === 'pra')
                  ? (v => '$' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(1).replace(/\.0M?$/, '') + 'M' : Math.abs(v) >= 1000 ? Math.round(v/1000) + 'K' : v))
                  : (cfg.metric === 'my_pct'
                      ? (v => (v * 100).toFixed(0) + '%')
                      : undefined),
              },
            },
            x: { grid: { display: false }, ticks: { font: { size: 9 }, color: tickColor, maxRotation: 0 } },
          },
        },
      });
    }, 150);
  }

  // Verification table — same shape as the Rep Leaderboard but limited to the
  // reps shown on the chart, in the same order. Lets you eyeball whether the
  // chart's cumulative values line up with the rep's totals for the date
  // range. Avg Pest is included since it's not on the main leaderboard.
  //
  // If state._indicatorRepChartWeek is set (the user clicked a week on the
  // chart), every column is recomputed against ONLY that week's sales so the
  // table acts as a per-week verification view. A "show cumulative" link
  // lives in the title row to clear the filter.
  const weekFilter = state._indicatorRepChartWeek;
  const VERIFY_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;
  const statsForRep = (rep) => {
    const sales = weekFilter != null ? rep.sales.filter(s => s.week === weekFilter) : rep.sales;
    const count = sales.length;
    const revenue = sales.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    const multi  = sales.filter(s => myBucketOf(s) === 'multi').length;
    const twelve = sales.filter(s => myBucketOf(s) === 'twelve').length;
    const autoPay = sales.filter(s => s.autoPay && s.autoPay !== 'No').length;
    const cancels = sales.filter(_isReportableCancel).length;
    const eligibleForPest = sales.filter(s => !VERIFY_PEST_EXCLUDE.test(s.subscription || ''));
    const avgPest = eligibleForPest.length > 0
      ? eligibleForPest.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / eligibleForPest.length
      : 0;
    const ctTotal = twelve + multi;
    return {
      count, revenue,
      acv: count > 0 ? revenue / count : 0,
      avgPest,
      myPct: ctTotal > 0 ? multi / ctTotal : 0,
      autoPayPct: count > 0 ? autoPay / count : 0,
      cancels,
      cancelPct: count > 0 ? cancels / count : 0,
      contractTotal: ctTotal, // exposed so the per-week filter can require a minimum
    };
  };
  const weekLabel = (() => {
    if (weekFilter == null) return null;
    const row = (state.indicatorsData || []).find(r => r.week === weekFilter);
    return indicatorWeekLabel(weekFilter, { short: true }) + (row?.date ? ' · ' + row.date : '');
  })();
  const repByName = Object.fromEntries(allReps.map(r => [r.name, r]));
  const verifyHeaderCell = (label, align) => el('th', {
    class: 'px-2 py-2 text-[10px] uppercase tracking-wider text-muted- font-semibold ' + (align === 'right' ? 'text-right' : 'text-left'),
  }, label);

  // Decide which reps appear in the table.
  // - In 'custom' mode the table mirrors the user's exact picks (no re-rank).
  // - In 'rep' mode without a week filter, mirror the chart's cumulative top 10.
  // - In 'rep' mode WITH a week filter, re-rank ALL reps by the selected metric
  //   for that week — so the table answers "who actually performed in this
  //   week", not "what did the cumulative top 10 do in this week".
  // - In 'team' / 'branch' modes the per-rep verification table is skipped
  //   (the chart is aggregated, not per-rep). We'll add a parallel team /
  //   branch table on the next iteration.
  const SORT_KEY_BY_METRIC = { revenue: 'revenue', count: 'count', acv: 'acv', avg_pest: 'avgPest', my_pct: 'myPct' };
  const showRepVerifyTable = (cfg.mode === 'rep' || cfg.mode === 'custom') && repsToChart.length > 0;
  let verifyReps;
  if (cfg.mode !== 'rep' || weekFilter == null) {
    verifyReps = repsToChart;
  } else {
    // Same selection rules as the cumulative chart — see sortKeyForMetric above:
    //   avg_pest: rank by avgPest, > 5 sales gate
    //   my_pct, acv: rank by REVENUE (top earners' percentage/avg for the week)
    //   revenue, count: rank by their own metric
    const weekSortKey = (cfg.metric === 'my_pct' || cfg.metric === 'acv')
      ? 'revenue'
      : (SORT_KEY_BY_METRIC[cfg.metric] || 'revenue');
    const ranked = allReps
      .map(r => ({ name: r.name, stats: statsForRep(r) }))
      .filter(x => x.stats.count > 0) // drop reps with no activity that week
      // Avg pest needs a meaningful sample size in the same week
      .filter(x => cfg.metric !== 'avg_pest' || (x.stats.count > 5 && x.stats.avgPest > 0))
      .sort((a, b) => (b.stats[weekSortKey] || 0) - (a.stats[weekSortKey] || 0));
    verifyReps = ranked.slice(0, 10).map(x => x.name);
  }

  const verifyTable = showRepVerifyTable ? el('div', { class: 'mt-4 pt-4 border-t', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'flex items-center justify-between mb-2 gap-3 flex-wrap' },
      el('h4', { class: 'text-xs font-bold uppercase tracking-widest', style: { color: 'var(--text-muted)' } },
        cfg.mode === 'custom'
          ? 'Selected reps · stats'
          : weekFilter != null ? 'Top 10 for week · stats' : 'Top 10 · stats'),
      weekFilter != null
        ? el('div', { class: 'flex items-center gap-2' },
            el('span', { class: 'text-[10px] font-bold', style: { color: 'var(--accent)' } }, weekLabel),
            el('button', {
              class: 'text-[10px] underline cursor-pointer',
              style: { color: 'var(--text-muted)' },
              onclick: () => { state._indicatorRepChartWeek = null; mountApp(); },
            }, 'show cumulative'),
          )
        : null,
    ),
    // Desktop / tablet: full table with horizontal scroll
    el('div', { class: 'hidden sm:block scroll-x' },
      el('table', { class: 'w-full text-xs' },
        el('thead', {},
          el('tr', { class: 'border-b', style: { borderColor: 'var(--border)' } },
            verifyHeaderCell('#', 'left'),
            verifyHeaderCell('Rep', 'left'),
            verifyHeaderCell('Team', 'left'),
            verifyHeaderCell('Office', 'left'),
            verifyHeaderCell('Sales', 'right'),
            verifyHeaderCell('Revenue', 'right'),
            verifyHeaderCell('ACV', 'right'),
            verifyHeaderCell('Avg Pest', 'right'),
            verifyHeaderCell('MY %', 'right'),
            verifyHeaderCell('Auto Pay', 'right'),
            verifyHeaderCell('Cancels', 'right'),
            verifyHeaderCell('Cancel %', 'right'),
          ),
        ),
        el('tbody', {},
          ...verifyReps.map((name, i) => {
            const r = repByName[name];
            if (!r) return null;
            const tierMeta = repTierMeta(r.tier);
            const teamColor = r.team ? getTeamColor(r.team) : null;
            const s = statsForRep(r);
            return el('tr', { class: 'border-b hover:bg-card2-', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-2 py-2 font-bold tabular-nums', style: { color: 'var(--text-muted)' } }, i + 1),
              el('td', { class: 'px-2 py-2' },
                el('div', { class: 'flex items-center gap-1.5' },
                  el('span', { class: 'font-semibold' }, name),
                  tierMeta && el('span', {
                    class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                    style: { background: tierMeta.color + '22', color: tierMeta.color },
                  }, tierMeta.label),
                ),
              ),
              el('td', { class: 'px-2 py-2 font-semibold', style: teamColor ? { color: teamColor } : { color: 'var(--text-muted)' } }, r.team || '—'),
              el('td', { class: 'px-2 py-2 text-muted-' }, (r.office || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ')),
              el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.int(s.count)),
              el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold' }, fmt.usd0(s.revenue)),
              el('td', { class: 'px-2 py-2 text-right tabular-nums' }, s.count > 0 ? fmt.usd(s.acv) : '—'),
              el('td', { class: 'px-2 py-2 text-right tabular-nums' }, s.avgPest > 0 ? fmt.usd(s.avgPest) : '—'),
              el('td', { class: 'px-2 py-2 text-right tabular-nums' }, s.count > 0 ? (s.myPct * 100).toFixed(1) + '%' : '—'),
              el('td', { class: 'px-2 py-2 text-right tabular-nums' }, s.count > 0 ? (s.autoPayPct * 100).toFixed(1) + '%' : '—'),
              el('td', { class: 'px-2 py-2 text-right tabular-nums' }, s.cancels > 0 ? fmt.int(s.cancels) : '—'),
              el('td', { class: 'pl-2 pr-3 py-2 text-right tabular-nums', style: s.cancelPct > 0.1 ? { color: '#DC2626', fontWeight: '600' } : {} }, s.cancelPct > 0 ? (s.cancelPct * 100).toFixed(1) + '%' : '—'),
            );
          }).filter(Boolean),
          verifyReps.length === 0 && el('tr', {},
            el('td', { class: 'px-5 py-6 text-center text-xs text-muted- italic', colspan: 12 },
              'No rep activity in ' + (weekLabel || 'this week') + '.'),
          ),
        ),
      ),
    ),
    // Mobile: stacked card per rep — same data, vertical layout, no scroll.
    el('div', { class: 'sm:hidden flex flex-col gap-2 mt-1' },
      ...(verifyReps.length === 0
        ? [el('div', { class: 'text-center text-xs text-muted- italic py-4' },
            'No rep activity in ' + (weekLabel || 'this week') + '.')]
        : verifyReps.map((name, i) => {
            const r = repByName[name];
            if (!r) return null;
            const tierMeta = repTierMeta(r.tier);
            const teamColor = r.team ? getTeamColor(r.team) : null;
            const s = statsForRep(r);
            const officeName = (r.office || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            const stat = (label, value, danger) => el('div', { class: 'flex items-center justify-between gap-1' },
              el('span', { class: 'text-muted-' }, label),
              el('span', {
                class: 'font-bold tabular-nums',
                style: danger ? { color: '#DC2626' } : {},
              }, value),
            );
            return el('div', {
              class: 'rounded-lg border p-2.5 flex flex-col gap-1.5',
              style: { borderColor: 'var(--border)', borderLeftWidth: '4px', borderLeftColor: teamColor || 'var(--border-2)' },
            },
              el('div', { class: 'flex items-center gap-2' },
                el('span', { class: 'font-bold tabular-nums shrink-0', style: { color: 'var(--text-muted)' } }, '#' + (i + 1)),
                el('span', { class: 'font-bold truncate flex-1' }, name),
                tierMeta && el('span', {
                  class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0',
                  style: { background: tierMeta.color + '22', color: tierMeta.color },
                }, tierMeta.label),
              ),
              el('div', { class: 'text-[10px] text-muted-' },
                el('span', { style: teamColor ? { color: teamColor, fontWeight: '600' } : {} }, r.team || '—'),
                ' · ',
                officeName || '—',
              ),
              el('div', { class: 'grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] mt-1' },
                stat('Sales', fmt.int(s.count)),
                stat('Revenue', fmt.usd0(s.revenue)),
                stat('ACV', s.count > 0 ? fmt.usd(s.acv) : '—'),
                stat('Avg Pest', s.avgPest > 0 ? fmt.usd(s.avgPest) : '—'),
                stat('MY %', s.count > 0 ? (s.myPct * 100).toFixed(1) + '%' : '—'),
                stat('Auto Pay', s.count > 0 ? (s.autoPayPct * 100).toFixed(1) + '%' : '—'),
                stat('Cancels', s.cancels > 0 ? fmt.int(s.cancels) + ' (' + (s.cancelPct * 100).toFixed(1) + '%)' : '—', s.cancelPct > 0.1),
              ),
            );
          })),
    ),
  ) : null;

  // Drill-down panel — shows the rep clicked on the chart, or (when no rep is
  // selected) the same per-metric mini-charts aggregated to a chosen scope
  // (Company / Branch / Team). The scope panel is the default empty state.
  // Rep-locked mode: HARD-LOCK the drill to the signed-in rep, resolved fresh
  // from the FULL dataset on every render. The old approach seeded
  // state._indicatorRepDrillDown once per session by name-match — when that
  // stored name went stale (or the match never landed), the panel silently
  // fell back to the company-wide scope view, showing reps everyone's data
  // under a "Your Performance Trends" heading.
  const _lockedToSelf = !isAdminRole(state.profile && state.profile?.role);
  let drillRepName, drillRep;
  if (_lockedToSelf) {
    const _sigT = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const _mineT = _sigT(state.profile && state.profile.full_name);
    const _full = (state._indicatorRawSales || []).filter(s =>
      s && s.rep && frPendingServiced(s) && (isMyRepName(s.rep) || (_mineT && _sigT(getCanonicalRepName(s.rep)) === _mineT)));
    if (_full.length) {
      drillRepName = getCanonicalRepName(_full[0].rep);
      const _base = repMap[drillRepName] || {};
      drillRep = {
        ..._base,
        name: drillRepName,
        office: _base.office || _full[0].office || '',
        revenue: _full.reduce((a, s) => a + (Number(s.contractValue) || 0), 0),
        sales: _full,
      };
      state._indicatorRepDrillDown = drillRepName; // keep downstream labels coherent
    } else {
      drillRepName = null;
      drillRep = null;
      state._indicatorRepDrillDown = null; // triggers the friendly empty state
    }
  } else {
    drillRepName = state._indicatorRepDrillDown;
    drillRep = drillRepName && repMap[drillRepName] ? repMap[drillRepName] : null;
  }
  const _perfTitle = '📈 Performance Trends';
  const _trendTitleNode = () => el('h3', { class: 'text-base font-bold' }, _perfTitle);
  // Right-hand control cluster on the card's TITLE row — the Filters
  // dropdown is appended first (below), then buildTrendMiniGrid mounts the
  // metric picker + Compare toggle into it: Filters · Revenue · Compare.
  const _trendControlsHost = el('div', { class: 'flex items-center gap-2 flex-wrap justify-end', style: { marginLeft: 'auto' } });
  let drillPanel;
  if (drillRep) {
    drillPanel = repDrillPanel(drillRep, chartBuckets,
      (!isAdminRole(state.profile && state.profile?.role)) ? _trendTitleNode() : null);
  } else {
    if (!state._indicatorTrendScope) state._indicatorTrendScope = { type: 'company' };
    // Scope panel renders standalone — no rep overlay. Reps' numbers are
    // dwarfed by company totals on a shared axis, so a side-by-side line
    // visually shrinks the rep's pattern. Selected reps are still plotted
    // on the upper trend chart; this panel just shows the scope.
    drillPanel = scopeDrillPanel(state._indicatorTrendScope, rawSales || [], chartBuckets, null, { controlsInto: _trendControlsHost });
  }

  // ── Slimmed layout: the old multi-line trend chart (header / chips /
  // canvas) is gone — the mini-chart scope panel IS the section now, with
  // direct pickers for Company / Branch / Team / Rep. Compare lives inside
  // the panel as before.
  const curScope = drillRep
    ? { type: 'rep', value: drillRepName }
    : (state._indicatorTrendScope || { type: 'company' });
  const titleCase2 = (s) => (s || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const setScope = (scope, repName) => {
    state._indicatorRepDrillDown = repName || null;
    state._indicatorTrendScope = scope || { type: 'company' };
    if (!repName) state._indicatorTrendCompare = state._indicatorTrendCompare || null;
    saveDemoData();
    mountApp();
  };
  const pickerSel = (placeholder, opts, selected, onpick, title) => {
    const sel = el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
      title: title || '',
      onchange: (e) => onpick(e.target.value),
    },
      el('option', { value: '' }, placeholder),
      ...opts.map(([v, lab]) => { const o = el('option', { value: v }, lab); if (v === selected) o.selected = true; return o; }));
    return sel;
  };
  const branchesAll = [...new Set((rawSales || []).map(s => s.office).filter(Boolean))].sort();
  const teamsAll = distinctTeams().filter(t => !isTeamExcluded(t));
  const repNames = Object.keys(repMap).sort();
  const _trendRepOnly = !isAdminRole(state.profile && state.profile?.role);
  // Rep-locked: no separate header row — the card title rides the same
  // line as the metric dropdown inside the drill panel ("You" is implied,
  // so no rep name / "YTD · just you" subtitle either).
  const pickerRow = _trendRepOnly
    ? null
    : (() => {
      // Company / Team / Rep pickers live in ONE Filters dropdown now —
      // the title row stays clean, Compare + metric pin to the top right.
      const _activeN = (curScope.type !== 'company' ? 1 : 0) + (state._indicatorRepDrillDown ? 1 : 0);
      const wrap = el('div', { class: 'relative' });
      const _fLabel = (t) => el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold pb-1', style: { color: 'var(--text-subtle)' } }, t);
      const panel = el('div', {
        class: 'card absolute p-3 flex flex-col gap-2.5',
        style: { top: 'calc(100% + 6px)', left: '0', minWidth: '240px', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._trendFiltersOpen ? 'flex' : 'none' },
      },
        el('div', {}, _fLabel('Office'), pickerSel('Company', branchesAll.map(b => [b, titleCase2(b)]),
          curScope.type === 'branch' ? curScope.value : '',
          (v) => setScope(v ? { type: 'branch', value: v } : { type: 'company' }, null),
          'Company-wide, or scope the mini-charts to one branch')),
        el('div', {}, _fLabel('Team'), pickerSel('Team…', teamsAll.map(t => [t, t]),
          curScope.type === 'team' ? curScope.value : '',
          (v) => setScope(v ? { type: 'team', value: v } : { type: 'company' }, null),
          'Scope the mini-charts to one team')),
        el('div', {}, _fLabel('Rep'), pickerSel('Rep…', repNames.map(n => [n, n]),
          curScope.type === 'rep' ? curScope.value : '',
          (v) => setScope(state._indicatorTrendScope || { type: 'company' }, v || null),
          'Drill into a single rep')));
      panel.querySelectorAll('select').forEach(x => { x.classList.add('w-full'); });
      const btn = el('button', {
        class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 flex items-center gap-1.5',
        style: _activeN
          ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
          : { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Scope the charts — branch, team, or a single rep',
        onclick: (e) => {
          e.stopPropagation();
          const open = panel.style.display === 'flex';
          panel.style.display = open ? 'none' : 'flex';
          state._trendFiltersOpen = !open;
          if (!open) clampDropdownPanel(panel);
          if (!open) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
            if (wrap.contains(ev.target)) return;
            panel.style.display = 'none'; state._trendFiltersOpen = false;
            document.removeEventListener('mousedown', closer);
          }), 0);
        },
      }, 'Filters' + (_activeN ? ' · ' + _activeN : ''));
      if (state._trendFiltersOpen) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
        if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
        if (wrap.contains(ev.target)) return;
        panel.style.display = 'none'; state._trendFiltersOpen = false;
        document.removeEventListener('mousedown', closer);
      }), 0);
      wrap.append(btn, panel);
      clampDropdownPanel(panel);
      _trendControlsHost.prepend(wrap);   // Filters leads the right cluster
      return el('div', { class: 'flex items-center gap-2 flex-wrap mb-3' },
        el('h3', { class: 'text-base font-bold mr-1' }, '📈 Metric Trends'),
        _trendControlsHost);
    })();

  return el('div', { class: 'card p-5' },
    pickerRow,
    // Rep-locked mode with no matched sales yet: friendly empty state instead
    // of silently falling back to company-wide charts.
    (_trendRepOnly && !state._indicatorRepDrillDown)
      ? el('div', {},
          el('h3', { class: 'text-base font-bold mb-2' }, _perfTitle),
          el('div', { class: 'text-xs py-6 text-center', style: { color: 'var(--text-muted)' } },
            'No synced sales under your name yet — your trend charts appear as soon as your first accounts land in the sync.'))
      : drillPanel,
  );
}

// Convert "#RRGGBB" → "rgba(r,g,b,a)" so chart fills can be derived from a
// chosen accent color without committing to 8-digit hex (which Chart.js
// quietly accepts but background-color CSS doesn't always interpolate well).
function _hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return 'rgba(223,100,58,' + alpha + ')';
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ── PDF report generation ────────────────────────────────────────────────
// Lazy-loads jsPDF + html2canvas (from CDN) the first time the admin asks
// for a team report. We only load them on demand so the rest of the app
// doesn't pay the bundle-size cost on every page load.
let _pdfLibsLoadPromise = null;
function loadPdfLibsOnce() {
  if (_pdfLibsLoadPromise) return _pdfLibsLoadPromise;
  const addScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.append(s);
  });
  _pdfLibsLoadPromise = Promise.all([
    addScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'),
    addScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'),
  ]).catch(err => { _pdfLibsLoadPromise = null; throw err; });
  return _pdfLibsLoadPromise;
}

// Build a 12-bucket weekly window (or fewer if the sales data has less
// history) for the trend mini-grid. Independent of the page's current
// date filter so a manager's report always sees the same context.
function buildReportBuckets(rawSales) {
  const weeks = [...new Set((rawSales || []).map(s => s.week).filter(w => w != null))]
    .sort((a, b) => a - b);
  const last12 = weeks.slice(-12);
  return last12.map(w => ({
    key:   'wk-' + w,
    label: indicatorWeekLabel(w, { short: true }),
    week:  w,
    match: (s) => s.week === w,
  }));
}

// Renders a clean, print-friendly per-team report as a DOM element. The
// caller positions it off-screen, waits for the embedded Chart.js mini-
// grid to paint, then html2canvases the whole thing into a PDF page.
function buildTeamReportNode(teamName, ctx) {
  // The PDF now renders TWO windows on the same page — a weekly view
  // up top so the manager can see the current week's pulse, then YTD
  // at the bottom for the long-arc story. The ctx that came from the
  // caller is no longer load-bearing for body sections; we recompute
  // both windows from state._indicatorRawSales directly so the PDF
  // always shows the same two windows regardless of what filter is
  // currently active on the page.
  // Rep mode (per Isaac): the "group" is one rep — brand the page with
  // their team's logo/color when they have a team.
  const _isRepMode  = (ctx.groupMode || 'team') === 'rep';
  const _brandKey   = _isRepMode ? ((typeof getRepTeam === 'function' && getRepTeam(teamName)) || teamName) : teamName;
  const teamLogo    = getTeamLogo(_brandKey);
  const teamColor   = getTeamColor(_brandKey);
  const companyLogo = state.companyLogo || '';
  const PEST_EXCLUDE_RE = /sentricon|german\s*roach|interior\s*flea/i;
  // PENDING/SERVICED revenue (per Isaac) — the PDF used to read the raw
  // dataset ungated, so its totals ran ~2% hot vs every on-screen board.
  // indicatorSales() applies the full canonical rulebook (FR Pending/
  // Serviced gate, global service exclusions, excluded sources, deleted
  // accounts) — dept pinned to 'all' so the report covers everyone.
  const fullRawSales = (() => {
    const prevDept = state.indicatorDept;
    try { state.indicatorDept = 'all'; return indicatorSales(); }
    catch (e) { return state._indicatorRawSales || []; }
    finally { state.indicatorDept = prevDept; }
  })();
  // Group key dispatch — Team Reports walk Manage Teams (getRepTeam),
  // Branch Reports key off the office name from the upload. Keeping the
  // local variable name "team" downstream since the per-group bucket
  // shape is identical; only the keying changes.
  const groupMode = ctx.groupMode || 'team';
  const isBranch  = groupMode === 'branch';
  const isRep     = groupMode === 'rep';
  const isCompany = groupMode === 'company';   // RIDD — every sale in one group (per Isaac)
  // Rep Reports key off the canonical rep name — every rep becomes their
  // own "group", so ranks/power ranking read "#N of M reps".
  const groupKeyOf = (s) => isCompany ? 'RIDD' : isRep
    ? getCanonicalRepName(s.rep || 'Unknown')
    : isBranch
      ? (s.office || 'Unassigned')
      : (getRepTeam(getCanonicalRepName(s.rep || 'Unknown')) || 'Unassigned');

  // Aggregate raw sales inside a date range into the same shape the
  // page-level viewIndicators emits (branchData + riddTotal + rankings
  // + powerRanking). Each call returns a "window" object that the
  // section builder below can render against. The boundary dates are
  // ISO yyyy-mm-dd; we compare against the raw sales' dateSold day key.
  const computeWindow = (startIso, endIso, label) => {
    // dateSold lives in MM/DD/YY[ HH:MM] from the CSV upload, not ISO.
    // Use _parseIndicatorDay (already in the file) to land on a real
    // Date object so the bounds comparison is format-safe.
    const startDate = new Date(startIso + 'T00:00');
    const endDate   = new Date(endIso   + 'T23:59:59');
    const inWindow = fullRawSales.filter(s => {
      const d = _parseIndicatorDay(s);
      return d && d >= startDate && d <= endDate;
    });
    // Per-group aggregates. getCanonicalRepName collapses merged
    // duplicates so they don't inflate either side. groupKeyOf returns
    // either the rep's team (Teams mode) or their office (Branch mode).
    const byTeam = {};
    inWindow.forEach(s => {
      const canonical = getCanonicalRepName(s.rep || 'Unknown');
      const team = groupKeyOf(s);
      if (!byTeam[team]) byTeam[team] = {
        sold_accounts: 0, revenue: 0, twelve: 0, multi: 0, autoPay: 0,
        initial_total: 0, initial_count: 0, reps: new Set(),
      };
      const t = byTeam[team];
      t.sold_accounts++;
      t.revenue += Number(s.contractValue || 0);
      const _myb = myBucketOf(s);
      if (_myb === 'twelve') t.twelve++; else if (_myb === 'multi') t.multi++;
      if (s.autoPay && s.autoPay !== 'No') t.autoPay++;
      if (!PEST_EXCLUDE_RE.test(s.subscription || '')) {
        t.initial_total += Number(s.initialPrice || 0);
        t.initial_count++;
      }
      if (canonical) t.reps.add(canonical);
    });
    const branchData = {};
    Object.entries(byTeam).forEach(([team, t]) => {
      const sold = t.sold_accounts;
      const myDen = t.twelve + t.multi;
      branchData[team] = {
        sold_accounts: sold,
        revenue:       t.revenue,
        avg_initial:   t.initial_count > 0 ? t.initial_total / t.initial_count : 0,
        acv:           sold > 0 ? t.revenue / sold : 0,
        reps:          t.reps.size,
        pra:           t.reps.size > 0 ? t.revenue / t.reps.size : 0,
        multi_year_pct: myDen > 0 ? t.multi / myDen : 0,
        auto_pay_pct:   sold > 0 ? t.autoPay / sold : 0,
      };
    });
    // Rankings exclude the synthetic "Unassigned" bucket so it can't
    // outrank a real team just by accumulating untagged reps' sales.
    const rankedTeams = Object.keys(branchData).filter(t => t !== 'Unassigned');
    const METRICS = ['sold_accounts', 'revenue', 'avg_initial', 'acv', 'pra', 'multi_year_pct', 'auto_pay_pct'];
    const rankings = {};
    METRICS.forEach(m => {
      const sorted = rankedTeams
        .map(t => ({ branch: t, val: branchData[t][m] || 0 }))
        .sort((a, b) => b.val - a.val);
      rankings[m] = sorted.map((s, i) => ({ ...s, rank: i + 1 }));
    });
    // RIDD totals. Averages are sales-weighted; raw counts sum.
    const totalSold    = rankedTeams.reduce((a, t) => a + (branchData[t].sold_accounts || 0), 0);
    const totalRevenue = rankedTeams.reduce((a, t) => a + (branchData[t].revenue || 0), 0);
    const totalReps    = rankedTeams.reduce((a, t) => a + (branchData[t].reps || 0), 0);
    const wAvg = (key) => totalSold > 0
      ? rankedTeams.reduce((a, t) => a + (branchData[t][key] || 0) * (branchData[t].sold_accounts || 0), 0) / totalSold
      : 0;
    const riddTotal = {
      sold_accounts:  totalSold,
      revenue:        totalRevenue,
      avg_initial:    wAvg('avg_initial'),
      acv:            totalSold > 0 ? totalRevenue / totalSold : 0,
      pra:            totalReps > 0 ? totalRevenue / totalReps : 0,
      multi_year_pct: wAvg('multi_year_pct'),
      auto_pay_pct:   wAvg('auto_pay_pct'),
    };
    // Power ranking — sum of per-metric ranks, lower is better.
    const totalPoints = {};
    rankedTeams.forEach(t => {
      totalPoints[t] = METRICS.reduce((sum, m) => {
        const entry = (rankings[m] || []).find(r => r.branch === t);
        return sum + (entry?.rank || rankedTeams.length);
      }, 0);
    });
    const powerRanking = rankedTeams.slice().sort((a, b) => (totalPoints[a] || 0) - (totalPoints[b] || 0));
    return { branchData, rankings, powerRanking, riddTotal, totalRanked: rankedTeams.length, rawSales: inWindow, label };
  };

  // Build the two windows. Weekly = Sunday → today (matches the TV
  // dashboard). YTD = Jan 1 → today.
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - today.getDay());
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const weekly = computeWindow(weekStart.toISOString().slice(0, 10), todayIso, 'This Week');
  const ytd    = computeWindow(yearStart.toISOString().slice(0, 10), todayIso, 'Year to Date');

  // Team Ranks at the bottom shows YTD — full season picture of every
  // rep on this team (or in this branch). In Teams mode we also surface
  // any rep assigned to the team via Manage Teams who happened to write
  // zero in the YTD window, so the manager sees who isn't producing at
  // all. Branch mode doesn't have an equivalent roster — every rep tied
  // to that office shows up via their sales.
  const teamSales = ytd.rawSales.filter(s => groupKeyOf(s) === teamName);
  const teamRepNames = new Set([
    ...teamSales.map(s => s.rep).filter(Boolean),
    ...((isBranch || isRep) ? [] : Object.entries(state._indicatorRepTeam || {})
      .filter(([_, t]) => t === teamName)
      .map(([rep]) => rep)),
  ]);
  const teamRepsFull = [...teamRepNames].map(name => {
    const repSales = teamSales.filter(s => s.rep === name);
    const count = repSales.length;
    const revenue = repSales.reduce((a, s) => a + Number(s.contractValue || 0), 0);
    const twelve  = repSales.filter(s => myBucketOf(s) === 'twelve').length;
    const multi   = repSales.filter(s => myBucketOf(s) === 'multi').length;
    const autoPay = repSales.filter(s => s.autoPay && s.autoPay !== 'No').length;
    const cancels = repSales.filter(_isReportableCancel).length;
    const rors    = repSales.filter(_is3DayROR).length;
    const sns     = repSales.filter(_isSoldNotStarted).length;
    const pestEligible = repSales.filter(s => !PEST_EXCLUDE_RE.test(s.subscription || ''));
    return {
      name,
      tier: getRepTier(name),
      sold:       count,
      revenue,
      acv:        count > 0 ? revenue / count : 0,
      avgPest:    pestEligible.length > 0 ? pestEligible.reduce((a, s) => a + Number(s.initialPrice || 0), 0) / pestEligible.length : 0,
      avgInitial: count > 0 ? repSales.reduce((a, s) => a + Number(s.initialPrice || 0), 0) / count : 0,
      myPct:      (twelve + multi) > 0 ? multi / (twelve + multi) : 0,
      autoPayPct: count > 0 ? autoPay / count : 0,
      cancels,
      rors,
      sns,
      cancelPct:  count > 0 ? cancels / count : 0,
    };
  });
  // Sort by sales count (matches the Indicators rep leaderboard's default).
  teamRepsFull.sort((a, b) => b.sold - a.sold || b.revenue - a.revenue);

  // Stats grid + ranking lookups read from the YTD window — same season
  // view that drives the power banner above. Fallback to empty object so
  // a team that exists in the page filter but had zero YTD sales still
  // renders the card (with dashes/zeros) instead of crashing.
  const teamD     = ytd.branchData[teamName] || {};
  const rankings  = ytd.rankings || {};
  const rankOf = (key) => (rankings[key] || []).find(r => r.branch === teamName)?.rank;

  // Page wrapper — sized to letter at 96dpi minus 0.5" margins so the
  // html2canvas output drops into a single jsPDF page without scaling.
  const wrap = el('div', {
    style: {
      width: '816px', minHeight: '1056px',
      padding: '40px',
      background: '#fff', color: '#323230',
      fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif',
      boxSizing: 'border-box',
    },
  });

  // Header — company branding on the left, team logo on the right.
  const header = el('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: '20px', paddingBottom: '16px',
      borderBottom: '3px solid ' + teamColor,
    },
  },
    el('div', {},
      companyLogo
        ? el('img', { src: companyLogo, alt: 'RIDD', style: { height: '48px', display: 'block', marginBottom: '6px' } })
        : el('div', { style: { fontSize: '28px', fontWeight: '900', color: '#DF643A', letterSpacing: '-0.02em' } }, 'RIDD'),
      el('div', { style: { fontSize: '10px', fontWeight: '700', letterSpacing: '0.18em', color: '#666' } }, 'SERVICE ABOVE ALL'),
    ),
    teamLogo
      ? el('img', { src: teamLogo, alt: teamName, style: { height: '72px', width: '72px', borderRadius: '0', objectFit: 'cover', border: '2px solid ' + teamColor, background: '#fff' } })
      : el('div', { style: { width: '72px', height: '72px', borderRadius: '0', background: teamColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: '900' } }, teamName.slice(0, 1).toUpperCase()),
  );

  // Title block — team name in its color + window label.
  const title = el('div', { style: { marginBottom: '18px' } },
    el('div', { style: { fontSize: '36px', fontWeight: '900', letterSpacing: '-0.01em', color: teamColor, lineHeight: '1' } }, teamName.toUpperCase()),
    el('div', { style: { fontSize: '12px', color: '#666', marginTop: '6px', fontWeight: '600' } },
      'Performance Report' + (ctx.windowLabel ? ' · ' + ctx.windowLabel : '') + ' · ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })),
  );

  // Power Rank banner — the single number the manager will look at first.
  // Rank against the YTD window so the headline reflects the season, not
  // a single noisy week. ytd.powerRanking is already sorted best→worst.
  const teamRank = ytd.powerRanking.indexOf(teamName) >= 0
    ? ytd.powerRanking.indexOf(teamName) + 1
    : null;
  const totalRanked = ytd.totalRanked;
  const powerBanner = el('div', {
    style: {
      padding: '14px 18px', background: '#323230', color: '#fff',
      borderRadius: '0', marginBottom: '18px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    },
  },
    el('div', {},
      el('div', { style: { fontSize: '11px', fontWeight: '800', letterSpacing: '0.18em' } }, 'POWER RANKING'),
      el('div', { style: { fontSize: '10px', opacity: '0.6', marginTop: '2px' } }, 'Sum of per-metric ranks · 1 = best'),
    ),
    el('div', { style: { fontSize: '36px', fontWeight: '900', color: teamRank === 1 ? '#DF643A' : '#fff', lineHeight: '1' } },
      teamRank ? '#' + teamRank + ' of ' + totalRanked : '—'),
  );

  // 4×2 stats grid — same metrics that drive the by-team table, plus
  // each tile's rank vs the other teams so the manager sees where they
  // win and where they're slipping at a glance.
  const stat = (label, value, rank) => el('div', {
    style: {
      padding: '12px 14px', background: '#F7F8F6',
      border: '1px solid #E5E5E0', borderRadius: '0',
    },
  },
    el('div', { style: { fontSize: '10px', fontWeight: '800', color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' } }, label),
    el('div', { style: { fontSize: '22px', fontWeight: '900', marginTop: '4px', color: '#323230' } }, value),
    rank != null && el('div', { style: { fontSize: '10px', fontWeight: '700', color: rank === 1 ? '#DF643A' : rank <= 3 ? '#DF643A' : '#888', marginTop: '4px' } },
      'Rank #' + rank + ' of ' + totalRanked),
  );
  const stats = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '20px' },
  },
    stat('Subscriptions',  fmt.int(teamD.sold_accounts || 0),                      rankOf('sold_accounts')),
    stat('D2D Revenue',    fmt.usd0(teamD.revenue || 0),                           rankOf('revenue')),
    stat('Avg Pest Initial', fmt.usd0(teamD.avg_initial || 0),                     rankOf('avg_initial')),
    stat('ACV',            fmt.usd0(teamD.acv || 0),                               rankOf('acv')),
    stat('PRA',            fmt.usd0(teamD.pra || 0),                               rankOf('pra')),
    stat('Multi-Year %',   ((teamD.multi_year_pct || 0) * 100).toFixed(1) + '%',   rankOf('multi_year_pct')),
    stat('Auto-Pay %',     ((teamD.auto_pay_pct || 0) * 100).toFixed(1) + '%',     rankOf('auto_pay_pct')),
    stat('Reps W/ Sale',   fmt.int(teamD.reps || 0),                               null),
  );

  // ── Performance Scorecard ──
  // For each of the 7 power-ranking metrics, a horizontal bar shows where
  // this team sits among all teams (full bar = best rank, near-empty =
  // worst). Color codes the bar so winners + focus areas read at a
  // glance: green = top 3, amber = middle, red = bottom 3.
  const scorecardHeader = el('div', { style: { fontSize: '13px', fontWeight: '800', letterSpacing: '0.06em', color: '#323230', margin: '8px 0 10px 0', textTransform: 'uppercase' } }, 'Performance Scorecard');

  const buildScorecardRow = (key, label, fmtter) => {
    const rank = rankOf(key);
    const teamVal = (teamD[key] != null ? teamD[key] : 0);
    // Filled bar pct: rank 1 → 100%, rank N → 100/N%
    const fillPct = rank ? ((totalRanked - rank + 1) / totalRanked) * 100 : 0;
    // Color buckets: top 3 green, bottom 3 red, middle amber
    const isStrong = rank && rank <= Math.min(3, Math.floor(totalRanked / 2));
    const isWeak   = rank && rank >  Math.max(totalRanked - 3, Math.ceil(totalRanked / 2));
    const barColor = isStrong ? '#DF643A' : isWeak ? '#DC2626' : '#A9441F';
    return el('div', { style: { marginBottom: '10px' } },
      // Top row: label + value on left, rank badge on right.
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' } },
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: '0' } },
          el('span', { style: { fontSize: '11px', fontWeight: '800', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#323230' } }, label),
          el('span', { style: { fontSize: '11px', fontWeight: '700', color: '#323230' } }, fmtter(teamVal)),
        ),
        el('span', { style: { fontSize: '12px', fontWeight: '900', color: barColor, whiteSpace: 'nowrap' } },
          rank ? '#' + rank + ' of ' + totalRanked : '—'),
      ),
      // Progress bar: filled portion = team's relative position (1 = best)
      el('div', { style: { background: '#EAEAE4', height: '10px', borderRadius: '0', overflow: 'hidden' } },
        el('div', { style: { width: fillPct.toFixed(1) + '%', height: '100%', background: barColor, borderRadius: '0' } }),
      ),
    );
  };

  const scorecard = el('div', { style: { marginBottom: '18px' } },
    buildScorecardRow('sold_accounts',  'Subscriptions',    v => fmt.int(v)),
    buildScorecardRow('revenue',        'D2D Revenue',      v => fmt.usd0(v)),
    buildScorecardRow('avg_initial',    'Avg Pest Initial', v => fmt.usd0(v)),
    buildScorecardRow('acv',            'ACV',              v => fmt.usd0(v)),
    buildScorecardRow('pra',            'PRA',              v => fmt.usd0(v)),
    buildScorecardRow('multi_year_pct', 'Multi-Year %',     v => (v * 100).toFixed(1) + '%'),
    buildScorecardRow('auto_pay_pct',   'Auto-Pay %',       v => (v * 100).toFixed(1) + '%'),
  );

  // ── Rookie vs Vet (this team only) ──
  // Same cohort split from the Indicators tab, scoped to this team's
  // reps + windowed sales. Hidden when neither tier has any reps so the
  // PDF doesn't carry a useless empty box.
  const teamRookies = [];
  const teamVets    = [];
  teamRepsFull.forEach(r => {
    if (r.tier === 'rookie') teamRookies.push(r);
    else if (r.tier === 'vet') teamVets.push(r);
  });
  const cohortStats = (reps) => {
    const sold    = reps.reduce((a, r) => a + r.sold, 0);
    const revenue = reps.reduce((a, r) => a + r.revenue, 0);
    return {
      reps: reps.length,
      sold,
      revenue,
      pra: reps.length > 0 ? revenue / reps.length : 0,
      acv: sold > 0 ? revenue / sold : 0,
    };
  };
  const rookieStats = cohortStats(teamRookies);
  const vetStats    = cohortStats(teamVets);
  const showCohort  = !isRep && (rookieStats.reps + vetStats.reps) > 0;   // one rep isn't a cohort

  const cohortHeader = showCohort
    ? el('div', { style: { fontSize: '13px', fontWeight: '800', letterSpacing: '0.06em', color: '#323230', margin: '8px 0 8px 0', textTransform: 'uppercase' } }, 'Rookie vs Vet · This ' + (isBranch ? 'Branch' : 'Team'))
    : null;
  const cohortColumn = (label, color, s) => {
    const line = (lbl, val) => el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '11px' } },
      el('span', { style: { color: '#666', fontWeight: '600' } }, lbl),
      el('span', { style: { color: '#323230', fontWeight: '700', fontVariantNumeric: 'tabular-nums' } }, val),
    );
    return el('div', { style: { flex: '1', padding: '10px 14px', background: '#F7F8F6', border: '1px solid #E5E5E0', borderRadius: '0' } },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', paddingBottom: '6px', borderBottom: '1px solid #E5E5E0' } },
        el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block' } }),
        el('span', { style: { fontSize: '11px', fontWeight: '900', letterSpacing: '0.1em', color: color, textTransform: 'uppercase' } }, label),
        el('span', { style: { marginLeft: 'auto', fontSize: '10px', color: '#888', fontWeight: '700' } }, s.reps + ' rep' + (s.reps === 1 ? '' : 's')),
      ),
      line('Sold',    fmt.int(s.sold)),
      line('Revenue', fmt.usd0(s.revenue)),
      line('PRA',     fmt.usd0(s.pra)),
      line('ACV',     fmt.usd0(s.acv)),
    );
  };
  const cohort = showCohort
    ? el('div', { style: { display: 'flex', gap: '10px', marginBottom: '18px' } },
        cohortColumn('Rookie', '#5F6C5B', rookieStats),
        cohortColumn('Vet',    '#DF643A', vetStats),
      )
    : null;

  // ── Team Ranks ──
  // Every rep on the team, ranked by sales count (same default sort as
  // the Indicators rep leaderboard). Includes the leaderboard's full
  // metric set so a manager opens the PDF and sees exactly what they'd
  // see on the page, with each rep's intra-team rank in the leftmost
  // column. Reps with zero sales in the window land at the bottom.
  const repsHeader = el('div', {
    style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '14px 0 6px 0' },
  },
    el('div', { style: { fontSize: '13px', fontWeight: '800', letterSpacing: '0.06em', color: '#323230', textTransform: 'uppercase' } }, isRep ? 'Rep Breakdown' : isBranch ? 'Branch Ranks' : 'Team Ranks'),
    el('div', { style: { fontSize: '10px', color: '#888', fontWeight: '600' } },
      teamRepsFull.length + ' rep' + (teamRepsFull.length === 1 ? '' : 's') + ' · sorted by sales'),
  );
  const th = (label, align) => el('th', {
    style: {
      padding: '7px 6px',
      textAlign: align || 'left',
      fontWeight: '700', letterSpacing: '0.05em',
      fontSize: '9px', textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    },
  }, label);
  const td = (content, align, opts = {}) => el('td', {
    style: {
      padding: '5px 6px',
      textAlign: align || 'left',
      fontSize: '10px',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      ...(opts.style || {}),
    },
  }, content);
  const repsTable = el('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } },
    // Explicit column widths so the wide metric set lays out cleanly
    // inside the 736px content area of the PDF page.
    el('colgroup', {},
      el('col', { style: { width: '26px' } }),   // #
      el('col', { style: { width: '138px' } }),  // Rep
      el('col', { style: { width: '50px' } }),   // Tier
      el('col', { style: { width: '44px' } }),   // Sold
      el('col', { style: { width: '72px' } }),   // Revenue
      el('col', { style: { width: '54px' } }),   // ACV
      el('col', { style: { width: '58px' } }),   // Avg Pest
      el('col', { style: { width: '44px' } }),   // MY %
      el('col', { style: { width: '44px' } }),   // AP %
      el('col', { style: { width: '44px' } }),   // Cancel
      el('col', { style: { width: '48px' } }),   // 3-Day ROR
      el('col', { style: { width: '56px' } }),   // Sold Not Started
    ),
    el('thead', {},
      el('tr', { style: { background: '#323230', color: '#fff' } },
        th('#'),
        th('Rep'),
        th('Tier'),
        th('Sold', 'right'),
        th('Revenue', 'right'),
        th('ACV', 'right'),
        th('Avg Pest', 'right'),
        th('MY %', 'right'),
        th('AP %', 'right'),
        th('Cncl', 'right'),
        th('3d ROR', 'right'),
        th('Not Strt', 'right'),
      ),
    ),
    el('tbody', {},
      teamRepsFull.length === 0
        ? el('tr', {}, el('td', { colspan: 12, style: { padding: '14px', textAlign: 'center', color: '#888', fontStyle: 'italic', fontSize: '11px' } }, 'No reps on this team'))
        : teamRepsFull.map((r, i) => {
            const tierLabel = r.tier === 'rookie' ? 'Rookie' : r.tier === 'vet' ? 'Vet' : '—';
            const tierColor = r.tier === 'rookie' ? '#5F6C5B' : r.tier === 'vet' ? '#DF643A' : '#999';
            const noSales   = r.sold === 0;
            const rowBg     = i % 2 === 0 ? '#FFFFFF' : '#FAFAF7';
            return el('tr', { style: { borderBottom: '1px solid #EAEAE4', background: rowBg, opacity: noSales ? '0.5' : '1' } },
              td((i + 1).toString(), 'left', { style: { fontWeight: '800', color: i === 0 ? '#DF643A' : '#323230' } }),
              td(r.name, 'left', { style: { fontWeight: '600', whiteSpace: 'normal', wordBreak: 'break-word' } }),
              td(tierLabel, 'left', { style: { fontWeight: '700', color: tierColor } }),
              td(fmt.int(r.sold),                       'right'),
              td(fmt.usd0(r.revenue),                   'right', { style: { fontWeight: '700' } }),
              td(r.acv     > 0 ? fmt.usd0(r.acv)     : '—', 'right'),
              td(r.avgPest > 0 ? fmt.usd0(r.avgPest) : '—', 'right'),
              td(r.sold    > 0 ? (r.myPct      * 100).toFixed(0) + '%' : '—', 'right'),
              td(r.sold    > 0 ? (r.autoPayPct * 100).toFixed(0) + '%' : '—', 'right'),
              td(r.cancels > 0 ? fmt.int(r.cancels) : '—', 'right',
                { style: { color: r.cancels > 0 ? '#DC2626' : '#323230', fontWeight: r.cancels > 0 ? '700' : '400' } }),
              td(r.rors > 0 ? fmt.int(r.rors) : '—', 'right',
                { style: { color: r.rors > 0 ? '#A9441F' : '#323230', fontWeight: r.rors > 0 ? '700' : '400' } }),
              td(r.sns > 0 ? fmt.int(r.sns) : '—', 'right',
                { style: { color: r.sns > 0 ? '#A9441F' : '#323230', fontWeight: r.sns > 0 ? '700' : '400' } }),
            );
          }),
    ),
  );

  // Footer with a thin divider.
  const footer = el('div', {
    style: {
      marginTop: '20px', paddingTop: '12px', borderTop: '1px solid #E5E5E0',
      display: 'flex', justifyContent: 'space-between',
      fontSize: '9px', color: '#888', letterSpacing: '0.04em',
    },
  },
    el('div', {}, 'Generated by RIDD Sales App'),
    el('div', {}, new Date().toISOString().slice(0, 10)),
  );

  // Cohort section is conditional — skip both header + grid when no
  // tagged reps in the window so we don't ship an empty box.
  const children = [header, title, stats, scorecardHeader, scorecard];
  if (cohortHeader && cohort) children.push(cohortHeader, cohort);
  children.push(repsHeader, repsTable, footer);
  wrap.append(...children);
  return wrap;
}

// Generates the PDF for one team. Lazy-loads jsPDF + html2canvas, builds
// the report DOM off-screen, waits for the mini-grid charts to paint,
// then captures + saves.
async function downloadTeamPdf(teamName, ctx) {
  try {
    await loadPdfLibsOnce();
  } catch {
    toast('Could not load PDF libraries — check your connection', 'error');
    return;
  }
  const reportEl = buildTeamReportNode(teamName, ctx);
  // Position off-screen but in-flow so Chart.js sees real dimensions.
  reportEl.style.position = 'fixed';
  reportEl.style.left     = '-99999px';
  reportEl.style.top      = '0';
  reportEl.style.zIndex   = '-1';
  document.body.append(reportEl);
  // Give Chart.js its setTimeout(0) + animation frame to render.
  await new Promise(r => setTimeout(r, 900));
  try {
    const canvas = await html2canvas(reportEl, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 18; // 0.25" at 72dpi
    // The report is authored as a single letter page (816×1056). Scale the
    // capture to fit one page so nothing — especially the footer — gets
    // sliced across a page seam. If a tall team pushes it over, it shrinks
    // to fit rather than spilling a near-empty second page.
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2;
    let imgW = usableW;
    let imgH = (canvas.height * imgW) / canvas.width;
    if (imgH > usableH) {
      imgH = usableH;
      imgW = (canvas.width * imgH) / canvas.height;
    }
    const x = margin + (usableW - imgW) / 2; // center if narrowed to fit height
    pdf.addImage(imgData, 'PNG', x, margin, imgW, imgH);
    const safeName = teamName.replace(/[^a-zA-Z0-9_-]+/g, '_');
    pdf.save('RIDD-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.pdf');
    toast('Downloaded ' + teamName + ' report', 'success');
  } catch (err) {
    console.error('[ridd] PDF generation failed', err);
    toast('Failed to generate PDF: ' + (err.message || 'unknown'), 'error');
  } finally {
    reportEl.remove();
  }
}

// ONE PDF for every team / office (per Isaac) — one page per group in the
// same document, instead of firing N separate downloads.
async function downloadCombinedTeamPdf(names, ctx, onProgress) {
  try {
    await loadPdfLibsOnce();
  } catch {
    toast('Could not load PDF libraries — check your connection', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const usableW = pageW - margin * 2, usableH = pageH - margin * 2;
  let pages = 0;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (onProgress) onProgress(name, i, names.length);
    const reportEl = buildTeamReportNode(name, ctx);
    reportEl.style.position = 'fixed'; reportEl.style.left = '-99999px'; reportEl.style.top = '0'; reportEl.style.zIndex = '-1';
    document.body.append(reportEl);
    await new Promise(r => setTimeout(r, 900));   // Chart.js needs a frame
    try {
      const canvas = await html2canvas(reportEl, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true });
      let imgW = usableW, imgH = (canvas.height * imgW) / canvas.width;
      if (imgH > usableH) { imgH = usableH; imgW = (canvas.width * imgH) / canvas.height; }
      if (pages > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (usableW - imgW) / 2, margin, imgW, imgH);
      pages++;
    } catch (err) {
      console.error('[ridd] combined PDF page failed for ' + name, err);
    } finally {
      reportEl.remove();
    }
  }
  if (!pages) { toast('Nothing to export', 'warn'); return; }
  const noun = (ctx.groupMode === 'branch') ? 'Offices' : 'Teams';
  pdf.save('RIDD-' + noun + '-' + new Date().toISOString().slice(0, 10) + '.pdf');
  toast('Downloaded ' + noun + ' report (' + pages + ' page' + (pages === 1 ? '' : 's') + ')', 'success');
}

// Sales leaderboard PDF — admin-facing one-pager. Two tables: Top 15
// Overall (any tier) and Top 15 Rookies, both ranked by revenue.
// Column-leading cells get a green accent so the manager can scan
// "who's #1 in ACV?" / "who's pricing pest highest?" in a glance.
function buildRookieVetReportNode(allReps, opts = {}) {
  const limitOverall = opts.limitOverall ?? 15;
  const limitRookie  = opts.limitRookie  ?? 15;

  // Filter to Manage-Teams Active reps only — the leaderboard already
  // hides inactives, this report should match what's on screen.
  const active = (allReps || []).filter(r => isRepActive(r.name));
  const sortByRevenue = (a, b) => (b.revenue || 0) - (a.revenue || 0);
  const overall = active.slice().sort(sortByRevenue).slice(0, limitOverall);
  const rookies = active.filter(r => r.tier === 'rookie').sort(sortByRevenue).slice(0, limitRookie);

  const companyLogo = state.companyLogo || '';
  const titleCase = (s) => (s || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const pctOrDash = (v) => (v > 0 ? (v * 100).toFixed(1) + '%' : '—');
  const usdOrDash = (v) => (v > 0 ? fmt.usd(v) : '—');
  // Record cells carry WHEN the record happened on a tiny second line so
  // the printed sheet can be referenced without opening the app. 7.5px +
  // gray keeps the 14-column layout from feeling crammed.
  const recWhen = {
    day:   (r) => { const p = (r.bestDayDate || '').split('/'); return p.length === 3 ? p[0].replace(/^0/, '') + '/' + p[1].replace(/^0/, '') + '/' + p[2].slice(-2) : (r.bestDayDate || ''); },
    week:  (r) => { if (!r.bestWeekStart) return ''; const d = new Date(r.bestWeekStart + 'T00:00'); return isNaN(d) ? '' : 'wk of ' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(-2); },
    month: (r) => { if (!r.bestMonthKey) return ''; const d = new Date(r.bestMonthKey + '-01T00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', ' ’'); },
  };

  // Page wrapper — US letter LANDSCAPE at 96 dpi. The 14-column table
  // needs the wider page to breathe; portrait was forcing the rep /
  // team / office columns to squeeze. Top padding kept tight so the
  // two-table report still fits on a single sheet.
  const page = el('div', {
    style: {
      width: '1220px',
      padding: '6px 8px 8px',
      background: '#fff', color: '#323230',
      fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif',
      boxSizing: 'border-box',
    },
  });

  // Header strip — logo + title + generation date.
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  page.append(
    el('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '14px', borderBottom: '2px solid #DF643A', paddingBottom: '4px', marginBottom: '6px',
      },
    },
      // Title hard-left so it lines up with the leaderboard's left edge;
      // logo + date live on the right side of the header strip.
      el('div', {},
        el('div', { style: { fontSize: '18px', fontWeight: '900', letterSpacing: '-0.01em', lineHeight: '1.1' } }, 'Sales Leaderboard'),
        el('div', { style: { fontSize: '10px', color: '#666', marginTop: '1px' } },
          'Top ' + limitOverall + ' overall · Top ' + limitRookie + ' rookies · ranked by revenue · column-leading metrics highlighted'),
      ),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        companyLogo
          ? el('img', { src: companyLogo, alt: 'RIDD', style: { height: '26px' } })
          : el('div', { style: { fontSize: '18px', fontWeight: '900', color: '#DF643A', letterSpacing: '-0.02em' } }, 'RIDD'),
        el('div', { style: { fontSize: '10px', color: '#666', fontWeight: '600', textAlign: 'right' } }, dateStr),
      ),
    ),
  );

  // ── Right-side branch panels — Revenue / ACV / Avg Pest Initial, each
  // ranked, stacked vertically beside the leaderboard so the printed
  // sheet reconciles against the CRM's branch totals at a glance. Sums
  // EVERY rep in the dataset (not just the top-15 rows below) and
  // inherits the page's department toggle — with Door to Door selected
  // these are D2D-only numbers (no upsells / inside sales).
  // Panels group by TEAM (not branch) — reps sell across branches but
  // belong to one team, so team rollups are the meaningful comparison.
  const PDF_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;
  // Troupe and Ganadores report SEPARATELY (they were merged as one crew
  // until Jul 2026 — per Isaac, keep them split like everywhere else).
  const PDF_TEAM_MERGE = {};
  // Returns null for reps who stay OFF the panels: no team assigned, or on
  // an excluded team (Manage Teams → Excluded).
  const teamOf = (r) => {
    const t = r.team || getRepTeam(r.name) || '';
    if (!t) return null;
    if (/^excluded$/i.test(t.trim())) return null; // the "Excluded" parking team
    if (typeof isTeamExcluded === 'function' && isTeamExcluded(t)) return null;
    return PDF_TEAM_MERGE[t.toLowerCase().trim()] || t;
  };
  const byBranch = {};
  for (const r of (allReps || [])) {
    const o = teamOf(r);
    if (!o) continue; // unassigned + excluded-team reps stay off the panels
    const b = byBranch[o] || (byBranch[o] = { revenue: 0, count: 0, pestSum: 0, pestN: 0 });
    b.revenue += r.revenue || 0;
    b.count   += r.count || (r.sales ? r.sales.length : 0);
    for (const s of (r.sales || [])) {
      if (PDF_PEST_EXCLUDE.test(s.subscription || '')) continue;
      b.pestSum += Number(s.initialPrice) || 0; b.pestN++;
    }
  }
  const deptLabel = (typeof INDICATOR_DEPTS !== 'undefined'
    && (INDICATOR_DEPTS.find(([k]) => k === (state.indicatorDept || 'all')) || [])[1]) || 'All';
  const sumAll = (k) => Object.values(byBranch).reduce((a, b) => a + b[k], 0);
  // Panels live on PAGE 2 now, restyled like the on-screen Sales Mix table
  // (per Isaac): chunky bars, value riding INSIDE the bar, and the
  // company/total reference as a full-width dark bar on top.
  const _mixPanel = (title, rows, totalLab, totalVal, fmtV) => {
    const maxV = rows.reduce((m, x) => Math.max(m, x[1]), 0.0001);
    const bar = (rank, label, val, dark) => {
      const pct = dark ? 100 : Math.max(2, val / maxV * 100);
      const inBar = pct >= 22;
      return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' } },
        el('div', { style: { width: '20px', fontSize: '9px', fontWeight: '800', color: '#999' } }, rank || ''),
        el('div', { style: { width: '120px', fontSize: '11px', fontWeight: dark ? '900' : '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
        el('div', { style: { flex: '1', height: '20px', borderRadius: '0', background: '#f1f1ec', position: 'relative' } },
          el('div', { style: { width: pct + '%', height: '100%', borderRadius: '0', background: dark ? '#323230' : '#DF643A', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '8px', boxSizing: 'border-box' } },
            inBar ? el('span', { style: { fontSize: '10px', fontWeight: '900', color: dark ? '#DF643A' : '#fff', whiteSpace: 'nowrap' } }, fmtV(val)) : null),
          inBar ? null : el('span', { style: { position: 'absolute', left: 'calc(' + pct + '% + 6px)', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', fontWeight: '900', color: '#323230', whiteSpace: 'nowrap' } }, fmtV(val))));
    };
    return el('div', {},
      el('div', { style: { fontSize: '12px', fontWeight: '900', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A9441F', margin: '0 0 4px' } }, title),
      bar('', totalLab, totalVal, true),
      ...rows.map(([o, v], i) => bar('#' + (i + 1), o, v, false)));
  };
  const desc = (rows) => rows.sort((a, b) => b[1] - a[1]);
  const revRows  = desc(Object.entries(byBranch).map(([o, b]) => [o, b.revenue]));
  const acvRows  = desc(Object.entries(byBranch).map(([o, b]) => [o, b.count > 0 ? b.revenue / b.count : 0]));
  const pestRows = desc(Object.entries(byBranch).map(([o, b]) => [o, b.pestN > 0 ? b.pestSum / b.pestN : 0]));
  const companyACV  = sumAll('count') > 0 ? sumAll('revenue') / sumAll('count') : 0;
  const companyPest = sumAll('pestN') > 0 ? sumAll('pestSum') / sumAll('pestN') : 0;
  // YTD PRA — per-rep average (subs/rep and revenue/rep). Denominator is
  // QUALIFIED reps only (per Isaac, Jul 2026): a rep must have sold MORE
  // than $20K YTD inside the team to count toward its PRA — stragglers
  // don't dilute the average. Revenue/subs still sum EVERY rep's sales.
  // Anchored to the calendar year regardless of the page's date window.
  const praStart = new Date(new Date().getFullYear(), 0, 1);
  const PRA_QUALIFY_MIN = 20000;
  const summer = {};
  for (const r of (allReps || [])) {
    for (const s of (r.sales || [])) {
      const dk = (s.dateSold || '').split(' ')[0].trim();
      if (!dk) continue;
      const d = new Date(dk);
      if (!Number.isFinite(d.getTime()) || d < praStart) continue;
      const o = teamOf(r);
      if (!o) continue; // unassigned + excluded-team reps stay off the panels
      const b = summer[o] || (summer[o] = { revenue: 0, subs: 0, repRev: {} });
      const cv = Number(s.contractValue || 0);
      b.revenue += cv; b.subs++; b.repRev[r.name] = (b.repRev[r.name] || 0) + cv;
    }
  }
  Object.values(summer).forEach(b => { b.q = Object.values(b.repRev).filter(v => v > PRA_QUALIFY_MIN).length; });
  const praRows = Object.entries(summer)
    .map(([o, b]) => ({ o, q: b.q, subsPra: b.subs / Math.max(1, b.q), revPra: b.revenue / Math.max(1, b.q) }))
    .sort((a, b) => b.revPra - a.revPra);
  const sumSummer = Object.values(summer).reduce((a, b) => ({ revenue: a.revenue + b.revenue, subs: a.subs + b.subs, reps: a.reps + b.q }), { revenue: 0, subs: 0, reps: 0 });
  // YTD PRA — Sales-Mix style (page 2): bar = revenue per qualified rep;
  // the >$20K count and subs/rep ride the row as small side columns.
  const _praPanel = praRows.length === 0 ? null : (() => {
    const maxV = praRows.reduce((m, r) => Math.max(m, r.revPra), 0.0001);
    const row = (rank, label, q, subs, val, dark) => {
      const pct = dark ? 100 : Math.max(2, val / maxV * 100);
      const inBar = pct >= 26;
      return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' } },
        el('div', { style: { width: '20px', fontSize: '9px', fontWeight: '800', color: '#999' } }, rank || ''),
        el('div', { style: { width: '104px', fontSize: '11px', fontWeight: dark ? '900' : '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
        el('div', { style: { width: '54px', fontSize: '9px', fontWeight: '700', color: '#666', whiteSpace: 'nowrap' } }, q + ' >$20K'),
        el('div', { style: { width: '66px', fontSize: '9px', fontWeight: '700', color: '#666', whiteSpace: 'nowrap' } }, subs + ' subs/rep'),
        el('div', { style: { flex: '1', height: '20px', borderRadius: '0', background: '#f1f1ec', position: 'relative' } },
          el('div', { style: { width: pct + '%', height: '100%', borderRadius: '0', background: dark ? '#323230' : '#DF643A', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '8px', boxSizing: 'border-box' } },
            inBar ? el('span', { style: { fontSize: '10px', fontWeight: '900', color: dark ? '#DF643A' : '#fff', whiteSpace: 'nowrap' } }, fmt.usd0(val)) : null),
          inBar ? null : el('span', { style: { position: 'absolute', left: 'calc(' + pct + '% + 6px)', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', fontWeight: '900', color: '#323230', whiteSpace: 'nowrap' } }, fmt.usd0(val))));
    };
    return el('div', {},
      el('div', { style: { fontSize: '12px', fontWeight: '900', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A9441F', margin: '0 0 4px' } }, 'YTD PRA'),
      row('', 'Company', String(sumSummer.reps || 0), sumSummer.reps > 0 ? (sumSummer.subs / sumSummer.reps).toFixed(1) : '—', sumSummer.reps > 0 ? sumSummer.revenue / sumSummer.reps : 0, true),
      ...praRows.map((r, i) => row('#' + (i + 1), r.o, String(r.q || 0), r.q > 0 ? r.subsPra.toFixed(1) : '—', r.q > 0 ? r.revPra : 0, false)));
  })();

  // ── PAGE 2 — the four rollup panels, Sales-Mix style, 2×2 grid ──
  const page2 = revRows.length === 0 ? null : el('div', {
    style: {
      width: '1220px',
      padding: '6px 8px 8px',
      background: '#fff', color: '#323230',
      fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif',
      boxSizing: 'border-box',
    },
  },
    el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', borderBottom: '2px solid #DF643A', paddingBottom: '4px', marginBottom: '10px' } },
      el('div', {},
        el('div', { style: { fontSize: '18px', fontWeight: '900', letterSpacing: '-0.01em', lineHeight: '1.1' } }, 'Team Rollups'),
        el('div', { style: { fontSize: '10px', color: '#666', marginTop: '1px' } }, 'Team Revenue · Team ACV · Avg Pest Initial · YTD PRA — every rep in the window · ' + deptLabel)),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        companyLogo
          ? el('img', { src: companyLogo, alt: 'RIDD', style: { height: '26px' } })
          : el('div', { style: { fontSize: '18px', fontWeight: '900', color: '#DF643A', letterSpacing: '-0.02em' } }, 'RIDD'),
        el('div', { style: { fontSize: '10px', color: '#666', fontWeight: '600', textAlign: 'right' } }, dateStr))),
    el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 36px', alignItems: 'start' } },
      _mixPanel('Team Revenue', revRows, 'Total', sumAll('revenue'), fmt.usd0),
      _mixPanel('Team ACV', acvRows, 'Company', companyACV, fmt.usd),
      _mixPanel('Avg Pest Initial', pestRows, 'Company', companyPest, fmt.usd),
      _praPanel));

  // For each section we identify the column-leading value per metric
  // so the manager sees at a glance who's #1 in ACV / pest / MY% / etc.
  // Cancel % is "best when low" so its leader is the min, not the max.
  const findLeaders = (reps) => {
    const leaders = {};
    const max = (key) => {
      let best = -Infinity, who = null;
      for (const r of reps) {
        const v = Number(r[key] || 0);
        if (v > best) { best = v; who = r.name; }
      }
      return best > 0 ? who : null;
    };
    const minCancelHolder = (() => {
      // Only reps with at least one sale qualify — a rep with 0 sales
      // would technically have 0% cancel rate and falsely win.
      const eligible = reps.filter(r => (r.count || 0) > 0);
      if (eligible.length === 0) return null;
      let best = Infinity, who = null;
      for (const r of eligible) {
        const v = Number(r.cancelPct || 0);
        if (v < best) { best = v; who = r.name; }
      }
      return who;
    })();
    leaders.count       = max('count');
    leaders.revenue     = max('revenue');
    leaders.acv         = max('acv');
    leaders.avgPest     = max('avgPest');
    leaders.auditPct    = max('auditPct');
    leaders.revPerDay   = max('revPerDay');
    leaders.acctsPerDay = max('acctsPerDay');
    leaders.avgInitial  = max('avgInitial');
    leaders.myPct       = max('myPct');
    leaders.autoPayPct  = max('autoPayPct');
    leaders.bestDay     = max('bestDay');
    leaders.bestWeek    = max('bestWeek');
    leaders.bestMonth   = max('bestMonth');
    leaders.cancelPct   = minCancelHolder;
    return leaders;
  };

  // Section renderer. Single column shape across all three tables so
  // they read as a set.
  const tableSection = (label, accentColor, reps) => {
    const sectionHeader = el('div', {
      style: {
        display: 'flex', alignItems: 'baseline', gap: '10px',
        marginTop: '4px', marginBottom: '4px',
      },
    },
      el('div', {
        style: {
          fontSize: '11px', fontWeight: '900', letterSpacing: '0.08em',
          textTransform: 'uppercase', color: accentColor,
        },
      }, label),
      el('div', { style: { fontSize: '10px', color: '#666' } },
        reps.length + ' rep' + (reps.length === 1 ? '' : 's')),
    );
    if (reps.length === 0) {
      return el('div', {},
        sectionHeader,
        el('div', {
          style: {
            padding: '12px', fontSize: '11px', color: '#888',
            fontStyle: 'italic', border: '1px dashed #ddd', borderRadius: '0',
          },
        }, 'No ' + label.toLowerCase() + ' assigned in Manage Teams.'),
      );
    }
    const leaders = findLeaders(reps);
    const th = (text, align) => el('th', {
      style: {
        fontSize: '8px', fontWeight: '800', letterSpacing: '0.04em',
        textTransform: 'uppercase', color: '#666',
        padding: '4px 4px',
        textAlign: 'left',   // everything left-justified (per Isaac)
        borderBottom: '1px solid #ddd',
        whiteSpace: 'nowrap',
      },
    }, text);
    // td renderer with optional `leader` flag — wraps the value in the
    // green accent pill that makes column winners pop on the printed
    // page (works in B&W too because the pill has its own outline).
    const td = (content, align, opts2 = {}) => {
      const style = {
        padding: '3px 4px',
        fontSize: '9.5px',
        textAlign: 'left',   // everything left-justified (per Isaac)
        borderBottom: '1px solid #f0f0f0',
        whiteSpace: 'nowrap',
        fontWeight: opts2.bold || opts2.leader ? '800' : '400',
        color: opts2.leader ? '#A9441F' : (opts2.color || '#323230'),
        fontVariantNumeric: 'tabular-nums',
      };
      if (opts2.leader) {
        style.background = 'rgba(223,100,58,0.18)';
        style.boxShadow  = 'inset 0 0 0 1px rgba(223,100,58,0.55)';
      }
      return el('td', { style }, content);
    };
    return el('div', {},
      sectionHeader,
      el('table', {
        style: {
          width: '100%', borderCollapse: 'collapse',
          border: '1px solid #e5e5e5',
        },
      },
        el('thead', { style: { background: '#fafafa' } },
          el('tr', {},
            th('#', 'left'),
            th('Rep'),
            th('Team'),
            th('Office'),
            th('Sales',      'right'),
            th('Revenue',    'right'),
            th('Audit %',    'right'),
            th('ACV',        'right'),
            th('Days w/ a Sale', 'right'),
            th('$ / Day',    'right'),
            th('Accts/Day',  'right'),
            th('Avg Pest',   'right'),
            th('Avg Initial','right'),
            th('MY %',       'right'),
            th('Auto Pay %', 'right'),
            th('Cancels',    'right'),
            th('Cancel %',   'right'),
            th('Best Day',   'right'),
            th('Best Week',  'right'),
            th('Best Month', 'right'),
          ),
        ),
        el('tbody', {},
          ...reps.map((r, i) => el('tr', {},
            td('#' + (i + 1), 'left', { bold: true, color: i === 0 ? accentColor : '#888' }),
            td(r.name, 'left', { bold: true }),
            td(r.team || '—', 'left', { color: '#666' }),
            td(titleCase(r.office) || '—', 'left', { color: '#666' }),
            td(fmt.int(r.count || 0),     'right', { leader: leaders.count === r.name }),
            td(fmt.usd0(r.revenue || 0),  'right', { bold: true, leader: leaders.revenue === r.name }),
            td(pctOrDash(r.auditPct),     'right', { leader: leaders.auditPct === r.name }),
            td(usdOrDash(r.acv),          'right', { leader: leaders.acv === r.name }),
            td(r.sellingDays > 0 ? fmt.int(r.sellingDays) : '—', 'right'),
            td(r.revPerDay > 0 ? fmt.usd0(r.revPerDay) : '—', 'right', { leader: leaders.revPerDay === r.name }),
            td(r.acctsPerDay > 0 ? r.acctsPerDay.toFixed(1) : '—', 'right', { leader: leaders.acctsPerDay === r.name }),
            td(usdOrDash(r.avgPest),      'right', { leader: leaders.avgPest === r.name }),
            td(usdOrDash(r.avgInitial),   'right', { leader: leaders.avgInitial === r.name }),
            td(pctOrDash(r.myPct),        'right', { leader: leaders.myPct === r.name }),
            td(pctOrDash(r.autoPayPct),   'right', { leader: leaders.autoPayPct === r.name }),
            td(r.cancels > 0 ? fmt.int(r.cancels) : '—', 'right', { color: '#666' }),
            // Cancel % is "best when low" — leader pill goes to the
            // lowest non-zero rate, and over-10% rates still render red
            // even on the leader so the absolute number reads honestly.
            td(r.cancelPct > 0 ? (r.cancelPct * 100).toFixed(1) + '%' : '—', 'right', {
              leader: leaders.cancelPct === r.name,
              color: r.cancelPct > 0.1 ? '#B91C1C' : '#323230',
            }),
            // Personal records — dollar amount with the date it happened
            // tucked underneath in small gray type.
            ...[
              [r.bestDay,   recWhen.day(r),   leaders.bestDay   === r.name],
              [r.bestWeek,  recWhen.week(r),  leaders.bestWeek  === r.name],
              [r.bestMonth, recWhen.month(r), leaders.bestMonth === r.name],
            ].map(([amount, when, isLeader]) => td(
              amount > 0
                ? el('div', { style: { lineHeight: '1.15' } },
                    el('div', {}, fmt.usd0(amount)),
                    when ? el('div', { style: { fontSize: '7.5px', fontWeight: '600', color: isLeader ? '#A9441F' : '#999' } }, when) : null)
                : '—',
              'right', { leader: isLeader })),
          )),
        ),
      ),
    );
  };

  // Leaderboard tables on the left, branch panels on the right — wide gap
  // so the two zones read separately; panel kept narrow so the leaderboard
  // gets the larger share of the page.
  // Full-width tables — the rollup panels moved to page 2 (per Isaac).
  page.append(
    tableSection('Top ' + limitOverall + ' Overall', '#323230', overall),
    el('div', { style: { height: '4px' } }),
    tableSection('Top ' + limitRookie + ' Rookies', '#5F6C5B', rookies),
  );

  // Two print pages: leaderboard + team rollups. The downloader renders
  // each child as its own PDF page.
  return el('div', {}, page, ...(page2 ? [page2] : []));
}

async function downloadRookieVetPdf(allReps) {
  try {
    await loadPdfLibsOnce();
  } catch {
    toast('Could not load PDF libraries — check your connection', 'error');
    return;
  }
  const reportEl = buildRookieVetReportNode(allReps);
  reportEl.style.position = 'fixed';
  reportEl.style.left     = '-99999px';
  reportEl.style.top      = '0';
  reportEl.style.zIndex   = '-1';
  document.body.append(reportEl);
  // No Chart.js to wait on — one frame is enough for layout to settle.
  await new Promise(r => requestAnimationFrame(() => r()));
  try {
    const { jsPDF } = window.jspdf;
    // Landscape gives the 14-column table the horizontal room it needs.
    // Page 1 = leaderboard tables, page 2 = the Sales-Mix-style rollups.
    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
    const pageW = pdf.internal.pageSize.getWidth();   // 792pt (11")
    const pageH = pdf.internal.pageSize.getHeight();  // 612pt (8.5")
    const marginX = 5;
    const marginY = 8;
    const imgW = pageW - marginX * 2;
    const usableH = pageH - marginY * 2;
    const sheets = [...reportEl.children];
    for (let pi = 0; pi < sheets.length; pi++) {
      const canvas = await html2canvas(sheets[pi], {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
      });
      const imgData = canvas.toDataURL('image/png');
      const imgH = (canvas.height * imgW) / canvas.width;
      if (pi > 0) pdf.addPage();
      if (imgH <= usableH) {
        pdf.addImage(imgData, 'PNG', marginX, marginY, imgW, imgH);
      } else {
        // Scale to fit the sheet rather than tiling — better to lose a
        // bit of font size than to print a ghost row on an extra page.
        const scaledH = usableH;
        const scaledW = (imgW * usableH) / imgH;
        const xCentered = marginX + (imgW - scaledW) / 2;
        pdf.addImage(imgData, 'PNG', xCentered, marginY, scaledW, scaledH);
      }
    }
    pdf.save('RIDD-Leaderboard-' + new Date().toISOString().slice(0, 10) + '.pdf');
    toast('Downloaded sales leaderboard', 'success');
  } catch (err) {
    console.error('[ridd] Rookie/Vet PDF failed', err);
    toast('Failed to generate PDF: ' + (err.message || 'unknown'), 'error');
  } finally {
    reportEl.remove();
  }
}

// Modal listing every team with a per-team Download button + a single
// "Download all" button that fires the downloads sequentially.
// ── TV Display dashboard ─────────────────────────────────────────────────
// Fullscreen leaderboard meant for a wall-mounted TV in the office.
// Pulls today's sales from state.allSales (live mode) or state.mySales
// (rep view), aggregates by office + rep, and renders huge typography
// optimized for "read across the room". Auto-refreshes every 30s so
// new sales appear without anyone touching the TV.
function openTVDashboard() {
  const overlay = el('div', {
    style: {
      position: 'fixed', inset: '0',
      background: '#0A0A0A', color: '#fff',
      zIndex: '9999', overflow: 'auto',
      fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif',
    },
  });

  // Date-window picker: today by default, but the TV board can also be
  // pointed at week-to-date or month-to-date for end-of-period pushes.
  if (!state._tvDashboardRange) state._tvDashboardRange = 'today';
  // Default custom range = past 7 days so the dates auto-fill the
  // first time a user clicks Custom; they can then drag either input
  // to whatever window they need.
  if (!state._tvDashboardCustomStart || !state._tvDashboardCustomEnd) {
    const _today = new Date();
    const _weekAgo = new Date(); _weekAgo.setDate(_weekAgo.getDate() - 7);
    state._tvDashboardCustomStart = state._tvDashboardCustomStart || _weekAgo.toISOString().slice(0, 10);
    state._tvDashboardCustomEnd   = state._tvDashboardCustomEnd   || _today.toISOString().slice(0, 10);
  }
  const RANGES = [
    { id: 'today',   label: 'Today' },
    { id: 'week',    label: 'This Week' },
    { id: 'month',   label: 'This Month' },
    { id: 'quarter', label: 'This Quarter' },
    { id: 'custom',  label: 'Custom' },
  ];

  let refreshTimer = null;
  let clockTimer   = null;
  let pulseTimer   = null;
  // Fullscreen toggle — uses the page-level Fullscreen API so OS chrome
  // (URL bar, tabs, dock) is fully out of the way for a wall-mounted TV.
  // fsBtn is re-assigned by render() each repaint; refreshFsBtn swaps the
  // icon so it stays in sync if the user presses Esc instead of clicking.
  const FS_ENTER = '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>';
  const FS_EXIT  = '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>';
  let fsBtn = null;
  const refreshFsBtn = () => {
    if (!fsBtn) return;
    const inFs = !!document.fullscreenElement;
    fsBtn.title = inFs ? 'Exit fullscreen' : 'Enter fullscreen';
    fsBtn.innerHTML = '';
    fsBtn.append(svg(inFs ? FS_EXIT : FS_ENTER, 18));
  };
  const cleanup = () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (clockTimer)   clearInterval(clockTimer);
    if (pulseTimer)   clearInterval(pulseTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', refreshFsBtn);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.remove();
  };
  // Esc unwinds one level at a time — in fullscreen the browser handles
  // the exit; out of fullscreen Esc closes the TV display.
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (document.fullscreenElement) return;
    cleanup();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', refreshFsBtn);

  const fmtMoney = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');

  const computeRange = () => {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const r = state._tvDashboardRange;
    if (r === 'week') {
      // Sunday → today
      const start = new Date(now); start.setDate(start.getDate() - start.getDay());
      return { start: start.toISOString().slice(0, 10), end: todayKey, label: 'This Week' };
    }
    if (r === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: start.toISOString().slice(0, 10), end: todayKey, label: 'This Month' };
    }
    if (r === 'quarter') {
      // Calendar quarter — Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec.
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), qStartMonth, 1);
      const qNum = Math.floor(now.getMonth() / 3) + 1;
      return { start: start.toISOString().slice(0, 10), end: todayKey, label: 'Q' + qNum + ' ' + now.getFullYear() };
    }
    if (r === 'custom') {
      // Guard against swapped dates — if start > end, flip them so the
      // window doesn't silently return zero sales.
      let s = state._tvDashboardCustomStart || todayKey;
      let e = state._tvDashboardCustomEnd   || todayKey;
      if (s > e) [s, e] = [e, s];
      return { start: s, end: e, label: s + ' → ' + e };
    }
    return { start: todayKey, end: todayKey, label: 'Today' };
  };

  const render = () => {
    overlay.innerHTML = '';
    const range = computeRange();
    const EXCLUDED = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule']);
    // Same CRM-backed pool as the War Room (office-staff CRM sales + manual
    // upsells); falls back to the app table until the dataset loads.
    const allSales = (typeof dashboardSales === 'function' ? dashboardSales() : (state.allSales || [])) || [];
    // Filter by entry date (created_at) — when the sale was logged — not
    // sold_date. Reps frequently back-date a sold_date to the actual door
    // knock, so a sale logged today for "yesterday" should still show on
    // Today's board. created_at is UTC ISO; convert to local YYYY-MM-DD so
    // comparisons line up with the range picker's local-date strings.
    const localDay = (iso) => {
      if (!iso) return null;
      const d = new Date(iso);
      if (isNaN(d)) return null;
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    };
    const inWindow = allSales.filter(s => {
      const day = localDay(s.created_at) || s.sold_date;
      if (!day) return false;
      if (EXCLUDED.has(s.audit_status)) return false;
      return day >= range.start && day <= range.end;
    });

    // Office aggregates — sorted by revenue desc so the highest-producing
    // office sits first after Total.
    const officeTotals = {};
    inWindow.forEach(s => {
      const k = s.office_id || 'unassigned';
      if (!officeTotals[k]) officeTotals[k] = 0;
      officeTotals[k] += Number(s.revenue_amount || 0);
    });
    const totalRevenue = Object.values(officeTotals).reduce((a, b) => a + b, 0);
    const sortedOffices = (state.offices || [])
      .map(o => ({ ...o, total: officeTotals[o.id] || 0 }))
      .sort((a, b) => b.total - a.total)
      .filter(o => o.total > 0)
      .slice(0, 5);

    // Top reps. Looks up name + avatar via state.allProfiles (admin
    // mode) or falls back to the current user's profile (rep mode where
    // only their own sales are visible).
    const repAgg = {};
    inWindow.forEach(s => {
      // CRM sellers without an app account rank under their CRM name —
      // same rule as the War Room leaderboard.
      const key = s.rep_id || (s._crm && s._crmRep && !FR_SYSTEM_NAME_RE.test(s._crmRep) ? 'crm:' + s._crmRep : null);
      if (!key) return;
      if (!repAgg[key]) repAgg[key] = { id: key, _crmName: (!s.rep_id && s._crmRep) || null, revenue: 0, count: 0, sales: [] };
      repAgg[key].revenue += Number(s.revenue_amount || 0);
      repAgg[key].count++;
      repAgg[key].sales.push(s);
    });
    const profileFor = (id, agg) => (state.allProfiles || []).find(p => p.id === id)
      || (state.profile && state.profile.id === id ? state.profile : null)
      || (agg && agg._crmName
            ? (() => { const d = flipLastFirst(agg._crmName); return { full_name: d, initials: d.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), avatar_url: '', office_id: null }; })()
            : { full_name: 'Rep', initials: '?', avatar_url: '', office_id: null });
    const ranked = Object.values(repAgg)
      .map(r => ({ ...r, profile: profileFor(r.id, r) }))
      .sort((a, b) => b.revenue - a.revenue);

    // Company stats — right-rail breakdown.
    // OTS (One Time Service) = contract types 4 + 5 (D2D / Office
    // upsells) — single charge, no recurring. Subscriptions = everything
    // else and may be either monthly (initial + 11 months of recurring)
    // or pay-per-service (num_services × monthly_amount).
    const totalSales   = inWindow.length;
    const OTS_CT_IDS   = new Set([4, 5]);
    const isOts        = (s) => {
      if (s._crm) {
        // CRM rows: one-time = no agreement length — except Sentricon,
        // which is always a 12-month program.
        if (/sentricon/i.test(String(s._crmService || ''))) return false;
        return !(Number(s.contract_months) > 1);
      }
      return OTS_CT_IDS.has(Number(s.contract_type_id));
    };
    const subs         = inWindow.filter(s => !isOts(s));
    const otsSales     = inWindow.filter(s => isOts(s));
    const subCount     = subs.length;
    const otsCount     = otsSales.length;

    // Avg Initial — subscription-only. OTS rows distort this since their
    // "initial" is effectively the full sale price, not a first-month
    // billing inside a longer term.
    const avgInitial   = subCount > 0
      ? subs.reduce((a, s) => a + Number(s.initial_amount || 0), 0) / subCount
      : 0;
    // Avg Recurring — monthly_amount averaged across subscription
    // contracts. OTS rows would all be $0 here and pull the figure down.
    const avgRecurring = subCount > 0
      ? subs.reduce((a, s) => a + Number(s.monthly_amount || 0), 0) / subCount
      : 0;

    // Per-sale ACV. PPS subs bill per-visit; monthly subs are initial +
    // 11 months of recurring (initial covers month 1). OTS is a single
    // payment — fall back to revenue_amount when initial_amount is blank
    // (the upsell flow stores the full price in revenue_amount).
    const saleACV = (s) => {
      if (s._crm) return Number(s.revenue_amount || 0);   // CRM contract value is exact
      if (isOts(s)) return Number(s.revenue_amount || s.initial_amount || 0);
      if (s.pay_per_service) return Number(s.num_services || 0) * Number(s.monthly_amount || 0);
      return Number(s.initial_amount || 0) + Number(s.monthly_amount || 0) * 11;
    };
    const subAcv       = subCount > 0
      ? subs.reduce((a, s) => a + saleACV(s), 0) / subCount
      : 0;
    const otsAcv       = otsCount > 0
      ? otsSales.reduce((a, s) => a + saleACV(s), 0) / otsCount
      : 0;
    const weightedAcv  = totalSales > 0
      ? inWindow.reduce((a, s) => a + saleACV(s), 0) / totalSales
      : 0;

    // Multi-Year % — same definition the rep modal uses: multi / (12 +
    // multi) across subscription contracts. OTS and other contract
    // lengths fall out of both numerator and denominator so the figure
    // reflects only contracts where MY was even an option.
    const sub12mo      = subs.filter(s => myBucketOf(s) === 'twelve').length;
    const subMultiYr   = subs.filter(s => myBucketOf(s) === 'multi').length;
    const myDenom      = sub12mo + subMultiYr;
    const multiYearPct = myDenom > 0 ? (subMultiYr / myDenom) * 100 : 0;

    const companyLogo  = state.companyLogo || '';

    // ── Goal math ────────────────────────────────────────────────────
    // Annual company goal → monthly → daily (Mon–Sat working days). Per-
    // rep daily goal divides the department's daily target by the count
    // of active sellers (rep + admin_rep roles). The strip then shows
    // "Today's goal", "This week's goal", or "This month's goal"
    // depending on which range button is active so the number on screen
    // is always comparable to the revenue right above it.
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const _isoOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    // ── Weekend weights — LEARNED from the trailing 8 weeks ──────────
    // The office is open 7 days, but weekends run a skeleton crew (1 rep
    // vs ~6 on weekdays), so a flat per-day goal would hand them an
    // impossible number. Instead of hardcoded knobs, the board measures
    // what a Saturday and a Sunday each actually produce vs an average
    // weekday and weights the month's days by it — hire a second weekend
    // rep and the weights adjust themselves. $0 days count (an empty
    // Saturday is signal). Clamped 0.1–1; 1/3 until there's at least two
    // of that day in the history.
    let satWeight = 0.33, sunWeight = 0.33;
    {
      const dayRevMap = new Map();
      allSales.forEach(s => {
        if (EXCLUDED.has(s.audit_status)) return;
        const day = localDay(s.created_at) || s.sold_date;
        if (day) dayRevMap.set(day, (dayRevMap.get(day) || 0) + Number(s.revenue_amount || 0));
      });
      let wkSum = 0, wkN = 0, satSum = 0, satN = 0, sunSum = 0, sunN = 0;
      const d = new Date(today); d.setDate(d.getDate() - 1);
      for (let i = 0; i < 56; i++, d.setDate(d.getDate() - 1)) {
        const rev = dayRevMap.get(_isoOf(d)) || 0;
        if (d.getDay() === 0)      { sunSum += rev; sunN++; }
        else if (d.getDay() === 6) { satSum += rev; satN++; }
        else                       { wkSum += rev; wkN++; }
      }
      const wkAvg = wkN ? wkSum / wkN : 0;
      if (wkAvg > 0 && satN >= 2) satWeight = Math.min(1, Math.max(0.1, (satSum / satN) / wkAvg));
      if (wkAvg > 0 && sunN >= 2) sunWeight = Math.min(1, Math.max(0.1, (sunSum / sunN) / wkAvg));
    }
    const dayWeight = (d) => d.getDay() === 0 ? sunWeight : d.getDay() === 6 ? satWeight : 1;
    // Weighted "working days" in the month — a Saturday counts as a
    // fraction of a weekday, so dailyCompanyGoal below is the WEEKDAY pace.
    let workingDaysInMonth = 0;
    for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
      workingDaysInMonth += dayWeight(d);
    }
    const cg = state.companyGoal || { amount: 6000000, period: 'year' };
    const monthlyCompanyGoal = cg.period === 'year' ? cg.amount / 12 : cg.amount;
    const dailyCompanyGoal = workingDaysInMonth > 0 ? monthlyCompanyGoal / workingDaysInMonth : 0;
    const sellerRoles = new Set(['rep', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'rep_sales', 'rep_partner', 'rep_team_lead', 'admin_rep']);
    const activeRepCount = Math.max(1,
      (state.allProfiles || []).filter(p => p.is_active !== false && sellerRoles.has(p.role)).length
    );
    // WEIGHTED working days between two ISO dates (inclusive) — weekdays
    // count 1, Sat/Sun count their learned fractions. Used for Custom.
    const countWorkingDays = (startIso, endIso) => {
      let n = 0;
      const d = new Date(startIso + 'T00:00');
      const stop = new Date(endIso + 'T00:00');
      while (d <= stop) {
        n += dayWeight(d);
        d.setDate(d.getDate() + 1);
      }
      return n;
    };
    let periodCompanyGoal, periodRepGoal, periodGoalLabel;
    if (state._tvDashboardRange === 'today') {
      // Today's Goal = what's LEFT of the monthly goal ÷ working days left
      // in the month (today included) — a live catch-up pace. Ahead of plan
      // → tomorrow's number eases; behind → it climbs. Floors at $0 once
      // the month is already in the bag.
      const todayIso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      const monthStartIso = todayIso.slice(0, 8) + '01';
      const mtdRevenue = allSales.reduce((a, s) => {
        if (EXCLUDED.has(s.audit_status)) return a;
        const day = localDay(s.created_at) || s.sold_date;
        // Through YESTERDAY — today's own sales don't shrink today's target
        // mid-day; the number stays fixed while the room sells against it.
        if (!day || day < monthStartIso || day >= todayIso) return a;
        return a + Number(s.revenue_amount || 0);
      }, 0);
      let workingDaysLeft = 0;   // today included — WEIGHTED (Sat/Sun count their learned fractions)
      for (let d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); d <= monthEnd; d.setDate(d.getDate() + 1)) {
        workingDaysLeft += dayWeight(d);
      }
      // Remaining goal ÷ weighted days left = the weekday pace; today's goal
      // is that pace × today's own weight (a Saturday gets its fair share).
      const weekdayPace = workingDaysLeft > 0 ? Math.max(0, (monthlyCompanyGoal - mtdRevenue) / workingDaysLeft) : 0;
      periodCompanyGoal = weekdayPace * dayWeight(today);
      periodRepGoal     = periodCompanyGoal / activeRepCount;
      periodGoalLabel   = "Today's Goal";
    } else if (state._tvDashboardRange === 'week') {
      // 5 weekdays + weighted Saturday + weighted Sunday.
      periodCompanyGoal = dailyCompanyGoal * (5 + satWeight + sunWeight);
      periodRepGoal     = periodCompanyGoal / activeRepCount;
      periodGoalLabel   = "Week's Goal";
    } else if (state._tvDashboardRange === 'quarter') {
      // Annual goal ÷ 4. Skips the day-counting since the quarter is a
      // fixed slice of the annual plan, regardless of how many working
      // days fall inside it.
      const yearGoal = cg.period === 'year' ? cg.amount : cg.amount * 12;
      periodCompanyGoal = yearGoal / 4;
      periodRepGoal     = periodCompanyGoal / activeRepCount;
      periodGoalLabel   = "Quarter's Goal";
    } else if (state._tvDashboardRange === 'custom') {
      // Pro-rate by working days inside the chosen window so a 2-day
      // pick gets a 2-day goal, a 30-day pick gets a 30-day goal, etc.
      const r = computeRange();
      const wd = countWorkingDays(r.start, r.end);
      periodCompanyGoal = dailyCompanyGoal * wd;
      periodRepGoal     = periodCompanyGoal / activeRepCount;
      periodGoalLabel   = wd + '-Day Goal';
    } else {
      periodCompanyGoal = monthlyCompanyGoal;
      periodRepGoal     = monthlyCompanyGoal / activeRepCount;
      periodGoalLabel   = "Month's Goal";
    }
    const goalProgressPct = periodCompanyGoal > 0
      ? Math.min(100, (totalRevenue / periodCompanyGoal) * 100)
      : 0;

    // ── Top bar ──────────────────────────────────────────────────────
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    // Pulsing lime dot + "LIVE" label so anyone walking past the TV
    // knows the numbers are auto-refreshing (every 30s).
    const livePill = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px',
        background: 'rgba(223,100,58,0.15)',
        border: '1px solid #DF643A',
        borderRadius: '0',
      },
    },
      el('div', {
        id: 'tv-live-dot',
        style: { width: '8px', height: '8px', borderRadius: '50%', background: '#DF643A', transition: 'opacity .3s' },
      }),
      el('span', { style: { fontSize: '10px', fontWeight: '900', letterSpacing: '0.18em', color: '#DF643A' } }, 'LIVE'),
    );
    const timeEl = el('div', { style: { fontSize: '14px', fontWeight: '600', color: '#DF643A', letterSpacing: '0.05em' } },
      new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    const syncEl = (() => {
      const t = state.indicatorsUploadedAt ? new Date(state.indicatorsUploadedAt) : null;
      if (!t || isNaN(t)) return null;
      return el('div', { style: { fontSize: '11px', color: '#888', letterSpacing: '0.05em' } },
        'CRM sync · ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    })();
    const topBar = el('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 32px', borderBottom: '2px solid #222',
      },
    },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '18px' } },
        el('div', { style: { fontSize: '28px', fontWeight: '900', letterSpacing: '0.05em' } }, '🏆 SALES WAR ROOM'),
        el('div', { style: { fontSize: '14px', color: '#888' } }, dateStr),
      ),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } },
        el('div', { style: { display: 'inline-flex', borderRadius: '0', overflow: 'hidden', border: '1px solid #333' } },
          ...RANGES.map(r => el('button', {
            style: {
              padding: '6px 14px', fontSize: '12px', fontWeight: '800',
              letterSpacing: '0.1em', textTransform: 'uppercase',
              background: state._tvDashboardRange === r.id ? '#DF643A' : 'transparent',
              color: state._tvDashboardRange === r.id ? '#0A0A0A' : '#888',
              border: 'none', cursor: 'pointer',
            },
            onclick: () => { state._tvDashboardRange = r.id; render(); },
          }, r.label)),
        ),
        // Custom date pickers — only visible when Custom is the active
        // range. Inputs are styled dark to blend with the TV background
        // and re-render the whole board on change so the goal + roster
        // + stats all update against the new window.
        state._tvDashboardRange === 'custom' && el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px' },
        },
          el('input', {
            type: 'date',
            value: state._tvDashboardCustomStart || '',
            style: {
              padding: '5px 8px', fontSize: '12px',
              background: '#323230', color: '#fff',
              border: '1px solid #333', borderRadius: '0',
              colorScheme: 'dark',
            },
            onchange: (e) => { state._tvDashboardCustomStart = e.target.value; render(); },
          }),
          el('span', { style: { color: '#666', fontSize: '12px' } }, '→'),
          el('input', {
            type: 'date',
            value: state._tvDashboardCustomEnd || '',
            style: {
              padding: '5px 8px', fontSize: '12px',
              background: '#323230', color: '#fff',
              border: '1px solid #333', borderRadius: '0',
              colorScheme: 'dark',
            },
            onchange: (e) => { state._tvDashboardCustomEnd = e.target.value; render(); },
          }),
        ),
        livePill,
        syncEl,
        timeEl,
        (() => {
          fsBtn = el('button', {
            style: {
              background: '#222', color: '#fff', border: 'none',
              width: '36px', height: '36px', borderRadius: '50%',
              cursor: 'pointer', display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
            },
            onclick: async () => {
              try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
              } catch (_) {}
            },
          });
          refreshFsBtn();
          return fsBtn;
        })(),
        el('button', {
          style: {
            background: '#222', color: '#fff', border: 'none',
            width: '36px', height: '36px', borderRadius: '50%',
            fontSize: '20px', cursor: 'pointer', lineHeight: '1',
          },
          title: 'Close (Esc)',
          onclick: cleanup,
        }, '×'),
      ),
    );

    // ── Office strip ─────────────────────────────────────────────────
    // TOTAL tile gets an extra goal block — the department's period
    // target + per-rep target sized to the current view (today / week /
    // month) so the team can see at a glance how far they are from the
    // number they need to hit.
    const officeCard = (label, value, opts = {}) => el('div', {
      style: {
        flex: '1', minWidth: '0',
        padding: '18px 16px',
        // TOTAL tile matches the range buttons' accent lime exactly, so
        // the top strip reads as one brand color. Dark text for contrast
        // (same pairing as the TODAY button). Other tiles stay dark.
        background: opts.isTotal ? '#DF643A' : '#323230',
        textAlign: 'center',
        borderRight: '1px solid #0A0A0A',
        position: 'relative',
      },
    },
      el('div', { style: { fontSize: '13px', fontWeight: '800', letterSpacing: '0.15em', color: opts.isTotal ? '#323230' : '#888', textTransform: 'uppercase', marginBottom: '6px' } }, label),
      el('div', { style: { fontSize: '32px', fontWeight: '900', color: opts.isTotal ? '#323230' : '#fff', letterSpacing: '-0.02em' } }, fmtMoney(value)),
      opts.isTotal && opts.periodGoal > 0 && el('div', {
        style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.22)' },
      },
        // Goal label + value (e.g. "TODAY'S GOAL · $X").
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '4px' } },
          el('span', { style: { fontSize: '10px', fontWeight: '800', letterSpacing: '0.14em', color: 'rgba(29,29,29,0.75)', textTransform: 'uppercase' } }, opts.periodGoalLabel),
          el('span', { style: { fontSize: '14px', fontWeight: '800', color: '#323230', fontVariantNumeric: 'tabular-nums' } }, fmtMoney(opts.periodGoal)),
        ),
        // Progress bar — dark track on the lime tile, white fill.
        el('div', { style: { height: '6px', background: 'rgba(0,0,0,0.2)', borderRadius: '0', overflow: 'hidden' } },
          el('div', {
            style: {
              width: opts.goalProgressPct.toFixed(1) + '%',
              height: '100%',
              background: opts.goalProgressPct >= 100 ? '#323230' : '#FFFFFF',
              transition: 'width .3s',
            },
          }),
        ),
        // Stats line: percent-to-goal + per-rep target.
        el('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: 'rgba(29,29,29,0.8)', fontWeight: '700', letterSpacing: '0.05em' } },
          el('span', {}, opts.goalProgressPct.toFixed(0) + '% to goal'),
          el('span', {}, 'Per rep: ' + fmtMoney(opts.periodRepGoal)),
        ),
      ),
    );
    const officeStrip = el('div', {
      style: { display: 'flex', borderBottom: '2px solid #222', alignItems: 'stretch' },
    },
      officeCard('TOTAL', totalRevenue, {
        isTotal: true,
        periodGoal: periodCompanyGoal,
        periodRepGoal: periodRepGoal,
        periodGoalLabel: periodGoalLabel,
        goalProgressPct,
      }),
      ...sortedOffices.map(o => officeCard(o.name, o.total)),
    );

    // ── Rep table (left) — every rep's logged production this window:
    // PFP · name · subscriptions logged · revenue · ACV · MY% (excludes
    // one-time services) · Rec Mix% (subs ÷ all accounts). Same OTS
    // definition as the right rail (contract types 4 + 5).
    const _tvOts = new Set([4, 5]);
    const repRow = (rep, rank) => {
      const sales2 = rep.sales || [];
      const subs2 = sales2.filter(s => !_tvOts.has(Number(s.contract_type_id)));
      const c12 = subs2.filter(s => myBucketOf(s) === 'twelve').length;
      const cMY = subs2.filter(s => myBucketOf(s) === 'multi').length;
      const myPct = (c12 + cMY) > 0 ? (cMY / (c12 + cMY)) * 100 : 0;
      const recMix = sales2.length > 0 ? (subs2.length / sales2.length) * 100 : 0;
      const acv = sales2.length > 0 ? rep.revenue / sales2.length : 0;
      const tdS = { padding: '12px 10px', fontSize: '16px', fontWeight: '700', color: '#ddd', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' };
      return el('tr', { style: { borderTop: '1px solid #323230', background: rank === 1 ? 'linear-gradient(90deg, #DF643A18 0%, transparent 70%)' : 'transparent' } },
        el('td', { style: { padding: '12px 0 12px 14px', width: '46px' } }, (() => {
          const a = avatarNode(rep.profile.avatar_url, rep.profile.initials || (rep.profile.full_name || '?').slice(0, 2), 'w-9 h-9 text-[11px]');
          a.style.flexShrink = '0';
          return a;
        })()),
        el('td', { style: { padding: '12px 10px', minWidth: '0' } },
          el('div', { style: { fontSize: '17px', fontWeight: '800', color: rank === 1 ? '#DF643A' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' } }, rep.profile.full_name || 'Rep'),
          el('div', { style: { fontSize: '11px', color: '#777' } }, (state.offices || []).find(o => o.id === rep.profile.office_id)?.name || '—')),
        el('td', { style: tdS }, String(subs2.length)),
        el('td', { style: { ...tdS, color: '#DF643A', fontWeight: '900', fontSize: '17px' } }, fmtMoney(rep.revenue)),
        el('td', { style: tdS }, fmtMoney(acv)),
        el('td', { style: tdS }, (c12 + cMY) > 0 ? myPct.toFixed(0) + '%' : '—'),
        el('td', { style: { ...tdS, paddingRight: '14px' } }, recMix.toFixed(0) + '%'),
      );
    };
    const thS = { padding: '8px 10px', fontSize: '10px', fontWeight: '800', letterSpacing: '0.12em', color: '#777', textTransform: 'uppercase', textAlign: 'right', whiteSpace: 'nowrap' };
    const roster = el('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '10px' },
    },
      el('div', { style: { fontSize: '14px', fontWeight: '800', letterSpacing: '0.2em', color: '#888', marginBottom: '6px' } }, 'REPS · ' + range.label.toUpperCase()),
      ranked.length === 0
        ? el('div', { style: { padding: '30px', textAlign: 'center', color: '#666', fontStyle: 'italic', background: '#323230', borderRadius: '0' } },
            'No sales yet for ' + range.label.toLowerCase())
        : el('div', { style: { background: '#323230', borderRadius: '0', border: '1px solid #323230', overflow: 'auto' } },
            el('table', { style: { width: '100%', borderCollapse: 'collapse' } },
              el('thead', {}, el('tr', {},
                el('th', { style: { ...thS, textAlign: 'left', paddingLeft: '14px' } }, ''),
                el('th', { style: { ...thS, textAlign: 'left' } }, 'Rep'),
                el('th', { style: thS, title: 'Subscriptions logged (one-time services excluded)' }, 'Subs'),
                el('th', { style: thS }, 'Revenue'),
                el('th', { style: thS }, 'ACV'),
                el('th', { style: thS, title: 'Multi-year contracts ÷ (12-month + multi-year) — one-time services excluded' }, 'MY %'),
                el('th', { style: { ...thS, paddingRight: '14px' }, title: 'Subscriptions ÷ all accounts logged' }, 'Rec Mix'))),
              el('tbody', {}, ...ranked.map((rep, i) => repRow(rep, i + 1))))),
    );

    // ── Company stats card (right) ───────────────────────────────────
    const statLine = (label, value, big) => el('div', {
      style: {
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        padding: '12px 0',
        borderTop: '1px solid #323230',
        fontSize: big ? '24px' : '16px',
      },
    },
      el('span', { style: { color: big ? '#fff' : '#888', fontWeight: big ? '800' : '600', letterSpacing: big ? '0.02em' : '0.05em' } }, label),
      el('span', { style: { color: big ? '#DF643A' : '#fff', fontWeight: '900', fontVariantNumeric: 'tabular-nums' } }, value),
    );

    const statsCard = el('div', {
      style: { display: 'flex', flexDirection: 'column' },
    },
      el('div', { style: { textAlign: 'center', padding: '24px 0', borderBottom: '2px solid #222', marginBottom: '12px' } },
        companyLogo
          ? el('img', { src: companyLogo, alt: 'RIDD', style: { height: '80px', display: 'inline-block', filter: 'brightness(1.1)' } })
          : el('div', { style: { fontSize: '56px', fontWeight: '900', color: '#DF643A', letterSpacing: '-0.02em' } }, 'RIDD'),
        el('div', { style: { fontSize: '12px', fontWeight: '700', letterSpacing: '0.18em', color: '#666', marginTop: '4px' } }, 'PEST CONTROL'),
        el('div', { style: { fontSize: '11px', color: '#666', marginTop: '8px' } }, range.label + ' · ' + range.start + (range.start !== range.end ? ' → ' + range.end : '')),
      ),
      statLine('Total Sales',      totalSales,             true),
      statLine('Total Revenue',    fmtMoney(totalRevenue), true),
      el('div', { style: { height: '8px' } }),
      statLine('Avg Initial',      fmtMoney(avgInitial)),
      statLine('Avg Recurring',    fmtMoney(avgRecurring)),
      statLine('Weighted ACV',     fmtMoney(weightedAcv)),
      statLine('Subscription ACV', fmtMoney(subAcv)),
      statLine('OTS ACV',          fmtMoney(otsAcv)),
      statLine('Multi-Year %',     multiYearPct.toFixed(1) + '%'),
    );

    // ── Two-column body ─────────────────────────────────────────────
    const body = el('div', {
      style: {
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: '24px',
        padding: '24px 32px',
      },
    }, roster, statsCard);

    overlay.append(topBar, officeStrip, body);
  };

  render();
  // Auto-refresh: pulls fresh data + repaints. 30s keeps the TV current
  // without thrashing the network or the eye. Sales reps will see new
  // logs appear inside 30s of an admin auditing them.
  refreshTimer = setInterval(render, 30000);
  // LIVE-dot pulse — toggles the dot's opacity twice a second so anyone
  // walking past the TV can tell the page is alive and auto-refreshing.
  // Looks up the dot fresh each tick because render() replaces the DOM.
  let pulseState = true;
  pulseTimer = setInterval(() => {
    const dot = document.getElementById('tv-live-dot');
    if (!dot) return;
    pulseState = !pulseState;
    dot.style.opacity = pulseState ? '1' : '0.35';
  }, 700);

  document.body.append(overlay);
}

function _lbAllRepsForReport() { return Array.isArray(state._indLbAllReps) ? state._indLbAllReps : []; }
function openTeamReportsModal(ctx) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  // One modal, three report groupings (per Isaac): Teams (Manage Teams),
  // Offices (branch name from the upload), or Reps (one PDF per rep — an
  // individual breakdown ranked against every other rep). A dropdown in
  // the header switches the list; it opens on whatever grouping the
  // Indicators page is in.
  const MODES = [['team', 'Teams'], ['branch', 'Offices'], ['rep', 'Reps']];
  let mode = ['team', 'branch', 'rep'].includes(ctx.groupMode) ? ctx.groupMode : 'team';
  const rawSales = ctx.rawSales || state._indicatorRawSales || [];
  const repNames = [...new Set(rawSales.map(s => s.rep ? getCanonicalRepName(s.rep) : '').filter(Boolean))].sort();
  const itemsFor = (m) => {
    if (m === 'rep') return repNames;
    if (m === 'branch') {
      const fromCtx = ctx.groupMode === 'branch' ? (ctx.branches || []) : [];
      const list = fromCtx.length ? fromCtx : [...new Set(rawSales.map(s => s.office).filter(Boolean))].sort();
      return list.filter(b => b !== 'Unassigned');
    }
    const fromCtx = ctx.groupMode === 'team' ? (ctx.branches || []) : [];
    const list = fromCtx.length ? fromCtx
      : (typeof getRepTeam === 'function' ? [...new Set(repNames.map(n => getRepTeam(n)).filter(Boolean))].sort() : []);
    return list.filter(b => b !== 'Unassigned');
  };
  const labelOf = (m) => m === 'rep' ? 'Rep' : m === 'branch' ? 'Office' : 'Team';
  const allLabel = (m) => '\ud83d\udcc4 All ' + (m === 'branch' ? 'offices' : 'teams') + ' \u00b7 one PDF';
  const ctxFor = (m) => Object.assign({}, ctx, { groupMode: m });

  const status = el('div', { class: 'text-xs text-muted-', style: { minHeight: '16px' } });
  const title   = el('h3', { class: 'text-base font-bold' });
  const subline = el('p', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } });
  const list    = el('div', { class: 'flex-1 overflow-y-auto' });
  const search  = el('input', {
    type: 'text', placeholder: 'Find a rep…', autocomplete: 'off',
    class: 'rounded-lg border px-2.5 py-1 text-[11px] w-full',
    style: { borderColor: 'var(--border-2)' },
    oninput: (e) => {
      const q = (e.target.value || '').trim().toLowerCase();
      list.querySelectorAll('[data-report-item]').forEach(row => {
        row.style.display = (!q || (row.getAttribute('data-report-item') || '').includes(q)) ? '' : 'none';
      });
    },
  });

  let downloadAllBtn = null;
  const mkRow = (item, m) => {
    const isRep = m === 'rep';
    const brand = isRep ? ((typeof getRepTeam === 'function' && getRepTeam(item)) || '') : item;
    const color = getTeamColor(brand || item);
    const logo  = getTeamLogo(brand || item);
    const dlBtn = el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: async () => {
        dlBtn.disabled = true; dlBtn.textContent = '…';
        try {
          await downloadTeamPdf(item, ctxFor(m));
        } catch (err) {
          // downloadTeamPdf has its own try/catch but a synchronous
          // throw inside buildTeamReportNode (or before the inner try)
          // would otherwise leave the button stuck on "…" with no toast.
          console.error('[ridd] downloadTeamPdf threw', err);
          toast('PDF failed for ' + item + ': ' + (err.message || 'unknown — check console'), 'error');
        } finally {
          dlBtn.disabled = false; dlBtn.textContent = 'Download PDF';
        }
      },
    }, 'Download PDF');
    return el('div', {
      'data-report-item': String(item).toLowerCase(),
      class: 'flex items-center justify-between gap-3 px-4 py-2.5 border-b',
      style: { borderColor: 'var(--border)' },
    },
      el('div', { class: 'flex items-center gap-3 min-w-0' },
        logo
          ? el('img', { src: logo, style: { width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', background: '#fff' } })
          : el('span', { style: { width: '28px', height: '28px', borderRadius: '50%', background: color, flexShrink: '0' } }),
        el('div', { class: 'min-w-0' },
          el('div', { class: 'font-semibold truncate' }, item),
          (isRep && brand) ? el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-muted)' } }, brand) : null),
      ),
      dlBtn,
    );
  };

  // 📄 Top-15 leaderboard PDF (top 15 overall + top 15 rookies) — lives here
  // now instead of the Leaderboard toolbar (per Isaac). Pulls the full
  // active roster regardless of page filters.
  const lbReps = (typeof _lbAllRepsForReport === 'function') ? _lbAllRepsForReport() : [];
  const lbRow = (() => {
    const dl = el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: async () => {
        dl.disabled = true; dl.textContent = '…';
        try { await downloadRookieVetPdf(lbReps); }
        catch (err) { console.error('[ridd] leaderboard PDF threw', err); toast('PDF failed: ' + (err.message || 'unknown'), 'error'); }
        finally { dl.disabled = false; dl.textContent = 'Download PDF'; }
      },
    }, 'Download PDF');
    return el('div', {
      class: 'flex items-center justify-between gap-3 px-4 py-2.5 border-b',
      style: { borderColor: 'var(--border)', background: 'var(--card-2)' },
    },
      el('div', { class: 'flex items-center gap-3 min-w-0' },
        el('span', { style: { width: '28px', height: '28px', borderRadius: '50%', background: 'var(--text)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: '0' } }, '\ud83c\udfc6'),
        el('div', { class: 'min-w-0' },
          el('div', { class: 'font-semibold truncate' }, 'Leaderboard \u00b7 Top 15'),
          el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-muted)' } }, 'Top 15 overall + top 15 rookies, column leaders highlighted'))),
      lbReps.length ? dl : el('span', { class: 'text-[11px] text-muted-' }, 'Open Indicators first'));
  })();
  // 📊 Roster workbook — one tab per team plus a Summary tab (moved here
  // from the Manage Teams header, per Isaac).
  // 𝕽 RIDD — the whole company as one report (per Isaac; replaces the
  // old "All offices · one PDF" that stitched every office together).
  const riddRow = (() => {
    const dl = el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: async () => {
        dl.disabled = true; dl.textContent = '…';
        try { await downloadTeamPdf('RIDD', ctxFor('company')); }
        catch (err) { console.error('[ridd] RIDD PDF threw', err); toast('PDF failed: ' + (err.message || 'unknown'), 'error'); }
        finally { dl.disabled = false; dl.textContent = 'Download PDF'; }
      },
    }, 'Download PDF');
    return el('div', {
      class: 'flex items-center justify-between gap-3 px-4 py-2.5 border-b',
      style: { borderColor: 'var(--border)', background: 'var(--card-2)' },
    },
      el('div', { class: 'flex items-center gap-3 min-w-0' },
        el('span', { style: { width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: '900', flexShrink: '0' } }, '\u211d'),
        el('div', { class: 'min-w-0' },
          el('div', { class: 'font-semibold truncate' }, 'RIDD \u00b7 company total'),
          el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-muted)' } }, 'Every office and team rolled into one report'))),
      dl);
  })();
  const rosterRow = (() => {
    const dl = el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: async () => {
        dl.disabled = true; dl.textContent = '…';
        try { await exportManageTeamsXlsx(); }
        catch (err) { console.error('[ridd] roster export threw', err); toast('Export failed: ' + (err.message || 'unknown'), 'error'); }
        finally { dl.disabled = false; dl.textContent = 'Download .xlsx'; }
      },
    }, 'Download .xlsx');
    return el('div', {
      class: 'flex items-center justify-between gap-3 px-4 py-2.5 border-b',
      style: { borderColor: 'var(--border)', background: 'var(--card-2)' },
    },
      el('div', { class: 'flex items-center gap-3 min-w-0' },
        el('span', { style: { width: '28px', height: '28px', borderRadius: '50%', background: 'var(--text)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: '0' } }, '\ud83d\udcca'),
        el('div', { class: 'min-w-0' },
          el('div', { class: 'font-semibold truncate' }, 'Roster \u00b7 Excel'),
          el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-muted)' } }, 'One tab per team + Summary \u00b7 opens in Google Sheets with tabs intact'))),
      dl);
  })();
  const paint = () => {
    const items = itemsFor(mode);
    const lab = labelOf(mode);
    title.textContent = '📄 ' + lab + ' Reports';
    subline.textContent = 'PDF per ' + lab.toLowerCase() + ' · ' + (ctx.windowLabel || 'current window') + ' · '
      + (mode === 'rep' ? 'stats, ranks vs every rep, breakdown' : 'charts, ranks, top reps');
    searchWrap.style.display = mode === 'rep' ? '' : 'none';
    search.value = '';
    list.innerHTML = '';
    if (!items.length) list.append(el('div', { class: 'px-4 py-6 text-center text-xs text-muted- italic' }, 'No ' + lab.toLowerCase() + 's in this window.'));
    items.forEach(item => list.append(mkRow(item, mode)));
    status.textContent = '';
    // No "Download all" in Reps mode (per Isaac — 40+ PDFs at once is a mess).
    // (All-offices-one-PDF retired — the RIDD row above covers the company view.)
  };

  const modeSelect = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
    title: 'Which grouping to report on — one PDF per team, office, or individual rep',
    onchange: (e) => { mode = e.target.value; paint(); },
  }, ...MODES.map(([v, l]) => el('option', { value: v, selected: v === mode }, l)));

  // ONE PDF with every team / office on its own page (per Isaac) — replaces
  // the old Download-all that fired a separate file per group. Hidden in
  // Reps mode.
  downloadAllBtn = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: async () => {
      const m = mode, items = itemsFor(m);
      if (!items.length) return;
      downloadAllBtn.disabled = true; modeSelect.disabled = true; downloadAllBtn.textContent = 'Generating…';
      try {
        await downloadCombinedTeamPdf(items, ctxFor(m), (nm, i, n) => { status.textContent = 'Adding ' + nm + ' (' + (i + 1) + '/' + n + ')…'; });
        status.textContent = 'Done — one PDF, ' + items.length + ' pages.';
      } finally {
        modeSelect.disabled = false;
        downloadAllBtn.disabled = false; downloadAllBtn.textContent = allLabel(m);
      }
    },
  }, '📄 All offices · one PDF');

  // Search strip — only shown in Reps mode (rosters run long).
  const searchWrap = el('div', { class: 'px-4 pt-3 pb-2 border-b', style: { borderColor: 'var(--border)' } }, search);
  const card = el('div', {
    class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col',
    style: { maxHeight: 'calc(100vh - 64px)' },
  },
    el('div', { class: 'flex items-center justify-between gap-3 px-5 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'min-w-0' }, title, subline),
      el('div', { class: 'flex items-center gap-2 shrink-0' },
        modeSelect,
        el('button', { class: 'text-2xl leading-none text-muted- cursor-pointer', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
    ),
    lbRow,
    rosterRow,
    riddRow,
    searchWrap,
    list,
    el('div', { class: 'flex items-center justify-between gap-3 px-5 py-3 border-t', style: { borderColor: 'var(--border)' } },
      status,
    ),
  );
  paint();

  overlay.append(card);
  document.body.append(overlay);
}

// ── Manage Teams export ──────────────────────────────────────────────────
// One-click export of the full Manage Teams roster as a multi-tab .xlsx.
// Google Sheets imports .xlsx natively with tabs intact, so the manager
// receiving the file can open it in Sheets and immediately see one tab
// per team. SheetJS is lazy-loaded on the first export so the rest of
// the app doesn't pay the bundle-size cost.
let _xlsxLibLoadPromise = null;
function loadXlsxLibOnce() {
  if (_xlsxLibLoadPromise) return _xlsxLibLoadPromise;
  _xlsxLibLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { _xlsxLibLoadPromise = null; reject(new Error('Failed to load SheetJS')); };
    document.head.append(s);
  });
  return _xlsxLibLoadPromise;
}

async function exportManageTeamsXlsx() {
  try {
    await loadXlsxLibOnce();
  } catch {
    toast('Could not load Excel library — check your connection', 'error');
    return;
  }
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel library missing after load', 'error'); return; }

  // Union every rep name we know about so the export reflects the same
  // roster Manage Teams shows on screen (CSV uploads + team assignments
  // + tier assignments + office assignments).
  const allRepNames = new Set([
    ...(state._indicatorRawSales || []).map(s => s.rep).filter(Boolean),
    ...Object.keys(state._indicatorRepTeam   || {}),
    ...Object.keys(state._indicatorRepTier   || {}),
    ...Object.keys(state._indicatorRepOffice || {}),
  ]);

  // Per-rep sales stats so the manager can sanity-check who's actually
  // producing vs who's been on the roster without a sale.
  const repStats = {};
  (state._indicatorRawSales || []).forEach(s => {
    if (!s.rep) return;
    if (!repStats[s.rep]) repStats[s.rep] = { sales: 0, revenue: 0, lastSale: '' };
    const r = repStats[s.rep];
    r.sales++;
    r.revenue += Number(s.contractValue || 0);
    const day = (s.dateSold || '').split(' ')[0];
    if (day && (!r.lastSale || new Date(day) > new Date(r.lastSale))) r.lastSale = day;
  });

  // Bucket by team. (unassigned) lands as its own group at the end so
  // the manager can review and assign without missing anyone.
  const byTeam = {};
  [...allRepNames].forEach(name => {
    const team = getRepTeam(name) || '(unassigned)';
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push({
      name,
      tier:   getRepTier(name) || '',
      office: getRepOffice(name) || '',
      active: isRepActive(name),
      excluded: isTeamExcluded(team),
      ...(repStats[name] || { sales: 0, revenue: 0, lastSale: '' }),
    });
  });
  Object.values(byTeam).forEach(arr => arr.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

  // Real teams alphabetically, then (unassigned) at the bottom.
  const teamNames = Object.keys(byTeam).sort((a, b) => {
    if (a === '(unassigned)') return 1;
    if (b === '(unassigned)') return -1;
    return a.localeCompare(b);
  });

  const wb = XLSX.utils.book_new();

  // Summary tab — one row per team with cohort counts. First thing the
  // manager sees when they open the file.
  const summaryRows = [
    ['RIDD · Manage Teams Export'],
    ['Generated', new Date().toLocaleString('en-US')],
    [],
    ['Team', 'Reps', 'Rookies', 'Vets', 'Untagged', 'Active', 'Inactive', 'Excluded from metrics'],
  ];
  let totals = { reps: 0, rookies: 0, vets: 0, untagged: 0, active: 0, inactive: 0 };
  teamNames.forEach(team => {
    const reps = byTeam[team];
    const rookies  = reps.filter(r => r.tier === 'rookie').length;
    const vets     = reps.filter(r => r.tier === 'vet').length;
    const untagged = reps.filter(r => !r.tier).length;
    const active   = reps.filter(r => r.active).length;
    const inactive = reps.length - active;
    const excluded = isTeamExcluded(team) ? 'Yes' : 'No';
    summaryRows.push([team, reps.length, rookies, vets, untagged, active, inactive, excluded]);
    totals.reps     += reps.length;
    totals.rookies  += rookies;
    totals.vets     += vets;
    totals.untagged += untagged;
    totals.active   += active;
    totals.inactive += inactive;
  });
  summaryRows.push(['Total', totals.reps, totals.rookies, totals.vets, totals.untagged, totals.active, totals.inactive, '']);
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 18 }, { wch: 7 }, { wch: 9 }, { wch: 7 }, { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  // Per-team tabs.
  teamNames.forEach(team => {
    const reps = byTeam[team];
    const headerRows = [
      [team + (isTeamExcluded(team) ? ' (Excluded from metrics)' : '')],
      [reps.length + ' rep' + (reps.length === 1 ? '' : 's')],
      [],
      ['#', 'Rep Name', 'Tier', 'Team', 'Office', 'Active', 'Sales', 'Revenue', 'Last Sale'],
    ];
    const dataRows = reps.map((r, i) => [
      i + 1,
      r.name,
      r.tier === 'rookie' ? 'Rookie' : r.tier === 'vet' ? 'Vet' : '',
      team === '(unassigned)' ? '' : team,
      r.office,
      r.active ? 'Active' : 'Inactive',
      r.sales,
      r.revenue,
      r.lastSale,
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([...headerRows, ...dataRows]);
    sheet['!cols'] = [{ wch: 4 }, { wch: 26 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 7 }, { wch: 12 }, { wch: 12 }];
    // Excel sheet names: max 31 chars, no / \ ? * [ ] :
    const safeName = (team === '(unassigned)' ? 'Unassigned' : team)
      .replace(/[/\\?*\[\]:]/g, '_')
      .slice(0, 31);
    XLSX.utils.book_append_sheet(wb, sheet, safeName);
  });

  const filename = 'RIDD-Manage-Teams-' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, filename);
  toast('Exported ' + teamNames.length + ' team tab' + (teamNames.length === 1 ? '' : 's'), 'success');
}

// Flat, CRM-ready export of every rep's Rookie/Vet tier. One row per rep with
// the FieldRoutes employee id + username so the values can be loaded back into
// the CRM (which then becomes the source of truth for tier). Tier is global
// (not year-scoped), so this lists the whole roster regardless of Team Year.
async function exportTiersXlsx() {
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel library missing after load', 'error'); return; }
  // Pull the CRM roster so we can stamp each rep with their FieldRoutes id /
  // username for matching on import.
  if (state.frRoster == null && typeof loadFieldRoutesRoster === 'function') { try { await loadFieldRoutesRoster(); } catch (_) {} }
  const roster = state.frRoster || [];
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const empBySig = {};
  roster.forEach(e => {
    const cands = [(typeof _frEmpName === 'function') ? _frEmpName(e) : '', (typeof _frRealName === 'function') ? _frRealName(e) : ''];
    cands.forEach(c => { const s = _sig(c); if (s && !empBySig[s]) empBySig[s] = e; });
  });
  const names = new Set([
    ...(state._indicatorRawSales || []).map(s => s.rep).filter(Boolean),
    ...Object.keys(state._indicatorRepTier   || {}),
    ...Object.keys(state._indicatorRepTeam   || {}),
    ...Object.keys(state._indicatorRepOffice || {}),
  ]);
  const rows = [...names]
    .filter(n => !(typeof getRepAliasTarget === 'function' && getRepAliasTarget(n)))  // drop merged duplicates
    .map(n => {
      const e = empBySig[_sig(n)];
      const t = getRepTier(n);
      return {
        name: n,
        tier: t === 'rookie' ? 'Rookie' : t === 'vet' ? 'Vet' : '',
        empId: e ? (e.employee_id || '') : '',
        username: e ? (e.username || '') : '',
        type: (e && e.type_label) || '',
        office: getRepOffice(n) || (e && e.office_name) || '',
        team: getRepTeam(n) || '',
        active: isRepActive(n) ? 'Active' : 'Inactive',
        matched: e ? 'Yes' : 'No',
      };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const tagged = rows.filter(r => r.tier).length;
  const header = ['Rep Name', 'Tier', 'FieldRoutes Employee ID', 'FieldRoutes Username', 'Rep Type', 'Branch / Office', 'Team', 'Active', 'Matched in CRM'];
  const aoa = [
    ['RIDD · Rep Tier Export (Rookie / Vet)'],
    ['Generated', new Date().toLocaleString('en-US')],
    [rows.length + ' reps · ' + tagged + ' tagged Rookie/Vet · ' + (rows.length - tagged) + ' untagged'],
    ['Load these tiers into FieldRoutes per employee, then the app can read tier back from the CRM as the source of truth.'],
    [],
    header,
    ...rows.map(r => [r.name, r.tier, r.empId, r.username, r.type, r.office, r.team, r.active, r.matched]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 26 }, { wch: 8 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 9 }, { wch: 13 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Rep Tiers');
  XLSX.writeFile(wb, 'RIDD-Rep-Tiers-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('Exported ' + rows.length + ' reps (' + tagged + ' tagged)', 'success');
}

// Per-week values for the small-multiples grid (Revenue, Sales, ACV, Avg Pest,
// MY %). Reused by both the per-rep drill panel and the scope (Company /
// Branch / Team) panel — anything with a list of sales can plot against this.
function buildTrendMiniGrid(sales, chartBuckets, idPrefix, accentColor, overlay, opts = {}) {
  const REP_AVG_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;
  const metrics = [
    { id: 'revenue',   label: 'Revenue',          isCurrency: true,  format: v => '$' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1000 ? Math.round(v/1000) + 'K' : v) },
    { id: 'count',     label: 'Sales',            isCurrency: false, format: v => String(v) },
    { id: 'acv',       label: 'ACV',              isCurrency: true,  format: v => '$' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1000 ? Math.round(v/1000) + 'K' : v) },
    { id: 'avg_pest',  label: 'Avg Pest Initial', isCurrency: true,  format: v => '$' + Math.round(v) },
    { id: 'my_pct',    label: 'MY %',             isCurrency: false, format: v => (v * 100).toFixed(0) + '%' },
  ];

  const lineColor = accentColor || 'var(--accent)';
  const fillColor = accentColor ? _hexToRgba(accentColor, 0.15) : 'rgba(223,100,58,.15)';

  // Take a sales array → metric value for a given bucket. Now sales-set is a
  // parameter so the overlay (when present) can compute against a different
  // population (e.g. just one rep's sales) on the same bucket boundaries.
  const valueAt = (metricId, bucket, srcSales) => {
    const bucketSales = (srcSales || []).filter(bucket.match);
    if (bucketSales.length === 0) return 0;
    if (metricId === 'revenue') return bucketSales.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    if (metricId === 'count')   return bucketSales.length;
    if (metricId === 'avg_pest') {
      const eligible = bucketSales.filter(s => !REP_AVG_PEST_EXCLUDE.test(s.subscription || ''));
      if (eligible.length === 0) return 0;
      return eligible.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / eligible.length;
    }
    if (metricId === 'my_pct') {
      const twelve = bucketSales.filter(s => myBucketOf(s) === 'twelve').length;
      const multi  = bucketSales.filter(s => myBucketOf(s) === 'multi').length;
      const total  = twelve + multi;
      return total > 0 ? multi / total : 0;
    }
    // acv
    const rev = bucketSales.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    return bucketSales.length > 0 ? rev / bucketSales.length : 0;
  };

  // TREND RULE: if the LAST bucket includes today it's still filling in —
  // slice it off so a partial period never plots as a collapse. Tested via
  // the bucket's own matcher with a synthetic sale dated today (date-based
  // buckets match; week-number buckets no-op harmlessly).
  const _lastLive = (() => {
    try {
      const lb = chartBuckets[chartBuckets.length - 1];
      if (!lb || !lb.match) return false;
      const t = new Date();
      return !!lb.match({ dateSold: (t.getMonth() + 1) + '/' + t.getDate() + '/' + t.getFullYear() });
    } catch (e) { return false; }
  })();
  if (_lastLive && chartBuckets.length > 1) chartBuckets = chartBuckets.slice(0, -1);
  const labels = chartBuckets.map(b => b.label);

  const buildMini = (metric) => {
    const id = idPrefix + '-' + metric.id;
    const wrap = el('div', { class: 'rounded-lg border p-2', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } });
    // One tall chart now (the metric dropdown above names it) instead of
    // five stacked 120px minis — mobile reps were scrolling forever.
    const cvsWrap = el('div', { style: { position: 'relative', height: '220px', width: '100%' } });
    const cvs = el('canvas', { id });
    cvsWrap.append(cvs);
    wrap.append(cvsWrap);

    setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      const cvsEl = document.getElementById(id);
      if (!cvsEl) return;
      if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
      const isDark = state.theme === 'dark';
      const tickColor = isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)';
      const datasets = [{
        label: metric.label,
        data: chartBuckets.map(b => valueAt(metric.id, b, sales)),
        borderColor: lineColor,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
        // Plot on the LEFT axis when an overlay is present so two
        // wildly-different scales (e.g. company $500K vs rep $20K) can
        // both render usefully.
        yAxisID: overlay ? 'y' : undefined,
      }];
      if (overlay) {
        datasets.push({
          label: overlay.label,
          data: chartBuckets.map(b => valueAt(metric.id, b, overlay.sales)),
          borderColor: overlay.color,
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 4,
          borderWidth: 2,
          borderDash: [5, 4],
          // Sales-count + percent metrics share the left axis (numbers stay
          // in similar magnitude); dollar amounts use a secondary right axis
          // so the rep's pattern is visible at their own scale.
          yAxisID: (metric.id === 'count' || metric.id === 'my_pct') ? 'y' : 'y2',
        });
      }
      const yAxes = { y: { beginAtZero: true, ticks: { font: { size: 9 }, color: tickColor, maxTicksLimit: 4, callback: metric.format } } };
      if (overlay && metric.id !== 'count' && metric.id !== 'my_pct') {
        yAxes.y2 = {
          beginAtZero: true,
          position: 'right',
          grid: { display: false },
          ticks: { font: { size: 9 }, color: overlay.color, maxTicksLimit: 4, callback: metric.format },
        };
      }
      _chartInstances[id] = new Chart(cvsEl.getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#323230', bodyFont: { size: 10 }, padding: 6, cornerRadius: 6,
              displayColors: !!overlay,
              callbacks: { label: (ctx) => (overlay ? ctx.dataset.label + ': ' : '') + metric.format(ctx.parsed.y) },
            },
          },
          scales: Object.assign({
            x: { grid: { display: false }, ticks: { font: { size: 8 }, color: tickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
          }, yAxes),
        },
      });
    }, 150);

    return wrap;
  };

  // ONE chart + a metric dropdown (was a grid of five minis — each chart
  // stacked full-width on mobile, burying everything below it). The pick
  // persists in state._miniTrendMetric and swaps the chart in place, no
  // full re-render, so this works inside modals too.
  const chosen = () => metrics.find(m => m.id === (state._miniTrendMetric || 'revenue')) || metrics[0];
  const chartHolder = el('div', {});
  const renderChart = () => { chartHolder.innerHTML = ''; chartHolder.append(buildMini(chosen())); };
  renderChart();
  const metricSelect = el('select', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
    onchange: (e) => { state._miniTrendMetric = e.target.value; renderChart(); },
  },
    ...metrics.map(m => el('option', { value: m.id, selected: chosen().id === m.id }, m.label)));
  // When an overlay is wired up, surface a tiny legend so the reader knows
  // which line is the scope vs which is the comparison rep.
  const legendRow = overlay ? el('div', { class: 'flex items-center gap-4 text-[10px] flex-wrap', style: { color: 'var(--text-muted)' } },
    el('div', { class: 'flex items-center gap-1.5' },
      el('span', { style: { display: 'inline-block', width: '18px', height: '2px', background: lineColor } }),
      el('span', {}, 'Scope'),
    ),
    el('div', { class: 'flex items-center gap-1.5' },
      el('span', { style: { display: 'inline-block', width: '18px', height: '0', borderTop: '2px dashed ' + overlay.color } }),
      el('span', {}, overlay.label),
      el('span', { class: 'text-[9px] italic', style: { color: 'var(--text-subtle)' } }, '(right axis on $ metrics)'),
    ),
  ) : null;
  // Hoisted mode: the caller owns a header row (the card title row) — the
  // metric picker + Compare cluster mount THERE, and this block is just the
  // legend (compare mode) + chart.
  if (opts.controlsInto) {
    opts.controlsInto.append(metricSelect, opts.rightNode || el('span', {}));
    return el('div', { class: 'flex flex-col gap-2' }, legendRow, chartHolder);
  }
  metricSelect.style.order = '99';
  return el('div', { class: 'flex flex-col gap-2' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
      opts.titleNode || (overlay ? null : el('div', { class: 'flex-1' })),
      opts.rightNode ? el('div', { class: 'flex items-center gap-2 flex-wrap', style: { order: '98', marginLeft: 'auto' } }, opts.rightNode) : null,
      metricSelect,
      legendRow,
    ),
    chartHolder,
  );
}

// Mini per-metric trend charts for one rep, rendered as small multiples.
// ── Rep landing player card (#4) ─────────────────────────────────────────
// The FIRST thing a rep sees: their own YTD stats in player-card form.
// First-run card (rep home) — a brand-new or unmatched rep never sees a
// silent blank page. Distinguishes "linked, just no sales yet" from "we
// can't match you to the CRM" so the fix is obvious in both cases.
function _repFirstRunCard() {
  const matched = myRepNameSet().size > 0;
  const first = ((state.profile && state.profile.full_name) || '').split(/\s+/)[0] || 'there';
  return el('div', { class: 'card p-6 flex flex-col items-center text-center gap-2' },
    el('div', { class: 'text-3xl' }, matched ? '\ud83d\udc4b' : '\ud83d\udd0d'),
    el('div', { class: 'text-lg font-bold' }, matched ? ('Welcome, ' + first + '!') : 'Almost set up'),
    el('div', { class: 'text-sm max-w-md', style: { color: 'var(--text-muted)' } },
      matched
        ? 'No production on the board yet this year \u2014 your next sale shows up here within a day of the CRM sync. Until then, check out the leaderboard and competitions.'
        : 'Your login works, but we haven\u2019t matched you to any CRM sales yet. If you\u2019ve already made sales, your name may be spelled differently in FieldRoutes \u2014 ask an admin to link your account on the Users screen.'));
}

// Tap anywhere → the full player card modal (records, drills, charts).
// Attrition for the landing cards — same definition as the player card's
// "Attrition · incl. 3-day ROR" tile (per Isaac): cancelled ÷ serviced
// contract value, 3-day RORs and one-time services included on both sides. Runs on
// the rep/team's full book (not just YTD) so it reads as a real rate.
// Landing-card tiles: every tile drills to the accounts behind it (per
// Isaac — partners want to see what's contributing). Click stops at the tile
// so the card's own click (full player card) doesn't also fire.
function _landingTile(who, showRep) {
  return (label, value, rows, subtitle) => el('div', {
    class: 'rounded-lg border p-2.5 text-center' + (rows ? ' cursor-pointer transition hover:brightness-95' : ''),
    style: { borderColor: 'var(--border)', background: 'var(--card-2)' },
    title: rows ? 'See the accounts behind ' + label : undefined,
    onclick: rows ? (e) => { e.stopPropagation(); openLandingTileDrill(who + ' \u00b7 ' + label, subtitle || '', rows, { showRep }); } : undefined,
  },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-muted)' } }, label),
    el('div', { class: 'text-base font-bold tabular-nums mt-0.5' }, value));
}
function _landingTiles(tile, m) {
  const yr = new Date().getFullYear();
  const ytdLabel = yr + ' YTD';
  const multi = m.ytd.filter(s => myBucketOf(s) === 'multi');
  const twelve = m.ytd.filter(s => myBucketOf(s) === 'twelve');
  const apayOn = m.ytd.filter(s => s.autoPay && s.autoPay !== 'No');
  const cxl = m.ytd.filter(s => (typeof _repCancelCounts === 'function') ? _repCancelCounts(s) : !!s.cancelDate);
  const attrRows = _landingAttritionRows(m.ytd);
  return [
    tile('Sales', fmt.int(m.count), m.ytd, ytdLabel),
    tile('Revenue/Day', m.sellDays ? fmt.usd0(m.revenue / m.sellDays) : '\u2014', m.ytd, fmt.usd0(m.revenue) + ' over ' + m.sellDays + ' selling days'),
    tile('Accts/Day', m.sellDays ? (m.count / m.sellDays).toFixed(1) : '\u2014', m.ytd, m.count + ' accounts over ' + m.sellDays + ' selling days'),
    tile('ACV', m.count ? fmt.usd(m.revenue / m.count) : '\u2014', m.ytd, fmt.usd0(m.revenue) + ' \u00f7 ' + m.count + ' accounts'),
    tile('Avg Pest', m.avgPest > 0 ? fmt.usd(m.avgPest) : '\u2014', m.pest, 'pest accounts (Sentricon, German roach, interior flea excluded) \u00b7 avg initial'),
    tile('MY %', (m.myPct * 100).toFixed(1) + '%', multi, multi.length + ' multi-year of ' + (multi.length + twelve.length) + ' (multi + 12-month)'),
    tile('Auto Pay', (m.apay * 100).toFixed(1) + '%', apayOn, apayOn.length + ' of ' + m.count + ' on autopay'),
    tile('Attrition', m.attrPct == null ? '\u2014' : (m.attrPct * 100).toFixed(1) + '%', attrRows.cancelled, 'cancelled \u00f7 serviced by contract value, incl. 3-day ROR + one-time \u00b7 ' + attrRows.cancelled.length + ' of ' + attrRows.serviced.length + ' serviced'),
    tile('Cancels', String(m.cancels), cxl, 'counted cancels (excluded reasons removed)'),
  ];
}
function _landingAttritionRows(rows) {
  const out = { serviced: [], cancelled: [] };
  try {
    const _svcR = (x) => (Number(x.services) || 0) > 0 || !!x.servicedDate;
    const _actR = (x) => (x.status || '').toLowerCase() === 'active' || ((x.status || '') === '' && _subAliveNow(x) === true);
    const _cxlR = (x) => !!x.cancelDate && !_actR(x);
    const _ror = (x) => _is3DayROR(x) && !_isSoldNotStarted(x);
    const _isOTS = (x) => {
      if (/^\s*one[\s-]?time/i.test(String(x.subscription || ''))) return true;
      const m = Number(x.contract);
      return !(m > 1) && !/sentricon/i.test(String(x.subscription || ''));
    };
    for (const x of rows || []) {
      if (!_svcR(x)) continue;
      out.serviced.push(x);
      if (_cxlR(x)) out.cancelled.push(x);
    }
  } catch { /* fall through */ }
  return out;
}

function _landingAttritionPct(rows) {
  // ONE attrition definition (per Isaac): the same _attrRevParts the
  // leaderboard "Attrition %" and the player card use — cancelled $ ÷
  // serviced $, with 3-day RORs and one-time services out of both sides.
  // (This tile used to define those exclusions and then not apply them,
  // so a rep saw two different "Attrition" numbers on one page.)
  try {
    let serv = 0, cxl = 0;
    for (const x of rows || []) { const p = _attrRevParts(x); serv += p.serv; cxl += p.cxl; }
    return serv > 0 ? cxl / serv : null;
  } catch { return null; }
}

function repLandingPlayerCard(opts) {
  try {
    const _hdrExtra = (opts && opts.headerExtra) || null;
    const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const mine = _sig(state.profile && state.profile.full_name);
    if (!mine && !myRepNameSet().size) return _repFirstRunCard();
    const yr = String(new Date().getFullYear());
    const all = (state._indicatorRawSales || []).filter(s =>
      s && s.rep && frPendingServiced(s) && (isMyRepName(s.rep) || _sig(getCanonicalRepName(s.rep)) === mine));
    const ytd = all.filter(s => {
      const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
      return iso && iso.slice(0, 4) === yr;
    });
    if (!ytd.length) return _repFirstRunCard(); // never a silent blank page
    const name = getCanonicalRepName(ytd[0].rep);
    const revenue = ytd.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
    const count = ytd.length;
    const sellDays = new Set(ytd.map(s => dateSoldToIso(s.dateSold)).filter(Boolean)).size;
    const PEST_RE = /sentricon|german\s*roach|interior\s*flea/i;
    const pest = ytd.filter(s => !PEST_RE.test(s.subscription || ''));
    const avgPest = pest.length ? pest.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / pest.length : 0;
    const multi = ytd.filter(s => myBucketOf(s) === 'multi').length;
    const twelve = ytd.filter(s => myBucketOf(s) === 'twelve').length;
    const myPct = (multi + twelve) > 0 ? multi / (multi + twelve) : 0;
    const apay = count ? ytd.filter(s => s.autoPay && s.autoPay !== 'No').length / count : 0;
    const cancels = ytd.filter(s => (typeof _repCancelCounts === 'function') ? _repCancelCounts(s) : !!s.cancelDate).length;
    const attrPct = _landingAttritionPct(ytd);
    const team = getRepTeam(name);
    const teamColor = team ? getTeamColor(team) : null;
    const tierMeta = (typeof repTierMeta === 'function') ? repTierMeta(getRepTier(name)) : null;
    const office = (ytd[0].office || '').split(' ').map(w => (w[0] || '').toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const initials = name.split(/[\s,]+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase();
    const repObj = { name, office: ytd[0].office || '', team, tier: getRepTier(name), sales: all, revenue: all.reduce((a, s) => a + (Number(s.contractValue) || 0), 0) };

    const tile = _landingTile(name, false);

    return el('div', {
      class: 'card p-4 sm:p-5 cursor-pointer transition hover:brightness-95',
      style: { borderLeftWidth: '4px', borderLeftColor: teamColor || 'var(--accent)' },
      onclick: () => openIndicatorRepCard(repObj, []),
      title: 'Open your full player card — records, accounts, drill-downs',
    },
      el('div', { class: 'flex items-start gap-3 mb-3' },
        (typeof avatarNode === 'function') ? avatarNode(state.profile.avatar_url || null, initials, 'w-12 h-12 text-base') : null,
        el('div', { class: 'min-w-0 flex-1' },
          el('div', { class: 'flex items-center gap-2 flex-wrap' },
            el('span', { class: 'text-lg font-bold truncate' }, name),
            tierMeta && el('span', {
              class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
              style: { background: tierMeta.color + '22', color: tierMeta.color },
            }, tierMeta.label),
            // Revenue rides right beside the name (THE number) — pulled out
            // of the tile grid so the remaining 9 tiles fill even 3-per-row
            // rows on mobile.
            el('span', { class: 'text-2xl leading-none font-black tabular-nums ml-1' }, fmt.usd0(revenue)))),
        // Right column, pinned top-right: Team | Me toggle over the link
        // (per Isaac — the toggle used to float mid-row on phones).
        el('div', { class: 'flex flex-col items-end gap-1.5 shrink-0 self-start ml-auto' },
          _hdrExtra,
          el('span', { class: 'text-[11px] font-bold shrink-0', style: { color: 'var(--accent)' } }, 'Player card →'))),
      el('div', { class: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))' } },
        ..._landingTiles(tile, { ytd, count, revenue, sellDays, avgPest, pest, myPct, apay, attrPct, cancels }),
      ),
    );
  } catch (e) { console.warn('[ridd] rep landing card failed', e); return null; }
}

// Team player card (per Isaac, Sep 2026): partners live in their team's
// numbers, so every team they reach (Settings → Users → Teams led, or their
// own assignment) gets a card under their own — same tiles, same click-through
// to a full player card (entity mode: every drill runs on the pooled sales).
function teamLandingPlayerCards(opts) {
  try {
    const _hdrExtra = (opts && opts.headerExtra) || null;
    if (typeof myReachTeams !== 'function') return [];
    const teams = [...myReachTeams()].filter(Boolean).slice(0, 4);
    if (!teams.length) return [];
    const yr = String(new Date().getFullYear());
    const PEST_RE = /sentricon|german\s*roach|interior\s*flea/i;
    const pool = (state._indicatorRawSales || []).filter(s => s && s.rep && frPendingServiced(s));
    const teamOf = (s) => getRepTeam(getCanonicalRepName(s.rep)) || '';
    return teams.map((team, i) => {
      const all = pool.filter(s => teamOf(s) === team);
      const ytd = all.filter(s => { const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : ''; return iso && iso.slice(0, 4) === yr; });
      const revenue = ytd.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
      const count = ytd.length;
      const reps = new Set(ytd.map(s => getCanonicalRepName(s.rep))).size;
      const sellDays = new Set(ytd.map(s => dateSoldToIso(s.dateSold)).filter(Boolean)).size;
      const pest = ytd.filter(s => !PEST_RE.test(s.subscription || ''));
      const avgPest = pest.length ? pest.reduce((a, s) => a + (Number(s.initialPrice) || 0), 0) / pest.length : 0;
      const multi = ytd.filter(s => myBucketOf(s) === 'multi').length;
      const twelve = ytd.filter(s => myBucketOf(s) === 'twelve').length;
      const myPct = (multi + twelve) > 0 ? multi / (multi + twelve) : 0;
      const apay = count ? ytd.filter(s => s.autoPay && s.autoPay !== 'No').length / count : 0;
      const cancels = ytd.filter(s => (typeof _repCancelCounts === 'function') ? _repCancelCounts(s) : !!s.cancelDate).length;
      const attrPct = _landingAttritionPct(ytd);
      const color = getTeamColor(team) || 'var(--accent)';
      const initials = String(team).split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const entity = { name: team, team, office: '', tier: '', sales: all, revenue: all.reduce((a, s) => a + (Number(s.contractValue) || 0), 0), _entity: 'team' };
      const tile = _landingTile(team + ' team', true);
      return el('div', {
        class: 'card p-4 sm:p-5 cursor-pointer transition hover:brightness-95',
        style: { borderLeftWidth: '4px', borderLeftColor: color },
        onclick: () => openIndicatorRepCard(_scopeRep(entity, () => true), []),
        title: 'Open the team’s player card — pooled records, accounts, drill-downs',
      },
        el('div', { class: 'flex items-start gap-3 mb-3' },
          el('div', { class: 'w-12 h-12 rounded-full flex items-center justify-center text-base font-black shrink-0', style: { background: color, color: '#fff' } }, initials),
          el('div', { class: 'min-w-0 flex-1' },
            el('div', { class: 'flex items-center gap-2 flex-wrap' },
              el('span', { class: 'text-lg font-bold truncate' }, team),
              el('span', { class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', style: { background: color + '22', color } }, 'Team'),
              el('span', { class: 'text-2xl leading-none font-black tabular-nums ml-1' }, fmt.usd0(revenue))),
            el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, reps + ' rep' + (reps === 1 ? '' : 's') + ' with a sale this year')),
          el('div', { class: 'flex flex-col items-end gap-1.5 shrink-0 self-start ml-auto' },
            i === 0 ? _hdrExtra : null,
            el('span', { class: 'text-[11px] font-bold shrink-0', style: { color: 'var(--accent)' } }, 'Team card →'))),
        el('div', { class: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))' } },
          ..._landingTiles(tile, { ytd, count, revenue, sellDays, avgPest, pest, myPct, apay, attrPct, cancels })));
    });
  } catch (e) { console.warn('[ridd] team landing card failed', e); return []; }
}

// One landing card for partners / office leads: TEAM stats by default (the
// numbers they actually live in), with a Team | Me toggle in the header to
// flip to their personal player card. Falls back to the personal card when
// they don't reach a team. Choice persists per browser.
function partnerLandingCard() {
  try {
    const leadRole = (typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role))
      || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role));
    const teams = (leadRole && typeof myReachTeams === 'function') ? [...myReachTeams()].filter(Boolean) : [];
    if (!teams.length) return repLandingPlayerCard();
    let view = 'team';
    try { view = localStorage.getItem('ridd_partner_card_view') === 'me' ? 'me' : 'team'; } catch { /* private mode */ }
    const wrap = el('div', { class: 'flex flex-col gap-4' });
    const paint = () => {
      const toggle = el('div', {
        class: 'inline-flex rounded-lg border overflow-hidden shrink-0 text-[10px] font-bold uppercase tracking-wider',
        style: { borderColor: 'var(--border-2)' },
        onclick: (e) => e.stopPropagation(),
      }, ...[['team', 'Team'], ['me', 'Me']].map(([v, label]) => el('button', {
        class: 'px-2.5 py-1 transition',
        style: view === v
          ? { background: 'var(--accent)', color: 'var(--accent-text)' }
          : { background: 'var(--card)', color: 'var(--text-muted)' },
        onclick: (e) => {
          e.stopPropagation();
          if (view === v) return;
          view = v;
          try { localStorage.setItem('ridd_partner_card_view', v); } catch { /* ignore */ }
          paint();
        },
      }, label)));
      const nodes = view === 'team'
        ? teamLandingPlayerCards({ headerExtra: toggle })
        : [repLandingPlayerCard({ headerExtra: toggle })];
      wrap.replaceChildren(...nodes.filter(Boolean));
    };
    paint();
    return wrap;
  } catch (e) { console.warn('[ridd] partner landing card failed', e); return repLandingPlayerCard(); }
}

function repDrillPanel(rep, chartBuckets, titleNode) {
  const team = getRepTeam(rep.name);
  const accent = team ? getTeamColor(team) : null;
  const idPrefix = 'chart-rep-drill-' + rep.name.replace(/\s+/g, '-');
  // (Stats chips + office/sales/revenue sub-line removed — the player card
  // owns those numbers, properly scoped. This panel is charts only.)
  // titleNode: rep-locked mode passes the card's own heading so the title
  // and metric picker share one row ("You" is implied — no name needed);
  // admin rep-drills keep the 👤 name (and the divider above the panel).
  return el('div', titleNode ? {} : { class: 'mt-4 pt-4 border-t', style: { borderColor: 'var(--border)' } },
    buildTrendMiniGrid(rep.sales, chartBuckets, idPrefix, accent, null, {
      titleNode: titleNode || el('h4', { class: 'text-sm font-bold' }, '👤 ' + rep.name),
    }),
  );
}

// Default panel shown when no rep is drilled in. Same small-multiples grid,
// but aggregated to a chosen scope: Company (everyone), a single Branch, or
// a single Team. Scope persists across reloads. Per the project rule,
// excluded-team reps are dropped ONLY when the scope is 'team' — branch and
// company views show every rep regardless of team-exclusion status.
function scopeDrillPanel(scope, allScopedSales, chartBuckets, compareRep, panelOpts = {}) {
  // Available branches and teams for the picker
  const branches = [...new Set((allScopedSales || []).map(s => s.office).filter(Boolean))].sort();
  const teams = distinctTeams().filter(t => !isTeamExcluded(t));
  const titleCase = (s) => (s || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  // Resolve a scope spec → { sales, label, color } so the same logic powers
  // the primary scope and the optional compare overlay.
  const resolveScope = (sc) => {
    if (!sc) return null;
    if (sc.type === 'team') {
      const t = sc.value;
      return {
        sales: (allScopedSales || []).filter(s => (getRepTeam(s.rep) || 'Unassigned') === t),
        label: t,
        color: getTeamColor(t),
      };
    }
    if (sc.type === 'branch') {
      return {
        sales: (allScopedSales || []).filter(s => s.office === sc.value),
        label: titleCase(sc.value),
        color: BRANCH_COLORS[sc.value] || BRANCH_COLORS[String(sc.value).toUpperCase()] || null,
      };
    }
    return { sales: allScopedSales || [], label: 'Company', color: null };
  };

  const primary = resolveScope(scope);
  let scopedSales = primary.sales;
  let label = primary.label;
  let scopeColor = primary.color;

  const reps = new Set(scopedSales.map(s => s.rep).filter(Boolean)).size;
  const rev = scopedSales.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
  const sublabel = (scope.type === 'company'
      ? 'All branches and teams'
      : scope.type === 'branch' ? 'Office' : 'Team')
    + ' · ' + reps + ' rep' + (reps === 1 ? '' : 's')
    + ' · ' + scopedSales.length + ' sale' + (scopedSales.length === 1 ? '' : 's')
    + ' · $' + Math.round(rev).toLocaleString();

  // Compare mode is a same-type A-vs-A toggle:
  //   OFF → primary scope is Company; no overlay
  //   ON  → primary + compare are two units of the same type (branch v
  //         branch OR team v team, picked from the current indicatorsGroupBy)
  // Company is intentionally excluded from both pickers when ON — the
  // toggle's off state is the "view the company total" state.
  const compareType = state.indicatorsGroupBy === 'teams' ? 'team' : 'branch';
  const comparePool = compareType === 'team' ? teams : branches;
  const sameAsPrimary = (sc) => sc && sc.type === scope.type
    && (sc.type === 'company' || sc.value === scope.value);

  // If a saved compare now duplicates the primary (user switched scope while
  // compare was on), silently re-pick so the overlay stays meaningful.
  if (state._indicatorTrendCompare && sameAsPrimary(state._indicatorTrendCompare)) {
    const fallback = comparePool.find(x => x !== scope.value);
    state._indicatorTrendCompare = fallback ? { type: compareType, value: fallback } : null;
    saveDemoData();
  }
  const compareScope = state._indicatorTrendCompare || null;
  const compareOn = !!compareScope;
  const compareResolved = resolveScope(compareScope);

  // Compare on/off pill — small switch styled to match the surrounding pills.
  const compareToggle = el('button', {
    class: 'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition',
    style: compareOn
      ? { borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)' }
      : { borderColor: 'var(--border-2)', background: 'transparent', color: 'var(--text)' },
    title: compareOn ? 'Turn off compare — return to company-wide view' : 'Compare two ' + (compareType === 'team' ? 'teams' : 'branches'),
    onclick: () => {
      if (compareOn) {
        // OFF → Company view, no overlay.
        state._indicatorTrendCompare = null;
        state._indicatorTrendScope = { type: 'company' };
      } else {
        // ON → both sides become units of the current groupBy type. Need
        // at least 2 to be meaningful; bail otherwise with a toast.
        if (comparePool.length < 2) {
          toast('Need at least 2 ' + (compareType === 'team' ? 'teams' : 'branches') + ' to compare', 'warn');
          return;
        }
        // Keep an existing branch/team primary if it still matches the
        // current type; otherwise pick the first unit. Either way, pick a
        // compare that isn't the primary.
        let primaryVal;
        if (scope.type === compareType && comparePool.includes(scope.value)) {
          primaryVal = scope.value;
        } else {
          primaryVal = comparePool[0];
          state._indicatorTrendScope = { type: compareType, value: primaryVal };
        }
        const compareVal = comparePool.find(p => p !== primaryVal) || comparePool[0];
        state._indicatorTrendCompare = { type: compareType, value: compareVal };
      }
      saveDemoData();
      mountApp();
    },
  },
    el('span', {
      style: {
        position: 'relative', display: 'inline-block',
        width: '20px', height: '11px', borderRadius: '0',
        background: compareOn ? 'rgba(0,0,0,.25)' : 'var(--border-2)',
        transition: 'background .15s',
      },
    },
      el('span', {
        style: {
          position: 'absolute', top: '1px', left: compareOn ? '10px' : '1px',
          width: '9px', height: '9px', borderRadius: '0',
          background: compareOn ? '#fff' : 'var(--text-muted)',
          transition: 'left .15s',
        },
      }),
    ),
    'Compare',
  );

  // When compare is on, render two dropdowns — primary + compare — both
  // constrained to the current groupBy type (branch v branch OR team v
  // team). Company is intentionally absent; the toggle's OFF state is
  // the "company view". Primary defaults to whatever scope is currently
  // selected; compare excludes the primary from its options.
  const optionLabel = (x) => compareType === 'branch' ? titleCase(x) : x;
  const primarySelect = compareOn ? el('select', {
    class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold cursor-pointer bg-transparent',
    style: { borderColor: 'var(--border-2)' },
    title: 'Primary ' + (compareType === 'team' ? 'team' : 'branch'),
    onchange: (e) => {
      const newPrimary = e.target.value;
      state._indicatorTrendScope = { type: compareType, value: newPrimary };
      // Make sure the compare side isn't the same as the new primary.
      if (compareScope && compareScope.value === newPrimary) {
        const replacement = comparePool.find(p => p !== newPrimary) || comparePool[0];
        state._indicatorTrendCompare = { type: compareType, value: replacement };
      }
      saveDemoData();
      mountApp();
    },
  },
    ...comparePool.map(x => el('option', { value: x, selected: scope.value === x }, optionLabel(x))),
  ) : null;

  const compareSelect = compareOn ? el('select', {
    class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold cursor-pointer bg-transparent',
    style: { borderColor: 'var(--border-2)' },
    title: 'Compare against',
    onchange: (e) => {
      state._indicatorTrendCompare = { type: compareType, value: e.target.value };
      saveDemoData();
      mountApp();
    },
  },
    ...comparePool
      .filter(x => x !== scope.value)
      .map(x => el('option', { value: x, selected: compareScope?.value === x }, optionLabel(x))),
  ) : null;

  // Drill-panel toolbar. Off: just the toggle. On: toggle + primary + "vs"
  // + compare. The primary picker doubles as a way to switch which unit
  // you're looking at without leaving the panel.
  const scopeSelector = el('div', { class: 'flex items-center gap-2 flex-wrap' },
    compareToggle,
    compareOn && primarySelect,
    compareOn && el('span', { class: 'text-[11px] font-semibold text-muted-' }, 'vs'),
    compareOn && compareSelect,
  );

  const idPrefix = 'chart-scope-' + scope.type + '-' + (scope.value || 'all').replace(/\s+/g, '-');
  // Compare toggle + metric picker pin to the top-right corner. (The
  // "Company · All branches and teams · N reps…" scope line was dropped —
  // the Filters dropdown already names the scope; compare mode's selects
  // name their sides.)
  const _scopeTitle = null;
  return el('div', { class: 'mt-2' },
    buildTrendMiniGrid(scopedSales, chartBuckets, idPrefix, scopeColor,
      // Pick the overlay to draw against the primary scope's line. Priority:
      //   1. Scope-compare toggle in this panel (compareResolved) — when the
      //      admin explicitly picks another branch/team/company to compare.
      //   2. Rep-overlay (compareRep) — when a single rep is selected on the
      //      upper trend chart, render their per-week numbers as a dashed
      //      line on top of the scope's solid line.
      // Only one overlay renders per chart; scope-compare wins because it
      // is the more deliberate, explicit selection.
      compareResolved
        ? {
            sales: compareResolved.sales,
            color: compareResolved.color || '#5F6C5B',
            label: compareResolved.label,
          }
        : (compareRep ? {
            sales: compareRep.sales,
            color: getRepTeam(compareRep.name) ? getTeamColor(getRepTeam(compareRep.name)) : '#DF643A',
            label: compareRep.name,
          } : null),
      { titleNode: _scopeTitle, rightNode: scopeSelector, controlsInto: panelOpts.controlsInto },
    ),
  );
}

// ── YoY Trend chart ──────────────────────────────────────────────────────
// WEEKLY metric lines for the current year vs last year — the week-by-week
// shape with the year-over-year gap visible at a glance. Pick the metric
// from the dropdown (Revenue, Sales, ACV, Avg Initial, Avg Pest Initial,
// MY %, Audit %, Cancel %). Company-wide within the current department
// toggle; ignores the page's date range on purpose (always a full-year
// week-of-year axis, Sunday-anchored like everything else).
const YOY_METRICS = [
  ['revenue',     'Revenue',          'usd'],
  ['pra',         'PRA',              'usd'],
  ['count',       'Sales',            'int'],
  ['acv',         'ACV',              'usd'],
  ['avg_initial', 'Avg Initial',      'usd'],
  ['avg_pest',    'Avg Pest Initial', 'usd'],
  ['my_pct',      'MY %',             'pct'],
  ['audit_pct',   'Audit %',          'pct'],
  ['cancel_pct',  'Cancel %',         'pct'],
];
function indicatorYoYTrendChart() {
  const id = 'chart-yoy-trend';
  let metric = state._indicatorYoYMetric || 'revenue';
  const mDef = YOY_METRICS.find(m => m[0] === metric) || YOY_METRICS[0];
  const kind = mDef[2];
  let raw = indicatorSales();
  // Rep accounts see THEIR OWN trend, not the company's — matched by name
  // signature so "Sauer, Drew" ↔ "Drew Sauer" resolves.
  // Partners / team leads (per Isaac, Sep 2026): the admin chart, scoped —
  // Company plus the teams they reach and those teams' reps, defaulting to
  // their team(s). Plain reps keep the personal chart.
  const _yoyPartner = !isAdminRole(state.profile && state.profile?.role)
    && ((typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role)) || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role)))
    && typeof myReachTeams === 'function' && myReachTeams().size > 0;
  const _yoyReachTeams = _yoyPartner ? [...myReachTeams()].filter(Boolean).sort() : [];
  const _yoyRepOnly = !isAdminRole(state.profile && state.profile?.role) && !_yoyPartner;
  if (_yoyRepOnly) {
    const _sigY = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    const _mineY = _sigY(state.profile.full_name);
    raw = raw.filter(x => x.rep && (isMyRepName(x.rep) || _sigY(getCanonicalRepName(x.rep)) === _mineY));
  }
  const curY = new Date().getFullYear(), prevY = curY - 1;
  const PEST_RE = /sentricon|german\s*roach|interior\s*flea/i;

  // Per (year, week-of-year) accumulators. Week 1 = the Sunday-anchored
  // week containing Jan 1 (same convention as the week labels everywhere).
  //
  // Cancel % uses MATCHED HORIZONS: a 2025 cohort has had a year longer to
  // cancel than its 2026 counterpart, which made last year look terrible by
  // construction. So for the prior year, a cancel only counts if it happened
  // within the SAME elapsed time the current-year cohort has had (cancel
  // date ≤ prior-year week start + days elapsed since this year's week
  // start). `cancels` = all-time cancels (current-year line), `cancelsM` =
  // horizon-matched cancels (prior-year line).
  const mk = () => ({ rev: 0, revNew: 0, revRenewal: 0, n: 0, multi: 0, twelve: 0, fail: 0, initSum: 0, pestSum: 0, pestN: 0, cancels: 0, cancelsM: 0, cancelElig: 0, repSet: new Set() });
  // (per-scope accumulators are built by buildAcc below — the first scope's
  // maps are aliased to acc/accTier after the build)
  // ── Tier split (All / Rookies / Vets) — checkbox picker, so Rookies vs
  // Vets can overlay as separate lines. Tier is resolved PER SALE YEAR:
  // current year uses the live tier (manual tags respected); past years use
  // sales history (first year selling = rookie that year, seller before =
  // vet), so 2025's rookie line shows who was a rookie IN 2025.
  const YOY_TIERS = [['all', 'All reps'], ['rookie', 'Rookies'], ['vet', 'Vets']];
  const _yoySelTiers = (() => {
    if (_yoyRepOnly) return ['all'];
    const sel = Array.isArray(state._indicatorYoYTiers) ? state._indicatorYoYTiers.filter(t => YOY_TIERS.some(x => x[0] === t)) : [];
    return sel.length ? sel : ['all'];
  })();
  const _tierSplit = _yoySelTiers.some(t => t !== 'all');
  const _tierMemo = new Map();
  const _tierOfSaleYear = (rep, y) => {
    const key = rep + '|' + y;
    let v = _tierMemo.get(key);
    if (v !== undefined) return v;
    const nm = getCanonicalRepName(rep);
    if (y === curY) v = (typeof getRepTier === 'function' && getRepTier(nm)) || '';
    else {
      const yrs = (typeof _repSaleYears === 'function') ? _repSaleYears(nm) : null;
      v = !yrs ? '' : yrs.min === y ? 'rookie' : yrs.min < y ? 'vet' : '';
    }
    _tierMemo.set(key, v);
    return v;
  };
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  // View granularity — Weeks (Wk 1..52 per year), Months (Jan..Dec per
  // year), or Years (one point per year, all history on one line). This
  // absorbed the old Monthly PRA / Monthly Revenue cards.
  const gran = ['week', 'month', 'year'].includes(state._indicatorYoYGran) ? state._indicatorYoYGran : 'week';
  const weekStartOf = (y, wk) => {
    const jan1 = new Date(y, 0, 1);
    const a = new Date(jan1); a.setDate(a.getDate() - a.getDay());
    a.setDate(a.getDate() + (wk - 1) * 7);
    return a;
  };
  // Start of bucket b in year y, per granularity (drives the matched-horizon
  // cancel math and the live-bucket trim).
  const bucketStartOf = (y, b) => gran === 'week' ? weekStartOf(y, b) : gran === 'month' ? new Date(y, b - 1, 1) : new Date(y, 0, 1);
  const bucketOfDate = (d, y) => {
    if (gran === 'month') return d.getMonth() + 1;
    if (gran === 'year') return 1;
    const jan1 = new Date(y, 0, 1);
    const anchor = new Date(jan1); anchor.setDate(anchor.getDate() - anchor.getDay());
    return Math.floor((d - anchor) / 604800000) + 1;
  };
  const _curBucketNow = gran === 'month' ? (todayMid.getMonth() + 1) : gran === 'year' ? 1
    : (() => { const a = new Date(curY, 0, 1); a.setDate(a.getDate() - a.getDay()); return Math.floor((todayMid - a) / 604800000) + 1; })();
  // ── SCOPES — the old Metric Trends card folded in here (one chart now).
  // Check Company / offices / teams / reps and each plots its own line,
  // multiplying with Years × Type like every other picker on this card. ──
  const _yoyOfficeOf = (s) => {
    const o = String(s.office || '').split(',')[0].trim();
    return o ? o.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ') : '';
  };
  const _yoySelScopes = (() => {
    if (_yoyRepOnly) return [{ t: 'co' }];
    let sel = Array.isArray(state._indicatorYoYScopes) ? state._indicatorYoYScopes.filter(x => x && x.t) : [];
    if (_yoyPartner) {
      // Only what a partner may see: Company, their teams, their teams' reps.
      const okTeam = new Set(_yoyReachTeams);
      sel = sel.filter(sc => sc.t === 'co' || (sc.t === 'team' && okTeam.has(sc.v)) || (sc.t === 'rep' && okTeam.has(getRepTeam(sc.v) || '')));
      if (!sel.length) return _yoyReachTeams.map(t => ({ t: 'team', v: t }));   // default: their team(s)
      return sel;
    }
    return sel.length ? sel : [{ t: 'co' }];
  })();
  // PRA is revenue ÷ unique sellers — for a REP scope that's ÷1, i.e. it
  // just repaints Revenue (Isaac: "the PRA metric isn't doing anything").
  // Rep-only views fall back to Revenue and hide the PRA option entirely.
  const _yoyAllReps = _yoyRepOnly || _yoySelScopes.every(sc => sc.t === 'rep');
  if (_yoyAllReps && metric === 'pra') metric = 'revenue';
  // Department scopes (per Isaac): Office Staff / Sales Rep / Technician as
  // their own overlay lines, keyed by the same dept buckets the page-level
  // Type toggle uses (_indicatorDeptOf → office / d2d / techs).
  const _YOY_DEPTS = [['office', 'Office Staff'], ['d2d', 'Sales Rep'], ['techs', 'Technician']];
  const _scopeLabelOf = (sc) => sc.t === 'co' ? 'Company'
    : sc.t === 'dept' ? ((_YOY_DEPTS.find(d => d[0] === sc.v) || [])[1] || String(sc.v || ''))
    : String(sc.v || '');
  const _scopeKey = (sc) => sc.t + ':' + (sc.v || '');
  const _scopeMatchFn = (sc) => {
    if (sc.t === 'co') return () => true;
    if (sc.t === 'dept') return (s) => _indicatorDeptOf(s) === sc.v;
    if (sc.t === 'office') return (s) => _yoyOfficeOf(s) === sc.v;
    if (sc.t === 'team') return (s) => (typeof getRepTeam === 'function' && getRepTeam(getCanonicalRepName(s.rep))) === sc.v;
    return (s) => getCanonicalRepName(s.rep) === sc.v;   // rep
  };
  const buildAcc = (rawArr) => {
    const acc = {}, accTier = {};
    let maxWeek = 0, lastDataWeek = 0;
    for (const s of rawArr) {
    const iso = dateSoldToIso(s.dateSold);
    if (!iso) continue;
    const y = Number(iso.slice(0, 4));
    const d = new Date(iso + 'T00:00');
    if (isNaN(d)) continue;
    const wk = bucketOfDate(d, y);
    if (wk < 1) continue;
    const ay = acc[y] || (acc[y] = {});
    const a = ay[wk] || (ay[wk] = mk());
    // Tier buckets accumulate in parallel — same math, scoped to the reps
    // who were that tier in that year.
    let aT = null;
    if (_tierSplit && s.rep) {
      const t = _tierOfSaleYear(s.rep, y);
      if (t) { const kT = y + '|' + t; const ayT = accTier[kT] || (accTier[kT] = {}); aT = ayT[wk] || (ayT[wk] = mk()); }
    }
    const cv = Number(s.contractValue) || 0;
    const _repNm = s.rep ? getCanonicalRepName(s.rep) : null;
    for (const b of (aT ? [a, aT] : [a])) {
      if (_repNm) b.repSet.add(_repNm);   // PRA denominator: unique sellers in the bucket
      b.rev += cv;
      if (_indicatorIsRenewal(s)) b.revRenewal += cv; else b.revNew += cv;
      b.n++;
      const _myb = myBucketOf(s);
      if (_myb === 'multi') b.multi++; else if (_myb === 'twelve') b.twelve++;
      if (/failed\s*audit/i.test(s.customerFlags || '')) b.fail++;
      b.initSum += Number(s.initialPrice) || 0;
      if (!PEST_RE.test(s.subscription || '')) { b.pestSum += Number(s.initialPrice) || 0; b.pestN++; }
      if (_isReportableCancel(s)) {
        b.cancels++;
        if (y === prevY) {
          // Matched horizon: cutoff = prior-year week start + the elapsed
          // time the current-year cohort has had (today − cur week start).
          const cancelD = _parseSlashDate(s.cancelDate);
          const cutoff = bucketStartOf(prevY, wk).getTime() + Math.max(0, todayMid - bucketStartOf(curY, wk));
          if (cancelD && cancelD.getTime() <= cutoff) b.cancelsM++;
        }
      }
      if (!_isExcludableCancel(s)) b.cancelElig++;
    }
      if (wk > maxWeek) maxWeek = wk;
      if (y === curY && wk > lastDataWeek) lastDataWeek = wk;
    }
    return { acc, accTier, maxWeek, lastDataWeek };
  };
  const scopeAccs = _yoySelScopes.map(sc => buildAcc(sc.t === 'co' ? raw : raw.filter(_scopeMatchFn(sc))));
  let maxWeek = Math.max(0, ...scopeAccs.map(x => x.maxWeek));
  let lastDataWeek = Math.max(0, ...scopeAccs.map(x => x.lastDataWeek));
  // The FIRST selected scope feeds the header numbers + YoY footer.
  const acc = scopeAccs[0].acc, accTier = scopeAccs[0].accTier;
  maxWeek = Math.min(Math.max(maxWeek, 1), gran === 'month' ? 12 : gran === 'year' ? 1 : 54);
  // Rep view is YTD-only: cut the axis at the CURRENT bucket so prior
  // years' lines don't run months past today — every year compares the same
  // Jan-1 → now stretch. Admins keep the full-year axis.
  if (_yoyRepOnly && gran !== 'year') {
    maxWeek = Math.min(maxWeek, Math.max(_curBucketNow, 1));
  }

  // Office staff can split the revenue metric into Total / New / Renewal.
  // Revenue splits into Total / New / Renewal for EVERY user type (per Isaac,
  // Sep 2026) — sales reps default to Total and won't notice a difference.
  const isOffice = true;
  const revType = (metric === 'revenue') ? (state._indicatorYoYRevType || 'total') : 'total';
  const valOf = (a, matchedHorizon) => {
    if (!a) return null;
    switch (metric) {
      case 'revenue':     return revType === 'new' ? a.revNew : revType === 'renewal' ? a.revRenewal : a.rev;
      case 'pra':         return (a.repSet && a.repSet.size > 0) ? a.rev / a.repSet.size : null;
      case 'count':       return a.n;
      case 'acv':         return a.n > 0 ? a.rev / a.n : null;
      case 'avg_initial': return a.n > 0 ? a.initSum / a.n : null;
      case 'avg_pest':    return a.pestN > 0 ? a.pestSum / a.pestN : null;
      case 'my_pct':      { const ct = a.twelve + a.multi; return ct > 0 ? a.multi / ct : null; }
      case 'audit_pct':   return a.n > 0 ? (a.n - a.fail) / a.n : null;
      case 'cancel_pct':  return a.cancelElig > 0 ? (matchedHorizon ? a.cancelsM : a.cancels) / a.cancelElig : null;
      default:            return null;
    }
  };
  const weeksAxis = Array.from({ length: maxWeek }, (_, i) => i + 1);
  const yearsPresent = Object.keys(acc).map(Number).sort((a, b) => a - b);
  const curVals  = weeksAxis.map(w => (w <= lastDataWeek ? valOf(acc[curY] && acc[curY][w], false) : null));
  // Cancel % prior-year line stops where the current year stops — beyond
  // that there's no equal-horizon counterpart to compare against.
  const prevVals = weeksAxis.map(w => (metric === 'cancel_pct' && w > lastDataWeek) ? null : valOf(acc[prevY] && acc[prevY][w], true));
  // YTD aggregate per year — combine weeks 1..lastDataWeek into one bucket so
  // the final "YTD" dot shows each year's year-to-date total (proper ratio for
  // averages/percent, not a sum of weekly averages).
  const _bucketsOfIn = (A, year, tier) => (!tier || tier === 'all') ? A.acc[year] : A.accTier[year + '|' + tier];
  const _combineYTD = (A, year, tier) => { const c = mk(); const ay = _bucketsOfIn(A, year, tier) || {}; for (let w = 1; w <= lastDataWeek; w++) { const a = ay[w]; if (!a) continue; for (const k in c) { if (k === 'repSet') continue; c[k] += (a[k] || 0); } if (a.repSet) a.repSet.forEach(x => c.repSet.add(x)); } return c; };
  const ytdValOf = (A, year, tier) => valOf(_combineYTD(A, year, tier), year === prevY);
  const fmtVal = (v) => v == null ? '—'
    : kind === 'usd' ? '$' + ((metric === 'revenue' || metric === 'pra') ? Math.round(v).toLocaleString() : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    : kind === 'pct' ? (v * 100).toFixed(1) + '%'
    : fmt.int(v);

  // ONE dropdown — the Office-staff revenue split (Total / New / Renewal)
  // folds into the metric list instead of living in a second select.
  const metricSel = (() => {
    const opts = [];
    for (const [v, lab] of YOY_METRICS) {
      if (v === 'pra' && _yoyAllReps) continue;   // ÷1 for a single rep — meaningless
      if (v === 'revenue' && isOffice) {
        opts.push(['revenue|total', 'Total Revenue'], ['revenue|new', 'New Revenue'], ['revenue|renewal', 'Renewal Revenue']);
      } else opts.push([v, lab]);
    }
    const cur = (metric === 'revenue' && isOffice) ? 'revenue|' + revType : metric;
    const selEl = el('select', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
      onchange: (e) => {
        const v = e.target.value;
        if (v.indexOf('revenue|') === 0) { state._indicatorYoYMetric = 'revenue'; state._indicatorYoYRevType = v.split('|')[1]; }
        else state._indicatorYoYMetric = v;
        mountApp();
      },
    }, ...opts.map(([v, lab]) => { const o = el('option', { value: v }, lab); if (v === cur) o.selected = true; return o; }));
    // Face reads "Metric ▾" (per Isaac); the native select sits invisibly on
    // top so a tap still opens the platform picker. Accent when off default.
    const curLab = (opts.find(o => o[0] === cur) || [])[1] || 'Revenue';
    const nonDefault = cur !== 'revenue' && cur !== 'revenue|total';
    selEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;';
    const face = el('span', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium border flex items-center gap-1.5 whitespace-nowrap',
      style: nonDefault
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
    }, curLab);   // the button IS the current value (per Isaac): "Revenue", "ACV", …
    return el('div', { class: 'relative inline-flex', title: 'Metric: ' + curLab + ' — tap to change' }, face, selEl);
  })();

  // Years picker — defaults to the CURRENT year only; check other years to
  // overlay them (plotting all six by default was spaghetti).
  const _yoySelYears = (() => {
    const sel = Array.isArray(state._indicatorYoYYears) ? state._indicatorYoYYears.filter(y => yearsPresent.includes(y)) : [];
    if (sel.length) return sel;
    return yearsPresent.includes(curY) ? [curY] : yearsPresent.slice(-1);
  })();
  const yearsWrap = (() => {
    const wrap = el('div', { class: 'relative' });
    // STAGED — checking years just flips the checkbox (instant); Apply
    // commits the set with ONE full re-render (each toggle used to rebuild
    // the whole page).
    let _stagedYears = [..._yoySelYears];
    let _stagedGran = gran;
    let _yApply = null;
    const _yDirty = () => {
      if (!_yApply) return;
      _yApply.style.background = 'var(--accent)';
      _yApply.style.color = 'var(--accent-text)';
      _yApply.style.borderColor = 'var(--accent)';
    };
    // "Show as" — Weeks / Months / Years granularity (absorbed the old
    // Monthly PRA/Revenue cards). Years view plots all history on one line,
    // so the year checkboxes below only apply to Weeks/Months.
    const granRows = [];
    const paintGran = () => granRows.forEach(({ row, glyph, gid }) => {
      glyph.textContent = _stagedGran === gid ? '◉' : '○';
      row.style.background = _stagedGran === gid ? 'var(--card-2)' : 'transparent';
    });
    const granRow = (gid, lab) => {
      const glyph = el('span', { style: { fontSize: '12px' } }, '');
      const row = el('button', {
        class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
        style: { color: 'var(--text)' },
        onclick: (e) => { e.stopPropagation(); _stagedGran = gid; paintGran(); _yDirty(); },
      }, glyph, el('span', {}, lab));
      granRows.push({ row, glyph, gid });
      return row;
    };
    const panel = el('div', {
      class: 'card absolute p-1.5',
      style: { top: 'calc(100% + 6px)', right: '0', minWidth: '170px', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._yoyYearsOpen ? 'block' : 'none' },
    },
      el('div', { class: 'px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Show as'),
      granRow('week', 'Weeks'),
      granRow('month', 'Months'),
      granRow('year', 'Years (all history)'),
      el('div', { class: 'px-2.5 pt-2 pb-0.5 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Overlay years'),
      ...yearsPresent.slice().sort((a, b) => b - a).map(y => {
        const glyph = el('span', { style: { fontSize: '13px' } }, _stagedYears.includes(y) ? '☑' : '☐');
        const row = el('button', {
          class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
          style: { color: 'var(--text)', background: _stagedYears.includes(y) ? 'var(--card-2)' : 'transparent' },
          onclick: (e) => {
            e.stopPropagation();
            _stagedYears = _stagedYears.includes(y) ? _stagedYears.filter(x => x !== y) : [..._stagedYears, y];
            const on = _stagedYears.includes(y);
            glyph.textContent = on ? '☑' : '☐';
            row.style.background = on ? 'var(--card-2)' : 'transparent';
            _yDirty();
          },
        }, glyph, el('span', {}, String(y) + (y === curY ? ' · current' : '')));
        return row;
      }),
      (_yApply = el('button', {
        class: 'w-full rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 mt-1',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: (e) => {
          e.stopPropagation();
          state._indicatorYoYYears = _stagedYears.length ? _stagedYears : [curY];
          state._indicatorYoYGran = _stagedGran;
          state._yoyYearsOpen = false;
          mountApp();
        },
      }, 'Apply')));
    paintGran();
    const btn = el('button', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer border flex items-center gap-1.5',
      style: _yoySelYears.length > 1
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
      title: 'Pick which years to overlay',
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'block';
        panel.style.display = open ? 'none' : 'block';
        state._yoyYearsOpen = !open;
        if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
          if (wrap.contains(ev.target)) return;
          panel.style.display = 'none'; state._yoyYearsOpen = false;
          document.removeEventListener('mousedown', closer);
        }), 0); }
      },
    }, 'Range', el('span', { style: { fontSize: '9px' } }, '\u25bc'));
    // The button reads "Range" (per Isaac, Sep 2026); the current value rides the tooltip.
    btn.title = 'Range: ' + (gran === 'year' ? 'Years · all' : (gran === 'month' ? 'Months' : 'Weeks') + ' · ' + _yoySelYears.join(', ')) + ' — tap to change';
    if (gran !== 'week' || _yoySelYears.length !== 1) { btn.style.background = 'var(--accent)'; btn.style.color = 'var(--accent-text)'; btn.style.borderColor = 'var(--accent)'; }
    // (value text kept as-is — the fixed "View" label is added at render)
    if (state._yoyYearsOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
      if (wrap.contains(ev.target)) return;
      panel.style.display = 'none'; state._yoyYearsOpen = false;
      document.removeEventListener('mousedown', closer);
    }), 0); }
    wrap.append(btn, panel);
    return wrap;
  })();

  // Type picker — All / Rookies / Vets checkboxes (same staged-Apply UX as
  // Years) so cohorts overlay as separate lines. Admin-only; a rep's own
  // trend has no cohort to split.
  const tiersWrap = _yoyRepOnly ? null : (() => {
    const wrap = el('div', { class: 'relative' });
    let _staged = [..._yoySelTiers];
    let _tApply = null;
    const _tDirty = () => {
      if (!_tApply) return;
      _tApply.style.background = 'var(--accent)';
      _tApply.style.color = 'var(--accent-text)';
      _tApply.style.borderColor = 'var(--accent)';
    };
    const panel = el('div', {
      class: 'card absolute p-1.5',
      style: { top: 'calc(100% + 6px)', right: '0', minWidth: '160px', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._yoyTiersOpen ? 'block' : 'none' },
    },
      ...YOY_TIERS.map(([tid, lab]) => {
        const glyph = el('span', { style: { fontSize: '13px' } }, _staged.includes(tid) ? '☑' : '☐');
        const row = el('button', {
          class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
          style: { color: 'var(--text)', background: _staged.includes(tid) ? 'var(--card-2)' : 'transparent' },
          onclick: (e) => {
            e.stopPropagation();
            _staged = _staged.includes(tid) ? _staged.filter(x => x !== tid) : [..._staged, tid];
            const on = _staged.includes(tid);
            glyph.textContent = on ? '☑' : '☐';
            row.style.background = on ? 'var(--card-2)' : 'transparent';
            _tDirty();
          },
        }, glyph, el('span', {}, lab));
        return row;
      }),
      (_tApply = el('button', {
        class: 'w-full rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 mt-1',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: (e) => {
          e.stopPropagation();
          state._indicatorYoYTiers = _staged.length ? _staged : ['all'];
          state._yoyTiersOpen = false;
          mountApp();
        },
      }, 'Apply')));
    const label = _yoySelTiers.length === 1 && _yoySelTiers[0] === 'all'
      ? 'All'
      : _yoySelTiers.map(t => (YOY_TIERS.find(x => x[0] === t) || [])[1] || t).join(' + ');
    const btn = el('button', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer border flex items-center gap-1.5',
      style: _tierSplit
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
      title: 'Break the lines out by rep type — check Rookies + Vets to compare the cohorts',
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'block';
        panel.style.display = open ? 'none' : 'block';
        state._yoyTiersOpen = !open;
        if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
          if (wrap.contains(ev.target)) return;
          panel.style.display = 'none'; state._yoyTiersOpen = false;
          document.removeEventListener('mousedown', closer);
        }), 0); }
      },
    }, label === 'All' ? 'All types' : label);
    btn.title = 'Type: ' + label + ' — ' + btn.title;
    if (state._yoyTiersOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
      if (wrap.contains(ev.target)) return;
      panel.style.display = 'none'; state._yoyTiersOpen = false;
      document.removeEventListener('mousedown', closer);
    }), 0); }
    wrap.append(btn, panel);
    return wrap;
  })();

  // Scope picker — the old Metric Trends filters, now living on THIS card.
  const scopesWrap = _yoyRepOnly ? null : (() => {
    const wrap = el('div', { class: 'relative' });
    let _staged = _yoySelScopes.map(sc => _scopeKey(sc));
    let _sApply = null;
    const _sDirty = () => {
      if (!_sApply) return;
      _sApply.style.background = 'var(--accent)';
      _sApply.style.color = 'var(--accent-text)';
      _sApply.style.borderColor = 'var(--accent)';
    };
    const offices = _yoyPartner ? [] : [...new Set(raw.map(_yoyOfficeOf).filter(Boolean))].sort();
    const repNamesAll = [...new Set(raw.map(s => s.rep ? getCanonicalRepName(s.rep) : '').filter(Boolean))].sort();
    const repNames = _yoyPartner ? repNamesAll.filter(n => _yoyReachTeams.includes(getRepTeam(n) || '')) : repNamesAll;
    const teams = _yoyPartner ? _yoyReachTeams : ((typeof getRepTeam === 'function')
      ? [...new Set(repNamesAll.map(n => getRepTeam(n)).filter(Boolean))].sort()
      : []);
    const rowBtn = (key, lab) => {
      const glyph = el('span', { style: { fontSize: '13px' } }, _staged.includes(key) ? '☑' : '☐');
      const row = el('button', {
        class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
        style: { color: 'var(--text)', background: _staged.includes(key) ? 'var(--card-2)' : 'transparent' },
        onclick: (e) => {
          e.stopPropagation();
          _staged = _staged.includes(key) ? _staged.filter(x => x !== key) : [..._staged, key];
          const on = _staged.includes(key);
          glyph.textContent = on ? '☑' : '☐';
          row.style.background = on ? 'var(--card-2)' : 'transparent';
          _sDirty();
        },
      }, glyph, el('span', { class: 'truncate' }, lab));
      return row;
    };
    const secTitle = (t) => el('div', { class: 'px-2.5 pt-2 pb-1 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, t);
    let _stTiers = [..._yoySelTiers];
    const tierBtn = (tid, lab) => {
      const glyph = el('span', { style: { fontSize: '13px' } }, _stTiers.includes(tid) ? '☑' : '☐');
      const row = el('button', {
        class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
        style: { color: 'var(--text)', background: _stTiers.includes(tid) ? 'var(--card-2)' : 'transparent' },
        onclick: (e) => {
          e.stopPropagation();
          _stTiers = _stTiers.includes(tid) ? _stTiers.filter(x => x !== tid) : [..._stTiers, tid];
          const on = _stTiers.includes(tid);
          glyph.textContent = on ? '☑' : '☐';
          row.style.background = on ? 'var(--card-2)' : 'transparent';
          _sDirty();
        },
      }, glyph, el('span', {}, lab));
      return row;
    };
    const repList = el('div', {});
    const paintReps = (q) => {
      repList.innerHTML = '';
      const ql = String(q || '').toLowerCase();
      // Checked reps always show; search reveals the rest (cap 10 matches).
      const checked = repNames.filter(n => _staged.includes('rep:' + n));
      const matches = ql.length >= 2 ? repNames.filter(n => !checked.includes(n) && n.toLowerCase().includes(ql)).slice(0, 10) : [];
      [...checked, ...matches].forEach(n => repList.append(rowBtn('rep:' + n, n)));
      if (!checked.length && !matches.length) repList.append(el('div', { class: 'px-2.5 py-1.5 text-[10px]', style: { color: 'var(--text-subtle)' } }, ql.length >= 2 ? 'No matching reps' : 'Type 2+ letters to search ' + fmt.int(repNames.length) + ' reps'));
    };
    const repSearch = el('input', {
      type: 'text', placeholder: 'Search reps…', autocomplete: 'off',
      class: 'w-full rounded-lg px-2.5 py-1 text-[11px]',
      style: { background: 'var(--card-2)', border: '1px solid var(--border-2)', color: 'var(--text)' },
      oninput: (e) => paintReps(e.target.value),
      onclick: (e) => e.stopPropagation(),
    });
    paintReps('');
    const panel = el('div', {
      class: 'card absolute p-1.5',
      style: { top: 'calc(100% + 6px)', right: '0', minWidth: '230px', maxHeight: '340px', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._yoyScopesOpen ? 'block' : 'none' },
    },
      rowBtn('co:', 'Company (everything on this page)'),
      // Type (All reps / Rookies / Vets) lives INSIDE this picker now (per
      // Isaac) — the separate "All types" button is gone.
      secTitle('Type'),
      ...YOY_TIERS.map(([tid, lab]) => tierBtn(tid, lab)),
      _yoyPartner ? null : secTitle('Department'),
      ...(_yoyPartner ? [] : _YOY_DEPTS.map(([k, lab]) => rowBtn('dept:' + k, lab))),
      offices.length ? secTitle('Offices') : null,
      ...offices.map(o => rowBtn('office:' + o, o)),
      teams.length ? secTitle('Teams') : null,
      ...teams.map(t => rowBtn('team:' + t, t)),
      secTitle('Reps'),
      el('div', { class: 'px-1.5 pb-1' }, repSearch),
      repList,
      (_sApply = el('button', {
        class: 'w-full rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 mt-1',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: (e) => {
          e.stopPropagation();
          const parsed = _staged.map(k => { const i = k.indexOf(':'); return { t: k.slice(0, i), v: k.slice(i + 1) || undefined }; });
          state._indicatorYoYScopes = parsed.length ? parsed : [{ t: 'co' }];
          state._indicatorYoYTiers = _stTiers.length ? _stTiers : ['all'];
          state._yoyScopesOpen = false;
          mountApp();
        },
      }, 'Apply')));
    const multi = _yoySelScopes.length > 1 || _yoySelScopes[0].t !== 'co' || _tierSplit;
    const _tierLab = _tierSplit ? _yoySelTiers.map(t => (YOY_TIERS.find(x => x[0] === t) || [])[1] || t).join(' + ') : '';
    const label = (!multi ? 'Company'
      : _yoySelScopes.length === 1 ? _scopeLabelOf(_yoySelScopes[0])
      : _yoySelScopes.length + ' selected') + (_tierLab ? ' · ' + _tierLab : '');
    const btn = el('button', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer border flex items-center gap-1.5',
      style: multi
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
      title: 'Overlay departments, offices, teams, or individual reps as their own lines (multiplies with Years and Type — up to 14 lines)',
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'block';
        panel.style.display = open ? 'none' : 'block';
        state._yoyScopesOpen = !open;
        if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
          if (wrap.contains(ev.target)) return;
          panel.style.display = 'none'; state._yoyScopesOpen = false;
          document.removeEventListener('mousedown', closer);
        }), 0); }
      },
    }, label);
    btn.title = 'Scope: ' + label + ' — ' + btn.title;
    if (state._yoyScopesOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
      if (wrap.contains(ev.target)) return;
      panel.style.display = 'none'; state._yoyScopesOpen = false;
      document.removeEventListener('mousedown', closer);
    }), 0); }
    wrap.append(btn, panel);
    return wrap;
  })();

  const cvsWrap = el('div', { style: { position: 'relative', height: '280px', width: '100%' } });
  cvsWrap.append(el('canvas', { id }));
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const cvs = document.getElementById(id);
    if (!cvs) return;
    if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
    const isDark = state.theme === 'dark';
    const txt = isDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)';
    const grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    _chartInstances[id] = new Chart(cvs.getContext('2d'), {
      type: 'line',
      data: {
        labels: gran === 'year' ? yearsPresent.map(String)
          : (gran === 'month' ? weeksAxis.map(w => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][w - 1] || w) : weeksAxis.map(w => 'Wk ' + w)).concat('YTD'),
        datasets: (() => {
          // One line per year present. Current year = bold green solid; prior
          // years = dashed, the immediately-prior muted and older ones colored.
          // The YTD value rides a SEPARATE right-hand axis (and its own point-
          // only dataset) so its cumulative size never skews the weekly scale.
          const muted = isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.35)';
          const palette = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
          const lines = [], ytdPts = [];
          const multiScope = _yoySelScopes.length > 1 || _yoySelScopes[0].t !== 'co';
          if (gran === 'year') {
            // One point per year, ALL history on a single line per series —
            // the Years checkboxes don't apply in this view.
            const scopePalette0 = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
            _yoySelScopes.forEach((sc, si) => {
              const A = scopeAccs[si];
              const scopeLab = multiScope ? _scopeLabelOf(sc) : '';
              _yoySelTiers.forEach((tier) => {
                const tierLab = tier === 'all' ? '' : tier === 'rookie' ? 'Rookies' : 'Vets';
                const label = [scopeLab, tierLab].filter(Boolean).join(' · ') || 'Company';
                const color = _yoySelScopes.length > 1 ? scopePalette0[(_tierSplit ? si * _yoySelTiers.length + _yoySelTiers.indexOf(tier) : si) % scopePalette0.length]
                  : tier === 'rookie' ? '#DF643A' : tier === 'vet' ? '#818CF8' : (_tierSplit ? '#323230' : '#DF643A');
                const data = yearsPresent.map(y => { const _b = _bucketsOfIn(A, y, tier) || {}; return valOf(_b[1], y === prevY); });
                lines.push({ label, data, borderColor: color, backgroundColor: 'rgba(223,100,58,.10)', fill: lines.length === 0 && kind !== 'pct' && _yoySelScopes.length * _yoySelTiers.length === 1, spanGaps: true, borderWidth: 3, tension: 0.25, pointRadius: 3.5, pointHoverRadius: 6 });
              });
            });
            return lines;
          }
          const _totalSeries = _yoySelYears.length * _yoySelTiers.length * _yoySelScopes.length;
          const MAX_SERIES = 14;   // beyond this the chart is spaghetti — trim scopes/years/tiers
          const scopePalette = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
          _yoySelScopes.forEach((sc, si) => {
            const A = scopeAccs[si];
            const scopeLab = multiScope ? ' · ' + _scopeLabelOf(sc) : '';
            yearsPresent.forEach((y) => {
              if (!_yoySelYears.includes(y)) return;   // only the years picked in the Years dropdown plot
              const isCur = y === curY;
              const idx = curY - y; // 0 = current, 1 = prior year, …
              const yColor = isCur ? '#DF643A' : (idx === 1 ? muted : palette[(idx - 2 + palette.length) % palette.length]);
              _yoySelTiers.forEach((tier) => {
                if (lines.length >= MAX_SERIES) return;
                // Color priority: multiple SCOPES → one color per scope
                // (years distinguished by solid vs dashed); otherwise the
                // tier split colors (Rookies amber / Vets indigo); otherwise
                // the classic year palette.
                // One scope (a team, say) split by type still needs two
                // colors — otherwise Rookies and Vets paint the same orange.
                const _ti = _yoySelTiers.indexOf(tier);
                const color = _yoySelScopes.length > 1
                  ? scopePalette[(_tierSplit ? si * _yoySelTiers.length + _ti : si) % scopePalette.length]
                  : tier === 'all' ? (_tierSplit && isCur ? '#323230' : yColor) : (tier === 'rookie' ? (isCur ? '#DF643A' : '#A9441F') : (isCur ? '#818CF8' : '#5F6C5B'));
                const tierLab = tier === 'all' ? '' : tier === 'rookie' ? ' · Rookies' : ' · Vets';
                const label = String(y) + tierLab + scopeLab;
                const _b = _bucketsOfIn(A, y, tier) || {};
                const vals = weeksAxis.map(w => {
                  if (isCur && w > lastDataWeek) return null;
                  if (metric === 'cancel_pct' && y === prevY && w > lastDataWeek) return null;
                  return valOf(_b[w], y === prevY);
                });
                // TREND RULE: the current-year line ends at the last COMPLETED
                // week — the in-progress week plotted as a nosedive on every
                // metric (Carson + Isaac both flagged it). Its live total still
                // shows in the YTD diamond on the right axis.
                const _liveIdx = (isCur && lastDataWeek >= _curBucketNow) ? _curBucketNow - 1 : -1;
                const plotVals = _liveIdx >= 0 ? vals.map((v, i) => (i >= _liveIdx ? null : v)) : vals;
                lines.push(isCur
                  ? { label, data: plotVals, borderColor: color, backgroundColor: 'rgba(223,100,58,.12)', fill: kind !== 'pct' && _totalSeries === 1, spanGaps: true, borderWidth: 3, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, order: 0 }
                  : { label, data: vals, borderColor: color, borderDash: [6, 4], backgroundColor: 'transparent', fill: false, spanGaps: true, borderWidth: 2, tension: 0.3, pointRadius: 1.5, pointHoverRadius: 5, order: idx });
                // TRENDLINE (per Isaac): single-scope views always carry a
                // least-squares trend over this line's completed weeks —
                // same color, faint dotted, no points.
                if (isCur && _yoySelScopes.length === 1) {
                  const _tp = [];
                  plotVals.forEach((v, i2) => { if (v != null) _tp.push([i2, v]); });
                  if (_tp.length >= 3) {
                    const _n = _tp.length;
                    const _sx = _tp.reduce((a2, p2) => a2 + p2[0], 0), _sy = _tp.reduce((a2, p2) => a2 + p2[1], 0);
                    const _sxx = _tp.reduce((a2, p2) => a2 + p2[0] * p2[0], 0), _sxy = _tp.reduce((a2, p2) => a2 + p2[0] * p2[1], 0);
                    const _den = _n * _sxx - _sx * _sx;
                    if (_den) {
                      const _sl = (_n * _sxy - _sx * _sy) / _den, _ic = (_sy - _sl * _sx) / _n;
                      const _x0 = _tp[0][0], _x1 = _tp[_tp.length - 1][0];
                      lines.push({
                        label: label + ' · trend',
                        data: weeksAxis.map((_, i2) => (i2 >= _x0 && i2 <= _x1) ? _ic + _sl * i2 : null),
                        borderColor: color, borderDash: [3, 5], borderWidth: 1.5,
                        backgroundColor: 'transparent', fill: false, pointRadius: 0,
                        pointHoverRadius: 0, spanGaps: true, tension: 0, order: 3,
                      });
                    }
                  }
                }
                // FLOATING LIVE DOT (per Isaac, Jul 2026): the in-progress
                // week still shows as a DETACHED hollow point at its live
                // value — a mid-week read without the misleading nosedive
                // line. Once the week completes it becomes a normal point
                // and the line connects to it on the next sync.
                if (_liveIdx >= 0 && vals[_liveIdx] != null) {
                  const liveData = weeksAxis.map((_, i2) => (i2 === _liveIdx ? vals[_liveIdx] : null));
                  lines.push({
                    label: label + ' · live', data: liveData, showLine: false,
                    borderColor: color, backgroundColor: 'rgba(255,255,255,0)',
                    pointRadius: 4.5, pointHoverRadius: 6.5, pointBorderWidth: 2.5,
                    pointStyle: 'circle', order: 0,
                  });
                }
                // YTD dot — point only, on the secondary 'yYTD' axis. Skipped for a
                // rep's own single-series view (it read as a stray marker).
                const ytdData = weeksAxis.map(() => null); ytdData.push(ytdValOf(A, y, tier));
                state._yoyHideYtd = (_totalSeries === 1 && !isAdminRole(state.profile?.role));
                if (!state._yoyHideYtd) ytdPts.push({ label: 'YTD ' + label, data: ytdData, yAxisID: 'yYTD', showLine: false, borderColor: color, backgroundColor: color, pointRadius: 5, pointHoverRadius: 7, pointStyle: 'rectRot', order: 0 });
              });
            });
          });
          // OUTLIER GUARD (per Isaac): one freak week (e.g. a tiny-denominator
          // PRA in early 2025) was stretching the whole axis. Cap the weekly
          // axis at a robust ceiling — Q3 + 3×IQR of every plotted value —
          // so the real trend stays readable; capped points ride the top edge
          // and still show their true value on hover.
          state._yoyAxisCap = null;
          // Percent metrics are naturally bounded (0–100%) — the robust cap
          // was CLIPPING legit peaks (office-staff MY% spikes cut at ~44%).
          // Outlier protection is for dollar/count axes only.
          if (kind !== 'pct') {
            const _av = [];
            lines.forEach(ds => (ds.data || []).forEach(v => { if (typeof v === 'number' && isFinite(v)) _av.push(v); }));
            if (_av.length >= 8) {
              _av.sort((a2, b2) => a2 - b2);
              const _q = (f) => _av[Math.min(_av.length - 1, Math.floor(f * (_av.length - 1)))];
              const _q1 = _q(0.25), _q3 = _q(0.75);
              const _cap = _q3 + 3 * (_q3 - _q1);
              // Only cap when a FEW points would be clipped (≤5%). A single rep's
              // weekly revenue is naturally spiky — one sale is a peak — and
              // capping was flattening half the chart (per Isaac).
              const _over = _av.filter(v => v > _cap).length;
              if (_cap > 0 && _av[_av.length - 1] > _cap * 1.25 && _over <= Math.max(1, Math.floor(_av.length * 0.05))) state._yoyAxisCap = _cap;
            }
          }
          return lines.concat(ytdPts);
        })(),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 11 }, usePointStyle: true, filter: (item) => !/^YTD /.test(item.text) && !/ · live$/.test(item.text) && !/ · trend$/.test(item.text) } },
          tooltip: {
            backgroundColor: '#323230', padding: 10, cornerRadius: 8,
            callbacks: {
              // Each line carries the actual Sun–Sat date range being
              // compared, e.g. "2026 (6/7–6/13): $812,440".
              label: (ctx) => {
                if (gran !== 'week' || ctx.dataIndex >= weeksAxis.length) return ctx.dataset.label + ': ' + fmtVal(ctx.parsed.y);
                const w = ctx.dataIndex + 1;
                const y = parseInt(ctx.dataset.label, 10);
                const jan1 = new Date(y, 0, 1);
                const anchor = new Date(jan1); anchor.setDate(anchor.getDate() - anchor.getDay());
                const s = new Date(anchor); s.setDate(s.getDate() + (w - 1) * 7);
                const e2 = new Date(s); e2.setDate(e2.getDate() + 6);
                const f = (d) => (d.getMonth() + 1) + '/' + d.getDate();
                const live = y === curY && todayMid >= s && todayMid <= e2 ? ' · week in progress' : '';
                return ctx.dataset.label + ' (' + f(s) + '–' + f(e2) + '): ' + fmtVal(ctx.parsed.y) + live;
              },
              footer: (items) => {
                const i = items[0]?.dataIndex;
                if (i == null) return '';
                const c = curVals[i], p = prevVals[i];
                if (c == null || p == null || !(p !== 0)) return '';
                if (kind === 'pct') {
                  const d = (c - p) * 100;
                  return 'YoY: ' + (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts';
                }
                const d = (c - p) / p;
                return 'YoY: ' + (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '%';
              },
            },
          },
        },
        scales: {
          // Every metric axis starts at 0 (per Isaac) — a 91–100% MY% zoom
          // made small dips look like cliffs.
          y: { beginAtZero: true, min: 0, max: state._yoyAxisCap || undefined, grid: { color: grid }, ticks: { color: txt, font: { size: 10 },
            callback: kind === 'usd'
              ? (v => '$' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : Math.abs(v) >= 10000 ? Math.round(v / 1000) + 'K' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : v))
              : kind === 'pct' ? (v => (v * 100).toFixed(0) + '%') : undefined } },
          // Independent right-hand axis for the YTD dots so their cumulative
          // magnitude never rescales the weekly lines.
          yYTD: { position: 'right', beginAtZero: true, min: 0, display: !state._yoyHideYtd, grid: { drawOnChartArea: false }, ticks: { color: txt, font: { size: 10 },
            callback: kind === 'usd'
              ? (v => '$' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'K' : v))
              : kind === 'pct' ? (v => (v * 100).toFixed(0) + '%') : undefined } },
          x: { grid: { display: false }, ticks: { color: txt, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 18 } },
        },
      },
    });
  }, 50);

  // Exclude picker (per Isaac, Sep 2026) — one-time services / 3-day RORs /
  // renewals, for EVERY user type. Shares state with the page Filters panel
  // (indicatorSales() already drops them), so the whole tab agrees.
  const exclWrap = (() => {
    const wrap = el('div', { class: 'relative' });
    const _st = { ...indicatorExcl() };
    let _xApply = null;
    const dirty = () => { if (!_xApply) return; _xApply.style.background = 'var(--accent)'; _xApply.style.color = 'var(--accent-text)'; _xApply.style.borderColor = 'var(--accent)'; };
    const rowX = (key, lab) => {
      const glyph = el('span', { style: { fontSize: '13px' } }, _st[key] ? '\u2611' : '\u2610');
      const row = el('button', {
        class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
        style: { color: 'var(--text)', background: _st[key] ? 'var(--card-2)' : 'transparent' },
        onclick: (e) => { e.stopPropagation(); _st[key] = !_st[key]; glyph.textContent = _st[key] ? '\u2611' : '\u2610'; row.style.background = _st[key] ? 'var(--card-2)' : 'transparent'; dirty(); },
      }, glyph, el('span', {}, lab));
      return row;
    };
    const panel = el('div', {
      class: 'card absolute p-1.5',
      style: { top: 'calc(100% + 6px)', right: '0', minWidth: '190px', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._yoyExclOpen ? 'block' : 'none' },
    },
      el('div', { class: 'px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Leave out'),
      rowX('oneTime', 'One-time services'), rowX('ror', '3-day RORs'), rowX('renewal', 'Renewals'),
      (_xApply = el('button', {
        class: 'w-full rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 mt-1',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: (e) => { e.stopPropagation(); state.indicatorExcl = { ..._st }; state._yoyExclOpen = false; mountApp(); },
      }, 'Apply')));
    const nX = Object.values(indicatorExcl()).filter(Boolean).length;
    const btn = el('button', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer border flex items-center gap-1.5',
      style: nX ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', color: 'var(--text)' },
      title: 'Exclude one-time services, 3-day RORs or renewals from the lines (applies to the whole Indicators tab)',
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'block';
        panel.style.display = open ? 'none' : 'block';
        state._yoyExclOpen = !open;
        if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
          if (wrap.contains(ev.target)) return;
          panel.style.display = 'none'; state._yoyExclOpen = false;
          document.removeEventListener('mousedown', closer);
        }), 0); }
      },
    }, 'Exclude' + (nX ? ' \u00b7 ' + nX : ''), el('span', { style: { fontSize: '9px' } }, '\u25bc'));
    if (state._yoyExclOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
      if (wrap.contains(ev.target)) return;
      panel.style.display = 'none'; state._yoyExclOpen = false;
      document.removeEventListener('mousedown', closer);
    }), 0); }
    wrap.append(btn, panel);
    return wrap;
  })();

  // Partner view (per Isaac): ONE dropdown — Company / their team(s) / every
  // rep on those teams listed outright (no search), the type split and the
  // range (Weeks / Months / Years + overlay years) — one Apply.
  const comboWrap = _yoyPartner ? (() => {
    const wrap = el('div', { class: 'relative' });
    let _stScopes = _yoySelScopes.map(sc => _scopeKey(sc));
    let _stTiers = [..._yoySelTiers];
    let _stYears = [..._yoySelYears];
    let _stGran = gran;
    let _apply = null;
    const dirty = () => { if (!_apply) return; _apply.style.background = 'var(--accent)'; _apply.style.color = 'var(--accent-text)'; _apply.style.borderColor = 'var(--accent)'; };
    const secTitle = (t) => el('div', { class: 'px-2.5 pt-2 pb-0.5 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, t);
    const check = (has, toggle, lab) => {
      const glyph = el('span', { style: { fontSize: '13px' } }, has() ? '\u2611' : '\u2610');
      const row = el('button', {
        class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
        style: { color: 'var(--text)', background: has() ? 'var(--card-2)' : 'transparent' },
        onclick: (e) => { e.stopPropagation(); toggle(); const on = has(); glyph.textContent = on ? '\u2611' : '\u2610'; row.style.background = on ? 'var(--card-2)' : 'transparent'; dirty(); },
      }, glyph, el('span', { class: 'truncate' }, lab));
      return row;
    };
    const scopeRow = (key, lab) => check(() => _stScopes.includes(key), () => { _stScopes = _stScopes.includes(key) ? _stScopes.filter(x => x !== key) : [..._stScopes, key]; }, lab);
    const tierRow = (tid, lab) => check(() => _stTiers.includes(tid), () => { _stTiers = _stTiers.includes(tid) ? _stTiers.filter(x => x !== tid) : [..._stTiers, tid]; }, lab);
    const yearRow = (y) => check(() => _stYears.includes(y), () => { _stYears = _stYears.includes(y) ? _stYears.filter(x => x !== y) : [..._stYears, y]; }, String(y) + (y === curY ? ' \u00b7 current' : ''));
    const granRows = [];
    const granRow = (gid, lab) => {
      const glyph = el('span', { style: { fontSize: '13px' } });
      const row = el('button', { class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95', style: { color: 'var(--text)' },
        onclick: (e) => { e.stopPropagation(); _stGran = gid; paintGran(); dirty(); } }, glyph, el('span', {}, lab));
      granRows.push({ row, glyph, gid });
      return row;
    };
    const paintGran = () => granRows.forEach(({ row, glyph, gid }) => { const on = _stGran === gid; glyph.textContent = on ? '\u25c9' : '\u25cb'; row.style.background = on ? 'var(--card-2)' : 'transparent'; });
    const repNamesAll = [...new Set(raw.map(x => x.rep ? getCanonicalRepName(x.rep) : '').filter(Boolean))];
    const teamReps = (t) => repNamesAll.filter(n => (getRepTeam(n) || '') === t).sort();
    const panel = el('div', {
      class: 'card absolute p-1.5',
      style: { top: 'calc(100% + 6px)', right: '0', minWidth: '250px', maxHeight: '70vh', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._yoyComboOpen ? 'block' : 'none' },
    },
      scopeRow('co:', 'Company'),
      ..._yoyReachTeams.flatMap(t => [
        secTitle(t + ' team'),
        scopeRow('team:' + t, t + ' (whole team)'),
        ...teamReps(t).map(n => scopeRow('rep:' + n, n)),
      ]),
      secTitle('Type'),
      ...YOY_TIERS.map(([tid, lab]) => tierRow(tid, lab)),
      secTitle('Show as'),
      granRow('week', 'Weeks'), granRow('month', 'Months'), granRow('year', 'Years (all history)'),
      secTitle('Overlay years'),
      ...yearsPresent.slice().sort((a, b) => b - a).map(yearRow),
      (_apply = el('button', {
        class: 'w-full rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 mt-1 sticky',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)', bottom: '0' },
        onclick: (e) => {
          e.stopPropagation();
          const parsed = _stScopes.map(k => { const i = k.indexOf(':'); return { t: k.slice(0, i), v: k.slice(i + 1) || undefined }; });
          state._indicatorYoYScopes = parsed.length ? parsed : _yoyReachTeams.map(t => ({ t: 'team', v: t }));
          state._indicatorYoYTiers = _stTiers.length ? _stTiers : ['all'];
          state._indicatorYoYYears = _stYears.length ? _stYears : [curY];
          state._indicatorYoYGran = _stGran;
          state._yoyComboOpen = false;
          mountApp();
        },
      }, 'Apply')));
    paintGran();
    const scopeLab = _yoySelScopes.length === 1 ? _scopeLabelOf(_yoySelScopes[0]) : _yoySelScopes.length + ' selected';
    const tierLab = (_yoySelTiers.length === 1 && _yoySelTiers[0] === 'all') ? '' : _yoySelTiers.map(t => (YOY_TIERS.find(x => x[0] === t) || [])[1] || t).join(' + ');
    const granLab = gran === 'year' ? 'Years' : (gran === 'month' ? 'Months' : 'Weeks') + ' \u00b7 ' + _yoySelYears.slice().sort().join('/');
    const btn = el('button', {
      class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer border flex items-center gap-1.5',
      style: { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' },
      title: 'Who to plot, rep type and time range',
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'block';
        panel.style.display = open ? 'none' : 'block';
        state._yoyComboOpen = !open;
        if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
          if (wrap.contains(ev.target)) return;
          panel.style.display = 'none'; state._yoyComboOpen = false;
          document.removeEventListener('mousedown', closer);
        }), 0); }
      },
    }, [scopeLab, tierLab, granLab].filter(Boolean).join(' \u00b7 '), el('span', { style: { fontSize: '9px' } }, '\u25bc'));
    if (state._yoyComboOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
      if (wrap.contains(ev.target)) return;
      panel.style.display = 'none'; state._yoyComboOpen = false;
      document.removeEventListener('mousedown', closer);
    }), 0); }
    wrap.append(btn, panel);
    return wrap;
  })() : null;

  return el('div', { class: 'card p-5' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-3' },
      el('h3', { class: 'text-sm font-bold' }, 'Performance Trends'),
      // Labels live INSIDE the buttons now (Scope / Type / Range / Metric —
      // per Isaac); the current value shows in each button's tooltip.
      el('div', { class: 'flex items-center gap-2 flex-wrap' }, ...(comboWrap ? [comboWrap] : [scopesWrap, yearsWrap]), exclWrap, metricSel)),
    cvsWrap);
}

function indicatorChart(title, data, branches, metricKey, weeks, invertForRanking = false, bucketLabels = null) {
  // bucketLabels: when provided, the x-axis is day/month buckets (ordinals)
  // instead of CSV week numbers — labels come from this array and the
  // raw-sales reps index is skipped (synthetic rows already carry reps).
  const canvasId = 'chart-' + metricKey;
  const isRanking = metricKey === '_power_ranking';
  const chartHeight = isRanking ? '320px' : '260px';
  // Click-to-drill is only meaningful for the per-week metric charts (Weekly
  // PRA, Weekly Revenue, etc.). The ranking chart already shows comparative
  // position, so drilling there isn't useful.
  const supportsDrill = !isRanking;
  const drillKey = state.indicatorsGroupBy === 'teams' ? metricKey + '-team' : metricKey;
  if (!state._indicatorChartDrill) state._indicatorChartDrill = {};
  // Migrate legacy string value → array, and filter to currently-present branches
  const rawDrill = state._indicatorChartDrill[drillKey];
  let drilledBranches = [];
  if (Array.isArray(rawDrill))      drilledBranches = rawDrill.filter(b => branches.includes(b));
  else if (typeof rawDrill === 'string' && branches.includes(rawDrill)) drilledBranches = [rawDrill];
  state._indicatorChartDrill[drillKey] = drilledBranches.slice(); // normalize back

  // Wrapper with explicit height so Chart.js respects it
  const canvasWrap = el('div', { style: { position: 'relative', height: chartHeight, width: '100%' } });
  const canvas = el('canvas', { id: canvasId });
  canvasWrap.append(canvas);

  // Banner above the chart when drilled in (one or many branches)
  const groupLabel = state.indicatorsGroupBy === 'teams' ? 'Team' : 'Office';
  const isDrilled  = drilledBranches.length > 0;
  // Drill UI is just a small Reset button inline with the chart title —
  // the old green chip banner above the canvas made the card jump around
  // on every drill change.
  const resetBtn = (supportsDrill && isDrilled)
    ? el('button', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Clear the drilled ' + groupLabel.toLowerCase() + (drilledBranches.length === 1 ? '' : 's') + ' and show everyone again',
        onclick: () => {
          delete state._indicatorChartDrill[drillKey];
          saveDemoData();
          mountApp();
        },
      }, '\u2715 Reset')
    : null;

  const container = el('div', { class: 'card p-5' },
    el('div', { class: 'flex items-center justify-between mb-3 gap-2' },
      el('h3', { class: 'text-sm font-bold' }, title),
      resetBtn || (supportsDrill ? el('span', { class: 'text-[10px] text-muted- italic' },
        'Click a ' + groupLabel.toLowerCase() + ' line to compare against Company \u00b7 click more to stack') : null),
    ),
    canvasWrap,
  );

  // Build chart after DOM insertion
  setTimeout(() => {
    const cvs = document.getElementById(canvasId);
    if (!cvs || typeof Chart === 'undefined') return;

    // Destroy previous instance if it exists
    if (_chartInstances[canvasId]) {
      _chartInstances[canvasId].destroy();
      delete _chartInstances[canvasId];
    }

    // When drilled in, only render the focused branches — Company line gets
    // appended below for context.
    const branchesForChart = drilledBranches.length > 0 ? drilledBranches : branches;

    // ── Precomputed indexes ──────────────────────────────────────────────
    // The per-point closures below used to re-scan `data` and the FULL raw
    // sales array for every plotted point (branches × weeks × full scans),
    // which turned all-time uploads into multi-second renders. Everything is
    // now indexed once up front; per-point work is a Map lookup.
    const rowIx = new Map();
    data.forEach(r => { const k = r.branch + '|' + r.week; const a = rowIx.get(k); if (a) a.push(r); else rowIx.set(k, [r]); });
    const rowsAt = (b, w) => rowIx.get(b + '|' + w) || [];
    let rankIx = null;
    if (isRanking) {
      // Reps W/ A Sale per branch|week — one pass over raw sales (matches the
      // table's single-week reps logic).
      const raw = bucketLabels ? null : indicatorSales();
      const hasRaw = !bucketLabels && Array.isArray(raw) && raw.length > 0;
      const repsIx = new Map();
      if (hasRaw) for (const s of (raw || [])) {
        if (!s.rep) continue;
        const k = s.office + '|' + s.week;
        let set = repsIx.get(k); if (!set) { set = new Set(); repsIx.set(k, set); }
        set.add(s.rep);
      }
      // Each plotted point ranks branches on JUST that week's numbers, so
      // the latest point on the line agrees with the weekly Power Ranking
      // table — including mid-week swaps that a season-to-date cumulative
      // view would bury under prior weeks of data.
      rankIx = new Map();
      for (const w of weeks) {
        const weekData = {};
        branches.forEach(b => {
          const bRows = rowsAt(b, w);
          const sold = bRows.reduce((a, r) => a + r.sold_accounts, 0);
          const rev = bRows.reduce((a, r) => a + r.revenue, 0);
          const multi = bRows.reduce((a, r) => a + r.multi_years, 0);
          let reps = hasRaw ? (repsIx.get(b + '|' + w)?.size || 0) : (bRows[0]?.reps || 0);
          reps = Math.max(1, reps); // avoid divide-by-zero for PRA
          const twelve = bRows.reduce((a, r) => a + (r.twelve_month || 0), 0);
          const ctTotal = twelve + multi;
          // Avg Initial weighted by non-Sentricon counts (falls back to sold_accounts)
          const aiDen = bRows.reduce((a, r) => a + (r.avg_initial_count != null ? r.avg_initial_count : r.sold_accounts), 0);
          const aiNum = bRows.reduce((a, r) => a + r.avg_initial * (r.avg_initial_count != null ? r.avg_initial_count : r.sold_accounts), 0);
          weekData[b] = {
            sold_accounts: sold, revenue: rev,
            avg_initial: aiDen > 0 ? aiNum / aiDen : 0,
            acv: sold > 0 ? rev / sold : 0,
            pra: rev / reps,
            multi_year_pct: ctTotal > 0 ? multi / ctTotal : 0,
            auto_pay_pct: sold > 0 ? bRows.reduce((a, r) => a + r.auto_pay_pct * r.sold_accounts, 0) / sold : 0,
            audit_pct: sold > 0 ? (sold - bRows.reduce((a, r) => a + (r.audit_fail || 0), 0)) / sold : 0,
            reps,
          };
        });
        // Golf scoring — sum of per-metric ranks, lower = better. Matches table.
        // Ties: higher D2D Revenue → higher Avg Pest Initial.
        // Reps W/ A Sale is intentionally EXCLUDED here, mirroring the
        // Power Ranking table — more reps doesn't make a branch a better
        // seller, just a bigger one. Including it here was making the
        // trend chart disagree with the table on the leader.
        // Deselected offices/teams are excluded from Power Ranking — keep the
        // trend's ranking in lockstep with the table so neither scores them.
        const rankBranches = branches.filter(b => !isRankExcluded(b));
        const pts = {};
        rankBranches.forEach(b => pts[b] = 0);
        // Audit % excluded from scoring (shown in the table only) — keep this in
        // lockstep with POWER_RANKING_METRICS so the trend matches the table.
        INDICATOR_METRICS.filter(m => m.key !== 'reps' && m.key !== 'new_revenue' && m.key !== 'renewal_revenue' && m.key !== 'audit_pct' && m.key !== 'last_resort_pct').forEach(m => {
          const sorted = rankBranches.slice().sort((a, b) => (weekData[b]?.[m.key] || 0) - (weekData[a]?.[m.key] || 0));
          sorted.forEach((b, i) => { pts[b] += i + 1; });
        });
        const ranked = rankBranches.slice().sort((a, b) => {
          const tp = (pts[a] || 0) - (pts[b] || 0);
          if (tp !== 0) return tp;
          const rev = (weekData[b]?.revenue || 0) - (weekData[a]?.revenue || 0);
          if (rev !== 0) return rev;
          return (weekData[b]?.avg_initial || 0) - (weekData[a]?.avg_initial || 0);
        });
        ranked.forEach((b, i) => rankIx.set(b + '|' + w, i + 1));
      }
    }

    const datasets = branchesForChart.map(branch => {
      const values = weeks.map(w => {
        if (isRanking) return rankIx.get(branch + '|' + w) || null;

        const weekRow = rowsAt(branch, w)[0];
        if (!weekRow) return null;
        const sold = weekRow.sold_accounts;
        if (metricKey === 'pra') return weekRow.reps > 0 ? weekRow.revenue / weekRow.reps : 0;
        if (metricKey === 'acv') return sold > 0 ? weekRow.revenue / sold : 0;
        if (metricKey === 'revenue') return weekRow.revenue;
        return weekRow[metricKey] || 0;
      });

      return {
        label: branch.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' '),
        data: values,
        borderColor: getGroupColor(branch),
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      };
    });

    // Append a "Company" line when drilled in — same metric, but aggregated
    // across every branch/team for context. PRA = total revenue ÷ total reps;
    // Revenue/ACV/Avg Pest Initial = weighted; multi/auto-pay % = weighted.
    if (drilledBranches.length > 0 && !isRanking) {
      const companyValues = weeks.map(w => {
        const rows = data.filter(r => r.week === w);
        if (rows.length === 0) return null;
        const sold    = rows.reduce((a, r) => a + (r.sold_accounts || 0), 0);
        const revenue = rows.reduce((a, r) => a + (r.revenue || 0), 0);
        const reps    = rows.reduce((a, r) => a + (r.reps || 0), 0);
        if (metricKey === 'revenue')        return revenue;
        if (metricKey === 'sold_accounts')  return sold;
        if (metricKey === 'reps')           return reps;
        if (metricKey === 'pra')            return reps > 0 ? revenue / reps : 0;
        if (metricKey === 'acv')            return sold > 0 ? revenue / sold : 0;
        if (metricKey === 'avg_initial') {
          const den = rows.reduce((a, r) => a + (r.avg_initial_count != null ? r.avg_initial_count : (r.sold_accounts || 0)), 0);
          const num = rows.reduce((a, r) => a + (r.avg_initial || 0) * (r.avg_initial_count != null ? r.avg_initial_count : (r.sold_accounts || 0)), 0);
          return den > 0 ? num / den : 0;
        }
        if (metricKey === 'multi_year_pct' || metricKey === 'auto_pay_pct') {
          // Weighted by sold_accounts to match the table's company-row formula
          const total = sold;
          if (total === 0) return 0;
          return rows.reduce((a, r) => a + ((r[metricKey] || 0) * (r.sold_accounts || 0)), 0) / total;
        }
        return null;
      });
      datasets.push({
        label: 'Company',
        data: companyValues,
        borderColor: 'var(--text-muted)',
        backgroundColor: 'transparent',
        borderDash: [6, 4],
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
      });
    }

    const isDark = state.theme === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const tickColor = isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)';

    _chartInstances[canvasId] = new Chart(cvs.getContext('2d'), {
      type: 'line',
      data: {
        labels: weeks.map(w => {
          if (bucketLabels) return bucketLabels[w] || '';
          const row = data.find(r => r.week === w && r.date);
          return indicatorWeekLabel(w, { short: true, rows: data }) + (row?.date ? '\n' + row.date : '');
        }),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 10, right: 20, bottom: 5, left: 5 } },
        // Click any branch/team line to toggle it into a stacked drill
        // comparison vs Company. The chart's tooltip uses `index` mode so
        // every line shows on hover — for the click, we resolve the actual
        // closest line to the cursor instead of relying on els[0] (which
        // would always be the alphabetically-first branch).
        onClick: supportsDrill ? (evt, _els) => {
          const chart = _chartInstances[canvasId];
          if (!chart) return;
          // 'nearest' with axis: 'xy' picks the line whose point is closest
          // to where the user actually clicked, regardless of tooltip mode.
          const elems = chart.getElementsAtEventForMode(
            evt.native || evt, 'nearest', { intersect: false, axis: 'xy' }, false);
          if (!elems.length) return;
          const ds = chart.data.datasets[elems[0].datasetIndex];
          if (!ds || !ds.label || ds.label === 'Company') return;
          // Datasets use Title-Cased labels; resolve back to the original branch key
          const branchKey = branches.find(b =>
            b.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ') === ds.label
          ) || ds.label;
          if (!branchKey) return;
          const current = Array.isArray(state._indicatorChartDrill[drillKey]) ? state._indicatorChartDrill[drillKey] : [];
          const next = current.includes(branchKey)
            ? current.filter(x => x !== branchKey) // toggle off
            : [...current, branchKey];             // stack on
          state._indicatorChartDrill[drillKey] = next;
          saveDemoData();
          mountApp();
        } : undefined,
        onHover: supportsDrill ? (e, els) => {
          if (e?.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default';
        } : undefined,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 11 }, usePointStyle: true },
          },
          tooltip: { backgroundColor: '#323230', titleFont: { size: 12 }, bodyFont: { size: 11 }, padding: 10, cornerRadius: 8,
            // Sort items so leader is on top; for the Power Ranking chart
            // lower y = better, otherwise higher y = better.
            itemSort: (a, b) => isRanking ? a.parsed.y - b.parsed.y : b.parsed.y - a.parsed.y,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const idx = items[0].dataIndex;
                const w = weeks[idx];
                if (bucketLabels) return String(bucketLabels[w] || '').replace('\n', ' · ');
                const row = data.find(r => r.week === w && r.date);
                return indicatorWeekLabel(w, { rows: data }) + (row?.date ? ' (' + row.date + ')' : '');
              },
              label: (ctx) => {
                const me = ctx.parsed.y;
                if (me == null) return ctx.dataset.label;
                // Rank = how many other branches/teams have a strictly better
                // value at this week + 1. Ties share the same rank.
                let rank = 1;
                ctx.chart.data.datasets.forEach(ds => {
                  const v = ds.data[ctx.dataIndex];
                  if (v == null) return;
                  if (isRanking ? v < me : v > me) rank++;
                });
                const lbl = ctx.dataset.label;
                // Format value to match the y-axis tick formatting
                let formatted;
                if (isRanking) {
                  formatted = '#' + Math.round(me);
                } else if (['revenue', 'acv', 'pra', 'avg_initial'].includes(metricKey)) {
                  formatted = '$' + Math.round(me).toLocaleString();
                } else if (['auto_pay_pct', 'multi_year_pct'].includes(metricKey)) {
                  formatted = (me * 100).toFixed(1) + '%';
                } else {
                  formatted = String(me);
                }
                return rank + '. ' + lbl + ': ' + formatted;
              },
            },
          },
        },
        scales: {
          y: {
            reverse: isRanking,
            beginAtZero: !isRanking,
            grid: { color: isRanking ? 'rgba(223,100,58,.15)' : gridColor },
            ticks: { font: { size: 10 }, color: tickColor,
              callback: isRanking
                ? undefined
                : (['revenue', 'avg_initial', 'acv', 'pra'].includes(metricKey)
                    ? (v => '$' + (Math.abs(v) >= 1000000 ? (v / 1000000).toFixed(1).replace(/\.0M?$/, '') + 'M' : Math.abs(v) >= 1000 ? Math.round(v / 1000) + 'K' : v))
                    : (['auto_pay_pct', 'multi_year_pct'].includes(metricKey)
                        ? (v => (v * 100).toFixed(0) + '%')
                        : undefined)),
            },
            ...(isRanking ? {
              min: 0.5,
              max: branches.length + 0.5,
              afterBuildTicks: (axis) => {
                axis.ticks = Array.from({ length: branches.length }, (_, i) => ({ value: i + 1 }));
              },
              ticks: {
                stepSize: 1,
                autoSkip: false,
                font: { size: 10 },
                color: tickColor,
                callback: (v) => Number.isInteger(v) && v >= 1 && v <= branches.length ? String(v) : '',
              },
            } : {}),
          },
          x: { grid: { display: false }, ticks: { font: { size: 9 }, color: tickColor, maxRotation: 0 } },
        },
      },
    });
  }, 150);

  return container;
}

function viewHistory({ embedded = false } = {}) {
  // History is the SETTLED queue: a sale lands here only after the backend-
  // lock decision is made (Lock or Chargeback) or it's been terminated on
  // the upfront pass with a non-cancellable status (Not Payable / Reschedule).
  // Cancels live on the Sales tab so admins can reinstate them inline.
  const SETTLED_AUDIT = new Set(['not_payable', 'reschedule']);
  const isSettled = (s) => {
    const lock = s.lock_status || 'pending';
    // Lock/Chargeback don't count as settled until backend payroll has
    // actually run — same gate the Sales tab uses for History pill.
    // Not Payable / Reschedule now live on the Sales tab's Archived pill.
    return (lock === 'lock' || lock === 'chargeback') && !!s.backend_payroll_processed_at;
  };
  const rows = state.mySales.filter(isSettled).sort((a, b) => new Date(b.sold_date) - new Date(a.sold_date));
  const filterState = { q: '', status: '', source: '' };

  const container = el('div', { class: 'flex flex-col gap-4' + (embedded ? '' : ' w-full') });

  // Embedded mode lives inside the Sales tab — the queue-pill label is
  // already serving as the section header, so we skip the H1 + tagline.
  if (!embedded) {
    container.append(
      el('div', {},
        el('h1', { class: 'text-3xl font-bold' }, 'Sales History'),
        el('p', { class: 'text-muted- text-sm mt-1' }, 'Every sale on record, filterable and exportable.'),
      ),
    );
  }

  const tableHost = el('div', {});
  const filterBar = el('div', { class: 'flex flex-wrap gap-2 items-center' },
    el('input', {
      class: 'flex-1 min-w-[200px] rounded-lg border px-2.5 py-1 text-[11px]',
      placeholder: 'Search customer or notes…',
      oninput: e => { filterState.q = e.target.value.toLowerCase(); renderTable(); },
    }),
    el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px]',
      onchange: e => { filterState.status = e.target.value; renderTable(); },
    },
      el('option', { value: '' }, 'All statuses'),
      el('option', { value: 'serviced' },       'Serviced'),
      el('option', { value: 'below_minimums' }, 'Below Minimums'),
      el('option', { value: 'nsf' },            'NSF'),
      el('option', { value: 'not_payable' },    'Not Payable'),
      el('option', { value: 'reschedule' },     'Reschedule'),
    ),
    el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px]',
      onchange: e => { filterState.source = e.target.value; renderTable(); },
    },
      el('option', { value: '' }, 'All sources'),
      ...state.sources.map(s => el('option', { value: s.id }, s.name)),
    ),
  );

  function filterRows() {
    return rows.filter(s => {
      if (filterState.q) {
        const hay = (s.customer_name + ' ' + (s.notes || '')).toLowerCase();
        if (!hay.includes(filterState.q)) return false;
      }
      if (filterState.status && s.audit_status !== filterState.status) return false;
      if (filterState.source && s.source_id !== Number(filterState.source)) return false;
      return true;
    });
  }

  function renderTable() {
    const r = filterRows();
    tableHost.innerHTML = '';
    tableHost.append(
      el('div', { class: 'text-xs text-muted- px-1 py-2' }, `${r.length} record${r.length === 1 ? '' : 's'}`),
      el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'scroll-x' },
          el('table', { class: 'w-full text-sm' },
            el('thead', { class: 'text-[10px] uppercase tracking-widest text-muted-', style: { background: 'var(--card-2)' } },
              el('tr', {},
                el('th', { class: 'text-left px-3 py-2' }, 'Customer'),
                el('th', { class: 'text-left px-3 py-2 desktop-only' }, 'Cust #'),
                el('th', { class: 'text-left px-3 py-2' }, 'Sold by'),
                el('th', { class: 'text-left px-3 py-2 desktop-only' }, 'Office'),
                el('th', { class: 'text-left px-3 py-2' }, 'Service'),
                el('th', { class: 'text-left px-3 py-2 desktop-only' }, 'Source'),
                el('th', { class: 'text-right px-3 py-2' }, 'Initial'),
                el('th', { class: 'text-right px-3 py-2 desktop-only' }, 'Monthly'),
                el('th', { class: 'text-right px-3 py-2' }, 'Revenue'),
                el('th', { class: 'text-left px-3 py-2' }, 'Sold'),
                el('th', { class: 'text-left px-3 py-2' }, 'Status'),
                el('th', { class: 'text-left px-3 py-2' }, 'Audit 2'),
                el('th', { class: 'text-left px-3 py-2' }, 'Lock'),
              ),
            ),
            el('tbody', {}, r.length === 0
              ? el('tr', {}, el('td', { colspan: 13, class: 'text-center text-muted- py-8' }, 'No results.'))
              : r.map(s => {
                  return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
                    el('td', { class: 'px-3 py-2.5 font-medium' }, s.customer_name),
                    el('td', { class: 'px-3 py-2.5 text-muted- desktop-only' }, s.customer_number || '—'),
                    el('td', { class: 'px-3 py-2.5 whitespace-nowrap' }, ((state.allProfiles || []).find(p => p.id === s.rep_id) || {}).full_name || '—'),
                    el('td', { class: 'px-3 py-2.5 text-muted- desktop-only' }, nameFromId(state.offices, s.office_id)),
                    el('td', { class: 'px-3 py-2.5 text-muted-' }, nameFromId(state.serviceTypes, s.service_type_id)),
                    el('td', { class: 'px-3 py-2.5 text-muted- desktop-only' }, nameFromId(state.sources, s.source_id)),
                    el('td', { class: 'px-3 py-2.5 text-right tabular-nums' }, fmt.usd(s.initial_amount)),
                    el('td', { class: 'px-3 py-2.5 text-right tabular-nums desktop-only' }, fmt.usd(s.monthly_amount)),
                    el('td', { class: 'px-3 py-2.5 text-right tabular-nums font-medium' }, fmt.usd(s.revenue_amount)),
                    el('td', { class: 'px-3 py-2.5 text-muted- tabular-nums' }, fmt.dateShort(s.sold_date)),
                    el('td', { class: 'px-3 py-2.5' }, statusChip(s.audit_status)),
                    el('td', { class: 'px-3 py-2.5 whitespace-nowrap' },
                      SETTLED_AUDIT.has(s.audit_status)
                        ? el('span', { class: 'text-xs', style: { color: 'var(--text-subtle)' } }, '—')
                        : auditor2Select(s.id)),
                    el('td', { class: 'px-3 py-2.5 whitespace-nowrap' },
                      SETTLED_AUDIT.has(s.audit_status)
                        ? el('span', { class: 'text-xs', style: { color: 'var(--text-subtle)' } }, '—')
                        : lockStatusSelect(s.id)),
                  );
                }),
            ),
          ),
        ),
      ),
    );
  }

  container.append(filterBar, tableHost);
  renderTable();
  return container;
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: SCORECARDS — monthly per-agent performance scorecards. Phase 1
// implements the Inside Sales template (Attendance 15% / Close% 25% /
// Accuracy 25% / Audit 35%) with manual entry and a per-day attendance
// calculator. Data lives in state._scorecardData keyed by
// `${agent}|${YYYY-MM}`; the template config (weights + penalties) lives
// in state._scorecardTemplate so future Phase 2 work can support
// multiple templates without a schema change.
// ──────────────────────────────────────────────────────────────────────────

const SCORECARD_DEFAULT_TEMPLATE = {
  name: 'Inside Sales',
  // Close-heavy split (per Isaac): the selling skill carries the most
  // weight, call audits stay meaningful, accuracy and attendance follow.
  metrics: [
    { id: 'close_pct',  label: 'Close %',              weight: 0.35, source: 'manual' },
    { id: 'audit',      label: 'Audit Score (Calls)',  weight: 0.30, source: 'manual' },
    { id: 'accuracy',   label: 'Accuracy Score',       weight: 0.20, source: 'manual' },
    { id: 'attendance', label: 'Attendance Score',     weight: 0.15, source: 'attendance' },
  ],
  attendance: {
    // workingDays is computed dynamically from the scorecard period
    // (Mon–Sat in the selected month) unless the user types an
    // override in the modal. A stored value here is kept as a fallback
    // for periods that fail to parse.
    workingDays: null,
    // Two penalty shapes:
    //   unit: 'days'    → deduction = (count × weightDays) ÷ workingDays × 100%
    //                     (so each tardy costs one working day of attendance)
    //   unit: 'percent' → deduction = count × weight (flat %)
    // Final score = max(0, 100 − Σ deductions).
    penalties: [
      { id: 'tardyLate',         label: 'Tardies / Lates',      unit: 'days',    weightDays: 1 },
      { id: 'sameDayCallout',    label: 'Same-Day Call Outs',   unit: 'percent', weight: 10 },
      { id: 'leftLateOver1Hour', label: 'Left / Late > 1 Hour', unit: 'percent', weight: 5  },
    ],
  },
};

// ── Scorecard departments (per Isaac) ──
// Inside Sales and Loyalty each get their OWN template. An agent's
// department comes from their rep_type (same rule the Calendar uses),
// with the Loyalty lead role as a fallback for leads whose rep_type was
// never set. Reps see only their own card; team leads see their whole
// department; admins switch departments with the dropdown.
const SCORECARD_DEPTS = [
  { id: 'inside_sales', label: 'Inside Sales' },
  { id: 'loyalty',      label: 'Loyalty' },
];

function scorecardDeptOf(p) {
  if (!p) return 'inside_sales';
  if (p.rep_type === 'loyalty_rep' || p.role === 'rep_loyalty' || p.role === 'rep_loyalty_lead') return 'loyalty';
  return 'inside_sales';
}

const SCORECARD_LOYALTY_DEFAULT_TEMPLATE = {
  name: 'Loyalty',
  // Same weight shape as Inside Sales, but the selling skill is SAVES:
  // rename/retune anything in the template editor.
  metrics: [
    { id: 'save_pct',   label: 'Save %',               weight: 0.35, source: 'manual' },
    { id: 'audit',      label: 'Audit Score (Calls)',  weight: 0.30, source: 'manual' },
    { id: 'accuracy',   label: 'Accuracy Score',       weight: 0.20, source: 'manual' },
    { id: 'attendance', label: 'Attendance Score',     weight: 0.15, source: 'attendance' },
  ],
  attendance: {
    workingDays: null,
    penalties: [
      { id: 'tardyLate',         label: 'Tardies / Lates',      unit: 'days',    weightDays: 1 },
      { id: 'sameDayCallout',    label: 'Same-Day Call Outs',   unit: 'percent', weight: 10 },
      { id: 'leftLateOver1Hour', label: 'Left / Late > 1 Hour', unit: 'percent', weight: 5  },
    ],
  },
};

// Mon–Sat working-day count for a YYYY-MM period key. Matches the
// rest of the platform's "RIDD weeks run Sunday-off only" convention
// (TV dashboard, indicators goal math). Returns 0 if the key can't be
// parsed so the attendance formula can fall back to the template default.
function workingDaysForPeriod(periodKey) {
  if (!periodKey) return 0;
  const m = String(periodKey).match(/^(\d{4})-(\d{2})$/);
  if (!m) return 0;
  const year  = Number(m[1]);
  const month = Number(m[2]);
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0) count++; // skip Sundays only
  }
  return count;
}

function getScorecardTemplate(dept = 'inside_sales') {
  // Merge the saved template over the defaults so newly-added fields
  // (like penalty `unit`) automatically appear in older saved templates.
  // Per-department store; the legacy single _scorecardTemplate blob was
  // always the Inside Sales template, so it stays that dept's fallback.
  const store = (state._scorecardTemplates && typeof state._scorecardTemplates === 'object') ? state._scorecardTemplates : {};
  const DEF = dept === 'loyalty' ? SCORECARD_LOYALTY_DEFAULT_TEMPLATE : SCORECARD_DEFAULT_TEMPLATE;
  const saved = store[dept] || (dept === 'inside_sales' ? (state._scorecardTemplate || {}) : {});
  const merged = {
    name:       saved.name       || DEF.name,
    metrics:    Array.isArray(saved.metrics) && saved.metrics.length ? saved.metrics : DEF.metrics,
    attendance: saved.attendance || DEF.attendance,
  };
  // One-time migration: a saved template still carrying the ORIGINAL default
  // weights (15/25/25/35) was never customized — upgrade it to the new
  // close-heavy split. Custom weights are always left alone.
  {
    const w = Object.fromEntries((merged.metrics || []).map(m => [m.id, Number(m.weight)]));
    if (merged.metrics.length === 4 && w.attendance === 0.15 && w.close_pct === 0.25 && w.accuracy === 0.25 && w.audit === 0.35) {
      merged.metrics = DEF.metrics.map(m => ({ ...m }));
    }
  }
  // Upgrade legacy penalties (no `unit` field). For the three baked-in
  // IDs we adopt the latest defaults (so a user who never customized
  // gets the new percent-based deductions automatically). Anything with
  // a custom ID falls back to 'days' unit using its existing weightDays.
  if (Array.isArray(merged.attendance.penalties)) {
    const defaultsById = Object.fromEntries(
      DEF.attendance.penalties.map(p => [p.id, p])
    );
    merged.attendance = {
      ...merged.attendance,
      penalties: merged.attendance.penalties.map(p => {
        if (p && p.unit) return p; // already migrated
        const d = defaultsById[p.id];
        if (d) return { ...p, unit: d.unit, weight: d.weight, weightDays: d.weightDays };
        return { ...p, unit: 'days' };
      }),
    };
  }
  return merged;
}

function scorecardPeriodOptions() {
  // Months from the CURRENT month back to whichever is oldest: 12 months
  // ago, the earliest scored card, or the earliest logged 1:1 — so history
  // never falls off the dropdown as time goes on (per Isaac). Anchored to
  // today, never a future-dated sale (that put November 2026 at the top).
  const today = new Date();
  const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  let earliest = ym(new Date(today.getFullYear(), today.getMonth() - 11, 1));
  const consider = (k) => { if (/^\d{4}-\d{2}$/.test(k || '') && k < earliest && k >= '2015-01') earliest = k; };
  Object.keys(state._scorecardData || {}).forEach(k => consider(k.split('|')[1]));
  (state._scorecardMeetings || []).forEach(m => consider(String(m.period || m.meeting_date || '').slice(0, 7)));
  const opts = [];
  for (let d = new Date(today.getFullYear(), today.getMonth(), 1); ym(d) >= earliest; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
    opts.push({ key: ym(d), label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
  }
  return opts;
}

// Composite score (0–100) for a single scorecard. Attendance metric
// derives from the calculator below; other metrics are entered manually.
// `periodKey` (YYYY-MM) lets the attendance helper compute working days
// dynamically for the month being scored.
// Scores are OUT OF 100, not percentages (per Isaac's sheet): 85.75, 90.
function fmtScore(v, dp = 2) { return Number.isFinite(v) ? String(Math.round(v * Math.pow(10, dp)) / Math.pow(10, dp)) : '\u2014'; }
// Audit / Accuracy metrics (per Isaac, Sep 2026): graded calls roll up
// into the score AUTOMATICALLY — a hand-entered value on the card still
// wins, but nobody has to click "Apply" for logged audits to count. Pass
// `profileId` so the rollup can be looked up; `card` may be an empty shell
// for a rep who has audits but no saved card yet.
function scorecardAutoMetric(profileId, metricId, periodKey) {
  if (!profileId || typeof callAuditRollup !== 'function') return null;
  if (metricId !== 'audit' && metricId !== 'accuracy') return null;
  const r = callAuditRollup(profileId, periodKey);
  if (!r || !r.n) return null;
  const v = metricId === 'audit' ? r.call : r.accuracy;
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}
function computeScorecardScore(card, tpl, periodKey, profileId) {
  if (!card) return null;
  const attendanceScore = computeAttendanceScore(card.attendance || {}, tpl.attendance, periodKey);
  let composite = 0;
  let totalWeight = 0;
  const breakdown = {};
  for (const m of tpl.metrics) {
    let v = m.source === 'attendance'
      ? attendanceScore
      : Number(card.metrics?.[m.id]);
    if (!Number.isFinite(v)) { const auto = scorecardAutoMetric(profileId, m.id, periodKey); if (auto != null) v = auto; }
    if (Number.isFinite(v)) {
      composite   += v * m.weight;
      totalWeight += m.weight;
      breakdown[m.id] = v;
    }
  }
  // Straight weighted sum, exactly like the Performance score row on
  // Isaac's sheet (Σ score × weight). A metric left blank contributes 0
  // — the card shows how much of the template is filled so a partial
  // month reads as partial, not as a bad month.
  const final = composite;
  return {
    final: Math.round(final * 100) / 100,
    breakdown,
    attendanceScore,
    coverage: totalWeight, // 0..1 — how much of the template was filled
  };
}

// Resolve the working-days denominator for a period. User override on
// the card wins; otherwise we compute Mon–Sat days from the period;
// otherwise the template default; otherwise 22 as last resort.
function resolveWorkingDays(att, tplAtt, periodKey) {
  const override = Number(att && att.workingDays);
  if (Number.isFinite(override) && override > 0) return override;
  const dynamic = workingDaysForPeriod(periodKey);
  if (dynamic > 0) return dynamic;
  const tplDefault = Number(tplAtt && tplAtt.workingDays);
  if (Number.isFinite(tplDefault) && tplDefault > 0) return tplDefault;
  return 22;
}

function computeAttendanceScore(att, tplAtt, periodKey) {
  const workingDays = resolveWorkingDays(att, tplAtt, periodKey);
  if (workingDays <= 0) return 0;
  let deduction = 0;
  for (const p of (tplAtt.penalties || [])) {
    const n = Number((att && att[p.id]) || 0);
    if (!n) continue;
    if (p.unit === 'percent') {
      // Flat percentage points off the top per occurrence.
      deduction += n * Number(p.weight || 0);
    } else {
      // 'days' (default) — each occurrence costs N working days of
      // attendance, scaled by the actual month length. Legacy templates
      // without a unit field fall through here.
      deduction += (n * Number(p.weightDays || 0)) / workingDays * 100;
    }
  }
  const score = Math.max(0, 100 - deduction);
  return Math.round(score * 10) / 10;
}

// Color band for a composite or per-metric score. Mirrors industry
// scorecard conventions: ≥90 strong, 75–89 watch, <75 intervene.
function scorecardBand(score) {
  if (score == null || !Number.isFinite(score)) return { color: 'var(--text-muted)', bg: 'var(--card-2)', label: '—' };
  if (score >= 90) return { color: '#DF643A', bg: 'rgba(223,100,58,.16)', label: 'Strong' };
  if (score >= 75) return { color: '#A9441F', bg: 'rgba(223,100,58,.18)', label: 'Watch' };
  return { color: '#B91C1C', bg: 'rgba(220,38,38,.14)', label: 'Intervene' };
}


// ── Call-audit QA rubrics (per Isaac) ─────────────────────────────────
// Replaces the old sheet's binary 0/1 call grading. Each call is graded
// against weighted sections; every criterion is Yes (full) / Partial
// (half) / No (0) / N-A (out of the denominator), so a call doesn't have
// to be perfect to score well — it earns points for what was done right.
// Compliance sections flag the call when any criterion is a hard No.
const SCORECARD_CALL_RUBRICS = {
  inside_sales: {
    call: [
      { id: 'discovery', label: 'Discovery', weight: 20, criteria: [
        { id: 'probe',   label: 'Asked probing questions to identify the pest & situation' },
        { id: 'home',    label: 'Confirmed home / property details' },
        { id: 'concern', label: 'Uncovered the customer’s real concern' },
      ] },
      { id: 'value', label: 'Value Build', weight: 25, criteria: [
        { id: 'topdown', label: 'Started top-down at the right package' },
        { id: 'tied',    label: 'Tied coverage to the customer’s issue' },
        { id: 'explain', label: 'Explained the initial + recurring service clearly' },
      ] },
      { id: 'close', label: 'Close & Objections', weight: 30, criteria: [
        { id: 'rebuttal', label: 'Handled objections with a real rebuttal' },
        { id: 'urgency',  label: 'Created urgency & asked for the sale' },
        { id: 'price',    label: 'Defended price before discounting' },
      ] },
      { id: 'compliance', label: 'Compliance & Terms', weight: 25, flag: true, criteria: [
        { id: 'floor',    label: 'Stayed at / above the pricing floor' },
        { id: 'terms',    label: 'Reviewed agreement terms & length' },
        { id: 'contract', label: 'Sent the contract for signature (no verbal-only)' },
      ] },
    ],
    accuracy: [
      { id: 'acc', label: 'Accuracy', weight: 100, criteria: [
        { id: 'notes',    label: 'Call notes logged accurately' },
        { id: 'build',    label: 'Subscription / pricing built right in FieldRoutes' },
        { id: 'followup', label: 'Follow-up scheduled if unbooked' },
      ] },
    ],
  },
  loyalty: {
    call: [
      { id: 'discovery', label: 'Reason Discovery', weight: 25, criteria: [
        { id: 'listen', label: 'Listened & probed WHY they want to cancel' },
        { id: 'ack',    label: 'Acknowledged the concern before pitching' },
      ] },
      { id: 'value', label: 'Value Rebuild', weight: 30, criteria: [
        { id: 'tied',   label: 'Rebuttal tied to their specific reason' },
        { id: 'remind', label: 'Reminded them of coverage / service history' },
      ] },
      { id: 'save', label: 'Save Attempt', weight: 30, criteria: [
        { id: 'offer', label: 'Made a real save offer' },
        { id: 'ask',   label: 'Asked them to stay' },
      ] },
      { id: 'compliance', label: 'Compliance', weight: 15, flag: true, criteria: [
        { id: 'honest',  label: 'No false promises — accurate policy' },
        { id: 'process', label: 'Followed the cancel / save process' },
      ] },
    ],
    accuracy: [
      { id: 'acc', label: 'Accuracy', weight: 100, criteria: [
        { id: 'reason',   label: 'Cancellation reason coded correctly' },
        { id: 'notes',    label: 'Account notes logged accurately' },
        { id: 'saveback', label: 'Save-back / cancel processed correctly' },
      ] },
    ],
  },
};

// grades: { 'sectionId.criterionId': 2|1|0 } — missing/null = N/A (excluded).
function callAuditScore(grades, dept, kind) {
  const rub = (SCORECARD_CALL_RUBRICS[dept] || SCORECARD_CALL_RUBRICS.inside_sales)[kind] || [];
  let wEarned = 0, wPossible = 0, flagged = false, graded = 0;
  for (const sec of rub) {
    let e = 0, pp = 0;
    for (const c of sec.criteria) {
      const g = (grades || {})[sec.id + '.' + c.id];
      if (g == null) continue;
      pp += 2; e += Number(g) || 0; graded++;
      if (sec.flag && Number(g) === 0) flagged = true;
    }
    if (pp > 0) { wEarned += (e / pp) * sec.weight; wPossible += sec.weight; }
  }
  return { score: wPossible > 0 ? wEarned / wPossible * 100 : null, flagged, graded };
}

function callAuditRollup(profileId, period) {
  const list = ((state._scorecardAudits || {})[profileId + '|' + period]) || [];
  const calls = list.map(a => Number(a.call_score)).filter(Number.isFinite);
  const accs  = list.map(a => Number(a.accuracy_score)).filter(Number.isFinite);
  const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return { n: list.length, call: avg(calls), accuracy: avg(accs), flags: list.filter(a => a.flagged).length };
}

// ── Scorecards cloud persistence (per Isaac: make the swap permanent) ──
// Cards + call audits live in their own Supabase tables (scorecard_cards /
// call_audits — run scorecards_v1.sql once). Local state stays the working
// cache so the render code is unchanged: loads hydrate it, edits write
// through. DEMO mode stays local-only.
async function loadScorecardCloud(period) {
  if (typeof DEMO !== 'undefined' && DEMO) return;
  if (typeof supabase === 'undefined' || !supabase) return;
  if (state._scorecardCloudFor === period || state._scorecardCloudLoading) return;
  state._scorecardCloudLoading = true;
  try {
    const [cards, audits] = await Promise.all([
      supabase.from('scorecard_cards').select('*').eq('period', period),
      supabase.from('call_audits').select('*').eq('period', period).order('call_date', { ascending: true }),
    ]);
    if (!cards.error) {
      state._scorecardData = state._scorecardData || {};
      for (const row of (cards.data || [])) {
        const d = row.data || {};
        state._scorecardData[row.profile_id + '|' + row.period] = {
          metrics: d.metrics || {}, attendance: d.attendance || {}, notes: d.notes || '',
          finalized: row.finalized || null, reviewed: row.reviewed || null,
        };
      }
    }
    if (!audits.error) {
      state._scorecardAudits = state._scorecardAudits || {};
      for (const k of Object.keys(state._scorecardAudits)) if (k.endsWith('|' + period)) delete state._scorecardAudits[k];
      for (const a of (audits.data || [])) {
        const k = a.profile_id + '|' + a.period;
        (state._scorecardAudits[k] = state._scorecardAudits[k] || []).push(a);
      }
    }
    state._scorecardCloudFor = period;
  } catch (e) { console.warn('scorecard cloud load failed', e); }
  state._scorecardCloudLoading = false;
  if (state.view === 'scorecards') mountApp();
}

// Period-aware upsert used by the 1:1 meeting form (the performance
// review scores ANY month, not just the page's selected period). Same
// merge semantics as viewScorecards' upsertCard, then cloud save.
function scorecardUpsertCard(profileId, period, patch) {
  state._scorecardData = state._scorecardData || {};
  const k = profileId + '|' + period;
  const cur = state._scorecardData[k] || { metrics: {}, attendance: {}, notes: '' };
  state._scorecardData[k] = {
    metrics:    { ...(cur.metrics || {}),    ...(patch.metrics || {}) },
    attendance: { ...(cur.attendance || {}), ...(patch.attendance || {}) },
    notes:      patch.notes != null ? patch.notes : (cur.notes || ''),
    finalized:  patch.finalized !== undefined ? patch.finalized : (cur.finalized || null),
    reviewed:   patch.reviewed  !== undefined ? patch.reviewed  : (cur.reviewed  || null),
  };
  saveDemoData();
  const p = (state.allProfiles || []).find(x => x.id === profileId);
  const d = scorecardDeptOf(p || state.profile);
  saveScorecardCardCloud(profileId, period, d, getScorecardTemplate(d));
}

function saveScorecardCardCloud(profileId, period, dept, tpl) {
  if (typeof DEMO !== 'undefined' && DEMO) return;
  if (typeof supabase === 'undefined' || !supabase) return;
  const card = (state._scorecardData || {})[profileId + '|' + period];
  if (!card) return;
  let final = null;
  try {
    const sc = computeScorecardScore(card, tpl, period, profileId);
    if (sc && sc.coverage > 0) final = Number(sc.final.toFixed(2));
  } catch (e) { /* score stays null */ }
  supabase.from('scorecard_cards').upsert({
    profile_id: profileId, period, dept,
    data: { metrics: card.metrics || {}, attendance: card.attendance || {}, notes: card.notes || '' },
    weights: (tpl && Array.isArray(tpl.metrics)) ? tpl.metrics.map(m => ({ id: m.id, label: m.label, weight: m.weight })) : null,
    final_score: final,
    finalized: card.finalized || null,
    reviewed: card.reviewed || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,period' }).then(({ error }) => {
    if (error) console.warn('scorecard cloud save failed:', error.message);
  });
}

function saveCallAuditRow(row) {
  if (typeof trackAction === 'function') trackAction('call_audit', 'save');
  const k = row.profile_id + '|' + row.period;
  state._scorecardAudits = state._scorecardAudits || {};
  (state._scorecardAudits[k] = state._scorecardAudits[k] || []).push(row);
  saveDemoData();
  if (!(typeof DEMO !== 'undefined' && DEMO) && typeof supabase !== 'undefined' && supabase) {
    const payload = { ...row };
    delete payload.id;
    supabase.from('call_audits').insert(payload).select().then(({ data, error }) => {
      if (!error && data && data[0]) row.id = data[0].id;
      else if (error) console.warn('call audit save failed:', error.message);
    });
  }
}

function deleteCallAuditRow(a) {
  const k = a.profile_id + '|' + a.period;
  const list = (state._scorecardAudits || {})[k] || [];
  const i = list.indexOf(a);
  if (i >= 0) list.splice(i, 1);
  saveDemoData();
  if (!(typeof DEMO !== 'undefined' && DEMO) && typeof supabase !== 'undefined' && supabase && a.id && !String(a.id).startsWith('local-'))
    supabase.from('call_audits').delete().eq('id', a.id).then(({ error }) => { if (error) console.warn('call audit delete failed:', error.message); });
}

// Grade-a-call modal: rubric sections with Yes / Partial / No / N-A per
// criterion, live score, meta fields matching the old audit sheet.
function openCallAuditModal(profile, period, dept, onDone) {
  const overlay = el('div', { class: 'modal-overlay', style: { zIndex: '210' } });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', { class: 'card w-full max-w-2xl p-6 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(modal);
  const rub = SCORECARD_CALL_RUBRICS[dept] || SCORECARD_CALL_RUBRICS.inside_sales;
  const meta = { call_date: new Date().toISOString().slice(0, 10), call_ref: '', customer_ref: '', call_type: '', outcome: '', notes: '' };
  const grades = {};
  const OUTCOMES = dept === 'loyalty'
    ? ['Saved', 'Cancelled', 'Pending', 'Resign', 'Other']
    : ['Qualified - Booked', 'Qualified - Unbooked', 'Not Qualified', 'Follow-Up Set', 'Other'];
  const GRADE_BTNS = [[2, 'Yes'], [1, 'Half'], [0, 'No'], [null, 'N/A']];
  const render = () => {
    modal.innerHTML = '';
    const callSc = callAuditScore(grades, dept, 'call');
    const accSc  = callAuditScore(grades, dept, 'accuracy');
    modal.append(el('div', { class: 'flex items-start justify-between gap-4 mb-4' },
      el('div', {},
        el('h2', { class: 'text-xl font-bold' }, 'Audit a Call'),
        el('div', { class: 'text-xs text-muted- mt-1' }, (profile.full_name || 'Agent') + ' · ' + period)),
      el('div', { class: 'flex items-center gap-3' },
        el('div', { class: 'text-right' },
          el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-bold' }, 'Call'),
          el('div', { class: 'text-lg font-black tabular-nums', style: { color: 'var(--accent)' } }, callSc.score == null ? '—' : callSc.score.toFixed(0) + '%')),
        el('div', { class: 'text-right' },
          el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-bold' }, 'Accuracy'),
          el('div', { class: 'text-lg font-black tabular-nums', style: { color: 'var(--accent)' } }, accSc.score == null ? '—' : accSc.score.toFixed(0) + '%')),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×'))));
    if (callSc.flagged) modal.append(el('div', { class: 'rounded-lg border px-3 py-2 text-[11px] mb-3', style: { borderColor: '#DC2626', background: 'rgba(220,38,38,.08)', color: '#DC2626' } },
      '⚑ Compliance flag — a compliance criterion is graded No. The call still scores; the flag rides with it.'));
    const inp = (key, ph, type) => el('input', {
      type: type || 'text', placeholder: ph, value: meta[key] || '',
      class: 'rounded-lg border px-2.5 py-1 text-[11px] w-full',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
      oninput: (e) => { meta[key] = e.target.value; },
    });
    modal.append(el('div', { class: 'grid grid-cols-2 gap-2 mb-3' },
      inp('call_date', 'Call date', 'date'),
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] w-full cursor-pointer',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
        onchange: (e) => { meta.outcome = e.target.value; },
      }, el('option', { value: '' }, 'Outcome…'), ...OUTCOMES.map(o => el('option', { value: o, selected: meta.outcome === o }, o))),
      inp('call_ref', 'Five9 / phone #'),
      inp('customer_ref', 'FieldRoutes customer #'),
      el('div', { style: { gridColumn: 'span 2' } }, inp('call_type', 'Call type (e.g. Pest quote, Rodent service, Resign)'))));
    const secBlock = (sec, kind) => el('div', { class: 'mb-3' },
      el('div', { class: 'flex items-center justify-between mb-1' },
        el('div', { class: 'text-[11px] font-bold uppercase tracking-wider' }, sec.label + (sec.flag ? ' ⚑' : '')),
        kind === 'call' ? el('div', { class: 'text-[10px] text-muted-' }, sec.weight + '% of call score') : null),
      ...sec.criteria.map(c => {
        const k = sec.id + '.' + c.id;
        const cur = grades[k];
        return el('div', { class: 'flex items-center justify-between gap-2 border-t py-1.5', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'text-xs flex-1 min-w-0' }, c.label),
          el('div', { class: 'flex gap-1 shrink-0' }, ...GRADE_BTNS.map(([v, lab]) => {
            const on = v == null ? (k in grades && grades[k] == null) : cur === v;
            return el('button', {
              class: 'rounded border px-2 py-0.5 text-[10px] font-bold transition',
              style: on
                ? { borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)' }
                : { borderColor: 'var(--border-2)', background: 'transparent', color: 'var(--text-muted)' },
              onclick: () => { if (v == null) grades[k] = null; else grades[k] = v; render(); },
            }, lab);
          })));
      }));
    modal.append(el('div', { class: 'mb-1' }, ...rub.call.map(sec => secBlock(sec, 'call'))));
    modal.append(el('div', { class: 'mb-3' }, ...rub.accuracy.map(sec => secBlock(sec, 'accuracy'))));
    modal.append(el('textarea', {
      rows: 3, placeholder: 'Coaching notes — what was great, what to improve…',
      class: 'rounded-lg border px-3 py-2 text-sm w-full mb-3',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
      oninput: (e) => { meta.notes = e.target.value; },
    }, meta.notes || ''));
    modal.append(el('div', { class: 'flex items-center justify-between gap-3' },
      el('div', { class: 'text-[10px] text-muted-' }, 'Ungraded rows count as N/A — the call is scored only on what you grade.'),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', cursor: 'pointer' },
        onclick: () => {
          const cs = callAuditScore(grades, dept, 'call');
          const as2 = callAuditScore(grades, dept, 'accuracy');
          if (!cs.graded && !as2.graded) { alert('Grade at least one criterion first.'); return; }
          saveCallAuditRow({
            id: 'local-' + Math.random().toString(36).slice(2),
            profile_id: profile.id, period, dept,
            call_date: meta.call_date || null, call_ref: meta.call_ref || null,
            customer_ref: meta.customer_ref || null, call_type: meta.call_type || null,
            outcome: meta.outcome || null, notes: meta.notes || null,
            grades: { ...grades },
            call_score: cs.score == null ? null : Number(cs.score.toFixed(1)),
            accuracy_score: as2.score == null ? null : Number(as2.score.toFixed(1)),
            flagged: !!cs.flagged,
            created_by: state.profile?.id || null,
          });
          overlay.remove();
          if (onDone) onDone();
        },
      }, 'Save audit')));
  };
  render();
  document.body.append(overlay);
}

