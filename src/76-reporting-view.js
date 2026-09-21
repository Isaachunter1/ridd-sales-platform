// ┌─ src/76-reporting-view.js ─────────────────────────────────────────────────────
// │ Reporting shell: sub-tabs, methodology bar, error guard, view dispatch.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewReporting() {
  if (!isAdminRole(state.profile?.role)) {
    return el('div', { class: 'card p-6 text-center text-sm text-muted-' }, 'Reporting is an admin-only tab.');
  }
  if (!state.reportingSubTab) state.reportingSubTab = 'overview';

  // Lazy-load subscription rows for the active snapshot on first visit.
  // Re-checks on each render in case the user just switched snapshots.
  const activeId = state.reportingActiveUploadId;
  if (activeId && state.reportingSubscriptionsLoadedFor !== activeId) {
    loadReportingSubscriptions(activeId).then(rows => {
      // Snapshot may have changed under us while the request was in flight.
      if (state.reportingActiveUploadId !== activeId) return;
      if (rows == null) return;        // aborted/superseded load — keep what we have
      state.reportingSubscriptions = rows;
      state.reportingSubscriptionsLoadedFor = activeId;
      _refreshRepTypeMap();
      mountApp();
    });
  }

  // Marketing has its own data source (marketing.html), so it doesn't use the
  // reporting snapshot top bar — only the sub-tab nav above it.
  const isMarketing = state.reportingSubTab === 'marketing';

  // A sub-tab that throws must not blank the whole Reporting view (Carson hit
  // this on Retention). Render it in a guard: the other tabs stay usable, the
  // error is shown with a one-click reset of that tab's saved state, and it
  // still posts to the admin error feed.
  const _guarded = (build) => {
    try { return build(); }
    catch (e) {
      console.error('[reporting] sub-tab render failed', state.reportingSubTab, e);
      try { _reportClientError('reporting/' + state.reportingSubTab + ': ' + (e && e.message), e && e.stack); } catch (_) {}
      return el('div', { class: 'card p-8 flex flex-col items-center gap-3 text-center' },
        el('div', { class: 'text-sm font-bold' }, 'This tab hit an error'),
        el('div', { class: 'text-xs text-muted-' }, String((e && e.message) || e).slice(0, 200)),
        el('div', { class: 'flex items-center gap-2' },
          el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => {
            // Clear this tab's remembered filters / what-ifs and re-render.
            try { ['_retenWhatIf', '_retenMemo', '_putisSort', '_putisPctCols', '_yoyAxisCap', '_yoyHideYtd'].forEach(k => { delete state[k]; }); } catch (_) {}
            state._salesFilters = state._salesFilters || {};
            mountApp();
          } }, 'Reset this tab'),
          el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => location.reload() }, 'Reload app')));
    }
  };
  return el('div', { class: 'flex flex-col gap-4' },
    // (Active Snapshot bar retired — per Isaac; the header stamp already says when the data synced.)
    reportingSubTabs(),
    reportingMethodologyBar(),
    _guarded(() =>
    isMarketing                            ? reportingMarketingPnl() :
    state.reportingSubTab === 'is'         ? reportingMarketingPnl() :
    state.reportingSubTab === 'config'     ? el('div', { class: 'flex flex-col gap-4' }, reportingAuditExportCard(), el('div', { class: 'grid grid-cols-1 lg:grid-cols-3 gap-4 items-start' }, reportingServiceConfigPanel(), reportingSourceConfigPanel(), reportingCancelConfigPanel()), reportingMarketingGoalsPanel()) :
    state.reportingSubTab === 'uploads'    ? reportingUploadsPanel() :
    state.reportingSubTab === 'putis'      ? reportingPutis() :
    state.reportingSubTab === 'geographic' ? reportingGeographic() :
    state.reportingSubTab === 'waterfall'  ? reportingWaterfall() :
    // 'services' retired as a top tab; 'health'/'nextbest' fold into
    // Retention — legacy persisted values land there too.
    (state.reportingSubTab === 'health' || state.reportingSubTab === 'nextbest' || state.reportingSubTab === 'services') ? reportingWaterfall() :
    state.reportingSubTab === 'auditing'   ? reportingAuditing() :
    state.reportingSubTab === 'ops'        ? reportingOps() :
                                              reportingOverview()),
  );
}

// The active snapshot's metadata row (filename / date / row count), or null.
function reportingActiveSnapshotMeta() {
  return (state.reportingUploads || []).find(x => x.id === state.reportingActiveUploadId) || null;
}

// Thin "how reporting is calculated" bar shown on every report sub-tab, plus a
// Details popup. Both read the live config so the disclaimer is always honest
// about what's being excluded/how recurring + attrition are defined.
function reportingMethodologyBar() {
  const tab = state.reportingSubTab;
  if (tab === 'config' || tab === 'uploads') return null; // settings, not a report

  const u = reportingActiveSnapshotMeta();
  const svc = state.reportingServiceConfig || [];
  const hidden  = svc.filter(c => c.is_hidden).length;
  const srcExcl = (state.reportingSourceConfig || []).filter(c => c.included === false).length;
  const reaExcl = (state.reportingCancelConfig || []).filter(c => c.counts_attrition === false).length;

  // The banner itself is retired — its full contents live in the modal,
  // opened by the ⓘ button in the filter row below. (hidden/srcExcl/reaExcl
  // are still computed above so this function's callers stay stable.)
  void u; void hidden; void srcExcl; void reaExcl;
  return null;
}

// Compact ⓘ that opens the methodology modal (replaces the old banner).
function reportingMethodologyInfoBtn() {
  const tab = state.reportingSubTab;
  if (tab === 'config' || tab === 'uploads') return null;
  return el('button', {
    class: 'inline-flex items-center justify-center rounded-full text-xs font-bold cursor-pointer shrink-0 transition hover:brightness-95',
    style: { width: '26px', height: '26px', background: 'var(--accent)', color: 'var(--accent-text)', alignSelf: 'flex-end', marginBottom: '4px' },
    title: 'How these numbers are calculated — snapshot, exclusions, recurring & attrition definitions',
    onclick: () => openReportingMethodologyModal(tab),
  }, 'ⓘ');
}

function openReportingMethodologyModal(tab) {
  const u   = reportingActiveSnapshotMeta();
  const svc = state.reportingServiceConfig || [];
  const lc  = reportingServiceLifecycleMap();
  const hidden   = svc.filter(c => c.is_hidden).map(c => c.service_name).sort();
  const retired  = [...lc.entries()].filter(([, v]) => v === 'retired').map(([n]) => n).sort();
  const srcExcl  = (state.reportingSourceConfig || []).filter(c => c.included === false).map(c => c.source).sort();
  const reaExcl  = (state.reportingCancelConfig || []).filter(c => c.counts_attrition === false).map(c => c.reason).sort();

  const overlay = el('div', { class: 'modal-overlay' });
  const closeKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', closeKey); } };
  document.addEventListener('keydown', closeKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); document.removeEventListener('keydown', closeKey); } });

  const list = (arr) => arr.length
    ? el('span', { style: { color: 'var(--text)' } }, arr.join(', '))
    : el('span', { style: { color: 'var(--text-subtle)' } }, 'none');

  const section = (title, ...body) => el('div', { class: 'mb-3' },
    el('div', { class: 'text-[11px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--accent)' } }, title),
    el('div', { class: 'text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, ...body),
  );

  const tabNotes = {
    overview:   'Headline cards + donuts cover every visible sub in scope. Active = status Active with no cancel date. ARR sums Annual Recurring Value over active recurring subs.',
    geographic: 'Map + tables use recurring subs only (one-time excluded) — the same set and rules as the Overview cards, so totals tie. Attrition = real cancels ÷ recurring subs; rates need 10+ subs in an area before they show. Retention = 1 − attrition.',
    reps:       'Per-rep counts use every visible sub in scope (sold_by). Active and ARV use the same Active + recurring rules as Overview.',
    waterfall:  'Population: recurring service types only (per the Lifecycle config), serviced subs only (retention starts at first service), after Hidden-service and excluded-source filters, branch rules, and the Retention-population rules from Configurations (renewal subs, $0 payers, and frozen-\u22641-service subs are excluded by default \u2014 the workbook\u2019s manual Steps 4\u20136). Each cell = subs of that row still active at that year\u2019s end: started on/before Dec 31 and not cancelled by then. Cancels with a reason excluded from attrition count as RETAINED, and the 3-day-ROR setting matches the Overview tab. Subscription/ARR rows are initial-service-year cohorts (all-time; the time range doesn\u2019t apply). Contract Length / Rep default to BOOK SIZE per year-end — new sales enter columns as they start — and the Cohort picker locks those rows to one start-year and follows it, a true retention curve. Rep mode shows the top 15 reps by sub count, attributed by Sold By. Colors grade each cell against the cohort size (cohort views) or the row\u2019s best year (book-size view). Each cell shows the count plus its share of the cohort still active, and hovering shows the step attrition vs the prior year (1 \u2212 survivors \u00f7 prior-year survivors). Contract Length groups to 12/18/24 months plus Other (odd or legacy lengths pending CRM cleanup); the Blended Attrition table compares each year\u2019s beginning-of-year book (existing cohorts only) to those SAME subs at year-end \u2014 new sales during the year never enter, and ARR mode measures it in dollars.',
    is:         'Inside Sales is a sold-date P&L: new revenue is committed-sold (auto-pay) subs by the month sold. It honors excluded Sources but, being sold-revenue, not the lifecycle/hidden/cancel rules.',
  };

  const card = el('div', {
    class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col',
    style: { maxHeight: 'calc(100vh - 64px)' },
  },
    el('div', { class: 'flex items-start justify-between p-6 pb-3' },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Reporting Methodology'),
        el('h2', { class: 'text-xl font-bold mt-0.5' }, 'How this report is calculated'),
      ),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: () => { overlay.remove(); document.removeEventListener('keydown', closeKey); } }, '×'),
    ),
    el('div', { class: 'overflow-auto px-6 pb-6', style: { borderTop: '1px solid var(--border)' } },
      el('div', { class: 'pt-4' },
        section('Data source',
          u ? ('All numbers come from your active snapshot — ' + (u.filename || 'upload') + ', ' + (u.row_count || 0).toLocaleString()
                + ' subscriptions' + (u.uploaded_at ? ', uploaded ' + new Date(u.uploaded_at).toLocaleDateString() : '') + '.')
            : 'No active snapshot loaded.'),
        section('Recurring vs one-time',
          'Decided per service by its Lifecycle in Configurations. Recurring counts toward ARR, churn and retention; One-time and Retired do not. "Auto" infers recurring from revenue (any Annual Recurring Value > $0).'),
        section('Active & attrition',
          'Active = status Active with no cancellation date. A cancellation counts as attrition only if the sub is recurring AND its reason is not excluded below. (Excluded reasons are real cancels that you\'ve decided aren\'t true churn.)'),
        section('Excluded from all reporting',
          el('div', {}, 'Hidden services (', list(hidden), ')'),
          el('div', { class: 'mt-0.5' }, 'Excluded sources (', list(srcExcl), ')')),
        section('Excluded from attrition only',
          el('div', {}, 'Cancel reasons (', list(reaExcl), ')'),
          el('div', { class: 'mt-0.5' }, 'Retired services flagged for cleanup (', list(retired), ')')),
        tabNotes[tab] && section('This tab', tabNotes[tab]),
        el('div', { class: 'text-[11px] mt-2', style: { color: 'var(--text-subtle)' } },
          'Change any of these in the Configurations sub-tab.'),
      ),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

function reportingTopBar() {
  const uploads = state.reportingUploads || [];
  const activeId = state.reportingActiveUploadId;
  const active = uploads.find(u => u.id === activeId);

  // Total subscription count in the active snapshot — always the full row
  // count, independent of any date/office filters elsewhere. Snapshots now
  // come from the RevHawk sync (↻ in the top bar), so there's no upload button.
  const meta = active
    ? el('div', { class: 'text-xs text-muted-' },
        el('b', { style: { color: 'var(--text)' } }, (active.row_count || 0).toLocaleString() + ' total subscriptions'),
        ' · synced ' + timeAgo(active.uploaded_at))
    : el('div', { class: 'text-xs text-muted-' }, 'No snapshot yet — hit the ↻ sync icon in the top bar to pull from RevHawk.');

  return el('div', { class: 'card p-4 flex items-center justify-between gap-4 flex-wrap' },
    el('div', { class: 'flex flex-col gap-1' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Active Snapshot'),
      meta,
    ),
  );
}

function formatSnapshotLabel(u) {
  const dt = u.uploaded_at ? new Date(u.uploaded_at) : null;
  const date = dt ? dt.toLocaleDateString() : '';
  const name = u.filename || 'snapshot';
  return date + ' — ' + name + ' (' + (u.row_count || 0).toLocaleString() + ' rows)';
}

// ── Service FAMILIES — a subscription name can span several ("Pest Mole
// Mosquito 6"). Used by Next Best Service + Customer Health.
const _SVC_FAMS = [
  ['Termite', /sentricon|termite/i], ['German Roach', /german\s*roach/i],
  ['Mosquito', /mosquito/i], ['Rodent', /rodent/i], ['Mole', /mole/i],
  ['Snake', /snake/i], ['Carpenter Bee', /carpenter\s*bee/i], ['Flea', /flea/i],
];
function svcFamiliesOf(name) {
  const out = [];
  for (const [fam, re] of _SVC_FAMS) if (re.test(String(name || ''))) out.push(fam);
  if (!out.length || /(^|\s)pest(\s|$)/i.test(String(name || ''))) out.unshift('Pest');
  return [...new Set(out)];
}
function _titleCaseWords(s) {
  return String(s == null ? '' : s).split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
}
const _custDisplayName = (r) => {
  const n = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
  return n ? n.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ') : ('#' + r.customer_id);
};
function _reportingCsvDownload(fname, header, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [header.map(esc).join(',')].concat(rows.map(r => r.map(esc).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
  a.download = fname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ═══ CUSTOMER HEALTH — churn defense. Scores every ACTIVE customer on the
// known churn drivers (measured on this book) and hands the office a ranked
// save-call list before the cancel happens. ═══
function reportingCustomerHealth() {
  const gate = reportingDataGate();
  if (gate) return gate;
  const { visible } = reportingFilters();
  const office = state.reportingOffice || 'all';
  const rows = reportingFilterByOffice(visible, office);
  const now = new Date();
  const isActive = (r) => (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;
  const zip5 = (r) => String(r.zip_code || '').trim().slice(0, 5);
  const moSince = (iso) => { const d = new Date(String(iso) + 'T00:00'); return isNaN(d) ? null : (now - d) / 2629800000; };
  const excludedReasons = reportingExcludedCancelReasons();
  const counted = (r) => r.subscription_date_canceled && !excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r)));

  // Context churn rates — which ZIPs and service families bite hardest.
  const zipStat = new Map(), famStat = new Map();
  let allN = 0, allC = 0;
  rows.forEach(r => {
    const z = zip5(r);
    const zs = zipStat.get(z) || { n: 0, c: 0 }; zs.n++; if (counted(r)) zs.c++; zipStat.set(z, zs);
    svcFamiliesOf(r.subscription).forEach(f => {
      const fs = famStat.get(f) || { n: 0, c: 0 }; fs.n++; if (counted(r)) fs.c++; famStat.set(f, fs);
    });
    allN++; if (counted(r)) allC++;
  });
  const baseRate = allN ? allC / allN : 0;
  const riskyZip = (z) => { const s = zipStat.get(z); return !!(s && s.n >= 20 && s.c / s.n > baseRate * 1.25); };
  const riskyFam = (f) => { const s = famStat.get(f); return !!(s && s.n >= 100 && s.c / s.n > baseRate * 1.15); };

  // One record per ACTIVE customer.
  const byCust = new Map();
  rows.forEach(r => {
    if (!isActive(r) || !r.customer_id) return;
    let c = byCust.get(r.customer_id);
    if (!c) { c = { id: r.customer_id, name: _custDisplayName(r), office: r.office_name || '—', zip: zip5(r), state: r.state || '', phone: r.phone || '', email: r.email || '', subs: [], arr: 0, fams: new Set(), pastDue: 0, autopay: false, oldest: null, renewal: false }; byCust.set(r.customer_id, c); }
    if (!c.phone && r.phone) c.phone = r.phone;
    c.subs.push(r.subscription);
    c.arr += Number(r.annual_recurring_value) || 0;
    svcFamiliesOf(r.subscription).forEach(f => c.fams.add(f));
    c.pastDue = Math.max(c.pastDue, Number(r.days_past_due) || 0);
    { const _ap = String(r.customer_auto_pay || '').trim(); if (_ap && !/^no$/i.test(_ap)) c.autopay = true; }
    const mo = moSince(r.initial_service);
    if (mo != null && (c.oldest == null || mo > c.oldest)) c.oldest = mo;
    const len = Number(r.agreement_length) || 0;
    if (len > 1 && mo != null && mo >= len - 2 && mo <= len + 1) c.renewal = true;
  });

  const scored = [];
  byCust.forEach(c => {
    let score = 0; const why = []; const flags = {};
    if (c.pastDue >= 60)      { score += 40; why.push(c.pastDue + 'd past due'); flags.pastdue = true; }
    else if (c.pastDue >= 30) { score += 30; why.push(c.pastDue + 'd past due'); flags.pastdue = true; }
    else if (c.pastDue > 0)   { score += 15; why.push(c.pastDue + 'd past due'); flags.pastdue = true; }
    if (!c.autopay)           { score += 15; why.push('no autopay'); flags.apay = true; }
    if (c.fams.size <= 1)     { score += 10; why.push('single service'); flags.single = true; }
    if (c.oldest != null && c.oldest >= 3 && c.oldest <= 14) { score += 10; why.push('danger-zone tenure (' + c.oldest.toFixed(0) + ' mo)'); flags.danger = true; }
    if (c.renewal)            { score += 15; why.push('renewal window'); flags.renewal = true; }
    if (riskyZip(c.zip))      { score += 10; why.push('high-churn ZIP'); flags.zip = true; }
    if ([...c.fams].some(riskyFam)) { score += 10; why.push('high-churn service'); flags.svc = true; }
    // Golden autopay conversion: pays reliably by hand (zero past due, 3+
    // months tenure) but no autopay — the easiest "flip them on" ask.
    // (True "billing method on file" isn't in the CRM export yet.)
    if (flags.apay && c.pastDue === 0 && (c.oldest || 0) >= 3) { flags.apayEasy = true; why.push('pays on time — easy autopay ask'); }
    c.score = Math.min(100, score); c.why = why; c.flags = flags;
    c.bucket = c.score >= 65 ? 'critical' : c.score >= 40 ? 'atrisk' : c.score >= 20 ? 'watch' : 'healthy';
    scored.push(c);
  });
  scored.sort((a, b) => b.score - a.score || b.arr - a.arr);

  const BUCKETS = [
    // One colour per bucket, worst → best: red, rust, orange (attention), sage (good).
    ['critical', 'Critical', '#DC2626'], ['atrisk', 'At Risk', '#A9441F'],
    ['watch', 'Watch', '#DF643A'], ['healthy', 'Healthy', '#5F6C5B'],
  ];
  const bucketAgg = {};
  BUCKETS.forEach(([k]) => bucketAgg[k] = { n: 0, arr: 0 });
  scored.forEach(c => { bucketAgg[c.bucket].n++; bucketAgg[c.bucket].arr += c.arr; });
  const sel = state._healthBucket || 'critical';
  const q = String(state._healthQ || '').toLowerCase();
  const factor = state._healthFactor || 'all';
  const list = scored.filter(c => (sel === 'all' || c.bucket === sel)
    && (factor === 'all' || c.flags[factor])
    && (!q || (c.name + ' ' + c.id + ' ' + c.office).toLowerCase().includes(q)));
  // APay breakout: golden conversions (reliable manual payers) sort first.
  if (factor === 'apay') list.sort((a, b) => (b.flags.apayEasy ? 1 : 0) - (a.flags.apayEasy ? 1 : 0) || b.arr - a.arr);

  const exportBtn = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    title: 'Download the filtered list as a call sheet (CSV)',
    onclick: () => _reportingCsvDownload('customer-health-' + sel + '.csv',
      ['Customer ID', 'Customer', 'Phone', 'Email', 'Office', 'State', 'ZIP', 'Health Score', 'Bucket', 'ARR', 'Services', 'Months Active', 'Past Due Days', 'Auto Pay', 'Pays On Time (No APay)', 'Risk Factors'],
      list.map(c => [c.id, c.name, c.phone, c.email, c.office, c.state, c.zip, c.score, c.bucket, Math.round(c.arr), c.subs.join(' | '), c.oldest != null ? c.oldest.toFixed(1) : '', c.pastDue, c.autopay ? 'Yes' : 'No', c.flags.apayEasy ? 'YES' : '', c.why.join('; ')])),
  }, '⬇ Export call list (' + list.length.toLocaleString() + ')');

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
        el('div', {},
          el('h2', { class: 'text-lg font-bold' }, '❤️‍🩹 Customer Health'),
          el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
            'Every active customer, scored on the churn drivers measured in OUR book — past due balance, no autopay, single service, danger-zone tenure (months 3–14), renewal window, high-churn ZIP / service. Call the top of this list before they cancel.')),
        exportBtn),
      el('div', { class: 'grid gap-3 mt-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
        ...BUCKETS.map(([k, label, color]) => el('button', {
          class: 'rounded-xl p-3 text-left transition hover:brightness-95 cursor-pointer',
          style: { background: 'var(--card-2)', border: sel === k ? '2px solid ' + color : '2px solid transparent' },
          onclick: () => { state._healthBucket = k; mountApp(); },
        },
          el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color } }, label),
          el('div', { class: 'text-xl font-black tabular-nums' }, bucketAgg[k].n.toLocaleString()),
          el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, fmt.usd0(bucketAgg[k].arr) + ' ARR'))),
        el('button', {
          class: 'rounded-xl p-3 text-left transition hover:brightness-95 cursor-pointer',
          style: { background: 'var(--card-2)', border: sel === 'all' ? '2px solid var(--accent)' : '2px solid transparent' },
          onclick: () => { state._healthBucket = 'all'; mountApp(); },
        },
          el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-muted)' } }, 'All'),
          el('div', { class: 'text-xl font-black tabular-nums' }, scored.length.toLocaleString()),
          el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, 'active customers')))),
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'p-3 border-b flex flex-col gap-2', style: { borderColor: 'var(--border)' } },
        // Factor breakouts (per Isaac) — one chip per risk driver; the APay
        // chip surfaces the golden "pays on time, just flip autopay on" list.
        (() => {
          const F = [
            ['all', 'All factors'], ['pastdue', '💸 Past due'], ['apay', '💳 No autopay'],
            ['single', '1️⃣ Single service'], ['danger', '⏳ Danger zone'], ['renewal', '🔁 Renewal window'],
            ['zip', '📍 High-churn ZIP'], ['svc', '🧪 High-churn service'],
          ];
          const inBucket = scored.filter(c => (sel === 'all' || c.bucket === sel));
          const cnt = (k) => k === 'all' ? inBucket.length : inBucket.filter(c => c.flags[k]).length;
          return el('div', { class: 'flex items-center gap-1.5 flex-wrap' },
            ...F.map(([k, l]) => el('button', {
              class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95',
              style: factor === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)' },
              onclick: () => { state._healthFactor = k; mountApp(); },
            }, l + ' · ' + cnt(k).toLocaleString())));
        })(),
        factor === 'apay' && (() => {
          const easy = list.filter(c => c.flags.apayEasy);
          return el('div', { class: 'text-[11px] font-semibold', style: { color: '#DF643A' } },
            '💡 ' + easy.length.toLocaleString() + ' of these pay reliably by hand (zero past due, 3+ months in) — the easiest autopay conversions, sorted to the top. ' +
            fmt.usd0(easy.reduce((a, c) => a + c.arr, 0)) + ' ARR protected if they flip.');
        })(),
        el('input', {
          class: 'w-full rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          placeholder: 'Search name / ID / office…', value: state._healthQ || '',
          onchange: (e) => { if (e.target.value.trim() && typeof trackAction === 'function') trackAction('search:customer_health'); },
          oninput: (e) => { state._healthQ = e.target.value; clearTimeout(state._healthQt); state._healthQt = setTimeout(() => mountApp(), 350); },
        })),
      el('div', { class: 'overflow-x-auto', style: { maxHeight: '560px' } },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider sticky top-0', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
            el('tr', {},
              el('th', { class: 'text-left px-3 py-2 font-semibold' }, 'Score'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Customer'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Office'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'ARR'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Tenure'),
              el('th', { class: 'text-left px-3 py-2 font-semibold' }, 'Why'))),
          el('tbody', {},
            ...list.slice(0, 300).map(c => {
              const color = c.bucket === 'critical' ? '#DC2626' : c.bucket === 'atrisk' ? '#A9441F' : c.bucket === 'watch' ? '#A9441F' : '#DF643A';
              return el('tr', { class: 'border-t tabular-nums', style: { borderColor: 'var(--border)' } },
                el('td', { class: 'px-3 py-2 font-black', style: { color } }, c.score),
                el('td', { class: 'px-2 py-2' },
                  el('div', { class: 'font-semibold' }, c.name),
                  el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '#' + c.id + ' · ' + [...c.fams].join(', ')),
                  c.phone ? el('a', { href: 'tel:' + String(c.phone).replace(/[^0-9+]/g, ''), class: 'text-[11px] font-bold tabular-nums', style: { color: 'var(--accent)' } }, c.phone) : null),
                el('td', { class: 'px-2 py-2 whitespace-nowrap' }, _titleCaseWords(c.office)),
                el('td', { class: 'px-2 py-2 text-right font-semibold' }, fmt.usd0(c.arr)),
                el('td', { class: 'px-2 py-2 text-right whitespace-nowrap' }, c.oldest != null ? c.oldest.toFixed(0) + ' mo' : '—'),
                el('td', { class: 'px-3 py-2', style: { color: 'var(--text-muted)' } }, c.why.join(' · ') || '—'));
            }),
            list.length > 300 ? el('tr', {}, el('td', { class: 'px-3 py-3 text-center text-[11px] italic', colspan: 6, style: { color: 'var(--text-subtle)' } }, 'Showing top 300 — export the CSV for all ' + list.length.toLocaleString() + '.')) : null)))));
}

// ═══ NEXT BEST SERVICE — the attach engine. Multi-service customers retain
// 13 pts better; this ranks WHO to pitch WHAT, from what similar customers
// actually bought together. ═══
function reportingNextBest() {
  const gate = reportingDataGate();
  if (gate) return gate;
  const { visible } = reportingFilters();
  const office = state.reportingOffice || 'all';
  const rows = reportingFilterByOffice(visible, office);
  const isActive = (r) => (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;

  // Customer → active family set + meta; family → avg ARV + office prevalence.
  const byCust = new Map();
  const famArv = new Map();   // fam → { sum, n }
  rows.forEach(r => {
    if (!isActive(r) || !r.customer_id) return;
    let c = byCust.get(r.customer_id);
    if (!c) { c = { id: r.customer_id, name: _custDisplayName(r), office: r.office_name || '—', state: r.state || '', zip: String(r.zip_code || '').slice(0, 5), phone: r.phone || '', fams: new Set(), arr: 0 }; byCust.set(r.customer_id, c); }
    if (!c.phone && r.phone) c.phone = r.phone;
    c.arr += Number(r.annual_recurring_value) || 0;
    svcFamiliesOf(r.subscription).forEach(f => {
      c.fams.add(f);
      const fa = famArv.get(f) || { sum: 0, n: 0 }; fa.sum += Number(r.annual_recurring_value) || 0; fa.n++; famArv.set(f, fa);
    });
  });
  const customers = [...byCust.values()];
  // Co-occurrence: P(B | A) across customers; office prevalence of each fam.
  const famCount = new Map(), pair = new Map(), offFam = new Map(), offCount = new Map();
  customers.forEach(c => {
    const fams = [...c.fams];
    fams.forEach(a => {
      famCount.set(a, (famCount.get(a) || 0) + 1);
      fams.forEach(b => { if (a !== b) { const k = a + '→' + b; pair.set(k, (pair.get(k) || 0) + 1); } });
    });
    offCount.set(c.office, (offCount.get(c.office) || 0) + 1);
    fams.forEach(f => { const k = c.office + '|' + f; offFam.set(k, (offFam.get(k) || 0) + 1); });
  });
  const pOf = (a, b) => { const n = famCount.get(a) || 0; return n >= 25 ? (pair.get(a + '→' + b) || 0) / n : 0; };
  const famAvgArv = (f) => { const s = famArv.get(f); return s && s.n ? s.sum / s.n : 0; };
  const allFams = [..._SVC_FAMS.map(x => x[0]), 'Pest'].filter(f => (famCount.get(f) || 0) >= 25);

  // Score every customer's best missing family.
  const opps = [];
  customers.forEach(c => {
    let best = null;
    allFams.forEach(b => {
      if (c.fams.has(b)) return;
      const co = Math.max(...[...c.fams].map(a => pOf(a, b)), 0);
      const local = (offFam.get(c.office + '|' + b) || 0) / Math.max(1, offCount.get(c.office) || 0);
      const conf = 0.7 * co + 0.3 * local;
      if (conf > 0.02 && (!best || conf > best.conf)) best = { fam: b, conf, arv: famAvgArv(b) };
    });
    if (best) opps.push({ ...c, rec: best.fam, conf: best.conf, estArv: best.arv, value: best.conf * best.arv });
  });
  opps.sort((a, b) => b.value - a.value);

  // Attach matrix — the strongest pairs, for strategy (not per-customer).
  const pairs = [];
  allFams.forEach(a => allFams.forEach(b => { if (a !== b) { const p = pOf(a, b); if (p > 0.03) pairs.push({ a, b, p, n: famCount.get(a) || 0 }); } }));
  pairs.sort((x, y) => y.p - x.p);

  const famFilter = state._nbFam || 'all';
  const list = opps.filter(o => famFilter === 'all' || o.rec === famFilter);
  const singles = customers.filter(c => c.fams.size <= 1).length;
  const estIf10 = list.slice(0, Math.ceil(list.length * 0.1)).reduce((a, o) => a + o.estArv, 0);

  const exportBtn = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    title: 'Download the filtered opportunity list (CSV) — hand it to techs / office staff as a pitch sheet',
    onclick: () => _reportingCsvDownload('next-best-service' + (famFilter === 'all' ? '' : '-' + famFilter.toLowerCase().replace(/\s+/g, '-')) + '.csv',
      ['Customer ID', 'Customer', 'Phone', 'Office', 'State', 'ZIP', 'Current ARR', 'Owns', 'Recommended Service', 'Confidence %', 'Est ARV / yr'],
      list.map(o => [o.id, o.name, o.phone, o.office, o.state, o.zip, Math.round(o.arr), [...o.fams].join(' | '), o.rec, (o.conf * 100).toFixed(1), Math.round(o.estArv)])),
  }, '⬇ Export pitch list (' + list.length.toLocaleString() + ')');

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
        el('div', {},
          el('h2', { class: 'text-lg font-bold' }, '🎯 Next Best Service'),
          el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
            'What similar customers actually bought together, turned into a per-customer pitch. Multi-service customers retain 13 pts better — every conversion here is new ARR that also protects the base ARR. ' +
            singles.toLocaleString() + ' single-service customers in scope; a 10% hit rate on the top decile ≈ ' + fmt.usd0(estIf10) + ' new ARR.')),
        exportBtn),
      // Attach matrix — top pairs
      el('div', { class: 'mt-3' },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, 'Strongest attach patterns (P(also owns B | owns A))'),
        el('div', { class: 'flex gap-2 flex-wrap' },
          ...pairs.slice(0, 8).map(pr => el('div', { class: 'rounded-lg px-2.5 py-1.5 text-[11px]', style: { background: 'var(--card-2)' } },
            el('b', {}, pr.a), ' → ', el('b', {}, pr.b),
            el('span', { class: 'tabular-nums', style: { color: 'var(--text-muted)' } }, '  ' + (pr.p * 100).toFixed(1) + '% · ' + fmt.usd0(famAvgArv(pr.b)) + ' avg ARV')))))),
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'p-3 border-b flex items-center gap-2 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Recommend'),
        ...['all'].concat(allFams).map(f => el('button', {
          class: 'px-2.5 py-1 rounded-lg text-[11px] font-semibold transition hover:brightness-95',
          style: famFilter === f ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)' },
          onclick: () => { state._nbFam = f; mountApp(); },
        }, f === 'all' ? 'All' : f))),
      el('div', { class: 'overflow-x-auto', style: { maxHeight: '560px' } },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider sticky top-0', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
            el('tr', {},
              el('th', { class: 'text-left px-3 py-2 font-semibold' }, 'Customer'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Office'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Owns'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Pitch'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Confidence'),
              el('th', { class: 'text-right px-3 py-2 font-semibold' }, 'Est ARV/yr'))),
          el('tbody', {},
            ...list.slice(0, 300).map(o => el('tr', { class: 'border-t tabular-nums', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-3 py-2' },
                el('div', { class: 'font-semibold' }, o.name),
                el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '#' + o.id + ' · ' + fmt.usd0(o.arr) + ' current ARR'),
                o.phone ? el('a', { href: 'tel:' + String(o.phone).replace(/[^0-9+]/g, ''), class: 'text-[11px] font-bold tabular-nums', style: { color: 'var(--accent)' } }, o.phone) : null),
              el('td', { class: 'px-2 py-2 whitespace-nowrap' }, _titleCaseWords(o.office)),
              el('td', { class: 'px-2 py-2', style: { color: 'var(--text-muted)' } }, [...o.fams].join(', ')),
              el('td', { class: 'px-2 py-2 font-bold', style: { color: 'var(--accent)' } }, o.rec),
              el('td', { class: 'px-2 py-2 text-right' }, (o.conf * 100).toFixed(0) + '%'),
              el('td', { class: 'px-3 py-2 text-right font-semibold' }, fmt.usd0(o.estArv)))),
            list.length > 300 ? el('tr', {}, el('td', { class: 'px-3 py-3 text-center text-[11px] italic', colspan: 6, style: { color: 'var(--text-subtle)' } }, 'Showing top 300 by expected value — export the CSV for all ' + list.length.toLocaleString() + '.')) : null)))));
}

function reportingRenewals() {
  const gate = reportingDataGate();
  if (gate) return gate;
  _renewalLogLoad();   // shared disposition log (Supabase; local fallback)
  const { visible } = reportingFilters();
  const office = state.reportingOffice || 'all';
  const rows = reportingFilterByOffice(visible, office);
  const now = new Date();
  const isActive = (r) => (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;
  // ALREADY RENEWED (per Isaac): a customer holding ANY active subscription
  // from one of the four Renewal sources has been renewed — renewed once
  // means DONE, they never appear on a renewal call list again.
  // Eligibility rules (per Isaac, Sep 2026):
  //   1. Renew once — ANY subscription on the account with a Renewal source
  //      (active or not) makes the whole account ineligible.
  //   2. Term end = start date + contract length; eligible inside the final
  //      2 months (and still eligible once past term while month-to-month).
  //   3. Sentricon is never renewed.
  const RENEWAL_SRC_RE = /^renewal\s*-/i;
  const _isSentricon = (r) => /sentricon/i.test(String(r.subscription || ''));
  const renewedCust = new Set();
  rows.forEach(r => {
    if (!r.customer_id) return;
    if (RENEWAL_SRC_RE.test(String(r.subscription_source || ''))) renewedCust.add(r.customer_id);
  });
  const expiring = [], past = [];
  let renewedN = 0, renewedArr = 0;
  rows.forEach(r => {
    if (!isActive(r)) return;
    if (_isSentricon(r)) return;
    const len = Number(r.agreement_length) || 0;
    if (len <= 1) return;
    const d = new Date(String(r.initial_service) + 'T00:00');
    if (isNaN(d)) return;
    const mo = (now - d) / 2629800000;
    const inWindow = mo >= len - 2;
    if (inWindow && renewedCust.has(r.customer_id)) {
      renewedN++; renewedArr += Number(r.annual_recurring_value) || 0;
      return;
    }
    const rec = {
      id: r.customer_id, name: _custDisplayName(r), office: r.office_name || '—', state: r.state || '',
      phone: r.phone || '', email: r.email || '',
      svc: r.subscription, arv: Number(r.annual_recurring_value) || 0, len, mo,
      toGo: len - mo, pastBy: mo - len,
      autopay: (() => { const _ap = String(r.customer_auto_pay || '').trim(); return !!_ap && !/^no$/i.test(_ap); })(),
      pastDue: Number(r.days_past_due) || 0,
    };
    if (mo >= len - 2 && mo < len) expiring.push(rec);
    else if (mo >= len) past.push(rec);
  });
  expiring.sort((a, b) => a.toGo - b.toGo || b.arv - a.arv);
  past.sort((a, b) => b.arv - a.arv);
  const arrOf = (L) => L.reduce((a, x) => a + x.arv, 0);

  // Renewed via the CRM (a Renewal-source sub is active) — surfaced in the
  // Renewed column as read-only cards so the board shows the whole picture.
  const crmRenewed = [];
  const _seenCrm = new Set();
  rows.forEach(r => {
    if (!isActive(r) || !r.customer_id || !renewedCust.has(r.customer_id) || _seenCrm.has(r.customer_id)) return;
    if (!RENEWAL_SRC_RE.test(String(r.subscription_source || ''))) return;
    _seenCrm.add(r.customer_id);
    crmRenewed.push({ id: r.customer_id, name: _custDisplayName(r), office: r.office_name || '—', phone: r.phone || '', svc: r.subscription, arv: Number(r.annual_recurring_value) || 0, len: Number(r.agreement_length) || 0, mo: 0, toGo: 0, pastBy: 0, autopay: true, pastDue: 0, crm: true, since: r.sold_date || '' });
  });
  crmRenewed.sort((a, b) => String(b.since).localeCompare(String(a.since)));

  // ── PIPELINE BOARD (per Isaac, Sep 2026) — four stages, kanban style.
  // Stage lives in renewal_worklog.result (shared, instant). Legacy
  // dispositions map onto the stages so nothing already worked is lost:
  // No Answer / Follow Up → Contacting, Resigned → Renewed.
  const LOG = state._renewalLog || {};
  const logOf = (x) => LOG[String(x.id)] || {};
  const STAGES = [
    { key: 'Eligible',       label: 'Eligible',       emoji: '🟢', color: '#5F6C5B', bg: 'rgba(95,108,91,.10)',  blurb: 'Final 2 months of term (start date + contract length) or past term and still month-to-month · never renewed before · no Sentricon' },
    { key: 'Contacting',     label: 'Contacting',     emoji: '📞', color: '#A9441F', bg: 'rgba(169,68,31,.10)',  blurb: 'Reached out — call attempts and notes live on the card' },
    { key: 'Renewed',        label: 'Renewed',        emoji: '✅', color: 'var(--ok)', bg: 'rgba(22,163,74,.10)',  blurb: 'Re-signed. Cards marked CRM came in through a Renewal source automatically' },
    { key: 'Not Interested', label: 'Not Interested', emoji: '❌', color: '#DC2626', bg: 'rgba(220,38,38,.10)',  blurb: 'Declined — stays here so nobody calls them again' },
  ];
  const stageOf = (x) => {
    const r = String(logOf(x).result || '');
    if (r === 'Contacting' || r === 'No Answer' || r === 'Follow Up') return 'Contacting';
    if (r === 'Renewed' || r === 'Resigned') return 'Renewed';
    if (r === 'Not Interested') return 'Not Interested';
    return 'Eligible';
  };
  const q = String(state._renewalQ || '').trim().toLowerCase();
  const matchQ = (x) => !q || String(x.name).toLowerCase().includes(q) || String(x.id).includes(q) || String(x.phone || '').includes(q) || String(x.office).toLowerCase().includes(q);
  const allRecs = expiring.concat(past);
  const cols = {}; STAGES.forEach(s => cols[s.key] = []);
  allRecs.forEach(x => cols[stageOf(x)].push(x));
  cols.Renewed = cols.Renewed.concat(crmRenewed);
  // Eligible: soonest term end first, then past-term biggest ARV; other
  // stages: most recently touched first.
  const touched = (x) => String(logOf(x).updated_at || '');
  cols.Eligible.sort((a, b) => (a.pastBy >= 0 ? 1 : 0) - (b.pastBy >= 0 ? 1 : 0) || (a.pastBy >= 0 ? b.arv - a.arv : a.toGo - b.toGo));
  ['Contacting', 'Renewed', 'Not Interested'].forEach(k => cols[k].sort((a, b) => touched(b).localeCompare(touched(a))));
  const moveTo = (x, stage) => {
    if (x.crm) return;
    _renewalLogSave(x.id, { result: stage === 'Eligible' ? '' : stage });
    mountApp();
  };
  const dragKey = { cur: null };
  const CARD_LIMIT = 120;

  const card = (x, stage) => {
    const g = logOf(x);
    const open = state._renewalOpenCard === String(x.id);
    const endTxt = x.crm ? ('renewed ' + (x.since ? String(x.since).slice(0, 10) : '')) : x.pastBy >= 0 ? ('+' + x.pastBy.toFixed(1) + ' mo past term') : ('ends in ' + x.toGo.toFixed(1) + ' mo');
    const endColor = x.crm ? 'var(--ok)' : x.pastBy >= 0 ? '#DC2626' : x.toGo < 1 ? '#DC2626' : '#A9441F';
    const stageSel = el('select', {
      class: 'rounded-md border px-1.5 py-0.5 text-[10px] font-bold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      title: 'Move to a stage',
      onclick: (e) => e.stopPropagation(),
      onchange: (e) => moveTo(x, e.target.value),
    }, ...STAGES.map(s => { const o = el('option', { value: s.key }, s.emoji + ' ' + s.label); if (s.key === stage) o.selected = true; return o; }));
    const c = el('div', {
      class: 'rounded-xl border p-2.5 flex flex-col gap-1.5 transition' + (x.crm ? '' : ' cursor-grab'),
      draggable: x.crm ? 'false' : 'true',
      style: { borderColor: 'var(--border)', background: 'var(--card)', opacity: x.crm ? '.85' : '1' },
      ondragstart: (e) => { if (x.crm) { e.preventDefault(); return; } dragKey.cur = x; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(x.id)); } catch { /* ignore */ } c.style.opacity = '.5'; },
      ondragend: () => { c.style.opacity = '1'; dragKey.cur = null; },
      onclick: () => { state._renewalOpenCard = open ? null : String(x.id); mountApp(); },
    },
      el('div', { class: 'flex items-start justify-between gap-2' },
        el('div', { class: 'min-w-0' },
          el('div', { class: 'text-xs font-bold truncate' }, x.name),
          el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-subtle)' } }, '#' + x.id + ' · ' + _titleCaseWords(x.office))),
        x.crm ? el('span', { class: 'text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0', style: { background: 'rgba(22,163,74,.12)', color: 'var(--ok)' } }, 'CRM')
          : (g.attempts ? el('span', { class: 'text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0 tabular-nums', style: { background: 'var(--card-2)', color: 'var(--text-muted)' }, title: 'Call attempts' }, '📞 ' + g.attempts) : null)),
      el('div', { class: 'flex items-center justify-between gap-2 text-[11px]' },
        el('span', { class: 'truncate', style: { color: 'var(--text-muted)' } }, x.svc),
        el('span', { class: 'font-bold tabular-nums shrink-0' }, fmt.usd0(x.arv))),
      el('div', { class: 'flex items-center justify-between gap-2 text-[10px]' },
        el('span', { class: 'font-bold', style: { color: endColor } }, endTxt),
        el('span', { style: { color: 'var(--text-subtle)' } }, (x.autopay ? '' : 'no autopay') + (x.pastDue > 0 ? (x.autopay ? '' : ' · ') + x.pastDue + 'd past due' : ''))),
      open && !x.crm ? el('div', { class: 'flex flex-col gap-1.5 pt-1.5 border-t', style: { borderColor: 'var(--border)' }, onclick: (e) => e.stopPropagation() },
        x.phone ? el('a', { href: 'tel:' + String(x.phone).replace(/[^0-9+]/g, ''), class: 'text-[11px] font-bold tabular-nums', style: { color: 'var(--accent)' } }, '📞 ' + x.phone) : null,
        el('div', { class: 'flex items-center gap-1.5' },
          el('button', { class: 'rounded-md border px-2 py-0.5 text-[10px] font-black cursor-pointer transition hover:brightness-95', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, title: 'Log a call attempt (stamps you + today)',
            onclick: () => { _renewalLogSave(x.id, { attempts: (Number(g.attempts) || 0) + 1, result: stage === 'Eligible' ? 'Contacting' : (g.result || '') }); mountApp(); } }, '+1 attempt'),
          stageSel),
        el('input', { class: 'rounded-lg border px-2 py-1 text-[11px] w-full', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, placeholder: 'notes…', value: g.notes || '',
          onchange: (e) => _renewalLogSave(x.id, { notes: e.target.value }) }),
        g.worked_by ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'last touched by ' + g.worked_by.split(' ')[0] + (g.updated_at ? ' · ' + String(g.updated_at).slice(0, 10) : '')) : null)
        : (open && x.crm ? el('div', { class: 'text-[10px] pt-1.5 border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } }, 'Renewed through a Renewal source in FieldRoutes — nothing to work here.') : null),
      !open && g.notes ? el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-muted)' } }, '✎ ' + g.notes) : null);
    return c;
  };

  const column = (s) => {
    const L = cols[s.key].filter(matchQ);
    const shownN = state['_renewalMore_' + s.key] ? L.length : Math.min(L.length, CARD_LIMIT);
    const body = el('div', { class: 'flex flex-col gap-2 p-2 overflow-y-auto', style: { maxHeight: '68vh', minHeight: '120px' } },
      ...(L.length ? L.slice(0, shownN).map(x => card(x, s.key)) : [el('div', { class: 'text-[11px] text-center py-6', style: { color: 'var(--text-subtle)' } }, 'Nothing here' + (q ? ' for “' + q + '”' : ''))]),
      L.length > shownN ? el('button', { class: 'rounded-lg border px-2 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => { state['_renewalMore_' + s.key] = true; mountApp(); } }, 'Show all ' + L.length.toLocaleString()) : null);
    const col = el('div', { class: 'rounded-2xl border flex flex-col min-w-0', style: { borderColor: 'var(--border)', background: 'var(--card-2)' },
      ondragover: (e) => { if (!dragKey.cur) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.style.outline = '2px solid ' + s.color; },
      ondragleave: () => { col.style.outline = ''; },
      ondrop: (e) => { e.preventDefault(); col.style.outline = ''; if (dragKey.cur) moveTo(dragKey.cur, s.key); },
    },
      el('div', { class: 'px-3 py-2 rounded-t-2xl', style: { background: s.bg }, title: s.blurb },
        el('div', { class: 'flex items-center justify-between gap-2' },
          el('div', { class: 'text-xs font-black truncate' }, s.emoji + ' ' + s.label),
          el('div', { class: 'text-[10px] font-bold tabular-nums shrink-0', style: { color: s.color } }, L.length.toLocaleString())),
        el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, fmt.usd0(arrOf(L)) + ' ARR')),
      body);
    return col;
  };

  const exportAll = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: () => _reportingCsvDownload('renewals-pipeline.csv',
      ['Stage', 'Customer ID', 'Customer Name', 'Phone', 'Office Name', 'Subscription Type', 'ARV', 'Contract', 'Months In', 'Months To Term End', 'Auto Pay', 'Days Past Due', 'Attempts', 'Office Rep', 'Notes', 'Updated'],
      STAGES.flatMap(s => cols[s.key].map(x => { const g = logOf(x); return [s.key, x.id, x.name, x.phone, x.office, x.svc, Math.round(x.arv), x.len, x.mo.toFixed(1), x.crm ? '' : x.toGo.toFixed(1), x.autopay ? 'Yes' : 'No', x.pastDue, g.attempts || 0, g.worked_by || '', g.notes || '', g.updated_at || '']; }))),
  }, '⬇ Export board');
  const search = el('input', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px]', type: 'search', placeholder: 'Search name, #id, phone, office…', value: state._renewalQ || '',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: '220px' },
    oninput: (e) => { state._renewalQ = e.target.value; clearTimeout(state._renewalQT); state._renewalQT = setTimeout(mountApp, 250); },
  });
  const worked = allRecs.filter(x => stageOf(x) !== 'Eligible').length;
  const renewedManual = cols.Renewed.filter(x => !x.crm).length;
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
        el('div', {},
          el('h2', { class: 'text-lg font-bold' }, '🔁 Renewals pipeline'),
          el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
            'Eligible = inside the final 2 months of the contract (start date + contract length) or past term and still month-to-month, never renewed before (any Renewal-source sub on the account rules it out), and not Sentricon. Refreshes from the CRM sync. Drag a card between stages or use the stage picker on it; attempts and notes save instantly for everyone.')),
        el('div', { class: 'flex items-center gap-2 flex-wrap' }, search, exportAll)),
      el('div', { class: 'flex gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } },
        el('span', {}, el('b', {}, allRecs.length.toLocaleString()), ' eligible contracts · ', el('b', {}, fmt.usd0(arrOf(allRecs))), ' ARR in play'),
        el('span', {}, el('b', {}, worked.toLocaleString()), ' worked · ', el('b', { style: { color: 'var(--ok)' } }, renewedManual.toLocaleString()), ' renewed by the team' + (worked ? ' (' + (renewedManual / worked * 100).toFixed(0) + '%)' : '')),
        crmRenewed.length ? el('span', {}, el('b', {}, crmRenewed.length.toLocaleString()), ' renewed via a Renewal source in the CRM · ', el('b', {}, fmt.usd0(arrOf(crmRenewed))), ' ARR') : null)),
    el('div', { class: 'grid gap-3 renewal-board', style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } }, ...STAGES.map(column)));
}

// ── Renewal disposition log — shared across agents. Supabase table
// `renewal_worklog` (see renewal_worklog.sql); localStorage keeps a local
// copy so the tab works offline / pre-migration.
function _renewalLogLoad() {
  if (state._renewalLogLoaded) return;
  state._renewalLogLoaded = true;
  state._renewalLog = state._renewalLog || {};
  try { const ls = localStorage.getItem('ridd_renewal_log_v1'); if (ls) Object.assign(state._renewalLog, JSON.parse(ls)); } catch (e) { /* fresh */ }
  if (typeof DEMO !== 'undefined' && DEMO) return;
  if (!supabase || !state.profile) return;
  supabase.from('renewal_worklog').select('*').then(({ data, error }) => {
    if (error) { console.warn('[renewals] worklog load failed (run renewal_worklog.sql?)', error.message); return; }
    (data || []).forEach(r => { state._renewalLog[String(r.customer_id)] = r; });
    if (state.reportingSubTab === 'waterfall' && state._retenSection === 'renewals') mountApp();
  });
}
function _renewalLogSave(custId, patch) {
  state._renewalLog = state._renewalLog || {};
  const key = String(custId);
  const row = Object.assign({ customer_id: key, attempts: 0, result: '', notes: '' }, state._renewalLog[key] || {}, patch,
    { worked_by: (state.profile && state.profile.full_name) || '', updated_at: new Date().toISOString() });
  state._renewalLog[key] = row;
  try { localStorage.setItem('ridd_renewal_log_v1', JSON.stringify(state._renewalLog)); } catch (e) { /* quota */ }
  if (typeof DEMO !== 'undefined' && DEMO) return;
  if (!supabase || !state.profile) return;
  supabase.from('renewal_worklog').upsert(row, { onConflict: 'customer_id' }).then(({ error }) => {
    if (error) { console.warn('[renewals] worklog save failed (run renewal_worklog.sql?)', error.message); toast('Saved locally — server sync failed (run renewal_worklog.sql)', 'warn'); }
  });
}
function reportingContractLength() {
  const gate = reportingDataGate();
  if (gate) return gate;
  const { visible } = reportingFilters();
  const office = state.reportingOffice || 'all';
  const rows = reportingFilterByOffice(visible, office);
  const now = new Date();
  const TERMS = [12, 18, 24];
  const termOf = (r) => { const m = Number(r.agreement_length) || 0; return TERMS.includes(m) ? m : null; };
  const lifeMo = (r) => {
    const a = new Date(String(r.initial_service) + 'T00:00');
    const b = r.subscription_date_canceled ? new Date(String(r.subscription_date_canceled) + 'T00:00') : now;
    return (isNaN(a) || isNaN(b)) ? null : Math.max(0, (b - a) / 2629800000);
  };
  const ageMo = (r) => {
    const a = new Date(String(r.initial_service) + 'T00:00');
    return isNaN(a) ? null : (now - a) / 2629800000;
  };
  // Per-term rollups
  const T = {};
  TERMS.forEach(t => T[t] = { n: 0, arv: 0, s12n: 0, s12k: 0, finN: 0, finK: 0, cxl: [], reasons: new Map(), cxlN: 0, delinq: 0 });
  rows.forEach(r => {
    const t = termOf(r); if (!t) return;
    const o = T[t];
    o.n++; o.arv += Number(r.annual_recurring_value) || 0;
    const age = ageMo(r), life = lifeMo(r);
    const cxl = !!r.subscription_date_canceled;
    if (age != null && age >= 12) { o.s12n++; if (!cxl || life >= 12) o.s12k++; }
    if (age != null && age >= t + 1) { o.finN++; if (!cxl || life >= t) o.finK++; }
    if (cxl && life != null) {
      o.cxl.push(life); o.cxlN++;
      const reason = reportingCancelReasonOf(r);
      o.reasons.set(reason, (o.reasons.get(reason) || 0) + 1);
      if (/delinquent/i.test(reason)) o.delinq++;
    }
  });
  const med = (arr) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const pctUnder = (arr, m) => arr.length ? arr.filter(v => v < m).length / arr.length : 0;
  const TERM_COLOR = { 12: '#5F6C5B', 18: '#A9441F', 24: '#DF643A' };

  // Reason mix table — top reasons across all three terms.
  const allReasons = new Map();
  TERMS.forEach(t => T[t].reasons.forEach((n, k) => allReasons.set(k, (allReasons.get(k) || 0) + n)));
  const topReasons = [...allReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9);

  // Office × term mix + delinquency share of cancels
  const byOff = new Map();
  rows.forEach(r => {
    const t = termOf(r); if (!t) return;
    const k = r.office_name || '—';
    const o = byOff.get(k) || { n: 0, t: { 12: 0, 18: 0, 24: 0 }, cxl: 0, delinq: 0 };
    o.n++; o.t[t]++;
    if (r.subscription_date_canceled) { o.cxl++; if (/delinquent/i.test(reportingCancelReasonOf(r))) o.delinq++; }
    byOff.set(k, o);
  });
  const offices2 = [...byOff.entries()].map(([k, o]) => ({ k, ...o })).filter(o => o.n >= 100).sort((a, b) => b.n - a.n);

  // Survival by year sold × term
  const byYr = new Map();
  rows.forEach(r => {
    const t = termOf(r); if (!t) return;
    const age = ageMo(r); if (age == null || age < 12) return;
    const y = String(r.initial_service || '').slice(0, 4); if (!/^20\d\d$/.test(y)) return;
    const o = byYr.get(y) || { 12: { n: 0, k: 0 }, 18: { n: 0, k: 0 }, 24: { n: 0, k: 0 } };
    const life = lifeMo(r);
    o[t].n++; if (!r.subscription_date_canceled || life >= 12) o[t].k++;
    byYr.set(y, o);
  });
  const years2 = [...byYr.keys()].sort();

  const card = (kids, cls) => el('div', { class: 'card ' + (cls || 'p-4') }, ...kids);
  const secHdr = (title, sub) => el('div', { class: 'mb-2' },
    el('h3', { class: 'text-sm font-bold' }, title),
    sub && el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } }, sub));
  const pct = (v) => (v * 100).toFixed(1) + '%';

  return el('div', { class: 'flex flex-col gap-4' },
    // Headline cards
    card([
      secHdr('📄 Contract Length — 12 vs 18 vs 24', 'The full term story on one screen. Verdict from the data: 24s are proven (+2 months kept, best 12-mo survival); 18s die of NON-PAYMENT, early, concentrated in the offices with the weakest collections — the term isn\u2019t toxic, how it\u2019s sold is.'),
      el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' } },
        ...TERMS.map(t => {
          const o = T[t];
          return el('div', { class: 'rounded-xl p-3', style: { background: 'var(--card-2)', borderTop: '3px solid ' + TERM_COLOR[t] } },
            el('div', { class: 'flex items-baseline justify-between' },
              el('div', { class: 'text-sm font-black' }, t + '-month'),
              el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-subtle)' } }, o.n.toLocaleString() + ' subs')),
            el('div', { class: 'mt-1.5 text-[11px] tabular-nums flex flex-col gap-0.5' },
              el('div', {}, el('b', {}, o.s12n ? pct(o.s12k / o.s12n) : '—'), el('span', { style: { color: 'var(--text-muted)' } }, ' survive 12 months')),
              el('div', {}, el('b', {}, o.finN ? pct(o.finK / o.finN) : '—'), el('span', { style: { color: 'var(--text-muted)' } }, ' complete the full term')),
              el('div', {}, el('b', {}, o.cxl.length ? med(o.cxl).toFixed(1) + ' mo' : '—'), el('span', { style: { color: 'var(--text-muted)' } }, ' median life when cancelled')),
              el('div', {}, el('b', { style: { color: o.cxlN && o.delinq / o.cxlN > 0.45 ? '#DC2626' : 'inherit' } }, o.cxlN ? pct(o.delinq / o.cxlN) : '—'), el('span', { style: { color: 'var(--text-muted)' } }, ' of cancels = delinquency')),
              el('div', {}, el('b', {}, fmt.usd0(o.n ? o.arv / o.n : 0)), el('span', { style: { color: 'var(--text-muted)' } }, ' avg ARV'))));
        }))]),
    // Reason mix
    card([
      secHdr('Why each term cancels', 'Share of that term\u2019s cancels. The tell: 18s over-index on Delinquent (non-payment) while every VOLUNTARY reason is lower than on 12s — the customer doesn\u2019t quit, the payment does.'),
      el('div', { class: 'overflow-x-auto' },
        el('table', { class: 'w-full text-xs tabular-nums' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } },
            el('tr', {},
              el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Reason'),
              ...TERMS.map(t => el('th', { class: 'text-right px-2 py-1.5 font-semibold', style: { color: TERM_COLOR[t] } }, t + ' mo')))),
          el('tbody', {},
            ...topReasons.map(([k]) => {
              const isDel = /delinquent/i.test(k);
              return el('tr', { class: 'border-t', style: Object.assign({ borderColor: 'var(--border)' }, isDel ? { background: 'rgba(220,38,38,.05)' } : {}) },
                el('td', { class: 'px-2 py-1.5' + (isDel ? ' font-bold' : '') }, k),
                ...TERMS.map(t => {
                  const o = T[t];
                  const share = o.cxlN ? (o.reasons.get(k) || 0) / o.cxlN : 0;
                  const worst = TERMS.every(t2 => t2 === t || (T[t2].cxlN ? (T[t2].reasons.get(k) || 0) / T[t2].cxlN : 0) <= share);
                  return el('td', { class: 'px-2 py-1.5 text-right' + (worst && share > 0.02 ? ' font-bold' : ''), style: worst && isDel ? { color: '#DC2626' } : {} }, pct(share));
                }));
            }))))]),
    // Early-cancel timing
    card([
      secHdr('How early the cancels happen', 'Among cancelled subs of each term — the 18s\u2019 exits cluster in the first half-year, the signature of a term used as a closing crutch rather than a commitment.'),
      el('div', { class: 'flex gap-3 flex-wrap' },
        ...TERMS.map(t => {
          const o = T[t];
          return el('div', { class: 'flex-1 rounded-xl p-3', style: { background: 'var(--card-2)', minWidth: '170px', borderTop: '3px solid ' + TERM_COLOR[t] } },
            el('div', { class: 'text-xs font-black mb-1' }, t + '-month cancels'),
            el('div', { class: 'text-[11px] tabular-nums flex flex-col gap-0.5' },
              el('div', {}, el('b', {}, o.cxl.length ? med(o.cxl).toFixed(1) + ' mo' : '—'), el('span', { style: { color: 'var(--text-muted)' } }, ' median lifetime')),
              el('div', {}, el('b', {}, pct(pctUnder(o.cxl, 4))), el('span', { style: { color: 'var(--text-muted)' } }, ' gone within 4 months')),
              el('div', {}, el('b', {}, pct(pctUnder(o.cxl, 7))), el('span', { style: { color: 'var(--text-muted)' } }, ' gone within 7 months'))));
        }))]),
    // Office term mix
    card([
      secHdr('Who sells which term', 'Term mix per office, with each office\u2019s delinquency share of cancels — the 18-heavy offices are the weak-collections offices, which is most of why the 18 aggregate looks bad.'),
      el('div', { class: 'overflow-x-auto' },
        el('table', { class: 'w-full text-xs tabular-nums' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } },
            el('tr', {},
              el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Office'),
              ...TERMS.map(t => el('th', { class: 'text-right px-2 py-1.5 font-semibold', style: { color: TERM_COLOR[t] } }, t + ' mo')),
              el('th', { class: 'text-right px-2 py-1.5 font-semibold' }, 'Delinq. share of cancels'))),
          el('tbody', {},
            ...offices2.map(o => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-2 py-1.5 font-semibold' }, _titleCaseWords(o.k)),
              ...TERMS.map(t => {
                const share = o.n ? o.t[t] / o.n : 0;
                return el('td', { class: 'px-2 py-1.5 text-right' + (t === 18 && share > 0.35 ? ' font-bold' : '') , style: t === 18 && share > 0.35 ? { color: '#A9441F' } : {} }, pct(share));
              }),
              el('td', { class: 'px-2 py-1.5 text-right font-bold', style: { color: o.cxl && o.delinq / o.cxl > 0.45 ? '#DC2626' : 'var(--text)' } }, o.cxl ? pct(o.delinq / o.cxl) : '—'))))))]),
    // Year × term survival
    card([
      secHdr('12-month survival by year sold', 'Same-year comparison strips out vintage effects: 18 ≈ 12 in every year; 24 beats both.'),
      el('div', { class: 'overflow-x-auto' },
        el('table', { class: 'w-full text-xs tabular-nums' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } },
            el('tr', {},
              el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Year sold'),
              ...TERMS.map(t => el('th', { class: 'text-right px-2 py-1.5 font-semibold', style: { color: TERM_COLOR[t] } }, t + ' mo')))),
          el('tbody', {},
            ...years2.map(y => {
              const o = byYr.get(y);
              const vals = TERMS.map(t => o[t].n >= 30 ? o[t].k / o[t].n : null);
              const best = Math.max(...vals.filter(v => v != null));
              return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
                el('td', { class: 'px-2 py-1.5 font-semibold' }, y),
                ...TERMS.map((t, i) => el('td', {
                  class: 'px-2 py-1.5 text-right' + (vals[i] != null && vals[i] === best ? ' font-bold' : ''),
                  style: vals[i] != null && vals[i] === best ? { color: '#DF643A' } : {},
                  title: o[t].n + ' subs old enough to measure',
                }, vals[i] != null ? pct(vals[i]) : el('span', { style: { color: 'var(--text-subtle)' } }, '—'))));
            }))))]),
    // Playbook
    card([
      secHdr('What to do with this'),
      el('div', { class: 'text-xs flex flex-col gap-1.5', style: { color: 'var(--text-muted)' } },
        el('div', {}, '1. Autopay at signing on every 18 and 24 — the delinquency wedge is the whole story; a term bonus should only pay with a payment method attached.'),
        el('div', {}, '2. Push 24s — best survival every single year, highest ARV, +2 months kept. The comp ladder should make it the best payday.'),
        el('div', {}, '3. Pilot 18s in STRONG offices only — if good closers write autopay-backed 18s and they still track the 12 curve, retire the tier; if they stick, the term was never the problem.'),
        el('div', {}, '4. The 18-heavy offices need the collections fix more than a pricing fix — same playbook as the best office (autopay enforcement, card-on-file, dunning).'))]));
}

