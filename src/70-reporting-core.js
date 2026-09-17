// ┌─ src/70-reporting-core.js ─────────────────────────────────────────────────────
// │ Reporting data layer: subscription snapshot loading, recurring/cancel/source rules, retention population rules.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// Given the active-test, return the ACTIVE subs that data-hygiene says are
// probably stale and should be closed, each stamped with a _flagReason:
//   • retired service, still Active                → "Retired service"
//   • one-time service, Active AND already serviced → "One-time already serviced"
// A one-time sub that's Active but NOT yet serviced (completed = 0) is left
// alone — that's a legit sold-not-started subscription.
function reportingFlaggedActive(rows, isActive) {
  const lc = reportingServiceLifecycleMap();
  const out = [];
  for (const r of rows) {
    if (!isActive(r)) continue;
    const kind = lc.get(r.subscription);
    const completed = Number(r.subscription_completed_services) || 0;
    let reason = null;
    if (kind === 'retired') reason = 'Retired service — should be closed';
    else if (kind === 'onetime' && completed >= 1) reason = 'One-time already serviced (' + completed + ') — should be closed';
    if (reason) out.push({ ...r, _flagReason: reason });
  }
  return out;
}

// Cancellation reasons the admin has marked as NOT counting toward attrition
// (Configurations tab). A canceled sub whose reason is in this set is excluded
// from churn everywhere — Overview cancel count/rate AND the Geographic map.
// Null/blank reason normalizes to 'Unspecified' to match the donut grouping.
// Normalize a cancel reason for matching/consolidation — collapse whitespace,
// trim, lowercase. So "Moved", "moved " and "Moved" all reconcile to one.
// Normalize a cancel reason for matching: collapse whitespace, lowercase,
// and strip trailing punctuation — the CRM carries both "Unspecified." and
// "Unspecified", and "Sales Rep Error " with a trailing space. Without this,
// a Configurations choice can silently miss a variant spelling.
// FieldRoutes renamed several cancellation reasons over time; exports keep
// the label as it read when the cancel was logged, so the same reason ID
// shows up under two spellings. Canonicalize the legacy names everywhere.
const _CANCEL_REASON_ALIASES = {
  'inbound renewal': 'renewal - inbound',
  'outbound renewal': 'renewal - outbound',
  'loyalty renewal': 'renewal - loyalty',
  'service pro upsell renewal': 'renewal - service pro upsell',
};
const _CANCEL_REASON_DISPLAY = {
  'inbound renewal': 'Renewal - Inbound',
  'outbound renewal': 'Renewal - Outbound',
  'loyalty renewal': 'Renewal - Loyalty',
  'service pro upsell renewal': 'Renewal - Service Pro Upsell',
};
function _normCancelReason(s) { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').toLowerCase(); return _CANCEL_REASON_ALIASES[t] || t; }
function reportingExcludedCancelReasons() { return _retenMemoGet('excl', _reportingExcludedCancelReasonsBuild); }
function _reportingExcludedCancelReasonsBuild() {
  if (!_retenWhatIf('exclReasons', true)) return new Set();
  const cfg = state.reportingCancelConfig || [];
  const set = new Set(cfg.filter(c => c.counts_attrition === false).map(c => _normCancelReason(c.reason)));
  // Retention-tab slicers (session only): per-reason include / exclude on
  // top of the saved config — the Settings panel stays the source of truth
  // for the rest of the app.
  const w = state._retenWhatIf;
  if (w && w.reasons && state.reportingSubTab === 'waterfall') for (const k in w.reasons) { if (w.reasons[k]) set.add(k); else set.delete(k); }
  return set;
}
function reportingCancelReasonOf(r) {
  // Tidy for display/grouping too — otherwise "Unspecified." and
  // "Unspecified" chart as two different reasons.
  const raw = String(r.subscription_cancellation_reason || '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (!raw) return 'Unspecified';
  return _CANCEL_REASON_DISPLAY[raw.toLowerCase()] || raw;
}

// Lead sources the admin marked as NOT counting (Configurations tab). Subs
// from an excluded source (e.g. Miscellaneous) drop out of ALL snapshot-based
// reporting — they're filtered at the shared `visible` set so Overview,
// Geographic, Rep Performance and Waterfall all inherit it, and Inside Sales
// skips them too. Null/blank source normalizes to 'Unspecified'.
function reportingExcludedSources() {
  const cfg = state.reportingSourceConfig || [];
  return new Set(cfg.filter(c => c.included === false).map(c => c.source));
}
function reportingSourceOf(r) {
  return (r.subscription_source || '').trim() || 'Unspecified';
}
// Revenue classification of a lead source — the single source of truth for how
// the app counts revenue from that source: 'new', 'renewal', or 'upsell'.
// Admin override lives in reporting_source_config.revenue_class (Configurations →
// Lead Sources); when unset it falls back to the source NAME (the historical
// rule): "…Renewal…" → renewal, "…Upsell…" → upsell, everything else → new.
let _srcClassMap = null, _srcClassRef = null;
function reportingSourceClass(sourceName) {
  const name = String(sourceName || '').trim();
  // Map rebuilt only when the config array identity changes — the old
  // Array.find ran per SALE inside 100k-row loops (~8M comparisons/render).
  const cfgArr = state.reportingSourceConfig || [];
  if (_srcClassRef !== cfgArr) {
    _srcClassRef = cfgArr;
    _srcClassMap = new Map();
    for (const c of cfgArr) if (c && c.source && c.revenue_class) _srcClassMap.set(c.source, c.revenue_class);
  }
  const hit = _srcClassMap.get(name);
  if (hit) return hit;
  if (/renewal/i.test(name)) return 'renewal';
  if (/upsell/i.test(name))  return 'upsell';
  return 'new';
}
// Marketing / Inside Sales counts ONLY Office Staff accounts (the call center).
// Door-to-door (Sales Rep) and technician upsells are excluded — rep type comes
// from the Customer Report's "Sold By Type".
function reportingIsOfficeStaff(r) {
  return String((r && r.sold_by_type) || '').trim() === 'Office Staff';
}

// Filters + flag helpers used by every chart. Centralized so the rules
// (hide hidden services, exclude 3-day RORs from churn, etc.) live in
// one place and can't drift between charts.
// A subscription that never became a customer: no completed initial service
// (status not Completed and no serviced date) AND it's either sitting Frozen
// in the CRM (the "removed" cards — e.g. custs 162628 / 178498) or was
// cancelled as Sold-Not-Started / No Initial. Active-but-unscheduled and
// Pending initials are NOT touched — those are still future business.
const _NO_INITIAL_REASON_RE = /sold,?\s*not\s*started|no\s*initial/i;
function reportingNeverStarted(r) {
  if (!r) return false;
  const initDone = String(r.initial_status || '').toLowerCase() === 'completed' || !!r.initial_serviced_date;
  if (initDone) return false;
  const frozen = String(r.subscription_status || '').toLowerCase() === 'frozen';
  const snsReason = _NO_INITIAL_REASON_RE.test(String(reportingCancelReasonOf(r) || ''));
  return frozen || snsReason;
}
function reportingFilters() {
  const cfgByName = new Map((state.reportingServiceConfig || []).map(c => [c.service_name, c]));
  const isHidden    = (r) => !!cfgByName.get(r.subscription)?.is_hidden;
  // Recurring is decided per SERVICE TYPE (admin override, else ARV data
  // guess) — see reportingServiceRecurringMap. This means even a $0-ARV
  // row (e.g. a frozen month) of a recurring service still counts recurring.
  const recurringByName = reportingServiceRecurringMap();
  const isRecurring = (r) => reportingRecurringMode() === 'arv'
    ? (Number(r.annual_recurring_value) || 0) > 0
    : !!recurringByName.get(r.subscription);
  // Active = currently in service. Both the status field and the cancel
  // date have to agree — a row with status=Active but a cancel date is
  // a frozen/lapsed sub, not active.
  const isActive = (r) => {
    const s = (r.subscription_status || '').toLowerCase();
    return s === 'active' && !r.subscription_date_canceled;
  };
  // Cancellation: any canceled recurring sub, UNLESS its reason is config-
  // excluded from attrition (Configurations tab). Non-recurring (one-time)
  // cancels are excluded too — they're not real attrition.
  const excludedReasons = reportingExcludedCancelReasons();
  const isRealCancel = (r) => {
    if (!r.subscription_date_canceled) return false;
    if (!isRecurring(r)) return false;
    if (reportingExcludeRorChurn() && _reporting3dayRor(r)) return false;
    if (excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r)))) return false;
    return true;
  };
  const all = reportingApplyBranchRules(state.reportingSubscriptions || []);
  // `visible` is the master set every snapshot-based tab reads from. It drops
  // Hidden service types AND subs from excluded lead sources (Configurations),
  // so a source like Miscellaneous falls out of all reporting at once — and
  // (per Isaac) subscriptions that NEVER STARTED: no initial service ever
  // completed AND either frozen/removed in the CRM or cancelled as
  // Sold-Not-Started / No Initial. Those are dead cards, not customers.
  const excludedSources = reportingExcludedSources();
  const visible = all.filter(r => !isHidden(r) && !excludedSources.has(reportingSourceOf(r)) && !reportingNeverStarted(r));
  const recurring = visible.filter(isRecurring);
  return { all, visible, recurring, cfgByName, isHidden, isRecurring, isActive, isRealCancel };
}

// Group rows by key, summing a value. Returns [{ label, value }] sorted desc.
function reportingGroupSum(rows, keyFn, valueFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    map.set(k, (map.get(k) || 0) + (Number(valueFn(r)) || 0));
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
function reportingGroupCount(rows, keyFn) {
  return reportingGroupSum(rows, keyFn, () => 1);
}

// Like reportingGroupSum but returns the mean per group instead of the
// total. Used by ACV by Service — slice "size" is the avg contract value
// per sub for that service, not the total. Empty groups are dropped.
function reportingGroupAvg(rows, keyFn, valueFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null || k === '') continue;
    const v = Number(valueFn(r)) || 0;
    if (!groups.has(k)) groups.set(k, { sum: 0, count: 0 });
    const g = groups.get(k);
    g.sum += v;
    g.count += 1;
  }
  return [...groups.entries()]
    .map(([label, { sum, count }]) => ({ label, value: count > 0 ? sum / count : 0 }))
    .sort((a, b) => b.value - a.value);
}

// Bucket a days_past_due value into one of five named tiers. Returns
// 'Current' for null / 0 / negative inputs and rolls everything over
// 90 days into a single tail bucket.
function reportingAgingBucket(days) {
  const d = Number(days) || 0;
  if (d <= 30) return 'Current';     // FieldRoutes: ≤30 days is "current"
  if (d <= 60) return '31–60 days';
  if (d <= 90) return '61–90 days';
  return '90+ days';
}
const REPORTING_AGING_ORDER = ['Current', '31–60 days', '61–90 days', '90+ days'];

// Customer tenure bucket from initial_service date — years between then
// and today. Returns 'Unknown' for missing / unparseable dates so the
// chart can still surface them as a separate slice instead of dropping.
function reportingTenureBucket(initialService, today = new Date()) {
  if (!initialService) return 'Unknown';
  const start = new Date(initialService + 'T00:00');
  if (Number.isNaN(start.getTime())) return 'Unknown';
  const years = (today - start) / (365.25 * 86400000);
  if (years < 1) return '<1 year';
  if (years < 2) return '1–2 years';
  if (years < 3) return '2–3 years';
  if (years < 4) return '3–4 years';
  return '4+ years';
}
const REPORTING_TENURE_ORDER = ['<1 year', '1–2 years', '2–3 years', '3–4 years', '4+ years', 'Unknown'];

// Doughnut chart card — title, chart, total, top-N legend with a rolled-up
// "Other" row for the long tail. `key` must be stable across renders so the
// Chart.js instance can be cleanly destroyed before re-creation. When
// `colorMap` is provided (compare mode), labels look up colors there so
// the same service is the same color across both offices' pies.
function reportingPieCard({ key, title, slices, formatValue, totalLabel, subline, top = 6, officeLabel, colorMap, overrideTotal, hidePercent, preserveOrder, onSliceClick, onOtherClick, footerAction }) {
  const id = 'rpt-pie-' + key;
  const formatter = formatValue || ((n) => Number(n).toLocaleString());
  // `preserveOrder` keeps the caller's order (used for aging buckets so
  // Current → 90+ stays in time order rather than reshuffling by $).
  const filtered = slices.filter(s => s.value > 0);
  const sorted = preserveOrder ? filtered : [...filtered].sort((a, b) => b.value - a.value);
  // `overrideTotal` lets the caller display a different bottom-line
  // total than the slice sum (used for ACV — slices are per-service
  // averages, total is the weighted overall average across all subs).
  const sliceSum = sorted.reduce((s, x) => s + x.value, 0);
  const overall = overrideTotal != null ? overrideTotal : sliceSum;
  const colorFor = (label, idx) => colorMap?.[label] || REPORTING_PALETTE[idx % REPORTING_PALETTE.length];

  const cvsWrap = el('div', { style: { position: 'relative', height: '220px', width: '100%' } });
  const cvs = el('canvas', { id });
  cvsWrap.append(cvs);

  // Defer Chart.js construction until the canvas is in the DOM. 50ms
  // matches the indicator charts' pattern; long enough for layout to
  // settle, short enough that the UI doesn't feel laggy.
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const cvsEl = document.getElementById(id);
    if (!cvsEl) return;
    if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
    const isDark = state.theme === 'dark';
    _chartInstances[id] = new Chart(cvsEl.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: sorted.map(s => s.label),
        datasets: [{
          data: sorted.map(s => s.value),
          backgroundColor: sorted.map((s, i) => colorFor(s.label, i)),
          borderWidth: 1,
          borderColor: isDark ? '#323230' : '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#323230', bodyFont: { size: 11 }, padding: 8, cornerRadius: 6,
            callbacks: {
              // For non-additive metrics (like ACV averages) the percent
              // share is misleading, so hidePercent suppresses it. For
              // additive metrics we use the SLICE SUM as the denominator
              // so percentages add up to 100 regardless of overrideTotal.
              label: (ctx) => hidePercent
                ? ctx.label + ': ' + formatter(ctx.parsed)
                : ctx.label + ': ' + formatter(ctx.parsed) +
                    ' (' + ((ctx.parsed / Math.max(sliceSum, 1)) * 100).toFixed(1) + '%)',
            },
          },
        },
        // Slice click → drill down. The cursor flips to pointer on hover
        // when the chart is clickable so the affordance is discoverable.
        onClick: onSliceClick ? (evt, elements) => {
          if (!elements.length) return;
          const slice = sorted[elements[0].index];
          if (slice) onSliceClick(slice.label, slice.value);
        } : undefined,
        onHover: onSliceClick ? (e, elements) => {
          if (e?.native?.target) e.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        } : undefined,
      },
    });
  }, 50);

  const topSlices  = sorted.slice(0, top);
  const otherCount = Math.max(0, sorted.length - top);
  const otherTotal = sorted.slice(top).reduce((s, x) => s + x.value, 0);

  // Uniform cards (per Isaac): fixed height, one-line title + subline,
  // fixed donut, legend capped at `top` rows + Other, footer slot always
  // reserved — so every chart on the Overview lines up edge to edge.
  return el('div', { class: 'card p-4 flex flex-col gap-3', style: { height: officeLabel ? '556px' : '540px' } },
    el('div', { class: 'shrink-0' },
      officeLabel && el('div', {
        class: 'text-[9px] uppercase tracking-widest font-bold mb-1 truncate',
        style: { color: 'var(--accent)' },
      }, officeLabel),
      el('div', { class: 'text-sm font-bold truncate', title }, title),
      el('div', { class: 'text-[10px] text-muted- mt-0.5 truncate', title: subline || '' }, subline || '\u00a0'),
    ),
    sorted.length === 0
      ? el('div', { class: 'p-8 text-center text-xs text-muted- flex-1 flex items-center justify-center' }, 'No data')
      : el('div', { class: 'flex flex-col gap-3 flex-1', style: { minHeight: '0' } },
          cvsWrap,
          el('div', { class: 'flex items-baseline justify-between gap-2 pt-1 border-t', style: { borderColor: 'var(--border)' } },
            el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold pt-2', style: { color: 'var(--text-subtle)' } }, totalLabel || 'Total'),
            el('div', { class: 'text-lg font-bold tabular-nums pt-2' }, formatter(overall)),
          ),
          el('div', { class: 'flex flex-col gap-1.5 text-xs flex-1 overflow-hidden', style: { minHeight: '0' } },
            ...topSlices.map((s, i) => {
              // Legend rows mirror the donut wedges: clicking either opens the
              // same drill table. Rows are the bigger, easier-to-hit target —
              // especially for tiny wedges (e.g. a 1-mo agreement slice).
              const clickable = !!onSliceClick;
              const rowEl = el('div', {
                class: 'flex items-center gap-2 rounded px-1 -mx-1 py-0.5' + (clickable ? ' cursor-pointer transition' : ''),
                title: clickable ? 'Click to see the ' + formatter(s.value) + ' under "' + s.label + '"' : undefined,
                onclick: clickable ? () => onSliceClick(s.label, s.value) : undefined,
                onmouseenter: clickable ? (e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; } : undefined,
                onmouseleave: clickable ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined,
              },
                el('div', { style: { width: '8px', height: '8px', borderRadius: '0', background: colorFor(s.label, i), flexShrink: '0' } }),
                el('div', { class: 'flex-1 truncate', style: { color: 'var(--text)' } }, s.label),
                el('div', { class: 'tabular-nums', style: { color: 'var(--text-muted)' } }, formatter(s.value)),
              );
              return rowEl;
            }),
            otherCount > 0 && (() => {
              const otherSlices = sorted.slice(top);   // [{label, value}] — the breakdown modal needs the values
              const otherLabels = otherSlices.map(s => s.label);
              const clickable = !!onOtherClick;
              return el('div', {
                class: 'flex items-center gap-2 rounded px-1 -mx-1 py-0.5' + (clickable ? ' cursor-pointer transition' : ''),
                title: clickable ? 'Click to see the ' + otherCount + ' smaller categories combined' : undefined,
                onclick: clickable ? () => onOtherClick(otherLabels, otherTotal, otherSlices, overall) : undefined,
                onmouseenter: clickable ? (e) => { e.currentTarget.style.background = 'var(--bg-subtle)'; } : undefined,
                onmouseleave: clickable ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined,
              },
                el('div', { style: { width: '8px', height: '8px', borderRadius: '0', background: 'var(--text-subtle)', flexShrink: '0' } }),
                el('div', { class: 'flex-1', style: { color: 'var(--text-muted)' } }, 'Other (' + otherCount + ')'),
                el('div', { class: 'tabular-nums', style: { color: 'var(--text-muted)' } }, formatter(otherTotal)),
              );
            })(),
          ),
          footerAction ? el('div', {
            class: 'text-[11px] font-semibold cursor-pointer pt-1 mt-auto border-t hover:brightness-110 transition truncate shrink-0',
            style: { color: 'var(--accent)', borderColor: 'var(--border)', minHeight: '24px' },
            title: footerAction.label,
            onclick: footerAction.onClick,
          }, footerAction.label) : el('div', { class: 'mt-auto shrink-0', style: { minHeight: '24px' } }),
        ),
  );
}

// Drill-down modal — opens when a chart slice is clicked. Shows every
// row that contributed to that slice, sorted by contract value desc by
// default. Columns are chosen to be useful across every chart type
// (customer + office for identity, ARV + contract $ for revenue, past
// due + cancel info for risk). The modal closes on background click,
// the × button, or Escape.
// ── ARR COMBINER (per Isaac) — the "Recurring Annual Value by Service"
// card's drill. Not a customer table: a picker where you check off service
// types (search "sentricon", Select shown) and read their COMBINED active
// ARR, sub count, and share of the book, live.
function openReportingArrCombineModal(data, chartTitle) {
  const slices = (data.slices && data.slices.rarr ? data.slices.rarr : []).filter(s => s.value > 0)
    .slice().sort((a, b) => b.value - a.value);
  const drill = data.drill && data.drill.rarr;
  const subCount = new Map();
  if (drill) drill.source.forEach(r => { const k = drill.key(r); subCount.set(k, (subCount.get(k) || 0) + 1); });
  const totalArr = slices.reduce((a, s) => a + s.value, 0);
  const sel = new Set();
  let q = '';
  let sortKey = 'arr';   // 'arr' (default, biggest first) or 'name' (A→Z)
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const summaryEl = el('div', {});
  const listEl = el('div', { class: 'px-4 pb-2 overflow-y-auto flex-1' });
  const visible = () => {
    const vis = slices.filter(s => !q || s.label.toLowerCase().includes(q));
    return sortKey === 'name'
      ? vis.sort((a, b) => a.label.localeCompare(b.label))
      : vis.sort((a, b) => b.value - a.value);
  };
  // Sortable header row — click Service for A→Z, ARR for biggest-first.
  const headerEl = el('div', {});
  const renderHeader = () => {
    headerEl.innerHTML = '';
    const th = (key, txt, cls) => el('button', {
      class: 'text-[9px] uppercase tracking-widest font-bold cursor-pointer select-none transition hover:brightness-75 ' + (cls || ''),
      style: { color: sortKey === key ? 'var(--accent)' : 'var(--text-subtle)', background: 'none', border: 'none', padding: '0' },
      title: key === 'name' ? 'Sort alphabetically' : 'Sort by ARR (biggest first)',
      onclick: () => { sortKey = key; renderHeader(); renderList(); },
    }, txt + (sortKey === key ? (key === 'name' ? ' ▲' : ' ▼') : ''));
    headerEl.append(el('div', { class: 'px-4 pb-1.5 flex items-center justify-between gap-3' },
      el('div', { class: 'pl-6' }, th('name', 'Service')),
      th('arr', 'Subs · ARR · Share', 'text-right')));
  };
  const renderSummary = () => {
    summaryEl.innerHTML = '';
    const picked = slices.filter(s => sel.has(s.label));
    const arr = picked.reduce((a, s) => a + s.value, 0);
    const subs = picked.reduce((a, s) => a + (subCount.get(s.label) || 0), 0);
    summaryEl.append(el('div', { class: 'mx-4 mb-2 rounded-xl p-3', style: { background: 'var(--card-2)' } },
      el('div', { class: 'flex items-baseline justify-between gap-3 flex-wrap' },
        el('div', {},
          el('div', { class: 'text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Combined ARR — ' + picked.length + ' service type' + (picked.length === 1 ? '' : 's')),
          el('div', { class: 'text-xl font-bold tabular-nums' }, picked.length ? fmt.usd0(arr) : '—')),
        picked.length > 0 && el('div', { class: 'text-right text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } },
          el('div', {}, fmt.int(subs) + ' active subs'),
          el('div', {}, totalArr > 0 ? (arr / totalArr * 100).toFixed(1) + '% of active ARR' : '')))));
  };
  const renderList = () => {
    listEl.innerHTML = '';
    const vis = visible();
    if (!vis.length) { listEl.append(el('div', { class: 'p-6 text-center text-sm', style: { color: 'var(--text-muted)' } }, 'No service types match.')); return; }
    const maxV = vis.reduce((a, s) => Math.max(a, s.value), 1);
    vis.forEach(s => {
      const on = sel.has(s.label);
      listEl.append(el('div', {
        class: 'py-2 px-2 -mx-2 rounded-lg cursor-pointer transition hover:brightness-95 border-t border-',
        onclick: () => { on ? sel.delete(s.label) : sel.add(s.label); renderSummary(); renderList(); },
      },
        el('div', { class: 'flex items-center gap-2.5 text-xs' },
          el('span', { style: { fontSize: '14px', color: on ? 'var(--accent)' : 'var(--text-subtle)' } }, on ? '☑' : '☐'),
          el('span', { class: 'font-semibold truncate flex-1' }, s.label),
          el('span', { class: 'tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } },
            fmt.int(subCount.get(s.label) || 0) + ' subs · ' + fmt.usd0(s.value)
            + (totalArr > 0 ? ' · ' + (s.value / totalArr * 100).toFixed(1) + '%' : ''))),
        el('div', { class: 'mt-1 ml-6 rounded-full overflow-hidden', style: { height: '3px', background: 'var(--card-2)' } },
          el('div', { style: { width: Math.max(1.5, s.value / Math.max(1, maxV) * 100) + '%', height: '100%', background: on ? 'var(--accent)' : 'var(--text-subtle)', opacity: on ? '.9' : '.35' } }))));
    });
  };
  const searchBox = el('input', {
    class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    placeholder: 'Search service types — e.g. "sentricon"…',
    oninput: (e) => { q = String(e.target.value || '').toLowerCase().trim(); renderList(); },
  });
  const quickBtn = (labelTxt, fn) => el('button', {
    class: 'rounded-lg border px-2.5 py-1.5 text-[10px] font-bold cursor-pointer transition hover:brightness-95 whitespace-nowrap',
    style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
    onclick: fn,
  }, labelTxt);
  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, (chartTitle || 'Recurring Annual Value') + ' — combine services'),
        el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
          'Check off service types to see their combined active ARR. Search, then "Select shown" to grab a whole family at once.')),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×')),
    summaryEl,
    el('div', { class: 'px-4 pb-2 flex items-center gap-2' },
      searchBox,
      quickBtn('Select shown', () => { visible().forEach(s => sel.add(s.label)); renderSummary(); renderList(); }),
      quickBtn('Clear', () => { sel.clear(); renderSummary(); renderList(); })),
    headerEl,
    listEl);
  renderSummary();
  renderHeader();
  renderList();
  overlay.append(card);
  document.body.append(overlay);
}

// ── AREA REPORT CARD (per Isaac) — clicking a ZIP/county leads with "how
// does this area COMPARE": each metric's value, rank among peers, and a
// percentile bar, plus a best/worst read at a glance. The raw customer
// table is behind the button at the bottom.
function openReportingAreaStatsModal({ area, peers, kind }) {
  const label = kind === 'County' ? ((area.county || 'Unknown') + ' County') : ('ZIP ' + area.zip);
  const title = label + (area.state ? ' · ' + area.state : '');
  const peerNoun = kind === 'County' ? 'counties' : 'ZIPs';
  const all = (peers && peers.length ? peers : [area]);
  const METRICS = [
    { label: 'Customers',        val: (a) => a.customers,   fmt: (v) => fmt.int(v),   better: 'high' },
    { label: 'Subscriptions',    val: (a) => a.subs,        fmt: (v) => fmt.int(v),   better: 'high' },
    { label: 'Total ARV',        val: (a) => a.arv,         fmt: (v) => fmt.usd0(v),  better: 'high' },
    { label: 'Contract revenue', val: (a) => a.contract,    fmt: (v) => fmt.usd0(v),  better: 'high' },
    { label: 'ACV',              val: (a) => a.avgContract, fmt: (v) => fmt.usd0(v),  better: 'high' },
    { label: 'Retention',        val: (a) => a.attritionEligible ? (1 - a.cancelRate) : null, fmt: (v) => (v * 100).toFixed(1) + '%', better: 'high' },
    { label: 'Attrition',        val: (a) => a.attritionEligible ? a.cancelRate : null,       fmt: (v) => (v * 100).toFixed(1) + '%', better: 'low' },
  ];
  const rowsEls = [];
  const pcts = [];
  METRICS.forEach(m => {
    const mine = m.val(area);
    const eligible = all.filter(a => m.val(a) != null);
    if (mine == null || eligible.length < 2) {
      rowsEls.push(el('div', { class: 'py-2 border-t border- flex items-center justify-between gap-3 text-xs' },
        el('span', { class: 'font-semibold' }, m.label),
        el('span', { style: { color: 'var(--text-subtle)' } }, mine == null ? '< 10 subs — not rated' : m.fmt(mine))));
      return;
    }
    const sorted = eligible.map(a => m.val(a)).sort((a, b) => m.better === 'low' ? a - b : b - a);
    const rank = sorted.findIndex(v => v === mine) + 1;
    const pct = eligible.length > 1 ? (eligible.length - rank) / (eligible.length - 1) : 1;
    pcts.push(pct);
    const median = sorted[Math.floor(sorted.length / 2)];
    const tone = pct >= 0.67 ? '#DF643A' : pct <= 0.33 ? '#DC2626' : '#A9441F';
    rowsEls.push(el('div', { class: 'py-2 border-t border-' },
      el('div', { class: 'flex items-center justify-between gap-3 text-xs' },
        el('span', { class: 'font-semibold' }, m.label),
        el('span', { class: 'tabular-nums' },
          el('b', {}, m.fmt(mine)),
          el('span', { style: { color: 'var(--text-muted)' } }, '  ·  median ' + m.fmt(median)))),
      el('div', { class: 'flex items-center gap-2 mt-1' },
        el('div', { class: 'flex-1 rounded-full overflow-hidden', style: { height: '4px', background: 'var(--card-2)' } },
          el('div', { style: { width: Math.max(2, pct * 100) + '%', height: '100%', background: tone } })),
        el('span', { class: 'text-[10px] font-bold tabular-nums whitespace-nowrap', style: { color: tone } },
          '#' + rank + ' of ' + eligible.length))));
  });
  const avgPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
  const standing = avgPct == null ? null
    : avgPct >= 0.8 ? ['One of your best ' + peerNoun, '#DF643A']
    : avgPct >= 0.55 ? ['Above the pack', '#DF643A']
    : avgPct >= 0.45 ? ['Middle of the pack', '#A9441F']
    : avgPct >= 0.2 ? ['Below the pack', '#A9441F']
    : ['One of your weakest ' + peerNoun, '#DC2626'];
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const card = el('div', { class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, title),
        el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
          'vs ' + all.length.toLocaleString() + ' ' + peerNoun + ' in this view · bars = percentile (right = best)'),
        standing && el('div', { class: 'text-[11px] font-bold mt-1', style: { color: standing[1] } },
          (avgPct >= 0.5 ? '▲ ' : '▼ ') + standing[0] + ' — better than ' + Math.round(avgPct * 100) + '% overall')),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×')),
    el('div', { class: 'px-4 pb-2 overflow-y-auto' }, ...rowsEls),
    el('div', { class: 'p-4 pt-2' },
      el('button', {
        class: 'w-full rounded-xl px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => {
          overlay.remove();
          openReportingDrillModal({ chartTitle: title, sliceLabel: label, rows: area.rows || [], formatValue: fmt.usd0 });
        },
      }, 'View all ' + (area.rows || []).length.toLocaleString() + ' customers →')));
  overlay.append(card);
  document.body.append(overlay);
}

function openReportingSliceStatsModal({ chartTitle, sliceLabel, rows, siblings, formatValue }) {
  const fmtV = formatValue || ((v) => fmt.int(v));
  const n = rows.length;
  const excludedReasons = reportingExcludedCancelReasons();
  const isCxl = (r) => !!r.subscription_date_canceled;
  const countedCxl = rows.filter(r => isCxl(r) && !excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r))));
  const activeRows = rows.filter(r => (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled);
  const customers = new Set(rows.map(r => r.customer_id).filter(Boolean)).size;
  const arrActive = activeRows.reduce((a, r) => a + (Number(r.annual_recurring_value) || 0), 0);
  const contract = rows.reduce((a, r) => a + (Number(r.subscription_contract_value) || 0), 0);
  const lifeMo = (r) => {
    const a = new Date(String(r.initial_service) + 'T00:00');
    const b = r.subscription_date_canceled ? new Date(String(r.subscription_date_canceled) + 'T00:00') : new Date();
    return (isNaN(a) || isNaN(b)) ? null : Math.max(0, (b - a) / 2629800000);
  };
  const lives = rows.map(lifeMo).filter(v => v != null).sort((a, b) => a - b);
  const medianLife = lives.length ? lives[Math.floor(lives.length / 2)] : null;
  // Mostly-cancelled slice (e.g. a Cancellation Reasons wedge) → loss framing.
  const cxlSlice = n > 0 && rows.filter(isCxl).length / n > 0.95;
  // Rank among the chart's own slices, on the chart's own metric.
  const sibs = (siblings || []).filter(s => s.value > 0).slice().sort((a, b) => b.value - a.value);
  const myIdx = sibs.findIndex(s => s.label === sliceLabel);
  const sibTotal = sibs.reduce((a, s) => a + s.value, 0);
  const myVal = myIdx >= 0 ? sibs[myIdx].value : null;
  const groupTop = (keyFn) => {
    const m = new Map();
    rows.forEach(r => { const k = keyFn(r) || '—'; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, c]) => ({ k, c })).sort((a, b) => b.c - a.c);
  };
  const byOffice = groupTop(r => _titleCaseWords(r.office_name || '—'));
  const bySvc = groupTop(r => r.subscription);
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const stat = (label, val, sub) => el('div', { class: 'flex-1 px-3 py-2 rounded-xl', style: { background: 'var(--card-2)', minWidth: '105px' } },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-base font-black tabular-nums' }, val),
    sub && el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, sub));
  const miniBars = (title, groups) => {
    if (groups.length < 2) return null;
    const top = groups.slice(0, 5);
    const maxC = top[0].c;
    return el('div', { class: 'flex-1', style: { minWidth: '210px' } },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, title),
      ...top.map(g => el('div', { class: 'py-1 border-t border-' },
        el('div', { class: 'flex items-center justify-between text-[11px]' },
          el('span', { class: 'truncate' }, g.k),
          el('span', { class: 'tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } }, fmt.int(g.c) + ' · ' + Math.round(g.c / n * 100) + '%')),
        el('div', { class: 'mt-0.5 rounded-full overflow-hidden', style: { height: '3px', background: 'var(--card-2)' } },
          el('div', { style: { width: Math.max(2, g.c / maxC * 100) + '%', height: '100%', background: 'var(--accent)', opacity: '.7' } })))),
      groups.length > 5 && el('div', { class: 'text-[10px] mt-1', style: { color: 'var(--text-subtle)' } }, '+ ' + (groups.length - 5) + ' more'));
  };
  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, sliceLabel),
        el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
          chartTitle + (myIdx >= 0 ? ' · #' + (myIdx + 1) + ' of ' + sibs.length : '')
          + (myVal != null && sibTotal > 0 ? ' · ' + (myVal / sibTotal * 100).toFixed(1) + '% of the chart (' + fmtV(myVal) + ')' : ''))),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×')),
    el('div', { class: 'px-4 pb-2 overflow-y-auto' },
      el('div', { class: 'flex gap-2 flex-wrap mb-3' },
        stat('Subs', fmt.int(n), fmt.int(customers) + ' customers'),
        cxlSlice
          ? stat('ARR lost', fmt.usd0(rows.reduce((a, r) => a + (Number(r.annual_recurring_value) || 0), 0)))
          : stat('Active ARR', fmt.usd0(arrActive), fmt.int(activeRows.length) + ' active subs'),
        stat('ACV', n ? fmt.usd0(contract / n) : '—', fmt.usd0(contract) + ' total contract'),
        cxlSlice
          ? stat('Median lifetime', medianLife != null ? medianLife.toFixed(1) + ' mo' : '—', lives.length ? Math.round(lives.filter(v => v < 12).length / lives.length * 100) + '% left within 12 mo' : '')
          : stat('Attrition', n ? (countedCxl.length / n * 100).toFixed(1) + '%' : '—', fmt.int(countedCxl.length) + ' counted cancels · lifetime' + (medianLife != null ? ' · median ' + medianLife.toFixed(1) + ' mo' : ''))),
      el('div', { class: 'flex gap-5 flex-wrap' },
        miniBars('By office', byOffice),
        miniBars('By service', bySvc))),
    el('div', { class: 'p-4 pt-2' },
      el('button', {
        class: 'w-full rounded-xl px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => {
          overlay.remove();
          openReportingDrillModal({ chartTitle, sliceLabel, rows, formatValue });
        },
      }, 'View all ' + fmt.int(n) + ' customers →')));
  overlay.append(card);
  document.body.append(overlay);
}

function openReportingDrillModal({ chartTitle, sliceLabel, rows, formatValue }) {
  const overlay = el('div', { class: 'modal-overlay' });
  const closeKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', closeKey); } };
  document.addEventListener('keydown', closeKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', closeKey); }
  });

  const hasFlags = rows.some(r => r._flagReason);
  const hasLoc = rows.some(r => r.state || r.zip_code);   // location columns (fixing CRM addresses)
  const totalContract = rows.reduce((s, r) => s + (Number(r.subscription_contract_value) || 0), 0);
  const totalArv      = rows.reduce((s, r) => s + (Number(r.annual_recurring_value) || 0), 0);
  const formatter = formatValue || fmt.usd0;

  // Customer "Last, First" with a graceful fall-back to ID if names are missing.
  const customerName = (r) => {
    const last = (r.last_name || '').trim();
    const first = (r.first_name || '').trim();
    if (last && first) return last + ', ' + first;
    return last || first || r.customer_id || '—';
  };
  const fmtDate = (d) => d ? new Date(d + 'T00:00').toLocaleDateString() : '—';

  // Column model — drives both the (sortable) header and the body cells, so
  // they can never drift out of order. `get` returns a comparable value used
  // for sorting; `type` decides the default sort direction on first click.
  const cols = [
    { key: 'customer',     label: 'Customer',        align: 'left',  type: 'str', get: r => customerName(r).toLowerCase() },
    { key: 'office',       label: 'Office',          align: 'left',  type: 'str', get: r => (r.office_name || '').toLowerCase() },
    { key: 'rep',          label: 'Sold by',         align: 'left',  type: 'str', get: r => String(r.sold_by || '').toLowerCase() },
    ...(hasLoc ? [
      { key: 'state',      label: 'State',           align: 'left',  type: 'str', get: r => (r.state || '').toUpperCase() },
      { key: 'zip',        label: 'ZIP',             align: 'left',  type: 'str', get: r => String(r.zip_code || '') },
      { key: 'county',     label: 'County',          align: 'left',  type: 'str', get: r => (r.county || '').toLowerCase() },
    ] : []),
    { key: 'subscription', label: 'Subscription',    align: 'left',  type: 'str', get: r => (r.subscription || '').toLowerCase() },
    { key: 'status',       label: 'Status',          align: 'left',  type: 'str', get: r => (r.subscription_status || '').toLowerCase() },
    ...(hasFlags ? [{ key: 'svcs', label: 'Svcs', align: 'right', type: 'num', get: r => Number(r.subscription_completed_services) || 0 }] : []),
    ...(hasFlags ? [{ key: 'flag', label: 'Flag', align: 'left',  type: 'str', get: r => (r._flagReason || '').toLowerCase() }] : []),
    { key: 'arv',          label: 'ARV',             align: 'right', type: 'num', get: r => Number(r.annual_recurring_value) || 0 },
    { key: 'contract',     label: 'Contract $',      align: 'right', type: 'num', get: r => Number(r.subscription_contract_value) || 0 },
    { key: 'initial',      label: 'Initial Service', align: 'left',  type: 'str', get: r => r.initial_service || '' },
    { key: 'pastdue',      label: 'Past Due',        align: 'right', type: 'num', get: r => Number(r.days_past_due) || 0 },
    { key: 'canceled',     label: 'Canceled',        align: 'left',  type: 'str', get: r => r.subscription_date_canceled || '' },
  ];

  let sortKey = 'contract';   // default: largest contract value first
  let sortDir = 'desc';
  // Render is WINDOWED: a big slice (e.g. the whole snapshot behind the
  // Subscriptions card) is tens of thousands of rows × 11 cells — building
  // that many DOM nodes at once freezes then crashes the tab. We render a page
  // at a time and cache the sort so "Show more" doesn't re-sort every click.
  const RENDER_PAGE = 200;
  let renderLimit = RENDER_PAGE;
  let sortedCache = null;

  const computeSorted = () => {
    const col = cols.find(c => c.key === sortKey) || cols[0];
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  };

  const rowFor = (r) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    el('td', { class: 'px-3 py-2' },
      el('div', { class: 'font-medium' }, customerName(r)),
      r.customer_id && el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '#' + r.customer_id),
    ),
    el('td', { class: 'px-3 py-2' }, r.office_name || '—'),
    el('td', { class: 'px-3 py-2' }, r.sold_by ? el('div', {}, el('div', {}, r.sold_by), r.sold_by_type ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, r.sold_by_type) : null) : '—'),
    hasLoc && el('td', { class: 'px-3 py-2 font-semibold' }, r.state || '—'),
    hasLoc && el('td', { class: 'px-3 py-2 tabular-nums' }, r.zip_code || '—'),
    hasLoc && el('td', { class: 'px-3 py-2' }, r.county || '—'),
    el('td', { class: 'px-3 py-2' }, r.subscription || '—'),
    el('td', { class: 'px-3 py-2' }, r.subscription_status || '—'),
    hasFlags && el('td', { class: 'px-3 py-2 text-right tabular-nums' }, String(Number(r.subscription_completed_services) || 0)),
    hasFlags && el('td', { class: 'px-3 py-2' },
      r._flagReason
        ? el('span', { class: 'text-[11px] font-semibold', style: { color: '#DC2626' } }, r._flagReason)
        : '—'),
    el('td', { class: 'px-3 py-2 text-right tabular-nums' },
      r.annual_recurring_value != null ? '$' + Math.round(r.annual_recurring_value).toLocaleString() : '—'),
    el('td', { class: 'px-3 py-2 text-right tabular-nums' },
      r.subscription_contract_value != null ? '$' + Math.round(r.subscription_contract_value).toLocaleString() : '—'),
    el('td', { class: 'px-3 py-2' }, fmtDate(r.initial_service)),
    el('td', {
      class: 'px-3 py-2 text-right tabular-nums',
      style: { color: (Number(r.days_past_due) || 0) > 0 ? '#DC2626' : 'var(--text-muted)' },
    }, r.days_past_due ? r.days_past_due + 'd' : '—'),
    el('td', { class: 'px-3 py-2' },
      r.subscription_date_canceled
        ? el('div', {},
            el('div', {}, fmtDate(r.subscription_date_canceled)),
            r.subscription_cancellation_reason && el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, r.subscription_cancellation_reason),
          )
        : '—',
    ),
  );

  const tbody = el('tbody', {});
  const moreBar = el('div', { class: 'flex items-center justify-center gap-3 p-3 text-xs', style: { borderTop: '1px solid var(--border)', display: 'none' } });

  const renderRows = () => {
    if (!sortedCache) sortedCache = computeSorted();
    const shown = Math.min(renderLimit, sortedCache.length);
    tbody.replaceChildren(...sortedCache.slice(0, shown).map(rowFor));
    moreBar.replaceChildren();
    moreBar.style.display = (sortedCache.length > RENDER_PAGE) ? 'flex' : 'none';
    if (sortedCache.length > shown) {
      const remaining = sortedCache.length - shown;
      moreBar.append(
        el('span', { style: { color: 'var(--text-muted)' } }, 'Showing ' + shown.toLocaleString() + ' of ' + sortedCache.length.toLocaleString() + ' rows'),
        el('button', {
          class: 'rounded-full px-2.5 py-1 font-semibold border cursor-pointer transition hover:brightness-110 text-[11px]',
          style: { background: 'var(--accent)', color: '#3A1D12', borderColor: 'var(--accent)' },
          onclick: () => { renderLimit += RENDER_PAGE * 2; renderRows(); },
        }, 'Show ' + Math.min(RENDER_PAGE * 2, remaining).toLocaleString() + ' more'),
        el('button', {
          class: 'rounded-full px-2.5 py-1 font-semibold border cursor-pointer transition hover:brightness-110 text-[11px]',
          style: { background: 'transparent', color: 'var(--text)', borderColor: 'var(--border-2)' },
          title: 'May be slow for very large lists',
          onclick: () => { renderLimit = sortedCache.length; renderRows(); },
        }, 'Show all ' + sortedCache.length.toLocaleString()),
      );
    } else if (sortedCache.length > RENDER_PAGE) {
      moreBar.append(el('span', { style: { color: 'var(--text-muted)' } }, 'Showing all ' + sortedCache.length.toLocaleString() + ' rows'));
    }
  };
  // A new sort invalidates the cache and snaps back to the first page so we
  // never sort-then-build the whole list in one frame.
  const resort = () => { sortedCache = null; renderLimit = RENDER_PAGE; renderRows(); };

  const headRow = el('tr', {});
  const paintHeaders = () => {
    headRow.replaceChildren(...cols.map(c => {
      const active = c.key === sortKey;
      const arrow = '';
      return el('th', {
        class: (c.align === 'right' ? 'text-right' : 'text-left') + ' px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap hover:text-default transition',
        style: active ? { color: 'var(--accent)', fontWeight: '800' } : undefined,
        title: 'Sort by ' + c.label,
        onclick: () => {
          if (sortKey === c.key) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
          else { sortKey = c.key; sortDir = c.type === 'num' ? 'desc' : 'asc'; }
          paintHeaders();
          resort();
        },
      }, c.label + arrow);
    }));
  };

  // Export the FULL slice (all rows, current sort) so nothing is lost to the
  // render window — the workflow for hunting CRM errors needs every row.
  const exportCsv = () => {
    const data = sortedCache || computeSorted();
    const head = ['Customer', 'Customer ID', 'Office', 'Sold By', 'Sold By Type', 'Subscription', 'Status', 'Completed Services', 'Flag', 'ARV', 'Contract', 'Initial Service', 'Days Past Due', 'Canceled Date', 'Cancel Reason'];
    const lines = [head.map(csvEsc).join(',')];
    for (const r of data) {
      lines.push([
        csvEsc(customerName(r)),
        csvEsc(r.customer_id || ''),
        csvEsc(r.office_name || ''),
        csvEsc(r.sold_by || ''),
        csvEsc(r.sold_by_type || ''),
        csvEsc(r.subscription || ''),
        csvEsc(r.subscription_status || ''),
        Number(r.subscription_completed_services) || 0,
        csvEsc(r._flagReason || ''),
        Number(r.annual_recurring_value) || 0,
        Number(r.subscription_contract_value) || 0,
        csvEsc(r.initial_service || ''),
        Number(r.days_past_due) || 0,
        csvEsc(r.subscription_date_canceled || ''),
        csvEsc(r.subscription_cancellation_reason || ''),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const fname = ('ridd-' + (chartTitle || 'drill') + '-' + (sliceLabel || '')).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80) + '.csv';
    const a = el('a', { href: url, download: fname });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  paintHeaders();
  renderRows();

  const card = el('div', {
    class: 'card w-full w-full my-8 overflow-hidden flex flex-col',
    style: { maxHeight: 'calc(100vh - 64px)' },
  },
    el('div', { class: 'flex items-start justify-between p-6 pb-3' },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, chartTitle),
        el('h2', { class: 'text-xl font-bold mt-0.5' }, sliceLabel),
        el('div', { class: 'text-xs text-muted- mt-1' },
          rows.length.toLocaleString() + ' row' + (rows.length === 1 ? '' : 's') +
          ' · ' + formatter(totalContract) + ' contract' +
          (totalArv > 0 ? ' · ' + formatter(totalArv) + ' ARV' : '') +
          ' · click a column to sort'),
      ),
      el('div', { class: 'flex items-center gap-2 shrink-0' },
        rows.length > 0 && el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold border cursor-pointer transition hover:brightness-110',
          style: { background: 'var(--card-2)', color: 'var(--text)', borderColor: 'var(--border)' },
          title: 'Download all ' + rows.length.toLocaleString() + ' rows as CSV',
          onclick: exportCsv,
        }, '↓ Export CSV'),
        el('button', {
          class: 'text-2xl leading-none',
          style: { color: 'var(--text-muted)' },
          onclick: () => { overlay.remove(); document.removeEventListener('keydown', closeKey); },
        }, '×'),
      ),
    ),
    rows.length === 0
      ? el('div', { class: 'p-12 text-center text-sm text-muted-' }, 'No rows in this slice.')
      : el('div', { class: 'overflow-auto flex-1', style: { borderTop: '1px solid var(--border)' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider sticky top-0', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
              headRow,
            ),
            tbody,
          ),
        ),
    moreBar,
  );

  overlay.append(card);
  document.body.append(overlay);
}

// Filter visible subs to a single office. 'all' means no filter.
function reportingFilterByOffice(rows, office) {
  if (!office || office === 'all') return rows;
  return rows.filter(r => (r.office_name || '') === office);
}

// Resolve a date-range preset into { start, end } ISO yyyy-mm-dd bounds.
// `null` ends mean "open" on that side. Custom mode falls back to the
// explicit start/end values from state.
function reportingDateBounds(preset, customStart, customEnd) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (preset === 'ytd') {
    return { start: today.getFullYear() + '-01-01', end: iso(today) };
  }
  if (preset === 'last_12_months') {
    const d = new Date(today); d.setFullYear(d.getFullYear() - 1);
    return { start: iso(d), end: iso(today) };
  }
  if (preset === 'last_year') {
    const y = today.getFullYear() - 1;
    return { start: y + '-01-01', end: y + '-12-31' };
  }
  if (preset === 'custom') {
    return { start: customStart || null, end: customEnd || null };
  }
  return { start: null, end: null };
}

// Filter subs by initial_service date. Both bounds are inclusive. null
// bounds mean "open" on that side. Rows missing initial_service are
// dropped whenever any bound is set (they can't be placed in time).
function reportingFilterByDate(rows, start, end) {
  if (!start && !end) return rows;
  return rows.filter(r => {
    if (!r.initial_service) return false;
    if (start && r.initial_service < start) return false;
    if (end   && r.initial_service > end)   return false;
    return true;
  });
}

// Pretty label for the active date-range preset. Used in chart sublines
// and the comparison table header so the reader knows the time scope.
function reportingDateRangeLabel(preset, start, end) {
  if (preset === 'all' || !preset) return 'All time';
  if (preset === 'ytd')            return 'Year to date';
  if (preset === 'last_12_months') return 'Last 12 months';
  if (preset === 'last_year')      return 'Last year';
  if (preset === 'custom') {
    if (start && end) return start + ' → ' + end;
    if (start)        return 'From ' + start;
    if (end)          return 'Through ' + end;
    return 'Custom range';
  }
  return 'All time';
}

// Distinct office names from a row set, sorted alphabetically. Used to
// populate the office picker(s) in the filter bar.
function reportingOfficeList(rows) {
  return [...new Set((rows || []).map(r => r.office_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

// Compute every chart's slice data + summary stats for a given row scope.
// Pulling this into a helper means single-mode and compare-mode call the
// exact same code path — no risk of one going stale relative to the other.
function reportingChartData(scopeRows, serviceConfig) {
  scopeRows = reportingApplyBranchRules(scopeRows); // branch excludes + renames
  const cfgByName = new Map((serviceConfig || []).map(c => [c.service_name, c]));
  // Recurring is decided per SERVICE TYPE (admin override in Configurations,
  // else "any row of this service has ARV > 0"). See
  // reportingServiceRecurringMap — this is why a frozen recurring sub still
  // classifies as recurring instead of falling into "Other active".
  const recurringByName = reportingServiceRecurringMap();
  const isRecurring = (r) => reportingRecurringMode() === 'arv'
    ? (Number(r.annual_recurring_value) || 0) > 0
    : !!recurringByName.get(r.subscription);
  const isActive = (r) => {
    const s = (r.subscription_status || '').toLowerCase();
    return s === 'active' && !r.subscription_date_canceled;
  };
  // Cancellation: any canceled recurring sub, UNLESS its reason is config-
  // excluded from attrition (Configurations tab). Non-recurring (one-time)
  // cancels are excluded too — they're not real attrition.
  const excludedReasons = reportingExcludedCancelReasons();
  const isRealCancel = (r) => {
    if (!r.subscription_date_canceled) return false;
    if (!isRecurring(r)) return false;
    if (reportingExcludeRorChurn() && _reporting3dayRor(r)) return false;
    if (excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r)))) return false;
    return true;
  };

  // Serviced: subs that have received at least one service. Since the
  // current CSV export only includes serviced accounts, this generally
  // matches the full row set — kept as its own filter so it stays
  // accurate if a future upload starts including pre-service rows.
  const isServiced = (r) => (Number(r.subscription_completed_services) || 0) > 0;

  const recurringRows   = scopeRows.filter(isRecurring);
  // One-time = an actual one-time SERVICE TYPE, not merely any $0-ARV row.
  // RIDD's one-time services are all named "One Time <something>" in the
  // Subscription column (8 of them: One Time Pest Control, German Roach,
  // Interior Flea, Rodent, Mosquito, Termite Inspection, Fire Ant, Vehicle
  // Infestation). Matching the "One Time" prefix auto-includes any future
  // ones and excludes "Initial" rows of recurring plans / internal services.
  // To hand-pin instead, fill ONE_TIME_SERVICES below and it takes priority.
  const ONE_TIME_SERVICES = [/* 'Exclusion', */];
  const otSet = new Set(ONE_TIME_SERVICES.map(s => s.toLowerCase()));
  const isOneTimeService = (r) => {
    const name = (r.subscription || '').trim().toLowerCase();
    if (otSet.size) return otSet.has(name);
    return name.startsWith('one time') || name.startsWith('one-time');
  };
  const oneTimeRows     = scopeRows.filter(isOneTimeService);
  // Retired services (config Lifecycle = Retired): the active subs still
  // sitting on discontinued services — the cleanup backlog, by service type.
  const lifecycleByName  = reportingServiceLifecycleMap();
  const retiredActiveRows = scopeRows.filter(r => isActive(r) && lifecycleByName.get(r.subscription) === 'retired');
  const activeRecurring = recurringRows.filter(isActive);
  const activeSubs      = scopeRows.filter(isActive);
  // The Active Subscriptions CHART follows the same "include one-time"
  // toggle as the headline KPI — otherwise the KPI (recurring-only) and the
  // donut total (all active) sit 50–100 apart on the same page.
  const activeForCharts = (typeof reportingActiveInclOneTime === 'function' && reportingActiveInclOneTime())
    ? activeSubs : activeRecurring;
  const realCancels     = scopeRows.filter(isRealCancel);
  const servicedRows    = scopeRows.filter(isServiced);
  // Past due = any sub with days_past_due > 0, regardless of status.
  // ── Receivables = REAL balances (per Isaac, fact-checked against the
  // FieldRoutes Receivables Aging card). The balance + its age live on the
  // CUSTOMER, so count each customer once; "Current" = 30 days or less,
  // past due = older than 30 (that's how FieldRoutes splits $2.13M into
  // $144K current / $1.98M past due). Contract value is NOT a receivable —
  // the old card summed it and called it AR.
  const arByCust = new Map();
  for (const r of scopeRows) {
    const cid = r.customer_id; if (!cid || arByCust.has(cid)) continue;
    const bal = Math.max(0, Number(r.responsible_balance) || 0);
    arByCust.set(cid, { balance: bal, dpd: Number(r.days_past_due) || 0, office: r.office_name || 'Unspecified', row: r });
  }
  const arCusts         = [...arByCust.values()];
  const pastDueCusts    = arCusts.filter(c => c.balance > 0 && c.dpd > 30);
  const pastDueRows     = pastDueCusts.map(c => c.row);
  const pastDueAmount   = pastDueCusts.reduce((sum, c) => sum + c.balance, 0);
  const totalAR         = arCusts.reduce((sum, c) => sum + c.balance, 0);
  const pastDuePct      = totalAR > 0 ? (pastDueAmount / totalAR) * 100 : 0;
  const totalContract   = scopeRows.reduce((sum, r) => sum + (Number(r.subscription_contract_value) || 0), 0);
  // Weighted average contract value across the entire scope — used as
  // the bottom-line total on the ACV pie since summing per-service
  // averages doesn't produce a meaningful overall number.
  const weightedAvgACV  = scopeRows.length > 0 ? totalContract / scopeRows.length : 0;

  // Customer "recurring vs other" split — a customer counts as recurring
  // if any of their active subs is on a recurring service.
  const customerMap = new Map();
  for (const r of scopeRows) {
    if (!r.customer_id) continue;
    if (!customerMap.has(r.customer_id)) customerMap.set(r.customer_id, { recurring: false, active: false });
    const m = customerMap.get(r.customer_id);
    if (isActive(r)) m.active = true;
    // A customer counts as "recurring" if they hold ANY recurring sub —
    // active OR frozen. Without this, someone with an active one-time sub
    // and a frozen recurring package was mislabeled "Other active" even
    // though they're clearly a recurring customer. "Other active" should
    // only be customers whose subs are ALL one-time / non-recurring.
    if (isRecurring(r)) m.recurring = true;
  }
  let recurringCustomers = 0, otherActiveCustomers = 0;
  // Track which customer IDs land in each bucket so the Active Customers
  // chart can drill into the underlying rows.
  const recurringCustIds   = new Set();
  const otherActiveCustIds = new Set();
  for (const [cid, v] of customerMap.entries()) {
    if (!v.active) continue;
    if (v.recurring) { recurringCustomers++;    recurringCustIds.add(cid); }
    else             { otherActiveCustomers++;  otherActiveCustIds.add(cid); }
  }

  const activeArr = activeRecurring.reduce((s, r) => s + (Number(r.annual_recurring_value) || 0), 0);
  // Rate over RECURRING subs (the card says "recurring subs only") — it used
  // to divide by every row incl. one-time services, so it read low.
  const cancelRate = recurringRows.length > 0
    ? ((realCancels.length / recurringRows.length) * 100)
    : 0;

  // Receivables aging slices in stable bucket order (Current → 90+).
  // Empty buckets are kept at value 0 so the pie filters them out but
  // the legend order stays predictable across snapshots.
  const agingTotals = new Map(REPORTING_AGING_ORDER.map(k => [k, 0]));
  for (const c of arCusts) {
    if (!c.balance) continue;
    const bucket = reportingAgingBucket(c.dpd);
    agingTotals.set(bucket, (agingTotals.get(bucket) || 0) + c.balance);
  }
  const receivablesSlices = REPORTING_AGING_ORDER.map(k => ({ label: k, value: agingTotals.get(k) || 0 }));

  // Customer tenure: count subs per tenure bucket. Stable order so the
  // legend reads <1yr → 4+yr → Unknown across every snapshot.
  const today = new Date();
  const tenureCounts = new Map(REPORTING_TENURE_ORDER.map(k => [k, 0]));
  for (const r of scopeRows) {
    const bucket = reportingTenureBucket(r.initial_service, today);
    tenureCounts.set(bucket, (tenureCounts.get(bucket) || 0) + 1);
  }
  const tenureSlices = REPORTING_TENURE_ORDER.map(k => ({ label: k, value: tenureCounts.get(k) || 0 }));

  // Agreement length mix: 12 / 18 / 24 are the real products — everything
  // else (6, 13, 36, legacy oddballs) rolls into one "Other" slice (per
  // Isaac; matches the retention waterfall's contract buckets). Zero/null
  // lengths are dropped — they don't represent a real contract term.
  const agreementMap = new Map([['12 mo', 0], ['18 mo', 0], ['24 mo', 0], ['Other', 0]]);
  for (const r of scopeRows) {
    const months = Number(r.agreement_length) || 0;
    if (months <= 0) continue;
    const key = (months === 12 || months === 18 || months === 24) ? months + ' mo' : 'Other';
    agreementMap.set(key, (agreementMap.get(key) || 0) + 1);
  }
  const agreementSlices = [...agreementMap.entries()]
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label, value: count }));

  return {
    stats: {
      subs:             scopeRows.length,
      servicedSubs:     servicedRows.length,
      recurring:        recurringRows.length,
      activeRecurring:  activeRecurring.length,
      activeSubs:       activeSubs.length,
      activeArr,
      uniqueCustomers:  new Set(scopeRows.map(r => r.customer_id).filter(Boolean)).size,
      // Customers with ≥1 ACTIVE sub — matches the Active Customers donut
      // (recurring + other-active). The old KPI used uniqueCustomers, which
      // counts every customer EVER (canceled included) under an "Active" label.
      activeCustomers:  recurringCustomers + otherActiveCustomers,
      distinctServices: new Set(scopeRows.map(r => r.subscription).filter(Boolean)).size,
      distinctActiveServices: new Set(activeSubs.map(r => r.subscription).filter(Boolean)).size,
      realCancels:      realCancels.length,
      cancelRate,
      pastDueAmount,
      pastDuePct,
      pastDueCount:     pastDueRows.length,
      totalAR,
      weightedAvgACV,
    },
    slices: {
      rarr:        reportingGroupSum(activeRecurring, r => r.subscription,                r => r.annual_recurring_value),
      rarrOffice:  reportingGroupSum(activeRecurring, r => r.office_name || 'Unspecified', r => r.annual_recurring_value),
      customers:   [
        { label: 'Recurring customers', value: recurringCustomers },
        { label: 'Other active',        value: otherActiveCustomers },
      ],
      activeSubs:  reportingGroupCount(activeForCharts, r => r.subscription),
      serviced:    reportingGroupSum(servicedRows,  r => r.subscription, r => r.subscription_contract_value),
      aging:       receivablesSlices,
      pastDueOffice: reportingGroupSum(pastDueCusts, c => c.office, c => c.balance),
      tenure:      tenureSlices,
      agreement:   agreementSlices,
      cancels:     reportingGroupCount(realCancels, r => reportingCancelReasonOf(r)),
      sources:     reportingGroupCount(scopeRows,   r => r.subscription_source || 'Unspecified'),
      onetimeSubs: reportingGroupCount(oneTimeRows, r => r.subscription || 'Unspecified'),
      onetimeRev:  reportingGroupSum(oneTimeRows,   r => r.subscription || 'Unspecified', r => r.subscription_contract_value),
      retiredSubs: reportingGroupCount(retiredActiveRows, r => r.subscription || 'Unspecified'),
    },
    // Per-chart drill spec: given a slice label, source.filter(r => key(r) === label)
    // returns every row that contributed to that slice. Used by the drill
    // modal so a user can click into any wedge and see the underlying subs.
    drill: {
      rarr:          { source: activeRecurring, key: r => r.subscription },
      rarrOffice:    { source: activeRecurring, key: r => r.office_name || 'Unspecified' },
      customers:     {
        source: scopeRows.filter(r => r.customer_id && (recurringCustIds.has(r.customer_id) || otherActiveCustIds.has(r.customer_id))),
        key: r => recurringCustIds.has(r.customer_id) ? 'Recurring customers' : 'Other active',
      },
      activeSubs:    { source: activeForCharts, key: r => r.subscription },
      serviced:      { source: servicedRows,  key: r => r.subscription },
      aging:         { source: scopeRows,     key: r => reportingAgingBucket(r.days_past_due) },
      pastDueOffice: { source: pastDueRows,   key: r => r.office_name || 'Unspecified' },
      tenure:        { source: scopeRows,     key: r => reportingTenureBucket(r.initial_service, today) },
      agreement:     { source: scopeRows.filter(r => (Number(r.agreement_length) || 0) > 0), key: r => { const m = Number(r.agreement_length) || 0; return (m === 12 || m === 18 || m === 24) ? m + ' mo' : 'Other'; } },
      cancels:       { source: realCancels,   key: r => reportingCancelReasonOf(r) },
      sources:       { source: scopeRows,     key: r => r.subscription_source || 'Unspecified' },
      onetimeSubs:   { source: oneTimeRows,   key: r => r.subscription || 'Unspecified' },
      onetimeRev:    { source: oneTimeRows,   key: r => r.subscription || 'Unspecified' },
      retiredSubs:   { source: retiredActiveRows, key: r => r.subscription || 'Unspecified' },
      // Every ACTIVE one-time sub in one bucket (single synthetic slice) so
      // the One-Time Subscriptions card can offer a "show all active" inspect
      // link for flagging mis-categorized or stale one-time subscriptions.
      onetimeActive: { source: oneTimeRows.filter(isActive), key: () => 'Active one-time' },
      // Data-hygiene: active subs that probably should be closed (config-driven
      // lifecycle rules). Each row carries _flagReason.
      flaggedActive: { source: reportingFlaggedActive(scopeRows, isActive), key: () => 'Should be closed' },
    },
  };
}

// Build a stable label-to-color map from the union of two slice sets.
// Used in compare mode so "Pest 4" is the same color in both offices'
// pies. Labels are ordered by combined value so the dominant service
// always lands on the first palette color.
function reportingColorMap(slicesA, slicesB) {
  const totals = new Map();
  for (const s of slicesA) totals.set(s.label, (totals.get(s.label) || 0) + s.value);
  for (const s of slicesB) totals.set(s.label, (totals.get(s.label) || 0) + s.value);
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  const map = {};
  ordered.forEach((label, i) => { map[label] = REPORTING_PALETTE[i % REPORTING_PALETTE.length]; });
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKETING — the CMO command center. One page that fuses four systems:
//   · Revenue & accounts by lead source — LIVE FieldRoutes data (the same
//     30-min pipeline as everything else; FR Pending/Serviced gate)
//   · Ad spend — Windsor.ai (Meta + Google daily) via /api/marketing-spend
//   · Leads — GoHighLevel by source/month via /api/ghl-leads
//   · Books — QuickBooks "Advertising & Marketing" by month via /api/qbo-spend
// Each feed degrades gracefully: a missing key/env shows a setup hint on its
// card while the rest of the page keeps working. Replaced the old iframe page
// whose FieldRoutes data was BAKED IN (stale since June).
// ═══════════════════════════════════════════════════════════════════════════
const MK_CACHE_MS = 30 * 60 * 1000;
// Session bearer token for the app's own /api endpoints (they're all
// auth-gated server-side now — closed by default, Apple style).
async function _apiAuthHeaders(extra) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return Object.assign({ Authorization: 'Bearer ' + ((session && session.access_token) || '') }, extra || {});
  } catch (e) { return extra || {}; }
}
function _mkFetch(key, url) {
  const slot = state[key] || (state[key] = { data: null, err: null, at: 0, inflight: false });
  if (slot.inflight || (slot.at && Date.now() - slot.at < MK_CACHE_MS)) return slot;
  slot.inflight = true;
  _apiAuthHeaders({ accept: 'application/json' })
    .then(h => fetch(url, { headers: h }))
    .then(r => r.json().then(j => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      slot.at = Date.now(); slot.inflight = false;
      if (ok && j && !j.error) { slot.data = j; slot.err = null; }
      else slot.err = (j && j.error) || 'unavailable';
      if (state.view === 'marketing') mountApp();
    })
    .catch(e => { slot.at = Date.now(); slot.inflight = false; slot.err = String(e && e.message || e); if (state.view === 'marketing') mountApp(); });
  return slot;
}

