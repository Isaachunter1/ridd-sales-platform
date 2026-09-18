// ┌─ src/94-commission-view.js ─────────────────────────────────────────────────────
// │ D2D Pay tab (commission calculator view).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewCommission() {
  // D2D Pay — wiped clean (per Isaac, Sep 2026) to be rebuilt from scratch.
  // The old Upfront stub + Backend calculator (viewD2dUpfront /
  // commissionCalculator / commissionMyPay) are still in the file and in
  // git history; nothing routes to them until the new design lands.
  return el('div', { class: 'flex flex-col gap-4 w-full' },
    el('div', { class: 'card p-10 text-center text-sm text-muted-' },
      el('div', { class: 'font-display text-lg mb-1', style: { color: 'var(--text)' } }, 'Pay'),
      'D2D pay is being rebuilt. Nothing to show here yet.'));
}

// ── Rep-facing view: your OWN published commission, read-only. Reps can't read
// the company snapshot or other reps' pay — they read only their own row from
// commission_results (row-level security enforces it). ──
function commissionMyPay() {
  const p = state.profile || {};
  const wrap = (node) => el('div', { class: 'flex flex-col gap-4 w-full' }, el('h1', { class: 'text-2xl font-bold' }, 'My Commission'), node);
  if (!p.fieldroutes_employee_id) return wrap(el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'Your account isn’t linked to a FieldRoutes rep yet. Ask an admin to link you on Settings → Users.'));
  if (!state._myCommissionLoaded) { loadMyCommissionResult().then(() => { if (state.view === 'commission') mountApp(); }); return wrap(el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'Loading your commission…')); }
  const row = state._myCommission;
  if (!row || !row.data) return wrap(el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'Your commission will appear here, updated with each sync. Nothing to show yet.'));
  const B = row.data;
  const { breakdown, stats } = commissionRenderCards(B, B.name || p.full_name || '');
  return wrap(el('div', { class: 'flex flex-col gap-3' },
    el('div', { class: 'text-xs text-muted-' }, 'Updated ' + (row.published_at ? new Date(row.published_at).toLocaleDateString() : '') + (row.period_start ? ' · sold ' + row.period_start + ' → ' + row.period_end : '')),
    el('div', { class: 'flex flex-col gap-4 w-full max-w-[440px]' }, breakdown, stats)));
}

// ── Office Staff (Inside Sales) commission — the in-app Pay-Tab model ────────
// Office Staff log sales in this app and are paid on the Inside Sales pay
// rules (Settings → Commissions ▸ Office Staff), NOT the CRM pest/bundle model.
// This mirrors the math in the Inside Sales "Pay" view: upfront commission per
// serviced sale (revenue × contract-type rate, or flat $ for renewal sources),
// Below-Minimums at the reduced rate, plus quarter-end backend (multi-year,
// renewal) and the close-rate bonus on subscription revenue.
function commissionComputeOfficeStaff(emp, startMs, endMs) {
  const repId = emp.app_profile_id;
  const profile = (state.allProfiles || []).find(p => p.id === repId) || {};
  ensurePaySettings();
  const sales = (state.allSales || []).filter(s => {
    if (String(s.rep_id) !== String(repId)) return false;
    const sd = Date.parse(s.sold_date);
    if (isNaN(sd)) return false;
    if (startMs && sd < startMs) return false;
    if (endMs && sd > endMs) return false;
    return true;
  });
  const sumRev = (arr) => arr.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
  const serviced = sales.filter(s => s.audit_status === 'serviced');
  const below    = sales.filter(s => s.audit_status === 'below_minimums');
  const pending  = sales.filter(s => s.audit_status === 'pending');
  const cancelled = sales.filter(s => s.audit_status === 'cancelled');
  const isMultiYear = (s) => [18, 24].includes(Number(s.contract_months));

  const _upMult = upfrontTierPayPct(upfrontCollectedPct([...serviced, ...below]), repId);
  const salesPay   = serviced.reduce((a, s) => a + getCommissionAmount(repId, s), 0) * _upMult;
  const belowPay   = below.reduce((a, s) => a + getCommissionAmount(repId, s), 0) * _upMult;
  const pendingPay = pending.reduce((a, s) => a + getCommissionAmount(repId, { ...s, audit_status: 'serviced' }), 0);

  const multiYearBonus = serviced.filter(s => isMultiYear(s) && !isRenewalSource(s)).reduce((a, s) => a + getBackendAmount(s), 0);
  const renewalPay     = serviced.filter(s => isRenewalSource(s)).reduce((a, s) => a + getBackendAmount(s), 0);
  const closeRate      = Number(profile.close_rate_target ?? 0.50);
  const subscriptionRev = subscriptionRevenueOf(serviced);
  const closeRateBonus = closeRateBonusFor(closeRate, subscriptionRev, repId);
  const backendPay     = multiYearBonus + closeRateBonus + renewalPay;

  const upfrontPay = salesPay + belowPay;
  const totalPay   = upfrontPay + backendPay;
  return {
    totalRevenue: sumRev(sales), subscriptionRev, salesPay, belowPay, pendingPay,
    multiYearBonus, closeRateBonus, renewalPay, backendPay, upfrontPay, totalPay, closeRate,
    sold: sales.length, serviced: serviced.length, below: below.length,
    pending: pending.length, cancelled: cancelled.length,
  };
}

// Breakdown + stats cards for an Office Staff rep — same visual language as
// the CRM commissionRenderCards, but with the Inside Sales pay lines.
function commissionRenderOfficeStaff(B, repName) {
  const money = (n) => { const v = Math.round((n || 0) * 100) / 100; return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const pct = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2) + '%';
  const ROW = (label, valNode, kind) => el('div', {
    class: 'flex items-center gap-4 gap-3 px-3 py-2 text-sm',
    style: { borderTop: '1px solid var(--border)',
      background: kind === 'rev' ? 'rgba(95,108,91,.08)' : kind === 'comm' ? 'rgba(223,100,58,.10)' : kind === 'total' ? 'rgba(223,100,58,.18)' : 'transparent' } },
    el('span', { class: kind === 'total' ? 'font-bold' : '' }, label),
    el('span', { class: 'tabular-nums ' + (kind === 'total' ? 'font-bold' : '') }, valNode));
  const breakdown = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-3 py-2 font-display text-xl', style: { background: 'var(--text)', color: 'var(--bg)' } }, 'Inside Sales Pay'),
    ROW('Office Staff', repName),
    ROW('Total Revenue', money(B.totalRevenue), 'rev'),
    ROW('Subscription Revenue', money(B.subscriptionRev), 'rev'),
    ROW('Sales Pay (serviced)', money(B.salesPay), 'comm'),
    ROW('Below-Minimums Pay', money(B.belowPay), 'comm'),
    ROW('Upfront Pay', money(B.upfrontPay), 'total'),
    ROW('Multi-Year Backend', money(B.multiYearBonus), 'comm'),
    ROW('Renewal Pay', money(B.renewalPay), 'comm'),
    ROW('Close-Rate Bonus (' + pct(B.closeRate * 100) + ')', money(B.closeRateBonus), 'comm'),
    ROW('Backend Pay', money(B.backendPay), 'total'),
    ROW('Total Pay', money(B.totalPay), 'total'),
    el('div', { class: 'px-3 py-2 text-sm flex items-center gap-4', style: { background: 'rgba(95,108,91,.08)', borderTop: '1px solid var(--border)' } },
      el('span', { class: 'font-semibold' }, 'Pending Pay (est.)'), el('span', { class: 'tabular-nums font-semibold' }, money(B.pendingPay))));
  const statRow = (label, val, tone) => el('div', { class: 'flex items-center gap-4 px-3 py-1.5 text-sm', style: { borderTop: '1px solid var(--border)' } },
    el('span', {}, label), el('span', { class: 'tabular-nums font-semibold', style: tone ? { color: tone } : {} }, val));
  const stats = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-3 py-2 font-display text-lg', style: { background: 'var(--text)', color: 'var(--bg)' } }, 'Accounts'),
    statRow('Total Accounts Sold', B.sold),
    statRow('Commissionable', B.serviced),
    statRow('Below Minimums', B.below),
    statRow('Pending Audit', B.pending),
    statRow('Cancelled', B.cancelled, B.cancelled ? '#DC2626' : null));
  return { breakdown, stats };
}

function commissionCalculator() {
  if (!isAdminRole(state.profile?.role)) return el('div', { class: 'card p-8 text-center text-sm text-muted-' }, 'Commission Calculator is admin-only.');
  const money = (n) => { const v = Math.round((n || 0) * 100) / 100; const s = v < 0 ? '-' : ''; return s + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const pct = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2) + '%';

  // Need the roster for Sales Reps (CRM-sourced). Office Staff are app users
  // who log Inside Sales in-app (keyed by rep_id) — no CRM snapshot required.
  if (state.frRoster == null && !state._frRosterLoading) loadFieldRoutesRoster().then(() => { if (state.view === 'commission') mountApp(); });

  const roster = state.frRoster || [];
  const salesReps = roster.filter(e => e.type_label === 'Sales Rep').sort((a, b) => _frEmpName(a).localeCompare(_frEmpName(b)));
  // Office Staff / Inside Sales reps: app profiles that have logged sales here.
  const appRepIds = new Set((state.allSales || []).map(s => String(s.rep_id)));
  const officeStaff = (state.allProfiles || [])
    .filter(p => appRepIds.has(String(p.id)))
    .map(p => ({ employee_id: 'app:' + p.id, app_profile_id: p.id, isApp: true, type_label: 'Office Staff', fname: p.full_name || '', lname: '', email: p.email || '', office_name: '' }))
    .sort((a, b) => _frEmpName(a).localeCompare(_frEmpName(b)));
  const reps = [...salesReps, ...officeStaff];
  if (!reps.length) return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'No reps yet — run a sync (Sales Reps) or log Inside Sales in-app (Office Staff).');

  if (!state._commEmpId || !reps.find(e => e.employee_id === state._commEmpId)) state._commEmpId = reps[0].employee_id;
  const emp = reps.find(e => e.employee_id === state._commEmpId);

  // Sales Reps read from the CRM snapshot — load it on demand. Office Staff
  // pull from in-app logged sales, so they skip this guard.
  if (!emp.isApp) {
    const activeId = state.reportingActiveUploadId;
    if (!activeId) return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'No CRM snapshot yet — hit the ↻ sync icon to pull FieldRoutes, then come back.');
    if (state.reportingSubscriptionsLoadedFor !== activeId) {
      loadReportingSubscriptions(activeId).then(rows => { if (rows && state.reportingActiveUploadId === activeId) { state.reportingSubscriptions = rows; state.reportingSubscriptionsLoadedFor = activeId; mountApp(); } });
      return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, 'Loading the CRM snapshot…');
    }
  }

  // Period (default: this year) + lock date.
  const yr = new Date().getFullYear();
  if (state._commStart == null) state._commStart = yr + '-01-01';
  if (state._commEnd == null)   state._commEnd = new Date().toISOString().slice(0, 10);
  if (state._commLock == null)  state._commLock = '';
  const startMs = state._commStart ? Date.parse(state._commStart) : 0;
  const endMs   = state._commEnd ? Date.parse(state._commEnd) + 86399000 : 0;
  const lockMs  = state._commLock ? Date.parse(state._commLock) : 0;

  // ── Office Staff (Inside Sales) — paid on the in-app Pay-Tab model. Self-
  // contained: no CRM rate override / lock date, rules live in Settings. ──
  if (emp.isApp) {
    const lblO = (t) => el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold block mb-1' }, t);
    const optForO = (e) => el('option', { value: e.employee_id, selected: e.employee_id === state._commEmpId }, _frEmpName(e) + (e.office_name ? ' · ' + e.office_name : ''));
    const repSelectO = el('select', { class: 'rounded-xl border px-2.5 py-1 text-[11px] font-medium', style: { borderColor: 'var(--border-2)', maxWidth: '260px' }, onchange: (e) => { state._commEmpId = e.target.value; mountApp(); } },
      salesReps.length ? el('optgroup', { label: 'Sales Reps · CRM' }, ...salesReps.map(optForO)) : null,
      officeStaff.length ? el('optgroup', { label: 'Office Staff · Inside Sales' }, ...officeStaff.map(optForO)) : null);
    const dateInputO = (val, onCommit) => el('input', { type: 'date', value: val || '', class: 'rounded-xl border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onchange: (e) => { onCommit(e.target.value); mountApp(); } });
    const B = commissionComputeOfficeStaff(emp, startMs, endMs);
    const { breakdown, stats } = commissionRenderOfficeStaff(B, _frEmpName(emp));
    const note = el('div', { class: 'card p-3 text-xs', style: { borderLeft: '3px solid var(--accent)' } },
      el('b', { style: { color: 'var(--text)' } }, 'Inside Sales pay model. '),
      el('span', { class: 'text-muted-' }, 'Sourced from sales logged in-app. Rates (upfront % by contract type, below-min, renewal flat $, backend, close-rate bonus) are set in Settings → Commissions ▸ Office Staff.'),
      B.sold === 0 ? el('div', { class: 'mt-2 text-muted-' }, 'No sales logged for this rep in the selected window.') : null);
    return el('div', { class: 'flex flex-col gap-4 w-full' },
      el('div', { class: 'flex items-end gap-4 flex-wrap gap-3' },
        el('div', {},
          el('h1', { class: 'text-2xl font-bold' }, 'Commission Calculator'),
          el('p', { class: 'text-xs text-muted-' }, 'Sales Reps from live FieldRoutes (canonical gates: global excluded services, excluded sources, renewals out, sold-not-started out); Office Staff from Inside Sales logged in-app. Pick a rep and period; rates & rules are saved for everyone.')),
        el('div', { class: 'flex items-end gap-2 flex-wrap' },
          el('label', { class: 'block' }, lblO('Rep'), repSelectO),
          el('label', { class: 'block' }, lblO('Sold from'), dateInputO(state._commStart, v => state._commStart = v)),
          el('label', { class: 'block' }, lblO('Sold to'), dateInputO(state._commEnd, v => state._commEnd = v)))),
      el('div', { class: 'flex flex-col lg:flex-row gap-5 items-start' },
        el('div', { class: 'flex flex-col gap-4 w-full lg:w-[440px] lg:shrink-0' }, breakdown, stats),
        el('div', { class: 'flex flex-col gap-4 flex-1 w-full min-w-0' }, note)));
  }

  const cfg = commissionConfig();
  const R = commissionCompute(emp, startMs, endMs, lockMs);
  const man = commissionManual(emp.employee_id);

  // ---- input helpers ----
  const saveRates = (patch) => { const c = commissionConfig(); c.repRates = Object.assign({}, c.repRates); c.repRates[emp.employee_id] = Object.assign({}, c.repRates[emp.employee_id], patch); saveCommissionConfig(c); mountApp(); };
  const clearOverride = () => { const c = commissionConfig(); c.repRates = Object.assign({}, c.repRates); delete c.repRates[emp.employee_id]; saveCommissionConfig(c); mountApp(); };
  const saveMan = (patch) => { setCommissionManual(emp.employee_id, Object.assign({}, man, patch)); mountApp(); };
  const lbl = (t) => el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold block mb-1' }, t);
  const numField = (label, val, onCommit, opts = {}) => el('label', { class: 'block' }, lbl(label),
    el('input', { type: 'number', step: opts.step || '0.01', value: (val == null ? '' : val), placeholder: opts.ph || '',
      class: 'w-full rounded-lg border px-2.5 py-1 text-[11px] text-left tabular-nums', style: { borderColor: 'var(--border-2)' },
      onchange: (e) => onCommit(e.target.value) }));

  // ---- breakdown + stats (shared with the rep's own pay view) ----
  const { breakdown, stats } = commissionRenderCards(R, _frEmpName(emp));

  // ---- per-rep rate override (type defaults live in Settings → Commissions) ----
  const typeLabel = emp.type_label || 'Sales Rep';
  const typeDef = commissionRulesForType(typeLabel);
  const ratesPanel = el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center gap-4 gap-2 mb-1' },
      el('div', { class: 'text-sm font-bold' }, 'Rate override · ' + _frEmpName(emp)),
      R.overridden ? el('button', { class: 'text-[11px] rounded px-2.5 py-1 border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, onclick: clearOverride }, 'Reset to ' + typeLabel + ' default') : null),
    el('div', { class: 'text-[11px] text-muted- mb-3' },
      typeLabel + ' default: Pest ' + pct(typeDef.pest * 100) + ' · Anc ×' + typeDef.ancMult + ' · Bundle ×' + typeDef.bundleMult + '. Edit below only to override this rep (negotiated deal). Defaults are set in Settings → Commissions.'),
    el('div', { class: 'grid grid-cols-3 gap-3' },
      numField('Pest Commission %', R.pestRate * 100, v => saveRates({ pest: (parseFloat(v) || 0) / 100 }), { step: '0.5' }),
      numField('Ancillary Multiplier', R.ancMult, v => saveRates({ ancMult: parseFloat(v) || 0 }), { step: '0.1' }),
      numField('Bundle Multiplier', R.bundleMult, v => saveRates({ bundleMult: parseFloat(v) || 0 }), { step: '0.1' })),
    el('div', { class: 'text-[11px] mt-2', style: { color: R.overridden ? 'var(--accent)' : 'var(--text-muted)' } },
      (R.overridden ? '✎ Overriding the ' + typeLabel + ' default · ' : 'Using the ' + typeLabel + ' default · ') + 'Ancillary ' + pct(R.ancRate * 100) + ' · Bundle ' + pct(R.bundleRate * 100)));

  const manualPanel = el('div', { class: 'card p-4' },
    el('div', { class: 'text-sm font-bold mb-3' }, 'This run — overrides & deductions'),
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-3 gap-3' },
      numField('Overrides', man.overrides, v => saveMan({ overrides: v })),
      numField('Rent', man.rent, v => saveMan({ rent: v })),
      numField('Paid YTD', man.paidYtd, v => saveMan({ paidYtd: v })),
      numField('Other +/-', man.other, v => saveMan({ other: v })),
      numField('Audit Deduction', man.audit, v => saveMan({ audit: v })),
      numField('Pay Periods', man.payPeriods == null ? 26 : man.payPeriods, v => saveMan({ payPeriods: v }), { step: '1' })),
    el('div', { class: 'text-[11px] text-muted- mt-2' }, 'Deductions are entered as positive numbers — the breakdown subtracts them.'));

  // ---- controls ----
  const optFor = (e) => el('option', { value: e.employee_id, selected: e.employee_id === state._commEmpId }, _frEmpName(e) + (e.office_name ? ' · ' + e.office_name : ''));
  const repSelect = el('select', { class: 'rounded-xl border px-2.5 py-1 text-[11px] font-medium', style: { borderColor: 'var(--border-2)', maxWidth: '260px' }, onchange: (e) => { state._commEmpId = e.target.value; mountApp(); } },
    salesReps.length ? el('optgroup', { label: 'Sales Reps · CRM' }, ...salesReps.map(optFor)) : null,
    officeStaff.length ? el('optgroup', { label: 'Office Staff · Inside Sales' }, ...officeStaff.map(optFor)) : null);
  const dateInput = (val, onCommit) => el('input', { type: 'date', value: val || '', class: 'rounded-xl border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)' }, onchange: (e) => { onCommit(e.target.value); mountApp(); } });

  return el('div', { class: 'flex flex-col gap-4 w-full' },
    el('div', { class: 'flex items-end gap-4 flex-wrap gap-3' },
      el('div', {},
        el('h1', { class: 'text-2xl font-bold' }, 'Commission Calculator'),
        el('p', { class: 'text-xs text-muted-' }, 'Sales Reps from live FieldRoutes (canonical gates: global excluded services, excluded sources, renewals out, sold-not-started out); Office Staff from Inside Sales logged in-app. Pick a rep and period; rates & rules are saved for everyone.')),
      el('div', { class: 'flex items-end gap-2 flex-wrap' },
        el('label', { class: 'block' }, lbl('Sales Rep'), repSelect),
        el('label', { class: 'block' }, lbl('Sold from'), dateInput(state._commStart, v => state._commStart = v)),
        el('label', { class: 'block' }, lbl('Sold to'), dateInput(state._commEnd, v => state._commEnd = v)),
        el('label', { class: 'block' }, lbl('Lock date'), dateInput(state._commLock, v => state._commLock = v)))),
    el('div', { class: 'flex flex-col lg:flex-row gap-5 items-start' },
      el('div', { class: 'flex flex-col gap-4 w-full lg:w-[440px] lg:shrink-0' },   // left: the breakdown (fixed width)
        R.sold === 0 ? el('div', { class: 'card p-3 text-xs', style: { borderLeft: '3px solid var(--accent)' } },
          el('b', { style: { color: 'var(--text)' } }, 'No sales matched this rep in the window.'),
          el('span', { class: 'text-muted-' }, ' Try widening the dates, re-syncing, or confirming the rep’s FieldRoutes link on Settings → Users. Once accounts show up, map their service types to split the revenue.')) : null,
        breakdown, stats,
        // Transparency card: what the canonical gates removed and why —
        // these rows exist in the CRM but are NOT commissionable here.
        (() => {
          const g = R.gates;
          if (!g) return null;
          const money = (n) => '$' + Math.round(n || 0).toLocaleString();
          const parts = [
            g.global.n ? [g.global.n + ' billing artifact' + (g.global.n === 1 ? '' : 's') + ' (global excluded services)', g.global.rev] : null,
            g.source.n ? [g.source.n + ' from excluded lead sources', g.source.rev] : null,
            g.renewal.n ? [g.renewal.n + ' renewal-source sub' + (g.renewal.n === 1 ? '' : 's'), g.renewal.rev] : null,
            g.sns.n ? [g.sns.n + ' sold-not-started (initial never ran)', g.sns.rev] : null,
          ].filter(Boolean);
          if (!parts.length) return null;
          return el('div', { class: 'card p-3 text-xs', style: { borderLeft: '3px solid #A9441F' } },
            el('b', { style: { color: 'var(--text)' } }, 'Excluded from pay (' + (R.rawMatched - R.sold) + ' of ' + R.rawMatched + ' CRM rows): '),
            el('span', { class: 'text-muted-' }, parts.map(([t, v]) => t + ' · ' + money(v)).join(' — ') +
              '. Same rules as Indicators/Reporting (Settings → Configurations).'));
        })()),
      el('div', { class: 'flex flex-col gap-4 flex-1 w-full min-w-0' }, ratesPanel, manualPanel)));  // right: per-rep override + deductions (type rules live in Settings → Commissions)
}

// ── CRM Reconciliation ──────────────────────────────────────────────────────
// Match every sale logged in THIS app to the live FieldRoutes snapshot, using
// each rep's FieldRoutes employee-ID link. Surfaces "logged in the app but not
// in the CRM" (the office-staff integrity check) and, optionally, the reverse.
function reportingReconciliation() {
  const gate = reportingDataGate();
  if (gate) return gate;
  // Need the employee roster for the ID links.
  if (state.frRoster == null && !state._frRosterLoading) {
    loadFieldRoutesRoster().then(() => { if (state.view === 'reporting') mountApp(); });
  }
  const money = (n) => (typeof fmt !== 'undefined' && fmt.usd0) ? fmt.usd0(n) : ('$' + Math.round(n || 0).toLocaleString());
  const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

  const profiles = state.allProfiles || [];
  const roster = state.frRoster || [];
  const rosterById = new Map(roster.map(e => [e.employee_id, e]));
  const crmRows = state.reportingSubscriptions || [];

  // Date window for app sales (default 90 days).
  if (state._reconDays == null) state._reconDays = 90;
  const days = state._reconDays;
  const cutoff = days ? (Date.now() - days * 86400000) : 0;

  // rep profile → the set of all their FieldRoutes employee IDs (across offices).
  const repEmpIds = new Map();
  for (const p of profiles) {
    let row = frRosterRowForProfile(p) || (p.fieldroutes_employee_id ? rosterById.get(p.fieldroutes_employee_id) : null);
    if (!row) row = roster.find(e => e.email && _frNormEmail(e.email) === _frNormEmail(p.email))
                  || roster.find(e => _frRealName(e) === _frNormName(p.full_name));
    if (row) repEmpIds.set(p.id, new Set(String(row.employee_ids || row.employee_id || '').split(',').map(s => s.trim()).filter(Boolean)));
  }
  // CRM rows grouped by the selling employee ID.
  const crmByEmp = new Map();
  for (const r of crmRows) { const id = String(r.sold_by_id || '').trim(); if (!id) continue; if (!crmByEmp.has(id)) crmByEmp.set(id, []); crmByEmp.get(id).push(r); }

  const matchSale = (sale, empIds) => {
    let cands = [];
    for (const id of empIds) { const a = crmByEmp.get(id); if (a) cands = cands.concat(a); }
    if (!cands.length) return null;
    const cnum = String(sale.customer_number || '').trim();
    if (cnum) { const hit = cands.find(r => String(r.customer_id || '').trim() === cnum); if (hit) return hit; }
    const sn = nameKey(sale.customer_name);
    const sd = Date.parse(sale.sold_date);
    return cands.find(r => {
      const rn = nameKey([r.first_name, r.last_name].filter(Boolean).join(' '));
      if (!rn || rn !== sn) return false;
      const rd = Date.parse(r.sold_date || String(r.sold_at || '').slice(0, 10));
      if (isNaN(sd) || isNaN(rd)) return true;
      return Math.abs(sd - rd) <= 7 * 86400000;
    }) || null;
  };

  const matched = [], missing = [], unlinkable = [];
  for (const s of (state.allSales || [])) {
    if (cutoff && Date.parse(s.sold_date) < cutoff) continue;
    const empIds = repEmpIds.get(s.rep_id);
    if (!empIds || !empIds.size) { unlinkable.push(s); continue; }
    (matchSale(s, empIds) ? matched : missing).push(s);
  }
  const reconcilable = matched.length + missing.length;
  const matchPct = reconcilable ? Math.round((matched.length / reconcilable) * 100) : 0;
  const repName = (id) => (profiles.find(p => p.id === id) || {}).full_name || '—';
  const fmtD = (d) => { const t = Date.parse(d); return isNaN(t) ? (d || '—') : new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }); };

  const rangeBtns = el('div', { class: 'inline-flex rounded-xl border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...[[30, '30d'], [90, '90d'], [365, '1y'], [0, 'All']].map(([d, lbl]) => el('button', {
      class: 'px-2.5 py-1 text-[11px] font-semibold transition',
      style: days === d ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'transparent', color: 'var(--text)' },
      onclick: () => { state._reconDays = d; mountApp(); },
    }, lbl)));

  const card = (label, val, sub, color) => el('div', { class: 'card p-4 flex-1', style: { minWidth: '150px' } },
    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, label),
    el('div', { class: 'font-display text-3xl sm:text-4xl mt-1', style: color ? { color } : {} }, val),
    sub ? el('div', { class: 'text-[11px] text-muted- mt-0.5' }, sub) : null);

  const missingTable = el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' },
    el('table', { class: 'w-full text-sm whitespace-nowrap' },
      el('thead', { class: 'text-[10px] uppercase tracking-widest text-muted-' }, el('tr', {},
        el('th', { class: 'text-left px-4 py-3' }, 'Rep'),
        el('th', { class: 'text-left px-3 py-3' }, 'Customer'),
        el('th', { class: 'text-left px-3 py-3' }, 'Cust #'),
        el('th', { class: 'text-left px-3 py-3' }, 'Sold'),
        el('th', { class: 'text-right px-3 py-3' }, 'Value'),
        el('th', { class: 'text-left px-3 py-3' }, 'Audit'))),
      el('tbody', {},
        missing.length === 0
          ? el('tr', {}, el('td', { class: 'px-4 py-8 text-center text-xs text-muted- italic', colspan: 6 }, 'Every reconcilable app sale was found in FieldRoutes. 🎉'))
          : null,
        ...missing.slice().sort((a, b) => Date.parse(b.sold_date) - Date.parse(a.sold_date)).slice(0, 200).map(s => el('tr', { class: 'border-t border-' },
          el('td', { class: 'px-4 py-3 font-semibold' }, repName(s.rep_id)),
          el('td', { class: 'px-3 py-3' }, s.customer_name || '—'),
          el('td', { class: 'px-3 py-3 text-muted-' }, s.customer_number || '—'),
          el('td', { class: 'px-3 py-3 text-muted-' }, fmtD(s.sold_date)),
          el('td', { class: 'px-3 py-3 text-right tabular-nums' }, money(s.revenue_amount)),
          el('td', { class: 'px-3 py-3 text-muted-' }, s.audit_status || '—')))))));

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center justify-between flex-wrap gap-3' },
      el('div', {},
        el('h2', { class: 'text-lg font-bold' }, 'CRM Reconciliation'),
        el('p', { class: 'text-xs text-muted-' }, 'App-logged sales matched to FieldRoutes by each rep’s employee-ID link, then by customer number or name + date.')),
      rangeBtns),
    el('div', { class: 'flex gap-3 flex-wrap' },
      card('Reconcilable sales', reconcilable.toLocaleString(), 'Linked reps, in range', null),
      card('Matched in CRM', matched.length.toLocaleString(), matchPct + '% of reconcilable', 'var(--accent)'),
      card('Missing from CRM', missing.length.toLocaleString(), 'Logged in app, not found', missing.length ? '#DC2626' : null)),
    unlinkable.length
      ? el('div', { class: 'card p-3 text-xs text-muted-', style: { borderLeft: '3px solid var(--border-2)' } },
          el('b', { style: { color: 'var(--text)' } }, unlinkable.length.toLocaleString() + ' sale' + (unlinkable.length === 1 ? '' : 's')),
          ' skipped — the rep isn’t linked to a FieldRoutes employee yet. Link them on Settings → Users to include their sales here.')
      : null,
    el('div', { class: 'text-[11px] uppercase tracking-widest text-muted- font-semibold mt-1' }, 'Logged in app · not found in CRM'),
    missingTable,
    missing.length > 200 ? el('div', { class: 'text-[11px] text-muted-' }, 'Showing the 200 most recent of ' + missing.length.toLocaleString() + '.') : null);
}

// ──────────────────────────────────────────────────────────────────────────
// REPORTING · SERVICES — what we sell WHERE. Three reads (per Isaac):
//   1. Service Mix — every service type with Active / Cancelled counts.
//   2. Where a service lives — per-area counts + penetration for one service.
//   3. Add-on attach by area — % of customers holding 2+ subscriptions,
//      with the area's most common add-on, to spot where add-ons thrive.
// ──────────────────────────────────────────────────────────────────────────
function reportingServices() {
  const gate = reportingDataGate();
  if (gate) return gate;
  const { visible } = reportingFilters();
  const scope = reportingScope();
  const office = state.reportingOffice || 'all';
  const rows = reportingFilterByOffice(visible, office);
  const isActive = (r) => (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;
  const zip5 = (r) => String(r.zip_code || '').trim().slice(0, 5) || '—';
  const areaMode = state._svcAreaMode || 'office';
  const areaOf = (r) => areaMode === 'zip' ? zip5(r)
    : areaMode === 'county' ? ((r.county || '—') + (r.state ? ', ' + r.state : ''))
    : areaMode === 'state' ? (r.state || '—')
    : (r.office_name || '—');

  // ── Single pass: per-service totals, per-area totals, per-area-service ──
  const bySvc = new Map();          // svc → {a, c, arr}
  const byArea = new Map();         // area → {total, active}
  const byAreaSvc = new Map();      // area|svc → {a, c}
  const custSubs = new Map();       // customer → Set(svc)  (add-on analysis)
  const custArea = new Map();
  rows.forEach(r => {
    const svc = r.subscription || '—';
    const area = areaOf(r);
    const act = isActive(r);
    let s = bySvc.get(svc); if (!s) { s = { a: 0, c: 0, arr: 0 }; bySvc.set(svc, s); }
    act ? s.a++ : s.c++;
    if (act) s.arr += Number(r.annual_recurring_value) || 0;
    let ar = byArea.get(area); if (!ar) { ar = { total: 0, active: 0 }; byArea.set(area, ar); }
    ar.total++; if (act) ar.active++;
    const k = area + '|' + svc;
    let as = byAreaSvc.get(k); if (!as) { as = { a: 0, c: 0 }; byAreaSvc.set(k, as); }
    act ? as.a++ : as.c++;
    const cid = String(r.customer_id || '');
    if (cid && act) {
      let set = custSubs.get(cid); if (!set) { set = new Set(); custSubs.set(cid, set); }
      set.add(svc);
      custArea.set(cid, area);
    }
  });
  const svcList = [...bySvc.entries()].sort((x, y) => (y[1].a + y[1].c) - (x[1].a + x[1].c));
  const money0s = (v) => '$' + Math.round(v || 0).toLocaleString();

  // ── Controls ──
  const areaSel = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { state._svcAreaMode = e.target.value; mountApp(); },
  }, ...[['office', 'By Office'], ['county', 'By County'], ['zip', 'By Zip'], ['state', 'By State']]
    .map(([v, l]) => { const o = el('option', { value: v }, l); if (areaMode === v) o.selected = true; return o; }));
  const officeSel = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { state.reportingOffice = e.target.value; mountApp(); },
  },
    el('option', { value: 'all', selected: office === 'all' }, 'All Offices'),
    ...scope.offices.map(o => el('option', { value: o, selected: office === o }, o)));

  const drillSvc = (svc, areaFilter) => {
    const subset = rows.filter(r => (r.subscription || '—') === svc && (!areaFilter || areaOf(r) === areaFilter));
    openReportingDrillModal({ chartTitle: 'Service: ' + svc, sliceLabel: areaFilter ? areaFilter : 'All areas', rows: subset, formatValue: (v) => fmt.int(v) });
  };

  // ── Card 1 · Service Mix ──
  if (!state._svcSort) state._svcSort = { key: 'total', dir: 'desc' };
  const sSort = state._svcSort;
  const svcRows = svcList.map(([svc, s]) => ({ svc, a: s.a, c: s.c, total: s.a + s.c, arr: s.arr, cxl: (s.a + s.c) > 0 ? s.c / (s.a + s.c) : 0 }));
  svcRows.sort((x, y) => { const d = (x[sSort.key] < y[sSort.key] ? -1 : x[sSort.key] > y[sSort.key] ? 1 : 0); return sSort.dir === 'asc' ? d : -d; });
  const th = (key, label, tip) => el('th', {
    class: 'text-left py-2 font-semibold cursor-pointer select-none ' + (key === 'svc' ? 'px-3' : 'px-2'),
    style: sSort.key === key ? { color: 'var(--accent)', fontWeight: '800' } : {},
    title: tip || ('Sort by ' + label),
    onclick: () => { state._svcSort = { key, dir: sSort.key === key ? (sSort.dir === 'desc' ? 'asc' : 'desc') : (key === 'svc' ? 'asc' : 'desc') }; mountApp(); },
  }, label);
  const mixCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b border- flex items-center justify-between gap-2 flex-wrap' },
      el('div', {},
        el('h3', { class: 'text-sm font-bold' }, '🧾 Service Mix' + (office === 'all' ? '' : ' — ' + office)),
        el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } },
          fmt.int(rows.length) + ' subscriptions · click a service for its accounts')),
      configInfoBtn('Service Mix',
        'Every service type in the current scope with its Active and Cancelled subscription counts. Active = status Active with no cancel date; everything else counts as Cancelled/inactive. ARR sums the annual recurring value of ACTIVE subs only. Hidden services and excluded sources (Configurations) are filtered out, matching the rest of Reporting.')),
    el('div', { class: 'scroll-x', style: { maxHeight: '420px', overflowY: 'auto' } },
      el('table', { class: 'w-full text-xs tabular-nums' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-', style: { position: 'sticky', top: '0', background: 'var(--card)' } },
          el('tr', {}, th('svc', 'Service'), th('a', 'Active'), th('c', 'Cancelled'), th('total', 'Total'), th('cxl', 'Cancel %'), th('arr', 'Active ARR'))),
        el('tbody', {},
          ...svcRows.map(r => el('tr', {
            class: 'border-t border- cursor-pointer transition hover:brightness-95',
            onclick: () => drillSvc(r.svc),
          },
            el('td', { class: 'px-3 py-1.5 font-semibold truncate', style: { maxWidth: '260px' } }, r.svc),
            el('td', { class: 'px-2 py-1.5', style: { color: '#DF643A', fontWeight: '600' } }, fmt.int(r.a)),
            el('td', { class: 'px-2 py-1.5', style: { color: 'var(--text-muted)' } }, fmt.int(r.c)),
            el('td', { class: 'px-2 py-1.5 font-bold' }, fmt.int(r.total)),
            el('td', { class: 'px-2 py-1.5', style: r.cxl > 0.4 ? { color: '#DC2626', fontWeight: '700' } : { color: 'var(--text-muted)' } }, (r.cxl * 100).toFixed(1) + '%'),
            el('td', { class: 'px-2 py-1.5', style: { color: 'var(--text-muted)' } }, money0s(r.arr))))))));

  // ── Card 2 · Where a service lives ──
  const svcNames = svcList.map(([svc]) => svc);
  const selSvc = svcNames.includes(state._svcFocus) ? state._svcFocus : (svcNames[0] || '');
  const focusSel = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', maxWidth: '240px' },
    onchange: (e) => { state._svcFocus = e.target.value; mountApp(); },
  }, ...svcNames.map(sv => { const o = el('option', { value: sv }, sv); if (sv === selSvc) o.selected = true; return o; }));
  const areaRows = [...byArea.entries()]
    .map(([area, ar]) => {
      const as = byAreaSvc.get(area + '|' + selSvc) || { a: 0, c: 0 };
      return { area, a: as.a, c: as.c, n: as.a + as.c, book: ar.total, pen: ar.total > 0 ? (as.a + as.c) / ar.total : 0 };
    })
    .filter(r => r.n > 0)
    .sort((x, y) => y.n - x.n)
    .slice(0, 15);
  const maxPen = areaRows.reduce((m, r) => Math.max(m, r.pen), 0.0001);
  const whereCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b border- flex items-center justify-between gap-2 flex-wrap' },
      el('div', {},
        el('h3', { class: 'text-sm font-bold' }, '📍 Where It Lives'),
        el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } },
          'Top areas for the picked service — the bar is PENETRATION (share of that area\u2019s book), so hot zips stand out even when they\u2019re small')),
      el('div', { class: 'flex items-center gap-2' }, focusSel,
        configInfoBtn('Where It Lives',
          'For the selected service: the areas (by the grouping picked up top) with the most subscriptions of it, active + cancelled. Penetration = this service\u2019s subs ÷ ALL subs in that area — a 20% zip means one in five subscriptions there is this service. Click a row for those accounts.'))),
    el('div', { class: 'p-3 flex flex-col gap-1' },
      ...(areaRows.length ? areaRows.map(r => el('div', {
        class: 'py-1.5 px-2 -mx-1 rounded-lg cursor-pointer transition hover:brightness-95',
        onclick: () => drillSvc(selSvc, r.area),
        title: r.area + ': ' + fmt.int(r.n) + ' of ' + fmt.int(r.book) + ' subs in this area are ' + selSvc,
      },
        el('div', { class: 'flex items-center justify-between gap-2 text-xs' },
          el('span', { class: 'font-semibold truncate' }, r.area),
          el('span', { class: 'tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } },
            fmt.int(r.a) + ' active · ' + fmt.int(r.c) + ' cxl · ' + (r.pen * 100).toFixed(1) + '% of area')),
        el('div', { class: 'mt-1 rounded-full overflow-hidden', style: { height: '5px', background: 'var(--card-2)' } },
          el('div', { style: { width: Math.max(2, r.pen / maxPen * 100) + '%', height: '100%', background: 'var(--accent)', opacity: '.85' } })))) : [el('div', { class: 'p-6 text-center text-xs', style: { color: 'var(--text-muted)' } }, 'No subscriptions for this service in scope.')])));

  // ── Card 3 · Add-on attach by area ──
  const areaAttach = new Map();     // area → {cust, multi, addOns: Map}
  custSubs.forEach((set, cid) => {
    const area = custArea.get(cid) || '—';
    let a = areaAttach.get(area); if (!a) { a = { cust: 0, multi: 0, addOns: new Map() }; areaAttach.set(area, a); }
    a.cust++;
    if (set.size >= 2) {
      a.multi++;
      // every sub beyond the customer's biggest service counts as an add-on
      const arr = [...set];
      const primary = arr.reduce((best, sv) => ((bySvc.get(sv) || {}).a || 0) > ((bySvc.get(best) || {}).a || 0) ? sv : best, arr[0]);
      arr.forEach(sv => { if (sv !== primary) a.addOns.set(sv, (a.addOns.get(sv) || 0) + 1); });
    }
  });
  const attachRows = [...areaAttach.entries()]
    .map(([area, a]) => {
      const top = [...a.addOns.entries()].sort((x, y) => y[1] - x[1])[0];
      return { area, cust: a.cust, multi: a.multi, rate: a.cust > 0 ? a.multi / a.cust : 0, top: top ? top[0] + ' ×' + top[1] : '—' };
    })
    .filter(r => r.cust >= 25)
    .sort((x, y) => y.rate - x.rate);
  const companyAttach = (() => { let c = 0, m = 0; custSubs.forEach(set => { c++; if (set.size >= 2) m++; }); return c > 0 ? m / c : 0; })();
  const attachCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b border- flex items-center justify-between gap-2 flex-wrap' },
      el('div', {},
        el('h3', { class: 'text-sm font-bold' }, '➕ Add-On Attach by Area'),
        el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } },
          'Company attach rate: ' + (companyAttach * 100).toFixed(1) + '% of active customers hold 2+ subscriptions — areas above that are your add-on hotbeds')),
      configInfoBtn('Add-On Attach',
        'Per area: how many ACTIVE customers hold two or more subscriptions (attach rate), and the most common add-on there. A customer\u2019s \u201Cprimary\u201D is their most widely-sold service; everything else they hold counts as an add-on. Areas with fewer than 25 active customers are hidden. Green = above the company attach rate.')),
    el('div', { class: 'scroll-x', style: { maxHeight: '380px', overflowY: 'auto' } },
      el('table', { class: 'w-full text-xs tabular-nums' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-', style: { position: 'sticky', top: '0', background: 'var(--card)' } },
          el('tr', {},
            el('th', { class: 'text-left px-3 py-2 font-semibold' }, areaMode === 'zip' ? 'Zip' : areaMode === 'county' ? 'County' : areaMode === 'state' ? 'State' : 'Office'),
            el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Customers'),
            el('th', { class: 'text-left px-2 py-2 font-semibold' }, '2+ Subs'),
            el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Attach %'),
            el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Top Add-On'))),
        el('tbody', {},
          ...attachRows.map(r => el('tr', { class: 'border-t border-' },
            el('td', { class: 'px-3 py-1.5 font-semibold' }, r.area),
            el('td', { class: 'px-2 py-1.5', style: { color: 'var(--text-muted)' } }, fmt.int(r.cust)),
            el('td', { class: 'px-2 py-1.5' }, fmt.int(r.multi)),
            el('td', { class: 'px-2 py-1.5 font-bold', style: { color: r.rate >= companyAttach ? '#DF643A' : 'var(--text-muted)' } }, (r.rate * 100).toFixed(1) + '%'),
            el('td', { class: 'px-2 py-1.5 truncate', style: { maxWidth: '220px', color: 'var(--text-muted)' } }, r.top)))))));

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Group areas'),
      areaSel, officeSel),
    mixCard,
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' }, whereCard, attachCard));
}

