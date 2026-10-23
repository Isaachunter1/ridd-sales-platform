// MAIN APP SHELL
// ──────────────────────────────────────────────────────────────────────────
// The header names the MAIN tab, not the sub-tab (per Isaac, Oct 16): Pay, Scorecards, Calendar and
// Hall of Fame all live under Sales, so they all read SALES.
const TAB_TITLES = {
  dashboard:    'SALES',
  sales:        'SALES',
  pay:          'SALES',
  calendar:     'SALES',
  competitions: 'COMPETITIONS',
  hall_of_fame: 'SALES',
  d2d_hof:      'SALES',
  tech_hof:     'SALES',
  loyalty_dashboard: 'LOYALTY',
  loyalty_renewals: 'LOYALTY',
  loyalty_health: 'LOYALTY',
  queues:       'QUEUES',
  indicators:   'INDICATORS',
  nrla:         'COMPETITIONS',
  scorecards:   'SALES',
  reporting:    'REPORTING',
  marketing:    'MARKETING',
  commission:   'SALES',
  d2d_dashboard: 'SALES',
  d2d_sales:    'SALES',
  techs:        'SALES',
  all_dashboard: 'SALES',
  tech_sales:   'SALES',
  tech_pay:     'SALES',
  admin:        'SETTINGS',
};

// #history is kept as a legacy alias — it lands the user on Sales tab with
// the History queue pill pre-selected (see boot/hashchange handlers below).
const HASH_MAP = { '#dashboard':'dashboard', '#sales':'sales', '#pay':'pay', '#calendar':'calendar', '#history':'sales', '#competitions':'competitions', '#halloffame':'dashboard', '#indicators':'indicators', '#nrla':'nrla', '#scorecards':'scorecards', '#reporting':'reporting', '#marketing':'marketing', '#commission':'commission', '#d2ddash':'d2d_dashboard', '#d2dupfront':'commission', '#d2dsales':'d2d_sales', '#techs':'techs', '#d2dhof':'d2d_dashboard', '#techhof':'techs', '#alldash':'all_dashboard', '#techsales':'tech_sales', '#techpay':'tech_pay', '#admin':'admin', '#loyaltydash':'loyalty_renewals', '#renewals':'loyalty_renewals', '#health':'loyalty_health' };
const VIEW_TO_HASH = Object.fromEntries(Object.entries(HASH_MAP).map(([h,v])=>[v,h]));

// Only ring the bell when a sale's audit_status flips to one of these,
// OR when a CSV upload breaks a per-rep / company record.
// Everything else stays in the audit log but won't surface as a notification.
const NOTIFY_STATUSES = new Set(['cancelled', 'reschedule']);
function isNotifEntry(entry) {
  if (!entry) return false;
  if (entry.action === 'audit') return NOTIFY_STATUSES.has(entry.new_status);
  // Record-broken alerts retired (auto-sync partial-day diffs made them fire
  // on every refresh) — also hides any old entries still stored in the log.
  if (entry.action === 'record_broken') return false;
  return false;
}

function buildNotifDropdown() {
  const log = (state.auditLog || []).filter(isNotifEntry);
  const unread = log.filter(e => !state.notifLastSeen || e.timestamp > state.notifLastSeen);
  const statusLabels = { cancelled: 'Cancelled', reschedule: 'Rescheduled' };

  const dropdown = el('div', { class: 'notif-dropdown card', style: { display: 'none' } },
    el('div', { class: 'flex items-center justify-between px-4 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-base font-bold' }, 'Notifications'),
      unread.length > 0 && el('button', {
        class: 'text-[10px] font-semibold', style: { color: 'var(--accent)' },
        onclick: () => { state.notifLastSeen = new Date().toISOString(); saveDemoData(); mountApp(); },
      }, 'Mark all read'),
    ),
    log.length === 0
      ? el('div', { class: 'px-4 py-6 text-center text-muted- text-xs' }, 'Nothing new')
      : el('div', { class: 'overflow-y-auto', style: { maxHeight: '320px' } },
          ...log.slice().reverse().slice(0, 20).map(entry => {
            const isUnread = !state.notifLastSeen || entry.timestamp > state.notifLastSeen;
            const isRecord = entry.action === 'record_broken';
            const recordKindLabels = { bestDay: 'Best Day', bestWeek: 'Best Week', bestMonth: 'Best Month' };
            const headline = isRecord
              ? '🆕 ' + (recordKindLabels[entry.record_kind] || entry.record_kind)
              : (statusLabels[entry.new_status] || entry.new_status);
            const headlineColor = isRecord ? 'var(--accent)' : (entry.new_status === 'cancelled' ? '#DC2626' : 'var(--accent)');
            return el('div', {
              class: 'px-4 py-2.5 border-b text-xs cursor-pointer hover:brightness-95 transition',
              style: { borderColor: 'var(--border)', fontWeight: isUnread ? '600' : '400', borderLeft: isUnread ? '3px solid var(--accent)' : '3px solid transparent' },
              onclick: () => {
                if (isRecord) {
                  // Jump to the indicators page so the manager can dig in
                  state.view = 'indicators';
                  history.replaceState(null, '', VIEW_TO_HASH['indicators'] || '#indicators');
                } else {
                  // Jump to Sales tab, filtered to this status, so the rep can act on it
                  state.salesFilters = { dateStart: '', dateEnd: '', status: entry.new_status, repId: '', contractTypeId: '' };
                  state.view = 'sales';
                  history.replaceState(null, '', VIEW_TO_HASH['sales'] || '#sales');
                }
                mountApp();
              },
            },
              el('div', { class: 'flex items-center justify-between' },
                el('span', { style: { color: headlineColor } }, headline),
                el('span', { class: 'text-muted- text-[10px]' }, timeAgo(entry.timestamp)),
              ),
              isRecord
                ? el('div', { class: 'mt-0.5' },
                    el('span', { class: 'font-semibold' }, entry.rep_name),
                    el('span', { class: 'text-muted-' }, ' · ' + fmt.usd0(entry.new_revenue) + (entry.old_revenue > 0 ? ' (was ' + fmt.usd0(entry.old_revenue) + ')' : '') + ' · ' + entry.period_label),
                  )
                : (entry.customer_name && el('div', { class: 'text-muted- mt-0.5' }, entry.customer_name)),
            );
          }),
        ),
  );
  return dropdown;
}

function buildSearchBar() {
  const wrap = el('div', { class: 'search-bar desktop-only' });
  const results = el('div', { class: 'search-results card', style: { display: 'none' } });
  let timer;
  const input = el('input', {
    type: 'text', placeholder: 'Search customers...', autocomplete: 'off',
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim().toLowerCase();
        results.innerHTML = '';
        if (q.length < 2) { results.style.display = 'none'; return; }
        const source = isAdminRole(state.profile?.role) ? state.allSales : state.mySales;
        const matches = source.filter(s =>
          (s.customer_name||'').toLowerCase().includes(q) ||
          (s.customer_number||'').toLowerCase().includes(q) ||
          (s.notes||'').toLowerCase().includes(q)
        ).slice(0, 8);
        if (!matches.length) {
          results.append(el('div', { class: 'px-4 py-3 text-xs text-muted-' }, 'No results'));
        } else {
          matches.forEach(s => results.append(
            el('div', {
              class: 'px-4 py-2.5 text-xs cursor-pointer hover:brightness-95 transition border-b',
              style: { borderColor: 'var(--border)' },
              onclick: () => {
                state.view = 'sales';
                state._salesQueueFilter = 'history';
                results.style.display = 'none'; input.value = '';
                history.replaceState(null, '', VIEW_TO_HASH['sales'] || '#sales');
                mountApp();
              },
            },
              el('div', { class: 'flex items-center justify-between' },
                el('span', { class: 'font-semibold' }, s.customer_name),
                statusChip(s.audit_status),
              ),
              el('div', { class: 'text-muted- mt-0.5' }, [s.customer_number, fmt.dateShort(s.sold_date), fmt.usd(s.revenue_amount)].filter(Boolean).join(' \u00b7 ')),
            )
          ));
        }
        results.style.display = 'block';
      }, 150);
    },
    onfocus: () => { if (input.value.length >= 2) results.style.display = 'block'; },
  });
  wrap.append(
    el('div', { class: 'search-icon' }, iconSearch(14)),
    input,
    results,
  );
  setTimeout(() => document.addEventListener('mousedown', function closer(e) {
    if (!wrap.contains(e.target)) { results.style.display = 'none'; }
  }), 0);
  return wrap;
}

function mobileBottomNav() {
  const isAdmin = isAdminRole(state.profile?.role);
  const isAuditor = isAuditorRole(state.profile?.role);
  // Slot 4 is role-aware: reps see Competitions (live bingo + leaderboards
  // they check between sales), admins see Calendar (they manage scheduling).
  // The other view stays reachable through the More popover.
  // Auditors only have sales access — a single Sales slot, no More menu.
  const isRepOnly = !isAdmin && !isAuditor;
  const isOfficeStaffM = isRepOnly && isOfficeStaffRole(state.profile?.role);
  const items = isAuditor ? [
    ['sales', 'Sales', iconSales],
  ] : isRepOnly ? (isOfficeStaffM ? [
    // Office Staff reps: Inside Sales essentials + Competitions + Indicators.
    ['dashboard', 'Dashboard', iconDashboard],
    ['sales', 'Sales', iconSales],
    ['nrla', 'Comps', iconTrophy],
  ] : [
    // Sales-Rep accounts: Sales (their commission home) + Competitions +
    // rep-lite Indicators.
    [(typeof D2D_SALES_TAB_KEYS !== 'undefined' && D2D_SALES_TAB_KEYS.has(state._lastD2dTab) ? state._lastD2dTab : 'd2d_dashboard'), 'Sales', iconDollar],
    ['nrla', 'Competitions', iconTrophy],
  ]) : [
    ['dashboard', 'Dashboard', iconDashboard],
    ['sales', 'Sales', iconSales],
    ['pay', 'Pay', iconPay],
    isAdmin
      ? ['calendar', 'Calendar', iconCalendar]
      : ['competitions', 'Competitions', iconTrophy],
  ];
  const slotKeys = new Set(items.map(([k]) => k));
  const nav = el('nav', { class: 'mobile-nav' },
    ...items.map(([k, label, iconFn]) => el('button', {
      'data-active': state.view === k,
      onclick: () => { state.view = k; state._navChosen = true; history.replaceState(null,'',VIEW_TO_HASH[k]||'#'+k); mountApp(); },
    }, iconFn(20), el('span', {}, label))),
    // "More" button
    !isAuditor && !isRepOnly && (() => {
      const moreBtn = el('button', { 'data-active': !slotKeys.has(state.view) },
        iconGrid(20), el('span', {}, 'More'));
      const popover = el('div', { class: 'more-popover card', style: { display: 'none' } },
        ...[
          // Surface whichever of (Competitions, Calendar) isn't already in slot 4.
          ...(isAdmin ? [['competitions','Competitions',iconTrophy]] : [['calendar', 'Calendar', iconCalendar]]),
          // Scorecards is visible to every seller — admins see the
          // full roster, reps see only their own card (viewScorecards
          // handles the scoping). Indicators stays admin-only since
          // it's leadership-only data.
          ['scorecards','Scorecards',iconClipboard],
          ...(isAdmin ? [['reporting','Reporting',iconPie]] : []),
          ...(isAdmin ? [['admin','Settings',iconGear]] : [])
        ].map(([k,label,iconFn]) => el('button', {
          class: 'flex items-center gap-3 w-full px-2.5 py-1 text-[11px]',
          style: state.view === k ? { color: 'var(--accent)', fontWeight: '600' } : { color: 'var(--text)' },
          onclick: () => { state.view = k; state._navChosen = true; history.replaceState(null,'',VIEW_TO_HASH[k]||'#'+k); mountApp(); },
        }, iconFn(18), label)),
      );
      moreBtn.onclick = () => {
        popover.style.display = popover.style.display === 'block' ? 'none' : 'block';
        if (popover.style.display === 'block') {
          setTimeout(() => document.addEventListener('mousedown', function c(e) {
            if (!popover.contains(e.target) && !moreBtn.contains(e.target)) { popover.style.display='none'; document.removeEventListener('mousedown',c); }
          }), 0);
        }
      };
      const wrap = el('div', { class: 'relative' }, moreBtn, popover);
      return wrap;
    })(),
  );
  return nav;
}

// Recurring vs one-time for a dashboard sale (CRM row or app-logged):
// a subscription term (12/18/24) or PIF is recurring; a one-time service
// (0/1-month term, or a "One Time …" service name) is not.
function isRecurringSale(s) {
  const m = Number(s?.contract_months || 0);
  if (s?.paid_in_full || m > 1) return true;
  const svc = String(s?._crmService || (state.serviceTypes || []).find(t => t.id === s?.service_type_id)?.name || '');
  if (/one[\s-]?time/i.test(svc)) return false;
  return m > 1;
}

// Office stats for the Inside Sales dashboard (replaces the old 🏢 Office
// toggle). Collapsed by default to a one-line bar; click expands a table —
// one row per office with a sale in the window, sorted by revenue, plus a
// Total row that ties back to the KPI cards below it.
function dashOfficeStats(approved, isRenewal) {
  const officeName = (s) => {
    const o = (state.offices || []).find(o => o.id === s.office_id);
    const raw = o ? o.name : String(s._crmOffice || '').split(',')[0].trim();
    return (raw || 'Unassigned').toUpperCase();
  };
  const by = new Map();
  for (const s of approved) {
    const k = officeName(s);
    let r = by.get(k);
    if (!r) { r = { name: k, sales: 0, nw: 0, ren: 0, rev: 0, newRev: 0, renRev: 0, rec: 0, my12: 0, myMulti: 0 }; by.set(k, r); }
    const rev = Number(s.revenue_amount || 0);
    r.sales += 1; r.rev += rev;
    if (isRecurringSale(s)) r.rec += 1;
    const _cm = Number(s.contract_months || 0);
    if (_cm === 12) r.my12 += 1; else if (_cm === 18 || _cm === 24) r.myMulti += 1;
    if (isRenewal(s)) { r.ren += 1; r.renRev += rev; } else { r.nw += 1; r.newRev += rev; }
  }
  const rows = [...by.values()].sort((a, b) => b.rev - a.rev || b.sales - a.sales);
  const tot = rows.reduce((t, r) => ({ sales: t.sales + r.sales, nw: t.nw + r.nw, ren: t.ren + r.ren, rev: t.rev + r.rev, newRev: t.newRev + r.newRev, renRev: t.renRev + r.renRev, rec: t.rec + r.rec, my12: t.my12 + r.my12, myMulti: t.myMulti + r.myMulti }), { sales: 0, nw: 0, ren: 0, rev: 0, newRev: 0, renRev: 0, rec: 0, my12: 0, myMulti: 0 });
  const myPct = (r) => (r.my12 + r.myMulti) ? Math.round(r.myMulti / (r.my12 + r.myMulti) * 100) + '%' : '—';
  const acv = (r) => r.sales ? fmt.usd0(r.rev / r.sales) : '—';
  const recMix = (r) => r.sales ? Math.round(r.rec / r.sales * 100) + '%' : '—';
  const open = !!state.dashOfficeView;
  const header = el('button', {
    class: 'w-full flex items-center justify-between gap-3 px-3 py-2 text-left',
    onclick: () => { state.dashOfficeView = !open; mountApp(); },
    title: open ? 'Collapse' : 'Expand office breakdown',
  },
    el('div', { class: 'flex items-center gap-2 min-w-0' },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Office stats'),
      el('span', { class: 'text-[11px] text-muted- truncate' }, rows.length + ' office' + (rows.length === 1 ? '' : 's') + ' · ' + fmt.int(tot.sales) + ' sales · ' + fmt.usd0(tot.rev) + ' · ' + fmt.usd0(tot.newRev) + ' new · ' + fmt.usd0(tot.renRev) + ' renewal · ' + acv(tot) + ' ACV · ' + myPct(tot) + ' MY · ' + recMix(tot) + ' rec')),
    el('span', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' } }, open ? '− Collapse' : '+ Expand'));
  if (!open) return el('div', { class: 'card' }, header);
  const th = (t, right) => el('th', { class: 'px-2 py-1 text-[10px] uppercase tracking-widest font-semibold text-muted- whitespace-nowrap ' + (right ? 'text-right' : 'text-left') }, t);
  const td = (t, right, cls) => el('td', { class: 'px-2 py-1 text-[11px] tabular-nums whitespace-nowrap ' + (right ? 'text-right' : 'text-left') + (cls ? ' ' + cls : '') }, t);
  const line = (r, isTot) => el('tr', { class: isTot ? 'border-t font-bold' : 'border-t', style: { borderColor: 'var(--border)' } },
    td(isTot ? 'Total' : r.name, false, isTot ? '' : 'font-semibold'),
    td(fmt.int(r.sales)), td(fmt.int(r.nw)), td(fmt.int(r.ren)),
    td(fmt.usd0(r.rev)), td(fmt.usd0(r.newRev)), td(fmt.usd0(r.renRev)), td(acv(r)), td(myPct(r)), td(recMix(r)));
  return el('div', { class: 'card' },
    header,
    el('div', { class: 'overflow-x-auto px-1 pb-2' },
      el('table', { class: 'w-full' },
        el('thead', {}, el('tr', {}, th('Office'), th('Sales'), th('New'), th('Renewals'), th('Revenue'), th('New Revenue'), th('Renewal Revenue'), th('ACV'), th('MY %'), th('Rec Mix'))),
        el('tbody', {},
          ...(rows.length ? rows.map(r => line(r, false)) : [el('tr', {}, el('td', { class: 'px-2 py-2 text-[11px] text-muted-', colspan: 10 }, 'No sales in this window.'))]),
          rows.length ? line(tot, true) : null))));
}

function officeDashboard(windowSales) {
  const EXCLUDE = new Set(['cancelled','nsf','not_payable','reschedule','rejected']);
  return el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
    ...state.offices.map(office => {
      const sales = windowSales.filter(s => s.office_id === office.id && !EXCLUDE.has(s.audit_status));
      const revenue = sales.reduce((a,s) => a + Number(s.revenue_amount||0), 0);
      const reps = new Set(sales.map(s => s.rep_id)).size;
      return el('div', { class: 'card p-4' },
        el('div', { class: 'text-[10px] text-muted- uppercase tracking-widest font-semibold' }, office.name),
        el('div', { class: 'text-xl font-black tabular-nums mt-1' }, fmt.int(sales.length)),
        el('div', { class: 'text-xs text-muted- mt-1' }, fmt.usd0(revenue) + ' \u00b7 ' + reps + ' rep' + (reps !== 1 ? 's' : '')),
      );
    }),
  );
}

function microGoalWidget() {
  const goal = getGoalForContext();
  const dailyTarget = Math.ceil(goal.amount / 250);
  const todayKey = bizTodayIso();   // was UTC — flipped to "tomorrow" at 8pm ET
  const EXCLUDE = new Set(['cancelled','nsf','not_payable','reschedule','rejected']);
  const todayCount = dashboardSales().filter(s => s.sold_date === todayKey && !EXCLUDE.has(s.audit_status) && s.rep_id === state.profile.id).length;
  const remaining = Math.max(0, dailyTarget - todayCount);
  const hit = remaining === 0;
  return el('div', {
    class: 'card px-4 py-3 flex items-center gap-3',
    style: hit ? { borderLeft: '3px solid var(--accent)' } : { borderLeft: '3px solid var(--border-2)' },
  },
    el('div', { class: 'text-xl' }, hit ? '\u2705' : '\ud83c\udfaf'),
    el('div', { class: 'flex-1' },
      el('div', { class: 'text-sm font-semibold' }, hit ? 'Daily target hit!' : remaining + ' more sale' + (remaining > 1 ? 's' : '') + ' to hit daily target'),
      el('div', { class: 'text-[10px] text-muted-' }, todayCount + ' / ' + dailyTarget + ' today'),
    ),
  );
}

