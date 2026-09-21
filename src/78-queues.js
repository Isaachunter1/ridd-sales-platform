// ┌─ src/78-queues.js ─────────────────────────────────────────────────────
// │ Admin Queues view.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ═══ WORK QUEUES — the office-staff home for the three call lists
// (Renewals · Customer Health · Next Best). Same components the admin
// Retention tab uses; this view just gives agents a direct door without
// opening the rest of Reporting. Admins see it too (oversight).
function viewQueues() {
  // Reporting rows lazy-load exactly like the backend audit queue does.
  if (state.reportingActiveUploadId
      && state.reportingSubscriptionsLoadedFor !== state.reportingActiveUploadId
      && typeof loadReportingSubscriptions === 'function' && !state._queuesRowsLoading) {
    state._queuesRowsLoading = true;
    loadReportingSubscriptions(state.reportingActiveUploadId).then(rows => {
      state._queuesRowsLoading = false;
      if (rows == null || state.reportingActiveUploadId == null) return;
      state.reportingSubscriptions = rows;
      state.reportingSubscriptionsLoadedFor = state.reportingActiveUploadId;
      if (state.view === 'queues') mountApp();
    }).catch(() => { state._queuesRowsLoading = false; });
  }
  const sec = ['health', 'nextbest'].includes(state._queuesSection) ? state._queuesSection : 'renewals';
  const pills = el('div', { class: 'flex items-center gap-1.5 flex-wrap' },
    ...[['renewals', '🔁 Renewals'], ['health', '❤️‍🩹 Customer Health'], ['nextbest', '🎯 Next Best Service']].map(([k, l]) => el('button', {
      class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95',
      style: sec === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)' },
      onclick: () => { state._queuesSection = k; mountApp(); },
    }, l)));
  let body;
  if (state._queuesRowsLoading && state.reportingSubscriptionsLoadedFor !== state.reportingActiveUploadId) {
    body = emptyCard('Loading the customer book…');
  } else {
    body = sec === 'health' ? reportingCustomerHealth() : sec === 'nextbest' ? reportingNextBest() : reportingRenewals();
  }
  return el('div', { class: 'flex flex-col gap-4 w-full' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
      el('div', {},
        el('h1', { class: 'text-2xl font-bold' }, 'Work Queues'),
        el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
          'Who to call and why — renewals entering their window, at-risk customers to save, and cross-sell pitches. Lists refresh from the CRM hourly; dispositions are shared across the whole team.')),
      pills),
    body);
}

// ═══ FULL-POPULATION AUDIT EXPORT (per Isaac) — every subscription row in
// the snapshot, raw CRM fields PLUS every classification the app applies
// (visible/hidden, recurring, serviced, active, counted-cancel + why not,
// ROR, one-time, retention population). Built to XLOOKUP against a manual
// CRM export by Customer ID + Subscription to find where reporting is
// right — and where it isn't.
function reportingAuditExportCard() {
  const gate = reportingDataGate();
  if (gate) return null;   // config panels render their own empty states
  return el('div', { class: 'card p-4 flex items-start justify-between gap-3 flex-wrap' },
    el('div', {},
      el('h3', { class: 'text-sm font-bold' }, '🔍 Reporting audit export'),
      el('p', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } },
        'Every row in the snapshot — including hidden/excluded ones — with the raw CRM fields AND every judgment the app makes about the row (visible, recurring, active, counted as churn + the reason it isn\u2019t, ROR, retention population). XLOOKUP it against a manual CRM export by Customer ID to reconcile.')),
    el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95 shrink-0',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: () => {
        const { all, isHidden, isRecurring, isActive, isRealCancel } = reportingFilters();
        const excludedSources = reportingExcludedSources();
        const excludedReasons = reportingExcludedCancelReasons();
        const rorOn = reportingExcludeRorChurn();
        const rows = all.map(r => {
          const hidden = isHidden(r);
          const srcExcl = excludedSources.has(reportingSourceOf(r));
          const visible = !hidden && !srcExcl;
          const rec = isRecurring(r);
          const serviced = (Number(r.subscription_completed_services) || 0) > 0 || !!r.initial_service;
          const ror = !!(r.subscription_date_canceled && typeof _reporting3dayRor === 'function' && _reporting3dayRor(r));
          const reasonExcl = !!(r.subscription_date_canceled && excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r))));
          const counted = isRealCancel(r);
          let whyNot = '';
          if (r.subscription_date_canceled && !counted) {
            whyNot = !rec ? 'not recurring (one-time/lifecycle)'
              : (rorOn && ror) ? '3-day ROR'
              : reasonExcl ? 'reason excluded in Configurations'
              : !visible ? (hidden ? 'service type hidden' : 'source excluded') : 'other';
          }
          return [
            r.customer_id, r.last_name, r.first_name, r.office_name, r.state, r.county, r.zip_code,
            r.subscription, r.subscription_source, r.sold_by, r.sold_by_type, r.sold_date,
            r.initial_service, r.subscription_completed_services, r.subscription_status,
            r.subscription_date_canceled, reportingCancelReasonOf(r),
            r.agreement_length, r.recurring_frequency,
            r.annual_recurring_value, r.subscription_contract_value, r.initial_price,
            r.days_past_due, r.customer_auto_pay, r.customer_flags,
            visible ? 'Yes' : (hidden ? 'No — hidden service' : 'No — excluded source'),
            rec ? 'Yes' : 'No',
            serviced ? 'Yes' : 'No',
            isActive(r) ? 'Yes' : 'No',
            (visible && rec && serviced) ? 'Yes' : 'No',
            r.subscription_date_canceled ? (counted ? 'Yes' : 'No') : '',
            whyNot, ror ? 'Yes' : '',
          ];
        });
        _reportingCsvDownload('reporting-audit-export.csv', [
          'Customer ID', 'Last Name', 'First Name', 'Office', 'State', 'County', 'Zip',
          'Subscription', 'Source', 'Sold By', 'Sold By Type', 'Sold Date',
          'Initial Service', 'Completed Services', 'Status',
          'Date Canceled', 'Cancel Reason',
          'Agreement Length', 'Frequency',
          'ARV', 'Contract Value', 'Initial Price',
          'Days Past Due', 'Auto Pay', 'Customer Flags',
          'App: Visible', 'App: Recurring', 'App: Serviced', 'App: Active',
          'App: In Retention Population', 'App: Counted As Churn', 'App: Why Not Counted', 'App: 3-Day ROR',
        ], rows);
        toast('Exported ' + rows.length.toLocaleString() + ' rows', 'success');
      },
    }, '⬇ Export full audit table'));
}

