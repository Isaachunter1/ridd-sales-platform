// ┌─ src/20-reporting-auditing.js ─────────────────────────────────────────────────────
// │ Reporting → Auditing sub-tab (D2D account audits, audit report, exports).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
// REPORTING SUB-TAB: AUDITING — Door-to-Door account audits, derived LIVE
// from the Customer Flags column of the REPORTING snapshot (the Customer
// Report uploaded on this tab — make sure the export includes Flags):
//   'Failed Audit' flag → failed · 'Passed Audit' → passed ·
//   'No Audit' / no audit flag → pending (counts as passed for the
//   effective pass rate). 'Sent to Collections' powers the collections
//   split; cancels (minus ROR / Sold-Not-Started churn) power attrition.
// ════════════════════════════════════════════════════════════════════════
function _auditStatusOf(flagsStr) {
  const f = (flagsStr || '').toLowerCase();
  if (f.includes('failed audit')) return 'failed';
  if (f.includes('passed audit')) return 'passed';
  if (f.includes('no audit'))     return 'noaudit';
  return 'pending';
}

function reportingAuditing() {
  const gate = reportingDataGate();
  if (gate) return gate;
  const rowsAll = state.reportingSubscriptions || [];
  const d2d = rowsAll.filter(r => (r.subscription_source || '').trim() === 'Door to Door');
  const anyFlags = d2d.some(r => r.customer_flags && String(r.customer_flags).trim());

  // Reportable cancel = has a cancel date and isn't ROR / Sold-Not-Started
  // churn (reason match, or a no-reason cancel within 3 days of the sale).
  const isExcludableRow = (r) => {
    const reason = r.subscription_cancellation_reason || '';
    if (_ROR_REASON_RE.test(reason) || _SNS_REASON_RE.test(reason)) return true;
    if (reason.trim()) return false;
    if (!r.sold_date || !r.subscription_date_canceled) return false;
    const d = (new Date(r.subscription_date_canceled) - new Date(r.sold_date)) / 86400000;
    return d >= 0 && d <= 3;
  };
  // 3-day ROR ONLY (a Right-of-Rescission cancel — explicit reason, or a
  // no-reason cancel within 3 days of the sale). Sold-Not-Started is NOT a ROR.
  // Tracked separately so the player card can show attrition with vs. without RORs.
  const isRorRow = (r) => {
    const reason = r.subscription_cancellation_reason || '';
    if (_SNS_REASON_RE.test(reason)) return false;     // Sold-Not-Started, not a ROR
    if (_ROR_REASON_RE.test(reason)) return true;       // explicit ROR reason
    if (reason.trim()) return false;                    // some other reason → not a ROR
    if (!r.sold_date || !r.subscription_date_canceled) return false;
    const d = (new Date(r.subscription_date_canceled) - new Date(r.sold_date)) / 86400000;
    return d >= 0 && d <= 3;
  };

  // Team lookup from Manage Teams (indicators), but format-agnostic: the
  // Customer Report's "Sold By" is "Last, First" while Manage Teams may key a
  // rep as "First Last" (or vice-versa). Index every assignment by a sorted
  // token signature so either spelling resolves to the same team.
  const _teamMap = (typeof _activeTeamMap === 'function') ? _activeTeamMap() : (state._indicatorRepTeam || {});
  const _nameSig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const _teamBySig = {};
  for (const k of Object.keys(_teamMap || {})) { if (_teamMap[k]) _teamBySig[_nameSig(k)] = _teamMap[k]; }
  const teamForRep = (repName) => (typeof getRepTeam === 'function' && getRepTeam(repName)) || _teamBySig[_nameSig(repName)] || '';

  // ── One record per account (flags are customer-level) ──
  const acct = new Map();
  for (const r of d2d) {
    const id = (r.customer_id || '').trim();
    if (!id) continue;
    let a = acct.get(id);
    if (!a) {
      const repName = _cleanRepName(getCanonicalRepName((r.sold_by || 'Unknown').trim()));
      a = {
        customerId: id,
        customer: [r.last_name, r.first_name].filter(Boolean).join(', '),
        flags: (r.customer_flags || '').trim(),
        rep: repName,
        team: teamForRep(repName) || 'Unassigned',
        office: (r.office_name || 'UNKNOWN').toUpperCase().trim(),
        status: _auditStatusOf(r.customer_flags),
        collections: false,
        cancelled: false,
        serviced: false,
        date: null,
        soldRev: 0, servicedRev: 0, activeRev: 0, cancelledRev: 0, agingRev: 0, frozenRev: 0, rorRev: 0,
        exclRev: 0, exclCancelRev: 0, otsCancelRev: 0,
        subs: 0, servicedSubs: 0, cancelledSubs: 0, collSubs: 0, rows: [],
      };
      acct.set(id, a);
    }
    a.rows.push(r); // keep raw subscription rows so the player card can drill into any bucket
    // Sold = every subscription row tied to the rep (NOT deduped to one per
    // customer). A customer with 2 subs counts as 2 sold; the customer-level
    // audit flag applies to each of their subs so the buckets still tie out.
    a.subs += 1;
    if (r.subscription_date_canceled && !isExcludableRow(r)) { a.cancelled = true; a.cancelledSubs += 1; }
    // Collections = cancelled with reason "Delinquent" (per comp rules — the
    // Sent to Collections flag is NOT used here).
    if (/delinquen/i.test(r.subscription_cancellation_reason || '')) { a.collections = true; a.collSubs += 1; }
    const ds = r.sold_date || r.initial_service;
    const d = ds ? new Date(ds + (String(ds).length === 10 ? 'T00:00' : '')) : null;
    if (d && !isNaN(d) && (!a.date || d < a.date)) a.date = d;
    // Revenue rollups (per subscription row):
    //   Serviced  = subs that have received a service (initial service / completed > 0)
    //   Active    = active sub (not cancelled) under 7 days past due
    //   Aging     = active sub (not cancelled) 7+ days past due
    //   Cancelled = a real cancel (cancel date, excluding ROR / Sold-Not-Started)
    const cv = Number(r.subscription_contract_value) || 0;
    a.soldRev += cv;
    const serviced = (Number(r.subscription_completed_services) || 0) > 0 || !!r.initial_service;
    if (serviced) { a.servicedRev += cv; a.serviced = true; a.servicedSubs += 1; }
    // Serviced revenue partitions cleanly into Active + Cancelled + Frozen/Other,
    // so Serviced − Cancelled − Frozen = Active exactly (and with no frozen, = Active):
    //   Active    = serviced, status Active, not cancelled  (Aging = 7+ dpd slice of it)
    //   Cancelled = serviced, real cancel (ROR / Sold-Not-Started excluded)
    //   Frozen    = serviced, not a real cancel, status not Active (on hold / frozen)
    const subActive = (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;
    if (serviced) {
      // Cancelled = serviced then cancelled, INCLUDING 3-day RORs (a ROR that got
      // an initial service before it was rescinded is still a serviced cancel).
      if (r.subscription_date_canceled) a.cancelledRev += cv;
      else if (subActive) { a.activeRev += cv; a.activeSubsN = (a.activeSubsN || 0) + 1; if ((Number(r.days_past_due) || 0) >= reportingAgingDays()) a.agingRev += cv; }
      else a.frozenRev += cv;
    }
    // 3-day ROR revenue that sits INSIDE Serviced (initial done, then rescinded
    // within 3 days) — non-commissionable; surfaced so reps see it transparently.
    if (serviced && isRorRow(r)) a.rorRev += cv;
    // OTS + ROR exclusion bucket (per Isaac): a completed one-time service
    // closing out isn't attrition — grouped with the 3-day RORs so the clean
    // attrition rate drops both from BOTH sides of the ratio.
    const _otsRowX = /^\\s*one[\\s-]?time/i.test(String(r.subscription || ''));
    if (serviced && (isRorRow(r) || _otsRowX)) {
      a.exclRev += cv;
      if (r.subscription_date_canceled) a.exclCancelRev += cv;
    }
    if (serviced && _otsRowX && r.subscription_date_canceled) a.otsCancelRev += cv;
    // Pending-eligible = actually needs an audit: NOT frozen status, and not a
    // pre-service cancel (sold then cancelled before any service ran). Drives the
    // Pending count — frozen / on-hold and pre-service cancels never need auditing.
    if ((r.subscription_status || '').toLowerCase() !== 'frozen' && !(r.subscription_date_canceled && !serviced)) {
      a.pendingSubs = (a.pendingSubs || 0) + 1;
    }
  }

  // ── Filters: sold-date range + branch ──
  if (!state.auditRange) state.auditRange = 'this_year';
  if (!state.auditOffice) state.auditOffice = 'all';
  const dataYears = [...new Set([...acct.values()].map(a => a.date ? String(a.date.getFullYear()) : null).filter(Boolean))].sort().reverse();
  const curYear = new Date().getFullYear();
  const presetOpts = [
    ['this_month', 'This Month'], ['last_month', 'Last Month'],
    ['this_year', 'This Year'], ['last_year', 'Last Year'],
    ...dataYears.filter(y => Number(y) < curYear - 1).map(y => ['year:' + y, y]),
    ['all_time', 'All Time'], ['custom', 'Custom…'],
  ];
  const preset = presetOpts.some(([v]) => v === state.auditRange) ? state.auditRange : 'this_year';
  const bounds = indicatorRangeBounds(preset, { start: state.auditCustomStart, end: state.auditCustomEnd });
  const rangeLabel = preset === 'custom' ? (bounds.start + ' → ' + bounds.end) : indicatorPresetLabel(preset);
  const inRange = (a) => {
    if (preset === 'all_time') return true;
    if (!a.date || isNaN(a.date)) return false;
    const iso = a.date.toISOString().slice(0, 10);
    return iso >= bounds.start && iso <= bounds.end;
  };
  const offices = [...new Set([...acct.values()].map(a => a.office))].sort();
  const teamsList = [...new Set([...acct.values()].map(a => a.team))].sort();
  if (!state.auditTeam) state.auditTeam = 'all';
  const offFilter = state.auditOffice;
  const teamFilter = state.auditTeam;

  // ── Aggregate per rep / per branch ──
  const mk = () => ({ sold: 0, serviced: 0, activeSubs: 0, passed: 0, failed: 0, pending: 0, noaudit: 0,
    soldRev: 0, servicedRev: 0, activeRev: 0, cancelledRev: 0, agingRev: 0, frozenRev: 0, rorRev: 0,
    exclRev: 0, exclCancelRev: 0, otsCancelRev: 0,
    attr: { passed: [0, 0], failed: [0, 0], pending: [0, 0], noaudit: [0, 0] },
    coll: { passed: [0, 0], failed: [0, 0], pending: [0, 0], noaudit: [0, 0] } });
  const reps = {}, offs = {}, teams = {}, tot = mk();
  // Per-rep office/team so the Rep column can show where each rep belongs.
  const repMeta = {};
  for (const a of acct.values()) {
    if (!inRange(a)) continue;
    if (offFilter !== 'all' && a.office !== offFilter) continue;
    if (teamFilter !== 'all' && a.team !== teamFilter) continue;
    const r = reps[a.rep] || (reps[a.rep] = mk());
    const o = offs[a.office] || (offs[a.office] = mk());
    const t = teams[a.team] || (teams[a.team] = mk());
    const meta = repMeta[a.rep] || (repMeta[a.rep] = { officeCounts: {}, team: a.team });
    meta.officeCounts[a.office] = (meta.officeCounts[a.office] || 0) + 1;
    meta.team = a.team;
    for (const b of [r, o, t, tot]) {
      b.sold += a.subs; b.serviced += a.servicedSubs; b.activeSubs += (a.activeSubsN || 0);
      if (a.status === 'pending') b.pending += (a.pendingSubs || 0); // frozen + pre-service cancels need no audit
      else b[a.status] += a.subs;
      b.soldRev += a.soldRev; b.servicedRev += a.servicedRev; b.activeRev += a.activeRev; b.cancelledRev += a.cancelledRev; b.agingRev += a.agingRev; b.frozenRev += a.frozenRev; b.rorRev += a.rorRev;
      b.exclRev += a.exclRev; b.exclCancelRev += a.exclCancelRev; b.otsCancelRev += a.otsCancelRev;
      b.attr[a.status][1] += a.subs; b.attr[a.status][0] += a.cancelledSubs;
      b.coll[a.status][1] += a.subs; b.coll[a.status][0] += a.collSubs;
    }
  }
  // A rep's primary office = the one most of their in-range accounts came from.
  const repOfficeOf = (rep) => { const c = (repMeta[rep] || {}).officeCounts || {}; const e = Object.entries(c); return e.length ? e.sort((x, y) => y[1] - x[1])[0][0] : ''; };
  const repTeamOf = (rep) => (repMeta[rep] || {}).team || 'Unassigned';

  const rate = (pair) => pair[1] > 0 ? pair[0] / pair[1] : null;
  const GOOD = 'rgba(223,100,58,.18)', BAD = 'rgba(220,38,38,.14)';
  const passShade = (p) => p == null ? '' : (p >= 0.85 ? GOOD : p < 0.65 ? BAD : '');

  // ── UI bits ──
  const sel = (value, opts, onchange, title) => el('select', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer', title: title || '', onchange,
  }, ...opts.map(([v, lab]) => { const o = el('option', { value: v }, lab); if (v === value) o.selected = true; return o; }));

  // Everything on this tab is left-justified per request.
  const th = (lab) => el('th', { class: 'px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap text-left', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } }, lab);
  const td = (val, opts = {}) => el('td', { class: 'px-2.5 py-1.5 tabular-nums text-xs whitespace-nowrap text-left' + (opts.bold ? ' font-bold' : ''), style: opts.sticky ? { background: opts.bg || 'var(--card)', position: 'sticky', left: 0, zIndex: 1, boxShadow: '1px 0 0 var(--border)' } : { background: opts.bg || 'transparent' } }, val);
  const money = (v) => v ? '$' + Math.round(v).toLocaleString() : '—';

  // Player-card drill-in: click any rep / team / branch row to see its full
  // audit + production + revenue profile in one popup.
  const openAuditCardModal = (name, s, kind, org) => {
    // No Audit counts toward Passed (exempt = not a failure); Pending excluded.
    const passBase = s.passed + s.failed + s.noaudit;
    const passPct = passBase > 0 ? (s.passed + s.noaudit) / passBase : null;
    // Revenue waterfall: Active = serviced AND active (subset of Serviced; includes Aging).
    const activeRev = s.activeRev;
    const rorRev = s.rorRev || 0;                              // serviced 3-day ROR portion (now inside Cancelled)
    const servExcl = s.servicedRev - (s.exclRev || 0);         // serviced revenue with RORs + one-time services removed
    const attrExclRor = servExcl > 0 ? (s.cancelledRev - (s.exclCancelRev || 0)) / servExcl : null;   // ROR + OTS removed from both sides
    const attrInclRor = s.servicedRev > 0 ? s.cancelledRev / s.servicedRev : null;          // RORs counted (already in Cancelled)
    const cancelIfAging = s.servicedRev > 0 ? (s.cancelledRev + s.agingRev) / s.servicedRev : null;
    const activeRetention = s.servicedRev > 0 ? activeRev / s.servicedRev : null;
    const aP = rate(s.attr.passed), aF = rate(s.attr.failed);
    const soldSvc = s.sold > 0 ? s.serviced / s.sold : null;
    const kindLabel = kind === 'rep' ? 'Rep' : kind === 'team' ? 'Team' : 'Branch';
    const _meta = (typeof reportingActiveSnapshotMeta === 'function') ? reportingActiveSnapshotMeta() : null;
    const asOf = _meta && _meta.uploaded_at ? new Date(_meta.uploaded_at).toLocaleDateString() : null;
    const pctS = (p) => p == null ? '—' : (p * 100).toFixed(1) + '%';
    const good = '#DF643A', bad = '#DC2626';
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const tile = (label, val, sub, color, onClick) => el('div', {
        class: 'rounded-xl p-3' + (onClick ? ' cursor-pointer hover:brightness-95 transition' : ''),
        style: { background: 'var(--card-2)' }, onclick: onClick || undefined,
        title: onClick ? 'Click to see these customers' : undefined,
      },
      el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-xl font-black tabular-nums mt-0.5', style: color ? { color } : {} }, val),
      sub ? el('div', { class: 'text-[10px] text-muted- mt-0.5' }, sub) : null);
    // ── Drill: gather THIS entity's raw subscription rows (same filters that
    // built `s`), then a clicked tile opens the windowed customer list. ──
    const entityAccts = [...acct.values()].filter(a => {
      if (!inRange(a)) return false;
      if (offFilter !== 'all' && a.office !== offFilter) return false;
      if (teamFilter !== 'all' && a.team !== teamFilter) return false;
      return kind === 'rep' ? a.rep === name : kind === 'team' ? a.team === name : a.office === name;
    });
    const entityRows = entityAccts.flatMap(a => a.rows || []);
    const _svc = (r) => (Number(r.subscription_completed_services) || 0) > 0 || !!r.initial_service;
    const _act = (r) => (r.subscription_status || '').toLowerCase() === 'active' && !r.subscription_date_canceled;
    const _stat = (r) => (typeof _auditStatusOf === 'function') ? _auditStatusOf(r.customer_flags) : '';
    const drill = (label, pred) => () => {
      const rows = entityRows.filter(pred);
      if (!rows.length) return;
      openReportingDrillModal({ chartTitle: name + ' — ' + label, sliceLabel: fmt.int(rows.length) + ' subscription' + (rows.length === 1 ? '' : 's'), rows, formatValue: money });
    };
    const group = (title, tiles) => el('div', {},
      el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, title),
      el('div', { class: 'grid grid-cols-2 sm:grid-cols-3 gap-2' }, ...tiles));
    const card = el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
      el('div', { class: 'p-5 pb-3 flex items-start justify-between gap-3', style: { borderBottom: '1px solid var(--border)' } },
        el('div', {},
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--accent)' } }, kindLabel),
          el('h2', { class: 'text-xl font-bold mt-0.5' }, name),
          // (office · team line hidden — multi-market attribution confused reps)
          asOf ? el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-subtle)' } }, 'As of ' + asOf) : null),
        el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
      el('div', { class: 'p-5 overflow-auto flex flex-col gap-4' },
        group('Production', [
          tile('Sold', fmt.int(s.sold), null, null, drill('Sold', () => true)),
          tile('Serviced', fmt.int(s.serviced), null, null, drill('Serviced', _svc)),
          tile('Sold → Service', pctS(soldSvc), null, soldSvc == null ? null : (soldSvc >= 0.85 ? good : soldSvc < 0.65 ? bad : null)),
        ]),
        group('Audit', [
          tile('Pass %', pctS(passPct), passBase + ' audited (incl. no-audit)', passPct == null ? null : (passPct >= 0.85 ? good : passPct < 0.65 ? bad : null)),
          tile('Passed', fmt.int(s.passed), null, good, drill('Passed', r => _stat(r) === 'passed')),
          tile('Failed', fmt.int(s.failed), null, s.failed > 0 ? bad : null, drill('Failed', r => _stat(r) === 'failed')),
          tile('No Audit', fmt.int(s.noaudit), 'counts as passed', null, drill('No Audit', r => _stat(r) === 'noaudit')),
          tile('Pending', fmt.int(s.pending), null, null, drill('Pending', r => _stat(r) === 'pending' && (r.subscription_status || '').toLowerCase() !== 'frozen' && !(r.subscription_date_canceled && !_svc(r)))),
          tile('Attrition on Audits: Pass / Fail', pctS(aP) + ' / ' + pctS(aF)),
        ]),
        group('Revenue · contract value  (Serviced = Active + Cancelled)', [
          tile('Sold', money(s.soldRev), 'all sold (incl. pre-service)', null, drill('Sold revenue', () => true)),
          tile('Serviced', money(s.servicedRev), 'received an initial service', null, drill('Serviced revenue', _svc)),
          tile('Active', money(activeRev), 'serviced & active · incl. aging', null, drill('Active', r => _svc(r) && _act(r))),
          tile('Cancelled', money(s.cancelledRev), 'serviced then cancelled · incl. 3-day ROR', s.cancelledRev > 0 ? bad : null, drill('Cancelled', r => _svc(r) && !!r.subscription_date_canceled)),
          tile('Cancelled · 3-Day ROR', money(rorRev), 'right-of-rescission slice of Cancelled', rorRev > 0 ? bad : null, drill('3-Day ROR', r => _svc(r) && !!r.subscription_date_canceled && typeof _reporting3dayRor === 'function' && _reporting3dayRor(r))),
          tile('Cancelled · One-Time', money(s.otsCancelRev || 0), 'completed one-time services — not attrition', null, drill('One-time services (cancelled)', r => _svc(r) && !!r.subscription_date_canceled && /^\\s*one[\\s-]?time/i.test(String(r.subscription || '')))),
          tile('Aging', money(s.agingRev), 'at-risk slice of Active', s.agingRev > 0 ? bad : null, drill('Aging', r => _svc(r) && _act(r) && (Number(r.days_past_due) || 0) >= reportingAgingDays())),
        ]),
        group('Attrition · of serviced', [
          // Fixed identity colors (not thresholds): green = the headline
          // excl-ROR number, black = incl-ROR, yellow = the aging what-if.
          tile('Attrition · excl. ROR + OTS', pctS(attrExclRor), 'cancelled ÷ serviced (3-day RORs + one-time services removed from both sides)', good),
          tile('Attrition · incl. 3-day ROR', pctS(attrInclRor), 'cancelled ÷ serviced (incl. ROR + one-time)', 'var(--text)'),
          tile('If aging churns', pctS(cancelIfAging), '(cancelled + aging) ÷ serviced', '#D97706'),
          tile('Active retention', pctS(activeRetention), 'active ÷ serviced', activeRetention == null ? null : (activeRetention >= 0.85 ? good : activeRetention < 0.65 ? bad : null)),
        ]),
        // ── "True Attrition" bar (per Isaac) — same definition as the rep
        // player card and the Retention tab: cancels EXCLUDING 3-day RORs,
        // one-time services and renewals (removed from BOTH sides), PLUS
        // aging actives counted as churn. Contract-value weighted; counts drill.
        (() => {
          const _cv = (r) => Number(r.subscription_contract_value) || 0;
          const _rorT = (r) => typeof _reporting3dayRor === 'function' && _reporting3dayRor(r);
          const _otsT = (r) => /^\s*one[\s-]?time/i.test(String(r.subscription || ''));
          const _renT = (r) => /^renewal/i.test(String(r.subscription_cancellation_reason || '').trim()) || (typeof reportingSourceClass === 'function' && reportingSourceClass(r.subscription_source) === 'renewal');
          const _exclR = (typeof reportingExcludedCancelReasons === 'function') ? reportingExcludedCancelReasons() : new Set();
          const _cxlT = (r) => !!r.subscription_date_canceled && !_act(r) && !_exclR.has(_normCancelReason(r.subscription_cancellation_reason));
          const _agingT = (r) => _act(r) && (Number(r.days_past_due) || 0) >= (typeof reportingAgingDays === 'function' ? reportingAgingDays() : 60);
          const _tx = (r) => _svc(r) && !_rorT(r) && !_otsT(r) && !_renT(r);
          let tSvc = 0, tCxl = 0, tAging = 0, nSvc = 0, nCxl = 0, nAging = 0;
          for (const r of entityRows) { if (!_tx(r)) continue; const cv = _cv(r); tSvc += cv; nSvc++; if (_cxlT(r)) { tCxl += cv; nCxl++; } else if (_agingT(r)) { tAging += cv; nAging++; } }
          if (!(tSvc > 0)) return null;
          const rate = (tCxl + tAging) / tSvc, kept = tSvc - tCxl - tAging;
          const seg = (v, color, label) => v > 0 ? el('div', { style: { width: Math.max(0, Math.min(100, v / tSvc * 100)).toFixed(2) + '%', background: color, height: '100%' }, title: label + ' — ' + money(v) + ' (' + (v / tSvc * 100).toFixed(1) + '%)' }) : null;
          const cnt = (label, n, pred) => el('button', { class: 'text-[10px] font-semibold hover:underline', style: { color: 'var(--text-muted)' }, onclick: drill(label, r => _tx(r) && pred(r)) }, label + ' ' + fmt.int(n));
          return el('div', { class: 'rounded-xl p-3', style: { background: 'var(--card-2)' } },
            el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
              el('div', {},
                el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'True attrition · excl. ROR + OTS + renewals · aging counts as churn'),
                el('div', { class: 'text-[10px] text-muted- mt-0.5' }, '(cancelled ' + money(tCxl) + ' + aging ' + money(tAging) + ') ÷ ' + money(tSvc) + ' serviced')),
              el('div', { class: 'text-xl font-black tabular-nums', style: { color: rate >= 0.15 ? bad : rate < 0.08 ? good : '#D97706' } }, pctS(rate))),
            el('div', { class: 'flex overflow-hidden rounded-full mt-2', style: { height: '10px', background: 'var(--border)' } }, seg(tCxl, bad, 'Cancelled'), seg(tAging, '#D97706', 'Aging'), seg(kept, good, 'Kept')),
            el('div', { class: 'flex items-center gap-3 mt-1.5 flex-wrap' }, cnt('Serviced', nSvc, () => true), cnt('Cancelled', nCxl, _cxlT), cnt('Aging', nAging, _agingT)));
        })()));
    overlay.append(card);
    document.body.append(overlay);
  };

  // opts.org = { office, team } renders the two org columns (rep table only).
  const statRow = (name, s, opts = {}) => {
    const auditedN = s.passed + s.failed;
    const passBase = s.passed + s.failed + s.noaudit;
    const passPct = passBase > 0 ? (s.passed + s.noaudit) / passBase : null;
    const activeRev = s.activeRev;
    const aP = rate(s.attr.passed), aF = rate(s.attr.failed);
    // TOTAL row: uniform background — per-cell tints on the last row bled
    // past the card's rounded clip and looked like a stray extra row.
    const td0 = td;
    const td_ = (val, o = {}) => opts.total ? td0(val, { ...o, bg: 'var(--card-2)' }) : td0(val, o);
    return el('tr', {
      class: 'border-t' + (opts.total ? '' : ' cursor-pointer hover:brightness-95 transition'),
      style: { borderColor: 'var(--border)', background: opts.total ? 'var(--card-2)' : 'transparent' },
      title: opts.total ? '' : 'Click for the ' + (opts.kind === 'rep' ? 'rep' : opts.kind === 'team' ? 'team' : 'branch') + ' card',
      onclick: opts.total ? undefined : () => openAuditCardModal(name, s, opts.kind, opts.org),
    },
      td_(name, { bold: !!opts.total, sticky: true }),

      td_(fmt.int(s.sold)),
      td_(fmt.int(s.serviced)),
      td_(fmt.int(s.activeSubs)),
      td_(s.sold > 0 ? (s.serviced / s.sold * 100).toFixed(1) + '%' : '—'),
      td_(fmt.int(auditedN)),
      td_(fmt.int(s.passed), { bg: 'rgba(223,100,58,.08)' }),
      td_(fmt.int(s.failed), { bg: s.failed > 0 ? 'rgba(220,38,38,.08)' : 'transparent' }),
      td_(fmt.int(s.noaudit)),
      td_(fmt.int(s.pending)),
      td_(money(s.soldRev)),
      td_(money(s.servicedRev)),
      td_(money(activeRev)),
      td_(money(s.cancelledRev), { bg: s.cancelledRev > 0 ? 'rgba(220,38,38,.06)' : 'transparent' }),
      td_(money(s.agingRev), { bg: s.agingRev > 0 ? 'rgba(220,38,38,.06)' : 'transparent' }),
      td_(passPct == null ? '—' : (passPct * 100).toFixed(1) + '%', { bg: passShade(passPct), bold: true }),
      td_(aP == null ? '—' : (aP * 100).toFixed(1) + '%'),
      td_(aF == null ? '—' : (aF * 100).toFixed(1) + '%', { bg: aF != null && aP != null && aF > aP ? 'rgba(220,38,38,.08)' : 'transparent' }),
    );
  };
  // Value extractor for each sortable column. Percent/attrition use -1 for
  // "no data" so blanks sort to the bottom. Name/Office/Team sort as text.
  const sortVal = (id, name, s) => {
    switch (id) {
      case 'name':     return name;
      case 'office':   return repOfficeOf(name);
      case 'team':     return repTeamOf(name);
      case 'sold':     return s.sold;
      case 'serviced': return s.serviced;
      case 'activeSubs': return s.activeSubs;
      case 'soldServiced': return s.sold > 0 ? s.serviced / s.sold : -1;
      case 'audited':  return s.passed + s.failed;
      case 'passed':   return s.passed;
      case 'failed':   return s.failed;
      case 'pending':  return s.pending;
      case 'noaudit':  return s.noaudit;
      case 'passpct':  { const b = s.passed + s.failed + s.noaudit; return b > 0 ? (s.passed + s.noaudit) / b : -1; }
      case 'attrP':    { const r = rate(s.attr.passed); return r == null ? -1 : r; }
      case 'attrF':    { const r = rate(s.attr.failed); return r == null ? -1 : r; }
      case 'servicedRev': return s.servicedRev;
      case 'soldRev':     return s.soldRev;
      case 'activeRev':   return s.activeRev;
      case 'cancelledRev':return s.cancelledRev;
      case 'frozenRev':   return s.frozenRev;
      case 'agingRev':    return s.agingRev;
      default:            return 0;
    }
  };
  // kind 'rep' adds Office + Team columns (pulled per rep); both kinds show
  // the Total / Active / Aging revenue columns. Click any header to sort.
  const _phoneAud = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
  const statTable = (label, entries, note, kind, headerRight) => {
    const cols = [
      { id: 'name', label: kind === 'rep' ? 'Rep' : (kind === 'team' ? 'Team' : 'Branch'), tip: kind === 'rep' ? 'Sales rep (canonical name).' : (kind === 'team' ? 'Team from Manage Teams (current Team Year). "Unassigned" = no team set.' : 'Branch / office.') },
      // (Office/Team columns removed — the table filters below cover them;
      // the rep card modal still shows both.)
      { id: 'sold', label: 'Sold', tip: 'EVERY subscription sold in range (a customer with 2 subs counts as 2). Passed, failed, pending and no-audit all included. D2D production only.' },
      { id: 'serviced', label: 'Serviced', tip: 'Subscriptions that have been serviced — an initial service / at least one completed service.' },
      { id: 'activeSubs', label: 'Active', tip: 'Count of serviced subscriptions that are still active (not cancelled) — the unit behind Active Rev.' },
      { id: 'soldServiced', label: 'Sold/Serviced', tip: 'Of subscriptions sold, the share that received an initial service — serviced ÷ sold. 89% = 89% of sold subs have been serviced; the rest are sold but not yet serviced.' },
      { id: 'audited', label: 'Audited', tip: 'Subscriptions with a final audit result = Passed + Failed. (Pending and No Audit are not yet audited.)' },
      { id: 'passed', label: 'Passed', tip: 'Accounts flagged "Passed Audit".' },
      { id: 'failed', label: 'Failed', tip: 'Accounts flagged "Failed Audit".' },
      { id: 'noaudit', label: 'No Audit', tip: 'Accounts explicitly flagged "No Audit" — exempt from auditing.' },
      { id: 'pending', label: 'Pending', tip: 'No audit result yet — awaiting audit (no Passed / Failed / No-Audit flag). Pre-service cancels are excluded — they never need an audit.' },
      { id: 'soldRev', label: 'Sold Rev', tip: 'Contract value across ALL sold subscriptions (everything, regardless of service or status).' },
      { id: 'servicedRev', label: 'Serviced Rev', tip: 'Contract value of subscriptions that received an initial service. Splits into Active + Cancelled + Frozen.' },
      { id: 'activeRev', label: 'Active Rev', tip: 'Contract value of subscriptions that were SERVICED and are still active (not cancelled). Always ≤ Serviced Rev. Includes aging.' },
      { id: 'cancelledRev', label: 'Cancelled Rev', tip: 'Contract value of SERVICED subscriptions that later cancelled — includes 3-day RORs that were serviced before being rescinded. Serviced = Active + Cancelled.' },
      { id: 'agingRev', label: 'Aging Rev', tip: 'Contract value of serviced, active subscriptions 7+ days past due — the at-risk slice inside Active.' },
      { id: 'passpct', label: 'Pass %', tip: '(Passed + No Audit) ÷ (Passed + Failed + No Audit). No-Audit counts as passed; Pending excluded.' },
      { id: 'attrP', label: 'Attrition · Passed', tip: 'Of passed-audit accounts, the share with a reportable cancel (ROR / Sold-Not-Started excluded).' },
      { id: 'attrF', label: 'Attrition · Failed', tip: 'Of failed-audit accounts, the share with a reportable cancel (ROR / Sold-Not-Started excluded).' },
    ];
    if (!state.auditSort) state.auditSort = {};
    const sortState = state.auditSort[kind] || { key: 'sold', dir: 'desc' };
    const setSort = (key) => {
      const cur = state.auditSort[kind] || { key: 'sold', dir: 'desc' };
      const dir = cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc')
        : (key === 'name' || key === 'office' || key === 'team' ? 'asc' : 'desc');
      state.auditSort[kind] = { key, dir };
      mountApp();
    };
    const sorted = [...entries].sort((a, b) => {
      const va = sortVal(sortState.key, a[0], a[1]), vb = sortVal(sortState.key, b[0], b[1]);
      const c = (typeof va === 'string' || typeof vb === 'string') ? String(va).localeCompare(String(vb)) : (va - vb);
      return sortState.dir === 'asc' ? c : -c;
    });
    const scrolls = kind === 'rep' || _phoneAud;   // phones: every audit table scrolls sideways with the name column frozen
    const thSort = (c, i) => el('th', {
      class: 'px-1.5 py-2 text-[9px] uppercase tracking-wide font-semibold text-left cursor-pointer select-none hover:text-default transition'
        + (scrolls ? ' whitespace-nowrap' : ''),
      style: { background: 'var(--card-2)', color: sortState.key === c.id ? 'var(--accent)' : 'var(--text-muted)', fontWeight: sortState.key === c.id ? '800' : undefined, ...(i === 0 ? { position: 'sticky', left: 0, zIndex: 2, boxShadow: '1px 0 0 var(--border)' } : {}) },
      title: c.tip || '',
      onclick: () => setSort(c.id),
    }, c.label);   // active column = accent color (no arrow, app-wide convention)
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap' },
        el('h3', { class: 'text-base font-bold' }, label),
        headerRight || null),
      el('div', { style: scrolls ? { overflow: 'auto', maxHeight: '70vh' } : {} },
        el('table', { class: 'w-full', style: {
          borderCollapse: 'collapse',
          // Branch/Team on desktop: FIXED layout — first column 110px, the
          // rest split the remaining width evenly, so both tables' columns
          // align vertically and nothing scrolls sideways. Rep (and every
          // table on phones) keeps auto layout + sideways scroll.
          tableLayout: scrolls ? undefined : 'fixed',
          fontSize: scrolls ? '11px' : '10px',
        } },
          !scrolls && el('colgroup', {}, el('col', { style: { width: '110px' } }), ...cols.slice(1).map(() => el('col', {}))),
          el('thead', { style: scrolls ? { position: 'sticky', top: 0, zIndex: 3 } : {} }, el('tr', {}, ...cols.map((c, i) => thSort(c, i)))),
          el('tbody', {},
            // Reps: top 25 by the current sort (per Isaac); a live search or
            // "Show all" reveals the rest. Total row still covers everyone.
            ...(kind === 'rep' && !state._auditRepShowAll && !(state._auditRepSearch || '').trim() ? sorted.slice(0, 25) : sorted).map(([name, s2]) => {
              const tr = statRow(name, s2, { kind, org: kind === 'rep' ? { office: repOfficeOf(name), team: repTeamOf(name) } : undefined });
              if (kind === 'rep') tr.setAttribute('data-auditrep', String(name).toLowerCase());
              return tr;
            }),
            statRow('TOTAL', tot, { total: true, kind, org: kind === 'rep' ? {} : undefined }))),
        kind === 'rep' && sorted.length > 25 && !(state._auditRepSearch || '').trim() ? el('div', { class: 'px-4 py-2 border-t flex items-center justify-between gap-2 text-[11px]', style: { borderColor: 'var(--border)' } },
          el('span', { class: 'text-muted-' }, state._auditRepShowAll ? 'Showing all ' + sorted.length + ' reps' : 'Top 25 of ' + sorted.length + ' reps'),
          el('button', { class: 'font-semibold', style: { color: 'var(--accent)' }, onclick: () => { state._auditRepShowAll = !state._auditRepShowAll; mountApp(); } },
            state._auditRepShowAll ? 'Show top 25' : 'Show all')) : null));
  };

  const repEntries = Object.entries(reps).sort((a, b) => b[1].sold - a[1].sold || b[1].failed - a[1].failed);
  const offEntries = Object.entries(offs).sort((a, b) => b[1].sold - a[1].sold);
  const teamEntries = Object.entries(teams).sort((a, b) => b[1].sold - a[1].sold);
  // Every in-scope account (same range/office/team filters as the tables) —
  // used by the Export button so the download matches what's on screen.
  const scopedAccounts = [...acct.values()].filter(a =>
    inRange(a) && (offFilter === 'all' || a.office === offFilter) && (teamFilter === 'all' || a.team === teamFilter));

  if (!anyFlags) {
    return el('div', { class: 'flex flex-col gap-4 max-w-3xl mx-auto' },
      el('div', { class: 'card p-10 text-center' },
        el('div', { class: 'text-4xl mb-3' }, '🛡️'),
        el('h2', { class: 'text-lg font-bold mb-2' }, 'This snapshot has no Customer Flags yet'),
        el('p', { class: 'text-sm text-muted- max-w-lg mx-auto' },
          'No separate upload needed — this tab reads the SAME Customer Report as the rest of Reporting. The current snapshot just predates flag capture. Make sure the report export includes the Flags column, then upload it on this tab as usual; every future regular upload keeps this page current automatically. (One-time: run reporting_flags.sql in Supabase first.)')));
  }

  return el('div', { class: 'flex flex-col gap-4' },
    // Toolbar — same card treatment as the Reporting filter bars; pickers
    // left, tools (⬇ export · 👥 manage teams) pushed right.
    el('div', { class: 'card p-4 flex items-center gap-2 flex-wrap' },
      sel(offFilter, [['all', 'All Branches'], ...offices.map(o => [o, o])], (e) => { state.auditOffice = e.target.value; mountApp(); }),
      sel(teamFilter, [['all', 'All Teams'], ...teamsList.map(t => [t, t])], (e) => { state.auditTeam = e.target.value; mountApp(); }, 'Filter by team'),
      sel(preset, presetOpts, (e) => {
        state.auditRange = e.target.value;
        if (e.target.value === 'custom' && !state.auditCustomStart) {
          const t = new Date(); state.auditCustomEnd = t.toISOString().slice(0, 10);
          const s = new Date(t); s.setMonth(s.getMonth() - 1); state.auditCustomStart = s.toISOString().slice(0, 10);
        }
        mountApp();
      }, 'Accounts sold in this window'),
      preset === 'custom' && el('input', {
        type: 'date', value: state.auditCustomStart || '',
        class: 'rounded-xl px-2.5 py-1 text-[11px]',
        onchange: (e) => { state.auditCustomStart = e.target.value; mountApp(); },
      }),
      preset === 'custom' && el('span', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, '→'),
      preset === 'custom' && el('input', {
        type: 'date', value: state.auditCustomEnd || '',
        class: 'rounded-xl px-2.5 py-1 text-[11px]',
        onchange: (e) => { state.auditCustomEnd = e.target.value; mountApp(); },
      }),
      el('div', { class: 'flex-1' }),
      el('button', {
        class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Export every in-scope D2D account (audit status, flags, revenue) to Excel \u2014 incl. a sheet of accounts with no audit flag',
        onclick: () => exportAuditingXlsx(scopedAccounts, rangeLabel),
      }, '\u2b07'),
      el('button', {
        class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Assign reps to teams / tiers (same as the Indicators tab)',
        onclick: () => openManageTeamsModal(),
      }, '\ud83d\udc65'),
      ),

    // ONE rollup table with an Office ⇄ Teams toggle (per Isaac), then the per-rep detail table.
    (() => {
      const canOff = offFilter === 'all' && offEntries.length > 1;
      const canTeam = teamFilter === 'all' && teamEntries.length > 1;
      if (!canOff && !canTeam) return null;
      const which = (state._auditRollup === 'team' && canTeam) || !canOff ? 'team' : 'office';
      const seg = (canOff && canTeam) ? el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
        ...[['office', 'Office'], ['team', 'Teams']].map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold transition', style: which === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._auditRollup = v; mountApp(); } }, l))) : null;
      return which === 'team'
        ? statTable('Audit Report', teamEntries, null, 'team', seg)
        : statTable('Audit Report', offEntries, null, 'branch', seg);
    })(),

    // (Cohort Attrition card retired per Isaac, Sep 2026.)
    (() => {
      // Rep-table filters (team / office / name search). Selects re-render;
      // the search hides rows in place so the input never loses focus.
      const fT = state._auditRepTeam || 'all';
      const fO = state._auditRepOffice || 'all';
      const teamsAll = [...new Set(repEntries.map(([n]) => repTeamOf(n) || 'Unassigned'))].sort();
      const officesAll = [...new Set(repEntries.map(([n]) => repOfficeOf(n)).filter(Boolean))].sort();
      const repEntriesFiltered = repEntries.filter(([n]) =>
        (fT === 'all' || (repTeamOf(n) || 'Unassigned') === fT) &&
        (fO === 'all' || repOfficeOf(n) === fO));
      const sel = (val, opts, onpick, allLabel) => el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
        onchange: (e) => onpick(e.target.value),
      },
        el('option', { value: 'all', selected: val === 'all' }, allLabel),
        ...opts.map(o => el('option', { value: o, selected: val === o },
          o.split(' ').map(w => (w[0] || '').toUpperCase() + w.slice(1).toLowerCase()).join(' '))));
      const controls = el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('input', {
          id: 'audit-rep-search', type: 'text', placeholder: 'Search rep…',
          value: state._auditRepSearch || '',
          class: 'rounded-lg border px-2.5 py-1 text-[11px]',
          style: { borderColor: 'var(--border-2)', minWidth: '160px' },
          oninput: (e) => {
            const wasEmpty = !(state._auditRepSearch || '').trim();
            state._auditRepSearch = e.target.value;
            const q = e.target.value.trim().toLowerCase();
            // Rows beyond the top 25 aren't rendered until a search starts —
            // re-mount on the empty ⇄ non-empty transition, then filter in place.
            if (wasEmpty !== !q) { mountApp(); setTimeout(() => { const i = document.getElementById('audit-rep-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); return; }
            document.querySelectorAll('[data-auditrep]').forEach(row => {
              row.style.display = (!q || (row.getAttribute('data-auditrep') || '').includes(q)) ? '' : 'none';
            });
          },
        }),
        sel(fT, teamsAll, (v) => { state._auditRepTeam = v; mountApp(); }, 'All teams'),
        sel(fO, officesAll, (v) => { state._auditRepOffice = v; mountApp(); }, 'All offices'));
      const table = statTable('Sales Reps · Audit Report', repEntriesFiltered, null, 'rep', controls);
      // re-apply a live search that was typed before this render
      if (state._auditRepSearch) setTimeout(() => {
        const q = state._auditRepSearch.trim().toLowerCase();
        document.querySelectorAll('[data-auditrep]').forEach(row => {
          row.style.display = (!q || (row.getAttribute('data-auditrep') || '').includes(q)) ? '' : 'none';
        });
      }, 0);
      return table;
    })(),

  );
}

// Export the in-scope D2D accounts (one row per account) to an .xlsx. The
// first sheet is every account with its audit status, raw Customer Flags and
// revenue; the second isolates accounts with NO audit flag yet (Pending) so
// the auditor can chase down what still needs a flag.
async function exportAuditingXlsx(accounts, scopeLabel) {
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel library missing after load', 'error'); return; }
  const STATUS = { passed: 'Passed', failed: 'Failed', noaudit: 'No Audit', pending: 'Pending (no flag)' };
  const fmtD = (d) => (d && !isNaN(d)) ? d.toISOString().slice(0, 10) : '';
  const header = ['Customer ID', 'Customer', 'Rep', 'Team', 'Office', 'Audit Status', 'Has Audit Flag', 'Serviced',
    'Customer Flags', 'Cancelled', 'In Collections', 'First Sold/Service',
    'Sold Rev', 'Serviced Rev', 'Active Rev', 'Cancelled Rev', 'Aging Rev'];
  const toRow = (a) => [
    a.customerId || '', a.customer || '', a.rep || '', a.team || '', a.office || '',
    STATUS[a.status] || a.status, a.status === 'pending' ? 'No' : 'Yes', a.serviced ? 'Yes' : 'No',
    a.flags || '', a.cancelled ? 'Yes' : 'No', a.collections ? 'Yes' : 'No', fmtD(a.date),
    Math.round(a.soldRev || 0), Math.round(a.servicedRev || 0), Math.round(a.activeRev || 0), Math.round(a.cancelledRev || 0), Math.round(a.agingRev || 0),
  ];
  const all = (accounts || []).slice().sort((x, y) => (x.office || '').localeCompare(y.office || '') || (x.rep || '').localeCompare(y.rep || ''));
  const noFlag = all.filter(a => a.status === 'pending');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Scope', scopeLabel || ''], ['Pulled', new Date().toLocaleString()], [], header, ...all.map(toRow)]), 'All Accounts');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Accounts with NO audit flag yet (Pending)'], [], header, ...noFlag.map(toRow)]), 'No Audit Flag');
  XLSX.writeFile(wb, 'RIDD-Auditing-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  toast('Exported ' + all.length + ' accounts · ' + noFlag.length + ' with no flag', 'success');
}

