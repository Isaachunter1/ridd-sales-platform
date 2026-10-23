// ═══ PERMISSIONS MATRIX (per Isaac) — what each USER TYPE can see. ═══
// Admins always see everything. Defaults mirror shipped behavior exactly;
// overrides are edited in Settings → Permissions (checkbox matrix) and ride
// the synced config row (competitions.extras.perms), so a change reaches
// every user on every device — no deploy per role tweak.
const PERM_ROLES = ['rep_sales', 'rep_partner', 'rep_team_lead', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'office_staff', 'tech_regional', 'tech_branch', 'tech_senior_lead', 'tech_pro', 'auditor', 'developer'];
// Technician access profiles (per Isaac, Sep 22): explicit roles instead of inferring from the CRM type.
const TECH_ROLES = new Set(['tech_regional', 'tech_branch', 'tech_senior_lead', 'tech_pro']);
const TECH_MANAGER_ROLES = new Set(['tech_regional', 'tech_branch']);
const isTechRole = (r) => TECH_ROLES.has(r);
// Slack DMs per rep type (Settings → Configurations → Slack notifications).
// Defaults per Isaac (Sep 2026): on for office staff, off for D2D + technicians.
// Admins/auditors always allowed. Stored in pay_settings.slack_types so every
// signed-in user loads it.
const SLACK_TYPE_DEFAULTS = { office: true, d2d: false, tech: false };
function slackTypeOfProfile(p) {
  if (!p) return null;
  if (isTechRole(p.role)) return 'tech';
  if (p.role === 'rep_sales' || p.role === 'rep_partner' || p.role === 'rep_team_lead') return 'd2d';
  if (typeof isOfficeStaffProfile === 'function' ? isOfficeStaffProfile(p) : isOfficeStaffRole(p.role)) return 'office';
  return null;
}
function slackAllowedFor(p) {
  if (!p) return false;
  if (isAdminRole(p.role) || p.role === 'auditor') return true;
  const t = slackTypeOfProfile(p);
  if (!t) return false;
  const cfg = Object.assign({}, SLACK_TYPE_DEFAULTS, (state.appSettings && state.appSettings.slack_types) || {});
  return cfg[t] !== false;
}
const isTechManagerRole = (r) => TECH_MANAGER_ROLES.has(r);
const PERM_DEFS = [
  { id: 'view_comps',       label: 'Competitions tab',    group: 'Tabs' },
  { id: 'view_indicators',  label: 'Indicators tab',      group: 'Tabs' },
  { id: 'view_reporting',   label: 'Reporting tab',       group: 'Tabs', sensitive: 'company-wide revenue, attrition and audit reporting' },   // read-only reporting for a non-admin (per Isaac, Sep 22)
  { id: 'view_pricing',     label: 'Pricing tab',         group: 'Tabs' },
  { id: 'view_tv',          label: 'TV Display',          group: 'Tabs' },
  // The role's Sales group sub-tabs (Inside Sales / D2D / Technician bar).
  { id: 'tab_dashboard',    label: 'Sales · Dashboard',   group: 'Sales tabs' },
  { id: 'tab_sales',        label: 'Sales · Sales',       group: 'Sales tabs' },
  { id: 'tab_pay',          label: 'Sales · Pay',         group: 'Sales tabs', sensitive: 'pay stubs and commission amounts' },
  { id: 'tab_scorecards',   label: 'Sales · Scorecards',  group: 'Sales tabs' },
  { id: 'tab_calendar',     label: 'Sales · Calendar',    group: 'Sales tabs' },
  { id: 'tab_hof',          label: 'Sales · Hall of Fame', group: 'Sales tabs' },
  { id: 'tab_loyalty',      label: 'Loyalty (Renewals · Customer Health)', group: 'Tabs' },
  // Settings pages a non-admin may open (Permissions itself stays admin-only).
  { id: 'view_settings',    label: 'Settings',            group: 'Settings', sensitive: 'the Settings area' },
  { id: 'set_users',        label: 'Settings · Users',    group: 'Settings', sensitive: 'every user\u2019s account, role and password reset' },
  { id: 'set_teams',        label: 'Settings · Teams',    group: 'Settings' },
  { id: 'set_goals',        label: 'Settings · Goals',    group: 'Settings', sensitive: 'company and per-rep revenue goals' },
  { id: 'set_comps',        label: 'Settings · Competitions', group: 'Settings' },
  { id: 'set_commissions',  label: 'Settings · Commissions',  group: 'Settings', sensitive: 'commission rates and pay rules' },
  { id: 'set_config',       label: 'Settings · Configurations', group: 'Settings', sensitive: 'the rules behind every reporting number' },
  { id: 'set_marketing',    label: 'Settings · Marketing & lead sources', group: 'Settings', sensitive: 'ad spend, cost per lead and marketing targets' },
  { id: 'set_slack',        label: 'Settings · Slack',    group: 'Settings' },
  { id: 'set_usage',        label: 'Settings · Usage',    group: 'Settings', sensitive: 'what every user looks at in the app' },
  // (My Player Card left the matrix, Oct 16 — it shows automatically for any login linked to a FieldRoutes rep: indShowMyCard.)
  { id: 'ind_table',        label: 'Indicators table',    group: 'Indicators sections' },
  { id: 'ind_power_chart',  label: 'Power Ranking chart', group: 'Indicators sections' },
  { id: 'ind_board',        label: 'Leaderboard',         group: 'Indicators sections' },
  { id: 'ind_yoy',          label: 'Trends',              group: 'Indicators sections' },
  { id: 'ind_trend',        label: 'Metric Trends',       group: 'Indicators sections' },
  { id: 'ind_records',      label: 'Records',       group: 'Indicators sections' },
  { id: 'ind_class',        label: 'Class Metrics', group: 'Indicators sections' },
  { id: 'ind_mix',          label: 'Sales Mix table', group: 'Indicators sections' },
  // Filters → Metric (Sold / Pending · Serviced) + the Passed Audit toggle (per Isaac, Oct 16 — granted by user type).
  { id: 'ind_metric_pick',  label: 'Filters · Metric + Passed Audit', group: 'Indicators sections' },
];
// Sales-group sub-tab defaults = what each family sees today: D2D reps get
// Dashboard / Sales / Pay; office staff the full Inside Sales bar; the
// non-selling office role everything but Pay; auditors just Sales. Pricing is
// open to everyone (as it is now); TV Display to office staff; Reporting and
// Settings to nobody but admins until switched on here.
const _PERM_D2D_TABS    = { tab_dashboard: 1, tab_sales: 1, tab_pay: 1, tab_hof: 1, view_pricing: 1 };
const _PERM_OFFICE_TABS = { tab_dashboard: 1, tab_sales: 1, tab_pay: 1, tab_scorecards: 1, tab_calendar: 1, tab_hof: 1, view_pricing: 1, view_tv: 1, tab_loyalty: 1 };   // Loyalty tab (per Isaac, Sep 23): office staff only
const _PERM_TECH_TABS   = { tab_dashboard: 1, tab_sales: 1, tab_pay: 1, tab_hof: 1, view_pricing: 1, view_tv: 1 };
const PERM_DEFAULTS = {
  // Oct 16 (per Isaac — opening up for the leadership / rep rollout, cautiously): every selling role also gets
  // Records and Class Metrics — rep-vs-rep production they already see on the leaderboard, no pay, no company totals.
  rep_sales:       { view_comps: 1, view_indicators: 1, ind_card: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ..._PERM_D2D_TABS },   // no Indicators table / Power Ranking for sales reps (per Isaac, Sep 2026)
  rep_office:      { view_comps: 1, view_indicators: 1, ind_card: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ..._PERM_OFFICE_TABS },
  rep_loyalty:     { view_comps: 1, view_indicators: 1, ind_card: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ..._PERM_OFFICE_TABS },
  rep_partner:     { ind_metric_pick: 1, view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1, view_settings: 1, set_goals: 1, ..._PERM_D2D_TABS },   // Settings → Goals: their own reps' yearly goals (per Isaac, Sep 23)
  rep_team_lead:   { ind_metric_pick: 1, view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1, view_settings: 1, set_goals: 1, ..._PERM_D2D_TABS },
  rep_office_lead: { ind_metric_pick: 1, view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1, ..._PERM_OFFICE_TABS },
  rep_loyalty_lead: { ind_metric_pick: 1, view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1, ..._PERM_OFFICE_TABS },
  // Office Staff - Office (per Isaac, Sep 22): works in the office, doesn't sell — no player card, no pay; sees the boards. Tune in Settings → Permissions.
  office_staff:    { ind_metric_pick: 1, view_comps: 1, view_indicators: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ..._PERM_OFFICE_TABS, tab_pay: 0 },
  // Technicians (per Isaac, Sep 22): Service Pros get their dashboard / sales / pay; leads add the Indicators table; managers add the Power Ranking + mix.
  tech_pro:         { view_indicators: 1, ind_card: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ..._PERM_TECH_TABS },
  tech_senior_lead: { view_indicators: 1, ind_card: 1, ind_table: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ..._PERM_TECH_TABS },
  tech_branch:      { view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1, ..._PERM_TECH_TABS },
  tech_regional:    { view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1, ..._PERM_TECH_TABS },
  auditor:         { tab_sales: 1, view_pricing: 1 },   // auditors live in the Sales queue — grant extras here as needed
  // Developer (per Isaac, Oct 1): the tech guy sees every LAYER of the app —
  // all three Sales worlds, Loyalty, Competitions, Indicators, the read-only
  // Reporting tabs and the non-sensitive Settings pages. P&L + Marketing show
  // their full UI on SAMPLE numbers (devSampleData, src/80) — never QuickBooks
  // or ad spend; no pay stubs, commission rules, goals, users, usage or
  // Connections (keys). Tune in Settings → Permissions like any role.
  developer:       { view_comps: 1, view_indicators: 1, view_reporting: 1, view_pricing: 1, view_tv: 1,
                     tab_dashboard: 1, tab_sales: 1, tab_scorecards: 1, tab_calendar: 1, tab_hof: 1, tab_loyalty: 1,
                     ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1,
                     view_settings: 1, set_teams: 1, set_comps: 1, set_config: 1, set_marketing: 1, set_slack: 1 },
};
// Settings pages → the permission that opens each (Permissions itself is admin-only, always).
const ADMIN_SECTION_PERM = { calendar: 'tab_calendar', users: 'set_users', teams: 'set_teams', goals: 'set_goals', comps: 'set_comps', pricing: 'set_commissions', config: 'set_config', marketing: 'set_marketing', slack: 'set_slack', usage: 'set_usage' };   // 'data' (Data sources) is admin-only, never delegated
// Sub-tab view key → its Sales-tab permission (all three groups).
const VIEW_TAB_PERM = { dashboard: 'tab_dashboard', sales: 'tab_sales', pay: 'tab_pay', scorecards: 'tab_scorecards', calendar: 'tab_calendar', hall_of_fame: 'tab_hof', d2d_hof: 'tab_hof', tech_hof: 'tab_hof',
  d2d_dashboard: 'tab_dashboard', d2d_sales: 'tab_sales', commission: 'tab_pay', techs: 'tab_dashboard', all_dashboard: 'tab_dashboard', tech_sales: 'tab_sales', tab_pay: 'tab_pay', tech_pay: 'tab_pay', loyalty_dashboard: 'tab_loyalty', loyalty_renewals: 'tab_loyalty', loyalty_health: 'tab_loyalty' };
// Loyalty tab (per Isaac, Sep 24): every office rep, loyalty rep and loyalty / office lead — always; others via Settings → Permissions.
function canOpenLoyalty(profile) { const p = profile || state.profile; return !!p && (isAdminRole(p.role) || ['rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'office_staff'].includes(String(p.role || '')) || userCan('tab_loyalty', p)); }
// Non-admins may open Settings when granted; only the sections they hold.
function canOpenSettings(profile) { const p = profile || state.profile; return !!p && (isAdminRole(p.role) || userCan('view_settings', p)); }
function canOpenAdminSection(k, profile) { const p = profile || state.profile; if (!p) return false; if (isAdminRole(p.role)) return true; if (k === 'perms' || k === 'uploads' || k === 'data') return false; return userCan('view_settings', p) && !!ADMIN_SECTION_PERM[k] && userCan(ADMIN_SECTION_PERM[k], p); }
// Effective permission role: legacy 'rep' resolves by CRM type.
function _permRoleOf(profile) {
  const r = (profile && profile.role) || '';
  if (PERM_DEFAULTS[r]) return r;
  if (r === 'rep') {
    try { return (typeof repTypeGroup === 'function' && repTypeGroup(profile) === 'office') ? 'rep_office' : 'rep_sales'; }
    catch (e) { return 'rep_sales'; }
  }
  return 'rep_sales';
}
// Manual upsell logging stays until Configurations → Auto-log → Upsells is
// flipped to Automatic (add-on tickets in FieldRoutes). One switch, no lag.
function manualUpsellsOn() {
  // Manual sale / upsell logging is RETIRED (per Isaac, Sep 2026): every
  // sale and upsell comes from FieldRoutes through the syncs. The form
  // still opens for EDITS and queue claims; nobody logs from scratch.
  return false;
}
function userCan(permId, profile) {
  const p = profile || state.profile;
  if (!p) return false;
  if (isAdminRole(p.role)) return true;
  const role = _permRoleOf(p);
  const overrides = (state._compExtras && state._compExtras.perms) || {};
  const eff = { ...(PERM_DEFAULTS[role] || {}), ...(overrides[role] || {}) };
  return !!eff[permId];
}


// ── SCOPED permissions — not on/off but WHO it reaches. First scoped row:
// player-card drill-down on the Rep Leaderboard / Records (self is ALWAYS
// allowed — a rep can never lose their own card). Edited in the same
// Settings → Permissions matrix as dropdowns; synced the same way.
const PERM_SCOPES = ['none', 'self', 'team', 'dept', 'all'];
const PERM_SCOPE_LABELS = { none: 'Nobody else', self: 'Self only', team: 'Own team', dept: 'Own dept', all: 'Everyone' };
const PERM_SCOPE_DEFS = [
  { id: 'drill_scope', label: 'Player-card drill-down', group: 'Reach',
    help: 'Whose DETAILED player cards this user type can open (leaderboard rows, record drill-downs). Headline numbers stay visible to all; the full card is what this gates. Self always works.' },
  // Data reach (per Isaac, Sep 22): self / own team / own dept / company for
  // what a role SEES, separate from what it can drill into.
  { id: 'board_scope', label: 'Leaderboard rows', group: 'Reach',
    help: 'Whose rows this user type sees on the leaderboards (Indicators rep leaderboard, Dashboard leaderboard). Self only = just their own row; Own team = their team; Own dept = inside sales or D2D; Everyone = the company.' },
  { id: 'sales_scope', label: 'Sales tab rows', group: 'Reach',
    help: 'Whose sales this user type sees on the Sales tab. Self only = their own sales (today\u2019s behaviour for reps); Own team / Own dept / Everyone widen it.' },
];
const PERM_SCOPE_DEFAULTS = {
  rep_sales:       { drill_scope: 'self' },
  rep_office:      { drill_scope: 'self' },
  rep_loyalty:     { drill_scope: 'self' },
  rep_partner:     { drill_scope: 'team' },
  rep_team_lead:   { drill_scope: 'team' },
  rep_office_lead: { drill_scope: 'dept' },
  rep_loyalty_lead: { drill_scope: 'dept' },
  office_staff:    { drill_scope: 'all', board_scope: 'all' },   // Office Staff - Office walks all three dashboards and opens any rep's player card (per Isaac, Oct 6); Reporting stays off (no view_reporting)
  tech_pro:         { drill_scope: 'self', sales_scope: 'self' },
  tech_senior_lead: { drill_scope: 'team', sales_scope: 'team' },
  tech_branch:      { drill_scope: 'dept', sales_scope: 'team' },
  tech_regional:    { drill_scope: 'all', sales_scope: 'all' },
  auditor:         { drill_scope: 'none' },
  developer:       { drill_scope: 'all', sales_scope: 'all' },
};
// Data-reach defaults = today's behaviour: every role sees every leaderboard
// row; reps see only their own sales on the Sales tab.
for (const _r of Object.keys(PERM_SCOPE_DEFAULTS)) { PERM_SCOPE_DEFAULTS[_r].board_scope = 'all'; PERM_SCOPE_DEFAULTS[_r].sales_scope = PERM_SCOPE_DEFAULTS[_r].sales_scope || 'self'; }
function userScope(scopeId, profile) {
  const p = profile || state.profile;
  if (!p) return 'none';
  if (isAdminRole(p.role)) return 'all';
  const role = _permRoleOf(p);
  const overrides = (state._compExtras && state._compExtras.permScopes) || {};
  const v = (overrides[role] && overrides[role][scopeId]) || (PERM_SCOPE_DEFAULTS[role] || {})[scopeId];
  return PERM_SCOPES.includes(v) ? v : 'self';
}

// Role helpers — keep "has admin powers" and "is a seller" consistent across
// the codebase. `admin_rep` is an admin who also sells (on leaderboard, has a
// Pay tab); `admin` is admin-only (not on leaderboard, no sales).
const ADMIN_ROLES   = ['admin', 'admin_rep'];
const SELLER_ROLES  = ['rep', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'rep_sales', 'rep_partner', 'rep_team_lead', 'admin_rep'];
const isAdminRole   = (r) => ADMIN_ROLES.includes(r);
const isSellerRole  = (r) => SELLER_ROLES.includes(r);
const isAuditorRole = (r) => r === 'auditor';
const isDeveloperRole = (r) => r === 'developer';   // see PERM_DEFAULTS.developer
// Who gets the Office Staff / D2D Sales / Technicians switch at the top of Sales: admins, developers, and the
// non-selling "Office Staff - Office" role (per Isaac, Oct 6 — e.g. Cameron). Outside their own world that
// role sees the Dashboard only: no Sales queue, no Pay.
const canWalkWorlds = (r) => isAdminRole(r) || r === 'developer' || r === 'office_staff';
// Rep - Partner: a D2D rep who LEADS a team. Same permissions as a Sales
// Rep everywhere, plus: they can open the player cards of reps on THEIR
// team (leaderboard + records) — never the whole company.
// Partner (business partner) and D2D Team Lead are separate CATEGORIES now
// (per Isaac) — same team-lead powers by default, independently tunable in
// Settings → Permissions. isPartnerRole covers both where "leads a team"
// is what matters (player-card access, analyst layout ordering).
const isPartnerRole = (r) => r === 'rep_partner' || r === 'rep_team_lead';
// Office Staff - Team Lead: an office-staff rep who LEADS the call center.
// Same permissions as Office Staff everywhere, plus: they can open the
// player cards of OFFICE STAFF reps (their team), mirroring rep_partner.
const isOfficeLeadRole = (r) => r === 'rep_office_lead' || r === 'rep_loyalty_lead';
// Human-readable label for any role enum value, used wherever we render a
// role to the UI. Keeps the Users table, the editor dropdown, and the
// profile menu in sync without scattering string-cases.
const ROLE_LABEL = {
  rep:        'Rep (legacy)',   // pre-migration accounts; behaves like its CRM type
  rep_sales:  'Sales Rep - Rep',
  rep_partner:'Sales Rep - Partner',
  rep_team_lead:'Sales Rep - Team Lead',
  rep_office: 'Office Staff - Inside Sales Rep',
  rep_office_lead: 'Office Staff - Inside Sales Team Lead',
  rep_loyalty: 'Office Staff - Loyalty Rep',
  rep_loyalty_lead: 'Office Staff - Loyalty Team Lead',
  office_staff: 'Office Staff - Office',   // non-selling office user (per Isaac, Sep 22)
  tech_regional: 'Technician - Regional Manager',
  tech_branch: 'Technician - Office Manager',
  tech_senior_lead: 'Technician - Senior Lead Service Pro',
  tech_pro: 'Technician - Service Pro',
  admin_rep:  'Admin',   // one "Admin" label (per Isaac) — admin_rep still sells under the hood
  admin:      'Admin',
  auditor:    'Auditor',
  developer:  'Developer',
};
const roleLabel = (r) => ROLE_LABEL[r] || r || '';
// Owner admin (per Isaac, Sep 2026): exactly one profile has is_owner —
// the only login that can grant / remove admin access or hand ownership
// on. Checked against the REAL profile so "view as" can never borrow it.
const isOwnerUser = () => !!((state._realProfile || state.profile || {}).is_owner);
const roleLabelOf = (p) => !p ? '' : (p.is_owner ? 'Admin - Owner' : roleLabel(p.role));
// Rep access flavors. The explicit roles decide directly; the legacy 'rep'
// role falls back to the CRM rep-type lookup (state.myRepType, fetched at
// login) so existing accounts keep working unchanged.
const isOfficeStaffRole = (r) => r === 'rep_office' || r === 'rep_office_lead' || r === 'rep_loyalty' || r === 'rep_loyalty_lead' || r === 'office_staff'
  || (r === 'rep' && crmSellerIs('office_staff', state.myRepType || ''));

