// ──────────────────────────────────────────────────────────────────────────
// Data loaders
// ──────────────────────────────────────────────────────────────────────────
// ── Access re-check (per Isaac, Sep 2026): a signed-in session survives a
// refresh by design (Supabase refresh token), so deactivating a user must
// also bite mid-session. Every time the tab regains focus, and every 10
// minutes, re-read the user's own profile: inactive or disabled → sign out
// on the spot. The server-side twin is the custom access-token hook in
// auth_access_hook.sql, which refuses to mint a new token for them at all.
async function _recheckAccess() {
  try {
    if (typeof DEMO !== 'undefined' && DEMO) return;
    if (!state.session || !state._realProfile) return;
    const { data } = await supabase.from('profiles').select('is_active, role').eq('id', state._realProfile.id).maybeSingle();
    if (!data) return;
    if (data.is_active === false || data.role === 'disabled') {
      await supabase.auth.signOut();
      state.session = null; state.profile = null;
      location.reload();
    }
  } catch (e) { /* offline or transient — the next check will run */ }
}
// Inactivity timeout (per Isaac): 6 hours without a click / keypress / tap
// and the session ends — next visit is the login screen. Tracked in
// localStorage so it survives refreshes; the Supabase-side twin is
// Authentication → Sessions → inactivity timeout, when the plan allows it.
const IDLE_LIMIT_MS = 6 * 60 * 60 * 1000;
function _touchActivity() { try { localStorage.setItem('ridd_last_active', String(Date.now())); } catch (e) {} }
async function _checkIdle() {
  try {
    if (typeof DEMO !== 'undefined' && DEMO) return;
    if (!state.session) return;
    // The TV board is an unattended wall screen (per Isaac): nobody touches
    // it all day, so the board itself counts as activity — it must never
    // idle out to the login screen mid-shift.
    if (state._tvOpen) { _touchActivity(); return; }
    const last = Number(localStorage.getItem('ridd_last_active') || 0);
    if (last && Date.now() - last > IDLE_LIMIT_MS) {
      await supabase.auth.signOut();
      state.session = null; state.profile = null;
      try { localStorage.removeItem('ridd_last_active'); } catch (e) {}
      location.reload();
    }
  } catch (e) { /* best effort */ }
}
if (!window._riddAccessWired) {
  window._riddAccessWired = true;
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, _touchActivity, { passive: true }));
  _touchActivity();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _checkIdle(); });
  setInterval(_checkIdle, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _recheckAccess(); });
  setInterval(_recheckAccess, 10 * 60 * 1000);
}
async function loadProfile() {
  // Defensive: some entry paths (password recovery, stale tabs) can get here
  // before the auth listener has populated state.session — self-heal from
  // the SDK instead of crashing on session.user.
  if (!state.session) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) state.session = session;
    } catch { /* fall through to the explicit error below */ }
  }
  if (!state.session) throw new Error('No active session — please sign in again.');
  const uid  = state.session.user.id;
  const user = state.session.user;
  // maybeSingle() returns null instead of throwing when no row matches —
  // lets us self-heal an orphaned auth.users row by inserting a profile
  // (e.g. when the schema was reset after the auth user was already created,
  // or when the dashboard 'Add user' flow updated an existing row instead of
  // inserting and so the on_auth_user_created trigger never fired).
  let { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  if (!data) {
    const fullName = user.user_metadata?.full_name
      || user.user_metadata?.name
      || (user.email ? user.email.split('@')[0] : 'User');
    const { data: created, error: insertErr } = await supabase
      .from('profiles')
      .insert({ id: uid, email: user.email, full_name: fullName, role: 'rep' })
      .select('*')
      .single();
    if (insertErr) throw insertErr;
    data = created;
  }
  // Enforce login deactivation: an admin flipping a user inactive in the
  // Users tab should bounce that user out at next page load. Historical
  // sales stay attached to their profile — only the session is killed.
  if (data && data.is_active === false) {
    await supabase.auth.signOut();
    state.session = null;
    throw new Error('This account has been deactivated. Contact an admin to restore access.');
  }
  state._realProfile = data;
  state.profile = data;
  _applyViewAsOverlay();
  try { if (typeof track === 'function') track('session', 'start', _trkDevice(), null, { bundle: (document.querySelector('script[src*=".immutable.js"]') || {}).src ? String(document.querySelector('script[src*=".immutable.js"]').src).replace(/.*app-/, '').replace(/\.immutable.*/, '') : '' }); } catch (e) { /* noop */ }
  // Stamp "Last Login" for the Users tab — the APP sign-in, not FieldRoutes.
  // Own row, one column, via the security-definer RPC in app_last_login.sql.
  // Fire-and-forget: a failure just leaves the previous stamp in place.
  try { Promise.resolve(supabase.rpc('touch_last_login')).catch(() => {}); } catch { /* ignore */ }
  // Rep TYPE for access shaping (Sales Rep → Competitions only · Office
  // Staff → Competitions + Inside Sales). Read from the CRM roster mirror,
  // matched on the linked employee ID or the login email (self-read policy —
  // rep_type_access.sql). A failed lookup degrades to the most restrictive
  // access (Sales Rep treatment).
  state.myRepType = '';
  // Only the LEGACY 'rep' role needs the CRM lookup — the explicit
  // rep_sales / rep_office roles decide access on their own.
  if (data && data.role === 'rep') {
    try {
      let q = supabase.from('fieldroutes_employees').select('type_label');
      q = data.fieldroutes_employee_id
        ? q.eq('employee_id', data.fieldroutes_employee_id)
        : q.ilike('email', data.email || '');
      const { data: fr } = await q.limit(1).maybeSingle();
      state.myRepType = (fr && fr.type_label) || '';
    } catch (e) {
      console.warn('[ridd] rep-type lookup skipped (run rep_type_access.sql?)', e);
    }
  }
}

// Canonical RIDD contract types. Commercial + Paid in Full are checkbox
// modifiers on a sale, NOT contract types, so they're intentionally excluded.
// Used both to seed demo mode and as a fallback when the backend table is
// empty (otherwise the Contract Type dropdown renders with no options).
const DEFAULT_CONTRACT_TYPES = [
  { id: 1, name: '12 Months',        implied_months: 12 },
  { id: 2, name: '18 Months',        implied_months: 18 },
  { id: 3, name: '24 Months',        implied_months: 24 },
  { id: 4, name: 'Upsell - D2D',     implied_months: null },
  { id: 5, name: 'Upsell - Office',  implied_months: null },
  { id: 6, name: 'One Time Service', implied_months: 0 },
];

async function loadLookups() {
  const [offices, serviceTypes, sources, contractTypes] = await Promise.all([
    supabase.from('offices').select('*').order('name'),
    supabase.from('service_types').select('*').order('name'),
    supabase.from('sources').select('*').order('name'),
    supabase.from('contract_types').select('*').order('id'),
  ]);
  state.offices       = offices.data || [];
  state.serviceTypes  = serviceTypes.data || [];
  state.sources       = sources.data || [];
  // Fall back to the canonical list when the table returns nothing, so the
  // Contract Type dropdown is never empty.
  state.contractTypes = (contractTypes.data && contractTypes.data.length)
    ? contractTypes.data
    : DEFAULT_CONTRACT_TYPES.map(c => ({ ...c }));
}

// ── Shared calendar (shifts + swap requests) ──────────────────────────────
// Shifts used to live only in each browser's localStorage — an admin's
// schedule was invisible to everyone else. They now mirror through ONE
// shared row (public.calendar_store): loaded on boot, and any local change
// (create/delete/split/transfer/swap — every path funnels through mountApp)
// is fingerprint-detected and pushed, debounced. Reps can write too: shift
// swaps are rep actions.
let _calCloudFp = null, _calPushT = null, _calLoaded = false;
const _calFp = () => { try { return JSON.stringify([state.shifts, state.shiftSwapRequests, state.calendarMinReps || {}, state.calendarSettings || {}]); } catch { return ''; } };
async function loadCalendarFromCloud() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('calendar_store').select('data').eq('id', 1).maybeSingle();
    if (error) { console.warn('[ridd] calendar cloud load skipped (run calendar_store.sql?)', error.message); return; }
    const d = (data && data.data) || null;
    if (d && Array.isArray(d.shifts)) state.shifts = d.shifts;
    if (d && Array.isArray(d.swaps))  state.shiftSwapRequests = d.swaps;
    if (d && d.minReps && typeof d.minReps === 'object') state.calendarMinReps = d.minReps;
    if (d && d.settings && typeof d.settings === 'object') state.calendarSettings = d.settings;   // Calendar → Settings (Oct 13)
    _calCloudFp = _calFp();
    _calLoaded = true;     // pushes only start once the server copy is in — no stale clobbers
  } catch (e) { console.warn('[ridd] calendar cloud load skipped', e); }
}
function _calendarCloudAutoSync() {
  if (DEMO || !supabase || !state.profile || !_calLoaded) return;
  const fp = _calFp();
  if (fp === _calCloudFp) return;
  _calCloudFp = fp;
  clearTimeout(_calPushT);
  _calPushT = setTimeout(async () => {
    try {
      const { error } = await supabase.from('calendar_store').upsert({
        id: 1,
        data: { shifts: state.shifts || [], swaps: state.shiftSwapRequests || [], minReps: state.calendarMinReps || {}, settings: state.calendarSettings || {} },
        updated_by: state.profile.id,
        updated_at: new Date().toISOString(),
      });
      if (error) healthReport('calendar', false, error); else healthReport('calendar', true);
    } catch (e) { healthReport('calendar', false, e); }
  }, 800);
}

// ── View-as (admin role preview) ─────────────────────────────────────────
// Lets an admin render the app EXACTLY as another role sees it while keeping
// their real admin session (server-side rights unchanged — RLS still sees the
// real JWT). The preview role overlays state.profile?.role; the true row stays
// in state._realProfile and the overlay is re-applied on every profile load.
const VIEW_AS_KEY = 'ridd_view_as_role';
const VIEW_AS_PROFILE_KEY = 'ridd_view_as_profile';   // a specific person (their id) — per Isaac, to test exactly what THEY see
function viewAsRole() { try { return sessionStorage.getItem(VIEW_AS_KEY) || ''; } catch { return ''; } }
function viewAsProfileId() { try { return sessionStorage.getItem(VIEW_AS_PROFILE_KEY) || ''; } catch { return ''; } }
function _applyViewAsOverlay() {
  const r = viewAsRole();
  if (!state._realProfile) return;
  const pid = viewAsProfileId();
  const target = pid ? (state.allProfiles || []).find(p => p.id === pid) : null;
  if (target) {
    // Whole identity: name, id, office, FieldRoutes link, role — so My Stats,
    // the player card, mySales and every "is this me" check answer as them.
    state.profile = Object.assign({}, target, { _viewAs: true });
  } else {
    state.profile = r ? Object.assign({}, state._realProfile, { role: r }) : state._realProfile;
  }
  // mySales is derived from profile.id at load — re-derive under the overlay.
  if (Array.isArray(state.allSales)) state.mySales = state.allSales.filter(s => s.rep_id === state.profile.id);
}
// A preview starts where that user would: their Sales dashboard. Drop the
// admin's current tab (#settings…) and the "resume last tab" note, or the
// reload lands the preview on whatever screen the admin happened to be on.
function _viewAsFreshStart() {
  window._riddNoResumeSave = true;
  try { localStorage.removeItem(RESUME_KEY); } catch { /* private mode */ }
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
}
function setViewAsProfile(profile) {
  const real = state._realProfile || state.profile;
  if (!real || !isAdminRole(real.role) || !profile || !profile.id) return;
  try {
    sessionStorage.setItem(VIEW_AS_PROFILE_KEY, profile.id);
    sessionStorage.setItem(VIEW_AS_KEY, profile.role || 'rep_sales');
    sessionStorage.setItem('ridd_view_as_return', state.view || 'admin');
  } catch { /* private mode */ }
  _viewAsFreshStart();
  location.reload();
}
function setViewAsRole(role) {
  const real = state._realProfile || state.profile;
  if (!real || !isAdminRole(real.role)) return;   // only true admins may preview
  if (!state._realProfile) state._realProfile = real;
  // Full reload on every switch (per Isaac): a re-mount alone kept every
  // dataset the ADMIN had already pulled (full Indicators blob with customer
  // names, all profiles, …) sitting in memory under the previewed role.
  // Reloading makes every fetch, route guard and permission check run as
  // that role from the first byte — the same page a real rep gets. (The
  // JWT stays admin, so server-side RLS is the one thing this can't mimic.)
  let back = 'admin';
  try {
    sessionStorage.removeItem(VIEW_AS_PROFILE_KEY);   // role-only preview (a person preview goes through setViewAsProfile)
    if (role) { sessionStorage.setItem(VIEW_AS_KEY, role); sessionStorage.setItem('ridd_view_as_return', state.view || 'admin'); }
    else { sessionStorage.removeItem(VIEW_AS_KEY); back = sessionStorage.getItem('ridd_view_as_return') || 'admin'; sessionStorage.removeItem('ridd_view_as_return'); }
  } catch { /* private mode etc. — preview just won't survive a reload */ }
  if (!role) { try { history.replaceState(null, '', (typeof VIEW_TO_HASH !== 'undefined' && VIEW_TO_HASH[back]) || '#' + back); } catch { /* ignore */ } }
  else _viewAsFreshStart();
  location.reload();
}

// ── Targeted refreshers ──────────────────────────────────────────────────
// Most actions write ONE table. Re-running loadData() after every save
// (6 queries plus several fire-and-forget config loads that each schedule
// their own remount) is what made small saves feel slow and bouncy. These
// refresh exactly what changed: one query burst, one render.
// Auto-logged D2D / Technician rows (queue_type) live in state.queueSales so
// every Inside Sales screen (Pay, Dashboard tiles, leaderboard) keeps reading
// allSales/mySales = office rows only, exactly as before.
function _splitSalesRows(rows) {
  const office = [], other = { d2d: [], tech: [] };
  for (const s of rows) {
    // 'approved' was the auto-stager's early spelling of the commissionable
    // status; payroll and the queues key on 'serviced' (shown as
    // "Commissionable"). Read both as one.
    if (s.audit_status === 'approved') s.audit_status = 'serviced';
    const q = s.queue_type || 'office'; if (q === 'office') office.push(s); else (other[q] || (other[q] = [])).push(s); }
  state.allSales   = office;
  state.mySales    = office.filter(s => s.rep_id === state.profile.id);
  state.queueSales = other;
}
async function refreshSalesData() {
  const [salesRes, lb, gh, ao] = await Promise.all([
    supabase.from('sales').select('*').order('sold_date', { ascending: false }),
    supabase.from('leaderboard').select('*'),
    loadUnloggedSales(),
    loadAddOns(),
  ]);
  if (salesRes.data) {
    _splitSalesRows(salesRes.data);
  }
  if (lb.data) state.leaderboard = lb.data;
  if (gh) state.unloggedSales = gh;
  if (ao) state.addOns = ao;
}
// Add-ons (per Isaac + COO, Sep 2026 — docs/TECH_UPSELLS.md): one row per
// add-on ticket item on a subscription, with its 5-paid-invoice streak.
// RLS hands reps their own rows. Best-effort until 20260922_add_ons.sql runs.
async function loadAddOns() {
  try {
    const { data, error } = await supabase.from('add_ons').select('*').order('added_at', { ascending: false });
    if (error) return null;
    return data || [];
  } catch (e) { return null; }
}
function addOnOfSale(s) {
  if (!s || !state.addOns || !state.addOns.length) return null;
  if (s.add_on_id != null) return state.addOns.find(a => a.id === s.add_on_id) || null;
  return null;
}
// 👻 Unlogged ("ghost") sales the sync found in FieldRoutes for a rep that
// were never logged here. RLS scopes reps to their own rows. Best-effort:
// until unlogged_sales.sql is run the query errors and we keep [].
async function loadUnloggedSales() {
  try {
    const { data, error } = await supabase.from('unlogged_sales').select('*').order('sold_date', { ascending: false });
    if (error) return null;
    return data || [];
  } catch (e) { return null; }
}
// Profiles RLS only hands non-admins their OWN row, so the calendar,
// scorecards, and leaderboards rendered every other agent as "(removed)"
// for team leads (Pere's report). `profiles_roster` is a limited-column
// view (name / avatar / role / type / office — no pay fields) every
// signed-in user can read; merge it in behind the full rows we DO get.
// Best-effort: until profiles_roster.sql is run the view is missing and
// we simply keep whatever `profiles` returned.
async function fetchProfilesForMe() {
  const full = await supabase.from('profiles').select('*').order('full_name');
  let rows = full.data || null;
  const admin = isAdminRole((state.profile || {}).role);   // overlaid role on purpose — View-as loads what that role loads
  if (!admin || (rows && rows.length <= 1)) {
    try {
      const ro = await supabase.from('profiles_roster').select('*').order('full_name');
      if (!ro.error && Array.isArray(ro.data) && ro.data.length) {
        const byId = new Map(ro.data.map(p => [p.id, p]));
        (rows || []).forEach(p => byId.set(p.id, { ...(byId.get(p.id) || {}), ...p }));
        rows = Array.from(byId.values()).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
      }
    } catch (e) { /* view not installed yet */ }
  }
  return { data: rows, error: full.error };
}
async function refreshProfilesData() {
  const { data } = await fetchProfilesForMe();
  if (data) {
    state.allProfiles = data;
    const me = data.find(p => p.id === (state._realProfile || state.profile || {}).id);
    if (me) { state._realProfile = me; _applyViewAsOverlay(); }
  }
}
async function refreshCompetitionsData() {
  const [comps, rules, progress] = await Promise.all([
    supabase.from('competitions').select('*').order('start_date', { ascending: false }),
    supabase.from('competition_rules').select('*'),
    supabase.from('competition_progress').select('*'),
  ]);
  if (comps.data)    state.competitions = comps.data;
  if (rules.data)    state.compRules    = rules.data;
  if (progress.data) state.compProgress = progress.data;
}

async function loadData() {
  const isAdmin = isAdminRole(state.profile?.role);
  // Always fetch every sales row visible to the current user. RLS
  // decides what's returned: admins get everything; reps get whatever
  // the `sales` SELECT policy allows. The Dashboard wants the full
  // company picture for every role (reps included), so the rep-only
  // .eq('rep_id', …) filter was removed — `state.mySales` is now
  // derived from `state.allSales` client-side instead of a second
  // round-trip. If your Supabase RLS only lets reps see their own
  // rows, the Dashboard will quietly show just their own data; loosen
  // the SELECT policy on `sales` to let authenticated users read all
  // rows if you want the full company view.
  const salesQuery = supabase.from('sales').select('*').order('sold_date', { ascending: false });
  // Admins see every rep on the Users tab and need names + avatars across the
  // sales/queue tables. Reps can only read their own profile per RLS, so for
  // them this select returns just one row — same as state.profile.
  const profilesQuery = fetchProfilesForMe();

  // CRITICAL PATH = what the default view needs: the user's sales + names.
  // Competitions/rules/progress + the legacy leaderboard table hydrate
  // right after first paint instead of holding the splash hostage.
  const [salesRes, profiles] = await Promise.all([salesQuery, profilesQuery]);
  loadUnloggedSales().then(gh => { if (gh) { state.unloggedSales = gh; if (state.view === 'sales') mountApp(); } });
  loadAutologSwitch();   // upsells are always automatic now — no remount needed
  setTimeout(() => {
    Promise.all([
      supabase.from('competitions').select('*').order('start_date', { ascending: false }),
      supabase.from('competition_rules').select('*'),
      supabase.from('competition_progress').select('*'),
      supabase.from('leaderboard').select('*'),
    ]).then(([comps, rules, progress, leaderboard]) => {
      if (comps.data)      state.competitions = comps.data;
      if (rules.data)      state.compRules    = rules.data;
      if (progress.data)   state.compProgress = progress.data;
      if (leaderboard.data) state.leaderboard = leaderboard.data;
      if (['competitions', 'nrla', 'hall_of_fame'].includes(state.view)) mountApp();
    }).catch(err => console.warn('[ridd] comps hydrate skipped', err));
  }, 0);
  // Indicator teams/tiers live on the server now (public.indicator_config).
  // Pulled outside the Promise.all so it isn't gated by the first-load
  // critical path — it can finish on its own. localStorage already
  // populated state at boot, so the UI is never blank waiting on this.
  loadIndicatorConfigFromSupabase().catch(err => console.warn('[ridd] indicator config load skipped', err));
  subscribeRosterRealtime();
  subscribeMySalesRealtime();
  // Pull the company logo from app_settings (single row) so the upload
  // an admin did on browser A shows up on every other admin's browser
  // and on every rep's view. Fire-and-forget — localStorage already
  // populated state.companyLogo for instant first render.
  loadCompanyLogo().catch(err => console.warn('[ridd] company logo load skipped', err));
  loadCalendarFromCloud().then(() => scheduleBackgroundRemount()).catch(err => console.warn('[ridd] calendar load skipped', err));
  loadCommissionConfig().catch(err => console.warn('[ridd] commission config load skipped', err));
  loadCompanyGoal().then(() => scheduleBackgroundRemount()).catch(err => console.warn('[ridd] company goal load skipped', err));
  loadAppSettings().then(() => scheduleBackgroundRemount()).catch(err => console.warn('[ridd] pay settings load skipped', err));
  loadPayAdjustments().then(() => scheduleBackgroundRemount()).catch(err => console.warn('[ridd] pay adjustments load skipped', err));
  // Reporting tab metadata — admin-only, fire-and-forget. The Reporting
  // tab lazy-loads the heavy subscription rows on demand once the user
  // actually visits the tab, so this just primes the uploads list +
  // service config (both small).
  loadReportingMetadata()
    .then(() => autoDeriveIndicatorsFromSnapshot())   // hands-off: keep Indicators current with the nightly snapshot
    .then(() => prefetchReportingSnapshot())          // warm the snapshot in the background so Reporting / Geographic open instantly
    .catch(err => console.warn('[ridd] reporting metadata load skipped', err));

  _splitSalesRows(salesRes.data || []);
  state.competitions = state.competitions || [];
  state.compRules    = state.compRules    || [];
  state.compProgress = state.compProgress || [];
  state.leaderboard  = state.leaderboard  || [];
  state.allProfiles  = profiles.data || [];
  // Re-sync state.profile from the fresh row so changes saved by openUserEditor
  // (or by another admin editing this user) are reflected without a sign-out.
  const me = state.allProfiles.find(p => p.id === (state._realProfile || state.profile || {}).id);
  if (me) { state._realProfile = me; state.profile = me; _applyViewAsOverlay(); }
}

// ──────────────────────────────────────────────────────────────────────────
