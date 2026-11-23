// ┌─ dashp/module ────────────────────────────────────────────────────────────
// │ COMMISSIONS (DASHP) — the page itself: the top bar (Technicians / Sales
// │ Reps, Year, Quarter or Version, Refresh), which screen is showing, and the
// │ registration that puts "Commissions" in the nav (registerRiddModule — the
// │ same hook Pricing uses, so app-shell and nav-mount are untouched).
// │
// │ Who sees it: admins and developers — the same people the server lets read
// │ /api/dashp/* (server/services/dashp/index.js). Widen one, widen the other.
// │
// │ The folder, top to bottom:
// │   api.js          fetch + cache + DASHP's shapes turned into plain view data
// │   ui.js           stat tile, line, chip, tabs, expandable card, THE table
// │   technicians.js  list (per quarter / full year) + one technician's quarter
// │   d2d.js          list (per year, live / pinned / final) + one rep's year
// │   module.js       this file
// │ Nothing outside app/src/dashp/ calls into it, and it calls out only to
// │ el, fmt, state, mountApp, svg, _apiAuthHeaders, isAdminRole, isDeveloperRole.
// └────────────────────────────────────────────────────────────────────────

function dashpView() {
  const S = dashpStore();
  if (!S.year) S.year = new Date().getFullYear();
  // Office Staff (per Isaac, Nov 18): the Pay sub-tab moved here. Office reps see only that tab and only themselves.
  const _officeOnly = typeof dashpOfficeCanSeeAll === 'function' && !dashpOfficeCanSeeAll();
  // Sales (per Isaac, Nov 18): the Inside Sales → Sales tab (log a sale, the rep's list, the auditing queue) moved
  // here too, so everything money-related is one tab. Same renderer (viewSales), same permissions row.
  const _r = state.profile && state.profile.role, _aud = _r === 'auditor';
  const _canSales = typeof viewSales === 'function' && (isAdminRole(_r) || _aud || typeof VIEW_TAB_PERM === 'undefined' || !VIEW_TAB_PERM.sales || (typeof userCan === 'function' && userCan(VIEW_TAB_PERM.sales)));
  // Sales sub-tab retired (per Isaac, Nov 23): the same screen (log a sale, the sales list, the auditing queue) now
  // folds open at the foot of Office Staff. Auditors have no pay to look at, so they land straight on it.
  const _tabs = _officeOnly ? [['office', 'Office Staff']] : [['tech', 'Technicians'], ['d2d', 'Sales Reps'], ['office', 'Office Staff']];
  if (!_tabs.some(([k]) => k === S.tab)) S.tab = _tabs[0][0];
  const salesSection = (open) => {
    if (!_canSales) return null;
    const isOpen = S.salesOpen == null ? open : S.salesOpen;
    return el('div', { class: 'flex flex-col gap-3' },
      el('button', { class: 'card p-3 flex items-center gap-3 w-full text-left', onclick: () => { S.salesOpen = !isOpen; mountApp(); } },
        el('span', { class: 'text-sm font-black' }, (isOpen ? '\u25be ' : '\u25b8 ') + (isAdminRole(_r) || _aud ? 'Sales & audit queue' : 'Your sales')),
        el('span', { class: 'text-[10px] flex-1 text-right', style: { color: 'var(--text-subtle)' } }, 'Log a sale, the sales list and the auditing queue \u2014 what payroll pays from')),
      isOpen ? viewSales() : null);
  };
  if (_aud) return el('div', { class: 'flex flex-col gap-4' }, salesSection(true));
  const thisYear = new Date().getFullYear();
  const years = []; for (let y = thisYear; y >= 2024; y--) years.push([y, String(y)]);   // DASHP has no "which years exist" list; an empty year just shows an empty table

  // Detail open: a back link instead of the pickers (the detail belongs to the year / quarter it was opened from).
  if (S.detail) {
    const d = S.detail;
    if (_officeOnly && d.kind === 'office') return dashpOfficeDetailView(S);
    return el('div', { class: 'flex flex-col gap-4' },
      el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => { S.detail = null; mountApp(); } },
          '← ' + (d.kind === 'tech' ? 'All technicians' : d.kind === 'office' ? 'All office staff' : 'All sales reps')),
        // Technician: hop between this person's quarters without going back to the list.
        d.kind === 'tech' ? dashpTabs([1, 2, 3, 4].map(q => [q, 'Q' + q]), d.quarter, (q) => { S.detail = Object.assign({}, d, { quarter: Number(q) }); mountApp(); }) : null,
        el('div', { class: 'text-[10px] flex-1 text-right', style: { color: 'var(--text-subtle)' } }, d.kind === 'office' ? 'Live · the same stub payroll pays from' : 'Read-only · calculated by DASHP, refreshed hourly')),
      d.kind === 'tech' ? dashpTechDetailView(S) : d.kind === 'office' ? dashpOfficeDetailView(S) : dashpD2dDetailView(S));
  }

  // Build the list first: the technician list works out which quarter to show, and the bar's select reads it.
  const body = S.tab === 'tech' ? dashpTechList(S) : S.tab === 'office' ? dashpOfficeList(S) : dashpD2dList(S);
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
      dashpTabs(_tabs, S.tab, (v) => { S.tab = v; S.detail = null; mountApp(); }),
      dashpSelect('Year', S.year, years, (v) => { S.year = Number(v); S.techQuarter = null; mountApp(); }),
      S.tab === 'office'
        ? dashpSelect('Period', S.osPeriodShown == null ? 'year' : S.osPeriodShown, [['year', 'Full year'], ...getPayPeriods(S.year).map(p => [p.id, p.label])], (v) => { S.osPeriod = v === 'year' ? 'year' : Number(v); mountApp(); })
        : S.tab === 'tech'
        ? dashpSelect('Quarter', S.techQuarterShown || 'year', [['year', 'Full year'], [1, 'Q1'], [2, 'Q2'], [3, 'Q3'], [4, 'Q4']], (v) => { S.techQuarter = v === 'year' ? 'year' : Number(v); mountApp(); })
        : dashpSelect('Version', S.d2dType || 'live', [['live', 'Live'], ['pinned', 'Pinned'], ['final', 'Final']], (v) => { S.d2dType = v; mountApp(); }),
      el('div', { class: 'text-[10px] flex-1 text-right', style: { color: 'var(--text-subtle)' } }, S.tab === 'office' ? 'Live · the app’s own pay engine (FieldRoutes via RevHawk), the same numbers payroll runs' : 'Read-only · calculated by DASHP, refreshed hourly'),
      S.tab === 'office' ? null : el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => dashpRefresh() }, '↻ Refresh')),
    body,
    S.tab === 'office' ? salesSection(false) : null);
}

registerRiddModule({
  id: 'dashp',                 // the view key and the URL hash (#dashp)
  label: 'Commissions',
  title: 'COMMISSIONS',
  icon: () => (typeof svg === 'function' ? svg('<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>') : el('span', {}, '$')),
  canView: () => { const r = state.profile && state.profile.role; return isAdminRole(r) || isDeveloperRole(r) || r === 'auditor' || (typeof dashpOfficeIsRep === 'function' && dashpOfficeIsRep(state.profile)); },   // office reps: their own pay (+ their sales, folded under it); auditors: the audit queue (per Isaac, Nov 18 / 23)
  render: () => dashpView(),
});