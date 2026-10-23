// ──────────────────────────────────────────────────────────────────────────
// Global state
// ──────────────────────────────────────────────────────────────────────────
const state = {
  session: null,
  profile: null,           // current user's profile row
  offices: [],
  serviceTypes: [],
  sources: [],
  contractTypes: [],
  view: 'dashboard',       // dashboard | sales | pay | competitions | history | admin
  theme: (localStorage.getItem('ridd-theme') || 'light'),
  // cached collections
  mySales: [],
  allSales: [],            // admin only
  payAdjustments: [],      // per-pay-period Other Pay lines (bonuses, comps…) — pay_adjustments
  allProfiles: [],         // admin only — list of all reps with their profile info
  competitions: [],
  compRules: [],           // all rules for all competitions
  compProgress: [],        // all progress rows
  leaderboard: [],         // legacy raw rows (replaced by computeLeaderboard)
  // Dashboard state
  dashDateRange: 'today',  // today|yesterday|week|last_week|month|last_month|year|last_year|all|custom
  dashCustomStart: null,
  dashCustomEnd: null,
  // Pay tab
  payYear: null,           // int year, defaults to current year in viewPay
  payPeriodId: null,       // int 1..26, defaults to current period in viewPay
  dashGoalTab: 'total',    // total | new | renewal
  dashLeaderTab: 'total',  // total | new | renewals  ← leaderboard filter
  dashLeaderSort: 'sales', // sales | revenue | initial | recurring | acv | my_pct | rec_mix_pct
  // Revenue goal config
  companyGoal: { amount: 6000000, period: 'year' },   // company-wide annual (loaded from app_settings)
  sidebarOpen: false,      // mobile drawer state
  auditLog: [],            // activity timeline
  notifLastSeen: null,     // ISO timestamp of last notification seen
  salesFilters: { dateStart: '', dateEnd: '', status: '', repId: '', contractTypeId: '' },
  dashOfficeView: false,
  // Calendar / shifts
  shifts: [],                  // { id, rep_id, date, start, end, slot_id, slot_start, slot_end, department, note, recurring }
  shiftSwapRequests: [],       // { id, shift_id, from_rep_id, to_rep_id, status, note, created_at, resolved_at }
  calendarView: 'month',       // 'week' | 'month' — month is the default (see-your-shifts view)
  calendarAnchor: null,        // ISO 'YYYY-MM-DD' — first day of the currently-viewed week/month window
  calendarDepartment: 'inside_sales', // 'inside_sales' | 'loyalty' — scopes the calendar to a department
  // Reporting tab — admin-only, populated by loadReportingMetadata()
  reportingUploads: [],            // [{ id, uploaded_at, uploaded_by, filename, row_count, notes }]
  reportingServiceConfig: [],      // [{ service_name, category, is_recurring, is_hidden, lifecycle }]
  reportingCancelConfig: [],       // [{ reason, counts_attrition }] — attrition exclusions
  reportingSourceConfig: [],       // [{ source, included }] — sources excluded from all reporting
  reportingActiveUploadId: null,   // currently-selected snapshot
  reportingSubscriptions: [],      // rows for the active snapshot (lazy-loaded)
  reportingSubscriptionsLoadedFor: null, // upload_id whose rows are in reportingSubscriptions
  reportingSubTab: 'overview',     // 'overview' | 'config' | 'uploads'
  reportingOffice: 'all',          // office_name filter for Overview ('all' = no filter)
  reportingCompareMode: false,     // when true, Overview splits into A vs B
  reportingCompareOffice: 'all',   // second office for compare mode
  reportingDateRange: 'all',       // 'all' | 'today' | 'yesterday' | 'last_7' | 'last_30' | 'last_90' | 'ytd' | 'last_12_months' | 'last_year' | 'custom'
  reportingDateStart: '',          // ISO yyyy-mm-dd (only used when range='custom')
  reportingDateEnd: '',            // ISO yyyy-mm-dd (only used when range='custom')
  reportingWaterfallMode: 'subscription', // 'subscription' | 'arv' | 'contract' | 'rep'
  reportingGeoMetric: 'customers', // default map metric (per Isaac) — distinct customer count, not subs
  reportingZipSort: 'subs',        // sort column for the ZIP table on Geographic tab
  reportingZipSortDir: 'desc',     // 'asc' | 'desc'
  reportingMapLevel: 'country',    // 'country' | 'state' — drives which choropleth renders
  reportingMapState: null,         // state code (e.g., 'UT') when drilled into a state
  reportingHighlightedZip: null,   // ZIP code the map should zoom to + highlight (set by table-row click)
  reportingDrillBy: 'zip',         // 'zip' | 'county' — within-state breakdown granularity
  reportingHighlightedCounty: null,// normalized county name the map should zoom to + highlight
};
// Debug: expose state for console inspection (remove before prod)
// ── External modules (e.g. riddmarket) plug into the shell WITHOUT editing
// app.js. A module file (modules/<id>.js, loaded after app.js in index.html)
// calls registerRiddModule({ id, label, title, icon, canView, render }):
//   id       — view key + URL hash ('#<id>'); keep it to [a-z0-9_]
//   label    — nav menu text; title — page header (defaults to label)
//   icon     — a Node (SVG/emoji span) or a function returning one
//   canView  — (ctx) => bool; ctx = { profile, isAdmin, role, userCan }
//   render   — (ctx) => Node; ctx adds { el, state, supabase, mountApp, toast, fmt, openReportingDrillModal }
//   onEnter  — optional (ctx) => void, fired when the view opens
// Guardrails: the module gets the SAME anon Supabase client as the app (RLS
// is the security boundary), keeps its own state under state.modules[id],
// and lives in its own DB schema. See CONTRIBUTING-MODULES.md.
window.RIDD_MODULES = window.RIDD_MODULES || [];
window.registerRiddModule = function (mod) {
  if (!mod || !/^[a-z][a-z0-9_]*$/.test(String(mod.id || '')) || typeof mod.render !== 'function') { console.warn('[ridd] bad module registration', mod); return; }
  const i = window.RIDD_MODULES.findIndex(m => m.id === mod.id);
  if (i >= 0) window.RIDD_MODULES[i] = mod; else window.RIDD_MODULES.push(mod);
  state.modules = state.modules || {}; state.modules[mod.id] = state.modules[mod.id] || {};
  if (document.getElementById('app') && state.profile) { try { mountApp(); } catch (e) { console.warn('[ridd] module mount', e); } }
};
function _moduleCtx() {
  const role = state.profile && state.profile.role;
  return { profile: state.profile, role, isAdmin: isAdminRole(role), userCan: (k) => (typeof userCan === 'function' ? userCan(k) : false),
    el, state, supabase, mountApp, toast, fmt, openReportingDrillModal: (typeof openReportingDrillModal === 'function' ? openReportingDrillModal : null),
    store: (state.modules = state.modules || {}) };
}
function _visibleModules() { try { const ctx = _moduleCtx(); return (window.RIDD_MODULES || []).filter(m => { try { return typeof m.canView === 'function' ? !!m.canView(ctx) : true; } catch { return false; } }); } catch { return []; } }
window.__RIDD = state;
// Newer debug hook used by the deploy verifier — exposes the role helpers
// alongside state so we can confirm a deploy actually shipped.
window.__ridd = {
  get state() { return state; },
  // Supabase client + the demo/local persister — needed for console-driven
  // recovery jobs (e.g. restoring NRLA rosters from a season archive).
  get supabase() { return supabase; },
  saveDemoData,
  // Comp internals for console diagnostics (per Isaac's Kobe blank-board hunt)
  kobeWeekCompute, isRepActive, frPendingServiced, dateSoldToIso,
  isAdminRole, ADMIN_ROLES, SELLER_ROLES,
  // Save helpers exposed so DevTools-driven bulk edits (e.g. "mark every
  // untagged rep as rookie") can persist through the same pipeline a UI
  // change would — localStorage cache + Supabase mirror.
  saveIndicatorState,
  saveIndicatorConfigToSupabase,
  mountApp,
  setRepTier, getRepTier,
  setRepTeam, getRepTeam,
  setRepOffice, getRepOffice,
  setTeamColor, getTeamColor,
  setTeamLogo,  getTeamLogo,
};

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ridd-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1C1C1B' : '#FFFFFF');
}
applyTheme(state.theme);

function toggleTheme() {
  applyTheme(state.theme === 'light' ? 'dark' : 'light');
  if (state.session || DEMO) mountApp();
}

// ── RESUME WHERE YOU LEFT OFF ────────────────────────────────────────────
// iOS cold-launches a PWA at the manifest start_url, losing the tab you
// were on. We save the current spot continuously; a relaunch within the
// window restores tab + sub-tab + scroll, like a native app resume. Past
// the window it opens fresh on the default screen.
const RESUME_KEY = 'ridd_resume_v1';
const RESUME_WINDOW_MS = 5 * 60 * 1000;   // "last place" survives a 5-min backgrounding
function _saveResume() {
  if (window._riddNoResumeSave) return;   // a View-as switch is reloading — don't note the admin's tab for the preview to resume
  try {
    if (!state.view) return;
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      view: state.view, at: Date.now(), scroll: window.scrollY || 0,
      reportingSubTab: state.reportingSubTab || null,
      adminSection: state.adminSection || null,
      adminSubTab: state._adminSubTab || null,
    }));
  } catch { /* private mode */ }
}
function _applyResume() {
  try {
    const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    if (!r || !r.view || (Date.now() - (r.at || 0)) > RESUME_WINDOW_MS) return false;
    state.view = r.view;
    if (r.reportingSubTab) state.reportingSubTab = r.reportingSubTab;
    if (r.adminSection)    state.adminSection = r.adminSection;
    if (r.adminSubTab)     state._adminSubTab = r.adminSubTab;
    state._resumeScroll = r.scroll || 0;
    return true;
  } catch { return false; }
}
window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _saveResume(); });
window.addEventListener('pagehide', _saveResume);

