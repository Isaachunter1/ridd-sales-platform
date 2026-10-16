// ┌─ src/76-reporting-view.js ─────────────────────────────────────────────────────
// │ Reporting shell: sub-tabs, methodology bar, error guard, view dispatch.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewReporting() {
  const _adminHere = isAdminRole(state.profile?.role);
  if (!_adminHere && !userCan('view_reporting')) {
    return el('div', { class: 'card p-6 text-center text-sm text-muted-' }, 'Reporting is an admin-only tab.');
  }
  if (!state.reportingSubTab) state.reportingSubTab = 'overview';
  // A non-admin granted Reporting (Settings → Permissions) gets the read-only
  // tabs; Marketing / P&L (spend, QuickBooks) and Configurations / Uploads stay admin.
  if (!_adminHere && (devSampleData() ? ['config', 'uploads'] : ['marketing', 'putis', 'config', 'uploads']).includes(state.reportingSubTab)) state.reportingSubTab = 'overview';

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
    // Attribution is real for a developer (FieldRoutes + GoHighLevel only — no QuickBooks in it), so no sample ribbon there.
    (['marketing', 'putis', 'is'].includes(state.reportingSubTab) && !(state.reportingSubTab === 'marketing' && state._mktSub === 'providers' && state._mktProvView === 'recon')) ? devSampleBanner() : null,
    reportingMethodologyBar(),
    _guarded(() => perfT('reporting:' + state.reportingSubTab + (isMarketing ? ':' + (state._mktSub || '') : ''), () =>
    isMarketing                            ? reportingMarketingPnl() :
    state.reportingSubTab === 'is'         ? reportingMarketingPnl() :
    // Reporting → Configuration retired (settings audit, Sep 30): every
    // setting it held lives in ONE place now — Settings.
    state.reportingSubTab === 'config'     ? el('div', { class: 'card p-6 flex flex-col gap-3 items-start' },
        el('div', { class: 'text-sm font-bold' }, 'Reporting settings moved to Settings'),
        el('div', { class: 'text-xs text-muted-' }, 'Service types, cancel reasons, CRM vocabulary and Indicators are under Settings → Configurations; lead sources, ad accounts, GoHighLevel and marketing targets under Settings → Marketing & lead sources.'),
        el('div', { class: 'flex gap-2 flex-wrap' },
          ...[['config', 'Configurations'], ['marketing', 'Marketing & lead sources'], ['data', 'Connections']].map(([k, l]) => el('button', { class: 'rounded-lg border px-3 text-[12px] font-semibold', style: { borderColor: 'var(--border-2)', minHeight: '40px' }, onclick: () => { state.view = 'admin'; state.adminSection = k; mountApp(); } }, l + ' →')))) :
    state.reportingSubTab === 'uploads'    ? reportingUploadsPanel() :
    state.reportingSubTab === 'putis'      ? reportingPutis() :
    state.reportingSubTab === 'geographic' ? reportingGeographic() :
    state.reportingSubTab === 'waterfall'  ? reportingWaterfall() :
    // 'services' retired as a top tab; 'health'/'nextbest' fold into
    // Retention — legacy persisted values land there too.
    (state.reportingSubTab === 'health' || state.reportingSubTab === 'nextbest' || state.reportingSubTab === 'services') ? reportingWaterfall() :
    state.reportingSubTab === 'auditing'   ? el('div', { class: 'flex flex-col gap-4' }, auditTasksCard(), reportingAuditing()) :
    state.reportingSubTab === 'ops'        ? reportingOpsHub() :
                                              reportingOverview())),
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
    waterfall:  'Population: recurring service types only (per the Lifecycle config), serviced subs only (retention starts at first service), after Hidden-service and excluded-source filters, office rules, and the Retention-population rules from Configurations (renewal subs, $0 payers, and frozen-\u22641-service subs are excluded by default \u2014 the workbook\u2019s manual Steps 4\u20136). Each cell = subs of that row still active at that year\u2019s end: started on/before Dec 31 and not cancelled by then. Cancels with a reason excluded from attrition count as RETAINED, and the 3-day-ROR setting matches the Overview tab. Subscription/ARR rows are initial-service-year cohorts (all-time; the time range doesn\u2019t apply). Contract Length / Rep default to BOOK SIZE per year-end — new sales enter columns as they start — and the Cohort picker locks those rows to one start-year and follows it, a true retention curve. Rep mode shows the top 15 reps by sub count, attributed by Sold By. Colors grade each cell against the cohort size (cohort views) or the row\u2019s best year (book-size view). Each cell shows the count plus its share of the cohort still active, and hovering shows the step attrition vs the prior year (1 \u2212 survivors \u00f7 prior-year survivors). Contract Length groups to 12/18/24 months plus Other (odd or legacy lengths pending CRM cleanup); the Blended Attrition table compares each year\u2019s beginning-of-year book (existing cohorts only) to those SAME subs at year-end \u2014 new sales during the year never enter, and ARR mode measures it in dollars.',
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
  const counted = (r) => r.subscription_date_canceled && reportingCancelCountsByReason(r);

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
    // (Renewal window + high-churn service retired per Isaac, Sep 23 — renewals have their own tab.)
    if (riskyZip(c.zip))      { score += 10; why.push('high-churn ZIP'); flags.zip = true; }
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
    // Worst → least: red, rust, orange. Healthy is not a call list (per Isaac, Sep 23).
    ['critical', 'Critical', '#DC2626'], ['atrisk', 'At Risk', '#A9441F'], ['watch', 'Watch', '#DF643A'],
  ];
  const bucketAgg = {};
  BUCKETS.forEach(([k]) => bucketAgg[k] = { n: 0, arr: 0 });
  scored.forEach(c => { if (bucketAgg[c.bucket]) { bucketAgg[c.bucket].n++; bucketAgg[c.bucket].arr += c.arr; } });
  const sel = BUCKETS.some(([k]) => k === state._healthBucket) ? state._healthBucket : 'critical';
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
            'Every active customer, scored on the churn drivers measured in OUR book — past due balance, no autopay, single service, danger-zone tenure (months 3–14), high-churn ZIP. Call the top of this list before they cancel.')),
        exportBtn),
      el('div', { class: 'grid gap-3 mt-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
        ...BUCKETS.map(([k, label, color]) => el('button', {
          class: 'rounded-xl p-3 text-left transition hover:brightness-95 cursor-pointer',
          style: { background: 'var(--card-2)', border: sel === k ? '2px solid ' + color : '2px solid transparent' },
          onclick: () => { state._healthBucket = k; mountApp(); },
        },
          el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color } }, label),
          el('div', { class: 'text-xl font-black tabular-nums' }, bucketAgg[k].n.toLocaleString()))))),
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'p-3 border-b flex flex-col gap-2', style: { borderColor: 'var(--border)' } },
        // Factor breakouts (per Isaac) — one chip per risk driver; the APay
        // chip surfaces the golden "pays on time, just flip autopay on" list.
        (() => {
          const F = [
            ['all', 'All factors'], ['pastdue', '💸 Past due'], ['apay', '💳 No autopay'],
            ['single', '1️⃣ Single service'], ['danger', '⏳ Danger zone'], ['zip', '📍 High-churn ZIP'],
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

// Renewals sold under a non-Renewal source (per Isaac, Oct 13): a plan closed with a Renewal cancel reason and a new
// plan sold on the account 45 days before → 60 days after the close. They count as renewed (off the call queue) and
// are listed on Auditing so the source gets fixed in FieldRoutes. `skip` = customers already renewed by source/chain.
function renewalMisSourcedRows(rows, skip) {
  const out = [], DAY = 86400000, tt = (d) => { const x = new Date(String(d || '').slice(0, 10) + 'T00:00'); return isNaN(x) ? NaN : x.getTime(); };
  const RSRC = /^renewal\s*-/i;
  const subsOf = new Map(), srcRenewed = new Set();
  (rows || []).forEach(r => { if (!r.customer_id) return; (subsOf.get(r.customer_id) || subsOf.set(r.customer_id, []).get(r.customer_id)).push(r);
    if (RSRC.test(String(r.subscription_source || '')) || r.renewed_into || r.is_renewal_cont) srcRenewed.add(r.customer_id); });
  subsOf.forEach((subs, cid) => {
    if ((skip && skip.has(cid)) || srcRenewed.has(cid)) return;
    for (const o of subs) {
      if (!o.subscription_date_canceled || !/^renewal/i.test(String(reportingCancelReasonOf(o) || '').trim())) continue;
      const oc = tt(o.subscription_date_canceled); if (isNaN(oc)) continue;
      const n = subs.find(x => x !== o && !isNaN(tt(x.sold_date)) && tt(x.sold_date) - oc >= -45 * DAY && tt(x.sold_date) - oc <= 60 * DAY);
      if (!n) continue;
      out.push({ ...n, id: cid, name: _custDisplayName(n), office: n.office_name || '—', closed: String(o.subscription_date_canceled).slice(0, 10), sold: String(n.sold_date).slice(0, 10), source: n.subscription_source || '(none)', svc: n.subscription || '',
        _flagReason: 'Customer #' + cid + ' · old plan closed as Renewal ' + String(o.subscription_date_canceled).slice(0, 10) + ' · new plan sold ' + String(n.sold_date).slice(0, 10) + ' as “' + (n.subscription_source || 'no source') + '” — set it to the right Renewal source' });
      break;
    }
  });
  return out;
}
function reportingRenewals(srcRows, opts) {
  opts = opts || {};
  let rows;
  if (srcRows) rows = srcRows;   // Renewals tab: rows from the renewal_pipeline view (live CRM mirror)
  else {
    const gate = reportingDataGate();
    if (gate) return gate;
    const { visible } = reportingFilters();
    const office = state.reportingOffice || 'all';
    rows = reportingFilterByOffice(visible, office);
  }
  _renewalLogLoad();   // shared disposition log (Supabase realtime; local fallback)
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
    else if (r.renewed_into || r.is_renewal_cont) renewedCust.add(r.customer_id);
  });
  // A plan closed with a Renewal cancel reason but no Renewal-source plan on
  // the account (21 customers, Oct 13). Per Isaac, two cases:
  //   · the new plan was sold right at the close (45 days before → 60 after,
  //     same window as linkRenewalChains) → a renewal sold under the wrong
  //     source: counts as renewed, and is listed so the source gets fixed;
  //   · the customer signed back up later → a fresh contract, still eligible.
  const misSourced = renewalMisSourcedRows(rows, renewedCust);   // also listed on Auditing (per Isaac, Oct 13)
  misSourced.forEach(m => renewedCust.add(m.id));
  // Per Isaac (Sep 23): any recurring plan that can go back under contract —
  // everything except Sentricon and one-time services. Term runs from the
  // SIGNED AGREEMENT date (fallback: initial service when no e-sign stamp).
  // Customer life (per Isaac, Oct 12): the churn spike sits at months 11–12
  // of a customer's life, so the call queue keys off the customer's FIRST
  // service across every subscription, not just this plan's term.
  const firstStart = {};
  rows.forEach(r => {
    const st = String(r.origin_initial_service || r.initial_service || '').slice(0, 10);
    if (!r.customer_id || !/^\d{4}-\d{2}-\d{2}$/.test(st)) return;
    if (!firstStart[r.customer_id] || st < firstStart[r.customer_id]) firstStart[r.customer_id] = st;
  });
  const expiring = [], past = [];
  let renewedN = 0, renewedArr = 0;
  rows.forEach(r => {
    if (!isActive(r)) return;
    if (_isSentricon(r)) return;
    // No recurring revenue = nothing to renew (per Isaac, Oct 13).
    if (!((Number(r.annual_recurring_value) || 0) > 0)) return;
    if (/one[\s-]?time/i.test(String(r.subscription || ''))) return;
    const len = Number(r.agreement_length) || 0;
    // No contract length on file (per Isaac, Oct 13): left off the call queue — they're an Auditing task
    // ("Active plan with no contract length") to fix in FieldRoutes.
    const noContract = false;
    if (len <= 1) return;
    const d = new Date(String(r.contract_signed_at || r.initial_service) + 'T00:00');
    if (isNaN(d)) return;
    const mo = (now - d) / 2629800000;
    const inWindow = noContract || mo >= len - 2;
    if (inWindow && renewedCust.has(r.customer_id)) {
      renewedN++; renewedArr += Number(r.annual_recurring_value) || 0;
      return;
    }
    const rec = {
      id: r.customer_id, name: _custDisplayName(r), office: r.office_name || '—', state: r.state || '',
      phone: r.phone || '', email: r.email || '',
      svc: r.subscription, arv: Number(r.annual_recurring_value) || 0, len, mo,
      toGo: len - mo, pastBy: mo - len, noContract,
      // Last month of the term (per Isaac, Sep 23 — shown instead of "ends in
      // X mo"): an 18-month agreement first serviced Mar ’25 bills through
      // Aug ’26, i.e. start + (length − 1) months.
      endMonth: (() => { const e = new Date(d.getFullYear(), d.getMonth() + len - 1, 1); return e.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', ' \u2019'); })(),
      autopay: (() => { const _ap = String(r.customer_auto_pay || '').trim(); return !!_ap && !/^no$/i.test(_ap); })(),
      pastDue: Number(r.days_past_due) || 0,
      unsigned: String(r.contract_state || 'none') !== 'signed',
      life: (() => { const fs = firstStart[r.customer_id]; const f = fs ? new Date(fs + 'T00:00') : d; return Math.max(mo, (now - f) / 2629800000); })(),   // term start fell back to the initial service — verify the document
    };
    if (noContract) past.push(rec);
    else if (mo >= len - 2 && mo < len) expiring.push(rec);
    else if (mo >= len) past.push(rec);
  });
  // One call per CUSTOMER (per Isaac, Oct 13 — subscriptions strung together
  // at the customer level): a customer with two contract plans in play shows
  // once, keyed to the plan whose term ends soonest, with the plans' ARR summed.
  const _oneCust = (L) => {
    const by = new Map();
    L.forEach(x => {
      const k = String(x.id); const cur = by.get(k);
      if (!cur) { by.set(k, Object.assign({}, x, { plans: 1 })); return; }
      const keep = x.toGo < cur.toGo ? Object.assign({}, x) : cur;
      keep.arv = cur.arv + x.arv; keep.plans = cur.plans + 1;
      if (keep.svc.indexOf(' + ') < 0 || keep.plans > 1) keep.svc = [...new Set(String(cur.svc).split(' + ').concat([x.svc]))].join(' + ');
      by.set(k, keep);
    });
    return [...by.values()];
  };
  { const merged = _oneCust(expiring.concat(past)); expiring.length = 0; past.length = 0;
    merged.forEach(x => (x.pastBy < 0 ? expiring : past).push(x)); }
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
    { key: 'Eligible',       label: 'Eligible',       emoji: '🟢', color: '#5F6C5B', bg: 'rgba(95,108,91,.10)',  blurb: 'Final 2 months of the agreement (signed date + contract length), or past term and month-to-month · any recurring plan · never renewed before · no Sentricon, no one-time' },
    { key: 'Contacting',     label: 'Contacting',     emoji: '📞', color: '#A9441F', bg: 'rgba(169,68,31,.10)',  blurb: 'Reached out — call attempts and notes live on the card' },
    { key: 'Renewed',        label: 'Renewed',        emoji: '✅', color: 'var(--ok)', bg: 'rgba(22,163,74,.10)',  blurb: 'Re-signed. Cards marked CRM came in through a Renewal source automatically' },
    { key: 'Not Interested', label: 'Not Interested', emoji: '❌', color: '#DC2626', bg: 'rgba(220,38,38,.10)',  blurb: 'Declined — stays here so nobody calls them again' },
  ];
  const stageOf = (x) => {
    const r = String(logOf(x).result || '');
    if (r === 'Contacting' || r === 'No Answer' || r === 'Follow Up' || /^Callback/.test(r)) return 'Contacting';
    if (r === 'Renewed' || r === 'Resigned') return 'Renewed';
    if (r === 'Not Interested') return 'Not Interested';
    return 'Eligible';
  };
  const q = String(state._renewalQ || '').trim().toLowerCase();
  const fBranch = String(state._renewalBranch || ''), fMinAcv = Number(state._renewalMinAcv) || 0, fSort = String(state._renewalSort || 'soonest');
  // Window (default per Isaac): the accounts ENDING within 2 months — reach
  // them before the cancellation call. Past-term (month-to-month) and All are a click away.
  const fWin = String(state._renewalWindow || 'ending');
  const inWin = (x) => x.crm || fWin === 'all' || (fWin === 'ending' ? x.pastBy < 0 : x.pastBy >= 0);
  const matchQ = (x) => (!q || String(x.name).toLowerCase().includes(q) || String(x.id).includes(q) || String(x.phone || '').includes(q) || String(x.office).toLowerCase().includes(q))
    && (!fBranch || String(x.office) === fBranch) && (!(fMinAcv > 0) || x.arv >= fMinAcv) && inWin(x);
  const allRecs = expiring.concat(past);
  const cols = {}; STAGES.forEach(s => cols[s.key] = []);
  allRecs.forEach(x => cols[stageOf(x)].push(x));
  cols.Renewed = cols.Renewed.concat(crmRenewed);
  // Eligible: soonest term end first, then past-term biggest ARV; other
  // stages: most recently touched first.
  const touched = (x) => String(logOf(x).updated_at || '');
  // Sort (per Isaac): soonest term end · most recently out of contract ·
  // longest out of contract · highest ACV.
  const SORTS = {
    soonest: (a, b) => (a.pastBy >= 0 ? 1 : 0) - (b.pastBy >= 0 ? 1 : 0) || (a.pastBy >= 0 ? b.arv - a.arv : a.toGo - b.toGo),
    newest_out: (a, b) => a.pastBy - b.pastBy,       // just went out of contract first (still-in-term first)
    oldest_out: (a, b) => b.pastBy - a.pastBy,       // longest out of contract first
    acv: (a, b) => b.arv - a.arv,
  };
  cols.Eligible.sort(SORTS[fSort] || SORTS.soonest);
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
    const endTxt = x.crm ? ('renewed ' + (x.since ? String(x.since).slice(0, 10) : '')) : x.pastBy >= 0 ? ('term ended ' + x.endMonth + ' · ' + x.pastBy.toFixed(1) + ' mo ago') : ('term ends ' + x.endMonth);
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
        el('span', { style: { color: 'var(--text-subtle)' } }, (x.unsigned ? '⚠ no signed agreement' : '') + (x.autopay ? '' : (x.unsigned ? ' · ' : '') + 'no autopay') + (x.pastDue > 0 ? ((x.autopay && !x.unsigned) ? '' : ' · ') + x.pastDue + 'd past due' : ''))),
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
  const branches = [...new Set(allRecs.map(x => String(x.office || '')).filter(Boolean))].sort();
  const selCls = 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer';
  const selSty = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const winSel = el('select', { class: selCls, style: selSty, title: 'Which eligible accounts to show', onchange: (e) => { state._renewalWindow = e.target.value; mountApp(); } },
    ...[['ending', 'Ending within 2 months'], ['past', 'Past term (month-to-month)'], ['all', 'All eligible']].map(([v, l]) => el('option', { value: v, selected: fWin === v }, l)));
  const branchSel = el('select', { class: selCls, style: selSty, onchange: (e) => { state._renewalBranch = e.target.value; mountApp(); } },
    el('option', { value: '', selected: !fBranch }, 'All offices'), ...branches.map(b => el('option', { value: b, selected: fBranch === b }, _titleCaseWords(b))));
  const acvIn = el('input', { type: 'text', inputmode: 'numeric', placeholder: 'Min ACV $', value: fMinAcv > 0 ? String(fMinAcv) : '', class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: Object.assign({ width: '90px' }, selSty),
    onchange: (e) => { state._renewalMinAcv = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; mountApp(); } });
  const sortSel = el('select', { class: selCls, style: selSty, title: 'Order of the Eligible column', onchange: (e) => { state._renewalSort = e.target.value; mountApp(); } },
    ...[['soonest', 'Soonest term end'], ['newest_out', 'Most recently out of contract'], ['oldest_out', 'Longest out of contract'], ['acv', 'Highest ACV']].map(([v, l]) => el('option', { value: v, selected: fSort === v }, l)));
  if (!state._renewalBoard) return _renewalQueueView({ allRecs, crmRenewed, misSourced, logOf, stageOf, search, branchSel, acvIn, q, fBranch, fMinAcv, compact: !!opts.compact, exportBoard: exportAll });
  if (opts.compact) {
    return el('div', { class: 'flex flex-col gap-3' },
      el('div', { class: 'flex items-center gap-2 flex-wrap' }, _renewalModeBtn(), search, winSel, branchSel, acvIn, sortSel,
        el('span', { class: 'text-[11px] tabular-nums ml-auto', style: { color: 'var(--text-muted)' } }, cols.Eligible.filter(matchQ).length.toLocaleString() + ' eligible · ' + fmt.usd0(arrOf(cols.Eligible.filter(matchQ))) + ' ARR'),
        exportAll),
      el('div', { class: 'grid gap-3 renewal-board', style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } }, ...STAGES.map(column)));
  }
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
        el('div', {},
          el('h2', { class: 'text-lg font-bold' }, '🔁 Renewals pipeline'),
          el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
            'Eligible = inside the final 2 months of the contract (start date + contract length) or past term and still month-to-month, never renewed before (any Renewal-source sub on the account rules it out), and not Sentricon. Refreshes from the CRM sync. Drag a card between stages or use the stage picker on it; attempts and notes save instantly for everyone.')),
        el('div', { class: 'flex items-center gap-2 flex-wrap' }, _renewalModeBtn(), search, winSel, branchSel, acvIn, sortSel, exportAll)),
      el('div', { class: 'flex gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } },
        el('span', {}, el('b', {}, allRecs.length.toLocaleString()), ' eligible contracts · ', el('b', {}, fmt.usd0(arrOf(allRecs))), ' ARR in play'),
        el('span', {}, el('b', {}, worked.toLocaleString()), ' worked · ', el('b', { style: { color: 'var(--ok)' } }, renewedManual.toLocaleString()), ' renewed by the team' + (worked ? ' (' + (renewedManual / worked * 100).toFixed(0) + '%)' : '')),
        crmRenewed.length ? el('span', {}, el('b', {}, crmRenewed.length.toLocaleString()), ' renewed via a Renewal source in the CRM · ', el('b', {}, fmt.usd0(arrOf(crmRenewed))), ' ARR') : null)),
    el('div', { class: 'grid gap-3 renewal-board', style: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } }, ...STAGES.map(column)));
}

// ── RENEWAL CALL QUEUE (per Isaac, Oct 12) ─────────────────────────────
// Reps get one ordered list of who to call next instead of a stage board.
// The churn report shows the biggest loss at months 11–12 of customer life
// (the first contract ending), and renewals can be signed 2 months before
// the term ends — so first-contract accounts inside that window go first,
// then other contracts ending, then the newly month-to-month, and long
// month-to-month customers (who mostly stay anyway) last.
// Outcomes save to renewal_worklog.result: '' (to call) · Contacting (no
// answer, attempts++) · 'Callback YYYY-MM-DD' · Renewed · Not Interested.
// The board is still one click away for managers.
const RENEWAL_TIERS = [
  { key: 0, label: 'Callback due',             short: 'Callback',    color: '#7C3AED', bg: 'rgba(124,58,237,.10)', blurb: 'Promised a callback for today or earlier' },
  { key: 1, label: 'First contract ending',    short: 'Month 11–12', color: '#DC2626', bg: 'rgba(220,38,38,.10)',  blurb: 'Final 2 months of the first agreement — the churn spike at months 11–12 of customer life' },
  { key: 2, label: 'Contract ending',          short: 'Ending',      color: '#A9441F', bg: 'rgba(169,68,31,.10)',  blurb: 'Final 2 months of a longer or later agreement' },
  { key: 3, label: 'Just out of contract',     short: 'Just M2M',    color: '#B45309', bg: 'rgba(180,83,9,.10)',   blurb: 'Term ended in the last 3 months — now month-to-month' },
  { key: 4, label: 'Long-term month-to-month', short: 'Long M2M',    color: '#5F6C5B', bg: 'rgba(95,108,91,.10)',  blurb: 'Out of contract 3+ months — usually loyal; call once the list above is clear' },
];
const RENEWAL_FIRST_LIFE_MAX = 14;   // months of customer life that still count as the first contract
function _renewalYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _renewalToday() { return _renewalYmd(new Date()); }
function _renewalLocalDay(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? String(iso).slice(0, 10) : _renewalYmd(d); }
function _renewalCallback(g) { const m = /^Callback\s+(\d{4}-\d{2}-\d{2})/.exec(String((g && g.result) || '')); return m ? m[1] : ''; }
function _renewalTierOf(x, g, today) {
  const cb = _renewalCallback(g);
  if (cb && cb <= today) return 0;
  if (x.noContract) return 4;
  if (x.pastBy < 0) return x.life <= RENEWAL_FIRST_LIFE_MAX ? 1 : 2;
  return x.pastBy < 3 ? 3 : 4;
}
function _renewalModeBtn() {
  const board = !!state._renewalBoard;
  return el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    title: board ? 'Back to the call queue' : 'Stage board (manager view)',
    onclick: () => { state._renewalBoard = !board; mountApp(); } }, board ? '☰ Call queue' : '▦ Board view');
}
// Presence: which customer each open renewal queue has up (per Isaac, Oct 13 — several reps calling at once). Lives
// only while the tab is open; closing it or leaving the queue releases the customer.
function _renewalClaimTrack(cid) {
  if ((typeof DEMO !== 'undefined' && DEMO) || !supabase || !state.profile) return;
  const me = String(state.profile.id), name = String(state.profile.full_name || 'Another rep').split(' ')[0];
  if (!state._renewalClaimCh) {
    try {
      const ch = supabase.channel('renewal_claims', { config: { presence: { key: me } } });
      ch.on('presence', { event: 'sync' }, () => {
        const m = {}; const ps = ch.presenceState() || {};
        for (const [k, arr] of Object.entries(ps)) { if (k === me) continue; (arr || []).forEach(p => { if (p && p.cid) m[String(p.cid)] = p.name || 'Another rep'; }); }
        const changed = JSON.stringify(m) !== JSON.stringify(state._renewalClaims || {});
        state._renewalClaims = m;
        if (changed && state.view === 'loyalty_renewals') { clearTimeout(state._renewalClaimT); state._renewalClaimT = setTimeout(mountApp, 200); }
      });
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') { state._renewalClaimReady = true; state._renewalClaimSent = undefined; _renewalClaimTrack(state._renewalClaimWant == null ? null : state._renewalClaimWant); } });
      state._renewalClaimCh = ch;
    } catch (e) { return; }
  }
  state._renewalClaimWant = cid;
  if (!state._renewalClaimReady || state._renewalClaimSent === cid) return;
  state._renewalClaimSent = cid;
  try { state._renewalClaimCh.track({ cid: cid || null, name }); } catch (e) { /* presence is best effort */ }
}
function _renewalQueueView(o) {
  const today = _renewalToday();
  const me = (state.profile && state.profile.full_name) || '';
  const tab = String(state._renewalQTab || 'queue');
  const fTier = state._renewalTier == null ? '' : String(state._renewalTier);
  const base = (x) => (!o.q || String(x.name).toLowerCase().includes(o.q) || String(x.id).includes(o.q) || String(x.phone || '').includes(o.q) || String(x.office).toLowerCase().includes(o.q))
    && (!o.fBranch || String(x.office) === o.fBranch);
  const queue = [], snoozed = [], done = [];
  o.allRecs.forEach(x => {
    const g = o.logOf(x), st = o.stageOf(x);
    if (st === 'Renewed' || st === 'Not Interested') { done.push(x); return; }
    const cb = _renewalCallback(g);
    if (cb && cb > today) { snoozed.push(x); return; }
    x._tier = _renewalTierOf(x, g, today);
    x._triedToday = (Number(g.attempts) || 0) > 0 && _renewalLocalDay(g.updated_at) === today && !cb;
    queue.push(x);
  });
  // Order (per Isaac, Oct 13): newest customers first — fewest months of customer life — so the month 11–12
  // first-contract accounts lead and long-tenured month-to-month customers fall to the end. A callback that is due
  // today stays on top (it was promised); anyone already tried today sinks to the bottom.
  queue.sort((a, b) => (a._triedToday ? 1 : 0) - (b._triedToday ? 1 : 0) || (a._tier === 0 ? 0 : 1) - (b._tier === 0 ? 0 : 1)
    || a.life - b.life || b.arv - a.arv);
  const qAll = queue.filter(base);
  const tierN = {}; RENEWAL_TIERS.forEach(t => { tierN[t.key] = { n: 0, arr: 0 }; });
  qAll.forEach(x => { tierN[x._tier].n++; tierN[x._tier].arr += x.arv; });
  const qShown = qAll;
  snoozed.sort((a, b) => _renewalCallback(o.logOf(a)).localeCompare(_renewalCallback(o.logOf(b))));
  const doneAll = done.concat(o.crmRenewed);
  doneAll.sort((a, b) => String(o.logOf(b).updated_at || b.since || '').localeCompare(String(o.logOf(a).updated_at || a.since || '')));
  // Today's scoreboard — every worklog row touched today.
  const LOG = state._renewalLog || {};
  let tCalls = 0, tRenewed = 0, mCalls = 0, mRenewed = 0;
  Object.values(LOG).forEach(g => {
    if (!g || _renewalLocalDay(g.updated_at) !== today) return;
    const ren = g.result === 'Renewed' || g.result === 'Resigned';
    tCalls++; if (ren) tRenewed++;
    if (me && g.worked_by === me) { mCalls++; if (ren) mRenewed++; }
  });

  const save = (x, patch, msg) => { _renewalLogSave(x.id, patch); if (msg) toast(msg, 'success'); state._renewalCbOpen = null; mountApp(); };
  const btn = (label, title, onclick, sty) => el('button', { class: 'rounded-lg border px-2 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95 whitespace-nowrap', title,
    style: Object.assign({ borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, sty || {}), onclick: (e) => { e.stopPropagation(); onclick(); } }, label);
  // One Disposition button (per Isaac, Oct 13): click it, pick the outcome, save. What each outcome does:
  //   No answer      → +1 attempt; drops to the bottom of the queue for today, back in its normal spot tomorrow.
  //   Callback       → +1 attempt + a date; leaves the queue (Callbacks tab) and returns at the top on that day.
  //   Renewed        → +1 attempt; off the queue for everyone, listed under Done (Undo puts it back).
  //   Not interested → +1 attempt; off the queue for everyone, listed under Done (Undo puts it back).
  // Every save stamps the rep and the time, and syncs to everyone's screen within a second.
  const DISPOS = [
    { k: 'noanswer', label: '📵 No answer', tip: 'Back tomorrow — drops to the bottom of today’s list' },
    { k: 'callback', label: '📅 Callback', tip: 'Pick a day — off the list until then, then back on top' },
    { k: 'renewed', label: '✅ Renewed', tip: 'Signed a new agreement — off the list for everyone' },
    { k: 'notint', label: '❌ Not interested', tip: 'Declined — off the list for everyone' },
  ];
  const actions = (x, big) => {
    const g = o.logOf(x);
    const att = Number(g.attempts) || 0;
    const open = state._renewalDispOpen === String(x.id);
    const pick = open ? (state._renewalDispPick || '') : '';
    const sz = big ? { fontSize: '12px', padding: '6px 14px' } : {};
    if (!open) return el('div', { class: 'flex items-center gap-1.5 flex-wrap' },
      btn('📝 Disposition', 'Log how the call went', () => { state._renewalDispOpen = String(x.id); state._renewalDispPick = ''; state._renewalDispDate = ''; mountApp(); },
        Object.assign({ background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }, sz)));
    const cbDate = state._renewalDispDate || '';
    const canSave = pick && (pick !== 'callback' || cbDate);
    const doSave = () => {
      if (!canSave) return;
      const patch = pick === 'noanswer' ? { attempts: att + 1, result: 'Contacting' }
        : pick === 'callback' ? { attempts: att + 1, result: 'Callback ' + cbDate }
        : pick === 'renewed' ? { attempts: att + 1, result: 'Renewed' } : { attempts: att + 1, result: 'Not Interested' };
      const msg = pick === 'callback' ? 'Callback set for ' + cbDate : pick === 'renewed' ? x.name + ' renewed 🎉' : pick === 'noanswer' ? 'No answer logged — back tomorrow' : 'Marked not interested';
      state._renewalDispOpen = null; state._renewalDispPick = ''; state._renewalDispDate = '';
      save(x, patch, msg);
    };
    const opt = (d) => el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer transition', title: d.tip,
      style: pick === d.k ? { borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--accent-text)' } : { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onclick: (e) => { e.stopPropagation(); state._renewalDispPick = d.k; mountApp(); } }, d.label);
    const tip = pick ? (DISPOS.find(d => d.k === pick) || {}).tip : 'Pick how the call went';
    return el('div', { class: 'flex flex-col gap-1.5 rounded-xl border p-2', style: { borderColor: 'var(--border-2)', background: 'var(--card)' }, onclick: (e) => e.stopPropagation() },
      el('div', { class: 'flex items-center gap-1.5 flex-wrap' }, ...DISPOS.map(opt),
        pick === 'callback' ? el('input', { type: 'date', min: today, value: cbDate, class: 'rounded-lg border px-1.5 py-0.5 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onchange: (e) => { state._renewalDispDate = e.target.value; mountApp(); } }) : null),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('span', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, tip),
        el('span', { class: 'ml-auto inline-flex gap-1.5' },
          btn('Cancel', '', () => { state._renewalDispOpen = null; mountApp(); }),
          el('button', { class: 'rounded-lg px-3 py-1 text-[11px] font-black', disabled: !canSave, title: canSave ? 'Save the disposition' : (pick === 'callback' ? 'Pick the callback day' : 'Pick an outcome first'),
            style: { background: canSave ? 'var(--ok)' : 'var(--card-2)', color: canSave ? '#fff' : 'var(--text-subtle)', cursor: canSave ? 'pointer' : 'not-allowed' },
            onclick: (e) => { e.stopPropagation(); doSave(); } }, 'Save'))));
  };

  const tierChip = (t) => el('span', { class: 'text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0', style: { background: t.bg, color: t.color }, title: t.blurb }, t.short);
  const why = (x) => {
    const lifeTxt = 'month ' + Math.floor(x.life + 1) + ' of life';
    if (x._tier === 0) return 'callback due ' + _renewalCallback(o.logOf(x)) + ' · ' + (x.pastBy < 0 && !x.noContract ? 'term ends ' + x.endMonth : 'month-to-month');
    if (x.noContract) return 'no contract on file · month-to-month · ' + lifeTxt;
    if (x.pastBy < 0) return 'term ends ' + x.endMonth + ' · ' + lifeTxt + ' · ' + x.len + '-mo agreement';
    return 'term ended ' + x.endMonth + ' · month-to-month ' + x.pastBy.toFixed(1) + ' mo · ' + lifeTxt;
  };
  const flags = (x) => [x.unsigned ? '⚠ no signed agreement' : '', x.autopay ? '' : 'no autopay', x.pastDue > 0 ? x.pastDue + 'd past due' : ''].filter(Boolean).join(' · ');
  const phoneA = (x, big) => x.phone ? el('a', { href: 'tel:' + String(x.phone).replace(/[^0-9+]/g, ''), class: (big ? 'text-base' : 'text-[12px]') + ' font-black tabular-nums whitespace-nowrap', style: { color: 'var(--accent)' }, onclick: (e) => e.stopPropagation() }, '📞 ' + x.phone)
    : el('span', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, 'no phone on file');
  const notesIn = (x) => { const g = o.logOf(x); return el('input', { class: 'rounded-lg border px-2 py-1 text-[11px] w-full', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, placeholder: 'notes for the next rep…', value: g.notes || '', onclick: (e) => e.stopPropagation(), onchange: (e) => _renewalLogSave(x.id, { notes: e.target.value }) }); };
  const lastTouch = (x) => { const g = o.logOf(x); const n = Number(g.attempts) || 0; return n ? ('📞 ' + n + ' attempt' + (n > 1 ? 's' : '') + (g.worked_by ? ' · last ' + g.worked_by.split(' ')[0] : '') + (g.updated_at ? ' ' + _renewalLocalDay(g.updated_at) : '')) : 'not called yet'; };

  const nextUp = (x) => {
    // Green and upbeat (per Isaac, Oct 13) — this is a renewal opportunity, not a fire.
    const G = '#15803D';
    return el('div', { class: 'rounded-2xl border p-4 flex flex-col gap-2', style: { borderColor: 'rgba(22,163,74,.55)', background: 'rgba(22,163,74,.08)' } },
      el('div', { class: 'flex items-center justify-end gap-2 flex-wrap' },
        x._tier === 0 ? el('span', { class: 'text-[10px] font-bold', style: { color: G, marginRight: 'auto' } }, '📅 Callback due today') : null,
        el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, lastTouch(x))),
      el('div', { class: 'flex items-end justify-between gap-3 flex-wrap' },
        el('div', { class: 'min-w-0' },
          el('div', { class: 'text-lg font-black truncate' }, x.name),
          el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, '#' + x.id + ' · ' + _titleCaseWords(x.office) + ' · ' + x.svc + ' · ' + fmt.usd0(x.arv) + ' ARR'),
          el('div', { class: 'text-[12px] font-bold mt-0.5', style: { color: G } }, why(x)),
          flags(x) ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, flags(x)) : null),
        phoneA(x, true)),
      actions(x, true),
      notesIn(x));
  };
  const LIMIT = state._renewalQMore ? 100000 : 60;
  const row = (x, i) => {
    const t = RENEWAL_TIERS[x._tier];
    const open = state._renewalOpenCard === String(x.id);
    return el('div', { class: 'rounded-xl border px-3 py-2 flex flex-col gap-1.5 cursor-pointer', style: { borderColor: 'var(--border)', background: 'var(--card)', opacity: x._triedToday ? '.6' : '1' },
      onclick: () => { state._renewalOpenCard = open ? null : String(x.id); mountApp(); } },
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('span', { class: 'text-[10px] font-bold tabular-nums w-6 shrink-0', style: { color: 'var(--text-subtle)' } }, String(i + 1)),
        el('div', { class: 'min-w-0 flex-1', style: { minWidth: '160px' } },
          el('div', { class: 'text-xs font-bold truncate' }, x.name + (x._triedToday ? ' · tried today' : '') + ((state._renewalClaims || {})[String(x.id)] ? ' · 📞 ' + state._renewalClaims[String(x.id)] + ' is on this one' : '')),
          el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-muted)' } }, why(x))),
        el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-subtle)', maxWidth: '200px' } }, _titleCaseWords(x.office) + ' · ' + x.svc),
        el('div', { class: 'text-[11px] font-bold tabular-nums w-16 text-right shrink-0' }, fmt.usd0(x.arv)),
        phoneA(x)),
      open ? el('div', { class: 'flex flex-col gap-1.5 pt-1.5 border-t', style: { borderColor: 'var(--border)' }, onclick: (e) => e.stopPropagation() },
        el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '#' + x.id + (flags(x) ? ' · ' + flags(x) : '') + ' · ' + lastTouch(x)),
        actions(x), notesIn(x))
        : (o.logOf(x).notes ? el('div', { class: 'text-[10px] truncate pl-8', style: { color: 'var(--text-muted)' } }, '✎ ' + o.logOf(x).notes) : null));
  };
  const plainRow = (x, right) => el('div', { class: 'rounded-xl border px-3 py-2 flex items-center gap-2 flex-wrap', style: { borderColor: 'var(--border)', background: 'var(--card)' } },
    el('div', { class: 'min-w-0 flex-1', style: { minWidth: '160px' } },
      el('div', { class: 'text-xs font-bold truncate' }, x.name),
      el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-muted)' } }, '#' + x.id + ' · ' + _titleCaseWords(x.office) + ' · ' + x.svc + (o.logOf(x).notes ? ' · ✎ ' + o.logOf(x).notes : ''))),
    el('div', { class: 'text-[11px] font-bold tabular-nums' }, fmt.usd0(x.arv)), phoneA(x), right);

  const tabBtn = (k, label, n) => el('button', { class: 'rounded-lg px-3 py-1 text-[11px] font-bold cursor-pointer', style: tab === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text)' },
    onclick: () => { state._renewalQTab = k; mountApp(); } }, label + ' · ' + n.toLocaleString());
  const tierBar = el('div', { class: 'flex gap-1.5 flex-wrap' },
    el('button', { class: 'rounded-lg border px-2 py-1 text-[10px] font-bold cursor-pointer', style: { borderColor: fTier === '' ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onclick: () => { state._renewalTier = null; mountApp(); } }, 'All · ' + qAll.length.toLocaleString()),
    ...RENEWAL_TIERS.filter(t => tierN[t.key].n).map(t => el('button', { class: 'rounded-lg border px-2 py-1 text-[10px] font-bold cursor-pointer', title: t.blurb + ' · ' + fmt.usd0(tierN[t.key].arr) + ' ARR',
      style: { borderColor: fTier === String(t.key) ? t.color : 'var(--border-2)', background: fTier === String(t.key) ? t.bg : 'var(--card)', color: t.color },
      onclick: () => { state._renewalTier = t.key; mountApp(); } }, t.label + ' · ' + tierN[t.key].n.toLocaleString())));
  const exportQ = el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: () => _reportingCsvDownload('renewal-call-queue-' + today + '.csv',
      ['Rank', 'Priority', 'Customer ID', 'Customer Name', 'Phone', 'Office Name', 'Subscription Type', 'ARV', 'Contract', 'Customer Life (mo)', 'Term End', 'Months To Term End', 'Months Past Term', 'Auto Pay', 'Days Past Due', 'Attempts', 'Last Rep', 'Notes'],
      qShown.map((x, i) => { const g = o.logOf(x); return [i + 1, RENEWAL_TIERS[x._tier].label, x.id, x.name, x.phone, x.office, x.svc, Math.round(x.arv), x.len, x.life.toFixed(1), x.endMonth, x.pastBy < 0 ? x.toGo.toFixed(1) : '', x.pastBy >= 0 ? x.pastBy.toFixed(1) : '', x.autopay ? 'Yes' : 'No', x.pastDue, g.attempts || 0, g.worked_by || '', g.notes || '']; })) }, '⬇ Export queue');

  let body;
  if (tab === 'callbacks') {
    const L = snoozed.filter(base);
    body = L.length ? el('div', { class: 'flex flex-col gap-1.5' }, ...L.map(x => plainRow(x, el('span', { class: 'inline-flex items-center gap-1.5' },
      el('span', { class: 'text-[11px] font-bold', style: { color: '#7C3AED' } }, '📅 ' + _renewalCallback(o.logOf(x))),
      btn('Call now', 'Put back in the queue today', () => save(x, { result: 'Contacting' }))))))
      : el('div', { class: 'text-[12px] text-center py-8', style: { color: 'var(--text-subtle)' } }, 'No callbacks scheduled.');
  } else if (tab === 'done') {
    const L = doneAll.filter(base);
    body = L.length ? el('div', { class: 'flex flex-col gap-1.5' }, ...L.slice(0, LIMIT).map(x => {
      const g = o.logOf(x), ren = x.crm || /Renewed|Resigned/.test(g.result || '');
      return plainRow(x, el('span', { class: 'inline-flex items-center gap-1.5' },
        el('span', { class: 'text-[10px] font-black uppercase', style: { color: ren ? 'var(--ok)' : '#DC2626' } }, x.crm ? 'Renewed in CRM' : (ren ? 'Renewed' : 'Not interested') + (g.worked_by ? ' · ' + g.worked_by.split(' ')[0] : '') + (g.updated_at ? ' ' + _renewalLocalDay(g.updated_at) : '')),
        x.crm ? null : btn('↩ Undo', 'Put back in the queue', () => save(x, { result: '' }))));
    }), L.length > LIMIT ? btn('Show all ' + L.length.toLocaleString(), '', () => { state._renewalQMore = true; mountApp(); }) : null)
      : el('div', { class: 'text-[12px] text-center py-8', style: { color: 'var(--text-subtle)' } }, 'Nothing closed out yet.');
  } else {
    // Several reps at once (per Isaac, Oct 13): each open queue tells the others (Supabase realtime presence, no table)
    // which customer it has up. Your next call skips anyone another rep is on; their row says who.
    const claims = state._renewalClaims || {};
    const first = qShown.find(x => !claims[String(x.id)]) || null, rest = qShown.filter(x => x !== first);
    _renewalClaimTrack(state._renewalDispOpen || (first ? String(first.id) : null));
    body = first ? el('div', { class: 'flex flex-col gap-2' },
      first._triedToday ? el('div', { class: 'text-[12px] font-bold text-center py-2', style: { color: 'var(--ok)' } }, '🎉 Everyone in this list has been tried today — what is left are second attempts.') : null,
      nextUp(first),
      rest.length ? el('div', { class: 'text-[10px] font-black uppercase tracking-wider mt-1', style: { color: 'var(--text-subtle)' } }, 'Then') : null,
      ...rest.slice(0, LIMIT).map((x, i) => row(x, i + 1)),
      rest.length > LIMIT ? btn('Show all ' + rest.length.toLocaleString(), '', () => { state._renewalQMore = true; mountApp(); }) : null)
      : el('div', { class: 'text-[12px] text-center py-8', style: { color: 'var(--text-subtle)' } }, o.q ? 'Nobody matches “' + o.q + '”.' : 'Queue is clear — nice work.');
  }
  const header = el('div', { class: 'flex flex-col gap-2' },
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      tabBtn('queue', '📞 Call queue', qAll.length), tabBtn('callbacks', '📅 Callbacks', snoozed.filter(base).length), tabBtn('done', '✓ Done', doneAll.filter(base).length),
      el('span', { class: 'text-[11px] tabular-nums ml-auto', style: { color: 'var(--text-muted)' } },
        'Today: ', el('b', {}, String(mCalls)), ' calls · ', el('b', { style: { color: 'var(--ok)' } }, String(mRenewed)), ' renewed (you) · team ', el('b', {}, String(tCalls)), ' / ', el('b', { style: { color: 'var(--ok)' } }, String(tRenewed)))),
    el('div', { class: 'flex items-center gap-2 flex-wrap' }, o.search, o.branchSel, _renewalModeBtn()));
  if (o.compact) return el('div', { class: 'flex flex-col gap-3' }, header, body);
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4 flex flex-col gap-3' },
      el('div', {},
        el('h2', { class: 'text-lg font-bold' }, '🔁 Renewal call queue'),
        el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
          'Who to call, newest customers first — the fewest months since their first service — so first contracts ending (months 11–12, where churn spikes) lead and long-term month-to-month customers come last. Renewals can be signed in the final 2 months of the agreement. No answer drops a customer to the bottom for today; a callback takes them off the list until that day. Never renewed before · no Sentricon.')),
      header),
    body);
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
    if (state.view === 'loyalty_renewals') mountApp();
  });
  // Many reps work the board at once (per Isaac): every save lands on every
  // open board within a second through the realtime channel, so two people
  // never drag the same card without seeing it move.
  try {
    if (!state._renewalRt) {
      state._renewalRt = supabase.channel('renewal_worklog_rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'renewal_worklog' }, (msg) => {
          const row = msg.new && msg.new.customer_id ? msg.new : null;
          if (msg.eventType === 'DELETE') { const k = msg.old && msg.old.customer_id; if (k) delete state._renewalLog[String(k)]; }
          else if (row) state._renewalLog[String(row.customer_id)] = row;
          try { localStorage.setItem('ridd_renewal_log_v1', JSON.stringify(state._renewalLog)); } catch (e) { /* quota */ }
          if (state.view === 'loyalty_renewals') { clearTimeout(state._renewalRtT); state._renewalRtT = setTimeout(mountApp, 300); }
        }).subscribe();
    }
  } catch (e) { /* realtime unavailable — saves still land, boards refresh on reload */ }
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
      (o.cxlByReason = o.cxlByReason || []).push([reason, life]);
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
    // Customer lifetime (per Isaac, Sep 23): reason dropdown drives the tiles
    // AND the bars below — "why each term cancels" as a grouped bar chart.
    (() => {
      const rsel = state._ctReason || 'all';
      const cxlOf = (o) => rsel === 'all' ? o.cxl : (o.cxlByReason || []).filter(([k]) => k === rsel).map(([, l]) => l);
      const reasonSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '260px' },
        onchange: (e) => { state._ctReason = e.target.value; mountApp(); } },
        el('option', { value: 'all', selected: rsel === 'all' }, 'All reasons'),
        ...[...allReasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => el('option', { value: k, selected: rsel === k }, k + ' (' + n.toLocaleString() + ')')));
      const cid = 'ct-reason-bars';
      setTimeout(() => {
        if (typeof Chart === 'undefined') return;
        const cvs = document.getElementById(cid); if (!cvs) return;
        if (_chartInstances[cid]) { _chartInstances[cid].destroy(); delete _chartInstances[cid]; }
        const isDark = state.theme === 'dark';
        const txt = isDark ? '#C9C9BE' : '#555', gridc = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
        const shareOf = (t, k) => T[t].cxlN ? (T[t].reasons.get(k) || 0) / T[t].cxlN * 100 : 0;
        const labels = rsel === 'all' ? topReasons.map(([k]) => k) : TERMS.map(t => t + '-month');
        const datasets = rsel === 'all'
          ? TERMS.map(t => ({ label: t + ' mo', data: topReasons.map(([k]) => shareOf(t, k)), backgroundColor: TERM_COLOR[t], borderRadius: 3 }))
          : [{ label: rsel, data: TERMS.map(t => shareOf(t, rsel)), backgroundColor: TERMS.map(t => TERM_COLOR[t]), borderRadius: 3 }];
        _chartInstances[cid] = new Chart(cvs.getContext('2d'), {
          type: 'bar', data: { labels, datasets },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: rsel === 'all', labels: { color: txt, boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(1) + '% of that term\u2019s cancels' } } },
            scales: { x: { ticks: { color: txt, font: { size: 10 }, autoSkip: false, maxRotation: 30 }, grid: { display: false } }, y: { ticks: { color: txt, font: { size: 10 }, callback: (v) => v + '%' }, grid: { color: gridc }, title: { display: true, text: 'share of the term\u2019s cancels', color: txt, font: { size: 10 } } } } },
        });
      }, 0);
      return card([
        el('div', { class: 'flex items-start justify-between gap-3 flex-wrap mb-2' }, secHdr('Customer lifetime — how early the cancels happen'), reasonSel),
        el('div', { class: 'flex gap-3 flex-wrap' },
          ...TERMS.map(t => {
            const L = cxlOf(T[t]);
            return el('div', { class: 'flex-1 rounded-xl p-3', style: { background: 'var(--card-2)', minWidth: '170px', borderTop: '3px solid ' + TERM_COLOR[t] } },
              el('div', { class: 'text-xs font-black mb-1' }, t + '-month cancels' + (rsel === 'all' ? '' : ' · ' + L.length.toLocaleString())),
              el('div', { class: 'text-[11px] tabular-nums flex flex-col gap-0.5' },
                el('div', {}, el('b', {}, L.length ? med(L).toFixed(1) + ' mo' : '—'), el('span', { style: { color: 'var(--text-muted)' } }, ' median lifetime')),
                el('div', {}, el('b', {}, pct(pctUnder(L, 4))), el('span', { style: { color: 'var(--text-muted)' } }, ' gone within 4 months')),
                el('div', {}, el('b', {}, pct(pctUnder(L, 7))), el('span', { style: { color: 'var(--text-muted)' } }, ' gone within 7 months'))));
          })),
        // Insights (per Isaac): the selected reason against every other reason
        // and the all-reason averages — lifetime, how early, how big a slice.
        (() => {
          const all = TERMS.flatMap(t => T[t].cxlByReason || []);
          if (!all.length) return null;
          const byR = new Map(); all.forEach(([k, l]) => { const a = byR.get(k) || []; a.push(l); byR.set(k, a); });
          const stat = (L) => ({ n: L.length, med: L.length ? med(L) : null, u4: pctUnder(L, 4), u7: pctUnder(L, 7), avg: L.length ? L.reduce((a, b) => a + b, 0) / L.length : null });
          const A = stat(all.map(([, l]) => l));
          const rows = [...byR.entries()].filter(([, L]) => L.length >= 20).map(([k, L]) => ({ k, ...stat(L) }));
          const byMed = rows.slice().sort((a, b) => a.med - b.med);
          const line = (t) => el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, t);
          const bold = (t) => el('b', { style: { color: 'var(--text)' } }, t);
          const mo = (v) => v == null ? '—' : v.toFixed(1) + ' mo';
          const box = (kids) => el('div', { class: 'rounded-xl p-3 mt-3 flex flex-col gap-1', style: { background: 'var(--card-2)' } }, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-0.5', style: { color: 'var(--text-subtle)' } }, 'Insights'), ...kids);
          if (rsel === 'all') {
            const fast = byMed[0], slow = byMed[byMed.length - 1];
            const big = rows.slice().sort((a, b) => b.n - a.n)[0];
            return box([
              line(['Across ', bold(A.n.toLocaleString() + ' cancels'), ' the median lifetime is ', bold(mo(A.med)), ' (average ', bold(mo(A.avg)), '); ', bold(pct(A.u4)), ' are gone within 4 months and ', bold(pct(A.u7)), ' within 7.']),
              fast ? line(['Fastest exit: ', bold(fast.k), ' at a median ', bold(mo(fast.med)), ' (', pct(fast.u4), ' gone within 4 months). Slowest: ', bold(slow.k), ' at ', bold(mo(slow.med)), '.']) : null,
              big ? line(['Biggest reason: ', bold(big.k), ' — ', bold(pct(big.n / A.n)), ' of all cancels, median ', bold(mo(big.med)), '.']) : null,
              line('Pick a reason above to compare it against these averages.')]);
          }
          const R = rows.find(x => x.k === rsel) || (byR.get(rsel) ? { k: rsel, ...stat(byR.get(rsel)) } : null);
          if (!R || !R.n) return box([line('No cancels with this reason in the current scope.')]);
          const rank = byMed.findIndex(x => x.k === rsel);
          const dMed = R.med != null && A.med != null ? R.med - A.med : null;
          const shareAll = R.n / A.n;
          const termShares = TERMS.map(t => [t, T[t].cxlN ? (T[t].reasons.get(rsel) || 0) / T[t].cxlN : 0]).sort((a, b) => b[1] - a[1]);
          return box([
            line([bold(R.k), ': ', bold(R.n.toLocaleString() + ' cancels'), ' — ', bold(pct(shareAll)), ' of all cancels. Median lifetime ', bold(mo(R.med)), dMed == null ? '' : (dMed < 0 ? ', ' + Math.abs(dMed).toFixed(1) + ' months SOONER than the all-reason median of ' + mo(A.med) : ', ' + dMed.toFixed(1) + ' months later than the all-reason median of ' + mo(A.med)), '.']),
            line([bold(pct(R.u4)), ' gone within 4 months vs ', bold(pct(A.u4)), ' overall; ', bold(pct(R.u7)), ' within 7 vs ', bold(pct(A.u7)), '.']),
            rank >= 0 ? line(['Among the ', byMed.length, ' reasons with 20+ cancels this is the ', bold('#' + (rank + 1)), ' fastest exit', rank === 0 ? ' — the quickest of all.' : rank === byMed.length - 1 ? ' — the slowest of all.' : '.']) : null,
            termShares[0] ? line(['Hits ', bold(termShares[0][0] + '-month'), ' contracts hardest (', bold(pct(termShares[0][1])), ' of their cancels) and ', bold(termShares[termShares.length - 1][0] + '-month'), ' least (', bold(pct(termShares[termShares.length - 1][1])), ').']) : null]);
        })(),
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mt-4 mb-1', style: { color: 'var(--text-subtle)' } }, rsel === 'all' ? 'Why each term cancels' : rsel + ' — share of each term\u2019s cancels'),
        el('div', { style: { height: '220px' } }, el('canvas', { id: cid }))]);
    })(),
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

