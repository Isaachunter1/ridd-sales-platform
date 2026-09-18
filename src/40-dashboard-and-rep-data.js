// ┌─ src/40-dashboard-and-rep-data.js ─────────────────────────────────────────────────────
// │ Inside Sales dashboard, war room, indicator sales pool + rep data helpers, player cards, tooltips.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// Dashboard → the SAME player card the Indicators leaderboard opens (per
// Isaac). Resolves the app profile to its CRM seller name via the bridged
// pool, rebuilds the office-staff rep roster from the raw CRM rows, and
// hands it to openIndicatorRepCard. Falls back to the old profile modal
// only when the person has no CRM sales at all.
function openDashboardPlayerCard(profileIdOrCrmName) {
  const isCrm = typeof profileIdOrCrmName === 'string' && profileIdOrCrmName.startsWith('crm:');
  const p = isCrm ? null : (state.allProfiles || []).find(x => x.id === profileIdOrCrmName);
  let nm = isCrm ? getCanonicalRepName(profileIdOrCrmName.slice(4)) : '';
  if (!nm) {
    const counts = new Map();
    for (const s of dashboardSales()) if (s.rep_id === profileIdOrCrmName && s._crmRep) counts.set(s._crmRep, (counts.get(s._crmRep) || 0) + 1);
    nm = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || getCanonicalRepName(p?.full_name || '');
  }
  const prevDept = state.indicatorDept, prevAcct = state.indicatorAcctStatus;
  let raw = [];
  try { state.indicatorDept = 'office'; state.indicatorAcctStatus = 'pending_serviced'; raw = indicatorSales(); }
  catch (e) { raw = []; }
  finally { state.indicatorDept = prevDept; state.indicatorAcctStatus = prevAcct; }
  if (!nm || !raw.some(x => getCanonicalRepName(x.rep) === nm)) {
    if (p) openRepProfileModal(p.id); else toast('No CRM sales for this rep yet', 'warn');
    return;
  }
  const allReps = _buildAllRepsFromRawSales(raw);
  const rep = allReps.find(r => r.name === nm) || _enrichRepFromRawSales(nm, raw);
  openIndicatorRepCard(rep, allReps);
}

function warRoomCrmSales() {
  const prevDept = state.indicatorDept;
  const prevAcct = state.indicatorAcctStatus;
  let raw = [];
  // PENDING/SERVICED basis (per Isaac, after trying sold-basis): the War
  // Room counts real production — FieldRoutes' own Pending/Serviced gate
  // applies, so accounts that closed before ever being serviced don't
  // count. Pinned explicitly now that the Indicators-page DEFAULT is Total.
  try { state.indicatorDept = 'office'; state.indicatorAcctStatus = 'pending_serviced'; raw = indicatorSales(); }
  catch (e) { raw = []; }
  finally { state.indicatorDept = prevDept; state.indicatorAcctStatus = prevAcct; }
  if (!raw.length) return [];
  if (_wrBridgeCache.src === raw && _wrBridgeCache.roster === state.frRoster
      && _wrBridgeCache.profiles === state.allProfiles) return _wrBridgeCache.out;
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  // CRM employee id → app profile, in layers. A profile's stored id may be a
  // BRANCH id rather than the group master, so every id in the person's
  // roster group indexes to the profile; name-signature and letter-signature
  // (with shared-token guard) mop up unlinked and variant-spelling accounts —
  // the Tyler Trump / Pere LeSueur class of split identities.
  const { map: masterOf, rowByMaster } = _frMasterMaps();
  const profByEmpId = new Map(), profBySig = new Map(), profBySqueeze = new Map();
  (state.allProfiles || []).forEach(p => {
    const pid = String(p.fieldroutes_employee_id || '').trim();
    if (pid) {
      const master = masterOf.get(pid) || pid;
      profByEmpId.set(pid, p.id);
      profByEmpId.set(master, p.id);
      const row = rowByMaster.get(master);
      if (row) String(row.employee_ids || row.employee_id || '').split(',').forEach(x => {
        const t = x.trim(); if (t && !profByEmpId.has(t)) profByEmpId.set(t, p.id);
      });
    }
    if (p.full_name) {
      profBySig.set(_sig(p.full_name), p.id);
      _nameSqueezeSigs(p.full_name).forEach(sg => profBySqueeze.set(sg, p.id));
    }
  });
  const srcIdByName = new Map((state.sources || []).map(o => [String(o.name || '').trim().toLowerCase(), o.id]));
  // CRM office strings vary ('Atlanta' / 'ATLANTA' / 'Atlanta, Detroit') —
  // first comma segment, uppercased, matched against app office names so
  // the admin Office cards keep working on CRM rows.
  const officeIdByName = new Map((state.offices || []).map(o => [String(o.name || '').split(',')[0].trim().toUpperCase(), o.id]));
  const svcIdByName = new Map((state.serviceTypes || []).map(o => [String(o.name || '').trim().toLowerCase(), o.id]));
  const out = [];
  raw.forEach((s, i) => {
    const iso = (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '';
    if (!iso) return;
    const canonical = getCanonicalRepName(s.rep);
    const empId = String(s.repId || '').trim();
    let rep_id = (empId && (profByEmpId.get(empId) || profByEmpId.get(masterOf.get(empId) || ''))) || profBySig.get(_sig(canonical)) || null;
    if (!rep_id) {
      for (const sg of _nameSqueezeSigs(canonical)) {
        const hit = profBySqueeze.get(sg);
        if (hit) { rep_id = hit; break; }
      }
    }
    const t = (typeof _parseIndicatorTime === 'function') ? _parseIndicatorTime(s) : null;
    const cv = Number(s.contractValue) || 0;
    const initial = Number(s.initialPrice) || 0;
    const months = Number(s.contract) || 0;
    out.push({
      id: 'crm-' + i,
      _crm: true,
      _crmRep: canonical,
      _crmRenewal: (typeof _indicatorIsRenewal === 'function') && _indicatorIsRenewal(s),
      _crmService: String(s.subscription || '').trim(),
      _crmAutoPay: !!(s.autoPay && s.autoPay !== 'No'),
      _crmOffice: String(s.office || ''),
      rep_id,
      logged_by: null,
      customer_name: s.customer || '',
      customer_number: s.customerId != null ? String(s.customerId) : null,
      office_id: officeIdByName.get(String(s.office || '').split(',')[0].trim().toUpperCase()) ?? null,
      service_type_id: svcIdByName.get(String(s.subscription || '').trim().toLowerCase()) ?? null,
      source_id: srcIdByName.get(String(s.source || '').trim().toLowerCase()) ?? null,
      contract_months: months,
      initial_amount: initial,
      // 11 remaining billings after the initial covers month 1 — matches the
      // auto-add sync's math, and initial + 11×monthly reconciles to CV.
      monthly_amount: months > 1 ? Math.max(0, Math.round(((cv - initial) / 11) * 100) / 100) : 0,
      pay_per_service: false,
      revenue_amount: cv,
      sold_date: iso,
      audit_status: 'serviced',
      created_at: iso + 'T' + (t ? String(t.hour).padStart(2, '0') + ':' + String(t.minute).padStart(2, '0') : '12:00') + ':00',
    });
  });
  _wrBridgeCache = { src: raw, roster: state.frRoster, profiles: state.allProfiles, out };
  return out;
}
// The combined pool every War Room metric reads: CRM rows + app upsells.
// Falls back to the app sales table until the shared dataset has loaded
// (with a one-time cloud kick so the room fills in without a manual refresh).
let _dashSalesCache = { crm: null, all: null, cts: null, srcs: null, out: null };
function dashboardSales() {
  const crm = warRoomCrmSales();
  if (!crm.length) {
    if (!state._dashCrmKick && !(typeof DEMO !== 'undefined' && DEMO)
        && typeof refreshIndicatorsFromCloud === 'function') {
      state._dashCrmKick = true;
      Promise.resolve(refreshIndicatorsFromCloud(true))
        .then(() => { if (state.view === 'dashboard') mountApp(); })
        .catch(() => { /* stamp shows the sync clock; fallback keeps rendering */ });
    }
    return state.allSales;
  }
  if (_dashSalesCache.crm === crm && _dashSalesCache.all === state.allSales
      && _dashSalesCache.cts === state.contractTypes && _dashSalesCache.srcs === state.sources
      && _dashSalesCache.day === ((typeof bizTodayIso === 'function') ? bizTodayIso() : _dashSalesCache.day)) return _dashSalesCache.out;
  const upsellCt  = new Set((state.contractTypes || []).filter(c => /upsell/i.test(String(c.name || ''))).map(c => c.id));
  const upsellSrc = new Set((state.sources || []).filter(o => /upsell/i.test(String(o.name || ''))).map(o => o.id));
  const ups = (state.allSales || []).filter(s => upsellCt.has(s.contract_type_id) || upsellSrc.has(s.source_id));
  // ── OPTIMISTIC TODAY (bottleneck fix): a sale logged at 2:14 shows on the
  // boards at 2:14 — not at the next hourly sync. Today's app-logged rows
  // with NO CRM counterpart yet ride along flagged _pendingSync; the moment
  // the CRM row lands (matched by customer # or name, same day) the logged
  // row steps aside, so totals never double-count. Scope: TODAY only —
  // yesterday's unmatched logs are data problems, not sync lag.
  const _todayIso = (typeof bizTodayIso === 'function') ? bizTodayIso() : new Date().toISOString().slice(0, 10);
  const _sqz = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const _crmNumsToday = new Set(), _crmNamesToday = new Set();
  crm.forEach(s => { if (s.sold_date === _todayIso) { if (s.customer_number) _crmNumsToday.add(String(s.customer_number)); if (s.customer_name) _crmNamesToday.add(_sqz(s.customer_name)); } });
  const _upIds = new Set(ups.map(u => u.id));
  const _EXCL_OPT = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const pend = (state.allSales || []).filter(s =>
    s.sold_date === _todayIso
    && !_upIds.has(s.id)
    && !_EXCL_OPT.has(s.audit_status)
    && !(s.customer_number && _crmNumsToday.has(String(s.customer_number)))
    && !(s.customer_name && _crmNamesToday.has(_sqz(s.customer_name)))
  ).map(s => Object.assign({}, s, { _pendingSync: true }));
  const out = crm.concat(ups, pend);
  _dashSalesCache = { crm, all: state.allSales, cts: state.contractTypes, srcs: state.sources, out, day: _todayIso };
  return out;
}

// Is this profile a TECHNICIAN? Same resolution ladder as office staff:
// linked CRM roster row → own CRM type → shared-dataset name-signature map.
// Which half of the Sales world does this person belong to? Drives the
// default landing view AND which sales tab they're allowed to see.
// The ACCESS PROFILE in the sales app decides (per Isaac, Sep 2026): an
// explicit role wins outright — a rep whose CRM type says Technician or
// Office Staff but who was given "Sales Rep - Partner" here IS a partner.
// The CRM type is only consulted for legacy 'rep' / role-less accounts.
const _EXPLICIT_ROLES = new Set(['rep_sales', 'rep_partner', 'rep_team_lead', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead']);
function repTypeGroup(p) {
  if (!p) return null;
  if (isAdminRole(p.role)) return 'admin';
  if (isAuditorRole(p.role)) return 'auditor';
  if (_EXPLICIT_ROLES.has(p.role)) return isOfficeStaffProfile(p) ? 'office' : 'd2d';
  if (isTechProfile(p)) return 'tech';
  if (isOfficeStaffProfile(p)) return 'office';
  return 'd2d';
}
function defaultViewFor(p) {
  const g = repTypeGroup(p);
  return g === 'tech' ? 'techs'
    : g === 'd2d' ? 'd2d_dashboard'
    : g === 'auditor' ? 'sales'
    : g === 'office' ? 'sales'   // office staff open straight into the Sales tab (per Isaac)
    : 'dashboard';
}
function isTechProfile(p) {
  if (!p) return false;
  if (_EXPLICIT_ROLES.has(p.role) || isAdminRole(p.role) || isAuditorRole(p.role)) return false;   // access profile wins over CRM type
  const emp = frRosterRowForProfile(p);
  if (emp && emp.type_label) return /technician/i.test(emp.type_label);
  if (state.profile && p.id === state.profile.id && state.myRepType) return /technician/i.test(state.myRepType);
  try {
    const t = (state._indicatorRepTypeBySig || {})[_repTypeNameSig(getCanonicalRepName(p.full_name || ''))];
    if (t) return /technician/i.test(t);
  } catch (e) { /* fall through */ }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: TECHNICIANS — Service Pro upsells. CRM rows with source
// "Upsell - Service Pro" are the live production feed (they sync hourly);
// techs manually log their upsells here too — same reasoning as inside
// sales: the manual log is the commission ledger of the original deal.
// ──────────────────────────────────────────────────────────────────────────
const TECH_UPSELL_SRC_RE = /^upsell\s*-\s*service\s*pro$/i;
let _techBridgeCache = { src: null, out: null };
function techUpsellRows() {
  let raw = [];
  const prevDept = state.indicatorDept;
  try { state.indicatorDept = 'all'; raw = indicatorSales(); }
  catch (e) { raw = []; }
  finally { state.indicatorDept = prevDept; }
  if (_techBridgeCache.src === raw && _techBridgeCache.out) return _techBridgeCache.out;
  const out = raw.filter(s => TECH_UPSELL_SRC_RE.test(String(s.source || '').trim()));
  _techBridgeCache = { src: raw, out };
  return out;
}
function viewTechs() {
  const isAdmin = isAdminRole(state.profile?.role);
  if (!isAdmin && !isTechProfile(state.profile)) {
    return el('div', { class: 'card p-10 text-center text-sm text-muted-' },
      'The Technicians tab is for Service Pros and admins. If you should have access, ask an admin to link your account to your CRM technician profile (Settings → Users).');
  }
  const range = getDateRange(state._techRange || 'today');
  const all = techUpsellRows();
  const inRange = all.filter(s => {
    const iso = (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '';
    if (!iso) return false;
    const d = new Date(iso + 'T00:00');
    return !isNaN(d) && d >= range.start && d <= range.end;
  });
  const revenue = inRange.reduce((a, s) => a + (Number(s.contractValue) || 0), 0);
  // Leaderboard: every SELLER of a Service Pro upsell in range, by CRM
  // name — techs without app accounts rank too (same rule as Inside Sales).
  const byTech = new Map();
  inRange.forEach(s => {
    const nm = flipLastFirst(getCanonicalRepName(s.rep || '—'));
    if (FR_SYSTEM_NAME_RE.test(nm)) return;
    let t = byTech.get(nm); if (!t) { t = { n: 0, rev: 0 }; byTech.set(nm, t); }
    t.n++; t.rev += Number(s.contractValue) || 0;
  });
  const board = [...byTech.entries()].map(([nm, t]) => ({ nm, ...t })).sort((a, b) => b.rev - a.rev);
  const rangeSel = el('select', {
    class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
    onchange: (e) => { state._techRange = e.target.value; mountApp(); },
  }, ...[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month'], ['year', 'This Year'], ['all', 'All Time']]
    .map(([v, l]) => { const o = el('option', { value: v }, l); if ((state._techRange || 'today') === v) o.selected = true; return o; }));
  const myUpsells = (state.mySales || []).filter(s => {
    const src2 = state.sources.find(o => o.id === s.source_id);
    return src2 && TECH_UPSELL_SRC_RE.test(String(src2.name || ''));
  });
  return el('div', { class: 'flex flex-col gap-5 w-full' },
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('button', {
        class: 'flex-1 min-w-0 rounded-xl px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => { state._saleFormPreset = 'tech'; openNewSaleModal(); state._saleFormPreset = null; },   // modal builds synchronously — consume then clear
      }, '+ Log Upsell'),
      rangeSel,
      configInfoBtn('Technicians data',
        'Live from FieldRoutes: every subscription with source "Upsell - Service Pro" (the technicians\u2019 dedicated upsell source), refreshed by the hourly sync. Technicians ALSO log their upsells manually with the + button — the manual log is the commission record of the original deal, exactly like Inside Sales. Techs without app accounts still rank here under their CRM name.')),
    el('div', { class: 'grid grid-cols-2 gap-4' },
      el('div', { class: 'card p-4 sm:p-5 text-center' },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Upsells'),
        el('div', { class: 'font-display text-3xl sm:text-4xl mt-1' }, fmt.int(inRange.length))),
      el('div', { class: 'card p-4 sm:p-5 text-center' },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Upsell Revenue'),
        el('div', { class: 'font-display text-3xl sm:text-4xl mt-1' }, fmt.usd0(revenue)))),
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b border- flex items-center justify-between' },
        el('h2', { class: 'text-base font-bold' }, 'Service Pro Leaderboard'),
        el('span', { class: 'text-xs text-muted-' }, board.length + ' techs')),
      board.length === 0
        ? el('div', { class: 'p-10 text-center text-sm text-muted-' }, 'No Service Pro upsells in this window yet — first one on the board takes #1.')
        : el('div', { class: 'scroll-x' },
            el('table', { class: 'w-full text-[12px]' },
              el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
                el('tr', {},
                  el('th', { class: 'text-left pl-4 pr-2 py-2 w-8' }, '#'),
                  el('th', { class: 'text-left px-2 py-2' }, 'Technician'),
                  el('th', { class: 'text-right px-2 py-2' }, 'Upsells'),
                  el('th', { class: 'text-right pl-2 pr-4 py-2' }, 'Revenue'))),
              el('tbody', {},
                ...board.slice(0, 50).map((r, i) => el('tr', { class: 'border-t border-' },
                  el('td', { class: 'pl-4 pr-2 py-2 font-bold tabular-nums' + (i === 0 ? ' text-base' : ''), style: i === 0 ? { color: 'var(--accent)' } : {} }, i + 1),
                  el('td', { class: 'px-2 py-2 font-semibold' }, r.nm),
                  el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.int(r.n)),
                  el('td', { class: 'pl-2 pr-4 py-2 text-right tabular-nums font-semibold' }, fmt.usd0(r.rev)))))))),
    !isAdmin && el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b border-' }, el('h2', { class: 'text-base font-bold' }, 'My Logged Upsells')),
      myUpsells.length === 0
        ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'Nothing logged yet — tap + Log Upsell after your next one.')
        : el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
            el('tbody', {}, ...myUpsells.slice(0, 25).map(s => el('tr', { class: 'border-t border-' },
              el('td', { class: 'pl-4 pr-2 py-2 tabular-nums text-muted-' }, s.sold_date),
              el('td', { class: 'px-2 py-2 font-semibold' }, s.customer_name || '—'),
              el('td', { class: 'px-2 py-2 text-muted-' }, nameFromId(state.serviceTypes, s.service_type_id)),
              el('td', { class: 'pl-2 pr-4 py-2 text-right tabular-nums font-semibold' }, fmt.usd0(s.revenue_amount))))))),
    ));
}

function viewDashboard() {
  const isAdmin = isAdminRole(state.profile?.role);
  const range = getDateRange(state.dashDateRange);
  // Scope: LIVE CRM office-staff sales + app-logged upsells for everyone
  // (see warRoomCrmSales above). Dashboard is a "what's the room doing"
  // view, not a personal scoreboard. Sales tab + Pay tab still scope to
  // state.mySales so reps can't see other reps' deal detail.
  const salesScope = dashboardSales();
  const windowSales = salesScope.filter(s => {
    const d = new Date(s.sold_date + 'T00:00');
    return d >= range.start && d <= range.end;
  });
  // Count every sale that isn't cancelled/nsf/not_payable/reschedule.
  // Pending and below-min sales still count toward total revenue on the dashboard.
  const EXCLUDE_DASH = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const approved = windowSales.filter(s => !EXCLUDE_DASH.has(s.audit_status));

  // Renewal split via source.is_renewal
  const renewalIds = new Set(state.sources.filter(s => s.is_renewal).map(s => s.id));
  const isRenewal  = (sale) => sale._crmRenewal ?? renewalIds.has(sale.source_id);
  const approvedNew     = approved.filter(s => !isRenewal(s));
  const approvedRenewal = approved.filter(s =>  isRenewal(s));

  const totalSalesCount  = approved.length;
  const newSalesCount    = approvedNew.length;
  const renewalCount     = approvedRenewal.length;

  const totalRevenue     = sumRev(approved);
  const newRevenue       = sumRev(approvedNew);
  const renewalRevenue   = sumRev(approvedRenewal);

  // Revenue goal
  const goal = getGoalForContext();
  const ytd  = goalYtdRevenue(isAdmin);
  const goalProgress = goal.amount > 0 ? Math.min(1, ytd[state.dashGoalTab] / goal.amount) : 0;
  const daysLeft = daysLeftInGoalPeriod(goal);

  return el('div', { class: 'flex flex-col gap-5 w-full' },

    // ─── Top row: + New Sale + date filter + office view ───
    el('div', { class: 'flex items-center gap-2 flex-wrap dash-toolbar' },
      // + New Sale stretches to fill the row on every screen (per Isaac);
      // Today / info keep their natural size on the right (dash-toolbar CSS).
      manualUpsellsOn() ? el('button', {
        class: 'dash-newsale rounded-xl px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => openNewSaleModal(),
      }, '+ New Sale') : el('div', { class: 'dash-newsale rounded-xl px-2.5 py-1 text-[11px] font-semibold text-center', style: { background: 'var(--card-2)', color: 'var(--text-muted)' }, title: 'Upsells are logged automatically from FieldRoutes add-on tickets' }, 'Sales and upsells sync from FieldRoutes'),

      // Date filter
      el('select', {
        class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer',
        onchange: e => {
          state.dashDateRange = e.target.value;
          if (state.dashDateRange === 'custom') {
            if (!state.dashCustomStart) state.dashCustomStart = new Date().toISOString().slice(0, 10);
            if (!state.dashCustomEnd)   state.dashCustomEnd   = new Date().toISOString().slice(0, 10);
          }
          mountApp();
        },
      },
        el('option', { value: 'today',      selected: state.dashDateRange === 'today' },      'Today'),
        el('option', { value: 'yesterday',  selected: state.dashDateRange === 'yesterday' },  'Yesterday'),
        el('option', { value: 'week',       selected: state.dashDateRange === 'week' },       'This Week'),
        el('option', { value: 'last_week',  selected: state.dashDateRange === 'last_week' },  'Last Week'),
        el('option', { value: 'month',      selected: state.dashDateRange === 'month' },      'This Month'),
        el('option', { value: 'last_month', selected: state.dashDateRange === 'last_month' }, 'Last Month'),
        el('option', { value: 'year',       selected: state.dashDateRange === 'year' },       'This Year'),
        el('option', { value: 'last_year',  selected: state.dashDateRange === 'last_year' },  'Last Year'),
        el('option', { value: 'all',        selected: state.dashDateRange === 'all' },        'All Time'),
        el('option', { value: 'custom',     selected: state.dashDateRange === 'custom' },     'Custom…'),
      ),

      // Custom range inputs
      state.dashDateRange === 'custom' && el('div', { class: 'flex items-center gap-2' },
        el('input', { type: 'date', class: 'rounded-xl px-2.5 py-1 text-[11px]', value: state.dashCustomStart || '', onchange: e => { state.dashCustomStart = e.target.value; mountApp(); } }),
        el('span', { class: 'text-muted- text-xs' }, '→'),
        el('input', { type: 'date', class: 'rounded-xl px-2.5 py-1 text-[11px]', value: state.dashCustomEnd || '', onchange: e => { state.dashCustomEnd = e.target.value; mountApp(); } }),
      ),

      configInfoBtn('Sales data',
        'Live from FieldRoutes. Every number on this page — goals, sales and revenue cards, the sales feed, and the leaderboard — comes from the CRM shared dataset (office-staff sales, refreshed by the hourly sync shown in the stamp), plus manually logged UPSELL rows (the one thing the CRM can\'t express). Reps manually log every sale for the pay/audit ledger — those logs are the commission record of the ORIGINAL contract — but regular logged sales are not re-counted here, since the CRM already carries them. Upsells count as New revenue. Office staff without an app account still count — their CRM sales rank under their CRM name. Contract values are exact CRM figures.'),
    ),

    // ─── Revenue Goal card — 3 bars: Total, New, Renewal ───
    (() => {
      const now2 = new Date();
      const dayOfYear = Math.floor((now2 - new Date(now2.getFullYear(), 0, 0)) / 86400000);
      const expectedPct = dayOfYear / 365;   // even time — no longer drives the bars (seasonal pace below); kept for reference
      const paceMarkerPct = Math.min(100, expectedPct * 100);

      // Targets from Goals settings
      const g = state.companyGoal;
      const newTarget     = g.new_amount     || Math.round(g.amount * 0.75);
      const renewalTarget = g.renewal_amount || Math.round(g.amount * 0.25);

      // ── Seasonal year-shape (per Isaac): July carries ~5× January, so an
      // even-time marker calls September "ahead" on seasonality alone. Both
      // the Department bars and the Individual view now judge pace against
      // the Goals tab's monthly allocation (falls back to the IS curve).
      const _shapeOf = (monthly) => {
        const m = Array.isArray(monthly) && monthly.length === 12 ? monthly.map(Number) : null;
        const arr = (m && m.some(v => v > 0)) ? m : (typeof IS_SEASONAL !== 'undefined' ? IS_SEASONAL : Array(12).fill(1));
        const tot = arr.reduce((a, b) => a + (b || 0), 0) || 1;
        return arr.map(v => (v || 0) / tot);
      };
      const _dimOf = (y, mi) => new Date(y, mi + 1, 0).getDate();
      const _isoOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      // Selling day = Mon–Fri, company holidays off (weekends are bonus — same rule as the weekday goal).
      const _isSellingDay = (d) => { const w = d.getDay(); if (w === 0 || w === 6) return false; return !(typeof companyHolidayFor === 'function' && companyHolidayFor(_isoOf(d))); };
      const _sellingDaysInMonth = (y, mi) => { let n = 0; for (let d = 1; d <= _dimOf(y, mi); d++) if (_isSellingDay(new Date(y, mi, d))) n++; return n; };
      const _sellingDaysBetween = (a, b) => { let n = 0; const d = new Date(a.getFullYear(), a.getMonth(), a.getDate()); const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()); while (d <= end) { if (_isSellingDay(d)) n++; d.setDate(d.getDate() + 1); } return n; };
      // Seasonal share of the year that "should" be sold by a date (whole months before it + this month pro-rated by selling days).
      const _seasonalPctAt = (shape, d) => {
        const mi = d.getMonth(), y = d.getFullYear();
        const done = _sellingDaysBetween(new Date(y, mi, 1), d), tot = _sellingDaysInMonth(y, mi) || 1;
        return shape.slice(0, mi).reduce((a, b) => a + b, 0) + shape[mi] * Math.min(1, done / tot);
      };
      const _hasMonthly = (monthly) => Array.isArray(monthly) && monthly.length === 12 && monthly.some(v => Number(v) > 0);
      const _monthTargetOf = (monthly, annual, mi) => _hasMonthly(monthly) ? Number(monthly[mi]) || 0 : annual * _shapeOf(monthly)[mi];
      // Goal dollars for one calendar day: the month's allocation spread over its selling days (weekends/holidays = $0).
      const _dayGoal = (monthly, annual, d) => _isSellingDay(d) ? _monthTargetOf(monthly, annual, d.getMonth()) / (_sellingDaysInMonth(d.getFullYear(), d.getMonth()) || 1) : 0;
      const _goalBetween = (monthly, annual, a, b) => { let t = 0; const d = new Date(a.getFullYear(), a.getMonth(), a.getDate()); const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()); while (d <= end) { t += _dayGoal(monthly, annual, d); d.setDate(d.getDate() + 1); } return t; };
      // Month-to-date actuals by bucket (the annual bars are YTD; the catch-up and projection need MTD).
      const _mtd = (() => {
        const EX = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
        const m0 = new Date(now2.getFullYear(), now2.getMonth(), 1);
        const rIds = new Set((state.sources || []).filter(x => x.is_renewal).map(x => x.id));
        const isR = (x) => x._crmRenewal ?? rIds.has(x.source_id);
        const t = { new: 0, renewal: 0 };
        for (const x of dashboardSales()) { if (EX.has(x.audit_status)) continue; const d = new Date(x.sold_date + 'T00:00'); if (isNaN(d) || d < m0) continue; t[isR(x) ? 'renewal' : 'new'] += Number(x.revenue_amount || 0); }
        return t;
      })();

      // DEPARTMENT numbers for everyone (per Isaac): reps were seeing their
      // PERSONAL YTD racing the department's $4M goal (-98% "behind"). The
      // Department pacer always shows the whole department; personal numbers
      // live in the Individual toggle.
      const ytdDept = goalYtdRevenue(true);

      // Progress bars for New and Renewal
      const progressBars = [
        { label: 'New Revenue',     actual: ytdDept.new,     target: newTarget,     color: '#DF643A' },
        { label: 'Renewal Revenue', actual: ytdDept.renewal, target: renewalTarget, color: '#5F6C5B' },
      ];

      // Total Revenue distribution bar (stacked: New | Renewal)
      const totalActual = ytdDept.total;
      const newPctOfTotal = totalActual > 0 ? (ytdDept.new / totalActual * 100) : 50;
      const renewalPctOfTotal = totalActual > 0 ? (ytdDept.renewal / totalActual * 100) : 50;

      // ── Department ⇄ Individual toggle — Individual shows every rep's YTD
      // against the personal goal they set (⚙ My Settings) or an admin set
      // for them, with the same year-pace marker as the department bars. ──
      const goalMode = state.dashGoalMode === 'reps' ? 'reps' : 'dept';
      // Toggle stays pinned right on phones too (per Isaac): the longer
      // Individual title gets flex-1 / min-w-0 so it wraps instead of
      // shoving the toggle around.
      const goalHeader = el('div', { class: 'flex items-center justify-between gap-2 mb-2' },
        el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold flex-1 min-w-0', style: { color: 'var(--text-subtle)' } },
          goalMode === 'reps' ? 'Individual Revenue Pacer · YTD new revenue' : 'Revenue Pacer'),
        el('div', { class: 'inline-flex rounded-lg border overflow-hidden shrink-0 ml-auto', style: { borderColor: 'var(--border-2)' } },
          ...[['dept', 'Department'], ['reps', 'Individual']].map(([v, l]) => el('button', {
            class: 'px-2.5 py-1 text-[11px] font-semibold transition',
            style: goalMode === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
            title: v === 'reps' ? 'Each rep\'s YTD revenue vs their individual goal' : 'Department totals vs the company goal',
            onclick: () => { state.dashGoalMode = v; mountApp(); },
          }, l))));

      if (goalMode === 'reps') {
        // ── Seasonal pace (per Isaac): "even pace" is wrong for this
        // business — July carries ~5× January. The year-shape comes from
        // the Goals tab's monthly NEW allocation (falls back to the IS
        // seasonal curve), so a rep is judged against the months as
        // they're actually weighted, and today's catch-up number asks for
        // more during the busy season.
        const _shape = _shapeOf(g.monthly_new);
        const _mi = now2.getMonth();
        const seasonalPct = _seasonalPctAt(_shape, now2);   // same math as the Department bars
        const seasonalPctMonthEnd = _shape.slice(0, _mi + 1).reduce((a, b) => a + b, 0);
        const seasonalMarkerPct = Math.min(100, seasonalPct * 100);
        const EXCLUDE2 = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
        const jan1 = new Date(now2.getFullYear(), 0, 1);
        // Goals are NEW-revenue goals (per Isaac) — split each rep's YTD so
        // the bar races new business only; renewal production shows as a
        // muted "+$X renewal" so it isn't invisible, just not goal credit.
        const _renIds = new Set((state.sources || []).filter(s => s.is_renewal).map(s => s.id));
        const _isRenS = (s) => s._crmRenewal ?? _renIds.has(s.source_id);
        const ytdByRep = {}, renByRep = {};
        for (const s of dashboardSales()) {
          if (EXCLUDE2.has(s.audit_status)) continue;
          const d = s.sold_date ? new Date(s.sold_date + 'T00:00') : null;
          if (!d || isNaN(d) || d < jan1) continue;
          const amt = Number(s.revenue_amount || 0);
          if (_isRenS(s)) renByRep[s.rep_id] = (renByRep[s.rep_id] || 0) + amt;
          else ytdByRep[s.rep_id] = (ytdByRep[s.rep_id] || 0) + amt;
        }
        const sellers = (state.allProfiles || [])
          .filter(p => isSellerRole(p.role) && p.is_active !== false && isOfficeStaffProfile(p))
          .map(p => ({ p, goal: Number(p.annual_revenue_goal) || 0, rev: ytdByRep[p.id] || 0 }))
          .filter(x => x.goal > 0 || x.rev > 0)
          .sort((a, b) => (b.goal ? b.rev / b.goal : 0) - (a.goal ? a.rev / a.goal : 0) || b.rev - a.rev);
        // ── Personal pacer (per Isaac): a rep doesn't need the whole
        // room's bars. Sellers see ONLY their own card, with the same
        // seasonal pace / catch-up / projection / period-window numbers the
        // Department view carries. Admins keep the full roster below.
        const me = state.profile;
        const mine = me && !isAdminRole(me.role) ? sellers.find(x => x.p.id === me.id) : null;
        if (mine || (me && !isAdminRole(me.role) && isSellerRole(me.role))) {
          const goal = mine ? mine.goal : Number(me.annual_revenue_goal) || 0;
          const rev = mine ? mine.rev : (ytdByRep[me.id] || 0);
          const ren = renByRep[me.id] || 0;
          const _y = now2.getFullYear();
          const monthTarget = (mi) => goal * _shape[mi];
          const dayGoal = (d) => _isSellingDay(d) ? monthTarget(d.getMonth()) / (_sellingDaysInMonth(d.getFullYear(), d.getMonth()) || 1) : 0;
          const goalBetween = (a, b) => { let t = 0; const d = new Date(a.getFullYear(), a.getMonth(), a.getDate()); const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()); while (d <= end) { t += dayGoal(d); d.setDate(d.getDate() + 1); } return t; };
          const today0 = new Date(_y, _mi, now2.getDate());
          const tom = new Date(_y, _mi, now2.getDate() + 1);
          const m0 = new Date(_y, _mi, 1), mEnd = new Date(_y, _mi, _dimOf(_y, _mi));
          const mtd = (() => { let t = 0; for (const x of dashboardSales()) { if (x.rep_id !== me.id || EXCLUDE2.has(x.audit_status) || _isRenS(x)) continue; const d = new Date(x.sold_date + 'T00:00'); if (!isNaN(d) && d >= m0) t += Number(x.revenue_amount || 0); } return t; })();
          const daysDoneM = _sellingDaysBetween(m0, today0), daysTotM = _sellingDaysInMonth(_y, _mi) || 1;
          const daysLeftM = _sellingDaysBetween(tom, mEnd), daysLeftY = _sellingDaysBetween(tom, new Date(_y, 11, 31));
          const monTarget = monthTarget(_mi);
          const needMonth = daysLeftM > 0 ? Math.max(0, (monTarget - mtd) / daysLeftM) : null;
          const needYear = daysLeftY > 0 ? Math.max(0, (goal - rev) / daysLeftY) : null;
          const projMonth = daysDoneM > 0 ? mtd / daysDoneM * daysTotM : null;
          const projYear = seasonalPct > 0.02 ? rev / seasonalPct : null;
          const delta = rev - goal * seasonalPct;
          const pct = goal > 0 ? Math.min(100, rev / goal * 100) : 0;
          const monName = now2.toLocaleDateString('en-US', { month: 'short' });
          // Window (follows the date filter): this rep's NEW revenue in the window vs their share of the goal for it.
          const kind = state.dashDateRange || 'today';
          const natEnd = kind === 'today' ? today0 : kind === 'week' ? (() => { const d = new Date(today0); d.setDate(d.getDate() + (6 - d.getDay())); return d; })() : kind === 'month' ? mEnd : kind === 'quarter' ? new Date(_y, Math.floor(_mi / 3) * 3 + 3, 0) : kind === 'year' ? new Date(_y, 11, 31) : new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());
          const open = natEnd >= today0 && range.end >= today0;
          const winEnd = open ? natEnd : range.end;
          const winLabel = ({ today: 'Today', yesterday: 'Yesterday', week: 'This week', last_week: 'Last week', month: 'This month', last_month: 'Last month', quarter: 'This quarter', year: 'This year', last_year: 'Last year' })[kind] || 'Custom range';
          const winActual = (() => { let t = 0; for (const x of dashboardSales()) { if (x.rep_id !== me.id || EXCLUDE2.has(x.audit_status) || _isRenS(x)) continue; const d = new Date(x.sold_date + 'T00:00'); if (!isNaN(d) && d >= range.start && d <= range.end) t += Number(x.revenue_amount || 0); } return t; })();
          const winGoal = goal > 0 ? goalBetween(range.start, winEnd) : 0;
          const winLeft = open ? _sellingDaysBetween(tom, winEnd) : 0;
          const winNeed = open && winLeft > 0 ? Math.max(0, (winGoal - winActual) / winLeft) : null;
          const tile = (label, value, sub, o = {}) => el('div', { class: 'rounded-lg border p-3', style: { borderColor: 'var(--border)', background: 'var(--card-2)' }, title: o.tip || '' },
            el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
            el('div', { class: 'text-lg font-black tabular-nums mt-0.5', style: o.color ? { color: o.color } : {} }, value),
            sub ? el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } }, sub) : null);
          const hit = (v, t) => v != null && t > 0 && v >= t;
          return el('div', { class: 'card p-5 rev-goal-card' },
            goalHeader,
            el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-2' },
              el('div', { class: 'flex items-center gap-2 min-w-0' },
                avatarNode(me.avatar_url, me.initials, 'w-8 h-8 text-[10px]'),
                el('div', {}, el('div', { class: 'text-sm font-bold' }, 'My Pacer'),
                  el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, goal > 0 ? 'YTD new revenue vs your annual goal · seasonal pace' : 'Set your annual goal in ⚙ My Settings to unlock pace, catch-up and projections'))),
              el('div', { class: 'text-right' },
                el('div', { class: 'text-2xl font-black tabular-nums' }, fmt.usd0(rev), goal > 0 ? el('span', { class: 'text-sm font-semibold', style: { color: 'var(--text-muted)' } }, ' / ' + fmt.usd0(goal) + ' · ' + Math.round(rev / goal * 100) + '%') : null),
                goal > 0 ? el('div', { class: 'text-[11px] font-bold', style: { color: delta >= 0 ? '#DF643A' : '#DC2626' } }, (delta >= 0 ? '▲ ' + fmt.usd0(delta) + ' ahead of' : '▼ ' + fmt.usd0(-delta) + ' behind') + ' seasonal pace') : null,
                ren > 0 ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' }, title: 'Renewal production — real revenue, but goals are NEW-revenue goals' }, '+' + fmt.usd0(ren) + ' renewal') : null)),
            el('div', { class: 'goal-track', style: { position: 'relative', height: '10px' } },
              el('div', { style: { background: 'var(--accent)', height: '100%', width: pct.toFixed(1) + '%', transition: 'width .3s' } }),
              goal > 0 ? el('div', { title: 'Where today sits on the seasonal plan — ' + (seasonalPct * 100).toFixed(1) + '% of the year\'s weighted goal should be sold by today', style: { position: 'absolute', top: '-3px', bottom: '-3px', left: seasonalMarkerPct.toFixed(1) + '%', width: '2px', background: 'var(--text)', opacity: '.6' } }) : null),
            goal > 0 ? el('div', { class: 'grid gap-2 mt-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' } },
              tile(monName + ' so far', fmt.usd0(mtd) + ' / ' + fmt.usd0(monTarget), daysDoneM + ' of ' + daysTotM + ' selling days', { tip: 'Month-to-date new revenue vs this month\'s share of your annual goal (' + (_shape[_mi] * 100).toFixed(1) + '% of the year)' }),
              tile('Need / day · rest of ' + monName, needMonth == null ? '—' : needMonth > 0 ? fmt.usd0(needMonth) : '✓ hit', daysLeftM + ' selling days left', { color: needMonth > 0 ? undefined : '#16A34A', tip: fmt.usd0(Math.max(0, monTarget - mtd)) + ' left on ' + monName + ' ÷ ' + daysLeftM + ' selling days (Mon–Fri, holidays off)' }),
              tile('Need / day · rest of year', needYear == null ? '—' : needYear > 0 ? fmt.usd0(needYear) : '✓ hit', daysLeftY + ' selling days left', { color: needYear > 0 ? undefined : '#16A34A', tip: fmt.usd0(Math.max(0, goal - rev)) + ' left on the annual goal ÷ ' + daysLeftY + ' selling days' }),
              tile('Projected ' + monName, projMonth == null ? '—' : fmt.usd0(projMonth), 'of ' + fmt.usd0(monTarget), { color: projMonth == null ? undefined : hit(projMonth, monTarget) ? '#16A34A' : '#DC2626', tip: 'This month\'s run-rate carried to month end' }),
              tile('Projected year', projYear == null ? '—' : fmt.usd0(projYear), 'of ' + fmt.usd0(goal), { color: projYear == null ? undefined : hit(projYear, goal) ? '#16A34A' : '#DC2626', tip: 'YTD ÷ the seasonal share of the year that should be sold by today' }),
              tile(winLabel, fmt.usd0(winActual) + ' / ' + fmt.usd0(winGoal), !open ? (winActual >= winGoal ? '✓ hit · +' + fmt.usd0(winActual - winGoal) : 'missed by ' + fmt.usd0(winGoal - winActual)) : kind === 'today' ? (winActual >= winGoal ? '✓ day goal hit' : fmt.usd0(Math.max(0, winGoal - winActual)) + ' to go today') : winNeed == null ? (winActual >= winGoal ? '✓ hit' : 'no selling days left') : winNeed > 0 ? 'need ' + fmt.usd0(winNeed) + '/day · ' + winLeft + ' days left' : '✓ window goal hit', { color: (!open || winNeed === 0 || (kind === 'today' && winActual >= winGoal)) && winActual >= winGoal ? '#16A34A' : (!open && winActual < winGoal ? '#DC2626' : undefined), tip: 'Follows the date filter at the top. Window goal = your annual goal spread by the seasonal month shape over that month\'s selling days.' }),
            ) : null);
        }
        return el('div', { class: 'card p-5 rev-goal-card' },
          goalHeader,
          sellers.length === 0
            ? el('div', { class: 'text-xs py-4 text-center', style: { color: 'var(--text-muted)' } },
                'No individual goals yet — reps set theirs in ⚙ My Settings, or set them in Edit User.')
            : el('div', { class: 'flex flex-col gap-3' },
                ...sellers.map(({ p, goal, rev }) => {
                  const pct = goal > 0 ? Math.min(100, rev / goal * 100) : 0;
                  // Seasonal pace: where this rep SHOULD be given how the
                  // year is weighted (not day-of-year ÷ 365).
                  const delta = rev - goal * seasonalPct;
                  // The number that matters (per Isaac): what to sell each
                  // remaining SELLING DAY of the YEAR (Mon–Sat, company
                  // holidays off) to land the ANNUAL goal — not a get-back-
                  // on-pace-by-month-end figure.
                  const _daysLeftYear = (() => {
                    let n = 0;
                    const d = new Date(now2); d.setHours(12, 0, 0, 0);
                    while (d.getFullYear() === now2.getFullYear()) {
                      const iso = d.toISOString().slice(0, 10);
                      if (d.getDay() !== 0 && !(typeof companyHolidayFor === 'function' && companyHolidayFor(iso))) n++;
                      d.setDate(d.getDate() + 1);
                    }
                    return Math.max(1, n);
                  })();
                  const todayNeed = goal > 0 ? Math.max(0, (goal - rev) / _daysLeftYear) : 0;
                  return el('div', {},
                    el('div', { class: 'flex items-center justify-between mb-1 gap-2' },
                      el('div', {
                        class: 'flex items-center gap-2 min-w-0 cursor-pointer group',
                        title: 'Open ' + (p.full_name || 'this rep') + '\'s player card',
                        onclick: () => openDashboardPlayerCard(p.id),
                      },
                        avatarNode(p.avatar_url, p.initials, 'w-6 h-6 text-[9px]'),
                        el('span', { class: 'text-xs font-semibold truncate group-hover:underline' }, p.full_name),
                        goal > 0
                          ? el('span', { class: 'text-[10px] font-bold whitespace-nowrap', style: { color: delta >= 0 ? '#DF643A' : '#DC2626' },
                              title: (delta >= 0 ? fmt.usd0(delta) + ' ahead of' : fmt.usd0(-delta) + ' behind') + ' the seasonal pace (year shape from the Goals tab\'s monthly allocation)' },
                              delta >= 0 ? '▲ ahead' : '▼ behind')
                          : el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'no goal set'),
                        // Month-end seasonal target (per Isaac) — the number
                        // this rep should have banked by the end of THIS month.
                        goal > 0 ? el('span', { class: 'text-[10px] tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' },
                            title: 'Where the seasonal plan says this rep should be by month-end (' + (seasonalPctMonthEnd * 100).toFixed(1) + '% of the annual goal)' },
                          'target ' + fmt.usd0(goal * seasonalPctMonthEnd) + ' by ' + now2.toLocaleDateString('en-US', { month: 'short' }) + ' end') : null),
                      el('span', { class: 'text-[11px] font-bold tabular-nums whitespace-nowrap' },
                        fmt.usd0(rev) + (goal > 0 ? ' / ' + fmt.usd0(goal) + ' · ' + Math.round(rev / goal * 100) + '%' : ''),
                        (renByRep[p.id] || 0) > 0 ? el('span', { class: 'font-normal', style: { color: 'var(--text-subtle)' }, title: 'Renewal production — real revenue, but individual goals are NEW-revenue goals' }, '  +' + fmt.usd0(renByRep[p.id]) + ' renewal') : null)),
                    el('div', { class: 'goal-track', style: { position: 'relative' } },
                      el('div', { style: { background: 'var(--accent)', height: '100%', width: pct.toFixed(1) + '%', borderRadius: '0', transition: 'width .3s' } }),
                      goal > 0 ? el('div', {
                        title: 'Where today sits on the SEASONAL plan — ' + (seasonalPct * 100).toFixed(1) + '% of the year\'s weighted goal should be sold by today',
                        style: { position: 'absolute', top: '-2px', bottom: '-2px', left: seasonalMarkerPct.toFixed(1) + '%', width: '2px', background: 'var(--text)', opacity: '.6' },
                      }) : null),
                    goal > 0 && el('div', {
                      class: 'text-[10px] mt-0.5 tabular-nums', style: { color: delta >= 0 ? 'var(--text-muted)' : '#DC2626' },
                      title: fmt.usd0(Math.max(0, goal - rev)) + ' left to the annual goal \u00f7 ' + _daysLeftYear + ' selling days (Mon\u2013Sat, holidays off) left this year',
                    },
                      todayNeed > 0
                        ? fmt.usd0(todayNeed) + '/day rest of year to hit the annual goal'
                        : '\u2713 annual goal hit \u2014 everything from here is gravy'));
                })));
      }

      return el('div', { class: 'card p-5 rev-goal-card' },
        goalHeader,
        el('div', { class: 'flex flex-col gap-4' },

          // ── Total Revenue: distribution bar ──
          el('div', {},
            el('div', { class: 'flex items-center justify-between mb-1' },
              el('div', { class: 'flex items-center gap-2' },
                el('span', { class: 'text-sm font-semibold' }, 'Total Revenue'),
                el('span', { class: 'text-[11px] text-muted-' }, '· ' + daysLeft + ' days left'),
              ),
              el('span', { class: 'text-sm font-bold tabular-nums' }, fmt.usd0(totalActual)),
            ),
            // Stacked bar
            el('div', { class: 'goal-track flex overflow-hidden', style: { position: 'relative' } },
              el('div', {
                style: { background: '#DF643A', height: '100%', width: newPctOfTotal.toFixed(1) + '%', transition: 'width .3s', borderRadius: '0' },
                title: 'New: ' + fmt.usd0(ytdDept.new) + ' (' + newPctOfTotal.toFixed(1) + '%)',
              }),
              el('div', {
                style: { background: '#5F6C5B', height: '100%', width: renewalPctOfTotal.toFixed(1) + '%', transition: 'width .3s', borderRadius: '0' },
                title: 'Renewal: ' + fmt.usd0(ytdDept.renewal) + ' (' + renewalPctOfTotal.toFixed(1) + '%)',
              }),
            ),
            // Legend
            el('div', { class: 'flex items-center gap-4 mt-1.5' },
              el('div', { class: 'flex items-center gap-1.5' },
                el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#DF643A' } }),
                el('span', { class: 'text-[11px]' }, 'New'),
                el('span', { class: 'text-[11px] font-semibold tabular-nums' }, fmt.usd0(ytdDept.new)),
                el('span', { class: 'text-[10px] text-muted-' }, '(' + newPctOfTotal.toFixed(0) + '%)'),
              ),
              el('div', { class: 'flex items-center gap-1.5' },
                el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#5F6C5B' } }),
                el('span', { class: 'text-[11px]' }, 'Renewal'),
                el('span', { class: 'text-[11px] font-semibold tabular-nums' }, fmt.usd0(ytdDept.renewal)),
                el('span', { class: 'text-[10px] text-muted-' }, '(' + renewalPctOfTotal.toFixed(0) + '%)'),
              ),
            ),
          ),

          // Slight divider so "what's earned" (Total Revenue distribution
          // above) reads separately from "tracking toward target" (the
          // New / Renewal progress bars below).
          el('div', { style: { height: '1px', background: 'var(--border)', margin: '2px 0' } }),

          // ── New Revenue + Renewal Revenue: progress bars toward target ──
          ...progressBars.map(bar => {
            const pct = bar.target > 0 ? Math.min(1, bar.actual / bar.target) : 0;
            const _monthly = bar.label.startsWith('New') ? g.monthly_new : g.monthly_renewal;
            const _bucket = bar.label.startsWith('New') ? 'new' : 'renewal';
            // Pace vs the SEASONAL plan (not even time) — see _shapeOf above.
            const seasonalPctBar = _seasonalPctAt(_shapeOf(_monthly), now2);
            const barMarkerPct = Math.min(100, seasonalPctBar * 100);
            const paceDiff = bar.target > 0 ? (((bar.actual / bar.target) - seasonalPctBar) / (seasonalPctBar || 0.01) * 100) : 0;
            const paceAhead = paceDiff >= 0;
            // Catch-up (per Isaac): $/selling-day for the rest of the MONTH to
            // land this month's allocation, and for the rest of the YEAR to
            // land the annual goal. Projection: this month's run-rate carried
            // to month end, and YTD ÷ seasonal share carried to year end.
            const _mi2 = now2.getMonth(), _y2 = now2.getFullYear();
            const monTarget = _monthTargetOf(_monthly, bar.target, _mi2);
            const mtdActual = _mtd[_bucket];
            const daysDoneM = _sellingDaysBetween(new Date(_y2, _mi2, 1), now2);
            const daysTotM = _sellingDaysInMonth(_y2, _mi2) || 1;
            const _tom = new Date(_y2, _mi2, now2.getDate() + 1);
            const daysLeftM = _sellingDaysBetween(_tom, new Date(_y2, _mi2, _dimOf(_y2, _mi2)));
            const daysLeftY = _sellingDaysBetween(_tom, new Date(_y2, 11, 31));
            const needMonth = monTarget > 0 && daysLeftM > 0 ? Math.max(0, (monTarget - mtdActual) / daysLeftM) : null;
            const needYear = bar.target > 0 && daysLeftY > 0 ? Math.max(0, (bar.target - bar.actual) / daysLeftY) : null;
            const projMonth = daysDoneM > 0 ? mtdActual / daysDoneM * daysTotM : null;
            const projYear = seasonalPctBar > 0.02 ? bar.actual / seasonalPctBar : null;
            const monName = now2.toLocaleDateString('en-US', { month: 'short' });
            const _hit = (v, t) => v != null && t > 0 && v >= t;
            // Phones (per Isaac): the four outlook lines are too wordy — the
            // bar, the %, the pace chip and the day goal carry the story there.
            const outlook = el('div', { class: 'hidden sm:flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } },
              needMonth != null ? el('span', { title: fmt.usd0(Math.max(0, monTarget - mtdActual)) + ' left on ' + monName + ' (' + fmt.usd0(monTarget) + ' allocation, ' + fmt.usd0(mtdActual) + ' sold) ÷ ' + daysLeftM + ' selling days left this month' },
                needMonth > 0 ? el('span', {}, 'Need ', el('b', { style: { color: bar.color } }, fmt.usd0(needMonth) + '/day'), ' rest of ' + monName) : el('span', {}, '✓ ' + monName + ' allocation hit')) : null,
              needYear != null ? el('span', { title: fmt.usd0(Math.max(0, bar.target - bar.actual)) + ' left on the annual goal ÷ ' + daysLeftY + ' selling days left this year' },
                needYear > 0 ? el('span', {}, 'Need ', el('b', { style: { color: bar.color } }, fmt.usd0(needYear) + '/day'), ' rest of year') : el('span', {}, '✓ annual goal hit')) : null,
              projMonth != null && monTarget > 0 ? el('span', { title: 'This month’s run-rate (' + fmt.usd0(mtdActual) + ' over ' + daysDoneM + ' of ' + daysTotM + ' selling days) carried to month end' },
                'Projected ' + monName + ' ', el('b', { style: { color: _hit(projMonth, monTarget) ? '#5F6C5B' : '#DC2626' } }, fmt.usd0(projMonth)), ' of ' + fmt.usd0(monTarget)) : null,
              projYear != null && bar.target > 0 ? el('span', { title: 'YTD ÷ the seasonal share of the year that should be sold by today (' + (seasonalPctBar * 100).toFixed(1) + '%)' },
                'Projected year ', el('b', { style: { color: _hit(projYear, bar.target) ? '#5F6C5B' : '#DC2626' } }, fmt.usd0(projYear)), ' of ' + fmt.usd0(bar.target)) : null,
            );
            let needLine = null, needLineMob = null;
            if (Array.isArray(_monthly) && _monthly.length === 12 && bar.target > 0) {
              const _mi = now2.getMonth();
              const _dim = new Date(now2.getFullYear(), _mi + 1, 0).getDate();
              // Weekday goal (per Isaac): THIS month's seasonal target ÷ ALL
              // of its weekdays (company holidays off) — a fixed daily
              // number for the whole month. Weekends are bonus revenue on
              // top; no year-deficit catch-up baked in.
              let _weekdaysInMonth = 0;
              for (let _d = 1; _d <= _dim; _d++) {
                const _dt = new Date(now2.getFullYear(), _mi, _d);
                const _dow = _dt.getDay();
                if (_dow === 0 || _dow === 6) continue;
                const _iso2 = _dt.getFullYear() + '-' + String(_mi + 1).padStart(2, '0') + '-' + String(_d).padStart(2, '0');
                if (typeof companyHolidayFor === 'function' && companyHolidayFor(_iso2)) continue;
                _weekdaysInMonth++;
              }
              const _monTarget = Number(_monthly[_mi]) || 0;
              const _monLabel = now2.toLocaleDateString('en-US', { month: 'long' });
              if (_monTarget > 0 && _weekdaysInMonth > 0) {
                const _dayGoal = _monTarget / _weekdaysInMonth;
                const _wgTitle = _monLabel + ' target ' + fmt.usd0(_monTarget) + ' ÷ ' + _weekdaysInMonth + ' weekdays (holidays off) · weekends are bonus';
                // Rides inline to the right of the goal amount (per Isaac).
                needLine = el('span', { class: 'text-xs tabular-nums font-semibold whitespace-nowrap hidden sm:inline', style: { color: 'var(--text-muted)' }, title: _wgTitle },
                  '· weekday goal ', el('span', { style: { color: bar.color, fontWeight: '700' } }, fmt.usd0(_dayGoal) + '/day'));
                needLineMob = el('span', { class: 'text-[10px] tabular-nums font-semibold', style: { color: 'var(--text-muted)' }, title: _wgTitle },
                  fmt.usd0(_dayGoal) + '/day goal');
              }
            }
            return el('div', {},
              // ONE line on every screen size (label + % left, money + pace
              // chip right; the chip drops before the money wraps).
              el('div', { class: 'flex items-center justify-between mb-1 gap-2', style: { flexWrap: 'nowrap', minWidth: 0 } },
                el('div', { class: 'flex items-center gap-1.5 shrink-0' },
                  el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: bar.color } }),
                  el('span', { class: 'text-sm font-semibold whitespace-nowrap' }, bar.label),
                  el('span', { class: 'text-sm font-bold whitespace-nowrap hidden sm:inline', style: { color: bar.color } }, fmt.pct(pct)),
                  // Goal rides next to the % (per Isaac)
                  el('span', { class: 'text-xs tabular-nums font-bold whitespace-nowrap hidden sm:inline', style: { color: 'var(--text-muted)' } }, 'of ' + fmt.usd0(bar.target)),
                  needLine,
                ),
                el('div', { class: 'flex items-center gap-2 min-w-0 justify-end' },
                  el('span', { class: 'text-xs tabular-nums whitespace-nowrap font-semibold' }, fmt.usd0(bar.actual)),
                  el('span', {
                    class: 'text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap hidden sm:inline',
                    style: {
                      background: paceAhead ? 'rgba(223,100,58,.12)' : 'rgba(220,38,38,.08)',
                      color: paceAhead ? '#DF643A' : '#DC2626',
                    },
                  }, (paceAhead ? '+' : '') + paceDiff.toFixed(1) + '%'),
                ),
              ),
              // Mobile: % + goal + pace chip on their own tiny line under the
              // label row instead of forcing a mid-row wrap.
              el('div', { class: 'flex items-center gap-2 mb-1 sm:hidden' },
                el('span', { class: 'text-xs font-bold', style: { color: bar.color } }, fmt.pct(pct)),
                el('span', { class: 'text-[11px] tabular-nums font-bold', style: { color: 'var(--text-muted)' } }, 'of ' + fmt.usd0(bar.target)),
                el('span', {
                  class: 'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                  style: {
                    background: paceAhead ? 'rgba(223,100,58,.12)' : 'rgba(220,38,38,.08)',
                    color: paceAhead ? '#DF643A' : '#DC2626',
                  },
                }, (paceAhead ? '+' : '') + paceDiff.toFixed(1) + '% vs year pace'),
                needLineMob,
              ),
              el('div', { class: 'goal-track', style: { position: 'relative' } },
                el('div', { style: { background: bar.color, height: '100%', borderRadius: '0', transition: 'width .3s', width: (pct * 100).toFixed(2) + '%' } }),
                el('div', {
                  style: {
                    position: 'absolute', top: '-3px', bottom: '-3px',
                    left: barMarkerPct.toFixed(1) + '%',
                    width: '2px', background: '#DC2626', borderRadius: '0',
                  },
                  title: 'Seasonal pace — ' + (seasonalPctBar * 100).toFixed(1) + '% of the year’s goal should be sold by today (Goals tab monthly allocation)',
                }),
              ),
              el('div', { class: 'goal-ticks mt-1' },
                ...goalTicks(bar.target).map(t => el('span', {}, t)),
              ),
              outlook,
            );
          }),

          // ── Period strip (per Isaac): follows the date filter at the top.
          // Open windows (Today / This week / This month / Quarter / Year /
          // a custom range ending today or later) pace against the goal for
          // that window and say what's needed per selling day to close it.
          // Closed windows (Yesterday / Last week / Last month / Last year /
          // a past custom range) are a result — hit, or missed by $X — with
          // no pace judgement.
          (() => {
            const kind = state.dashDateRange || 'today';
            const rs = range.start, re = range.end;
            const today0 = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate());
            const natEnd = kind === 'today' ? today0
              : kind === 'week' ? (() => { const d = new Date(today0); d.setDate(d.getDate() + (6 - d.getDay())); return d; })()
              : kind === 'month' ? new Date(now2.getFullYear(), now2.getMonth() + 1, 0)
              : kind === 'quarter' ? new Date(now2.getFullYear(), Math.floor(now2.getMonth() / 3) * 3 + 3, 0)
              : kind === 'year' ? new Date(now2.getFullYear(), 11, 31)
              : new Date(re.getFullYear(), re.getMonth(), re.getDate());
            const open = natEnd >= today0 && re >= today0;
            const label = ({ today: 'Today', yesterday: 'Yesterday', week: 'This week', last_week: 'Last week', month: 'This month', last_month: 'Last month', quarter: 'This quarter', year: 'This year', last_year: 'Last year' })[kind]
              || (rs.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + re.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            const winEnd = open ? natEnd : re;
            const rowsP = [
              { label: 'New', color: '#DF643A', actual: newRevenue, monthly: g.monthly_new, annual: newTarget },
              { label: 'Renewal', color: '#5F6C5B', actual: renewalRevenue, monthly: g.monthly_renewal, annual: renewalTarget },
            ].map(r => {
              const goalWin = _goalBetween(r.monthly, r.annual, rs, winEnd);            // whole window (through its natural end)
              const goalSoFar = open ? _goalBetween(r.monthly, r.annual, rs, today0) : goalWin;   // what should be in by today
              const tom = new Date(today0); tom.setDate(tom.getDate() + 1);
              const left = open ? _sellingDaysBetween(tom, winEnd) : 0;
              const need = open && left > 0 ? Math.max(0, (goalWin - r.actual) / left) : null;
              return { ...r, goalWin, goalSoFar, left, need };
            });
            if (!rowsP.some(r => r.goalWin > 0)) return null;
            const line = (r) => {
              const pctW = r.goalWin > 0 ? Math.min(1, r.actual / r.goalWin) : 0;
              const soFarPct = r.goalWin > 0 ? Math.min(100, r.goalSoFar / r.goalWin * 100) : 0;
              const diff = r.actual - r.goalWin;
              const verdict = !open
                ? el('span', { class: 'text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', style: diff >= 0 ? { background: 'rgba(95,108,91,.10)', color: '#5F6C5B' } : { background: 'rgba(220,38,38,.08)', color: '#DC2626' } }, diff >= 0 ? '✓ hit · +' + fmt.usd0(diff) : 'missed by ' + fmt.usd0(-diff))
                : kind === 'today'
                  ? el('span', { class: 'text-[10px] font-semibold whitespace-nowrap', style: { color: r.actual >= r.goalWin ? '#5F6C5B' : 'var(--text-muted)' } }, r.actual >= r.goalWin ? '✓ day goal hit' : fmt.usd0(Math.max(0, r.goalWin - r.actual)) + ' to go today')
                  : r.need != null
                    ? el('span', { class: 'text-[10px] font-semibold whitespace-nowrap', style: { color: r.need > 0 ? 'var(--text-muted)' : '#5F6C5B' }, title: fmt.usd0(Math.max(0, r.goalWin - r.actual)) + ' left ÷ ' + r.left + ' selling days left in the window' }, r.need > 0 ? 'need ' + fmt.usd0(r.need) + '/day · ' + r.left + ' days left' : '✓ window goal hit')
                    : el('span', { class: 'text-[10px] font-semibold whitespace-nowrap', style: { color: r.actual >= r.goalWin ? '#5F6C5B' : '#DC2626' } }, r.actual >= r.goalWin ? '✓ hit' : fmt.usd0(r.goalWin - r.actual) + ' short, no selling days left');
              return el('div', { class: 'min-w-0' },
                el('div', { class: 'flex items-center justify-between gap-2 mb-1 min-w-0' },
                  el('div', { class: 'flex items-center gap-1.5 min-w-0' },
                    el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: r.color, flexShrink: 0 } }),
                    el('span', { class: 'text-xs font-semibold whitespace-nowrap' }, r.label),
                    el('span', { class: 'text-xs tabular-nums font-bold whitespace-nowrap' }, fmt.usd0(r.actual)),
                    el('span', { class: 'text-[10px] tabular-nums text-muted- whitespace-nowrap' }, 'of ' + fmt.usd0(r.goalWin))),
                  verdict),
                el('div', { class: 'goal-track', style: { position: 'relative', height: '6px' } },
                  el('div', { style: { background: r.color, height: '100%', width: (pctW * 100).toFixed(1) + '%', transition: 'width .3s' } }),
                  open && kind !== 'today' && r.goalWin > 0 ? el('div', { title: 'Where today sits in the window — ' + fmt.usd0(r.goalSoFar) + ' should be in by now', style: { position: 'absolute', top: '-2px', bottom: '-2px', left: soFarPct.toFixed(1) + '%', width: '2px', background: 'var(--text)', opacity: '.6' } }) : null));
            };
            return el('div', {},
              el('div', { style: { height: '1px', background: 'var(--border)', margin: '2px 0 10px' } }),
              el('div', { class: 'flex items-center justify-between mb-2' },
                el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label + (open ? ' · pace' : ' · result')),
                el('span', { class: 'text-[10px] text-muted-', title: 'Window goal = the Goals tab’s monthly allocation spread over that month’s selling days (Mon–Fri, holidays off), summed across the window. Weekends are bonus.' }, open ? 'goal through ' + winEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'follows the date filter')),
              el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3' }, ...rowsP.map(line)));
          })(),
        ),
      );
    })(),

    // ─── Office stats (per Isaac): replaces the old 🏢 Office toggle — a
    // collapsed bar under the revenue pacer that expands into a per-office
    // table (sales / new / renewals / revenue / new revenue / reps). ───
    dashOfficeStats(approved, isRenewal),

    // ─── KPI cards: one combined Sales card + one combined Revenue card.
    // Three stats sit side by side inside each card (instead of three
    // separate cards) so the dashboard stays compact — especially on
    // mobile, where the old layout stacked six full-width cards. ───
    kpiTripleCard([
      ['Total Sales', fmt.int(totalSalesCount), () => { state.view = 'sales'; mountApp(); }],
      ['New Sales',   fmt.int(newSalesCount),   () => { state.view = 'sales'; mountApp(); }],
      ['Renewals',    fmt.int(renewalCount),    () => { state.view = 'sales'; state._salesQueueFilter = 'history'; mountApp(); }],
    ]),
    kpiTripleCard([
      ['Total Revenue',   fmt.usd0(totalRevenue)],
      ['New Revenue',     fmt.usd0(newRevenue)],
      ['Renewal Revenue', fmt.usd0(renewalRevenue)],
    ]),
    // (Reconcile export link removed per Isaac — the CSV logic lives in git history if ever needed.)

    // ─── Split: Today's Sales (30%) | Leaderboard (70%) ───
    // Mobile stacks LEADERBOARD first (per Isaac) — CSS order flips below
    // the lg breakpoint; desktop keeps feed-left / leaderboard-right.
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-[3fr_7fr] gap-4' },
      el('div', { class: 'order-2 lg:order-1 min-w-0' }, todaysSalesPanel(windowSales, range)),
      el('div', { class: 'order-1 lg:order-2 min-w-0' }, leaderboardSection(range)),
    ),
  );
}


// One card, three stats side by side, divided by hairlines. Replaces the
// old 3-cards-per-row KPI grid on the dashboard — on mobile the three
// numbers share one row instead of stacking three full-width cards.
// stats: array of [label, value, onclick?]
function kpiTripleCard(stats) {
  return el('div', { class: 'card p-4 sm:p-5 grid grid-cols-3' },
    ...stats.map(([label, value, onclick], i) => el('div', {
      class: 'min-w-0 flex flex-col justify-center px-2 sm:px-4 text-center'
        + (i > 0 ? ' border-l' : '')
        + (onclick ? ' cursor-pointer hover:brightness-95 transition' : ''),
      style: i > 0 ? { borderColor: 'var(--border)' } : {},
      onclick,
      title: onclick ? label + ' — view all' : undefined,
    },
      el('div', { class: 'text-[9px] sm:text-[10px] text-muted- uppercase tracking-widest font-semibold truncate' }, label),
      el('div', { class: 'font-display text-2xl sm:text-4xl mt-1.5 tabular-nums truncate leading-none' }, value),
    )),
  );
}

function kpiCard(label, value, sub, onclick) {
  return el('div', { class: 'card p-5' + (onclick ? ' cursor-pointer hover:brightness-95 transition' : ''), onclick },
    el('div', { class: 'text-[10px] text-muted- uppercase tracking-widest font-semibold' }, label),
    el('div', { class: 'font-display text-4xl sm:text-5xl mt-1.5 tabular-nums leading-none' }, value),
    el('div', { class: 'text-xs mt-2.5 font-medium', style: { color: onclick ? 'var(--accent)' : 'var(--text-muted)' } },
      onclick ? (sub + ' ↗') : sub,
    ),
  );
}

// ─── Revenue goal helpers ───
function getDateRange(kind) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  switch (kind) {
    case 'today':     return { start: today, end: endOfDay(today) };
    case 'yesterday': { const y = addDays(today, -1); return { start: y, end: endOfDay(y) }; }
    case 'week': {
      const s = new Date(today); s.setDate(s.getDate() - s.getDay()); // Sunday
      return { start: s, end: endOfDay(today) };
    }
    case 'last_week': {
      const start = new Date(today); start.setDate(start.getDate() - start.getDay() - 7);
      const end   = addDays(start, 6);
      return { start, end: endOfDay(end) };
    }
    case 'month':     return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: endOfDay(today) };
    case 'last_month':{
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end   = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
      return { start, end: endOfDay(end) };
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { start: new Date(now.getFullYear(), q * 3, 1), end: endOfDay(today) };
    }
    case 'year':      return { start: new Date(now.getFullYear(), 0, 1), end: endOfDay(today) };
    case 'last_year': {
      return { start: new Date(now.getFullYear() - 1, 0, 1), end: endOfDay(new Date(now.getFullYear() - 1, 11, 31)) };
    }
    case 'custom': {
      const s = state.dashCustomStart ? new Date(state.dashCustomStart + 'T00:00') : today;
      const e = state.dashCustomEnd   ? new Date(state.dashCustomEnd   + 'T00:00') : today;
      return { start: s, end: endOfDay(e) };
    }
    case 'all':       return { start: new Date(2000, 0, 1), end: endOfDay(today) };
    default:          return { start: today, end: endOfDay(today) };
  }
}
function rangeLabel(range) {
  const fmtOpt = { month: 'short', day: 'numeric', year: 'numeric' };
  const s = range.start.toLocaleDateString('en-US', fmtOpt);
  const e = range.end.toLocaleDateString('en-US', fmtOpt);
  return s === e ? s : (s + ' – ' + e);
}

// Admin sees company-wide; rep sees their own (rolled up from profile target)
function getGoalForContext() {
  const isAdmin = isAdminRole(state.profile?.role);
  if (isAdmin) return state.companyGoal;
  const repGoal = Number(state.profile.annual_revenue_goal || 0);
  return { amount: repGoal > 0 ? repGoal : 250000, period: 'year' };
}
function goalYtdRevenue(isAdmin) {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  // Everyone reads the CRM-backed pool; reps see their own slice of it.
  const dash = dashboardSales();
  const scope = isAdmin ? dash : dash.filter(s => s.rep_id === state.profile.id);
  const EXCLUDE_GOAL = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const ytd = scope.filter(s => {
    if (EXCLUDE_GOAL.has(s.audit_status)) return false;
    return new Date(s.sold_date + 'T00:00') >= yearStart;
  });
  const renewalIds = new Set(state.sources.filter(s => s.is_renewal).map(s => s.id));
  const isR = s => s._crmRenewal ?? renewalIds.has(s.source_id);
  return {
    total: sumRev(ytd),
    new: sumRev(ytd.filter(s => !isR(s))),
    renewal: sumRev(ytd.filter(s =>  isR(s))),
  };
}
function daysLeftInGoalPeriod(goal) {
  const now = new Date();
  const end = new Date(now.getFullYear(), 11, 31);
  return Math.max(0, Math.ceil((end - now) / 86400000));
}
function goalTicks(amount) {
  const step = amount / 5;
  const out = [];
  for (let i = 0; i <= 5; i++) {
    const v = step * i;
    if (v >= 1e6) out.push('$' + (v / 1e6).toFixed(v >= 5e6 ? 0 : 1) + 'M');
    else if (v >= 1000000) out.push('$' + (v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1) + 'M');
    else if (v >= 1000) out.push('$' + Math.round(v / 1000) + 'K');
    else out.push('$' + Math.round(v));
  }
  return out;
}

function compSummaryCard(comp) {
  const rules = state.compRules.filter(r => r.competition_id === comp.id);
  const myProgress = state.compProgress.filter(p => p.competition_id === comp.id && p.rep_id === state.profile.id);
  const met = myProgress.filter(p => p.met).length;
  const total = rules.length;
  return el('div', {
    class: 'card p-5 cursor-pointer hover:border-lime transition',
    onclick: () => { state.view = 'competitions'; mountApp(); },
  },
    el('div', { class: 'flex items-center justify-between mb-2' },
      el('div', { class: 'text-[10px] text-battleship uppercase tracking-widest' }, comp.category.replace('_', ' ') + ' · ' + comp.type),
      el('div', { class: 'chip chip-pending' }, fmt.dateShort(comp.start_date) + ' → ' + fmt.dateShort(comp.end_date)),
    ),
    el('h3', { class: 'text-xl font-bold text-smoke' }, comp.name),
    el('div', { class: 'text-sm text-battle-2 mt-1' }, comp.prize_text || ''),
    total > 0 && el('div', { class: 'mt-3' },
      el('div', { class: 'flex items-center justify-between text-xs text-battle-2 mb-1' },
        el('span', {}, `${met} / ${total} ${comp.type === 'bingo' ? 'squares' : 'rules'}`),
        el('span', {}, fmt.pct(met / total)),
      ),
      el('div', { class: 'h-1.5 rounded-full bg-eerie3 overflow-hidden' },
        el('div', { class: 'h-full bg-lime transition-all', style: { width: (total ? (met / total * 100) : 0) + '%' } }),
      ),
    ),
  );
}

function recentSalesTable(rows, opts = {}) {
  if (rows.length === 0) return el('div', { class: (opts.flat ? 'p-6' : 'card p-6') + ' text-center text-muted- text-sm' }, 'No sales yet.');
  const wrapperClass = opts.flat ? 'scroll-x' : 'card overflow-hidden';
  const innerScroll = opts.flat ? '' : 'scroll-x';
  return el('div', { class: wrapperClass },
    el('div', { class: innerScroll || '' },
      el('table', { class: 'w-full text-sm' },
        el('thead', { class: 'text-[10px] uppercase tracking-widest text-muted- bg-card2-' },
          el('tr', {},
            el('th', { class: 'text-left px-4 py-2' }, 'Customer'),
            el('th', { class: 'text-left px-4 py-2 desktop-only' }, 'Service'),
            el('th', { class: 'text-right px-4 py-2' }, 'Revenue'),
            el('th', { class: 'text-left px-4 py-2' }, 'Date'),
            el('th', { class: 'text-left px-4 py-2' }, 'Status'),
          ),
        ),
        el('tbody', {},
          rows.map(s => el('tr', { class: 'border-t border-' },
            el('td', { class: 'px-4 py-2.5 font-medium' }, s.customer_name),
            el('td', { class: 'px-4 py-2.5 text-muted- desktop-only' }, nameFromId(state.serviceTypes, s.service_type_id)),
            el('td', { class: 'px-4 py-2.5 text-right tabular-nums' }, fmt.usd(s.revenue_amount)),
            el('td', { class: 'px-4 py-2.5 text-muted- tabular-nums' }, fmt.dateShort(s.sold_date)),
            el('td', { class: 'px-4 py-2.5' }, statusChip(s.audit_status)),
          )),
        ),
      ),
    ),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// LEADERBOARD — computed live from profiles + sales
// ──────────────────────────────────────────────────────────────────────────
// Is this profile an INSIDE SALES (office staff) person? Best signal first:
// explicit role → linked CRM roster row → own CRM type (self) → name-
// signature map from the shared dataset. Used to scope the whole War Room
// family (leaderboard, individual goals, Hall of Fame) to office staff.
function isOfficeStaffProfile(p) {
  if (!p) return false;
  if (p.role === 'rep_office' || p.role === 'rep_office_lead' || p.role === 'rep_loyalty' || p.role === 'rep_loyalty_lead') return true;
  if (p.role === 'rep_sales' || p.role === 'rep_partner' || p.role === 'rep_team_lead') return false;
  const emp = frRosterRowForProfile(p);   // works even when the profile stores a branch id
  if (emp && emp.type_label) return /office\s*staff/i.test(emp.type_label);
  if (state.profile && p.id === state.profile.id && state.myRepType) return /office\s*staff/i.test(state.myRepType);
  try {
    const t = (state._indicatorRepTypeBySig || {})[_repTypeNameSig(getCanonicalRepName(p.full_name || ''))];
    if (t) return /office\s*staff/i.test(t);
  } catch (e) { /* fall through */ }
  return false; // unknown type — self-heals once their CRM type syncs
}
const _wowMemo = { pool: null, map: null };
function computeLeaderboard(tab = 'total', range = null) {
  // Only people with sales access rank on the leaderboard: sales reps,
  // loyalty reps, and Admin + Sales. Auditors review and Admin (no sales)
  // manages — neither sells, so neither gets a row.
  const profilesAll = state.allProfiles.length ? state.allProfiles : [state.profile].filter(Boolean);
  // OFFICE STAFF ONLY — this is the Inside Sales leaderboard; D2D sales
  // reps have their own boards (Indicators/Competitions) and were showing
  // up here as permanent "No sales" rows. Type resolution, best signal
  // first: explicit role → linked CRM roster row (admins have the full
  // roster) → own CRM type (self) → name-signature map from the shared
  // dataset (available to every role).
  const renewalIds = new Set(state.sources.filter(s => s.is_renewal).map(s => s.id));
  const isRenewalSale = s => s._crmRenewal ?? renewalIds.has(s.source_id);

  // Sales to aggregate — counts every sale that isn't cancelled/nsf/not_payable/reschedule.
  // This way the leaderboard ticks up as soon as a rep logs a sale, before audit.
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const salesPool = dashboardSales().filter(s => {
    if (EXCLUDE.has(s.audit_status)) return false;
    const d = new Date(s.sold_date + 'T00:00');
    if (range) return d >= range.start && d <= range.end;
    return d >= yearStart;
  });
  // Rank rows: current office-staff sellers PLUS anyone — active or not —
  // who has revenue in the pool (per Isaac: a rep going inactive must not
  // drop their production off the board, or the pinned RIDD totals drift
  // away from the revenue tiles). Disabled/former reps only appear when
  // they actually have sales in the window.
  const _poolRepIds = new Set(salesPool.map(s => s.rep_id).filter(Boolean));
  const profiles = profilesAll.filter(p => (isSellerRole(p.role) && isOfficeStaffProfile(p)) || _poolRepIds.has(p.id));

  // Week-over-Week % — this week's revenue vs last week's AT THE SAME POINT
  // in the week (a Wednesday compares against last week through Wednesday),
  // so the number is fair mid-week and converges to full-week by Saturday.
  // Weeks start Sunday, matching the date filter. Computed from the full
  // pool, independent of the selected range.
  let _wowByKey = (_wowMemo.pool === dashboardSales()) ? _wowMemo.map : null;
  if (!_wowByKey) {
    _wowByKey = new Map();
    const _iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const now = new Date();
    const curStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const prevStart = new Date(curStart); prevStart.setDate(prevStart.getDate() - 7);
    const curStartIso = _iso(curStart), prevStartIso = _iso(prevStart);
    const todayIso = _iso(now);
    const prevCut = new Date(prevStart); prevCut.setDate(prevCut.getDate() + now.getDay());
    const prevCutIso = _iso(prevCut);
    dashboardSales().forEach(s => {
      if (EXCLUDE.has(s.audit_status) || !s.sold_date) return;
      const k = s.rep_id || (s._crm && s._crmRep ? 'crm:' + s._crmRep : null);
      if (!k) return;
      let o = _wowByKey.get(k); if (!o) { o = { cur: 0, prev: 0 }; _wowByKey.set(k, o); }
      if (s.sold_date >= curStartIso && s.sold_date <= todayIso) o.cur += Number(s.revenue_amount || 0);
      else if (s.sold_date >= prevStartIso && s.sold_date <= prevCutIso) o.prev += Number(s.revenue_amount || 0);
    });
    _wowMemo.pool = dashboardSales(); _wowMemo.map = _wowByKey;
  }
  const _wowOf = (key) => {
    const o = _wowByKey.get(key);
    if (!o) return null;
    if (o.prev > 0) return (o.cur - o.prev) / o.prev;
    return o.cur > 0 ? Infinity : null;   // no last-week baseline → "New"
  };
  const _bestDayOf = (sales) => {
    const byDay = {};
    sales.forEach(s => { if (s.sold_date) byDay[s.sold_date] = (byDay[s.sold_date] || 0) + Number(s.revenue_amount || 0); });
    return Object.values(byDay).reduce((a, b) => Math.max(a, b), 0);
  };

  const rows = profiles.map(p => {
    let sales = salesPool.filter(s => s.rep_id === p.id);
    if (tab === 'new')      sales = sales.filter(s => !isRenewalSale(s));
    if (tab === 'renewals') sales = sales.filter(s =>  isRenewalSale(s));

    const count    = sales.length;
    const revenue  = sales.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
    // Initial = AVERAGE initial invoice per sale (not a sum).
    const initial  = count ? sales.reduce((a, s) => a + Number(s.initial_amount || 0), 0) / count : 0;
    // Recurring Rev = contract revenue only — total revenue minus one-time
    // service revenue (a sale is one-time when it carries no contract months).
    const oneTimeRev = sales.reduce((a, s) => {
      const m = Number(s.contract_months);
      if (m > 1) return a;
      // Sentricon is always a 12-month program — a blank agreement length is
      // a data error (flagged in the audit queue), not a one-time service.
      const svc = String(s._crmService || nameFromId(state.serviceTypes, s.service_type_id) || '');
      if (/sentricon/i.test(svc)) return a;
      return a + Number(s.revenue_amount || 0);
    }, 0);
    const recurring = Math.max(0, revenue - oneTimeRev);
    const ots = oneTimeRev;   // one-time service revenue (own column, per Isaac)
    // ACV = average value across ALL sales, one-time services included.
    const acv = count ? revenue / count : 0;

    // MY% = multi-year (≥18mo, includes 36/60mo) / (12mo + multi-year)
    const c12     = sales.filter(s => myBucketOf(s) === 'twelve').length;
    const cMY     = sales.filter(s => myBucketOf(s) === 'multi').length;
    const cTotal  = c12 + cMY;
    const my_pct  = cTotal > 0 ? cMY / cTotal : 0;

    // REC MIX% = contract sales / (contract sales + one-time)
    const cOneTime = sales.filter(s => !Number(s.contract_months) || Number(s.contract_months) <= 1).length;
    const rec_mix_pct = (cTotal + cOneTime) > 0 ? cTotal / (cTotal + cOneTime) : 0;
    // Auto Pay % — CRM rows only (manual upsell logs don't carry the field).
    const _apRows = sales.filter(s => s._crm);
    const auto_pay_pct = _apRows.length ? _apRows.filter(s => s._crmAutoPay).length / _apRows.length : null;

    return {
      rep_id: p.id,
      full_name: p.full_name,
      first_name: (p.full_name || '').split(' ')[0],
      avatar_url: p.avatar_url,
      initials: p.initials,
      office: state.offices.find(o => o.id === p.office_id)?.name || '',
      count, revenue, initial, recurring, ots, acv, my_pct, rec_mix_pct, auto_pay_pct,
      best_day: _bestDayOf(sales), wow: _wowOf(p.id),
    };
  });

  // CRM office-staff sellers WITHOUT an app account rank too (Isaac: "include
  // all revenue sold by office staff even if they're not active in the app").
  // Bridge rows carry rep_id=null + the seller's canonical CRM name — group
  // by name and build synthetic rows with the same math as profile rows.
  {
    const unmatched = new Map();
    salesPool.forEach(s => {
      if (s.rep_id != null || !s._crm || !s._crmRep) return;
      if (FR_SYSTEM_NAME_RE.test(s._crmRep)) return;   // system/integration accounts don't rank
      let g = unmatched.get(s._crmRep); if (!g) { g = []; unmatched.set(s._crmRep, g); }
      g.push(s);
    });
    unmatched.forEach((sales0, name) => {
      let sales = sales0;
      if (tab === 'new')      sales = sales.filter(s => !isRenewalSale(s));
      if (tab === 'renewals') sales = sales.filter(s =>  isRenewalSale(s));
      if (!sales.length) return;
      const count = sales.length;
      const revenue = sales.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
      const initial = count ? sales.reduce((a, s) => a + Number(s.initial_amount || 0), 0) / count : 0;
      const oneTimeRev = sales.reduce((a, s) => {
        const m = Number(s.contract_months);
        if (m > 1) return a;
        if (/sentricon/i.test(String(s._crmService || ''))) return a;
        return a + Number(s.revenue_amount || 0);
      }, 0);
      const recurring = Math.max(0, revenue - oneTimeRev);
      const ots = oneTimeRev;
      const acv = count ? revenue / count : 0;
      const c12 = sales.filter(s => myBucketOf(s) === 'twelve').length;
      const cMY = sales.filter(s => myBucketOf(s) === 'multi').length;
      const cTotal = c12 + cMY;
      const my_pct = cTotal > 0 ? cMY / cTotal : 0;
      const cOneTime = sales.filter(s => !Number(s.contract_months) || Number(s.contract_months) <= 1).length;
      const rec_mix_pct = (cTotal + cOneTime) > 0 ? cTotal / (cTotal + cOneTime) : 0;
      const _apRows = sales.filter(s => s._crm);
      const auto_pay_pct = _apRows.length ? _apRows.filter(s => s._crmAutoPay).length / _apRows.length : null;
      const disp = flipLastFirst(name);   // CRM exports "Last, First"
      rows.push({
        rep_id: 'crm:' + name,           // synthetic — no app profile behind it
        _noProfile: true,
        full_name: disp,
        first_name: disp,                // leaderboard shows full names for everyone
        avatar_url: null,
        initials: disp.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        office: (() => { const oid = sales.find(s => s.office_id)?.office_id; return state.offices.find(o => o.id === oid)?.name || ''; })(),
        count, revenue, initial, recurring, ots, acv, my_pct, rec_mix_pct, auto_pay_pct,
        best_day: _bestDayOf(sales), wow: _wowOf('crm:' + name),
      });
    });
  }

  // ── RECONCILIATION ROW — whatever the board still hasn't attributed rolls
  // into ONE "House / System" row: CRM rows sold by system / integration
  // accounts (Referral, Pest Booker, RIDD Account, …) and rows whose app
  // profile was deleted. The tiles count these, so without this row the
  // pinned RIDD totals could never equal the revenue cards (per Isaac:
  // every FieldRoutes dollar has to land somewhere visible).
  {
    const covered = new Set(profiles.map(p => p.id));
    let sales = salesPool.filter(s => {
      if (s.rep_id != null) return !covered.has(s.rep_id);
      return !(s._crm && s._crmRep && !FR_SYSTEM_NAME_RE.test(s._crmRep));
    });
    if (tab === 'new')      sales = sales.filter(s => !isRenewalSale(s));
    if (tab === 'renewals') sales = sales.filter(s =>  isRenewalSale(s));
    if (sales.length) {
      const count = sales.length;
      const revenue = sales.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
      const initial = count ? sales.reduce((a, s) => a + Number(s.initial_amount || 0), 0) / count : 0;
      const oneTimeRev = sales.reduce((a, s) => {
        const m = Number(s.contract_months);
        if (m > 1) return a;
        if (/sentricon/i.test(String(s._crmService || ''))) return a;
        return a + Number(s.revenue_amount || 0);
      }, 0);
      const recurring = Math.max(0, revenue - oneTimeRev);
      const acv = count ? revenue / count : 0;
      const c12 = sales.filter(s => myBucketOf(s) === 'twelve').length;
      const cMY = sales.filter(s => myBucketOf(s) === 'multi').length;
      const cTotal = c12 + cMY;
      const cOneTime = sales.filter(s => !Number(s.contract_months) || Number(s.contract_months) <= 1).length;
      const _apRows = sales.filter(s => s._crm);
      rows.push({
        rep_id: 'crm:__house__',
        _noProfile: true,
        full_name: 'House / System',
        first_name: 'House / System',
        avatar_url: null,
        initials: '🔧',
        office: '',
        count, revenue, initial, recurring, ots: oneTimeRev, acv,
        my_pct: cTotal > 0 ? cMY / cTotal : 0,
        rec_mix_pct: (cTotal + cOneTime) > 0 ? cTotal / (cTotal + cOneTime) : 0,
        auto_pay_pct: _apRows.length ? _apRows.filter(s => s._crmAutoPay).length / _apRows.length : null,
        best_day: _bestDayOf(sales), wow: null,
      });
    }
  }

  // Sort by active sort column (default: sales desc)
  const sortKey = state.dashLeaderSort;
  const keyMap = { sales: 'count', revenue: 'revenue', initial: 'initial', recurring: 'recurring', ots: 'ots', acv: 'acv', my_pct: 'my_pct', rec_mix_pct: 'rec_mix_pct', auto_pay: 'auto_pay_pct' };
  const k = keyMap[sortKey] || 'count';
  rows.sort((a, b) => (b[k] || 0) - (a[k] || 0));
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// BADGE SYSTEM — gamification chips shown on the leaderboard
// ──────────────────────────────────────────────────────────────────────────
// Two badge families:
//   • First Blood — auto, daily — whoever logs the first sale of the day. Resets at midnight.
//   • Hall of Fame — auto, persistent — whoever currently holds a company-wide record.
//     Transfers automatically when someone beats the record.
const BADGE_DEFS = {
  first_blood: { label: 'First Blood', emoji: '🩸', color: '#DC2626', desc: 'First sale of the day (resets daily)' },
  best_day:    { label: 'Best Day',    emoji: '🏆', color: '#DF643A', desc: 'Holds the company best-day record' },
  best_week:   { label: 'Best Week',   emoji: '🏆', color: '#DF643A', desc: 'Holds the company best-week record' },
  best_month:  { label: 'Best Month',  emoji: '🏆', color: '#DF643A', desc: 'Holds the company best-month record' },
};

// Returns a map { rep_id: Set([...badge codes]) }
const _badgeMemo = { pool: null, day: null, out: null };
function computeBadges() {
  const _pool = dashboardSales();
  const _day = bizTodayIso();
  if (_badgeMemo.pool === _pool && _badgeMemo.day === _day) return _badgeMemo.out;
  const _out = _computeBadgesUncached();
  _badgeMemo.pool = _pool; _badgeMemo.day = _day; _badgeMemo.out = _out;
  return _out;
}
function _computeBadgesUncached() {
  const badges = {};
  const add = (repId, code) => {
    if (!repId) return;
    if (!badges[repId]) badges[repId] = new Set();
    badges[repId].add(code);
  };

  // ── First Blood — first sale of TODAY (resets daily) ──
  const todayKey = bizTodayIso();   // business day, pinned ET
  const salesToday = dashboardSales().filter(s => s.sold_date === todayKey);
  if (salesToday.length) {
    const earliest = salesToday.reduce((a, b) => {
      const ta = new Date(a.created_at || a.sold_date).getTime();
      const tb = new Date(b.created_at || b.sold_date).getTime();
      return ta <= tb ? a : b;
    });
    if (earliest) add(earliest.rep_id, 'first_blood');
  }

  // ── Hall of Fame — company-wide bests persist until someone beats them ──
  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile].filter(Boolean);
  const byRep = groupBy(dashboardSales(), s => s.rep_id);
  let bestDayHolder = null,  bestDayRev = 0;
  let bestWeekHolder = null, bestWeekRev = 0;
  let bestMonthHolder = null, bestMonthRev = 0;
  profiles.forEach(p => {
    const r = computeRepRecords(p.id, byRep[p.id] || []);
    if (r.bestDay.revenue   > bestDayRev)   { bestDayHolder   = p.id; bestDayRev   = r.bestDay.revenue;   }
    if (r.bestWeek.revenue  > bestWeekRev)  { bestWeekHolder  = p.id; bestWeekRev  = r.bestWeek.revenue;  }
    if (r.bestMonth.revenue > bestMonthRev) { bestMonthHolder = p.id; bestMonthRev = r.bestMonth.revenue; }
  });
  if (bestDayRev   > 0) add(bestDayHolder,   'best_day');
  if (bestWeekRev  > 0) add(bestWeekHolder,  'best_week');
  if (bestMonthRev > 0) add(bestMonthHolder, 'best_month');

  return badges;
}

// Compute personal records for a rep across all their history
function computeRepRecords(repId, repSales) {
  const approved = (repSales || []).filter(s => ['serviced','approved'].includes(s.audit_status));
  // Best day
  const byDay = {};
  for (const s of approved) {
    byDay[s.sold_date] = byDay[s.sold_date] || { date: s.sold_date, count: 0, revenue: 0 };
    byDay[s.sold_date].count += 1;
    byDay[s.sold_date].revenue += Number(s.revenue_amount || 0);
  }
  const days = Object.values(byDay);
  const bestDay = days.length ? days.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : { date: null, count: 0, revenue: 0 };

  // Best week
  const byWeek = {};
  for (const s of approved) {
    const d = new Date(s.sold_date + 'T00:00');
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
    const key = ws.toISOString().slice(0, 10);
    byWeek[key] = byWeek[key] || { weekStart: key, count: 0, revenue: 0 };
    byWeek[key].count += 1;
    byWeek[key].revenue += Number(s.revenue_amount || 0);
  }
  const weeks = Object.values(byWeek);
  const bestWeek = weeks.length ? weeks.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : { weekStart: null, count: 0, revenue: 0 };

  // Best month
  const byMonth = {};
  for (const s of approved) {
    const key = s.sold_date.slice(0, 7); // YYYY-MM
    byMonth[key] = byMonth[key] || { month: key, count: 0, revenue: 0 };
    byMonth[key].count += 1;
    byMonth[key].revenue += Number(s.revenue_amount || 0);
  }
  const months = Object.values(byMonth);
  const bestMonth = months.length ? months.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : { month: null, count: 0, revenue: 0 };

  return { bestDay, bestWeek, bestMonth };
}


// Renewal detection for uploaded indicator sales. Now reads the SAME source
// revenue classification as reporting (Configurations → Lead Sources): a source
// counts as a renewal when its Revenue Type is Renewal. With no override it
// falls back to the name rule (…Renewal…), so default behavior is unchanged —
// but an admin retag in one place now applies to indicators too.
const _IND_RENEWAL_RE = /renewal/i; // legacy default, retained for reference
function _indicatorIsRenewal(s) { return reportingSourceClass(s && s.source ? String(s.source) : '') === 'renewal'; }
// Service types RIDD excludes by default from all reporting (mirrors the CRM's
// Global excluded service types) — fees, chargebacks, follow-ups, inspections,
// removals, etc. that aren't real new production. Matched on the subscription
// name (case-insensitive, "(Hidden)" + any leading "Office:" prefix stripped).
// Edit this list to add/remove an excluded service.
const _IND_EXCLUDED_SERVICES = new Set([
  'ach chargeback', 'early cancellation fee', 'german roach initial', 'rodent station removal',
  'sentricon station removal', 'tech follow up', 'box elder treatment', 'german roach follow up',
  'initial interior', 'inspection', 'late fee', 'paid in full',
]);
function _indicatorServiceExcluded(s) {
  const n = String(s && s.subscription || '').toLowerCase().replace(/\(hidden\)/g, '').replace(/\s+/g, ' ').trim();
  if (_IND_EXCLUDED_SERVICES.has(n)) return true;
  const ci = n.indexOf(':'); // strip a leading office prefix, e.g. "salt lake: box elder treatment"
  return ci >= 0 && _IND_EXCLUDED_SERVICES.has(n.slice(ci + 1).trim());
}
const INDICATOR_DEPTS = [
  ['all',    'All'],
  ['d2d',    'Sales Rep'],
  ['office', 'Office Staff'],
  ['techs',  'Technician'],
];
const _indSalesCache = { src: null, cfg: '', byKey: new Map() };
// The FieldRoutes "Pending / Serviced Accounts" gate as a standalone
// predicate — initial-appointment status Pending or Completed, minus the
// global service exclusions. indicatorSales() applies it to every metric on
// the Indicators tab; consumers that read the raw array directly (My Stats,
// weekly recap) call it themselves so EVERYTHING on that tab reconciles with
// the CRM's Sales Leaderboard. Comp boards keep their own comp rules.
// ── MY% SERVICE EXCLUSIONS ──────────────────────────────────────────────
// Some services are not really sold on term length, so scoring a rep's MY%
// on them just adds noise in whichever direction the CRM happens to default
// the agreement. Those services drop out of BOTH sides of the ratio - they
// still count everywhere else (revenue, ACV, counts, records, KOTH).
// Default: Sentricon. Editable in Settings > Configurations.
// SCOPE: display metric ONLY. commissionCompute keeps its own revenue-
// weighted myPct (see the Multi-Year Bonus/Deduction block) and is
// deliberately untouched - that one is pay, and changing it moves payouts.
const MY_EXCLUDE_DEFAULT = ['sentricon'];
function myExcludeTerms() {
  const v = state.indicatorMyExclServiceTerms;
  return (Array.isArray(v) && v.length) ? v : MY_EXCLUDE_DEFAULT;
}
function _myServiceNameOf(s) {
  if (!s) return '';
  if (s.subscription) return String(s.subscription);              // indicators raw-sales pool
  if (s._crmService) return String(s._crmService);                // app-native pool, CRM-matched
  if (s.service_type_id != null && typeof nameFromId === 'function') {
    return String(nameFromId(state.serviceTypes, s.service_type_id) || '');
  }
  return String(s.service || '');
}
function myExcludedFromPct(s) {
  const n = _myServiceNameOf(s).toLowerCase();
  if (!n) return false;
  return myExcludeTerms().some(t => t && n.includes(String(t).toLowerCase()));
}
// The ONE place that decides which side of the MY% ratio a sale lands on.
// 'multi' | 'twelve' | null, where null means out of the ratio entirely.
// Also unifies the threshold at >=18: the codebase previously ran >=18 in
// some places and >12 in others, so 13-17mo contracts counted as multi-year
// on the Power Ranking and team PDFs but not on the rep leaderboard - the
// same rep read differently screen to screen.
function myBucketOf(s) {
  if (!s || myExcludedFromPct(s)) return null;
  const m = Number(s.contract != null ? s.contract : s.contract_months) || 0;
  if (m >= 18) return 'multi';
  if (m === 12) return 'twelve';
  return null;
}
// Customers DELETED inside FieldRoutes leave orphan rows in the RevHawk
// mirror (the CRM's live reports drop them, the warehouse keeps them). The
// mirror carries no deletion marker, so this admin-maintained ID list
// (Settings → Configurations) is the source of truth — excluded from EVERY
// dataset so app numbers align with the CRM exactly.
function deletedCustIdSet() {
  const set = new Set((state.indicatorDeletedCustIds || []).map(x => String(x).trim()).filter(Boolean));
  // Auto-detected orphans: subscriptions whose customer id has NO customer
  // record in FieldRoutes any more (deleted in the CRM). Flagged by the sync
  // as customer_missing; excluded here unless an admin turns the rule off.
  if (reportingAutoExcludeOrphans()) for (const id of (state._orphanCustIds || [])) set.add(id);
  return set;
}
function reportingAutoExcludeOrphans() {
  const r = _adminRules(); if (r && typeof r.autoExclOrphans === 'boolean') return r.autoExclOrphans;
  return true; }
function setReportingAutoExcludeOrphans(b) { _setAdminRule('autoExclOrphans', !!b); }
// Rows the sync flagged as having no CRM customer record. Kept aside (not in
// the working snapshot) so Settings can list them for review.
function orphanSubRows() { return state._orphanSubs || []; }
function indicatorSales() {
  const dept = state.indicatorDept || 'all';
  const src = state._indicatorRawSales || [];
  // CRM-style user filters (session-only; default = unfiltered, so nothing
  // changes until the user opens the Filters panel and picks something).
  const _acct       = state.indicatorAcctStatus || 'pending_serviced';   // default = Pending/Serviced (matches the CRM Sales Leaderboard config)
  const _exclSvc    = state.indicatorExclServiceTypes || [];
  const _inclSvc    = state.indicatorInclServiceTypes || [];
  const _inclSrcArr = state.indicatorInclSources || [];
  const _exclSrcArr = state.indicatorExclSources || [];
  // Cache filtered views per dept+comps+filters. A render calls this dozens of
  // times; the cache resets when the upload (array identity), any saved config,
  // or a filter changes.
  const cfg = _indCfgRev + '|' + (state.indicatorsComps ? 1 : 0)
    + '|' + _acct + '#' + _exclSvc.join('~') + '#' + _inclSvc.join('~') + '#' + _inclSrcArr.join('~') + '#' + _exclSrcArr.join('~')
    + '#' + (state.indicatorDeletedCustIds || []).join('~');
  if (_indSalesCache.src !== src || _indSalesCache.cfg !== cfg) {
    _indSalesCache.src = src; _indSalesCache.cfg = cfg; _indSalesCache.byKey.clear();
  }
  const hit = _indSalesCache.byKey.get(dept);
  if (hit) return hit;
  // Comps mode — competition exclusions. OFF (default): branch level shows
  // everything, no exclusions at any level. ON: comp rules apply — currently
  // reps on excluded teams (Manage Teams); extend here as comp rules grow.
  // Sold-Not-Started accounts (sold but cancelled before ever receiving a
  // service) are not real customers — their revenue/counts are stripped from
  // EVERY indicator metric so the page reflects pending + serviced production
  // only. Serviced-then-cancelled accounts still count (they got service).
  // Cancel Analysis reads state._indicatorRawSales directly when it needs the
  // raw mix back.
  // Excluded lead sources (Settings → Configurations) now drop from the
  // Indicators tab too, matching Reporting.
  const _exclSrc = (typeof reportingExcludedSources === 'function') ? reportingExcludedSources() : new Set();
  // Sold-Not-Started accounts (no service and not active+pending — closed on
  // the sales-rep side, frozen, no appointment, initial appt cancelled, or sold
  // then cancelled before service) aren't real production, so they're stripped
  // from EVERY indicator metric. Leaves only active-pending + serviced accounts.
  const _exclSvcSet = _exclSvc.length ? new Set(_exclSvc) : null;
  const _inclSvcSet = _inclSvc.length ? new Set(_inclSvc) : null;
  const _inclSrcSet = _inclSrcArr.length ? new Set(_inclSrcArr) : null;
  const _exclSrcSet = _exclSrcArr.length ? new Set(_exclSrcArr) : null;
  const _delSet = deletedCustIdSet();
  let all = src.filter(s => {
    // Deleted-in-CRM orphans (see deletedCustIdSet above) never count.
    if (_delSet.size && _delSet.has(String(s.customerId != null ? s.customerId : ''))) return false;
    // FieldRoutes' GLOBAL report exclusions — billing artifacts, not sales.
    // Matches the CRM Sales Leaderboard's "Global:" excluded service types so
    // the two reconcile to the penny.
    if (FR_GLOBAL_EXCLUDED_SERVICES.has(String(s.subscription || '').trim())) return false;
    // Account status. Default "Pending / Serviced" now uses FIELDROUTES' OWN
    // definition: the account's initial-appointment status is Pending or
    // Completed. Verified against the CRM's Sales Leaderboard to the penny
    // (e.g. Drew Sauer $409,600.97 ✓ — the old heuristic showed $369,579
    // because it also required the subscription to be Active). Older
    // snapshots without the Initial Status column fall back to the legacy
    // sold-not-started heuristic.
    // Manual sheets: the CRM Status column is ALWAYS the gate — Pending /
    // Serviced count, Canceled / Not Serviced never do (per Isaac) — even
    // when the Filters panel is set to "all".
    if (state._indManualMode) { if (!frPendingServiced(s)) return false; }
    else if (_acct !== 'all' && !frPendingServiced(s)) return false;
    if (_indicatorServiceExcluded(s)) return false;
    const _s = String(s.source || '').trim();
    if (_exclSrc.has(_s)) return false;
    // ── CRM-style filters (Filters panel) ──
    const _sub = (s.subscription || '').trim();
    if (_exclSvcSet && _exclSvcSet.has(_sub)) return false;                      // "exclude these services"
    if (_inclSvcSet && !_inclSvcSet.has(_sub)) return false;                     // "only these services"
    if (_inclSrcSet && !_inclSrcSet.has(_s)) return false;                       // "only these sources"
    if (_exclSrcSet && _exclSrcSet.has(_s)) return false;                        // "exclude these sources"
    return true;
  });
  if (state.indicatorsComps) all = all.filter(s => !isRepExcluded(s.rep));
  const out = dept === 'all' ? all : all.filter(s => _indicatorDeptOf(s) === dept);
  _indSalesCache.byKey.set(dept, out);
  return out;
}

// ── CRM Reconcile (admin) ────────────────────────────────────────────────
// Paste the legacy CRM Sales Leaderboard's SalesReport CSV (one rep's
// account list) and get a row-level diff against the app's own pool: which
// accounts are missing from the synced data entirely, which are excluded and
// by exactly WHICH rule, which are attributed to a different rep, and which
// the app counts that the CRM export doesn't. Ends "the totals are off"
// debates by naming the accounts instead of guessing at rules.
function _crmReconCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const out = []; let field = '', rec = [], inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { rec.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      rec.push(field); field = '';
      if (rec.length > 1 || rec[0] !== '') out.push(rec);
      rec = [];
    } else field += ch;
  }
  rec.push(field);
  if (rec.length > 1 || rec[0] !== '') out.push(rec);
  return out;
}
function openCrmReconcileModal() {
  const nameKey = (n) => String(n || '').toLowerCase().replace(/[^a-z]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  // Alias-aware resolution: "Lex Magaletta" (CSV) and "Magaletta, Alexander"
  // (app canonical) are the same human via the rep-alias store — fold every
  // known spelling's key to its canonical's key so cross-spelling rows don't
  // false-flag as "counted under a different rep" (242 rows of noise in the
  // Jul 2026 run, all one person).
  const _aliasKey = new Map();
  Object.entries(state._indicatorRepAlias || {}).forEach(([from, to]) => {
    _aliasKey.set(nameKey(from), nameKey(getCanonicalRepName(to)));
  });
  const repKeyOf = (n) => {
    const k = nameKey(getCanonicalRepName(n));
    return _aliasKey.get(k) || k;
  };
  // Why is this raw row NOT in the canonical pool? Mirrors the gate order
  // inside indicatorSales() exactly — if that changes, keep this in sync so
  // the report never lies about the reason.
  const _exclSrc = (typeof reportingExcludedSources === 'function') ? reportingExcludedSources() : new Set();
  const _delSet = deletedCustIdSet();
  const _exclSvcSet = (state.indicatorExclServiceTypes || []).length ? new Set(state.indicatorExclServiceTypes) : null;
  const _inclSvcSet = (state.indicatorInclServiceTypes || []).length ? new Set(state.indicatorInclServiceTypes) : null;
  const _inclSrcSet = (state.indicatorInclSources || []).length ? new Set(state.indicatorInclSources) : null;
  const _exclSrcSet = (state.indicatorExclSources || []).length ? new Set(state.indicatorExclSources) : null;
  const gateReason = (s) => {
    if (_delSet.size && _delSet.has(String(s.customerId != null ? s.customerId : ''))) return 'deleted-accounts list (Settings → Configurations)';
    if (FR_GLOBAL_EXCLUDED_SERVICES.has(String(s.subscription || '').trim())) return 'globally excluded service “' + s.subscription + '”';
    // Mirror of the served-evidence early-accept in frPendingServiced.
    if ((Number(s.services) || 0) > 0 || String(s.servicedDate || '').trim()) return null;
    const _alive = String(s.active || '').trim().toLowerCase();
    if (_alive === 'no') return 'cancelled before first service (CRM status Canceled / Not Serviced)';
    if (_isSoldNotStarted(s) && _alive !== 'yes') return 'Sold-Not-Started cancellation reason (sub not active)';
    if (_scInitialStatusHasData()) {
      const ist = String(s.initialStatus || '').trim().toLowerCase();
      if (ist === 'no appointment') return 'not scheduled yet (No Appointment) — Subscription Added, not Pending/Serviced';
      if (ist !== 'pending' && ist !== 'completed') return 'initial appt status “' + (s.initialStatus || '—') + '” (not Pending/Completed)';
    } else if (_scIsSoldNotStarted(s)) return 'Sold-Not-Started (legacy heuristic)';
    if (_indicatorServiceExcluded(s)) return 'excluded service “' + s.subscription + '” (Settings → Configurations)';
    const _s = String(s.source || '').trim();
    if (_exclSrc.has(_s)) return 'excluded source “' + (_s || '—') + '” (Settings → Configurations)';
    const _sub = String(s.subscription || '').trim();
    if (_exclSvcSet && _exclSvcSet.has(_sub)) return 'session filter: excluded service “' + _sub + '”';
    if (_inclSvcSet && !_inclSvcSet.has(_sub)) return 'session filter: not in included services';
    if (_inclSrcSet && !_inclSrcSet.has(_s)) return 'session filter: not in included sources';
    if (_exclSrcSet && _exclSrcSet.has(_s)) return 'session filter: excluded source “' + _s + '”';
    if (state.indicatorsComps && isRepExcluded(s.rep)) return 'comp exclusion (team excluded)';
    return null;
  };
  const money = (n) => fmt.usd(n);
  const run = (text, resBox, copyBtn) => {
    const recs = _crmReconCsv(text);
    if (recs.length < 2) { resBox.textContent = 'Paste the full CSV, header row included.'; return; }
    const hdr = recs[0].map(h => String(h || '').trim().toLowerCase());
    const col = (n) => hdr.indexOf(n);
    const iId = col('customer id'), iCust = col('customer'), iSub = col('subscription'),
          iRep = col('sales rep'), iDate = col('date sold'), iCv = col('contract value');
    if (iId < 0 || iCv < 0) { resBox.textContent = 'Couldn’t find “Customer ID” / “Contract Value” columns — is this the SalesReport export?'; return; }
    const num = (v) => parseFloat(String(v || '0').replace(/[$,]/g, '')) || 0;
    const crmRows = recs.slice(1).filter(r => String(r[iId] || '').trim()).map(r => ({
      id: String(r[iId]).trim(), customer: iCust >= 0 ? (r[iCust] || '') : '',
      sub: iSub >= 0 ? (r[iSub] || '') : '', rep: iRep >= 0 ? (r[iRep] || '') : '',
      date: iDate >= 0 ? (r[iDate] || '') : '', cv: num(r[iCv]),
    }));
    const crmTotal = crmRows.reduce((a, r) => a + r.cv, 0);
    const repKeys = new Set(crmRows.map(r => repKeyOf(r.rep)).filter(Boolean));
    const raw = state._indicatorRawSales || [];
    const byId = new Map();
    raw.forEach(s => {
      const id = String(s.customerId != null ? s.customerId : '').trim();
      if (!id) return;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(s);
    });
    const missing = [], excluded = [], otherRep = [], valueDiff = [], extras = [];
    let matchedCv = 0, matchedN = 0;
    const crmIds = new Set(crmRows.map(r => r.id));
    const usedRows = new Set();
    crmRows.forEach(r => {
      const rows = byId.get(r.id) || [];
      if (!rows.length) { missing.push(r); return; }
      const subKey = String(r.sub || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const rowsSub = rows.filter(s => String(s.subscription || '').toLowerCase().replace(/\s+/g, ' ').trim() === subKey && !usedRows.has(s));
      const cand = (rowsSub.length ? rowsSub : rows.filter(s => !usedRows.has(s)));
      if (!cand.length) { missing.push(r); return; }
      const pass = cand.filter(s => !gateReason(s));
      if (!pass.length) { excluded.push({ r, why: gateReason(cand[0]) }); return; }
      const s0 = pass[0];
      usedRows.add(s0);
      if (repKeys.size && !repKeys.has(repKeyOf(s0.rep))) { otherRep.push({ r, appRep: getCanonicalRepName(s0.rep) || '(no rep on the synced row)' }); return; }
      matchedN++; matchedCv += Number(s0.contractValue) || 0;
      if (Math.abs((Number(s0.contractValue) || 0) - r.cv) > 0.5) valueDiff.push({ r, appCv: Number(s0.contractValue) || 0 });
    });
    // Partial exports (a week, a month, one office) are common — only call
    // an app row "extra" when it falls INSIDE the date window the CSV
    // actually covers, otherwise the whole rest of the season shows up as
    // noise and buries the real differences.
    const _soldDay = (str) => {
      const m = String(str || '').trim().split(' ')[0].split('/');
      if (m.length !== 3) return null;
      let y = Number(m[2]); if (y < 100) y += 2000;
      const d = new Date(y, Number(m[0]) - 1, Number(m[1]));
      return isNaN(d) ? null : d.getTime();
    };
    let winLo = Infinity, winHi = -Infinity;
    crmRows.forEach(r => { const t = _soldDay(r.date); if (t != null) { if (t < winLo) winLo = t; if (t > winHi) winHi = t; } });
    const hasWin = winLo <= winHi;
    raw.forEach(s => {
      const id = String(s.customerId != null ? s.customerId : '').trim();
      if (!id || crmIds.has(id)) return;
      if (!repKeys.size || !repKeys.has(repKeyOf(s.rep))) return;
      if (gateReason(s)) return;
      if (hasWin) {
        const t = _soldDay(s.dateSold);
        if (t == null || t < winLo || t > winHi) return;
      }
      extras.push({ id, customer: s.customer || '', sub: s.subscription || '', date: s.dateSold || '', cv: Number(s.contractValue) || 0, rawRep: s.rep });
    });
    const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
    const L = [];
    L.push('CRM export:  ' + crmRows.length + ' accounts · ' + money(crmTotal));
    L.push('App matched: ' + matchedN + ' accounts · ' + money(matchedCv));
    L.push('Delta:       ' + money(crmTotal - matchedCv));
    L.push('');
    if (missing.length) {
      L.push('■ MISSING FROM SYNCED DATA — ' + missing.length + ' accts · ' + money(sum(missing, x => x.cv)));
      L.push('  (in the CRM, but the RevHawk mirror has no row for this customer)');
      missing.forEach(x => L.push('  #' + x.id + '  ' + x.customer + '  · ' + x.sub + ' · sold ' + x.date + ' · ' + money(x.cv)));
      L.push('');
    }
    if (excluded.length) {
      L.push('■ EXCLUDED BY AN APP RULE — ' + excluded.length + ' accts · ' + money(sum(excluded, x => x.r.cv)));
      excluded.forEach(x => L.push('  #' + x.r.id + '  ' + x.r.customer + '  · ' + x.r.sub + ' · ' + money(x.r.cv) + '\n     ↳ ' + x.why));
      L.push('');
    }
    if (otherRep.length) {
      L.push('■ COUNTED UNDER A DIFFERENT REP — ' + otherRep.length + ' accts · ' + money(sum(otherRep, x => x.r.cv)));
      otherRep.forEach(x => L.push('  #' + x.r.id + '  ' + x.r.customer + ' · ' + money(x.r.cv) + '  → app credits: ' + x.appRep));
      L.push('');
    }
    if (valueDiff.length) {
      L.push('■ CONTRACT-VALUE MISMATCH — ' + valueDiff.length + ' accts · net ' + money(sum(valueDiff, x => x.r.cv - x.appCv)));
      valueDiff.forEach(x => L.push('  #' + x.r.id + '  ' + x.r.customer + ' · CRM ' + money(x.r.cv) + ' vs app ' + money(x.appCv)));
      L.push('');
    }
    if (extras.length) {
      L.push('■ IN THE APP, NOT IN THE CRM EXPORT — ' + extras.length + ' accts · ' + money(sum(extras, x => x.cv)));
      L.push('  (usually a second CRM employee record merged under this rep, or a rep-name alias)');
      extras.forEach(x => L.push('  #' + x.id + '  ' + x.customer + '  · ' + x.sub + ' · sold ' + x.date + ' · ' + money(x.cv) + ' · raw rep: ' + x.rawRep));
      L.push('');
    }
    if (!missing.length && !excluded.length && !otherRep.length && !valueDiff.length && !extras.length)
      L.push('✓ Perfect reconciliation — every CRM account is counted, nothing extra.');
    const report = L.join('\n');
    resBox.textContent = report;
    if (copyBtn) { copyBtn.style.display = ''; copyBtn.onclick = () => { navigator.clipboard.writeText(report); copyBtn.textContent = 'Copied ✓'; setTimeout(() => { copyBtn.textContent = 'Copy report'; }, 1500); }; }
  };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/70 z-40 flex items-start justify-center p-4 overflow-y-auto' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const ta = el('textarea', {
    class: 'w-full rounded-lg border p-2 text-xs', rows: '6',
    style: { borderColor: 'var(--border-2)', fontFamily: 'ui-monospace, Menlo, monospace' },
    placeholder: 'Paste the CRM SalesReport CSV here (straight from the export — header row included)…',
  });
  const resBox = el('div', { class: 'text-xs mt-3', style: { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: '1.65' } });
  const copyBtn = el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer border transition hover:brightness-95',
    style: { borderColor: 'var(--border-2)', display: 'none' },
  }, 'Copy report');
  overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '860px' } },
    el('div', { class: 'flex items-center justify-between mb-1' },
      el('h3', { class: 'text-base font-bold' }, 'Reconcile vs CRM'),
      el('button', { class: 'text-xl leading-none cursor-pointer px-2', onclick: () => overlay.remove() }, '×')),
    el('p', { class: 'text-xs text-muted- mb-3' },
      'Paste a SalesReport CSV from the CRM’s Sales Leaderboard (one rep or many). Every account is joined on Customer ID against this app’s synced data, and any difference is named account-by-account with the exact rule responsible.'),
    ta,
    el('div', { class: 'flex items-center gap-2 mt-2 flex-wrap' },
      // Big exports won't paste cleanly — a real file picker reads the CSV
      // straight from disk and runs the diff immediately.
      (() => {
        const inp = el('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' } });
        inp.addEventListener('change', () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => { ta.value = '(' + f.name + ' loaded — ' + Math.round(f.size / 1024) + ' KB)'; run(String(rd.result || ''), resBox, copyBtn); };
          rd.readAsText(f);
        });
        const pick = el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95',
          style: { background: 'var(--brand, #DF643A)', color: '#fff' },
          onclick: () => inp.click(),
        }, 'Choose CSV file…');
        return el('span', {}, inp, pick);
      })(),
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer transition hover:brightness-95 border',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => run(ta.value, resBox, copyBtn),
      }, 'Run pasted text'),
      copyBtn),
    resBox));
  document.body.append(overlay);
}

// "MM/DD/YY HH:MM AM/PM" → { hour: 0-23, minute: 0-59 } | null
function _parseIndicatorTime(s) {
  const str = (s.dateSold || '').trim();
  const parts = str.split(' ');
  if (parts.length < 2) return null;
  const tp = parts[1].split(':');
  if (tp.length < 2) return null;
  let h = Number(tp[0]);
  const mn = Number(tp[1]);
  if (!Number.isFinite(h) || !Number.isFinite(mn)) return null;
  const ampm = parts[2] ? parts[2].toUpperCase() : null;
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  if (h < 0 || h > 23) return null;
  // FieldRoutes' dateAdded (pulled via RevHawk) runs ~3 hours behind Eastern —
  // its stored timezone doesn't match the branches — so raw hours make evening
  // knocks look like afternoon. Shift each sale to its OFFICE's local time so
  // Power Hour (and the day/hour heatmap) reflect when reps actually knock.
  h = (h + _saleHourOffset(s.office) + 24) % 24;
  return { hour: h, minute: mn };
}
// Hours to add to the source timestamp to reach the office's local time. The
// source runs ~3h behind Eastern; Destin is Central (+2), every other RIDD
// branch is Eastern (+3). Adjust here if a branch reads an hour off.
// ── User display timezone ─────────────────────────────────────────────────
// 'auto' = role default: office staff see MOUNTAIN (the Utah call center's
// clock, per Isaac); D2D reps see each sale in the SELLING OFFICE's local
// time (unchanged). The per-user override lives in My Settings (gear).
const USER_TZ_KEY = 'ridd_user_tz';
const USER_TZ_CHOICES = [
  ['auto', 'Auto — role default'],
  ['America/New_York', 'Eastern (ET)'],
  ['America/Chicago', 'Central (CT)'],
  ['America/Denver', 'Mountain (MT)'],
  ['America/Phoenix', 'Arizona (AZ)'],
  ['America/Los_Angeles', 'Pacific (PT)'],
];
function userTzPref() { try { return localStorage.getItem(USER_TZ_KEY) || 'auto'; } catch { return 'auto'; } }
function setUserTzPref(v) { try { localStorage.setItem(USER_TZ_KEY, v); } catch { /* private mode */ } }
// Hours to ADD to the raw FieldRoutes clock per zone — same convention as
// _saleHourOffset below (Mountain = +1), so CRM wall-clocks convert between
// zones by simple offset difference.
const _TZ_RAW_OFFSET = { 'America/New_York': 3, 'America/Chicago': 2, 'America/Denver': 1, 'America/Phoenix': 1, 'America/Los_Angeles': 0 };
const _TZ_SHORT = { 'America/New_York': 'ET', 'America/Chicago': 'CT', 'America/Denver': 'MT', 'America/Phoenix': 'AZ', 'America/Los_Angeles': 'PT' };
// Zone the inside-sales (War Room) clocks display in: user override → Mountain.
function warRoomTz() { const p = userTzPref(); return _TZ_RAW_OFFSET[p] != null ? p : 'America/Denver'; }

// Short zone label for a sale's office — pairs with _saleHourOffset below.
function _officeTzShort(office) {
  const o = String(office || '').toLowerCase();
  if (o.includes('salt lake')) return 'MT';
  if (o.includes('destin') || o.includes('joplin') || o.includes('little rock')) return 'CT';
  return 'ET';
}
function _saleHourOffset(office) {
  const o = String(office || '').toLowerCase();
  if (o.includes('salt lake')) return 1;   // Mountain
  if (o.includes('destin'))    return 2;   // Central
  if (o.includes('joplin'))    return 2;   // Central (Missouri)
  if (o.includes('little rock')) return 2; // Central (Arkansas)
  return 3;                                 // Eastern (Atlanta, Charleston, Detroit, Myrtle Beach, Raleigh, Virginia Beach)
}

// 14 → "2p", 0 → "12a", 12 → "12p"
function _fmtHourLabel(h) {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  if (h < 12) return h + 'a';
  return (h - 12) + 'p';
}

// { hour, minute } → "7:42 AM"
function _fmtTimeOfDay(t) {
  if (!t) return '—';
  const m = String(t.minute).padStart(2, '0');
  const ampm = t.hour >= 12 ? 'PM' : 'AM';
  const h12 = t.hour % 12 || 12;
  return h12 + ':' + m + ' ' + ampm;
}

// Per-record derived metrics — ACV / MY% / Avg Pest Init / Avg Init /
// Cancel % computed against the sales that fell inside that record period.
// Cached on the record so the leaderboard doesn't re-iterate per render.
function _computeRecordMetrics(sales) {
  if (!sales || sales.length === 0) return { acv: 0, myPct: 0, avgPest: 0, avgInitial: 0, cancelPct: 0 };
  const REP_AVG_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;
  const eligible = sales.filter(s => !REP_AVG_PEST_EXCLUDE.test(s.subscription || ''));
  const avgPest    = eligible.length > 0 ? eligible.reduce((a, s) => a + Number(s.initialPrice || 0), 0) / eligible.length : 0;
  const avgInitial = sales.reduce((a, s) => a + Number(s.initialPrice || 0), 0) / sales.length;
  const acv        = sales.reduce((a, s) => a + Number(s.contractValue || 0), 0) / sales.length;
  const multi   = sales.filter(s => myBucketOf(s) === 'multi').length;
  const twelve  = sales.filter(s => myBucketOf(s) === 'twelve').length;
  const ctTotal = multi + twelve;
  const myPct   = ctTotal > 0 ? multi / ctTotal : 0;
  const cancels   = sales.filter(_repCancelCounts).length;
  const cancelPct = cancels / sales.length;
  return { acv, myPct, avgPest, avgInitial, cancelPct };
}

// Player-card scope presets — anchor to the dataset's most recent sale
// date so "today / this week" mean the latest in the data, not the
// system clock (otherwise stale CSV uploads always look empty).
const CARD_SCOPE_PRESETS = [
  { id: 'all',         label: 'All time' },
  { id: 'today',       label: 'Today' },
  { id: 'yesterday',   label: 'Yesterday' },
  { id: 'this_week',   label: 'This week' },
  { id: 'last_week',   label: 'Last week' },
  { id: 'this_month',  label: 'This month' },
  { id: 'last_month',  label: 'Last month' },
  { id: 'last_30',     label: 'Last 30 days' },
  { id: 'last_90',     label: 'Last 90 days' },
  { id: 'ytd',         label: 'Year to date' },
];
function getCardScopeBounds(preset) {
  if (!preset || preset === 'all') return null;
  const rawSales = indicatorSales();
  let latest = null;
  for (const s of rawSales) {
    const d = _parseIndicatorDay(s);
    if (d && (!latest || d > latest)) latest = d;
  }
  if (!latest) return null;
  // Anchor = the latest sale day, but never past today: one future-dated
  // row (a typo'd sold date) dragged every preset months ahead and made
  // "This week" read 11/1–11/3 with zeros everywhere. Stale uploads still
  // anchor to their own last day, live data anchors to today.
  const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
  const anchor = new Date(latest > todayD ? todayD : latest); anchor.setHours(0, 0, 0, 0);
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  switch (preset) {
    case 'today':      return { start: anchor, end: endOfDay(anchor) };
    case 'yesterday':  { const y = new Date(anchor); y.setDate(y.getDate() - 1); return { start: y, end: endOfDay(y) }; }
    case 'this_week':  { const ws = new Date(anchor); ws.setDate(ws.getDate() - ws.getDay()); return { start: ws, end: endOfDay(anchor) }; }
    case 'last_week':  { const ws = new Date(anchor); ws.setDate(ws.getDate() - ws.getDay() - 7); const we = new Date(ws); we.setDate(we.getDate() + 6); return { start: ws, end: endOfDay(we) }; }
    case 'this_month': { const ms = new Date(anchor.getFullYear(), anchor.getMonth(), 1); return { start: ms, end: endOfDay(anchor) }; }
    case 'last_month': { const ms = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1); const me = new Date(anchor.getFullYear(), anchor.getMonth(), 0); return { start: ms, end: endOfDay(me) }; }
    case 'last_30':    { const s = new Date(anchor); s.setDate(s.getDate() - 29); return { start: s, end: endOfDay(anchor) }; }
    case 'last_90':    { const s = new Date(anchor); s.setDate(s.getDate() - 89); return { start: s, end: endOfDay(anchor) }; }
    case 'ytd':        { const ys = new Date(anchor.getFullYear(), 0, 1); return { start: ys, end: endOfDay(anchor) }; }
    default: return null;
  }
}
// Wrap a rep into a scoped view — sales filtered by predicate, with the
// aggregate fields (revenue / twelve / multi / autoPay / cancels) recomputed
// so existing block code reads from scopedRep without further changes.
function _scopeRep(rep, filterFn) {
  if (!filterFn) return rep;
  const sales = (rep.sales || []).filter(filterFn);
  let revenue = 0, twelve = 0, multi = 0, autoPay = 0, cancels = 0;
  for (const s of sales) {
    revenue += Number(s.contractValue || 0);
    const _myb = myBucketOf(s);
    if (_myb === 'twelve') twelve++; else if (_myb === 'multi') multi++;
    if (s.autoPay && s.autoPay !== 'No') autoPay++;
    if (_repCancelCounts(s)) cancels++;
  }
  return { ...rep, sales, revenue, twelve, multi, autoPay, cancels };
}

// Build a minimal enriched rep object from rawSales — just enough fields
// to feed openIndicatorRepCard from anywhere (top header icon, etc.) so we
// don't need the full indicatorRepSections closure scope.
function _enrichRepFromRawSales(repName, rawSales) {
  const sales = rawSales.filter(s => getCanonicalRepName(s.rep) === repName);
  let revenue = 0, twelve = 0, multi = 0, autoPay = 0, cancels = 0;
  for (const s of sales) {
    revenue += Number(s.contractValue || 0);
    const _myb = myBucketOf(s);
    if (_myb === 'twelve') twelve++; else if (_myb === 'multi') multi++;
    if (s.autoPay && s.autoPay !== 'No') autoPay++;
    if (_repCancelCounts(s)) cancels++;
  }
  return {
    name: repName, sales,
    team: getRepTeam(repName),
    tier: getRepTier(repName),
    office: sales[0]?.office || '',
    revenue, twelve, multi, autoPay, cancels,
  };
}
function _buildAllRepsFromRawSales(rawSales) {
  // Canonicalize (alias merges + whitespace) so "Karson  Murray" and
  // "Karson Murray" are ONE roster entry, keyed by the clean spelling.
  const names = [...new Set(rawSales.map(s => getCanonicalRepName(s.rep)).filter(Boolean))];
  return names.map(name => _enrichRepFromRawSales(name, rawSales));
}

// Coach Mode flagging — extracted to module scope so it can run from the
// top-header icon. Rules:
//   silent          — no sale in 5+ days (med) / 14+ days (high)
//   inactive_cand   — silent ≥30 days; suggests Manage-Teams cleanup
//                     instead of coaching. Short-circuits other rules
//                     since their averages would be stale.
//   declining       — week-over-week revenue drop
//   cancels         — high cancel rate
//   myPct / autoPayPct / acv / avgInit / avgPest
//                   — recent 14-day window's average underperforms the
//                     prior 14-day window by enough to be a real signal
// Termite Pros stays excluded since their cadence breaks the heuristics.
function computeCoachFlags() {
  const COACH_EXCLUDED_TEAMS = new Set(['Termite Pros']);
  const NO_SALE_DAYS_MED       = 5,    NO_SALE_DAYS_HIGH      = 14;
  const NO_SALE_DAYS_INACTIVE  = 30;
  const TREND_DECLINE_MED      = -0.20, TREND_DECLINE_HIGH    = -0.40;
  const CANCEL_PCT_MED         = 0.15,  CANCEL_PCT_HIGH       = 0.25;
  const AVG_DROP_PCT_MED       = -0.15, AVG_DROP_PCT_HIGH     = -0.30;  // dollar means
  const RATIO_DROP_PP_MED      = -0.10, RATIO_DROP_PP_HIGH    = -0.20;  // ratio metrics (pp)
  const MIN_VOLUME_FOR_RATE_RULES   = 5;
  const MIN_VOLUME_FOR_AVG_WINDOW   = 5;
  const RECENT_WINDOW_DAYS     = 14;
  const PEST_EXCLUDE_RE        = /sentricon|german\s*roach|interior\s*flea/i;

  const rawSales = indicatorSales();
  if (rawSales.length === 0) return [];

  // Find the dataset's most recent sale date (anchors WoW + days-since)
  let latest = null;
  for (const s of rawSales) {
    const d = _parseIndicatorDay(s);
    if (d && (!latest || d > latest)) latest = d;
  }
  // Apples-to-apples WoW windows — see _weekToDateWindows. The old
  // approach summed full Sun–Sat weeks via byWeek[], which falsely
  // flagged steady reps as "declining" mid-week (Sun–Wed this week
  // vs Sun–Sat last week is always a partial-to-full mismatch).
  const wow = latest ? _weekToDateWindows(latest) : null;

  // Per-rep aggregation. We cache each sale's parsed day on `_d` so the
  // window helper below can filter without re-parsing dozens of times.
  const byRep = {};
  for (const s of rawSales) {
    const name = s.rep || 'Unknown';
    if (!byRep[name]) byRep[name] = { name, sales: [], cancels: 0, byWeek: {}, lastSale: null };
    const r = byRep[name];
    r.sales.push(s);
    if (_isReportableCancel(s)) r.cancels++;
    const d = _parseIndicatorDay(s);
    if (d) {
      s._d = d;
      if (!r.lastSale || d > r.lastSale) r.lastSale = d;
      const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
      const wk = ws.toISOString().slice(0, 10);
      r.byWeek[wk] = (r.byWeek[wk] || 0) + Number(s.contractValue || 0);
    }
  }

  // Aggregates for a single rep across [start, end] inclusive. Returns
  // null when nothing falls in the window so the caller can short-
  // circuit cleanly.
  const windowStats = (sales, start, end) => {
    const startMs = start.getTime(), endMs = end.getTime();
    let count = 0, revenue = 0, twelve = 0, multi = 0, autoPay = 0;
    let initialSum = 0, pestInitialSum = 0, pestCount = 0;
    for (const s of sales) {
      if (!s._d) continue;
      const ms = s._d.getTime();
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
  for (const r of Object.values(byRep)) {
    // Manage Teams "Inactive" reps don't need coaching — usually they're
    // off-roster (left, on leave, moved off sales). Same skip lives in
    // the inline buildCoachModeCard path so both surfaces stay in sync.
    if (typeof isRepActive === 'function' && !isRepActive(r.name)) continue;
    const team = getRepTeam(r.name);
    if (COACH_EXCLUDED_TEAMS.has(team)) continue;
    const count = r.sales.length;
    const cancelPct = count > 0 ? r.cancels / count : 0;
    // Sum WTD revenue + matching same-period-last-week from this rep's
    // sales. Walking the array once is cheaper than maintaining a
    // separate byWeek map keyed on partial-week buckets.
    let thisWeek = 0, lastWeek = 0;
    if (wow) {
      for (const s of r.sales) {
        if (!s._d) continue;
        if (s._d >= wow.thisStart && s._d < wow.thisEnd) thisWeek += Number(s.contractValue || 0);
        else if (s._d >= wow.lastStart && s._d < wow.lastEnd) lastWeek += Number(s.contractValue || 0);
      }
    }
    const trendSlope = lastWeek > 0 ? (thisWeek / lastWeek) - 1 : (thisWeek > 0 ? 1 : 0);

    let daysSinceLastSale = null;
    if (latest && r.lastSale) daysSinceLastSale = Math.round((latest - r.lastSale) / 86400000);

    const issues = [];

    // Rule 1A: Long silence → roster-cleanup suggestion. Past 30 days
    // the rep almost certainly isn't on the team anymore; the right
    // action is to flip them Inactive in Manage Teams, not to coach.
    // Short-circuit the other rules — their averages would be stale.
    if (daysSinceLastSale != null && daysSinceLastSale >= NO_SALE_DAYS_INACTIVE) {
      issues.push({
        kind: 'inactive_candidate',
        label: '💤 Mark Inactive? · ' + daysSinceLastSale + ' days silent',
        severity: 'med',
      });
      flagged.push({ repName: r.name, team, issues, worstSeverity: 'med' });
      continue;
    }
    // Rule 1B: Standard silence (5–29 days)
    if (daysSinceLastSale != null && daysSinceLastSale >= NO_SALE_DAYS_MED) {
      issues.push({
        kind: 'silent',
        label: 'No sale in ' + daysSinceLastSale + ' days',
        severity: daysSinceLastSale >= NO_SALE_DAYS_HIGH ? 'high' : 'med',
      });
    }
    // Rule 2: WoW revenue decline — WTD vs same period last week so the
    // signal is honest on partial weeks.
    if (trendSlope <= TREND_DECLINE_MED && count >= MIN_VOLUME_FOR_RATE_RULES) {
      issues.push({
        kind: 'declining',
        label: 'Revenue down ' + Math.abs(trendSlope * 100).toFixed(0) + '% (WTD vs same period last week)',
        severity: trendSlope <= TREND_DECLINE_HIGH ? 'high' : 'med',
      });
    }
    // Rule 3: High cancel rate
    if (cancelPct >= CANCEL_PCT_MED && count >= MIN_VOLUME_FOR_RATE_RULES) {
      issues.push({
        kind: 'cancels',
        label: 'Cancel rate ' + (cancelPct * 100).toFixed(0) + '%',
        severity: cancelPct >= CANCEL_PCT_HIGH ? 'high' : 'med',
      });
    }

    // Rules 4–8: Average-trend declines. Compare last 14 days against
    // the prior 14 days. Both windows need ≥5 sales to file a flag —
    // small samples make averages swing on a single contract. Ratios
    // (MY %, Auto Pay %) use percentage-point delta; dollar means
    // (ACV, Avg Init, Avg Pest) use percent change.
    if (latest && count >= MIN_VOLUME_FOR_RATE_RULES) {
      const recentEnd   = latest;
      const recentStart = new Date(latest);     recentStart.setDate(recentStart.getDate() - RECENT_WINDOW_DAYS + 1);
      const priorEnd    = new Date(recentStart); priorEnd.setDate(priorEnd.getDate() - 1);
      const priorStart  = new Date(priorEnd);    priorStart.setDate(priorStart.getDate() - RECENT_WINDOW_DAYS + 1);
      const recent = windowStats(r.sales, recentStart, recentEnd);
      const prior  = windowStats(r.sales, priorStart,  priorEnd);
      if (recent && prior && recent.count >= MIN_VOLUME_FOR_AVG_WINDOW && prior.count >= MIN_VOLUME_FOR_AVG_WINDOW) {
        const ratioRule = (kind, label, recentVal, priorVal) => {
          const dpp = recentVal - priorVal;
          if (dpp <= RATIO_DROP_PP_MED) {
            issues.push({
              kind, label: label + ' down ' + Math.abs(dpp * 100).toFixed(0) + 'pp (14d vs prior 14d)',
              severity: dpp <= RATIO_DROP_PP_HIGH ? 'high' : 'med',
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
      flagged.push({ repName: r.name, team, issues, worstSeverity });
    }
  }
  flagged.sort((a, b) => {
    if (a.worstSeverity !== b.worstSeverity) return a.worstSeverity === 'high' ? -1 : 1;
    if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
    return a.repName.localeCompare(b.repName);
  });
  return flagged;
}

// Open the Coach Mode panel as a modal overlay. Triggered by the top-bar
// icon; clicking a rep opens that rep's full player card.
function openCoachModeModal() {
  const rawSales = indicatorSales();
  const flagged = computeCoachFlags();
  const allReps = _buildAllRepsFromRawSales(rawSales);
  const repByName = Object.fromEntries(allReps.map(r => [r.name, r]));

  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', { class: 'card w-full max-w-5xl p-6 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(modal);

  const highCount = flagged.filter(f => f.worstSeverity === 'high').length;
  const medCount  = flagged.length - highCount;
  // "Inactive candidates" = reps the silence rule short-circuited on
  // because they've been quiet ≥30 days. computeCoachFlags emits ONLY
  // the inactive_candidate chip for those, so we can detect them by
  // checking the kind of their single issue.
  const isInactiveCandidate = (f) =>
    f.issues.length === 1 && f.issues[0].kind === 'inactive_candidate';
  const inactiveCandidates = flagged.filter(isInactiveCandidate);

  // Filter toggle state — closure-scoped so the renderBody re-render
  // can flip it without losing it on each rebuild.
  let inactiveOnly = false;

  function chipFor(issue) {
    const isHigh = issue.severity === 'high';
    return el('span', {
      class: 'text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 whitespace-nowrap',
      style: isHigh
        ? { background: 'rgba(220,38,38,.12)', color: '#B91C1C' }
        : { background: 'rgba(223,100,58,.15)', color: '#A9441F' },
    }, issue.label);
  }

  // Bulk-flip every inactive-candidate rep to Inactive in one shot.
  // Sets the state directly + fires a SINGLE saveDemoData rather than
  // calling setRepActive() per rep (which would mirror to Supabase N
  // times). Then closes the modal and remounts so the cleared list +
  // refreshed top-bar Coach badge are immediately visible.
  const bulkMarkInactive = () => {
    if (inactiveCandidates.length === 0) return;
    const ok = confirm('Mark all ' + inactiveCandidates.length
      + ' rep' + (inactiveCandidates.length === 1 ? '' : 's')
      + ' as Inactive in Manage Teams? This is reversible — toggle them back individually under Manage Teams.');
    if (!ok) return;
    if (!state._indicatorRepActive) state._indicatorRepActive = {};
    inactiveCandidates.forEach(f => { state._indicatorRepActive[f.repName] = false; });
    _invalidateRepSigIndex(state._indicatorRepActive);
    saveDemoData(); // single write — mirrors to Supabase once in live mode
    toast('Marked ' + inactiveCandidates.length + ' rep' + (inactiveCandidates.length === 1 ? '' : 's') + ' Inactive', 'success');
    overlay.remove();
    mountApp();
  };

  const renderBody = () => {
    const list = inactiveOnly ? inactiveCandidates : flagged;
    modal.innerHTML = '';
    modal.append(
      el('div', { class: 'flex items-start justify-between gap-4 mb-3' },
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          el('h2', { class: 'text-xl font-bold' }, '🚨 Coach Mode'),
          flagged.length > 0
            ? el('span', { class: 'text-xs text-muted-' }, flagged.length + ' rep' + (flagged.length === 1 ? '' : 's') + ' need attention')
            : el('span', { class: 'text-xs text-muted-' }, 'no reps flagged'),
          highCount > 0 && el('span', { class: 'text-[10px] font-bold px-1.5 py-0.5 rounded', style: { background: 'rgba(220,38,38,.12)', color: '#B91C1C' } }, highCount + ' high'),
          medCount > 0 && el('span', { class: 'text-[10px] font-bold px-1.5 py-0.5 rounded', style: { background: 'rgba(223,100,58,.15)', color: '#A9441F' } }, medCount + ' med'),
        ),
        el('button', { class: 'text-2xl text-muted-', onclick: () => overlay.remove() }, '×'),
      ),
      // Roster-cleanup toolbar — only renders when there are actually
      // ≥30-day silent reps to act on. Filter pill on the left scopes
      // the table; bulk button on the right flips them all Inactive.
      inactiveCandidates.length > 0 && el('div', {
        class: 'flex items-center justify-between gap-3 mb-3 flex-wrap rounded-lg border px-3 py-2',
        style: { borderColor: 'var(--border)', background: 'var(--card-2)' },
      },
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          el('button', {
            class: 'rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest border transition hover:brightness-95',
            style: inactiveOnly
              ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'rgba(223,100,58,.10)' }
              : { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
            title: inactiveOnly ? 'Show every flagged rep' : 'Show only reps silent ≥30 days',
            onclick: () => { inactiveOnly = !inactiveOnly; renderBody(); },
          }, inactiveOnly ? 'Show all flags' : '💤 Only silent 30+ days'),
          el('span', { class: 'text-[11px] text-muted-' },
            inactiveCandidates.length + ' rep' + (inactiveCandidates.length === 1 ? '' : 's')
              + ' silent ≥30 days · candidates to flip Inactive'),
        ),
        el('button', {
          class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
          style: { background: '#DC2626', color: '#fff' },
          title: 'Mark all silent-30+ reps as Inactive in Manage Teams (one undo per rep)',
          onclick: bulkMarkInactive,
        }, 'Mark all ' + inactiveCandidates.length + ' Inactive'),
      ),
      flagged.length === 0
        ? el('div', { class: 'p-6 text-center text-xs text-muted- italic' }, 'Nothing to flag right now. 🎉')
        : list.length === 0
          ? el('div', { class: 'p-6 text-center text-xs text-muted- italic' }, 'No reps match this filter.')
          : el('div', { class: 'rounded-lg border overflow-hidden', style: { borderColor: 'var(--border)' } },
              el('div', { class: 'scroll-x', style: { maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' } },
                el('table', { class: 'w-full text-[12px]' },
                  el('thead', {
                    class: 'text-[9px] uppercase tracking-wider text-muted-',
                    style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: 1 },
                  },
                    el('tr', { style: { background: 'var(--card-2)' } },
                      el('th', { class: 'text-left pl-4 pr-2 py-2' }, 'Rep'),
                      el('th', { class: 'text-left px-2 py-2' }, 'Team'),
                      el('th', { class: 'text-left px-2 py-2' }, 'Issues'),
                      el('th', { class: 'text-right pl-2 pr-4 py-2' }, ''),
                    ),
                  ),
                  el('tbody', {},
                    ...list.map(({ repName, team, issues, worstSeverity }) => el('tr', {
                      class: 'border-t border- cursor-pointer hover:brightness-95 transition',
                      style: worstSeverity === 'high' ? { background: 'rgba(220,38,38,.04)' } : {},
                      onclick: () => {
                        overlay.remove();
                        const rep = repByName[repName];
                        if (rep) openIndicatorRepCard(rep, allReps);
                      },
                    },
                      el('td', { class: 'pl-4 pr-2 py-2 font-semibold whitespace-nowrap' }, repName),
                      el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap' }, team || '—'),
                      el('td', { class: 'px-2 py-2' },
                        el('div', { class: 'flex flex-wrap gap-1.5' },
                          ...issues.map(chipFor),
                        ),
                      ),
                      el('td', { class: 'pl-2 pr-4 py-2 text-right text-[10px] text-muted-' }, 'Open card →'),
                    )),
                  ),
                ),
              ),
            ),
    );
  };

  renderBody();
  document.body.append(overlay);
}

// Tiny 12-week revenue sparkline rendered as an SVG so it scales cleanly
// inside a tabular row. Color follows the trend slope (green up, red down,
// muted flat) so a glance at the column tells you who's hot.
function miniSparkline(values, slope = 0) {
  const W = 80, H = 22;
  const max = Math.max(1, ...values);
  if (values.length === 0) return el('div', { style: { width: W + 'px', height: H + 'px' } });
  const slopePct = slope * 100;
  const stroke = slopePct >= 5 ? '#DF643A' : slopePct <= -5 ? '#DC2626' : 'var(--text-muted)';
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const points = values.map((v, i) => {
    const x = i * step;
    const y = H - 2 - ((v / max) * (H - 4));
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const last = values[values.length - 1];
  const lastX = (values.length - 1) * step;
  const lastY = H - 2 - ((last / max) * (H - 4));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.style.display = 'block';
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('points', points);
  svg.appendChild(line);
  if (last > 0) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', lastX.toFixed(1));
    dot.setAttribute('cy', lastY.toFixed(1));
    dot.setAttribute('r', '2');
    dot.setAttribute('fill', stroke);
    svg.appendChild(dot);
  }
  return svg;
}

// Aggregate records over an arbitrary sales slice. Used for company /
// branch / team rollups and for snapshotting on each CSV upload.
// `by` controls which field decides the winner: 'revenue' or 'count'.
// Records (best day / week / month / PRA) count PENDING/SERVICED accounts
// ONLY — per Isaac: a "best day" should not be built on accounts that never
// scheduled an initial service and never signed. Same gate King of the Hill
// uses, so a rep's records and their crown day tell the same story.
// DELIBERATE divergence from the leaderboard, which still counts everything
// so it reconciles 1:1 with the CRM's rep revenue cards — records are a
// claim about a real day, the leaderboard is a mirror of the CRM.
function _recordEligible(s) {
  return (typeof frPendingServiced !== 'function') || frPendingServiced(s);
}
function aggregateRecords(sales, by = 'revenue') {
  const byDay = {}, byWeek = {}, byMonth = {};
  for (const s of sales) {
    if (!_recordEligible(s)) continue;
    const d = _parseIndicatorDay(s);
    if (!d) continue;
    const dayKey = (s.dateSold || '').split(' ')[0].trim();
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
    const weekKey = ws.toISOString().slice(0, 10);
    const monthKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const v = Number(s.contractValue || 0);
    if (!byDay[dayKey])     byDay[dayKey]     = { date: dayKey, count: 0, revenue: 0, _reps: new Set() };
    if (!byWeek[weekKey])   byWeek[weekKey]   = { weekStart: weekKey, count: 0, revenue: 0, _reps: new Set() };
    if (!byMonth[monthKey]) byMonth[monthKey] = { month: monthKey, count: 0, revenue: 0, _reps: new Set() };
    byDay[dayKey].count++;     byDay[dayKey].revenue     += v;     if (s.rep) byDay[dayKey]._reps.add(s.rep);
    byWeek[weekKey].count++;   byWeek[weekKey].revenue   += v;     if (s.rep) byWeek[weekKey]._reps.add(s.rep);
    byMonth[monthKey].count++; byMonth[monthKey].revenue += v;     if (s.rep) byMonth[monthKey]._reps.add(s.rep);
  }
  // Materialize the Set into a plain `reps` count and drop the temp
  // field so callers / snapshots don't accidentally serialize a Set.
  const finalize = (obj) => Object.values(obj).map(r => {
    const reps = r._reps.size;
    const { _reps, ...rest } = r;
    return { ...rest, reps };
  });
  const pick = (arr) => arr.length ? arr.reduce((a, b) => b[by] > a[by] ? b : a) : null;
  return {
    bestDay:   pick(finalize(byDay)),
    bestWeek:  pick(finalize(byWeek)),
    bestMonth: pick(finalize(byMonth)),
  };
}

// Like aggregateRecords but returns the top N records per category
// rather than just the single best. Used by the records-card drill-down
// when a user expands the Company row — they see the top 10 days /
// weeks / months in the dataset, not just the winner.
function topRecords(sales, n = 10, byMetric = 'revenue') {
  const byDay = {}, byWeek = {}, byMonth = {};
  for (const s of sales) {
    if (!_recordEligible(s)) continue;
    const d = _parseIndicatorDay(s);
    if (!d) continue;
    const dayKey = (s.dateSold || '').split(' ')[0].trim();
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
    const weekKey = ws.toISOString().slice(0, 10);
    const monthKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const v = Number(s.contractValue || 0);
    if (!byDay[dayKey])     byDay[dayKey]     = { date: dayKey, count: 0, revenue: 0, _reps: new Set() };
    if (!byWeek[weekKey])   byWeek[weekKey]   = { weekStart: weekKey, count: 0, revenue: 0, _reps: new Set() };
    if (!byMonth[monthKey]) byMonth[monthKey] = { month: monthKey, count: 0, revenue: 0, _reps: new Set() };
    byDay[dayKey].count++;     byDay[dayKey].revenue     += v;     if (s.rep) byDay[dayKey]._reps.add(s.rep);
    byWeek[weekKey].count++;   byWeek[weekKey].revenue   += v;     if (s.rep) byWeek[weekKey]._reps.add(s.rep);
    byMonth[monthKey].count++; byMonth[monthKey].revenue += v;     if (s.rep) byMonth[monthKey]._reps.add(s.rep);
  }
  const slice = (obj) => Object.values(obj)
    .map(r => {
      const reps = r._reps.size;
      const { _reps, ...rest } = r;
      return { ...rest, reps };
    })
    .sort((a, b) => (b[byMetric] || 0) - (a[byMetric] || 0))
    .slice(0, n);
  return { topDays: slice(byDay), topWeeks: slice(byWeek), topMonths: slice(byMonth) };
}

// Top N PRA days for an arbitrary sales slice. Same season gate as
// bestPRADayRecord — sales before May 1 are excluded so the leaderboard
// doesn't fill with off-season days that had two reps knocking.
function topPRADays(sales, n = 10, minReps = 1, byMetric = 'revenue') {
  const byDay = {};
  for (const s of sales) {
    if (!s.rep) continue;
    if (!_recordEligible(s)) continue;
    const key = (s.dateSold || '').split(' ')[0].trim();
    if (!key || !_isPraSeasonDay(key)) continue;
    if (!byDay[key]) byDay[key] = { revenue: 0, count: 0, reps: new Set() };
    byDay[key].revenue += Number(s.contractValue || 0);
    byDay[key].count   += 1;
    byDay[key].reps.add(s.rep);
  }
  return Object.entries(byDay)
    .map(([date, agg]) => {
      const reps = agg.reps.size;
      const denom = Math.max(reps, 1);
      return {
        date,
        pra: (byMetric === 'count' ? agg.count : agg.revenue) / denom,
        revenue: agg.revenue,
        count: agg.count,
        reps,
      };
    })
    .filter(r => r.reps >= minReps)
    .sort((a, b) => b.pra - a.pra)
    .slice(0, n);
}

// PRA-season gate. Sales rows whose date is before May 1 (any year)
// don't count toward Best PRA Day records — RIDD's official knocking
// season starts then. Accepts "MM/DD/YYYY" or "MM/DD/YY" (the CSV's
// native format); returns true for anything we can't parse so we err on
// the side of including data rather than silently dropping it.
const PRA_SEASON_START_MONTH = 5; // May
function _isPraSeasonDay(dayKey) {
  if (!dayKey) return false;
  const parts = String(dayKey).split('/');
  if (parts.length < 2) return true;
  const m = Number(parts[0]);
  if (!Number.isFinite(m)) return true;
  return m >= PRA_SEASON_START_MONTH;
}

// Shared debounce timer for the rep-leaderboard search input. Lives at
// module scope because indicatorRepSections rebuilds the input per
// render — without this, each keystroke would have to chase its own
// timeout. Holding it here lets every fresh oninput cancel the previous
// pending render and schedule a new one ~150ms after the user pauses.
let _repLeaderboardSearchTimer = null;

// "Reportable cancel" gate. RIDD treats 3-day RORs (Right of Rescission)
// and Sold-Not-Started ("Sold, Not Started (No Initial)") as data we
// want to KEEP in the dataset (the Cancel Analysis card surfaces them
// for the analyst) but DON'T want counted as cancels anywhere else —
// they're not real post-service attrition, just paperwork churn /
// install failures. Every cancel count, cancel rate, and cancel drill
// outside Cancel Analysis should call _isReportableCancel(s) instead of
// the raw `(s.cancelDate || s.active === 'No')` predicate.
const _ROR_REASON_RE = /\b(ror|right\s*of\s*rescission|3[-\s]*day)/i;
// Combined subscriptions — the account was merged into another account, not
// lost. Matches "Combined", "Combined Subscriptions", "combined with #102084",
// etc. Not real attrition, so it never counts as a cancel.
const _COMBINED_REASON_RE = /combin/i;
// One-time services — the job ran its course and the subscription closed out.
// Matched by cancel reason ("One Time Service", "One-Time", "OTS") OR by the
// subscription name itself ("One Time Pest Control", "One Time Mosquito", …)
// because the CSV export often drops the cancel reason on these even when
// the CRM has it. A completed one-time job is not attrition — never a cancel.
const _ONETIME_REASON_RE = /\b(one[\s-]?time|ots)\b/i;
const _ONETIME_SUB_RE    = /^\s*one[\s-]?time/i;
// Renewals — the old subscription closes out because the customer renewed
// onto a new one. Matches "Renewal", "Renewed", "Renewal - Loyalty", etc.
// That's a kept customer, not attrition — never counts as a cancel.
const _RENEWAL_REASON_RE = /\brenew/i;
function _parseSlashDate(str) {
  if (!str) return null;
  const parts = String(str).split(' ')[0].split('/');
  if (parts.length !== 3) return null;
  let m = Number(parts[0]), d = Number(parts[1]), y = Number(parts[2]);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  return new Date(y, m - 1, d);
}
function _is3DayROR(s) {
  if (!s) return false;
  if (_ROR_REASON_RE.test(s.cancelReason || '')) return true;
  // Date-based fallback: cancel within 3 days of sale, regardless of
  // what's typed in the reason field — confirmed rule: a quick cancel is
  // ROR even when the reason is mistagged (those get cleaned up in
  // FieldRoutes instead).
  const sold   = _parseSlashDate(s.dateSold);
  const cancel = _parseSlashDate(s.cancelDate);
  if (!sold || !cancel) return false;
  const diff = Math.round((cancel.getTime() - sold.getTime()) / 86400000);
  return diff >= 0 && diff <= 3;
}
function _isCombinedSub(s) {
  return !!s && _COMBINED_REASON_RE.test(s.cancelReason || '');
}
function _isOneTimeCancel(s) {
  if (!s) return false;
  return _ONETIME_REASON_RE.test(s.cancelReason || '') || _ONETIME_SUB_RE.test(s.subscription || '');
}
function _isRenewalCancel(s) {
  return !!s && _RENEWAL_REASON_RE.test(s.cancelReason || '');
}
// Combined ROR + SNS + Combined-subscription + One-Time + Renewal check —
// the kinds of cancels we strip from reporting metrics (paperwork churn /
// install failures / account merges / completed one-time jobs / renewals
// onto a new subscription — none of it real attrition). Cancel Analysis
// intentionally bypasses this so the analyst can still see them.
// Cancel reasons the admin marked "doesn't count as attrition" in the shared
// Cancel Reasons config (Settings → Configurations). The SAME exclusions now
// apply to the indicators tab so the two reconcile. Cached on the config
// array's identity (rebuilt only when the config is edited).
let _indCancelReasonSet = null, _indCancelReasonSrc = null;
function _indConfigCancelExcluded(s) {
  const cfg = state.reportingCancelConfig || [];
  if (_indCancelReasonSrc !== cfg) {
    _indCancelReasonSrc = cfg;
    _indCancelReasonSet = new Set(cfg.filter(c => c.counts_attrition === false).map(c => _normCancelReason(c.reason)));
  }
  return _indCancelReasonSet.has(_normCancelReason((s && s.cancelReason) || ''));
}
// ── SAVE-BACK RULE (per Isaac, Aug 2026) ────────────────────────────────
// "If they're active, that trumps any cancel date logged." A subscription
// the retention desk saved keeps its FieldRoutes cancel date forever, but
// it is alive and being serviced - it is not attrition. Current status
// wins. Robust across formats: RevHawk sends active as "Active"/"Frozen",
// old CSVs sent "Yes"/"No"; some snapshots carry the live status under
// `status` instead.
function _subAliveNow(s) {
  const a = String(s.active || '').trim().toLowerCase();
  if (a === 'yes' || a === 'active') return true;
  if (a === 'no' || a === 'frozen' || a === 'inactive') return false;
  const st = String(s.status || '').trim().toLowerCase();
  if (st === 'active') return true;
  if (st === 'frozen' || st === 'inactive' || st === 'canceled' || st === 'cancelled') return false;
  return null;   // unknown format - callers fall back to the cancel date
}
function _subCancelledNow(s) {
  if (!s) return false;
  if (!(s.cancelDate || s.active === 'No')) return false;
  return _subAliveNow(s) !== true;   // save-back: alive now -> not a cancel
}
function _isExcludableCancel(s) {
  return _is3DayROR(s) || _isSoldNotStarted(s) || _isCombinedSub(s) || _isOneTimeCancel(s) || _isRenewalCancel(s) || _indConfigCancelExcluded(s);
}
// "Counts as a cancel for reporting purposes." Use in place of the
// `(s.cancelDate || s.active === 'No')` literal everywhere outside
// Cancel Analysis. ROR / SNS rows are still in the dataset; they just
// don't tally as cancels here.
function _isReportableCancel(s) {
  if (!s) return false;
  if (!_subCancelledNow(s)) return false;
  return !_isExcludableCancel(s);
}

// ── Rep Leaderboard ROR toggle ──────────────────────────────────────────
// One global toggle on the Rep Leaderboard header ("Count 3-Day RORs").
// When ON, 3-day ROR cancels count as cancels again on the leaderboard AND
// every rep player card opened from it. Sold-Not-Started and Combined-
// subscription rows stay excluded either way — those are never attrition.
// Persisted with the rest of the indicator settings (per browser).
function _repCancelExcluded(s) {
  // Three cancel kinds are governed by the leaderboard's "Cancel filters"
  // dropdown — each toggle OVERRIDES any "not attrition" config marking for
  // its kind, so flipping it actually moves Cancels / Cancel %:
  //   · 3-Day RORs        (cancel within 3 days of sale / ROR reason)
  //   · One-time services (the ~8 "One Time …" service types closing out)
  //   · Renewals          (the 4 "Renewal - …" closes onto a new subscription)
  // Sold-Not-Started and Combined-subscription rows are NEVER attrition and
  // stay excluded regardless.
  if (_is3DayROR(s)) return !state._indicatorRepIncludeRor;
  if (_isOneTimeCancel(s)) return !state._indicatorRepIncludeOneTime;
  if (_isRenewalCancel(s)) return !state._indicatorRepIncludeRenewals;
  if (_isSoldNotStarted(s) || _isCombinedSub(s) || _indConfigCancelExcluded(s)) return true;
  return false;
}
function _repCancelCounts(s) {
  if (!s) return false;
  if (!_subCancelledNow(s)) return false;
  return !_repCancelExcluded(s);
}

// Apples-to-apples week-over-week windows. Given an anchor Date — the
// latest sale day in the dataset — returns:
//   { thisStart, thisEnd, lastStart, lastEnd, daysElapsed }
// where `thisStart` is the Sunday of the anchor's week, `thisEnd` is
// midnight after the anchor (exclusive), and `lastStart` / `lastEnd`
// are the matching slice exactly 7 days earlier. This keeps a Wednesday
// upload from comparing 4 days of "this week" against 7 days of "last
// week" — both windows always cover the same elapsed days. Use this
// whenever a WoW trend signal is being computed; raw Sunday-to-Sunday
// week sums are wrong mid-week.
function _weekToDateWindows(anchor) {
  if (!anchor) return null;
  const thisStart = new Date(anchor);
  thisStart.setDate(thisStart.getDate() - thisStart.getDay());
  thisStart.setHours(0, 0, 0, 0);
  const thisEnd = new Date(anchor);
  thisEnd.setHours(0, 0, 0, 0);
  thisEnd.setDate(thisEnd.getDate() + 1); // exclusive — covers full anchor day
  const lastStart = new Date(thisStart); lastStart.setDate(lastStart.getDate() - 7);
  const lastEnd   = new Date(thisEnd);   lastEnd.setDate(lastEnd.getDate()   - 7);
  const daysElapsed = Math.round((thisEnd.getTime() - thisStart.getTime()) / 86400000);
  return { thisStart, thisEnd, lastStart, lastEnd, daysElapsed };
}

// Best PRA Day — the single day with the highest Per Rep Average at the
// given scope. PRA = (revenue or sales count) ÷ active reps, depending on
// `byMetric`. `minReps` filters out degenerate days (e.g., one rep selling
// alone where PRA = full revenue). Returns
// { date, pra, revenue, count, reps } or null. `pra` is in the active
// metric so callers can format it directly.
//
// PRA only considers days from PRA_SEASON_START_MONTH onward — RIDD's
// season begins May 1 each year, and earlier days have such sparse rep
// activity that the PRA spikes are misleading (one or two reps on a
// quiet April day produces a "record" that nobody actually competed
// against). Tweak PRA_SEASON_START_MONTH if the season ever shifts.
function bestPRADayRecord(sales, minReps = 1, byMetric = 'revenue') {
  const byDay = {};
  for (const s of sales) {
    if (!s.rep) continue;
    if (!_recordEligible(s)) continue;
    const key = (s.dateSold || '').split(' ')[0].trim();
    if (!key) continue;
    if (!_isPraSeasonDay(key)) continue;
    if (!byDay[key]) byDay[key] = { revenue: 0, count: 0, reps: new Set() };
    byDay[key].revenue += Number(s.contractValue || 0);
    byDay[key].count   += 1;
    byDay[key].reps.add(s.rep);
  }
  let best = null;
  for (const [date, agg] of Object.entries(byDay)) {
    const reps = agg.reps.size;
    if (reps < minReps) continue;
    const pra = (byMetric === 'count' ? agg.count : agg.revenue) / reps;
    const candidate = { date, pra, revenue: agg.revenue, count: agg.count, reps };
    if (!best || candidate.pra > best.pra) best = candidate;
  }
  return best;
}

// Snapshot per-rep + company records on each CSV upload. Future uploads
// diff against the most recent snapshot to fire "broken record"
// notifications. We strip any sales arrays so the snapshot stays compact
// for localStorage.
function captureIndicatorSnapshot() {
  const rawSales = indicatorSales();
  if (rawSales.length === 0) return;
  const byRep = {};
  for (const s of rawSales) {
    const rep = s.rep || 'Unknown';
    if (!byRep[rep]) byRep[rep] = [];
    byRep[rep].push(s);
  }
  const reps = {};
  for (const [name, sales] of Object.entries(byRep)) {
    const recs = aggregateRecords(sales);
    const trim = (r) => r ? { ...r, count: r.count, revenue: r.revenue } : null;
    reps[name] = {
      bestDay:   trim(recs.bestDay),
      bestWeek:  trim(recs.bestWeek),
      bestMonth: trim(recs.bestMonth),
    };
  }
  const company = aggregateRecords(rawSales);
  const snap = {
    uploadedAt: state.indicatorsUploadedAt || new Date().toISOString(),
    fileName:   state.indicatorsFileName || '',
    company:    { bestDay: company.bestDay, bestWeek: company.bestWeek, bestMonth: company.bestMonth },
    reps,
  };
  if (!Array.isArray(state._indicatorSnapshots)) state._indicatorSnapshots = [];
  // De-dupe back-to-back uploads with identical fileName + uploadedAt so a
  // re-upload of the same file doesn't bloat history.
  const last = state._indicatorSnapshots[state._indicatorSnapshots.length - 1];
  if (last && last.uploadedAt === snap.uploadedAt && last.fileName === snap.fileName) return;

  // "Records broken" notifications RETIRED. They were built for weekly CSV
  // uploads (complete data → meaningful diffs). With the 30-min RevHawk
  // auto-sync every snapshot is a partial-day picture, so the diff fired
  // false "record broken" alerts on every refresh. Live records + Hall of
  // Fame stay — they're computed from the full dataset, not from diffs.
  // (detectRecordBreaks kept below in case this returns post-season with
  // completed-period + audit-settled logic.)

  state._indicatorSnapshots.push(snap);
  // Cap snapshot history. Each snapshot stores per-rep best day / week
  // / month — for a 200-rep org that's ~50KB × N snapshots. 30 covers
  // ~6 months of weekly uploads, which is enough horizon for "records
  // broken since last upload" diffs without blowing localStorage quota.
  if (state._indicatorSnapshots.length > 30) {
    state._indicatorSnapshots = state._indicatorSnapshots.slice(-30);
  }
}

// Compare a prior snapshot against the current one and emit an audit-log
// entry per record-broken event. These ride on the same channel as audit
// status changes so the existing bell dropdown picks them up.
function detectRecordBreaks(prior, current) {
  const entries = [];
  const labelOf = (rec) => rec?.date || rec?.weekStart || rec?.month || '';
  const fmtMonthLabel = (m) => {
    if (!m) return '';
    const [y, mo] = m.split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };
  const periodLabel = (kind, dateStr) => {
    if (kind === 'bestDay')   return dateStr;
    if (kind === 'bestWeek')  return 'Week of ' + dateStr;
    if (kind === 'bestMonth') return fmtMonthLabel(dateStr);
    return dateStr;
  };
  const mkEntry = (scope, kind, old, cur) => ({
    id:           'rec-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    action:       'record_broken',
    timestamp:    current.uploadedAt,
    rep_name:     scope === '__company__' ? 'Company' : scope,
    is_company:   scope === '__company__',
    record_kind:  kind,
    period_label: periodLabel(kind, labelOf(cur)),
    old_revenue:  old?.revenue || 0,
    new_revenue:  cur.revenue,
    new_count:    cur.count,
  });

  // Per-rep breaks
  for (const [name, curReps] of Object.entries(current.reps || {})) {
    const oldReps = (prior.reps && prior.reps[name]) || {};
    for (const kind of ['bestDay', 'bestWeek', 'bestMonth']) {
      const cur = curReps[kind];
      const old = oldReps[kind];
      if (!cur || cur.revenue === 0) continue;
      if (!old || cur.revenue > old.revenue) entries.push(mkEntry(name, kind, old, cur));
    }
  }
  // Company-level breaks
  for (const kind of ['bestDay', 'bestWeek', 'bestMonth']) {
    const cur = current.company?.[kind];
    const old = prior.company?.[kind];
    if (!cur || cur.revenue === 0) continue;
    if (!old || cur.revenue > old.revenue) entries.push(mkEntry('__company__', kind, old, cur));
  }
  return entries;
}

// Build a high-level "what changed in this upload" report — driven by
// raw sales (this week vs last week) plus the snapshot history (broken
// records). Returns null if there's nothing useful to show; otherwise
// the openImportInsightsModal renderer expects this exact shape.
function computeImportInsights() {
  const rawSales = indicatorSales();
  if (rawSales.length === 0) return null;

  // Anchor everything to the latest sale date in the dataset so the
  // popup makes sense even if the upload happens days after the data.
  // _weekToDateWindows then clips "last week" to the same elapsed
  // days — a Wednesday-anchored window compares Sun–Wed against
  // Sun–Wed of the prior week, not Sun–Sat.
  let latest = null;
  for (const s of rawSales) {
    const d = _parseIndicatorDay(s);
    if (d && (!latest || d > latest)) latest = d;
  }
  if (!latest) return null;
  const w = _weekToDateWindows(latest);
  const { thisStart, thisEnd, lastStart, lastEnd, daysElapsed } = w;

  const inRange = (s, start, end) => {
    const d = _parseIndicatorDay(s);
    return d && d >= start && d < end;
  };
  const thisWeek = rawSales.filter(s => inRange(s, thisStart, thisEnd));
  const lastWeek = rawSales.filter(s => inRange(s, lastStart, lastEnd));

  // Group helper — sums revenue + sale count by an arbitrary key.
  const aggBy = (sales, keyFn) => {
    const out = {};
    for (const s of sales) {
      const k = keyFn(s);
      if (!k) continue;
      if (!out[k]) out[k] = { revenue: 0, count: 0 };
      out[k].revenue += Number(s.contractValue || 0);
      out[k].count++;
    }
    return out;
  };
  const thisByRep    = aggBy(thisWeek, s => s.rep);
  const lastByRep    = aggBy(lastWeek, s => s.rep);
  const thisByBranch = aggBy(thisWeek, s => s.office);
  const lastByBranch = aggBy(lastWeek, s => s.office);
  const thisByTeam   = aggBy(thisWeek, s => (typeof getRepTeam === 'function' ? getRepTeam(s.rep) : '') || 'Unassigned');
  const lastByTeam   = aggBy(lastWeek, s => (typeof getRepTeam === 'function' ? getRepTeam(s.rep) : '') || 'Unassigned');

  // Mover = (name, thisRev, lastRev, delta, pct). pct uses lastRev as
  // the denominator; new entries (no prior week) get Infinity so they
  // bubble to the top of the trending-up list but are clearly tagged.
  const movers = (thisM, lastM) => {
    const names = new Set([...Object.keys(thisM), ...Object.keys(lastM)]);
    const out = [];
    for (const name of names) {
      const tRev = thisM[name]?.revenue || 0;
      const lRev = lastM[name]?.revenue || 0;
      const tCnt = thisM[name]?.count   || 0;
      const lCnt = lastM[name]?.count   || 0;
      const delta = tRev - lRev;
      const pct = lRev > 0 ? delta / lRev : (tRev > 0 ? Infinity : 0);
      out.push({ name, thisRev: tRev, lastRev: lRev, thisCount: tCnt, lastCount: lCnt, delta, pct });
    }
    return out;
  };
  // Volume floor on movers keeps "1 sale → 2 sales = 100%!" noise out.
  const MIN_REV_FOR_REP_MOVER = 1000;
  const repMovers = movers(thisByRep, lastByRep);
  const trendingUp = repMovers
    .filter(m => m.thisRev >= MIN_REV_FOR_REP_MOVER && (m.pct > 0 || m.pct === Infinity))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);
  const trendingDown = repMovers
    .filter(m => m.lastRev >= MIN_REV_FOR_REP_MOVER && m.pct < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5);

  const branchMovers = movers(thisByBranch, lastByBranch).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  const teamMovers   = movers(thisByTeam,   lastByTeam  ).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);

  // Company totals
  const sumOf = (arr) => arr.reduce((acc, s) => { acc.revenue += Number(s.contractValue || 0); acc.count++; return acc; }, { revenue: 0, count: 0 });
  const cThis = sumOf(thisWeek), cLast = sumOf(lastWeek);
  const company = {
    thisRev: cThis.revenue,
    lastRev: cLast.revenue,
    thisCount: cThis.count,
    lastCount: cLast.count,
    delta: cThis.revenue - cLast.revenue,
    pct: cLast.revenue > 0 ? (cThis.revenue - cLast.revenue) / cLast.revenue : 0,
  };

  // YTD comparison — Jan 1 of latest's year through the anchor day,
  // matched against the same window in the prior year (so the manager
  // sees season-level pace, not just week-over-week noise). Same
  // apples-to-apples principle as _weekToDateWindows but stretched to
  // a calendar year. Will show as "no prior-year data" when the CSV
  // doesn't reach back that far, which is the honest answer.
  const ytdStart = new Date(latest.getFullYear(), 0, 1);
  const ytdEnd   = new Date(latest); ytdEnd.setHours(0, 0, 0, 0); ytdEnd.setDate(ytdEnd.getDate() + 1);
  const lyStart  = new Date(latest.getFullYear() - 1, 0, 1);
  const lyEnd    = new Date(latest); lyEnd.setHours(0, 0, 0, 0); lyEnd.setFullYear(lyEnd.getFullYear() - 1); lyEnd.setDate(lyEnd.getDate() + 1);
  const ytdSales = rawSales.filter(s => inRange(s, ytdStart, ytdEnd));
  const lySales  = rawSales.filter(s => inRange(s, lyStart,  lyEnd));
  const yThis = sumOf(ytdSales), yLast = sumOf(lySales);
  const ytd = {
    year:      latest.getFullYear(),
    thisRev:   yThis.revenue,
    lastRev:   yLast.revenue,
    thisCount: yThis.count,
    lastCount: yLast.count,
    delta:     yThis.revenue - yLast.revenue,
    pct:       yLast.revenue > 0 ? (yThis.revenue - yLast.revenue) / yLast.revenue : 0,
  };

  // ── Same-period YoY windows ───────────────────────────────────────────
  // Each current window matched against the IDENTICAL calendar dates one
  // year earlier — only meaningful now that uploads carry multi-year data.
  const shiftYear = (d) => { const x = new Date(d); x.setFullYear(x.getFullYear() - 1); return x; };
  const cmp = (curArr, prevArr) => {
    const a = sumOf(curArr), b = sumOf(prevArr);
    return { thisRev: a.revenue, lastRev: b.revenue, thisCount: a.count, lastCount: b.count,
             delta: a.revenue - b.revenue, pct: b.revenue > 0 ? (a.revenue - b.revenue) / b.revenue : 0 };
  };
  const mtdStart = new Date(latest.getFullYear(), latest.getMonth(), 1);
  const yoy = {
    week: cmp(thisWeek, rawSales.filter(s => inRange(s, shiftYear(thisStart), shiftYear(thisEnd)))),
    mtd:  cmp(rawSales.filter(s => inRange(s, mtdStart, ytdEnd)),
              rawSales.filter(s => inRange(s, shiftYear(mtdStart), shiftYear(ytdEnd)))),
    mtdLabel: latest.toLocaleDateString('en-US', { month: 'short' }),
  };

  // ── Reps Knocking — distinct DOOR-TO-DOOR reps with at least one sale
  // (serviced or not) in the trailing 14 days, anchored at the latest sale
  // in the dataset. Broken out by branch and by team.
  const knockStart = new Date(latest); knockStart.setHours(0, 0, 0, 0); knockStart.setDate(knockStart.getDate() - 13);
  const knockEnd   = new Date(latest); knockEnd.setHours(0, 0, 0, 0); knockEnd.setDate(knockEnd.getDate() + 1);
  const knockAll = new Set(), knockBranch = {}, knockTeam = {};
  for (const s of rawSales) {
    if (!s.rep) continue;
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    const d = _parseIndicatorDay(s);
    if (!d || d < knockStart || d >= knockEnd) continue;
    const rep = (typeof getCanonicalRepName === 'function') ? getCanonicalRepName(s.rep) : s.rep;
    knockAll.add(rep);
    const b = s.office || 'UNKNOWN';
    (knockBranch[b] = knockBranch[b] || new Set()).add(rep);
    const t = ((typeof getRepTeam === 'function') ? getRepTeam(rep) : '') || 'Unassigned';
    (knockTeam[t] = knockTeam[t] || new Set()).add(rep);
  }
  const knockSort = (m) => Object.entries(m).map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]);
  const repsKnocking = {
    total: knockAll.size,
    windowLabel: knockStart.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
      + '–' + new Date(knockEnd.getTime() - 86400000).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
    byBranch: knockSort(knockBranch),
    byTeam: knockSort(knockTeam),
  };

  // Revenue by calendar year — the all-time context strip.
  const yearTotals = {};
  for (const s of rawSales) {
    const d = _parseIndicatorDay(s); if (!d) continue;
    const y = d.getFullYear();
    if (!yearTotals[y]) yearTotals[y] = { revenue: 0, count: 0 };
    yearTotals[y].revenue += Number(s.contractValue || 0);
    yearTotals[y].count++;
  }

  // Branch YTD vs same period last year (mover-shaped so the modal can
  // reuse moverRow). Sorted biggest gain → biggest loss.
  const ytdByBranch = aggBy(ytdSales, s => s.office);
  const lyByBranch  = aggBy(lySales,  s => s.office);
  const branchYoY = movers(ytdByBranch, lyByBranch)
    .filter(m => m.thisRev > 0 || m.lastRev > 0)
    .sort((a, b) => b.delta - a.delta);

  // Personal records broken since last upload — diff the last two
  // snapshots (the current snapshot was just pushed by the upload, so
  // it lives at the tail; prior is the one before it).
  const snaps = state._indicatorSnapshots || [];
  const prev  = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
  const cur   = snaps.length >= 1 ? snaps[snaps.length - 1] : null;
  const newRecords = [];
  if (prev && cur) {
    const prevReps = prev.reps || {};
    const curReps  = cur.reps  || {};
    for (const [name, recs] of Object.entries(curReps)) {
      const old = prevReps[name] || {};
      for (const kind of ['bestDay', 'bestWeek', 'bestMonth']) {
        const newR = recs[kind];
        const oldR = old[kind];
        if (newR && newR.revenue > 0 && (!oldR || newR.revenue > (oldR.revenue || 0))) {
          newRecords.push({ rep: name, kind, newRev: newR.revenue, oldRev: oldR?.revenue || 0 });
        }
      }
    }
  }
  newRecords.sort((a, b) => b.newRev - a.newRev);

  // Single biggest contract written in the upload window — the kind
  // of number an admin notices on a leaderboard scroll. Limited to the
  // active week so it doesn't surface a year-old whale.
  let topSale = null;
  for (const s of thisWeek) {
    const v = Number(s.contractValue || 0);
    if (!topSale || v > Number(topSale.contractValue || 0)) topSale = s;
  }

  return {
    weekLabel: {
      thisStart: thisStart.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      thisEnd:   new Date(thisEnd.getTime() - 86400000).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      lastStart: lastStart.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      lastEnd:   new Date(lastEnd.getTime() - 86400000).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      daysElapsed,
    },
    company,
    ytd,
    yoy,
    yearTotals,
    repsKnocking,
    branchYoY,
    trendingUp,
    trendingDown,
    branchMovers,
    teamMovers,
    newRecords: newRecords.slice(0, 8),
    topSale,
    importedRows: rawSales.length,
    fileName: state.indicatorsFileName || '',
  };
}

// Modal that renders the output of computeImportInsights(). Auto-
// surfaced after every successful indicator upload so the manager
// sees the highlights without having to dig through pages.
function openImportInsightsModal(insights) {
  if (!insights) return;
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const modal = el('div', {
    class: 'card w-full max-w-3xl p-6 my-8 overflow-y-auto',
    style: { maxHeight: 'calc(100vh - 64px)' },
  });
  overlay.append(modal);

  const pctBadge = (pct, opts = {}) => {
    const v = pct === Infinity ? 'NEW' : ((pct >= 0 ? '+' : '') + (pct * 100).toFixed(0) + '%');
    const color = pct === Infinity ? '#DF643A' : (pct >= 0 ? '#DF643A' : '#DC2626');
    return el('span', {
      class: 'tabular-nums font-bold ' + (opts.big ? 'text-base' : 'text-xs'),
      style: { color },
    }, v);
  };
  const sectionHeader = (text, sub) => el('div', { class: 'flex items-baseline justify-between mb-2 mt-4 first:mt-0' },
    el('h3', { class: 'text-xs uppercase tracking-widest font-bold' }, text),
    sub && el('span', { class: 'text-[10px] text-muted-' }, sub),
  );
  const moverRow = (m, opts) => el('div', { class: 'flex items-center justify-between gap-3 py-1.5 border-t border-' },
    el('div', { class: 'flex items-center gap-2 min-w-0' },
      el('span', { class: 'font-semibold truncate' }, m.name),
      el('span', { class: 'text-[10px] text-muted- tabular-nums' },
        fmt.usd0(m.thisRev) + (m.lastRev > 0 ? ' vs ' + fmt.usd0(m.lastRev) : ' ' + ((opts && opts.newText) || '(new this week)'))),
    ),
    el('div', { class: 'flex items-center gap-2 shrink-0' },
      el('span', { class: 'text-[10px] text-muted- tabular-nums' },
        (m.delta >= 0 ? '+' : '') + fmt.usd0(m.delta)),
      pctBadge(m.pct),
    ),
  );

  // ── Header
  modal.append(
    el('div', { class: 'flex items-start justify-between gap-4 mb-4' },
      el('div', {},
        el('h2', { class: 'text-xl font-bold' }, '📊 Import Highlights'),
        el('div', { class: 'text-[11px] text-muted- mt-1' },
          insights.fileName + ' · ' + fmt.int(insights.importedRows) + ' rows · '
            + insights.weekLabel.thisStart + '–' + insights.weekLabel.thisEnd
            + ' vs ' + insights.weekLabel.lastStart + '–' + insights.weekLabel.lastEnd
            + ' · ' + insights.weekLabel.daysElapsed + ' day' + (insights.weekLabel.daysElapsed === 1 ? '' : 's') + ' each (apples-to-apples)'),
      ),
      el('button', {
        class: 'text-2xl leading-none -mr-1', style: { color: 'var(--text-muted)' },
        onclick: () => overlay.remove(),
      }, '×'),
    ),
  );

  // YoY context (the scoreboard table was removed; `y` is still used by
  // the Revenue-by-year strip and Branch YoY section below).
  const y = insights.ytd;

  // ── Reps Knocking — D2D reps with a sale in the trailing 2 weeks, with
  // branch + team breakdowns. One of the headline numbers of the popup.
  const rk = insights.repsKnocking;
  if (rk && rk.total > 0) {
    const tc = (s) => (s || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const knockTable = (title, rows, labelFmt) => el('div', {},
      el('div', { class: 'text-[9px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, title),
      el('table', { class: 'w-full', style: { borderCollapse: 'collapse' } },
        el('tbody', {},
          ...rows.map(([k, n], i) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'py-1 pr-2 text-[10px] tabular-nums', style: { color: 'var(--text-subtle)', width: '24px' } }, '#' + (i + 1)),
            el('td', { class: 'py-1 text-xs font-semibold' }, labelFmt(k)),
            el('td', { class: 'py-1 text-xs text-right tabular-nums font-bold' }, fmt.int(n)))))));
    modal.append(el('div', {
      class: 'rounded-lg border p-4 mb-3',
      style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' },
    },
      el('div', { class: 'flex items-baseline gap-3 flex-wrap mb-2' },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, '🚪 Reps Knocking'),
        el('div', { class: 'text-2xl font-bold tabular-nums' }, fmt.int(rk.total)),
        el('div', { class: 'text-[11px] text-muted-' },
          'D2D reps with a sale in the last 2 weeks (' + rk.windowLabel + ')'),
      ),
      el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3' },
        rk.byBranch.length > 0 ? knockTable('By Branch', rk.byBranch, tc) : el('span'),
        rk.byTeam.length > 0 ? knockTable('By Team', rk.byTeam, (t) => t) : el('span')),
    ));
  }

  // ── Branch YTD vs same period last year
  if ((insights.branchYoY || []).some(m => m.lastRev > 0)) {
    modal.append(el('div', { class: 'mb-2' },
      sectionHeader('Branches · YTD vs ' + (y.year - 1), 'same period both years'),
      el('div', {}, ...insights.branchYoY.slice(0, 8).map(m => moverRow(m, { newText: '(new this year)' })))));
  }

  // Branch Movers, Team Movers, and New Personal Records intentionally removed
  // from the rep-facing Import Highlights box.

  // ── Footer dismiss
  modal.append(
    el('div', { class: 'flex justify-end mt-5' },
      el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => overlay.remove(),
      }, 'Got it'),
    ),
  );

  document.body.append(overlay);
}

function computeIndicatorRecords(rep) {
  const sales = rep?.sales || [];
  const byDay = {}, byWeek = {}, byMonth = {};
  for (const s of sales) {
    const d = _parseIndicatorDay(s);
    if (!d) continue;
    const dayKey = (s.dateSold || '').split(' ')[0].trim();
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
    const weekKey = ws.toISOString().slice(0, 10);
    const monthKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const v = Number(s.contractValue || 0);
    if (!byDay[dayKey])     byDay[dayKey]     = { date: dayKey, count: 0, revenue: 0, sales: [] };
    if (!byWeek[weekKey])   byWeek[weekKey]   = { weekStart: weekKey, count: 0, revenue: 0, sales: [] };
    if (!byMonth[monthKey]) byMonth[monthKey] = { month: monthKey, count: 0, revenue: 0, sales: [] };
    byDay[dayKey].count++;     byDay[dayKey].revenue     += v; byDay[dayKey].sales.push(s);
    byWeek[weekKey].count++;   byWeek[weekKey].revenue   += v; byWeek[weekKey].sales.push(s);
    byMonth[monthKey].count++; byMonth[monthKey].revenue += v; byMonth[monthKey].sales.push(s);
  }
  const pick = (obj) => {
    const arr = Object.values(obj);
    if (!arr.length) return null;
    const best = arr.reduce((a, b) => b.revenue > a.revenue ? b : a);
    return Object.assign(best, _computeRecordMetrics(best.sales));
  };
  return { bestDay: pick(byDay), bestWeek: pick(byWeek), bestMonth: pick(byMonth) };
}

let _indTrendsCache = { rep: null, byOff: new Map() };
function computeIndicatorTrends(rep, weekOffset = 0) {
  // weekOffset pages the 12-week window back in time: 0 = the latest 12
  // weeks, 1 = the 12 before those, etc. weeksHasOlder tells the caller
  // whether another page exists so the ‹ arrow can disable at the edge.
  //
  // Memoized on the rep OBJECT's identity: the player card rebuilds
  // scopedRep once per render, then four blocks (trends / power hour /
  // heatmap / top subs) all call this — without the cache the entity
  // cards (an office or all of RIDD = tens of thousands of sales) did
  // the full multi-pass crunch 4× on every tap.
  if (_indTrendsCache.rep !== rep) { _indTrendsCache.rep = rep; _indTrendsCache.byOff.clear(); }
  const _memo = _indTrendsCache.byOff.get(weekOffset);
  if (_memo) return _memo;
  const sales = rep?.sales || [];
  // Weekly buckets — last 12 weeks ending at the rep's most recent sale week
  const byWeek = {};
  let maxDate = null;
  for (const s of sales) {
    const d = _parseIndicatorDay(s);
    if (!d) continue;
    if (!maxDate || d > maxDate) maxDate = d;
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
    const key = ws.toISOString().slice(0, 10);
    byWeek[key] = byWeek[key] || { weekStart: key, count: 0, revenue: 0 };
    byWeek[key].count++;
    byWeek[key].revenue += Number(s.contractValue || 0);
  }
  const weeks12 = [];
  let weeksHasOlder = false;
  if (maxDate) {
    const lastWs = new Date(maxDate); lastWs.setDate(lastWs.getDate() - lastWs.getDay() - weekOffset * 12 * 7);
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(lastWs); ws.setDate(ws.getDate() - i * 7);
      const key = ws.toISOString().slice(0, 10);
      weeks12.push(byWeek[key] || { weekStart: key, count: 0, revenue: 0 });
    }
    const firstKey = weeks12[0].weekStart;
    weeksHasOlder = Object.keys(byWeek).some(k => k < firstKey);
  }
  // Day of week — Sun..Sat
  const dow = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sales) {
    const d = _parseIndicatorDay(s);
    if (!d) continue;
    dow[d.getDay()]++;
  }
  // Power Hour — sales bucketed by hour of day. Track earliest/latest deal
  // times so we can show the rep's working window alongside the chart.
  // hoursRev tracks total contract value per hour so the tooltip can show
  // both volume (count) and dollars + ACV.
  const hours    = Array.from({ length: 24 }, () => 0);
  const hoursRev = Array.from({ length: 24 }, () => 0);
  let earliest = null, latest = null;
  for (const s of sales) {
    const t = _parseIndicatorTime(s);
    if (!t) continue;
    hours[t.hour]++;
    hoursRev[t.hour] += Number(s.contractValue || 0);
    const minOfDay = t.hour * 60 + t.minute;
    if (!earliest || minOfDay < earliest.minOfDay) earliest = { ...t, minOfDay, dateSold: s.dateSold };
    if (!latest   || minOfDay > latest.minOfDay)   latest   = { ...t, minOfDay, dateSold: s.dateSold };
  }
  // Auto-trim to the active hour range, but always show 8a → 11p so the
  // chart consistently spans the full sales window. Earlier sales (e.g.
  // 6am) extend the start; later sales (past 11pm) extend the end.
  let firstHour = 0, lastHour = 23;
  while (firstHour < 23 && hours[firstHour] === 0) firstHour++;
  while (lastHour > firstHour && hours[lastHour] === 0) lastHour--;
  if (hours.every(h => h === 0)) { firstHour = 8; lastHour = 23; }
  firstHour = Math.min(firstHour, 8);
  lastHour  = Math.max(lastHour, 23);
  const peakHour = hours.reduce((a, c, i) => c > hours[a] ? i : a, firstHour);
  // Day × Hour heatmap — Sun..Sat × 0..23. Each cell holds the sales count
  // and revenue for that day-of-week + hour combo. Pairs the existing Day
  // of Week and Power Hour charts into one grid that surfaces patterns
  // neither shows alone (e.g. "Tuesdays at 6p crush").
  const dayHourCount = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dayHourRev   = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const s of sales) {
    const d = _parseIndicatorDay(s);
    const t = _parseIndicatorTime(s);
    if (!d || !t) continue;
    dayHourCount[d.getDay()][t.hour]++;
    dayHourRev[d.getDay()][t.hour] += Number(s.contractValue || 0);
  }
  // Top subscriptions by count (with cancel rate)
  const subStats = {};
  for (const s of sales) {
    const sub = ((s.subscription || '').trim()) || 'Unknown';
    if (!subStats[sub]) subStats[sub] = { name: sub, count: 0, revenue: 0, cancels: 0 };
    subStats[sub].count++;
    subStats[sub].revenue += Number(s.contractValue || 0);
    if (_isReportableCancel(s)) subStats[sub].cancels++;
  }
  // All subs ranked by count — UI scrolls within a fixed height so the
  // visible list stays compact (~5 rows) but every subscription is reachable.
  const topSubs = Object.values(subStats).sort((a, b) => b.count - a.count);
  // Streaks — consecutive calendar days with at least one sale
  const dayKeys = [...new Set(sales.map(s => (s.dateSold || '').split(' ')[0].trim()).filter(Boolean))];
  const days = dayKeys.map(k => {
    const [m, d, y] = k.split('/').map(Number);
    const yy = y < 100 ? y + 2000 : y;
    return new Date(yy, m - 1, d);
  }).filter(d => Number.isFinite(d.getTime())).sort((a, b) => a - b);
  let longestStreak = days.length > 0 ? 1 : 0;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = Math.round((days[i] - days[i - 1]) / 86400000);
    if (diff === 1) { run++; if (run > longestStreak) longestStreak = run; }
    else if (diff > 1) { run = 1; }
  }
  // Current streak: count back from the most recent sale day
  let currentStreak = 0;
  if (days.length > 0) {
    currentStreak = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      const diff = Math.round((days[i + 1] - days[i]) / 86400000);
      if (diff === 1) currentStreak++;
      else break;
    }
  }
  const _out = { weeks12, weeksHasOlder, dow, hours, hoursRev, firstHour, lastHour, peakHour, earliest, latest, dayHourCount, dayHourRev, topSubs, currentStreak, longestStreak };
  _indTrendsCache.byOff.set(weekOffset, _out);
  return _out;
}

// ── Rep home-page layout prefs — PER DEVICE (view preference, not shared
// config): which sections show on the rep Indicators page, in what order,
// plus an optional personal default date range. ──
const REP_LAYOUT_KEY = 'ridd_rep_layout_v1';
const _repLayoutKeyForMe = () => REP_LAYOUT_KEY + '::' + ((state.profile && state.profile.id) || 'anon');
const REP_LAYOUT_SECTIONS = [
  ['card',  'My Player Card'],
  ['yoy',   'Your Performance Trends'],
  ['board', 'Leaderboard'],
  ['trend', 'Your Metric Trends'],
];
// Rep - Partner / Office Team Lead page order (per Isaac): player card
// pinned at top, then Indicators table + Power Ranking chart (fixed
// positions above the stack), then this stack DEFAULT order: Rep
// Leaderboard, Performance Trends, Metric Trends, 🏅 Records, 🎓 Class
// Metrics. Saved Customize orders still win on that device.
// Partner / lead order (per Isaac, Sep 2026): trends above the leaderboard,
// Sales Mix after it.
const PARTNER_LAYOUT_SECTIONS = [
  ['card',    'My Player Card'],
  ['yoy',     'Performance Trends'],
  ['board',   'Leaderboard'],
  ['mix',     'Sales Mix'],
  ['trend',   'Your Metric Trends'],
  ['records', 'Records'],
  ['class',   'Class Metrics'],
];
// (the 'class' key is quoted so the CI class-token scanner skips it)
const _REP_SECTION_PERM = { 'card': 'ind_card', 'yoy': 'ind_yoy', 'trend': 'ind_trend', 'board': 'ind_board', 'records': 'ind_records', 'class': 'ind_class', 'mix': 'ind_mix' };
const _repLayoutSections = () => {
  const partnerish = (typeof isPartnerRole === 'function' && isPartnerRole(state.profile?.role))
    || (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(state.profile?.role));
  const ordered = partnerish ? PARTNER_LAYOUT_SECTIONS
    : [...REP_LAYOUT_SECTIONS, ['records', 'Records'], ['class', 'Class Metrics']];
  return ordered.filter(([id]) => (typeof userCan !== 'function') || userCan(_REP_SECTION_PERM[id] || ''));
};
function _repLayoutPrefs() {
  try {
    // Per-user key first; fall back to the old shared-device key once.
    const p = JSON.parse(localStorage.getItem(_repLayoutKeyForMe()) || localStorage.getItem(REP_LAYOUT_KEY) || 'null');
    if (p && Array.isArray(p.order)) {
      // heal: every known section appears exactly once
      p.order = [...new Set([...p.order.filter(k => _repLayoutSections().some(([id]) => id === k)), ..._repLayoutSections().map(([id]) => id)])];
      // One-time: partner/lead layouts saved before Sep 2026 had the leaderboard above the trends — flip them to the new default once.
      if (!p._v2 && _repLayoutSections()[0] && _repLayoutSections().some(([id]) => id === 'mix')) { p.order = _repLayoutSections().map(([id]) => id).filter(k => p.order.includes(k) || true); p._v2 = true; }
      p.hidden = Array.isArray(p.hidden) ? p.hidden : [];
      return p;
    }
  } catch { /* fresh */ }
  return { order: _repLayoutSections().map(([id]) => id), hidden: [], dateDefault: '' };
}
function _saveRepLayoutPrefs(p) {
  try { localStorage.setItem(_repLayoutKeyForMe(), JSON.stringify(p)); } catch { /* private mode */ }
  if (typeof pushUserPrefsSoon === 'function') pushUserPrefsSoon();
}

// ── CROSS-DEVICE USER PREFS (user_prefs table, own-row RLS) ──────────────
// localStorage stays the fast cache; the server copy follows the user to any
// device (customize on the phone, see it on the laptop). Best-effort: until
// user_prefs.sql runs, everything silently degrades to per-device.
let _userPrefsPushTimer = null;
function _collectUserPrefs() {
  const uid = state.profile && state.profile.id;
  if (!uid) return null;
  const out = { repLayout: null, indPresets: null, viewLayouts: {} };
  try { out.repLayout = JSON.parse(localStorage.getItem(_repLayoutKeyForMe()) || 'null'); } catch (e) { /* skip */ }
  try { out.indPresets = JSON.parse(localStorage.getItem(_indPresetsKey()) || 'null'); } catch (e) { /* skip */ }
  try {
    const pre = 'ridd_layout_v1::' + uid + '::';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pre)) { try { out.viewLayouts[k.slice(pre.length)] = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e2) { /* skip */ } }
    }
  } catch (e) { /* skip */ }
  return out;
}
function pushUserPrefsSoon() {
  clearTimeout(_userPrefsPushTimer);
  _userPrefsPushTimer = setTimeout(() => { pushUserPrefsNow().catch(() => { /* degrade */ }); }, 1500);
}
async function pushUserPrefsNow() {
  if (typeof DEMO !== 'undefined' && DEMO) return;
  const uid = state.profile && state.profile.id;
  if (!uid) return;
  const prefs = _collectUserPrefs();
  if (!prefs) return;
  try { await supabase.from('user_prefs').upsert({ user_id: uid, prefs, updated_at: new Date().toISOString() }); }
  catch (e) { /* table may not exist yet — per-device until the SQL runs */ }
}
async function loadUserPrefs() {
  if (typeof DEMO !== 'undefined' && DEMO) return;
  const uid = state.profile && state.profile.id;
  if (!uid) return;
  try {
    const { data, error } = await supabase.from('user_prefs').select('prefs').eq('user_id', uid).maybeSingle();
    if (error || !data || !data.prefs) return;
    const p = data.prefs;
    // Server copy wins on load — every local edit pushes within ~2s, so the
    // server is the freshest cross-device truth.
    try { if (p.repLayout && Array.isArray(p.repLayout.order)) localStorage.setItem(_repLayoutKeyForMe(), JSON.stringify(p.repLayout)); } catch (e) { /* skip */ }
    try { if (Array.isArray(p.indPresets)) localStorage.setItem(_indPresetsKey(), JSON.stringify(p.indPresets)); } catch (e) { /* skip */ }
    try {
      if (p.viewLayouts && typeof p.viewLayouts === 'object') {
        const pre = 'ridd_layout_v1::' + uid + '::';
        for (const [view, v] of Object.entries(p.viewLayouts)) { if (v) localStorage.setItem(pre + view, JSON.stringify(v)); }
      }
    } catch (e) { /* skip */ }
    if (typeof scheduleBackgroundRemount === 'function') scheduleBackgroundRemount();
  } catch (e) { /* degrade to per-device */ }
}

// ✏️ Customize sheet — reorder / show-hide the rep page sections and pick a
// personal default date range. Edits apply LIVE (page re-renders behind the
// sheet); everything is per-device so reps can't affect each other.
function openRepCustomizeModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const card = el('div', { class: 'card w-full max-w-sm my-8 flex flex-col overflow-hidden', style: { maxHeight: 'calc(100vh - 64px)' } });
  overlay.append(card); document.body.append(overlay);
  const render = () => {
    const p = _repLayoutPrefs();
    card.innerHTML = '';
    const arrow = (glyph, disabled, onclick) => el('button', {
      class: 'w-7 h-7 rounded-lg border text-xs font-bold transition' + (disabled ? '' : ' hover:brightness-95 cursor-pointer'),
      style: { borderColor: 'var(--border-2)', color: disabled ? 'var(--text-subtle)' : 'var(--text)', opacity: disabled ? .4 : 1 },
      disabled, onclick: disabled ? undefined : onclick,
    }, glyph);
    const commit = (np) => { _saveRepLayoutPrefs(np); render(); mountApp(); };
    card.append(
      el('div', { class: 'px-5 py-3 flex items-center justify-between border-b', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('h2', { class: 'text-lg font-bold' }, '✏️ Customize My Page'),
          el('div', { class: 'text-[11px] text-muted- mt-0.5' }, 'Just for you, on this device.')),
        el('button', { class: 'text-xl leading-none text-muted-', style: { lineHeight: '1' }, onclick: () => overlay.remove() }, '×')),
      el('div', { class: 'p-4 flex flex-col gap-2 overflow-auto' },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Sections · order & visibility'),
        ...p.order.map((k, i) => {
          const label = (_repLayoutSections().find(([id]) => id === k) || [k, k])[1];
          const hidden = p.hidden.includes(k);
          return el('div', { class: 'flex items-center gap-2 rounded-lg border px-3 py-2', style: { borderColor: 'var(--border)', background: hidden ? 'transparent' : 'var(--card-2)', opacity: hidden ? .55 : 1 } },
            arrow('▲', i === 0, () => { const o = [...p.order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; commit({ ...p, order: o }); }),
            arrow('▼', i === p.order.length - 1, () => { const o = [...p.order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; commit({ ...p, order: o }); }),
            el('span', { class: 'text-sm font-semibold flex-1 min-w-0 truncate' }, label),
            el('button', {
              class: 'text-[11px] font-bold px-2.5 py-1 rounded-lg border transition hover:brightness-95',
              style: hidden ? { borderColor: 'var(--border-2)', color: 'var(--text-muted)' } : { borderColor: 'var(--accent)', color: 'var(--accent)' },
              onclick: () => {
                const nh = hidden ? p.hidden.filter(x => x !== k) : [...p.hidden, k];
                if (nh.length >= p.order.length) { toast('Keep at least one section visible', 'warn'); return; }
                commit({ ...p, hidden: nh });
              },
            }, hidden ? 'Hidden' : 'Shown'));
        }),
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mt-2', style: { color: 'var(--text-subtle)' } }, 'My default date range'),
        el('select', {
          class: 'rounded-xl px-2.5 py-1 text-[11px] font-medium cursor-pointer w-full',
          onchange: (e) => {
            const v = e.target.value;
            const np = { ..._repLayoutPrefs(), dateDefault: v };
            _saveRepLayoutPrefs(np);
            if (v) { state.indicatorsRangePreset = v; }
            mountApp();
          },
        },
          el('option', { value: '', selected: !p.dateDefault }, 'App default (This Year)'),
          ...INDICATOR_RANGE_PRESETS.filter(x => x.id !== 'custom').map(x =>
            el('option', { value: x.id, selected: p.dateDefault === x.id }, x.label))),
        el('button', {
          class: 'mt-2 rounded-xl px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95',
          style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
          onclick: () => { try { localStorage.removeItem(REP_LAYOUT_KEY); } catch { } state._repDateDefaultApplied = false; render(); mountApp(); },
        }, '↺ Reset to default layout')));
  };
  render();
}

// Modal player card — opened from the Indicators rep-leaderboard row click.
// Mirrors the dashboard's openRepProfileModal layout (avatar/header, stats
// grid, records strip) but works off the raw-CSV-derived rep object and
// preserves the full drill-down behavior the inline section had.
// ── "Who am I in the CRM?" — ONE resolver for every rep-facing self filter
// (player card, leaderboard pin, weekly recap, YoY chart, D2D boards, Kobe,
// trend default). ID-FIRST: the fieldroutes_employee_id link (+ its merged
// master-ID group) beats name matching, then exact name signature, then
// squeezed signatures (spelling variants). Fixes the "profile says Michael
// Torres, CRM says Torres, Mike → empty app" class: linking a profile in
// Users now fixes the rep's whole experience, not just Commission.
let _myRepNamesCache = { src: null, pid: null, emp: null, set: null };
function myRepNameSet() {
  const prof = state.profile;
  if (!prof) return new Set();
  const src = state._indicatorRawSales || [];
  const emp = String(prof.fieldroutes_employee_id || '').trim();
  const c = _myRepNamesCache;
  if (c.src === src && c.pid === prof.id && c.emp === emp && c.set) return c.set;
  const _s = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const set = new Set();
  const mySig = _s(prof.full_name);
  const squeeze = (typeof _nameSqueezeSigs === 'function' && prof.full_name) ? new Set(_nameSqueezeSigs(prof.full_name)) : new Set();
  let masterOf = null;
  try { masterOf = _frMasterMaps().map; } catch (e) { masterOf = null; }
  const myMaster = (emp && masterOf) ? (masterOf.get(emp) || emp) : emp;
  // Unique canonical names first (few hundred), not per-row work (100k+).
  const uniq = new Map();
  for (const s of src) {
    if (!s || !s.rep) continue;
    const canon = getCanonicalRepName(s.rep);
    let ids = uniq.get(canon);
    if (!ids) uniq.set(canon, ids = new Set());
    const id = String(s.repId || '').trim();
    if (id) ids.add(id);
  }
  for (const [canon, ids] of uniq) {
    let hit = false;
    if (emp) for (const id of ids) {
      if (id === emp || (masterOf && (masterOf.get(id) || id) === myMaster)) { hit = true; break; }
    }
    if (!hit && mySig && _s(canon) === mySig) hit = true;
    if (!hit && squeeze.size && typeof _nameSqueezeSigs === 'function') {
      for (const sg of _nameSqueezeSigs(canon)) if (squeeze.has(sg)) { hit = true; break; }
    }
    if (hit) set.add(canon);
  }
  _myRepNamesCache = { src, pid: prof.id, emp, set };
  return set;
}
// Row/board-level: is this rep name mine? (canonicalizes internally)
const isMyRepName = (name) => !!name && myRepNameSet().has(getCanonicalRepName(name));

// ── Rep-detail visibility — one gate for player cards + record expansions.
// Admin: anyone. Self: always. Rep - Partner: also reps on THEIR OWN team.
// Everyone else: self only.
// App profile behind a dataset rep name (name signature match) — gives the
// player card its real profile photo and the rep's department.
function profileForRepName(repName) {
  const sig = _repTypeNameSig(typeof getCanonicalRepName === 'function' ? getCanonicalRepName(repName) : repName);
  if (!sig) return null;
  return (state.allProfiles || []).find(p => _repTypeNameSig(p.full_name) === sig) || null;
}
function canViewRepDetails(repName, repTeam) {
  const me = state.profile;
  if (!me) return false;
  if (isAdminRole(me.role)) return true;
  // Team leads (per Isaac): every card in their OWN department — an
  // Inside Sales lead reaches Inside Sales agents, a Loyalty lead reaches
  // Loyalty agents. Office-staff names without an app profile count as
  // the lead's department only when the viewer is Inside Sales.
  if (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(me.role)) {
    const target = profileForRepName(repName);
    if (target) return isOfficeStaffProfile(target) && scorecardDeptOf(target) === scorecardDeptOf(me);
    try {
      const t = (state._indicatorRepTypeBySig || {})[_repTypeNameSig(getCanonicalRepName(repName))];
      if (t && /office\s*staff/i.test(t)) return scorecardDeptOf(me) === 'inside_sales';
    } catch (e) { /* fall through */ }
  }
  const _sigG = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  // Self is ALWAYS viewable, whatever the configured reach.
  if (_sigG(repName) === _sigG(me.full_name) || isMyRepName(repName)) return true;
  // Reach comes from Settings → Permissions now (defaults preserve the old
  // hardcoded rules: partners/team leads = own team, office leads = the
  // call center, everyone else = self only).
  const scope = userScope('drill_scope');
  if (scope === 'all') return true;
  if (scope === 'dept') {
    // Same department as the viewer: office-staff viewers reach office
    // staff; D2D viewers reach non-office (their world).
    try {
      const t = (state._indicatorRepTypeBySig || {})[_repTypeNameSig(getCanonicalRepName(repName))];
      const targetIsOffice = !!(t && /office\s*staff/i.test(t));
      return isOfficeStaffProfile(me) ? targetIsOffice : !targetIsOffice;
    } catch (e) { return false; }
  }
  if (scope === 'team' && typeof getRepTeam === 'function') {
    // Viewer's reach: the teams they lead (Settings → Users → Teams led)
    // plus their own Manage Teams assignment.
    const mine = myReachTeams();
    const theirTeam = repTeam || getRepTeam(repName) || (typeof getCanonicalRepName === 'function' ? getRepTeam(getCanonicalRepName(repName)) : '');
    return !!(theirTeam && mine.has(theirTeam));
  }
  return false;   // 'self' / 'none' — self was already allowed above
}
// Popover helper: cards use overflow-hidden / scroll-x, which clips an
// absolutely-positioned dropdown (the rep pickers were getting cut off after
// two rows). Fix by pinning the panel to the viewport under its button once
// it's in the DOM; re-pinned on scroll/resize while it's open.
function _anchorPopover(panel, btn, align = 'left') {
  panel.style.position = 'fixed';
  panel.style.zIndex = '1000';
  const place = () => {
    if (!panel.isConnected) { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); return; }
    const r = btn.getBoundingClientRect();
    const w = panel.offsetWidth || 260;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    panel.style.left = left + 'px';
    panel.style.top = (r.bottom + 6) + 'px';
    panel.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 16) + 'px';
    panel.style.overflowY = 'auto';
  };
  requestAnimationFrame(place);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
}
// A combined (Total / RIDD) card is viewable when EVERY rep it rolls up is
// viewable by this user — so a partner who filtered the board down to their
// own team (or a preset of their reps) can open the Total card with the
// sales + retention views, while a company-wide Total stays admin-only.
function canViewAggregate(reps) {
  const list = (reps || []).filter(r => r && r.name);
  if (!list.length) return false;
  return list.every(r => canViewRepDetails(r.name, r.team));
}
function openIndicatorRepCard(rep, allReps = []) {
  if (!rep) return;
  // PRIVACY GATE — admin: anyone · self: always · Rep - Partner: their own
  // team's reps too (they manage them) · everyone else: self only. The
  // leaderboard still shows headline numbers for all; the full card
  // (accounts, drill-downs, retention) is what's gated. Aggregates pass
  // when every member rep does (rep._members set by the Total rows).
  // Per Isaac: any rep may open another agent's card and read the SALES
  // view; the Retention toggle (audits, attrition, account drill) needs
  // full access — admin, own card, or a lead inside their department.
  const fullAccess = Array.isArray(rep._members) ? canViewAggregate(rep._members) : canViewRepDetails(rep.name, rep.team);
  // Per Isaac (Sep 2026): outside the viewer's reach the card doesn't open
  // at all — a sales rep sees the leaderboard numbers, not other reps' cards.
  if (!fullAccess) { try { toast('You can open your own player card here — other reps\u2019 cards are for leads and admins.', 'info'); } catch (e) { /* pre-boot */ } return; }
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const modal = el('div', {
    class: 'card w-full max-w-5xl p-6 my-8 overflow-y-auto',
    style: { maxHeight: 'calc(100vh - 64px)' },
  });
  overlay.append(modal);

  // Avg Pest Initial mirrors the leaderboard / D2D-comp formula: exclude
  // termite (Sentricon) and pure-spray packages (German Roach, Interior
  // Flea) from the average so the figure reflects door-knocked pest
  // sales, not maintenance work that comes in at a different price tier.
  const REP_AVG_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;

  // Drill state — local to this modal instance
  let drillKey = null, drillSub = null;
  let recordsLeaderKey = null;       // 'bestDay' | 'bestWeek' | 'bestMonth' | null
  let recordsLeaderExpanded = null;  // name of the rep whose accounts are expanded inline
  let cardScope = 'ytd';             // CARD_SCOPE_PRESETS id — scopes ALL stats/charts in this card (YTD default)
  let _trendWkOff = 0;               // 12-week trend paging (0 = latest window)
  let cardView = 'sales';            // 'sales' | 'retention' — retention mirrors the Auditing player card
  let retDrill = null;               // retention tile drill { label, pred }
  const isAutoPayOn = (s) => s.autoPay && s.autoPay !== 'No' && String(s.autoPay).trim() !== '';

  // Scoped views — recomputed on every render via applyScope() so the
  // scope dropdown can change them without re-opening the modal. Other
  // blocks read from scopedRep / scopedAllRepRecords / scopedStats.
  let scopedRep = rep;
  let scopedAllRepRecords = (allReps && allReps.length > 0)
    ? allReps.map(r => ({ name: r.name, recs: computeIndicatorRecords(r) }))
    : [];
  let scopedStats = [];
  function applyScope() {
    const bounds = getCardScopeBounds(cardScope);
    const filterFn = bounds
      ? (s) => { const d = _parseIndicatorDay(s); return d && d >= bounds.start && d <= bounds.end; }
      : null;
    scopedRep = _scopeRep(rep, filterFn);
    scopedAllRepRecords = (allReps && allReps.length > 0)
      ? allReps.map(r => {
          const sr = _scopeRep(r, filterFn);
          return { name: r.name, recs: computeIndicatorRecords(sr) };
        })
      : [];
    const count = scopedRep.sales?.length || 0;
    const acv = count > 0 ? scopedRep.revenue / count : 0;
    const ctTotal = (scopedRep.twelve || 0) + (scopedRep.multi || 0);
    const myPct = ctTotal > 0 ? scopedRep.multi / ctTotal : 0;
    const autoPayPct = count > 0 ? (scopedRep.autoPay || 0) / count : 0;
    // Avg Initial: simple mean of every sale's initialPrice.
    // Avg Pest Initial: same mean but with Sentricon / German Roach /
    // Interior Flea filtered out (mirrors the comp + leaderboard).
    const allSales      = scopedRep.sales || [];
    const pestEligible  = allSales.filter(s => !REP_AVG_PEST_EXCLUDE.test(s.subscription || ''));
    const avgInitial    = allSales.length     > 0 ? allSales.reduce((a, s) => a + Number(s.initialPrice || 0), 0)    / allSales.length     : 0;
    const avgPest       = pestEligible.length > 0 ? pestEligible.reduce((a, s) => a + Number(s.initialPrice || 0), 0) / pestEligible.length : 0;
    // Personal PRA — denominators are SELLING days (days with ≥1 sale), so
    // days off don't drag the averages down.
    const sellDays = new Set(allSales.map(s => dateSoldToIso(s.dateSold)).filter(Boolean)).size;
    scopedStats = [
      { key: 'sales',      label: 'Sales',      value: fmt.int(count) },
      { key: 'revenue',    label: 'Revenue',    value: fmt.usd0(scopedRep.revenue || 0) },
      { key: 'revPerDay',  label: 'Production/Day',
        value: sellDays > 0 ? fmt.usd0((scopedRep.revenue || 0) / sellDays) + ' / ' + Math.round(count / sellDays) : '—' },   // whole accounts/day — decimals clipped the tile (per Isaac)
      { key: 'acv',        label: 'ACV',        value: fmt.usd(acv) },
      // Sales Rep dept → Avg Pest Initial (excludes Sentricon / German Roach /
      // Interior Flea). Office Staff, Technician, and All → plain Avg Initial.
      (state.indicatorDept === 'd2d'
        ? { key: 'avgPest',    label: 'Avg Pest', value: avgPest    > 0 ? fmt.usd(avgPest)    : '—' }
        : { key: 'avgInitial', label: 'Avg Initial',      value: avgInitial > 0 ? fmt.usd(avgInitial) : '—' }),
      { key: 'myPct',      label: 'MY %',       value: (myPct * 100).toFixed(1) + '%' },
      { key: 'autoPay',    label: 'Auto Pay',   value: (autoPayPct * 100).toFixed(1) + '%' },
      { key: 'cancels',    label: 'Cancels',    value: fmt.int(scopedRep.cancels || 0) },
    ];
  }

  // (stats are computed per-render inside applyScope() so the scope filter
  // can update them — see scopedStats above)

  const drillSubs = {
    autoPay: [
      { id: null,  label: 'All' },
      { id: 'on',  label: 'On Auto Pay' },
      { id: 'off', label: 'Not on Auto Pay' },
    ],
    myPct: [
      { id: null,    label: 'All Contracts' },
      { id: 'multi', label: 'Multi-Year (18+ mo)' },
      { id: '12mo',  label: '12-Month' },
      { id: 'other', label: 'Other' },
    ],
  };

  function buildDrillSales() {
    const all = scopedRep.sales || [];
    switch (drillKey) {
      case 'revenue':
        return all.slice().sort((a, b) => Number(b.contractValue || 0) - Number(a.contractValue || 0));
      case 'acv':
        return all.slice().sort((a, b) =>
          ((Number(b.initialPrice || 0)) + (Number(b.recurring || 0)) * 11) -
          ((Number(a.initialPrice || 0)) + (Number(a.recurring || 0)) * 11));
      case 'avgInitial':
        // Every sale contributes to the average; sort by initial so the
        // user sees the high-end pricing that's pulling the figure up.
        return all.slice().sort((a, b) => Number(b.initialPrice || 0) - Number(a.initialPrice || 0));
      case 'avgPest':
        // Same as Avg Init but drop Sentricon / German Roach / Interior
        // Flea so the drill matches the stat card's filtered formula.
        return all.filter(s => !REP_AVG_PEST_EXCLUDE.test(s.subscription || ''))
          .sort((a, b) => Number(b.initialPrice || 0) - Number(a.initialPrice || 0));
      case 'myPct':
        // Multi-year = anything ≥18mo (includes 36/60mo). All Contracts =
        // 12mo + multi-year. Other surfaces sales that don't fit either
        // bucket — missing contract length, 6mo, 13–17mo, etc. — so the
        // numbers always reconcile with the headline Sales count.
        return all.filter(s => {
          const _b = myBucketOf(s);
          if (drillSub === '12mo')  return _b === 'twelve';
          if (drillSub === 'multi') return _b === 'multi';
          if (drillSub === 'other') return _b === null;
          return _b !== null;
        }).sort((a, b) => (b.dateSold || '').localeCompare(a.dateSold || ''));
      case 'autoPay':
        return all.filter(s => {
          const on = isAutoPayOn(s);
          if (drillSub === 'on')  return on;
          if (drillSub === 'off') return !on;
          return true;
        }).sort((a, b) => (b.dateSold || '').localeCompare(a.dateSold || ''));
      case 'cancels':
        // Follows the leaderboard's ROR toggle: RORs show here when the
        // toggle is on; Sold-Not-Started / Combined rows never do. They
        // all live in the dataset for Cancel Analysis either way.
        return all.filter(_repCancelCounts)
          .sort((a, b) => (b.cancelDate || '').localeCompare(a.cancelDate || ''));
      case 'sales':
      default:
        return all.slice().sort((a, b) => (b.dateSold || '').localeCompare(a.dateSold || ''));
    }
  }

  function exportDrillCsv(drillSales) {
    if (drillSales.length === 0) return toast('Nothing to export', 'warn');
    const headers = ['customer','customer_id','subscription','sold_date','contract_months','initial','contract_value','recurring','auto_pay','status','cancel_date','cancel_reason'];
    const lines = [headers.join(',')];
    drillSales.forEach(s => lines.push([
      csvEsc(s.customer || ''),
      csvEsc(s.customerId || ''),
      csvEsc(s.subscription || ''),
      csvEsc(s.dateSold || ''),
      s.contract || '',
      Number(s.initialPrice || 0).toFixed(2),
      Number(s.contractValue || 0).toFixed(2),
      Number(s.recurring || 0).toFixed(2),
      csvEsc(s.autoPay || ''),
      csvEsc(s.status || ''),
      csvEsc(s.cancelDate || ''),
      csvEsc(s.cancelReason || ''),
    ].join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const subTag = drillSub ? '-' + drillSub : '';
    const a = el('a', { href: url, download: `ridd-${rep.name.replace(/\s+/g, '-')}-${drillKey}${subTag}-${new Date().toISOString().slice(0,10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Exported ' + drillSales.length + ' account' + (drillSales.length === 1 ? '' : 's'), 'success');
  }

  // ── Sub-renderers ───────────────────────────────────────────────────────
  function statsGrid() {
    // auto-fit grid: 9 tiles flow 3-up on phones and up to 9-up on wide
    // desktops without needing a grid-cols-9 utility in the static CSS.
    return el('div', { class: 'grid gap-2 sm:gap-3 mb-5', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))' } },
      ...scopedStats.map(stat => {
        const selected = drillKey === stat.key;
        return el('div', {
          class: 'rounded-lg border p-3 text-center cursor-pointer transition hover:brightness-95',
          style: selected
            ? { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.12)', boxShadow: '0 0 0 1px var(--accent)' }
            : { borderColor: 'var(--border)', background: 'var(--card-2)' },
          onclick: () => {
            drillKey = selected ? null : stat.key;
            drillSub = null;
            renderBody();
          },
        },
          el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold whitespace-nowrap' }, stat.label),
          // Font scales down with value length so long figures (entity cards
          // pool big revenue + Production/Day pairs) never clip in the tile.
          el('div', {
            class: (String(stat.value).length > 12 ? 'text-xs' : String(stat.value).length > 9 ? 'text-base' : 'text-lg')
              + ' font-bold tabular-nums mt-1 whitespace-nowrap',
          }, stat.value),
        );
      }),
    );
  }

  // ── Selling-days calendar ────────────────────────────────────────────────
  // A real month calendar, defaulting to the CURRENT month, with ‹ › arrows.
  // Each day is shaded by accounts sold that day (tooltip: count + revenue),
  // so "Days w/ a Sale" is verifiable at a glance. Bounded to the dataset's
  // 3-year window; can't navigate into the future.
  let _calY = new Date().getFullYear();
  let _calM = new Date().getMonth();
  let _acctSort = { key: 'sold', dir: 'desc' };   // accounts-table sort (click headers)
  let _calMode = 'calendar';          // 'calendar' | 'clock' — one card, two views
  let _calDrillIso = null;            // tapped day → inline account list
  const _whenToggle = () => el('div', { class: 'inline-flex rounded-lg border overflow-hidden shrink-0', style: { borderColor: 'var(--border-2)' } },
    ...[['calendar', '📅 Calendar'], ['clock', '🕐 Time of day']].map(([m, label]) => el('button', {
      class: 'px-2.5 py-1 text-[10px] font-bold transition cursor-pointer',
      style: _calMode === m ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)', background: 'var(--card)' },
      onclick: () => { if (_calMode !== m) { _calMode = m; _calDrillIso = null; renderBody(); } },
    }, label)));
  function sellDaysCalendarBlock() {
    try {
      const byDay = new Map();   // iso → { n, rev }
      for (const sale of (scopedRep.sales || [])) {
        const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(sale.dateSold) : '';
        if (!iso) continue;
        const rec = byDay.get(iso) || { n: 0, rev: 0 };
        rec.n += 1; rec.rev += Number(sale.contractValue) || 0;
        byDay.set(iso, rec);
      }
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const minY = now.getFullYear() - 2;
      const atMin = _calY === minY && _calM === 0;
      const atMax = _calY === now.getFullYear() && _calM === now.getMonth();
      const nav = (dir) => {
        let m = _calM + dir, y = _calY;
        if (m < 0) { m = 11; y--; }
        if (m > 11) { m = 0; y++; }
        if (y < minY || (y === now.getFullYear() && m > now.getMonth()) || y > now.getFullYear()) return;
        _calY = y; _calM = m; renderBody();
      };
      const first = new Date(_calY, _calM, 1);
      const daysInMonth = new Date(_calY, _calM + 1, 0).getDate();
      // month stats + shade scale relative to the rep's best day THIS month
      let monthDays = 0, monthAccts = 0, monthRev = 0, maxN = 1;
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = _calY + '-' + String(_calM + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const rec = byDay.get(iso);
        if (rec) { monthDays++; monthAccts += rec.n; monthRev += rec.rev; if (rec.n > maxN) maxN = rec.n; }
      }
      const shade = (n) => 'rgba(223,100,58,' + Math.min(1, 0.3 + 0.7 * (n / maxN)).toFixed(2) + ')';
      const arrow = (dir, disabled) => el('button', {
        class: 'rounded-lg border font-bold cursor-pointer transition hover:brightness-95',
        style: { width: '26px', height: '26px', lineHeight: '1', borderColor: 'var(--border-2)',
                 color: disabled ? 'var(--text-subtle)' : 'var(--text)', opacity: disabled ? '.4' : '1',
                 cursor: disabled ? 'default' : 'pointer', background: 'var(--card)' },
        onclick: () => { if (!disabled) nav(dir); },
      }, dir < 0 ? '‹' : '›');
      const cells = [];
      for (let i = 0; i < first.getDay(); i++) cells.push(el('div', {}));   // leading blanks
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(_calY, _calM, d);
        const iso = _calY + '-' + String(_calM + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const rec = byDay.get(iso);
        const future = day > now;
        const isToday = day.getTime() === now.getTime();
        const selected = _calDrillIso === iso;
        cells.push(el('div', {
          class: 'flex items-center justify-center tabular-nums' + (rec ? ' font-bold' : ''),
          title: day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            + (rec ? ' — ' + rec.n + ' account' + (rec.n === 1 ? '' : 's') + ' · $' + Math.round(rec.rev).toLocaleString() + ' · tap for the accounts' : (future ? '' : ' — no sale')),
          onclick: rec ? (() => { _calDrillIso = selected ? null : iso; renderBody(); }) : undefined,
          style: {
            height: 'clamp(30px, 7vw, 40px)', borderRadius: '0', fontSize: '12px',
            background: rec ? shade(rec.n) : 'var(--card)',
            color: rec ? '#3A1D12' : (future ? 'var(--text-subtle)' : 'var(--text-muted)'),
            border: selected ? '2px solid var(--text)' : (isToday ? '2px solid var(--accent)' : '1px solid var(--border)'),
            opacity: future ? '.45' : '1',
            cursor: rec ? 'pointer' : 'default',
          },
        }, String(d)));
      }
      return el('div', { class: 'rounded-lg border p-4 mb-5', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
        // Toggle pinned top-right beside the month nav (it used to wrap
        // under the stats line on mobile); the month stats get their own
        // line below.
        el('div', { class: 'flex items-center justify-between gap-2 mb-1.5 flex-wrap' },
          el('div', { class: 'flex items-center gap-2' },
            arrow(-1, atMin),
            el('div', { class: 'text-sm font-bold', style: { minWidth: '110px', textAlign: 'center' } },
              first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })),
            arrow(1, atMax)),
          _whenToggle()),
        el('div', { class: 'text-[11px] font-bold mb-2.5' },
          monthDays + ' day' + (monthDays === 1 ? '' : 's') + ' w/ a sale',
          el('span', { class: 'font-normal', style: { color: 'var(--text-muted)' } },
            monthAccts ? ' · ' + monthAccts + ' accts · $' + Math.round(monthRev).toLocaleString() : '')),
        el('div', { class: 'grid grid-cols-7 gap-1' },
          ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => el('div', { class: 'text-[9px] text-muted- font-semibold text-center' }, d)),
          ...cells),
        // Tapped day → the receipts: every account sold that day.
        _calDrillIso && (() => {
          const daySales = (scopedRep.sales || []).filter(x =>
            (typeof dateSoldToIso === 'function' ? dateSoldToIso(x.dateSold) : '') === _calDrillIso)
            .sort((a, b) => (Number(b.contractValue) || 0) - (Number(a.contractValue) || 0));
          if (!daySales.length) return null;
          const dTitle = new Date(_calDrillIso + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          return el('div', { class: 'mt-3 pt-3 border-t', style: { borderColor: 'var(--border)' } },
            el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-1.5', style: { color: 'var(--text-muted)' } },
              dTitle + ' — ' + daySales.length + ' account' + (daySales.length === 1 ? '' : 's')),
            ...daySales.map(x => {
              // Audit chip: Passed / No Audit → green, Failed → red, else Pending.
              const _fl = x.customerFlags || '';
              const _audit = SC_FAIL_RE.test(_fl) ? ['Failed', '#DC2626', 'rgba(220,38,38,.12)']
                : SC_PASS_RE.test(_fl) ? ['Passed', '#DF643A', 'rgba(223,100,58,.18)']
                : SC_NOAUDIT_RE.test(_fl) ? ['No Audit', '#DF643A', 'rgba(223,100,58,.14)']
                : ['Pending', '#A9441F', 'rgba(223,100,58,.14)'];
              const _ct = Number(x.contract) || 0;
              const _init = Number(x.initialPrice) || 0;
              return el('div', { class: 'flex items-center justify-between gap-2 text-[11px] py-1.5 border-b', style: { borderColor: 'var(--border)' } },
                el('div', { class: 'min-w-0 flex-1' },
                  el('div', { class: 'truncate' }, (x.customer || '—') + (x.customerId ? ' ' : ''),
                    x.customerId ? el('span', { class: 'tabular-nums', style: { color: 'var(--text-subtle)' } }, '#' + x.customerId) : null),
                  el('div', { class: 'truncate text-[10px]', style: { color: 'var(--text-muted)' } }, x.subscription || '')),
                el('div', { class: 'flex items-center gap-2 shrink-0 tabular-nums' },
                  el('span', { class: 'text-[10px]', style: { color: 'var(--text-muted)' }, title: 'Contract length' }, _ct ? _ct + ' mo' : '—'),
                  el('span', { class: 'text-[10px]', style: { color: 'var(--text-muted)' }, title: 'Initial service price' }, _init ? fmt.usd0(_init) + ' init' : '—'),
                  el('span', {
                    class: 'text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full',
                    style: { color: _audit[1], background: _audit[2] },
                    title: 'Audit status',
                  }, _audit[0]),
                  el('span', { class: 'font-bold' }, fmt.usd0(x.contractValue))));
            }));
        })());
    } catch (e) { console.warn('[ridd] sell-days calendar failed', e); return el('div', {}); }
  }

  function recordCard(label, rec, formatLabel, rank, recordKey) {
    const isOpen = recordsLeaderKey === recordKey;
    const rankBadge = rank
      ? el('button', {
          class: 'text-[10px] tabular-nums font-bold px-1.5 py-0.5 rounded shrink-0 transition hover:brightness-95 cursor-pointer',
          style: isOpen
            ? { background: 'var(--accent)', color: 'var(--accent-text)', boxShadow: '0 0 0 2px var(--accent)' }
            : (rank.rank === 1
              ? { background: 'var(--accent)', color: 'var(--accent-text)' }
              : { background: 'var(--card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }),
          title: 'Click to see the leaderboard for this record',
          onclick: () => { recordsLeaderKey = isOpen ? null : recordKey; renderBody(); },
        }, '#' + rank.rank + ' of ' + rank.total)
      : null;
    if (!rec || rec.revenue === 0) {
      return el('div', { class: 'rounded-lg border p-3', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
        el('div', { class: 'flex items-start justify-between gap-2' },
          el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold' }, label),
          rankBadge,
        ),
        el('div', { class: 'text-base font-bold tabular-nums mt-1 text-muted-' }, '—'),
      );
    }
    return el('div', { class: 'rounded-lg border p-3', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
      el('div', { class: 'flex items-start justify-between gap-2' },
        el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold' }, label),
        rankBadge,
      ),
      el('div', { class: 'text-lg font-bold tabular-nums mt-1' }, fmt.usd0(rec.revenue)),
      el('div', { class: 'text-[10px] text-muted- mt-0.5' },
        rec.count + ' sale' + (rec.count === 1 ? '' : 's') + ' · ' + formatLabel(rec),
      ),
    );
  }

  function rankFor(key) {
    if (scopedAllRepRecords.length < 2) return null;
    const valid = scopedAllRepRecords.filter(x => (x.recs[key]?.revenue || 0) > 0);
    valid.sort((a, b) => b.recs[key].revenue - a.recs[key].revenue);
    const idx = valid.findIndex(x => x.name === rep.name);
    return idx >= 0 ? { rank: idx + 1, total: valid.length } : null;
  }

  function recordsStrip() {
    const recs = computeIndicatorRecords(scopedRep);
    return el('div', { class: 'mb-5' },
      el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, 'Personal Records'),
      el('div', { class: 'grid grid-cols-3 gap-3' },
        recordCard('Best Day',   recs.bestDay,   r => r.date,                    rankFor('bestDay'),   'bestDay'),
        recordCard('Best Week',  recs.bestWeek,  r => 'Week of ' + r.weekStart,  rankFor('bestWeek'),  'bestWeek'),
        recordCard('Best Month', recs.bestMonth, r => {
          const [y, m] = r.month.split('-');
          return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        }, rankFor('bestMonth'), 'bestMonth'),
      ),
      recordsLeaderboardBlock(),
    );
  }

  // Render the full account list for an expanded leaderboard row. Pulls
  // every CSV-derived field so the user can investigate why each account
  // is active vs cancelled (cancel date, cancel reason, autopay, etc.).
  function accountsTable(sales) {
    // Sortable headers — click cycles desc → asc. State lives on the modal
    // instance so it survives re-renders while the card is open.
    const iso = (x) => (typeof dateSoldToIso === 'function' && dateSoldToIso(x.dateSold)) || '';
    const SORTERS = {
      customer:     (x) => (x.customer || '').toLowerCase(),
      customerId:   (x) => Number(x.customerId) || 0,
      subscription: (x) => (x.subscription || '').toLowerCase(),
      value:        (x) => Number(x.contractValue) || 0,
      autopay:      (x) => isAutoPayOn(x) ? 1 : 0,
      status:       (x) => (x.status || '').toLowerCase(),
      sold:         (x) => iso(x),
      aged:         (x) => Number(x.age) || 0,
      cancelDate:   (x) => x.cancelDate || '',
      cancelReason: (x) => (x.cancelReason || '').toLowerCase(),
    };
    const keyFn = SORTERS[_acctSort.key] || SORTERS.sold;
    const dirMul = _acctSort.dir === 'asc' ? 1 : -1;
    const sorted = [...sales].sort((a, b) => {
      const va = keyFn(a), vb = keyFn(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dirMul;
    });
    const hSort = (key, label, cls) => el('th', {
      class: cls + ' cursor-pointer select-none hover:underline',
      style: _acctSort.key === key ? { color: 'var(--accent)', fontWeight: '800' } : {},
      title: 'Sort by ' + label,
      onclick: () => {
        _acctSort = { key, dir: _acctSort.key === key && _acctSort.dir === 'desc' ? 'asc' : 'desc' };
        renderBody();
      },
    }, label);
    return el('div', { class: 'overflow-x-auto rounded border', style: { borderColor: 'var(--border)', background: 'var(--card)' } },
      el('table', { class: 'w-full text-[11px]', style: { minWidth: '760px' } },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
          el('tr', { style: { background: 'var(--card-2)' } },
            hSort('customer',     'Customer',      'text-left px-2 py-1.5 whitespace-nowrap'),
            hSort('customerId',   'Cust ID',       'text-left px-2 py-1.5'),
            hSort('subscription', 'Subscription',  'text-left px-2 py-1.5 whitespace-nowrap'),
            hSort('value',        'Value',         'text-right px-2 py-1.5'),
            hSort('autopay',      'Auto Pay',      'text-center px-2 py-1.5'),
            hSort('status',       'Status',        'text-center px-2 py-1.5'),
            hSort('sold',         'Sold',          'text-left px-2 py-1.5 whitespace-nowrap'),
            hSort('aged',         'Aged',          'text-right px-2 py-1.5'),
            hSort('cancelDate',   'Cancel Date',   'text-left px-2 py-1.5 whitespace-nowrap'),
            hSort('cancelReason', 'Cancel Reason', 'text-left px-2 py-1.5'),
          ),
        ),
        el('tbody', {},
          ...sorted.map(s => {
            // Tint counted cancels red so they stand out in the detail
            // list; excluded rows (per the ROR toggle) stay neutral.
            const cancelled = _repCancelCounts(s);
            const on = isAutoPayOn(s);
            return el('tr', {
              class: 'border-t border-',
              style: cancelled ? { background: 'rgba(220,38,38,.04)' } : {},
            },
              el('td', { class: 'px-2 py-1.5 font-medium whitespace-nowrap', title: s.customer || '' }, s.customer || '—'),
              el('td', { class: 'px-2 py-1.5 text-muted- tabular-nums' }, s.customerId || '—'),
              el('td', { class: 'px-2 py-1.5 text-muted- max-w-[200px] truncate', title: s.subscription || '' }, s.subscription || '—'),
              el('td', { class: 'px-2 py-1.5 text-right tabular-nums font-semibold' }, fmt.usd0(s.contractValue)),
              el('td', { class: 'px-2 py-1.5 text-center' },
                el('span', {
                  class: 'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                  style: on
                    ? { background: 'rgba(223,100,58,.16)', color: '#DF643A' }
                    : { background: 'rgba(220,38,38,.12)', color: '#B91C1C' },
                }, on ? 'On' : 'Off'),
              ),
              el('td', { class: 'px-2 py-1.5 text-center' },
                el('span', {
                  class: 'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                  style: cancelled
                    ? { background: 'rgba(220,38,38,.12)', color: '#B91C1C' }
                    : { background: 'rgba(223,100,58,.16)', color: '#DF643A' },
                }, cancelled ? 'Cancelled' : 'Active'),
              ),
              el('td', { class: 'px-2 py-1.5 text-muted- tabular-nums whitespace-nowrap' }, (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || (s.dateSold || '—').split(' ')[0]),
              // Days past due - the same field the Aging tile thresholds on,
              // so the drill shows exactly how far gone each account is.
              (() => {
                const d = Number(s.age) || 0;
                const hot = d >= ((typeof reportingAgingDays === 'function') ? reportingAgingDays() : 7);
                return el('td', { class: 'px-2 py-1.5 text-right tabular-nums' + (hot ? ' font-bold' : ''), style: hot ? { color: '#DC2626' } : { color: 'var(--text-muted)' } }, d > 0 ? d + 'd' : '—');
              })(),
              el('td', { class: 'px-2 py-1.5 text-muted- tabular-nums whitespace-nowrap' }, s.cancelDate || '—'),
              el('td', { class: 'px-2 py-1.5 text-muted-', style: { minWidth: '150px', maxWidth: '260px', whiteSpace: 'normal', lineHeight: '1.35' }, title: s.cancelReason || '' }, s.cancelReason || '—'),
            );
          }),
        ),
      ),
    );
  }

  function recordsLeaderboardBlock() {
    if (!recordsLeaderKey || scopedAllRepRecords.length === 0) return null;
    const labelMap = { bestDay: 'Best Day', bestWeek: 'Best Week', bestMonth: 'Best Month' };
    const subLabel = (r) => {
      if (recordsLeaderKey === 'bestDay')   return r.date;
      if (recordsLeaderKey === 'bestWeek')  return 'Week of ' + r.weekStart;
      if (recordsLeaderKey === 'bestMonth') {
        const [y, m] = r.month.split('-');
        return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }
    };
    const sorted = scopedAllRepRecords
      .filter(x => (x.recs[recordsLeaderKey]?.revenue || 0) > 0)
      .map(x => ({ name: x.name, rec: x.recs[recordsLeaderKey] }))
      .sort((a, b) => b.rec.revenue - a.rec.revenue);
    return el('div', {
      class: 'rounded-lg border mt-3',
      style: { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.04)' },
    },
      el('div', { class: 'flex items-center justify-between px-4 py-2.5 border-b', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--accent)' } }, labelMap[recordsLeaderKey] + ' · Leaderboard'),
          el('div', { class: 'text-[10px] text-muted- mt-0.5' }, sorted.length + ' rep' + (sorted.length === 1 ? '' : 's') + ' with a record'),
        ),
        el('button', {
          class: 'text-xs text-muted- hover:text-default',
          onclick: () => { recordsLeaderKey = null; renderBody(); },
        }, '✕'),
      ),
      el('div', { class: 'scroll-x', style: { maxHeight: '320px', overflowY: 'auto' } },
        el('table', { class: 'w-full text-[11px]' },
          el('thead', {
            class: 'text-[9px] uppercase tracking-wider text-muted-',
            style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: 1 },
          },
            el('tr', {},
              el('th', { class: 'text-left pl-4 pr-2 py-2 w-10' }, '#'),
              el('th', { class: 'text-left px-2 py-2' }, 'Rep'),
              el('th', { class: 'text-right px-2 py-2' }, 'Revenue'),
              el('th', { class: 'text-right px-2 py-2' }, 'Sales'),
              el('th', { class: 'text-right px-2 py-2' }, 'ACV'),
              el('th', { class: 'text-right px-2 py-2', title: 'Multi-year (≥18mo) / (12mo + multi-year)' }, 'MY %'),
              el('th', { class: 'text-right px-2 py-2', title: 'Avg initial price excluding Sentricon / German Roach / Interior Flea' }, 'Avg Pest Init'),
              el('th', { class: 'text-right px-2 py-2', title: 'Avg initial price across all sales' }, 'Avg Init'),
              el('th', { class: 'text-right px-2 py-2', title: 'Cancelled sales / sales in this period' }, 'Cncl %'),
              el('th', { class: 'text-left pl-2 pr-4 py-2' }, recordsLeaderKey === 'bestDay' ? 'Date' : recordsLeaderKey === 'bestWeek' ? 'Week' : 'Month'),
            ),
          ),
          el('tbody', {},
            ...sorted.flatMap((row, i) => {
              const isMe = row.name === rep.name;
              const isExpanded = recordsLeaderExpanded === row.name;
              const r = row.rec;
              // PRIVACY: same gate as the player card — admin: anyone,
              // self: always, Rep - Partner: their own team's reps.
              const canExpand = canViewRepDetails(row.name, row.team);
              const tr = el('tr', {
                class: 'border-t border- transition' + (isMe ? ' js-leader-current' : '') + (canExpand ? ' cursor-pointer hover:brightness-95' : ''),
                style: isExpanded
                  ? { background: 'rgba(223,100,58,.10)', fontWeight: isMe ? '600' : '500' }
                  : (isMe ? { background: 'rgba(223,100,58,.18)', fontWeight: '600' } : {}),
                onclick: canExpand ? (() => { recordsLeaderExpanded = isExpanded ? null : row.name; renderBody(); }) : undefined,
              },
                el('td', { class: 'pl-4 pr-2 py-2 font-bold tabular-nums', style: i === 0 ? { color: 'var(--accent)' } : {} }, '#' + (i + 1)),
                el('td', { class: 'px-2 py-2 whitespace-nowrap' },
                  el('span', { class: 'inline-block w-3 text-muted- mr-1', style: { transition: 'transform .15s ease', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block' } }, canExpand ? '▸' : ''),
                  row.name + (isMe ? '  (this rep)' : ''),
                ),
                el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold' }, fmt.usd0(r.revenue)),
                el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, r.count),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.usd0(r.acv)),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, (r.myPct * 100).toFixed(1) + '%'),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, r.avgPest > 0 ? fmt.usd0(r.avgPest) : '—'),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, r.avgInitial > 0 ? fmt.usd0(r.avgInitial) : '—'),
                el('td', {
                  class: 'px-2 py-2 text-right tabular-nums',
                  style: r.cancelPct > 0.1 ? { color: '#DC2626', fontWeight: '600' } : {},
                }, r.cancelPct > 0 ? (r.cancelPct * 100).toFixed(1) + '%' : '—'),
                el('td', { class: 'pl-2 pr-4 py-2 text-muted- tabular-nums whitespace-nowrap' }, subLabel(r)),
              );
              if (!isExpanded) return [tr];
              const periodLabel = recordsLeaderKey === 'bestDay' ? 'day' : recordsLeaderKey === 'bestWeek' ? 'week' : 'month';
              const subRow = el('tr', { class: 'border-t border-' },
                el('td', { class: 'p-0', colspan: 10 },
                  el('div', { class: 'p-3', style: { background: 'var(--card-2)' } },
                    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' },
                      r.sales.length + ' account' + (r.sales.length === 1 ? '' : 's') + ' from ' + row.name + "'s best " + periodLabel + ' · ' + subLabel(r),
                    ),
                    accountsTable(r.sales),
                  ),
                ),
              );
              return [tr, subRow];
            }),
          ),
        ),
      ),
    );
  }

  // ── Chart drill popup — tap any bar / label / heatmap cell to see the
  // actual accounts behind that number (stacks above the player card).
  const openChartDrill = (title, list) => {
    if (!list || !list.length) return;
    const ov = el('div', { class: 'modal-overlay' });
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    const rev = list.reduce((a, x) => a + (Number(x.contractValue) || 0), 0);
    ov.append(el('div', { class: 'card w-full max-w-3xl my-8 flex flex-col overflow-hidden', style: { maxHeight: 'calc(100vh - 64px)' } },
      el('div', { class: 'px-5 py-3 flex items-start justify-between gap-3 border-b', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('div', { class: 'text-sm font-bold' }, title),
          el('div', { class: 'text-[11px] text-muted- mt-0.5 tabular-nums' },
            list.length + ' account' + (list.length === 1 ? '' : 's') + ' · ' + fmt.usd0(rev))),
        el('button', { class: 'text-xl leading-none text-muted-', style: { lineHeight: '1' }, onclick: () => ov.remove() }, '×')),
      el('div', { class: 'overflow-auto' },
        accountsTable(list.slice().sort((a, b) => (b.dateSold || '').localeCompare(a.dateSold || ''))))));
    document.body.append(ov);
  };
  const _salesInWeek = (weekStart) => (scopedRep.sales || []).filter(x => {
    const d = _parseIndicatorDay(x); if (!d) return false;
    const ws = new Date(d); ws.setDate(ws.getDate() - ws.getDay());
    return ws.toISOString().slice(0, 10) === weekStart;
  });
  const _salesOnDow = (dow) => (scopedRep.sales || []).filter(x => { const d = _parseIndicatorDay(x); return d && d.getDay() === dow; });
  const _salesAtHour = (h) => (scopedRep.sales || []).filter(x => { const t = _parseIndicatorTime(x); return t && t.hour === h; });
  const _salesDowHour = (dow, h) => (scopedRep.sales || []).filter(x => {
    const d = _parseIndicatorDay(x); const t = _parseIndicatorTime(x);
    return d && t && d.getDay() === dow && t.hour === h;
  });

  function trendsBlock() {
    const tr = computeIndicatorTrends(scopedRep, _trendWkOff);
    const maxWeek = Math.max(1, ...tr.weeks12.map(w => w.revenue));
    const maxDow  = Math.max(1, ...tr.dow);
    const maxSub  = Math.max(1, ...tr.topSubs.map(s => s.count));
    const dowLabels = ['S','M','T','W','T','F','S'];
    const accent = 'var(--accent)';
    // Compact cash label under each bar: $850 / $4.5K / $45K
    const cash = (v) => v <= 0 ? '' : v >= 1000000 ? '$' + (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
      : v >= 100000 ? '$' + Math.round(v / 1000) + 'K'
      : v >= 1000 ? '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : '$' + Math.round(v);
    // ‹ › page the window in 12-week steps; ‹ disables at the oldest data,
    // › disables back at the live window.
    const wkArrow = (glyph, disabled, onclick) => el('button', {
      class: 'w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold transition' + (disabled ? '' : ' hover:brightness-95 cursor-pointer'),
      style: { borderColor: 'var(--border-2)', color: disabled ? 'var(--text-subtle)' : 'var(--text)', opacity: disabled ? .45 : 1 },
      disabled, onclick: disabled ? undefined : onclick,
    }, glyph);

    return el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4 mb-5' },
      // Weekly trend (12 weeks, revenue bars, pageable)
      el('div', { class: 'rounded-lg border p-4', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
        el('div', { class: 'flex items-center justify-between gap-2 mb-3 flex-wrap' },
          el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' },
            _trendWkOff === 0 ? 'Last 12 Weeks · Revenue' : '12 Weeks · Revenue'),
          el('div', { class: 'flex items-center gap-2' },
            wkArrow('‹', !tr.weeksHasOlder, () => { _trendWkOff++; renderBody(); }),
            el('div', { class: 'text-[10px] text-muted- tabular-nums' }, tr.weeks12.length === 0 ? '' : tr.weeks12[0].weekStart + ' → ' + tr.weeks12[tr.weeks12.length - 1].weekStart),
            wkArrow('›', _trendWkOff === 0, () => { _trendWkOff--; renderBody(); }),
          ),
        ),
        tr.weeks12.length === 0
          ? el('div', { class: 'text-xs text-muted- italic py-6 text-center' }, 'No date-stamped sales yet.')
          : el('div', {},
              el('div', { class: 'flex items-end gap-1', style: { height: '90px' } },
                ...tr.weeks12.map(w => {
                  const h = Math.max(2, Math.round((w.revenue / maxWeek) * 90));
                  const bar = el('div', {
                    class: 'flex-1 rounded-t transition ' + (w.count > 0 ? 'cursor-pointer' : 'cursor-help'),
                    style: { height: h + 'px', background: w.revenue > 0 ? accent : 'var(--border)', opacity: w.revenue > 0 ? 1 : 0.5 },
                    onclick: w.count > 0 ? () => openChartDrill('Week of ' + w.weekStart, _salesInWeek(w.weekStart)) : undefined,
                  });
                  attachTooltip(bar, {
                    title: w.revenue > 0 ? fmt.usd0(w.revenue) : 'No sales',
                    desc: 'Week of ' + w.weekStart + (w.count > 0 ? ' · ' + w.count + ' sale' + (w.count === 1 ? '' : 's') : ''),
                  });
                  return bar;
                }),
              ),
              // Revenue figure under every bar, compact ($4.5K) so 12 fit.
              el('div', { class: 'flex gap-1 mt-1' },
                ...tr.weeks12.map(w => el('div', {
                  class: 'flex-1 text-center tabular-nums font-semibold' + (w.count > 0 ? ' cursor-pointer' : ''),
                  style: { fontSize: '8px', color: w.revenue > 0 ? 'var(--text-muted)' : 'var(--text-subtle)' },
                  onclick: w.count > 0 ? () => openChartDrill('Week of ' + w.weekStart, _salesInWeek(w.weekStart)) : undefined,
                }, cash(w.revenue) || '·')),
              ),
            ),
      ),
      // Day of week distribution — bars share a baseline (separate bar +
      // label zones) so a tall Mon doesn't overflow above a short Sun.
      el('div', { class: 'rounded-lg border p-4', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
        el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-3' }, 'By Day of Week · Sales Count'),
        tr.dow.every(c => c === 0)
          ? el('div', { class: 'text-xs text-muted- italic py-6 text-center' }, 'No date-stamped sales yet.')
          : el('div', {},
              el('div', { class: 'flex items-end gap-2', style: { height: '70px' } },
                ...tr.dow.map((c, i) => {
                  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i];
                  const bar = el('div', {
                    class: 'flex-1 rounded-t transition ' + (c > 0 ? 'cursor-pointer' : 'cursor-help'),
                    style: {
                      height: Math.max(2, Math.round((c / maxDow) * 70)) + 'px',
                      background: c > 0 ? accent : 'var(--border)',
                      opacity: c > 0 ? 1 : 0.4,
                    },
                    onclick: c > 0 ? () => openChartDrill(dayName + 's', _salesOnDow(i)) : undefined,
                  });
                  attachTooltip(bar, { title: dayName, desc: c + ' sale' + (c === 1 ? '' : 's') });
                  return bar;
                }),
              ),
              el('div', { class: 'flex gap-2 mt-1.5' },
                ...tr.dow.map((c, i) => el('div', {
                  class: 'flex-1 flex flex-col items-center' + (c > 0 ? ' cursor-pointer' : ''),
                  onclick: c > 0 ? () => openChartDrill(['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'][i], _salesOnDow(i)) : undefined,
                },
                  el('div', { class: 'text-[9px] text-muted- font-semibold' }, dowLabels[i]),
                  el('div', { class: 'text-[10px] tabular-nums font-semibold' }, c),
                )),
              ),
            ),
      ),
    );
  }

  function powerHourBlock() {
    const tr = computeIndicatorTrends(scopedRep);
    const hasData = tr.hours.some(h => h > 0);
    const visible = [];
    for (let h = tr.firstHour; h <= tr.lastHour; h++) visible.push({ hour: h, count: tr.hours[h], revenue: tr.hoursRev[h] });
    const max = Math.max(1, ...visible.map(v => v.count));
    const accent = 'var(--accent)';

    return el('div', { class: 'rounded-lg border p-4 mb-5', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
      el('div', { class: 'flex items-center justify-between mb-3 flex-wrap gap-2' },
        el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Power Hour · Sales by Hour of Day'),
      ),
      !hasData
        ? el('div', { class: 'text-xs text-muted- italic py-6 text-center' }, 'No timestamped sales yet.')
        : el('div', {},
            el('div', { class: 'flex items-end gap-1', style: { height: '90px' } },
              ...visible.map(v => {
                const bar = el('div', {
                  class: 'flex-1 rounded-t transition ' + (v.count > 0 ? 'cursor-pointer' : 'cursor-help'),
                  style: {
                    height: Math.max(2, Math.round((v.count / max) * 90)) + 'px',
                    background: v.count > 0 ? accent : 'var(--border)',
                    opacity: v.count > 0 ? (v.hour === tr.peakHour ? 1 : 0.85) : 0.4,
                    outline: v.hour === tr.peakHour ? '2px solid var(--accent)' : 'none',
                  },
                  onclick: v.count > 0 ? () => openChartDrill(_fmtHourLabel(v.hour) + '–' + _fmtHourLabel((v.hour + 1) % 24), _salesAtHour(v.hour)) : undefined,
                });
                const acv = v.count > 0 ? v.revenue / v.count : 0;
                const descLines = ['Accounts: ' + v.count];
                if (v.count > 0) { descLines.push('Revenue: ' + fmt.usd0(v.revenue)); descLines.push('ACV: ' + fmt.usd0(acv)); }
                attachTooltip(bar, {
                  title: _fmtHourLabel(v.hour) + '–' + _fmtHourLabel((v.hour + 1) % 24) + (v.hour === tr.peakHour ? ' · Peak' : ''),
                  desc: descLines,
                });
                return bar;
              }),
            ),
            el('div', { class: 'flex gap-1 mt-1.5' },
              ...visible.map(v => el('div', {
                class: 'flex-1 flex flex-col items-center' + (v.count > 0 ? ' cursor-pointer' : ''),
                onclick: v.count > 0 ? () => openChartDrill(_fmtHourLabel(v.hour) + '–' + _fmtHourLabel((v.hour + 1) % 24), _salesAtHour(v.hour)) : undefined,
              },
                el('div', { class: 'text-[9px] text-muted- font-semibold' }, _fmtHourLabel(v.hour)),
                el('div', { class: 'text-[10px] tabular-nums font-semibold' }, v.count),
              )),
            ),
          ),
      hasData && el('div', { class: 'flex items-center gap-5 mt-3 text-[11px] flex-wrap' },
        el('div', {},
          el('span', { class: 'text-muted-' }, 'Earliest: '),
          el('span', { class: 'font-bold tabular-nums' }, _fmtTimeOfDay(tr.earliest)),
        ),
        el('div', {},
          el('span', { class: 'text-muted-' }, 'Latest: '),
          el('span', { class: 'font-bold tabular-nums' }, _fmtTimeOfDay(tr.latest)),
        ),
      ),
    );
  }

  function dayHourHeatmapBlock() {
    const tr = computeIndicatorTrends(scopedRep);
    // Find the max count across the visible window so cell intensity is
    // normalized. We only consider the firstHour..lastHour range (same as
    // Power Hour) so off-hours don't squash the scale.
    let maxCell = 0, totalCells = 0;
    for (let dow = 0; dow < 7; dow++) {
      for (let h = tr.firstHour; h <= tr.lastHour; h++) {
        if (tr.dayHourCount[dow][h] > maxCell) maxCell = tr.dayHourCount[dow][h];
        totalCells++;
      }
    }
    if (maxCell === 0) {
      return el('div', { class: 'rounded-lg border p-4 mb-5', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
        el('div', { class: 'flex items-center justify-between gap-2 mb-3' },
          el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Time of day'),
          _whenToggle()),
        el('div', { class: 'text-xs text-muted- italic py-6 text-center' }, 'No timestamped sales yet.'),
      );
    }
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hourCols = [];
    for (let h = tr.firstHour; h <= tr.lastHour; h++) hourCols.push(h);

    // Find the single hottest cell so we can crown it.
    let hotDow = 0, hotHour = tr.firstHour;
    for (let dow = 0; dow < 7; dow++) {
      for (const h of hourCols) {
        if (tr.dayHourCount[dow][h] > tr.dayHourCount[hotDow][hotHour]) { hotDow = dow; hotHour = h; }
      }
    }

    // Grid columns: a fixed-width day-label column + one fr per hour so the
    // heatmap fills the card. Cell height is bounded so a wide grid doesn't
    // turn into giant squares — a 28-44px range keeps it scannable on both
    // narrow modals and full-width layouts.
    const gridCols = '36px repeat(' + hourCols.length + ', minmax(0, 1fr))';
    return el('div', { class: 'rounded-lg border p-4 mb-5', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
      el('div', { class: 'flex items-center justify-between mb-3 flex-wrap gap-2' },
        el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Time of day'),
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          el('div', { class: 'text-[10px] text-muted-' }, 'Hottest: ',
            el('span', { style: { color: 'var(--text)', fontWeight: '600' } },
              dayLabels[hotDow] + ' ' + _fmtHourLabel(hotHour) + ' · ' + tr.dayHourCount[hotDow][hotHour] + ' sale' + (tr.dayHourCount[hotDow][hotHour] === 1 ? '' : 's')),
          ),
          _whenToggle()),
      ),
      el('div', { class: 'w-full' },
        // Header row: empty corner + hour labels (same grid template as body
        // rows so labels line up with their column on every viewport width).
        el('div', { style: { display: 'grid', gridTemplateColumns: gridCols, gap: '2px' } },
          el('div', {}),
          ...hourCols.map(h => el('div', {
            class: 'text-[9px] text-muted- font-semibold text-center',
          }, _fmtHourLabel(h))),
        ),
        // Day rows
        ...dayLabels.map((dayLabel, dow) => el('div', {
          style: { display: 'grid', gridTemplateColumns: gridCols, gap: '2px', marginTop: '2px', alignItems: 'center' },
        },
          el('div', { class: 'text-[9px] text-muted- font-semibold pr-2 text-right' }, dayLabel),
          ...hourCols.map(h => {
            const count = tr.dayHourCount[dow][h];
            const rev = tr.dayHourRev[dow][h];
            const intensity = maxCell > 0 ? count / maxCell : 0;
            const isHot = (dow === hotDow && h === hotHour);
            const cell = el('div', {
              class: 'rounded transition ' + (count > 0 ? 'cursor-pointer' : 'cursor-help'),
              style: {
                height: 'clamp(22px, 4vw, 44px)',
                background: count > 0
                  ? 'rgba(223,100,58,' + (0.12 + intensity * 0.85).toFixed(3) + ')'
                  : 'var(--border)',
                outline: isHot ? '2px solid var(--accent)' : 'none',
                outlineOffset: '-1px',
              },
              onclick: count > 0 ? () => openChartDrill(dayLabel + 's · ' + _fmtHourLabel(h) + '–' + _fmtHourLabel((h + 1) % 24), _salesDowHour(dow, h)) : undefined,
            });
            attachTooltip(cell, {
              title: dayLabel + ' ' + _fmtHourLabel(h) + (isHot ? ' · Hottest' : ''),
              desc: count + ' sale' + (count === 1 ? '' : 's') + (count > 0 ? ' · ' + fmt.usd0(rev) : ''),
            });
            return cell;
          }),
        )),
      ),
      // Legend
      el('div', { class: 'flex items-center gap-2 mt-3 text-[10px] text-muted-' },
        el('span', {}, 'Less'),
        ...[0.15, 0.35, 0.55, 0.75, 0.95].map(intensity => el('div', {
          class: 'rounded',
          style: { width: '14px', height: '14px', background: 'rgba(223,100,58,' + intensity.toFixed(2) + ')' },
        })),
        el('span', {}, 'More'),
        el('span', { class: 'ml-3' }, 'max ', el('span', { style: { color: 'var(--text)', fontWeight: '600' } }, maxCell + ' sale' + (maxCell === 1 ? '' : 's'))),
      ),
    );
  }

  function topSubsBlock() {
    const tr = computeIndicatorTrends(scopedRep);
    if (tr.topSubs.length === 0) return el('div', {});
    const maxCount = Math.max(1, ...tr.topSubs.map(s => s.count));
    // Each row is ~28px tall (text + gap-2). Show 5 rows worth, then scroll.
    const ROWS_VISIBLE = 5;
    const ROW_HEIGHT = 28;
    const maxHeight = (tr.topSubs.length > ROWS_VISIBLE)
      ? (ROWS_VISIBLE * ROW_HEIGHT + (ROWS_VISIBLE - 1) * 8) + 'px'
      : null;
    return el('div', { class: 'rounded-lg border p-4 mb-5', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
      el('div', { class: 'flex items-center justify-between mb-3' },
        el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Subscriptions'),
        el('div', { class: 'text-[10px] text-muted-' }, tr.topSubs.length + ' service type' + (tr.topSubs.length === 1 ? '' : 's') + (tr.topSubs.length > ROWS_VISIBLE ? ' · scroll for more' : '')),
      ),
      el('div', {
        class: 'flex flex-col gap-2',
        style: maxHeight ? { maxHeight, overflowY: 'auto', paddingRight: '6px' } : {},
      },
        ...tr.topSubs.flatMap(sub => {
          const pct = sub.count / maxCount;
          const cancelRate = sub.count > 0 ? sub.cancels / sub.count : 0;
          // Fixed grid so every column lines up: caret · name · bar · accts ·
          // revenue · cancels. The bar always starts at the same x.
          const SUB_GRID = '12px minmax(0, 1fr) clamp(110px, 24vw, 240px) 44px 84px 112px';
          const row = el('div', {
            class: 'text-xs cursor-pointer rounded transition hover:brightness-95',
            style: {
              display: 'grid', gridTemplateColumns: SUB_GRID, alignItems: 'center', columnGap: '10px',
              minHeight: ROW_HEIGHT + 'px',
              padding: '2px 4px',
            },
            title: 'Click to see all ' + sub.count + ' account' + (sub.count === 1 ? '' : 's') + ' for ' + sub.name,
            // Accounts open in the same drill POPUP the charts use — the old
            // inline expansion rendered a tall table inside this block's
            // 5-row scrollbox, which trapped the scroll on mobile.
            onclick: () => openChartDrill(sub.name, (scopedRep.sales || []).filter(x => ((x.subscription || '').trim() || 'Unknown') === sub.name)),
          },
            el('span', { class: 'inline-block text-muted-', style: { width: '10px' } }, '▸'),
            el('div', { class: 'truncate min-w-0', title: sub.name }, sub.name),
            el('div', { style: { background: 'var(--border)', height: '8px', borderRadius: '0', overflow: 'hidden' } },
              el('div', {
                style: { width: (pct * 100).toFixed(1) + '%', height: '100%', background: 'var(--accent)' },
              }),
            ),
            el('div', { class: 'tabular-nums font-semibold text-right' }, sub.count),
            el('div', { class: 'tabular-nums text-muted- text-right' }, fmt.usd0(sub.revenue)),
            sub.cancels > 0
              ? el('span', {
                  class: 'text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums text-center',
                  style: { background: 'rgba(220,38,38,.10)', color: '#B91C1C', justifySelf: 'end' },
                  title: sub.cancels + ' cancelled · ' + (cancelRate * 100).toFixed(1) + '% cancel rate',
                }, sub.cancels + ' cncl · ' + (cancelRate * 100).toFixed(1) + '%')
              : el('span', { class: 'text-[10px] text-muted- text-right', style: { justifySelf: 'end' } }, '0 cncl'),
          );
          return [row];
        }),
      ),
    );
  }

  function drillBlock() {
    if (!drillKey) return null;
    const drillSales = buildDrillSales();
    const drillLabel = scopedStats.find(s => s.key === drillKey)?.label || '';
    const subPills = drillSubs[drillKey];
    return el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.04)' } },
      el('div', { class: 'px-4 py-3 flex items-start justify-between gap-3 flex-wrap border-b', style: { borderColor: 'var(--border)' } },
        el('div', { class: 'flex items-center gap-3 flex-wrap' },
          el('div', {},
            el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--accent)' } }, drillLabel),
            el('div', { class: 'text-[10px] text-muted- mt-0.5' }, drillSales.length + ' account' + (drillSales.length === 1 ? '' : 's')),
          ),
          subPills && el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
            ...subPills.map(p => el('button', {
              class: 'px-2.5 py-1 text-[11px] font-semibold transition',
              style: drillSub === p.id
                ? { background: 'var(--accent)', color: 'var(--accent-text)' }
                : { background: 'transparent', color: 'var(--text)' },
              onclick: () => { drillSub = p.id; renderBody(); },
            }, p.label)),
          ),
        ),
        el('button', {
          class: 'px-2.5 py-1 rounded border text-[11px] font-semibold transition hover:brightness-95',
          style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
          onclick: () => exportDrillCsv(drillSales),
        }, '↓ Export'),
      ),
      drillSales.length === 0
        ? el('div', { class: 'p-4 text-center text-xs text-muted- italic' }, 'No accounts match this filter.')
        : el('div', { class: 'scroll-x', style: { maxHeight: '420px', overflowY: 'auto' } },
            el('table', { class: 'w-full text-[12px]' },
              el('thead', {
                class: 'text-[9px] uppercase tracking-wider text-muted-',
                style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: 1 },
              },
                el('tr', {},
                  el('th', { class: 'text-left pl-4 pr-2 py-2' }, 'Customer'),
                  el('th', { class: 'text-left px-2 py-2 desktop-only' }, 'Cust ID'),
                  el('th', { class: 'text-left px-2 py-2' }, 'Subscription'),
                  el('th', { class: 'text-left px-2 py-2 desktop-only' }, 'Sold'),
                  el('th', { class: 'text-right px-2 py-2 desktop-only' }, 'Contract'),
                  // Avg Init / Avg Pest drills swap the headline number
                  // from contract value to initial price — that's the
                  // figure being averaged, so showing it lets the user
                  // see exactly which sales are pulling the avg.
                  el('th', { class: 'text-right px-2 py-2' },
                    (drillKey === 'avgInitial' || drillKey === 'avgPest') ? 'Initial' : 'Value'),
                  drillKey === 'cancels'
                    ? el('th', { class: 'text-left px-2 py-2' }, 'Reason')
                    : el('th', { class: 'text-center px-2 py-2' }, 'Auto Pay'),
                ),
              ),
              el('tbody', {},
                ...drillSales.map(s => {
                  const on = isAutoPayOn(s);
                  const headlineValue = (drillKey === 'avgInitial' || drillKey === 'avgPest')
                    ? fmt.usd(s.initialPrice || 0)
                    : fmt.usd0(s.contractValue);
                  return el('tr', { class: 'border-t border-' },
                    el('td', { class: 'pl-4 pr-2 py-2 font-medium', title: s.customer || '' },
                      s.customer || '—',
                      // Mobile: no room for a Cust ID column — show the ID as a
                      // small sub-line under the name instead (hidden on ≥sm
                      // where the dedicated column takes over).
                      s.customerId && el('div', { class: 'sm:hidden text-[10px] font-normal tabular-nums', style: { color: 'var(--text-muted)' } }, '#' + s.customerId),
                    ),
                    el('td', { class: 'px-2 py-2 text-muted- tabular-nums desktop-only' }, s.customerId || '—'),
                    el('td', { class: 'px-2 py-2 text-muted- max-w-[200px] truncate', title: s.subscription || '' }, s.subscription || '—'),
                    el('td', { class: 'px-2 py-2 text-muted- tabular-nums desktop-only whitespace-nowrap' }, s.dateSold || '—'),
                    el('td', { class: 'px-2 py-2 text-right text-muted- tabular-nums desktop-only' }, s.contract ? s.contract + 'mo' : '—'),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold' }, headlineValue),
                    drillKey === 'cancels'
                      ? el('td', { class: 'px-2 py-2 text-muted-' }, s.cancelReason || '—')
                      : el('td', { class: 'px-2 py-2 text-center' },
                          el('span', {
                            class: 'text-[10px] font-semibold px-2 py-0.5 rounded',
                            style: on
                              ? { background: 'rgba(223,100,58,.16)', color: '#DF643A' }
                              : { background: 'rgba(220,38,38,.12)', color: '#B91C1C' },
                          }, on ? 'On' : 'Off'),
                        ),
                  );
                }),
              ),
            ),
          ),
    );
  }

  // ── RETENTION VIEW — mirrors the Auditing player card (Reporting →
  // Auditing) but computed from this rep's sales in the shared indicators
  // dataset, so reps can open it without the admin-only snapshot. Same
  // definitions: Serviced = received an initial service (completed services
  // > 0 or a serviced date); Active = serviced, status Active, no cancel;
  // Aging = active & past-due beyond the configured threshold; Cancelled =
  // serviced then cancelled (incl. 3-day ROR, split out separately); audit
  // buckets come from Customer Flags (No Audit counts as passed). All tiles
  // respect the scope dropdown, and clicking one drills to its accounts.
  function retentionBlock() {
    const all = scopedRep.sales || [];
    const _svcR = (x) => (Number(x.services) || 0) > 0 || !!x.servicedDate;
    // Save-back rule: status Active wins over a logged cancel date, so a
    // saved account sits in Active (and can age), never in Cancelled.
    const _actR = (x) => (x.status || '').toLowerCase() === 'active'
      || ((x.status || '') === '' && _subAliveNow(x) === true);
    const _cxlR = (x) => !!x.cancelDate && !_actR(x);
    const _agingDays = (typeof reportingAgingDays === 'function') ? reportingAgingDays() : 7;
    const _isAging = (x) => _actR(x) && (Number(x.age) || 0) >= _agingDays;
    const _stat = (x) => _auditStatusOf(x.customerFlags);
    const _ror = (x) => _is3DayROR(x) && !_isSoldNotStarted(x);
    // One-time service: "One Time …" name, or no contract months (Sentricon
    // exempt — always a 12-month program even when the field is blank).
    const _isOTS = (x) => {
      if (/^\\s*one[\\s-]?time/i.test(String(x.subscription || ''))) return true;
      const m = Number(x.contract);
      return !(m > 1) && !/sentricon/i.test(String(x.subscription || ''));
    };
    const _realCancel = (x) => _cxlR(x) && !_isExcludableCancel(x);
    let sold = 0, serviced = 0, activeN = 0, soldRev = 0, servicedRev = 0, activeRev = 0, agingRev = 0, cancelledRev = 0, frozenRev = 0, rorRev = 0, exclRev = 0, exclCancelRev = 0, otsCancelRev = 0;
    const audit = { passed: 0, failed: 0, noaudit: 0, pending: 0 };
    const attr = { passed: [0, 0], failed: [0, 0] };
    for (const x of all) {
      const cv = Number(x.contractValue) || 0;
      sold++; soldRev += cv;
      const svc = _svcR(x);
      if (svc) {
        serviced++; servicedRev += cv;
        if (_cxlR(x)) cancelledRev += cv;
        else if (_actR(x)) { activeN++; activeRev += cv; if (_isAging(x)) agingRev += cv; }
        else frozenRev += cv;
        if (_ror(x)) rorRev += cv;
        if (_ror(x) || _isOTS(x)) {
          exclRev += cv;
          if (_cxlR(x)) exclCancelRev += cv;
        }
        if (_isOTS(x) && _cxlR(x)) otsCancelRev += cv;
      }
      const st = _stat(x);
      if (st === 'pending') { if ((x.status || '').toLowerCase() !== 'frozen' && !(x.cancelDate && !svc)) audit.pending++; }
      else audit[st]++;
      if (st === 'passed' || st === 'failed') { attr[st][1]++; if (_realCancel(x)) attr[st][0]++; }
    }
    const passBase = audit.passed + audit.failed + audit.noaudit;
    const passPct = passBase > 0 ? (audit.passed + audit.noaudit) / passBase : null;
    const servExcl = servicedRev - exclRev;
    const attrExclRor = servExcl > 0 ? (cancelledRev - exclCancelRev) / servExcl : null;
    const attrInclRor = servicedRev > 0 ? cancelledRev / servicedRev : null;
    const cancelIfAging = servicedRev > 0 ? (cancelledRev + agingRev) / servicedRev : null;
    const activeRetention = servicedRev > 0 ? activeRev / servicedRev : null;
    const soldSvc = sold > 0 ? serviced / sold : null;
    const rateOf = (pair) => pair[1] > 0 ? pair[0] / pair[1] : null;
    const pctS = (p) => p == null ? '—' : (p * 100).toFixed(1) + '%';
    const money = (v) => v ? '$' + Math.round(v).toLocaleString() : '—';
    const good = '#DF643A', bad = '#DC2626';
    const drill = (label, pred) => () => { retDrill = (retDrill && retDrill.label === label) ? null : { label, pred }; renderBody(); };
    const tile = (label, val, sub, color, onClick) => el('div', {
        class: 'rounded-xl p-3' + (onClick ? ' cursor-pointer hover:brightness-95 transition' : ''),
        style: { background: 'var(--card-2)', ...(onClick && retDrill && retDrill.label === label ? { outline: '2px solid var(--accent)' } : {}) },
        onclick: onClick || undefined,
        title: onClick ? 'Click to see these accounts' : undefined,
      },
      el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-xl font-black tabular-nums mt-0.5', style: color ? { color } : {} }, val),
      sub ? el('div', { class: 'text-[10px] text-muted- mt-0.5' }, sub) : null);
    const group = (title, tiles) => el('div', {},
      el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, title),
      el('div', { class: 'grid grid-cols-2 sm:grid-cols-3 gap-2' }, ...tiles));
    const drillPanel = () => {
      if (!retDrill) return null;
      const rows = all.filter(retDrill.pred).sort((a, b) => (b.dateSold || '').localeCompare(a.dateSold || ''));
      return el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.04)' } },
        el('div', { class: 'px-4 py-3 flex items-center justify-between gap-3 border-b', style: { borderColor: 'var(--border)' } },
          el('div', {},
            el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--accent)' } }, retDrill.label),
            el('div', { class: 'text-[10px] text-muted- mt-0.5' }, rows.length + ' account' + (rows.length === 1 ? '' : 's'))),
          el('button', { class: 'text-lg leading-none text-muted-', onclick: () => { retDrill = null; renderBody(); } }, '×')),
        rows.length === 0
          ? el('div', { class: 'p-4 text-center text-xs text-muted- italic' }, 'No accounts in this bucket.')
          : el('div', { style: { maxHeight: '420px', overflowY: 'auto' } }, accountsTable(rows)));
    };
    return el('div', { class: 'flex flex-col gap-4' },
      group('Production', [
        tile('Sold', fmt.int(sold), null, null, drill('Sold', () => true)),
        tile('Serviced', fmt.int(serviced), null, null, drill('Serviced', _svcR)),
        tile('Active', fmt.int(activeN), 'still on the books', activeN > 0 ? good : null, drill('Active accounts', x => _svcR(x) && _actR(x))),
        tile('Sold/Serviced', pctS(soldSvc), null, soldSvc == null ? null : (soldSvc >= 0.85 ? good : soldSvc < 0.65 ? bad : null)),
      ]),
      group('Audit', [
        tile('Pass %', pctS(passPct), passBase + ' audited (incl. no-audit)', passPct == null ? null : (passPct >= 0.85 ? good : passPct < 0.65 ? bad : null)),
        tile('Passed', fmt.int(audit.passed), null, good, drill('Passed', x => _stat(x) === 'passed')),
        tile('Failed', fmt.int(audit.failed), null, audit.failed > 0 ? bad : null, drill('Failed', x => _stat(x) === 'failed')),
        tile('No Audit', fmt.int(audit.noaudit), 'counts as passed', null, drill('No Audit', x => _stat(x) === 'noaudit')),
        tile('Pending', fmt.int(audit.pending), null, null, drill('Pending', x => _stat(x) === 'pending' && (x.status || '').toLowerCase() !== 'frozen' && !(x.cancelDate && !_svcR(x)))),
        tile('Attrition on Audits: Pass / Fail', pctS(rateOf(attr.passed)) + ' / ' + pctS(rateOf(attr.failed))),
      ]),
      group('Revenue · contract value  (Serviced = Active + Cancelled)', [
        tile('Sold', money(soldRev), 'all sold (incl. pre-service)', null, drill('Sold revenue', () => true)),
        tile('Serviced', money(servicedRev), 'received an initial service', null, drill('Serviced revenue', _svcR)),
        tile('Active', money(activeRev), 'serviced & active · incl. aging', null, drill('Active', x => _svcR(x) && _actR(x))),
        tile('Cancelled', money(cancelledRev), 'serviced then cancelled · incl. 3-day ROR · saved accounts count as Active', cancelledRev > 0 ? bad : null, drill('Cancelled', x => _svcR(x) && _cxlR(x))),
        tile('Cancelled · ROR + One-Time', money(rorRev + otsCancelRev), '3-day ROR ' + money(rorRev) + ' · one-time ' + money(otsCancelRev) + ' — not attrition', (rorRev + otsCancelRev) > 0 ? bad : null, drill('3-Day ROR + one-time (cancelled)', x => _svcR(x) && (_ror(x) || (_cxlR(x) && _isOTS(x))))),
        tile('Aging', money(agingRev), 'at-risk slice of Active', agingRev > 0 ? bad : null, drill('Aging', x => _svcR(x) && _isAging(x))),
      ]),
      group('Attrition · of serviced', [
        tile('Attrition · excl. ROR + OTS', pctS(attrExclRor), 'cancelled ÷ serviced (3-day RORs + one-time services removed from both sides)', good),
        tile('Attrition · incl. 3-day ROR', pctS(attrInclRor), 'cancelled ÷ serviced (incl. ROR + one-time)', 'var(--text)'),
        tile('If aging churns', pctS(cancelIfAging), '(cancelled + aging) ÷ serviced', '#A9441F'),
          // ('Active retention' tile removed per Isaac - it duplicated 1 - attrition and left the grid uneven.)
      ]),
      // \u2500\u2500 "True Attrition" bar (per Isaac) \u2014 same fixed definition as
      // the Reporting > Retention bar: cancels EXCLUDING 3-day RORs,
      // one-time services, and renewals (removed from BOTH sides), PLUS
      // aging actives counted as churn. Revenue-weighted like the tiles
      // above; the counts underneath drill into the exact accounts.
      (() => {
        const _tx = (x) => _svcR(x) && !_ror(x) && !_isOTS(x) && !_isRenewalCancel(x);
        let tSvc = 0, tCxl = 0, tAging = 0, nSvc = 0, nCxl = 0, nAging = 0;
        for (const x of all) {
          if (!_tx(x)) continue;
          const cv = Number(x.contractValue) || 0;
          tSvc += cv; nSvc++;
          if (_realCancel(x)) { tCxl += cv; nCxl++; }
          else if (_isAging(x)) { tAging += cv; nAging++; }
        }
        if (!(tSvc > 0)) return null;
        const rate = (tCxl + tAging) / tSvc;
        const kept = tSvc - tCxl - tAging;
        const seg = (v, color, label) => v > 0 ? el('div', {
          style: { width: Math.max(0, Math.min(100, v / tSvc * 100)).toFixed(2) + '%', background: color, height: '100%' },
          title: label + ' \u2014 ' + money(v) + ' (' + (v / tSvc * 100).toFixed(1) + '%)',
        }) : null;
        return el('div', { class: 'rounded-xl p-3', style: { background: 'var(--card-2)' } },
          el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
            el('div', {},
              el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } },
                'True attrition \u00b7 excl. ROR + OTS + renewals \u00b7 aging counts as churn'),
              el('div', { class: 'text-[10px] text-muted- mt-0.5' },
                '(cancelled ' + money(tCxl) + ' + aging ' + money(tAging) + ') \u00f7 ' + money(tSvc) + ' serviced')),
            el('div', { class: 'text-xl font-black tabular-nums', style: { color: rate >= 0.15 ? bad : rate < 0.08 ? good : '#A9441F' } }, pctS(rate))),
          el('div', { class: 'w-full rounded-full overflow-hidden flex mt-2', style: { height: '10px', background: 'var(--card)' } },
            seg(kept, good, 'Retained'),
            seg(tAging, '#A9441F', 'Aging'),
            seg(tCxl, bad, 'Cancelled')),
          el('div', { class: 'flex items-center justify-between mt-1 text-[10px] text-muted-' },
            el('span', {},
              el('span', { class: 'cursor-pointer underline', onclick: drill('True attrition \u00b7 cancelled', x => _tx(x) && _realCancel(x)) }, fmt.int(nCxl) + ' cancelled'),
              ' \u00b7 ',
              el('span', { class: 'cursor-pointer underline', onclick: drill('True attrition \u00b7 aging', x => _tx(x) && _actR(x) && _isAging(x)) }, fmt.int(nAging) + ' aging')),
            el('span', {}, fmt.int(nSvc) + ' serviced accounts in this view')));
      })(),
      drillPanel() || el('div', {}),
    );
  }

  function header() {
    const tierMeta = repTierMeta(rep.tier);
    const teamColor = rep.team ? getTeamColor(rep.team) : null;
    const officeName = (rep.office || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const initials = (rep.name || '?').split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase();
    const bounds = getCardScopeBounds(cardScope);
    const scopeRangeLabel = bounds
      ? bounds.start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) + ' – ' + bounds.end.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
      : null;
    // Mobile: identity row first (with its own ×), controls wrap onto their
    // own full-width row below — the side-by-side desktop layout squeezed
    // the name into a one-word-per-line column on phones.
    // Sticky (per Isaac, Sep 2026): the rep's name stays pinned to the top
    // of the card while the body scrolls, so any screenshot says who it is.
    // The modal is the scroll container, so sticky works here; the negative
    // margins let it span the card's padding edge to edge.
    return el('div', { class: 'flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5', style: { position: 'sticky', top: '-24px', zIndex: 20, background: 'var(--card)', margin: '-24px -24px 20px', padding: '16px 24px 12px', borderBottom: '1px solid var(--border)' } },
      el('div', { class: 'flex items-center gap-4 flex-1 min-w-0' },
        avatarNode((profileForRepName(rep.name) || {}).avatar_url || null, initials, 'w-16 h-16 text-lg'),
        el('div', { class: 'flex-1 min-w-0' },
          el('div', { class: 'text-xl font-bold flex items-center gap-2 flex-wrap' },
            rep.name,
            tierMeta && el('span', {
              class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
              style: { background: tierMeta.color + '22', color: tierMeta.color },
            }, tierMeta.label),
          ),
          el('div', { class: 'text-xs text-muted- mt-1 flex items-center gap-2 flex-wrap tabular-nums' },
            // (team + office labels removed — identity is name + tier here)
            // Selling days = days with ≥1 sale, scoped to the timeframe
            // dropdown (which already names the window — no need to repeat
            // a second figure here).
            (() => {
              const scopedDays = new Set((scopedRep.sales || []).map(x => dateSoldToIso(x.dateSold)).filter(Boolean)).size;
              return el('span', {},
                el('b', { style: { color: 'var(--text)' } }, fmt.int(scopedDays)),
                ' selling days',
              );
            })(),
          ),
        ),
        el('button', {
          class: 'sm:hidden text-xl text-muted- transition leading-none self-start ml-auto',
          style: { lineHeight: '1' },
          onclick: () => overlay.remove(),
        }, '×'),
      ),
      el('div', { class: 'flex items-center gap-2 sm:gap-3 shrink-0 flex-wrap' },
        // Sales ↔ Retention view toggle — Retention mirrors the Auditing
        // player card (audits, serviced/active/cancelled revenue, attrition)
        // computed from this rep's sales in the shared dataset, so reps can
        // see it without the admin-only Reporting snapshot.
        fullAccess && el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
          ...[['sales', 'Sales'], ['retention', 'Retention']].map(([vid, lab]) => el('button', {
            class: 'px-2.5 py-1 text-[11px] font-semibold transition',
            style: cardView === vid
              ? { background: 'var(--accent)', color: 'var(--accent-text)' }
              : { background: 'transparent', color: 'var(--text)' },
            onclick: () => { if (cardView !== vid) { cardView = vid; retDrill = null; renderBody(); } },
          }, lab)),
        ),
        // Scope dropdown — every stat / chart in the modal recomputes to
        // this window. Anchored to the dataset's latest sale date so
        // "Today" means the data's latest, not the system clock. The
        // resolved date range shows as a subtle chip to the left so the
        // dropdown + close button stay on a tidy single line.
        scopeRangeLabel && el('span', {
          class: 'text-[10px] text-muted- tabular-nums whitespace-nowrap px-2 py-1 rounded',
          style: { background: 'var(--card-2)', border: '1px solid var(--border)' },
        }, scopeRangeLabel),
        el('select', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer bg-transparent',
          style: { borderColor: 'var(--border-2)' },
          onchange: (e) => { cardScope = e.target.value; _trendWkOff = 0; renderBody(); },
        },
          ...CARD_SCOPE_PRESETS.map(p => el('option', { value: p.id, selected: cardScope === p.id }, p.label)),
        ),
        el('button', {
          class: 'hidden sm:block text-xl text-muted- hover:text-default transition leading-none -mr-1',
          style: { lineHeight: '1' },
          onclick: () => overlay.remove(),
        }, '×'),
      ),
    );
  }

  // ── Render & re-render ──────────────────────────────────────────────────
  function renderBody() {
    applyScope();  // refresh scopedRep / scopedAllRepRecords / scopedStats
    modal.innerHTML = '';
    if (cardView === 'retention' && fullAccess) { modal.append(header(), retentionBlock()); return; }
    modal.append(
      header(),
      statsGrid(),
      recordsStrip(),
      (_calMode === 'calendar' ? sellDaysCalendarBlock() : dayHourHeatmapBlock()),
      trendsBlock(),
      powerHourBlock(),
      // Full Subscription Mix table (same one as the Indicators page),
      // scoped to this rep's accounts in the current date scope.
      (scopedRep.sales && scopedRep.sales.length)
        ? el('div', { class: 'mb-5' }, indicatorSubscriptionMixCard(scopedRep.sales, { subtitleSuffix: ' · ' + (rep.name || 'this rep') }))
        : topSubsBlock(),
      drillBlock() || el('div', {}),
    );
    // When the records leaderboard is open, scroll the current rep's row
    // into view inside the leaderboard's scroll container so the user
    // immediately sees their position in context.
    if (recordsLeaderKey) {
      requestAnimationFrame(() => {
        const me = modal.querySelector('.js-leader-current');
        const scroller = me?.closest('.scroll-x');
        if (me && scroller) {
          const meTop = me.offsetTop - scroller.offsetTop;
          scroller.scrollTop = Math.max(0, meTop - scroller.clientHeight / 2 + me.clientHeight / 2);
        }
      });
    }
  }

  renderBody();
  document.body.append(overlay);
}

function badgeChip(code) {
  const def = BADGE_DEFS[code];
  if (!def) return null;
  const chip = el('span', {
    class: 'inline-flex items-center justify-center rounded-full text-[11px] leading-none tooltip-trigger',
    style: {
      width: '20px',
      height: '20px',
      background: def.color + '22',
      border: '1px solid ' + def.color + '55',
    },
  }, def.emoji);
  attachTooltip(chip, {
    title: def.label,
    desc: def.desc,
  });
  return chip;
}

// Keep an absolutely-positioned dropdown panel INSIDE the viewport. Panels
// anchor left/right of their button; near a screen edge that pushed them
// off-screen (mobile especially). Call after the panel opens (or renders
// open) — measures after paint and shifts via transform, anchor-agnostic.
function clampDropdownPanel(panel) {
  if (!panel) return;
  panel.style.maxWidth = 'calc(100vw - 16px)';
  requestAnimationFrame(() => {
    try {
      if (!panel.isConnected || panel.style.display === 'none') return;
      panel.style.transform = '';
      const r = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      if (r.left < 8) panel.style.transform = 'translateX(' + (8 - r.left) + 'px)';
      else if (r.right > vw - 8) panel.style.transform = 'translateX(' + ((vw - 8) - r.right) + 'px)';
    } catch (e) { /* measurement only — never break the render */ }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Floating tooltip — one shared element pooled on the body
// ──────────────────────────────────────────────────────────────────────────
let _tooltipEl = null;
function ensureTooltipEl() {
  if (_tooltipEl) return _tooltipEl;
  _tooltipEl = el('div', { class: 'ridd-tooltip' });
  document.body.append(_tooltipEl);
  return _tooltipEl;
}

function attachTooltip(target, { title, desc }) {
  const showTip = () => {
    const tip = ensureTooltipEl();
    tip.innerHTML = '';
    if (title) tip.append(el('strong', {}, title));
    if (desc) {
      if (Array.isArray(desc)) desc.forEach(line => tip.append(el('div', { class: 'desc' }, line)));
      else tip.append(el('span', { class: 'desc' }, desc));
    }
    tip.classList.add('show');

    // Position above the target, centered horizontally
    const rect = target.getBoundingClientRect();
    // We need the tooltip size after content is set
    tip.style.left = '0px';
    tip.style.top  = '0px';
    const tRect = tip.getBoundingClientRect();
    const left = rect.left + rect.width / 2 - tRect.width / 2;
    let top  = rect.top - tRect.height - 10;
    // Flip below the target when there's no room above — triggers near the
    // top of the viewport were pushing the tip off-screen.
    tip.classList.remove('below');
    if (top < 8) { top = rect.bottom + 10; tip.classList.add('below'); }
    // Clamp to viewport
    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - tRect.width - 8));
    tip.style.left = clampedLeft + 'px';
    tip.style.top  = Math.max(8, Math.min(top, window.innerHeight - tRect.height - 8)) + 'px';
  };
  const hideTip = () => {
    if (_tooltipEl) _tooltipEl.classList.remove('show');
  };
  target.addEventListener('mouseenter', showTip);
  target.addEventListener('mouseleave', hideTip);
  target.addEventListener('focus', showTip);
  target.addEventListener('blur', hideTip);
}

// Hover (desktop) + tap-to-toggle (mobile) explainer. Same floating tooltip
// as attachTooltip, but a click/tap pins it open and tapping anywhere else
// dismisses — so touch users can read the calculation breakdowns too.
function attachExplainer(target, opts) {
  attachTooltip(target, opts);
  // Stamp show-time so a mobile tap (which fires mouseenter + click together)
  // doesn't immediately toggle the tip back off. Explainers also widen the
  // shared tooltip so multi-line calculation breakdowns stay readable.
  target.addEventListener('mouseenter', () => { const t = ensureTooltipEl(); t.classList.add('wide'); t._shownAt = Date.now(); });
  target.addEventListener('mouseleave', () => { ensureTooltipEl().classList.remove('wide'); });
  target.addEventListener('click', (e) => {
    e.stopPropagation();
    const tip = ensureTooltipEl();
    if (tip.classList.contains('show') && Date.now() - (tip._shownAt || 0) > 400) {
      tip.classList.remove('show', 'wide');
    } else {
      target.dispatchEvent(new Event('mouseenter'));
      tip._shownAt = Date.now();
    }
  });
  if (!window._explainerDismissBound) {
    window._explainerDismissBound = true;
    document.addEventListener('click', () => { if (_tooltipEl) _tooltipEl.classList.remove('show', 'wide'); });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// REP PROFILE MODAL — click a rep name on the leaderboard
// ──────────────────────────────────────────────────────────────────────────
function openRepProfileModal(repId) {
  const profile = state.allProfiles.find(p => p.id === repId) || state.profile;
  const repSales = dashboardSales().filter(s => s.rep_id === repId);
  const records = computeRepRecords(repId, repSales);
  const badges = computeBadges();
  const repBadges = [...(badges[repId] || [])];
  const leaderRow = computeLeaderboard('total').find(r => r.rep_id === repId);

  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const ytdSales = repSales.filter(s => !EXCLUDE.has(s.audit_status) && new Date(s.sold_date + 'T00:00') >= new Date(new Date().getFullYear(), 0, 1));
  const ytdRevenue = ytdSales.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);

  const modal = el('div', { class: 'card w-full max-w-2xl p-6 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } },
    // Header
    el('div', { class: 'flex items-center justify-between mb-5' },
      el('button', { class: 'text-xs text-muted- hover:text-default transition', onclick: () => overlay.remove() }, '← Back'),
      el('button', { class: 'text-2xl text-muted-', onclick: () => overlay.remove() }, '×'),
    ),

    // Avatar + name + badges. No email here (kept private to the Users tab).
    // Clicking the avatar blows it up in a lightbox.
    el('div', { class: 'flex items-center gap-4 mb-5' },
      (() => {
        const av = el('button', {
          class: 'shrink-0 rounded-full transition',
          style: { lineHeight: '0', cursor: profile.avatar_url ? 'zoom-in' : 'default' },
          title: profile.avatar_url ? 'Click to enlarge' : undefined,
          onclick: () => {
            if (!profile.avatar_url) return;
            const lb = el('div', {
              class: 'modal-overlay',
              style: { zIndex: '10001', cursor: 'zoom-out' },
              onclick: () => lb.remove(),
            },
              el('img', {
                src: profile.avatar_url, alt: profile.full_name || 'Profile photo',
                style: { width: 'min(70vw, 420px)', height: 'min(70vw, 420px)', objectFit: 'cover',
                         borderRadius: '50%', boxShadow: '0 24px 80px rgba(0,0,0,.5)', border: '4px solid rgba(255,255,255,.9)' },
              }),
            );
            document.body.append(lb);
          },
        }, avatarNode(profile.avatar_url, profile.initials, 'w-16 h-16 text-lg'));
        return av;
      })(),
      el('div', { class: 'flex-1' },
        el('div', { class: 'text-xl font-bold flex items-center gap-2 flex-wrap' },
          profile.full_name,
          ...repBadges.map(code => badgeChip(code)),
        ),
        el('div', { class: 'text-xs text-muted- mt-0.5' }, roleLabel(profile.role)),
      ),
    ),

    // YTD Stats grid
    el('div', { class: 'grid grid-cols-3 sm:grid-cols-5 gap-3 mb-5' },
      ...([
        ['Sales', fmt.int(leaderRow?.count || 0)],
        ['Revenue', fmt.usd0(leaderRow?.revenue || 0)],
        ['ACV', fmt.usd0(leaderRow?.acv || 0)],
        ['MY %', fmt.pct(leaderRow?.my_pct || 0)],
        ['Rec Mix', fmt.pct(leaderRow?.rec_mix_pct || 0)],
      ].map(([label, value]) => el('div', { class: 'card-2 rounded-xl p-3 text-center border border-' },
        el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold' }, label),
        el('div', { class: 'text-lg font-bold tabular-nums mt-1' }, value),
      ))),
    ),

    // Personal records
    el('div', { class: 'mb-5' },
      el('h3', { class: 'text-sm font-bold mb-2' }, 'Personal Records'),
      el('div', { class: 'grid grid-cols-3 gap-3' },
        recordStat('Best Day',   records.bestDay.revenue,   records.bestDay.count,   records.bestDay.date),
        recordStat('Best Week',  records.bestWeek.revenue,  records.bestWeek.count,  records.bestWeek.weekStart),
        recordStat('Best Month', records.bestMonth.revenue, records.bestMonth.count, records.bestMonth.month),
      ),
    ),

    // Badge collection
    repBadges.length > 0 && el('div', { class: 'mb-5' },
      el('h3', { class: 'text-sm font-bold mb-2' }, 'Badges'),
      el('div', { class: 'flex flex-wrap gap-2' },
        ...repBadges.map(code => {
          const def = BADGE_DEFS[code];
          return def ? el('div', { class: 'flex items-center gap-2 px-3 py-2 rounded-xl border border-', style: { background: def.color + '10' } },
            el('span', { class: 'text-lg' }, def.emoji),
            el('div', {},
              el('div', { class: 'text-xs font-semibold' }, def.label),
              el('div', { class: 'text-[10px] text-muted-' }, def.desc),
            ),
          ) : null;
        }),
      ),
    ),

    // Recent sales
    el('div', {},
      el('h3', { class: 'text-sm font-bold mb-2' }, 'Recent Sales'),
      repSales.length === 0
        ? el('div', { class: 'text-sm text-muted- italic' }, 'No sales logged yet.')
        : el('div', { class: 'scroll-x' },
            el('table', { class: 'w-full text-[12px]' },
              el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
                el('tr', {},
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Customer'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Service'),
                  el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Revenue'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Date'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Status'),
                ),
              ),
              el('tbody', {},
                repSales.slice(0, 10).map(s => el('tr', { class: 'border-t border-' },
                  el('td', { class: 'px-2 py-2 font-medium' }, s.customer_name),
                  el('td', { class: 'px-2 py-2 text-muted-' }, nameFromId(state.serviceTypes, s.service_type_id)),
                  el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.usd(s.revenue_amount)),
                  el('td', { class: 'px-2 py-2 text-muted- tabular-nums' }, fmt.dateShort(s.sold_date)),
                  el('td', { class: 'px-2 py-2' }, statusChip(s.audit_status)),
                )),
              ),
            ),
          ),
    ),
  );

  overlay.append(modal);
  document.body.append(overlay);
}

function avatarNode(url, initials, sizeClass = 'w-10 h-10 text-xs') {
  if (url) {
    return el('img', {
      src: url, alt: initials || '',
      class: `${sizeClass} rounded-full object-cover shrink-0 border border-`,
      onerror: "this.style.display='none';this.nextSibling&&(this.nextSibling.style.display='flex')",
    });
  }
  return el('div', {
    class: `${sizeClass} rounded-full shrink-0 flex items-center justify-center font-bold uppercase`,
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
  }, (initials || '?').slice(0, 2));
}

// ──────────────────────────────────────────────────────────────────────────
// TODAY'S SALES PANEL — left side of the dashboard split
// Columns: TIME · REP · CUSTOMER · SALE TYPE · REVENUE
// ──────────────────────────────────────────────────────────────────────────
function todaysSalesPanel(windowSales, range) {
  // Most recent first — ALWAYS (per Isaac). CRM rows carry a floating
  // office-local wall clock while app-logged rows carry real UTC, so a naive
  // Date() compare interleaved them wrong. Put both on the display zone's
  // wall clock (the same clock the Time column shows) before comparing.
  const _dispTz0 = warRoomTz();
  const _wallMs = (s) => {
    if (s._crm && s.created_at) {
      const m = String(s.created_at).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (m) {
        const shift = (_TZ_RAW_OFFSET[_dispTz0] ?? 1) - _saleHourOffset(s._crmOffice);
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + shift, +m[5]);
      }
    }
    if (s.created_at) {
      try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: _dispTz0, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(s.created_at)).map(x => [x.type, x.value]));
        return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
      } catch (e) { return new Date(s.created_at).getTime(); }
    }
    const d = String(s.sold_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return d ? Date.UTC(+d[1], +d[2] - 1, +d[3]) : 0;
  };
  const rows = [...windowSales].sort((a, b) => _wallMs(b) - _wallMs(a));

  const titleByRange = {
    today:      "Today's Sales",
    yesterday:  "Yesterday's Sales",
    week:       "This Week's Sales",
    last_week:  "Last Week's Sales",
    month:      "This Month's Sales",
    last_month: "Last Month's Sales",
    year:       "This Year's Sales",
    last_year:  "Last Year's Sales",
    all:        "All Sales",
    custom:     "Custom Range",
  };
  const title = titleByRange[state.dashDateRange] || "Sales";

  const header = el('div', { class: 'px-5 py-3 flex items-center justify-between border-b', style: { borderColor: 'var(--border)' } },
    el('h3', { class: 'text-base font-bold' }, title),
    rows.length > 0 && el('span', { class: 'text-xs text-muted-' }, rows.length + ''),
  );

  if (rows.length === 0) {
    return el('div', { class: 'card overflow-hidden flex flex-col' },
      header,
      el('div', { class: 'flex-1 flex items-center justify-center py-16 text-muted- text-sm' }, 'No sales'),
    );
  }

  // ACV helper
  const saleAcv = (s) => {
    if (s._crm) return Number(s.revenue_amount || 0); // CRM contract value is exact
    const init = Number(s.initial_amount || 0);
    const rec  = Number(s.monthly_amount || 0);
    if (s.pay_per_service) {
      return init + Number(s.num_services || 0) * rec;
    }
    return init + rec * 12;
  };

  // Resolve contract type name — prefer contract_type_id, fallback to contract_months
  // Four buckets only — 12 Mo / 18 Mo / 24 Mo / One-Time — for EVERY row,
  // CRM-synced and manually logged upsells alike.
  const _ctBucket = (m) => m >= 21 ? '24 Mo' : m >= 15 ? '18 Mo' : '12 Mo';
  const contractTypeName = (s) => {
    const svcNm = String(s._crmService || nameFromId(state.serviceTypes, s.service_type_id) || '').trim();
    // Sentricon is ALWAYS a 12-month program (per Isaac). Anything else on a
    // Sentricon account is a data error — the audit queue flags it.
    if (/sentricon/i.test(svcNm)) return '12 Mo';
    const m = Number(s.contract_months);
    if (m > 1) return _ctBucket(m);
    if (s._crm) {
      // CRM has no agreement length on this subscription. Before calling it
      // One-Time, check the service Lifecycle config — recurring services
      // default to the 12 Mo bucket. Durable fix: set the agreement length
      // on the sub in FieldRoutes.
      try {
        const rec = (typeof reportingServiceRecurringMap === 'function') ? reportingServiceRecurringMap() : null;
        if (rec && svcNm && rec.get(svcNm)) return '12 Mo';
      } catch (e) { /* fall through */ }
    }
    return 'One-Time';
  };

  return el('div', { class: 'card overflow-hidden flex flex-col' },
    header,
    // ~10 rows visible, the rest scroll in place (per Isaac).
    // Fixed column layout so the feed never needs a sideways scroll (per
    // Isaac): Time / Contract / ACV get fixed widths, Rep + Service share
    // the rest and ellipsize.
    el('div', { style: { maxHeight: '412px', overflowY: 'auto', overflowX: 'hidden' } },
      el('table', { class: 'w-full text-[11px]', style: { tableLayout: 'fixed' } },
        el('colgroup', {},
          el('col', { style: { width: '58px' } }), el('col', { style: { width: '30%' } }), el('col', {}),
          el('col', { style: { width: '54px' } }), el('col', { style: { width: '62px' } })),
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-', style: { position: 'sticky', top: '0', background: 'var(--card)', zIndex: '1' } },
          el('tr', {},
            el('th', { class: 'text-left pl-3 pr-1 py-1.5 font-semibold', title: 'Shown in ' + (_TZ_SHORT[warRoomTz()] || 'MT') + ' — change your time zone under the gear → My Settings' }, 'Time'),
            el('th', { class: 'text-left px-1 py-1.5 font-semibold' }, 'Rep'),
            el('th', { class: 'text-left px-1 py-1.5 font-semibold' }, 'Service'),
            el('th', { class: 'text-left px-1 py-1.5 font-semibold' }, 'Contract'),
            el('th', { class: 'text-right pr-3 py-1.5 font-semibold' }, 'ACV'),
          ),
        ),
        el('tbody', {},
          // First 25 by default; Show more reveals in batches. Totals above
          // always count every row regardless of what's rendered.
          rows.slice(0, state._dashFeedLimit || 25).map(s => {
            const rep = state.allProfiles.find(p => p.id === s.rep_id)
              || (s._crm ? null : state.profile);
            const crmName = flipLastFirst(s._crmRep || '');   // CRM exports "Last, First"
            const first = rep ? (rep.full_name || '').split(' ')[0] : (crmName.split(' ')[0] || '—');
            const crmInitials = crmName ? crmName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
            // CRM rows carry a FLOATING office-local wall-clock (built in the
            // bridge) — shift it into the display zone by offset difference.
            // App-logged rows carry a real UTC timestamp — format directly.
            const _dispTz = warRoomTz();
            let timeStr = '—';
            if (s._crm && s.created_at) {
              const m = String(s.created_at).match(/T(\d{2}):(\d{2})/);
              if (m) {
                const shift = (_TZ_RAW_OFFSET[_dispTz] ?? 1) - _saleHourOffset(s._crmOffice);
                const h = (Number(m[1]) + shift + 24) % 24;
                timeStr = (h % 12 || 12) + ':' + m[2] + (h >= 12 ? 'p' : 'a');
              }
            } else if (s.created_at) {
              try { timeStr = new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: _dispTz }); }
              catch (e) { timeStr = new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
              timeStr = timeStr.replace(/\s*AM$/i, 'a').replace(/\s*PM$/i, 'p');
            }
            const svcName = nameFromId(state.serviceTypes, s.service_type_id);
            // (The "⏳ syncing" chip is retired here — per Isaac. The row is
            // counted immediately either way; the CRM copy replaces it on sync.)
            const pendingChip = null;
            const ctName  = contractTypeName(s);
            const _ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
            return el('tr', { class: 'border-t border-' },
              el('td', { class: 'pl-3 pr-1 py-2 text-muted- tabular-nums whitespace-nowrap' }, timeStr),
              el('td', { class: 'px-1 py-2', style: _ell },
                el('div', { class: 'flex items-center gap-1.5 min-w-0' },
                  avatarNode(rep?.avatar_url, rep?.initials || crmInitials, 'w-5 h-5 text-[8px]'),
                  el('span', { class: 'font-medium', style: _ell }, first),
                ),
              ),
              el('td', { class: 'px-1 py-2 text-muted-', style: _ell, title: (svcName && svcName !== '—') ? svcName : (s._crmService || '') }, (svcName && svcName !== '—') ? svcName : (s._crmService || '—'), pendingChip),
              el('td', { class: 'px-1 py-2 text-muted- whitespace-nowrap' }, ctName),
              el('td', { class: 'pr-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap' }, fmt.usd0(saleAcv(s))),
            );
          }),
        ),
      ),
      rows.length > (state._dashFeedLimit || 25) && el('button', {
        class: 'w-full px-2.5 py-1 text-center text-[11px] font-semibold border-t border- cursor-pointer transition hover:brightness-95',
        style: { color: 'var(--accent)' },
        onclick: () => { state._dashFeedLimit = (state._dashFeedLimit || 25) + 50; mountApp(); },
      }, 'Show more · ' + fmt.int(rows.length - (state._dashFeedLimit || 25)) + ' remaining'),
    ),
  );
}

function leaderboardSection(range) {
  // Scoped to the dashboard's date filter (defaults to Today) — one filter
  // drives the whole page: cards, feed, and leaderboard.
  // Only reps with a recorded sale in the selected window rank — no
  // "No sales" filler rows (on Today that's usually just a name or two).
  const rowsAll = computeLeaderboard(state.dashLeaderTab, range || getDateRange(state.dashDateRange)).filter(r => r.count > 0);
  // Per-rep show/hide for this board. Session-only on purpose: a filter you
  // set and forget is how a rep goes missing without anyone noticing, so it
  // resets on reload and the button reads "N/M" the whole time it is on.
  // Keyed on rep_id, falling back to the name for CRM sellers with no app
  // account (r._noProfile), whose rep_id is synthetic.
  const _lbKey = (r) => String(r.rep_id || r.full_name || '');
  // Inclusion model (per Isaac): nothing ticked = everyone shows; tick reps
  // and ONLY those reps show. Session-only so a forgotten filter can't
  // quietly hide someone across reloads.
  if (!(state.dashLeaderOnly instanceof Set)) state.dashLeaderOnly = new Set();
  const lbOnly = state.dashLeaderOnly;
  const rows = lbOnly.size ? rowsAll.filter(r => lbOnly.has(_lbKey(r))) : rowsAll;
  const empty = rows.length === 0;
  const repBadges = computeBadges();

  const setSort = (k) => { state.dashLeaderSort = k; mountApp(); };
  const sortIndicator = () => '';   // arrows retired app-wide — active header is highlighted instead
  const sortHl = (k) => state.dashLeaderSort === k ? { color: 'var(--accent)', fontWeight: '800' } : {};

  return el('div', { class: 'card overflow-hidden' },
    // Header with tabs
    el('div', { class: 'flex items-center justify-between px-4 py-3 flex-wrap gap-3 border-b border-' },
      el('h2', { class: 'text-base font-bold' }, 'Leaderboard'),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('div', { class: 'pill-tabs' },
          ...[['total','Total'],['new','New'],['renewals','Renewals']].map(([k, label]) =>
            el('button', {
              'data-active': state.dashLeaderTab === k,
              onclick: () => { state.dashLeaderTab = k; mountApp(); },
            }, label),
          ),
        ),
        // Rep filter — add/remove individual reps from the board.
        (() => {
          const on = lbOnly.size > 0;
          const btn = el('button', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 whitespace-nowrap',
            style: { borderColor: on ? 'var(--accent)' : 'var(--border-2)', color: on ? 'var(--accent)' : 'var(--text-muted)' },
            title: 'Tick reps to show only them on this leaderboard',
            onclick: (e) => { e.stopPropagation(); state.dashLeaderFilterOpen = !state.dashLeaderFilterOpen; mountApp(); },
          }, on ? ('Reps ' + rows.length + '/' + rowsAll.length) : 'Reps');
          if (!state.dashLeaderFilterOpen) return el('span', { style: { position: 'relative' } }, btn);
          const bulk = (label, color, fn) => el('button', {
            class: 'text-[10px] font-bold transition hover:brightness-95',
            style: { color: color, background: 'transparent' },
            onclick: () => { fn(); mountApp(); },
          }, label);
          const panel = el('div', {
            class: 'card',
            style: { minWidth: '210px', padding: '8px', boxShadow: 'var(--shadow-lg)' },
          },
            el('div', { class: 'flex items-center justify-between gap-2 px-1 pb-2' },
              el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-bold' }, 'Show reps'),
              el('div', { class: 'flex items-center gap-2' },
                bulk('All', 'var(--accent)', () => rowsAll.forEach(r => lbOnly.add(_lbKey(r)))),
                bulk('Clear', 'var(--text-muted)', () => lbOnly.clear()))),
            rowsAll.length === 0
              ? el('div', { class: 'px-1 py-2 text-[11px] text-muted-' }, 'No reps with sales in this window.')
              : el('div', { class: 'flex flex-col', style: { maxHeight: '260px', overflowY: 'auto' } },
                  ...rowsAll.map(r => {
                    const k = _lbKey(r);
                    const isOn = lbOnly.has(k);
                    const cb = el('input', { type: 'checkbox', style: { cursor: 'pointer', flexShrink: '0', accentColor: 'var(--accent)' } });
                    if (isOn) cb.setAttribute('checked', '');
                    cb.checked = isOn;
                    cb.onchange = () => { if (cb.checked) lbOnly.add(k); else lbOnly.delete(k); mountApp(); };
                    return el('label', { class: 'flex items-center gap-2 px-1 py-1.5 rounded-lg cursor-pointer text-xs' },
                      cb, el('span', { class: 'truncate' }, r.full_name || r.first_name));
                  })));
          _anchorPopover(panel, btn, 'right');
          return el('span', { style: { position: 'relative' } }, btn, panel);
        })(),
      ),
    ),
    // Table
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-[12px]' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
          el('tr', {},
            el('th', { class: 'text-left pl-4 pr-1 py-2', style: { position: 'sticky', left: '0', background: 'var(--card)', zIndex: 2, minWidth: '40px', width: '40px' } }, '#'),
            el('th', { class: 'text-left px-2 py-2', style: { position: 'sticky', left: '40px', background: 'var(--card)', zIndex: 2 } }, 'Rep'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('sales'), onclick: () => setSort('sales') }, 'Sales'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('initial'), title: 'Average initial invoice per sale', onclick: () => setSort('initial') }, 'Initial'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('revenue'), onclick: () => setSort('revenue') }, 'Revenue'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('recurring'), title: 'Contract revenue only — total revenue minus one-time service revenue', onclick: () => setSort('recurring') }, 'Rec. Rev'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('ots'), title: 'One-time service revenue (no contract months)', onclick: () => setSort('ots') }, 'OTS Rev'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('acv'), title: 'Average contract value across ALL sales, one-time services included', onclick: () => setSort('acv') }, 'ACV'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('auto_pay'), title: 'Sales on auto-pay \u00f7 CRM-synced sales (manual upsell logs don\'t carry the field)', onclick: () => setSort('auto_pay') }, 'APay %'),

            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', style: sortHl('my_pct'), title: 'Multi-year contracts (18+ mo) / all contract sales', onclick: () => setSort('my_pct') }, 'MY %'),
            el('th', { class: 'text-right pl-2 pr-4 py-2 cursor-pointer select-none hover:text-default', style: sortHl('rec_mix_pct'), title: '12/18/24-mo contracts / (contracts + one-time services)', onclick: () => setSort('rec_mix_pct') }, 'Rec Mix %'),
          ),
        ),
        el('tbody', {},
          // ── RIDD totals — the whole department under the current filter,
          // pinned as the first row (per Isaac) so reps race a visible bar.
          (() => {
            if (!rows.length) return null;
            const t = rows.reduce((a, r) => ({
              count: a.count + (r.count || 0), revenue: a.revenue + (r.revenue || 0),
              recurring: a.recurring + (r.recurring || 0), ots: a.ots + (r.ots || 0),
              initSum: a.initSum + (r.initial || 0) * (r.count || 0),
              myW: a.myW + (r.my_pct || 0) * (r.count || 0), mixW: a.mixW + (r.rec_mix_pct || 0) * (r.count || 0),
              apW: a.apW + (r.auto_pay_pct != null ? r.auto_pay_pct * (r.count || 0) : 0),
              apN: a.apN + (r.auto_pay_pct != null ? (r.count || 0) : 0),
            }), { count: 0, revenue: 0, recurring: 0, ots: 0, initSum: 0, myW: 0, mixW: 0, apW: 0, apN: 0 });
            const stick = (left) => ({ position: 'sticky', left, background: 'var(--card-2)', zIndex: 1 });
            return el('tr', { class: 'border-b-2 tabular-nums font-black', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
              el('td', { class: 'pl-4 pr-1 py-2 text-base leading-none', style: Object.assign({ minWidth: '40px', fontFamily: 'Georgia, "Times New Roman", serif' }, stick('0')) }, '\ud835\udd7d'),
              el('td', { class: 'px-2 py-2 whitespace-nowrap', style: stick('40px') },
                lbOnly.size ? 'Total' : 'RIDD',
                el('span', { class: 'text-[10px] text-muted- ml-1.5 font-normal' }, rows.length + ' rep' + (rows.length === 1 ? '' : 's'))),
              el('td', { class: 'px-2 py-2 text-right' }, fmt.int(t.count)),
              el('td', { class: 'px-2 py-2 text-right' }, t.count ? fmt.usd0(t.initSum / t.count) : '—'),
              el('td', { class: 'px-2 py-2 text-right' }, fmt.usd0(t.revenue)),
              el('td', { class: 'px-2 py-2 text-right' }, fmt.usd0(t.recurring)),
              el('td', { class: 'px-2 py-2 text-right' }, t.ots > 0 ? fmt.usd0(t.ots) : '\u2014'),
              el('td', { class: 'px-2 py-2 text-right' }, t.count ? fmt.usd0(t.revenue / t.count) : '—'),
              el('td', { class: 'px-2 py-2 text-right' }, t.apN ? fmt.pct(t.apW / t.apN) : '\u2014'),
              el('td', { class: 'px-2 py-2 text-right' }, t.count ? fmt.pct(t.myW / t.count) : '—'),
              el('td', { class: 'pl-2 pr-4 py-2 text-right' }, t.count ? fmt.pct(t.mixW / t.count) : '—'));
          })(),
          rows.map((r, i) => {
            const isMe = r.rep_id === state.profile.id;
            return el('tr', {
              class: 'border-t border- hover:brightness-95 transition',
              style: isMe ? { background: 'rgba(223,100,58,.08)' } : {},
            },
              el('td', {
                class: 'pl-4 pr-1 py-2 font-bold tabular-nums' + (i === 0 && r.count > 0 ? ' text-base' : ''),
                style: Object.assign({ position: 'sticky', left: '0', background: 'var(--card)', zIndex: 1, minWidth: '40px' }, i === 0 && r.count > 0 ? { color: 'var(--accent)' } : {}),
              }, i + 1),
              el('td', { class: 'px-2 py-2', style: { position: 'sticky', left: '40px', background: 'var(--card)', zIndex: 1 } },
                el('div', {
                  class: 'flex items-center gap-2 cursor-pointer',
                  onclick: () => openDashboardPlayerCard(r.rep_id),
                  title: 'Open ' + (r.full_name || r.first_name) + '\'s player card',
                },
                  avatarNode(r.avatar_url, r.initials, 'w-7 h-7 text-[9px]'),
                  el('div', { class: 'flex-1 min-w-0' },
                    el('div', { class: 'font-semibold' + (r._noProfile ? '' : ' hover:underline') }, r.full_name || r.first_name),
                    // Badges drop below the name so they don't crowd the
                    // first-name line. Hidden when the rep has none.
                    (repBadges[r.rep_id] || []).length > 0 && el('div', { class: 'flex items-center gap-1 flex-wrap mt-0.5' },
                      ...[...(repBadges[r.rep_id] || [])].map(code => badgeChip(code)),
                    ),
                  ),
                ),
              ),
              r.count === 0
                ? el('td', { class: 'px-2 py-2 text-subtle- italic', colspan: 9 }, 'No sales')
                : [
                    el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.int(r.count)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, fmt.usd0(r.initial)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold' }, fmt.usd0(r.revenue)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, fmt.usd0(r.recurring)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, r.ots > 0 ? fmt.usd0(r.ots) : '\u2014'),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, fmt.usd0(r.acv)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' },
                      r.auto_pay_pct == null ? '\u2014' : fmt.pct(r.auto_pay_pct)),

                    el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.pct(r.my_pct)),
                    el('td', { class: 'pl-2 pr-4 py-2 text-right tabular-nums' }, fmt.pct(r.rec_mix_pct)),
                  ],
            );
          }),
        ),
      ),
    ),
    empty && el('div', { class: 'px-5 py-3 text-xs text-muted- border-t border-' }, 'No sales in this window yet — first one on the board takes #1'),
  );
}

function leaderboardTable(rows) {
  // Legacy wrapper for any old callers. New code should call leaderboardSection().
  return leaderboardSection();
  // unreachable old code kept for reference
  if (!rows.length) return el('div', { class: 'card p-6 text-center text-battle-2 text-sm' }, 'Leaderboard will show up once sales are approved this month.');
  const sorted = [...rows].sort((a, b) => Number(b.approved_revenue) - Number(a.approved_revenue));
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-sm' },
        el('thead', { class: 'text-[10px] uppercase tracking-widest text-battleship bg-eerie3' },
          el('tr', {},
            el('th', { class: 'text-left px-4 py-2 w-10' }, '#'),
            el('th', { class: 'text-left px-4 py-2' }, 'Rep'),
            el('th', { class: 'text-left px-4 py-2 desktop-only' }, 'Office'),
            el('th', { class: 'text-right px-4 py-2' }, 'Sales'),
            el('th', { class: 'text-right px-4 py-2' }, 'Revenue'),
          ),
        ),
        el('tbody', {},
          sorted.map((r, i) => {
            const isMe = r.rep_id === state.profile.id;
            return el('tr', { class: 'border-t border-eerie3' + (isMe ? ' bg-lime/10' : '') },
              el('td', { class: 'px-4 py-2.5 font-bold tabular-nums' + (i === 0 ? ' text-lime' : '') }, i + 1),
              el('td', { class: 'px-4 py-2.5 font-medium' }, r.full_name + (isMe ? ' (you)' : '')),
              el('td', { class: 'px-4 py-2.5 text-battle-2 desktop-only' }, r.office || '—'),
              el('td', { class: 'px-4 py-2.5 text-right tabular-nums' }, fmt.int(r.approved_sales)),
              el('td', { class: 'px-4 py-2.5 text-right tabular-nums font-medium' }, fmt.usd0(r.approved_revenue)),
            );
          }),
        ),
      ),
    ),
  );
}

function statusChip(s) {
  const cls = {
    pending:        'chip-pending',
    serviced:       'chip-serviced',
    cancelled:      'chip-rejected',
    below_minimums: 'chip-below',
    nsf:            'chip-nsf',
    not_payable:    'chip-below',
    reschedule:     'chip-pending',
    // Legacy aliases
    approved:       'chip-approved',
    rejected:       'chip-rejected',
  }[s] || 'chip-pending';
  const label = {
    below_minimums: 'Below Min',
    nsf:            'NSF',
    not_payable:    'Not Payable',
    reschedule:     'Reschedule',
  }[s] || (s || '').replace('_', ' ');
  return el('span', { class: 'chip ' + cls }, label);
}

function nameFromId(list, id) { return list.find(x => x.id === id)?.name || '—'; }
function idFromName(list, name) { return list.find(x => x.name === name)?.id; }

