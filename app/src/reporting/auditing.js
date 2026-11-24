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
// Lead data checks shown at the top of Auditing (per Isaac, Nov 23): moved off the Marketing tab.
function _auditLeadChecks() {
  if (state._ghl === undefined && typeof ghlLoadLeads === 'function') ghlLoadLeads();   // the leads file, if Marketing hasn't loaded it yet
  const safe = (fn, tag) => { try { return typeof fn === 'function' ? fn() : null; } catch (e) { console.warn('[auditing] ' + tag, e); return null; } };
  return [safe(typeof leadOppMonitorCard === 'function' ? leadOppMonitorCard : null, 'lead-opp monitor'),
    safe(typeof ghlUnmappedTodoCard === 'function' ? ghlUnmappedTodoCard : null, 'unmapped GHL sources')].filter(Boolean);
}
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
    if (_rorReasonHit(reason) || _snsReasonHit(reason)) return true;
    if (reason.trim()) return false;
    if (!r.sold_date || !r.subscription_date_canceled) return false;
    const d = (new Date(r.subscription_date_canceled) - new Date(r.sold_date)) / 86400000;
    return d >= 0 && d <= crmRorWindowDays();
  };
  // 3-day ROR ONLY (a Right-of-Rescission cancel — explicit reason, or a
  // no-reason cancel within 3 days of the sale). Sold-Not-Started is NOT a ROR.
  // Tracked separately so the player card can show attrition with vs. without RORs.
  const isRorRow = (r) => {
    const reason = r.subscription_cancellation_reason || '';
    if (_snsReasonHit(reason)) return false;     // Sold-Not-Started, not a ROR
    if (_rorReasonHit(reason)) return true;       // explicit ROR reason
    if (reason.trim()) return false;                    // some other reason → not a ROR
    if (!r.sold_date || !r.subscription_date_canceled) return false;
    const d = (new Date(r.subscription_date_canceled) - new Date(r.sold_date)) / 86400000;
    return d >= 0 && d <= crmRorWindowDays();
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
    // Attrition by audit status (per Isaac, Nov 10 — it read far lower than the attrition tiles because it counted
    // every subscription, serviced or not): serviced revenue with ROR + one-time out of both sides, like Excl. 3-day ROR.
    if (serviced && !(isRorRow(r) || _otsRowX)) { a.attrSvcRev = (a.attrSvcRev || 0) + cv; if (r.subscription_date_canceled) a.attrCxlRev = (a.attrCxlRev || 0) + cv; }
    // Pending-eligible = actually needs an audit: NOT frozen status, and not a
    // pre-service cancel (sold then cancelled before any service ran). Drives the
    // Pending count — frozen / on-hold and pre-service cancels never need auditing.
    // Never serviced and sold more than 30 days ago = not needed for audit either (per Isaac, Nov 24 — those are almost
    // always accounts deleted in FieldRoutes), so they leave the Pending count.
    const _staleUnsvc = !serviced && r.sold_date && (Date.now() - Date.parse(String(r.sold_date).slice(0, 10))) / 86400000 > 30;
    if ((r.subscription_status || '').toLowerCase() !== 'frozen' && !(r.subscription_date_canceled && !serviced) && !_staleUnsvc) {
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
      b.attr[a.status][1] += (a.attrSvcRev || 0); b.attr[a.status][0] += (a.attrCxlRev || 0);
      b.coll[a.status][1] += a.subs; b.coll[a.status][0] += a.collSubs;
    }
  }
  // A rep's primary office = the one most of their in-range accounts came from.
  const repOfficeOf = (rep) => { const c = (repMeta[rep] || {}).officeCounts || {}; const e = Object.entries(c); return e.length ? e.sort((x, y) => y[1] - x[1])[0][0] : ''; };
  const repTeamOf = (rep) => (repMeta[rep] || {}).team || 'Unassigned';

  const rate = (pair) => pair[1] > 0 ? pair[0] / pair[1] : null;
  const GOOD = 'rgba(21,128,61,.14)', BAD = 'rgba(220,38,38,.14)';
  const passShade = (p) => p == null ? '' : (p >= 0.85 ? GOOD : p < 0.65 ? BAD : '');

  // ── UI bits ──
  const sel = (value, opts, onchange, title) => el('select', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer', title: title || '', onchange,
  }, ...opts.map(([v, lab]) => { const o = el('option', { value: v }, lab); if (v === value) o.selected = true; return o; }));

  // Everything on this tab is left-justified per request.
  const th = (lab) => el('th', { class: 'px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap text-left', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } }, lab);
  const td = (val, opts = {}) => el('td', { class: 'px-3 py-1.5 tabular-nums text-xs whitespace-nowrap text-left' + (opts.bold ? ' font-bold' : ''), style: opts.sticky ? { background: opts.bg || 'var(--card)', position: 'sticky', left: 0, zIndex: 1, boxShadow: '1px 0 0 var(--border)' } : { background: opts.bg || 'transparent' } }, val);
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
    const kindLabel = kind === 'all' ? 'Everything in scope' : kind === 'rep' ? 'Rep' : kind === 'team' ? 'Team' : 'Office';
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
      if (kind === 'all') {   // TOTAL row: everything in the table — the rep table's own team / office pickers included
        const rt = (org && org.repTeam) || 'all', ro = (org && org.repOffice) || 'all';
        return (rt === 'all' || (repTeamOf(a.rep) || 'Unassigned') === rt) && (ro === 'all' || repOfficeOf(a.rep) === ro);
      }
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
    // Attrition pair in ONE tile — excl. ROR + OTS on the left, incl. on the
    // right — so the group is two cards wide and fills a phone row.
    // Spans two columns everywhere (per Isaac): a full phone row, two of the three desktop columns with Aging on the right.
    const attrTile = (excl, incl) => el('div', { class: 'rounded-xl p-3 sm:col-span-2', style: { background: 'var(--card-2)', gridColumn: 'span 2 / span 2' } },
      el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Attrition'),
      // Read labels ABOVE the figures (per Isaac).
      el('div', { class: 'grid grid-cols-2 gap-3 mt-1' },
        el('div', {},
          el('div', { class: 'text-[10px] font-semibold text-muted-' }, 'Excl. 3-day ROR'),
          el('div', { class: 'text-xl font-black tabular-nums mt-0.5', style: { color: good }, title: 'ROR + one-time removed from both sides' }, pctS(excl))),
        el('div', {},
          el('div', { class: 'text-[10px] font-semibold text-muted-' }, 'Incl. 3-day ROR'),
          el('div', { class: 'text-xl font-black tabular-nums mt-0.5' }, pctS(incl)))),
      el('div', { class: 'text-[10px] text-muted- mt-1' }, 'cancelled \u00f7 serviced \u00b7 one-time services out of both'));
    const card = el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
      el('div', { class: 'p-5 pb-3 flex items-start justify-between gap-3', style: { borderBottom: '1px solid var(--border)' } },
        el('div', {},
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--accent)' } }, kindLabel),
          el('h2', { class: 'text-xl font-bold mt-0.5' }, name),
          // (office · team line hidden — multi-market attribution confused reps)
          asOf ? el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-subtle)' } }, 'As of ' + asOf) : null),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
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
          tile('Pending', fmt.int(s.pending), null, null, drill('Pending', r => _stat(r) === 'pending' && (r.subscription_status || '').toLowerCase() !== 'frozen' && !(r.subscription_date_canceled && !_svc(r)) && !(!_svc(r) && r.sold_date && (Date.now() - Date.parse(String(r.sold_date).slice(0, 10))) / 86400000 > 30))),
          tile('Attrition on Audits: Pass / Fail', pctS(aP) + ' / ' + pctS(aF), 'cancelled ÷ serviced revenue · excl. 3-day ROR & one-time'),
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
        // Three attrition reads + retention (per Isaac, Nov 10 — the True attrition bar is retired).
        group('Attrition · of serviced', [
          tile('Attrition · excl. 3-day ROR', pctS(attrExclRor), 'cancelled ÷ serviced · ROR + one-time out of both', good),
          tile('Attrition · incl. 3-day ROR', pctS(attrInclRor), 'cancelled ÷ serviced · one-time out of both'),
          tile('3-day ROR + aging', pctS(cancelIfAging), '(cancelled + aging) ÷ serviced', '#A9441F'),
          tile('Retention', pctS(activeRetention), 'active ÷ serviced', activeRetention == null ? null : (activeRetention >= 0.85 ? good : activeRetention < 0.65 ? bad : null)),
        ])));
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
    // Colour (per Isaac, Sep 2026): Office / Team rows carry the same colour
    // Indicators and Manage Teams use for them (swatch + coloured name);
    // rep rows get a faint wash of their team's colour so the table reads
    // by team at a glance. The frozen name cell needs a SOLID version of the
    // wash (it covers cells scrolling under it), hence color-mix over the card.
    const groupColor = opts.total ? null
      : (opts.kind === 'office' || opts.kind === 'branch') ? (typeof getBranchColor === 'function' ? getBranchColor(name) : null)
      : opts.kind === 'team' ? (name && name !== 'Unassigned' && typeof getTeamColor === 'function' ? getTeamColor(name) : null)
      : null;
    const repTeam = (!opts.total && opts.kind === 'rep' && opts.org) ? opts.org.team : '';
    const washColor = (repTeam && repTeam !== 'Unassigned' && typeof getTeamColor === 'function') ? getTeamColor(repTeam) : null;
    // (Row wash in the team colour removed per Isaac, Nov 24 — it read as a status. A rep row now carries a small dot in
    // its team colour, and red is the only cell colour: failed audits, a low pass rate, failed accounts churning more.)
    const wash = null, washSolid = null;
    const td_ = (val, o = {}) => opts.total ? td0(val, { ...o, bg: 'var(--card-2)' }) : td0(val, o);
    const nameCell = groupColor
      ? el('span', { class: 'inline-flex items-center gap-1.5' },
          el('span', { class: 'inline-block rounded-full shrink-0', style: { width: '9px', height: '9px', background: groupColor } }),
          el('span', { class: 'font-semibold', style: { color: groupColor } }, name))
      : washColor ? el('span', { class: 'inline-flex items-center gap-1.5', title: repTeam }, el('span', { class: 'inline-block rounded-full shrink-0', style: { width: '7px', height: '7px', background: washColor } }), el('span', {}, name))
      : name;
    // TOTAL row opens the same card for everything in scope (per Isaac).
    const totalOrg = opts.kind === 'rep' ? { repTeam: state._auditRepTeam || 'all', repOffice: state._auditRepOffice || 'all' } : {};
    const totalName = [offFilter !== 'all' ? offFilter : '', teamFilter !== 'all' ? teamFilter : '', totalOrg.repOffice && totalOrg.repOffice !== 'all' ? totalOrg.repOffice : '', totalOrg.repTeam && totalOrg.repTeam !== 'all' ? totalOrg.repTeam : ''].filter(Boolean).join(' \u00b7 ') || 'RIDD';
    return el('tr', {
      class: 'border-t cursor-pointer hover:brightness-95 transition',
      style: { borderColor: 'var(--border)', background: opts.total ? 'var(--card-2)' : (wash || 'transparent') },
      title: opts.total ? 'Click for the card covering every ' + (opts.kind === 'rep' ? 'rep' : opts.kind === 'team' ? 'team' : 'branch') + ' in this table' : 'Click for the ' + (opts.kind === 'rep' ? 'rep' : opts.kind === 'team' ? 'team' : 'branch') + ' card' + (repTeam ? ' \u00b7 ' + repTeam : ''),
      onclick: opts.total ? () => openAuditCardModal(totalName, s, 'all', totalOrg) : () => openAuditCardModal(name, s, opts.kind, opts.org),
    },
      td_(nameCell, { bold: !!opts.total, sticky: true, bg: opts.total ? undefined : washSolid }),

      td_(fmt.int(s.sold)),
      td_(fmt.int(s.serviced)),
      td_(fmt.int(s.activeSubs)),
      td_(s.sold > 0 ? (s.serviced / s.sold * 100).toFixed(1) + '%' : '—'),
      td_(fmt.int(auditedN)),
      td_(fmt.int(s.passed)),
      td_(fmt.int(s.failed), { bg: s.failed > 0 ? 'rgba(220,38,38,.08)' : 'transparent' }),
      td_(fmt.int(s.noaudit)),
      td_(fmt.int(s.pending)),
      td_(money(s.soldRev)),
      td_(money(s.servicedRev)),
      td_(money(activeRev)),
      td_(money(s.cancelledRev)),
      td_(money(s.agingRev)),
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
      { id: 'name', label: kind === 'rep' ? 'Rep' : (kind === 'team' ? 'Team' : 'Office'), tip: kind === 'rep' ? 'Sales rep (canonical name).' : (kind === 'team' ? 'Team from Manage Teams (current Team Year). "Unassigned" = no team set.' : 'Office.') },
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
      { id: 'pending', label: 'Pending', tip: 'No audit result yet — awaiting audit (no Passed / Failed / No-Audit flag). Pre-service cancels are excluded, and so is anything never serviced that was sold more than 30 days ago — neither needs an audit.' },
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
    const scrolls = true;   // every audit table scrolls sideways with the name column frozen (per Isaac, Sep 2026 — fixed layout crushed the numbers together)
    const thSort = (c, i) => el('th', {
      class: 'px-3 py-2 text-[9px] uppercase tracking-wide font-semibold text-left cursor-pointer select-none hover:text-default transition'
        + (scrolls ? ' whitespace-nowrap' : ''),
      style: { background: 'var(--card-2)', color: sortState.key === c.id ? 'var(--accent)' : 'var(--text-muted)', fontWeight: sortState.key === c.id ? '800' : undefined, ...(i === 0 ? { position: 'sticky', left: 0, zIndex: 2, boxShadow: '1px 0 0 var(--border)' } : {}) },
      title: c.tip || '',
      onclick: () => setSort(c.id),
    }, c.label);   // active column = accent color (no arrow, app-wide convention)
    const _lockAxis = (card) => { try { const sc = card.querySelector('.scroll-x'); if (sc && typeof axisLockScroll === 'function') axisLockScroll(sc); } catch (e) { /* plain scroll */ } return card; };   // one direction at a time (per Isaac, Nov 24)
    return _lockAxis(el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 pt-4 pb-2 flex items-center justify-between gap-3 flex-wrap' },
        el('h3', { class: 'text-base font-bold' }, label),
        headerRight || null),
      el('div', { class: 'px-4 pb-2 text-[10px]', style: { color: 'var(--text-muted)' } }, (kind === 'rep' ? 'Dot = the rep\u2019s team. ' : '') + 'Red = failed audits, or failed accounts churning more than passed ones. Pass % is green at 85% or better and red under 65%.'),
      el('div', { class: scrolls ? 'scroll-x' : '', style: scrolls ? { overflow: 'auto', maxHeight: '70vh' } : {} },
        // frozen-table: stays a real table on phones so the name column pins (per Isaac).
        el('table', { class: 'w-full' + (scrolls ? ' frozen-table' : ''), style: {
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
            state._auditRepShowAll ? 'Show top 25' : 'Show all')) : null)));
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
    // left, tools (⬇ export · 👥 manage teams) pushed right. Pinned under
    // the page header on scroll (per Isaac).
    (() => { const _auditCtl = [
      sel(offFilter, [['all', 'All Offices'], ...offices.map(o => [o, o])], (e) => { state.auditOffice = e.target.value; mountApp(); }),
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
      // (Export button removed per Isaac, Sep 2026 — exportAuditingXlsx kept for the console.)
      el('button', {
        class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Assign reps to teams / tiers (same as the Indicators tab)',
        onclick: () => openManageTeamsModal(),
      }, '\ud83d\udc65'),
      ].filter(Boolean);
      // Desktop: these ride in the sub-tab row, right-justified (per Isaac, Oct 14); phones keep the pinned bar.
      if (reportingTabSlotPut(_auditCtl)) return null;
      const _f = _auditCtl.slice(); _f.splice(_f.length - 1, 0, el('div', { class: 'flex-1' }));
      return reportingPinBar('audit', el('div', { class: 'card p-4 flex items-center gap-2 flex-wrap' }, ..._f));
    })(),

    // Lead data checks (per Isaac, Nov 23 — moved here from Marketing): the lead → opportunity monitor (starts
    // closed) and the unmapped GoHighLevel sources to-do.
    // (Lead → opportunity and Unmapped GoHighLevel sources now sit in the task list: Affects reporting → Attribution.)

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



// ── Service fees credited to a user (per Isaac, Sep 29) ────────────────────
// Service fees are never assigned to a rep. The FieldRoutes add-ons sync
// flags every recurring ticket whose Service Fee line carries a Credit To
// (subscription_revenue.fee_credited_count > 0). This is the to-do list:
// open each account in FieldRoutes and clear Credit To on the fee line.
// Goal: zero. Same one-line collapsible style as Marketing's Needs attention.
function _loadFeeCreditAudit() {
  if (state._feeAudit !== undefined || !supabase) return;
  state._feeAudit = null;
  (async () => {
    try {
      const { data, error } = await supabase.from('subscription_revenue')
        .select('subscription_id, customer_id, base_service, fee_credited_count, fee_credited_employee_ids, lines, updated_at')
        .gt('fee_credited_count', 0).order('updated_at', { ascending: false }).limit(2000);
      state._feeAudit = error ? { error: error.message } : (data || []);
    } catch (e) { state._feeAudit = { error: String(e.message || e) }; }
    mountApp();
  })();
}
// ── To do · Add-ons with no rep (per Isaac, Oct 6) ───────────────────────
// An add-on (a recurring-ticket line that is not a fee) with Commission To left on N/A pays nobody. When it went
// on within ADDON_NOREP_DAYS of the subscription being sold, it was almost certainly part of that sale and should
// be credited to the rep who sold it — those are listed first, with the seller named.
const ADDON_NOREP_DAYS = 30;
function _loadAddOnNoRepAudit() {
  if (state._aoNoRep !== undefined || !supabase) return;
  state._aoNoRep = null;
  (async () => {
    try {
      const { data, error } = await supabase.from('add_ons').select('id, customer_id, subscription_id, service_name, base_service, credited_employee_id, credited_profile_id, added_at, recurring_amount, initial_amount, removed_at').is('removed_at', null).order('added_at', { ascending: false }).limit(5000);
      state._aoNoRep = error ? { error: error.message } : (data || []);
    } catch (e) { state._aoNoRep = { error: String(e.message || e) }; }
    mountApp();
  })();
}
function addOnNoRepAuditCard(opts) {
  _loadAddOnNoRepAudit();
  const d = state._aoNoRep;
  const noRep = (a) => { const v = String(a.credited_employee_id == null ? '' : a.credited_employee_id).trim(); return !a.credited_profile_id && (!v || v === '0' || v.startsWith('-')); };
  const subs = state.reportingSubscriptions || [];
  const M = addOnNoRepAuditCard._m && addOnNoRepAuditCard._m.src === subs ? addOnNoRepAuditCard._m.map : (() => { const m = new Map(); for (const r of subs) if (r.subscription_id != null) m.set(String(r.subscription_id), r); addOnNoRepAuditCard._m = { src: subs, map: m }; return m; })();
  const _allNoRep = (Array.isArray(d) ? d : []).filter(noRep).map(a => {
    const sub = M.get(String(a.subscription_id)) || null;
    const sold = sub ? String(sub.sold_date || '').slice(0, 10) : '';
    const days = sold && a.added_at ? Math.round((Date.parse(String(a.added_at).slice(0, 10)) - Date.parse(sold)) / 86400000) : null;
    const seller = sub ? ((typeof flipLastFirst === 'function' ? flipLastFirst(String(sub.sold_by || '').trim()) : String(sub.sold_by || '').trim())) : '';
    // Only add-ons with an appointment behind them matter (per Isaac, Nov 25 — #186193 was listed with no contract, no
    // payment and no appointment): the plan has an initial on the calendar, or a service was completed on or after the
    // day the add-on went on. An add-on on a plan with neither is not owed to anyone yet, so it stays off the list.
    const addDay = String(a.added_at || '').slice(0, 10);
    const day = (v) => String(v || '').slice(0, 10);
    const booked = !!sub && /^pending$/i.test(String(sub.initial_status || '').trim()) && !!day(sub.initial_appt_date);
    const servicedAfter = !!sub && !!addDay && [sub.initial_serviced_date, sub.last_completed_date].some(d => day(d) && day(d) >= addDay);
    // …but a rep can add the upsell and forget to book the visit for it (Isaac, Nov 24). So a real customer still
    // lists with no appointment behind the add-on: the plan is active and has a completed service, a signed agreement
    // or a card on autopay. Only a dead lead (none of those — #186193) or a frozen/cancelled plan stays off.
    const apOn = !!sub && (() => { const v = String(sub.customer_auto_pay == null ? '' : sub.customer_auto_pay).trim(); return !!v && !/^(no|0|false|none)$/i.test(v); })();
    const live = !!sub && /active/i.test(String(sub.subscription_status || '')) && !sub.subscription_date_canceled;
    const real = live && ((Number(sub.subscription_completed_services) || 0) > 0 || !!day(sub.last_completed_date) || String(sub.contract_state) === 'signed' || apOn);
    const needsAppt = !(booked || servicedAfter) && real;
    return { a, sold, days, seller, likely: days != null && days >= -1 && days <= ADDON_NOREP_DAYS, appt: booked || servicedAfter || real, needsAppt,
      apptNote: booked ? 'initial booked ' + day(sub.initial_appt_date) : servicedAfter ? 'serviced ' + [sub.last_completed_date, sub.initial_serviced_date].map(day).filter(d => d && d >= addDay).sort().pop()
        : needsAppt ? 'NOT SERVICED SINCE THE ADD-ON' + (day(sub.last_completed_date) ? ' (last service ' + day(sub.last_completed_date) + ')' : '') + ' — check a visit is booked for it' : '' };
  });
  const noApptN = _allNoRep.filter(r => !r.appt).length;
  const rows = _allNoRep.filter(r => r.appt).sort((x, y) => (y.likely - x.likely) || String(y.a.added_at).localeCompare(String(x.a.added_at)));
  const likelyN = rows.filter(r => r.likely).length;
  const needsN = rows.filter(r => r.needsAppt).length;
  const open = opts && opts.item ? state._auditDetail === 'addon' : state._aoNoRepOpen === true;
  const status = d === undefined || d === null ? 'checking…'
    : d.error ? 'waiting on the add-ons sync (migration 20260922_add_ons.sql)'
    : !rows.length ? 'All clear — every add-on with an appointment behind it is credited to a rep.' + (noApptN ? ' (' + noApptN + ' more with no rep are on plans that are frozen, cancelled or never started — not owed to anyone.)' : '')
    : rows.length + ' add-on' + (rows.length === 1 ? '' : 's') + ' with no rep' + (likelyN ? ' — ' + likelyN + ' went on within ' + ADDON_NOREP_DAYS + ' days of the sale and probably belong' + (likelyN === 1 ? 's' : '') + ' to the seller' : '') + '. No commission is paid on these until Commission To is set on the line in FieldRoutes.' + (needsN ? ' ' + needsN + ' of these ' + (needsN === 1 ? 'has' : 'have') + ' not been serviced since the add-on went on — check a visit is booked.' : '') + (noApptN ? ' Not listed: ' + noApptN + ' more on plans that are frozen, cancelled or never started (no service, signed agreement or autopay).' : '');
  const head = el('button', { class: 'w-full flex items-center gap-2 px-4 py-2.5 text-left', onclick: () => { state._aoNoRepOpen = !open; mountApp(); } },
    el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: Array.isArray(d) ? (likelyN ? '#DC2626' : rows.length ? '#D97706' : 'var(--ok)') : '#D97706' } }),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'To do · Add-ons with no rep'),
    el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, status),
    rows.length ? el('span', { class: 'ml-auto text-sm font-black tabular-nums', style: { color: likelyN ? '#DC2626' : '#D97706' } }, String(rows.length)) : null,
    el('span', { class: rows.length ? 'text-[11px]' : 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, open ? '▴' : '▾'));
  const list = open && rows.length ? el('div', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...rows.slice(0, 500).map((r, i) =>
    el('div', { class: 'flex items-center gap-3 px-4 py-2 border-t text-xs', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[10px] font-bold tabular-nums shrink-0', style: { color: 'var(--text-subtle)', width: '22px', textAlign: 'right' } }, (i + 1) + '.'),
      el('span', { class: 'font-semibold shrink-0', style: { minWidth: '70px' } }, '#' + r.a.customer_id),
      el('span', { class: 'shrink-0', style: { minWidth: '150px', color: 'var(--text-muted)' } }, (r.a.base_service || '') + ' · sub ' + r.a.subscription_id),
      el('span', { class: 'shrink-0 font-semibold', style: { minWidth: '170px' } }, r.a.service_name + ' ' + fmt.usd(Number(r.a.recurring_amount) || 0) + ' / service'),
      el('span', { class: 'flex-1 min-w-0', style: { color: r.likely ? '#DC2626' : 'var(--text-muted)' } },
        'added ' + String(r.a.added_at || '').slice(0, 10) + (r.days == null ? ' · sale date not found' : r.days <= 0 ? ' · the same day as the sale' : ' · ' + r.days + ' day' + (r.days === 1 ? '' : 's') + ' after the sale') + (r.likely && r.seller ? ' · sold by ' + r.seller + ', probably theirs' : r.seller ? ' · account sold by ' + r.seller : '') + (r.apptNote ? ' · ' + r.apptNote : ''))))) : null;
  if (opts && opts.item) return { rvIds: rows.map(r => String(r.a.id)), key: 'addon', tag: 'Add-ons', sev: !Array.isArray(d) ? 'amber' : likelyN ? 'red' : rows.length ? 'amber' : 'ok', count: Array.isArray(d) ? rows.length : null, text: status, detail: list, title: 'Add-ons with no rep' };
  return el('div', { class: 'card overflow-hidden' }, head, list);
}
function feeCreditAuditCard(opts) {
  _loadFeeCreditAudit();
  const d = state._feeAudit;
  // FieldRoutes' own system accounts (FR-System-…, FieldRoutes Admin, PestRoutes Admin) are fine on a service
  // fee (per Isaac, Oct 6): nobody is paid commission through them. Only a fee credited to a real person is flagged.
  if (state.frRoster == null && !state._frRosterLoading && typeof loadFieldRoutesRoster === 'function') loadFieldRoutesRoster().then(() => { if (state.reportingSubTab === 'auditing') mountApp(); });
  const _rosterById = (() => { const m = new Map(); for (const e of (state.frRoster || [])) for (const id of String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean)) m.set(id, e); return m; })();
  const _rosterName = (e) => e ? ((typeof _frEmpName === 'function' && _frEmpName(e)) || [e.first_name, e.last_name].filter(Boolean).join(' ') || e.name || '') : '';
  const isFrSystem = (id) => { const e = _rosterById.get(String(id)); if (!e) return false; return /field\s*routes|pest\s*routes|^fr[-\s]?system/i.test(_rosterName(e)) || /@(fieldroutes|pestroutes)\.com/i.test(String(e.email || '')); };
  // A fee is flagged only when it is credited to a real person we can name: an id of -1 / 0 is FieldRoutes' "N/A
  // Commission To", and an id that is not in the employee list is a FieldRoutes system account or someone long gone.
  const _isPerson = (id) => { const v = String(id == null ? '' : id).trim(); return !!v && v !== '0' && !v.startsWith('-') && _rosterById.has(v) && !isFrSystem(v); };
  const _flagged = (r) => (r.lines || []).filter(l => l.kind === 'fee' && _isPerson(l.credited_employee_id));
  const rows = (Array.isArray(d) ? d : []).filter(r => _flagged(r).length);
  const open = opts && opts.item ? state._auditDetail === 'fee' : state._feeAuditOpen === true;
  const empName = (id) => {
    const p = (state.profiles || []).find(x => String(x.fieldroutes_employee_id || '') === String(id));
    return p ? p.full_name : (_rosterName(_rosterById.get(String(id))) || 'FR #' + id);
  };
  const status = d === undefined || d === null || state.frRoster == null ? 'checking…'
    : d.error ? 'waiting on the add-ons sync (migration 20260929_add_ons_lifecycle.sql)'
    : !rows.length ? 'All clear — no service fee is credited to a person.'
    : rows.length + ' account' + (rows.length === 1 ? '' : 's') + ' with a service fee credited to a person — set Commission To back to N/A (or a FieldRoutes account) on the fee line';
  const head = el('button', { class: 'w-full flex items-center gap-2 px-4 py-2.5 text-left', onclick: () => { state._feeAuditOpen = !open; mountApp(); } },
    el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: Array.isArray(d) ? (rows.length ? '#DC2626' : 'var(--ok)') : '#D97706' } }),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'To do · Service fees'),
    el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, status),
    rows.length ? el('span', { class: 'ml-auto text-sm font-black tabular-nums', style: { color: '#DC2626' } }, String(rows.length)) : null,
    el('span', { class: rows.length ? 'text-[11px]' : 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, open ? '▴' : '▾'));
  const list = open && rows.length ? el('div', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...rows.map((r, i) => {
    const fees = _flagged(r);
    return el('div', { class: 'flex items-center gap-3 px-4 py-2 border-t text-xs', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[10px] font-bold tabular-nums shrink-0', style: { color: 'var(--text-subtle)', width: '22px', textAlign: 'right' } }, (i + 1) + '.'),
      el('span', { class: 'font-semibold shrink-0', style: { minWidth: '70px' } }, '#' + r.customer_id),
      el('span', { class: 'shrink-0', style: { minWidth: '140px', color: 'var(--text-muted)' } }, (r.base_service || '') + ' · sub ' + r.subscription_id),
      el('span', { class: 'flex-1 min-w-0' }, fees.map(l => l.name + ' ' + fmt.usd(Number(l.per_service) || 0) + ' credited to ' + ((l.credited_profile_id && ((state.profiles || []).find(x => x.id === l.credited_profile_id) || {}).full_name) || empName(l.credited_employee_id))).join(' · ')));
  })) : null;
  if (opts && opts.item) return { rvIds: rows.map(r => String(r.subscription_id)), key: 'fee', tag: 'Service fees', sev: !Array.isArray(d) || state.frRoster == null ? 'amber' : rows.length ? 'red' : 'ok', count: Array.isArray(d) && state.frRoster != null ? rows.length : null, text: status, detail: list, title: 'Service fees credited to a person' };
  return el('div', { class: 'card overflow-hidden' }, head, list);
}

// ── Auditing tasks built from the subscription book (per Isaac, Oct 6) ───
// Same shape as the service-fee and add-on checks: a coloured dot, what is wrong, how many, and a click through to
// the accounts (with CSV export). Each task is a rule the app already knows, pointed at "what needs fixing in
// FieldRoutes". Add a task by adding an entry to auditSubTasks().
function auditTaskCard(t) {
  // A task that cannot run yet (a setting is missing) says so in amber instead of showing a misleading zero.
  if (t.warn) return el('div', { class: 'card overflow-hidden' }, el('div', { class: 'w-full flex items-center gap-2 px-4 py-2.5' },
    el('span', { class: 'inline-block rounded-full shrink-0', style: { width: '8px', height: '8px', background: '#D97706' } }),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold shrink-0' }, 'To do · ' + t.title),
    el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, t.warn)));
  const n = t.rows.length;
  const open = n ? () => openReportingDrillModal({ chartTitle: 'Auditing · ' + t.title, sliceLabel: n.toLocaleString() + ' ' + (n === 1 ? t.noun : t.noun + 's'), rows: t.rows, formatValue: fmt.usd0 }) : null;
  return el('div', { class: 'card overflow-hidden' },
    el('button', { class: 'w-full flex items-center gap-2 px-4 py-2.5 text-left', style: { cursor: open ? 'pointer' : 'default' }, title: open ? 'Click for the accounts' : '', onclick: () => { if (open) open(); } },
      el('span', { class: 'inline-block rounded-full shrink-0', style: { width: '8px', height: '8px', background: n ? (t.tone === 'check' ? '#D97706' : '#DC2626') : 'var(--ok)' } }),
      el('span', { class: 'text-[11px] uppercase tracking-widest font-bold shrink-0' }, 'To do · ' + t.title),
      el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, n ? t.todo(n) : t.ok),
      n ? el('span', { class: 'ml-auto text-sm font-black tabular-nums', style: { color: t.tone === 'check' ? '#D97706' : '#DC2626' } }, n.toLocaleString()) : null,
      n ? el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, '→') : null));
}
// ── Auditing tasks as one dropdown list (per Isaac, Oct 13 — same look as Needs attention on Marketing) ──
// Memoized like the Needs attention feed (per Isaac, Oct 16): the Auditing tab and the tab bubble both build it.
// Built off-render (deferredMemo): null until the first build is done.
function auditTaskItems() {
  return deferredMemo('auditTasks', () => [state.allSales, state.reportingSubscriptions, state._svcChg, state._feeAudit, state.allProfiles, state._indicatorRawSales, state.unloggedSales, state._crmDeletedIdsRaw, state.reportingSourceConfig, state._ghl, state._attr],
    () => perfT('auditTaskItems', () => _auditTaskItemsRaw()));
}
// The CRM Needs-attention checks (src/core/exceptions.js — location, source, cancel reasons, duplicates, lead flow…),
// as Auditing rows (per Isaac, Nov 9: "put all of these needs attention items inside of the auditing tab"). Same
// owner-only scope and the same check-off keys ('att:<tag>') as before, so nothing already ticked comes back.
// Dropped here because Auditing already has them: "No reason" (same rows as Cancelled with no reason) and
// "Contract" (folded into No signed agreement below).
function _auditNeedsAttentionItems() {
  if (typeof exceptionFeedScope !== 'function' || typeof _exceptionFeedItemsRaw !== 'function') return [];
  const scope = exceptionFeedScope(); if (!scope) return [];
  let raw = []; try { raw = _exceptionFeedItemsRaw(scope) || []; } catch (e) { console.warn('[auditing] needs-attention checks', e); return []; }
  const DETAIL = { 'Lead flow': () => mktgLeadFlowTask({ embed: true }), 'ZIP': () => mktgZipFixTask({ embed: true }), 'Cancellation': () => auditCancelSplit() };
  return raw.filter(i => i && !['No reason', 'Contract'].includes(i.tag)).map(i => {
    const it = { key: 'att:' + i.tag, rvKey: 'att:' + i.tag, tag: i.tag, title: i.text, sev: i.sev, count: i.count != null ? i.count : null, text: i.text, onClick: i.onClick, rvIds: i.rvIds, rvOpen: i.rvOpen };
    if (DETAIL[i.tag]) Object.defineProperty(it, 'detail', { enumerable: true, get() { try { return DETAIL[i.tag](); } catch (e) { return null; } } });   // built fresh each render (its own buttons)
    return it;
  });
}
function _auditTaskItemsRaw() {
  const items = [];
  try { items.push(..._auditNeedsAttentionItems()); } catch (e) { console.warn('[auditing] needs-attention', e); }
  try { items.push(feeCreditAuditCard({ item: true })); } catch (e) { console.warn('[auditing] fee task', e); }
  try { items.push(addOnNoRepAuditCard({ item: true })); } catch (e) { console.warn('[auditing] add-on task', e); }
  try { if (typeof serviceChangeAuditItem === 'function') items.push(serviceChangeAuditItem()); } catch (e) { console.warn('[auditing] service-change task', e); }
  try { items.push(...auditSalesItems()); } catch (e) { console.warn('[auditing] sales tasks', e); }
  try { const sc = auditSourceCheckItem(); if (sc) items.push(...(Array.isArray(sc) ? sc : [sc])); } catch (e) { console.warn('[auditing] source check', e); }
  for (const t of auditSubTasks()) {
    if (t.warn) { items.push({ key: t.title, tag: t.tag || 'Setup', title: t.title, sev: 'amber', count: null, text: t.warn }); continue; }
    const n = t.rows.length;
    const _drill = (rs) => openReportingDrillModal({ chartTitle: 'Auditing · ' + t.title, sliceLabel: rs.length.toLocaleString() + ' ' + (rs.length === 1 ? t.noun : t.noun + 's'), rows: rs, formatValue: fmt.usd0, review: { key: t.title, idOf: (r) => r.subscription_id } });
    items.push({ key: t.title, tag: t.tag || t.title, title: t.title, sev: n ? (t.tone === 'check' ? 'amber' : 'red') : 'ok', count: n, text: n ? t.todo(n) : t.ok,
      onClick: n ? () => _drill(t.rows) : null,
      // Check-offs (per Isaac, Oct 15): accounts that weren't in the task when it was ticked bring it back, alone.
      rvIds: t.rows.map(r => String(r.subscription_id)), rvOpen: (ids) => _drill(t.rows.filter(r => ids.has(String(r.subscription_id)))) });
  }
  return items.filter(Boolean);
}
// ── Possibly deleted customers (per Isaac, Oct 29) ──────────────────────
// FieldRoutes never tells the RevHawk mirror about a deleted customer, so the account lives on as Active with an
// initial that stays "Pending" forever (Noah Shadix's #145329, initial Apr 21). Rule: an active plan whose
// Pending initial appointment date passed more than a week ago and was never serviced is flagged here. An admin
// marks the customer Deleted — held for good and excluded app-wide for every user — or Not deleted, which
// takes it off this list. Nothing is excluded until it is marked. Stored in app_settings 'crm_deleted_review' =
// { deleted: { id: { by, at } }, kept: { id: { by, at } } } (customer ids only).
const DEL_REVIEW_KEY = 'Possibly deleted customers';
const DEL_REVIEW_DAYS = 7;
function crmDelReviewLoad() {
  if (state._crmDelReview !== undefined) return;
  state._crmDelReview = { deleted: {}, kept: {} };
  if (typeof supabase === 'undefined' || !supabase || (typeof DEMO !== 'undefined' && DEMO)) return;
  Promise.resolve(supabase.from('app_settings').select('value').eq('key', 'crm_deleted_review').maybeSingle()).then(({ data }) => {
    if (!data || !data.value) return;
    state._crmDelReview = Object.assign({ deleted: {}, kept: {} }, data.value);
    if (typeof _applyLiveDataRules === 'function') _applyLiveDataRules();
    if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
    mountApp();
  }).catch(() => {});
}
// Every customer an admin has marked Deleted — read by deletedCustIdSet() for every dataset.
function crmDeletedConfirmedIds() { crmDelReviewLoad(); return Object.keys((state._crmDelReview && state._crmDelReview.deleted) || {}); }
function crmDelReviewMark(cid, verdict) {
  crmDelReviewLoad();
  const R = { deleted: Object.assign({}, state._crmDelReview.deleted), kept: Object.assign({}, state._crmDelReview.kept) };
  const id = String(cid), stamp = { by: (state.profile && state.profile.full_name) || '', at: new Date().toISOString() };
  delete R.deleted[id]; delete R.kept[id];
  if (verdict === 'deleted') R.deleted[id] = stamp; else if (verdict === 'kept') R.kept[id] = stamp;
  state._crmDelReview = R;
  if (typeof _applyLiveDataRules === 'function') _applyLiveDataRules();
  if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
  mountApp();
  if (typeof supabase === 'undefined' || !supabase || (typeof DEMO !== 'undefined' && DEMO)) return;
  Promise.resolve(supabase.from('app_settings').upsert({ key: 'crm_deleted_review', value: R }, { onConflict: 'key' }))
    .then(({ error }) => { if (error) toast('Couldn’t save: ' + error.message, 'error'); else toast(verdict === 'deleted' ? 'Marked deleted — out of every number' : verdict === 'kept' ? 'Kept — off the review list' : 'Put back on the review list', 'success'); })
    .catch(() => {});
}
// One row per customer: their active plans whose Pending initial passed 7+ days ago, never serviced.
function crmDelReviewCandidates() {
  crmDelReviewLoad();
  const rows = state._snapshotAllRows || state.reportingSubscriptions || [];
  const R = state._crmDelReview || { deleted: {}, kept: {} };
  const cut = new Date(); cut.setDate(cut.getDate() - DEL_REVIEW_DAYS); const cutIso = cut.toISOString().slice(0, 10);
  const by = new Map();
  for (const r of rows) {
    const id = String(r.customer_id != null ? r.customer_id : ''); if (!id || R.deleted[id] || R.kept[id]) continue;
    if (String(r.subscription_status || '').trim().toLowerCase() !== 'active' || r.subscription_date_canceled) continue;
    if (r.initial_service || r.initial_serviced_date || String(r.initial_status || '').trim().toLowerCase() !== 'pending') continue;
    const appt = String(r.initial_appt_date || '').slice(0, 10); if (!appt || appt >= cutIso) continue;
    const c = by.get(id) || by.set(id, { id, name: (typeof _custDisplayName === 'function' ? _custDisplayName(r) : ''), office: r.office_name || '', rep: String(r.sold_by || '').trim(), subs: [], value: 0, appt, sold: String(r.sold_date || '').slice(0, 10) }).get(id);
    c.subs.push(String(r.subscription || '').trim()); c.value += Number(r.subscription_contract_value) || 0;
    if (appt < c.appt) c.appt = appt;
  }
  return [...by.values()].sort((a, b) => a.appt.localeCompare(b.appt));
}
function crmDelReviewItem() {
  const L = crmDelReviewCandidates();
  const n = L.length, s = n === 1 ? '' : 's';
  const today = Date.now();
  const btn = (label, sty, fn) => el('button', { class: 'rounded-lg border px-2 py-0.5 text-[11px] font-bold cursor-pointer whitespace-nowrap', style: Object.assign({ borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, sty || {}), onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  const R = state._crmDelReview || { deleted: {} };
  const nDel = Object.keys(R.deleted || {}).length;
  const detail = el('div', { class: 'px-4 pb-3 flex flex-col gap-1.5' },
    el('div', { class: 'text-[11px] pt-1', style: { color: 'var(--text-muted)' } }, 'Look each one up in FieldRoutes. Deleted = held for good and left out of every number for everyone. Not deleted = off this list. ' + (nDel ? nDel.toLocaleString() + ' customer' + (nDel === 1 ? '' : 's') + ' marked deleted so far.' : '')),
    ...L.slice(0, 200).map(c => el('div', { class: 'flex items-center gap-2 flex-wrap rounded-lg border px-2.5 py-1.5 text-[11px]', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'font-bold tabular-nums' }, '#' + c.id),
      el('span', { class: 'font-semibold' }, c.name || '—'),
      el('span', { style: { color: 'var(--text-muted)' } }, [c.office, c.subs.join(', '), c.rep].filter(Boolean).join(' · ')),
      el('span', { class: 'tabular-nums', style: { color: '#B45309' } }, 'initial ' + c.appt + ' · ' + Math.round((today - Date.parse(c.appt)) / 86400000) + 'd ago, still Pending'),
      el('span', { class: 'tabular-nums font-semibold' }, fmt.usd0(c.value)),
      el('span', { class: 'ml-auto inline-flex gap-1.5' },
        btn('🗑 Deleted', { borderColor: '#DC2626', color: '#DC2626' }, () => crmDelReviewMark(c.id, 'deleted')),
        btn('Not deleted', null, () => crmDelReviewMark(c.id, 'kept'))))),
    n > 200 ? el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, 'Showing the oldest 200 of ' + n.toLocaleString() + '.') : null);
  return { key: DEL_REVIEW_KEY, tag: 'Deleted?', title: DEL_REVIEW_KEY, sev: n ? 'amber' : 'ok', count: n,
    text: n ? n.toLocaleString() + ' customer' + s + ' with a Pending initial more than ' + DEL_REVIEW_DAYS + ' days past and never serviced — usually deleted in FieldRoutes. Mark each Deleted or Not deleted.' : 'All clear — no Pending initial is more than a week past.',
    detail, rvIds: L.map(c => c.id) };
}

// ── Sections and families (per Isaac, Nov 24) ───────────────────────────
// The list reads in three sections — what changes someone's pay, what touches billing or the customer, what only
// moves a report — and tasks that are the same job in FieldRoutes sit under one row (wrong office, renewals, sold
// and never serviced, attribution, below minimum). Presentation only: every member keeps its own key and its own
// accounts, so nothing already ticked comes back and each list still opens on its own.
const AUDIT_SECTIONS = [['rep', 'Affects reporting'], ['pay', 'Affects pay'], ['cust', 'Affects billing or the customer']];   // reporting first (per Isaac, Nov 25)
const AUDIT_PLACE = [
  // [tag (lower-case), section, family key, family label, order inside the family]
  ['add-ons', 'pay'], ['term', 'pay'], ['commission', 'pay'], ['seller type', 'pay'], ['seller', 'pay'], ['service fees', 'pay'], ['passed audit', 'pay'],
  ['below minimum', 'pay', 'belowmin', 'Below minimum'],
  ['duplicates', 'cust'], ['agreement', 'cust'], ['one-time', 'cust'], ['autopay', 'cust'], ['not serviced', 'cust'], ['contract', 'cust'], ['sentricon', 'cust'], ['status', 'cust'],
  ['renewal', 'cust', 'renewals', 'Renewals', 0], ['renewal · not renewed', 'cust', 'renewals', 'Renewals', 1], ['renewal source', 'cust', 'renewals', 'Renewals', 2], ['renewal · not coded', 'cust', 'renewals', 'Renewals', 3],
  ['not started', 'cust', 'unserviced', 'Sold, never serviced', 0], ['pending', 'cust', 'unserviced', 'Sold, never serviced', 1], ['deleted?', 'cust', 'unserviced', 'Sold, never serviced', 2],
  ['location', 'rep', 'office', 'Wrong office', 0], ['zip', 'rep', 'office', 'Wrong office', 1],
  ['source check', 'rep', 'attr', 'Attribution', -1], ['pestbooker', 'rep', 'attr', 'Attribution', -0.5], ['source', 'rep', 'attr', 'Attribution', 0], ['lead flow', 'rep', 'attr', 'Attribution', 1], ['no ghl lead', 'rep', 'attr', 'Attribution', 2], ['sellify', 'rep', 'attr', 'Attribution', 3], ['lead → opportunity', 'rep', 'attr', 'Attribution', 4], ['unmapped sources', 'rep', 'attr', 'Attribution', 5],
  ['cancellation', 'rep'], ['no reason', 'rep'],
];
function auditPlaceOf(i) {
  const t = String((i && i.tag) || '').trim().toLowerCase();
  const p = AUDIT_PLACE.find(x => x[0] === t);
  return p ? { sec: p[1], fam: p[2] || null, famLabel: p[3] || null, ord: p[4] || 0 } : { sec: 'rep', fam: null, famLabel: null, ord: 0 };
}
// Top-level entries of the to-do list: { sec, item } or { sec, fam, label, members } — a family with one open
// member is shown as that member alone.
function auditTaskEntries(todo) {
  const RANK = { red: 0, amber: 1, ok: 2 }, out = [], fams = new Map();
  for (const i of todo) {
    const p = auditPlaceOf(i);
    if (!p.fam) { out.push({ sec: p.sec, item: i }); continue; }
    let f = fams.get(p.fam); if (!f) { f = { sec: p.sec, fam: p.fam, label: p.famLabel, members: [] }; fams.set(p.fam, f); out.push(f); }
    f.members.push({ i, ord: p.ord });
  }
  return out.map(e => { if (!e.fam) return e; e.members.sort((a, b) => a.ord - b.ord); const ms = e.members.map(m => m.i); return ms.length === 1 ? { sec: e.sec, item: ms[0] } : { sec: e.sec, fam: e.fam, label: e.label, members: ms }; })
    .sort((a, b) => { const sv = (e) => e.item ? RANK[e.item.sev] : Math.min(...e.members.map(m => RANK[m.sev])); return sv(a) - sv(b); });
}
// "Cancel reasons that can't be right", split by which rule each one breaks (per Isaac, Nov 24 — 824 in one list is
// too many to work). Same rows as the check itself (crmReconciliationChecks), grouped on the reason it was flagged for.
function auditCancelSplit() {
  const subs = state.reportingSubscriptions || []; if (!subs.length || typeof crmReconciliationChecks !== 'function') return null;
  const rec = refMemo('crmChecks', [subs, state.reportingSourceConfig], 300000, () => crmReconciliationChecks(subs));
  const RULES = [
    ['Sold, Not Started, but the initial was completed', /^Sold, Not Started/i], ['“Expired Subscription” (a retired reason)', /Expired Subscription/i],
    ['Coded 3-day ROR on a sale that has no rescission', /coded as a 3-day ROR/i], ['Cancelled days after the sale with no reason', /after the sale with no reason/i],
    ['Sales Rep cancel inside the rescission window, coded as something else', /^Sales Rep cancel/i], ['One-time plan closed with a recurring reason', /^One-time plan closed/i],
    ['Recurring plan closed as One Time Service', /^Recurring plan closed as One Time/i]];
  const groups = RULES.map(([label]) => ({ label, rows: [] })), other = { label: 'Other', rows: [] };
  for (const r of (rec.cancel || [])) { const k = RULES.findIndex(([, re]) => re.test(String(r._flagReason || ''))); (k >= 0 ? groups[k] : other).rows.push(r); }
  const all = [...groups, other].filter(g => g.rows.length).sort((a, b) => b.rows.length - a.rows.length);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return el('div', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...all.map(g => el('div', { class: 'flex items-center gap-3 px-4 py-2 border-t text-xs', style: { borderColor: 'var(--border)', paddingLeft: '48px' } },
    el('span', { class: 'text-sm font-black tabular-nums shrink-0', style: { minWidth: '52px', textAlign: 'right' } }, g.rows.length.toLocaleString()),
    el('span', { class: 'flex-1 min-w-0' }, g.label, (() => { const n = g.rows.filter(r => r.sold_date && r.sold_date >= d30).length; return n ? el('span', { style: { color: 'var(--text-muted)' } }, ' · ' + n + ' sold in the last 30 days') : null; })()),
    el('button', { class: 'text-[11px] font-bold whitespace-nowrap shrink-0', style: { color: 'var(--accent)' }, onclick: () => openReportingDrillModal({ chartTitle: 'CRM fixes · Cancellation · ' + g.label, sliceLabel: g.rows.length + ' account' + (g.rows.length === 1 ? '' : 's') + ' · newest first', rows: g.rows, formatValue: fmt.usd0, review: { key: 'att:Cancellation', idOf: (r) => r.subscription_id != null ? r.subscription_id : r.customer_id } }) }, 'Review →'))));
}
// Tasks built from the app's own sales (Office Staff): a Passed Audit flag with no autopay behind it, and sales the
// pricing check already marked under the minimum. Shown as the subscription rows, so the list opens like every other.
function auditSalesItems() {
  const S = state.allSales || [], subs = state.reportingSubscriptions || [];
  if (!S.length || !subs.length) return [];
  const bySid = new Map(); for (const r of subs) if (r.subscription_id != null) bySid.set(String(r.subscription_id), r);
  const rowOf = (s, why) => { const r = bySid.get(String(s.crm_subscription_id)); return r ? Object.assign({}, r, { _flagReason: why }) : null; };
  const mk = (title, tag, rows, tone, todo, ok) => { const n = rows.length;
    const drill = (rs) => openReportingDrillModal({ chartTitle: 'Auditing · ' + title, sliceLabel: rs.length.toLocaleString() + ' subscription' + (rs.length === 1 ? '' : 's'), rows: rs, formatValue: fmt.usd0, review: { key: title, idOf: (r) => r.subscription_id } });
    return { key: title, tag, title, sev: n ? (tone === 'check' ? 'amber' : 'red') : 'ok', count: n, text: n ? todo(n) : ok, onClick: n ? () => drill(rows) : null,
      rvIds: rows.map(r => String(r.subscription_id)), rvOpen: (ids) => drill(rows.filter(r => ids.has(String(r.subscription_id)))) }; };
  const live = (s) => s.sale_kind !== 'upsell' && !/^cancel/i.test(String(s.audit_status || '')) && !(typeof isRenewalSource === 'function' && isRenewalSource(s));
  // Passed Audit is what makes an Office Staff new account payable (Nov 24) — so a pass on an account with no autopay is worth a look.
  const passed = S.filter(s => live(s) && s.crm_audit === 'passed' && s.crm_autopay === false && !s.payroll_processed_at)
    .map(s => rowOf(s, 'Passed Audit, but not on autopay' + (s.crm_paid_since_sale === true ? ' — a payment has gone through since the sale' : ' and no payment since the sale'))).filter(Boolean);
  const noPay = passed.filter(r => /no payment since/.test(r._flagReason)).length;
  const below = S.filter(s => live(s) && s.crm_below_min && !s.payroll_processed_at).map(s => rowOf(s, 'Under the pricing minimum: ' + s.crm_below_min)).filter(Boolean);
  return [
    mk('Passed Audit with no autopay', 'Passed audit', passed, noPay ? 'fix' : 'check',
      (n) => n + ' Office Staff sale' + (n === 1 ? '' : 's') + ' flagged Passed Audit and not yet paid, with the account not on autopay' + (noPay ? ' (' + noPay + ' with no payment since the sale)' : '') + ' — check the payment before payroll.',
      'All clear — every unpaid Passed Audit sale is on autopay.'),
    mk('Office Staff sales under the pricing minimum', 'Below minimum', below, 'check',
      (n) => n + ' Office Staff sale' + (n === 1 ? '' : 's') + ' not yet paid that the pricing check marked under the minimum — fix the price in FieldRoutes or confirm the sale pays at the below-minimum rate.',
      'All clear — no unpaid Office Staff sale is under the pricing minimum.')];
}
// ── Source check: FieldRoutes source vs the Pest AI source (per Isaac, Nov 25) ──
// The provider numbers on Marketing count a sale on its FieldRoutes source, so that source has to agree with what
// Pest AI (GoHighLevel) recorded for the same person wherever there is something to compare. For every new sale of
// this month and last (the Marketing tab's own sale rows), the Pest AI opportunity behind the sale is looked up by
// phone / email (mkdPestAiLookup — the same lookup as the "No lead" list). Flagged: the opportunity's source maps to a
// different channel than the FieldRoutes source, has no source, or is a source nothing maps. Sales with nothing in
// Pest AI at all are the separate "No GHL lead" task. The list opens with both sources side by side and what to change.
function auditSourceCheckItem() {
  if (typeof mklMonth !== 'function' || typeof mkdPestAiLookup !== 'function' || typeof _mklYm !== 'function') return null;
  const G = state._ghl; if (!G || !Array.isArray(G.opps) || !G.opps.length) return { key: 'Source check', tag: 'Source check', title: 'FieldRoutes source vs Pest AI source', sev: 'amber', count: null, text: 'checking… (waiting on GoHighLevel)' };
  const now = new Date(), yms = [_mklYm(now), _mklShift(_mklYm(now), -1)];
  const seen = new Set(), bad = [], pbRows = []; let compared = 0, agree = 0;
  for (const ym of yms) { const D = mklMonth(ym); if (!D || !D.x) continue;
    for (const o in D.x) for (const c in D.x[o]) for (const r of (D.x[o][c].sales || [])) {
      const id = String(r.subscription_id != null ? r.subscription_id : r.customer_id); if (seen.has(id)) continue; seen.add(id);
      const x = mkdPestAiLookup(r); if (!x) continue;
      // PestBooker is a SALES REP in FieldRoutes, not a source (per Isaac, Nov 25): a sale still sourced PestBooker needs
      // Sold By = PestBooker and its source set to the channel that brought the lead in.
      const frPb = /^pest\s*booker$/i.test(String(x.want || '')) || /^pest\s*booker$/i.test(String((typeof reportingSourceOf === 'function' ? reportingSourceOf(r) : r.subscription_source) || '').trim());
      if (frPb) {
        const real = x.oDate && x.oCh && x.oCh !== 'PestBooker' && x.oCh !== 'not a lead' ? x.oCh : '';
        pbRows.push(Object.assign({}, r, { _flagReason: 'FieldRoutes source is PestBooker \u2014 PestBooker is the sales rep, not a source: set Sold By to PestBooker and the source to the channel that brought the lead in' + (real ? ' (Pest AI says ' + real + ')' : x.oDate ? ' (Pest AI says PestBooker too \u2014 fix both)' : ' (nothing in Pest AI to go by)') }));
        continue;
      }
      if (!x.oDate) continue;                                                            // nothing in Pest AI to compare with
      if (/^Opportunity made after the sale|^Only an old opportunity/.test(x.fix)) continue;   // not the lead behind this sale
      // Only a lead that can be THE lead behind this sale is compared (Nov 25 accuracy pass): the opportunity is within 30
      // days before the sale, and its source is a real lead source — Local Presence (a callback number), the Voice AI
      // line and anything mapped "not a lead" are not a source, so they prove nothing either way.
      const gap = (Date.parse(String(r.sold_date || '').slice(0, 10)) - Date.parse(x.oDate)) / 86400000;
      if (!(gap <= 30)) continue;
      if (x.oCh === 'not a lead' || /^local presence|voice ai/i.test(String(x.oSrc || '')) || (typeof MKP_NOT_A_SOURCE !== 'undefined' && MKP_NOT_A_SOURCE.test(String(x.oSrc || '')))) continue;
      // PestBooker is the online booking page, NOT a source (per Isaac, Nov 25): an opportunity stamped PestBooker has
      // lost the channel that really brought the lead in. Those are their own task (fix the opportunity's source in
      // Pest AI), and say nothing about whether FieldRoutes is right — so they are out of the comparison either way.
      if (x.oCh === 'PestBooker' || /^pest\s*booker/i.test(String(x.oSrc || ''))) {
        pbRows.push(Object.assign({}, r, { _flagReason: 'Pest AI opportunity (' + x.oDate + ') has source PestBooker, which is not a source \u2014 set it to the channel that brought the lead in' + (x.want && x.want !== 'PestBooker' ? ' (FieldRoutes says ' + x.want + ')' : '; FieldRoutes says PestBooker too, so fix both') }));
        continue;
      }
      compared++;
      if (/^Matches/.test(x.fix)) { agree++; continue; }
      bad.push(Object.assign({}, r, { _flagReason: 'FieldRoutes: ' + x.want + ' · Pest AI: ' + (x.oSrc || 'no source') + (x.oCh && x.oCh !== x.oSrc ? ' (' + x.oCh + ')' : '') + ' — ' + x.fix }));
    } }
  bad.sort((a, b) => String(b.sold_date || '').localeCompare(String(a.sold_date || '')));
  const n = bad.length, open = (rs) => (typeof mkdOpenNoLead === 'function' ? mkdOpenNoLead('Source check · FieldRoutes vs Pest AI · this month and last', rs)
    : openReportingDrillModal({ chartTitle: 'Auditing · Source check', sliceLabel: rs.length + ' sales', rows: rs, formatValue: fmt.usd0 }));
  const main = { key: 'Source check', tag: 'Source check', title: 'FieldRoutes source vs Pest AI source', sev: n ? 'red' : 'ok', count: n,
    text: n ? n.toLocaleString() + ' new sale' + (n === 1 ? '' : 's') + ' this month and last where FieldRoutes and Pest AI disagree on the source (' + agree.toLocaleString() + ' of ' + compared.toLocaleString() + ' compared agree) — the list shows both and what to change. Compared only when the Pest AI lead is within 30 days before the sale and has a real lead source.'
      : 'All clear — every sale with a Pest AI lead behind it carries the same source in FieldRoutes (' + compared.toLocaleString() + ' compared).',
    onClick: n ? () => open(bad) : null, rvIds: bad.map(r => String(r.subscription_id != null ? r.subscription_id : r.customer_id)),
    rvOpen: (ids) => open(bad.filter(r => ids.has(String(r.subscription_id != null ? r.subscription_id : r.customer_id)))) };
  pbRows.sort((a, b) => String(b.sold_date || '').localeCompare(String(a.sold_date || '')));
  const idOf = (r) => String(r.subscription_id != null ? r.subscription_id : r.customer_id), np = pbRows.length;
  const openPb = (rs) => (typeof mkdOpenNoLead === 'function' ? mkdOpenNoLead('PestBooker stamped as the source in Pest AI \u00b7 this month and last', rs) : openReportingDrillModal({ chartTitle: 'Auditing \u00b7 PestBooker as source', sliceLabel: rs.length + ' sales', rows: rs, formatValue: fmt.usd0 }));
  const pbItem = { key: 'PestBooker as source', tag: 'PestBooker', title: 'PestBooker stamped as the source', sev: np ? 'red' : 'ok', count: np,
    text: np ? np.toLocaleString() + ' new sale' + (np === 1 ? '' : 's') + ' this month and last with PestBooker as the source in FieldRoutes or on the Pest AI opportunity. PestBooker is a sales rep, not a source \u2014 set Sold By to PestBooker in FieldRoutes and the source, in both, to the channel that brought the lead in.'
      : 'All clear \u2014 no recent sale has PestBooker as its source in FieldRoutes or Pest AI.',
    onClick: np ? () => openPb(pbRows) : null, rvIds: pbRows.map(idOf), rvOpen: (ids) => openPb(pbRows.filter(r => ids.has(idOf(r)))) };
  return [main, pbItem];
}
// Lead → opportunity and Unmapped GoHighLevel sources as Attribution tasks (per Isaac, Nov 25 — they were two
// separate dropdown cards under the list). Same checks, same cards: each opens inside its row. Built live, not in the
// memo, because mapping a source or toggling the card changes them.
function auditLeadDataItems() {
  if (state._ghl === undefined && typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const out = [];
  const opened = (flag, fn) => { const was = state[flag]; state[flag] = true; try { return fn(); } catch (e) { console.warn('[auditing] ' + flag, e); return null; } finally { state[flag] = was; } };
  const headText = (card) => { const sp = card && card.querySelector('button span:nth-of-type(3)'); return sp ? sp.textContent.trim() : ''; };
  try {
    const D = typeof _lomData === 'function' ? _lomData() : null;
    if (D && D.rows && D.rows.length) {
      const bad = D.rows.filter(r => r.broken).length, soft = D.rows.filter(r => r.soft).length;
      const it = { key: 'Lead to opportunity', tag: 'Lead → opportunity', title: 'Lead → opportunity', sev: bad ? 'red' : soft ? 'amber' : 'ok', count: bad + soft,
        text: (headText(opened('_lomOpen', () => leadOppMonitorCard())) || 'New contacts that never got an opportunity, by source') + ' — last 7 days against the 28 before.' };
      Object.defineProperty(it, 'detail', { enumerable: true, get() { return opened('_lomOpen', () => leadOppMonitorCard()); } });
      out.push(it);
    }
  } catch (e) { console.warn('[auditing] lead-opp', e); }
  try {
    const card = typeof ghlUnmappedTodoCard === 'function' ? opened('_ghlTodoOpen', () => ghlUnmappedTodoCard()) : null;
    const text = headText(card), n = Number((text.match(/^([\d,]+)\s+source/) || [])[1] ? text.match(/^([\d,]+)\s+source/)[1].replace(/,/g, '') : 0);
    const it = { key: 'Unmapped GoHighLevel sources', tag: 'Unmapped sources', title: 'Unmapped GoHighLevel sources', sev: card ? 'red' : 'ok', count: card ? n : 0,
      text: card ? text : 'All clear — every GoHighLevel opportunity source is mapped to a channel.' };
    if (card) Object.defineProperty(it, 'detail', { enumerable: true, get() { return opened('_ghlTodoOpen', () => ghlUnmappedTodoCard()); } });
    out.push(it);
  } catch (e) { console.warn('[auditing] unmapped sources', e); }
  return out;
}
function auditTasksCard() {
  const _items0 = auditTaskItems();
  // The deleted-customer review is built live (its buttons change it), not in the memo.
  const _items = _items0 == null ? null : [..._items0, crmDelReviewItem(), ...auditLeadDataItems()];
  if (_items == null) return el('div', { class: 'card overflow-hidden' }, el('div', { class: 'w-full flex items-center gap-2 px-4 py-2.5' },
    el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: 'var(--border-2)' } }),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'Auditing tasks'), el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'checking…')));
  // No check-off boxes (per Isaac, Nov 19): every task shows while it has rows, and leaves when it's clear.
  const all = _items;
  const RANK = { red: 0, amber: 1, ok: 2 };
  const todo = all.filter(i => i.sev !== 'ok').sort((a, b) => RANK[a.sev] - RANK[b.sev]);
  const entries = auditTaskEntries(todo);
  const clear = all.filter(i => i.sev === 'ok');
  const open = state._auditTasksOpen !== false;
  const reds = todo.filter(i => i.sev === 'red').length;
  const head = el('button', { class: 'w-full flex items-center gap-2 px-4 py-2.5 text-left', onclick: () => { state._auditTasksOpen = !open; mountApp(); } },
    el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: !todo.length ? 'var(--ok)' : reds ? '#DC2626' : '#D97706' } }),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'Auditing tasks'),
    el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, !todo.length ? 'All clear — nothing to fix in FieldRoutes.' : entries.length + ' to do' + (open ? '' : ' · ' + entries.slice(0, 3).map(e => e.item ? e.item.tag : e.label).join(', ') + (entries.length > 3 ? '…' : '')) + (clear.length ? ' · ' + clear.length + ' clear' : '')),
    el('span', { class: 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, open ? '▴' : '▾'));
  if (!open) return el('div', { class: 'card overflow-hidden' }, head);
  const row = (i, idx, sub) => {
    const hasDetail = i.detail !== undefined;
    const showing = hasDetail && state._auditDetail === i.key;
    const click = hasDetail ? () => { state._auditDetail = showing ? null : i.key; mountApp(); } : i.onClick;
    const red = i.sev === 'red';
    return [el('div', { class: 'flex items-center gap-3 px-4 py-2 border-t text-xs audit-task-row', style: { borderColor: 'var(--border)', background: sub ? 'var(--card-2)' : undefined }, title: i.title || '' },
      el('span', { class: 'text-[10px] font-bold tabular-nums shrink-0', style: { color: 'var(--text-subtle)', width: '18px', textAlign: 'right' } }, sub ? '\u21b3' : String(idx + 1) + '.'),
      el('span', { class: 'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0', style: { background: red ? 'rgba(220,38,38,.12)' : 'rgba(217,119,6,.14)', color: red ? '#DC2626' : '#B45309', minWidth: '72px', textAlign: 'center' } }, i.tag),
      el('span', { class: 'text-sm font-black tabular-nums shrink-0', style: { minWidth: '52px', textAlign: 'right', color: red ? '#DC2626' : 'var(--text)' } }, i.count != null ? Number(i.count).toLocaleString() : '…'),
      el('span', { class: 'flex-1 min-w-0 audit-task-text', style: { overflowWrap: 'anywhere' } }, i.text),
      click && (i.count == null || i.count > 0) ? el('button', { class: 'text-[11px] font-bold whitespace-nowrap shrink-0', style: { color: 'var(--accent)' }, onclick: click }, (showing ? 'Hide' : 'Review') + ' →') : null),
      showing ? i.detail : null];
  };
  return el('div', { class: 'card overflow-hidden' }, head,
    todo.length ? el('div', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...(() => {
      const out = []; let num = 0;
      const famRow = (e, idx) => {
        const isOpen = (state._auditFamOpen || {})[e.fam] === true, red = e.members.some(m => m.sev === 'red');
        const total = e.members.reduce((t, m) => t + (Number(m.count) || 0), 0), pend = e.members.some(m => m.count == null);
        const head2 = el('div', { class: 'flex items-center gap-3 px-4 py-2 border-t text-xs audit-task-row cursor-pointer', style: { borderColor: 'var(--border)' }, onclick: () => { state._auditFamOpen = Object.assign({}, state._auditFamOpen || {}, { [e.fam]: !isOpen }); mountApp(); } },
          el('span', { class: 'text-[10px] font-bold tabular-nums shrink-0', style: { color: 'var(--text-subtle)', width: '18px', textAlign: 'right' } }, String(idx + 1) + '.'),
          el('span', { class: 'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0', style: { background: red ? 'rgba(220,38,38,.12)' : 'rgba(217,119,6,.14)', color: red ? '#DC2626' : '#B45309', minWidth: '72px', textAlign: 'center' } }, e.label),
          el('span', { class: 'text-sm font-black tabular-nums shrink-0', style: { minWidth: '52px', textAlign: 'right', color: red ? '#DC2626' : 'var(--text)' } }, total.toLocaleString() + (pend ? '+' : '')),
          el('span', { class: 'flex-1 min-w-0 audit-task-text', style: { overflowWrap: 'anywhere' } }, e.members.map(m => (m.title && m.title.length < 46 ? m.title : m.tag) + ' ' + (m.count != null ? Number(m.count).toLocaleString() : '…')).join(' · ')),
          el('span', { class: 'text-[11px] font-bold whitespace-nowrap shrink-0', style: { color: 'var(--accent)' } }, (isOpen ? 'Hide' : 'Show ' + e.members.length) + ' →'));
        return isOpen ? [head2, ...e.members.flatMap(m => row(m, 0, true))] : [head2];
      };
      for (const [sk, sl] of AUDIT_SECTIONS) {
        const es = entries.filter(e => e.sec === sk); if (!es.length) continue;
        out.push(el('div', { class: 'px-4 py-1.5 border-t text-[10px] uppercase tracking-widest font-bold', style: { borderColor: 'var(--border)', background: 'var(--card-2)', color: 'var(--text-muted)' } }, sl + ' · ' + es.length));
        for (const e of es) { out.push(...(e.item ? row(e.item, num) : famRow(e, num))); num++; }
      }
      return out;
    })()) : null,
    clear.length ? el('div', { class: 'px-4 py-2 border-t text-[11px]', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } },
      el('span', { style: { color: 'var(--ok)', fontWeight: 700 } }, '✓ All clear: '), clear.map(i => i.title || i.tag).join(' · ')) : null);
}
function auditSubTasks() {
  const rows = state.reportingSubscriptions || [];
  if (!rows.length) return [];
  const M = auditSubTasks._m;
  const key = rows.length + '|' + JSON.stringify((state.reportingServiceConfig || []).map(c => c.service_name + ':' + (c.lifecycle || ''))) + '|' + Object.keys((typeof commissionConfig === 'function' && commissionConfig().serviceCategories) || {}).length;
  if (M && M.src === rows && M.key === key) return M.tasks;
  const isActive = (r) => String(r.subscription_status || '').trim().toLowerCase() === 'active' && !r.subscription_date_canceled;
  const s = (n) => n === 1 ? '' : 's';
  const tasks = [];
  // 1. One-time (or retired) services that are still open after the work was done.
  tasks.push({ tag: 'One-time', title: 'One-time services still active', noun: 'subscription', rows: reportingFlaggedActive(rows, isActive),
    ok: 'All clear — no one-time or retired service is sitting open.',
    todo: (n) => n + ' active subscription' + s(n) + ' on a one-time or retired service that has already been serviced — close ' + (n === 1 ? 'it' : 'them') + ' in FieldRoutes so the active count is right. One-time German roach (2-week follow-up) and rodent (60-day follow-up) jobs are left open until the follow-up is done or its window, plus a week, has passed.' });
  // 2. Renewed, but the plan it replaced was never closed (same kind of plan, both active) — the customer may be billed twice.
  const fam = (x) => String(x || '').trim().split(/\s+/)[0].toLowerCase();
  const dup = [];
  try {
    const lives = semCustomerLives(rows, { include: (r) => !/sentricon/i.test(String(r.subscription || '')) });
    const cutoff = Date.now() - 14 * 86400000;
    for (const c of lives.values()) {
      if (!c.firstRenewal || c.firstRenewal.at > cutoff || !isActive(c.firstRenewal.row)) continue;
      const ren = c.firstRenewal.row, renIso = String(ren.sold_date || '').slice(0, 10);
      for (const r of c.subs) {
        if (r === ren || !isActive(r) || reportingSourceClass(r.subscription_source) === 'renewal') continue;
        if (String(r.sold_date || '').slice(0, 10) >= renIso || fam(r.subscription) !== fam(ren.subscription)) continue;
        dup.push({ ...r, _flagReason: 'Renewed ' + renIso + ' into ' + (ren.subscription || 'a new plan') + ' (sub ' + ren.subscription_id + ') — this older plan is still active' });
      }
    }
  } catch (e) { console.warn('[auditing] renewal-duplicate task skipped', e); }
  tasks.push({ tag: 'Renewal', title: 'Renewed, old plan still active', noun: 'subscription', tone: 'check', rows: dup,
    ok: 'All clear — no renewed customer still has the plan it replaced open.',
    todo: (n) => n + ' older plan' + s(n) + ' still active on a customer who has since renewed into the same kind of plan — check for double billing and close the old one.' });
  // 3. Sourced "Door to Door" but sold by someone who has never sold as a Sales Rep this year — usually a mis-picked source.
  const yr = String(new Date().getFullYear());
  const d2dSellers = new Set();
  for (const r of rows) if (String(r.sold_date || '').slice(0, 4) === yr && String(r.sold_by_type || '').trim() === 'Sales Rep' && r.sold_by_id != null) d2dSellers.add(String(r.sold_by || '').trim().toLowerCase());
  const mis = rows.filter(r => String(r.sold_date || '').slice(0, 4) === yr && String(r.subscription_source || '').trim().toLowerCase() === 'door to door'
    && ['Office Staff', 'Technician'].includes(String(r.sold_by_type || '').trim()) && !d2dSellers.has(String(r.sold_by || '').trim().toLowerCase()))
    .map(r => ({ ...r, _flagReason: 'Source is Door to Door, but sold by ' + String(r.sold_by_type).trim() + ' ' + (String(r.sold_by || '').trim() || '#' + r.sold_by_id) + ', who has no Sales Rep sales in ' + yr }));
  // (Listed under the Source check from Needs attention since Nov 9 — an Office Staff sale left on Door to Door is
  // one of its rows — so it is not a task of its own any more.)
  void mis;
  // 4. Service types with no commission category: a Sales Rep sale this year on a service the D2D calculator has no
  //    rule for, so it pays $0 until the service is classified (Settings → Commissions).
  const cats = (typeof commissionConfig === 'function') ? (commissionConfig().serviceCategories || {}) : {};
  const notSale = (name) => (typeof reportingNonSaleService === 'function') ? reportingNonSaleService(name) : false;
  if (!Object.keys(cats).length) tasks.push({ tag: 'Commission', title: 'Service types with no commission category', warn: 'The commission category list is empty, so every Sales Rep sale is unclassified. Run migrations/20261006_sales_rep_full_rate.sql, then this task lists what is left.' });
  else {
    const un = rows.filter(r => String(r.sold_date || '').slice(0, 4) === yr && String(r.sold_by_type || '').trim() === 'Sales Rep' && !r.subscription_date_canceled && !cats[r.subscription] && !notSale(r.subscription))
      .map(r => ({ ...r, _flagReason: 'Service type "' + (r.subscription || 'blank') + '" has no commission category — pays $0 until it is classified' }));
    const names = new Set(un.map(r => r.subscription));
    tasks.push({ tag: 'Commission', title: 'Service types with no commission category', noun: 'subscription', rows: un,
      ok: 'All clear — every service type a Sales Rep sold this year has a commission category.',
      todo: (n) => n + ' Sales Rep sale' + s(n) + ' in ' + yr + ' across ' + names.size + ' service type' + s(names.size) + ' with no commission category — classify ' + (names.size === 1 ? 'it' : 'them') + ' in Settings \u2192 Commissions.' });
  }
  // 5. Sales with no seller type: FieldRoutes has no Office Staff / Sales Rep / Technician type for whoever sold it,
  //    so the sale lands on no dashboard and in no pay queue.
  const noType = rows.filter(r => String(r.sold_date || '').slice(0, 4) === yr && !String(r.sold_by_type || '').trim() && !notSale(r.subscription))
    .map(r => ({ ...r, _flagReason: 'No seller type in FieldRoutes for ' + (String(r.sold_by || '').trim() || (r.sold_by_id != null && String(r.sold_by_id) !== '0' ? 'employee #' + r.sold_by_id : 'a blank Sold By')) }));
  tasks.push({ tag: 'Seller type', title: 'Sales with no seller type', noun: 'subscription', rows: noType,
    ok: 'All clear — every sale this year has a seller with a type.',
    todo: (n) => n + ' sale' + s(n) + ' in ' + yr + ' sold by someone with no Office Staff / Sales Rep / Technician type — set Sold By (or the employee\u2019s type) in FieldRoutes.' });
  // 6. Sold but never started: sold more than 14 days ago (within the last year), not cancelled, and the initial
  //    service still has not been completed.
  const dayMs = 86400000, nowMs = Date.now();
  const stale = rows.filter(r => { if (r.subscription_date_canceled || notSale(r.subscription)) return false;
      const sd = Date.parse(String(r.sold_date || '').slice(0, 10)); if (isNaN(sd)) return false; const age = (nowMs - sd) / dayMs; if (age < 14 || age > 365) return false;
      if (String(r.subscription_status || '').trim().toLowerCase() !== 'active') return false;
      if (r.initial_service || r.initial_serviced_date || String(r.initial_status || '').trim().toLowerCase() === 'completed') return false;
      // Not errors (per Isaac, Nov 19 audit review): an initial booked for a future date is scheduled, not stuck
      // (Sentricon installs book weeks out); a Pending initial more than 7 days past is the "Deleted?" task's list —
      // reviewed there, not twice.
      const ap = Date.parse(String(r.initial_appt_date || '').slice(0, 10));
      if (!isNaN(ap) && ap >= nowMs - dayMs) return false;
      if (!isNaN(ap) && /^pending$/i.test(String(r.initial_status || '').trim()) && (nowMs - ap) / dayMs > 7) return false;
      return true; })
    .map(r => { const age = Math.round((nowMs - Date.parse(String(r.sold_date).slice(0, 10))) / dayMs); const ist = String(r.initial_status || '').trim();
      return { ...r, _flagReason: 'Sold ' + age + ' days ago, initial service ' + (ist ? 'is ' + ist : 'has no appointment') + ' — schedule it or close the subscription' }; });
  tasks.push({ tag: 'Not started', title: 'Sold but never started', noun: 'subscription', rows: stale,
    ok: 'All clear — nothing sold more than two weeks ago is still waiting on its first service.',
    todo: (n) => n + ' active subscription' + s(n) + ' sold more than 14 days ago with no completed initial service and nothing booked ahead — schedule the first visit or close ' + (n === 1 ? 'it' : 'them') + '. (Pending initials more than a week past are under Deleted?.)' });
  // 6a. Renewal sold under a non-Renewal source (per Isaac, Oct 13 — moved here from the Renewals queue).
  const misSrc = (typeof renewalMisSourcedRows === 'function') ? renewalMisSourcedRows(rows).sort((x, y) => String(y.sold).localeCompare(String(x.sold))) : [];
  tasks.push({ tag: 'Renewal source', title: 'Renewals sold under a non-Renewal source', noun: 'subscription', tone: 'check', rows: misSrc,
    ok: 'All clear — every renewal carries a Renewal source.',
    todo: (n) => n + ' renewal' + s(n) + ' sold under a non-Renewal source (the old plan closed as Renewal, the new one sold right beside it) — set the source to the right Renewal source in FieldRoutes.' });
  // 6c. Active recurring plan, paying, but no contract length (per Isaac, Oct 13): it can't come up for renewal, so
  //     it's kept off the Renewals queue and listed here. Sentricon, one-time and $0 plans are left out.
  const noLen = rows.filter(r => isActive(r) && !notSale(r.subscription) && !/sentricon|one[\s-]?time/i.test(String(r.subscription || ''))
      && (Number(r.annual_recurring_value) || 0) > 0 && !((Number(r.agreement_length) || 0) > 0))
    .sort((x, y) => (Number(y.annual_recurring_value) || 0) - (Number(x.annual_recurring_value) || 0))
    .map(r => ({ ...r, _flagReason: 'Customer #' + r.customer_id + ' · ' + (r.subscription || 'plan') + ' · ' + fmt.usd0(Number(r.annual_recurring_value) || 0) + '/yr with no contract length — set the agreement length in FieldRoutes' }));
  tasks.push({ tag: 'Contract', title: 'Active plan with no contract length', noun: 'subscription', tone: 'check', rows: noLen,
    ok: 'All clear — every paying recurring plan has a contract length.',
    todo: (n) => n + ' active paying plan' + s(n) + ' with no contract length (' + fmt.usd0(noLen.reduce((a, r) => a + (Number(r.annual_recurring_value) || 0), 0)) + '/yr) — set the agreement length in FieldRoutes so ' + (n === 1 ? 'it comes' : 'they come') + ' up for renewal.' });
  // 6b. No signed agreement (per Isaac, Oct 13): active recurring sales this year, sold 2+ days ago, whose agreement
  //     was never e-signed in FieldRoutes (sent and unsigned, or never sent). One-time services don't need one.
  const unsigned = rows.filter(r => { if (!isActive(r) || notSale(r.subscription) || /one[\s-]?time/i.test(String(r.subscription || ''))) return false;
      const sd = String(r.sold_date || '').slice(0, 10); if (sd.slice(0, 4) !== yr) return false;
      const age = (nowMs - Date.parse(sd)) / dayMs; if (isNaN(age) || age < 2) return false;
      if (String(r.contract_state || 'none') === 'signed') return false;
      // Sent and still inside a week is in progress, not a task (Nov 24 audit review) — unless an initial is already booked.
      if (String(r.contract_state) === 'sent' && age < 7 && !/^pending$/i.test(String(r.initial_status || '').trim())) return false;
      return true; })
    .sort((x, y) => String(y.sold_date).localeCompare(String(x.sold_date)))
    .map(r => ({ ...r, _flagReason: 'Customer #' + r.customer_id + ' · sold ' + String(r.sold_date).slice(0, 10) + ' · agreement ' + (String(r.contract_state) === 'sent' ? 'sent, not signed' : 'never sent') }));
  // An initial on the books with no signature is the red flag (per Isaac, Nov 7 — "we do NOT want scheduled
  // appointments without signed contracts"; merged here from Marketing's Contract check, Nov 9).
  const unsignedSched = unsigned.filter(r => /^pending$/i.test(String(r.initial_status || '').trim())).length;
  tasks.push({ tag: 'Agreement', title: 'No signed agreement', noun: 'subscription', tone: unsignedSched ? 'fix' : 'check', rows: unsigned,
    ok: 'All clear — every active sale this year has a signed agreement.',
    todo: (n) => n.toLocaleString() + ' active sale' + s(n) + ' in ' + yr + ' with no signed agreement (' + unsigned.filter(r => String(r.contract_state) === 'sent').length.toLocaleString() + ' sent over a week ago or with an initial booked'
      + (unsignedSched ? ' · ' + unsignedSched.toLocaleString() + ' with an initial appointment scheduled — get it signed or pull the appointment' : '') + ') — resend it from Documents in FieldRoutes and get it signed.' });
  // 7. Cancelled with no reason (per Isaac, Oct 13 — the list he works through in FieldRoutes). Only cancels that
  //    count in the retention book: every year, the first service was completed, not a one-time / non-sale service,
  //    and not a 3-day order reversal (cancelled within 3 days of the sale with under 2 services). Deleted customers
  //    and ghost copies are already out of the book (_filterDeletedRows). Newest cancels first.
  const _d = (x) => Date.parse(String(x || '').slice(0, 10));
  const noReason = rows.filter(r => {
      if (!r.subscription_date_canceled || String(r.subscription_cancellation_reason || '').trim()) return false;   // blank only — “Unspecified” IS a reason (per Isaac, Oct 14)
      if (notSale(r.subscription) || /one[\s-]?time/i.test(String(r.subscription || ''))) return false;
      const done = Number(r.subscription_completed_services != null ? r.subscription_completed_services : r.completed_services) || 0;
      if (!(r.initial_service || r.initial_serviced_date) || String(r.initial_status || 'completed').trim().toLowerCase() !== 'completed' || done < 1) return false;
      const gap = (_d(r.subscription_date_canceled) - _d(r.sold_date)) / dayMs;
      if (!isNaN(gap) && gap <= 3 && done < 2) return false;
      return true; })
    .sort((x, y) => String(y.subscription_date_canceled).localeCompare(String(x.subscription_date_canceled)))
    .map(r => ({ ...r, _flagReason: 'Customer #' + r.customer_id + ' · cancelled ' + String(r.subscription_date_canceled).slice(0, 10) + ' after ' + (Number(r.subscription_completed_services != null ? r.subscription_completed_services : r.completed_services) || 0) + ' service' + s(Number(r.subscription_completed_services != null ? r.subscription_completed_services : r.completed_services) || 0) + ' — no cancellation reason' }));
  const nrYr = noReason.filter(r => String(r.subscription_date_canceled).slice(0, 4) === yr).length;
  tasks.push({ tag: 'No reason', title: 'Cancelled with no reason', noun: 'subscription', tone: 'check', rows: noReason,
    ok: 'All clear — every serviced cancel has a reason.',
    todo: (n) => n.toLocaleString() + ' serviced cancel' + s(n) + ' with no reason (' + nrYr.toLocaleString() + ' in ' + yr + ') — search the customer # in FieldRoutes and add the reason so the retention book and churn reasons are right. Never-serviced, 3-day reversals and deleted customers are already left out.' });
  // 8. Cancelled, then replaced by a new plan within 30 days (per Isaac, Oct 14): the same customer has a
  //    newer recurring plan sold from 7 days before to 30 days after the cancel, still running past it, and
  //    the cancel was NOT coded as a renewal (those are already linked to the customer's oldest plan). Likely
  //    uncoded renewals or re-entries — review them before deciding to link them like renewals.
  {
    const cfgM = new Map((state.reportingServiceConfig || []).map(c => [c.service_name, c]));
    const recur = (r) => { const c = cfgM.get(r.subscription); return !!c && (c.lifecycle || 'recurring') !== 'onetime' && c.lifecycle !== 'retired' && !c.is_hidden; };
    const d10 = (x) => String(x || '').slice(0, 10);
    const byCust = new Map();
    for (const r of rows) { if (!recur(r)) continue; const c = String(r.customer_id || ''); if (!c) continue; (byCust.get(c) || byCust.set(c, []).get(c)).push(r); }
    const shift = (iso, days) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + days); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const replaced = [];
    for (const r of rows) {
      if (!r.subscription_date_canceled || !recur(r) || !r.initial_service) continue;
      const why = String(r.subscription_cancellation_reason || '').trim();
      if (/^renewal\b/i.test(why) || /combined subscriptions|3\s*day\s*ror/i.test(why)) continue;
      const cx = d10(r.subscription_date_canceled), lo = shift(cx, -7), hi = shift(cx, 30);
      const o = (byCust.get(String(r.customer_id)) || []).find(x => x !== r && d10(x.sold_date || x.initial_service) >= lo && d10(x.sold_date || x.initial_service) <= hi && (!x.subscription_date_canceled || d10(x.subscription_date_canceled) > cx));
      if (o) replaced.push({ ...r, _flagReason: 'Customer #' + r.customer_id + ' · cancelled ' + cx + ' (' + (why || 'no reason') + ') · new plan ' + (o.subscription || '') + ' #' + o.subscription_id + ' sold ' + d10(o.sold_date || o.initial_service) + (o.subscription_date_canceled ? ' (cancelled ' + d10(o.subscription_date_canceled) + ')' : ' (active)') });
    }
    replaced.sort((x, y) => String(y.subscription_date_canceled).localeCompare(String(x.subscription_date_canceled)));
    // Removed from the task list (per Isaac, Nov 19 audit review): mostly same-day downgrades that retention already
    // links ("Link cancels replaced within 30 days"), so there's nothing to fix in FieldRoutes.
    if (false) tasks.push({ tag: 'Replaced', title: 'Cancelled, then replaced by a new plan within 30 days', noun: 'subscription', tone: 'check', rows: replaced,
      ok: 'All clear — no cancels were replaced by a new plan.',
      todo: (n) => n.toLocaleString() + ' cancel' + s(n) + ' where the customer got a new plan within 30 days, not coded as a renewal — likely uncoded renewals or re-entries. Retention now links these like renewals (step "Link cancels replaced within 30 days"), so they no longer count as churn — still recode the reason to a Renewal in FieldRoutes if it was one.' });
  }
  // Sentricon without a contract (per Isaac, Oct 14): every Sentricon needs at
  // least a 12-month agreement. They're sold as no-contract, so once the initial
  // service is done the agreement length must be set to 12 in FieldRoutes.
  {
    const sentNoTerm = rows.filter(r => /sentricon/i.test(String(r.subscription || '')) && !/install/i.test(String(r.subscription || ''))
      && (!!r.initial_service || String(r.initial_status || '').toLowerCase() === 'completed')
      && !((Number(r.agreement_length) || 0) >= 12)
      // Active, or cancelled in the last 90 days (per Isaac, Nov 19 audit review).
      && (isActive(r) || (Date.now() - Date.parse(String(r.subscription_date_canceled || '').slice(0, 10))) <= 90 * 86400000))
      .map(r => ({ ...r, _flagReason: 'Customer #' + r.customer_id + ' \u00b7 ' + (r.subscription || 'Sentricon') + ' \u00b7 ' + (/active/i.test(String(r.subscription_status || '')) && !r.subscription_date_canceled ? 'active' : 'frozen') + ' \u00b7 serviced ' + String(r.initial_service || '').slice(0, 10) + ' \u00b7 contract ' + ((Number(r.agreement_length) || 0) ? r.agreement_length + ' mo' : 'none') + ' \u2014 set to 12' }));
    tasks.push({ tag: 'Sentricon', title: 'Sentricon with no 12-month contract', noun: 'subscription', tone: 'check', rows: sentNoTerm,
      ok: 'All clear \u2014 every serviced Sentricon is on a 12-month (or longer) contract.',
      todo: (n) => n.toLocaleString() + ' Sentricon plan' + s(n) + ' (active, or cancelled in the last 90 days) with its initial service done but no contract or under 12 months \u2014 set the agreement length to 12 in FieldRoutes.' });
  }
  // 9. State doesn't match the ZIP (per Isaac, Oct 14): reporting already uses the
  //    ZIP's state; these are the customers to correct in FieldRoutes.
  {
    const seen = new Set(), bad = [];
    for (const r of rows) { if (!r.state_crm || seen.has(String(r.customer_id))) continue; seen.add(String(r.customer_id));
      const zipWrong = r.state !== r.zip_state;
      bad.push({ ...r, _flagReason: 'Customer #' + r.customer_id + ' \u00b7 state ' + r.state_crm + ', ZIP ' + String(r.zip_code || '').slice(0, 5) + ' is ' + r.zip_state + ' \u2014 ' + (zipWrong ? 'the ZIP looks wrong (kept ' + r.state + ', the office\u2019s state)' : 'the state looks wrong (reporting uses ' + r.state + ')') }); }
    // (Since Nov 9 these customers are rows of the Location check from Needs attention — one list, not two.)
    void bad;
  }
  // 10. Active and not on autopay (per Isaac, Nov 24 — the same flag as the Upfront Sales rows, for the whole book).
  {
    const noAp = (r) => { const v = String(r.customer_auto_pay == null ? '' : r.customer_auto_pay).trim(); return !v || /^(no|0|false|none)$/i.test(v); };
    const list = rows.filter(r => isActive(r) && Number(r.annual_recurring_value) > 0 && r.initial_service && !notSale(r.subscription) && noAp(r))
      .sort((x, y) => (Number(y.days_past_due) || 0) - (Number(x.days_past_due) || 0))
      .map(r => ({ ...r, _flagReason: 'Customer #' + r.customer_id + ' · not on autopay' + ((Number(r.days_past_due) || 0) > 0 ? ' · ' + Number(r.days_past_due) + ' days past due' : '') }));
    const due = list.filter(r => (Number(r.days_past_due) || 0) > 0).length;
    tasks.push({ tag: 'Autopay', title: 'Active plans not on autopay', noun: 'subscription', tone: 'check', rows: list,
      ok: 'All clear — every active recurring plan is on autopay.',
      todo: (n) => n.toLocaleString() + ' active recurring plan' + s(n) + ' not on autopay' + (due ? ' (' + due.toLocaleString() + ' past due)' : '') + ' — turn autopay on in FieldRoutes or get a payment method on file.' });
  }
  // 11. Active but not being serviced: no completed service in more than twice the plan's own service frequency
  //     (a 90-day plan with nothing done in 180+ days). Mosquito and seasonal plans are left out (they pause for winter),
  //     and so are plans with a custom frequency.
  {
    const list = rows.filter(r => { if (!isActive(r) || !(Number(r.annual_recurring_value) > 0) || !r.initial_service || notSale(r.subscription)) return false;
        if (/mosquito|seasonal/i.test(String(r.subscription || ''))) return false;
        const f = Number(r.recurring_frequency); if (!(f > 0) || !r.last_completed_date) return false;
        const age = (nowMs - Date.parse(String(r.last_completed_date).slice(0, 10))) / dayMs;
        return age > f * 2; })
      .sort((x, y) => String(x.last_completed_date).localeCompare(String(y.last_completed_date)))
      .map(r => ({ ...r, _flagReason: 'Customer #' + r.customer_id + ' · every ' + Number(r.recurring_frequency) + ' days · last service ' + String(r.last_completed_date).slice(0, 10) + ' (' + Math.round((nowMs - Date.parse(String(r.last_completed_date).slice(0, 10))) / dayMs) + ' days ago)' }));
    tasks.push({ tag: 'Not serviced', title: 'Active but not being serviced', noun: 'subscription', tone: 'check', rows: list,
      ok: 'All clear — every active plan has been serviced inside twice its frequency.',
      todo: (n) => n.toLocaleString() + ' active plan' + s(n) + ' with no completed service in more than twice the plan’s frequency (' + fmt.usd0(list.reduce((a, r) => a + (Number(r.annual_recurring_value) || 0), 0)) + '/yr) — schedule the visit, or close the plan if the customer is gone.' });
  }
  // 12. Technician sale of a normal service with a free initial (per Isaac, Nov 24: technicians can give an add-on a free
  //     initial, not a normal service type; a Sales Rep can sell a $1 initial). "Normal service" here = the customer's
  //     FIRST plan — a plan added to a customer who already had one is the add-on.
  {
    const first = new Map(), paidDay = new Set();
    for (const r of rows) { const d = String(r.sold_date || '').slice(0, 10); if (!d) continue; const k = String(r.customer_id); if (!first.has(k) || d < first.get(k)) first.set(k, d); if (Number(r.initial_price) > 0) paidDay.add(k + '|' + d); }
    const list = rows.filter(r => String(r.sold_date || '').slice(0, 4) === yr && typeof crmSellerRole === 'function' && crmSellerRole(String(r.sold_by_type || '')) === 'technician'
        && !(Number(r.initial_price) > 0) && !notSale(r.subscription) && !/one[\s-]?time/i.test(String(r.subscription || '')) && !r.subscription_date_canceled
        && first.get(String(r.customer_id)) === String(r.sold_date).slice(0, 10) && !paidDay.has(String(r.customer_id) + '|' + String(r.sold_date).slice(0, 10)))
      .sort((x, y) => String(y.sold_date).localeCompare(String(x.sold_date)))
      .map(r => ({ ...r, _flagReason: 'Customer #' + r.customer_id + ' · sold ' + String(r.sold_date).slice(0, 10) + ' by a technician · first plan on the customer · free initial' }));
    tasks.push({ tag: 'Below minimum', title: 'Technician sales with a free initial', noun: 'subscription', tone: 'check', rows: list,
      ok: 'All clear — no technician sold a new customer a plan with a free initial this year.',
      todo: (n) => n + ' technician sale' + s(n) + ' in ' + yr + ' of a customer’s first plan with a free initial — a free initial is for add-ons only; fix the initial price in FieldRoutes.' });
  }
  auditSubTasks._m = { src: rows, key, tasks };
  return tasks;
}
